/**
 * Alanyi adómentesség (AAM) értékhatár-figyelése.
 *
 * JOGI ALAP (r-ado-9, ellenőrizve a hatályos Áfa tv. szövegén):
 *  - 188. § (2): az értékhatár „20 000 000 forintnak megfelelő pénzösszeg";
 *  - 378. § (1): 2027-re „22 000 000 forint";
 *  - 191. § (2): az átlépő ügylet már nem adómentes, (3): két évig nem
 *    választható újra;
 *  - NAV-GYIK: a keretbe „áfa nélkül számított ellenérték" számít.
 * AAM mellett a számla áfát nem tartalmaz, tehát a kiállított számla összege
 * egyben a nettó ellenérték.
 *
 * MIT SZÁMOLUNK: a tárgyév (Budapest szerinti naptári év, a számla
 * teljesítési dátuma szerint) kiállított számláinak összege, mínusz a
 * stornózott számlák teljes összege, mínusz azok a visszatérítések, amelyek
 * SAJÁT helyesbítő számlája igazoltan kiállt. Csak az a csökkentés számít,
 * amelyhez bizonylat is készült (Áfa tv. 153/B. § (1) a): az adóalap
 * csökkentéséhez az érvénytelenítő vagy módosító számla kell). Kétség esetén
 * a keret-használatot túlbecsüljük, sosem alá. Ez BECSLÉS és csak a
 * webshopot látja: a keretbe a vállalkozás MINDEN belföldi bevétele
 * beleszámít, ezt a könyvelő egyezteti (docs/uzemeltetes/14-alanyi-adomentes-keret.md).
 */

import type { Payload, Where } from 'payload'

import { budapestDateString } from '../date/budapest'

/** Ellenőrzött értékhatárok évenként (Áfa tv. 188. § (2), 378. § (1)). */
export const AAM_LIMIT_BY_YEAR: Readonly<Record<number, number>> = {
  2026: 20_000_000,
  2027: 22_000_000,
}

/** Figyelmeztetési küszöbök a keret arányában. */
export const AAM_WARNING_RATIOS = [0.7, 0.9] as const

export type AamLevel = 'rendben' | 'figyelem-70' | 'figyelem-90' | 'tullepve'

export interface AamStatus {
  readonly year: number
  readonly netHuf: number
  readonly limitHuf: number
  /** Igaz, ha a tárgyév határa a táblából jön (nem a legutolsó ismert évből). */
  readonly limitVerified: boolean
  readonly ratio: number
  readonly level: AamLevel
}

export interface AamOrderInput {
  readonly totalHufSnapshot?: number | null
  readonly invoiceStatus?: string | null
  readonly invoiceCompletionDate?: string | null
  readonly stornoStatus?: string | null
  readonly correctiveInvoiceStatus?: string | null
  /** A LEGUTÓBB kiállított helyesbítő refund-sorszáma (1-alapú, a `refunds` indexe + 1). */
  readonly correctiveInvoiceSeq?: number | null
  /** A LEGUTÓBB kiállított helyesbítő számla száma (tulajdonosi olvasású mező). */
  readonly correctiveInvoiceNumber?: string | null
  readonly refunds?: unknown
}

function finiteAmount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** A tárgyév értékhatára; ismeretlen évre a legutolsó ismert (nem ellenőrzött). */
export function aamLimitForYear(year: number): { limitHuf: number; verified: boolean } {
  const exact = AAM_LIMIT_BY_YEAR[year]
  if (exact !== undefined) {
    return { limitHuf: exact, verified: true }
  }
  const knownYears = Object.keys(AAM_LIMIT_BY_YEAR)
    .map(Number)
    .filter((known) => known <= year)
    .sort((a, b) => b - a)
  const fallbackYear = knownYears[0] ?? Math.min(...Object.keys(AAM_LIMIT_BY_YEAR).map(Number))
  return { limitHuf: AAM_LIMIT_BY_YEAR[fallbackYear] ?? 20_000_000, verified: false }
}

/**
 * Az a visszatérítés-összeg, amelynek a SAJÁT helyesbítő számlája a rendelés
 * adatai szerint igazoltan kiállt (0, ha ilyen nincs).
 *
 * MIÉRT CSAK EGY BEJEGYZÉS? A rendelésen a helyesbítő állapota EGYETLEN érték
 * (`correctiveInvoiceStatus` + `correctiveInvoiceNumber` +
 * `correctiveInvoiceSeq`), nem bejegyzésenkénti nyilvántartás:
 *  - a `correctiveInvoiceSeq` a LEGUTÓBB kiállított helyesbítő refund-sorszáma
 *    (src/lib/szamlazz/corrective.ts: a szám és a sorszám csak
 *    `refundSeq >= recordedSeq` mellett íródik), a `refunds[seq - 1]`
 *    bejegyzéshez tartozik (a corrective-invoice-issue job és a
 *    refund-guard is így olvassa);
 *  - a kiállítás nem feltétlenül sorrendi: egy korábbi sorszám újrapróbálása
 *    a későbbi után is lefuthat, és a státusz ilyenkor „issued” lesz, a
 *    sorszám viszont a későbbié marad. A korábbi bejegyzések bizonylatát tehát
 *    a rendelés NEM igazolja, és a státusz egy későbbi, még függő vagy
 *    sikertelen helyesbítőnél sem „issued”;
 *  - a bejegyzésenkénti `refund-invoice-done` nyugta (audit-logs) csak az
 *    intent-kezelt visszatérítéseknél létezik, a régieknél nincs, ezért a
 *    keret-becslés nem építhet rá.
 * Így csak a `correctiveInvoiceSeq` bejegyzése vonható le, és csak ha a
 * státusz „issued” és a szám is ki van töltve (ugyanaz a feltétel, amellyel a
 * helyesbítő-kiállítás az „already-issued” döntést hozza). A többi
 * visszatérítés a keretben marad: az AAM adóhatár, a túlbecslés a biztonságos
 * irány. Helyesbítőt a részleges és a rendelést lezáró, nem első teljes
 * bejegyzés kap (refund-order.ts: „részrefund és záró rész: helyesbítő”); az
 * első, teljes visszatérítés stornót kap, azt a `stornoStatus` kezeli.
 */
function evidencedCorrectiveRefund(order: AamOrderInput): number {
  if (order.correctiveInvoiceStatus !== 'issued') {
    return 0
  }
  const number = order.correctiveInvoiceNumber
  if (typeof number !== 'string' || number.trim() === '') {
    return 0
  }
  const seq = order.correctiveInvoiceSeq
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1) {
    return 0
  }
  if (!Array.isArray(order.refunds) || seq > order.refunds.length) {
    return 0
  }
  const entry: unknown = order.refunds[seq - 1]
  if (typeof entry !== 'object' || entry === null) {
    return 0
  }
  const record = entry as { type?: unknown; amountHuf?: unknown }
  const correctedByCorrective = record.type === 'partial' || (record.type === 'full' && seq > 1)
  return correctedByCorrective ? finiteAmount(record.amountHuf) : 0
}

/** A rendelés nettó hozzájárulása a tárgyév keretéhez (0, ha nem az évé). */
export function aamContribution(order: AamOrderInput, year: number): number {
  if (order.invoiceStatus !== 'issued') {
    return 0
  }
  const completion =
    typeof order.invoiceCompletionDate === 'string' ? order.invoiceCompletionDate : ''
  if (!completion.startsWith(`${String(year)}-`)) {
    return 0
  }
  if (order.stornoStatus === 'storned') {
    return 0
  }
  const gross = finiteAmount(order.totalHufSnapshot)
  return Math.max(0, gross - evidencedCorrectiveRefund(order))
}

function levelFor(ratio: number): AamLevel {
  if (ratio >= 1) return 'tullepve'
  if (ratio >= (AAM_WARNING_RATIOS[1] ?? 0.9)) return 'figyelem-90'
  if (ratio >= (AAM_WARNING_RATIOS[0] ?? 0.7)) return 'figyelem-70'
  return 'rendben'
}

export function computeAamStatus(orders: readonly AamOrderInput[], year: number): AamStatus {
  const netHuf = orders.reduce((sum, order) => sum + aamContribution(order, year), 0)
  const { limitHuf, verified } = aamLimitForYear(year)
  const ratio = limitHuf > 0 ? netHuf / limitHuf : 0
  return { year, netHuf, limitHuf, limitVerified: verified, ratio, level: levelFor(ratio) }
}

/** A Budapest szerinti naptári év. */
export function budapestYear(nowMs: number): number {
  return Number(budapestDateString(new Date(nowMs)).slice(0, 4))
}

/** A lekérdezéshez szükséges `find` (rendszer- vagy tulajdonosi jogosultsággal). */
export type AamFindFn = (args: {
  where: Where
  page: number
  limit: number
}) => Promise<{ docs: readonly AamOrderInput[]; hasNextPage?: boolean | null }>

const AAM_PAGE_SIZE = 500
const AAM_MAX_PAGES = 40

/**
 * A tárgyév kiállított számlás rendelései. A teljesítési dátum szöveges
 * mező, ezért a szűrés a `createdAt`-re megy (az előző év decemberétől, mert
 * az év végi rendelés teljesítése átcsúszhat), a pontos évet a
 * `computeAamStatus` dönti el.
 */
export async function queryAamStatus(find: AamFindFn, nowMs: number): Promise<AamStatus> {
  const year = budapestYear(nowMs)
  const where: Where = {
    and: [
      { invoiceStatus: { equals: 'issued' } },
      { createdAt: { greater_than_equal: new Date(Date.UTC(year - 1, 11, 1)).toISOString() } },
    ],
  }
  const orders: AamOrderInput[] = []
  for (let page = 1; page <= AAM_MAX_PAGES; page += 1) {
    const result = await find({ where, page, limit: AAM_PAGE_SIZE })
    orders.push(...result.docs)
    if (result.docs.length < AAM_PAGE_SIZE || result.hasNextPage === false) {
      break
    }
  }
  return computeAamStatus(orders, year)
}

/**
 * A `find`-hez kért mezők: a helyesbítős levonáshoz a `refunds`, a helyesbítő
 * állapota, sorszáma és száma is kell (lásd `evidencedCorrectiveRefund`).
 */
export const AAM_ORDER_SELECT = {
  totalHufSnapshot: true,
  invoiceStatus: true,
  invoiceCompletionDate: true,
  stornoStatus: true,
  correctiveInvoiceStatus: true,
  correctiveInvoiceSeq: true,
  correctiveInvoiceNumber: true,
  refunds: true,
} as const

/** A Payload Local API-ra épülő `find` (a hívó dönti el a jogosultságot). */
export function payloadAamFind(
  payload: Pick<Payload, 'find'>,
  access: { overrideAccess: true } | { overrideAccess: false; user: unknown },
): AamFindFn {
  return async ({ where, page, limit }) => {
    const result = await payload.find({
      collection: 'orders',
      where,
      page,
      limit,
      depth: 0,
      sort: 'createdAt',
      select: AAM_ORDER_SELECT,
      ...access,
    } as unknown as Parameters<Payload['find']>[0])
    return {
      docs: result.docs as unknown as readonly AamOrderInput[],
      hasNextPage: result.hasNextPage,
    }
  }
}

/** Egy sor a levélbe és a képernyőre: „2026: 3 180 000 Ft a 20 000 000 Ft-os keretből (16%)". */
export function formatAamLine(status: AamStatus): string {
  const percent = Math.floor(status.ratio * 100)
  const base = `${String(status.year)}: ${status.netHuf.toLocaleString('hu-HU')} Ft a ${status.limitHuf.toLocaleString('hu-HU')} Ft-os keretből (${String(percent)}%)`
  return status.limitVerified ? base : `${base}, a tárgyévi értékhatár ellenőrizendő`
}
