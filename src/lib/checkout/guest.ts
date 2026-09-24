/**
 * Vendég-vásárlás — a vásárló AZONOSÍTÓ adatainak (e-mail + név) szerződése.
 *
 * A modul — a `./billing.ts` mintájára — SZÁNDÉKOSAN függőségmentes (nincs
 * benne payload-, next- vagy react-import), mert két, egymástól független
 * helyen fut le:
 *  - a /penztar űrlapján (kliens-bundle), hogy a beküldés hiányos adattal el se
 *    induljon, magyar, mezőhöz kötött hibaüzenettel;
 *  - a POST /api/checkout/start szolgáltatásában — mert a kliens MEGKERÜLHETŐ,
 *    így a szabály a szerveren KÖTELEZŐEN újra lefut.
 *
 * MIÉRT KÖTELEZŐ MINDKÉT MEZŐ: a vendég-vásárlásnál ez az EGYETLEN kapocs a
 * fizetés és a vevő között. Az e-mail-címre megy a visszaigazoló levél és a
 * jelszó-beállító link, és a fizetés UTÁN ebből dől el, melyik fiók kapja a
 * kurzust (src/lib/order-status/resolve-order-customer.ts). Rossz vagy hiányzó
 * cím = fizetés lement, hozzáférés sehol. A név a fiók `name` mezőjét és a
 * levél megszólítását adja.
 *
 * FONTOS HATÁRVONAL: ez NEM a számlázási név helyett van. A számlára a
 * `billing` blokk kerül (az lehet cégnév is), a `guest.name` a FIÓK neve.
 */

import { normalizeText } from './billing'

/** A pénztárból érkező, nyers vendég-adatok (a hálózati törzs alakja). */
export interface CheckoutGuestInput {
  email: string
  name: string
}

/** A validált, normalizált vendég-adatok — ezekkel jön létre a fiók. */
export interface NormalizedGuest {
  /**
   * Kisbetűsített, trimmelt cím. A Payload a users.email mezőt is így tárolja
   * (auth/baseFields/email.js beforeChange), tehát a keresés és a létrehozás
   * ugyanazon az alakon dolgozik.
   */
  email: string
  name: string
}

export type GuestFieldName = 'email' | 'name'
export type GuestErrorKind = 'missing' | 'tooLong' | 'invalid'

/** Egy mezőhöz kötött, MAGYAR hibaüzenet (a `Field` `error` propjára illeszkedik). */
export interface GuestFieldError {
  field: GuestFieldName
  kind: GuestErrorKind
  message: string
}

export type GuestValidationResult =
  { ok: true; value: NormalizedGuest } | { ok: false; errors: GuestFieldError[] }

/**
 * Hosszkorlátok. A 254 karakteres e-mail-plafon az RFC 5321 szerinti teljes
 * címhossz; a név alsó korlátja elgépelés-szűrő, a felső épesz-határ (a
 * `BILLING_LIMITS.name` értékeivel egyezik).
 */
export const GUEST_LIMITS = {
  name: { min: 2, max: 200 },
  email: { max: 254 },
} as const

/** A mezők megjelenítési (és hiba-)sorrendje — a pénztár űrlapjával egyezik. */
export const GUEST_FIELD_ORDER: readonly GuestFieldName[] = ['email', 'name']

/**
 * Az e-mail alaki ellenőrzése a PAYLOAD SAJÁT mintájával
 * (payload/dist/fields/validations.js `emailRegex`).
 *
 * MIÉRT PONT EZ, és miért nem a repó megengedőbb import-mintája
 * (`src/lib/customer-import/parse.ts` EMAIL_PATTERN): amit itt elfogadunk, azt
 * a fizetés UTÁN a `payload.create({ collection: 'users' })`-nek is el kell
 * fogadnia. Ha a checkout átengedne egy címet, amit a Payload validációja
 * visszautasít, a vevő kifizetné a kurzust, a fiókja viszont sosem jönne létre
 * — pontosan az a néma, pénzt érintő hiba, amit el akarunk kerülni. A két
 * oldalnak tehát UGYANAZ a szabálya, és a szigorúbb a mérvadó.
 */
const EMAIL_PATTERN =
  /^(?!.*\.\.)[\w!#$%&'*+/=?^`{|}~-](?:[\w!#$%&'*+/=?^`{|}~.-]*[\w!#$%&'*+/=?^`{|}~-])?@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i

export const GUEST_EMAIL_MISSING_ERROR =
  'Add meg az e-mail-címed. Ide küldjük a hozzáférést és a számlát.'
export const GUEST_EMAIL_INVALID_ERROR =
  'Ez az e-mail-cím nem érvényes. Ellenőrizd (például: nev@pelda.hu).'
export const GUEST_EMAIL_TOO_LONG_ERROR = `Az e-mail-cím legfeljebb ${GUEST_LIMITS.email.max} karakter lehet.`
export const GUEST_NAME_MISSING_ERROR = 'Add meg a neved (legalább 2 karakter).'
export const GUEST_NAME_TOO_LONG_ERROR = `A név legfeljebb ${GUEST_LIMITS.name.max} karakter lehet.`

/** Összefoglaló üzenet — a `guestSummaryMessage` a hibahalmazból választ. */
export const GUEST_SUMMARY_MISSING =
  'A vásárláshoz add meg az e-mail-címed és a neved, ezekkel hozzuk létre a fiókodat.'
export const GUEST_SUMMARY_MIXED = 'Ellenőrizd a pirossal jelölt mezőket.'

function sourceRecord(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {}
}

/**
 * A vendég-adatok ellenőrzése és normalizálása. A bemenet szándékosan
 * `unknown`: a szerver oldalon tetszőleges JSON-törzs érkezhet.
 */
export function validateGuest(input: unknown): GuestValidationResult {
  const source = sourceRecord(input)
  const errors: GuestFieldError[] = []

  // A normalizálás a láthatatlan (zero-width) karaktereket is kiszedi — enélkül
  // egy csupa-zero-width „cím" átmenne a kötelezőségi szűrőn.
  const email = normalizeText(source.email).toLowerCase()
  if (email.length === 0) {
    errors.push({ field: 'email', kind: 'missing', message: GUEST_EMAIL_MISSING_ERROR })
  } else if (email.length > GUEST_LIMITS.email.max) {
    errors.push({ field: 'email', kind: 'tooLong', message: GUEST_EMAIL_TOO_LONG_ERROR })
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.push({ field: 'email', kind: 'invalid', message: GUEST_EMAIL_INVALID_ERROR })
  }

  const name = normalizeText(source.name)
  if (name.length < GUEST_LIMITS.name.min) {
    errors.push({ field: 'name', kind: 'missing', message: GUEST_NAME_MISSING_ERROR })
  } else if (name.length > GUEST_LIMITS.name.max) {
    errors.push({ field: 'name', kind: 'tooLong', message: GUEST_NAME_TOO_LONG_ERROR })
  }

  if (errors.length > 0) {
    // A hibák a megjelenítési sorrendben menjenek vissza — a hívó az ELSŐ
    // hibás mezőre viszi a fókuszt.
    errors.sort(
      (left, right) =>
        GUEST_FIELD_ORDER.indexOf(left.field) - GUEST_FIELD_ORDER.indexOf(right.field),
    )
    return { ok: false, errors }
  }

  return { ok: true, value: { email, name } }
}

/** A felhasználónak szóló ÖSSZEFOGLALÓ a tényleges hibahalmazból származtatva. */
export function guestSummaryMessage(errors: readonly GuestFieldError[]): string {
  if (errors.length === 0) {
    return ''
  }
  if (errors.length === 1) {
    return errors[0].message
  }
  if (errors.every((item) => item.kind === 'missing')) {
    return GUEST_SUMMARY_MISSING
  }
  return GUEST_SUMMARY_MIXED
}

/** A mezőhöz kötött hibák leképezése mezőnév → üzenet térképre (a Field-ekhez). */
export function guestErrorMap(
  errors: readonly GuestFieldError[],
): Partial<Record<GuestFieldName, string>> {
  const map: Partial<Record<GuestFieldName, string>> = {}
  for (const item of errors) {
    if (map[item.field] === undefined) {
      map[item.field] = item.message
    }
  }
  return map
}
