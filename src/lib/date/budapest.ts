/**
 * Europe/Budapest naptári dátum (YYYY-MM-DD) — ne UTC slice (hófordulón elcsúszik).
 */

/** A Számla Agent dátummezőinek és a statisztika-tartalék dátumának alakja. */
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** Hónaphosszak (a február a szökőév-szabályból jön). */
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** Proleptikus Gergely-naptár (ISO 8601) szökőév-szabálya. */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28
  }
  return MONTH_LENGTHS[month - 1] ?? 0
}

/**
 * A megadott pillanat naptári napja Europe/Budapest zónában, YYYY-MM-DD.
 *
 * FIGYELEM: érvénytelen `Date`-re (`new Date('x')`) az `Intl` `RangeError`-t
 * dob — ez a szerződése, a hívók valós pillanattal hívják (a Számla Agent
 * kelt-dátuma az alapértelmezett `new Date()`-ből jön). Ahol a bemenet
 * bizonytalan, a `budapestMonthKey` a kapu: az `null`-t ad, nem dob.
 */
export function budapestDateString(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Budapest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/**
 * Érvényes YYYY-MM-DD — alak és naptár (lehetetlen hónap/nap elbukik; statisztika + számla).
 */
export function isIsoDateString(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value)
  if (match === null) {
    return false
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12) {
    return false
  }
  return day >= 1 && day <= daysInMonth(year, month)
}

/**
 * YYYY-MM hónap-kulcs Budapest szerint. Érvénytelen dátumnál `null`.
 *
 * Az érvénytelen `Date` kiszűrése NEM elhagyható: az `Intl.DateTimeFormat`
 * ilyenkor `RangeError`-t dob, és a hívó (`listMonthKeys`) ezt közvetlenül a
 * statisztika-nézet renderelése közben kapná meg — egy elrontott `now` így az
 * egész admin-nézetet 500-azná ahelyett, hogy üres ablakot adna.
 */
export function budapestMonthKey(now: Date): string | null {
  if (Number.isNaN(now.getTime())) {
    return null
  }
  const day = budapestDateString(now)
  return day.length >= 7 ? day.slice(0, 7) : null
}
