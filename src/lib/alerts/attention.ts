/**
 * „Figyelmet igényel": a tulajdonosi teendők EGY definíciója.
 *
 * Ugyanezt olvassa a reggeli napi összesítő (`src/lib/alerts/digest.ts`) és
 * az admin Irányítópult „Figyelmet igényel" blokkja
 * (`src/components/admin/FigyelmetIgenyel.tsx`), így a levél és a képernyő
 * ugyanazt a számot mutatja, és a képernyő linkje pontosan azt a szűrt
 * listát nyitja meg, amelyből a szám jön (a link a `where` feltételből épül).
 *
 * SÉMA NÉLKÜL. Minden feltétel meglévő mezőn fut (orders, refund-intents,
 * webhook-events), új mező és migráció nem kell. Ennek ára: a rendszerben
 * nincs „kézzel rendezve" jelölés. Ezért a három olyan kategória, amelyet a
 * tulajdonos csak a rendszeren KÍVÜL tud rendezni (sikertelen bizonylat,
 * elakadt visszatérítés, hibás webhook-esemény), csak az utolsó
 * `ATTENTION_LOOKBACK_DAYS` napban érintett sorokat számolja; különben egy
 * kézzel rendezett régi ügy örökké napi levelet küldene. A két „magától
 * rendeződő" kategória (számla nélküli fizetett rendelés, függő fizetés)
 * időkorlát nélkül számol: amíg nem rendeződik, jelezni kell.
 *
 * A küszöbök (feladat-előírás, r2-riasztas):
 *  - fizetett, de a számla 2 óra után sincs kiállítva;
 *  - payment_pending 1 óránál régebben (24 óra fölött külön számolva);
 *  - sikertelen számla, stornó vagy helyesbítő, és visszatérítésenként a
 *    hiányzó helyesbítő (lásd `missingCorrectiveSequences`);
 *  - visszatérítési szándék nem lezárt állapotban (prepared, provider_started,
 *    provider_unknown, provider_succeeded, manual_review) 15 percnél régebben;
 *  - sikertelen vagy kimerült (5 próbálkozás) webhook-esemény.
 */

import type { Payload, Where } from 'payload'

import { MAX_WEBHOOK_ATTEMPTS } from '../idempotency'
import { REFUND_INTENT_UNRESOLVED_STATES } from '../refund/refund-intent'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** Ennyi idő után hiányolunk számlát a fizetett rendelésről. */
export const INVOICE_MISSING_AFTER_MS = 2 * HOUR_MS
/** Ennyi idő után számít a függő fizetés teendőnek. */
export const PENDING_PAYMENT_AFTER_MS = HOUR_MS
/** Ennyi idő után azonnali riasztás is megy a függő fizetésről. */
export const PENDING_PAYMENT_ALERT_AFTER_MS = DAY_MS
/** Ennyi idő után számít elakadtnak a visszatérítési szándék. */
export const REFUND_INTENT_STUCK_AFTER_MS = 15 * MINUTE_MS
/** A kézzel rendezhető kategóriák visszatekintési ablaka (napokban). */
export const ATTENTION_LOOKBACK_DAYS = 14

/**
 * Nem lezárt visszatérítési szándékok (a refund-intents `state` értékei): a
 * refund-állapotgép feloldatlan állapotai (`REFUND_INTENT_UNRESOLVED_STATES`),
 * így egy új feloldatlan állapot magától ide kerül.
 *
 * A `provider_succeeded` IS ide tartozik: a Barion-siker már rögzítve van, de
 * a helyi lezárás (rendelés, hozzáférés, bizonylat, `committed`) elmaradt, pl.
 * mert a folyamat közben leállt. Amíg a rendelésen az ellenőrzés nem fut le,
 * a pénz visszament, a rendelés viszont nem mutatja.
 *
 * A `provider_failed` NEM: tárolt `provider_failed` sor csak igazoltan hatás
 * nélküli bizonyítékkal létezhet (a refund-intent tároló `parseIntent`-je a
 * bizonyíték nélkülit érvénytelennek veszi, és az állapotgép sem enged oda
 * bizonyíték nélkül), az pedig lezárt kísérlet.
 */
export const STUCK_REFUND_INTENT_STATES: readonly string[] = REFUND_INTENT_UNRESOLVED_STATES.filter(
  (state) => state !== 'provider_failed',
)

export type AttentionKey =
  | 'fizetettSzamlaNelkul'
  | 'fuggoFizetes'
  | 'fuggoFizetesRegi'
  | 'bizonylatHiba'
  | 'visszateritesElakadt'
  | 'webhookHiba'

export type AttentionCollection = 'orders' | 'refund-intents' | 'webhook-events'

export interface AttentionDefinition {
  readonly key: AttentionKey
  readonly collection: AttentionCollection
  readonly where: Where
  /** Rövid, a számmal együtt olvasandó címke (a szám elé kerül). */
  readonly label: string
  /** Egy mondat: mit jelent, és mi a teendő. */
  readonly teendo: string
  /**
   * Részhalmaz-e (a `fuggoFizetesRegi` a `fuggoFizetes` része): az
   * összesítésnél nem adódik hozzá még egyszer.
   */
  readonly reszhalmaz?: boolean
}

export type AttentionCounts = Readonly<Record<AttentionKey, number>>

function isoBefore(nowMs: number, ageMs: number): string {
  return new Date(nowMs - ageMs).toISOString()
}

export interface AttentionDefinitionOptions {
  /**
   * Azok a rendelések, amelyeken legalább egy visszatérítés helyesbítője
   * hiányzik (`missingCorrectiveOrderIds`). A bizonylathiba-feltétel ezekre
   * azonosító szerint szűr, így a szám és a link ugyanazt a listát adja.
   */
  readonly missingCorrectiveOrderIds?: readonly (number | string)[]
}

/**
 * A kategóriák definíciója egy adott pillanatra. A `where` mindig a Payload
 * szűrő-felületének kanonikus alakja (`or` → `and` → feltételek), hogy a
 * linkkel megnyitott listán a szűrő is látsszon és szerkeszthető legyen.
 */
export function attentionDefinitions(
  nowMs: number,
  options: AttentionDefinitionOptions = {},
): readonly AttentionDefinition[] {
  const lookbackIso = isoBefore(nowMs, ATTENTION_LOOKBACK_DAYS * DAY_MS)
  const recent = { updatedAt: { greater_than_equal: lookbackIso } }
  const missingCorrectiveIds = [...(options.missingCorrectiveOrderIds ?? [])]
  return [
    {
      key: 'fizetettSzamlaNelkul',
      collection: 'orders',
      where: {
        or: [
          {
            and: [
              { status: { equals: 'paid' } },
              { invoiceStatus: { in: ['none', 'pending'] } },
              { createdAt: { less_than: isoBefore(nowMs, INVOICE_MISSING_AFTER_MS) } },
            ],
          },
        ],
      },
      label: 'fizetett rendelés számla nélkül',
      teendo:
        'Két óránál régebben fizettek, de a számla még nincs kiállítva. Nézd meg a Számlázz.hu-t és a számlázás beállítását.',
    },
    {
      key: 'fuggoFizetes',
      collection: 'orders',
      where: {
        or: [
          {
            and: [
              { status: { equals: 'payment_pending' } },
              { createdAt: { less_than: isoBefore(nowMs, PENDING_PAYMENT_AFTER_MS) } },
            ],
          },
        ],
      },
      label: 'függő fizetés egy óránál régebben',
      teendo:
        'A Barion-fizetés egy óra után sem zárult le. Ha a vevő szerint fizetett, nézd meg a Barion-fiókban.',
    },
    {
      key: 'fuggoFizetesRegi',
      collection: 'orders',
      where: {
        or: [
          {
            and: [
              { status: { equals: 'payment_pending' } },
              { createdAt: { less_than: isoBefore(nowMs, PENDING_PAYMENT_ALERT_AFTER_MS) } },
            ],
          },
        ],
      },
      label: 'egy napnál régebbi',
      teendo:
        'Egy napja nem dőlt el a fizetés. Ellenőrizd a Barion-fiókban, és ha a pénz megjött, szólj a fejlesztőnek.',
      reszhalmaz: true,
    },
    {
      key: 'bizonylatHiba',
      collection: 'orders',
      where: {
        or: [
          { and: [{ invoiceStatus: { equals: 'failed' } }, recent] },
          { and: [{ stornoStatus: { equals: 'failed' } }, recent] },
          { and: [{ correctiveInvoiceStatus: { equals: 'failed' } }, recent] },
          ...(missingCorrectiveIds.length > 0
            ? [{ and: [{ id: { in: missingCorrectiveIds } }] }]
            : []),
        ],
      },
      label: 'sikertelen számla, stornó vagy helyesbítő',
      teendo: `Az utolsó ${ATTENTION_LOOKBACK_DAYS} napban a rendszer nem tudta kiállítani a bizonylatot. Állítsd ki kézzel a Számlázz.hu-ban. Ha a rendelésen több visszatérítés volt, egy korábbi helyesbítő akkor is hiányozhat, ha a legutóbbi kiállítottnak látszik.`,
    },
    {
      key: 'visszateritesElakadt',
      collection: 'refund-intents',
      where: {
        or: [
          {
            and: [
              { state: { in: [...STUCK_REFUND_INTENT_STATES] } },
              { createdAt: { less_than: isoBefore(nowMs, REFUND_INTENT_STUCK_AFTER_MS) } },
              recent,
            ],
          },
        ],
      },
      label: 'elakadt visszatérítés',
      teendo:
        'A visszatérítés 15 perc után sem zárult le. Nézd meg a Barion-fiókban, megtörtént-e, és a rendelésen futtasd az ellenőrzést.',
    },
    {
      key: 'webhookHiba',
      collection: 'webhook-events',
      where: {
        or: [
          { and: [{ status: { equals: 'failed' } }, recent] },
          {
            and: [
              { status: { in: ['received', 'failed'] } },
              { attempts: { greater_than_equal: MAX_WEBHOOK_ATTEMPTS } },
              recent,
            ],
          },
        ],
      },
      label: 'sikertelen vagy kimerült fizetési értesítés',
      teendo:
        'A Barion értesítését a rendszer nem tudta feldolgozni. A rendelés állapotát a Barion-fiókkal vesd össze.',
    },
  ]
}

/** Darabszám egy gyűjteményre és feltételre (a hívó adja: rendszer vagy felhasználó). */
export type AttentionCountFn = (collection: AttentionCollection, where: Where) => Promise<number>

/** Lapozott lekérdezés a hiányzó helyesbítők eldöntéséhez (a hívó adja a jogosultságot). */
export type AttentionFindFn = (args: {
  readonly collection: 'orders' | 'refund-intents'
  readonly where: Where
  readonly select: Readonly<Record<string, true>>
  readonly page: number
  readonly limit: number
}) => Promise<{ docs: readonly unknown[]; hasNextPage?: boolean | null }>

export interface AttentionSources {
  readonly count: AttentionCountFn
  readonly find: AttentionFindFn
}

/** A számok és a hozzájuk tartozó, UGYANAZON pillanatra épült definíciók (linkekhez). */
export interface AttentionSnapshot {
  readonly counts: AttentionCounts
  readonly definitions: readonly AttentionDefinition[]
}

const ATTENTION_PAGE_SIZE = 200
const ATTENTION_MAX_PAGES = 25

/**
 * A hiányzó helyesbítők lekérdezése nem teljes (a lapozás a korlátnál úgy
 * állt meg, hogy lehet még adat). Részeredményből a teendőt alulbecsülnénk,
 * ezért a hívó hibát kap, nem számot (a Figyelmet igényel blokk ilyenkor a
 * betöltési hibát mutatja, a napi összesítő hibája a poll-watch riasztása).
 */
export class AttentionIncompleteError extends Error {
  constructor(collection: string) {
    super(
      `A Figyelmet igényel lekérdezése nem teljes (${collection}): a lapozási korlát elfogyott.`,
    )
    this.name = 'AttentionIncompleteError'
  }
}

async function findAll(
  find: AttentionFindFn,
  collection: 'orders' | 'refund-intents',
  where: Where,
  select: Readonly<Record<string, true>>,
): Promise<unknown[]> {
  const docs: unknown[] = []
  for (let page = 1; page <= ATTENTION_MAX_PAGES; page += 1) {
    const result = await find({ collection, where, select, page, limit: ATTENTION_PAGE_SIZE })
    docs.push(...result.docs)
    if (result.docs.length < ATTENTION_PAGE_SIZE || result.hasNextPage === false) {
      return docs
    }
  }
  throw new AttentionIncompleteError(collection)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Relációs mező azonosítója (depth: 0 → szám vagy szöveg; populálva → `{ id }`). */
function relationKey(value: unknown): string | null {
  const id = asRecord(value)?.id ?? value
  return typeof id === 'number' || (typeof id === 'string' && id !== '') ? String(id) : null
}

/** A hiányzó helyesbítő eldöntéséhez kért rendelésmezők. */
export const CORRECTIVE_EVIDENCE_ORDER_SELECT = {
  id: true,
  refunds: true,
  correctiveInvoiceStatus: true,
  correctiveInvoiceSeq: true,
  correctiveInvoiceNumber: true,
} as const

/**
 * Egy rendelés azon visszatérítés-sorszámai (1-alapú, a `refunds` indexe + 1),
 * amelyeknek helyesbítő kellene, de a kiállításának nincs tartós bizonyítéka.
 *
 * MI KELL HELYESBÍTŐT: a részleges bejegyzés, és a rendelést lezáró, nem első
 * teljes bejegyzés (refund-order.ts; az első, teljes visszatérítés stornót
 * kap, azt a `stornoStatus` kezeli). Ugyanez a szabály az AAM-becslésé
 * (src/lib/alerts/aam.ts, `evidencedCorrectiveRefund`).
 *
 * BIZONYÍTÉK sorszámonként, a pillanatnyi `correctiveInvoiceStatus` NÉLKÜL
 * (az a legutóbbi kísérletet mutatja: egy későbbi sorszám sikeres
 * helyesbítője `issued`-ra írja, a korábbi, sikertelen bizonylat hiánya
 * ettől még megmarad):
 *  - a tárolt (`correctiveInvoiceSeq`, `correctiveInvoiceNumber`) pár, amely
 *    KIZÁRÓLAG a `refunds[seq - 1]` bejegyzést igazolja (az aam.ts szabálya:
 *    a pár a sikeres kiállítás ágain íródik, egy mentésben, és sosem törlődik);
 *  - az adott sorszámú, `committed` visszatérítési szándék. A kézi lezárás
 *    (refund-recovery.ts) csak akkor ír `committed`-et, ha a
 *    `refund-invoice-done` nyugta száma egyezik a rendelésen akkor tárolt, a
 *    SAJÁT sorszámára szóló párral; ez a nyugta változtathatatlan. Az
 *    automatikus lezárás soha ki nem fizetett, számla nélküli rendelésen fut,
 *    ott helyesbítő nem is lehet.
 *
 * TÜRELMI IDŐ: a még futó kiállítást nem jelezzük. Egy bizonyíték nélküli
 * bejegyzés akkor számít, ha a visszatérítése `INVOICE_MISSING_AFTER_MS`-nél
 * régebbi (vagy az időpontja nem olvasható), vagy ha a rendelés legutóbbi
 * helyesbítő-kísérlete már sikertelen.
 */
export function missingCorrectiveSequences(
  order: Readonly<Record<string, unknown>>,
  committedSequences: ReadonlySet<number>,
  nowMs: number,
): number[] {
  if (!Array.isArray(order.refunds)) {
    return []
  }
  const number = order.correctiveInvoiceNumber
  const seq = order.correctiveInvoiceSeq
  const pairSeq =
    typeof number === 'string' &&
    number.trim() !== '' &&
    typeof seq === 'number' &&
    Number.isSafeInteger(seq) &&
    seq >= 1
      ? seq
      : null
  const lastAttemptFailed = order.correctiveInvoiceStatus === 'failed'
  const graceLimit = nowMs - INVOICE_MISSING_AFTER_MS
  const missing: number[] = []
  order.refunds.forEach((entry: unknown, index: number) => {
    const record = asRecord(entry)
    if (record === null) {
      return
    }
    const sequence = index + 1
    const needsCorrective = record.type === 'partial' || (record.type === 'full' && sequence > 1)
    if (!needsCorrective || sequence === pairSeq || committedSequences.has(sequence)) {
      return
    }
    const refundedAtMs =
      typeof record.refundedAt === 'string' ? Date.parse(record.refundedAt) : Number.NaN
    if (lastAttemptFailed || Number.isNaN(refundedAtMs) || refundedAtMs < graceLimit) {
      missing.push(sequence)
    }
  })
  return missing
}

/**
 * Azok a rendelések, amelyeken legalább egy visszatérítés helyesbítője
 * hiányzik (`missingCorrectiveSequences`). A jelöltek: az utolsó
 * `ATTENTION_LOOKBACK_DAYS` napban módosult, kiállított számlás rendelések,
 * amelyeken helyesbítő-kísérlet már volt. Ha kísérlet sem volt (a folyamat a
 * Barion-siker után, a kiállítás előtt állt le), a szándék
 * `provider_succeeded`-ben marad, és az elakadt visszatérítések közt látszik.
 */
export async function missingCorrectiveOrderIds(
  find: AttentionFindFn,
  nowMs: number,
): Promise<(number | string)[]> {
  const lookbackIso = isoBefore(nowMs, ATTENTION_LOOKBACK_DAYS * DAY_MS)
  const candidates = await findAll(
    find,
    'orders',
    {
      and: [
        { invoiceStatus: { equals: 'issued' } },
        { correctiveInvoiceStatus: { in: ['pending', 'issued', 'failed'] } },
        { updatedAt: { greater_than_equal: lookbackIso } },
      ],
    },
    CORRECTIVE_EVIDENCE_ORDER_SELECT,
  )
  const unproven = new Map<string, { id: number | string; order: Record<string, unknown> }>()
  for (const doc of candidates) {
    const order = asRecord(doc)
    const id = order?.id
    if (order === null || (typeof id !== 'number' && typeof id !== 'string')) {
      continue
    }
    if (missingCorrectiveSequences(order, new Set(), nowMs).length > 0) {
      unproven.set(String(id), { id, order })
    }
  }
  if (unproven.size === 0) {
    return []
  }
  const intents = await findAll(
    find,
    'refund-intents',
    {
      and: [
        { order: { in: [...unproven.values()].map((item) => item.id) } },
        { state: { equals: 'committed' } },
      ],
    },
    { order: true, refundSequence: true },
  )
  const committedByOrder = new Map<string, Set<number>>()
  for (const doc of intents) {
    const intent = asRecord(doc)
    const orderKey = relationKey(intent?.order)
    const sequence = intent?.refundSequence
    if (orderKey === null || typeof sequence !== 'number') {
      continue
    }
    const sequences = committedByOrder.get(orderKey) ?? new Set<number>()
    sequences.add(sequence)
    committedByOrder.set(orderKey, sequences)
  }
  return [...unproven.entries()]
    .filter(
      ([key, item]) =>
        missingCorrectiveSequences(item.order, committedByOrder.get(key) ?? new Set(), nowMs)
          .length > 0,
    )
    .map(([, item]) => item.id)
}

/**
 * Az összes kategória darabszáma, és a definíciók, amelyekből a linkek
 * épülnek. Először a hiányzó helyesbítős rendeléseket keressük meg, utána
 * minden szám a kész definíció `where`-jével számolódik: a szám és a link
 * pontosan ugyanazt a listát adja.
 */
export async function resolveAttention(
  sources: AttentionSources,
  nowMs: number,
): Promise<AttentionSnapshot> {
  const missingIds = await missingCorrectiveOrderIds(sources.find, nowMs)
  const definitions = attentionDefinitions(nowMs, { missingCorrectiveOrderIds: missingIds })
  const values = await Promise.all(
    definitions.map((definition) => sources.count(definition.collection, definition.where)),
  )
  const counts: Record<AttentionKey, number> = {
    fizetettSzamlaNelkul: 0,
    fuggoFizetes: 0,
    fuggoFizetesRegi: 0,
    bizonylatHiba: 0,
    visszateritesElakadt: 0,
    webhookHiba: 0,
  }
  definitions.forEach((definition, index) => {
    const value = values[index] ?? 0
    counts[definition.key] = Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
  })
  return { counts, definitions }
}

/** A Payload Local API-ra épülő források (a hívó dönti el a jogosultságot). */
export function payloadAttentionSources(
  payload: Pick<Payload, 'count' | 'find'>,
  access: { overrideAccess: true } | { overrideAccess: false; user: unknown },
): AttentionSources {
  return {
    count: async (collection, where) => {
      const result = await payload.count({
        collection,
        where,
        ...access,
      } as unknown as Parameters<Payload['count']>[0])
      return result.totalDocs
    },
    find: async ({ collection, where, select, page, limit }) => {
      const result = await payload.find({
        collection,
        where,
        select,
        page,
        limit,
        depth: 0,
        sort: 'id',
        ...access,
      } as unknown as Parameters<Payload['find']>[0])
      return { docs: result.docs as readonly unknown[], hasNextPage: result.hasNextPage }
    },
  }
}

/** A teendők száma összesen (a részhalmaz nélkül). */
export function attentionTotal(counts: AttentionCounts): number {
  return attentionDefinitions(0)
    .filter((definition) => definition.reszhalmaz !== true)
    .reduce((sum, definition) => sum + counts[definition.key], 0)
}

function appendQueryPairs(prefix: string, value: unknown, out: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendQueryPairs(`${prefix}[${String(index)}]`, item, out))
    return
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      appendQueryPairs(`${prefix}[${key}]`, item, out)
    }
    return
  }
  if (value === undefined) {
    return
  }
  out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`)
}

/**
 * Szűrt admin-lista címe: `/admin/collections/<slug>?where[...]=...`. A
 * Payload listanézete a `where` paramétert a qs-formátumból olvassa (a kérés
 * query-je), és a szűrősávon meg is mutatja.
 */
export function attentionListHref(
  adminRoute: string,
  collection: AttentionCollection,
  where: Where,
): string {
  const pairs: string[] = []
  appendQueryPairs('where', where, pairs)
  const base = `${adminRoute.replace(/\/+$/, '')}/collections/${collection}`
  return pairs.length > 0 ? `${base}?${pairs.join('&')}` : base
}
