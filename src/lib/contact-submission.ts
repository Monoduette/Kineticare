/**
 * Kapcsolat-űrlap szerver-oldali validáció (T-016). A form-builder plugin nem
 * ellenőriz — ez az autoritás, ugyanazok a szabályok mint a kliensen. Tiszta
 * modul, Payload-független. Jelenleg egy nyilvános űrlap (Kapcsolat).
 */
export const CONTACT_MESSAGE_MIN_LENGTH = 10

/** A kliensoldali validation.ts EMAIL_PATTERN reguláris kifejezésével azonos. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * A beküldés submissionData sorainak kötelező-mező- és consent-ellenőrzése.
 *
 * A bemenet szándékosan `unknown`: a nyilvános végponton bármi érkezhet,
 * a nem-string értékeket és a hiányzó sorokat egyaránt „üres"-ként kezeljük.
 * A consentPrivacy a kliens-szerződés szerint „true"/„false" STRINGKént
 * érkezik — kizárólag a „true" fogadható el.
 *
 * @returns magyar hibaüzenetek listája; üres tömb = érvényes beküldés.
 */
export function validateContactSubmissionData(submissionData: unknown): string[] {
  const entries: unknown[] = Array.isArray(submissionData) ? submissionData : []
  const fieldValue = (name: string): string => {
    const entry = entries.find(
      (raw) =>
        typeof raw === 'object' &&
        raw !== null &&
        (raw as Record<string, unknown>).field === name,
    )
    const value =
      typeof entry === 'object' && entry !== null
        ? (entry as Record<string, unknown>).value
        : undefined
    return typeof value === 'string' ? value.trim() : ''
  }

  const errors: string[] = []

  if (fieldValue('name').length === 0) {
    errors.push('Add meg a neved.')
  }

  const email = fieldValue('email')
  if (email.length === 0) {
    errors.push('Add meg az e-mail-címed.')
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.push('Érvényes e-mail-címet adj meg (pl. nev@pelda.hu).')
  }

  if (fieldValue('subject').length === 0) {
    errors.push('Add meg az üzenet tárgyát.')
  }

  const message = fieldValue('message')
  if (message.length === 0) {
    errors.push('Írd meg az üzeneted.')
  } else if (message.length < CONTACT_MESSAGE_MIN_LENGTH) {
    errors.push(`Az üzenet legyen legalább ${CONTACT_MESSAGE_MIN_LENGTH} karakter hosszú.`)
  }

  // Jogtiszta hozzájárulás: a szerveren is kötelező — különben közvetlen
  // REST-hívással mentődne consent nélküli személyes adat (GDPR-kockázat).
  if (fieldValue('consentPrivacy') !== 'true') {
    // Szó szerint AZONOS a kliens-oldali és a másik három űrlap mondatával
    // (WCAG 2.2 SC 3.2.4, konzisztens azonosítás) — a review-kör találata
    // szerint korábban a kliens és a szerver mást mondott ugyanarra a hibára.
    errors.push('Pipáld be az adatkezelési hozzájárulást.')
  }

  return errors
}
