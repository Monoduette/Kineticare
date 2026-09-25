/**
 * Elállási funkció (45/2014. Korm. rendelet 22. § (1a)–(1c)): az űrlap
 * VALIDÁCIÓJA, kliens- és szerveroldalon ugyanazzal a szabállyal (az
 * ingyenes kurzus és a hírlevél űrlapjának mintájára, egy tiszta modulban).
 *
 * A rendelet (1a) pontja szerint az elállási funkcióban a fogyasztó a nevét,
 * a szerződést azonosító adatokat és annak az elektronikus elérhetőségnek az
 * adatait adja meg, amelyre az elállás megerősítését kéri. Ennél többet nem
 * kérünk: a Nemzeti Kereskedelmi és Fogyasztóvédelmi Hatóság gyakorlati
 * tájékoztatója (2026. 07. 17., „Elállási funkció: gyakorlati tudnivalók
 * webáruházak részére”, nkfh.gov.hu) szerint a funkció nem köthető előzetes
 * bejelentkezéshez, és nem lehet elrejtve. Adatkezelési hozzájárulást sem
 * kérünk: a nyilatkozat fogadása jogi kötelezettség (GDPR 6. cikk (1) c)),
 * egy kötelező jelölőnégyzet csak akadály lenne az elállás útjában.
 *
 * A rendelésszám szabad szöveg: aki nem találja a számot, a vásárlás napját
 * és a kurzus nevét írhatja ide. A nyilatkozatot formai okból (pl. elírt
 * rendelésszám) nem utasítjuk el, a munkatárs azonosítja a rendelést.
 */

export interface WithdrawalFormValues {
  name: string
  orderReference: string
  email: string
}

export type WithdrawalFormErrors = Partial<Record<keyof WithdrawalFormValues, string>>

export const EMPTY_WITHDRAWAL_VALUES: WithdrawalFormValues = {
  name: '',
  orderReference: '',
  email: '',
}

/** Ugyanaz a UX-szintű minta, mint a többi nyilvános űrlapon (kapcsolat, hírlevél, ingyenes kurzus). */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const WITHDRAWAL_NAME_MAX_LENGTH = 120
export const WITHDRAWAL_ORDER_MAX_LENGTH = 200
/** RFC 5321: a teljes cím legfeljebb 254 karakter. */
export const WITHDRAWAL_EMAIL_MAX_LENGTH = 254

export const WITHDRAWAL_NAME_REQUIRED_ERROR = 'Add meg a neved.'
export const WITHDRAWAL_NAME_TOO_LONG_ERROR = 'Ez a név túl hosszú.'
export const WITHDRAWAL_ORDER_REQUIRED_ERROR =
  'Add meg a rendelésszámot, vagy ha nincs meg, a vásárlás napját és a kurzus nevét.'
export const WITHDRAWAL_ORDER_TOO_LONG_ERROR = 'Ez a szöveg túl hosszú, írd röviden.'
export const WITHDRAWAL_EMAIL_REQUIRED_ERROR = 'Add meg az e-mail-címed.'
export const WITHDRAWAL_EMAIL_FORMAT_ERROR = 'Érvényes e-mail-címet adj meg (pl. nev@pelda.hu).'
export const WITHDRAWAL_EMAIL_TOO_LONG_ERROR = 'Ez az e-mail-cím túl hosszú.'

/** A vezérlőkarakterek (sortörés is) szóközzé válnak: a mezők egysorosak, és levélbe, naplóba kerülnek. */
function clean(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim()
}

function nameError(raw: string): string | null {
  const name = clean(raw)
  if (name.length === 0) return WITHDRAWAL_NAME_REQUIRED_ERROR
  if (name.length > WITHDRAWAL_NAME_MAX_LENGTH) return WITHDRAWAL_NAME_TOO_LONG_ERROR
  return null
}

function orderError(raw: string): string | null {
  const reference = clean(raw)
  if (reference.length === 0) return WITHDRAWAL_ORDER_REQUIRED_ERROR
  if (reference.length > WITHDRAWAL_ORDER_MAX_LENGTH) return WITHDRAWAL_ORDER_TOO_LONG_ERROR
  return null
}

function emailError(raw: string): string | null {
  const email = clean(raw)
  if (email.length === 0) return WITHDRAWAL_EMAIL_REQUIRED_ERROR
  if (email.length > WITHDRAWAL_EMAIL_MAX_LENGTH) return WITHDRAWAL_EMAIL_TOO_LONG_ERROR
  if (!EMAIL_PATTERN.test(email)) return WITHDRAWAL_EMAIL_FORMAT_ERROR
  return null
}

/** Mezőnkénti magyar hibaüzenetek; üres objektum = rendben. */
export function validateWithdrawalForm(values: WithdrawalFormValues): WithdrawalFormErrors {
  const errors: WithdrawalFormErrors = {}
  const name = nameError(values.name)
  if (name) errors.name = name
  const order = orderError(values.orderReference)
  if (order) errors.orderReference = order
  const email = emailError(values.email)
  if (email) errors.email = email
  return errors
}

/** A szerveroldali, normalizált beküldés. */
export interface WithdrawalRequestBody {
  name: string
  orderReference: string
  email: string
  /** Cloudflare Turnstile token; hiányozhat, ha a szerveren nincs secret. */
  turnstileToken: string | null
  /** Honeypot mező: emberi látogató sosem tölti ki. */
  honeypot: string
}

export type WithdrawalBodyResult =
  { ok: true; body: WithdrawalRequestBody } | { ok: false; errors: string[] }

function readString(value: unknown): string {
  return typeof value === 'string' ? clean(value) : ''
}

/** A nyers JSON-törzs ellenőrzése és normalizálása (a mezők vágva, vezérlőkarakter nélkül). */
export function parseWithdrawalRequestBody(raw: unknown): WithdrawalBodyResult {
  const record =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  const values: WithdrawalFormValues = {
    name: readString(record.name),
    orderReference: readString(record.orderReference),
    email: readString(record.email),
  }
  const errors = validateWithdrawalForm(values)
  const messages = [errors.name, errors.orderReference, errors.email].filter(
    (message): message is string => typeof message === 'string',
  )
  if (messages.length > 0) {
    return { ok: false, errors: messages }
  }
  const token = typeof record.turnstileToken === 'string' ? record.turnstileToken.trim() : ''
  return {
    ok: true,
    body: {
      ...values,
      turnstileToken: token.length > 0 ? token : null,
      honeypot: readString(record.website),
    },
  }
}

/**
 * A rendelésszám a mintája szerint (KH-<év>-<6 jegy>, src/lib/order-number.ts),
 * kis- és nagybetűtől, szóközöktől függetlenül. `null`, ha a szöveg nem
 * rendelésszám (például a vásárlás napja és a kurzus neve).
 */
export function normalizeOrderNumber(reference: string): string | null {
  const compact = reference.replace(/\s+/g, '').toUpperCase()
  return /^KH-\d{4}-\d{6}$/.test(compact) ? compact : null
}
