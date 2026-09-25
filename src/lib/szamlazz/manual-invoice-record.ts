import type { Payload } from 'payload'

import type { Order } from '../../payload-types'
import { withAdvisoryLock } from '../advisory-lock'
import { auditLogStore, writeAuditLog } from '../audit'
import { budapestDateString, isIsoDateString } from '../date/budapest'
import { formatPriceHuf } from '../format-price'
import { logger as rootLogger, type Logger } from '../logger'
import { resolveOrderPaidMoment } from './paid-date'

/**
 * A Számlázz.hu-ban megtalált vagy kézzel kiállított számla számának kézi
 * rögzítése egy 'failed' számlájú rendelésen (W1B-3, W1B-7; a tulajdonosi
 * admin-művelet később a w2 H2).
 *
 * Miért kell: a K12 kapu (src/lib/refund/invoice-gate.ts) a tulajdonosi
 * visszatérítést csak kiállított számla után engedi. Ha a számla automatikus
 * kiállítása 'failed' lett (végleges Számlázz.hu-elutasítás, kimerült
 * kísérletek, INVOICE_AUTOMATION_STOPPED), a tulajdonos előbb megkeresi a
 * számlát a Számlázz.hu-ban (egy korábbi beküldés létrehozhatta), és csak ha
 * nincs meg, állítja ki kézzel a 05-ös útmutató szerint. A rendelés számlázási
 * mezői rendszer-írásúak (access/system-written.ts), ezért a megtalált vagy
 * kézzel kiállított számla számát az üzemeltető ezzel a modullal rögzíti
 * (`npm run record:manual-invoice`). Az 'issued' állapot után a kapu magától
 * kinyílik, és a szokásos visszatérítés a valódi számlához készít stornót vagy
 * helyesbítőt.
 *
 * A talált számla csak akkor ennek a rendelésnek a számlája, ha a vevő neve és
 * a végösszeg is egyezik (a tulajdonos a Számlázz.hu-ban ellenőrzi; 05-ös
 * útmutató, 1. pont). A rendelésszám nem egyedi (src/lib/order-number.ts: az
 * év legnagyobb sorszámából képződik), egy törölt utolsó rendelés vagy
 * adatbázis-visszaállítás után egy korábbi, más vevő számlája is ugyanazt
 * viselheti. A rossz szám végleges kárt okoz: a valódi eladás számla nélkül
 * marad, a visszatérítés stornója vagy helyesbítője pedig egy idegen számlát
 * érvénytelenít vagy módosít. Amit a modul ebből ellenőrizni tud: a szám
 * egyedisége a még meglévő rendelések között, a teljesítés dátuma nem
 * korábbi a rendelés napjánál, és hangosan figyelmeztet, ha a számlakiállító
 * éppen ezt a számot utasította el mint nem egyeztethetőt (a hibaszöveg
 * említi). A vevő nevét és a végösszeget a próbafutás kimenete mellett az
 * ember veti össze.
 *
 * Amit szándékosan NEM tesz:
 * - a 'failed' állapotot nem állítja vissza 'pending'-re: a leállt vagy kézzel
 *   pótolt számla mellé egy újabb automatikus beküldés dupla NAV-számla lenne
 *   (invoice.ts, INVOICE_AUTOMATION_STOPPED);
 * - az `invoiceLastError`-t nem törli: a sikertelenség oka a rendelésen
 *   látható marad;
 * - 'none', 'pending' vagy már kiállított számlájú rendelésen nem ír: ott a
 *   számlajob még dolgozhat, vagy már van szám, és egy második szám kettős
 *   számlát jelentene.
 *
 * A teljesítés dátuma KÖTELEZŐ (W1B-3 törő B2): a számlán mindig ott áll, és
 * két adóügyi fogyasztó olvassa. Az alanyi adómentességi keret számlálója
 * (alerts/aam.ts) csak teljesítési dátummal számolja a rendelést, a későbbi
 * helyesbítő pedig az eredeti teljesítési dátumot ismétli (NAV: a helyesbítő
 * teljesítési hónapja nem térhet el). A dátum nem lehet jövőbeli, és nem lehet
 * korábbi a rendelés létrehozásának budapesti napjánál (évszám-elütés).
 *
 * Párhuzamosság: az írás ugyanazon az advisory-záron fut, mint a számla
 * kiállítása (`invoice:<orderId>`, invoice.ts issueInvoiceForOrder). A két
 * kulcsnak EGYEZNIE KELL; ezt teszt őrzi
 * (src/__tests__/szamlazz/w1b-r1-2-manual-invoice-record.test.ts). A zár alatt
 * a rendelés újraolvasva megy át minden feltételen, így egy közben lefutó
 * számlajob vagy egy második futtatás nem ír felül semmit. A zár után egy még
 * sorban álló számlajob az 'issued' állapotot látja, és no-op marad
 * (invoice.ts: „már kiállították a számlát”).
 */

export const MANUAL_INVOICE_RECORD_AUDIT_ACTION = 'invoice-manual-record'

/** A rögzíthető számlaszám felső hossza (a Számlázz.hu sorszámai ennél jóval rövidebbek). */
export const MANUAL_INVOICE_NUMBER_MAX_LENGTH = 64

/** A futást végző eszköz a műveletnapló `recordedBy` mezőjében (CLI-ből nincs bejelentkezett felhasználó). */
export const MANUAL_INVOICE_RECORDED_BY = 'script:record-manual-invoice'

/** Az advisory-zár kulcsa: SZÓ SZERINT ugyanaz, mint az invoice.ts issueInvoiceForOrder kulcsa. */
export function invoiceIssueLockKey(orderId: number): string {
  return `invoice:${orderId}`
}

export interface RecordManualInvoiceInput {
  payload: Payload
  orderNumber: string
  invoiceNumber: string
  /** A kézi számla teljesítési dátuma (YYYY-MM-DD), a számláról másolva. Kötelező. */
  completionDate: string
  /** Igaz: csak kiírja, mit tenne; semmit nem ír. */
  dryRun: boolean
  /** A beállított számlaszám-előtag (SZAMLAZZ_INVOICE_PREFIX); eltérésnél figyelmeztet. */
  invoicePrefix?: string
  /** Aki a futást indította (a CLI-ben az operációs rendszer felhasználója); a műveletnaplóba kerül. */
  operator?: string | null
  logger?: Logger
}

export interface ManualInvoiceOrderState {
  status: string | null
  invoiceStatus: string | null
  invoiceNumber: string | null
  invoiceCompletionDate: string | null
  invoiceLastError: string | null
}

/** A rendelés adatai, amelyeket az üzemeltető a kézi számlával összevet. */
export interface ManualInvoiceOrderFacts {
  /** A végösszeg a megrendeléskor (Ft); ennyiről szól a számla. */
  totalHuf: number | null
  /** A fizetés (hozzáférés-nyitás) budapesti napja: a számla teljesítési dátuma. */
  paidDate: string | null
  /** A rendelés eddigi visszatérítései. */
  refunds: Array<{ amountHuf: number; refundedAt: string; type: string }>
}

export type RecordManualInvoiceResult =
  | {
      status: 'refused'
      reasons: string[]
      warnings: string[]
    }
  | {
      status: 'dry-run' | 'recorded'
      orderId: number
      orderNumber: string
      invoiceNumber: string
      completionDate: string
      before: ManualInvoiceOrderState
      facts: ManualInvoiceOrderFacts
      warnings: string[]
      /** Csak 'recorded' esetén értelmes: bekerült-e a műveletnaplóba. */
      auditRecorded: boolean
    }

function orderState(order: Order): ManualInvoiceOrderState {
  return {
    status: order.status ?? null,
    invoiceStatus: order.invoiceStatus ?? null,
    invoiceNumber: order.invoiceNumber ?? null,
    invoiceCompletionDate: order.invoiceCompletionDate ?? null,
    invoiceLastError: order.invoiceLastError ?? null,
  }
}

/** Szóköz, tabulátor vagy sortörés a számban. */
const WHITESPACE = /\s/u

/**
 * A Számlázz.hu sorszáma ELŐTAG-ÉV-SORSZÁM alakú, például „ABC-2012-1”; az
 * e-számla száma „E-” kezdetű („E-ABC-2012-1”). Az előtag legfeljebb 5
 * karakter, ékezet nélküli nagybetű vagy számjegy, kötőjel nélkül
 * (https://tudastar.szamlazz.hu/gyik/szamlaszam-formatumok-mikor-kell-megadni,
 * https://tudastar.szamlazz.hu/gyik/elotagok-beallitasa-uj-szamlatomb-hasznalatahoz).
 *
 * Két lépésben ellenőrzünk, hogy az ok pontos legyen (GOV.UK Error message:
 * „Be specific”). Előbb a jelkészlet: a sorszámban csak nagybetű, számjegy
 * és kötőjel állhat. Ez fogja meg a PDF-ből másolt kötőjel-hasonmást (U+2010,
 * U+2011, U+2013), a cirill betűt, a kisbetűt és a csevegőüzenetből a szám
 * végére került pontot, vesszőt, zárójelet vagy idézőjelet. Utána az alak. A
 * hiba különben csak a visszatérítés UTÁN, a stornó vagy a helyesbítő
 * beküldésekor derülne ki: addigra a pénz visszament, a rossz szám pedig
 * végleg a rendelésen maradna (a mezők kézzel nem írhatók).
 */
const SERIAL_CHARACTERS = /^[A-Z0-9-]+$/u
const SERIAL_SHAPE = /^(?:E-)?([A-Z0-9]{1,5})-[0-9]{4}-[0-9]+$/u

/** A bemenet ellenőrzése adatbázis nélkül: a hibák listája (üres, ha rendben). */
export function validateManualInvoiceInput(input: {
  invoiceNumber: string
  completionDate: string
}): string[] {
  const reasons: string[] = []
  const number = input.invoiceNumber.trim()
  if (number.length === 0) {
    reasons.push('A számla száma üres. Add meg a kézzel kiállított számla sorszámát.')
  } else {
    if (number.length > MANUAL_INVOICE_NUMBER_MAX_LENGTH) {
      reasons.push(
        `A számla száma túl hosszú (${String(number.length)} karakter, legfeljebb ${String(MANUAL_INVOICE_NUMBER_MAX_LENGTH)}). Ellenőrizd, hogy csak a sorszámot adtad-e meg.`,
      )
    }
    if (WHITESPACE.test(number)) {
      reasons.push(
        'A számla számában szóköz vagy sortörés van. Másold ki pontosan a Számlázz.hu-ból a sorszámot.',
      )
    } else if (!SERIAL_CHARACTERS.test(number)) {
      reasons.push(
        'A számla számában olyan jel van, amely a Számlázz.hu sorszámában nem fordul elő (például a végére került pont vagy vessző, kisbetű, PDF-ből másolt, kötőjelnek látszó jel vagy cirill betű). A sorszámban csak ékezet nélküli nagybetű, számjegy és kötőjel áll: írd be kézzel, vagy másold ki a Számlázz.hu felületéről.',
      )
    } else if (!SERIAL_SHAPE.test(number)) {
      reasons.push(
        `A számla száma (${number}) nem a Számlázz.hu sorszámának alakja: előtag (legfeljebb 5 nagybetű vagy számjegy), négyjegyű év és sorszám, kötőjellel elválasztva, e-számlán E- kezdettel, például E-KIN-2026-42. Ellenőrizd, hogy a teljes sorszámot másoltad-e ki.`,
      )
    }
  }
  const date = typeof input.completionDate === 'string' ? input.completionDate.trim() : ''
  if (date.length === 0) {
    reasons.push(
      'Hiányzik a teljesítés dátuma. Add meg a kézi számlán álló teljesítési dátumot (--teljesites ÉÉÉÉ-HH-NN): ehhez igazodik a későbbi helyesbítő számla és az alanyi adómentességi keret számlálója.',
    )
  } else if (!isIsoDateString(date)) {
    reasons.push(
      `A teljesítés dátuma nem ÉÉÉÉ-HH-NN alakú valós dátum (${date}). Például: 2026-09-24.`,
    )
  } else if (date > budapestDateString()) {
    reasons.push(
      `A teljesítés dátuma a jövőben van (${date}). A kézi számla teljesítési dátumát add meg.`,
    )
  }
  return reasons
}

/**
 * Eltér-e a szám előtagja a beállítottól. A Számlázz.hu sorszáma
 * „<előtag>-<év>-<sorszám>”, e-számlán „E-<előtag>-…” (pl. „E-KIN-2026-12”):
 * az előtagot a sorszám alakjából olvassuk ki, és pontosan vetjük össze, így
 * a „KINB-…” vagy az „E-AKIN-…” sem megy át „KIN”-ként. Hibás alakú számnál
 * nem figyelmeztet: azt a bemenet-ellenőrzés elutasítja.
 */
function lacksPrefix(invoiceNumber: string, prefix: string | undefined): boolean {
  const wanted = prefix?.trim() ?? ''
  if (wanted === '') return false
  const actual = SERIAL_SHAPE.exec(invoiceNumber)?.[1]
  return actual !== undefined && actual !== wanted
}

/**
 * Említi-e a szöveg a számot önálló szóként (a „KIN-2026-4” nem találat a
 * „KIN-2026-42”-ben). A Számlázz.hu sorszámának jelei a nagybetű, a számjegy
 * és a kötőjel, ezért a határ minden más jel vagy a szöveg széle.
 */
function mentionsInvoiceNumber(text: string | null | undefined, invoiceNumber: string): boolean {
  if (!text || invoiceNumber === '') return false
  const escaped = invoiceNumber.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(?:^|[^A-Za-z0-9-])${escaped}(?:$|[^A-Za-z0-9-])`, 'u').test(text)
}

/** Egy ISO időpont budapesti naptári napja; null, ha az érték nem olvasható. */
export function budapestDay(value: unknown): string | null {
  const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isNaN(ms) ? null : budapestDateString(new Date(ms))
}

/** Forintösszeg az üzemeltetői kimenethez; a nem értelmezhető érték nem állítja meg a futást. */
export function manualInvoiceHuf(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? formatPriceHuf(value)
    : 'ismeretlen összeg'
}

/** Az állapot-feltételek a zár alatt újraolvasott rendelésen. */
function orderReasons(order: Order, completionDate: string): string[] {
  const reasons: string[] = []
  if (order.status === 'refunded') {
    reasons.push(
      'A rendelés már visszatérített. Visszatérített rendelésen a számla rögzítése külön döntést igényel (stornó is kell hozzá), ezt ez az eszköz nem végzi. Jelezd a fejlesztőnek.',
    )
  } else if (order.status !== 'paid') {
    reasons.push(
      `A rendelés nem fizetett állapotú (${order.status ?? 'ismeretlen'}), ezért számla sem rögzíthető rajta.`,
    )
  }
  const existing = order.invoiceNumber?.trim() ?? ''
  if (existing.length > 0) {
    reasons.push(
      `A rendelésen már áll számlaszám (${existing}). Második számot nem rögzítünk, mert az kettős számlát jelentene.`,
    )
  }
  switch (order.invoiceStatus) {
    case 'failed':
      break
    case 'issued':
      reasons.push('A rendelés számlája már kiállított állapotú, nincs mit rögzíteni.')
      break
    case 'pending':
      reasons.push(
        'A számla automatikus kiállítása még folyamatban van. Várd meg, amíg a számla elkészül vagy végleg sikertelen lesz; most egy kézi szám mellé a rendszer is kiállíthatna egy számlát.',
      )
      break
    default:
      reasons.push(
        'A rendelésnél a számla automatikus kiállítása el sem indult (vagy a számlázás ki van kapcsolva). Ilyenkor a rendszer még kiállíthatja a számlát, ezért kézi szám nem rögzíthető.',
      )
  }
  // A formátumhibát a bemenet-ellenőrzés már jelezte; itt csak a valós dátum
  // alsó határa számít: a teljesítés nem előzheti meg a rendelést.
  if (isIsoDateString(completionDate)) {
    const created = budapestDay(order.createdAt)
    if (created === null) {
      reasons.push(
        'A rendelés létrehozásának ideje nem olvasható, ezért a teljesítés dátuma nem ellenőrizhető. Jelezd a fejlesztőnek.',
      )
    } else if (completionDate < created) {
      reasons.push(
        `A teljesítés dátuma (${completionDate}) korábbi, mint a rendelés létrehozásának napja (${created}). Ellenőrizd a kézi számlán a dátumot, különösen az évszámot. Ha a dátum jó, a számla nem ehhez a rendeléshez tartozik: a rendelésszámot egy korábbi, azóta törölt vagy adatbázis-visszaállításkor elveszett rendelés is viselhette, és a talált számla annak az eladásnak a számlája. Ezt a számot ne rögzítsd, szólj a fejlesztőnek.`,
      )
    }
  }
  return reasons
}

/** Másik rendelés hordozza-e már ezt a számot (számla, stornó vagy helyesbítő). */
async function numberUsedElsewhere(
  payload: Payload,
  orderId: number,
  invoiceNumber: string,
): Promise<string[]> {
  const found = await payload.find({
    collection: 'orders',
    where: {
      and: [
        { id: { not_equals: orderId } },
        {
          or: [
            { invoiceNumber: { equals: invoiceNumber } },
            { stornoNumber: { equals: invoiceNumber } },
            { correctiveInvoiceNumber: { equals: invoiceNumber } },
          ],
        },
      ],
    },
    depth: 0,
    limit: 5,
    overrideAccess: true,
  })
  return found.docs
    .filter((doc) => doc.id !== orderId)
    .map((doc) => doc.orderNumber ?? `#${String(doc.id)}`)
}

async function findSingleOrder(
  payload: Payload,
  orderNumber: string,
): Promise<{ order: Order } | { reason: string }> {
  const found = await payload.find({
    collection: 'orders',
    where: { orderNumber: { equals: orderNumber } },
    depth: 0,
    limit: 2,
    overrideAccess: true,
  })
  const matches = found.docs.filter((doc) => doc.orderNumber === orderNumber)
  if (matches.length === 0 || found.totalDocs === 0) {
    return { reason: `Nincs ${orderNumber} rendelésszámú rendelés.` }
  }
  if (matches.length > 1 || found.totalDocs > 1) {
    return {
      reason: `Több rendelés is ${orderNumber} rendelésszámú. Ilyenkor nem rögzítünk semmit; jelezd a fejlesztőnek.`,
    }
  }
  return { order: matches[0] as Order }
}

/** A kézi számlával összevetendő adatok a zár alatt újraolvasott rendelésből. */
async function orderFacts(
  payload: Payload,
  order: Order,
  log: Logger,
): Promise<{ facts: ManualInvoiceOrderFacts; paidDateReadable: boolean }> {
  let paidDate: string | null = null
  let paidDateReadable = true
  try {
    paidDate = (await resolveOrderPaidMoment(payload, order))?.paidDate ?? null
  } catch (error) {
    paidDateReadable = false
    log.warn('kézi számlaszám rögzítése: a fizetés napja nem olvasható', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  const total = order.totalHufSnapshot
  return {
    facts: {
      totalHuf: typeof total === 'number' && Number.isFinite(total) ? total : null,
      paidDate,
      refunds: (order.refunds ?? []).map((entry) => ({
        amountHuf: entry.amountHuf,
        refundedAt: entry.refundedAt,
        type: entry.type,
      })),
    },
    paidDateReadable,
  }
}

/** Figyelmeztetések, amelyek nem akadályozzák az írást, de az üzemeltetőnek látnia kell őket. */
function factWarnings(
  facts: ManualInvoiceOrderFacts,
  paidDateReadable: boolean,
  completionDate: string,
): string[] {
  const warnings: string[] = []
  if (!paidDateReadable) {
    warnings.push(
      'A fizetés napja most nem olvasható, ezért nem tudtam összevetni a teljesítés dátumával. Ellenőrizd a kézi számlán.',
    )
  } else if (facts.paidDate !== null && facts.paidDate !== completionDate) {
    warnings.push(
      `A megadott teljesítési dátum (${completionDate}) eltér a fizetés napjától (${facts.paidDate}). Ellenőrizd, hogy a kézi számlán valóban ez áll-e; a 05-ös útmutató szerint a teljesítés dátuma a fizetés napja.`,
    )
  }
  if (facts.refunds.length > 0) {
    const list = facts.refunds
      .map(
        (entry) =>
          `${budapestDay(entry.refundedAt) ?? 'ismeretlen nap'}: ${manualInvoiceHuf(entry.amountHuf)}`,
      )
      .join(', ')
    warnings.push(
      `A rendelésen már van visszatérítés (${list}). A kézi számla a megrendeléskori végösszegről szóljon, és ellenőrizd, hogy a visszatérítéshez elkészült-e a helyesbítő számla (05-ös útmutató, 4. pont).`,
    )
  }
  return warnings
}

/**
 * A kézi számlaszám rögzítése. Próbafutásban (`dryRun`) csak kiértékel;
 * éles futásban a zár alatt újraolvasott rendelésen ír, és egy
 * műveletnapló-sort hagy. Sosem ír, ha bármelyik feltétel nem teljesül.
 */
export async function recordManualInvoiceNumber(
  input: RecordManualInvoiceInput,
): Promise<RecordManualInvoiceResult> {
  const orderNumber = input.orderNumber.trim()
  const invoiceNumber = input.invoiceNumber.trim()
  // A típus kötelezővé teszi, de egy JavaScript-hívó (vagy a jövőbeli admin-
  // művelet hibás űrlapja) kihagyhatja: ilyenkor is elutasítás legyen, ne
  // TypeError és ne dátum nélküli rögzítés.
  const completionDate = typeof input.completionDate === 'string' ? input.completionDate.trim() : ''
  const log = (input.logger ?? rootLogger).child({
    module: 'manual-invoice-record',
    orderNumber,
    invoiceNumber,
  })

  const warnings: string[] = []
  if (invoiceNumber.length > 0 && lacksPrefix(invoiceNumber, input.invoicePrefix)) {
    warnings.push(
      `A számla száma nem a beállított „${input.invoicePrefix ?? ''}” előtaggal szerepel. Ellenőrizd, hogy valóban ennek a rendelésnek a Kineticare-számláját adtad-e meg.`,
    )
  }

  const inputReasons = validateManualInvoiceInput({ invoiceNumber, completionDate })
  if (orderNumber.length === 0) inputReasons.unshift('A rendelésszám üres.')
  if (orderNumber.length === 0) return { status: 'refused', reasons: inputReasons, warnings }

  const lookup = await findSingleOrder(input.payload, orderNumber)
  if ('reason' in lookup) {
    return { status: 'refused', reasons: [...inputReasons, lookup.reason], warnings }
  }
  const orderId = lookup.order.id

  return withAdvisoryLock(
    input.payload,
    invoiceIssueLockKey(orderId),
    async (): Promise<RecordManualInvoiceResult> => {
      // A zár alatt újraolvasva: a próbafutás és az éles futás között (vagy
      // egy közben lefutó számlajob után) a rendelés megváltozhatott.
      const order = (await input.payload.findByID({
        collection: 'orders',
        id: orderId,
        depth: 0,
        overrideAccess: true,
      })) as Order | null
      if (!order || order.orderNumber !== orderNumber) {
        return {
          status: 'refused',
          reasons: [...inputReasons, `Nincs ${orderNumber} rendelésszámú rendelés.`],
          warnings,
        }
      }
      // A számlakiállító a nem egyeztethető (idegen vagy sztornózott) talált
      // bizonylat számát a hibaszövegbe írja, és nem veszi át. Ha az
      // üzemeltető éppen ezt rögzítené, az csak akkor helyes, ha a tulajdonos
      // meggyőződött róla, hogy mégis ennek a rendelésnek a számlája (a
      // lekérdezés például nem hozott végösszeget); ezért hangos figyelmeztetés,
      // nem tiltás.
      if (mentionsInvoiceNumber(order.invoiceLastError, invoiceNumber)) {
        warnings.unshift(
          `A rendelés „Számlázás utolsó hibája” mezője éppen ezt a számot (${invoiceNumber}) említi: a rendszer ezt a bizonylatot nem tudta ehhez a rendeléshez kötni, ezért nem vette át. Csak akkor rögzítsd, ha a tulajdonos a Számlázz.hu-ban ellenőrizte, hogy ennek a rendelésnek a számlája: a vevő neve és a végösszeg is ugyanaz, mint a rendelésen. Ha más vevőé, ne rögzítsd, és szólj a fejlesztőnek.`,
        )
      }
      const reasons = [...inputReasons, ...orderReasons(order, completionDate)]
      if (invoiceNumber.length > 0) {
        const others = await numberUsedElsewhere(input.payload, order.id, invoiceNumber)
        if (others.length > 0) {
          reasons.push(
            `Ez a számlaszám már egy másik rendelésen áll (${others.join(', ')}). Egy számla csak egy rendeléshez tartozhat; ellenőrizd a számot.`,
          )
        }
      }
      if (reasons.length > 0) {
        log.warn('kézi számlaszám rögzítése elutasítva', { reasonCount: reasons.length })
        return { status: 'refused', reasons, warnings }
      }

      const before = orderState(order)
      const { facts, paidDateReadable } = await orderFacts(input.payload, order, log)
      warnings.push(...factWarnings(facts, paidDateReadable, completionDate))
      if (input.dryRun) {
        return {
          status: 'dry-run',
          orderId: order.id,
          orderNumber,
          invoiceNumber,
          completionDate,
          before,
          facts,
          warnings,
          auditRecorded: false,
        }
      }

      const updated = (await input.payload.update({
        collection: 'orders',
        id: order.id,
        data: {
          invoiceStatus: 'issued',
          invoiceNumber,
          invoiceCompletionDate: completionDate,
        },
        depth: 0,
        overrideAccess: true,
      })) as Order
      if (
        updated.invoiceStatus !== 'issued' ||
        updated.invoiceNumber !== invoiceNumber ||
        updated.invoiceCompletionDate !== completionDate
      ) {
        throw new Error(
          `A rendelés mentése után a számla állapota nem a várt (${String(updated.invoiceStatus)}); a rögzítés nem biztos, nézd meg a rendelést.`,
        )
      }
      log.info('a számla sorszáma kézzel rögzítve a rendelésen', {
        orderId: order.id,
        completionDate,
      })

      const auditRecorded = await writeAuditLog({
        store: auditLogStore(input.payload),
        actor: null,
        action: MANUAL_INVOICE_RECORD_AUDIT_ACTION,
        entityType: 'orders',
        entityId: order.id,
        before: {
          invoiceStatus: before.invoiceStatus,
          invoiceNumber: before.invoiceNumber,
          invoiceCompletionDate: before.invoiceCompletionDate,
          invoiceLastError: before.invoiceLastError,
        },
        after: {
          version: 1,
          orderId: order.id,
          orderNumber,
          invoiceStatus: 'issued',
          invoiceNumber,
          invoiceCompletionDate: completionDate,
          recordedBy: MANUAL_INVOICE_RECORDED_BY,
          operator: input.operator?.trim() || null,
          recordedAt: new Date().toISOString(),
        },
      })
      if (!auditRecorded) {
        log.error(
          'a kézi számlaszám rögzítve, de a műveletnaplóba nem került be; a futás kimenetét őrizd meg bizonyítéknak',
          { orderId: order.id },
        )
      }
      return {
        status: 'recorded',
        orderId: order.id,
        orderNumber,
        invoiceNumber,
        completionDate,
        before,
        facts,
        warnings,
        auditRecorded,
      }
    },
    log,
  )
}
