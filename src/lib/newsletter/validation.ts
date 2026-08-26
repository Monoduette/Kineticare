/**
 * Hírlevél validáció — kliens és szerver egy fájlban. Mezők: email + consentNewsletter.
 */

export interface NewsletterFormValues {
  email: string
  /** Hírlevél-hozzájárulás — KÖTELEZŐ, alapértelmezetten false. */
  consentNewsletter: boolean
}

export type NewsletterFormErrors = Partial<Record<keyof NewsletterFormValues, string>>

export const EMPTY_NEWSLETTER_VALUES: NewsletterFormValues = {
  email: '',
  consentNewsletter: false,
}

/** A beküldési sorok mezőnevei — a kliens és a szerver EGY forrásból veszi. */
export const NEWSLETTER_EMAIL_FIELD = 'email'
export const NEWSLETTER_CONSENT_FIELD = 'consentNewsletter'

/**
 * Ugyanaz a szándékosan szigorú, UX-szintű minta, mint a kapcsolat-űrlapon
 * (src/app/(frontend)/kapcsolat/_lib/validation.ts) — a két űrlap ne mondjon
 * mást ugyanarra a címre.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** RFC 5321 szerinti maximális e-mail-hossz — a felső korlát a szemétadat ellen. */
export const NEWSLETTER_EMAIL_MAX_LENGTH = 254

export const NEWSLETTER_EMAIL_REQUIRED_ERROR = 'Add meg az e-mail-címed.'
export const NEWSLETTER_EMAIL_FORMAT_ERROR = 'Érvényes e-mail-címet adj meg (pl. nev@pelda.hu).'
export const NEWSLETTER_EMAIL_TOO_LONG_ERROR = 'Ez az e-mail-cím túl hosszú.'
/**
 * §2.7 (GOV.UK): mondja meg, MIT KELL TENNI. A korábbi „kérjük a
 * hozzájárulásod" udvariaskodott, és nem mutatott cselekvést. A szöveg
 * SZÓ SZERINT azonos a `free-course/validation.ts` hozzájárulás-hibájával:
 * ugyanaz a cselekvés = ugyanaz a szöveg (WCAG 2.2 SC 3.2.4).
 */
export const NEWSLETTER_CONSENT_ERROR = 'Pipáld be az adatkezelési hozzájárulást.'

/** Az e-mail-cím ellenőrzése; `null` = rendben. */
function emailError(rawEmail: string): string | null {
  const email = rawEmail.trim()
  if (email.length === 0) {
    return NEWSLETTER_EMAIL_REQUIRED_ERROR
  }
  if (email.length > NEWSLETTER_EMAIL_MAX_LENGTH) {
    return NEWSLETTER_EMAIL_TOO_LONG_ERROR
  }
  if (!EMAIL_PATTERN.test(email)) {
    return NEWSLETTER_EMAIL_FORMAT_ERROR
  }
  return null
}

/** KLIENS-oldali alak: a lábléc-űrlap állapota → mezőnkénti magyar hibaüzenet. */
export function validateNewsletterForm(values: NewsletterFormValues): NewsletterFormErrors {
  const errors: NewsletterFormErrors = {}

  const email = emailError(values.email)
  if (email) {
    errors.email = email
  }

  // Jogtiszta hozzájárulás: nem előpipált, explicit checkbox — enélkül a
  // beküldés kliensoldalon blokkolva van (a szerveren is, lásd lentebb).
  if (!values.consentNewsletter) {
    errors.consentNewsletter = NEWSLETTER_CONSENT_ERROR
  }

  return errors
}

export function isNewsletterFormValid(errors: NewsletterFormErrors): boolean {
  return Object.keys(errors).length === 0
}

/**
 * SZERVER-oldali alak: a form-builder `submissionData` sorai
 * (`{ field, value }`) → magyar hibaüzenetek listája; üres tömb = érvényes.
 *
 * Miért kell a kliens mellé: a `POST /api/form-submissions` NYILVÁNOS végpont,
 * és a plugin a sorokat ellenőrzés nélkül tárolja — kliens nélkül közvetlen
 * REST-hívással hozzájárulás NÉLKÜLI feliratkozás mentődne (GDPR-kockázat).
 *
 * A bemenet szándékosan `unknown`: a végponton bármi érkezhet. A hozzájárulás a
 * kliens-szerződés szerint „true"/„false" STRINGként jön — csak a „true" jó.
 */
export function validateNewsletterSubmissionData(submissionData: unknown): string[] {
  const entries: unknown[] = Array.isArray(submissionData) ? submissionData : []
  const fieldValue = (name: string): string => {
    const entry = entries.find(
      (raw) =>
        typeof raw === 'object' && raw !== null && (raw as Record<string, unknown>).field === name,
    )
    const value =
      typeof entry === 'object' && entry !== null
        ? (entry as Record<string, unknown>).value
        : undefined
    return typeof value === 'string' ? value.trim() : ''
  }

  const errors: string[] = []

  const email = emailError(fieldValue(NEWSLETTER_EMAIL_FIELD))
  if (email) {
    errors.push(email)
  }

  if (fieldValue(NEWSLETTER_CONSENT_FIELD) !== 'true') {
    errors.push(NEWSLETTER_CONSENT_ERROR)
  }

  return errors
}
