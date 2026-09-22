'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'

import {
  browserSnapshotStorage,
  rememberCheckoutSnapshot,
  trackAddPaymentInfo,
  trackInitiateCheckout,
  trackInitiatePurchase,
  type BarionCourseInput,
  type BarionSnapshotStorage,
} from '@/lib/analytics/barion-events'
import {
  ANALYTICS_EVENTS,
  captureAnalyticsEvent,
  captureAnalyticsException,
} from '@/lib/analytics/posthog'
import { BarionFizetesJelzes } from '@/components/checkout/BarionFizetesJelzes'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { PriceTag } from '@/components/ui/PriceTag'
import type { BillingFieldName } from '../../lib/checkout/billing'
import type { GuestFieldName } from '../../lib/checkout/guest'
import { CTA_PROGRESS_LABELS, ctaLabel } from '../../lib/cta-vocabulary'
import { checkoutHref, myCoursePlayerHref } from '../../lib/courses'
import { signInHref } from '../../lib/return-url'
import {
  BILLING_INPUT_NAME,
  CHECKOUT_TERMS_HEADING,
  CHECKOUT_TERMS_HINT,
  CHECKOUT_TERMS_LABEL,
  GUEST_INPUT_NAME,
  TERMS_ASZF_PATH,
  TERMS_HINT_ID,
  TERMS_INPUT_ID,
  TERMS_NEW_TAB_HINT,
  TERMS_PRIVACY_PATH,
  WAIVER_LOSS_INPUT_ID,
  WAIVER_START_INPUT_ID,
  createCheckoutSubmitHandler,
  planCheckoutSubmission,
  CHECKOUT_ALREADY_PURCHASED_ERROR,
  CHECKOUT_ERROR_REGION_ID,
  CHECKOUT_GUEST_EXISTING_ACCOUNT,
  CHECKOUT_GUEST_FINISH_AFTER_LOGIN,
  CHECKOUT_PAID_UNDER_REVIEW,
  CHECKOUT_REFUNDED_PRIVILEGED,
  emptyGuestForm,
  prefillBillingForm,
  withBillingValue,
  withGuestValue,
  withoutBillingError,
  withoutGuestError,
  type BillingFieldErrors,
  type CheckoutSubmissionContext,
  type CheckoutSubmissionPlan,
  type GuestFieldErrors,
} from '../../lib/checkout/form-submission'
import {
  submitCheckout,
  type CheckoutProduct,
  type CheckoutSubmitInput,
  type CheckoutSubmitResult,
  type CheckoutUser,
} from '../../lib/checkout-submit'

/**
 * A beküldést gátló feltétel magyarázatának elem-azonosítója. A gomb
 * `aria-describedby`-ja erre mutat, amíg van akadály.
 */
export const CHECKOUT_BLOCK_HINT_ID = 'kc-checkout-block-hint'

/**
 * CheckoutForm — a /penztar űrlapja (a vásárlás befejezése).
 * 29. § (1) m) SZÓ SZERINTI szövegekkel, NEM előre kipipálva — mindkettő
 * A DÖNTÉSI MAG NEM ITT VAN: a beküldési törzs összeállítása, a validáció, az
 */
export interface CheckoutFormProps {
  product: CheckoutProduct
  /**
   * A bejelentkezett vásárló profilja — VENDÉG-vásárlásnál `null`. Ilyenkor az
   * űrlap az azonosító mezőkkel (e-mail + név) indul, és a szerver ezekből
   * hozza létre (vagy találja meg) a fiókot a fizetés után.
   */
  user: CheckoutUser | null
  alreadyPurchased: boolean
}

/**
 * Navigálás a fizetési átjáróra. MODUL-szinten van, nem a komponensben: a
 * `window.location` írása a render-scope-ból a React-fordító
 * immutability-szabályába ütközik (a beküldés-kezelőt a render állítja össze).
 */
const redirectToGateway = (gatewayUrl: string): void => {
  window.location.href = gatewayUrl
}

/**
 * A pénztár terméke → a Barion Pixel tétel-leírása.
 *
 * Az ár hiánya KÉT külön eset. Ingyenes kurzusnál a 0 a valós érték (a
 * `revenue: 0` legitim adat). Fizetős kurzusnál a hiányzó ár konfigurációs
 * hiba: ilyenkor `NaN` megy tovább, amit a `barion-events` érvénytelennek lát,
 * és az eseményt EL SEM KÜLDI. Kitalált (pl. 0 forintos) ár helyett a csend a
 * helyes válasz — az hamis bevételi adatot rögzítene.
 */
export function checkoutBarionCourse(product: CheckoutProduct): BarionCourseInput {
  return {
    id: product.id,
    name: product.sku,
    priceHuf: product.priceHuf ?? (product.isFree ? 0 : Number.NaN),
    quantity: 1,
  }
}

/**
 * MIÉRT KELL. A `checkout_started` → `purchase_confirmed` tölcsér csak azt
 * mutatja meg, HÁNYAN esnek ki — azt nem, hogy MIÉRT. A kiesés okai
 * gyökeresen különböző teendőt jelentenek: a hiányzó ÁSZF-pipa felület-hiba,
 * a mezőhiba szöveg- vagy validáció-hiba, a szerver-elutasítás pedig
 * üzemzavar. Ezek nélkül a pénztár néma: a szerveroldali napló CSAK azt látja,
 * ami odaért, a kliensoldali elakadás (pipa, mezőhiba, hálózat) ott nyomtalan.
 */

/** A pénztári hibák ZÁRT kategória-készlete — a riportok ezekre bontanak. */
export const CHECKOUT_FAILURE_REASONS = [
  /** A beküldés el sem indulhatott (már megvette / hiányzó nyilatkozat). */
  'blocked',
  /** A megadott adatok nem mentek át a kliensoldali validáción. */
  'invalid',
  /** A kérés kiment, a szerver (vagy a hálózat) elutasította. */
  'rejected',
  /** VALÓDI JS-kivétel a beküldés útján (a részletek a PostHog $exception-be). */
  'exception',
] as const

/** Egy pénztári hiba kategóriája. Szűk unió: szabad sztringet nem enged át. */
export type CheckoutFailureReason = (typeof CHECKOUT_FAILURE_REASONS)[number]

export interface CheckoutFailureInput {
  /** A kurzus adatbázis-azonosítója (szám — a rendszerünkön kívül semmit nem jelent). */
  productId: number
  reason: CheckoutFailureReason
  /**
   * A fókuszált elem azonosítója, ha van. ZÁRT készlet: a hibarégió, a két
   * nyilatkozat-négyzet, az ÁSZF-négyzet vagy egy mező input-azonosítója —
   * mind a kódban rögzített konstans, SOHA nem a felhasználó bevitele.
   */
  field?: string | null
  /** A valódi JS-kivétel, ha volt — a PostHog `$exception`-be megy. */
  error?: unknown
}

/**
 * A pénztári hiba rögzítése.
 *
 * TELJES `try/catch`: a mérés hibája NEM ronthatja el a pénztárat. Ha a
 * PostHog-kliens bármely okból dob (blokkoló kiegészítő, hibás konfiguráció),
 * a vásárló ebből semmit nem érzékelhet — ugyanaz az elv, amit a
 * `withLeadTracking` és a Barion-pixel burkolók követnek. Naplózni innen nem
 * tudunk: a `src/lib/logger.ts` a szerver stdoutjára ír.
 */
export function reportCheckoutFailure({
  error,
  field,
  productId,
  reason,
}: CheckoutFailureInput): void {
  try {
    captureAnalyticsEvent(ANALYTICS_EVENTS.checkoutFailed, {
      productId,
      reason,
      // A hiányzó fókuszcél ki sem kerül (nem null-ként).
      ...(typeof field === 'string' && field.length > 0 ? { field } : {}),
    })
    if (error !== undefined) {
      captureAnalyticsException(error, 'checkout-submit')
    }
  } catch {
    // A mérés hibája nem érheti el a vásárlót.
  }
}

/**
 * A beküldési TERVBŐL a hiba gépi kategóriája — tiszta függvény, ezért DOM
 * nélkül tesztelhető. `null`, ha a terv szerint a beküldés mehet.
 *
 * MIÉRT A TERVBŐL: a `createCheckoutSubmitHandler` láncába nyúlni kockázatos
 * lenne (a fizetési út látható viselkedése nem változhat), a
 * `planCheckoutSubmission` viszont TISZTA — ugyanazzal az állapottal
 * másodszor hívva ugyanazt adja, mellékhatás nélkül. A mérés így a beküldés
 * mellett fut, nem benne.
 */
export function checkoutFailureFromPlan(
  plan: CheckoutSubmissionPlan,
): { reason: CheckoutFailureReason; field: string | null } | null {
  if (plan.kind === 'blocked') {
    return { reason: 'blocked', field: plan.focusElementId }
  }
  if (plan.kind === 'invalid') {
    return { reason: 'invalid', field: plan.focusElementId }
  }
  return null
}

/** A követéssel BURKOLT beküldés injektálható függőségei (teszthez). */
export interface TrackedSubmitDeps {
  submit: (body: CheckoutSubmitInput) => Promise<CheckoutSubmitResult>
  storage: () => BarionSnapshotStorage | null
  addPaymentInfo: (course: BarionCourseInput) => boolean
  initiatePurchase: (course: BarionCourseInput, orderNumber: string | null) => boolean
  remember: (
    storage: BarionSnapshotStorage | null,
    orderNumber: string,
    course: BarionCourseInput,
  ) => boolean
  /**
   * A pénztári hiba rögzítése. OPCIONÁLIS: hiányában a valódi küldő fut
   * (`reportCheckoutFailure`), így a meglévő hívási helyek és tesztek
   * változtatás nélkül működnek tovább, a mérés viszont élesben végig megy.
   */
  failed?: (reason: CheckoutFailureReason, error?: unknown) => void
}

/**
 * A beküldés Barion-követéssel BURKOLT változata.
 */
export function trackedSubmitCheckout(
  product: CheckoutProduct,
  deps: TrackedSubmitDeps = {
    submit: submitCheckout,
    storage: browserSnapshotStorage,
    addPaymentInfo: trackAddPaymentInfo,
    initiatePurchase: trackInitiatePurchase,
    remember: rememberCheckoutSnapshot,
  },
): (body: CheckoutSubmitInput) => Promise<CheckoutSubmitResult> {
  const failed =
    deps.failed ??
    ((reason: CheckoutFailureReason, error?: unknown) =>
      reportCheckoutFailure({ productId: product.id, reason, error }))

  return async (body) => {
    const course = checkoutBarionCourse(product)
    deps.addPaymentInfo(course)
    let result: CheckoutSubmitResult
    try {
      result = await deps.submit(body)
    } catch (error) {
      // VALÓDI JS-kivétel a beküldés útján. A `submitCheckout` maga mindent
      // elnyel, tehát ide csak váratlan hiba juthat — épp ezért érdemes látni.
      // A hiba UTÁNA VÁLTOZATLANUL TOVÁBBMEGY: a látható viselkedés (a
      // beküldés-kezelő `finally` ága, a gomb állapota) nem változhat attól,
      // hogy mérünk.
      failed('exception', error)
      throw error
    }
    if (result.ok) {
      deps.remember(deps.storage(), result.orderNumber, course)
      deps.initiatePurchase(course, result.orderNumber)
    } else {
      // A szerver (vagy a hálózat) elutasította. A magyar üzenet SZÖVEGE
      // szándékosan nem megy ki — csak a gépi kategória.
      failed('rejected')
    }
    return result
  }
}

/**
 * A beküldési hiba élő régiója — az űrlap tetején.
 * MINDIG renderelődik (üresen is), nem csak hibakor: a dinamikusan BESZÚRT
 * aria-live régiót több képernyőolvasó megbízhatatlanul jelenti be, a már
 * meglévő régió tartalomváltozását viszont igen.
 * A `data-visible` ezért NEM a létezést kapcsolja, csak a MEGJELENÉST: üres
 * állapotban a checkout.css a `.kc-visually-hidden` technikájával tünteti el a
 */
export function CheckoutErrorRegion({ error }: { error: string | null }) {
  return (
    <div
      aria-live="assertive"
      className="kc-checkout-form__error"
      data-visible={error !== null ? 'true' : 'false'}
      id={CHECKOUT_ERROR_REGION_ID}
      role="alert"
      // A `-1` azért kell, hogy a beküldés-kezelő PROGRAMBÓL ide tudja vinni a
      // fókuszt (a Tab-sorrendbe így sem kerül be). Enélkül a `focus()` no-op.
      tabIndex={-1}
    >
      {error}
    </div>
  )
}

export function CheckoutForm({ product, user, alreadyPurchased }: CheckoutFormProps) {
  const [waiverStart, setWaiverStart] = useState(false)
  const [waiverLoss, setWaiverLoss] = useState(false)
  /**
   * ÁSZF-elfogadás. A kezdőérték KÖTELEZŐEN `false`: az előre bepipált
   * elfogadás jogilag érvénytelen és sötét minta (GOV.UK Design System,
   * Checkboxes: „Do not pre-select checkbox options…"; NN/g: a jogi
   * jelölőnégyzet alapból üres). A hivatkozásokat a
   * `form-submission.ts` CHECKOUT_TERMS_* konstansainak fejkommentje sorolja.
   */
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A profil mezői kizárólag ELŐKITÖLTÉSKÉNT szolgálnak: innentől a state az
  // igazság, és a beküldött (esetleg felülírt) érték kerül a rendelésre.
  const [billing, setBilling] = useState(() => prefillBillingForm(user ?? {}))
  const [billingErrors, setBillingErrors] = useState<BillingFieldErrors>({})
  // Vendég-vásárlás: az azonosító mezők. Bejelentkezve nincs ilyen állapot —
  // a törzsbe sem kerül `guest` blokk (a szerver a munkamenetből dolgozik).
  const isGuest = user === null
  const [guest, setGuest] = useState(emptyGuestForm)
  const [guestErrors, setGuestErrors] = useState<GuestFieldErrors>({})

  /**
   * A pénztár MEGNYITÁSA az `initiateCheckout` (1. lépés). A `contentView` a
   * kurzusoldalon, a `purchase` a köszönőoldalon megy ki; a köztes két lépés
   * (`addPaymentInfo`, `initiatePurchase`) itt, a beküldési láncba fűzve — a
   * `createCheckoutSubmitHandler` viselkedésének módosítása NÉLKÜL: a követés
   * a `submit` függvényt BURKOLJA, nem írja át, és az átirányítás útvonala
   * (`redirect`) érintetlen marad.
   */
  useEffect(() => {
    trackInitiateCheckout(
      checkoutBarionCourse({
        id: product.id,
        sku: product.sku,
        priceHuf: product.priceHuf,
        isFree: product.isFree,
      }),
    )
  }, [product.id, product.sku, product.priceHuf, product.isFree])

  const requiresWaiver = !product.isFree
  const waiverComplete = !requiresWaiver || (waiverStart && waiverLoss)
  /**
   * MI HIÁNYZIK MÉG a beküldéshez — a gomb MELLETT kiírva, magyarul. A gomb
   * nem tiltódik le tőle (lásd a beküldő-gomb melletti kommentet): ez az
   * `aria-describedby` célja, hogy a billentyűzetes és a képernyőolvasós
   * látogató a gombra érve azonnal megtudja, mi az akadály.
   */
  const blockReason: string | null = alreadyPurchased
    ? 'Ezt a kurzust már megvetted, ezért új rendelés nem indítható. A lejátszóban éred el.'
    : !waiverComplete
      ? 'A fizetéshez pipáld ki mindkét nyilatkozatot az „Elállási jog” résznél.'
      : // Az akadályok sorrendje az ŰRLAP sorrendjét követi (waiver, majd
        // ÁSZF), hogy a magyarázat mindig a legelső hiányra mutasson — ez
        // ugyanaz a sorrend, amit a `planCheckoutSubmission` fókuszcélja visz.
        !termsAccepted
        ? `A vásárláshoz pipáld ki a nyilatkozatot a „${CHECKOUT_TERMS_HEADING}” résznél.`
        : null

  const updateBilling = (field: BillingFieldName, value: string): void => {
    setBilling((previous) => withBillingValue(previous, field, value))
    // A mező hibája gépeléskor eltűnik (az aria-invalid is), különben a
    // képernyőolvasó a már javított mezőt is végig érvénytelennek mondaná.
    setBillingErrors((previous) => withoutBillingError(previous, field))
  }

  const updateGuest = (field: GuestFieldName, value: string): void => {
    setGuest((previous) => withGuestValue(previous, field, value))
    setGuestErrors((previous) => withoutGuestError(previous, field))
  }

  /** A hibás mezőre visszük a fókuszt — a görgetést a böngésző intézi. */
  const focusElement = (elementId: string | null): void => {
    if (elementId === null || typeof document === 'undefined') {
      return
    }
    document.getElementById(elementId)?.focus()
  }

  /**
   * A beküldés MELLÉKHATÁS-lánca a `form-submission.ts` gyárában él, hogy a
   * mag és a komponens KÖZTI huzalozás is tesztelhető legyen — a review
   * mutációval megmutatta, hogy korábban ezt a pontot át lehetett írni úgy,
   * hogy az eredeti hiba visszatérjen, miközben a teljes suite zöld marad.
   * Itt már csak az aktuális állapot olvasása és a React-hookok bekötése van.
   */
  /**
   * A beküldés pillanatában érvényes űrlapállapot — EGYETLEN forrásból. A
   * beküldés és a hiba-MÉRÉS ugyanabból dolgozik, tehát a kettő nem tud
   * eltérő állapotról dönteni.
   */
  const readCheckoutContext = (): CheckoutSubmissionContext => ({
    productId: product.id,
    displayedPriceHuf: product.isFree ? null : product.priceHuf,
    alreadyPurchased,
    waiverRequired: requiresWaiver,
    waiverStartAccepted: waiverStart,
    waiverLossAccepted: waiverLoss,
    termsAccepted,
    billing,
    ...(isGuest ? { guest } : {}),
  })

  const runSubmit = createCheckoutSubmitHandler({
    readContext: readCheckoutContext,
    setError,
    setBillingErrors,
    setGuestErrors,
    setSubmitting,
    focusElement,
    submit: trackedSubmitCheckout(product),
    redirect: redirectToGateway,
  })

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    /**
     * MÉRÉS a beküldés MELLETT, nem BENNE: a `planCheckoutSubmission` tiszta
     * függvény, ugyanazzal az állapottal másodszor hívva ugyanazt adja,
     * mellékhatás nélkül. Így a fizetési út látható viselkedése (hibaüzenetek,
     * fókusz, gombállapot) érintetlen marad — a mérés nem nyúl a láncba.
     * A SZERVER által elutasított beküldés a `trackedSubmitCheckout`-ban megy
     * ki, tehát itt nem duplázódik: ez az ág csak a KLIENSOLDALI elakadást méri.
     */
    try {
      const hiba = checkoutFailureFromPlan(planCheckoutSubmission(readCheckoutContext()))
      if (hiba !== null) {
        reportCheckoutFailure({ productId: product.id, ...hiba })
      }
    } catch {
      // A mérés hibája nem érheti el a vásárlót.
    }
    await runSubmit()
  }

  return (
    <form className="kc-checkout-form" noValidate onSubmit={handleSubmit}>
      {/*
        A hibadoboz az űrlap TETEJÉN van: korábban a hosszú elállási kártya
        UTÁN, a lap alján jelent meg, tehát mobilon a beküldés után a
        felhasználó semmit nem látott. A fókusz emellett az első hibás mezőre
        ugrik, így a hiba akkor is előkerül, ha a doboz a képernyőn kívül esne.
        Az élő régió szerződését (mindig a DOM-ban, üresen vizuálisan nyomtalan)
        a CheckoutErrorRegion fejkommentje írja le.
      */}
      <CheckoutErrorRegion error={error} />
      {error === CHECKOUT_GUEST_EXISTING_ACCOUNT ||
      error === CHECKOUT_REFUNDED_PRIVILEGED ? (
        <p className="kc-checkout-form__block-hint">
          <Button href={signInHref(checkoutHref(product.id))} size="sm" variant="secondary">
            {ctaLabel('sign-in')}
          </Button>
        </p>
      ) : error === CHECKOUT_PAID_UNDER_REVIEW ? (
        <p className="kc-checkout-form__block-hint">
          <Button href="/kapcsolat" size="sm" variant="secondary">
            {ctaLabel('contact-open')}
          </Button>
        </p>
      ) : error === CHECKOUT_GUEST_FINISH_AFTER_LOGIN ? (
        <p className="kc-checkout-form__block-hint">
          {/*
            Paid rendelés van az e-mailre, aktivált fiók nincs (W4: ne mondjuk,
            hogy megvette). A pénztár újra 409 lenne; a lejátszó a következő
            lépés. WCAG 2.2 · 3.3.1: a hiba mellé jár a következő cselekvés.
            GOV.UK Error message: tell users what happened and how to fix it
            (https://design-system.service.gov.uk/components/error-message/).
          */}
          <Button href={signInHref(myCoursePlayerHref(product.id))} size="sm" variant="secondary">
            {ctaLabel('sign-in')}
          </Button>
        </p>
      ) : error === CHECKOUT_ALREADY_PURCHASED_ERROR && !alreadyPurchased ? (
        <p className="kc-checkout-form__block-hint">
          <Button href={myCoursePlayerHref(product.id)} size="sm" variant="secondary">
            {ctaLabel('course-start')}
          </Button>
        </p>
      ) : null}

      <Card className="kc-checkout-summary">
        <div className="kc-checkout-summary__row">
          <span>{product.sku}</span>
          {product.isFree ? (
            <span className="kc-checkout-summary__free">Ingyenes</span>
          ) : product.priceHuf !== null ? (
            <PriceTag priceHuf={product.priceHuf} />
          ) : null}
        </div>
      </Card>

      {isGuest ? (
        <Card className="kc-checkout-guest">
          <h2>Elérhetőséged</h2>
          {/*
            A szerver aktivált fiókra 409-et ad (`CHECKOUT_GUEST_EXISTING_ACCOUNT`),
            a kurzus NEM kerül csendben a meglévő fiókba. Baymard: a vendég-pénztár
            mondja el a visszatérő vevőnek, hogy lépjen be
            (https://baymard.com/blog/guest-and-account-checkout);
            WCAG 2.2 · 3.3.1: a következő lépés legyen igaz.
          */}
          <p className="kc-field__hint">
            A vásárláshoz nem kell regisztrálni. A fizetés után erre a címre küldjük a hozzáférést
            és egy linket, amivel jelszót állítasz be a fiókodhoz. Ha ezzel a címmel már van belépős
            fiókod, előbb{' '}
            <Link href={signInHref(checkoutHref(product.id))}>be is jelentkezhetsz</Link>:
            vendégként a vásárlás nem kerül abba a fiókba.
          </p>
          <Field
            autoComplete="email"
            error={guestErrors.email}
            inputMode="email"
            label="E-mail-cím"
            name={GUEST_INPUT_NAME.email}
            onChange={(event) => updateGuest('email', event.target.value)}
            required
            type="email"
            value={guest.email}
          />
          <Field
            autoComplete="name"
            error={guestErrors.name}
            hint="Ez a fiókod neve, a számlázási név ettől eltérhet (pl. cégnév)."
            label="Neved"
            name={GUEST_INPUT_NAME.name}
            onChange={(event) => updateGuest('name', event.target.value)}
            required
            value={guest.name}
          />
        </Card>
      ) : null}

      <Card className="kc-checkout-billing">
        <h2>Számlázási adatok</h2>
        <p className="kc-field__hint">
          {isGuest
            ? 'A számla ezekkel az adatokkal készül, a rendelésre az itt megadott adat kerül.'
            : 'A számla ezekkel az adatokkal készül. Ha a profilodban máshogy szerepelnek, itt felülírhatod őket. A rendelésre az itt megadott adat kerül.'}
        </p>
        <Field
          autoComplete="billing name"
          error={billingErrors.name}
          label="Név"
          name={BILLING_INPUT_NAME.name}
          onChange={(event) => updateBilling('name', event.target.value)}
          required
          value={billing.name}
        />
        <div className="kc-checkout-billing__grid">
          {/*
            `inputMode="numeric"` szándékosan NINCS: a mező külföldi
            irányítószámot is elfogad (pl. `SW1A 1AA`), a szám-billentyűzet
            pedig mobilon el sem érhetővé tenné a betűket.
          */}
          <Field
            autoComplete="billing postal-code"
            error={billingErrors.zip}
            label="Irányítószám"
            name={BILLING_INPUT_NAME.zip}
            onChange={(event) => updateBilling('zip', event.target.value)}
            required
            value={billing.zip}
          />
          <Field
            autoComplete="billing address-level2"
            error={billingErrors.city}
            label="Település"
            name={BILLING_INPUT_NAME.city}
            onChange={(event) => updateBilling('city', event.target.value)}
            required
            value={billing.city}
          />
        </div>
        <Field
          autoComplete="billing address-line1"
          error={billingErrors.street}
          label="Cím"
          name={BILLING_INPUT_NAME.street}
          onChange={(event) => updateBilling('street', event.target.value)}
          required
          value={billing.street}
        />
        {/*
          Az adószámra nincs szabványos autofill-token, és a böngésző
          amúgy is rossz mezőt (telefonszám, kártyaszám) kínálna fel.
        */}
        <Field
          autoComplete="off"
          error={billingErrors.taxNumber}
          hint="Csak céges vásárlás esetén."
          label="Adószám (céges vásárlásnál)"
          name={BILLING_INPUT_NAME.taxNumber}
          onChange={(event) => updateBilling('taxNumber', event.target.value)}
          value={billing.taxNumber}
        />
      </Card>

      {requiresWaiver ? (
        <Card className="kc-checkout-waiver">
          <h2>Elállási jog</h2>
          <p className="kc-checkout-waiver__lead">
            A digitális tartalom (a kurzusvideók) azonnali hozzáféréséről az alábbiakban
            nyilatkoznod kell. A 14 napos elállási jog szabályairól az{' '}
            <a href="/aszf" target="_blank" rel="noopener noreferrer">
              Általános szerződési feltételek
            </a>{' '}
            tájékoztat.
          </p>

          <div className="kc-checkout-waiver__item">
            <input
              aria-describedby="waiver-start-hint"
              checked={waiverStart}
              id={WAIVER_START_INPUT_ID}
              name="waiverStart"
              onChange={(event) => setWaiverStart(event.target.checked)}
              required
              type="checkbox"
            />
            <label htmlFor={WAIVER_START_INPUT_ID}>
              Kifejezetten kérem, hogy a digitális tartalomhoz a hozzáférés azonnal megkezdődjön.
            </label>
          </div>
          <p className="kc-field__hint" id="waiver-start-hint">
            Ha nem járulsz hozzá az azonnali hozzáféréshez, a kurzust 14 nap elteltével éred el.
          </p>

          <div className="kc-checkout-waiver__item">
            <input
              aria-describedby="waiver-loss-hint"
              checked={waiverLoss}
              id={WAIVER_LOSS_INPUT_ID}
              name="waiverLoss"
              onChange={(event) => setWaiverLoss(event.target.checked)}
              required
              type="checkbox"
            />
            <label htmlFor={WAIVER_LOSS_INPUT_ID}>
              Tudomásul veszem, hogy a teljesítés megkezdésével elveszítem a 14 napos elállási
              jogomat.
            </label>
          </div>
          <p className="kc-field__hint" id="waiver-loss-hint">
            A hozzájárulásodat a rendszer a rendelésen időbélyeggel rögzíti.
          </p>
        </Card>
      ) : (
        /*
          ═══ VÉDEKEZŐ ÁG, NEM MŰKÖDŐ FUNKCIÓ (2026-08-17) ═══
          Ez az ág ma ELÉRHETETLEN: a `/penztar` LAP-SZINTŰ kapuja ingyenes
          terméknél (`isFreeCourse`) az űrlap helyett tájékoztató állapotot
          rendel, tehát `CheckoutForm` `isFree: true` proppal élesben nem
          renderelődik. Őre: `src/__tests__/penztar-ingyenes-kapu.test.tsx`.

          MIÉRT MARAD BENNE MÉGIS: a `product.isFree` prop, a
          `priceHuf: number | null` típus és a rá épülő tesztek kivezetése külön,
          nagyobb refaktor. Amíg az le nem fut, ez az ág VÉDEKEZÉS (ha valaki a
          kaput megkerülve rendereli a komponenst, ne fizetős felületet lásson),
          nem pedig egy támogatott út: az ingyenes kurzus valódi igénylése a
          kurzusoldal `FreeCourseRequestForm`-ján keresztül történik.
          A beküldése ezért sem működne: a `POST /api/checkout/start` ár-kapuja
          az ingyenes terméket garantáltan elutasítja.
        */
        <Card className="kc-checkout-waiver kc-checkout-waiver--free">
          <p>
            Ez a kurzus ingyenes. A hozzáférés a regisztrációd után azonnal megnyílik, fizetés és
            elállási nyilatkozat nélkül.
          </p>
        </Card>
      )}

      {/* ÁSZF+adatvédelem: egy jelölőnégyzet, két link; adatmezők után, gomb előtt. */}
      <Card className="kc-checkout-terms">
        <h2>{CHECKOUT_TERMS_HEADING}</h2>
        <div className="kc-checkout-terms__row">
          <input
            aria-describedby={TERMS_HINT_ID}
            checked={termsAccepted}
            className="kc-checkout-terms__checkbox"
            id={TERMS_INPUT_ID}
            name="consentTerms"
            onChange={(event) => setTermsAccepted(event.target.checked)}
            required
            type="checkbox"
          />
          <label className="kc-checkout-terms__label" htmlFor={TERMS_INPUT_ID}>
            {CHECKOUT_TERMS_LABEL.before}
            <a href={TERMS_ASZF_PATH} rel="noopener noreferrer" target="_blank">
              {CHECKOUT_TERMS_LABEL.aszfLabel}
              <span className="kc-visually-hidden">{TERMS_NEW_TAB_HINT}</span>
            </a>
            {CHECKOUT_TERMS_LABEL.between}
            <a href={TERMS_PRIVACY_PATH} rel="noopener noreferrer" target="_blank">
              {CHECKOUT_TERMS_LABEL.privacyLabel}
              <span className="kc-visually-hidden">{TERMS_NEW_TAB_HINT}</span>
            </a>
            {CHECKOUT_TERMS_LABEL.after}
          </label>
        </div>
        <p className="kc-field__hint" id={TERMS_HINT_ID}>
          {CHECKOUT_TERMS_HINT}
        </p>
      </Card>

      {/* Barion jelzés a fizetőgomb fölött; ingyenes ágon kimarad. */}
      {product.isFree ? null : <BarionFizetesJelzes hely="penztar" />}

      {/*
        Fizetőgomb csak beküldés közben disabled (dupla küldés ellen).
        Hiányzó nyilatkozat/már megvett: validáció + aria-describedby, nem disabled.
      */}
      <div className="kc-checkout-form__actions">
        {alreadyPurchased ? (
          <Button href={myCoursePlayerHref(product.id)}>{ctaLabel('course-start')}</Button>
        ) : (
          <Button
            describedBy={blockReason === null ? undefined : CHECKOUT_BLOCK_HINT_ID}
            disabled={submitting}
            type="submit"
          >
            {/* A FELIRATOK A SZÓTÁRBÓL (2026-08-18). A fizetős ág a §3.2 #2
              („Megrendelem és fizetek") — a korábbi „Megrendelés és fizetés"
              deverbális főnévi alak volt (M-1), pedig ez a visszavonhatatlan
              lépés (P-1a → E/1).

              Az INGYENES ág a §3.2 #26 („Kérem a kurzust") sorát kapja, NEM
              külön szótári sort: a látogató szemszögéből ugyanaz a cselekvés,
              mint a kurzusoldal igénylő űrlapjának beküldése — űrlapot küld be,
              és hozzáférést kap. Külön felirat („Hozzáférés megnyitása") ugyanarra
              a funkcióra a WCAG 2.2 · 3.2.4-et sértené, ráadásul deverbális
              főnévi alak volt. (Ez az ág egyébként VÉDEKEZŐ: a lap-szintű kapu
              ingyenes terméken az űrlap helyett tájékoztató állapotot rendel.) */}
            {submitting
              ? CTA_PROGRESS_LABELS.processing
              : product.isFree
                ? ctaLabel('free-course-request')
                : ctaLabel('checkout-submit')}
          </Button>
        )}
        {alreadyPurchased || blockReason === null ? null : (
          <p className="kc-checkout-form__block-hint" id={CHECKOUT_BLOCK_HINT_ID}>
            {blockReason}
          </p>
        )}
      </div>
    </form>
  )
}
