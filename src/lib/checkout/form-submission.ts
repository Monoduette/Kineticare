import type { CheckoutSubmitInput, CheckoutSubmitResult } from '../checkout-submit'
import { KAPCSOLATI_EMAIL_TARTALEK } from '../contact-email'
import {
  BILLING_FIELD_ORDER,
  billingErrorMap,
  type CheckoutBillingInput,
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

/**
 * Vendég, nincs aktivált fiók, de van paid rendelés az e-mailre. W4: ne
 * mondjuk, hogy „már megvásároltad”. A pénztár-űrlap a Belépés gombot ehhez
 * a szöveghez köti; a cél a lejátszó (új pénztár 409 lenne), nem a checkout.
 *
 * Ez a vevő jellemzően még NEM állított be jelszót (a vendég-kötéshez
 * passwordSetupPending kell, guest-bindable-account.ts), tehát a puszta
 * „jelentkezz be" zsákutca volt. A szöveg megnevezi a belépési oldal
 * jelszó-beállító linkjét a felületen használt felirattal (§3.2 #37,
 * WCAG 2.2 · 3.2.4), és azt, hogy mit kap tőle (ugyanaz a szó, mint a
 * köszönőoldalon: „jelszó-beállító link").
 */
export const CHECKOUT_GUEST_FINISH_AFTER_LOGIN =
  'Ezzel az e-mail-címmel bejelentkezés után tudsz továbblépni. Ha még nincs jelszavad, a belépési oldalon válaszd az „Elfelejtetted a jelszavad?” lehetőséget, és küldünk jelszó-beállító linket.'

/**
 * A Barion hibajelzéssel elutasította a fizetés indítását: fizetés nem jött
 * létre, a rendelés payment_failed, a vevő újrapróbálhatja. Az ok a mi
 * oldalunkon van (konfiguráció, integráció), ezért a vevőtől nem kérünk
 * javítást, csak azt mondjuk meg, hogy pénzt nem vontunk le, és hová
 * fordulhat (GOV.UK, There is a problem with the service: „Try again later",
 * elérhetőség; NN/g Error Message Guidelines: pontos leírás, megoldás).
 */
export const CHECKOUT_START_REJECTED =
  'A fizetési oldal nem nyílt meg, mert a Barion nem fogadta el a fizetés indítását. Pénzt nem vontunk le. Próbáld újra később. Ha a hiba ismétlődik, írj nekünk a Kapcsolat oldalon.'

/**
 * Hibás Barion-beállítás (hiányzó vagy ellentmondó BARION_* változó): egyetlen
 * fizetés sem indulhat, rendelés sem jön létre. Üzemeltetői hiba, amelyet a
 * szerver RIASZTÁS-sal naplóz.
 */
export const CHECKOUT_PAYMENT_CONFIG_UNAVAILABLE =
  'A fizetés most nem indítható el, mert a fizetési rendszer beállításában hiba van nálunk. Pénzt nem vontunk le. Próbáld újra később. Ha sürgős, írj nekünk a Kapcsolat oldalon.'

/**
 * A vevő e-mail-címe a bolt saját Barion-fiókjáé: a Barion a saját boltban
 * fizetést nem enged (docs.barion.com Troubleshooting: „You cannot pay in your
 * own shop."). Vendégként a mezőt kell átírni, bejelentkezve a fiók címe
 * kötött, ezért ott a kijelentkezés a kiút.
 */
export const CHECKOUT_PAYEE_EMAIL_GUEST =
  'Ezzel az e-mail-címmel nem lehet fizetni, mert ez a bolt Barion-fiókjának címe. Adj meg másik e-mail-címet.'

export const CHECKOUT_PAYEE_EMAIL_ACCOUNT =
  'Ezzel a fiókkal nem lehet fizetni, mert az e-mail-címe a bolt Barion-fiókjának címe. Jelentkezz ki, és vendégként adj meg másik e-mail-címet.'

export const CHECKOUT_REFUNDED_RETRY =
  'A fizetésed teljes összegét visszatérítettük, mert az összeg nem egyezett a rendeléssel. Hozzáférés nem jött létre. Indítsd újra a vásárlást.'

export const CHECKOUT_REFUNDED_PRIVILEGED =
  'A fizetésed teljes összegét visszatérítettük: ezzel az e-mail-címmel munkatársi fiók van, vendégként ide nem köthető vásárlás. Lépj be a fiókodba, és onnan indítsd a vásárlást.'

export const CHECKOUT_PAID_UNDER_REVIEW =
  'A fizetésed beérkezett, de a rendelést nem tudtuk automatikusan lezárni. Rövid időn belül rendezzük: vagy megnyitjuk a hozzáférést, vagy a teljes összeget visszatérítjük. Addig ne indíts új fizetést.'

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
 * A jelölőnégyzetek SAJÁT, a négyzet alatt megjelenő hibaüzenetei (a-ux-10).
 *
 * Korábban a kipipálatlan négyzet csak egy fókuszgyűrűt kapott, szöveget nem:
 * a hibarégió 1500 px-re volt tőle. A GOV.UK a hibát a mező mellett ÉS az
 * összefoglalóban ugyanazzal a szöveggel kéri („Use the same message next to
 * the field and in the Error summary component so they look, sound and mean
 * the same", https://design-system.service.gov.uk/components/error-message/),
 * a WCAG 2.2 SC 3.3.1 pedig szöveges azonosítást
 * (https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html).
 * A szöveg a teendőt mondja meg (GOV.UK: „Describe what has happened and tell
 * them how to fix it."), a GOV.UK jelölőnégyzetes mintája szerint
 * felszólítással („Select if…", magyarul „Pipáld ki, hogy…").
 */
export const WAIVER_START_REQUIRED_ERROR = 'Pipáld ki, hogy kéred az azonnali hozzáférést.'
export const WAIVER_LOSS_REQUIRED_ERROR =
  'Pipáld ki, hogy tudomásul veszed az elállási jog elvesztését.'

/** A jelölőnégyzetes nyilatkozatok kulcsai (a mezőhibák mintájára). */
export type CheckoutCheckboxName = 'waiverStart' | 'waiverLoss' | 'terms'

/** Jelölőnégyzet → a négyzet alatt megjelenő hibaüzenet. */
export type CheckoutCheckboxErrors = Partial<Record<CheckoutCheckboxName, string>>

/** A jelölőnégyzet input-azonosítója (az összefoglaló linkje és a label `for` ide mutat). */
export const CHECKBOX_INPUT_ID: Record<CheckoutCheckboxName, string> = {
  waiverStart: WAIVER_START_INPUT_ID,
  waiverLoss: WAIVER_LOSS_INPUT_ID,
  terms: TERMS_INPUT_ID,
}

/** A négyzet alatti hibaüzenet elem-azonosítója (`aria-describedby`). */
export function checkboxErrorId(name: CheckoutCheckboxName): string {
  return `${CHECKBOX_INPUT_ID[name]}-hiba`
}

/** Az összefoglaló egy sora: a hibaüzenet és a hibás elem azonosítója (a link célja). */
export interface CheckoutErrorItem {
  targetId: string
  message: string
}

/**
 * Az összefoglaló címe. A GOV.UK „There is a problem" címének magyar,
 * teendőt mondó megfelelője, a hibák számával: a képernyőolvasó így előre
 * tudja, hány sor következik.
 */
export function checkoutErrorSummaryTitle(count: number): string {
  return count <= 1
    ? 'A fizetés előtt javítsd a következőt:'
    : `A fizetés előtt javítsd a következő ${count} dolgot:`
}

/** Az EGYMENETES ellenőrzés teljes eredménye (lásd `collectCheckoutErrors`). */
export interface CheckoutErrorSummary {
  title: string
  items: CheckoutErrorItem[]
  fieldErrors: BillingFieldErrors
  guestErrors: GuestFieldErrors
  checkboxErrors: CheckoutCheckboxErrors
}

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
  /**
   * A pénztárban a vevőnek MEGJELENÍTETT fizetendő ár. A törzsbe `priceHuf`
   * néven kerül, és a szerver összeveti a MOST érvényes árral
   * (start-checkout.ts `assertPurchasable`): ha az akció a lapnyitás és a
   * beküldés között járt le vagy indult el, a vevő 400-at és frissítési kérést
   * kap, nem pedig csendben más összeget terhel a Barion. Ingyenes terméknél
   * és ismeretlen árnál hiányzik.
   */
  displayedPriceHuf?: number | null
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
   * „Cégként vásárolok" (K11). A hálózati törzsben a `billing.companyPurchase`
   * mezőn megy ki (w1-checkout-backend szerződése), és a szerver ekkor
   * kötelezővé teszi a magyar adószámot. Hiánya = magánszemély (akinek az
   * adószám a szerver szerint is opcionális).
   */
  companyPurchase?: boolean
  /**
   * VENDÉG-VÁSÁRLÁS: az azonosító mezők állapota. Bejelentkezett vásárlásnál
   * hiányzik (a vevőt a munkamenet azonosítja), és a törzsbe sem kerül bele.
   */
  guest?: GuestFormValues
  /**
   * A láthatatlan Turnstile-ellenőrzés állapota (a-checkout-9). Hiánya vagy
   * `required: false` = nincs ellenőrzés (a site key nincs beállítva, a
   * szerver ilyenkor a secret hiányában maga sem ellenőriz).
   */
  turnstile?: CheckoutTurnstileState
}

/** A pénztári Turnstile-ellenőrzés kliens-oldali állapota. */
export interface CheckoutTurnstileState {
  required: boolean
  /** Az egyszer használható token, vagy `null`, amíg nincs (vagy lejárt). */
  token: string | null
  /** A szkript nem töltődött be, vagy az ellenőrzés hibát jelzett. */
  failed: boolean
  /**
   * A Cloudflare interakciót kér (a widget láthatóvá vált a gomb alatt, és a
   * látogatónak ki kell pipálnia). Ilyenkor a várakozás nem segít, tehát a
   * „még fut" üzenet félrevezetne.
   */
  interactive?: boolean
}

/**
 * A pénztári Turnstile-widget tárolójának azonosítója: interakció-kérésnél a
 * gomb megnyomása IDE viszi a fókuszt (a gomb alatt, nem a lap tetején).
 */
export const CHECKOUT_TURNSTILE_CONTAINER_ID = 'kc-checkout-turnstile'

/**
 * A Cloudflare interakciót kér: a teendő a gomb ALATT megjelent ellenőrzés
 * kipipálása. A szöveg a gomb alatti akadály-súgóban áll (a gomb
 * `aria-describedby`-ja), a gomb megnyomása pedig a widgetre viszi a
 * fókuszt, nem a lap tetején álló hibarégióra (a-ux-10 tanulsága: a távoli
 * fókuszugrás mobilon elveszti a vevőt). Mintája a meglévő nyilatkozat-súgó
 * („A fizetéshez pipáld ki mindkét nyilatkozatot…"). Források: GOV.UK Error
 * message („Say how to fix it",
 * https://design-system.service.gov.uk/components/error-message/); WCAG 2.2
 * SC 3.3.3 Error Suggestion; Cloudflare Turnstile, before-interactive-callback
 * („invoked before the challenge enters interactive mode",
 * https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/).
 */
export const CHECKOUT_TURNSTILE_INTERACTIVE_HINT =
  'A fizetéshez pipáld ki a gomb alatti biztonsági ellenőrzés négyzetét.'

/**
 * A spam-ellenőrzés még nem adott tokent (a láthatatlan ellenőrzés
 * jellemzően egy-két másodperc). A vevő tudja, mi történik, és mit tegyen.
 */
export const CHECKOUT_TURNSTILE_PENDING_ERROR =
  'A biztonsági ellenőrzés még fut. Várj néhány másodpercet, és nyomd meg újra a gombot.'

/**
 * A Turnstile szkriptje nem töltődött be (reklámblokkoló, hálózat), vagy az
 * ellenőrzés hibát jelzett. Nem blokkolunk szó nélkül: a vevő megtudja az
 * okot, a teendőt, és azt is, hová fordulhat (K14). Forrás: NN/g,
 * Error-Message Guidelines („offer some potential remedies",
 * https://www.nngroup.com/articles/error-message-guidelines/); GOV.UK,
 * There is a problem with the service (a mintában: „Try again later." és
 * elérhetőség,
 * https://design-system.service.gov.uk/patterns/problem-with-the-service-pages/).
 */
export const CHECKOUT_TURNSTILE_FAILED_ERROR =
  'A fizetés előtti biztonsági ellenőrzés nem töltődött be, ezért most nem tudjuk elindítani a fizetést. Frissítsd az oldalt, és próbáld újra. Ha reklámblokkolót használsz, engedélyezd benne a challenges.cloudflare.com címet. ' +
  `Ha így sem megy, írj nekünk az ${KAPCSOLATI_EMAIL_TARTALEK} címre.`

/**
 * A hálózati törzs: a közös `CheckoutSubmitInput` a két új mezővel. A
 * `companyPurchase` a számlázási blokkban, a `turnstileToken` a gyökérben
 * (a route-handler a szolgáltatás hívása ELŐTT leválasztja róla).
 */
export type CheckoutRequestBody = Omit<CheckoutSubmitInput, 'billing'> & {
  billing: CheckoutBillingInput & { companyPurchase?: boolean }
  turnstileToken?: string
}

export type CheckoutSubmissionPlan =
  /**
   * A beküldés meg sem indulhat (már megvette / hiányzó nyilatkozat / a
   * biztonsági ellenőrzés nem kész). A `focusElementId` az ELSŐ hiányzó
   * elem; a beküldés-kezelő hiányzó nyilatkozatnál ettől függetlenül a
   * teljes hiba-összefoglalót mutatja (`collectCheckoutErrors`).
   */
  | {
      kind: 'blocked'
      message: string
      focusElementId: string | null
      /**
       * `true`: az üzenet a gomb alatti súgóban már látszik, a hibarégió
       * (a lap tetején) üres marad, csak a fókusz mozdul.
       */
      hintOnly?: true
    }
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
  | { kind: 'send'; body: CheckoutRequestBody }

/**
 * A számlázási blokk validálandó alakja. Céges vásárlásnál a jelölés is
 * átmegy, így a KÖZÖS validátor (billing.ts, w1-checkout-backend) a kliensen
 * is kötelezővé teszi az adószámot, ugyanazzal a szöveggel, mint a szerver.
 */
function billingValidationInput(context: CheckoutSubmissionContext): Record<string, unknown> {
  return context.companyPurchase === true
    ? { ...context.billing, companyPurchase: true }
    : context.billing
}

/**
 * EGYMENETES ellenőrzés (a-ux-10): a vendég-mezők, a számlázási mezők, a két
 * elállási nyilatkozat és az ÁSZF-elfogadás hibái EGYSZERRE, az űrlap
 * sorrendjében. `null`, ha nincs hiba.
 *
 * MIÉRT: korábban a beküldés először csak a nyilatkozatot, a következő
 * nyomásra az ÁSZF-et, a harmadikra a mezőket kérte számon, és a fókusz
 * közben a 4000 px-es lap két vége között ugrált. A GOV.UK egyetlen
 * összefoglalót kér minden hibával („Always show an error summary when there
 * is a validation error, even if there's only one", a link a mezőre, illetve
 * jelölőnégyzetnél az első négyzetre mutat:
 * https://design-system.service.gov.uk/components/error-summary/); WCAG 2.2
 * SC 3.3.1 Error Identification.
 */
export function collectCheckoutErrors(
  context: CheckoutSubmissionContext,
): CheckoutErrorSummary | null {
  const items: CheckoutErrorItem[] = []

  const guestErrors: GuestFieldErrors = {}
  if (context.guest !== undefined) {
    const guestResult = validateGuest(context.guest)
    if (!guestResult.ok) {
      Object.assign(guestErrors, guestErrorMap(guestResult.errors))
      for (const field of GUEST_FIELD_ORDER) {
        const message = guestErrors[field]
        if (message !== undefined) {
          items.push({ targetId: guestInputId(field), message })
        }
      }
    }
  }

  const billingResult = validateBilling(billingValidationInput(context))
  const fieldErrors: BillingFieldErrors = billingResult.ok
    ? {}
    : billingErrorMap(billingResult.errors)
  for (const field of BILLING_FIELD_ORDER) {
    const message = fieldErrors[field]
    if (message !== undefined) {
      items.push({ targetId: billingInputId(field), message })
    }
  }

  const checkboxErrors: CheckoutCheckboxErrors = {}
  if (context.waiverRequired) {
    if (!context.waiverStartAccepted) {
      checkboxErrors.waiverStart = WAIVER_START_REQUIRED_ERROR
    }
    if (!context.waiverLossAccepted) {
      checkboxErrors.waiverLoss = WAIVER_LOSS_REQUIRED_ERROR
    }
  }
  if (!context.termsAccepted) {
    checkboxErrors.terms = CHECKOUT_TERMS_ERROR
  }
  for (const name of ['waiverStart', 'waiverLoss', 'terms'] as const) {
    const message = checkboxErrors[name]
    if (message !== undefined) {
      items.push({ targetId: CHECKBOX_INPUT_ID[name], message })
    }
  }

  if (items.length === 0) {
    return null
  }
  return {
    title: checkoutErrorSummaryTitle(items.length),
    items,
    fieldErrors,
    guestErrors,
    checkboxErrors,
  }
}

/**
 * Az űrlapállapotból a beküldési terv. A `send` ág törzse a MEZŐK AKTUÁLIS
 * állapotából épül (normalizálva) — a profil-előkitöltésnek itt már nyoma
 * sincs, tehát a felülírt érték kerül a rendelésre és a számlára.
 *
 * A terv a KATEGÓRIÁT és az első hiányzó elemet adja (ebből dolgozik a
 * pénztári hibamérés is); a vevőnek mutatott, minden hibát egyszerre felsoroló
 * összefoglalót a `collectCheckoutErrors` állítja elő.
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
   * ÁSZF-ELFOGADÁS — a waiver UTÁN ellenőrizve, mert az űrlapon is utána áll.
   * Az ág ingyenes terméken is fut (nincs `termsRequired` kapcsoló — a
   * konzisztens viselkedés maga a döntés).
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
   * hiányoznak, a szerver úgyis 400-zal utasítana el.
   */
  const guestResult = context.guest === undefined ? null : validateGuest(context.guest)
  const guestErrors =
    guestResult !== null && !guestResult.ok ? guestErrorMap(guestResult.errors) : {}

  const result = validateBilling(billingValidationInput(context))
  const fieldErrors = result.ok ? {} : billingErrorMap(result.errors)

  if (guestResult !== null && !guestResult.ok) {
    const firstInvalid =
      GUEST_FIELD_ORDER.find((field) => guestErrors[field] !== undefined) ?? 'email'
    return {
      kind: 'invalid',
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

  /**
   * A BIZTONSÁGI ELLENŐRZÉS az adatok UTÁN: a vevő előbb a saját hibáit
   * látja, és csak kész űrlapnál kap szót a még futó (vagy be sem töltött)
   * ellenőrzés. Token nélkül nem küldünk: a szerver úgyis 400-at adna, és a
   * vevő nem tudná, miért.
   */
  const turnstile = context.turnstile
  const turnstileToken =
    turnstile?.required === true && typeof turnstile.token === 'string' && turnstile.token !== ''
      ? turnstile.token
      : null
  if (turnstile?.required === true && turnstileToken === null) {
    if (!turnstile.failed && turnstile.interactive === true) {
      return {
        kind: 'blocked',
        message: CHECKOUT_TURNSTILE_INTERACTIVE_HINT,
        focusElementId: CHECKOUT_TURNSTILE_CONTAINER_ID,
        hintOnly: true,
      }
    }
    return {
      kind: 'blocked',
      message: turnstile.failed
        ? CHECKOUT_TURNSTILE_FAILED_ERROR
        : CHECKOUT_TURNSTILE_PENDING_ERROR,
      focusElementId: CHECKOUT_ERROR_REGION_ID,
    }
  }

  const billing = toBillingPayload(result.value)
  return {
    kind: 'send',
    body: {
      productId: context.productId,
      quantity: context.quantity ?? 1,
      ...(typeof context.displayedPriceHuf === 'number' &&
      Number.isFinite(context.displayedPriceHuf)
        ? { priceHuf: context.displayedPriceHuf }
        : {}),
      consentWithdrawalWaiver: true,
      // Ide CSAK a fenti `blocked` ág átengedésével juthatunk el, tehát a
      // `true` itt TÉNYÁLLÍTÁS. A szerver ettől függetlenül újra ellenőrzi
      // (start-checkout.ts): a kliens megkerülhető.
      consentTerms: true,
      // A céges jelölés a számlázási blokkban megy (w1-checkout-backend
      // szerződése: `billing.companyPurchase`, szó szerinti `true`).
      billing: context.companyPurchase === true ? { ...billing, companyPurchase: true } : billing,
      // A vendég-blokk KIZÁRÓLAG bejelentkezés nélkül megy ki (belépve a
      // szerver úgyis figyelmen kívül hagyná).
      ...(guestResult !== null && guestResult.ok ? { guest: guestResult.value } : {}),
      ...(turnstileToken !== null ? { turnstileToken } : {}),
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
  /** A hibarégió fő szövege (szerverhiba, vagy az összefoglaló címe). */
  setError: (message: string | null) => void
  /** Az összefoglaló linkes sorai (szerverhibánál és sikernél üres lista). */
  setErrorItems: (items: readonly CheckoutErrorItem[]) => void
  setBillingErrors: (errors: BillingFieldErrors) => void
  /** A vendég-mezők hibáinak beállítása (bejelentkezve mindig üres map). */
  setGuestErrors: (errors: GuestFieldErrors) => void
  /** A jelölőnégyzetek alatti hibaüzenetek. */
  setCheckboxErrors: (errors: CheckoutCheckboxErrors) => void
  setSubmitting: (value: boolean) => void
  /** `null` esetén nincs fókuszálandó elem (a hívó ilyenkor ne csináljon semmit). */
  focusElement: (elementId: string | null) => void
  submit: (body: CheckoutRequestBody) => Promise<CheckoutSubmitResult>
  /** Sikeres indítás után a fizetési átjáróra navigálás. */
  redirect: (gatewayUrl: string) => void
  /**
   * Sikertelen beküldés után (szerverhiba vagy kivétel). A Turnstile-token
   * egyszer használható, és a szerver már elhasználta: újat kell kérni, mert
   * a következő nyomás a régivel biztosan elbukna.
   */
  afterFailedSubmit?: () => void
}

export function createCheckoutSubmitHandler(deps: CheckoutSubmitHandlerDeps): () => Promise<void> {
  return async () => {
    deps.setError(null)
    deps.setErrorItems([])

    const context = deps.readContext()
    const plan = planCheckoutSubmission(context)

    if (plan.kind === 'blocked' || plan.kind === 'invalid') {
      // A már megvett kurzus nem űrlaphiba: ott a mezők javítása nem segít.
      const summary = context.alreadyPurchased ? null : collectCheckoutErrors(context)
      if (summary !== null) {
        deps.setBillingErrors(summary.fieldErrors)
        deps.setGuestErrors(summary.guestErrors)
        deps.setCheckboxErrors(summary.checkboxErrors)
        deps.setError(summary.title)
        deps.setErrorItems(summary.items)
        // GOV.UK: „Move keyboard focus to the error summary" — a böngésző az
        // összefoglalót a képernyőre görgeti, onnan minden hiba egy linkre van.
        deps.focusElement(CHECKOUT_ERROR_REGION_ID)
        return
      }
      if (plan.kind === 'blocked' && plan.hintOnly === true) {
        deps.focusElement(plan.focusElementId)
        return
      }
      deps.setError(plan.message)
      deps.focusElement(plan.focusElementId)
      return
    }

    deps.setBillingErrors({})
    deps.setGuestErrors({})
    deps.setCheckboxErrors({})
    deps.setSubmitting(true)
    /**
     * SIKERES átirányítás után a gomb „Feldolgozás…" állapotban MARAD
     * (a-ux-15): a böngésző még a Barion felé navigál, és a korábbi
     * visszaállítás a gombot újra nyomhatóvá tette, így egy türelmetlen
     * második koppintás még egy POST-ot küldött. Visszaállítás CSAK hibánál és
     * váratlan kivételnél. A „vissza" gombbal (bfcache) visszatérő lapot a
     * `CheckoutForm` `pageshow`-kezelője oldja fel.
     */
    let redirected = false
    try {
      const result = await deps.submit(plan.body)
      if (result.ok) {
        deps.redirect(result.gatewayUrl)
        redirected = true
        return
      }
      // A hibaüzenet ONNAN kap fókuszt, ahol a felhasználó látja is: enélkül a
      // doboz a képernyőn kívül maradt, és a beküldés némán elhalt (B1).
      deps.setError(result.message)
      deps.focusElement(CHECKOUT_ERROR_REGION_ID)
    } finally {
      if (!redirected) {
        deps.setSubmitting(false)
        deps.afterFailedSubmit?.()
      }
    }
  }
}
