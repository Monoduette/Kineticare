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
import { logger } from '../logger'
import { emitAlert } from './emit'

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
  /** Tájékoztató: a levonást NEM befolyásolja (lásd `evidencedCorrectiveRefund`). */
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
 * A BIZONYÍTÉK a tárolt (`correctiveInvoiceSeq`, `correctiveInvoiceNumber`)
 * pár, a pillanatnyi `correctiveInvoiceStatus` NEM számít:
 *  - a pár a `refunds[seq - 1]` bejegyzés helyesbítőjéhez tartozik (a
 *    corrective-invoice-issue job és a refund-guard is így olvassa);
 *  - src/lib/szamlazz/corrective.ts a számot és a sorszámot KIZÁRÓLAG a
 *    sikeres kiállítás ágain írja, egy mentésben, és csak
 *    `refundSeq >= recordedSeq` mellett; a függő és a sikertelen ág csak az
 *    állapotot és a kísérlet-számlálót írja, a párt sosem törli. A mezők
 *    rendszer-írásúak (a mezőszintű `create`/`update` tiltott), kézzel sem
 *    írhatók. Ugyanezt a párt használja a helyesbítő-kiállítás
 *    „already-issued” rövidzára is (szám + pontos sorszám-egyezés, állapot
 *    nélkül);
 *  - a státusz ezért egy KÉSŐBBI sorszám függő vagy sikertelen helyesbítőjét
 *    is jelentheti (azonos sorszám újrapróbálása a rövidzár miatt el sem jut
 *    az állapot-írásig), a korábbi, már kiállt bizonylatot viszont nem
 *    vonja vissza. Ha a levonást a státuszhoz kötnénk, egy későbbi hiba
 *    visszaírná a keretbe a már igazolt csökkentést;
 *  - a pár mindig csak EGY bejegyzést igazol: a kiállítás nem feltétlenül
 *    sorrendi (egy korábbi sorszám újrapróbálása a későbbi után is lefuthat,
 *    ilyenkor a pár a későbbié marad), tehát a többi bejegyzés bizonylatát a
 *    rendelés nem igazolja;
 *  - a bejegyzésenkénti `refund-invoice-done` nyugta (audit-logs) csak az
 *    intent-kezelt visszatérítéseknél létezik, a régieknél nincs, ezért a
 *    keret-becslés nem építhet rá.
 * A többi visszatérítés a keretben marad: az AAM adóhatár, a túlbecslés a
 * biztonságos irány. Helyesbítőt a részleges és a rendelést lezáró, nem első
 * teljes bejegyzés kap (refund-order.ts: „részrefund és záró rész:
 * helyesbítő”); az első, teljes visszatérítés stornót kap, azt a
 * `stornoStatus` kezeli.
 */
function evidencedCorrectiveRefund(order: AamOrderInput): number {
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

/** A riasztás kódja, ha a tárgyév rendelései nem olvashatók be teljesen. */
export const AAM_INCOMPLETE_ALERT_CODE = 'aam-keret-nem-teljes'

/**
 * A tárgyév rendelései nem olvashatók be teljesen (a lapozás a korlátnál úgy
 * állt meg, hogy lehet még adat). Részösszegből keret-szintet számolni TILOS,
 * mert az adóhatár-használatot alábecsülné: a hívó hibát kap, nem állapotot.
 */
export class AamIncompleteError extends Error {
  readonly pagesRead: number
  readonly ordersRead: number

  constructor(pagesRead: number, ordersRead: number) {
    super(
      `Az alanyi adómentes keret számítása nem teljes: ${String(pagesRead)} oldal (${String(ordersRead)} rendelés) után is volna még adat, keret-szint nem számolható.`,
    )
    this.name = 'AamIncompleteError'
    this.pagesRead = pagesRead
    this.ordersRead = ordersRead
  }
}

/**
 * A tárgyév kiállított számlás rendelései, a számla TELJESÍTÉSI DÁTUMA
 * szerint. A jelöltet ugyanaz a mező választja ki, amely szerint az
 * `aamContribution` az évhez rendel: a létrehozás ideje erre nem jó, mert egy
 * korábbi rendelés számláját később is kiállíthatják (vagy kézzel újra
 * kiállíthatják), és akkor a tárgyévbe számít (PR #305, Devin: novemberi rendelés, januári
 * teljesítés). A `createdAt`-visszatekintés az ilyen rendelést kihagyta, és a
 * keret-használatot alábecsülte.
 *
 * A teljesítési dátum szöveges mező (varchar, ÉÉÉÉ-HH-NN, a
 * `budapestDateString` írja), ezért szöveges tartományra szűrünk:
 * [`ÉÉÉÉ-`, `ÉÉÉÉ+1-`). Ez a `ÉÉÉÉ-` kezdetű értékeket bármely
 * adatbázis-rendezés (C és nyelvi collation) mellett lefedi; a Payload `like`
 * operátora nem előtag-, hanem tartalmazás-keresés, ezért nem az. A pontos
 * évet továbbra is a `computeAamStatus` dönti el.
 *
 * TELJESSÉG: az eredmény csak akkor épül, ha a lapozás igazoltan a végére ért
 * (rövid oldal vagy `hasNextPage === false`). Ha az `AAM_MAX_PAGES` korlát
 * úgy fogy el, hogy az utolsó oldal tele volt és nem zárta le a listát, a
 * függvény RIASZTÁST ír és `AamIncompleteError`-t dob: a részösszeg nem
 * jelenhet meg az év összegeként, és szint sem számolható belőle. A hívók a
 * dobást látható hibaként kezelik (a napi összesítőnél a poll-watch
 * riasztása, a Figyelmet igényel blokkban a betöltési hiba szövege).
 */
export async function queryAamStatus(find: AamFindFn, nowMs: number): Promise<AamStatus> {
  const year = budapestYear(nowMs)
  const where: Where = {
    and: [
      { invoiceStatus: { equals: 'issued' } },
      { invoiceCompletionDate: { greater_than_equal: `${String(year)}-` } },
      { invoiceCompletionDate: { less_than: `${String(year + 1)}-` } },
    ],
  }
  const orders: AamOrderInput[] = []
  let complete = false
  let pagesRead = 0
  for (let page = 1; page <= AAM_MAX_PAGES; page += 1) {
    const result = await find({ where, page, limit: AAM_PAGE_SIZE })
    pagesRead = page
    orders.push(...result.docs)
    if (result.docs.length < AAM_PAGE_SIZE || result.hasNextPage === false) {
      complete = true
      break
    }
  }
  if (!complete) {
    emitAlert(
      logger,
      AAM_INCOMPLETE_ALERT_CODE,
      'RIASZTÁS: az alanyi adómentes keret felhasználása nem számolható, mert a tárgyév számlás rendelései nem férnek bele a lekérdezés korlátjába. A keret-szint ezért nem látszik. Egyeztesd a keretet a könyvelővel, és szólj a fejlesztőnek.',
      { module: 'alerts/aam', year, pagesRead, ordersRead: orders.length },
    )
    throw new AamIncompleteError(pagesRead, orders.length)
  }
  return computeAamStatus(orders, year)
}

/**
 * A `find`-hez kért mezők: a helyesbítős levonáshoz a `refunds`, a helyesbítő
 * sorszáma és száma kell (lásd `evidencedCorrectiveRefund`).
 */
export const AAM_ORDER_SELECT = {
  totalHufSnapshot: true,
  invoiceStatus: true,
  invoiceCompletionDate: true,
  stornoStatus: true,
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
      // Az id a holtversenyt dönti el: nem egyedi rendezési kulcs mellett a
      // Postgres oldalanként más sorrendet adhat, és egy sor kimaradhatna.
      sort: ['createdAt', 'id'],
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
