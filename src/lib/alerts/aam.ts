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
 * SAJÁT helyesbítő számlája igazoltan kiállt (visszatérítésenként, lásd
 * `src/lib/alerts/corrective-evidence.ts`). Csak az a csökkentés számít,
 * amelyhez bizonylat is készült (Áfa tv. 153/B. § (1) a): az adóalap
 * csökkentéséhez az érvénytelenítő vagy módosító számla kell). Kétség esetén
 * a keret-használatot túlbecsüljük, sosem alá. Ez BECSLÉS és csak a
 * webshopot látja: a keretbe a vállalkozás MINDEN belföldi bevétele
 * beleszámít, ezt a könyvelő egyezteti (docs/uzemeltetes/14-alanyi-adomentes-keret.md).
 */

import type { Payload, Where } from 'payload'

import { shouldEmitThrottledAlert } from '../alert-throttle'
import { budapestDateString } from '../date/budapest'
import { logger } from '../logger'
import {
  COMMITTED_INTENT_SELECT,
  committedSequencesByOrder,
  correctiveRefunds,
} from './corrective-evidence'
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
  /** A rendelés azonosítója: a lezárt visszatérítési szándékok ehhez kötődnek. */
  readonly id?: number | string
  readonly totalHufSnapshot?: number | null
  /** A tételek (ár-snapshot és mennyiség): a snapshot nélküli régi rendelés tartaléka. */
  readonly items?: unknown
  /** A plugin „Összeg” mezője: a végösszeg tükre, a régi rendelés utolsó tartaléka. */
  readonly amount?: number | null
  readonly invoiceStatus?: string | null
  readonly invoiceCompletionDate?: string | null
  readonly stornoStatus?: string | null
  /** Tájékoztató: a levonást NEM befolyásolja (lásd `evidencedCorrectiveRefunds`). */
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

/** Véges, nem negatív összeg (a 0 is összeg), különben `null`. */
function knownAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * A tételek ár × mennyiség összege, ha MINDEN tételnek ismert az ára;
 * különben `null`. A mennyiség a rendeléskori szabály szerint számít
 * (src/lib/order-integrity.ts): a hiányzó vagy nem pozitív érték 1.
 */
function itemsAmountHuf(items: unknown): number | null {
  if (!Array.isArray(items) || items.length === 0) {
    return null
  }
  let total = 0
  for (const item of items as unknown[]) {
    const fields =
      typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {}
    const price = knownAmount(fields.priceHufSnapshot)
    if (price === null) {
      return null
    }
    const quantity = fields.quantity
    total +=
      price *
      (typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0 ? quantity : 1)
  }
  return total
}

/**
 * A kiállított számla összege (AAM mellett a számlán nincs áfa, ez tehát a
 * nettó ellenérték is), a legmegbízhatóbb elérhető forrásból; `null`, ha
 * egyik sem ismert.
 *
 * PR #305, Devin: a `totalHufSnapshot` nélküli régi rendelés számlája eddig
 * 0 Ft-tal számított, így a keret-használat a valósnál kisebbnek látszhatott.
 * A források, a megbízhatóság sorrendjében:
 *  - A számla összegét a rendelés nem tárolja: kiállításkor csak az állapot,
 *    a szám, a teljesítési dátum és a PDF-link íródik
 *    (src/lib/szamlazz/invoice.ts, `writeOrderInvoicingState`).
 *  - `totalHufSnapshot`: a tételek ár × mennyiség összege a rendeléskor
 *    (src/lib/order-integrity.ts; csak létrehozáskor írható, a számla sorai
 *    ugyanezekből a tételekből készülnek). Ha pozitív, ez számít, ahogy
 *    eddig, és egy kisebb tartalék-érték sem írja felül.
 *  - A tételek ár-snapshotja × mennyiség, ha minden tételnek van ára: a
 *    számla sorai pontosan ebből készülnek (`itemsFromOrder`,
 *    src/lib/szamlazz/invoice.ts), és hiányzó ár mellett számla sem áll ki.
 *    A hiányos tétellista nem forrás: a statisztika
 *    (src/lib/statistics/revenue.ts) a hiányzó árat 0-nak veszi, ami itt
 *    alábecslés volna, ezért a statisztika összegzőjét nem használjuk.
 *  - A plugin `amount` mezője: a rendeléskor a végösszeg tükre
 *    (order-integrity.ts); a visszatérítés is ezt veszi tartaléknak
 *    (src/lib/refund/refund-order.ts).
 * Az első POZITÍV érték számít; a 0 Ft csak akkor, ha egyik forrás sem mutat
 * többet (ingyenes tétel). Egy 0-s snapshot tehát nem írja felül egy
 * tartalék pozitív összegét: kétség esetén túlbecsülünk, ahogy a statisztika
 * tartaléka is csak pozitív összeggel pótol.
 */
function invoicedAmountHuf(order: AamOrderInput): number | null {
  const sources = [
    knownAmount(order.totalHufSnapshot),
    itemsAmountHuf(order.items),
    knownAmount(order.amount),
  ]
  return (
    sources.find((amount) => amount !== null && amount > 0) ??
    sources.find((amount) => amount !== null) ??
    null
  )
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

const NO_SEQUENCES: ReadonlySet<number> = new Set()

/**
 * Azoknak a visszatérítéseknek az összege, amelyek SAJÁT helyesbítő számlája
 * a bizonyítékok szerint kiállt (0, ha ilyen nincs).
 *
 * A bizonyíték visszatérítésenként ugyanaz, mint a Figyelmet igényel
 * hiányzó-helyesbítő számolásáé (`correctiveRefunds`,
 * src/lib/alerts/corrective-evidence.ts): a tárolt (`correctiveInvoiceSeq`,
 * `correctiveInvoiceNumber`) pár a saját sorszámát igazolja, a
 * `committedSequences` minden sorszámot, amelyhez `committed` visszatérítési
 * szándék tartozik. A pillanatnyi `correctiveInvoiceStatus` NEM számít: egy
 * későbbi függő vagy sikertelen helyesbítő nem írja vissza a keretbe a már
 * igazolt csökkentést.
 *
 * PR #305, Codex P1: két kiállt helyesbítőnél a pár csak a legutóbbit
 * mutatja, a korábbit a lezárt szándéka igazolja. Ha csak a párt néznénk, a
 * korábbi, dokumentált visszatérítés visszakerülne a keretbe, és a
 * keret-használat túl magas lenne (hamis 70/90/100%-os figyelmeztetés).
 *
 * A bizonyíték nélküli visszatérítés a keretben marad: az AAM adóhatár, a
 * túlbecslés a biztonságos irány (Áfa tv. 153/B. § (1) a): az adóalap
 * csökkentéséhez a módosító számla kell). A régi, szándék nélküli
 * visszatérítések közül ezért csak a pár sorszáma vonódik le.
 */
function evidencedCorrectiveRefunds(
  order: AamOrderInput,
  committedSequences: ReadonlySet<number>,
): number {
  return correctiveRefunds(order, committedSequences)
    .filter((refund) => refund.evidenced)
    .reduce((sum, refund) => sum + finiteAmount(refund.entry.amountHuf), 0)
}

/** Kiállított, tárgyévi, nem stornózott számla: ez számít a keretbe. */
function countsForYear(order: AamOrderInput, year: number): boolean {
  if (order.invoiceStatus !== 'issued' || order.stornoStatus === 'storned') {
    return false
  }
  const completion =
    typeof order.invoiceCompletionDate === 'string' ? order.invoiceCompletionDate : ''
  return completion.startsWith(`${String(year)}-`)
}

/**
 * A rendelés nettó hozzájárulása a tárgyév keretéhez (0, ha nem az évé).
 * A `committedSequences` a rendelés `committed` visszatérítési szándékainak
 * sorszámai (hiányában csak a tárolt pár igazol). `null`, ha a rendelés a
 * tárgyévbe számít, de a számla összege nem ismert (`invoicedAmountHuf`):
 * ilyenkor 0-val számolni alábecslés volna.
 */
export function aamContribution(
  order: AamOrderInput,
  year: number,
  committedSequences: ReadonlySet<number> = NO_SEQUENCES,
): number | null {
  if (!countsForYear(order, year)) {
    return 0
  }
  const gross = invoicedAmountHuf(order)
  if (gross === null) {
    return null
  }
  return Math.max(0, gross - evidencedCorrectiveRefunds(order, committedSequences))
}

/** A tárgyévbe számító, ismeretlen összegű számlás rendelések. */
function ordersWithoutAmount(
  orders: readonly AamOrderInput[],
  year: number,
): readonly AamOrderInput[] {
  return orders.filter((order) => aamContribution(order, year) === null)
}

function levelFor(ratio: number): AamLevel {
  if (ratio >= 1) return 'tullepve'
  if (ratio >= (AAM_WARNING_RATIOS[1] ?? 0.9)) return 'figyelem-90'
  if (ratio >= (AAM_WARNING_RATIOS[0] ?? 0.7)) return 'figyelem-70'
  return 'rendben'
}

/**
 * A tárgyév keret-állapota. A `committedByOrder` rendelés-azonosítónként
 * (szövegként) a `committed` szándékok sorszámai. Ha egy tárgyévi számla
 * összege nem ismert, `AamIncompleteError`-t dob: részösszegből szint nem
 * számolható.
 */
export function computeAamStatus(
  orders: readonly AamOrderInput[],
  year: number,
  committedByOrder: ReadonlyMap<string, ReadonlySet<number>> = new Map(),
): AamStatus {
  const withoutAmount = ordersWithoutAmount(orders, year).length
  if (withoutAmount > 0) {
    throw new AamIncompleteError(0, orders.length, withoutAmount)
  }
  const netHuf = orders.reduce(
    (sum, order) =>
      sum +
      (aamContribution(
        order,
        year,
        (order.id === undefined ? undefined : committedByOrder.get(String(order.id))) ??
          NO_SEQUENCES,
      ) ?? 0),
    0,
  )
  const { limitHuf, verified } = aamLimitForYear(year)
  const ratio = limitHuf > 0 ? netHuf / limitHuf : 0
  return { year, netHuf, limitHuf, limitVerified: verified, ratio, level: levelFor(ratio) }
}

/** A Budapest szerinti naptári év. */
export function budapestYear(nowMs: number): number {
  return Number(budapestDateString(new Date(nowMs)).slice(0, 4))
}

/** A rendelések lapozott lekérdezése (rendszer- vagy tulajdonosi jogosultsággal). */
export type AamFindFn = (args: {
  where: Where
  page: number
  limit: number
}) => Promise<{ docs: readonly AamOrderInput[]; hasNextPage?: boolean | null }>

/** A lezárt visszatérítési szándékok lapozott lekérdezése (ugyanazzal a jogosultsággal). */
export type AamIntentFindFn = (args: {
  where: Where
  page: number
  limit: number
}) => Promise<{ docs: readonly unknown[]; hasNextPage?: boolean | null }>

/** A keret-számítás forrásai: a rendelések és a helyesbítőt igazoló lezárt szándékok. */
export interface AamSources {
  readonly orders: AamFindFn
  readonly committedIntents: AamIntentFindFn
}

const AAM_PAGE_SIZE = 500
const AAM_MAX_PAGES = 40
/** Ennyi rendelés-azonosító megy egy szándék-lekérdezés `in` feltételébe. */
const AAM_INTENT_ORDER_CHUNK = 200

/** A riasztás kódja, ha a tárgyév rendelései nem olvashatók be teljesen. */
export const AAM_INCOMPLETE_ALERT_CODE = 'aam-keret-nem-teljes'

/**
 * A tárgyév rendelései nem olvashatók be teljesen (a lapozás a korlátnál úgy
 * állt meg, hogy lehet még adat), vagy egy tárgyévi számla összege nem ismert
 * (`ordersWithoutAmount` > 0). Részösszegből keret-szintet számolni TILOS,
 * mert az adóhatár-használatot alábecsülné: a hívó hibát kap, nem állapotot.
 */
export class AamIncompleteError extends Error {
  readonly pagesRead: number
  readonly ordersRead: number
  /** A tárgyévbe számító, ismeretlen összegű számlás rendelések száma (lapozási hibánál 0). */
  readonly ordersWithoutAmount: number

  constructor(pagesRead: number, ordersRead: number, ordersWithoutAmount = 0) {
    super(
      ordersWithoutAmount > 0
        ? `Az alanyi adómentes keret számítása nem teljes: ${String(ordersWithoutAmount)} rendelésnél hiányzik a kiállított számla összege, keret-szint nem számolható.`
        : `Az alanyi adómentes keret számítása nem teljes: ${String(pagesRead)} oldal (${String(ordersRead)} rendelés) után is volna még adat, keret-szint nem számolható.`,
    )
    this.name = 'AamIncompleteError'
    this.pagesRead = pagesRead
    this.ordersRead = ordersRead
    this.ordersWithoutAmount = ordersWithoutAmount
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
 * Ugyanígy jár el, ha egy tárgyévi számla összege egyik forrásból sem ismert
 * (`invoicedAmountHuf`): 0-val nem számol, hanem fojtott RIASZTÁST ír a
 * hiányzó összegű rendelések számával, és `AamIncompleteError`-t dob.
 */
export async function queryAamStatus(sources: AamSources, nowMs: number): Promise<AamStatus> {
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
    const result = await sources.orders({ where, page, limit: AAM_PAGE_SIZE })
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
  const withoutAmount = ordersWithoutAmount(orders, year)
  if (withoutAmount.length > 0) {
    // Évenként fojtva: a Figyelmet igényel blokk minden megnyitáskor újraszámol.
    if (
      shouldEmitThrottledAlert(
        `${AAM_INCOMPLETE_ALERT_CODE}:osszeg:${String(year)}`,
        undefined,
        nowMs,
      )
    ) {
      emitAlert(
        logger,
        AAM_INCOMPLETE_ALERT_CODE,
        `RIASZTÁS: az alanyi adómentes keret felhasználása nem számolható, mert ${String(withoutAmount.length)} rendelésnél hiányzik a kiállított számla összege. A keret-szint ezért nem látszik. Egyeztesd a keretet a könyvelővel, és szólj a fejlesztőnek.`,
        {
          module: 'alerts/aam',
          year,
          ordersWithoutAmount: withoutAmount.length,
          orderIds: withoutAmount.slice(0, 20).map((order) => order.id ?? null),
        },
      )
    }
    throw new AamIncompleteError(pagesRead, orders.length, withoutAmount.length)
  }
  const committedByOrder = await committedSequencesForOrders(sources.committedIntents, orders, year)
  return computeAamStatus(orders, year, committedByOrder)
}

/**
 * A lezárt (`committed`) visszatérítési szándékok sorszámai azokra a
 * rendelésekre, amelyeknél a tárolt pár nem igazol minden helyesbítőt
 * igénylő visszatérítést. Egy lekérdezés legfeljebb `AAM_INTENT_ORDER_CHUNK`
 * rendelésre szól (rendelésenkénti lekérdezés nincs); a többi rendeléshez nem
 * kell szándék, mert a párja mindent igazol, vagy nem is számít a keretbe.
 *
 * Ha egy részlet lapozása a korlátnál megállna, a már beolvasott szándékok
 * akkor is igaz bizonyítékok; a hiányzók visszatérítése a keretben marad
 * (túlbecslés, a biztonságos irány), és warn-sor jelzi.
 */
async function committedSequencesForOrders(
  find: AamIntentFindFn,
  orders: readonly AamOrderInput[],
  year: number,
): Promise<Map<string, Set<number>>> {
  const ids: (number | string)[] = []
  for (const order of orders) {
    if (
      order.id !== undefined &&
      countsForYear(order, year) &&
      correctiveRefunds(order, NO_SEQUENCES).some((refund) => !refund.evidenced)
    ) {
      ids.push(order.id)
    }
  }
  const intents: unknown[] = []
  for (let start = 0; start < ids.length; start += AAM_INTENT_ORDER_CHUNK) {
    const where: Where = {
      and: [
        { order: { in: ids.slice(start, start + AAM_INTENT_ORDER_CHUNK) } },
        { state: { equals: 'committed' } },
      ],
    }
    let complete = false
    for (let page = 1; page <= AAM_MAX_PAGES; page += 1) {
      const result = await find({ where, page, limit: AAM_PAGE_SIZE })
      intents.push(...result.docs)
      if (result.docs.length < AAM_PAGE_SIZE || result.hasNextPage === false) {
        complete = true
        break
      }
    }
    if (!complete) {
      logger.warn(
        'alanyi adómentes keret: a lezárt visszatérítések nem olvashatók be teljesen, a hiányzók a keretben maradnak',
        { module: 'alerts/aam', year },
      )
    }
  }
  return committedSequencesByOrder(intents)
}

/**
 * A `find`-hez kért mezők: a helyesbítős levonáshoz a `refunds`, a helyesbítő
 * sorszáma és száma, a lezárt szándékokhoz az azonosító kell (lásd
 * `evidencedCorrectiveRefunds`); a snapshot nélküli régi rendelés összegéhez
 * a tételek és az `amount` (lásd `invoicedAmountHuf`).
 */
export const AAM_ORDER_SELECT = {
  id: true,
  totalHufSnapshot: true,
  items: true,
  amount: true,
  invoiceStatus: true,
  invoiceCompletionDate: true,
  stornoStatus: true,
  correctiveInvoiceSeq: true,
  correctiveInvoiceNumber: true,
  refunds: true,
} as const

/**
 * A Payload Local API-ra épülő források (a hívó dönti el a jogosultságot:
 * rendszer-futásnál `overrideAccess`, a Figyelmet igényel blokkban a
 * tulajdonos saját jogai).
 */
export function payloadAamFind(
  payload: Pick<Payload, 'find'>,
  access: { overrideAccess: true } | { overrideAccess: false; user: unknown },
): AamSources {
  return {
    orders: async ({ where, page, limit }) => {
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
    },
    committedIntents: async ({ where, page, limit }) => {
      const result = await payload.find({
        collection: 'refund-intents',
        where,
        page,
        limit,
        depth: 0,
        sort: 'id',
        select: COMMITTED_INTENT_SELECT,
        ...access,
      } as unknown as Parameters<Payload['find']>[0])
      return { docs: result.docs as readonly unknown[], hasNextPage: result.hasNextPage }
    },
  }
}

/** Egy sor a levélbe és a képernyőre: „2026: 3 180 000 Ft a 20 000 000 Ft-os keretből (16%)". */
export function formatAamLine(status: AamStatus): string {
  const percent = Math.floor(status.ratio * 100)
  const base = `${String(status.year)}: ${status.netHuf.toLocaleString('hu-HU')} Ft a ${status.limitHuf.toLocaleString('hu-HU')} Ft-os keretből (${String(percent)}%)`
  return status.limitVerified ? base : `${base}, a tárgyévi értékhatár ellenőrizendő`
}
