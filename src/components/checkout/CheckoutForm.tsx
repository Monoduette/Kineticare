'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent, type MouseEvent } from 'react'

import {
  browserSnapshotStorage,
  rememberCheckoutSnapshot,
  trackAddPaymentInfo,
  trackInitiateCheckout,
  trackInitiatePurchase,
  type BarionCourseInput,
  type BarionSnapshotStorage,
} from '@/lib/analytics/barion-events'
import { trackMetaInitiateCheckout } from '@/lib/analytics/meta-events'
import {
  ANALYTICS_EVENTS,
  captureAnalyticsEvent,
  captureAnalyticsException,
} from '@/lib/analytics/posthog'
import { BarionFizetesJelzes } from '@/components/checkout/BarionFizetesJelzes'
import { CheckoutTurnstile } from '@/components/checkout/CheckoutTurnstile'
import { readCheckoutTurnstileSiteKey } from '@/components/checkout/checkout-turnstile-key'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { PriceTag } from '@/components/ui/PriceTag'
import type { BillingFieldName } from '../../lib/checkout/billing'
import type { GuestFieldName } from '../../lib/checkout/guest'
import { KAPCSOLATI_EMAIL_TARTALEK } from '../../lib/contact-email'
import { CTA_PROGRESS_LABELS, ctaLabel } from '../../lib/cta-vocabulary'
import { checkoutHref, myCoursePlayerHref } from '../../lib/courses'
import { formatPriceHuf } from '../../lib/format-price'
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
  checkboxErrorId,
  createCheckoutSubmitHandler,
  planCheckoutSubmission,
  CHECKOUT_ALREADY_PURCHASED_ERROR,
  CHECKOUT_ERROR_REGION_ID,
  CHECKOUT_GUEST_EXISTING_ACCOUNT,
  CHECKOUT_GUEST_FINISH_AFTER_LOGIN,
  CHECKOUT_PAID_UNDER_REVIEW,
  CHECKOUT_REFUNDED_PRIVILEGED,
  CHECKOUT_TURNSTILE_INTERACTIVE_HINT,
  emptyGuestForm,
  prefillBillingForm,
  withBillingValue,
  withGuestValue,
  withoutBillingError,
  withoutGuestError,
  type BillingFieldErrors,
  type CheckoutCheckboxErrors,
  type CheckoutCheckboxName,
  type CheckoutErrorItem,
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
  /**
   * A Turnstile site key, ha a szerver-oldali szülő átadja (`null` = nincs
   * ellenőrzés). Hiányában (`undefined`) a komponens a
   * `readCheckoutTurnstileSiteKey` szerver-akcióval kéri el.
   */
  turnstileSiteKey?: string | null
}

/**
 * A fizetőgomb fölötti összegzés szövegei (a-ux-6, 45/2014. 15. § (1)): a
 * lényeges feltételek „közvetlenül a fogyasztó szerződési nyilatkozatának
 * megtétele előtt". Az áfa-mondat a tulajdonos K1-es döntését követi (alanyi
 * adómentes, AAM; ugyanígy fogalmaz az ÁSZF jóváhagyott mondata is), a
 * hozzáférés a K13-as döntést (nem jár le; a kurzusoldal
 * „A hozzáférésed nem jár le" mondatával egyező tartalommal).
 */
export const CHECKOUT_FINAL_SUMMARY_HEADING = 'A rendelésed'
export const CHECKOUT_FINAL_FEE_TEXT = 'egyszeri díj, nem előfizetés'
export const CHECKOUT_FINAL_ACCESS_TEXT = 'nem jár le'
export const CHECKOUT_FINAL_TAX_TEXT =
  'A feltüntetett ár a fizetendő végösszeg. A KINETICARE Kft. alanyi adómentes, ezért a számla áfát nem tartalmaz.'

/** A beírt e-mail-cím visszaírása a gomb fölött (a-checkout-14, a-ux-4). */
export function checkoutEmailEcho(isGuest: boolean, email: string): string | null {
  const trimmed = email.trim()
  if (trimmed === '') {
    return null
  }
  return isGuest
    ? `Erre a címre küldjük a hozzáférést: ${trimmed}`
    : `A visszaigazolást erre a címre küldjük: ${trimmed}`
}

/**
 * Az elállási blokk szövegei (a-ux-7, r-legal-7). A korábbi súgó („Ha nem
 * járulsz hozzá az azonnali hozzáféréshez, a kurzust 14 nap elteltével éred
 * el.") olyan lehetőséget ígért, amit a rendszer nem ad: a két nyilatkozat
 * nélkül a vásárlás nem indul el. A tulajdonos és a jogász által választott
 * alapértelmezett, igaz szöveg: online a kurzus csak azonnali hozzáféréssel
 * vehető meg, más kérés a kapcsolati címen (K14). A bevezető mondat az ÁSZF
 * létező pontjára mutat („Elállási jog kizárása"), nem a 14 napos elállás
 * nem létező „szabályaira".
 */
export const CHECKOUT_WAIVER_START_HINT =
  'Online vásárlásnál a kurzus csak azonnali hozzáféréssel vehető meg. ' +
  `Ha ezt nem szeretnéd, írj nekünk az ${KAPCSOLATI_EMAIL_TARTALEK} címre.`

/** K11: számlát egyelőre csak magyarországi címre állítunk ki. */
export const CHECKOUT_BILLING_HU_ONLY_TEXT =
  'Számlát jelenleg csak magyarországi címre állítunk ki.'

/** K11: a céges vásárlás jelölése (a mező neve a szerveren `billing.companyPurchase`). */
export const CHECKOUT_COMPANY_PURCHASE_LABEL = 'Cégként vásárolok'
export const CHECKOUT_COMPANY_PURCHASE_HINT =
  'Egyéni vállalkozóként is ezt válaszd. A számla a megadott adószámmal készül.'

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
export function CheckoutErrorRegion({
  error,
  items = [],
  onItemClick,
}: {
  error: string | null
  /**
   * Az összefoglaló linkes sorai (a-ux-10). Minden hiba egy sor, a link a
   * hibás mezőre (jelölőnégyzetnél a négyzetre) mutat — GOV.UK Error summary.
   */
  items?: readonly CheckoutErrorItem[]
  /** A link kattintása: a fókuszt a célmezőre viszi (a puszta horgony nem fókuszál). */
  onItemClick?: (targetId: string, event: MouseEvent<HTMLAnchorElement>) => void
}) {
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
      {error !== null && items.length > 0 ? (
        <>
          <p className="kc-checkout-form__error-title">{error}</p>
          <ul className="kc-checkout-form__error-list">
            {items.map((item) => (
              <li key={item.targetId}>
                <a
                  href={`#${item.targetId}`}
                  onClick={(event) => onItemClick?.(item.targetId, event)}
                >
                  {item.message}
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : (
        error
      )}
    </div>
  )
}

/**
 * A kipipálatlan kötelező jelölőnégyzet SAJÁT hibaüzenete, közvetlenül a
 * négyzet alatt (a-ux-10; WCAG 2.2 SC 3.3.1). Ugyanaz az osztály, mint a
 * `Field` mezőhibájáé, hogy a két hibafajta egyformán nézzen ki.
 */
function CheckboxError({
  name,
  errors,
}: {
  name: CheckoutCheckboxName
  errors: CheckoutCheckboxErrors
}) {
  const message = errors[name]
  if (message === undefined) {
    return null
  }
  return (
    <p className="kc-field__error" id={checkboxErrorId(name)}>
      {message}
    </p>
  )
}

/** A jelölőnégyzet `aria-describedby` értéke: a hibaüzenet (ha van) és a súgó. */
function checkboxDescribedBy(
  name: CheckoutCheckboxName,
  errors: CheckoutCheckboxErrors,
  hintId: string,
): string {
  return errors[name] === undefined ? hintId : `${checkboxErrorId(name)} ${hintId}`
}

export function CheckoutForm({
  product,
  user,
  alreadyPurchased,
  turnstileSiteKey,
}: CheckoutFormProps) {
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
  const [errorItems, setErrorItems] = useState<readonly CheckoutErrorItem[]>([])
  const [checkboxErrors, setCheckboxErrors] = useState<CheckoutCheckboxErrors>({})
  // A profil mezői kizárólag ELŐKITÖLTÉSKÉNT szolgálnak: innentől a state az
  // igazság, és a beküldött (esetleg felülírt) érték kerül a rendelésre.
  const [billing, setBilling] = useState(() => prefillBillingForm(user ?? {}))
  const [billingErrors, setBillingErrors] = useState<BillingFieldErrors>({})
  // K11: „Cégként vásárolok". Alapból üres (előre bejelölt négyzet nincs a
  // pénztárban); a jelölés az adószámot kötelezővé teszi.
  const [companyPurchase, setCompanyPurchase] = useState(false)

  /**
   * LÁTHATATLAN TURNSTILE (a-checkout-9). A site key vagy propból jön, vagy a
   * szerver-akcióból (`undefined` = még töltődik). Ha az akció maga hibázik,
   * NEM blokkolunk: token nélkül küldünk, és a szerver dönt (ha ott be van
   * kapcsolva az ellenőrzés, érthető 400-at ad; ha nincs, a vásárlás megy).
   */
  const [resolvedSiteKey, setResolvedSiteKey] = useState<string | null | undefined>(
    turnstileSiteKey,
  )
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileFailed, setTurnstileFailed] = useState(false)
  // A Cloudflare interakciót kér (a widget a gomb alatt láthatóvá vált).
  const [turnstileInteractive, setTurnstileInteractive] = useState(false)
  const [turnstileReset, setTurnstileReset] = useState(0)
  useEffect(() => {
    if (turnstileSiteKey !== undefined) {
      return
    }
    let cancelled = false
    readCheckoutTurnstileSiteKey()
      .then((key) => {
        if (!cancelled) {
          setResolvedSiteKey(key)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedSiteKey(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [turnstileSiteKey])
  const turnstileRequired = resolvedSiteKey !== null
  const handleTurnstileToken = useCallback((token: string | null) => {
    setTurnstileToken(token)
    if (token !== null) {
      setTurnstileFailed(false)
      setTurnstileInteractive(false)
    }
  }, [])
  const handleTurnstileError = useCallback(() => setTurnstileFailed(true), [])

  /**
   * „VISSZA" A BARIONRÓL (bfcache). Sikeres indítás után a gomb szándékosan
   * „Feldolgozás…" állapotban marad (a-ux-15). Ha a vevő a böngésző Vissza
   * gombjával tér vissza, a lap a gyorsítótárból, a MEGFAGYOTT állapottal
   * éled újra: a gomb letiltva maradna, a Turnstile-token pedig már
   * elhasznált. A `pageshow` `persisted` jelzése pontosan ezt az esetet
   * azonosítja (https://developer.mozilla.org/en-US/docs/Web/API/PageTransitionEvent/persisted,
   * web.dev: Back/forward cache, https://web.dev/articles/bfcache).
   */
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) {
        setSubmitting(false)
        setTurnstileReset((previous) => previous + 1)
      }
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])
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
    const course = checkoutBarionCourse({
      id: product.id,
      sku: product.sku,
      priceHuf: product.priceHuf,
      isFree: product.isFree,
    })
    trackInitiateCheckout(course)
    // Már megvett kurzusnál a pénztár nem indítható (a gomb a lejátszóra
    // visz): ez nem valódi tölcsérbelépés, a Metának nem jelezzük.
    if (!alreadyPurchased) {
      trackMetaInitiateCheckout(course)
    }
  }, [product.id, product.sku, product.priceHuf, product.isFree, alreadyPurchased])

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
        : // A gomb ALATT megjelent ellenőrzés az utolsó akadály (lásd
          // CHECKOUT_TURNSTILE_INTERACTIVE_HINT).
          turnstileRequired && turnstileInteractive && !turnstileFailed && turnstileToken === null
          ? CHECKOUT_TURNSTILE_INTERACTIVE_HINT
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
    companyPurchase,
    ...(isGuest ? { guest } : {}),
    turnstile: {
      required: turnstileRequired,
      token: turnstileToken,
      failed: turnstileFailed,
      interactive: turnstileInteractive,
    },
  })

  const runSubmit = createCheckoutSubmitHandler({
    readContext: readCheckoutContext,
    setError,
    setErrorItems,
    setBillingErrors,
    setGuestErrors,
    setCheckboxErrors,
    setSubmitting,
    focusElement,
    submit: trackedSubmitCheckout(product),
    redirect: redirectToGateway,
    // A token egyszer használható: sikertelen beküldés után új ellenőrzés.
    afterFailedSubmit: () => {
      if (turnstileRequired) {
        setTurnstileReset((previous) => previous + 1)
      }
    },
  })

  /**
   * Az összefoglaló linkje a hibás mezőre viszi a fókuszt, nem csak görget:
   * a puszta horgony a böngészők többségében nem fókuszál (a GOV.UK
   * összefoglalója ugyanezt a JavaScript-pótlást végzi).
   */
  const handleErrorItemClick = (targetId: string, event: MouseEvent<HTMLAnchorElement>): void => {
    const target = typeof document === 'undefined' ? null : document.getElementById(targetId)
    if (target === null) {
      return
    }
    event.preventDefault()
    target.focus()
  }

  const setCheckbox = (name: CheckoutCheckboxName, checked: boolean): void => {
    if (name === 'waiverStart') {
      setWaiverStart(checked)
    } else if (name === 'waiverLoss') {
      setWaiverLoss(checked)
    } else {
      setTermsAccepted(checked)
    }
    // A kipipált négyzet hibája eltűnik (a mezőhibák mintájára).
    if (checked) {
      setCheckboxErrors((previous) => {
        if (previous[name] === undefined) {
          return previous
        }
        const next = { ...previous }
        delete next[name]
        return next
      })
    }
  }

  const emailEcho = checkoutEmailEcho(isGuest, isGuest ? guest.email : (user?.email ?? ''))

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
      <CheckoutErrorRegion error={error} items={errorItems} onItemClick={handleErrorItemClick} />
      {error === CHECKOUT_GUEST_EXISTING_ACCOUNT || error === CHECKOUT_REFUNDED_PRIVILEGED ? (
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
            : 'A számla ezekkel az adatokkal készül. Ha a profilodban máshogy szerepelnek, itt felülírhatod őket. A rendelésre az itt megadott adat kerül.'}{' '}
          {/*
            K11 (tulajdonosi döntés, 2026-09-24): a korlátot a kitöltés ELŐTT
            mondjuk ki, nem csak hibaüzenetben. GOV.UK Question pages: „Use
            hint text to show information that helps the majority of users
            answer the question"
            (https://design-system.service.gov.uk/patterns/question-pages/);
            WCAG 2.2 SC 3.3.2 Labels or Instructions
            (https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html).
          */}
          {CHECKOUT_BILLING_HU_ONLY_TEXT}
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
            K11 óta a mező KIZÁRÓLAG a négyjegyű magyar irányítószámot fogadja
            el (billing.ts), ezért mobilon a szám-billentyűzet a helyes
            (GOV.UK, Text input: „set the inputmode attribute to numeric to
            use the numeric keypad on devices with on-screen keyboards",
            https://design-system.service.gov.uk/components/text-input/).
            A `H-` előtag opcionális, így az, hogy a szám-billentyűzeten nem
            írható, nem zár ki senkit. A hibás alakra (elgépelés vagy külföldi
            cím) a közös `billing.ts` a mezőhöz kötött, a négyjegyű alakot kérő
            üzenetet adja; `maxLength` és `pattern` nincs.
          */}
          <Field
            autoComplete="billing postal-code"
            error={billingErrors.zip}
            inputMode="numeric"
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
          K11 + r-ado-13: „Cégként vásárolok" jelölés, amely KÖTELEZŐVÉ teszi
          az adószámot (a szerveren is, billing.ts). Alapból NINCS bejelölve:
          a GOV.UK a jelölőnégyzetet nem jelöli elő („Do not pre-select
          checkbox options", https://design-system.service.gov.uk/components/checkboxes/).
          Az adószám mező magánszemélynek továbbra is opcionális és látható
          (a szerver szerződése szerint), a jelölés csak kötelezővé teszi, és a
          felirata a cégre vált. A céges vevő így nem kaphat adószám nélküli,
          elszámolhatatlan számlát.
        */}
        <div className="kc-checkout-waiver__item">
          <input
            aria-describedby="kc-checkout-company-hint"
            checked={companyPurchase}
            id="kc-checkout-company"
            name="companyPurchase"
            onChange={(event) => {
              setCompanyPurchase(event.target.checked)
              setBillingErrors((previous) => withoutBillingError(previous, 'taxNumber'))
            }}
            type="checkbox"
          />
          <label htmlFor="kc-checkout-company">{CHECKOUT_COMPANY_PURCHASE_LABEL}</label>
        </div>
        <p className="kc-field__hint" id="kc-checkout-company-hint">
          {CHECKOUT_COMPANY_PURCHASE_HINT}
        </p>
        {/*
          Az adószámra nincs szabványos autofill-token, és a böngésző
          amúgy is rossz mezőt (telefonszám, kártyaszám) kínálna fel.
        */}
        <Field
          autoComplete="off"
          error={billingErrors.taxNumber}
          hint={
            companyPurchase
              ? 'Céges vásárlásnál kötelező: 11 számjegy, például 12345676-1-42.'
              : 'Csak céges vásárlás esetén.'
          }
          label={companyPurchase ? 'A cég adószáma' : 'Adószám (céges vásárlásnál)'}
          name={BILLING_INPUT_NAME.taxNumber}
          onChange={(event) => updateBilling('taxNumber', event.target.value)}
          required={companyPurchase}
          value={billing.taxNumber}
        />
      </Card>

      {requiresWaiver ? (
        <Card className="kc-checkout-waiver">
          <h2>Elállási jog</h2>
          {/*
            A bevezető az ÁSZF LÉTEZŐ pontjára mutat (r-legal-7): az ÁSZF az
            elállási jog kizárását rögzíti („Elállási jog kizárása"), a 14 napos
            elállás „szabályait" nem tartalmazza.
          */}
          <p className="kc-checkout-waiver__lead">
            A kurzusvideókat a fizetés után azonnal megnyitjuk. Ehhez a két alábbi nyilatkozat
            szükséges. Az elállási jog kizárásáról az{' '}
            <a href="/aszf" target="_blank" rel="noopener noreferrer">
              Általános szerződési feltételek
            </a>{' '}
            „Elállási jog kizárása” pontja szól.
          </p>

          <div className="kc-checkout-waiver__item">
            <input
              aria-describedby={checkboxDescribedBy(
                'waiverStart',
                checkboxErrors,
                'waiver-start-hint',
              )}
              aria-invalid={checkboxErrors.waiverStart === undefined ? undefined : true}
              checked={waiverStart}
              id={WAIVER_START_INPUT_ID}
              name="waiverStart"
              onChange={(event) => setCheckbox('waiverStart', event.target.checked)}
              required
              type="checkbox"
            />
            <label htmlFor={WAIVER_START_INPUT_ID}>
              Kifejezetten kérem, hogy a digitális tartalomhoz a hozzáférés azonnal megkezdődjön.
            </label>
          </div>
          <CheckboxError errors={checkboxErrors} name="waiverStart" />
          <p className="kc-field__hint" id="waiver-start-hint">
            {CHECKOUT_WAIVER_START_HINT}
          </p>

          <div className="kc-checkout-waiver__item">
            <input
              aria-describedby={checkboxDescribedBy(
                'waiverLoss',
                checkboxErrors,
                'waiver-loss-hint',
              )}
              aria-invalid={checkboxErrors.waiverLoss === undefined ? undefined : true}
              checked={waiverLoss}
              id={WAIVER_LOSS_INPUT_ID}
              name="waiverLoss"
              onChange={(event) => setCheckbox('waiverLoss', event.target.checked)}
              required
              type="checkbox"
            />
            <label htmlFor={WAIVER_LOSS_INPUT_ID}>
              Tudomásul veszem, hogy a teljesítés megkezdésével elveszítem a 14 napos elállási
              jogomat.
            </label>
          </div>
          <CheckboxError errors={checkboxErrors} name="waiverLoss" />
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
            aria-describedby={checkboxDescribedBy('terms', checkboxErrors, TERMS_HINT_ID)}
            aria-invalid={checkboxErrors.terms === undefined ? undefined : true}
            checked={termsAccepted}
            className="kc-checkout-terms__checkbox"
            id={TERMS_INPUT_ID}
            name="consentTerms"
            onChange={(event) => setCheckbox('terms', event.target.checked)}
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
        <CheckboxError errors={checkboxErrors} name="terms" />
        <p className="kc-field__hint" id={TERMS_HINT_ID}>
          {CHECKOUT_TERMS_HINT}
        </p>
      </Card>

      {/* Barion jelzés a fizetőgomb fölött; ingyenes ágon kimarad. */}
      {product.isFree ? null : <BarionFizetesJelzes hely="penztar" />}

      {/*
        ÖSSZEGZÉS KÖZVETLENÜL A FIZETŐGOMB FÖLÖTT (a-ux-6). A 45/2014. Korm.
        rendelet 15. § (1) a lényeges feltételeket (a teljes ár adóval együtt,
        az időtartam) „közvetlenül a fogyasztó szerződési nyilatkozatának
        megtétele előtt" kéri; mérve korábban az ár 3,64 képernyőnyire volt a
        gombtól 320×740-en. GOV.UK Check answers: „Show a single check answers
        page immediately before the confirmation screen"
        (https://design-system.service.gov.uk/patterns/check-answers/). A
        felső kártya megmarad. A beírt e-mail visszaírása ugyanennek a
        mintának az érve: „reduce error rates as users are given a second
        chance to notice and correct errors before submitting data"
        (a-checkout-14, a-ux-4); NN/g, Visibility of System Status
        (https://www.nngroup.com/articles/visibility-system-status/).
      */}
      {product.isFree || alreadyPurchased || product.priceHuf === null ? null : (
        <section aria-labelledby="kc-checkout-final-cim" className="kc-checkout-final">
          <h2 className="kc-checkout-final__heading" id="kc-checkout-final-cim">
            {CHECKOUT_FINAL_SUMMARY_HEADING}
          </h2>
          <dl className="kc-checkout-final__list">
            <div className="kc-checkout-final__row">
              <dt>Kurzus</dt>
              <dd>{product.sku}</dd>
            </div>
            <div className="kc-checkout-final__row">
              <dt>Díj</dt>
              <dd>{CHECKOUT_FINAL_FEE_TEXT}</dd>
            </div>
            <div className="kc-checkout-final__row">
              <dt>Hozzáférés</dt>
              <dd>{CHECKOUT_FINAL_ACCESS_TEXT}</dd>
            </div>
            <div className="kc-checkout-final__row kc-checkout-final__row--total">
              <dt>Fizetendő</dt>
              <dd>{formatPriceHuf(product.priceHuf)}</dd>
            </div>
          </dl>
          <p className="kc-checkout-final__note">{CHECKOUT_FINAL_TAX_TEXT}</p>
          {emailEcho === null ? null : <p className="kc-checkout-final__email">{emailEcho}</p>}
        </section>
      )}

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
        {/*
          A láthatatlan ellenőrzés helye: csak akkor jelenik meg, ha a
          Cloudflare interakciót kér (appearance: interaction-only). Már
          megvett kurzusnál nincs beküldés, ezért nincs ellenőrzés sem.
        */}
        {alreadyPurchased || typeof resolvedSiteKey !== 'string' ? null : (
          <CheckoutTurnstile
            describedBy={blockReason === null ? undefined : CHECKOUT_BLOCK_HINT_ID}
            onError={handleTurnstileError}
            onInteractiveChange={setTurnstileInteractive}
            onToken={handleTurnstileToken}
            resetKey={turnstileReset}
            siteKey={resolvedSiteKey}
          />
        )}
      </div>
    </form>
  )
}
