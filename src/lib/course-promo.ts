import type { Product } from '../payload-types'

import { budapestDateString } from './date/budapest'

/**
 * Akciós megjelenés (WP58, 2026-09-20, tulajdonosi kérés).
 *
 * A kurzus admin-lapján a szerkesztő bepipálja, hogy a kurzus AKCIÓS, és
 * megadja, mettől meddig. Az időablakon belül a kurzusoldal az akciós sablont
 * kapja (src/components/courses/promo), azon kívül a rendes kurzusoldalt. A
 * döntés EGY helyen él, itt, tisztán (DB és Next nélkül), hogy a kurzusoldal,
 * a kurzuskártya és az admin állapotjelző ugyanazt mondja (WCAG 2.2 SC 3.2.4,
 * Consistent Identification).
 *
 * Mezők (products, src/plugins/ecommerce.ts, „Akciós megjelenés” csoport):
 * - `promoEnabled`   pipa: akciós megjelenés kérve.
 * - `promoStart`     ISO dátum, opcionális; üresen azonnal kezdődik.
 * - `promoEnd`       ISO dátum, opcionális; üresen nincs vége.
 * - `promoPriceHuf`   az AKCIÓS ár (WP63, tulajdonosi kérés 2026-09-21: „a
 *   dátum lejárta állítsa vissza automatikusan az árat”). Az `Ár` mező a
 *   rendes, teljes ár marad; az időablakban a vevő az akciós árat fizeti, az
 *   ablakon kívül magától a rendes árat. NINCS ütemezett visszaírás: a
 *   fizetendő árat MINDEN olvasó a `coursePriceHuf` (src/lib/courses.ts)
 *   függvényből veszi, ami ezt a feloldót hívja, ezért az oldal, a kártya, a
 *   kosár, a pénztár, a Barion-összeg és a rendelés-snapshot ugyanazt az árat
 *   látja, a lejárat pillanatától kezdve. Ez a WooCommerce „regular price /
 *   sale price with schedule” modellje (https://woocommerce.com/document/managing-products/#sale-price),
 *   és a Shopify „compare at price” szabálya: az áthúzott ár a termék rendes
 *   ára (https://help.shopify.com/en/manual/products/details/product-pricing/sale-pricing).
 *   Az áthúzott (rendes) ár csak akkor jelenik meg, ha NAGYOBB az akciós
 *   árnál (a fogyasztóvédelmi „korábbi ár” szabály és a Baymard ár-megjelenítési
 *   ajánlása szerint csak valódi, magasabb ár húzható át:
 *   https://baymard.com/blog/list-price-discount-display).
 * - `promoOriginalPriceHuf` ÖRÖKSÉG (WP58): az egykori, kézzel beírt áthúzott
 *   ár. A WP63-tól nem olvassa senki; az oszlop a content-job átállító
 *   szabálya (`akcios-ar-atallas`) után külön PR-ben, generált migrációval
 *   szűnik meg.
 *
 * Időkezelés. A Payload a dátumot ISO stringként (UTC pillanat) tárolja. A
 * dayOnly választó MÉRTEN (@payloadcms/ui DatePicker, `setHours(12 - tzOffset)`)
 * a választott nap 12:00 UTC-jét menti, a REST API-n viszont akár `YYYY-MM-DD`
 * (UTC éjfél) is érkezhet. A szerkesztő mindkét esetben NAPOT gondol, ezért a
 * tárolt pillanatot a Europe/Budapest szerinti naptári napjára vetítjük:
 * - kezdet: a nap 00:00-jától (inkluzív), Budapest szerint;
 * - vég: a megadott nap VÉGÉIG, azaz a rákövetkező nap 00:00-jáig (exkluzív),
 *   Budapest szerint. Ezt a `promoEnd` mező leírása is így mondja.
 */

export interface CoursePromo {
  /** Igaz, ha a pipa be van kapcsolva ÉS a `now` az időablakban van. */
  active: boolean
  /** A szerkesztő által kért állapot (pipa), az időablaktól függetlenül. */
  enabled: boolean
  /** Az akció kezdete (a kezdőnap 00:00-ja Budapest szerint, UTC pillanat) vagy null. */
  start: Date | null
  /** Az akció végének KIZÁRÓ pillanata (a megadott nap utáni 00:00 Budapest szerint) vagy null. */
  end: Date | null
  /** A kurzus rendes (teljes) ára: az `Ár` mező, ha érvényes és pozitív. */
  regularPriceHuf: number | null
  /** Az akciós ár, ha érvényes, pozitív és KISEBB a rendes árnál; különben null. */
  promoPriceHuf: number | null
  /**
   * A MOST fizetendő ár: élő akcióban az akciós ár (ha van), különben a
   * rendes ár. Ezt tükrözi `coursePriceHuf` (src/lib/courses.ts).
   */
  priceHuf: number | null
  /**
   * Az áthúzva mutatandó rendes ár: csak élő akcióban, és csak ha az akciós
   * ár tényleg kisebb nála; különben null (nincs áthúzott ár).
   */
  originalPriceHuf: number | null
  /** Miért nem él: 'kikapcsolva' | 'meg-nem-kezdodott' | 'lejart' | null (ha él). */
  reason: 'kikapcsolva' | 'meg-nem-kezdodott' | 'lejart' | null
}

export type CoursePromoFields = Pick<
  Product,
  'promoEnabled' | 'promoStart' | 'promoEnd' | 'promoPriceHuf'
>

/** A feloldó bemenete: az akció mezői + a rendes ár mezői. */
export type CoursePromoPriceFields = CoursePromoFields &
  Pick<Product, 'priceInHUF' | 'priceInHUFEnabled'>

function positiveIntegerOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null
}

const DAY_MS = 24 * 60 * 60 * 1000

const BUDAPEST_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Budapest',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

function parseDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value !== 'string' || value.length === 0) {
    return null
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** A pillanat budapesti falióra-ideje UTC-számként (az eltolás kiszámításához). */
function budapestWallClockAsUtc(instant: Date): number {
  const parts: Record<string, number> = {}
  for (const part of BUDAPEST_PARTS.formatToParts(instant)) {
    if (part.type !== 'literal') {
      parts[part.type] = Number(part.value)
    }
  }
  return Date.UTC(
    parts.year ?? 1970,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  )
}

/**
 * A megadott pillanat Europe/Budapest szerinti naptári napjának 00:00-ja
 * (UTC pillanatként), `dayOffset` nappal eltolva. Az óraátállítás soha nem
 * éjfélkor van, ezért az eltolás egyetlen visszaellenőrzéssel pontos.
 */
function budapestDayStart(instant: Date, dayOffset: number): Date {
  const [year, month, day] = budapestDateString(instant).split('-').map(Number)
  const wallMidnight = Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + dayOffset)
  let guess = wallMidnight
  for (let i = 0; i < 2; i += 1) {
    const offset = budapestWallClockAsUtc(new Date(guess)) - guess
    guess = wallMidnight - offset
  }
  return new Date(guess)
}

/** A kezdet INKLUZÍV pillanata: a tárolt nap 00:00-ja Budapest szerint. */
export function promoStartInclusive(value: unknown): Date | null {
  const start = parseDate(value)
  return start === null ? null : budapestDayStart(start, 0)
}

/** A vég dátum KIZÁRÓ pillanata: a megadott nap utáni éjfél Budapest szerint (a nap végéig él). */
export function promoEndExclusive(value: unknown): Date | null {
  const end = parseDate(value)
  return end === null ? null : budapestDayStart(end, 1)
}

export function resolveCoursePromo(
  product: CoursePromoPriceFields,
  now: Date = new Date(),
): CoursePromo {
  const enabled = product.promoEnabled === true
  const start = promoStartInclusive(product.promoStart)
  const end = promoEndExclusive(product.promoEnd)
  const regularPriceHuf =
    product.priceInHUFEnabled === true ? positiveIntegerOrNull(product.priceInHUF) : null
  const promoCandidate = positiveIntegerOrNull(product.promoPriceHuf)
  // Az akciós ár csak akkor ár, ha a rendes árnál KISEBB: egyenlő vagy
  // nagyobb „akció” a vevőnek nem kedvezmény, az áthúzás félrevezető lenne.
  const promoPriceHuf =
    promoCandidate !== null && regularPriceHuf !== null && promoCandidate < regularPriceHuf
      ? promoCandidate
      : null

  let reason: CoursePromo['reason'] = null
  if (!enabled) {
    reason = 'kikapcsolva'
  } else if (start !== null && now.getTime() < start.getTime()) {
    reason = 'meg-nem-kezdodott'
  } else if (end !== null && now.getTime() >= end.getTime()) {
    reason = 'lejart'
  }
  const active = reason === null
  const priceHuf = active && promoPriceHuf !== null ? promoPriceHuf : regularPriceHuf

  return {
    active,
    enabled,
    start,
    end,
    regularPriceHuf,
    promoPriceHuf,
    priceHuf,
    originalPriceHuf: active && promoPriceHuf !== null ? regularPriceHuf : null,
    reason,
  }
}

/**
 * A MOST fizetendő ár egész forintban, vagy null, ha nincs érvényes ár. Élő
 * akcióban az akciós ár, különben a rendes ár. A `coursePriceHuf`
 * (src/lib/courses.ts) ezt hívja; a promo-mezők opcionálisak, hogy a régi,
 * szűk Pick-típusú hívók is forduljanak, de aki `select`-tel kér terméket,
 * annak a promo-mezőket is kérnie kell, különben csendben a rendes árat kapja
 * (őr: src/__tests__/course-promo.test.ts).
 */
export function effectiveCoursePriceHuf(
  product: Pick<Product, 'priceInHUF' | 'priceInHUFEnabled'> & Partial<CoursePromoFields>,
  now: Date = new Date(),
): number | null {
  return resolveCoursePromo(
    {
      priceInHUF: product.priceInHUF,
      priceInHUFEnabled: product.priceInHUFEnabled,
      promoEnabled: product.promoEnabled ?? null,
      promoStart: product.promoStart ?? null,
      promoEnd: product.promoEnd ?? null,
      promoPriceHuf: product.promoPriceHuf ?? null,
    },
    now,
  ).priceHuf
}

/** A megjelenítési döntéshez kellő mezők: akció + ár + bolti státusz. */
export type CoursePromoDisplayFields = CoursePromoPriceFields &
  Pick<Product, 'status'> &
  Partial<Pick<Product, '_status'>>

/**
 * Igaz, ha a kurzus MOST akciósként JELENIK MEG: az akció él (időablak), a
 * kurzus közzétett (archivált kurzuson a vásárlás tiltott, ott az „akciós ár”
 * hamis ígéret lenne), és van érvényes, pozitív ára (ingyenes vagy ár nélküli
 * kurzuson nincs mit akciózni). EZ az egyetlen szabály a kurzusoldal
 * sablonválasztásához, a kártya-címkéhez és a link-név előtagjához (Devin,
 * #278: a kártya és az oldal nem mondhat mást).
 */
export function isCoursePromoDisplayed(
  product: CoursePromoDisplayFields,
  now: Date = new Date(),
): boolean {
  if (product.status !== 'published') {
    return false
  }
  // A Payload dokumentum-státusz is kapu (Codex, #278): a visszavont
  // (draft) dokumentum a kurzusoldalon 404, ezért a kártya sem hirdethet akciót.
  if (product._status === 'draft') {
    return false
  }
  if (
    product.priceInHUFEnabled !== true ||
    typeof product.priceInHUF !== 'number' ||
    !Number.isFinite(product.priceInHUF) ||
    product.priceInHUF <= 0
  ) {
    return false
  }
  return resolveCoursePromo(product, now).active
}

/** Igaz, ha az akció időablaka MOST él (ár és státusz nélkül; lásd isCoursePromoDisplayed). */
export function isCoursePromoActive(
  product: Parameters<typeof resolveCoursePromo>[0],
  now: Date = new Date(),
): boolean {
  return resolveCoursePromo(product, now).active
}

/**
 * Egy nap „hónap nap” alakban, hu-HU, Budapest szerint, a magyar formázó
 * záró pontja NÉLKÜL („szeptember 30”), hogy a hívó kötőjeles ragot fűzhessen
 * hozzá („szeptember 30-ig”). Az AkH. 12. kiadás 297. pontja szerint a rag
 * kötőjellel, pont nélkül kapcsolódik a nap sorszámához.
 */
export function promoDayLabel(instant: Date): string {
  return new Intl.DateTimeFormat('hu-HU', {
    timeZone: 'Europe/Budapest',
    month: 'long',
    day: 'numeric',
  })
    .format(instant)
    .replace(/\.$/, '')
}

/**
 * Az akció utolsó NAPJA, ahogy a látogatónak mondjuk („Az akció szeptember
 * 30-ig él”): a kizáró pillanat előtti nap, Budapest szerint.
 */
export function promoLastDayLabel(promo: Pick<CoursePromo, 'end'>): string | null {
  if (promo.end === null) {
    return null
  }
  return promoDayLabel(new Date(promo.end.getTime() - 1))
}

/** Az akció ELSŐ napja („október 1”), vagy null, ha nincs kezdet. */
export function promoFirstDayLabel(promo: Pick<CoursePromo, 'start'>): string | null {
  if (promo.start === null) {
    return null
  }
  return promoDayLabel(new Date(promo.start.getTime() + DAY_MS / 2))
}
