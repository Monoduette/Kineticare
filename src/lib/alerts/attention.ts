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
 *  - sikertelen számla, stornó vagy helyesbítő;
 *  - visszatérítési szándék prepared / provider_started / provider_unknown /
 *    manual_review állapotban 15 percnél régebben;
 *  - sikertelen vagy kimerült (5 próbálkozás) webhook-esemény.
 */

import type { Where } from 'payload'

import { MAX_WEBHOOK_ATTEMPTS } from '../idempotency'

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

/** Nem végállapotú visszatérítési szándékok (a refund-intents `state` értékei). */
export const STUCK_REFUND_INTENT_STATES = [
  'prepared',
  'provider_started',
  'provider_unknown',
  'manual_review',
] as const

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

/**
 * A kategóriák definíciója egy adott pillanatra. A `where` mindig a Payload
 * szűrő-felületének kanonikus alakja (`or` → `and` → feltételek), hogy a
 * linkkel megnyitott listán a szűrő is látsszon és szerkeszthető legyen.
 */
export function attentionDefinitions(nowMs: number): readonly AttentionDefinition[] {
  const lookbackIso = isoBefore(nowMs, ATTENTION_LOOKBACK_DAYS * DAY_MS)
  const recent = { updatedAt: { greater_than_equal: lookbackIso } }
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
        ],
      },
      label: 'sikertelen számla, stornó vagy helyesbítő',
      teendo: `Az utolsó ${ATTENTION_LOOKBACK_DAYS} napban a rendszer nem tudta kiállítani a bizonylatot. Állítsd ki kézzel a Számlázz.hu-ban.`,
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

/** Az összes kategória darabszáma. */
export async function countAttention(
  count: AttentionCountFn,
  nowMs: number,
): Promise<AttentionCounts> {
  const definitions = attentionDefinitions(nowMs)
  const values = await Promise.all(
    definitions.map((definition) => count(definition.collection, definition.where)),
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
  return counts
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
