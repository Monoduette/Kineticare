/**
 * Időpontkérés validáció — kliens és szerver egy fájlban (DOM/Payload-független).
 *
 * Mezők: név + telefon kötelező (visszahívás); e-mail opcionális; `reason`
 * egészségügyi adat lehet, ezért nem kötelező; `availability` CMS-sávok,
 * szerveren csak darab-/hossz-limit; `consentHealth` kötelező (GDPR 9. cikk).
 */

/** A beküldési sorok mezőnevei — a kliens és a szerver EGY forrásból veszi. */
export const APPOINTMENT_NAME_FIELD = 'name'
export const APPOINTMENT_PHONE_FIELD = 'phone'
export const APPOINTMENT_EMAIL_FIELD = 'email'
export const APPOINTMENT_REASON_FIELD = 'reason'
export const APPOINTMENT_AVAILABILITY_FIELD = 'availability'
export const APPOINTMENT_CONSENT_FIELD = 'consentHealth'

/** Az `availability` sorok elválasztója a beküldésben (egy szöveges mező). */
export const APPOINTMENT_AVAILABILITY_SEPARATOR = ', '

export interface AppointmentFormValues {
  name: string
  phone: string
  /** Nem kötelező tartalék csatorna. */
  email: string
  /** Nem kötelező, EGÉSZSÉGÜGYI ADAT lehet — lásd a modul fejlécét. */
  reason: string
  /** A szerkesztő által megadott sávok feliratai közül a bejelöltek. */
  availability: string[]
  /** Kifejezett hozzájárulás — KÖTELEZŐ, sosem előpipálva. */
  consentHealth: boolean
}

export type AppointmentFormErrors = Partial<Record<keyof AppointmentFormValues, string>>

export const EMPTY_APPOINTMENT_VALUES: AppointmentFormValues = {
  name: '',
  phone: '',
  email: '',
  reason: '',
  availability: [],
  consentHealth: false,
}

/** Ugyanaz az UX-szintű minta, mint a másik két űrlapon (ne mondjanak mást). */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const APPOINTMENT_NAME_MAX_LENGTH = 100
/** RFC 5321 szerinti maximális e-mail-hossz. */
export const APPOINTMENT_EMAIL_MAX_LENGTH = 254
/** A nyers (tagolt) telefonszám felső hossza. */
export const APPOINTMENT_PHONE_MAX_LENGTH = 30
/** E.164: a hívható szám legfeljebb 15 számjegy; a rövid alsó korlát a elgépelés ellen. */
export const APPOINTMENT_PHONE_MIN_DIGITS = 6
export const APPOINTMENT_PHONE_MAX_DIGITS = 15
/** Adattakarékosság: a panasz leírása szándékosan rövid mező. */
export const APPOINTMENT_REASON_MAX_LENGTH = 1000
export const APPOINTMENT_AVAILABILITY_MAX_ITEMS = 6
export const APPOINTMENT_AVAILABILITY_MAX_ITEM_LENGTH = 60

/** Hibaüzenetek — mindegyik megmondja, mit tegyen a látogató. */
export const APPOINTMENT_NAME_REQUIRED_ERROR = 'Add meg a neved, hogy tudjuk, kit hívjunk vissza.'
export const APPOINTMENT_NAME_TOO_LONG_ERROR = `A név legfeljebb ${APPOINTMENT_NAME_MAX_LENGTH} karakter lehet.`
export const APPOINTMENT_PHONE_REQUIRED_ERROR =
  'Add meg a telefonszámod: ezen a számon egyeztetjük a pontos időpontot.'
export const APPOINTMENT_PHONE_FORMAT_ERROR =
  'Ellenőrizd a telefonszámot. Legalább 6, legfeljebb 15 számjegy kell bele (pl. +36 30 123 4567).'
export const APPOINTMENT_EMAIL_FORMAT_ERROR =
  'Érvényes e-mail-címet adj meg (pl. nev@pelda.hu), vagy hagyd üresen.'
export const APPOINTMENT_EMAIL_TOO_LONG_ERROR = 'Ez az e-mail-cím túl hosszú.'
export const APPOINTMENT_REASON_TOO_LONG_ERROR = `A leírás legfeljebb ${APPOINTMENT_REASON_MAX_LENGTH} karakter lehet. A többit elmondhatod a telefonos egyeztetésen.`
export const APPOINTMENT_AVAILABILITY_INVALID_ERROR =
  'Az időpont-sávokat nem tudtuk értelmezni. Jelöld be újra a felkínált lehetőségek közül, amelyik megfelel.'
/** §2.7: cselekvést mond, nem udvariaskodik; szó szerint azonos a másik két
 *  űrlap hozzájárulás-hibájával (WCAG 2.2 SC 3.2.4). */
export const APPOINTMENT_CONSENT_ERROR = 'Pipáld be az adatkezelési hozzájárulást.'

/**
 * Rögzített űrlap-chrome (feliratok, gombok, siker-nézet). A tartalom adminból
 * jön; ezek a szövegek tesztelhetők és nem szerkeszthetők. „Nem kötelező" és
 * „ez nem foglalás" szándékos.
 */
export const APPOINTMENT_UI_TEXT = {
  nameLabel: 'Neved',
  phoneLabel: 'Telefonszám',
  phoneHint: 'Ezen a számon egyeztetjük a pontos időpontot.',
  emailLabel: 'E-mail-cím (nem kötelező)',
  emailHint: 'Ide küldünk visszaigazolást, ha telefonon nem érünk el.',
  reasonLabel: 'Mire kérsz időpontot? (nem kötelező)',
  reasonHint:
    'Elég néhány szó, például „gépelés közben fáj a jobb csuklóm". A részleteket telefonon is átbeszéljük.',
  availabilityLegend: 'Mikor alkalmas neked? (nem kötelező)',
  availabilityHint:
    'Jelöld be az összeset, ami megfelel. Ez nem foglalás: a pontos időpontot telefonon egyeztetjük.',
  submitLabel: 'Időpontot kérek',
  submitPending: 'Küldés…',
  errorSummary: 'Néhány mező kitöltése hiányzik vagy javításra vár. Nézd át a megjelölt mezőket, és küldd el újra.',
  successTitle: 'Megkaptuk az időpontkérésed',
  successBody:
    'Két munkanapon belül telefonon keresünk, és egyeztetjük a pontos időpontot. Ha közben megváltozna valami, hívj minket nyugodtan.',
  successPhoneLead: 'Ha sürgős, hívj minket:',
} as const

/** A név ellenőrzése; `null` = rendben. */
function nameError(rawName: string): string | null {
  const name = rawName.trim()
  if (name.length === 0) {
    return APPOINTMENT_NAME_REQUIRED_ERROR
  }
  if (name.length > APPOINTMENT_NAME_MAX_LENGTH) {
    return APPOINTMENT_NAME_TOO_LONG_ERROR
  }
  return null
}

/**
 * A telefonszám ellenőrzése. A tagolást (szóköz, kötőjel, zárójel, `+`)
 * SZÁNDÉKOSAN megengedjük: a magyar számot mindenki tagoltan írja, és a
 * felesleges szigor itt csak hibaüzenetet szülne. A számjegyek darabszáma
 * dönt (E.164 felső korlát), a `tel:` linket a `telHref` építi.
 */
function phoneError(rawPhone: string): string | null {
  const phone = rawPhone.trim()
  if (phone.length === 0) {
    return APPOINTMENT_PHONE_REQUIRED_ERROR
  }
  if (phone.length > APPOINTMENT_PHONE_MAX_LENGTH) {
    return APPOINTMENT_PHONE_FORMAT_ERROR
  }
  const digits = phone.replace(/\D/g, '')
  if (
    digits.length < APPOINTMENT_PHONE_MIN_DIGITS ||
    digits.length > APPOINTMENT_PHONE_MAX_DIGITS
  ) {
    return APPOINTMENT_PHONE_FORMAT_ERROR
  }
  return null
}

/** A NEM KÖTELEZŐ e-mail-cím ellenőrzése: üresen mindig rendben van. */
function emailError(rawEmail: string): string | null {
  const email = rawEmail.trim()
  if (email.length === 0) {
    return null
  }
  if (email.length > APPOINTMENT_EMAIL_MAX_LENGTH) {
    return APPOINTMENT_EMAIL_TOO_LONG_ERROR
  }
  if (!EMAIL_PATTERN.test(email)) {
    return APPOINTMENT_EMAIL_FORMAT_ERROR
  }
  return null
}

/** A NEM KÖTELEZŐ panasz-leírás ellenőrzése: csak a felső hossz számít. */
function reasonError(rawReason: string): string | null {
  if (rawReason.trim().length > APPOINTMENT_REASON_MAX_LENGTH) {
    return APPOINTMENT_REASON_TOO_LONG_ERROR
  }
  return null
}

/** Az időpont-sávok ellenőrzése darabszámra és soronkénti hosszra. */
function availabilityError(items: readonly string[]): string | null {
  if (items.length > APPOINTMENT_AVAILABILITY_MAX_ITEMS) {
    return APPOINTMENT_AVAILABILITY_INVALID_ERROR
  }
  if (items.some((item) => item.trim().length > APPOINTMENT_AVAILABILITY_MAX_ITEM_LENGTH)) {
    return APPOINTMENT_AVAILABILITY_INVALID_ERROR
  }
  return null
}

/** KLIENS-oldali alak: az űrlap állapota → mezőnkénti magyar hibaüzenet. */
export function validateAppointmentForm(values: AppointmentFormValues): AppointmentFormErrors {
  const errors: AppointmentFormErrors = {}

  const name = nameError(values.name)
  if (name) {
    errors.name = name
  }

  const phone = phoneError(values.phone)
  if (phone) {
    errors.phone = phone
  }

  const email = emailError(values.email)
  if (email) {
    errors.email = email
  }

  const reason = reasonError(values.reason)
  if (reason) {
    errors.reason = reason
  }

  const availability = availabilityError(values.availability)
  if (availability) {
    errors.availability = availability
  }

  // Kifejezett hozzájárulás (GDPR 9. cikk (2) a)): nem előpipált checkbox,
  // enélkül a beküldés a kliensen ÉS a szerveren is blokkolva van.
  if (!values.consentHealth) {
    errors.consentHealth = APPOINTMENT_CONSENT_ERROR
  }

  return errors
}

export function isAppointmentFormValid(errors: AppointmentFormErrors): boolean {
  return Object.keys(errors).length === 0
}

/**
 * SZERVER-oldali alak: a form-builder `submissionData` sorai
 * (`{ field, value }`) → magyar hibaüzenetek listája; üres tömb = érvényes.
 *
 * Miért kell a kliens mellé: a `POST /api/form-submissions` NYILVÁNOS végpont,
 * és a plugin a sorokat ellenőrzés nélkül tárolja — kliens nélkül közvetlen
 * REST-hívással hozzájárulás NÉLKÜLI, egészségügyi adatot tartalmazó beküldés
 * mentődhetne (GDPR-kockázat). Ugyanaz a szerkezet, mint a
 * `validateNewsletterSubmissionData`-é.
 */
export function validateAppointmentSubmissionData(submissionData: unknown): string[] {
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

  const name = nameError(fieldValue(APPOINTMENT_NAME_FIELD))
  if (name) {
    errors.push(name)
  }

  const phone = phoneError(fieldValue(APPOINTMENT_PHONE_FIELD))
  if (phone) {
    errors.push(phone)
  }

  const email = emailError(fieldValue(APPOINTMENT_EMAIL_FIELD))
  if (email) {
    errors.push(email)
  }

  const reason = reasonError(fieldValue(APPOINTMENT_REASON_FIELD))
  if (reason) {
    errors.push(reason)
  }

  const rawAvailability = fieldValue(APPOINTMENT_AVAILABILITY_FIELD)
  const availability = availabilityError(
    rawAvailability.length === 0 ? [] : rawAvailability.split(APPOINTMENT_AVAILABILITY_SEPARATOR),
  )
  if (availability) {
    errors.push(availability)
  }

  if (fieldValue(APPOINTMENT_CONSENT_FIELD) !== 'true') {
    errors.push(APPOINTMENT_CONSENT_ERROR)
  }

  return errors
}
