import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  STUCK_ORDER_WARN_MS,
} from '../lib/order-poll/service'
import type { applyBarionStateTransition } from '../lib/order-status/apply-barion-state'
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

function setup(options: SetupOptions = {}) {
  const pending = options.pending ?? [createPendingOrder()]
  const paidResweep = options.paidResweep ?? []
  const lateSuccess = options.lateSuccess ?? []
  const user = { id: 7, email: 'anna@example.test', purchases: [] as number[] }
  const orderUpdates: Array<Record<string, unknown>> = []
  const queuedInvoices: number[] = []
  const paidCalls: number[] = []
  const finds: CapturedFind[] = []

  const payload = {
    find: async ({
      where,
      sort,
      limit,
    }: {
      collection: string
      where?: unknown
      sort?: string
      limit?: number
    }) => {
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
      if (sort === 'updatedAt') {
        docs.sort((a, b) => Date.parse(a.updatedAt ?? '') - Date.parse(b.updatedAt ?? ''))
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
      data,
    }: {
      collection: string
      id?: number | string
      data: Record<string, unknown>
    }) => {
      if (collection === 'orders') {
        orderUpdates.push(data)
        const pool = [...pending, ...paidResweep, ...lateSuccess]
        const target = id === undefined ? undefined : pool.find((order) => order.id === id)
        if (target) {
          Object.assign(target, data)
          // A Payload valódi update-je bökí az updatedAt-et — a W1/RF-3 touch
          // (ugyanazon státusz újraírása) csak így kerül a sor végére.
          if (typeof data.status === 'string') {
            target.updatedAt = new Date(NOW).toISOString()
          }
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
      expect(orderUpdates).toHaveLength(0)
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
    // W1 — rejected után touch: ugyanaz a státusz íródik vissza, hogy az
    // updatedAt elmozduljon. Státusz NEM cancelled/failed.
    expect(orderUpdates).toEqual([{ status: 'payment_pending' }])
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
    ).toBe('order')
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

  it('404 és a nem BarionApiError → order (rendelés-szintű, nem szakít meg)', () => {
    expect(
      classifyBarionFailure(
        new BarionApiError({ message: '404', kind: 'http', endpoint: 'GET x', httpStatus: 404 }),
      ),
    ).toBe('order')
    expect(classifyBarionFailure(new Error('fetch failed'))).toBe('order')
    expect(classifyBarionFailure(undefined)).toBe('order')
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
   * A 404 EGY fizetésre vonatkozik (nincs ilyen PaymentId), nem az egész
   * integrációra. Nem növeli a szállítási számlálót, tehát 25 ilyen rekord sem
   * tudja megszakítani a futást — különben egyetlen hibás rendelés
   * befagyasztaná az egész mentőhálót.
   */
  it('csupa HTTP 404 → SOHA nem szakít meg, minden rendelés sorra kerül', async () => {
    const notFound = (): BarionApiError =>
      new BarionApiError({ message: '404', kind: 'http', endpoint: 'GET x', httpStatus: 404 })
    const { calls, summary } = await runWithFailures(pendingBatch(5), [
      notFound(),
      notFound(),
      notFound(),
      notFound(),
      notFound(),
    ])

    expect(calls).toBe(5)
    expect(summary.failed).toBe(5)
    expect(summary.skipped).toBe(0)
  })
})

describe('order-poll — a futás eleji mennyezet (MAX_LEADING_FAILURES)', () => {
  /**
   * A keresztreview mutatott rá: a BARION_AUTH_ERROR_CODES listán NEM szereplő
   * hitelesítési hibakód `order`-osztályba esik (provider-hiba HTTP 200-zal),
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

  it('csupa `order`-osztályú hibánál az első MAX_LEADING_FAILURES után megszakít', async () => {
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

  it('late-success where: updatedAt ASC + barionPaymentId exists', async () => {
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
    expect(lateFinds[0]?.sort).toBe('updatedAt')
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
    RefundedTransactions: [{ TransactionId: 'tx-p0', Status: 'Refunded' }],
  })

  const refundableState: Partial<BarionPaymentStateResponse> = {
    Transactions: [
      {
        TransactionId: 'tx-p0',
        TransactionType: 'CardPayment',
        Status: 'Succeeded',
        Total: ORDER_TOTAL_HUF,
      },
    ] as BarionPaymentStateResponse['Transactions'],
  }

  it('pending + Succeeded + total-mismatch reject + sikeres auto-refund → nincs payment_pending visszaírás', async () => {
    const order = createPendingOrder({ id: 910, barionPaymentId: 'p0-pending-payment' })
    const { payload, onPaid, queueInvoice, orderUpdates, pending } = setup({
      pending: [order],
      stateOverrides: refundableState,
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
        recoverRejectedSucceededPayment({ ...input, refundPayment: refundedTransport }),
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
      barionPaymentId: 'p0-late-payment',
      createdAt: isoHoursAgo(2),
    })
    const { payload, onPaid, queueInvoice, orderUpdates, lateSuccess } = setup({
      pending: [],
      lateSuccess: [cancelled],
      stateOverrides: refundableState,
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
        recoverRejectedSucceededPayment({ ...input, refundPayment: refundedTransport }),
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
})
