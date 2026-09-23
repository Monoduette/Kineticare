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
import { courseHref } from '../../lib/course-url'
import { checkoutHref, myCoursePlayerHref } from '../../lib/courses'
import { ctaLabel } from '../../lib/cta-vocabulary'
import { pollOrderStatus, type PollResult } from '../../lib/order-status-poll'
import { forgotPasswordHref, signInHref } from '../../lib/return-url'

/**
 * ThankYouView — a köszönőoldal kliens-oldali viselkedése.
 *
 * A rendelés-státuszt 2 mp-enként poll-ozza a GET /api/orders/[orderNumber]/status
 * végponton; a `paid` átmenet után siker-nézet, 2 perc után „feldolgozás
 * alatt" + e-mail-ígéret, `cancelled`/`payment_failed` esetén a
 * /sikertelen-nek megfelelő nézet, `refunded` esetén a visszatérítés-nézet.
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
export function shouldEmitPurchaseConfirmed(result: PollResult | { kind: 'timeout' }): boolean {
  return result.kind === 'status' && result.status === 'paid'
}

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 120000 // 2 perc

type ViewState =
  | { kind: 'polling' }
  | { kind: 'paid'; productId: number | null }
  /** productId: a poll utolsó ismert tétele, ha a 2 perc alatt megjött. */
  | { kind: 'timeout'; productId: number | null }
  /** productId: az „Újrapróbálom" link célához (a státuszválasz hozza). */
  | { kind: 'failed'; status: string; productId: number | null }
  /** productId: a kurzusoldal linkjéhez (hozzáférés nem jött létre). */
  | { kind: 'refunded'; productId: number | null }
  | { kind: 'unauthorized' }
  | { kind: 'not-found' }
  | { kind: 'review' }

/**
 * A köszönőoldal következő lépése: ismert tételnél a lejátszó, egyébként a lista.
 * Ugyanaz a két gombosúly, ugyanaz a szótári felirat, mint a paid ágon.
 */
function thankYouCourseCta(productId: number | null): {
  href: string
  action: 'course-start' | 'my-courses-open'
} {
  if (productId !== null) {
    return { href: myCoursePlayerHref(productId), action: 'course-start' }
  }
  return { href: '/kurzusaim', action: 'my-courses-open' }
}

/**
 * A Barion EGYETLEN visszatérési címet ismer: a hivatalos leírás szerint a
 * `RedirectUrl` az a cím, ahova a fizető „after the payment is completed OR
 * CANCELED" kerül. Vagyis ide fut be a sikeres, a megszakított ÉS az
 * elutasított fizetés is. A vendég-vásárlónak pedig nincs munkamenete, tehát
 * az állapot-lekérdezés neki mindig 401 — ezen az ágon a lap SOSEM tudja,
 * mi történt.
 *
 * A szöveg e-mail-első: a vendégnek még nincs jelszava. A korábbi egyetlen
 * gomb a Belépés volt; az zsákutca, ha a levél (még) nincs meg, mert a
 * vendégfiók véletlen jelszóval születik, amit a vevő nem kap kézhez.
 * Az elsődleges gomb ezért a jelszó-beállító kérés (`password-reset-request`,
 * §3.2 #21): ugyanoda visz, mint a belépő oldal „Elfelejtetted a jelszavad?"
 * útja, a Kurzusaimra mint returnUrl-lel. A Belépés másodlagos (már van
 * jelszava). Egyik sem ide, a köszönőoldalra visz vissza.
 *
 * Forrás: NN/g, Error Message Guidelines (mondd meg, mi a következő lépés)
 * https://www.nngroup.com/articles/error-message-guidelines/ ;
 * GOV.UK, Start with the user need / don’t drop people off a journey
 * https://www.gov.uk/service-manual/design/user-centred-design ;
 * Baymard, post-purchase confirmation should lead to the purchased item
 * https://baymard.com/blog/order-confirmation-design ;
 * WCAG 2.2 · 3.3.1 Error Identification, 3.3.3 Error Suggestion, 3.2.4
 * Consistent Identification
 * https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html
 * https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html
 * https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html
 */
export function ThankYouUnauthorized({ orderNumber }: { orderNumber: string }) {
  return (
    <div className="kc-thankyou" role="status">
      <h1>A visszaigazolás e-mailben érkezik</h1>
      <p>
        A fizetésed állapotát itt most nem tudjuk megmutatni, mert nincs belépésed. Nézd meg a
        postaládád: ha a fizetés sikerült, oda megy a visszaigazoló. Vendégvásárlásnál a levélben
        jelszó-beállító link is lesz, azzal nyílik meg a fiókod a kurzussal.
      </p>
      <p>
        Ha a levél néhány perc múlva sem jön, kérj új jelszó-beállító linket ugyanazzal az
        e-mail-címmel, amellyel fizettél.
      </p>
      <p>
        Ha a fizetést megszakítottad vagy a bank elutasította, általában nem történik levonás; ha a
        bankod később mégis jóváhagyja, automatikusan érvényesítjük, és e-mailben visszaigazoljuk.
        Újra is próbálhatod: <Link href="/kurzusok">{ctaLabel('course-list-open')}</Link>.
      </p>
      <p className="kc-thankyou__order">
        Rendelésszám: <strong>{orderNumber}</strong>
      </p>
      <div className="kc-thankyou__actions">
        <Button href={forgotPasswordHref('/kurzusaim')}>
          {ctaLabel('password-reset-request')}
        </Button>
        <Button href={signInHref('/kurzusaim')} variant="secondary">
          {ctaLabel('sign-in')}
        </Button>
      </div>
    </div>
  )
}

/**
 * Sikeres, bejelentkezett vásárlás. Ha a státusz-poll ad termék-id-t (a
 * rendelés első tétele), a gomb a lejátszóra visz: a lista közbeiktatása
 * zsákutca volt. Ugyanaz a két gomb, ugyanazok az osztályok.
 *
 * Forrás: GOV.UK, Don’t drop people off a journey
 * https://www.gov.uk/service-manual/design/user-centred-design ;
 * Baymard, post-purchase confirmation should lead to the purchased item
 * https://baymard.com/blog/order-confirmation-design ;
 * WCAG 2.2 · 3.2.4 Consistent Identification
 * https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html
 */
export function ThankYouPaid({
  orderNumber,
  productId,
}: {
  orderNumber: string
  productId: number | null
}) {
  const next = thankYouCourseCta(productId)
  return (
    <div aria-live="polite" className="kc-thankyou kc-thankyou--paid" role="status">
      <h1>Köszönjük a vásárlást!</h1>
      <p>
        {next.action === 'course-start'
          ? 'A fizetésed sikeresen megérkezett. A kurzusod most megnyitható.'
          : 'A fizetésed sikeresen megérkezett. A kurzust a kurzusaid között éred el.'}
      </p>
      <p className="kc-thankyou__order">
        Rendelésszám: <strong>{orderNumber}</strong>
      </p>
      <div className="kc-thankyou__actions">
        <Button href={next.href}>{ctaLabel(next.action)}</Button>
        <Button href="/" variant="secondary">
          Vissza a kezdőlapra
        </Button>
      </div>
    </div>
  )
}

export function ThankYouReview({ orderNumber }: { orderNumber: string }) {
  return (
    <div aria-live="polite" className="kc-thankyou kc-thankyou--timeout" role="status">
      <h1>A fizetésed ellenőrzése szükséges</h1>
      <p>
        A fizetés eredményét még ellenőriznünk kell. Írj nekünk a rendelésszámoddal, és addig ne
        indíts új fizetést.
      </p>
      <p className="kc-thankyou__order">
        Rendelésszám: <strong>{orderNumber}</strong>
      </p>
      <div className="kc-thankyou__actions">
        <Button href="/kapcsolat">{ctaLabel('contact-open')}</Button>
      </div>
    </div>
  )
}

/**
 * A poll 2 perc után sem kapott paid/failed választ. Bejelentkezett vevő:
 * a státusz-válasz tétel-id-jét megőrizzük, hogy a gomb a lejátszóra vihessen,
 * ne a lista közbeiktatására. A hozzáférés még készülhet: a szöveg ezt
 * kimondja, a gomb ettől a kurzushoz visz.
 *
 * Forrás: NN/g, Error Message Guidelines (mondd meg a következő lépést)
 * https://www.nngroup.com/articles/error-message-guidelines/ ;
 * GOV.UK, Don’t drop people off a journey
 * https://www.gov.uk/service-manual/design/user-centred-design ;
 * Baymard, order confirmation should lead to the purchased item
 * https://baymard.com/blog/order-confirmation-design ;
 * WCAG 2.2 · 3.2.4 Consistent Identification
 * https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html
 */
export function ThankYouTimeout({
  orderNumber,
  productId,
}: {
  orderNumber: string
  productId: number | null
}) {
  const next = thankYouCourseCta(productId)
  return (
    <div aria-live="polite" className="kc-thankyou kc-thankyou--timeout" role="status">
      <h1>A fizetésed feldolgozása folyamatban</h1>
      <p>
        A bank még dolgozik a fizetésed jóváhagyásán. Ez általában néhány percet vesz igénybe. Amint
        megérkezik a visszaigazolás, <strong>e-mailben értesítünk</strong>.
        {next.action === 'course-start'
          ? ' A következő gombbal a kurzusodhoz lépsz: ha a hozzáférés még nem jelent meg, frissítsd az oldalt pár perc múlva.'
          : ' A kurzusod a kurzusaid között jelenik meg.'}
      </p>
      <p className="kc-thankyou__order">
        Rendelésszám: <strong>{orderNumber}</strong>
      </p>
      <div className="kc-thankyou__actions">
        <Button href={next.href}>{ctaLabel(next.action)}</Button>
        <Button href="/" variant="secondary">
          Vissza a kezdőlapra
        </Button>
      </div>
    </div>
  )
}

/**
 * Hiányzó rendelésszám a Barion-visszatérésben. Nincs tétel-id, a lista a
 * biztonságos cél. A gomb megmondja a következő lépést, a mondat nem küld
 * oldalnévre vadászni.
 *
 * Forrás: NN/g, Error Message Guidelines
 * https://www.nngroup.com/articles/error-message-guidelines/ ;
 * WCAG 2.2 · 3.3.3 Error Suggestion
 * https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html ;
 * WCAG 2.2 · 2.4.2 Page Titled (a H1 a lapcím állapotát ismétli, nem sikert állít)
 * https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html
 */
export function ThankYouMissingOrder() {
  return (
    <div className="kc-thankyou" role="status">
      <h1>A fizetésed állapota</h1>
      <p>Hiányzik a rendelésszám a hivatkozásból. A kurzusaidat a következő gombbal éred el.</p>
      <Button href="/kurzusaim">{ctaLabel('my-courses-open')}</Button>
    </div>
  )
}

/**
 * A státusz-végpont 404: a bejelentkezett fiókban nincs ilyen rendelés.
 *
 * Forrás: NN/g, Error Message Guidelines (mondd meg, mi a következő lépés)
 * https://www.nngroup.com/articles/error-message-guidelines/ ;
 * WCAG 2.2 · 3.3.3 Error Suggestion
 * https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html
 */
export function ThankYouNotFound({ orderNumber }: { orderNumber: string }) {
  return (
    <div className="kc-thankyou" role="status">
      <h1>A rendelés nem található</h1>
      <p>
        A megadott rendelésszámmal ({orderNumber}) nem találunk rendelést a fiókodban. Ha a
        fizetésedet elindítottad, a banki visszaigazolás még úton lehet. Nézz vissza pár perc múlva,
        vagy írj nekünk.
      </p>
      <div className="kc-thankyou__actions">
        <Button href="/kurzusaim">{ctaLabel('my-courses-open')}</Button>
        <Button href="/kapcsolat" variant="secondary">
          {ctaLabel('contact-open')}
        </Button>
      </div>
    </div>
  )
}

export function ThankYouFailed({ productId }: { productId: number | null }) {
  // Az Újrapróbálom a TERMÉKRE mutat (a /penztar numerikus termék-id-t vár) —
  // korábban a rendelésszám került a termék-paraméterbe, ami a pénztár
  // „nincs kiválasztott termék" ágára vezetett (zsákutca). Ha a termék-id
  // nem feloldható, a kurzuslista a biztonságos cél.
  const retryHref = productId !== null ? checkoutHref(productId) : '/kurzusok'
  return (
    <div aria-live="assertive" className="kc-thankyou kc-thankyou--failed" role="alert">
      <h1>A fizetés nem sikerült</h1>
      <p>
        A fizetésedet a bank elutasította vagy megszakította. Ilyenkor általában nem történik
        levonás. Ha a bankod később mégis jóváhagyja a fizetést, automatikusan érvényesítjük, és
        e-mailben visszaigazoljuk. Újra is próbálhatod a fizetést.
      </p>
      <div className="kc-thankyou__actions">
        <Button href={retryHref}>{ctaLabel('retry')}</Button>
        <Button href="/kapcsolat" variant="secondary">
          {ctaLabel('contact-open')}
        </Button>
      </div>
    </div>
  )
}

export function ThankYouRefunded({
  orderNumber,
  productId,
}: {
  orderNumber: string
  productId: number | null
}) {
  return (
    <div aria-live="polite" className="kc-thankyou" role="status">
      <h1>A fizetést visszatérítettük</h1>
      <p>
        A rendelést az ellenőrzés után nem zárhattuk le, ezért a teljes összeget automatikusan
        visszaküldtük a kártyádra. Hozzáférés nem jött létre. Ha kérdésed van, írj nekünk, vagy
        indítsd újra a vásárlást.
      </p>
      <p className="kc-thankyou__order">
        Rendelésszám: <strong>{orderNumber}</strong>
      </p>
      <div className="kc-thankyou__actions">
        {productId === null ? null : (
          <Button href={courseHref({ id: productId })}>{ctaLabel('course-sales-open')}</Button>
        )}
        <Button href="/kapcsolat" variant="secondary">
          {ctaLabel('contact-open')}
        </Button>
      </div>
    </div>
  )
}

export function ThankYouView({ orderNumber }: ThankYouViewProps) {
  const [state, setState] = useState<ViewState>({ kind: 'polling' })

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
    let lastProductId: number | null = null
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
      const result = await pollOrderStatus(orderNumber)
      if (cancelled) {
        return
      }

      // A purchase_confirmed kapuja explicit: vendég 401 / 404 / timeout
      // SOHA nem paid-esemény. A UI `paid` ága ugyanerre a feltételre épül.
      if (shouldEmitPurchaseConfirmed(result) && result.kind === 'status') {
        setState({ kind: 'paid', productId: result.productId })
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
        if (result.productId !== null) {
          lastProductId = result.productId
        }
        const status = result.status
        if (status === 'cancelled' || status === 'payment_failed') {
          setState({ kind: 'failed', status, productId: result.productId })
          emitBarionPurchase(pixelOrderNumber, false)
          return
        }
        if (status === 'refunded') {
          setState({ kind: 'refunded', productId: result.productId })
          emitBarionPurchase(pixelOrderNumber, false)
          return
        }
      } else if (result.kind === 'review') {
        setState({ kind: 'review' })
        return
      } else if (result.kind === 'not-found') {
        setState({ kind: 'not-found' })
        return
      } else if (result.kind === 'unauthorized') {
        setState({ kind: 'unauthorized' })
        return
      }

      if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        setState({ kind: 'timeout', productId: lastProductId })
        return
      }
      window.setTimeout(tick, POLL_INTERVAL_MS)
    }

    void tick()
    return () => {
      cancelled = true
    }
  }, [orderNumber])

  // Propokból közvetlenül következő nézetek (állapot nélkül).
  if (!orderNumber) {
    return <ThankYouMissingOrder />
  }

  if (state.kind === 'paid') {
    return <ThankYouPaid orderNumber={orderNumber} productId={state.productId} />
  }

  if (state.kind === 'timeout') {
    return <ThankYouTimeout orderNumber={orderNumber} productId={state.productId} />
  }

  if (state.kind === 'failed') {
    return <ThankYouFailed productId={state.productId} />
  }

  if (state.kind === 'refunded') {
    return <ThankYouRefunded orderNumber={orderNumber} productId={state.productId} />
  }
  if (state.kind === 'review') return <ThankYouReview orderNumber={orderNumber} />

  // 401 — nincs (érvényes) munkamenet. Ez KÉT esetet fed le:
  //  - VENDÉG-VÁSÁRLÁS: a vevő bejelentkezés nélkül fizetett, a fiókja a
  //    paid-átmenetkor készül. A szöveg elsőként az e-mailre irányít; ha a
  //    levél nem jön, a jelszó-beállító kérés a kiút (nem a Belépés: a
  //    vendégnek még nincs saját jelszava);
  //  - lejárt munkamenet egy meglévő fióknál: neki a Belépés a helyes út.
  if (state.kind === 'unauthorized') {
    return <ThankYouUnauthorized orderNumber={orderNumber} />
  }

  if (state.kind === 'not-found') {
    return <ThankYouNotFound orderNumber={orderNumber} />
  }

  return (
    <div aria-live="polite" className="kc-thankyou kc-thankyou--polling" role="status">
      <h1>Köszönjük, feldolgozzuk a fizetésedet</h1>
      <p>A bank visszaigazolására várunk… Ez általában néhány másodperc. Ne zárd be az oldalt.</p>
      <span aria-hidden="true" className="kc-thankyou__spinner" />
    </div>
  )
}
