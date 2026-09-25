import { fixture as refundFixture } from './refund-fixture'
import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_ALERT_COOLDOWN_MS, resetAlertThrottle } from '../lib/alert-throttle'
import { BarionApiError, type BarionPaymentStateResponse } from '../lib/barion'
import {
  classifyBarionFailure,
  INVOICE_PENDING_STALE_MS,
  LATE_SUCCESS_BATCH_SIZE,
  MAX_CONSECUTIVE_TRANSPORT_FAILURES,
  MAX_LEADING_FAILURES,
  ORDER_POLL_BATCH_SIZE,
  ORPHAN_ORDER_GRACE_MS,
  pollPendingOrders,
  REFUND_RECHECK_BATCH_SIZE,
  REFUND_RECHECK_LAST_CHANCE_MS,
  REFUND_RECHECK_MAX_ATTEMPTS,
  REFUND_RECHECK_RETRY_GAP_MS,
  RUN_LEVEL_ALERT_COOLDOWN_MS,
  STUCK_ORDER_WARN_MS,
  UNKNOWN_PAYMENT_CANCEL_AFTER_MS,
  UNVERIFIED_NOT_FOUND_CANCEL_AFTER_MS,
} from '../lib/order-poll/service'
import { emptyRefundLedger } from './empty-refund-ledger'
import { applyBarionStateTransition } from '../lib/order-status/apply-barion-state'
import { recoverRejectedSucceededPayment } from '../lib/order-status/recover-paid-reject'
import type { Order } from '../payload-types'

/**
 * W4-02 order-poll szolgáltatás tesztjei — mockolt payload + injektált
 * GetState/onPaid/queueInvoice. A lényeg: az elveszett callback-mentés ugyanazt
 * az állapotgépet futtatja, mint a callback-processzor, és a mellékhatások
 * (onPaid, számla-resweep) is bekövetkeznek.
 */

// CLAUDE.md 15.: tesztből SOSEM mehet ki valódi hálózati hívás. A GetState
// mindig injektált, tehát ide HANGOSAN DOBÓ őr való — ha bármelyik ág mégis
// fetchre futna, az azonnal látszik.
beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('TESZT: valódi hálózati hívás nem futhat')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  // A riasztás-fojtás folyamat-szintű állapota nem szivároghat át tesztek között.
  resetAlertThrottle()
})

const PAYMENT_ID = '11111111-2222-3333-4444-555555555555'
const ORDER_NUMBER = 'KH-2026-000123'
const NOW = Date.parse('2026-08-04T12:00:00Z')
/**
 * A rendelés szerver-oldali végösszege. Az S2 összeg-assert miatt a
 * GetState-válasz Total/Currency mezőjének egyeznie kell ezzel, különben a
 * paid-átmenet elutasított.
 */
const ORDER_TOTAL_HUF = 19990

function isoHoursAgo(hours: number): string {
  return new Date(NOW - hours * 3600_000).toISOString()
}

function createPendingOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 101,
    orderNumber: ORDER_NUMBER,
    status: 'payment_pending',
    barionPaymentId: PAYMENT_ID,
    customer: 7,
    customerEmail: 'anna@example.test',
    currency: 'HUF',
    totalHufSnapshot: ORDER_TOTAL_HUF,
    items: [
      {
        product: 42,
        quantity: 1,
        titleSnapshot: 'DEMO-KEZREHAB-001',
        priceHufSnapshot: ORDER_TOTAL_HUF,
      },
    ],
    createdAt: isoHoursAgo(1),
    updatedAt: isoHoursAgo(1),
    ...overrides,
  } as unknown as Order
}

function getStateResponse(
  status: string,
  overrides: Partial<BarionPaymentStateResponse> = {},
): BarionPaymentStateResponse {
  return {
    PaymentId: PAYMENT_ID,
    PaymentRequestId: ORDER_NUMBER,
    Status: status as BarionPaymentStateResponse['Status'],
    Total: ORDER_TOTAL_HUF,
    Currency: 'HUF',
    Transactions: [],
    ...overrides,
  }
}

interface SetupOptions {
  pending?: Order[]
  paidResweep?: Order[]
  /** R-03: cancelled / payment_failed rendelések a late-success scanhez. */
  lateSuccess?: Order[]
  stateStatus?: string
  stateError?: Error
  /** A GetState-válasz felülírásai (pl. eltérő Total az összeg-assert teszteléséhez). */
  stateOverrides?: Partial<BarionPaymentStateResponse>
  /** Barion webhook-events sorok (az árva-rendelés keresőjéhez). */
  webhookEvents?: Array<{ id: number; externalId: string; result?: string | null }>
}

/** A where `createdAt` tartomány-feltételei (a valódi DB is alkalmazza őket). */
function createdAtRange(where: unknown): { gte?: number; lte?: number } {
  const json = JSON.stringify(where ?? {})
  const gte = /"createdAt":\{"greater_than_equal":"([^"]+)"\}/.exec(json)
  const lte = /"createdAt":\{"less_than_equal":"([^"]+)"\}/.exec(json)
  return {
    ...(gte ? { gte: Date.parse(gte[1]) } : {}),
    ...(lte ? { lte: Date.parse(lte[1]) } : {}),
  }
}

interface CapturedFind {
  where?: unknown
  sort?: string
  limit?: number
}

/** A Payload `id: { not_in: [...] }` ágának kiolvasása a W1 pótlap-szűrőhöz. */
function extractNotInIds(where: unknown): Array<number | string> | null {
  if (!where || typeof where !== 'object') {
    return null
  }
  const record = where as Record<string, unknown>
  if (Array.isArray(record.and)) {
    for (const entry of record.and) {
      const found = extractNotInIds(entry)
      if (found) {
        return found
      }
    }
  }
  const idCond = record.id
  if (idCond && typeof idCond === 'object' && 'not_in' in idCond) {
    const notIn = (idCond as { not_in?: unknown }).not_in
    if (Array.isArray(notIn)) {
      return notIn as Array<number | string>
    }
  }
  return null
}

function whereLooksLikeLateSuccess(where: unknown): boolean {
  const json = JSON.stringify(where ?? {})
  return json.includes('cancelled') || json.includes('payment_failed')
}

interface ConditionalUpdateWhere {
  and?: Array<{
    id?: { equals?: number | string }
    status?: { equals?: string }
  }>
}

function readConditionalWhere(where: unknown): { id?: number | string; status?: string } {
  const conditions = (where as ConditionalUpdateWhere | undefined)?.and ?? []
  const id = conditions.find((condition) => condition.id !== undefined)?.id?.equals
  const status = conditions.find((condition) => condition.status !== undefined)?.status?.equals
  return {
    ...(id !== undefined ? { id } : {}),
    ...(status !== undefined ? { status } : {}),
  }
}

interface CapturedOrderUpdate {
  id?: number | string
  where?: { id?: number | string; status?: string }
  data: Record<string, unknown>
}

function setup(options: SetupOptions = {}) {
  const pending = options.pending ?? [createPendingOrder()]
  const paidResweep = options.paidResweep ?? []
  const lateSuccess = options.lateSuccess ?? []
  const user = { id: 7, email: 'anna@example.test', purchases: [] as number[] }
  const orderUpdates: Array<Record<string, unknown>> = []
  const orderUpdateCalls: CapturedOrderUpdate[] = []
  const queuedInvoices: number[] = []
  const paidCalls: number[] = []
  const finds: CapturedFind[] = []

  const payload = {
    find: async ({
      collection,
      where,
      sort,
      limit,
    }: {
      collection: string
      where?: unknown
      sort?: string
      limit?: number
    }) => {
      if (collection === 'webhook-events') {
        const events = options.webhookEvents ?? []
        return { docs: events.map((event) => ({ ...event })), totalDocs: events.length }
      }
      finds.push({
        ...(where !== undefined ? { where } : {}),
        ...(sort !== undefined ? { sort } : {}),
        ...(limit !== undefined ? { limit } : {}),
      })
      const json = JSON.stringify(where ?? {})
      let docs: Order[]
      if (whereLooksLikeLateSuccess(where)) {
        docs = [...lateSuccess]
      } else if (json.includes('"paid"') && !json.includes('payment_pending')) {
        docs = [...paidResweep]
      } else {
        docs = [...pending]
      }
      const notIn = extractNotInIds(where)
      if (notIn) {
        const excluded = new Set(notIn.map(String))
        docs = docs.filter((order) => !excluded.has(String(order.id)))
      }
      // A valódi DB a `barionPaymentId: { exists: true }` szűrőt is alkalmazza
      // (late-success lap, útvonal-próba jelöltje).
      if (json.includes('"barionPaymentId":{"exists":true}')) {
        docs = docs.filter(
          (order) => order.barionPaymentId !== null && order.barionPaymentId !== undefined,
        )
      }
      // Az útvonal-próba (és a számla-resweep) csak paid sort kér, mint a valódi DB.
      if (json.includes('"status":{"equals":"paid"}')) {
        docs = docs.filter((order) => order.status === 'paid')
      }
      // A PaymentId-egyezés szűrője (pl. az árva-kereső „kötött-e már” kérdése).
      const paymentIdMatch = /"barionPaymentId":\{"equals":"([^"]+)"\}/.exec(json)
      if (paymentIdMatch) {
        docs = [...pending, ...paidResweep, ...lateSuccess].filter(
          (order) => order.barionPaymentId === paymentIdMatch[1],
        )
      }
      // A dupla-fizetés-őr vevőre szűr (hasPaidOrderFor), mint a valódi DB.
      const customerMatch = /"customer":\{"equals":(\d+)\}/.exec(json)
      if (customerMatch) {
        docs = docs.filter((order) => String(order.customer) === customerMatch[1])
      }
      const range = createdAtRange(where)
      if (range.gte !== undefined || range.lte !== undefined) {
        docs = docs.filter((order) => {
          const createdAtMs = Date.parse(order.createdAt ?? '')
          return (
            (range.gte === undefined || createdAtMs >= range.gte) &&
            (range.lte === undefined || createdAtMs <= range.lte)
          )
        })
      }
      if (sort === 'updatedAt') {
        docs.sort((a, b) => Date.parse(a.updatedAt ?? '') - Date.parse(b.updatedAt ?? ''))
      } else if (sort === '-createdAt') {
        docs.sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''))
      } else if (sort === '-updatedAt') {
        docs.sort((a, b) => Date.parse(b.updatedAt ?? '') - Date.parse(a.updatedAt ?? ''))
      } else if (sort === 'createdAt') {
        docs.sort((a, b) => Date.parse(a.createdAt ?? '') - Date.parse(b.createdAt ?? ''))
      }
      if (typeof limit === 'number') {
        docs = docs.slice(0, limit)
      }
      // ÉLETHŰSÉG (P0-repro): a valódi Payload `find` ÚJ objektumokat ad vissza
      // az SQL-ből — ha közben egy recovery a DB-be ír, a poll kezében lévő
      // példány NEM változik. A korábbi alias (ugyanaz a referencia) épp a
      // stale-touch hibát rejtette el: az update mutálta a poll példányát is,
      // így az in-memory státusz sosem tudott elavulni.
      return { docs: docs.map((order) => ({ ...order })), totalDocs: docs.length }
    },
    findByID: async ({ collection, id }: { collection: string; id: number }) => {
      // Az M5 zár a záron belül ÚJRAOLVASSA a rendelést — a mock a tárolt
      // (és az update által mutált) példányt adja vissza, mint a valódi DB.
      if (collection === 'orders') {
        const found = [...pending, ...paidResweep, ...lateSuccess].find((order) => order.id === id)
        if (!found) {
          throw new Error(`teszthiba: nincs ilyen rendelés: ${id}`)
        }
        return found
      }
      return user
    },
    update: async ({
      collection,
      id,
      where,
      data,
    }: {
      collection: string
      id?: number | string
      where?: unknown
      data: Record<string, unknown>
    }) => {
      if (collection === 'orders') {
        const pool = [...pending, ...paidResweep, ...lateSuccess]
        // A Payload valódi update-je bökí az updatedAt-et — a W1/RF-3 touch
        // (ugyanazon státusz újraírása) csak így kerül a sor végére.
        const applyTo = (target: Order): void => {
          Object.assign(target, data)
          if (typeof data.status === 'string') {
            target.updatedAt = new Date(NOW).toISOString()
          }
        }
        if (where !== undefined) {
          const condition = readConditionalWhere(where)
          orderUpdateCalls.push({ where: condition, data })
          const target = pool.find(
            (order) =>
              String(order.id) === String(condition.id) && order.status === condition.status,
          )
          if (!target) {
            return { docs: [], errors: [] }
          }
          orderUpdates.push(data)
          applyTo(target)
          return { docs: [target], errors: [] }
        }
        orderUpdateCalls.push({ ...(id !== undefined ? { id } : {}), data })
        orderUpdates.push(data)
        const target = id === undefined ? undefined : pool.find((order) => order.id === id)
        if (target) {
          applyTo(target)
        }
      }
      if (collection === 'users') {
        Object.assign(user, data)
      }
      return data
    },
  }

  const fetchState = async (): Promise<BarionPaymentStateResponse> => {
    if (options.stateError) {
      throw options.stateError
    }
    return getStateResponse(options.stateStatus ?? 'Succeeded', options.stateOverrides)
  }

  const onPaid = async (order: Order): Promise<void> => {
    paidCalls.push(order.id)
  }
  const queueInvoice = async (orderId: number): Promise<boolean> => {
    queuedInvoices.push(orderId)
    return true
  }
  /**
   * Bekapcsolt Számlázz.hu-integráció. INJEKTÁLVA, nem envből: a resweep-ág
   * előfeltétele a `SZAMLAZZ_AGENT_KEY` megléte, a teszt viszont sosem függhet
   * valódi (vagy ál-) agent-kulcstól. A kikapcsolt ágnak külön tesztje van.
   */
  const invoicingEnabled = (): boolean => true

  return {
    payload: payload as never,
    fetchState,
    onPaid,
    queueInvoice,
    invoicingEnabled,
    user,
    orderUpdates,
    orderUpdateCalls,
    queuedInvoices,
    paidCalls,
    pending,
    lateSuccess,
    finds,
  }
}

describe('order-poll — elveszett callback-mentés', () => {
  it('Barion Succeeded + payment_pending rendelés → paid átmenet + purchases + onPaid mellékhatás', async () => {
    const order = createPendingOrder()
    const { payload, fetchState, onPaid, queueInvoice, user, paidCalls } = setup({
      pending: [order],
      stateStatus: 'Succeeded',
    })

    const summary = await pollPendingOrders({ payload, fetchState, onPaid, queueInvoice, now: NOW })

    expect(summary.scanned).toBe(1)
    expect(summary.transitionedPaid).toBe(1)
    expect(order.status).toBe('paid')
    expect(user.purchases).toEqual([42])
    expect(paidCalls).toEqual([101])
  })

  /**
   * K1 — a paid-átmenet mellékhatásai (számla + visszaigazoló/aktiváló e-mail)
   * nem veszhetnek el egy félbeszakadt jogosultság-beírás miatt.
   *
   * A RÉGI sorrenden (előbb `status: 'paid'`, utána grant) ez a teszt megbukna:
   * az első futás után a rendelés már paid lenne, tehát a második futás
   * `transitionedToPaid: false`-t adna, és az onPaid SOHA nem futna le — a vevő
   * fizetne, hozzáférést kapna, de levelet (vendégként jelszó-beállító linket)
   * sosem.
   */
  it('a jogosultság-beírás elhasalása után a következő futás PONTOSAN EGYSZER hívja az onPaid-et', async () => {
    const order = createPendingOrder()
    const base = setup({ pending: [order], stateStatus: 'Succeeded' })
    let grantFails = true
    const payload = {
      ...(base.payload as unknown as Record<string, unknown>),
      update: async (args: { collection: string; data: Record<string, unknown> }) => {
        if (args.collection === 'users' && grantFails) {
          throw new Error('teszt: a jogosultság-beírás elhasal (DB-hiba)')
        }
        return (base.payload as unknown as { update: (a: unknown) => Promise<unknown> }).update(
          args,
        )
      },
    } as never
    const deps = {
      payload,
      fetchState: base.fetchState,
      onPaid: base.onPaid,
      queueInvoice: base.queueInvoice,
      invoicingEnabled: base.invoicingEnabled,
      now: NOW,
    }

    await expect(pollPendingOrders(deps)).rejects.toThrow()
    // A rendelés NEM ragadhat paid-ben elmaradt mellékhatásokkal.
    expect(order.status).toBe('payment_pending')
    expect(base.paidCalls).toEqual([])

    grantFails = false
    const summary = await pollPendingOrders(deps)

    expect(summary.transitionedPaid).toBe(1)
    expect(order.status).toBe('paid')
    expect(base.user.purchases).toEqual([42])
    expect(base.paidCalls).toEqual([101])
  })

  /**
   * P1 — A MELLÉKHATÁS-LÁNC ISMÉTLŐDÉS-VÉDELME.
   *
   * A poll a futás ELEJÉN olvassa be a függő rendeléseket; mire a rendelés-
   * szintű zárra rákerül a sor, egy párhuzamos Barion-callback már paid-re
   * állíthatta. Az állapotgép ilyenkor `{ action: 'paid', duplicate: true,
   * transitionedToPaid: false }`-t ad — az onPaid tehát NEM futhat.
   *
   * MI A TÉT: az onOrderPaid újrafutása ismételt visszaigazoló levelet és
   * ismételt számla-jobot jelent, vendégnél pedig ÚJ jelszó-beállító tokent
   * (`payload.forgotPassword`) — a korábban kiküldött, még fel nem használt
   * aktiváló link érvénytelenné válna, és a vevő kizárhatná magát a kifizetett
   * kurzusából.
   *
   * A summary SZÁNDÉKOSAN változatlan (`transitionedPaid: 1`): a `duplicate`
   * ág külön ágon számol. Ezért a feltétel elrontása (`transitionedToPaid` →
   * `action === 'paid'`) KIZÁRÓLAG az onPaid-kémen látszik — a számlálókon nem.
   */
  it('MÁR paid rendelésre futó poll (verseny a callback-kel) → az onPaid NEM fut újra', async () => {
    // A poll a payment_pending listából kapta, de a záron belüli újraolvasás
    // már paid rendelést lát — pontosan a versenyhelyzet alakja.
    const order = createPendingOrder({ status: 'paid' })
    const { payload, fetchState, onPaid, queueInvoice, user, paidCalls, orderUpdates } = setup({
      pending: [order],
      stateStatus: 'Succeeded',
    })
    user.purchases = [42]

    const summary = await pollPendingOrders({ payload, fetchState, onPaid, queueInvoice, now: NOW })

    // A MELLÉKHATÁS-LÁNC egyszer sem indult el.
    expect(paidCalls).toEqual([])
    // Státusz-írás sincs (az átmenet no-op), a rendelés paid marad.
    expect(orderUpdates).toHaveLength(0)
    expect(order.status).toBe('paid')
    // A számláló változatlan — ez az, amitől a régi teszt vak volt.
    expect(summary.transitionedPaid).toBe(1)
  })

  it.each([['Canceled'], ['Expired']])('Barion %s → a rendelés cancelled lesz', async (status) => {
    const order = createPendingOrder()
    const { payload, fetchState, onPaid, queueInvoice, paidCalls } = setup({
      pending: [order],
      stateStatus: status,
    })

    const summary = await pollPendingOrders({ payload, fetchState, onPaid, queueInvoice, now: NOW })

    expect(summary.cancelled).toBe(1)
    expect(summary.transitionedPaid).toBe(0)
    expect(paidCalls).toHaveLength(0)
    expect(order.status).toBe('cancelled')
  })

  it.each([['Prepared'], ['Started']])(
    'Barion %s → a rendelés payment_pending marad',
    async (status) => {
      const { payload, fetchState, onPaid, queueInvoice, orderUpdates } = setup({
        stateStatus: status,
      })

      const summary = await pollPendingOrders({
        payload,
        fetchState,
        onPaid,
        queueInvoice,
        now: NOW,
      })

      expect(summary.stillPending).toBe(1)
      expect(orderUpdates).toEqual([{ status: 'payment_pending' }])
    },
  )

  /**
   * S2 összeg-assert: a poll-job UGYANAZT a magot futtatja, mint a callback,
   * tehát a Total-eltérés itt is elutasított paid-átmenetet jelent — a
   * „mentőháló" nem kerülheti meg az összeg-ellenőrzést.
   */
  it('Barion Succeeded, de eltérő Total → NINCS paid átmenet (failed), a státusz érintetlen', async () => {
    const order = createPendingOrder()
    const { payload, fetchState, onPaid, queueInvoice, user, paidCalls, orderUpdates } = setup({
      pending: [order],
      stateStatus: 'Succeeded',
      stateOverrides: { Total: 1 },
    })

    const summary = await pollPendingOrders({ payload, fetchState, onPaid, queueInvoice, now: NOW })

    expect(summary.transitionedPaid).toBe(0)
    expect(summary.failed).toBe(1)
    expect(order.status).toBe('payment_pending')
    // A hiányos GetState-ből nincs tartós refund claim; sem pénzmozgás, sem státuszírás.
    expect(orderUpdates).toEqual([])
    expect(user.purchases).toEqual([])
    expect(paidCalls).toHaveLength(0)
  })

  it('GetState-hiba → a rendelés kimarad (failed), a státusz érintetlen', async () => {
    const { payload, fetchState, onPaid, queueInvoice, orderUpdates } = setup({
      stateError: new Error('fetch failed'),
    })

    const summary = await pollPendingOrders({ payload, fetchState, onPaid, queueInvoice, now: NOW })

    expect(summary.failed).toBe(1)
    expect(orderUpdates).toHaveLength(0)
  })
})

describe('order-poll — árva rendelés (barionPaymentId nélkül)', () => {
  it('2 óránál fiatalabb árva → kihagyva (a vevő még játszhat)', async () => {
    const orphan = createPendingOrder({ barionPaymentId: null, createdAt: isoHoursAgo(0.5) })
    const { payload, fetchState, onPaid, queueInvoice, orderUpdates } = setup({ pending: [orphan] })

    const summary = await pollPendingOrders({ payload, fetchState, onPaid, queueInvoice, now: NOW })

    expect(summary.skipped).toBe(1)
    expect(summary.orphaned).toBe(0)
    expect(orderUpdates).toHaveLength(0)
  })

  it('ORPHAN_GRACE-nél régebbi árva → cancelled (a Barionban úgysem létezik fizetés)', async () => {
    const orphan = createPendingOrder({
      barionPaymentId: null,
      createdAt: new Date(NOW - ORPHAN_ORDER_GRACE_MS - 60_000).toISOString(),
    })
    const { payload, fetchState, onPaid, queueInvoice } = setup({ pending: [orphan] })

    const summary = await pollPendingOrders({ payload, fetchState, onPaid, queueInvoice, now: NOW })

    expect(summary.orphaned).toBe(1)
    expect(orphan.status).toBe('cancelled')
  })

  it('24 óránál régebbi függő rendelés → stillPending + owner-riasztás (státusz marad)', async () => {
    const stuck = createPendingOrder({
      createdAt: new Date(NOW - STUCK_ORDER_WARN_MS - 60_000).toISOString(),
    })
    const { payload, fetchState, onPaid, queueInvoice } = setup({
      pending: [stuck],
      stateStatus: 'Prepared',
    })

    const summary = await pollPendingOrders({ payload, fetchState, onPaid, queueInvoice, now: NOW })

    expect(summary.stillPending).toBe(1)
    expect(stuck.status).toBe('payment_pending')
  })

  it('a beragadt rendelés riasztása FOJTOTT: az első futás riaszt, a cooldown-on belüli ismétlés nem ír új error-sort', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const stuck = createPendingOrder({
      createdAt: new Date(NOW - STUCK_ORDER_WARN_MS - 60_000).toISOString(),
    })
    const { payload, fetchState, onPaid, queueInvoice } = setup({
      pending: [stuck],
      stateStatus: 'Prepared',
    })

    const first = await pollPendingOrders({ payload, fetchState, onPaid, queueInvoice, now: NOW })
    expect(first.stillPending).toBe(1)
    const firstLogs = logSpy.mock.calls.map((call) => call.map(String).join(' ')).join('\n')
    expect(firstLogs).toContain('24 órája payment_pending')

    // Ugyanaz a — már felszínre hozott — rendelés az 5 perccel későbbi futásban:
    // a rendelés továbbra is stillPending, de a RIASZTÁS nem ismétlődik.
    logSpy.mockClear()
    const second = await pollPendingOrders({
      payload,
      fetchState,
      onPaid,
      queueInvoice,
      now: NOW + 5 * 60_000,
    })
    expect(second.stillPending).toBe(1)
    const secondLogs = logSpy.mock.calls.map((call) => call.map(String).join(' ')).join('\n')
    expect(secondLogs).not.toContain('24 órája payment_pending')

    vi.restoreAllMocks()
  })
})

describe('order-poll — számla-resweep', () => {
  it("paid + invoiceStatus 'none' → újra sorba állítja az invoice-issue jobot", async () => {
    const paidOrder = createPendingOrder({ id: 202, status: 'paid', invoiceStatus: 'none' })
    const { payload, fetchState, onPaid, queueInvoice, invoicingEnabled, queuedInvoices } = setup({
      pending: [],
      paidResweep: [paidOrder],
    })

    const summary = await pollPendingOrders({
      payload,
      fetchState,
      onPaid,
      queueInvoice,
      invoicingEnabled,
      now: NOW,
    })

    expect(queuedInvoices).toEqual([202])
    expect(summary.invoiceRequeued).toBe(1)
  })

  it("friss 'pending' számla → NINCS resweep (valószínűleg dolgozik rajta egy worker)", async () => {
    const paidOrder = createPendingOrder({
      id: 202,
      status: 'paid',
      invoiceStatus: 'pending',
      updatedAt: new Date(NOW - 60_000).toISOString(),
    })
    const { payload, fetchState, onPaid, queueInvoice, invoicingEnabled, queuedInvoices } = setup({
      pending: [],
      paidResweep: [paidOrder],
    })

    const summary = await pollPendingOrders({
      payload,
      fetchState,
      onPaid,
      queueInvoice,
      invoicingEnabled,
      now: NOW,
    })

    expect(queuedInvoices).toHaveLength(0)
    expect(summary.invoiceRequeued).toBe(0)
  })

  it("régi (10+ perces) 'pending' számla → resweep (a worker elhalt közben)", async () => {
    const paidOrder = createPendingOrder({
      id: 202,
      status: 'paid',
      invoiceStatus: 'pending',
      updatedAt: new Date(NOW - INVOICE_PENDING_STALE_MS - 60_000).toISOString(),
    })
    const { payload, fetchState, onPaid, queueInvoice, invoicingEnabled, queuedInvoices } = setup({
      pending: [],
      paidResweep: [paidOrder],
    })

    await pollPendingOrders({
      payload,
      fetchState,
      onPaid,
      queueInvoice,
      invoicingEnabled,
      now: NOW,
    })

    expect(queuedInvoices).toEqual([202])
  })

  /**
   * Kikapcsolt Számlázz.hu-integráció (nincs SZAMLAZZ_AGENT_KEY — élesben ez a
   * jelenlegi állapot). Az invoice-issue task ilyenkor garantáltan 'disabled'
   * kimenettel no-opol, az invoiceStatus tehát 'none' marad: resweep-gát nélkül
   * MINDEN ütemezett futás újra sorba állítaná ugyanazt a 10 rendelést, azaz
   * élesben 5 percenként 10 fölösleges job-sor + félrevezető info-log.
   */
  it('kikapcsolt Számlázz.hu-integráció → NINCS resweep (nem termel fölösleges jobokat)', async () => {
    const paidOrder = createPendingOrder({ id: 202, status: 'paid', invoiceStatus: 'none' })
    const { payload, fetchState, onPaid, queueInvoice, queuedInvoices } = setup({
      pending: [],
      paidResweep: [paidOrder],
    })

    const summary = await pollPendingOrders({
      payload,
      fetchState,
      onPaid,
      queueInvoice,
      invoicingEnabled: () => false,
      now: NOW,
    })

    expect(queuedInvoices).toHaveLength(0)
    expect(summary.invoiceRequeued).toBe(0)
  })

  /**
   * A kihagyás NE legyen néma: korábban a „kimaradt a resweep" és a „lefutott,
   * de nem volt teendő" eset a job-outputban megkülönböztethetetlen volt
   * (mindkettő `invoiceRequeued: 0`), az ok pedig csak debug-szinten látszott.
   */
  it('a summary megkülönbözteti a kihagyott és a lefutott resweepet', async () => {
    const paidOrder = createPendingOrder({ id: 202, status: 'paid', invoiceStatus: 'none' })
    const base = { pending: [], paidResweep: [paidOrder] }

    const off = setup(base)
    const skipped = await pollPendingOrders({
      payload: off.payload,
      fetchState: off.fetchState,
      onPaid: off.onPaid,
      queueInvoice: off.queueInvoice,
      invoicingEnabled: () => false,
      now: NOW,
    })

    const on = setup(base)
    const done = await pollPendingOrders({
      payload: on.payload,
      fetchState: on.fetchState,
      onPaid: on.onPaid,
      queueInvoice: on.queueInvoice,
      invoicingEnabled: on.invoicingEnabled,
      now: NOW,
    })

    expect(skipped.invoiceResweep).toBe('skipped-disabled')
    expect(done.invoiceResweep).toBe('done')
  })

  /**
   * Hibás Számlázz.hu-konfiguráció (a feloldás DOB). A poll fő feladatát ez nem
   * viheti el, de az ok a summaryben és RIASZTÁS-szintű naplósorban is megjelenik.
   */
  /**
   * P2 — A NÉMA SZÁMLA-KIMARADÁS. Ha a job-sor nem érhető el (a
   * `queueInvoiceIssueJob` `payload.jobs.queue` nélkül `false`-szal lép ki), a
   * resweep VÉGIGMEGY a jelölteken, de egyet sem tud sorba állítani. Korábban
   * ez `invoiceRequeued: 0` + `invoiceResweep: 'done'` volt — vagyis
   * MEGKÜLÖNBÖZTETHETETLEN a „nincs teendő" esettől, holott itt a vevők
   * számlája nem készül el.
   */
  it('a job-sor nem fogad be semmit → queue-unavailable (nem néma 0)', async () => {
    const paidOrder = createPendingOrder({ id: 202, status: 'paid', invoiceStatus: 'none' })
    const { payload, fetchState, onPaid, invoicingEnabled } = setup({
      pending: [],
      paidResweep: [paidOrder],
    })
    // A valódi queueInvoiceIssueJob viselkedése hiányzó payload.jobs mellett.
    const queueInvoice = async (): Promise<boolean> => false

    const summary = await pollPendingOrders({
      payload,
      fetchState,
      onPaid,
      queueInvoice,
      invoicingEnabled,
      now: NOW,
    })

    expect(summary.invoiceRequeued).toBe(0)
    expect(summary.invoiceResweep).toBe('queue-unavailable')
  })

  it('NINCS jelölt (tényleg nincs teendő) → done marad, nem queue-unavailable', async () => {
    const { payload, fetchState, onPaid, invoicingEnabled } = setup({
      pending: [],
      paidResweep: [],
    })
    const queueInvoice = async (): Promise<boolean> => false

    const summary = await pollPendingOrders({
      payload,
      fetchState,
      onPaid,
      queueInvoice,
      invoicingEnabled,
      now: NOW,
    })

    expect(summary.invoiceRequeued).toBe(0)
    expect(summary.invoiceResweep).toBe('done')
  })

  it('RÉSZLEGES sikertelenség (egy megy, egy nem) → done marad', async () => {
    const first = createPendingOrder({ id: 202, status: 'paid', invoiceStatus: 'none' })
    const second = createPendingOrder({ id: 203, status: 'paid', invoiceStatus: 'none' })
    const { payload, fetchState, onPaid, invoicingEnabled } = setup({
      pending: [],
      paidResweep: [first, second],
    })
    const queueInvoice = async (orderId: number): Promise<boolean> => orderId === 202

    const summary = await pollPendingOrders({
      payload,
      fetchState,
      onPaid,
      queueInvoice,
      invoicingEnabled,
      now: NOW,
    })

    expect(summary.invoiceRequeued).toBe(1)
    expect(summary.invoiceResweep).toBe('done')
  })

  it('hibás Számlázz.hu-konfiguráció → skipped-config-error, a poll nem hasal el', async () => {
    const paidOrder = createPendingOrder({ id: 202, status: 'paid', invoiceStatus: 'none' })
    const { payload, fetchState, onPaid, queueInvoice, queuedInvoices } = setup({
      pending: [],
      paidResweep: [paidOrder],
    })

    const summary = await pollPendingOrders({
      payload,
      fetchState,
      onPaid,
      queueInvoice,
      invoicingEnabled: () => {
        throw new Error('Számlázz.hu-konfigurációs hiba: érvénytelen SZAMLAZZ_API_URL')
      },
      now: NOW,
    })

    expect(summary.invoiceResweep).toBe('skipped-config-error')
    expect(queuedInvoices).toHaveLength(0)
  })
})

/**
 * Megszakító (circuit breaker) — és ami ennél is fontosabb: a SORFEJ-BLOKKOLÁS
 * (poison pill) elkerülése.
 *
 * Élesben két, ELLENTÉTES kockázat feszül egymásnak:
 * (a) ha a BARION_POSKEY_* ál-értékre van állítva, az induláskori ENV-assert
 *     ÁTENGEDI (csak a kulcs meglétét nézi) — gát nélkül futásonként 25 hibás
 *     hívás és 25 error-sor menne ki;
 * (b) ha a megszakítás TÚL tág, akkor EGYETLEN hibás rendelés sorfejként
 *     befagyaszthatja az összes többit, azaz pont a mentőhálót viszi el.
 *
 * Ezért: hitelesítési hibára AZONNAL megszakítunk (ott a maradék hívás
 * garantáltan ugyanígy elhasal), szállítási hibára viszont csak
 * MAX_CONSECUTIVE_TRANSPORT_FAILURES egymást követő hiba után — közbeeső siker
 * a számlálót nullázza.
 */
describe('order-poll — hibaosztályozás (classifyBarionFailure)', () => {
  it('HTTP 401/403 → auth (azonnali megszakítás)', () => {
    for (const httpStatus of [401, 403]) {
      expect(
        classifyBarionFailure(
          new BarionApiError({ message: 'x', kind: 'http', endpoint: 'GET x', httpStatus }),
        ),
      ).toBe('auth')
    }
  })

  it('ismert provider auth-hibakód HTTP 200 mellett is → auth', () => {
    expect(
      classifyBarionFailure(
        new BarionApiError({
          message: 'auth',
          kind: 'provider',
          endpoint: 'GET x',
          httpStatus: 200,
          providerErrors: [
            { ErrorCode: 'AuthenticationFailed', Title: 'Hitelesítés', Description: '' },
          ],
        }),
      ),
    ).toBe('auth')
  })

  /**
   * A korábbi `/auth/i` MINTAILLESZTÉS ezt a kódot is auth-nak minősítette
   * volna, és egyetlen rendelés miatt megszakította volna az egész futást. A
   * pontos egyezésre szűrés ezt a hamis pozitívot zárja ki — a valódi
   * hitelesítési hibát pedig a 401/403 ág, illetve az ismert kódok listája fogja.
   */
  it('ismeretlen, „auth" szót tartalmazó hibakód NEM auth (nincs hamis megszakítás)', () => {
    expect(
      classifyBarionFailure(
        new BarionApiError({
          message: 'ismeretlen',
          kind: 'provider',
          endpoint: 'GET x',
          httpStatus: 200,
          providerErrors: [
            { ErrorCode: 'PayerAuthenticationPending', Title: 'Folyamatban', Description: '' },
          ],
        }),
      ),
    ).toBe('unknown')
  })

  it.each([
    ['timeout', new BarionApiError({ message: 't', kind: 'timeout', endpoint: 'GET x' })],
    ['network', new BarionApiError({ message: 'n', kind: 'network', endpoint: 'GET x' })],
    [
      'HTTP 503',
      new BarionApiError({ message: '503', kind: 'http', endpoint: 'GET x', httpStatus: 503 }),
    ],
  ])('%s → transport', (_label, error) => {
    expect(classifyBarionFailure(error)).toBe('transport')
  })

  /**
   * Cáfolható állítás (a-callback-5 / r-barion-11): eddig MINDEN 404 `order`
   * volt, tehát egy útvonal-eltérés („No HTTP resource was found…", Errors
   * tömb nélkül) egy óra után lezárta az élő függő rendelést. Most csak a
   * kifejezett not-found kód definitív, bármilyen HTTP-státusszal.
   */
  it('csak a PaymentNotFound kód → order; a puszta 404 → unverified-404', () => {
    expect(
      classifyBarionFailure(
        new BarionApiError({ message: '404', kind: 'http', endpoint: 'GET x', httpStatus: 404 }),
      ),
    ).toBe('unverified-404')
    expect(
      classifyBarionFailure(
        new BarionApiError({
          message: '404 + idegen kód',
          kind: 'http',
          endpoint: 'GET x',
          httpStatus: 404,
          providerErrors: [{ ErrorCode: 'SomethingElse', Title: 'DUMMY', Description: '' }],
        }),
      ),
    ).toBe('unverified-404')
    for (const [kind, httpStatus] of [
      ['http', 404],
      ['http', 400],
      ['provider', 200],
    ] as const) {
      expect(
        classifyBarionFailure(
          new BarionApiError({
            message: 'DUMMY not found',
            kind,
            endpoint: 'GET x',
            httpStatus,
            providerErrors: [{ ErrorCode: 'PaymentNotFound', Title: 'DUMMY', Description: '' }],
          }),
        ),
      ).toBe('order')
    }
    expect(classifyBarionFailure(new Error('fetch failed'))).toBe('unknown')
    expect(classifyBarionFailure(undefined)).toBe('unknown')
  })
})

/** A Barion kifejezett „nincs ilyen fizetés" válasza (repo-fixtúra kódja, lásd process-callback.ts). */
function definitiveNotFound(): BarionApiError {
  return new BarionApiError({
    message: 'DUMMY payment not found',
    kind: 'http',
    endpoint: 'GET state',
    httpStatus: 404,
    providerErrors: [
      { ErrorCode: 'PaymentNotFound', Title: 'DUMMY not found', Description: 'DUMMY' },
    ],
  })
}

/** Útvonal-eltérés alakú válasz: HTTP 404, Barion Errors tömb nélkül. */
function bareNotFound(): BarionApiError {
  return new BarionApiError({
    message: 'Barion API hiba (HTTP 404, GET /v4/Payment/…/PaymentState).',
    kind: 'http',
    endpoint: 'GET state',
    httpStatus: 404,
  })
}

function errorLog() {
  const errors: string[] = []
  const nothing = (): void => undefined
  const log = {
    child: () => log,
    debug: nothing,
    info: nothing,
    warn: nothing,
    error: (message: string) => errors.push(message),
  }
  return { log, errors }
}

describe('order-poll — puszta 404 (Barion-hibajelzés nélkül) önmagában nem zár le', () => {
  it('a türelmi időnél régebbi függő rendelés is payment_pending marad, fojtott RIASZTÁS, forgatás', async () => {
    const stale = createPendingOrder({
      createdAt: new Date(NOW - UNKNOWN_PAYMENT_CANCEL_AFTER_MS - 60_000).toISOString(),
    })
    const { payload, fetchState, onPaid, queueInvoice, orderUpdates } = setup({
      pending: [stale],
      stateError: bareNotFound(),
    })
    const { log, errors } = errorLog()

    const summary = await pollPendingOrders({
      payload,
      fetchState,
      onPaid,
      queueInvoice,
      now: NOW,
      logger: log as never,
      invoicingEnabled: () => false,
    })

    expect(stale.status).toBe('payment_pending')
    expect(summary.cancelled).toBe(0)
    expect(summary.failed).toBe(1)
    expect(orderUpdates).toEqual([{ status: 'payment_pending' }])
    expect(errors.filter((message) => message.includes('HTTP 404'))).toHaveLength(1)
    expect(errors[0]).toContain('RIASZTÁS')

    // Ugyanarra a rendelésre a következő futás a cooldown alatt nem ír új riasztást.
    await pollPendingOrders({
      payload,
      fetchState,
      onPaid,
      queueInvoice,
      now: NOW + 300_000,
      logger: log as never,
      invoicingEnabled: () => false,
    })
    expect(errors.filter((message) => message.includes('HTTP 404'))).toHaveLength(1)
    expect(stale.status).toBe('payment_pending')
  })

  /**
   * fix-404 rev1 (B1): a late-success scan csak lezárt sort néz, ezért a
   * függő sorokra szóló „most NEM zárjuk le … a poll lezárja" RIASZTÁS itt
   * hamis volt: a poll által lezárt régi sorra a 7 napos ablak végéig 6
   * óránként újra kiment. A lezárt sorra jövő puszta 404 most csak forgat.
   */
  it('a late-success scan puszta 404-re nem ír státuszt és nem riaszt, csak forgat', async () => {
    const cancelled = createPendingOrder({
      id: 610,
      status: 'cancelled',
      updatedAt: isoHoursAgo(2),
    })
    const { payload, fetchState, onPaid, queueInvoice, paidCalls, orderUpdates } = setup({
      pending: [],
      lateSuccess: [cancelled],
      stateError: bareNotFound(),
    })
    const { log, errors } = errorLog()

    await pollPendingOrders({
      payload,
      fetchState,
      onPaid,
      queueInvoice,
      now: NOW,
      logger: log as never,
      invoicingEnabled: () => false,
    })

    expect(cancelled.status).toBe('cancelled')
    expect(paidCalls).toHaveLength(0)
    expect(errors).toEqual([])
    // A cím „forgat" állítása (H13): státusz-változatlan touch, a sor a végére kerül.
    expect(orderUpdates).toEqual([{ status: 'cancelled' }])
    expect(cancelled.updatedAt).toBe(new Date(NOW).toISOString())
  })

  /**
   * A globális útvonal-eltérés MINDEN hívást 404-re visz: ez a futás eleji
   * mennyezetbe számít, a futás megáll. A forgatás miatt viszont nem lesz
   * sorfej-blokkoló: a következő futás a többi sorral kezd.
   */
  it('öt puszta 404 a futás elején megszakít, a következő futás a hatodikkal kezd és lezárja', async () => {
    const pending = Array.from({ length: 6 }, (_, index) =>
      createPendingOrder({
        id: 700 + index,
        barionPaymentId: `DUMMY-bare-${index}`,
        createdAt: isoHoursAgo(0.5),
        updatedAt: new Date(NOW - (6 - index) * 60_000).toISOString(),
      }),
    )
    const f = setup({ pending })
    const { log, errors } = errorLog()
    const fetchState = vi.fn(async (paymentId: string) => {
      if (paymentId !== pending[5].barionPaymentId) throw bareNotFound()
      return getStateResponse('Succeeded', { PaymentId: paymentId })
    })

    const first = await pollPendingOrders({
      ...f,
      fetchState,
      now: NOW,
      logger: log as never,
      invoicingEnabled: () => false,
    })
    expect(fetchState).toHaveBeenCalledTimes(MAX_LEADING_FAILURES)
    expect(first.skipped).toBe(1)
    expect(pending[5].status).toBe('payment_pending')
    expect(errors.some((message) => message.includes('tisztázatlan Barion-hiba'))).toBe(true)

    fetchState.mockClear()
    await pollPendingOrders({
      ...f,
      fetchState,
      now: NOW + 300_000,
      logger: log as never,
      invoicingEnabled: () => false,
    })
    expect(fetchState.mock.calls[0]?.[0]).toBe(pending[5].barionPaymentId)
    expect(pending[5].status).toBe('paid')
    expect(pending.slice(0, 5).every((order) => order.status === 'payment_pending')).toBe(true)
  })
})

describe('order-poll — a Barion által nem ismert függő fizetés (not-found kód)', () => {
  const notFound = definitiveNotFound

  it('a türelmi időnél régebbi függő rendelés → cancelled (a vevő újrakezdheti)', async () => {
    // Cáfolható állítás: eddig a 404 csak „forgatta" a sort, ami örökre
    // payment_pending maradt, és 5 percenként fölösleges GetState ment rá.
    const stale = createPendingOrder({
      createdAt: new Date(NOW - UNKNOWN_PAYMENT_CANCEL_AFTER_MS - 60_000).toISOString(),
    })
    const { payload, fetchState, onPaid, queueInvoice, paidCalls } = setup({
      pending: [stale],
      stateError: notFound(),
    })

    const summary = await pollPendingOrders({ payload, fetchState, onPaid, queueInvoice, now: NOW })

    expect(stale.status).toBe('cancelled')
    expect(summary.cancelled).toBe(1)
    expect(paidCalls).toHaveLength(0)
  })

  it('friss függő rendelés 404-gyel → marad payment_pending (csak forgatás)', async () => {
    const fresh = createPendingOrder({ createdAt: isoHoursAgo(0.25) })
    const { payload, fetchState, onPaid, queueInvoice } = setup({
      pending: [fresh],
      stateError: notFound(),
    })

    const summary = await pollPendingOrders({ payload, fetchState, onPaid, queueInvoice, now: NOW })

    expect(fresh.status).toBe('payment_pending')
    expect(summary.cancelled).toBe(0)
    expect(summary.failed).toBe(1)
  })
})

describe('order-poll — definitív hibák forgatása (PAY-POLL)', () => {
  // A definitív „nincs ilyen fizetés" a kifejezett not-found kód; a puszta 404
  // forgatását a „puszta 404" describe fedi.
  const missing = definitiveNotFound
  const timeout = () =>
    new BarionApiError({
      message: 'DUMMY timeout',
      kind: 'timeout',
      endpoint: 'GET state',
    })
  const batch = (count: number, status: 'payment_pending' | 'cancelled' = 'payment_pending') =>
    Array.from({ length: count }, (_, index) =>
      createPendingOrder({
        id: 2000 + index,
        status,
        barionPaymentId: `DUMMY-poll-${index}`,
        // A forgatás-tesztek FRISS (az UNKNOWN_PAYMENT_CANCEL_AFTER_MS-en belüli)
        // sorokat feltételeznek: a türelmi időn túli 404 már cancelled-et ír.
        createdAt: isoHoursAgo(0.5),
        updatedAt: new Date(NOW - (count - index) * 60_000).toISOString(),
      }),
    )

  it('a tartósan bizonytalan refundok két futás között forognak, az ablakon túli fizetés halad új money POST nélkül', async () => {
    const orders = batch(2 * ORDER_POLL_BATCH_SIZE + 1)
    const target = orders.at(-1)!
    const ledgers = new Map(orders.map((order) => [order.id, refundFixture(order)]))
    for (const [id, ledger] of ledgers) ledger.failures.otherPaid = id !== target.id
    const f = setup({ pending: orders })
    const post = vi.fn(async () => {
      throw new Error('SYNTHETIC response loss')
    })
    const fetchState = vi.fn(async (paymentId: string) =>
      getStateResponse('Succeeded', {
        PaymentId: paymentId,
        Transactions: [
          {
            TransactionId: 'aaaaaaaa-bbbb-cccc-dddd-123456789012',
            POSTransactionId: `${ORDER_NUMBER}-1`,
            TransactionType: 'CardPayment',
            Status: 'Succeeded',
            Total: ORDER_TOTAL_HUF,
          },
        ],
      }),
    )
    const reasons: string[] = []
    const applyTransition: typeof applyBarionStateTransition = async (input) => {
      const transition = await applyBarionStateTransition({
        ...input,
        payload: ledgers.get(input.order.id)!.payload,
      })
      if (transition.reason) reasons.push(transition.reason)
      return transition
    }
    const recoverRejectedPaid = (input: Parameters<typeof recoverRejectedSucceededPayment>[0]) =>
      recoverRejectedSucceededPayment({
        ...input,
        payload: ledgers.get(input.order.id)!.payload,
        refundPayment: post,
      })
    await pollPendingOrders({
      ...f,
      fetchState,
      applyTransition,
      recoverRejectedPaid,
      now: NOW,
      invoicingEnabled: () => false,
    })
    expect(post).toHaveBeenCalledTimes(2 * ORDER_POLL_BATCH_SIZE)
    expect(target.status).toBe('payment_pending')
    expect(reasons).toEqual(Array(2 * ORDER_POLL_BATCH_SIZE).fill('duplicate-paid-order'))
    // A duplicate-őr közben megszűnt, de a tartós refund továbbra is tilt/forog.
    for (const ledger of ledgers.values()) ledger.failures.otherPaid = false
    reasons.length = 0
    fetchState.mockClear()
    await pollPendingOrders({
      ...f,
      fetchState,
      applyTransition,
      recoverRejectedPaid,
      now: NOW + 300_000,
      invoicingEnabled: () => false,
    })
    expect(target.status).toBe('paid')
    expect(fetchState.mock.calls.flat()).toContain(target.barionPaymentId)
    expect(fetchState).toHaveBeenCalledTimes(2 * ORDER_POLL_BATCH_SIZE)
    expect(reasons.length).toBeGreaterThan(0)
    expect(reasons.every((reason) => reason === 'refund-pending-reconciliation')).toBe(true)
    expect(post).toHaveBeenCalledTimes(2 * ORDER_POLL_BATCH_SIZE)
  })

  it('öt HTTP 404 mögött a hatodik Succeeded fizetést is lezárja', async () => {
    const pending = batch(6)
    const f = setup({ pending })
    const fetchState = vi.fn(async (paymentId: string) => {
      if (paymentId !== pending[5].barionPaymentId) throw missing()
      return getStateResponse('Succeeded', { PaymentId: paymentId })
    })
    const summary = await pollPendingOrders({
      ...f,
      fetchState,
      now: NOW,
      invoicingEnabled: () => false,
    })
    expect(fetchState).toHaveBeenCalledTimes(6)
    expect(summary.failed).toBe(5)
    expect(summary.transitionedPaid).toBe(1)
    expect(summary.skipped).toBe(0)
    expect(pending[5].status).toBe('paid')
    expect(
      pending.slice(0, 5).every((order) => order.updatedAt === new Date(NOW).toISOString()),
    ).toBe(true)
  })

  it.each(['payment_pending', 'cancelled'] as const)(
    '%s: az ablakon túli fizetés a következő futásban sorra kerül',
    async (status) => {
      const pageLimit =
        status === 'payment_pending' ? 2 * ORDER_POLL_BATCH_SIZE : 2 * LATE_SUCCESS_BATCH_SIZE
      // A lezárt sorok a fizetési ablak vége + 60 perc utáni ellenőrzési pontra
      // esedékesek (lateSuccessPollDue): 2 órás rendelés, 1 óránál régebbi érintés.
      const orders = batch(pageLimit + 2, status).map((order, index, all) =>
        status === 'cancelled'
          ? Object.assign(order, {
              createdAt: isoHoursAgo(2),
              updatedAt: new Date(NOW - 3600_000 - (all.length - index) * 60_000).toISOString(),
            })
          : order,
      )
      const f = setup(
        status === 'payment_pending' ? { pending: orders } : { pending: [], lateSuccess: orders },
      )
      const target = orders.at(-1)!
      const fetchState = vi.fn(async (paymentId: string) => {
        if (paymentId !== target.barionPaymentId) throw missing()
        return getStateResponse('Succeeded', { PaymentId: paymentId })
      })
      await pollPendingOrders({ ...f, fetchState, now: NOW, invoicingEnabled: () => false })
      expect(fetchState).toHaveBeenCalledTimes(pageLimit)
      expect(fetchState.mock.calls.flat()).not.toContain(target.barionPaymentId)
      fetchState.mockClear()
      await pollPendingOrders({
        ...f,
        fetchState,
        now: NOW + 300_000,
        invoicingEnabled: () => false,
      })
      expect(fetchState.mock.calls.flat()).toContain(target.barionPaymentId)
      expect(fetchState.mock.calls.length).toBeLessThanOrEqual(pageLimit)
      expect(target.status).toBe('paid')
    },
  )

  it('a definitív rendelésválasz megszakítja az egymást követő transport hibákat', async () => {
    const f = setup({ pending: batch(6) })
    const failures = [timeout(), missing(), timeout(), missing(), timeout(), null]
    let index = 0
    const fetchState = vi.fn(async () => {
      const error = failures[index++]
      if (error) throw error
      return getStateResponse('Prepared')
    })
    const summary = await pollPendingOrders({
      ...f,
      fetchState,
      now: NOW,
      invoicingEnabled: () => false,
    })
    expect(fetchState).toHaveBeenCalledTimes(6)
    expect(summary.stillPending).toBe(1)
    expect(summary.skipped).toBe(0)
  })

  it('a touch írási hibája nem állítja meg a hatodik fizetést, a figyelmeztetés futásonként egy', async () => {
    const pending = batch(6)
    const f = setup({ pending })
    const original = f.payload as unknown as {
      update(args: { id?: number; data: Record<string, unknown> }): Promise<unknown>
    }
    const payload = {
      ...(f.payload as unknown as Record<string, unknown>),
      update: async (args: { id?: number; data: Record<string, unknown> }) => {
        if (args.data.status === 'payment_pending') throw new Error('DUMMY touch failure')
        return original.update(args)
      },
    } as unknown as Payload
    const warn = vi.fn()
    const logger = { child: () => logger, debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }
    const fetchState = vi.fn(async (paymentId: string) => {
      if (paymentId !== pending[5].barionPaymentId) throw missing()
      return getStateResponse('Succeeded', { PaymentId: paymentId })
    })
    await pollPendingOrders({
      ...f,
      payload,
      fetchState,
      now: NOW,
      invoicingEnabled: () => false,
      logger,
    })
    expect(fetchState).toHaveBeenCalledTimes(6)
    expect(pending[5].status).toBe('paid')
    expect(
      warn.mock.calls.filter(([message]) => String(message).includes('sorforgatás')),
    ).toHaveLength(1)
  })

  it('a GetState alatt paid lett sort a 404 utáni touch nem rontja vissza', async () => {
    const pending = batch(1)
    const f = setup({ pending })
    await pollPendingOrders({
      ...f,
      now: NOW,
      invoicingEnabled: () => false,
      fetchState: async () => {
        pending[0].status = 'paid'
        throw missing()
      },
    })
    expect(pending[0].status).toBe('paid')
    expect(f.orderUpdates).toEqual([])
  })

  it('ismeretlen kivétel/provider kód nem definitív rendelés-hiba', () => {
    expect(classifyBarionFailure(new Error('DUMMY unknown'))).toBe('unknown')
    expect(
      classifyBarionFailure(
        new BarionApiError({
          message: 'DUMMY unrecognized code',
          kind: 'provider',
          endpoint: 'GET state',
          providerErrors: [{ ErrorCode: 'Unrecognized', Title: 'DUMMY', Description: 'DUMMY' }],
        }),
      ),
    ).toBe('unknown')
  })
})

describe('order-poll — megszakítás és sorfej-blokkolás', () => {
  function pendingBatch(count: number): Order[] {
    return Array.from({ length: count }, (_, index) =>
      createPendingOrder({ id: 300 + index, orderNumber: `KH-2026-00${300 + index}` }),
    )
  }

  /** Futtatás egy hibasorozattal: az i. hívás az i. elemet dobja (null = siker). */
  async function runWithFailures(
    orders: Order[],
    failures: (BarionApiError | null | undefined)[],
  ): Promise<{ calls: number; summary: Awaited<ReturnType<typeof pollPendingOrders>> }> {
    const { payload, onPaid, queueInvoice } = setup({ pending: orders })
    let calls = 0
    const fetchState = async (): Promise<BarionPaymentStateResponse> => {
      const failure = failures[calls]
      calls += 1
      if (failure) {
        throw failure
      }
      // Sikeres, de még függő fizetés — nem billenti át az állapotgépet.
      return getStateResponse('Prepared')
    }

    const summary = await pollPendingOrders({
      payload,
      fetchState,
      onPaid,
      queueInvoice,
      invoicingEnabled: () => false,
      now: NOW,
    })
    return { calls, summary }
  }

  const timeout = (): BarionApiError =>
    new BarionApiError({ message: 'timeout', kind: 'timeout', endpoint: 'GET x' })

  it('hitelesítési hiba (HTTP 401) → az ELSŐ rendelés után megáll, a többi skipped', async () => {
    const { calls, summary } = await runWithFailures(pendingBatch(4), [
      new BarionApiError({
        message: 'Barion API hiba (HTTP 401, GET /v4/Payment/…/PaymentState).',
        kind: 'http',
        endpoint: 'GET /v4/Payment/{PaymentId}/PaymentState',
        httpStatus: 401,
      }),
    ])

    expect(calls).toBe(1)
    expect(summary.scanned).toBe(4)
    expect(summary.failed).toBe(1)
    expect(summary.skipped).toBe(3)
  })

  it('EGY szállítási hiba NEM szakít meg — a többi rendelés lefut (nincs poison pill)', async () => {
    const { calls, summary } = await runWithFailures(pendingBatch(4), [timeout()])

    expect(calls).toBe(4)
    expect(summary.failed).toBe(1)
    expect(summary.skipped).toBe(0)
    expect(summary.stillPending).toBe(3)
  })

  it(`${MAX_CONSECUTIVE_TRANSPORT_FAILURES} EGYMÁST KÖVETŐ szállítási hiba → megszakít`, async () => {
    const { calls, summary } = await runWithFailures(pendingBatch(6), [
      timeout(),
      timeout(),
      timeout(),
    ])

    expect(calls).toBe(MAX_CONSECUTIVE_TRANSPORT_FAILURES)
    expect(summary.failed).toBe(MAX_CONSECUTIVE_TRANSPORT_FAILURES)
    expect(summary.skipped).toBe(6 - MAX_CONSECUTIVE_TRANSPORT_FAILURES)
  })

  /**
   * A számláló NULLÁZÓDIK a sikeres hívásra: szórványos hibák (két hiba, siker,
   * két hiba) nem érik el a küszöböt, tehát a futás végigmegy. Ez a különbség
   * az „egymást követő" és az „összesen" szabály között.
   */
  it('közbeeső SIKER nullázza a számlálót — szórványos hiba nem szakít meg', async () => {
    const { calls, summary } = await runWithFailures(pendingBatch(6), [
      timeout(),
      timeout(),
      null,
      timeout(),
      timeout(),
    ])

    expect(calls).toBe(6)
    expect(summary.failed).toBe(4)
    expect(summary.skipped).toBe(0)
  })

  /**
   * A kifejezett not-found kód EGY fizetésre vonatkozik (nincs ilyen
   * PaymentId), nem az egész integrációra. Nem növeli a szállítási számlálót,
   * és a futás eleji mennyezetbe sem számít, tehát sok ilyen rekord sem tudja
   * megszakítani a futást — különben egyetlen hibás rendelés befagyasztaná az
   * egész mentőhálót.
   */
  it('csupa kifejezett not-found → SOHA nem szakít meg, minden rendelés sorra kerül', async () => {
    const orders = pendingBatch(MAX_LEADING_FAILURES + 2)
    const { calls, summary } = await runWithFailures(
      orders,
      orders.map(() => definitiveNotFound()),
    )

    expect(calls).toBe(orders.length)
    expect(summary.failed).toBe(orders.length)
    expect(summary.skipped).toBe(0)
  })

  /**
   * A puszta 404 viszont (Barion-hibajelzés nélkül) útvonal- vagy
   * verzióváltásra utal, ami minden hívást érint: a futás eleji mennyezet
   * megállítja, mint bármely tisztázatlan hibát.
   */
  it('csupa puszta 404 → a futás eleji mennyezet után megszakít', async () => {
    const orders = pendingBatch(MAX_LEADING_FAILURES + 2)
    const { calls, summary } = await runWithFailures(
      orders,
      orders.map(() => bareNotFound()),
    )

    expect(calls).toBe(MAX_LEADING_FAILURES)
    expect(summary.failed).toBe(MAX_LEADING_FAILURES)
    expect(summary.skipped).toBe(2)
  })
})

describe('order-poll — a futás eleji mennyezet (MAX_LEADING_FAILURES)', () => {
  /**
   * A keresztreview mutatott rá: a BARION_AUTH_ERROR_CODES listán NEM szereplő
   * hitelesítési hibakód `unknown`-osztályba esik (provider-hiba HTTP 200-zal),
   * tehát a 3 egymást követő SZÁLLÍTÁSI hibára figyelő megszakítás nem kapja
   * el — a futás végigmenne az összes függő rendelésen. Erre való a mennyezet.
   */
  const ismeretlenAuthHiba = (): BarionApiError =>
    new BarionApiError({
      message: 'ismeretlen szolgáltatói hiba',
      kind: 'provider',
      endpoint: 'GET x',
      httpStatus: 200,
      providerErrors: [{ ErrorCode: 'SomeUnlistedAuthProblem', Title: 'x', Description: 'x' }],
    })

  const naplo = () => {
    const errors: string[] = []
    const nulla = (): void => undefined
    const log = {
      child: () => log,
      debug: nulla,
      info: nulla,
      warn: nulla,
      error: (message: string) => errors.push(message),
    }
    return { log, errors }
  }

  it('csupa `unknown`-osztályú hibánál az első MAX_LEADING_FAILURES után megszakít', async () => {
    const pending = Array.from({ length: 12 }, () => createPendingOrder())
    const { payload, onPaid, queueInvoice } = setup({ pending })
    const { log, errors } = naplo()
    const fetchState = vi.fn(async (): Promise<BarionPaymentStateResponse> => {
      throw ismeretlenAuthHiba()
    })

    const summary = await pollPendingOrders({
      payload,
      fetchState,
      onPaid,
      queueInvoice,
      now: NOW,
      logger: log as never,
    })

    expect(fetchState).toHaveBeenCalledTimes(MAX_LEADING_FAILURES)
    expect(summary.failed).toBe(MAX_LEADING_FAILURES)
    expect(summary.skipped).toBe(pending.length - MAX_LEADING_FAILURES)
    expect(errors.some((message) => message.includes('RIASZTÁS'))).toBe(true)
  })

  it('EGY sikeres válasz kikapcsolja a mennyezetet — nincs sorfej-blokkolás', async () => {
    const pending = Array.from({ length: 12 }, () => createPendingOrder())
    const { payload, onPaid, queueInvoice } = setup({ pending })
    const { log } = naplo()
    let hivas = 0
    const fetchState = vi.fn(async (): Promise<BarionPaymentStateResponse> => {
      hivas += 1
      // Az ELSŐ hívás sikeres (a fizetés még folyamatban), a többi hibás.
      if (hivas === 1) {
        return getStateResponse('Prepared')
      }
      throw ismeretlenAuthHiba()
    })

    const summary = await pollPendingOrders({
      payload,
      fetchState,
      onPaid,
      queueInvoice,
      now: NOW,
      logger: log as never,
    })

    expect(fetchState).toHaveBeenCalledTimes(pending.length)
    expect(summary.skipped).toBe(0)
  })
})

/**
 * W1 — rejected sorfej (head-of-line). 25 total-mismatch poison a legrégebbi
 * updatedAt-tel kitölti az ablakot; a 26. Succeeded rendelés csak akkor
 * zárul paid-re UGYANABBAN a pollPendingOrders-hívásban, ha a rejected
 * sorokat megérintjük és egy pótlapot kérünk a már látott id-k nélkül.
 */
describe('order-poll — W1 rejected sorfej (updatedAt + touch + pótlap)', () => {
  const PAYABLE_ID = 499

  function poisonBatch(): Order[] {
    return Array.from({ length: ORDER_POLL_BATCH_SIZE }, (_, index) =>
      createPendingOrder({
        id: 400 + index,
        orderNumber: `KH-POISON-${index}`,
        barionPaymentId: `poison-${String(index).padStart(2, '0')}`,
        createdAt: isoHoursAgo(10),
        updatedAt: isoHoursAgo(10),
      }),
    )
  }

  it('25 rejected + 1 újabb Succeeded → egy futásban transitionedPaid >= 1 (a 26. paid)', async () => {
    const poisons = poisonBatch()
    const payable = createPendingOrder({
      id: PAYABLE_ID,
      orderNumber: 'KH-PAYABLE',
      barionPaymentId: 'payable-payment',
      createdAt: isoHoursAgo(1),
      updatedAt: isoHoursAgo(1),
    })
    const { payload, onPaid, queueInvoice, paidCalls, finds } = setup({
      pending: [...poisons, payable],
      stateStatus: 'Succeeded',
    })

    const fetchState = vi.fn(async (paymentId: string): Promise<BarionPaymentStateResponse> => {
      return getStateResponse('Succeeded', { PaymentId: paymentId })
    })

    const applyTransition = vi.fn(async ({ order }: { order: Order }) => {
      if (order.id === PAYABLE_ID) {
        return { action: 'paid' as const, transitionedToPaid: true }
      }
      return { action: 'rejected' as const, reason: 'total-mismatch' }
    }) as unknown as typeof applyBarionStateTransition

    const summary = await pollPendingOrders({
      payload,
      fetchState,
      onPaid,
      queueInvoice,
      applyTransition,
      invoicingEnabled: () => false,
      now: NOW,
    })

    expect(summary.transitionedPaid).toBeGreaterThanOrEqual(1)
    expect(paidCalls).toEqual([PAYABLE_ID])
    expect(summary.failed).toBe(ORDER_POLL_BATCH_SIZE)
    expect(summary.scanned).toBe(ORDER_POLL_BATCH_SIZE + 1)

    // GetState a rejected sorokra NEM ismétlődik — a pótlap csak a nem látott id.
    expect(fetchState).toHaveBeenCalledTimes(ORDER_POLL_BATCH_SIZE + 1)
    expect(fetchState).toHaveBeenCalledWith('payable-payment')

    expect(finds.length).toBeGreaterThanOrEqual(2)
    expect(finds[0]?.sort).toBe('updatedAt')
    expect(finds[0]?.limit).toBe(ORDER_POLL_BATCH_SIZE)
    const refill = finds.find((entry, index) => index > 0 && extractNotInIds(entry.where))
    expect(refill).toBeDefined()
    expect(extractNotInIds(refill?.where)).toEqual(
      expect.arrayContaining(poisons.map((order) => order.id)),
    )
    expect(extractNotInIds(refill?.where)).not.toContain(PAYABLE_ID)

    for (const poison of poisons) {
      expect(poison.status).toBe('payment_pending')
    }
  })

  it('25 still-pending Prepared + 1 Succeeded → egy futásban a 26. paid (pótlap still-pendingre is)', async () => {
    const PAYABLE_ID = 499
    const stuck = Array.from({ length: ORDER_POLL_BATCH_SIZE }, (_, index) =>
      createPendingOrder({
        id: 400 + index,
        orderNumber: `KH-STUCK-${index}`,
        barionPaymentId: `stuck-${String(index).padStart(2, '0')}`,
        createdAt: isoHoursAgo(2),
        updatedAt: isoHoursAgo(10),
      }),
    )
    const payable = createPendingOrder({
      id: PAYABLE_ID,
      orderNumber: 'KH-PAYABLE',
      barionPaymentId: 'payable-payment',
      createdAt: isoHoursAgo(1),
      updatedAt: isoHoursAgo(1),
    })
    const { payload, onPaid, queueInvoice, paidCalls } = setup({
      pending: [...stuck, payable],
    })

    const fetchState = vi.fn(async (paymentId: string): Promise<BarionPaymentStateResponse> => {
      if (paymentId === 'payable-payment') {
        return getStateResponse('Succeeded', { PaymentId: paymentId })
      }
      return getStateResponse('Prepared', { PaymentId: paymentId })
    })

    const applyTransition = vi.fn(async ({ order }: { order: Order }) => {
      if (order.id === PAYABLE_ID) {
        return { action: 'paid' as const, transitionedToPaid: true }
      }
      return { action: 'pending' as const }
    }) as unknown as typeof applyBarionStateTransition

    const summary = await pollPendingOrders({
      payload,
      fetchState,
      onPaid,
      queueInvoice,
      applyTransition,
      invoicingEnabled: () => false,
      now: NOW,
    })

    expect(summary.transitionedPaid).toBeGreaterThanOrEqual(1)
    expect(paidCalls).toEqual([PAYABLE_ID])
    expect(fetchState).toHaveBeenCalledTimes(ORDER_POLL_BATCH_SIZE + 1)
    expect(fetchState).toHaveBeenCalledWith('payable-payment')
  })

  it('a függő ablak updatedAt szerint nyílik (nem createdAt)', async () => {
    const { payload, fetchState, onPaid, queueInvoice, finds } = setup({
      pending: [createPendingOrder()],
      stateStatus: 'Prepared',
    })

    await pollPendingOrders({
      payload,
      fetchState,
      onPaid,
      queueInvoice,
      invoicingEnabled: () => false,
      now: NOW,
    })

    const pendingFinds = finds.filter((entry) => {
      const json = JSON.stringify(entry.where ?? {})
      return json.includes('payment_pending')
    })
    expect(pendingFinds.length).toBeGreaterThanOrEqual(1)
    expect(pendingFinds[0]?.sort).toBe('updatedAt')
    expect(pendingFinds[0]?.sort).not.toBe('createdAt')
  })
})

describe('order-poll — R-03 late-success (cancelled + Succeeded)', () => {
  it('cancelled rendelés + Barion Succeeded → paid + onPaid', async () => {
    const cancelled = createPendingOrder({
      id: 808,
      status: 'cancelled',
      barionPaymentId: 'late-success-payment',
      createdAt: isoHoursAgo(2),
    })
    const { payload, fetchState, onPaid, queueInvoice, paidCalls, user } = setup({
      pending: [],
      lateSuccess: [cancelled],
      stateStatus: 'Succeeded',
    })

    const summary = await pollPendingOrders({
      payload,
      fetchState,
      onPaid,
      queueInvoice,
      invoicingEnabled: () => false,
      now: NOW,
    })

    expect(summary.lateSuccessScanned).toBe(1)
    expect(summary.transitionedPaid).toBe(1)
    expect(cancelled.status).toBe('paid')
    expect(user.purchases).toEqual([42])
    expect(paidCalls).toEqual([808])
  })

  it('cancelled + Expired → no-op, nem számít cancelled-nek újra', async () => {
    const cancelled = createPendingOrder({
      id: 809,
      status: 'cancelled',
      barionPaymentId: 'already-cancelled-payment',
      createdAt: isoHoursAgo(2),
    })
    const { payload, onPaid, queueInvoice, paidCalls } = setup({
      pending: [],
      lateSuccess: [cancelled],
      stateStatus: 'Expired',
    })

    const summary = await pollPendingOrders({
      payload,
      fetchState: async () => getStateResponse('Expired'),
      onPaid,
      queueInvoice,
      invoicingEnabled: () => false,
      now: NOW,
    })

    expect(summary.lateSuccessScanned).toBe(1)
    expect(summary.cancelled).toBe(0)
    expect(summary.transitionedPaid).toBe(0)
    expect(cancelled.status).toBe('cancelled')
    expect(paidCalls).toHaveLength(0)
  })

  it('cancelled + Succeeded + duplicate reject → recover lefut', async () => {
    const cancelled = createPendingOrder({
      id: 810,
      status: 'cancelled',
      barionPaymentId: 'dup-late-payment',
      createdAt: isoHoursAgo(1),
    })
    const { payload, onPaid, queueInvoice } = setup({
      pending: [],
      lateSuccess: [cancelled],
    })
    const recoverRejectedPaid = vi.fn(async () => ({ action: 'refunded' as const }))
    const applyTransition = vi.fn(async () => ({
      action: 'rejected' as const,
      reason: 'duplicate-paid-order',
    }))

    const summary = await pollPendingOrders({
      payload,
      fetchState: async () => getStateResponse('Succeeded'),
      onPaid,
      queueInvoice,
      applyTransition: applyTransition as never,
      recoverRejectedPaid,
      invoicingEnabled: () => false,
      now: NOW,
    })

    expect(summary.failed).toBe(1)
    expect(recoverRejectedPaid).toHaveBeenCalledTimes(1)
    const recoverInput = recoverRejectedPaid.mock.calls.at(0)?.at(0)
    expect(recoverInput).toMatchObject({
      reason: 'duplicate-paid-order',
      source: 'order-poll',
      order: expect.objectContaining({ id: 810 }),
    })
    expect(cancelled.status).toBe('cancelled')
  })

  it('late-success where: a legfiatalabb elöl (-createdAt) + barionPaymentId exists', async () => {
    const cancelled = createPendingOrder({
      id: 811,
      status: 'cancelled',
      barionPaymentId: 'late-where-payment',
      createdAt: isoHoursAgo(2),
    })
    const { payload, onPaid, queueInvoice, finds } = setup({
      pending: [],
      lateSuccess: [cancelled],
      stateStatus: 'Expired',
    })

    await pollPendingOrders({
      payload,
      fetchState: async () => getStateResponse('Expired'),
      onPaid,
      queueInvoice,
      invoicingEnabled: () => false,
      now: NOW,
    })

    const lateFinds = finds.filter((entry) => whereLooksLikeLateSuccess(entry.where))
    expect(lateFinds.length).toBeGreaterThanOrEqual(1)
    expect(lateFinds[0]?.sort).toBe('-createdAt')
    expect(JSON.stringify(lateFinds[0]?.where ?? {})).toContain('barionPaymentId')
    expect(JSON.stringify(lateFinds[0]?.where ?? {})).toContain('exists')
  })

  it('RF-3: 10 Expired (régi updatedAt) + 1 Succeeded → ugyanabban a futásban paid a refill miatt', async () => {
    const expired = Array.from({ length: LATE_SUCCESS_BATCH_SIZE }, (_, index) =>
      createPendingOrder({
        id: 900 + index,
        status: 'cancelled',
        barionPaymentId: `expired-${index}`,
        createdAt: isoHoursAgo(3),
        updatedAt: isoHoursAgo(5),
      }),
    )
    const succeeded = createPendingOrder({
      id: 999,
      status: 'cancelled',
      barionPaymentId: 'late-succeeded',
      createdAt: isoHoursAgo(1),
      updatedAt: isoHoursAgo(1),
    })
    const { payload, onPaid, queueInvoice, paidCalls } = setup({
      pending: [],
      lateSuccess: [...expired, succeeded],
    })

    const summary = await pollPendingOrders({
      payload,
      fetchState: async (paymentId: string) => {
        if (paymentId === 'late-succeeded') {
          return getStateResponse('Succeeded')
        }
        return getStateResponse('Expired')
      },
      onPaid,
      queueInvoice,
      invoicingEnabled: () => false,
      now: NOW,
    })

    expect(summary.lateSuccessScanned).toBe(LATE_SUCCESS_BATCH_SIZE + 1)
    expect(summary.transitionedPaid).toBe(1)
    expect(succeeded.status).toBe('paid')
    expect(paidCalls).toEqual([999])
    expect(expired.every((row) => row.status === 'cancelled')).toBe(true)
  })

  it('RF-4: recover failed → late-success sor NEM forog (nincs status-touch)', async () => {
    const cancelled = createPendingOrder({
      id: 812,
      status: 'cancelled',
      barionPaymentId: 'failed-recover-payment',
      createdAt: isoHoursAgo(2),
      updatedAt: isoHoursAgo(4),
    })
    const originalUpdatedAt = cancelled.updatedAt
    const { payload, onPaid, queueInvoice, orderUpdates } = setup({
      pending: [],
      lateSuccess: [cancelled],
    })
    const recoverRejectedPaid = vi.fn(async () => ({
      action: 'failed' as const,
      detail: 'barion-refund-error',
    }))
    const applyTransition = vi.fn(async () => ({
      action: 'rejected' as const,
      reason: 'duplicate-paid-order',
    }))

    await pollPendingOrders({
      payload,
      fetchState: async () => getStateResponse('Succeeded'),
      onPaid,
      queueInvoice,
      applyTransition: applyTransition as never,
      recoverRejectedPaid,
      invoicingEnabled: () => false,
      now: NOW,
    })

    expect(recoverRejectedPaid).toHaveBeenCalledTimes(1)
    expect(recoverRejectedPaid.mock.calls.at(0)?.at(0)).toMatchObject({ source: 'order-poll' })
    expect(cancelled.updatedAt).toBe(originalUpdatedAt)
    expect(orderUpdates.some((row) => row.status === 'cancelled')).toBe(false)
  })
})

describe('P0 — a poll nem írhatja vissza a refunded rendelést', () => {
  /**
   * A VALÓDI recovery fut (recoverRejectedSucceededPayment), injektált Barion
   * refund-transporttal: a Refund-hívás Refunded-et ad, a persist a DB-be
   * `status: 'refunded'`-et ír. A poll kezében lévő rendelés-példány közben
   * NEM változik (a harness `find`-je másolatot ad, mint a valódi Payload) —
   * a hibás touch tehát a friss DB-státuszt írná felül a stale in-memoryval.
   */
  type RecoverInput = Parameters<typeof recoverRejectedSucceededPayment>[0]

  const refundedTransport: NonNullable<RecoverInput['refundPayment']> = async () => ({
    PaymentId: PAYMENT_ID,
    RefundedTransactions: [
      {
        TransactionId: 'aaaaaaaa-bbbb-cccc-dddd-123456789012',
        POSTransactionId: `${ORDER_NUMBER}-1`,
        Total: ORDER_TOTAL_HUF,
        Status: 'Succeeded',
      },
    ],
  })

  const refundableState: Partial<BarionPaymentStateResponse> = {
    Transactions: [
      {
        TransactionId: 'tx-p0',
        POSTransactionId: `${ORDER_NUMBER}-1`,
        TransactionType: 'CardPayment',
        Status: 'Succeeded',
        Total: ORDER_TOTAL_HUF,
      },
    ] as BarionPaymentStateResponse['Transactions'],
  }

  it('pending + Succeeded + total-mismatch reject + sikeres auto-refund → nincs payment_pending visszaírás', async () => {
    const order = createPendingOrder({ id: 910 })
    const ledger = refundFixture(order)
    const { payload, onPaid, queueInvoice, orderUpdates, pending } = setup({
      pending: [order],
      stateOverrides: refundableState,
    })
    const originalUpdate = vi.mocked(ledger.payload.update).getMockImplementation()!
    vi.mocked(ledger.payload.update).mockImplementation(async (args) => {
      orderUpdates.push(args.data as Record<string, unknown>)
      return originalUpdate(args)
    })

    const summary = await pollPendingOrders({
      payload,
      fetchState: async () => getStateResponse('Succeeded', refundableState),
      onPaid,
      queueInvoice,
      applyTransition: (async () => ({
        action: 'rejected' as const,
        reason: 'total-mismatch',
      })) as never,
      recoverRejectedPaid: (input) =>
        recoverRejectedSucceededPayment({
          ...input,
          payload: ledger.payload,
          refundPayment: refundedTransport,
        }),
      invoicingEnabled: () => false,
      now: NOW,
    })

    expect(summary.failed).toBe(1)
    const refundedIdx = orderUpdates.findIndex((row) => row.status === 'refunded')
    expect(refundedIdx, 'a recovery nem persistálta a refunded státuszt').toBeGreaterThanOrEqual(0)
    const later = orderUpdates.slice(refundedIdx + 1)
    expect(
      later.some((row) => row.status === 'payment_pending'),
      'a poll a refunded DB-státuszt payment_pendingre írta vissza',
    ).toBe(false)
    expect(pending[0]?.status).toBe('refunded')
  })

  it('late-success cancelled + duplicate reject + sikeres auto-refund → nincs cancelled visszaírás', async () => {
    const cancelled = createPendingOrder({
      id: 911,
      status: 'cancelled',
      createdAt: isoHoursAgo(2),
    })
    const ledger = refundFixture(cancelled)
    const { payload, onPaid, queueInvoice, orderUpdates, lateSuccess } = setup({
      pending: [],
      lateSuccess: [cancelled],
      stateOverrides: refundableState,
    })
    const originalUpdate = vi.mocked(ledger.payload.update).getMockImplementation()!
    vi.mocked(ledger.payload.update).mockImplementation(async (args) => {
      orderUpdates.push(args.data as Record<string, unknown>)
      return originalUpdate(args)
    })

    const summary = await pollPendingOrders({
      payload,
      fetchState: async () => getStateResponse('Succeeded', refundableState),
      onPaid,
      queueInvoice,
      applyTransition: (async () => ({
        action: 'rejected' as const,
        reason: 'duplicate-paid-order',
      })) as never,
      recoverRejectedPaid: (input) =>
        recoverRejectedSucceededPayment({
          ...input,
          payload: ledger.payload,
          refundPayment: refundedTransport,
        }),
      invoicingEnabled: () => false,
      now: NOW,
    })

    expect(summary.failed).toBe(1)
    const refundedIdx = orderUpdates.findIndex((row) => row.status === 'refunded')
    expect(refundedIdx, 'a recovery nem persistálta a refunded státuszt').toBeGreaterThanOrEqual(0)
    const later = orderUpdates.slice(refundedIdx + 1)
    expect(
      later.some((row) => row.status === 'cancelled'),
      'a late-success touch a refunded DB-státuszt cancelledre írta vissza',
    ).toBe(false)
    expect(lateSuccess[0]?.status).toBe('refunded')
  })

  it('párhuzamos refund a lap betöltése után (skipped/already-refunded) → a friss-olvasás véd', async () => {
    // A mutációs próba (a2) igazolta: ezen az ágon a recoveryRefunded zászló
    // HAMIS marad (a recovery already-refunded skippel tér vissza), tehát
    // KIZÁRÓLAG a touch előtti friss DB-olvasás akadályozza a visszaírást.
    // Ez a teszt szögezi le, hogy a guard nem „fölösleges extra findByID".
    const order = createPendingOrder({ id: 912, barionPaymentId: 'p0-parallel-payment' })
    const { payload, onPaid, queueInvoice, orderUpdates, pending } = setup({
      pending: [order],
      stateOverrides: refundableState,
    })

    await pollPendingOrders({
      payload,
      // A GetState alatt fut be a párhuzamos callback-recovery: a DB-ben a sor
      // már refunded, a poll kezében lévő példány payment_pending marad.
      fetchState: async () => {
        pending[0].status = 'refunded'
        return getStateResponse('Succeeded', refundableState)
      },
      onPaid,
      queueInvoice,
      applyTransition: (async () => ({
        action: 'rejected' as const,
        reason: 'total-mismatch',
      })) as never,
      recoverRejectedPaid: (input) =>
        recoverRejectedSucceededPayment({ ...input, refundPayment: refundedTransport }),
      invoicingEnabled: () => false,
      now: NOW,
    })

    expect(
      orderUpdates.some((row) => row.status === 'payment_pending'),
      'a poll a párhuzamosan refundolt sort payment_pendingre írta vissza',
    ).toBe(false)
    expect(pending[0].status).toBe('refunded')
  })
})

describe('RF-3 — a nem-paid late-success sor forgatása le van szögezve', () => {
  it('late-success Canceled (nem fordult paid-re) → touch forgatja a sort', async () => {
    // A mutációs próba (rf3) igazolta: a touch törlése zölden átment — ez a
    // teszt zárja a rést. A touch dolga az updatedAt-bump, hogy a 10+10-es
    // late-success ablak ne ugyanazokat a sorokat nézze minden futásban.
    const cancelled = createPendingOrder({
      id: 913,
      status: 'cancelled',
      barionPaymentId: 'rf3-rotate-payment',
      createdAt: isoHoursAgo(2),
      updatedAt: isoHoursAgo(2),
    })
    const { payload, fetchState, onPaid, queueInvoice, orderUpdates } = setup({
      pending: [],
      lateSuccess: [cancelled],
      stateStatus: 'Canceled',
    })

    await pollPendingOrders({ payload, fetchState, onPaid, queueInvoice, now: NOW })

    expect(
      orderUpdates.some((row) => row.status === 'cancelled'),
      'az RF-3 touch nem forgatta a nem-paid late-success sort (updatedAt-bump elmaradt)',
    ).toBe(true)
  })
})

describe('árva-ág — friss-státusz őr a cancelled írás előtt', () => {
  it('árva sor, amit a lap betöltése után paid-re állít a callback → nincs cancelled felülírás', async () => {
    // A checkout a Payment/Start után, a paymentId mentése előtt is elhalhat —
    // a kései callback a PaymentRequestId-fallbackkel ilyenkor is párosít és
    // paid-re állíthat. A poll árva-ága a lapbetöltéskori stale példányból
    // dolgozik: friss-olvasás nélkül a FIZETETT sorra írna cancelled-et.
    const paidLater = createPendingOrder({
      id: 914,
      barionPaymentId: null,
      createdAt: new Date(NOW - ORPHAN_ORDER_GRACE_MS - 60_000).toISOString(),
      updatedAt: isoHoursAgo(30),
    })
    const first = createPendingOrder({
      id: 915,
      barionPaymentId: 'orphan-race-payment',
      updatedAt: isoHoursAgo(40),
    })
    const { payload, onPaid, queueInvoice, orderUpdates, pending } = setup({
      pending: [first, paidLater],
    })

    await pollPendingOrders({
      payload,
      // Az első (paymentId-s) sor GetState-je alatt fut be a kései callback,
      // és paid-re állítja az árva sort a DB-ben.
      fetchState: async () => {
        const target = pending.find((row) => row.id === 914)
        if (target) {
          target.status = 'paid'
        }
        return getStateResponse('Prepared')
      },
      onPaid,
      queueInvoice,
      now: NOW,
    })

    expect(
      orderUpdates.some((row) => row.status === 'cancelled'),
      'az árva-ág a közben paid-re állt sort cancelled-re írta felül',
    ).toBe(false)
    expect(pending.find((row) => row.id === 914)?.status).toBe('paid')
  })
})

describe('order-poll — státuszellenőrzés a közös zár alatt (A1)', () => {
  function withConcurrentWrite(
    base: ReturnType<typeof setup>,
    orderId: number,
    status: Order['status'],
  ): Payload {
    return {
      ...(base.payload as unknown as Record<string, unknown>),
      // A callback a helper friss olvasása ELŐTT fejeződött be. A tényleges
      // zárvárási interleavinget a conditional-status teszt külön ellenőrzi.
      findByID: async (args: { collection: string; id: number }) => {
        if (args.collection === 'orders') {
          const row = [...base.pending, ...base.lateSuccess].find((entry) => entry.id === orderId)
          if (row) {
            row.status = status
          }
        }
        return (base.payload as unknown as { findByID: (a: unknown) => Promise<unknown> }).findByID(
          args,
        )
      },
    } as unknown as Payload
  }

  it('W1 touch: a sor a friss olvasás előtt refunded lett → nincs payment_pending visszaírás', async () => {
    const order = createPendingOrder({ id: 920, barionPaymentId: 'cas-pending-payment' })
    const base = setup({ pending: [order] })

    await pollPendingOrders({
      payload: withConcurrentWrite(base, 920, 'refunded'),
      fetchState: async () => getStateResponse('Succeeded'),
      onPaid: base.onPaid,
      queueInvoice: base.queueInvoice,
      applyTransition: (async () => ({
        action: 'rejected' as const,
        reason: 'total-mismatch',
      })) as never,
      recoverRejectedPaid: async () => ({
        action: 'skipped' as const,
        detail: 'no-refundable-transaction',
      }),
      invoicingEnabled: () => false,
      now: NOW,
    })

    expect(base.orderUpdateCalls).toEqual([])
    expect(base.orderUpdates.some((row) => row.status === 'payment_pending')).toBe(false)
    expect(base.pending[0]?.status).toBe('refunded')
  })

  it('árva-ág: a sor a friss olvasás előtt paid lett → nincs cancelled felülírás, skipped', async () => {
    const orphan = createPendingOrder({
      id: 921,
      barionPaymentId: null,
      createdAt: new Date(NOW - ORPHAN_ORDER_GRACE_MS - 60_000).toISOString(),
    })
    const base = setup({ pending: [orphan] })

    const summary = await pollPendingOrders({
      payload: withConcurrentWrite(base, 921, 'paid'),
      fetchState: base.fetchState,
      onPaid: base.onPaid,
      queueInvoice: base.queueInvoice,
      invoicingEnabled: () => false,
      now: NOW,
    })

    expect(base.orderUpdateCalls).toEqual([])
    expect(base.orderUpdates.some((row) => row.status === 'cancelled')).toBe(false)
    expect(summary.orphaned).toBe(0)
    expect(summary.skipped).toBe(1)
    expect(base.pending[0]?.status).toBe('paid')
  })

  // r-barion-6 óta lezárt sort CSAK a Barion végleges, negatív válasza forgat
  // (lateSuccessPollDue), ezért a touch-CAS itt egy Expired válaszon fut.
  it('RF-3 touch: a sor a friss olvasás előtt refunded lett → nincs cancelled visszaírás', async () => {
    const cancelled = createPendingOrder({
      id: 922,
      status: 'cancelled',
      barionPaymentId: 'cas-late-payment',
      createdAt: isoHoursAgo(2),
      updatedAt: isoHoursAgo(6),
    })
    const base = setup({ pending: [], lateSuccess: [cancelled] })

    await pollPendingOrders({
      payload: withConcurrentWrite(base, 922, 'refunded'),
      fetchState: async () => getStateResponse('Expired'),
      onPaid: base.onPaid,
      queueInvoice: base.queueInvoice,
      applyTransition: (async () => ({
        action: 'cancelled' as const,
        duplicate: true,
      })) as never,
      invoicingEnabled: () => false,
      now: NOW,
    })

    expect(base.orderUpdateCalls).toEqual([])
    expect(base.orderUpdates.some((row) => row.status === 'cancelled')).toBe(false)
    expect(base.lateSuccess[0]?.status).toBe('refunded')
  })
})

describe('order-poll — late-success hurok fékei (A2)', () => {
  function lateBatch(count: number): Order[] {
    return Array.from({ length: count }, (_, index) =>
      createPendingOrder({
        id: 940 + index,
        status: 'cancelled',
        orderNumber: `KH-LATE-${index}`,
        barionPaymentId: `late-brake-${index}`,
        createdAt: isoHoursAgo(3),
        updatedAt: isoHoursAgo(3 + index),
      }),
    )
  }

  const ismeretlenHiba = (): BarionApiError =>
    new BarionApiError({
      message: 'ismeretlen szolgáltatói hiba',
      kind: 'provider',
      endpoint: 'GET x',
      httpStatus: 200,
      providerErrors: [{ ErrorCode: 'SomeUnlistedAuthProblem', Title: 'x', Description: 'x' }],
    })

  it('csupa unknown-osztályú hiba → MAX_LEADING_FAILURES után megszakít, a maradék skipped', async () => {
    const late = lateBatch(LATE_SUCCESS_BATCH_SIZE)
    const { payload, onPaid, queueInvoice } = setup({ pending: [], lateSuccess: late })
    const fetchState = vi.fn(async (): Promise<BarionPaymentStateResponse> => {
      throw ismeretlenHiba()
    })

    const summary = await pollPendingOrders({
      payload,
      fetchState,
      onPaid,
      queueInvoice,
      invoicingEnabled: () => false,
      now: NOW,
    })

    expect(fetchState).toHaveBeenCalledTimes(MAX_LEADING_FAILURES)
    expect(summary.failed).toBe(MAX_LEADING_FAILURES)
    expect(summary.skipped).toBe(LATE_SUCCESS_BATCH_SIZE - MAX_LEADING_FAILURES)
  })

  it('hitelesítési hiba → a lapon maradó sorok skipped-be kerülnek', async () => {
    const late = lateBatch(3)
    const { payload, onPaid, queueInvoice } = setup({ pending: [], lateSuccess: late })
    const fetchState = vi.fn(async (): Promise<BarionPaymentStateResponse> => {
      throw new BarionApiError({
        message: 'Barion API hiba (HTTP 401)',
        kind: 'http',
        endpoint: 'GET /v4/Payment/{PaymentId}/PaymentState',
        httpStatus: 401,
      })
    })

    const summary = await pollPendingOrders({
      payload,
      fetchState,
      onPaid,
      queueInvoice,
      invoicingEnabled: () => false,
      now: NOW,
    })

    expect(fetchState).toHaveBeenCalledTimes(1)
    expect(summary.failed).toBe(1)
    expect(summary.skipped).toBe(2)
  })

  it('egymást követő szállítási hibák → a lapon maradó sorok skipped-be kerülnek', async () => {
    const late = lateBatch(5)
    const { payload, onPaid, queueInvoice } = setup({ pending: [], lateSuccess: late })
    const fetchState = vi.fn(async (): Promise<BarionPaymentStateResponse> => {
      throw new BarionApiError({ message: 'timeout', kind: 'timeout', endpoint: 'GET x' })
    })

    const summary = await pollPendingOrders({
      payload,
      fetchState,
      onPaid,
      queueInvoice,
      invoicingEnabled: () => false,
      now: NOW,
    })

    expect(fetchState).toHaveBeenCalledTimes(MAX_CONSECUTIVE_TRANSPORT_FAILURES)
    expect(summary.failed).toBe(MAX_CONSECUTIVE_TRANSPORT_FAILURES)
    expect(summary.skipped).toBe(5 - MAX_CONSECUTIVE_TRANSPORT_FAILURES)
  })
})

/**
 * A3 → r-barion-6: a függő Barion-státuszú lezárt sor korábban forgott (touch),
 * hogy ne ragadjon a lap elején. Azóta a late-success scan a legfiatalabb
 * sorokkal kezd, és a sort CSAK a Barion végleges, negatív válasza forgatja
 * (lateSuccessPollDue): a még folyamatban lévő fizetés sora esedékes marad, és a
 * következő futás újra rákérdez.
 */
describe('order-poll — late-success sor függő Barion-státusznál (A3, r-barion-6)', () => {
  it.each([
    ['cancelled', 'Prepared'],
    ['payment_failed', 'Started'],
  ] as const)(
    '%s sor + %s → nincs forgatás, a státusz marad, a következő futás újra rákérdez',
    async (status, barionStatus) => {
      const row = createPendingOrder({
        id: 930,
        status,
        barionPaymentId: 'late-prepared-payment',
        createdAt: isoHoursAgo(2),
        updatedAt: isoHoursAgo(6),
      })
      const { payload, onPaid, queueInvoice, orderUpdates } = setup({
        pending: [],
        lateSuccess: [row],
      })
      const fetchState = vi.fn(async () => getStateResponse(barionStatus))

      for (const now of [NOW, NOW + 5 * 60_000]) {
        await pollPendingOrders({
          payload,
          fetchState,
          onPaid,
          queueInvoice,
          invoicingEnabled: () => false,
          now,
        })
      }

      expect(orderUpdates).toEqual([])
      expect(row.status).toBe(status)
      expect(fetchState).toHaveBeenCalledTimes(2)
    },
  )
})

// ---------------------------------------------------------------------------
// fix-404 — a tartósan 404-es függő sorok és a futás eleji mennyezet
// ---------------------------------------------------------------------------

/** Kontextust is rögzítő napló: a RIASZTÁS-sorok audit-mezőinek ellenőrzéséhez. */
function contextLog() {
  const errors: Array<{ message: string; context: Record<string, unknown> }> = []
  const warns: string[] = []
  const infos: string[] = []
  const log = {
    child: () => log,
    debug: (): void => undefined,
    info: (message: string) => {
      infos.push(message)
    },
    warn: (message: string) => {
      warns.push(message)
    },
    error: (message: string, context?: Record<string, unknown>) => {
      errors.push({ message, context: context ?? {} })
    },
  }
  return { log, errors, warns, infos }
}

/** A Barion dokumentált „ismeretlen fizetés" válasza (Error_codes_notifications). */
function notExistingPaymentId(httpStatus = 404): BarionApiError {
  return new BarionApiError({
    message: `Barion API hiba (HTTP ${httpStatus}): NotExistingPaymentId`,
    kind: httpStatus === 200 ? 'provider' : 'http',
    endpoint: 'GET state',
    httpStatus,
    providerErrors: [
      {
        ErrorCode: 'NotExistingPaymentId',
        Title: 'DUMMY The given payment id is invalid',
        Description: 'DUMMY',
      },
    ],
  })
}

const STUCK_PAYMENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const LIVE_PAYMENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const PROBE_PAYMENT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

/** 24 óránál régebbi függő sor, amelyre a Barion tartósan 404-et ad. */
function stuckPendingOrder(overrides: Partial<Order> = {}): Order {
  return createPendingOrder({
    id: 3101,
    orderNumber: 'KH-2026-003101',
    barionPaymentId: STUCK_PAYMENT_ID,
    createdAt: isoHoursAgo(24 * 30),
    updatedAt: isoHoursAgo(24 * 30),
    ...overrides,
  })
}

/** Friss, élő függő sor: a GetState-je sikeres (Prepared), tehát az útvonal működik. */
function livePendingOrder(overrides: Partial<Order> = {}): Order {
  return createPendingOrder({
    id: 3102,
    orderNumber: 'KH-2026-003102',
    barionPaymentId: LIVE_PAYMENT_ID,
    createdAt: isoHoursAgo(0.2),
    updatedAt: isoHoursAgo(0.2),
    ...overrides,
  })
}

const OLDER_PAYMENT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'

/**
 * A régi függő sor ELŐTT indult, fizetett rendelés (PR #304 szomszéd-bizonyíték):
 * ha a mostani beállítással a GetState-je sikeres, a régi sor is ebben a
 * környezetben és boltban indult.
 */
function olderPaidOrder(overrides: Partial<Order> = {}): Order {
  return createPendingOrder({
    id: 3104,
    orderNumber: 'KH-2026-003104',
    status: 'paid',
    barionPaymentId: OLDER_PAYMENT_ID,
    // Másik vevő, másik termék: a szomszéd nem lehet a vizsgált vásárlás duplikátuma.
    customer: 8,
    items: [{ product: 99, quantity: 1, titleSnapshot: 'DEMO-MAS-TERMEK', priceHufSnapshot: 1000 }],
    createdAt: isoHoursAgo(24 * 40),
    updatedAt: isoHoursAgo(24 * 40),
    ...overrides,
  })
}

const olderSucceeds = {
  [OLDER_PAYMENT_ID]: () => getStateResponse('Succeeded', { PaymentId: OLDER_PAYMENT_ID }),
}

describe('fix-404 — NotExistingPaymentId: a Barion dokumentált not-found kódja definitív', () => {
  it.each([404, 400, 200])(
    'HTTP %i + NotExistingPaymentId → order (bármilyen státusszal)',
    (status) => {
      expect(classifyBarionFailure(notExistingPaymentId(status))).toBe('order')
    },
  )

  it('a kódegyezés kis-nagybetűt nem néz, de pontos (nincs részleges egyezés)', () => {
    const withCode = (ErrorCode: string) =>
      new BarionApiError({
        message: 'x',
        kind: 'http',
        endpoint: 'GET state',
        httpStatus: 404,
        providerErrors: [{ ErrorCode, Title: 'DUMMY', Description: 'DUMMY' }],
      })
    expect(classifyBarionFailure(withCode('notexistingpaymentid'))).toBe('order')
    expect(classifyBarionFailure(withCode('NotExistingPaymentIdX'))).toBe('unverified-404')
    expect(classifyBarionFailure(bareNotFound())).toBe('unverified-404')
  })

  /**
   * A HUNT-teszt fordítottja: a 30 napos, NotExistingPaymentId-vel
   * megválaszolt függő sor eddig 10 napi futás után is payment_pending maradt.
   */
  it('30 napos függő sor + 404 NotExistingPaymentId → az első futásban cancelled, útvonal-bizonyíték nélkül is', async () => {
    const stuck = stuckPendingOrder()
    const f = setup({ pending: [stuck] })
    const fetchState = vi.fn(async () => {
      throw notExistingPaymentId(404)
    })

    const summary = await pollPendingOrders({
      ...f,
      fetchState,
      now: NOW,
      logger: contextLog().log as never,
      invoicingEnabled: () => false,
    })

    expect(stuck.status).toBe('cancelled')
    expect(summary.cancelled).toBe(1)
    expect(fetchState).toHaveBeenCalledTimes(1)
    expect(f.paidCalls).toHaveLength(0)
  })
})

describe('fix-404 — 24 óránál régebbi, puszta 404-es függő sor: lezárás CSAK útvonal-bizonyítékkal', () => {
  const byPaymentId =
    (responses: Record<string, () => BarionPaymentStateResponse>) =>
    async (paymentId: string): Promise<BarionPaymentStateResponse> => {
      const respond = responses[paymentId]
      if (!respond) {
        throw bareNotFound()
      }
      return respond()
    }

  it('előtte és utána indult fizetés GetState-je is sikeres → a régi sor cancelled, RIASZTÁS rendelésszámmal, pénzmozgás nincs', async () => {
    const stuck = stuckPendingOrder()
    const live = livePendingOrder()
    const f = setup({ pending: [stuck, live], paidResweep: [olderPaidOrder()] })
    const { log, errors } = contextLog()
    const recoverRejectedPaid = vi.fn(async () => {
      throw new Error('TESZT: pénzmozgás nem indulhat')
    })

    const summary = await pollPendingOrders({
      ...f,
      fetchState: byPaymentId({
        [LIVE_PAYMENT_ID]: () => getStateResponse('Prepared', { PaymentId: LIVE_PAYMENT_ID }),
        ...olderSucceeds,
      }),
      recoverRejectedPaid,
      now: NOW,
      logger: log as never,
      invoicingEnabled: () => false,
    })

    expect(stuck.status).toBe('cancelled')
    expect(live.status).toBe('payment_pending')
    expect(summary.cancelled).toBe(1)
    expect(recoverRejectedPaid).not.toHaveBeenCalled()
    expect(f.paidCalls).toHaveLength(0)
    const closure = errors.find((entry) => entry.message.includes('lezárva (cancelled)'))
    expect(closure?.message).toMatch(/^RIASZTÁS/)
    expect(closure?.context).toMatchObject({
      orderNumber: 'KH-2026-003101',
      routeProof: 'bracket',
      httpStatus: 404,
    })
    // A lezárt sorra nem íródik mellé a „NEM zárjuk le" riasztás.
    expect(errors.some((entry) => entry.message.includes('most NEM zárjuk le'))).toBe(false)
  })

  it('a sorrend mindegy: a régi sor előbb kerül sorra, a bizonyító siker utána jön', async () => {
    const stuck = stuckPendingOrder({ updatedAt: isoHoursAgo(24 * 40) })
    const live = livePendingOrder({ updatedAt: isoHoursAgo(0.1) })
    const f = setup({ pending: [live, stuck], paidResweep: [olderPaidOrder()] })
    const calls: string[] = []
    const fetchState = async (paymentId: string): Promise<BarionPaymentStateResponse> => {
      calls.push(paymentId)
      if (paymentId === STUCK_PAYMENT_ID) {
        throw bareNotFound()
      }
      return getStateResponse('Prepared', { PaymentId: paymentId })
    }

    await pollPendingOrders({
      ...f,
      fetchState,
      now: NOW,
      logger: contextLog().log as never,
      invoicingEnabled: () => false,
    })

    expect(calls).toEqual([STUCK_PAYMENT_ID, LIVE_PAYMENT_ID, OLDER_PAYMENT_ID])
    expect(stuck.status).toBe('cancelled')
  })

  it('bizonyíték nélkül (egyetlen sikeres GetState sincs, nincs paid rendelés) → marad, fojtott riasztás', async () => {
    const stuck = stuckPendingOrder()
    const f = setup({ pending: [stuck] })
    const { log, errors } = contextLog()
    const fetchState = vi.fn(async () => {
      throw bareNotFound()
    })

    for (const offset of [0, 300_000]) {
      const summary = await pollPendingOrders({
        ...f,
        fetchState,
        now: NOW + offset,
        logger: log as never,
        invoicingEnabled: () => false,
      })
      expect(summary.cancelled).toBe(0)
    }

    expect(stuck.status).toBe('payment_pending')
    // Útvonal-próba nem futott (nincs paid jelölt): futásonként egyetlen hívás.
    expect(fetchState).toHaveBeenCalledTimes(2)
    const alerts = errors.filter((entry) => entry.message.includes('NEM zárjuk le'))
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.message).toMatch(/^RIASZTÁS/)
  })

  it('csendes bolt: a sikeres útvonal-próba (utána) és az előtte indult fizetett rendelés GetState-je bizonyít → cancelled', async () => {
    const stuck = stuckPendingOrder()
    const paid = createPendingOrder({
      id: 3103,
      status: 'paid',
      barionPaymentId: PROBE_PAYMENT_ID,
      invoiceStatus: 'issued',
    } as Partial<Order>)
    const older = olderPaidOrder()
    const f = setup({ pending: [stuck], paidResweep: [paid, older] })
    const { log, errors } = contextLog()
    const fetchState = vi.fn(
      byPaymentId({
        [PROBE_PAYMENT_ID]: () => getStateResponse('Succeeded', { PaymentId: PROBE_PAYMENT_ID }),
        ...olderSucceeds,
      }),
    )

    const summary = await pollPendingOrders({
      ...f,
      fetchState,
      now: NOW,
      logger: log as never,
      invoicingEnabled: () => false,
    })

    expect(fetchState.mock.calls.map(([id]) => id)).toEqual([
      STUCK_PAYMENT_ID,
      PROBE_PAYMENT_ID,
      OLDER_PAYMENT_ID,
    ])
    expect(stuck.status).toBe('cancelled')
    expect(summary.cancelled).toBe(1)
    // A próba csak olvas: a paid rendelésre nem ír, és mellékhatást sem indít.
    expect(paid.status).toBe('paid')
    expect(f.paidCalls).toHaveLength(0)
    expect(f.orderUpdateCalls.some((call) => String(call.id ?? call.where?.id) === '3103')).toBe(
      false,
    )
    const closure = errors.find((entry) => entry.message.includes('lezárva (cancelled)'))
    expect(closure?.context).toMatchObject({ routeProof: 'bracket' })
  })

  it('az útvonal-próba is 404 (globális útvonalhiba) → semmi nem zárul le', async () => {
    const stuck = stuckPendingOrder()
    const paid = createPendingOrder({
      id: 3103,
      status: 'paid',
      barionPaymentId: PROBE_PAYMENT_ID,
    })
    const f = setup({ pending: [stuck], paidResweep: [paid] })
    const fetchState = vi.fn(async () => {
      throw bareNotFound()
    })

    const summary = await pollPendingOrders({
      ...f,
      fetchState,
      now: NOW,
      logger: contextLog().log as never,
      invoicingEnabled: () => false,
    })

    expect(fetchState).toHaveBeenCalledTimes(2)
    expect(stuck.status).toBe('payment_pending')
    expect(summary.cancelled).toBe(0)
  })

  it.each([
    ['24 óra mínusz 1 perc', UNVERIFIED_NOT_FOUND_CANCEL_AFTER_MS - 60_000, 'payment_pending'],
    ['pontosan 24 óra', UNVERIFIED_NOT_FOUND_CANCEL_AFTER_MS, 'cancelled'],
  ] as const)('életkor: %s → %s', async (_label, ageMs, expected) => {
    const stuck = stuckPendingOrder({ createdAt: new Date(NOW - ageMs).toISOString() })
    const f = setup({ pending: [stuck, livePendingOrder()], paidResweep: [olderPaidOrder()] })

    await pollPendingOrders({
      ...f,
      fetchState: byPaymentId({
        [LIVE_PAYMENT_ID]: () => getStateResponse('Prepared', { PaymentId: LIVE_PAYMENT_ID }),
        ...olderSucceeds,
      }),
      now: NOW,
      logger: contextLog().log as never,
      invoicingEnabled: () => false,
    })

    expect(stuck.status).toBe(expected)
  })

  it('hiányzó vagy értelmezhetetlen createdAt → sosem zárul le (az életkor nem bizonyított)', async () => {
    const noDate = stuckPendingOrder({ createdAt: 'nem dátum' })
    const f = setup({ pending: [noDate, livePendingOrder()] })

    await pollPendingOrders({
      ...f,
      fetchState: byPaymentId({
        [LIVE_PAYMENT_ID]: () => getStateResponse('Prepared', { PaymentId: LIVE_PAYMENT_ID }),
      }),
      now: NOW,
      logger: contextLog().log as never,
      invoicingEnabled: () => false,
    })

    expect(noDate.status).toBe('payment_pending')
  })

  it('verseny: a sor a futás közben paid lett (párhuzamos callback) → a lezárás NEM írja felül', async () => {
    const stuck = stuckPendingOrder()
    const live = livePendingOrder()
    const f = setup({ pending: [stuck, live], paidResweep: [olderPaidOrder()] })
    const { log, warns } = contextLog()
    const fetchState = async (paymentId: string): Promise<BarionPaymentStateResponse> => {
      if (paymentId === STUCK_PAYMENT_ID) {
        throw bareNotFound()
      }
      // A forgatás UTÁN, a lezárás ELŐTT egy callback paid-re állítja a sort.
      stuck.status = 'paid'
      return getStateResponse('Prepared', { PaymentId: paymentId })
    }

    const summary = await pollPendingOrders({
      ...f,
      fetchState,
      now: NOW,
      logger: log as never,
      invoicingEnabled: () => false,
    })

    expect(stuck.status).toBe('paid')
    expect(summary.cancelled).toBe(0)
    expect(warns.some((message) => message.includes('már nem payment_pending'))).toBe(true)
  })

  it('hitelesítési megszakítás a futásban → nincs útvonal-próba és nincs lezárás', async () => {
    const stuck = stuckPendingOrder({ updatedAt: isoHoursAgo(24 * 40) })
    const other = livePendingOrder()
    const paid = createPendingOrder({ id: 3103, status: 'paid', barionPaymentId: PROBE_PAYMENT_ID })
    const f = setup({ pending: [stuck, other], paidResweep: [paid] })
    const fetchState = vi.fn(async (paymentId: string) => {
      if (paymentId === STUCK_PAYMENT_ID) {
        throw bareNotFound()
      }
      if (paymentId === PROBE_PAYMENT_ID) {
        return getStateResponse('Succeeded', { PaymentId: PROBE_PAYMENT_ID })
      }
      throw new BarionApiError({
        message: 'Barion API hiba (HTTP 401).',
        kind: 'http',
        endpoint: 'GET state',
        httpStatus: 401,
      })
    })

    await pollPendingOrders({
      ...f,
      fetchState,
      now: NOW,
      logger: contextLog().log as never,
      invoicingEnabled: () => false,
    })

    expect(fetchState.mock.calls.map(([id]) => id)).toEqual([STUCK_PAYMENT_ID, LIVE_PAYMENT_ID])
    expect(stuck.status).toBe('payment_pending')
  })

  // r-barion-6 + PR #304: a bizonyítottan azonos környezetben lezárt sor
  // fizetési ablaka rég lejárt, a Barion ott nem ismeri a fizetést: a
  // late-success scan többé nem kérdez rá (korábban 7 napig 5 percenként).
  it('a bizonyítottan lezárt régi sorra a late-success scan többé nem hív GetState-et', async () => {
    const stuck = stuckPendingOrder({ createdAt: isoHoursAgo(25), updatedAt: isoHoursAgo(25) })
    const first = setup({ pending: [stuck, livePendingOrder()], paidResweep: [olderPaidOrder()] })

    await pollPendingOrders({
      ...first,
      fetchState: byPaymentId({
        [LIVE_PAYMENT_ID]: () => getStateResponse('Prepared', { PaymentId: LIVE_PAYMENT_ID }),
        ...olderSucceeds,
      }),
      now: NOW,
      logger: contextLog().log as never,
      invoicingEnabled: () => false,
    })
    expect(stuck.status).toBe('cancelled')

    const second = setup({ pending: [], lateSuccess: [stuck] })
    const fetchState = vi.fn(async () =>
      getStateResponse('Succeeded', { PaymentId: STUCK_PAYMENT_ID }),
    )
    const summary = await pollPendingOrders({
      ...second,
      fetchState,
      now: NOW + 300_000,
      logger: contextLog().log as never,
      invoicingEnabled: () => false,
    })

    expect(fetchState).not.toHaveBeenCalled()
    expect(summary.lateSuccessScanned).toBe(0)
    expect(stuck.status).toBe('cancelled')
  })

  it('öt régi, 404-es sor a sor elején: az 1. futás mennyezetet ér, a 2. futás (élő sor elöl) mind az ötöt lezárja', async () => {
    const stuck = Array.from({ length: MAX_LEADING_FAILURES }, (_, index) =>
      stuckPendingOrder({
        id: 3200 + index,
        orderNumber: `KH-2026-00${3200 + index}`,
        barionPaymentId: `dddddddd-dddd-dddd-dddd-00000000000${index}`,
        updatedAt: new Date(NOW - (40 - index) * 3600_000).toISOString(),
      }),
    )
    const live = livePendingOrder({ updatedAt: isoHoursAgo(0.1) })
    const f = setup({ pending: [...stuck, live], paidResweep: [olderPaidOrder()] })
    const fetchState = byPaymentId({
      [LIVE_PAYMENT_ID]: () => getStateResponse('Prepared', { PaymentId: LIVE_PAYMENT_ID }),
      ...olderSucceeds,
    })

    const firstRun = await pollPendingOrders({
      ...f,
      fetchState,
      now: NOW,
      logger: contextLog().log as never,
      invoicingEnabled: () => false,
    })
    expect(firstRun.cancelled).toBe(0)
    expect(stuck.every((order) => order.status === 'payment_pending')).toBe(true)

    const secondRun = await pollPendingOrders({
      ...f,
      fetchState,
      now: NOW + 300_000,
      logger: contextLog().log as never,
      invoicingEnabled: () => false,
    })
    expect(secondRun.cancelled).toBe(MAX_LEADING_FAILURES)
    expect(stuck.every((order) => order.status === 'cancelled')).toBe(true)
    expect(live.status).toBe('payment_pending')
  })
})

/**
 * PR #304 (Codex P1, discussion_r4097432522): egy puszta 404 csak akkor zárhat
 * le egy régi függő rendelést, ha bizonyítható, hogy a rendelés a mostani
 * Barion-környezetben és boltban indult. Környezet- vagy boltváltás után a
 * fizetés a mostani beállítással 404-et ad, holott a régiben sikeres lehetett:
 * a lezárás második terhelést okozhatna.
 */
describe('PR #304 — puszta 404: lezárás csak azonos Barion-környezet bizonyítéka mellett', () => {
  it('környezetváltás: csak a váltás UTÁN indult fizetés sikeres, a régi szomszédé 404 → NEM zárul le, RIASZTÁS', async () => {
    const stuck = stuckPendingOrder()
    const live = livePendingOrder()
    // A régi, a váltás előtt indult fizetett rendelés a mostani beállítással nem kérdezhető le.
    const f = setup({ pending: [stuck, live], paidResweep: [olderPaidOrder()] })
    const { log, errors } = contextLog()
    const fetchState = vi.fn(async (paymentId: string) => {
      if (paymentId === LIVE_PAYMENT_ID) {
        return getStateResponse('Prepared', { PaymentId: LIVE_PAYMENT_ID })
      }
      throw bareNotFound()
    })

    for (const offset of [0, 300_000]) {
      const summary = await pollPendingOrders({
        ...f,
        fetchState,
        now: NOW + offset,
        logger: log as never,
        invoicingEnabled: () => false,
      })
      expect(summary.cancelled).toBe(0)
    }

    expect(stuck.status).toBe('payment_pending')
    expect(fetchState.mock.calls.map(([id]) => id)).toContain(OLDER_PAYMENT_ID)
    const unproven = errors.filter((entry) =>
      entry.message.includes('nem bizonyítható, hogy a rendelés a mostani Barion-környezetben'),
    )
    expect(unproven).toHaveLength(1)
    expect(unproven[0]?.message).toMatch(/^RIASZTÁS/)
  })

  it('nincs a rendelés előtt indult fizetett rendelés (csak utána indultak) → NEM zárul le', async () => {
    const stuck = stuckPendingOrder()
    const f = setup({ pending: [stuck, livePendingOrder()] })
    const summary = await pollPendingOrders({
      ...f,
      fetchState: async (paymentId: string) => {
        if (paymentId === LIVE_PAYMENT_ID) {
          return getStateResponse('Prepared', { PaymentId: LIVE_PAYMENT_ID })
        }
        throw bareNotFound()
      },
      now: NOW,
      logger: contextLog().log as never,
      invoicingEnabled: () => false,
    })
    expect(summary.cancelled).toBe(0)
    expect(stuck.status).toBe('payment_pending')
  })

  it('a bizonyíték a rendelés UTÁN indult szomszédot is megköveteli: csak régebbi siker → NEM zárul le', async () => {
    const stuck = stuckPendingOrder()
    const f = setup({ pending: [stuck], paidResweep: [olderPaidOrder()] })
    const summary = await pollPendingOrders({
      ...f,
      fetchState: async (paymentId: string) => {
        if (paymentId === OLDER_PAYMENT_ID) {
          return getStateResponse('Succeeded', { PaymentId: OLDER_PAYMENT_ID })
        }
        throw bareNotFound()
      },
      now: NOW,
      logger: contextLog().log as never,
      invoicingEnabled: () => false,
    })
    expect(summary.cancelled).toBe(0)
    expect(stuck.status).toBe('payment_pending')
  })
})

describe('fix-404 — a futás eleji mennyezet csak a függő lapokat állítja meg (H1)', () => {
  /**
   * A HUNT-teszt fordítottja: öt tartósan 404-es függő sor minden futásban
   * kiütötte a mennyezetet, a late-success scan kimaradt, és a cancelled, a
   * Barionnál Succeeded rendelés 20 futás után sem lett paid.
   */
  it.each([
    ['puszta 404, régi sorok', () => bareNotFound(), 24 * 10],
    ['puszta 404, friss sorok', () => bareNotFound(), 1],
    ['404 + ismeretlen kód', () => notFoundWithUnknownCode('SomethingElse'), 24 * 10],
  ] as const)(
    '%s: a cancelled, Succeeded rendelés már az első futásban paid',
    async (_label, failure, ageHours) => {
      const stuck = Array.from({ length: MAX_LEADING_FAILURES }, (_, index) =>
        createPendingOrder({
          id: 3300 + index,
          barionPaymentId: `eeeeeeee-eeee-eeee-eeee-00000000000${index}`,
          createdAt: isoHoursAgo(ageHours),
          updatedAt: isoHoursAgo(ageHours - index * 0.01),
        }),
      )
      const lateOrder = createPendingOrder({
        id: 3390,
        status: 'cancelled',
        barionPaymentId: PAYMENT_ID,
        createdAt: isoHoursAgo(2),
        updatedAt: isoHoursAgo(2),
      })
      // PR #304: a régi sorok lezárásához egy ELŐTTÜK indult fizetett rendelés
      // sikeres GetState-je is kell (a késői siker az UTÁNUK indult szomszéd).
      const aged = ageHours >= 24
      const f = setup({
        pending: stuck,
        lateSuccess: [lateOrder],
        paidResweep: aged ? [olderPaidOrder()] : [],
      })
      const fetchState = vi.fn(async (paymentId: string) => {
        if (paymentId === OLDER_PAYMENT_ID) {
          return getStateResponse('Succeeded', { PaymentId: OLDER_PAYMENT_ID })
        }
        if (paymentId !== PAYMENT_ID) {
          throw failure()
        }
        return getStateResponse('Succeeded')
      })
      const { log, errors } = contextLog()

      await pollPendingOrders({
        ...f,
        fetchState,
        now: NOW,
        logger: log as never,
        invoicingEnabled: () => false,
      })

      // A régi soroknál a függő mennyezet megkérdezi az útvonal-próbát (a
      // fizetett, előttük indult rendelés): sikeres, tehát warn, nem RIASZTÁS
      // (fix-404 P-D); a próba sikere egyben a lezárás „előtte” szomszédja.
      expect(fetchState).toHaveBeenCalledTimes(MAX_LEADING_FAILURES + (aged ? 2 : 1))
      expect(lateOrder.status).toBe('paid')
      expect(f.paidCalls).toEqual([3390])
      expect(errors.some((entry) => entry.message.includes('tisztázatlan Barion-hiba'))).toBe(!aged)
      // A régi sorokat a két szomszéd sikere (előtte és utána indult fizetés)
      // le is zárja; a 24 óránál fiatalabbak maradnak.
      const expected = ageHours >= 24 ? 'cancelled' : 'payment_pending'
      expect(stuck.every((order) => order.status === expected)).toBe(true)
    },
  )

  /**
   * A late-success scan SAJÁT keretet kap: ha a mennyezet után a késői sorok
   * között is áll néhány tartósan 404-es cancelled sor a Succeeded előtt, az
   * első újabb hiba nem állíthatja meg (különben csendes boltban futásonként
   * csak egy késői sor kerülne sorra).
   */
  it('mennyezet után a late-success scan saját kerettel a 404-es késői sorokon át is eléri a Succeeded-et', async () => {
    const stuck = Array.from({ length: MAX_LEADING_FAILURES }, (_, index) =>
      createPendingOrder({
        id: 3350 + index,
        barionPaymentId: `edededed-eded-eded-eded-00000000000${index}`,
        createdAt: isoHoursAgo(1),
        updatedAt: isoHoursAgo(1 - index * 0.01),
      }),
    )
    const lateBare = Array.from({ length: 2 }, (_, index) =>
      createPendingOrder({
        id: 3380 + index,
        status: 'cancelled',
        barionPaymentId: `edededed-eded-eded-eded-00000000010${index}`,
        createdAt: isoHoursAgo(5),
        updatedAt: isoHoursAgo(5 - index * 0.01),
      }),
    )
    const lateOrder = createPendingOrder({
      id: 3389,
      status: 'cancelled',
      barionPaymentId: PAYMENT_ID,
      createdAt: isoHoursAgo(2),
      updatedAt: isoHoursAgo(2),
    })
    const f = setup({ pending: stuck, lateSuccess: [...lateBare, lateOrder] })
    const fetchState = vi.fn(async (paymentId: string) => {
      if (paymentId !== PAYMENT_ID) {
        throw bareNotFound()
      }
      return getStateResponse('Succeeded')
    })

    await pollPendingOrders({
      ...f,
      fetchState,
      now: NOW,
      logger: contextLog().log as never,
      invoicingEnabled: () => false,
    })

    expect(fetchState).toHaveBeenCalledTimes(MAX_LEADING_FAILURES + 3)
    expect(lateOrder.status).toBe('paid')
    expect(f.paidCalls).toEqual([3389])
  })

  it('globális 404: a futás legfeljebb 2 × MAX_LEADING_FAILURES GetState-et tesz', async () => {
    const pending = Array.from({ length: MAX_LEADING_FAILURES + 2 }, (_, index) =>
      createPendingOrder({
        id: 3400 + index,
        barionPaymentId: `ffffffff-ffff-ffff-ffff-00000000000${index}`,
      }),
    )
    const late = Array.from({ length: LATE_SUCCESS_BATCH_SIZE }, (_, index) =>
      createPendingOrder({
        id: 3450 + index,
        status: 'cancelled',
        barionPaymentId: `ffffffff-ffff-ffff-ffff-00000000010${index}`,
        createdAt: isoHoursAgo(2),
      }),
    )
    const f = setup({ pending, lateSuccess: late })
    const fetchState = vi.fn(async () => {
      throw bareNotFound()
    })

    const summary = await pollPendingOrders({
      ...f,
      fetchState,
      now: NOW,
      logger: contextLog().log as never,
      invoicingEnabled: () => false,
    })

    expect(fetchState).toHaveBeenCalledTimes(2 * MAX_LEADING_FAILURES)
    expect(summary.cancelled).toBe(0)
    expect(pending.every((order) => order.status === 'payment_pending')).toBe(true)
    expect(late.every((order) => order.status === 'cancelled')).toBe(true)
  })

  it('globális 404 régi sorokkal: + egyetlen (sikertelen) útvonal-próba, lezárás nincs', async () => {
    const pending = Array.from({ length: MAX_LEADING_FAILURES + 2 }, (_, index) =>
      createPendingOrder({
        id: 3500 + index,
        barionPaymentId: `abababab-abab-abab-abab-00000000000${index}`,
        createdAt: isoHoursAgo(24 * 3),
      }),
    )
    const paid = createPendingOrder({ id: 3599, status: 'paid', barionPaymentId: PROBE_PAYMENT_ID })
    const f = setup({ pending, paidResweep: [paid] })
    const fetchState = vi.fn<(paymentId: string) => Promise<BarionPaymentStateResponse>>(
      async () => {
        throw bareNotFound()
      },
    )

    const summary = await pollPendingOrders({
      ...f,
      fetchState,
      now: NOW,
      logger: contextLog().log as never,
      invoicingEnabled: () => false,
    })

    expect(fetchState).toHaveBeenCalledTimes(MAX_LEADING_FAILURES + 1)
    expect(fetchState.mock.calls.at(-1)?.[0]).toBe(PROBE_PAYMENT_ID)
    expect(summary.cancelled).toBe(0)
    expect(pending.every((order) => order.status === 'payment_pending')).toBe(true)
  })

  it('hitelesítési hiba továbbra is kihagyja a late-success scant', async () => {
    const lateOrder = createPendingOrder({
      id: 3690,
      status: 'cancelled',
      barionPaymentId: PAYMENT_ID,
      createdAt: isoHoursAgo(2),
    })
    const f = setup({
      pending: [createPendingOrder({ id: 3601, barionPaymentId: LIVE_PAYMENT_ID })],
      lateSuccess: [lateOrder],
    })
    const fetchState = vi.fn(async (paymentId: string) => {
      if (paymentId === PAYMENT_ID) {
        return getStateResponse('Succeeded')
      }
      throw new BarionApiError({
        message: 'Barion API hiba (HTTP 401).',
        kind: 'http',
        endpoint: 'GET state',
        httpStatus: 401,
      })
    })

    await pollPendingOrders({
      ...f,
      fetchState,
      now: NOW,
      logger: contextLog().log as never,
      invoicingEnabled: () => false,
    })

    expect(fetchState).toHaveBeenCalledTimes(1)
    expect(lateOrder.status).toBe('cancelled')
  })
})

/** 404 + nem ismert provider-kód: ugyanúgy unverified-404, mint a puszta 404. */
function notFoundWithUnknownCode(ErrorCode: string): BarionApiError {
  return new BarionApiError({
    message: `Barion API hiba (HTTP 404): ${ErrorCode}`,
    kind: 'http',
    endpoint: 'GET state',
    httpStatus: 404,
    providerErrors: [{ ErrorCode, Title: 'DUMMY', Description: 'DUMMY' }],
  })
}

describe('ti-proposed: late-success scan — puszta 404: forgatás és futás eleji mennyezet (H13)', () => {
  it('a cancelled sort a puszta 404 után a sor végére forgatja (updatedAt-touch, státusz változatlan)', async () => {
    const cancelled = createPendingOrder({
      id: 611,
      status: 'cancelled',
      updatedAt: isoHoursAgo(2),
    })
    const { payload, fetchState, onPaid, queueInvoice, orderUpdates } = setup({
      pending: [],
      lateSuccess: [cancelled],
      stateError: bareNotFound(),
    })
    await pollPendingOrders({
      payload,
      fetchState,
      onPaid,
      queueInvoice,
      now: NOW,
      logger: errorLog().log as never,
      invoicingEnabled: () => false,
    })
    expect(cancelled.status).toBe('cancelled')
    expect(orderUpdates).toEqual([{ status: 'cancelled' }])
    expect(cancelled.updatedAt).toBe(new Date(NOW).toISOString())
  })

  it('csupa puszta 404 a late-success scanben → a futás eleji mennyezet után megszakít', async () => {
    // A +60 perces ellenőrzési pontra esedékes lezárt sorok (lateSuccessPollDue).
    const cancelledOrders = Array.from({ length: MAX_LEADING_FAILURES + 2 }, (_, index) =>
      createPendingOrder({
        id: 800 + index,
        status: 'cancelled',
        barionPaymentId: `DUMMY-late-bare-${index}`,
        createdAt: isoHoursAgo(2),
        updatedAt: new Date(NOW - (70 - index) * 60_000).toISOString(),
      }),
    )
    const f = setup({ pending: [], lateSuccess: cancelledOrders })
    const fetchState = vi.fn(async () => {
      throw bareNotFound()
    })
    const summary = await pollPendingOrders({
      ...f,
      fetchState,
      now: NOW,
      logger: errorLog().log as never,
      invoicingEnabled: () => false,
    })
    expect(fetchState).toHaveBeenCalledTimes(MAX_LEADING_FAILURES)
    expect(summary.skipped).toBe(2)
  })
})

describe('fix-404 — a tartós refund-egyeztetés riasztása fojtott', () => {
  it('„tartós refund ellenőrzésre vár": egy RIASZTÁS a cooldown alatt, a lejárta után újra', async () => {
    const order = createPendingOrder({ id: 3701, barionPaymentId: LIVE_PAYMENT_ID })
    const f = setup({ pending: [order] })
    const { log, errors } = contextLog()
    const applyTransition: typeof applyBarionStateTransition = async () => ({
      action: 'rejected' as const,
      reason: 'refund-pending-reconciliation',
    })
    const recoverRejectedPaid = vi.fn(async () => ({
      action: 'failed' as const,
      detail: 'refund-pending-reconciliation',
    }))
    const run = (offset: number) =>
      pollPendingOrders({
        ...f,
        fetchState: async () => getStateResponse('Succeeded', { PaymentId: LIVE_PAYMENT_ID }),
        applyTransition,
        recoverRejectedPaid,
        now: NOW + offset,
        logger: log as never,
        invoicingEnabled: () => false,
      })
    const reconcileAlerts = () =>
      errors.filter((entry) => entry.message.includes('tartós refund ellenőrzésre vár'))

    await run(0)
    await run(300_000)
    await run(600_000)
    expect(recoverRejectedPaid).toHaveBeenCalledTimes(3)
    expect(reconcileAlerts()).toHaveLength(1)
    expect(reconcileAlerts()[0]?.message).toMatch(/^RIASZTÁS/)

    await run(DEFAULT_ALERT_COOLDOWN_MS + 1)
    expect(reconcileAlerts()).toHaveLength(2)
  })
})

describe('fix-404 rev1 — mennyezet-riasztás, útvonal-próba jelöltje, lezárási írás hibája', () => {
  const respondFor =
    (responses: Record<string, () => BarionPaymentStateResponse>) =>
    async (paymentId: string): Promise<BarionPaymentStateResponse> => {
      const respond = responses[paymentId]
      if (!respond) {
        throw bareNotFound()
      }
      return respond()
    }

  /**
   * B2: globális útvonalhibánál (minden GetState puszta 404) a függő lapok és
   * a late-success scan is eléri a mennyezetet. Eddig futásonként két
   * mennyezet-RIASZTÁS ment ki, és a late-success scan minden lezárt sorra
   * külön rendelésenkénti riasztást írt. Futásonként egy mennyezet-RIASZTÁS
   * elég; a late-success scan mennyezete csak akkor RIASZTÁS, ha a függő
   * lapoknál nem ment ki.
   */
  it.each([
    ['a függő lapok is elérik a mennyezetet', MAX_LEADING_FAILURES],
    ['nincs függő sor', 0],
  ] as const)(
    'globális puszta 404 (%s): egy mennyezet-RIASZTÁS, lezárt sorra nincs rendelésenkénti riasztás',
    async (_label, pendingCount) => {
      const pending = Array.from({ length: pendingCount }, (_, index) =>
        createPendingOrder({
          id: 3800 + index,
          barionPaymentId: `acacacac-acac-acac-acac-00000000000${index}`,
          updatedAt: new Date(NOW - (20 - index) * 60_000).toISOString(),
        }),
      )
      const late = Array.from({ length: MAX_LEADING_FAILURES + 2 }, (_, index) =>
        createPendingOrder({
          id: 3850 + index,
          status: 'cancelled',
          barionPaymentId: `bcbcbcbc-bcbc-bcbc-bcbc-00000000000${index}`,
          // A +60 perces ellenőrzési pontra esedékes lezárt sorok (lateSuccessPollDue).
          createdAt: isoHoursAgo(2),
          updatedAt: new Date(NOW - (70 - index) * 60_000).toISOString(),
        }),
      )
      const f = setup({ pending, lateSuccess: late })
      const { log, errors } = contextLog()
      const fetchState = vi.fn(async (): Promise<BarionPaymentStateResponse> => {
        throw bareNotFound()
      })

      await pollPendingOrders({
        ...f,
        fetchState,
        now: NOW,
        logger: log as never,
        invoicingEnabled: () => false,
      })

      // A late-success scan mennyezete továbbra is megállít (a warn-ág is kilép).
      expect(fetchState).toHaveBeenCalledTimes(pendingCount + MAX_LEADING_FAILURES)
      const ceilingAlerts = errors.filter((entry) =>
        entry.message.includes('tisztázatlan Barion-hiba'),
      )
      expect(ceilingAlerts).toHaveLength(1)
      // Rendelésenkénti riasztás csak a FÜGGŐ sorokra megy.
      const perOrderAlerts = errors.filter((entry) => entry.message.includes('most NEM zárjuk le'))
      expect(perOrderAlerts).toHaveLength(pendingCount)
    },
  )

  /**
   * B3: az útvonal-próba a LEGUTÓBB frissült, Barion-azonosítós paid rendelést
   * kérdezi. A legrégebbi paid rendelés a legvalószínűbb, hogy a másik
   * Barion-környezetből való (a próba elbukna, a beígért lezárás elmaradna), az
   * azonosító nélküli pedig nem is kérdezhető.
   */
  it('az útvonal-próba jelöltje a legutóbb frissült, Barion-azonosítós paid rendelés', async () => {
    const stuck = stuckPendingOrder()
    const oldPaid = createPendingOrder({
      id: 3811,
      status: 'paid',
      barionPaymentId: 'dededede-dede-dede-dede-dededededede',
      updatedAt: isoHoursAgo(24 * 60),
    })
    const newPaid = createPendingOrder({
      id: 3812,
      status: 'paid',
      barionPaymentId: PROBE_PAYMENT_ID,
      updatedAt: isoHoursAgo(2),
    })
    const noPaymentId = createPendingOrder({
      id: 3813,
      status: 'paid',
      barionPaymentId: null,
      updatedAt: isoHoursAgo(1),
    })
    const f = setup({ pending: [stuck], paidResweep: [oldPaid, newPaid, noPaymentId] })
    const fetchState = vi.fn(
      respondFor({
        [PROBE_PAYMENT_ID]: () => getStateResponse('Succeeded', { PaymentId: PROBE_PAYMENT_ID }),
      }),
    )

    await pollPendingOrders({
      ...f,
      fetchState,
      now: NOW,
      logger: contextLog().log as never,
      invoicingEnabled: () => false,
    })

    expect(fetchState.mock.calls.map(([id]) => id)).toEqual([STUCK_PAYMENT_ID, PROBE_PAYMENT_ID])
    // PR #304: a sor ELŐTT indult, lekérdezhető fizetett rendelés nélkül nincs lezárás.
    expect(stuck.status).toBe('payment_pending')
  })

  it('a lezárási írás DB-hibája nem állítja meg a futást: a sor marad, a számla-resweep lefut', async () => {
    const stuck = stuckPendingOrder()
    const unbilled = createPendingOrder({
      id: 3821,
      status: 'paid',
      invoiceStatus: 'none',
    } as Partial<Order>)
    const f = setup({
      pending: [stuck, livePendingOrder()],
      paidResweep: [unbilled, olderPaidOrder()],
    })
    const original = f.payload as unknown as {
      update(args: { data: Record<string, unknown> }): Promise<unknown>
    }
    const payload = {
      ...(f.payload as unknown as Record<string, unknown>),
      update: async (args: { data: Record<string, unknown> }) => {
        if (args.data.status === 'cancelled') throw new Error('DUMMY DB write failure')
        return original.update(args)
      },
    } as unknown as Payload
    const { log, warns } = contextLog()

    const summary = await pollPendingOrders({
      ...f,
      payload,
      fetchState: respondFor({
        [LIVE_PAYMENT_ID]: () => getStateResponse('Prepared', { PaymentId: LIVE_PAYMENT_ID }),
        ...olderSucceeds,
      }),
      now: NOW,
      logger: log as never,
    })

    expect(stuck.status).toBe('payment_pending')
    expect(summary.cancelled).toBe(0)
    expect(f.queuedInvoices).toContain(3821)
    expect(summary.invoiceResweep).toBe('done')
    expect(warns.some((message) => message.includes('cancelled írás sikertelen'))).toBe(true)
  })
})

describe('fix-404 rev1 — tömeges „nincs ilyen fizetés" útvonal-bizonyíték nélkül (B4)', () => {
  const notExistingPaymentId400 = (): BarionApiError =>
    new BarionApiError({
      message: 'Barion API hiba (HTTP 400): NotExistingPaymentId',
      kind: 'http',
      endpoint: 'GET state',
      httpStatus: 400,
      providerErrors: [{ ErrorCode: 'NotExistingPaymentId', Title: 'DUMMY', Description: 'DUMMY' }],
    })
  /** 1 óránál régebbi függő sorok, a legrégebben érintett elöl. */
  const agedBatch = (count: number): Order[] =>
    Array.from({ length: count }, (_, index) =>
      createPendingOrder({
        id: 3900 + index,
        orderNumber: `KH-2026-00${3900 + index}`,
        barionPaymentId: `fafafafa-fafa-fafa-fafa-0000000000${String(index).padStart(2, '0')}`,
        createdAt: isoHoursAgo(2),
        updatedAt: new Date(NOW - (60 - index) * 60_000).toISOString(),
      }),
    )

  /**
   * A NotExistingPaymentId definitív (#260: 1 óra után lezár). Ha viszont a
   * Barion MINDEN fizetésre ezt adja (BARION_ENVIRONMENT-tévesztés, idegen
   * POSKey), egy futás eddig minden 1 óránál régebbi függő sort lezárt.
   */
  it('20 régi sor, mind NotExistingPaymentId, egyetlen sikeres GetState sincs → nincs lezárás, egy RIASZTÁS', async () => {
    const pending = agedBatch(20)
    const f = setup({ pending })
    const { log, errors } = contextLog()
    const fetchState = vi.fn(async (): Promise<BarionPaymentStateResponse> => {
      throw notExistingPaymentId400()
    })

    const summary = await pollPendingOrders({
      ...f,
      fetchState,
      now: NOW,
      logger: log as never,
      invoicingEnabled: () => false,
    })

    expect(summary.cancelled).toBe(0)
    expect(pending.every((order) => order.status === 'payment_pending')).toBe(true)
    const alerts = errors.filter((entry) => entry.message.startsWith('RIASZTÁS'))
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.message).toContain('BARION_ENVIRONMENT')
    expect(alerts[0]?.context).toMatchObject({
      count: 20,
      providerErrorCodes: ['NotExistingPaymentId'],
    })
  })

  it.each([
    ['egy másik függő sor GetState-je sikeres', 'getstate'],
    ['az útvonal-próba (legutóbbi paid rendelés) sikeres', 'probe'],
  ] as const)(
    'ugyanez MAX_LEADING_FAILURES sorral, de %s → mind lezárul',
    async (_label, proof) => {
      const pending = agedBatch(MAX_LEADING_FAILURES)
      const live = livePendingOrder({ updatedAt: isoHoursAgo(0.01) })
      const paid = createPendingOrder({
        id: 3990,
        status: 'paid',
        barionPaymentId: PROBE_PAYMENT_ID,
      })
      const f =
        proof === 'getstate'
          ? setup({ pending: [...pending, live] })
          : setup({ pending, paidResweep: [paid] })
      const fetchState = vi.fn(async (paymentId: string) => {
        if (paymentId === LIVE_PAYMENT_ID || paymentId === PROBE_PAYMENT_ID) {
          return getStateResponse(proof === 'getstate' ? 'Prepared' : 'Succeeded', {
            PaymentId: paymentId,
          })
        }
        throw notExistingPaymentId400()
      })

      const summary = await pollPendingOrders({
        ...f,
        fetchState,
        now: NOW,
        logger: contextLog().log as never,
        invoicingEnabled: () => false,
      })

      expect(summary.cancelled).toBe(MAX_LEADING_FAILURES)
      expect(pending.every((order) => order.status === 'cancelled')).toBe(true)
      expect(paid.status).toBe('paid')
    },
  )
})

// ---------------------------------------------------------------------------
// fix-404 rev2 — több egymást követő futás: memóriabeli rendelés-tábla
// ---------------------------------------------------------------------------

/**
 * Memóriabeli orders-tábla egymást követő futásokhoz. A where-t (and, equals,
 * in, not_in, exists, greater_than_equal), a rendezést és a limitet úgy
 * alkalmazza, mint a DB, az update pedig bökí az updatedAt-et. A setup() mockja
 * a függő listát státusztól függetlenül adja vissza, ezért az olyan
 * forgatókönyvhöz, ahol a poll lezár egy sort, és az a következő futásokban a
 * late-success scanbe kerül, nem alkalmas.
 */
function ordersTable(rows: Order[], clock: { now: number }) {
  const field = (row: Order, name: string): unknown =>
    (row as unknown as Record<string, unknown>)[name]
  const matches = (row: Order, where: unknown): boolean => {
    if (!where || typeof where !== 'object') {
      return true
    }
    const record = where as Record<string, unknown>
    if (Array.isArray(record.and)) {
      return record.and.every((entry) => matches(row, entry))
    }
    if (Array.isArray(record.or)) {
      return record.or.some((entry) => matches(row, entry))
    }
    return Object.entries(record).every(([name, condition]) => {
      const c = condition as Record<string, unknown>
      const value = field(row, name)
      if ('equals' in c) return value === c.equals
      if ('in' in c) return (c.in as unknown[]).includes(value)
      if ('not_in' in c) return !(c.not_in as unknown[]).map(String).includes(String(value))
      if ('exists' in c) return (value !== null && value !== undefined) === c.exists
      if ('greater_than_equal' in c) return String(value) >= String(c.greater_than_equal)
      if ('less_than_equal' in c) return String(value) <= String(c.less_than_equal)
      throw new Error(`teszthiba: ismeretlen feltétel ${JSON.stringify(c)}`)
    })
  }
  const byId = (id: number | string): Order => {
    const found = rows.find((row) => String(row.id) === String(id))
    if (!found) {
      throw new Error(`teszthiba: nincs ilyen rendelés: ${id}`)
    }
    return found
  }
  return {
    find: async ({ where, sort, limit }: { where?: unknown; sort?: string; limit?: number }) => {
      let docs = rows.filter((row) => matches(row, where))
      if (sort) {
        const descending = sort.startsWith('-')
        const name = descending ? sort.slice(1) : sort
        docs = [...docs].sort((a, b) => {
          const diff = Date.parse(String(field(a, name))) - Date.parse(String(field(b, name)))
          return descending ? -diff : diff
        })
      }
      if (typeof limit === 'number') {
        docs = docs.slice(0, limit)
      }
      return { docs: docs.map((row) => ({ ...row })), totalDocs: docs.length }
    },
    findByID: async ({ collection, id }: { collection: string; id: number }) => {
      if (collection !== 'orders') {
        throw new Error(`teszthiba: váratlan findByID (${collection})`)
      }
      return { ...byId(id) }
    },
    update: async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
      const target = byId(id)
      Object.assign(target, data)
      target.updatedAt = new Date(clock.now).toISOString()
      return { ...target }
    },
  }
}

/** Időbélyeget is rögzítő napló: melyik futásban íródott a sor. */
function timedLog(clock: { now: number }) {
  type Entry = { message: string; context: Record<string, unknown>; at: number }
  const errors: Entry[] = []
  const warns: Entry[] = []
  const log = {
    child: () => log,
    debug: (): void => undefined,
    info: (): void => undefined,
    warn: (message: string, context?: Record<string, unknown>) => {
      warns.push({ message, context: context ?? {}, at: clock.now })
    },
    error: (message: string, context?: Record<string, unknown>) => {
      errors.push({ message, context: context ?? {}, at: clock.now })
    },
  }
  return { log, errors, warns }
}

const POLL_INTERVAL_MS = 5 * 60_000

/** Egymást követő, 5 percenkénti futások (a cron ütemezése szerint). */
async function pollEveryFiveMinutes(input: {
  payload: unknown
  fetchState: (paymentId: string) => Promise<BarionPaymentStateResponse>
  log: unknown
  clock: { now: number }
  runs: number
  startAt?: number
}): Promise<void> {
  for (let run = 0; run < input.runs; run += 1) {
    input.clock.now = (input.startAt ?? NOW) + run * POLL_INTERVAL_MS
    await pollPendingOrders({
      payload: input.payload as never,
      fetchState: input.fetchState,
      now: input.clock.now,
      logger: input.log as never,
      invoicingEnabled: () => false,
    })
  }
}

const ceilingAlertPrefix = `RIASZTÁS: ${MAX_LEADING_FAILURES} tisztázatlan Barion-hiba`

/** Tisztázatlan (nem 404, nem auth, nem szállítási) Barion-hiba: a sor nem forog. */
function unclearProviderError(): BarionApiError {
  return new BarionApiError({
    message: 'Barion API hiba (HTTP 400): SomethingElse',
    kind: 'http',
    endpoint: 'GET state',
    httpStatus: 400,
    providerErrors: [{ ErrorCode: 'SomethingElse', Title: 'DUMMY', Description: 'DUMMY' }],
  })
}

describe('fix-404 rev2 — a futás eleji mennyezet riasztása: útvonal-próba és fojtás', () => {
  /**
   * Breaker X1: a poll a sikeres útvonal-próbával lezár hat, a másik
   * környezetből maradt, puszta 404-es függő sort. Ezek a 7 napos ablakban a
   * late-success scanbe kerülnek, tartósan 404-et kapnak, és csendes boltban
   * minden futás eléri velük a mennyezetet. Eddig ez 5 percenként „Ellenőrizd a
   * Barion-környezetet, a POSKey-t" RIASZTÁS-t írt, miközben ugyanaz a futás
   * épp bizonyította, hogy az útvonal és a POSKey működik.
   */
  it('a poll által lezárt ≥5 puszta-404-es sor: sikeres útvonal-próba mellett a late-success mennyezet nem riaszt, a próba futásonként egyszer fut', async () => {
    const clock = { now: NOW }
    const stuck = Array.from({ length: MAX_LEADING_FAILURES + 1 }, (_, index) =>
      createPendingOrder({
        id: 4000 + index,
        orderNumber: `KH-2026-00${4000 + index}`,
        barionPaymentId: `a1a1a1a1-a1a1-a1a1-a1a1-00000000000${index}`,
        createdAt: isoHoursAgo(30),
        updatedAt: new Date(NOW - 30 * 3600_000 + index).toISOString(),
      }),
    )
    // PR #304: a lezáráshoz egy a sorok ELŐTT (20 napja) és egy UTÁNUK (2 órája)
    // indult, a mostani beállítással lekérdezhető fizetett rendelés kell.
    const olderPaid = createPendingOrder({
      id: 4090,
      status: 'paid',
      customer: 8,
      barionPaymentId: OLDER_PAYMENT_ID,
      createdAt: isoHoursAgo(24 * 20),
      updatedAt: isoHoursAgo(24 * 19),
    })
    const paid = createPendingOrder({
      id: 4091,
      status: 'paid',
      customer: 8,
      barionPaymentId: PROBE_PAYMENT_ID,
      createdAt: isoHoursAgo(2),
      updatedAt: isoHoursAgo(2),
    })
    const payload = ordersTable([...stuck, olderPaid, paid], clock)
    const probeCallsAt: number[] = []
    const fetchState = vi.fn(async (paymentId: string): Promise<BarionPaymentStateResponse> => {
      if (paymentId === PROBE_PAYMENT_ID || paymentId === OLDER_PAYMENT_ID) {
        if (paymentId === PROBE_PAYMENT_ID) probeCallsAt.push(clock.now)
        return getStateResponse('Succeeded', { PaymentId: paymentId })
      }
      throw bareNotFound()
    })
    const { log, errors } = timedLog(clock)

    await pollEveryFiveMinutes({ payload, fetchState, log, clock, runs: 24 })

    expect(stuck.every((order) => order.status === 'cancelled')).toBe(true)
    const lastClosureAt = Math.max(
      ...errors
        .filter((entry) => entry.message.includes('lezárva (cancelled)'))
        .map((entry) => entry.at),
    )
    expect(lastClosureAt).toBe(NOW + POLL_INTERVAL_MS)
    // A bizonyított útvonal mellett a függő mennyezet sem riaszt (P-D), a lezárt
    // sorokat pedig a late-success scan többé nem kérdezi (r-barion-6), így
    // mennyezet-RIASZTÁS egyáltalán nem megy.
    expect(errors.filter((entry) => entry.message.startsWith(ceilingAlertPrefix))).toEqual([])
    // A mennyezet és a futás végi lezárás ugyanazt a próbát használja: egy
    // futásban legfeljebb egy próba-hívás.
    expect(probeCallsAt.length).toBeGreaterThan(0)
    expect(new Set(probeCallsAt).size).toBe(probeCallsAt.length)
  })

  /**
   * Vezetői review: a mennyezet-RIASZTÁS futásszintű állapotot jelez, és
   * tartós oknál (a próba nem bizonyít, pl. nincs Barion-azonosítós paid
   * rendelés) 5 percenként ismétlődött. Óránként egy RIASZTÁS, közben warn.
   */
  it.each([
    ['a függő lapok', 'payment_pending', 'a függő rendelések feldolgozása megszakadt'],
    ['a late-success scan', 'cancelled', 'a late-success scan megszakadt'],
  ] as const)(
    '%s mennyezet-RIASZTÁS-a óránként egy, a közbeeső futások warn-t kapnak, a hívás-plafon marad',
    async (_label, status, marker) => {
      const clock = { now: NOW }
      const rows = Array.from({ length: MAX_LEADING_FAILURES }, (_, index) =>
        createPendingOrder({
          id: 4100 + index,
          status,
          barionPaymentId: `b2b2b2b2-b2b2-b2b2-b2b2-00000000000${index}`,
          createdAt: isoHoursAgo(2),
          updatedAt: new Date(NOW - (60 - index) * 60_000).toISOString(),
        }),
      )
      const payload = ordersTable(rows, clock)
      // A lezárt sort a puszta 404 forgatja (az ellenőrzési pontja lezárul,
      // r-barion-6), így az többé nem esedékes. A late-success mennyezet
      // fojtását ezért egy nem forgató, tisztázatlan hibával mérjük.
      const failure = status === 'payment_pending' ? bareNotFound : unclearProviderError
      const fetchState = vi.fn(async (): Promise<BarionPaymentStateResponse> => {
        throw failure()
      })
      const { log, errors, warns } = timedLog(clock)
      const ceilingAlerts = () =>
        errors.filter((entry) => entry.message.startsWith(ceilingAlertPrefix))

      await pollEveryFiveMinutes({ payload, fetchState, log, clock, runs: 12 })

      expect(ceilingAlerts()).toHaveLength(1)
      expect(ceilingAlerts()[0]?.message).toContain(marker)
      const throttled = warns.filter(
        (entry) => entry.message.includes('mennyezet') && entry.message.includes('RIASZTÁS fojtva'),
      )
      expect(throttled).toHaveLength(11)
      expect(fetchState).toHaveBeenCalledTimes(12 * MAX_LEADING_FAILURES)

      await pollEveryFiveMinutes({
        payload,
        fetchState,
        log,
        clock,
        runs: 1,
        startAt: NOW + RUN_LEVEL_ALERT_COOLDOWN_MS,
      })
      expect(ceilingAlerts()).toHaveLength(2)
    },
  )
})

describe('fix-404 rev2 — csendes bolt, globális útvonalhiba: a late-success scan útvonal-gyanúja (X3)', () => {
  /**
   * Breaker X3: nincs függő sor, a late-success scan három lezárt sorára puszta
   * 404 jön, és a futásban semmi nem sikerül. A mennyezet (5) nem ér el, a
   * lezárt sorokra rendelésenként szándékosan nem riasztunk (B1), így eddig
   * senki nem vette észre, hogy egyetlen GetState sem működik. Az útvonal-próba
   * dönt: ha egy paid rendelés GetState-je is elbukik, óránként egy RIASZTÁS;
   * ha sikeres, a 404 sor-specifikus, és nincs riasztás.
   */
  it.each([
    ['elbukik (globális útvonalhiba)', 1, false],
    ['sikeres (sor-specifikus 404)', 0, true],
  ] as const)(
    'az útvonal-próba %s → egy óra alatt %i útvonal-gyanú RIASZTÁS, futásonként egy próba',
    async (_label, expectedAlerts, probeSucceeds) => {
      const clock = { now: NOW }
      const late = Array.from({ length: 3 }, (_, index) =>
        createPendingOrder({
          id: 4200 + index,
          status: 'cancelled',
          barionPaymentId: `c3c3c3c3-c3c3-c3c3-c3c3-00000000000${index}`,
          createdAt: isoHoursAgo(3),
          updatedAt: new Date(NOW - 2 * 3600_000 + index).toISOString(),
        }),
      )
      const paid = createPendingOrder({
        id: 4290,
        status: 'paid',
        barionPaymentId: PROBE_PAYMENT_ID,
        createdAt: isoHoursAgo(48),
        updatedAt: isoHoursAgo(48),
      })
      const payload = ordersTable([...late, paid], clock)
      const fetchState = vi.fn(async (paymentId: string): Promise<BarionPaymentStateResponse> => {
        if (probeSucceeds && paymentId === PROBE_PAYMENT_ID) {
          return getStateResponse('Succeeded', { PaymentId: paymentId })
        }
        throw bareNotFound()
      })
      const { log, errors } = timedLog(clock)

      await pollEveryFiveMinutes({ payload, fetchState, log, clock, runs: 12 })

      const alerts = errors.filter((entry) => entry.message.startsWith('RIASZTÁS'))
      expect(alerts).toHaveLength(expectedAlerts)
      expect(alerts.every((entry) => entry.message.includes('BARION_API_URL'))).toBe(true)
      expect(alerts.map((entry) => entry.context)).toEqual(
        Array.from({ length: expectedAlerts }, () =>
          expect.objectContaining({ lateUnverifiedNotFound: 3, routeProbe: 'failed' }),
        ),
      )
      // r-barion-6: a puszta 404 lezárja a sorok ellenőrzési pontját, a további
      // 11 futás egyetlen Barion-hívást sem tesz (korábban futásonként 3 + 1).
      expect(fetchState).toHaveBeenCalledTimes(late.length + 1)
      expect(late.every((order) => order.status === 'cancelled')).toBe(true)
    },
  )
})

describe('fix-404 rev2 — a not-found fék az útvonal-próbán múlik (X2)', () => {
  /**
   * Breaker X2: a B4-fék eddig csak az EGY futásban összegyűlt, 1 óránál
   * régebbi sorokat számolta. Globális félrekonfigurálásnál (minden fizetésre
   * NotExistingPaymentId, a paid rendelésére is) a szétszórt korú sorok
   * futásonként kis csomagokban lépték át az 1 órát, és mind lezárult, egyetlen
   * sikeres GetState nélkül.
   */
  it('szétszórt korú függő sorok, globális NotExistingPaymentId, a próba is elbukik → egy óra alatt semmi nem zárul le, egy RIASZTÁS, a visszatartott sor forog', async () => {
    const clock = { now: NOW }
    const ages = [3, 2.5, 2, 1.5, 0.9, 0.7, 0.5, 0.2]
    const rows = ages.map((ageHours, index) =>
      createPendingOrder({
        id: 4300 + index,
        orderNumber: `KH-2026-00${4300 + index}`,
        barionPaymentId: `d4d4d4d4-d4d4-d4d4-d4d4-00000000000${index}`,
        createdAt: isoHoursAgo(ageHours),
        updatedAt: isoHoursAgo(ageHours),
      }),
    )
    const paid = createPendingOrder({
      id: 4390,
      status: 'paid',
      barionPaymentId: PROBE_PAYMENT_ID,
      createdAt: isoHoursAgo(24 * 5),
      updatedAt: isoHoursAgo(24 * 5),
    })
    const payload = ordersTable([...rows, paid], clock)
    const fetchState = vi.fn(async (): Promise<BarionPaymentStateResponse> => {
      throw notExistingPaymentId(404)
    })
    const { log, errors } = timedLog(clock)

    await pollEveryFiveMinutes({ payload, fetchState, log, clock, runs: 12 })

    expect(rows.map((order) => order.status)).toEqual(ages.map(() => 'payment_pending'))
    const alerts = errors.filter((entry) => entry.message.startsWith('RIASZTÁS'))
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.message).toContain('BARION_ENVIRONMENT')
    expect(alerts[0]?.context).toMatchObject({
      count: 4,
      routeProbe: 'failed',
      probeOrderId: 4390,
      providerErrorCodes: ['NotExistingPaymentId'],
    })
    // A visszatartott sor minden futásban a sor végére forog (nem ragad a
    // függő lap elején, és nem éhezteti az élő sorokat).
    expect(rows[0]?.updatedAt).toBe(new Date(clock.now).toISOString())
  })

  it('a fék RIASZTÁS-a fojtott: a cooldown alatt egy, a lejárta után újra', async () => {
    const pending = Array.from({ length: MAX_LEADING_FAILURES }, (_, index) =>
      createPendingOrder({
        id: 4400 + index,
        barionPaymentId: `e5e5e5e5-e5e5-e5e5-e5e5-00000000000${index}`,
        createdAt: isoHoursAgo(2),
      }),
    )
    const f = setup({ pending })
    const { log, errors } = contextLog()
    const run = (at: number) =>
      pollPendingOrders({
        ...f,
        fetchState: async () => {
          throw notExistingPaymentId(404)
        },
        now: at,
        logger: log as never,
        invoicingEnabled: () => false,
      })
    const brakeAlerts = () =>
      errors.filter(
        (entry) =>
          entry.message.startsWith('RIASZTÁS') && entry.message.includes('BARION_ENVIRONMENT'),
      )

    await run(NOW)
    await run(NOW + POLL_INTERVAL_MS)
    expect(brakeAlerts()).toHaveLength(1)

    await run(NOW + DEFAULT_ALERT_COOLDOWN_MS)
    expect(brakeAlerts()).toHaveLength(2)
    expect(pending.every((order) => order.status === 'payment_pending')).toBe(true)
  })

  /**
   * Ha a próba nem tud dönteni (auth-megszakítás a futásban, vagy a jelölt nem
   * olvasható), a not-found kódú sor marad, és a következő futás dönt. Eddig a
   * MAX_LEADING_FAILURES-nél kevesebb ilyen sor ilyenkor is bizonyíték nélkül
   * lezárult.
   */
  it.each([['hitelesítési megszakítás a futásban'], ['a próba jelöltje nem olvasható (DB-hiba)']])(
    '%s → az egyetlen not-found kódú sor sem zárul le, fék-RIASZTÁS nincs',
    async (label) => {
      const authAbort = label.startsWith('hitelesítési')
      const definitive = createPendingOrder({
        id: 4501,
        barionPaymentId: STUCK_PAYMENT_ID,
        createdAt: isoHoursAgo(3),
        updatedAt: isoHoursAgo(3),
      })
      const other = livePendingOrder({ updatedAt: isoHoursAgo(0.1) })
      const f = setup({ pending: authAbort ? [definitive, other] : [definitive] })
      const findWithBrokenProbe = async (args: { sort?: string }) => {
        if (args.sort === '-updatedAt') {
          throw new Error('DUMMY DB read failure')
        }
        return (f.payload as unknown as { find(a: unknown): Promise<unknown> }).find(args)
      }
      const payload = authAbort
        ? f.payload
        : ({
            ...(f.payload as unknown as Record<string, unknown>),
            find: findWithBrokenProbe,
          } as unknown as Payload)
      const { log, errors, warns } = contextLog()

      await pollPendingOrders({
        ...f,
        payload,
        fetchState: async (paymentId: string) => {
          if (paymentId === STUCK_PAYMENT_ID) {
            throw notExistingPaymentId(404)
          }
          throw new BarionApiError({
            message: 'Barion API hiba (HTTP 401).',
            kind: 'http',
            endpoint: 'GET state',
            httpStatus: 401,
          })
        },
        now: NOW,
        logger: log as never,
        invoicingEnabled: () => false,
      })

      expect(definitive.status).toBe('payment_pending')
      expect(errors.some((entry) => entry.message.includes('BARION_ENVIRONMENT-et'))).toBe(false)
      expect(warns.some((message) => message.includes('a lezárás a következő futásra marad'))).toBe(
        true,
      )
    },
  )
})

describe('fix-404 rev2 — lezárási részletek (DB-hiba, a lezárás szövege)', () => {
  it('a not-found kódú sor lezárási írásának DB-hibája nem állítja meg a futást: a sor marad, a számla-resweep lefut', async () => {
    const definitive = createPendingOrder({
      id: 4601,
      barionPaymentId: STUCK_PAYMENT_ID,
      createdAt: isoHoursAgo(3),
    })
    const unbilled = createPendingOrder({
      id: 4602,
      status: 'paid',
      barionPaymentId: null,
      invoiceStatus: 'none',
    } as Partial<Order>)
    const f = setup({ pending: [definitive], paidResweep: [unbilled] })
    const original = f.payload as unknown as {
      update(args: { data: Record<string, unknown> }): Promise<unknown>
    }
    const payload = {
      ...(f.payload as unknown as Record<string, unknown>),
      update: async (args: { data: Record<string, unknown> }) => {
        if (args.data.status === 'cancelled') throw new Error('DUMMY DB write failure')
        return original.update(args)
      },
    } as unknown as Payload
    const { log, warns } = contextLog()

    const summary = await pollPendingOrders({
      ...f,
      payload,
      fetchState: async () => {
        throw notExistingPaymentId(404)
      },
      now: NOW,
      logger: log as never,
    })

    expect(definitive.status).toBe('payment_pending')
    expect(summary.cancelled).toBe(0)
    expect(f.queuedInvoices).toEqual([4602])
    expect(warns.some((message) => message.includes('ismeretlen fizetés: a cancelled írás'))).toBe(
      true,
    )
  })

  // r-barion-6 + PR #304: a lezárt régi sort a late-success scan többé nem
  // kérdezi, ezért a lezárási RIASZTÁS már nem ígér késői felvételt
  // (a korábbi lateSuccessRecoverable-mező ezt mondta ki 7 napig).
  it.each([
    ['30 órás', 30],
    ['30 napos', 24 * 30],
  ] as const)(
    'a puszta 404-es %s sor lezárási RIASZTÁS-a nem ígér késői felvételt',
    async (_label, ageHours) => {
      const stuck = stuckPendingOrder({
        createdAt: isoHoursAgo(ageHours),
        updatedAt: isoHoursAgo(ageHours),
      })
      const f = setup({ pending: [stuck, livePendingOrder()], paidResweep: [olderPaidOrder()] })
      const { log, errors } = contextLog()

      await pollPendingOrders({
        ...f,
        fetchState: async (paymentId: string) => {
          if (paymentId === LIVE_PAYMENT_ID) {
            return getStateResponse('Prepared', { PaymentId: paymentId })
          }
          if (paymentId === OLDER_PAYMENT_ID) {
            return getStateResponse('Succeeded', { PaymentId: paymentId })
          }
          throw bareNotFound()
        },
        now: NOW,
        logger: log as never,
        invoicingEnabled: () => false,
      })

      expect(stuck.status).toBe('cancelled')
      const closure = errors.find((entry) => entry.message.includes('lezárva (cancelled)'))
      expect(closure?.message).not.toContain('late-success')
      expect(closure?.context).not.toHaveProperty('lateSuccessRecoverable')
    },
  )
})

// ---------------------------------------------------------------------------
// w1-barion-platform: fix-404 követő javítások, 429, lezárt sorok leállítása,
// árva rendelés, visszatérítés heti újraellenőrzése
// ---------------------------------------------------------------------------

const MIN_MS = 60_000
const HOUR_MS = 3600_000

function transientTimeout(): BarionApiError {
  return new BarionApiError({ message: 'DUMMY timeout', kind: 'timeout', endpoint: 'GET state' })
}

function rateLimited(): BarionApiError {
  return new BarionApiError({
    message: 'Barion API hiba (HTTP 429).',
    kind: 'http',
    endpoint: 'GET state',
    httpStatus: 429,
  })
}

function unauthorized(): BarionApiError {
  return new BarionApiError({
    message: 'Barion API hiba (HTTP 401).',
    kind: 'http',
    endpoint: 'GET state',
    httpStatus: 401,
  })
}

const guidFor = (prefix: string, n: number): string =>
  `${prefix.repeat(8)}-${prefix.repeat(4)}-${prefix.repeat(4)}-${prefix.repeat(4)}-${String(n).padStart(12, '0')}`

function tableRow(id: number, overrides: Partial<Order>): Order {
  return createPendingOrder({
    id,
    orderNumber: `KH-2026-${String(id).padStart(6, '0')}`,
    customer: 7000 + id,
    ...overrides,
  })
}

/** A +60 perces ellenőrzési pontra esedékes lezárt sor (3 órás, 2 órája érintett). */
const dueLateRow = (id: number, prefix = 'd'): Order =>
  tableRow(id, {
    status: 'cancelled',
    barionPaymentId: guidFor(prefix, id),
    createdAt: isoHoursAgo(3),
    updatedAt: new Date(NOW - 2 * HOUR_MS + id).toISOString(),
  })

const pendingRow = (id: number, ageHours: number, prefix = 'b'): Order =>
  tableRow(id, {
    barionPaymentId: guidFor(prefix, id),
    createdAt: isoHoursAgo(ageHours),
    updatedAt: new Date(NOW - ageHours * HOUR_MS + id).toISOString(),
  })

const PROBE_ID = guidFor('f', 901)
const paidCandidate = (id: number, createdHoursAgo = 48): Order =>
  tableRow(id, {
    status: 'paid',
    barionPaymentId: PROBE_ID,
    createdAt: isoHoursAgo(createdHoursAgo),
    updatedAt: isoHoursAgo(createdHoursAgo),
  })

/** Futásszintű RIASZTÁS-ok (a függő sorok rendelésenkénti 404-riasztása nélkül). */
const runLevelAlerts = (errors: Array<{ message: string }>) =>
  errors.filter(
    (entry) =>
      entry.message.startsWith('RIASZTÁS') && !entry.message.includes('most NEM zárjuk le'),
  )

describe('fix-404 követés: egyetlen átmeneti próba-hiba nem konfigurációs RIASZTÁS (breaker P-A, P-B)', () => {
  it('P-A: lezárt, puszta 404-es sorok + a próba timeoutol → nincs útvonal-gyanú RIASZTÁS, csak warn', async () => {
    const clock = { now: NOW }
    const rows = [dueLateRow(500), dueLateRow(501), dueLateRow(502), paidCandidate(902)]
    const fetchState = vi.fn(async (paymentId: string): Promise<BarionPaymentStateResponse> => {
      if (paymentId === PROBE_ID) throw transientTimeout()
      throw bareNotFound()
    })
    const { log, errors, warns } = timedLog(clock)

    await pollEveryFiveMinutes({
      payload: ordersTable(rows, clock),
      fetchState,
      log,
      clock,
      runs: 1,
    })

    expect(errors.filter((entry) => entry.message.startsWith('RIASZTÁS'))).toEqual([])
    expect(warns.some((entry) => entry.message.includes('útvonal-próba eldöntetlen'))).toBe(true)
  })

  it('P-B: 2 órás NotExistingPaymentId-s függő sor + a próba timeoutol → a sor marad, nincs „konfigurációs hibára utal"', async () => {
    const clock = { now: NOW }
    const row = pendingRow(600, 2, 'e')
    const rows = [row, paidCandidate(903)]
    const fetchState = vi.fn(async (paymentId: string): Promise<BarionPaymentStateResponse> => {
      if (paymentId === PROBE_ID) throw transientTimeout()
      throw notExistingPaymentId(404)
    })
    const { log, errors } = timedLog(clock)

    await pollEveryFiveMinutes({
      payload: ordersTable(rows, clock),
      fetchState,
      log,
      clock,
      runs: 1,
    })

    expect(row.status).toBe('payment_pending')
    expect(errors.some((entry) => entry.message.includes('konfigurációs hibára utal'))).toBe(false)
  })
})

describe('fix-404 követés X2: próba-jelölt nélkül a fék a szétszórt korú sorokat is megfogja', () => {
  it('nincs Barion-azonosítós paid rendelés, globális NotExistingPaymentId, 8 szétszórt korú sor → egy óra alatt < 5 zárul le, és van RIASZTÁS', async () => {
    const clock = { now: NOW }
    const ages = [3, 2.5, 2, 1.5, 0.9, 0.7, 0.5, 0.2]
    const rows = ages.map((ageHours, index) => pendingRow(300 + index, ageHours, 'c'))
    const fetchState = vi.fn(async (): Promise<BarionPaymentStateResponse> => {
      throw notExistingPaymentId(404)
    })
    const { log, errors } = timedLog(clock)

    await pollEveryFiveMinutes({
      payload: ordersTable(rows, clock),
      fetchState,
      log,
      clock,
      runs: 12,
    })

    const cancelled = rows.filter((row) => row.status === 'cancelled').length
    expect(cancelled).toBeLessThan(MAX_LEADING_FAILURES)
    expect(errors.filter((entry) => entry.message.startsWith('RIASZTÁS')).length).toBeGreaterThan(0)
  })

  it('a legitim 1–4 maradék sor (#260) továbbra is lezárul próba-jelölt nélkül', async () => {
    const clock = { now: NOW }
    const rows = [pendingRow(310, 2, 'c'), pendingRow(311, 3, 'c')]
    const fetchState = vi.fn(async (): Promise<BarionPaymentStateResponse> => {
      throw notExistingPaymentId(404)
    })
    const { log } = timedLog(clock)

    await pollEveryFiveMinutes({
      payload: ordersTable(rows, clock),
      fetchState,
      log,
      clock,
      runs: 1,
    })

    expect(rows.every((row) => row.status === 'cancelled')).toBe(true)
  })
})

describe('fix-404 követés P-D: a függő lapok mennyezete megkérdezi az útvonal-próbát', () => {
  it('5 friss, puszta-404-es függő sor, működő útvonal → 12 óra alatt 0 mennyezet-RIASZTÁS', async () => {
    const clock = { now: NOW }
    const rows = [
      ...Array.from({ length: MAX_LEADING_FAILURES }, (_, index) => pendingRow(700 + index, 2)),
      paidCandidate(904),
    ]
    const fetchState = vi.fn(async (paymentId: string): Promise<BarionPaymentStateResponse> => {
      if (paymentId === PROBE_ID) return getStateResponse('Succeeded', { PaymentId: paymentId })
      throw bareNotFound()
    })
    const { log, errors, warns } = timedLog(clock)

    await pollEveryFiveMinutes({
      payload: ordersTable(rows, clock),
      fetchState,
      log,
      clock,
      runs: 12 * 12,
    })

    expect(errors.filter((entry) => entry.message.startsWith(ceilingAlertPrefix))).toEqual([])
    expect(
      warns.some(
        (entry) =>
          entry.message.includes('függő lapok elérték') &&
          entry.message.includes('útvonal-próba sikeres'),
      ),
    ).toBe(true)
  })
})

describe('fix-404 követés: a rev2 feltételeinek őr-tesztjei (breaker N1, N3, N4, N6, N16, N17 és a vezetői a–c)', () => {
  it('G-N3 / (b): globális puszta 404, a függő lapok elérik a mennyezetet, 2–3 late-sor → futásonként egy futásszintű RIASZTÁS', async () => {
    const clock = { now: NOW }
    const rows = [
      ...Array.from({ length: MAX_LEADING_FAILURES }, (_, index) => pendingRow(800 + index, 2)),
      dueLateRow(850),
      dueLateRow(851),
      dueLateRow(852),
      paidCandidate(905),
    ]
    const fetchState = vi.fn(async (): Promise<BarionPaymentStateResponse> => {
      throw bareNotFound()
    })
    const { log, errors } = timedLog(clock)

    await pollEveryFiveMinutes({
      payload: ordersTable(rows, clock),
      fetchState,
      log,
      clock,
      runs: 1,
    })

    expect(runLevelAlerts(errors)).toHaveLength(1)
  })

  it('G-N4: globális puszta 404, nincs függő sor, 6 late-sor és próba-jelölt → egy RIASZTÁS (a mennyezeté)', async () => {
    const clock = { now: NOW }
    const rows = [
      ...Array.from({ length: MAX_LEADING_FAILURES + 1 }, (_, index) => dueLateRow(860 + index)),
      paidCandidate(906),
    ]
    const fetchState = vi.fn(async (): Promise<BarionPaymentStateResponse> => {
      throw bareNotFound()
    })
    const { log, errors } = timedLog(clock)

    await pollEveryFiveMinutes({
      payload: ordersTable(rows, clock),
      fetchState,
      log,
      clock,
      runs: 1,
    })

    expect(errors.filter((entry) => entry.message.startsWith('RIASZTÁS'))).toHaveLength(1)
  })

  it('(a): globális puszta 404, 7 lezárt sor, sikertelen próba-jelölt → 12 futás alatt pontosan 1 RIASZTÁS', async () => {
    const clock = { now: NOW }
    const rows = [
      ...Array.from({ length: 7 }, (_, index) => dueLateRow(1860 + index)),
      paidCandidate(1906),
    ]
    const fetchState = vi.fn(async (): Promise<BarionPaymentStateResponse> => {
      throw bareNotFound()
    })
    const { log, errors } = timedLog(clock)

    await pollEveryFiveMinutes({
      payload: ordersTable(rows, clock),
      fetchState,
      log,
      clock,
      runs: 12,
    })

    expect(errors.filter((entry) => entry.message.startsWith('RIASZTÁS'))).toHaveLength(1)
  })

  it('G-N1 / (c): volt sikeres GetState, a late-sorok 404-esek, a próba-jelölt fizetése nem ismert → nincs útvonal-gyanú RIASZTÁS és nincs próba-hívás', async () => {
    const clock = { now: NOW }
    const live = pendingRow(870, 0.2, 'a')
    const rows = [live, dueLateRow(875), dueLateRow(876), dueLateRow(877), paidCandidate(907)]
    const fetchState = vi.fn(async (paymentId: string): Promise<BarionPaymentStateResponse> => {
      if (paymentId === live.barionPaymentId)
        return getStateResponse('Prepared', { PaymentId: paymentId })
      throw bareNotFound()
    })
    const { log, errors } = timedLog(clock)

    await pollEveryFiveMinutes({
      payload: ordersTable(rows, clock),
      fetchState,
      log,
      clock,
      runs: 1,
    })

    expect(errors.filter((entry) => entry.message.startsWith('RIASZTÁS'))).toHaveLength(0)
    expect(fetchState.mock.calls.filter(([id]) => id === PROBE_ID)).toHaveLength(0)
  })

  it('G-N6: a not-found kódú sor után sikeres GetState jön → a lezárás próba-hívás nélkül történik', async () => {
    const clock = { now: NOW }
    const definitive = tableRow(880, {
      barionPaymentId: guidFor('e', 880),
      createdAt: isoHoursAgo(2),
      updatedAt: isoHoursAgo(3),
    })
    const live = pendingRow(881, 0.2, 'a')
    const rows = [definitive, live, paidCandidate(908)]
    const fetchState = vi.fn(async (paymentId: string): Promise<BarionPaymentStateResponse> => {
      if (paymentId === live.barionPaymentId)
        return getStateResponse('Prepared', { PaymentId: paymentId })
      if (paymentId === PROBE_ID) return getStateResponse('Succeeded', { PaymentId: paymentId })
      throw notExistingPaymentId(404)
    })
    const { log } = timedLog(clock)

    await pollEveryFiveMinutes({
      payload: ordersTable(rows, clock),
      fetchState,
      log,
      clock,
      runs: 1,
    })

    expect(definitive.status).toBe('cancelled')
    expect(fetchState.mock.calls.filter(([id]) => id === PROBE_ID)).toHaveLength(0)
  })

  it('G-N17: szállítási megszakítás a függő lapon (előtte egy not-found kódú sor) → nincs próba-hívás, nincs konfigurációs RIASZTÁS', async () => {
    const clock = { now: NOW }
    const definitive = tableRow(890, {
      barionPaymentId: guidFor('e', 890),
      createdAt: isoHoursAgo(2),
      updatedAt: isoHoursAgo(5),
    })
    const rows = [
      definitive,
      pendingRow(891, 0.3),
      pendingRow(892, 0.3),
      pendingRow(893, 0.3),
      paidCandidate(909),
    ]
    const fetchState = vi.fn(async (paymentId: string): Promise<BarionPaymentStateResponse> => {
      if (paymentId === definitive.barionPaymentId) throw notExistingPaymentId(404)
      throw transientTimeout()
    })
    const { log, errors } = timedLog(clock)

    await pollEveryFiveMinutes({
      payload: ordersTable(rows, clock),
      fetchState,
      log,
      clock,
      runs: 1,
    })

    expect(definitive.status).toBe('payment_pending')
    expect(fetchState.mock.calls.filter(([id]) => id === PROBE_ID)).toHaveLength(0)
    expect(errors.some((entry) => entry.message.includes('konfigurációs hibára utal'))).toBe(false)
  })

  it('G-N16: hitelesítési megszakítás a late-success scanben (előtte egy not-found kódú függő sor) → nincs próba-hívás, nincs konfigurációs RIASZTÁS', async () => {
    const clock = { now: NOW }
    const definitive = tableRow(895, {
      barionPaymentId: guidFor('e', 895),
      createdAt: isoHoursAgo(2),
      updatedAt: isoHoursAgo(5),
    })
    const rows = [definitive, dueLateRow(896), paidCandidate(910)]
    const fetchState = vi.fn(async (paymentId: string): Promise<BarionPaymentStateResponse> => {
      if (paymentId === definitive.barionPaymentId) throw notExistingPaymentId(404)
      throw unauthorized()
    })
    const { log, errors } = timedLog(clock)

    await pollEveryFiveMinutes({
      payload: ordersTable(rows, clock),
      fetchState,
      log,
      clock,
      runs: 1,
    })

    expect(definitive.status).toBe('payment_pending')
    expect(fetchState.mock.calls.filter(([id]) => id === PROBE_ID)).toHaveLength(0)
    expect(errors.some((entry) => entry.message.includes('konfigurációs hibára utal'))).toBe(false)
  })

  it('a hitelesítési megszakítás RIASZTÁS-a futásszinten fojtott: 12 futás alatt 1 RIASZTÁS, közben warn', async () => {
    const clock = { now: NOW }
    const rows = [pendingRow(1900, 0.3), pendingRow(1901, 0.3)]
    const fetchState = vi.fn(async (): Promise<BarionPaymentStateResponse> => {
      throw unauthorized()
    })
    const { log, errors, warns } = timedLog(clock)

    await pollEveryFiveMinutes({
      payload: ordersTable(rows, clock),
      fetchState,
      log,
      clock,
      runs: 12,
    })

    expect(errors.filter((entry) => entry.message.includes('hitelesítési hiba'))).toHaveLength(1)
    expect(
      warns.filter((entry) => entry.message.includes('a futás ismét megszakadt')),
    ).toHaveLength(11)
  })

  it('a szállítási megszakítás RIASZTÁS-a is futásszinten fojtott', async () => {
    const clock = { now: NOW }
    const rows = Array.from({ length: MAX_CONSECUTIVE_TRANSPORT_FAILURES }, (_, index) =>
      pendingRow(1910 + index, 0.3),
    )
    const fetchState = vi.fn(async (): Promise<BarionPaymentStateResponse> => {
      throw transientTimeout()
    })
    const { log, errors } = timedLog(clock)

    await pollEveryFiveMinutes({
      payload: ordersTable(rows, clock),
      fetchState,
      log,
      clock,
      runs: 6,
    })

    expect(
      errors.filter((entry) => entry.message.includes('egymást követő Barion-hiba')),
    ).toHaveLength(1)
  })
})

describe('a-callback-8: HTTP 429 átmeneti — nem forgat, nem mennyezet, a következő futás újrapróbálja', () => {
  it('függő sor: a 429-es sor nem forog, a többi feldolgozódik, a következő futás újra rákérdez', async () => {
    const clock = { now: NOW }
    const limited = pendingRow(1950, 0.5)
    const live = pendingRow(1951, 0.5)
    const rows = [limited, live]
    let limitedCalls = 0
    const fetchState = vi.fn(async (paymentId: string): Promise<BarionPaymentStateResponse> => {
      if (paymentId === limited.barionPaymentId) {
        limitedCalls += 1
        if (limitedCalls === 1) throw rateLimited()
      }
      return getStateResponse('Prepared', { PaymentId: paymentId })
    })
    const { log, errors } = timedLog(clock)
    const updatedBefore = limited.updatedAt

    const payload = ordersTable(rows, clock)
    clock.now = NOW
    const summary = await pollPendingOrders({
      payload: payload as never,
      fetchState,
      now: NOW,
      logger: log as never,
      invoicingEnabled: () => false,
    })

    expect(summary.failed).toBe(1)
    expect(summary.stillPending).toBe(1)
    expect(limited.updatedAt).toBe(updatedBefore)
    expect(errors).toEqual([])

    await pollEveryFiveMinutes({
      payload,
      fetchState,
      log,
      clock,
      runs: 1,
      startAt: NOW + POLL_INTERVAL_MS,
    })
    expect(limitedCalls).toBe(2)
  })

  it('öt 429-es függő sor sem éri el a futás eleji mennyezetet, a mögöttük álló Succeeded paid lesz', async () => {
    const clock = { now: NOW }
    const limitedRows = Array.from({ length: MAX_LEADING_FAILURES }, (_, index) =>
      pendingRow(1960 + index, 0.5),
    )
    const target = pendingRow(1969, 0.5)
    Object.assign(target, { customer: 7, items: createPendingOrder().items })
    const f = setup({ pending: [...limitedRows, target] })
    const fetchState = vi.fn(async (paymentId: string): Promise<BarionPaymentStateResponse> => {
      if (paymentId === target.barionPaymentId)
        return getStateResponse('Succeeded', { PaymentId: paymentId })
      throw rateLimited()
    })
    const { log, errors } = timedLog(clock)

    const summary = await pollPendingOrders({
      ...f,
      fetchState,
      now: NOW,
      logger: log as never,
      invoicingEnabled: () => false,
    })

    expect(target.status).toBe('paid')
    expect(summary.skipped).toBe(0)
    expect(errors.filter((entry) => entry.message.startsWith(ceilingAlertPrefix))).toEqual([])
  })

  it('a 429 osztálya rate-limited (nem transport, nem unknown)', () => {
    expect(classifyBarionFailure(rateLimited())).toBe('rate-limited')
  })
})

describe('r-barion-6 / a-checkout-5: a Barion szerint végleges lezárt fizetést nem pollozzuk hét napig', () => {
  it('idővonal: az ablak vége + 15 perc előtt nincs hívás, +15 és +60 percnél egy-egy, utána Expired-re soha többé', async () => {
    const createdAt = NOW
    const row = tableRow(2100, {
      status: 'cancelled',
      barionPaymentId: guidFor('a', 2100),
      createdAt: new Date(createdAt).toISOString(),
      updatedAt: new Date(createdAt + 5 * MIN_MS).toISOString(),
    })
    const clock = { now: createdAt }
    const payload = ordersTable([row], clock)
    const callsAt: number[] = []
    const fetchState = vi.fn(async (paymentId: string): Promise<BarionPaymentStateResponse> => {
      callsAt.push(clock.now)
      return getStateResponse('Expired', { PaymentId: paymentId })
    })
    const { log } = timedLog(clock)

    // 7 napon át 5 percenként.
    await pollEveryFiveMinutes({
      payload,
      fetchState,
      log,
      clock,
      runs: (7 * 24 * 60) / 5,
      startAt: createdAt + 5 * MIN_MS,
    })

    expect(callsAt.map((at) => (at - createdAt) / MIN_MS)).toEqual([45, 90])
    expect(row.status).toBe('cancelled')
  })

  it('a még folyamatban lévő (Prepared) fizetés a +60 perces pont után is esedékes marad, amíg a Barion le nem zárja', async () => {
    const createdAt = NOW
    const row = tableRow(2101, {
      status: 'cancelled',
      barionPaymentId: guidFor('a', 2101),
      createdAt: new Date(createdAt).toISOString(),
      updatedAt: new Date(createdAt + 5 * MIN_MS).toISOString(),
    })
    const clock = { now: createdAt }
    let status = 'Prepared'
    const fetchState = vi.fn(async (paymentId: string): Promise<BarionPaymentStateResponse> =>
      getStateResponse(status, { PaymentId: paymentId }),
    )
    const { log } = timedLog(clock)
    const payload = ordersTable([row], clock)

    await pollEveryFiveMinutes({
      payload,
      fetchState,
      log,
      clock,
      runs: 24,
      startAt: createdAt + 5 * MIN_MS,
    })
    const whilePrepared = fetchState.mock.calls.length
    status = 'Expired'
    await pollEveryFiveMinutes({
      payload,
      fetchState,
      log,
      clock,
      runs: 12,
      startAt: createdAt + 125 * MIN_MS,
    })

    // +45 perctől 5 percenként a 2. óra végéig (45, 50, …, 120: 16 hívás); az
    // Expired után egy hívás, és vége.
    expect(whilePrepared).toBe(16)
    expect(fetchState.mock.calls.length).toBe(whilePrepared + 1)
  })

  it('a Barion szerint sikeres, de nálunk elutasított (paid-reject) lezárt sor futásonként esedékes marad (automatikus visszatérítés újrapróbálása)', async () => {
    const clock = { now: NOW }
    const row = dueLateRow(2102)
    const payload = ordersTable([row], clock)
    const fetchState = vi.fn(async (paymentId: string) =>
      getStateResponse('Succeeded', { PaymentId: paymentId }),
    )
    const recoverRejectedPaid = vi.fn(async () => ({
      action: 'failed' as const,
      detail: 'refund-pending-reconciliation',
    }))
    const { log } = timedLog(clock)

    for (let run = 0; run < 3; run += 1) {
      clock.now = NOW + run * POLL_INTERVAL_MS
      await pollPendingOrders({
        payload: payload as never,
        fetchState,
        applyTransition: (async () => ({
          action: 'rejected' as const,
          reason: 'duplicate-paid-order',
        })) as never,
        recoverRejectedPaid,
        now: clock.now,
        logger: log as never,
        invoicingEnabled: () => false,
      })
    }

    expect(fetchState).toHaveBeenCalledTimes(3)
    expect(recoverRejectedPaid).toHaveBeenCalledTimes(3)
  })
})

describe('paid-reject végleges leállása: igaz szöveg, fojtott RIASZTÁS, forgatás', () => {
  it.each([
    'automatic-refund-rejected',
    'automatic-refund-attempts-exhausted',
    'automatic-refund-window-closed',
  ])(
    '%s: függő sornál 3 futás alatt 1 RIASZTÁS, nem ígér következő futást, a sor forog',
    async (detail) => {
      const clock = { now: NOW }
      const row = pendingRow(2200, 1)
      const payload = ordersTable([row], clock)
      const { log, errors } = timedLog(clock)

      for (let run = 0; run < 3; run += 1) {
        clock.now = NOW + run * POLL_INTERVAL_MS
        await pollPendingOrders({
          payload: payload as never,
          fetchState: async (paymentId: string) =>
            getStateResponse('Succeeded', { PaymentId: paymentId }),
          applyTransition: (async () => ({
            action: 'rejected' as const,
            reason: 'duplicate-paid-order',
          })) as never,
          recoverRejectedPaid: async () => ({ action: 'failed' as const, detail }),
          now: clock.now,
          logger: log as never,
          invoicingEnabled: () => false,
        })
      }

      const terminal = errors.filter((entry) => entry.message.includes('paid-reject recovery'))
      expect(terminal).toHaveLength(1)
      expect(terminal[0]?.message).toContain('véglegesen leállt')
      expect(terminal[0]?.message).not.toContain('következő futás')
      expect(row.updatedAt).toBe(new Date(NOW + 2 * POLL_INTERVAL_MS).toISOString())
    },
  )

  // Lead (d): a nem végleges ok (a következő futás valóban újra ellenőrzi)
  // korábban minden 5 perces futásban új RIASZTÁS-sort írt ugyanarra az ügyre.
  it('nem végleges ok (historical-refund-reconciliation-required): 3 futás alatt 1 RIASZTÁS, a recovery minden futásban lefut', async () => {
    const clock = { now: NOW }
    const row = pendingRow(2202, 1)
    const payload = ordersTable([row], clock)
    const { log, errors } = timedLog(clock)
    const recoverRejectedPaid = vi.fn(async () => ({
      action: 'failed' as const,
      detail: 'historical-refund-reconciliation-required',
    }))

    for (let run = 0; run < 3; run += 1) {
      clock.now = NOW + run * POLL_INTERVAL_MS
      await pollPendingOrders({
        payload: payload as never,
        fetchState: async (paymentId: string) =>
          getStateResponse('Succeeded', { PaymentId: paymentId }),
        applyTransition: (async () => ({
          action: 'rejected' as const,
          reason: 'duplicate-paid-order',
        })) as never,
        recoverRejectedPaid,
        now: clock.now,
        logger: log as never,
        invoicingEnabled: () => false,
      })
    }

    expect(recoverRejectedPaid).toHaveBeenCalledTimes(3)
    const alerts = errors.filter((entry) => entry.message.includes('paid-reject recovery'))
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.message).toContain('a következő futás újra ellenőrzi')
  })

  it('lezárt sornál a végleges leállás lezárja az ellenőrzési pontot: a következő futás nem hív GetState-et', async () => {
    const clock = { now: NOW }
    const row = dueLateRow(2201)
    const payload = ordersTable([row], clock)
    const fetchState = vi.fn(async (paymentId: string) =>
      getStateResponse('Succeeded', { PaymentId: paymentId }),
    )
    const { log } = timedLog(clock)

    for (let run = 0; run < 2; run += 1) {
      clock.now = NOW + run * POLL_INTERVAL_MS
      await pollPendingOrders({
        payload: payload as never,
        fetchState,
        applyTransition: (async () => ({
          action: 'rejected' as const,
          reason: 'duplicate-paid-order',
        })) as never,
        recoverRejectedPaid: async () => ({
          action: 'failed' as const,
          detail: 'automatic-refund-window-closed',
        }),
        now: clock.now,
        logger: log as never,
        invoicingEnabled: () => false,
      })
    }

    expect(fetchState).toHaveBeenCalledTimes(1)
  })
})

describe('a-callback-9: árva rendelés lezárása előtt a gazdátlan Barion-callback események', () => {
  const ORPHAN_PAYMENT_ID = '12121212-3434-4545-5656-787878787878'
  const orphan = (ageHours: number): Order =>
    createPendingOrder({
      id: 2300,
      barionPaymentId: null,
      createdAt: isoHoursAgo(ageHours),
      updatedAt: isoHoursAgo(ageHours),
    })

  it('a callback eseményéből kiderül, hogy a fizetés ehhez a rendeléshez tartozik → pótolva és paid, nincs lezárás', async () => {
    const order = orphan(25)
    const f = setup({
      pending: [order],
      webhookEvents: [{ id: 1, externalId: ORPHAN_PAYMENT_ID, result: 'failed' }],
    })
    const fetchState = vi.fn(async (paymentId: string) =>
      getStateResponse('Succeeded', { PaymentId: paymentId }),
    )

    const summary = await pollPendingOrders({
      ...f,
      fetchState,
      now: NOW,
      invoicingEnabled: () => false,
    })

    expect(fetchState).toHaveBeenCalledWith(ORPHAN_PAYMENT_ID)
    expect(order.barionPaymentId).toBe(ORPHAN_PAYMENT_ID)
    expect(order.status).toBe('paid')
    expect(summary.orphaned).toBe(0)
    expect(f.paidCalls).toEqual([2300])
  })

  it('a gazdátlan esemény más rendelésszámhoz tartozik → az árva rendelés a szokásos módon lezárul', async () => {
    const order = orphan(25)
    const f = setup({
      pending: [order],
      webhookEvents: [{ id: 1, externalId: ORPHAN_PAYMENT_ID, result: 'failed' }],
    })
    const fetchState = vi.fn(async (paymentId: string) =>
      getStateResponse('Succeeded', { PaymentId: paymentId, PaymentRequestId: 'KH-2026-999999' }),
    )

    const summary = await pollPendingOrders({
      ...f,
      fetchState,
      now: NOW,
      invoicingEnabled: () => false,
    })

    expect(order.status).toBe('cancelled')
    expect(order.barionPaymentId).toBeNull()
    expect(summary.orphaned).toBe(1)
  })

  it('nincs gazdátlan esemény → Barion-hívás nélkül lezárul (mint korábban)', async () => {
    const order = orphan(25)
    const f = setup({ pending: [order] })
    const fetchState = vi.fn(async () => getStateResponse('Succeeded'))

    const summary = await pollPendingOrders({
      ...f,
      fetchState,
      now: NOW,
      invoicingEnabled: () => false,
    })

    expect(fetchState).not.toHaveBeenCalled()
    expect(summary.orphaned).toBe(1)
  })

  // Breaker BRK-3: a Barion definitív „nincs ilyen fizetés” válasza (hamis GUID,
  // a másik Barion-környezet fizetése) korábban „nem ellenőrizhető”-nek számított,
  // és 48 óráig tartotta függőben az árva rendelést.
  it('a gazdátlan eseményre a Barion NotExistingPaymentId-t ad → nem jelölt, a 25 órás árva rendelés lezárul, a kihagyás warn-nyomot hagy', async () => {
    const order = orphan(25)
    const f = setup({
      pending: [order],
      webhookEvents: [{ id: 1, externalId: ORPHAN_PAYMENT_ID, result: 'rejected' }],
    })
    const fetchState = vi.fn(async () => {
      throw notExistingPaymentId()
    })
    const { log, warns } = contextLog()

    const summary = await pollPendingOrders({
      ...f,
      fetchState,
      now: NOW,
      logger: log as never,
      invoicingEnabled: () => false,
    })

    expect(fetchState).toHaveBeenCalledWith(ORPHAN_PAYMENT_ID)
    expect(order.status).toBe('cancelled')
    expect(summary.orphaned).toBe(1)
    // Környezetváltás után ez akár épp ennek a rendelésnek a fizetése is lehet:
    // a kihagyásnak nyoma marad a kézi egyeztetéshez.
    expect(
      warns.filter((message) =>
        message.startsWith('árva rendelés: egy gazdátlan Barion-eseményt a Barion a jelenlegi'),
      ),
    ).toHaveLength(1)
  })

  it.each([
    [25, 'payment_pending', false],
    [49, 'cancelled', true],
  ] as const)(
    'a gazdátlan esemény GetState-je hibázik, %i órás rendelés → %s (RIASZTÁS: %s)',
    async (ageHours, expected, alerted) => {
      const order = orphan(ageHours)
      const f = setup({
        pending: [order],
        webhookEvents: [{ id: 1, externalId: ORPHAN_PAYMENT_ID }],
      })
      const { log, errors } = contextLog()

      await pollPendingOrders({
        ...f,
        fetchState: async () => {
          throw transientTimeout()
        },
        now: NOW,
        logger: log as never,
        invoicingEnabled: () => false,
      })

      expect(order.status).toBe(expected)
      expect(errors.some((entry) => entry.message.includes('nem volt ellenőrizhető'))).toBe(alerted)
    },
  )
})

describe('r-barion-8: minden visszatérítés egy héttel később egyszer újra egyeztetve', () => {
  // A hibázott, le nem zárt újraellenőrzések tára folyamat-szintű, és a sávból
  // kiesett bejegyzésről a következő futás utólag RIASZTÁS-t küld. Hogy egy
  // teszt maradéka ne a következő teszt naplójába riasszon, minden teszt után
  // egy jóval későbbi, jelölt nélküli futás a valódi határon kiüríti a tárat
  // (a fojtást a fájlszintű afterEach utána nullázza).
  afterEach(async () => {
    await pollPendingOrders({
      ...setup({ pending: [], paidResweep: [] }),
      fetchState: async () => {
        throw new Error('TESZT: a tár kiürítése nem hívhat GetState-et')
      },
      now: NOW + 365 * 24 * HOUR_MS,
      logger: contextLog().log as never,
      invoicingEnabled: () => false,
    })
  })

  const SOURCE_TX_ID = 'abababab-0000-4000-8000-000000000001'
  function refundedOrder(refundedDaysAgo: number): Order {
    return createPendingOrder({
      id: 2400,
      status: 'refunded',
      invoiceStatus: 'issued',
      refundedAt: new Date(NOW - refundedDaysAgo * 24 * HOUR_MS).toISOString(),
      refunds: [
        {
          transactionId: SOURCE_TX_ID,
          amountHuf: ORDER_TOTAL_HUF,
          status: 'Succeeded',
          refundedAt: new Date(NOW - refundedDaysAgo * 24 * HOUR_MS).toISOString(),
          type: 'full',
        },
      ],
    } as Partial<Order>)
  }
  const reversedState = () =>
    getStateResponse('Succeeded', {
      Total: 0,
      Transactions: [
        {
          TransactionId: SOURCE_TX_ID,
          POSTransactionId: `${ORDER_NUMBER}-1`,
          TransactionType: 'CardPayment',
          Status: 'Succeeded',
          Total: ORDER_TOTAL_HUF,
        },
        {
          TransactionId: 'abababab-0000-4000-8000-000000000002',
          TransactionType: 'RefundToBankCard',
          Status: 'Succeeded',
          Total: ORDER_TOTAL_HUF,
          RelatedId: SOURCE_TX_ID,
        },
        {
          TransactionId: 'abababab-0000-4000-8000-000000000003',
          TransactionType: 'StornoUnSuccessfulRefundToBankCard',
          Status: 'Succeeded',
          Total: ORDER_TOTAL_HUF,
          RelatedId: SOURCE_TX_ID,
        },
      ],
    })

  function withLedger(f: ReturnType<typeof setup>, orderId: number): Payload {
    return {
      ...(f.payload as unknown as Record<string, unknown>),
      db: { drizzle: emptyRefundLedger([orderId]) },
    } as unknown as Payload
  }

  it('7,5 napos visszatérítés, a Barion sztornózta (StornoUnSuccessfulRefundToBankCard) → RIASZTÁS, írás nélkül; a sávban egyszer', async () => {
    const order = refundedOrder(7.5)
    const f = setup({ pending: [], paidResweep: [order] })
    const payload = withLedger(f, order.id)
    const fetchState = vi.fn(async () => reversedState())
    const { log, errors } = contextLog()

    for (const offset of [0, POLL_INTERVAL_MS]) {
      await pollPendingOrders({
        ...f,
        payload,
        fetchState,
        now: NOW + offset,
        logger: log as never,
        invoicingEnabled: () => false,
      })
    }

    expect(fetchState).toHaveBeenCalledTimes(1)
    const alert = errors.find((entry) =>
      entry.message.startsWith('RIASZTÁS: a Barion visszatérítései nem egyeznek'),
    )
    expect(alert?.context).toMatchObject({ findings: ['refund-reversal'] })
    expect(f.orderUpdateCalls).toEqual([])
  })

  it.each([3, 9])('%i napos visszatérítés a sávon kívül → nincs GetState', async (days) => {
    const order = refundedOrder(days)
    const f = setup({ pending: [], paidResweep: [order] })
    const fetchState = vi.fn(async () => reversedState())

    await pollPendingOrders({
      ...f,
      payload: withLedger(f, order.id),
      fetchState,
      now: NOW,
      invoicingEnabled: () => false,
    })

    expect(fetchState).not.toHaveBeenCalled()
  })

  // Breaker BRK-4: a részleges visszatérítés a rendelést paid-en hagyja, a
  // rendelés refundedAt-je üres, csak a refunds[].refundedAt hordozza az időt.
  it('részleges visszatérítés (a rendelés paid, refundedAt üres) 7,5 nap után is újra egyeztetve: a sztornó RIASZTÁS-t ad', async () => {
    const refundedIso = new Date(NOW - 7.5 * 24 * HOUR_MS).toISOString()
    const order = createPendingOrder({
      id: 2401,
      status: 'paid',
      invoiceStatus: 'issued',
      refunds: [
        {
          transactionId: SOURCE_TX_ID,
          amountHuf: 5000,
          status: 'Succeeded',
          refundedAt: refundedIso,
          type: 'partial',
        },
      ],
    } as Partial<Order>)
    expect(order.refundedAt ?? null).toBeNull()
    const f = setup({ pending: [], paidResweep: [order] })
    const fetchState = vi.fn(async () =>
      getStateResponse('Succeeded', {
        Total: ORDER_TOTAL_HUF - 5000,
        Transactions: [
          {
            TransactionId: SOURCE_TX_ID,
            POSTransactionId: `${ORDER_NUMBER}-1`,
            TransactionType: 'CardPayment',
            Status: 'Succeeded',
            Total: ORDER_TOTAL_HUF,
          },
          {
            TransactionId: 'abababab-0000-4000-8000-000000000002',
            TransactionType: 'RefundToBankCard',
            Status: 'Succeeded',
            Total: 5000,
            RelatedId: SOURCE_TX_ID,
          },
          {
            TransactionId: 'abababab-0000-4000-8000-000000000003',
            TransactionType: 'StornoUnSuccessfulRefundToBankCard',
            Status: 'Succeeded',
            Total: 5000,
            RelatedId: SOURCE_TX_ID,
          },
        ],
      }),
    )
    const { log, errors } = contextLog()

    await pollPendingOrders({
      ...f,
      payload: withLedger(f, order.id),
      fetchState,
      now: NOW,
      logger: log as never,
      invoicingEnabled: () => false,
    })

    expect(fetchState).toHaveBeenCalledTimes(1)
    const alert = errors.find((entry) =>
      entry.message.startsWith('RIASZTÁS: a Barion visszatérítései nem egyeznek'),
    )
    expect(alert?.context).toMatchObject({ findings: ['refund-reversal'] })
  })

  // Lead (a): a sáv első 5 (már ellenőrzött, fojtott) sora korábban minden
  // futásban újra az 5-ös lapot töltötte ki, a 6. visszatérítés sosem került sorra.
  it('hat visszatérítés ugyanabban a sávban: futásonként legfeljebb 5 GetState, a 6. a következő futásban kerül sorra', async () => {
    const orders = [2410, 2411, 2412, 2413, 2414, 2415].map((id, index) => {
      const order = refundedOrder(7.1 + index * 0.1)
      order.id = id
      return order
    })
    const f = setup({ pending: [], paidResweep: orders })
    const payload = {
      ...(f.payload as unknown as Record<string, unknown>),
      db: { drizzle: emptyRefundLedger(orders.map((order) => order.id)) },
    } as unknown as Payload
    const fetchState = vi.fn(async () => reversedState())

    await pollPendingOrders({
      ...f,
      payload,
      fetchState,
      now: NOW,
      invoicingEnabled: () => false,
    })
    expect(fetchState).toHaveBeenCalledTimes(REFUND_RECHECK_BATCH_SIZE)

    await pollPendingOrders({
      ...f,
      payload,
      fetchState,
      now: NOW + POLL_INTERVAL_MS,
      invoicingEnabled: () => false,
    })
    expect(fetchState).toHaveBeenCalledTimes(6)
  })

  it('BRK-R2-1: a sávbeli újraellenőrzés átmeneti GetState-hibája (503) után a következő futás újra ellenőriz', async () => {
    const order = refundedOrder(7.5)
    const f = setup({ pending: [], paidResweep: [order] })
    const payload = withLedger(f, order.id)
    let calls = 0
    const fetchState = vi.fn(async () => {
      calls += 1
      if (calls === 1) {
        throw new BarionApiError({
          message: '503',
          kind: 'http',
          endpoint: 'GET x',
          httpStatus: 503,
        })
      }
      return reversedState()
    })
    const { log, errors } = contextLog()

    for (const offset of [0, REFUND_RECHECK_RETRY_GAP_MS]) {
      await pollPendingOrders({
        ...f,
        payload,
        fetchState,
        now: NOW + offset,
        logger: log as never,
        invoicingEnabled: () => false,
      })
    }

    expect(fetchState).toHaveBeenCalledTimes(2)
    const alert = errors.find((entry) =>
      entry.message.startsWith('RIASZTÁS: a Barion visszatérítései nem egyeznek'),
    )
    expect(alert?.context).toMatchObject({ findings: ['refund-reversal'] })
  })

  // Vezetői minor (rev3): a sikeres, egyező újraellenőrzés után a kulcs a
  // sávban foglalt marad. Ha a kulcs 'match' után is felszabadulna, minden
  // egyező visszatérítés 5 percenként GetState-et kapna 24 órán át.
  it('egyező visszatérítés (match): a következő futás a sávban nem kérdez újra', async () => {
    const order = refundedOrder(7.5)
    order.id = 2420
    const f = setup({ pending: [], paidResweep: [order] })
    const fetchState = vi.fn(async () =>
      getStateResponse('Succeeded', {
        Total: 0,
        Transactions: (reversedState().Transactions ?? []).filter(
          (transaction) => transaction.TransactionType !== 'StornoUnSuccessfulRefundToBankCard',
        ),
      }),
    )
    const { log, errors, infos } = contextLog()

    for (const offset of [0, POLL_INTERVAL_MS]) {
      await pollPendingOrders({
        ...f,
        payload: withLedger(f, order.id),
        fetchState,
        now: NOW + offset,
        logger: log as never,
        invoicingEnabled: () => false,
      })
    }

    expect(infos).toContain('visszatérítés-egyeztetés: a Barion és a rendelés adatai egyeznek')
    expect(fetchState).toHaveBeenCalledTimes(1)
    expect(errors).toEqual([])
  })

  const RECHECK_GAVE_UP_ALERT =
    'RIASZTÁS: a visszatérítés egy héttel későbbi ellenőrzése ennél a rendelésnél'
  const gaveUpAlerts = (errors: Array<{ message: string; context: Record<string, unknown> }>) =>
    errors.filter((entry) => entry.message.startsWith(RECHECK_GAVE_UP_ALERT))
  const GAP = REFUND_RECHECK_RETRY_GAP_MS
  const bare404 = (): BarionApiError =>
    new BarionApiError({
      message: 'Barion API hiba (HTTP 404).',
      kind: 'http',
      endpoint: 'GET state',
      httpStatus: 404,
    })
  const http503 = (): BarionApiError =>
    new BarionApiError({ message: '503', kind: 'http', endpoint: 'GET state', httpStatus: 503 })
  /** Sávbeli visszatérítések saját rendelés- és fizetés-azonosítóval (a modulszintű állapot miatt). */
  const bandOrders = (ids: number[], firstDaysAgo: number, stepDays = 0.1): Order[] =>
    ids.map((id, index) => {
      const order = refundedOrder(firstDaysAgo + index * stepDays)
      order.id = id
      order.barionPaymentId = guidFor('d', id)
      return order
    })
  const withLedgerFor = (f: ReturnType<typeof setup>, orders: Order[]): Payload =>
    ({
      ...(f.payload as unknown as Record<string, unknown>),
      db: { drizzle: emptyRefundLedger(orders.map((order) => order.id)) },
    }) as unknown as Payload

  // Breaker (rev3, major): a végleges hiba a következő futásban is ugyanaz
  // volna. Rev2 minden hiba után elengedte a kulcsot, így a sor 5 percenként
  // újra GetState-et kapott a sáv 24 órájában. Minden sor saját rendelés-
  // azonosítót kap: a hibaszámláló modulszintű, sorrendfüggés nélkül.
  it.each([
    ['NotExistingPaymentId (HTTP 400)', 2421, () => notExistingPaymentId(400), 'order'],
    [
      'egyéb 4xx elutasítás (HTTP 400, ModelValidationError)',
      2424,
      () =>
        new BarionApiError({
          message: 'Barion API hiba (HTTP 400): ModelValidationError',
          kind: 'http',
          endpoint: 'GET state',
          httpStatus: 400,
          providerErrors: [
            { ErrorCode: 'ModelValidationError', Title: 'DUMMY', Description: 'DUMMY' },
          ],
        }),
      'unknown',
    ],
  ] as const)(
    'végleges hiba (%s): a sávban nincs újabb GetState, egyetlen RIASZTÁS kéri a kézi ellenőrzést',
    async (_label, orderId, makeError, failureClass) => {
      const [order] = bandOrders([orderId], 7.05)
      const f = setup({ pending: [], paidResweep: [order] })
      const fetchState = vi.fn(async (): Promise<BarionPaymentStateResponse> => {
        throw makeError()
      })
      const { log, errors } = contextLog()

      for (const offset of [0, POLL_INTERVAL_MS, GAP, 2 * GAP]) {
        await pollPendingOrders({
          ...f,
          payload: withLedger(f, order.id),
          fetchState,
          now: NOW + offset,
          logger: log as never,
          invoicingEnabled: () => false,
        })
      }

      expect(fetchState).toHaveBeenCalledTimes(1)
      const alerts = gaveUpAlerts(errors)
      expect(alerts).toHaveLength(1)
      expect(alerts[0].context).toMatchObject({
        alertCode: 'visszaterites-ujraellenorzes-elmaradt',
        orderId: order.id,
        reason: 'vegleges-hiba',
        attempts: 1,
        failureClass,
      })
      expect(f.orderUpdateCalls).toEqual([])
    },
  )

  // Breaker (rev3): az átmeneti hiba után a sáv újrapróbál, de legfeljebb
  // REFUND_RECHECK_MAX_ATTEMPTS-szor, és a kísérletek között legalább
  // REFUND_RECHECK_RETRY_GAP_MS telik el (rev3 átnézés: egy negyedórás kiesés
  // ne égesse el mindhárom kísérletet); utána egyetlen RIASZTÁS, és a sávban csend.
  it.each([
    ['HTTP 503', 2422, () => http503(), 'transport'],
    ['időtúllépés', 2425, () => transientTimeout(), 'transport'],
    [
      'hálózati hiba',
      2426,
      () => new BarionApiError({ message: 'DUMMY reset', kind: 'network', endpoint: 'GET state' }),
      'transport',
    ],
    ['HTTP 429 a kapu újrapróbálása után is', 2427, () => rateLimited(), 'rate-limited'],
    [
      'HTTP 408 (proxy-időtúllépés)',
      2428,
      () =>
        new BarionApiError({
          message: 'Barion API hiba (HTTP 408).',
          kind: 'http',
          endpoint: 'GET state',
          httpStatus: 408,
        }),
      'unknown',
    ],
    [
      'értelmezhetetlen válasz',
      2429,
      () =>
        new BarionApiError({
          message: 'DUMMY nem JSON',
          kind: 'invalid_response',
          endpoint: 'GET state',
          httpStatus: 200,
        }),
      'unknown',
    ],
    ['nem Barion-eredetű kivétel', 2419, () => new Error('DUMMY váratlan hiba'), 'unknown'],
  ] as const)(
    'átmeneti hiba (%s): legfeljebb REFUND_RECHECK_MAX_ATTEMPTS kísérlet, köztük legalább REFUND_RECHECK_RETRY_GAP_MS, utána egyetlen RIASZTÁS',
    async (_label, orderId, makeError, failureClass) => {
      const [order] = bandOrders([orderId], 7.05)
      const f = setup({ pending: [], paidResweep: [order] })
      const fetchState = vi.fn(async (): Promise<BarionPaymentStateResponse> => {
        throw makeError()
      })
      const { log, errors } = contextLog()
      const callsPerRun: number[] = []
      const alertCountsPerRun: number[] = []

      for (const offset of [0, GAP - POLL_INTERVAL_MS, GAP, 2 * GAP, 3 * GAP]) {
        await pollPendingOrders({
          ...f,
          payload: withLedger(f, order.id),
          fetchState,
          now: NOW + offset,
          logger: log as never,
          invoicingEnabled: () => false,
        })
        callsPerRun.push(fetchState.mock.calls.length)
        alertCountsPerRun.push(gaveUpAlerts(errors).length)
      }

      // A várakozás vége előtti utolsó futás még nem próbál újra; a harmadik kísérlet után
      // a RIASZTÁS egyszer megy ki, a sávban több hívás nincs.
      expect(REFUND_RECHECK_MAX_ATTEMPTS).toBe(3)
      expect(callsPerRun).toEqual([1, 1, 2, 3, 3])
      expect(alertCountsPerRun).toEqual([0, 0, 0, 1, 1])
      expect(gaveUpAlerts(errors)[0].context).toMatchObject({
        reason: 'kiserletek-elfogytak',
        attempts: REFUND_RECHECK_MAX_ATTEMPTS,
        failureClass,
      })
    },
  )

  // A kísérletek közti várakozás nem viheti ki a sort a sávból feladás nélkül:
  // ha a sávból a várakozásnál kevesebb van hátra, a sor várakozás nélkül
  // megkapja a maradék kísérleteit és a RIASZTÁS-t.
  it('a sáv végén hibázó visszatérítés várakozás nélkül megkapja a maradék kísérleteit és a RIASZTÁS-t', async () => {
    const [order] = bandOrders([2418], 8 - (GAP - HOUR_MS) / (24 * HOUR_MS))
    const f = setup({ pending: [], paidResweep: [order] })
    const fetchState = vi.fn(async (): Promise<BarionPaymentStateResponse> => {
      throw http503()
    })
    const { log, errors } = contextLog()

    for (const offset of [0, POLL_INTERVAL_MS, 2 * POLL_INTERVAL_MS]) {
      await pollPendingOrders({
        ...f,
        payload: withLedger(f, order.id),
        fetchState,
        now: NOW + offset,
        logger: log as never,
        invoicingEnabled: () => false,
      })
    }

    expect(fetchState).toHaveBeenCalledTimes(REFUND_RECHECK_MAX_ATTEMPTS)
    expect(gaveUpAlerts(errors)).toHaveLength(1)
    expect(gaveUpAlerts(errors)[0].context).toMatchObject({ reason: 'kiserletek-elfogytak' })
  })

  it('átmeneti adatbázis-hiba (a friss rendelés-olvasás a GetState után bukik): ugyanaz a kísérlet-plafon', async () => {
    const [order] = bandOrders([2423], 7.05)
    const f = setup({ pending: [], paidResweep: [order] })
    const baseFind = (f.payload as unknown as { find: (args: unknown) => Promise<unknown> }).find
    const freshReads = vi.fn()
    const payload = {
      ...(f.payload as unknown as Record<string, unknown>),
      find: async (args: { collection: string; where?: unknown }) => {
        if (JSON.stringify(args.where ?? {}).includes(`"id":{"equals":${order.id}}`)) {
          freshReads()
          throw new Error('DUMMY Connection terminated unexpectedly')
        }
        return baseFind(args)
      },
    } as unknown as Payload
    const fetchState = vi.fn(async () => reversedState())
    const { log, errors } = contextLog()

    for (const offset of [0, GAP, 2 * GAP, 2 * GAP + POLL_INTERVAL_MS, 3 * GAP]) {
      await pollPendingOrders({
        ...f,
        payload,
        fetchState,
        now: NOW + offset,
        logger: log as never,
        invoicingEnabled: () => false,
      })
    }

    expect(freshReads).toHaveBeenCalledTimes(REFUND_RECHECK_MAX_ATTEMPTS)
    expect(fetchState).toHaveBeenCalledTimes(REFUND_RECHECK_MAX_ATTEMPTS)
    const alerts = gaveUpAlerts(errors)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].context).toMatchObject({
      reason: 'kiserletek-elfogytak',
      failureClass: 'adatbazis',
    })
  })

  // Breaker (rev3): a sáv elején álló, hibázó sorok nem foglalhatják el
  // futásról futásra az 5-ös GetState-keretet a sáv 6. visszatérítése elől.
  // A 429 fizetésenkénti fojtás (a futást nem állítja meg), ezért ez az átmeneti
  // eset; a szállítási hiba a futást amúgy is megállítja (lásd lent).
  it.each([
    ['végleges (NotExistingPaymentId)', 2430, () => notExistingPaymentId(400)],
    ['átmeneti (HTTP 429)', 2450, () => rateLimited()],
  ] as const)(
    '5 hibázó sor (%s) nem éheztetheti ki a sáv 6. visszatérítését: a második futás sorra veszi',
    async (_label, firstId, makeError) => {
      const orders = bandOrders(
        Array.from({ length: 6 }, (_unused, index) => firstId + index),
        7.05,
      )
      const f = setup({ pending: [], paidResweep: orders })
      const payload = withLedgerFor(f, orders)
      const reversedPaymentId = orders[5].barionPaymentId
      const fetchState = vi.fn(async (paymentId: string) => {
        if (paymentId !== reversedPaymentId) throw makeError()
        return reversedState()
      })
      const { log, errors } = contextLog()

      for (const offset of [0, POLL_INTERVAL_MS]) {
        await pollPendingOrders({
          ...f,
          payload,
          fetchState,
          now: NOW + offset,
          logger: log as never,
          invoicingEnabled: () => false,
        })
      }

      const calledIds = fetchState.mock.calls.map(([paymentId]) => paymentId)
      expect(calledIds.slice(0, REFUND_RECHECK_BATCH_SIZE)).not.toContain(reversedPaymentId)
      expect(calledIds).toContain(reversedPaymentId)
      const alert = errors.find((entry) =>
        entry.message.startsWith('RIASZTÁS: a Barion visszatérítései nem egyeznek'),
      )
      expect(alert?.context).toMatchObject({ findings: ['refund-reversal'] })
    },
  )

  // Rev3 átnézés: a szállítási hiba a Barion egészét érinti, a futás nem égeti
  // el vele a sáv többi sorát; a következő futás a még nem próbált sort veszi.
  it('szállítási hiba (503): a futás újraellenőrzése megáll, a következő futás a még nem próbált sort veszi', async () => {
    const orders = bandOrders([2444, 2445], 7.2)
    const f = setup({ pending: [], paidResweep: orders })
    const fetchState = vi.fn<(paymentId: string) => Promise<BarionPaymentStateResponse>>(
      async () => {
        throw http503()
      },
    )
    const calledPerRun: string[][] = []

    for (const offset of [0, POLL_INTERVAL_MS]) {
      fetchState.mockClear()
      await pollPendingOrders({
        ...f,
        payload: withLedgerFor(f, orders),
        fetchState,
        now: NOW + offset,
        invoicingEnabled: () => false,
      })
      calledPerRun.push(fetchState.mock.calls.map(([paymentId]) => paymentId))
    }

    expect(calledPerRun).toEqual([[orders[0].barionPaymentId], [orders[1].barionPaymentId]])
  })

  /** Az útvonal-próba jelöltje: a legutóbb frissült, Barion-azonosítós paid rendelés. */
  const paidProbeRow = (id: number): Order =>
    createPendingOrder({
      id,
      status: 'paid',
      invoiceStatus: 'issued',
      barionPaymentId: guidFor('e', id),
      updatedAt: new Date(NOW + HOUR_MS).toISOString(),
    } as Partial<Order>)
  const recheckRun = (
    f: ReturnType<typeof setup>,
    payload: Payload,
    fetchState: (paymentId: string) => Promise<BarionPaymentStateResponse>,
    now: number,
    log: unknown,
  ) =>
    pollPendingOrders({
      ...f,
      payload,
      fetchState,
      now,
      logger: log as never,
      invoicingEnabled: () => false,
    })

  // Breaker B2 (rev3-rev1): egy átmeneti POSKey-kiesés (pl. kulcsforgatás a
  // Barion adminban a Railway frissítése előtt) futásonként egy sávbeli
  // visszatérítést véglegesen feladott. A hitelesítési hiba globális: a sort
  // nem adjuk fel és kísérletet sem számolunk, de a sor hátrébb kerül (rev3-rev2),
  // így futásonként másik sor kap egy hívást; a futás megáll, egy fojtott
  // futásszintű RIASZTÁS megy ki; a javítás után a sáv minden sora sorra kerül.
  it('átmeneti hitelesítési kiesés: futásonként egy hívás mindig másik sorra, egy fojtott RIASZTÁS, feladás nélkül; utána a sáv minden visszatérítése újra ellenőrzött', async () => {
    const orders = bandOrders([2470, 2471, 2472], 7.2)
    const f = setup({ pending: [], paidResweep: orders })
    const payload = withLedgerFor(f, orders)
    let keyBroken = true
    const fetchState = vi.fn<(paymentId: string) => Promise<BarionPaymentStateResponse>>(
      async () => {
        if (keyBroken) throw unauthorized()
        return reversedState()
      },
    )
    const { log, errors } = contextLog()
    const calledPerRun: string[][] = []

    for (const run of [0, 1, 2]) {
      fetchState.mockClear()
      await recheckRun(f, payload, fetchState, NOW + run * POLL_INTERVAL_MS, log)
      calledPerRun.push(fetchState.mock.calls.map(([id]) => id))
    }
    keyBroken = false
    fetchState.mockClear()
    await recheckRun(f, payload, fetchState, NOW + GAP + 2 * POLL_INTERVAL_MS, log)

    expect(calledPerRun).toEqual(orders.map((order) => [order.barionPaymentId]))
    expect(fetchState.mock.calls.map(([id]) => id).sort()).toEqual(
      orders.map((order) => order.barionPaymentId).sort(),
    )
    expect(gaveUpAlerts(errors)).toEqual([])
    const authAlerts = errors.filter((entry) =>
      entry.message.startsWith('RIASZTÁS: Barion hitelesítési hiba'),
    )
    expect(authAlerts).toHaveLength(1)
    expect(authAlerts[0].context).toMatchObject({ source: 'refund-recheck', httpStatus: 401 })
  })

  // Breaker B1 (rev3-rev1): egy globális, puszta 404-es útvonalhiba (2026-09-24-én
  // mérve: „No HTTP resource was found”, Errors tömb nélkül) csendes boltban a
  // sáv minden visszatérítését véglegesen feladta. A puszta 404 csak akkor
  // végleges, ha az útvonal-próba bizonyítja, hogy az útvonal működik. A kiesés
  // alatt futásonként a sor és egy próba kap hívást (a futás megáll); a hátrébb
  // tett sor REFUND_RECHECK_RETRY_GAP_MS után, a még nem próbált azonnal kerül sorra.
  it('átmeneti globális 404 (útvonalhiba, a próba is elbukik): futásonként a sor és egy próba, nincs feladás, a javítás után a sáv visszatérítései újra ellenőrzésre kerülnek', async () => {
    const orders = bandOrders([2460, 2461, 2462], 7.2)
    const probe = paidProbeRow(2463)
    const f = setup({ pending: [], paidResweep: [...orders, probe] })
    const payload = withLedgerFor(f, orders)
    let routeBroken = true
    const fetchState = vi.fn<(paymentId: string) => Promise<BarionPaymentStateResponse>>(
      async (paymentId) => {
        if (routeBroken) throw bare404()
        return paymentId === probe.barionPaymentId ? getStateResponse('Succeeded') : reversedState()
      },
    )
    const { log, errors } = contextLog()
    const calledPerRun: string[][] = []
    const runAt = async (now: number): Promise<void> => {
      fetchState.mockClear()
      await recheckRun(f, payload, fetchState, now, log)
      calledPerRun.push(fetchState.mock.calls.map(([id]) => id))
    }

    await runAt(NOW)
    await runAt(NOW + POLL_INTERVAL_MS)
    routeBroken = false
    await runAt(NOW + 2 * POLL_INTERVAL_MS)
    await runAt(NOW + GAP + POLL_INTERVAL_MS)

    expect(calledPerRun).toEqual([
      [orders[0].barionPaymentId, probe.barionPaymentId],
      [orders[1].barionPaymentId, probe.barionPaymentId],
      [orders[2].barionPaymentId],
      [orders[0].barionPaymentId, orders[1].barionPaymentId],
    ])
    expect(gaveUpAlerts(errors)).toEqual([])
    const routeAlerts = errors.filter((entry) =>
      entry.message.startsWith(
        'RIASZTÁS: a Barion PaymentState HTTP 404-et adott a visszatérítések',
      ),
    )
    expect(routeAlerts).toHaveLength(1)
    expect(routeAlerts[0].context).toMatchObject({ source: 'refund-recheck', routeProbe: 'failed' })
  })

  it('puszta 404, de az útvonal-próba sikeres: a sor végleges hibával egyszer feladva, a sávban nincs újabb GetState', async () => {
    const [order] = bandOrders([2490], 7.05)
    const probeOrder = paidProbeRow(2491)
    const f = setup({ pending: [], paidResweep: [order, probeOrder] })
    const fetchState = vi.fn(async (paymentId: string): Promise<BarionPaymentStateResponse> => {
      if (paymentId === probeOrder.barionPaymentId) return getStateResponse('Succeeded')
      throw bare404()
    })
    const { log, errors } = contextLog()

    for (const offset of [0, GAP, 2 * GAP]) {
      await pollPendingOrders({
        ...f,
        payload: withLedger(f, order.id),
        fetchState,
        now: NOW + offset,
        logger: log as never,
        invoicingEnabled: () => false,
      })
    }

    expect(fetchState.mock.calls.filter(([id]) => id === order.barionPaymentId)).toHaveLength(1)
    const alerts = gaveUpAlerts(errors)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].context).toMatchObject({
      orderId: order.id,
      reason: 'vegleges-hiba',
      failureClass: 'unverified-404',
      httpStatus: 404,
    })
  })

  // A futás egy másik sikeres GetState-je ugyanúgy bizonyítja az útvonalat, mint
  // az útvonal-próba. Itt a próba jelöltje (egy paid rendelés) is 404-et adna:
  // ha a bizonyíték elveszne, a próba futna, és a sort nem adnánk fel.
  it.each([
    ['egy függő rendelés sikeres GetState-je', 'pending'],
    ['a sáv egy korábbi visszatérítésének sikeres GetState-je', 'band'],
  ] as const)(
    'puszta 404, az útvonalat a futásban %s bizonyítja: a sor próba nélkül, végleges hibával feladva',
    async (_label, evidence) => {
      const [okRow, notFoundRow] = bandOrders(
        evidence === 'pending' ? [2494, 2495] : [2492, 2493],
        7.05,
      )
      const band = evidence === 'pending' ? [notFoundRow] : [okRow, notFoundRow]
      const probe = paidProbeRow(evidence === 'pending' ? 2497 : 2498)
      const pendingOrder = createPendingOrder({ id: 2496 })
      const f = setup({
        pending: evidence === 'pending' ? [pendingOrder] : [],
        paidResweep: [...band, probe],
      })
      const fetchState = vi.fn(async (paymentId: string): Promise<BarionPaymentStateResponse> => {
        if (paymentId === PAYMENT_ID) return getStateResponse('Prepared')
        if (paymentId === okRow.barionPaymentId) return reversedState()
        throw bare404()
      })
      const { log, errors } = contextLog()

      await pollPendingOrders({
        ...f,
        payload: withLedgerFor(f, band),
        fetchState,
        now: NOW,
        logger: log as never,
        invoicingEnabled: () => false,
      })

      expect(
        fetchState.mock.calls.filter(([id]) => id === notFoundRow.barionPaymentId),
      ).toHaveLength(1)
      expect(fetchState.mock.calls.filter(([id]) => id === probe.barionPaymentId)).toEqual([])
      const alerts = gaveUpAlerts(errors)
      expect(alerts).toHaveLength(1)
      expect(alerts[0].context).toMatchObject({
        orderId: notFoundRow.id,
        reason: 'vegleges-hiba',
        failureClass: 'unverified-404',
      })
    },
  )

  // Rev3-rev2 (major): egyetlen sorra szóló, tartós puszta 404 nem állhat
  // futásról futásra a lista elején. 8d8c3fa-n a sor minden futásban elöl állt,
  // a próba után a futás megállt, és a sáv többi visszatérítése egyszer sem
  // kapott GetState-et (sztornó-érzékelés nélkül maradt). Ha a próba jelöltje
  // maga ez a sor, vagy nincs jelölt, a próba semmit nem bizonyít: a sor
  // átmeneti kísérletet kap, és a plafonnál RIASZTÁS-sal zárul.
  it.each([
    ['a próba jelöltje egy másik, szintén 404-es fizetés', 'other', 2600, null],
    [
      'a próba jelöltje maga a 404-es sor (részleges visszatérítés, paid)',
      'self',
      2603,
      'kiserletek-elfogytak',
    ],
    ['nincs próba-jelölt (nincs paid rendelés)', 'none', 2605, 'kiserletek-elfogytak'],
  ] as const)(
    'puszta 404 egyetlen sávbeli sorra (%s): a sor nem állja el a sáv többi visszatérítésének útját',
    async (_label, probeKind, stuckId, gaveUpReason) => {
      const [stuck, okRow] = bandOrders([stuckId, stuckId + 1], 7.05)
      if (probeKind === 'self') {
        stuck.status = 'paid'
        stuck.refundedAt = null
        stuck.refunds = (stuck.refunds ?? []).map((entry) => ({
          ...entry,
          amountHuf: 5000,
          type: 'partial' as const,
        }))
        stuck.updatedAt = new Date(NOW + HOUR_MS).toISOString()
      }
      const probeRows = probeKind === 'other' ? [paidProbeRow(stuckId + 2)] : []
      const f = setup({ pending: [], paidResweep: [stuck, okRow, ...probeRows] })
      const payload = withLedgerFor(f, [stuck, okRow])
      const fetchState = vi.fn(async (paymentId: string): Promise<BarionPaymentStateResponse> => {
        if (paymentId === okRow.barionPaymentId) return reversedState()
        throw bare404()
      })
      const okCalls = () =>
        fetchState.mock.calls.filter(([id]) => id === okRow.barionPaymentId).length
      const { log, errors } = contextLog()

      await recheckRun(f, payload, fetchState, NOW, log)
      await recheckRun(f, payload, fetchState, NOW + POLL_INTERVAL_MS, log)
      const okCallsAfterSecondRun = okCalls()
      await recheckRun(f, payload, fetchState, NOW + GAP, log)
      await recheckRun(f, payload, fetchState, NOW + 2 * GAP, log)

      expect(okCallsAfterSecondRun).toBe(1)
      expect(okCalls()).toBe(1)
      const alerts = gaveUpAlerts(errors)
      if (gaveUpReason === null) {
        expect(alerts).toEqual([])
      } else {
        expect(alerts).toHaveLength(1)
        expect(alerts[0].context).toMatchObject({
          orderId: stuck.id,
          reason: gaveUpReason,
          attempts: REFUND_RECHECK_MAX_ATTEMPTS,
          failureClass: 'unverified-404',
        })
      }
    },
  )

  // Az eldöntetlen próba (a jelölt GetState-je 429 vagy 503) nem bizonyít
  // semmit: a sor kísérlet nélkül hátrébb kerül, RIASZTÁS nem megy, és a
  // javítás után újra ellenőrzött (ha kísérletet számolnánk, a harmadik futás
  // feladná).
  it.each([
    ['HTTP 429', 2610, () => rateLimited()],
    ['HTTP 503', 2612, () => http503()],
  ] as const)(
    'puszta 404, az útvonal-próba eldöntetlen (%s): nincs kísérlet, nincs feladás, a javítás után a sor újra ellenőrzött',
    async (_label, rowId, probeError) => {
      const [order] = bandOrders([rowId], 7.05)
      const probe = paidProbeRow(rowId + 1)
      const f = setup({ pending: [], paidResweep: [order, probe] })
      let broken = true
      const fetchState = vi.fn(async (paymentId: string): Promise<BarionPaymentStateResponse> => {
        if (paymentId === probe.barionPaymentId) throw probeError()
        if (broken) throw bare404()
        return reversedState()
      })
      const { log, errors } = contextLog()

      for (const offset of [0, GAP, 2 * GAP]) {
        await recheckRun(f, withLedger(f, order.id), fetchState, NOW + offset, log)
      }
      broken = false
      await recheckRun(f, withLedger(f, order.id), fetchState, NOW + 3 * GAP, log)

      expect(fetchState.mock.calls.filter(([id]) => id === order.barionPaymentId)).toHaveLength(4)
      expect(gaveUpAlerts(errors)).toEqual([])
      expect(errors.filter((entry) => entry.message.includes('BARION_API_URL'))).toEqual([])
      const reversal = errors.find((entry) =>
        entry.message.startsWith('RIASZTÁS: a Barion visszatérítései nem egyeznek'),
      )
      expect(reversal?.context).toMatchObject({ findings: ['refund-reversal'] })
    },
  )

  // Breaker BRK-X1 (rev3-rev1): a sávnál hosszabb globális útvonalhiba alatt a
  // hátrébb tett, kísérlet nélküli sorok némán kiestek a sávból. A futások itt
  // óránként jönnek (egy késő futás legrosszabb esete): minden sor a sávból
  // kiesés előtt sor-szintű RIASZTÁS-t kap.
  it('a sávnál hosszabb globális 404: minden sávbeli visszatérítés a sávból kiesés előtt sor-szintű RIASZTÁS-t kap', async () => {
    const orders = bandOrders([2620, 2621, 2622], 7.02)
    const probe = paidProbeRow(2623)
    const f = setup({ pending: [], paidResweep: [...orders, probe] })
    const payload = withLedgerFor(f, orders)
    const fetchState = vi.fn(async (): Promise<BarionPaymentStateResponse> => {
      throw bare404()
    })
    const { log, errors } = contextLog()

    for (let hour = 0; hour <= 25; hour += 1) {
      await recheckRun(f, payload, fetchState, NOW + hour * HOUR_MS, log)
    }

    const alerts = gaveUpAlerts(errors)
    expect(alerts.map((entry) => entry.context.orderId).sort()).toEqual(
      orders.map((order) => order.id).sort(),
    )
    for (const alert of alerts) {
      expect(alert.context).toMatchObject({
        reason: 'globalis-hiba',
        failureClass: 'unverified-404',
      })
    }
  })

  // A többi globális megállás ugyanígy: a sávból REFUND_RECHECK_LAST_CHANCE_MS-on
  // belül kieső sor most kap RIASZTÁS-t, a több időt kapó sor nem. A RIASZTÁS a
  // sor eddigi kísérleteit viszi: a hitelesítési hiba nem számít kísérletnek,
  // az 503 igen.
  it.each([
    ['hitelesítési hiba', 'auth', 2630, 0],
    ['szállítási hiba (503)', 'transport', 2632, 1],
    ['a futás már a függő soroknál megszakadt (hitelesítés)', 'futas-megszakadt', 2634, 0],
  ] as const)(
    'globális megállás (%s): a sávból hamarosan kieső visszatérítés sor-szintű RIASZTÁS-t kap, a később kieső nem',
    async (_label, failureClass, exitingId, attempts) => {
      const [exiting] = bandOrders(
        [exitingId],
        8 - REFUND_RECHECK_LAST_CHANCE_MS / 2 / (24 * HOUR_MS),
      )
      const [later] = bandOrders([exitingId + 1], 7.05)
      const pendingOrder = createPendingOrder({ id: exitingId + 100 })
      const f = setup({
        pending: failureClass === 'futas-megszakadt' ? [pendingOrder] : [],
        paidResweep: [exiting, later],
      })
      const fetchState = vi.fn<(paymentId: string) => Promise<BarionPaymentStateResponse>>(
        async () => {
          throw failureClass === 'transport' ? http503() : unauthorized()
        },
      )
      const { log, errors } = contextLog()

      await recheckRun(f, withLedgerFor(f, [exiting, later]), fetchState, NOW, log)

      expect(fetchState.mock.calls.map(([id]) => id)).toEqual([
        failureClass === 'futas-megszakadt' ? PAYMENT_ID : exiting.barionPaymentId,
      ])
      const alerts = gaveUpAlerts(errors)
      expect(alerts).toHaveLength(1)
      expect(alerts[0].context).toMatchObject({
        orderId: exiting.id,
        reason: 'globalis-hiba',
        attempts,
        failureClass,
      })
    },
  )

  // Breaker BRK-X2 (rev3-rev1): ugyanaz a globális 404 a late-success scanben és
  // a heti újraellenőrzésben két, egyaránt a BARION_API_URL-re mutató
  // RIASZTÁS-t adott. Közös fojtás-kulcs: egy óra alatt egy RIASZTÁS.
  it('ugyanaz a globális 404 a late-success scanben és a heti újraellenőrzésben: egy futásban egyetlen útvonal-RIASZTÁS', async () => {
    const [order] = bandOrders([2640], 7.05)
    const late = createPendingOrder({
      id: 2641,
      status: 'cancelled',
      barionPaymentId: guidFor('f', 2641),
      createdAt: isoHoursAgo(3),
      updatedAt: isoHoursAgo(2),
    })
    const probe = paidProbeRow(2642)
    const f = setup({ pending: [], paidResweep: [order, probe], lateSuccess: [late] })
    const fetchState = vi.fn<(paymentId: string) => Promise<BarionPaymentStateResponse>>(
      async () => {
        throw bare404()
      },
    )
    const { log, errors } = contextLog()

    await recheckRun(f, withLedger(f, order.id), fetchState, NOW, log)

    expect(fetchState.mock.calls.map(([id]) => id)).toEqual([
      late.barionPaymentId,
      probe.barionPaymentId,
      order.barionPaymentId,
    ])
    const routeAlerts = errors.filter(
      (entry) => entry.message.startsWith('RIASZTÁS') && entry.message.includes('BARION_API_URL'),
    )
    expect(routeAlerts).toHaveLength(1)
  })

  // Breaker BRK-P5 (rev3-rev1): a várakozás után újrapróbálható, hibázó sorok a
  // még nem próbáltak mögé kerülnek, így nem foglalják el az 5-ös keretet a
  // sávba épp belépő visszatérítés elől.
  it('a várakozás után újrapróbáló sorok nem előzik meg a sávba épp belépő, még nem próbált visszatérítést', async () => {
    const failing = bandOrders([2650, 2651, 2652, 2653, 2654], 7.3)
    const [fresh] = bandOrders([2655], 7 - (GAP - POLL_INTERVAL_MS) / (24 * HOUR_MS))
    const all = [...failing, fresh]
    const f = setup({ pending: [], paidResweep: all })
    const payload = withLedgerFor(f, all)
    const fetchState = vi.fn(async (paymentId: string): Promise<BarionPaymentStateResponse> => {
      if (paymentId === fresh.barionPaymentId) return reversedState()
      throw rateLimited()
    })
    const { log } = contextLog()

    await recheckRun(f, payload, fetchState, NOW, log)
    expect(fetchState.mock.calls.map(([id]) => id)).toEqual(
      failing.map((order) => order.barionPaymentId),
    )
    fetchState.mockClear()
    await recheckRun(f, payload, fetchState, NOW + GAP, log)

    expect(fetchState.mock.calls[0]?.[0]).toBe(fresh.barionPaymentId)
  })

  // A kísérlet nélküli hátrébb tétel megtartja a sor korábbi kísérleteit: egy
  // közbeeső globális hiba nem adhat újabb REFUND_RECHECK_MAX_ATTEMPTS kört.
  it('a közbeeső hitelesítési hiba nem nullázza a sor korábbi kísérleteit: a harmadik átmeneti hiba után RIASZTÁS', async () => {
    const [order] = bandOrders([2660], 7.05)
    const f = setup({ pending: [], paidResweep: [order] })
    const errorsPerRun = [http503, unauthorized, http503, http503]
    let run = 0
    const fetchState = vi.fn(async (): Promise<BarionPaymentStateResponse> => {
      throw errorsPerRun[run]()
    })
    const { log, errors } = contextLog()

    for (const offset of [0, GAP, 2 * GAP, 3 * GAP]) {
      await recheckRun(f, withLedger(f, order.id), fetchState, NOW + offset, log)
      run += 1
    }

    expect(fetchState).toHaveBeenCalledTimes(4)
    const alerts = gaveUpAlerts(errors)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].context).toMatchObject({
      reason: 'kiserletek-elfogytak',
      attempts: REFUND_RECHECK_MAX_ATTEMPTS,
    })
  })

  // A sávból kiesés előtti RIASZTÁS csak a még le nem zárt sort érinti: a
  // sávban már ellenőrzött visszatérítés kulcsa foglalt, arról nem megy RIASZTÁS.
  it('globális megállásnál a sávban már ellenőrzött, hamarosan kieső visszatérítés nem kap RIASZTÁS-t', async () => {
    const [checked] = bandOrders([2662], 8 - REFUND_RECHECK_LAST_CHANCE_MS / 2 / (24 * HOUR_MS))
    const [entering] = bandOrders([2663], 7 - POLL_INTERVAL_MS / (24 * HOUR_MS))
    const f = setup({ pending: [], paidResweep: [checked, entering] })
    const payload = withLedgerFor(f, [checked, entering])
    let keyBroken = false
    const fetchState = vi.fn<(paymentId: string) => Promise<BarionPaymentStateResponse>>(
      async () => {
        if (keyBroken) throw unauthorized()
        return reversedState()
      },
    )
    const { log, errors } = contextLog()

    await recheckRun(f, payload, fetchState, NOW, log)
    keyBroken = true
    await recheckRun(f, payload, fetchState, NOW + 2 * POLL_INTERVAL_MS, log)

    expect(fetchState.mock.calls.map(([id]) => id)).toEqual([
      checked.barionPaymentId,
      entering.barionPaymentId,
    ])
    expect(gaveUpAlerts(errors)).toEqual([])
  })
  // Vezetői minor (rev3-rev3): a sávból kiesés előtti RIASZTÁS csak globális
  // megállás után jár. Egy sorra szóló átmeneti hiba (429) a sáv utolsó órájában
  // sem ad feladást: a következő futás újrapróbálja a sort.
  it('a sáv utolsó órájában kapott 429 nem globális megállás: nincs feladás, a következő futás újrapróbál', async () => {
    const [order] = bandOrders([2670], 8 - REFUND_RECHECK_LAST_CHANCE_MS / 2 / (24 * HOUR_MS))
    const f = setup({ pending: [], paidResweep: [order] })
    let calls = 0
    const fetchState = vi.fn(async (): Promise<BarionPaymentStateResponse> => {
      calls += 1
      if (calls === 1) throw rateLimited()
      return reversedState()
    })
    const { log, errors } = contextLog()

    await recheckRun(f, withLedger(f, order.id), fetchState, NOW, log)
    const gaveUpAfterFirstRun = gaveUpAlerts(errors).length
    await recheckRun(f, withLedger(f, order.id), fetchState, NOW + POLL_INTERVAL_MS, log)

    expect(gaveUpAfterFirstRun).toBe(0)
    expect(fetchState).toHaveBeenCalledTimes(2)
    expect(gaveUpAlerts(errors)).toEqual([])
    const reversal = errors.find((entry) =>
      entry.message.startsWith('RIASZTÁS: a Barion visszatérítései nem egyeznek'),
    )
    expect(reversal?.context).toMatchObject({ findings: ['refund-reversal'] })
  })

  // Vezetői minor (rev3-rev3): ha a sor a sáv utolsó futásában kap sorra szóló
  // átmeneti hibát (429), a következő futásban már nincs a sávban. fb98534-en
  // némán eltűnt; most a következő futás utólag, egyszer RIASZTÁS-t küld róla.
  it('a sáv utolsó perceiben 429-et kapó, azután kieső visszatérítés utólag egyszer RIASZTÁS-t kap', async () => {
    const [order] = bandOrders([2672], 8 - (3 * 60_000) / (24 * HOUR_MS))
    const f = setup({ pending: [], paidResweep: [order] })
    const fetchState = vi.fn(async (): Promise<BarionPaymentStateResponse> => {
      throw rateLimited()
    })
    const { log, errors } = contextLog()

    for (const run of [0, 1, 2]) {
      await recheckRun(f, withLedger(f, order.id), fetchState, NOW + run * POLL_INTERVAL_MS, log)
    }

    expect(fetchState).toHaveBeenCalledTimes(1)
    const alerts = gaveUpAlerts(errors)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].context).toMatchObject({
      orderId: order.id,
      reason: 'sav-lejart',
      attempts: 1,
      failureClass: 'rate-limited',
      refundedAt: order.refundedAt,
    })
  })

  // Az utólagos RIASZTÁS nem hamis riasztás: ha a rendelés egy újabb
  // visszatérítése sikeresen egyeztetve lett, az a fizetés egészét nézte, a
  // korábbi, hibázott időpont is lefedett.
  it('a hibázott részleges visszatérítés után egy újabb visszatérítés sikeres egyeztetése lefedi a korábbit: utólag nincs RIASZTÁS', async () => {
    const [order] = bandOrders([2674], 7.05)
    const earlierIso = new Date(NOW - 8 * 24 * HOUR_MS + HOUR_MS).toISOString()
    const laterIso = new Date(NOW - 7 * 24 * HOUR_MS + 10 * 60_000).toISOString()
    const partial = (refundedAt: string, transactionId: string) => ({
      transactionId,
      amountHuf: 5000,
      status: 'Succeeded' as const,
      refundedAt,
      type: 'partial' as const,
    })
    order.status = 'paid'
    order.refundedAt = null
    order.refunds = [
      partial(earlierIso, SOURCE_TX_ID),
      partial(laterIso, 'abababab-0000-4000-8000-000000000004'),
    ]
    const f = setup({ pending: [], paidResweep: [order] })
    let calls = 0
    const fetchState = vi.fn(async (): Promise<BarionPaymentStateResponse> => {
      calls += 1
      if (calls === 1) throw rateLimited()
      return reversedState()
    })
    const { log, errors } = contextLog()

    for (const offset of [0, 15 * 60_000, 65 * 60_000]) {
      await recheckRun(f, withLedger(f, order.id), fetchState, NOW + offset, log)
    }

    expect(fetchState).toHaveBeenCalledTimes(2)
    expect(gaveUpAlerts(errors)).toEqual([])
  })

  // Breaker BRK-R2-1 (rev3-rev2): a hátrébb tett sorok egymás közti sorrendje a
  // DB-sorrend volt. A tartós puszta 404-es, sikertelen próbájú sor a sáv utolsó
  // 6 órájában várakozás nélkül minden futásban elsőként próbálkozott, és a
  // futást megállította: a mögötte várakozó részleges visszatérítés (egyetlen
  // 503 után) sosem kapott újabb kísérletet, kézi RIASZTÁS lett belőle, közben
  // 47 GetState + 47 próba és 4 útvonal-RIASZTÁS. A legrégebben hibázott elöl.
  it('BRK-R2-1: a hátrébb tett, tartósan 404-es sor nem éheztetheti ki a várakozó sorokat', async () => {
    const [stuck] = bandOrders([2700], 7 + 18 / 24)
    const [partial] = bandOrders([2701], 7 + 20 / 24)
    partial.status = 'paid'
    partial.refundedAt = null
    partial.refunds = (partial.refunds ?? []).map((entry) => ({
      ...entry,
      amountHuf: 5000,
      type: 'partial' as const,
    }))
    const probe = paidProbeRow(2702)
    const f = setup({ pending: [], paidResweep: [stuck, partial, probe] })
    const payload = withLedgerFor(f, [stuck, partial])
    let partialCalls = 0
    const fetchState = vi.fn(async (paymentId: string): Promise<BarionPaymentStateResponse> => {
      if (paymentId === partial.barionPaymentId) {
        partialCalls += 1
        if (partialCalls === 1) throw http503()
        return reversedState()
      }
      throw bare404()
    })
    const { log, errors } = contextLog()

    for (let run = 0; run < 48; run += 1) {
      await recheckRun(f, payload, fetchState, NOW + run * POLL_INTERVAL_MS, log)
    }

    const stuckCalls = fetchState.mock.calls.filter(([id]) => id === stuck.barionPaymentId).length
    const routeAlerts = errors.filter(
      (entry) => entry.message.startsWith('RIASZTÁS') && entry.message.includes('BARION_API_URL'),
    ).length
    expect(partialCalls).toBe(2)
    expect(gaveUpAlerts(errors).filter((entry) => entry.context.orderId === partial.id)).toEqual([])
    expect(stuckCalls).toBeLessThanOrEqual(REFUND_RECHECK_MAX_ATTEMPTS)
    expect(routeAlerts).toBe(1)
  })

  // Breaker BRK-R2-2 (rev3-rev2): ha a próba jelöltje maga a 404-es sor, és a
  // próba második GetState-je sikeres, az első 404 bizonyítottan nem végleges.
  // fb98534 ezt végleges hibaként, az első kísérletben feladta.
  it('BRK-R2-2: sikeres önpróba után a sor nem végleges hibával feladva, hanem újrapróbálva', async () => {
    const [row] = bandOrders([2710], 7.05)
    row.status = 'paid'
    row.refundedAt = null
    row.refunds = (row.refunds ?? []).map((entry) => ({
      ...entry,
      amountHuf: 5000,
      type: 'partial' as const,
    }))
    row.updatedAt = new Date(NOW + HOUR_MS).toISOString()
    const f = setup({ pending: [], paidResweep: [row] })
    let calls = 0
    const fetchState = vi.fn(async (): Promise<BarionPaymentStateResponse> => {
      calls += 1
      if (calls === 1) throw bare404()
      return reversedState()
    })
    const { log, errors } = contextLog()

    await recheckRun(f, withLedger(f, row.id), fetchState, NOW, log)
    const reasonsAfterFirstRun = gaveUpAlerts(errors).map((entry) => entry.context.reason)
    await recheckRun(f, withLedger(f, row.id), fetchState, NOW + GAP, log)

    expect(reasonsAfterFirstRun).not.toContain('vegleges-hiba')
    expect(fetchState).toHaveBeenCalledTimes(3)
    expect(gaveUpAlerts(errors)).toEqual([])
  })
})
