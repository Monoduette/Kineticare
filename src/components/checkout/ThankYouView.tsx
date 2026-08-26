'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/Button'
import {
  browserSnapshotStorage,
  forgetCheckoutSnapshot,
  readCheckoutSnapshot,
  trackPurchase,
  type BarionCourseInput,
  type BarionSnapshotStorage,
} from '@/lib/analytics/barion-events'
import { captureAnalyticsEvent } from '@/lib/analytics/posthog'
import { checkoutHref } from '../../lib/courses'
import { ctaLabel } from '../../lib/cta-vocabulary'
import { pollOrderStatus, type PollResult } from '../../lib/order-status-poll'

/**
 * ThankYouView — a köszönőoldal kliens-oldali viselkedése.
 *
 * A rendelés-státuszt 2 mp-enként poll-ozza a GET /api/orders/[orderNumber]/status
 * végponton; a `paid` átmenet után siker-nézet, 2 perc után „feldolgozás
 * alatt" + e-mail-ígéret, `cancelled`/`payment_failed` esetén a
 * /sikertelen-nek megfelelő nézet.
 */
export interface ThankYouViewProps {
  orderNumber: string | null
}

/** A `purchase` esemény injektálható függőségei (teszthez). */
export interface BarionPurchaseDeps {
  storage: () => BarionSnapshotStorage | null
  read: (storage: BarionSnapshotStorage | null, orderNumber: string) => BarionCourseInput | null
  track: (
    course: BarionCourseInput,
    input: { orderNumber: string | null; succeeded: boolean },
  ) => boolean
  forget: (storage: BarionSnapshotStorage | null, orderNumber: string) => void
}

/**
 * A `step` hordozza a kimenetelt: sikeres fizetésnél a lezáró lépés,
 * SIKERTELENNÉL `-1`. Enélkül a Barion a meghiúsult fizetést is bevételnek
 * látná — ez a fajta hiba néma, ezért van rá külön őr-teszt.
 * A kosár-adat a pénztárban eltett PILLANATKÉPBŐL jön: a státusz-végpont csak
 * a státuszt és a termék-id-t adja vissza, a `purchase`-nek viszont kötelező a
 * `contents`, a `revenue` és a `currency`. Ha a pillanatkép hiányzik — más
 */
export function emitBarionPurchase(
  orderNumber: string,
  succeeded: boolean,
  deps: BarionPurchaseDeps = {
    storage: browserSnapshotStorage,
    read: readCheckoutSnapshot,
    track: trackPurchase,
    forget: forgetCheckoutSnapshot,
  },
): boolean {
  const storage = deps.storage()
  const course = deps.read(storage, orderNumber)
  if (course === null) {
    return false
  }
  const sent = deps.track(course, { orderNumber, succeeded })
  deps.forget(storage, orderNumber)
  return sent
}

/**
 * A MÉRT HIBA: az esemény korábban CSAK a rendelésszámot vitte. A PostHogban
 */
export function purchaseEventProperties(
  orderNumber: string,
  order: { value: number | null; currency: string | null },
): Record<string, unknown> {
  const properties: Record<string, unknown> = { orderNumber }
  // Hiányzó/érvénytelen összeg esetén a kulcs KIMARAD — a `value: null` a
  // riportban nullás bevételnek látszana, ami hamis állítás lenne.
  if (order.value !== null) {
    properties.value = order.value
  }
  if (order.currency !== null) {
    properties.currency = order.currency
  }
  return properties
}

/**
 * A `purchase_confirmed` CSAK akkor megy ki, ha a poll ténylegesen
 * visszaigazolta a `paid` státuszt.
 * Vendég-visszatérésnél a státusz-végpont 401-et ad (`unauthorized`):
 * nincs munkamenet, a kliens NEM tudja, paid-e a rendelés. Ugyanez
 * igaz a `not-found`, az `error` és a poll-időtúllépés (`timeout`)
 * ágára. Hamis paid-eseményt küldeni (a Barion-visszatérés puszta
 */
export function shouldEmitPurchaseConfirmed(
  result: PollResult | { kind: 'timeout' },
): boolean {
  return result.kind === 'status' && result.status === 'paid'
}

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 120000 // 2 perc

type ViewState =
  | { kind: 'polling'; attempts: number }
  | { kind: 'paid' }
  | { kind: 'timeout' }
  /** productId: az „Újrapróbálom" link célához (a státuszválasz hozza). */
  | { kind: 'failed'; status: string; productId: number | null }
  | { kind: 'unauthorized' }
  | { kind: 'not-found' }

/**
 * A Barion EGYETLEN visszatérési címet ismer: a hivatalos leírás szerint a
 * `RedirectUrl` az a cím, ahova a fizető „after the payment is completed OR
 * CANCELED" kerül. Vagyis ide fut be a sikeres, a megszakított ÉS az
 * elutasított fizetés is. A vendég-vásárlónak pedig nincs munkamenete, tehát
 * az állapot-lekérdezés neki mindig 401 — ezen az ágon a lap SOSEM tudja,
 * mi történt.
 */export function ThankYouUnauthorized({ orderNumber }: { orderNumber: string }) {
  return (
    <div className="kc-thankyou" role="status">
      <h1>Nem látjuk, mi történt a fizetéssel</h1>
      <p>
        Ehhez a rendeléshez be kell lépned, különben nem tudjuk megmutatni, sikerült-e a
        fizetés.
      </p>
      <p>
        <strong>Ha sikerült:</strong> a visszaigazolót e-mailben küldjük. Ha vendégként
        vásároltál, a levélben egy jelszó-beállító link is lesz, azzal nyílik meg a fiókod a
        kurzussal.
      </p>
      <p>
        <strong>Ha megszakítottad vagy elutasították:</strong> a fizetés nem történt meg, és
        nyugodtan újrapróbálhatod.
      </p>
      <p className="kc-thankyou__order">
        Rendelésszám: <strong>{orderNumber}</strong>
      </p>
      <div className="kc-thankyou__actions">
        <Button href={`/belepes?returnUrl=${encodeURIComponent('/fizetes/koszonom?order=' + orderNumber)}`}>
          Belépés
        </Button>
        <Button href="/kurzusok" variant="secondary">
          Vissza a kurzusokhoz
        </Button>
      </div>
    </div>
  )
}

export function ThankYouView({ orderNumber }: ThankYouViewProps) {
  const [state, setState] = useState<ViewState>({ kind: 'polling', attempts: 0 })

  useEffect(() => {
    // A hiányzó rendelésszám a PROPBÓL következik (szerver-oldalról érkezik,
    // tehát a szerver- és a kliens-render azonos): ezt a nézetet renderben
    // döntjük el, nem állapotba írjuk. Az effekt ilyenkor nem poll-oz.
    //
    // A BEJELENTKEZETTSÉGET viszont NEM propból tudjuk: ez az oldal mindig
    // kereszt-oldali navigációval nyílik (Barion-visszairányítás), ahol a
    // csrf-engedélylista miatt a szerver nem látja a süti-tokent. A poll
    // azonos eredetű `fetch`, az KÜLD `Origin`-t — a 401 → `unauthorized`
    // állapot dönti el, hogy tényleg nincs-e bejelentkezve. Részletes
    // indoklás: src/app/(frontend)/fizetes/koszonom/page.tsx fejléce.
    if (!orderNumber) {
      return
    }

    let cancelled = false
    let attempts = 0
    const startedAt = Date.now()

    // A Barion `purchase` a kimenetel ELDŐLTEKOR megy ki (a szerződést és az
    // indoklást a modul-szintű `emitBarionPurchase` fejkommentje írja le). Az
    // alias azért kell, mert a `tick` zárványában a `string | null` prop
    // szűkítése már nem él. Ugyanezt az aliast használja a PostHog
    // `purchase_confirmed` eseménye is — az is `string`-et vár.
    const pixelOrderNumber: string = orderNumber

    const tick = async (): Promise<void> => {
      if (cancelled) {
        return
      }
      attempts += 1
      const result = await pollOrderStatus(orderNumber)
      if (cancelled) {
        return
      }

      // A purchase_confirmed kapuja explicit: vendég 401 / 404 / timeout
      // SOHA nem paid-esemény. A UI `paid` ága ugyanerre a feltételre épül.
      if (shouldEmitPurchaseConfirmed(result) && result.kind === 'status') {
        setState({ kind: 'paid' })
        // PostHog funnel-záró esemény, a rendelés végösszegével (no-op
        // consent nélkül) — a tulajdonságokat lásd a purchaseEventProperties
        // fejlécében.
        captureAnalyticsEvent(
          'purchase_confirmed',
          purchaseEventProperties(pixelOrderNumber, result),
        )
        emitBarionPurchase(pixelOrderNumber, true)
        return
      }

      if (result.kind === 'status') {
        const status = result.status
        if (status === 'cancelled' || status === 'payment_failed') {
          setState({ kind: 'failed', status, productId: result.productId })
          emitBarionPurchase(pixelOrderNumber, false)
          return
        }
      } else if (result.kind === 'not-found') {
        setState({ kind: 'not-found' })
        return
      } else if (result.kind === 'unauthorized') {
        setState({ kind: 'unauthorized' })
        return
      }

      if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        setState({ kind: 'timeout' })
        return
      }
      setState({ kind: 'polling', attempts })
      window.setTimeout(tick, POLL_INTERVAL_MS)
    }

    void tick()
    return () => {
      cancelled = true
    }
  }, [orderNumber])

  // Propokból közvetlenül következő nézetek (állapot nélkül).
  if (!orderNumber) {
    return (
      <div className="kc-thankyou" role="status">
        <h1>Köszönjük!</h1>
        <p>Hiányzik a rendelésszám a hivatkozásból. A rendelésedet a Kurzusaim oldalon találod.</p>
        <Button href="/kurzusaim">{ctaLabel('my-courses-open')}</Button>
      </div>
    )
  }

  if (state.kind === 'paid') {
    return (
      <div aria-live="polite" className="kc-thankyou kc-thankyou--paid" role="status">
        <h1>Köszönjük a vásárlást!</h1>
        <p>
          A fizetésed sikeresen megérkezett. A kurzust a{' '}
          <Link href="/kurzusaim">Kurzusaim</Link> oldalon éred el.
        </p>
        <p className="kc-thankyou__order">
          Rendelésszám: <strong>{orderNumber}</strong>
        </p>
        {/* §3.2 #9: a köszönőoldal HÁROM ága ugyanazzal a szóval visz a saját
            kurzusokhoz. Korábban itt „Tovább a kurzusaimhoz" (M-7), a timeout
            ágon „Nézd meg a kurzusaimat", a hiba-ágakon pedig „Kurzusaim" állt
            — három felirat EGY cselekvésre, ugyanabban a komponensben
            (WCAG 2.2 · 3.2.4 sértés). */}
        <div className="kc-thankyou__actions">
          <Button href="/kurzusaim">{ctaLabel('my-courses-open')}</Button>
          <Button href="/" variant="secondary">Vissza a kezdőlapra</Button>
        </div>
      </div>
    )
  }

  if (state.kind === 'timeout') {
    return (
      <div aria-live="polite" className="kc-thankyou kc-thankyou--timeout" role="status">
        <h1>A fizetésed feldolgozása folyamatban</h1>
        <p>
          A bank még dolgozik a fizetésed jóváhagyásán. Ez általában néhány percet vesz igénybe —
          amint megérkezik a visszaigazolás, <strong>e-mailben értesítünk</strong>, és a kurzus
          megjelenik a Kurzusaim oldalon.
        </p>
        <p className="kc-thankyou__order">
          Rendelésszám: <strong>{orderNumber}</strong>
        </p>
        <div className="kc-thankyou__actions">
          <Button href="/kurzusaim">{ctaLabel('my-courses-open')}</Button>
          <Button href="/" variant="secondary">Vissza a kezdőlapra</Button>
        </div>
      </div>
    )
  }

  if (state.kind === 'failed') {
    // Az Újrapróbálom a TERMÉKRE mutat (a /penztar numerikus termék-id-t vár) —
    // korábban a rendelésszám került a termék-paraméterbe, ami a pénztár
    // „nincs kiválasztott termék" ágára vezetett (zsákutca). Ha a termék-id
    // nem feloldható, a kurzuslista a biztonságos cél.
    const retryHref =
      state.productId !== null ? checkoutHref(state.productId) : '/kurzusok'
    return (
      <div aria-live="assertive" className="kc-thankyou kc-thankyou--failed" role="alert">
        <h1>A fizetés nem sikerült</h1>
        <p>
          A fizetésedet a bank elutasította vagy megszakította. Semmi sem került levonásra —
          újrapróbálhatod bármikor.
        </p>
        <div className="kc-thankyou__actions">
          <Button href={retryHref}>{ctaLabel('retry')}</Button>
          <Button href="/kapcsolat" variant="secondary">{ctaLabel('contact-open')}</Button>
        </div>
      </div>
    )
  }

  // 401 — nincs (érvényes) munkamenet. Ez KÉT esetet fed le:
  //  - VENDÉG-VÁSÁRLÁS: a vevő bejelentkezés nélkül fizetett, a fiókja most
  //    készül. Neki nincs mit tennie, és belépni sem tud még — ezért a szöveg
  //    elsőként az e-mailre irányít (ott érkezik a jelszó-beállító link), a
  //    belépés csak másodlagos ajánlat;
  //  - lejárt munkamenet egy meglévő fióknál: neki a belépés a helyes út.
  // A korábbi, feltétel nélküli „jelentkezz be" a vendégnek zsákutca volt.
  if (state.kind === 'unauthorized') {
    return <ThankYouUnauthorized orderNumber={orderNumber} />
  }

  if (state.kind === 'not-found') {
    return (
      <div className="kc-thankyou" role="status">
        <h1>A rendelés nem található</h1>
        <p>
          A megadott rendelésszámmal ({orderNumber}) nem találunk rendelést a fiókodban. Ha a
          fizetésedet elindítottad, a banki visszaigazolás még úton lehet — nézz vissza pár perc
          múlva a Kurzusaim oldalra, vagy írj nekünk.
        </p>
        <div className="kc-thankyou__actions">
          <Button href="/kurzusaim">{ctaLabel('my-courses-open')}</Button>
          <Button href="/kapcsolat" variant="secondary">{ctaLabel('contact-open')}</Button>
        </div>
      </div>
    )
  }

  return (
    <div aria-live="polite" className="kc-thankyou kc-thankyou--polling" role="status">
      <h1>Köszönjük — feldolgozzuk a fizetésedet</h1>
      <p>
        A bank visszaigazolására várunk… Ez általában néhány másodperc. Ne zárd be az oldalt.
      </p>
      <p className="kc-thankyou__spinner" aria-hidden="true">⏳</p>
    </div>
  )
}
