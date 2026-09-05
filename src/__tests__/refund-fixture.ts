import type { Payload } from 'payload'
import { afterEach, beforeEach, expect, vi } from 'vitest'
import type { Order, RefundIntent, User } from '../payload-types'
import { refundOrder } from '../lib/refund/refund-order'
import { getRefundRecoveryStatus, recoverRefundOrder } from '../lib/refund/refund-recovery'
import type { RefundAccessBaseline } from '../lib/refund/access-store'
import { RECEIPTS, readReceipt, writeReceipt } from '../lib/refund/recovery-receipts'

const store = vi.hoisted(() => ({
  intents: new Map<unknown, RefundIntent>(),
  history: new Map<unknown, RefundIntent[]>(),
  keys: new Map<unknown, Set<string>>(),
  operations: new Map<unknown, Map<string, number>>(),
}))
vi.mock('../lib/refund/intent-store', () => ({
  loadRefundIntentsForOrder: async (payload: unknown) => {
    const history = store.history.get(payload) ?? []
    const latest = store.intents.get(payload)
    return structuredClone(
      latest && !history.some((item) => item.id === latest.id) ? [...history, latest] : history,
    )
  },
  loadRefundIntentForOperation: async (payload: unknown, _orderId: number, key: string) => {
    const id = store.operations.get(payload)?.get(key)
    if (id === undefined) return null
    const intent = store.intents.get(payload)
    return structuredClone(
      intent?.id === id ? intent : store.history.get(payload)?.find((item) => item.id === id),
    )
  },
  loadActiveRefundIntent: async (payload: unknown) => {
    const intent = store.intents.get(payload)
    return intent?.activeOrderKey ? structuredClone(intent) : null
  },
  createRefundIntent: async (
    payload: unknown,
    request: Record<string, unknown>,
    operationKey: string,
  ) => {
    if (store.intents.get(payload)?.activeOrderKey) throw new Error('active intent')
    const keys = store.keys.get(payload) ?? new Set<string>()
    if (keys.has(operationKey)) throw new Error('operation key replay')
    keys.add(operationKey)
    store.keys.set(payload, keys)
    const intent = {
      ...request,
      id: 81 + (store.history.get(payload)?.length ?? 0),
      order: Number(request.orderId),
      actor: Number(request.actorId),
      state: 'prepared',
      activeOrderKey: 'SYNTHETIC-ACTIVE',
      requestHash: 'a'.repeat(64),
      createdAt: '2026-09-05T10:00:00.000Z',
      updatedAt: '2026-09-05T10:00:00.000Z',
    } as unknown as RefundIntent
    store.intents.set(payload, intent)
    const operations = store.operations.get(payload) ?? new Map<string, number>()
    operations.set(operationKey, intent.id)
    store.operations.set(payload, operations)
    return structuredClone(intent)
  },
  transitionRefundIntent: async (
    payload: unknown,
    expected: RefundIntent,
    state: RefundIntent['state'],
  ) => {
    const current = store.intents.get(payload)!
    if (current.state !== expected.state) throw new Error('CAS conflict')
    const intent = {
      ...current,
      state,
      activeOrderKey: state === 'committed' ? null : current.activeOrderKey,
      ...(state === 'provider_started' ? { providerStartedAt: '2026-09-05T10:00:01.000Z' } : {}),
      ...(state === 'provider_succeeded' ? { providerResolvedAt: '2026-09-05T10:00:02.000Z' } : {}),
    }
    store.intents.set(payload, intent)
    if (state === 'committed')
      store.history.set(payload, [...(store.history.get(payload) ?? []), structuredClone(intent)])
    return structuredClone(intent)
  },
}))

const locks = vi.hoisted(() => ({
  held: [] as string[],
  events: [] as string[],
  beforeOrder: null as null | (() => void),
  tails: new Map<string, Promise<void>>(),
}))
vi.mock('../lib/advisory-lock', () => ({
  withAdvisoryLock: async (_p: unknown, key: string, fn: () => Promise<unknown>) => {
    const previous = locks.tails.get(key) ?? Promise.resolve()
    let release!: () => void
    const next = new Promise<void>((resolve) => {
      release = resolve
    })
    locks.tails.set(
      key,
      previous.then(() => next),
    )
    await previous
    if (key.startsWith('refund:order:') && locks.beforeOrder) {
      const before = locks.beforeOrder
      locks.beforeOrder = null
      before()
    }
    locks.held.push(key)
    locks.events.push(key)
    try {
      return await fn()
    } finally {
      locks.held.splice(locks.held.lastIndexOf(key), 1)
      release()
    }
  },
}))
const provider = vi.hoisted(() => ({ refund: vi.fn(), state: vi.fn() }))
vi.mock('../lib/barion', async (original) => ({
  ...(await original<typeof import('../lib/barion')>()),
  refundPayment: provider.refund,
  fetchPaymentState: provider.state,
}))
const documents = vi.hoisted(() => ({ storno: vi.fn(), corrective: vi.fn(), queue: vi.fn() }))
const access = vi.hoisted(() => ({ read: vi.fn(), apply: vi.fn() }))
vi.mock('../lib/refund/access-store', () => ({
  readRefundAccessBaseline: access.read,
  applyRefundAccessCleanup: access.apply,
}))
vi.mock('../lib/szamlazz', () => ({
  issueStornoForOrder: documents.storno,
  issueCorrectiveInvoiceForOrder: documents.corrective,
  queueCorrectiveInvoiceJob: documents.queue,
  isRetryableStornoError: () => false,
  isRetryableCorrectiveError: () => false,
}))

interface Audit {
  id: number
  action: string
  entityType: string
  entityId: string
  after: unknown
}
export async function claimInvoice(payload: Payload, kind: 'storno' | 'corrective') {
  const intent = store.intents.get(payload)!
  if (await readReceipt(payload, intent, RECEIPTS.invoiceStarted))
    throw new Error('SYNTHETIC existing invoice claim')
  await writeReceipt(payload, intent, RECEIPTS.invoiceStarted, {
    version: 1,
    kind,
    sequence: intent.refundSequence,
  })
}
export function fixture() {
  const order = {
    id: 11,
    orderNumber: 'SYNTHETIC-RECOVERY-11',
    status: 'paid',
    amount: 20000,
    totalHufSnapshot: 20000,
    barionPaymentId: 'SYNTHETIC-PAYMENT',
    customer: 7,
    items: [{ product: 42, quantity: 1 }],
    refunds: [],
    invoiceNumber: 'SYNTHETIC-INV',
  } as unknown as Order
  const user = {
    id: 7,
    purchases: [42, 99],
    accessGrants: [],
    updatedAt: '2026-09-05T09:00:00.000Z',
  } as unknown as User
  const audits: Audit[] = []
  const relations = new Map([
    [42, 1],
    [99, 2],
  ])
  let nextRelation = 3
  const failures = {
    order: false,
    user: false,
    receipt: '',
    receiptAfterWrite: false,
    otherPaid: false,
    orderNoop: false,
    userNoop: false,
  }
  const payload = {
    auth: vi.fn(async () => ({ user: { id: 1, role: 'owner' } })),
    find: vi.fn(
      async (args: {
        collection: string
        where?: { and?: Array<Record<string, { equals?: unknown }>> }
      }) => {
        if (args.collection === 'refund-intents') {
          const docs = store.history.get(payload) ?? []
          return { docs: structuredClone(docs), totalDocs: docs.length, hasNextPage: false }
        }
        if (args.collection === 'audit-logs') {
          const docs = audits.filter((audit) =>
            (args.where?.and ?? []).every((condition) =>
              Object.entries(condition).every(
                ([key, value]) => audit[key as keyof Audit] === value.equals,
              ),
            ),
          )
          return { docs: structuredClone(docs), totalDocs: docs.length, hasNextPage: false }
        }
        if (args.where?.and)
          return {
            docs: failures.otherPaid ? [{ id: 90 }] : [],
            totalDocs: failures.otherPaid ? 1 : 0,
            hasNextPage: false,
          }
        return { docs: [structuredClone(order)], totalDocs: 1, hasNextPage: false }
      },
    ),
    findByID: vi.fn(async ({ collection }: { collection: string }) =>
      structuredClone(collection === 'users' ? user : order),
    ),
    update: vi.fn(
      async ({ collection, data }: { collection: string; data: Record<string, unknown> }) => {
        if (collection === 'orders' && failures.order) throw new Error('SYNTHETIC storage failure')
        if (collection === 'users' && failures.user) throw new Error('SYNTHETIC storage failure')
        if (
          (collection === 'orders' && failures.orderNoop) ||
          (collection === 'users' && failures.userNoop)
        )
          return structuredClone(data)
        Object.assign(collection === 'users' ? user : order, structuredClone(data))
        if (collection === 'users') user.updatedAt = '2026-09-05T10:00:03.000Z'
        return structuredClone(collection === 'users' ? user : order)
      },
    ),
    create: vi.fn(async ({ data }: { data: Omit<Audit, 'id'> }) => {
      const fail = failures.receipt === data.action
      if (fail && !failures.receiptAfterWrite) throw new Error('SYNTHETIC receipt failure')
      const audit = { id: audits.length + 1, ...structuredClone(data) }
      audits.push(audit)
      if (fail) throw new Error('SYNTHETIC lost acknowledgement')
      return audit
    }),
  } as unknown as Payload
  const capture = (ids: readonly number[]): RefundAccessBaseline => {
    const owned = (user.purchases ?? []) as number[]
    for (const key of relations.keys()) if (!owned.includes(key)) relations.delete(key)
    for (const key of owned) if (!relations.has(key)) relations.set(key, nextRelation++)
    return {
      version: 1,
      customerId: user.id,
      productIds: [...ids],
      purchases: owned
        .filter((key) => ids.includes(key))
        .map((productId) => ({ id: relations.get(productId)!, productId })),
      grantProductIds: (user.accessGrants ?? [])
        .map((row) => Number(row.product))
        .filter((id) => ids.includes(id)),
      grantsFingerprint: 'b'.repeat(64),
      grantProof: 'absence-only',
    }
  }
  access.read.mockImplementation(async (_payload: Payload, _id: number, ids: readonly number[]) =>
    capture(ids),
  )
  access.apply.mockImplementation(
    async (
      _payload: Payload,
      input: {
        intent: RefundIntent
        baseline: RefundAccessBaseline
        productIds: readonly number[]
      },
    ) => {
      expect(locks.held).toContain('purchases:user:7')
      const current = capture(input.productIds)
      const original = input.baseline
      if (failures.user || failures.userNoop) return { status: 'manual_review' }
      if (
        !failures.otherPaid &&
        (current.grantProductIds.length ||
          original.grantProductIds.length ||
          current.purchases.some(
            (row) =>
              !original.purchases.some(
                (before) => before.id === row.id && before.productId === row.productId,
              ),
          ))
      )
        return { status: 'manual_review' }
      const before = structuredClone(user)
      const oldRelations = new Map(relations)
      try {
        if (!failures.otherPaid) {
          user.purchases = (user.purchases as number[]).filter(
            (id) => !input.productIds.includes(id),
          )
          input.productIds.forEach((id) => relations.delete(id))
        }
        await payload.create({
          collection: 'audit-logs',
          data: {
            actor: 1,
            action: 'refund-cleanup-done',
            entityType: 'refund-intents',
            entityId: String(input.intent.id),
            after: {
              version: 1,
              intentId: input.intent.id,
              orderId: 11,
              sequence: input.intent.refundSequence,
              requestFingerprint: input.intent.requestHash,
              completed: true,
              reason: 'resolved',
              cleanupKind: 'sql-access-v1',
            },
          },
          overrideAccess: true,
        })
        return { status: 'completed' }
      } catch {
        if (!failures.receiptAfterWrite) {
          Object.assign(user, before)
          relations.clear()
          oldRelations.forEach((value, key) => relations.set(key, value))
        }
        return { status: 'manual_review' }
      }
    },
  )
  const actor = { id: 1, role: 'owner' } as User
  provider.state.mockResolvedValue({
    PaymentId: order.barionPaymentId,
    Transactions: [
      {
        TransactionId: 'SYNTHETIC-TX',
        POSTransactionId: 'SYNTHETIC-ORIGINAL-POS',
        TransactionType: 'CardPayment',
        Status: 'Succeeded',
        Total: 20000,
      },
    ],
  })
  provider.refund.mockImplementation(
    async (input: {
      transactionsToRefund: Array<{ amountToRefund: number; posTransactionId: string }>
    }) => {
      expect(store.intents.get(payload)?.state).toBe('provider_started')
      expect(input.transactionsToRefund[0].posTransactionId).toBe('SYNTHETIC-ORIGINAL-POS')
      expect(audits.some((audit) => audit.action === 'refund-prepared')).toBe(true)
      return {
        PaymentId: order.barionPaymentId,
        RefundedTransactions: [
          {
            TransactionId: 'SYNTHETIC-TX',
            Total: input.transactionsToRefund[0].amountToRefund,
            Status: 'Refunded',
          },
        ],
        Errors: [],
      }
    },
  )
  documents.storno.mockImplementation(async () => {
    await claimInvoice(payload, 'storno')
    Object.assign(order, { stornoStatus: 'storned', stornoNumber: 'SYNTHETIC-ST' })
    return { outcome: 'storned', stornoNumber: 'SYNTHETIC-ST' }
  })
  documents.corrective.mockImplementation(async (_order: Order, deps: { refundSeq: number }) => {
    await claimInvoice(payload, 'corrective')
    Object.assign(order, {
      correctiveInvoiceStatus: 'issued',
      correctiveInvoiceNumber: 'SYNTHETIC-HE',
      correctiveInvoiceSeq: deps.refundSeq,
    })
    return { outcome: 'issued', correctiveInvoiceNumber: 'SYNTHETIC-HE' }
  })
  const options = { payload, orderNumber: order.orderNumber!, actor }
  return {
    order,
    user,
    audits,
    failures,
    payload,
    options,
    regrant: () => {
      user.purchases = [...new Set([...(user.purchases as number[]), 42])]
      relations.set(42, nextRelation++)
    },
    start: (input: { amountHuf?: unknown; reason?: unknown; operationKey?: unknown } = {}) =>
      refundOrder({ ...options, input: { operationKey: 'A'.repeat(43), ...input } }),
    recover: () => recoverRefundOrder(options),
    status: () => getRefundRecoveryStatus(options),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  store.intents.clear()
  store.history.clear()
  store.keys.clear()
  store.operations.clear()
  locks.held = []
  locks.events = []
  locks.beforeOrder = null
  locks.tails.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('UNEXPECTED NETWORK')
    }),
  )
  vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://shop.example.test')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

export { store, locks, provider, documents, access }
