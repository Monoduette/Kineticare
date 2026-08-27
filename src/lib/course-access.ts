/**
 * Kurzus-hozzáférés érvényessége — egyetlen igazságforrása (A1). Tiszta modul,
 * nincs DB-függés.
 *
 * `accessDurationDays` hiányzik/0/negatív → korlátlan. Ismeretlen vásárlási
 * dátum → fail-open (korlátlan). Egyébként: lejárat = vásárlás + N×24 óra;
 * `most >= lejárat` → lejárt.
 */
export const MS_PER_DAY = 24 * 60 * 60 * 1000

export type CourseAccessReason =
  /** Nincs korlát a terméken (accessDurationDays hiányzik/0/negatív). */
  | 'unlimited'
  /** Van korlát, de a vásárlás időpontja nem ismert → fail-open. */
  | 'unknown-purchase-date'
  /** Van korlát, a hozzáférés MOST még él. */
  | 'active'
  /** Van korlát, a hozzáférés lejárt. */
  | 'expired'

export interface CourseAccessState {
  /** Hozzáfér-e MOST a felhasználó a kurzushoz. */
  hasAccess: boolean
  /** Mikor jár le a hozzáférés; null = korlátlan (vagy nem meghatározható). */
  expiresAt: Date | null
  /** Az eredmény indoka — naplózáshoz és a felületi üzenet kiválasztásához. */
  reason: CourseAccessReason
}

export interface CourseAccessInput {
  /**
   * A vásárlás (fizetés) időpontja. Az orders sémában NINCS `paidAt` mező,
   * ezért a gyakorlatban a paid rendelés `createdAt` értéke kerül ide
   * (lásd course-access-lookup.ts).
   */
  purchasedAt?: string | Date | null
  /** A termék `accessDurationDays` mezője. Hiányzó/0/negatív → korlátlan. */
  accessDurationDays?: number | null
  /** „Most" — az egységtesztek és a determinisztikus renderelés miatt injektálható. */
  now?: Date
}

/** Elfogadja az ISO-stringet és a Date-et is; érvénytelen érték → null. */
function toDate(value: string | Date | null | undefined): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime())
  }
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }
  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * A hozzáférés-szabály kiértékelése — MINDEN hozzáférési pont ezt hívja.
 * A fenti modul-fejléc szabályait valósítja meg, mellékhatás nélkül.
 */
export function resolveCourseAccess(input: CourseAccessInput): CourseAccessState {
  const days = input.accessDurationDays
  if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0) {
    return { hasAccess: true, expiresAt: null, reason: 'unlimited' }
  }

  const purchasedAt = toDate(input.purchasedAt)
  if (purchasedAt === null) {
    return { hasAccess: true, expiresAt: null, reason: 'unknown-purchase-date' }
  }

  const expiresAt = new Date(purchasedAt.getTime() + days * MS_PER_DAY)
  const now = input.now ?? new Date()
  if (now.getTime() < expiresAt.getTime()) {
    return { hasAccess: true, expiresAt, reason: 'active' }
  }
  return { hasAccess: false, expiresAt, reason: 'expired' }
}

/**
 * Magyar dátumformátum a felületre: „2027. 03. 04.".
 * A megjelenítés Europe/Budapest zónában történik (a tárolt időpont UTC), hogy
 * a vevő azt a napot lássa, amit a saját naptárában is.
 */
const HU_DATE_FORMATTER = new Intl.DateTimeFormat('hu-HU', {
  timeZone: 'Europe/Budapest',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function formatAccessDate(date: Date): string {
  return HU_DATE_FORMATTER.format(date)
}

/** A lejárt hozzáférés felhasználói üzenetének első mondata (felület + API). */
export const ACCESS_EXPIRED_TITLE = 'A hozzáférésed ehhez a kurzushoz lejárt.'

/** Mit tehet a vevő — sürgetés és nyomásgyakorlás nélkül. */
const ACCESS_EXPIRED_HINT = 'Ha szeretnéd folytatni, a kurzus újra megvásárolható.'

/**
 * Empatikus, magyar üzenet a lejárt hozzáférésre — a lejárat napjával, ha
 * ismert. Ugyanez az üzenet megy a felületre és a stream-token 403-as
 * válaszába, hogy a vevő mindenhol ugyanazt olvassa.
 */
export function accessExpiredMessage(expiresAt: Date | null): string {
  if (expiresAt === null) {
    return `${ACCESS_EXPIRED_TITLE} ${ACCESS_EXPIRED_HINT}`
  }
  return `${ACCESS_EXPIRED_TITLE} A hozzáférés ${formatAccessDate(expiresAt)} napján járt le. ${ACCESS_EXPIRED_HINT}`
}

/** „Hozzáférés eddig: 2027. 03. 04." — a kurzusaim-listán; null, ha korlátlan. */
export function accessExpiryLabel(expiresAt: Date | null): string | null {
  return expiresAt === null ? null : `Hozzáférés eddig: ${formatAccessDate(expiresAt)}`
}

/**
 * A lejátszó kapuja: miért nincs videó. A lookup-hiba NEM lejárat
 * (NN/g Error Message Guidelines: ne mondj hamis okot;
 * https://www.nngroup.com/articles/error-message-guidelines/ ;
 * WCAG 2.2 · 3.3.1 Error Identification).
 */
export type PlayerGateKind = 'expired' | 'lookup-failed' | 'grant-pending' | 'not-purchased'

export interface PlayerGate {
  kind: PlayerGateKind
  /** A kapu magyarázó mondata; null = a komponens alapüzenete. */
  message: string | null
}

export const ACCESS_LOOKUP_FAILED_MESSAGE =
  'A hozzáférésed ellenőrzése most nem sikerült. Ez nem azt jelenti, hogy lejárt. Próbáld újra, vagy írj nekünk.'

export const ACCESS_GRANT_PENDING_MESSAGE =
  'A vásárlásod megvan, a hozzáférés még feldolgozás alatt. Próbáld újra egy perc múlva, vagy írj nekünk, ha várakozás után sem nyílik meg.'

export function resolvePlayerGate(input: {
  purchased: boolean
  access: CourseAccessState | null
  hasPaidOrder: boolean
}): { hasAccess: true; gate: null } | { hasAccess: false; gate: PlayerGate } {
  if (input.purchased) {
    if (input.access === null || input.access.hasAccess) {
      return { hasAccess: true, gate: null }
    }
    if (input.access.reason === 'unknown-purchase-date') {
      return {
        hasAccess: false,
        gate: { kind: 'lookup-failed', message: ACCESS_LOOKUP_FAILED_MESSAGE },
      }
    }
    return {
      hasAccess: false,
      gate: { kind: 'expired', message: accessExpiredMessage(input.access.expiresAt) },
    }
  }
  if (input.hasPaidOrder) {
    return {
      hasAccess: false,
      gate: { kind: 'grant-pending', message: ACCESS_GRANT_PENDING_MESSAGE },
    }
  }
  return { hasAccess: false, gate: { kind: 'not-purchased', message: null } }
}

/**
 * A hozzáférés-állapot kliens-komponensbe átadható (szerializálható) alakja:
 * Date helyett kész, magyar szövegek — így a kliens nem formáz dátumot, és a
 * szerver/kliens kimenet definíció szerint azonos.
 */
export interface CourseAccessView {
  hasAccess: boolean
  /** „Hozzáférés eddig: …" — null, ha nincs ismert lejárat. */
  expiryLabel: string | null
  /** Empatikus üzenet lejárt hozzáférésnél — null, ha él a hozzáférés. */
  expiredMessage: string | null
}

export function toCourseAccessView(state: CourseAccessState): CourseAccessView {
  return {
    hasAccess: state.hasAccess,
    expiryLabel: accessExpiryLabel(state.expiresAt),
    expiredMessage: state.hasAccess ? null : accessExpiredMessage(state.expiresAt),
  }
}
