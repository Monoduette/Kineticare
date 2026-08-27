/**
 * Visszatérési útvonal (`returnUrl`, `vissza`) ellenőrzése — EGY helyen.
 *
 * Több folyamat is fogad a felhasználótól visszatérési célt: a belépés és a
 * regisztráció `?returnUrl=` paramétere (a pénztár is ezen keresztül küldi
 * vissza a vásárlót), illetve az előnézetből kilépő route `?vissza=`
 * paramétere. Mindegyiknél ugyanaz a kockázat: ha a kapott érték idegen
 * eredetre mutat, a belépés utáni ugrás (`window.location.href`) vagy a
 * `Location` fejléc egy külső, megtévesztő oldalra viszi a felhasználót
 * (open redirect → belépés utáni adathalászat).
 *
 * A szűrés ezért közös segédben él, és minden fogyasztó ezt használja: a
 * hívási helyenként külön megírt `startsWith('/')` ellenőrzés NEM elég, mert a
 * `//evil.example` és a `/\evil.example` alakot a böngésző protokoll-relatív,
 * tehát IDEGEN EREDETŰ címként értelmezi.
 *
 * A modul szándékosan függőségmentes (nincs benne naplózás és Next-import),
 * így szerver- és kliensoldali kódból egyaránt behúzható.
 */

/** A belépés/regisztráció alapértelmezett célja, ha nincs érvényes returnUrl. */
export const DEFAULT_AUTH_RETURN_URL = '/kurzusaim'

/** A nyilvános belépő oldal útvonala. */
export const SIGN_IN_PATH = '/belepes'

/** A nyilvános jelszó-visszaállító kérés útvonala. */
export const FORGOT_PASSWORD_PATH = '/elfelejtett-jelszo'

/**
 * Belépő hivatkozás ellenőrzött `returnUrl`-lel.
 *
 * A kosár már így viszi vissza a vevőt a pénztárra; a pénztár vendég-sora, a
 * köszönőoldal és a jelszó-levelek korábban csupasz `/belepes`-t adtak, és a
 * belépés után a Kurzusaim/pénztár szándék elveszett. A szűrés ugyanaz, mint
 * a belépő oldalé: idegen eredetű cél a `DEFAULT_AUTH_RETURN_URL`-re esik.
 *
 * Forrás: GOV.UK Design System, Begin with the user need / don’t drop people
 * off a journey (https://design-system.service.gov.uk/patterns/task-list-pages/);
 * WCAG 2.2 · 3.2.4 Consistent Identification
 * (https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html).
 */
export function signInHref(returnUrl: string = DEFAULT_AUTH_RETURN_URL): string {
  const safe = sanitizeReturnUrl(returnUrl, DEFAULT_AUTH_RETURN_URL)
  return `${SIGN_IN_PATH}?returnUrl=${encodeURIComponent(safe)}`
}

/**
 * Elfelejtett-jelszó oldal ellenőrzött `returnUrl`-lel.
 *
 * A belépő oldalról és a meglévő-fiók levelekből ide lép a vevő. A korábbi
 * csupasz `/elfelejtett-jelszo` eldobta a pénztár/kurzus célt, és a reset-levél
 * mindig a Kurzusaimra esett. A szűrés ugyanaz, mint a belépőé.
 *
 * Forrás: GOV.UK, Don’t drop people off a journey
 * https://www.gov.uk/service-manual/design/user-centred-design ;
 * WCAG 2.2 · 3.2.4 Consistent Identification
 * https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html
 */
export function forgotPasswordHref(returnUrl: string = DEFAULT_AUTH_RETURN_URL): string {
  const safe = sanitizeReturnUrl(returnUrl, DEFAULT_AUTH_RETURN_URL)
  return `${FORGOT_PASSWORD_PATH}?returnUrl=${encodeURIComponent(safe)}`
}

/**
 * A Payload forgot-password kérés `req.data.returnUrl` értéke, szűrve.
 * Ismeretlen vagy idegen érték → Kurzusaim. A REST handler a teljes JSON-t
 * `req.data`-ba teszi, a műveletnek csak az e-mailt adja tovább.
 */
export function returnUrlFromForgotPasswordRequest(req: unknown): string {
  if (typeof req !== 'object' || req === null) {
    return DEFAULT_AUTH_RETURN_URL
  }
  const data = (req as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) {
    return DEFAULT_AUTH_RETURN_URL
  }
  return sanitizeReturnUrl((data as { returnUrl?: unknown }).returnUrl, DEFAULT_AUTH_RETURN_URL)
}

/**
 * Vezérlőkarakter (pl. soremelés) az útvonalban a `Location` fejlécben
 * fejléc-injekciót jelentene, ezért az ilyen érték sehol nem engedhető át.
 * Regex helyett kódpont-vizsgálat: a vezérlőkaraktert tartalmazó regex az
 * ESLint no-control-regex szabályába ütközne.
 */
export function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) {
      return true
    }
  }
  return false
}

/**
 * A visszatérési útvonal ellenőrzése: CSAK azonos eredetű, a gyökérből induló
 * relatív útvonal engedélyezett.
 *
 * Kizárva:
 *  - nem szöveg (hiányzó vagy többször megadott query-paraméter — utóbbi tömb),
 *  - üres vagy csak whitespace,
 *  - `//host` és `/\host` — protokoll-relatív, tehát idegen eredetű cím,
 *  - abszolút URL és bármilyen séma (`http:`, `https:`, `javascript:`,
 *    `data:` …), valamint a séma nélküli, nem gyökérből induló útvonal,
 *  - vezérlőkaraktert tartalmazó érték (fejléc-injekció).
 *
 * Minden gyanús értékre a hívó által megadott `fallback` a válasz, így az
 * átirányítás sosem hagyja el a saját eredetet. A `fallback` mindig fejlesztői
 * (nem felhasználói) érték: gyökér-relatív útvonalat kell megadni.
 */
export function sanitizeReturnUrl(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }
  const trimmed = value.trim()
  if (trimmed.length === 0 || hasControlCharacter(trimmed)) {
    return fallback
  }
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return fallback
  }
  return trimmed
}
