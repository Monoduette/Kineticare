import type { CheckoutSubmitInput, CheckoutSubmitResult } from '../checkout-submit'
import {
  BILLING_FIELD_ORDER,
  billingErrorMap,
  billingSummaryMessage,
  toBillingPayload,
  validateBilling,
  type BillingFieldName,
} from './billing'
import {
  GUEST_FIELD_ORDER,
  guestErrorMap,
  guestSummaryMessage,
  validateGuest,
  type GuestFieldName,
} from './guest'

/**
 * A pénztár űrlapjának TISZTA döntési magja.
 *
 * MIÉRT KÜLÖN MODUL: a `vitest` `environment: 'node'`, jsdom/happy-dom nincs
 * telepítve (és nem is veszünk fel újat), a `renderToStaticMarkup` pedig a
 * `defaultValue`-t is `value=` attribútumként rendereli — vagyis a kimenetből
 * NEM lehet megkülönböztetni a kontrollált mezőt a kontrollálatlantól. Az a
 * hiba viszont, ami miatt ez a kör indult, éppen az volt, hogy a beküldött
 * törzs NEM a mezők (módosított) állapotából épült. Ez a modul azt a lépést
 * emeli ki, ahol ez eldől — így valódi, diszkrimináló teszt írható rá, a
 * `CheckoutForm` pedig csak állapotot tart és eseményt köt.
 *
 * A modul függőségmentes (nincs react-, next- vagy payload-import).
 */

/** A pénztár számlázási mezőinek NYERS (még nem validált) állapota. */
export type BillingFormValues = Record<BillingFieldName, string>

/** Mezőnév → megjelenítendő magyar hibaüzenet. */
export type BillingFieldErrors = Partial<Record<BillingFieldName, string>>

/** A vendég-azonosító mezők (e-mail + név) NYERS állapota. */
export type GuestFormValues = Record<GuestFieldName, string>

/** Mezőnév → megjelenítendő magyar hibaüzenet (vendég-mezők). */
export type GuestFieldErrors = Partial<Record<GuestFieldName, string>>

/** A profilból előkitölthető mezők (a `CheckoutUser` érintett része). */
export interface BillingProfile {
  name?: string | null
  billingName?: string | null
  billingZip?: string | null
  billingCity?: string | null
  billingStreet?: string | null
  taxNumber?: string | null
}

/**
 * A validációs mezőnév → a HTML input `name` attribútuma. Egyetlen forrás:
 * a `CheckoutForm` ebből adja a `name` propokat, a fókuszálandó elem
 * azonosítója pedig ugyanebből képződik — így a kettő nem tud elcsúszni.
 */
export const BILLING_INPUT_NAME: Record<BillingFieldName, string> = {
  name: 'billingName',
  zip: 'billingZip',
  city: 'billingCity',
  street: 'billingStreet',
  taxNumber: 'taxNumber',
}

/** A `Field` id-konvenciója (`kc-field-<name>`) szerinti elem-azonosító. */
export function billingInputId(field: BillingFieldName): string {
  return `kc-field-${BILLING_INPUT_NAME[field]}`
}

/**
 * A vendég-mezők input-nevei. SZÁNDÉKOSAN eltérnek a számlázási mezőktől: a
 * `guestName` a FIÓK neve (ide megy a levél megszólítása), a `billingName`
 * pedig a számlára kerülő — céges vásárlásnál cégnév — adat.
 */
export const GUEST_INPUT_NAME: Record<GuestFieldName, string> = {
  email: 'guestEmail',
  name: 'guestName',
}

export function guestInputId(field: GuestFieldName): string {
  return `kc-field-${GUEST_INPUT_NAME[field]}`
}

export const CHECKOUT_ALREADY_PURCHASED_ERROR =
  'Ezt a kurzust már megvetted. A lejátszóban éred el.'

/**
 * Vendég, aktivált fiók: a szerver 409-cel ezt adja. Itt is él, hogy a
 * pénztár-űrlap a Belépés gombot ehhez a szöveghez kösse (kliens-biztos modul).
 */
export const CHECKOUT_GUEST_EXISTING_ACCOUNT =
  'Ehhez az e-mail-címhez már van fiók. Jelentkezz be, és onnan tudod megvenni vagy megnyitni a kurzust.'
export const CHECKOUT_WAIVER_ERROR = 'A vásárláshoz mindkét hozzájárulást el kell fogadnod.'

/** ÁSZF-elfogadás a pénztárban — egy jelölőnégyzet, két hivatkozás; alapból üres (ingyenes terméken is). */

/** A jelölőnégyzet elem-azonosítója (a `label for` és a fókuszcél is ez). */
export const TERMS_INPUT_ID = 'kc-checkout-terms'

/** A jelölőnégyzethez tartozó súgó elem-azonosítója (`aria-describedby`). */
export const TERMS_HINT_ID = 'kc-checkout-terms-hint'

/** Az ÁSZF útvonala (a lábléc jogi linkjeivel és a waiver-blokkal azonos). */
export const TERMS_ASZF_PATH = '/aszf'

/**
 * Az adatkezelési tájékoztató útvonala. Ugyanaz, amit a hírlevél-, az
 * időpontkérő- és az ingyenes kurzus űrlapja használ (`PRIVACY_POLICY_PATH`);
 * a `penztar-aszf-elfogadas.test.tsx` állítása méri, hogy a kettő nem csúszik
 * szét. A modul FÜGGŐSÉGMENTES marad (lásd a fájl fejkommentjét), ezért a
 * konstans itt is ki van írva, nem importáljuk.
 */
export const TERMS_PRIVACY_PATH = '/adatvedelem'

/**
 * A felirat darabjai — a két hivatkozás a mondatba ÁGYAZVA áll.
 *
 * A SZÓHASZNÁLAT az ÁSZF 22. bekezdését követi: az ÁSZF-et ELFOGADJUK, az
 * adatkezelési tájékoztatót MEGISMERJÜK (az adatkezelés nem szerződés, azt nem
 * „elfogadni" kell). A dokumentum NEVE viszont a felület saját, mindenhol
 * használt megnevezése („Adatkezelési és adatvédelmi szabályzat" — így hívja a
 * lábléc, a hírlevél-, az időpontkérő- és az ingyenes kurzus űrlapja is): ha
 * ugyanaz a hivatkozás a pénztárban máshogy szólna, az a WCAG 2.2 SC 3.2.4-be
 * ütközne.
 *
 * A hivatkozás-feliratok TÁRGYESETBEN állnak, mert magyarul a mondat csak így
 * nyelvhelyes („megismertem az Adatkezelési és adatvédelmi szabályzatot"). A
 * szótári alak beerőltetése fordítás-ízű, magyartalan mondatot adna, amit a
 * tulajdonos kifejezetten tiltott (docs/ui-sztenderdek.md §3.1).
 */
export const CHECKOUT_TERMS_LABEL = {
  before: 'Elfogadom az ',
  aszfLabel: 'Általános szerződési feltételeket',
  between: ', és megismertem az ',
  privacyLabel: 'Adatkezelési és adatvédelmi szabályzatot',
  after: '.',
} as const

/** Link nélküli, összefűzött változat (naplóhoz, teszthez, adminhoz). */
export const CHECKOUT_TERMS_LABEL_TEXT = `${CHECKOUT_TERMS_LABEL.before}${CHECKOUT_TERMS_LABEL.aszfLabel}${CHECKOUT_TERMS_LABEL.between}${CHECKOUT_TERMS_LABEL.privacyLabel}${CHECKOUT_TERMS_LABEL.after}`

/**
 * A KÉPERNYŐOLVASÓNAK szóló figyelmeztetés: a jogi linkek ÚJ LAPON nyílnak.
 *
 * Miért új lap: a pénztár űrlapállapota kliens-oldali React-state, tehát a
 * saját lapon való elnavigálás ELVESZTENÉ a már kitöltött számlázási adatokat.
 * Miért kell kimondani: WCAG 2.2 SC 3.2.5 (Change on Request) — az ablaknyitás
 * nem tekinthető felhasználó által kezdeményezettnek előzetes jelzés nélkül; a
 * G201 technika kifejezetten az előzetes figyelmeztetést ajánlja.
 * https://www.w3.org/WAI/WCAG22/Understanding/change-on-request.html
 */
export const TERMS_NEW_TAB_HINT = ' (új lapon nyílik)'

/**
 * A rögzítés ígérete a vevőnek — ugyanaz a mondatforma, mint a waiver-blokké
 * („A hozzájárulásodat a rendszer a rendelésen időbélyeggel rögzíti."). Az
 * ígéretet a szerver `buildCustomerSnapshot`-ja váltja be: a rendelés
 * vevő-pillanatképére `consentTerms` + `consentTermsAt` kerül.
 */
export const CHECKOUT_TERMS_HINT = 'Az elfogadásodat a rendszer a rendelésen időbélyeggel rögzíti.'

/** A blokk címsora (a kártya h2-je). */
export const CHECKOUT_TERMS_HEADING = 'Szerződési feltételek'

/**
 * A hiányzó elfogadás üzenete az élő hibarégióba. A GOV.UK hibaszöveg-mintáját
 * követi: a hibaüzenet MEGMONDJA A TEENDŐT, nem csak a hiányt állapítja meg.
 * https://design-system.service.gov.uk/components/checkboxes/
 */
export const CHECKOUT_TERMS_ERROR =
  'A vásárláshoz fogadd el az Általános szerződési feltételeket, és jelöld, hogy az Adatkezelési és adatvédelmi szabályzatot megismerted.'

/** Az elállási-nyilatkozat két jelölőnégyzetének elem-azonosítója. */
/**
 * A pénztár élő hibarégiójának azonosítója.
 *
 * MIÉRT KELL AZONOSÍTÓ EGY `role="alert"` DOBOZNAK: az élő régiót a
 * képernyőolvasó felolvassa, a LÁTÓ felhasználó viszont nem látja, ha a doboz a
 * képernyőn kívül van. Mérve: szerverhiba után a hibadoboz `top` értéke asztalon
 * −753 px, mobilon −1343 px, a `document.activeElement` pedig `BODY` maradt —
 * vagyis a felületen SEMMI nem jelezte a hibát, a gomb is visszaállt alapállásba.
 * A fókusz ide mozgatásával a böngésző a dobozt a képernyőre görgeti, és a
 * billentyűzetes olvasás is innen folytatódik.
 */
export const CHECKOUT_ERROR_REGION_ID = 'kc-checkout-hiba'

export const WAIVER_START_INPUT_ID = 'waiver-start'
export const WAIVER_LOSS_INPUT_ID = 'waiver-loss'

/**
 * A profil KIZÁRÓLAG előkitöltés: innentől a form-állapot az igazság, és a
 * beküldésbe a (esetleg felülírt) állapot megy — nem a profil.
 */
export function prefillBillingForm(profile: BillingProfile): BillingFormValues {
  return {
    // A `buyerFromOrder` is a billingName → name sorrendet követi (invoice.ts).
    name: profile.billingName ?? profile.name ?? '',
    zip: profile.billingZip ?? '',
    city: profile.billingCity ?? '',
    street: profile.billingStreet ?? '',
    taxNumber: profile.taxNumber ?? '',
  }
}

/**
 * A vendég-mezők előkitöltése. Bejelentkezve NINCS vendég-blokk (a szerver a
 * munkamenetből dolgozik), ezért az űrlap üres állapotból indul.
 */
export function emptyGuestForm(): GuestFormValues {
  return { email: '', name: '' }
}

/** Egy mező új értéke (a state-frissítés tiszta megfelelője). */
export function withGuestValue(
  values: GuestFormValues,
  field: GuestFieldName,
  value: string,
): GuestFormValues {
  return { ...values, [field]: value }
}

/** A vendég-mező hibájának TÖRLÉSE gépelés közben (a számlázási mezők mintája). */
export function withoutGuestError(
  errors: GuestFieldErrors,
  field: GuestFieldName,
): GuestFieldErrors {
  if (errors[field] === undefined) {
    return errors
  }
  const next = { ...errors }
  delete next[field]
  return next
}

/** Egy mező új értéke (a state-frissítés tiszta megfelelője). */
export function withBillingValue(
  values: BillingFormValues,
  field: BillingFieldName,
  value: string,
): BillingFormValues {
  return { ...values, [field]: value }
}

/**
 * A mező hibájának TÖRLÉSE gépelés közben.
 *
 * Enélkül az `aria-invalid` a javítás után is igaz maradt, tehát a
 * képernyőolvasó a már helyes mezőt is végig érvénytelennek mondta.
 */
export function withoutBillingError(
  errors: BillingFieldErrors,
  field: BillingFieldName,
): BillingFieldErrors {
  if (errors[field] === undefined) {
    return errors
  }
  const next = { ...errors }
  delete next[field]
  return next
}

/** A beküldés pillanatában érvényes teljes űrlapállapot. */
export interface CheckoutSubmissionContext {
  productId: number
  quantity?: number
  alreadyPurchased: boolean
  /** Fizetős termék → a két elállási nyilatkozat kötelező. */
  waiverRequired: boolean
  waiverStartAccepted: boolean
  waiverLossAccepted: boolean
  /**
   * Az ÁSZF-elfogadás (és az adatkezelési tájékoztató megismerésének)
   * jelölőnégyzete. MINDEN terméken kötelező — az ingyenesen is, mert a
   * szerződés ott is létrejön (lásd a CHECKOUT_TERMS_* konstansok fejkommentjét).
   */
  termsAccepted: boolean
  billing: BillingFormValues
  /**
   * VENDÉG-VÁSÁRLÁS: az azonosító mezők állapota. Bejelentkezett vásárlásnál
   * hiányzik (a vevőt a munkamenet azonosítja), és a törzsbe sem kerül bele.
   */
  guest?: GuestFormValues
}

export type CheckoutSubmissionPlan =
  /** A beküldés meg sem indulhat (már megvette / hiányzó nyilatkozat). */
  | { kind: 'blocked'; message: string; focusElementId: string | null }
  /** A megadott adatok hibásak — mezőhibák + összefoglaló + fókuszcél. */
  | {
      kind: 'invalid'
      message: string
      fieldErrors: BillingFieldErrors
      /** A vendég-mezők hibái (bejelentkezve mindig üres). */
      guestErrors: GuestFieldErrors
      focusElementId: string
    }
  /** Mehet: ez a törzs megy ki a POST /api/checkout/start végpontra. */
  | { kind: 'send'; body: CheckoutSubmitInput }

/**
 * Az űrlapállapotból a beküldési terv. A `send` ág törzse a MEZŐK AKTUÁLIS
 * állapotából épül (normalizálva) — a profil-előkitöltésnek itt már nyoma
 * sincs, tehát a felülírt érték kerül a rendelésre és a számlára.
 */
export function planCheckoutSubmission(context: CheckoutSubmissionContext): CheckoutSubmissionPlan {
  if (context.alreadyPurchased) {
    return {
      kind: 'blocked',
      message: CHECKOUT_ALREADY_PURCHASED_ERROR,
      focusElementId: CHECKOUT_ERROR_REGION_ID,
    }
  }
  if (context.waiverRequired && !(context.waiverStartAccepted && context.waiverLossAccepted)) {
    return {
      kind: 'blocked',
      message: CHECKOUT_WAIVER_ERROR,
      focusElementId: context.waiverStartAccepted ? WAIVER_LOSS_INPUT_ID : WAIVER_START_INPUT_ID,
    }
  }
  /**
   * ÁSZF-ELFOGADÁS — a waiver UTÁN ellenőrizve, mert az űrlapon is utána áll:
   * a fókusz így mindig az ELSŐ hiányzó jelölőnégyzetre kerül, nem egy
   * feljebb/lejjebb lévőre. Az ág ingyenes terméken is fut (nincs
   * `termsRequired` kapcsoló — a konzisztens viselkedés maga a döntés).
   */
  if (!context.termsAccepted) {
    return {
      kind: 'blocked',
      message: CHECKOUT_TERMS_ERROR,
      focusElementId: TERMS_INPUT_ID,
    }
  }

  /**
   * A VENDÉG-MEZŐK ELŐBB: a beküldési űrlapon ezek állnak legelöl, és ha
   * hiányoznak, a szerver úgyis 400-zal utasítana el. A fókusz így az első
   * tényleg hibás mezőre kerül, nem a lejjebb lévő számlázási blokkra.
   */
  const guestResult = context.guest === undefined ? null : validateGuest(context.guest)
  const guestErrors =
    guestResult !== null && !guestResult.ok ? guestErrorMap(guestResult.errors) : {}

  const result = validateBilling(context.billing)
  const fieldErrors = result.ok ? {} : billingErrorMap(result.errors)

  if (guestResult !== null && !guestResult.ok) {
    const firstInvalid =
      GUEST_FIELD_ORDER.find((field) => guestErrors[field] !== undefined) ?? 'email'
    return {
      kind: 'invalid',
      // Ha a számlázási blokk is hibás, az összefoglaló a vendég-mezőkről szól:
      // a felhasználó a fókuszált (első) hibát javítja, a többi a mezőknél látszik.
      message: guestSummaryMessage(guestResult.errors),
      fieldErrors,
      guestErrors,
      focusElementId: guestInputId(firstInvalid),
    }
  }

  if (!result.ok) {
    const firstInvalid =
      BILLING_FIELD_ORDER.find((field) => fieldErrors[field] !== undefined) ?? 'name'
    return {
      kind: 'invalid',
      message: billingSummaryMessage(result.errors),
      fieldErrors,
      guestErrors: {},
      focusElementId: billingInputId(firstInvalid),
    }
  }

  return {
    kind: 'send',
    body: {
      productId: context.productId,
      quantity: context.quantity ?? 1,
      consentWithdrawalWaiver: true,
      // Ide CSAK a fenti `blocked` ág átengedésével juthatunk el, tehát a
      // `true` itt TÉNYÁLLÍTÁS. A szerver ettől függetlenül újra ellenőrzi
      // (start-checkout.ts): a kliens megkerülhető.
      consentTerms: true,
      billing: toBillingPayload(result.value),
      // A vendég-blokk KIZÁRÓLAG bejelentkezés nélkül megy ki (belépve a
      // szerver úgyis figyelmen kívül hagyná).
      ...(guestResult !== null && guestResult.ok ? { guest: guestResult.value } : {}),
    },
  }
}

/**
 * A beküldés MELLÉKHATÁSAI — a tiszta terv és a React-komponens közötti
 * huzalozás.
 *
 * MIÉRT KÜLÖN GYÁR: a `planCheckoutSubmission` maga kiválóan tesztelt, de a
 * review mutációval megmutatta, hogy a MAG ÉS A KOMPONENS KÖZTI kötés
 * továbbra is fedezetlen volt: a `handleSubmit`-et át lehetett írni úgy, hogy
 * megkerülje a tervet (és pontosan az eredeti hibát csinálja — üres
 * számlázási adatot küldjön), miközben a teljes suite zöld maradt. Éppen ezen
 * a ponton élt az eredeti hiba, ezért ezt is le kell fedni.
 *
 * A gyár DOM nélkül, hamis függőségekkel tesztelhető; a `CheckoutForm` már
 * csak állapotot tart és ezt a függvényt köti az `onSubmit`-re.
 */
export interface CheckoutSubmitHandlerDeps {
  /** A beküldés pillanatában érvényes űrlapállapot (a React-state olvasása). */
  readContext: () => CheckoutSubmissionContext
  setError: (message: string | null) => void
  setBillingErrors: (errors: BillingFieldErrors) => void
  /** A vendég-mezők hibáinak beállítása (bejelentkezve mindig üres map). */
  setGuestErrors: (errors: GuestFieldErrors) => void
  setSubmitting: (value: boolean) => void
  /** `null` esetén nincs fókuszálandó elem (a hívó ilyenkor ne csináljon semmit). */
  focusElement: (elementId: string | null) => void
  submit: (body: CheckoutSubmitInput) => Promise<CheckoutSubmitResult>
  /** Sikeres indítás után a fizetési átjáróra navigálás. */
  redirect: (gatewayUrl: string) => void
}

export function createCheckoutSubmitHandler(deps: CheckoutSubmitHandlerDeps): () => Promise<void> {
  return async () => {
    deps.setError(null)

    const plan = planCheckoutSubmission(deps.readContext())

    if (plan.kind === 'blocked') {
      deps.setError(plan.message)
      deps.focusElement(plan.focusElementId)
      return
    }
    if (plan.kind === 'invalid') {
      deps.setBillingErrors(plan.fieldErrors)
      deps.setGuestErrors(plan.guestErrors)
      deps.setError(plan.message)
      deps.focusElement(plan.focusElementId)
      return
    }

    deps.setBillingErrors({})
    deps.setGuestErrors({})
    deps.setSubmitting(true)
    // A `submit` saját hibakezelése miatt itt nem dobhat; a `finally` mégis
    // kell, hogy egy váratlan kivétel se hagyja a gombot „Feldolgozás…"-ban.
    try {
      const result = await deps.submit(plan.body)
      if (result.ok) {
        deps.redirect(result.gatewayUrl)
        return
      }
      // A hibaüzenet ONNAN kap fókuszt, ahol a felhasználó látja is: enélkül a
      // doboz a képernyőn kívül maradt, és a beküldés némán elhalt (B1).
      deps.setError(result.message)
      deps.focusElement(CHECKOUT_ERROR_REGION_ID)
    } finally {
      deps.setSubmitting(false)
    }
  }
}
