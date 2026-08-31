import { describe, expect, it } from 'vitest'

import {
  REFUND_INTENT_STATES,
  activeRefundOrderKey,
  canonicalRefundIntentRequestTuple,
  decideRefundIntentCreation,
  decideRefundIntentTransition,
  digestRefundIdempotencyKey,
  hashRefundIntentRequestV1,
  type RefundIntentState,
} from '@/lib/refund/refund-intent'

const request = {
  schemaVersion: 1,
  actorId: 'user-á',
  orderId: 'order-1',
  provider: 'barion',
  providerPaymentId: 'payment-1',
  providerTransactionId: 'transaction-1',
  refundSequence: 1,
  requestedAmountHuf: 12_345,
  currency: 'HUF',
  reason: 'Kért visszatérítés',
} as const

const hashA = 'a'.repeat(64)
const hashB = 'b'.repeat(64)
const keyA = 'c'.repeat(64)
const keyB = 'd'.repeat(64)
const keyC = 'e'.repeat(64)
const providerNoEffectEvidence = {
  kind: 'provider_confirmed_no_effect',
  confirmedAt: '2026-08-31T20:00:00.000Z',
  reference: 'barion-refund-state:transaction-1:no-effect',
} as const

describe('refund intent canonical request', () => {
  it('matches the V1 literal canonical tuple and known SHA-256 answers', () => {
    const knownRequest = {
      schemaVersion: 1,
      actorId: 'actor-1',
      orderId: 'order-1',
      provider: 'barion',
      providerPaymentId: 'payment-1',
      providerTransactionId: 'transaction-1',
      refundSequence: 1,
      requestedAmountHuf: 12_500,
      currency: 'HUF',
      reason: null,
    } as const
    const rawKey = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc'

    expect(JSON.stringify(canonicalRefundIntentRequestTuple(knownRequest))).toBe(
      '["kineticare/refund-intent/request/v1",1,"actor-1","order-1","barion","payment-1","transaction-1",1,12500,"HUF",null]',
    )
    expect(hashRefundIntentRequestV1(knownRequest)).toBe(
      'eb184d3c474f32eefa7b603883b197bea9590151583924ca188be14d2cc66116',
    )
    expect(digestRefundIdempotencyKey(rawKey)).toBe(
      'fdc731c466d569d1753ea8c2f490db3fa17fbe6796f27ca81a8f0e67d2f1b86f',
    )
    expect(activeRefundOrderKey('order-1', 'prepared')).toBe(
      'v1:10de8a0768b6f04f3ef11097f8a4d14adde8523fe2cbcdaa7c183a4fb42644a7',
    )
  })

  it('is stable across property order and NFC-equivalent strings', () => {
    const reordered = {
      reason: 'Ke\u0301rt visszate\u0301ri\u0301te\u0301s',
      currency: 'HUF',
      requestedAmountHuf: 12_345,
      refundSequence: 1,
      providerTransactionId: 'transaction-1',
      providerPaymentId: 'payment-1',
      provider: 'barion',
      orderId: 'order-1',
      actorId: 'user-a\u0301',
      schemaVersion: 1,
    }
    expect(hashRefundIntentRequestV1(reordered)).toBe(hashRefundIntentRequestV1(request))
    expect(canonicalRefundIntentRequestTuple(reordered)).toEqual(
      canonicalRefundIntentRequestTuple(request),
    )
  })

  it.each([
    ['schemaVersion', 2],
    ['actorId', 'user-2'],
    ['orderId', 'order-2'],
    ['provider', 'other'],
    ['providerPaymentId', 'payment-2'],
    ['providerTransactionId', 'transaction-2'],
    ['refundSequence', 2],
    ['requestedAmountHuf', 12_346],
    ['currency', 'EUR'],
    ['reason', 'Más ok'],
  ] as const)('binds %s into the request hash', (field, value) => {
    expect(() => hashRefundIntentRequestV1({ ...request, [field]: value })).toSatisfy(
      (run: () => string) => {
        try {
          return run() !== hashRefundIntentRequestV1(request)
        } catch {
          return true
        }
      },
    )
  })

  it.each([
    null,
    [],
    { ...request, unknown: true },
    { ...request, requestedAmountHuf: 0 },
    { ...request, requestedAmountHuf: 1.5 },
    { ...request, requestedAmountHuf: Number.NaN },
    { ...request, refundSequence: Number.MAX_SAFE_INTEGER + 1 },
    { ...request, orderId: '' },
    { ...request, actorId: ' spaced ' },
    { ...request, providerPaymentId: 'bad\nvalue' },
    { ...request, reason: 42 },
    { ...request, reason: 'x'.repeat(1_001) },
    { ...request, reason: 'bad\u0000reason' },
    { ...request, orderId: 'bad\ud800identifier' },
    { ...request, reason: 'bad\udcffreason' },
  ])('rejects malformed request %#', (value) => {
    expect(() => hashRefundIntentRequestV1(value)).toThrow(TypeError)
  })

  it('rejects distinct ill-formed Unicode strings before UTF-8 replacement can collide', () => {
    expect(() => hashRefundIntentRequestV1({ ...request, orderId: 'order-\ud800' })).toThrow(
      /well-formed Unicode/u,
    )
    expect(() => hashRefundIntentRequestV1({ ...request, orderId: 'order-\udc00' })).toThrow(
      /well-formed Unicode/u,
    )
  })

  it('fails closed for inherited required fields and custom request prototypes', () => {
    const inherited = Object.create(request) as Record<string, unknown>
    inherited.reason = request.reason
    expect(() => hashRefundIntentRequestV1(inherited)).toThrow(TypeError)

    const customPrototype = Object.create({}) as Record<string, unknown>
    Object.assign(customPrototype, request)
    expect(() => hashRefundIntentRequestV1(customPrototype)).toThrow(TypeError)
  })

  it('rejects symbol fields and accessor request fields', () => {
    const symbolField = Symbol('unexpected')
    expect(() => hashRefundIntentRequestV1({ ...request, [symbolField]: true })).toThrow(TypeError)

    const accessor = { ...request }
    Object.defineProperty(accessor, 'reason', {
      enumerable: true,
      get: () => request.reason,
    })
    expect(() => hashRefundIntentRequestV1(accessor)).toThrow(TypeError)
  })

  it('accepts only canonical raw 32-byte base64url keys and returns only a digest', () => {
    const rawKey = Buffer.alloc(32, 7).toString('base64url')
    const digest = digestRefundIdempotencyKey(rawKey)
    expect(digest).toMatch(/^[a-f0-9]{64}$/u)
    expect(digest).not.toContain(rawKey)
    for (const invalid of ['', `${rawKey}=`, rawKey.slice(1), 'a'.repeat(43), 7]) {
      expect(() => digestRefundIdempotencyKey(invalid)).toThrow(TypeError)
    }
  })
})

describe('refund intent transition graph', () => {
  const allowed = new Set([
    'prepared>provider_started',
    'provider_started>provider_failed',
    'provider_started>provider_unknown',
    'provider_started>provider_succeeded',
    'provider_unknown>manual_review',
    'provider_succeeded>committed',
    'manual_review>provider_failed',
    'manual_review>provider_succeeded',
  ])

  const decideTransition = (from: RefundIntentState, to: RefundIntentState) =>
    decideRefundIntentTransition(
      from,
      to,
      to === 'provider_failed' ? providerNoEffectEvidence : undefined,
    )

  it('implements the exhaustive 7x7 matrix with exactly one launch authorization', () => {
    let launches = 0
    for (const from of REFUND_INTENT_STATES) {
      for (const to of REFUND_INTENT_STATES) {
        const decision = decideTransition(from, to)
        expect(decision.allowed).toBe(allowed.has(`${from}>${to}`))
        const isLaunchEdge = from === 'prepared' && to === 'provider_started'
        if (decision.launchAllowed) launches += 1
        expect(decision.launchAllowed).toBe(isLaunchEdge)
        expect(decision.action).toBe(
          isLaunchEdge ? 'authorize_provider_launch' : decision.allowed ? 'transition' : 'none',
        )
      }
    }
    expect(launches).toBe(1)
  })

  it('proves every simple path contains at most one provider-launch authorization', () => {
    const walk = (
      state: RefundIntentState,
      visited: ReadonlySet<RefundIntentState>,
      launches: number,
    ) => {
      expect(launches).toBeLessThanOrEqual(1)
      for (const next of REFUND_INTENT_STATES) {
        const edge = decideTransition(state, next)
        if (!edge.allowed || visited.has(next)) continue
        walk(next, new Set([...visited, next]), launches + Number(edge.launchAllowed))
      }
    }
    for (const start of REFUND_INTENT_STATES) walk(start, new Set([start]), 0)
  })

  it('proves provider success cannot reach provider failure', () => {
    const reachable = (
      from: RefundIntentState,
      target: RefundIntentState,
      seen = new Set<RefundIntentState>(),
    ): boolean => {
      if (from === target) return true
      for (const next of REFUND_INTENT_STATES) {
        if (seen.has(next) || !decideTransition(from, next).allowed) continue
        if (reachable(next, target, new Set([...seen, next]))) return true
      }
      return false
    }

    expect(reachable('provider_succeeded', 'provider_failed')).toBe(false)
    expect(reachable('provider_succeeded', 'manual_review')).toBe(false)
    expect(decideRefundIntentTransition('provider_succeeded', 'manual_review')).toMatchObject({
      allowed: false,
    })
  })

  it('requires structured provider no-effect evidence before failure can release the lock', () => {
    expect(decideRefundIntentTransition('provider_started', 'provider_failed')).toEqual({
      allowed: false,
      launchAllowed: false,
      action: 'none',
      reason: 'provider_no_effect_evidence_required',
    })
    expect(
      decideRefundIntentTransition('provider_started', 'provider_failed', providerNoEffectEvidence),
    ).toEqual({
      allowed: true,
      launchAllowed: false,
      action: 'transition',
      persistence: {
        reconciliationCheckedAt: providerNoEffectEvidence.confirmedAt,
        reconciliationReference: providerNoEffectEvidence.reference,
      },
    })
    expect(
      decideRefundIntentTransition('manual_review', 'provider_failed', {
        ...providerNoEffectEvidence,
        confirmedAt: 'not-a-date',
      }),
    ).toMatchObject({
      allowed: false,
      reason: 'provider_no_effect_evidence_required',
    })
    expect(activeRefundOrderKey('order-1', 'provider_failed')).toMatch(/^v1:/u)
    expect(activeRefundOrderKey('order-1', 'provider_failed', providerNoEffectEvidence)).toBeNull()
  })
})

describe('refund intent creation decision', () => {
  const record = (state: RefundIntentState, overrides = {}) => ({
    orderId: 'order-1',
    state,
    requestHash: hashA,
    idempotencyKeyHash: keyA,
    refundSequence: 1,
    ...(state === 'provider_failed'
      ? {
          reconciliationCheckedAt: providerNoEffectEvidence.confirmedAt,
          reconciliationReference: providerNoEffectEvidence.reference,
        }
      : {}),
    ...overrides,
  })

  it.each(REFUND_INTENT_STATES)('replays same key and payload in %s without launch', (state) => {
    expect(
      decideRefundIntentCreation({
        orderId: 'order-1',
        requestHash: hashA,
        idempotencyKeyHash: keyA,
        refundSequence: 1,
        existingRecords: [record(state)],
      }),
    ).toMatchObject({ kind: 'replay', launchAllowed: false })
  })

  it.each(REFUND_INTENT_STATES)('conflicts same key and different payload in %s', (state) => {
    expect(
      decideRefundIntentCreation({
        orderId: 'order-1',
        requestHash: hashB,
        idempotencyKeyHash: keyA,
        refundSequence: 1,
        existingRecords: [record(state)],
      }),
    ).toEqual({ kind: 'conflict', launchAllowed: false, reason: 'key_payload_mismatch' })
  })

  it.each([
    'prepared',
    'provider_started',
    'provider_unknown',
    'provider_succeeded',
    'manual_review',
  ] as const)('blocks a different key while %s is unresolved', (state) => {
    expect(
      decideRefundIntentCreation({
        orderId: 'order-1',
        requestHash: hashB,
        idempotencyKeyHash: keyB,
        refundSequence: 1,
        existingRecords: [record(state)],
      }),
    ).toEqual({ kind: 'conflict', launchAllowed: false, reason: 'order_blocked' })
  })

  it('allows a new key after definitive provider failure for the same sequence', () => {
    expect(
      decideRefundIntentCreation({
        orderId: 'order-1',
        requestHash: hashB,
        idempotencyKeyHash: keyB,
        refundSequence: 1,
        existingRecords: [record('provider_failed')],
      }),
    ).toEqual({ kind: 'create', launchAllowed: false })
    expect(activeRefundOrderKey('order-1', 'provider_failed', providerNoEffectEvidence)).toBeNull()
  })

  it('fails closed when provider failure lacks complete persisted no-effect evidence', () => {
    const withoutEvidence = record('provider_failed')
    delete (withoutEvidence as { reconciliationCheckedAt?: string }).reconciliationCheckedAt
    delete (withoutEvidence as { reconciliationReference?: string }).reconciliationReference
    const partialEvidence = record('provider_failed')
    delete (partialEvidence as { reconciliationReference?: string }).reconciliationReference

    for (const failedRecord of [withoutEvidence, partialEvidence]) {
      expect(
        decideRefundIntentCreation({
          orderId: 'order-1',
          requestHash: hashB,
          idempotencyKeyHash: keyB,
          refundSequence: 1,
          existingRecords: [failedRecord],
        }),
      ).toEqual({
        kind: 'invariant_violation',
        launchAllowed: false,
        reason: 'corrupt_record',
      })
    }
  })

  it('does not reopen a confirmed-success intent for the same order', () => {
    expect(
      decideRefundIntentCreation({
        orderId: 'order-1',
        requestHash: hashB,
        idempotencyKeyHash: keyB,
        refundSequence: 1,
        existingRecords: [record('provider_succeeded')],
      }),
    ).toEqual({ kind: 'conflict', launchAllowed: false, reason: 'order_blocked' })
  })

  it('fails closed for corrupt, duplicate, and cross-order same-key data', () => {
    const decide = (existingRecords: readonly unknown[]) =>
      decideRefundIntentCreation({
        orderId: 'order-1',
        requestHash: hashA,
        idempotencyKeyHash: keyA,
        refundSequence: 1,
        existingRecords,
      })
    expect(decide([{ broken: true }])).toMatchObject({ kind: 'invariant_violation' })
    expect(decide([record('committed'), record('provider_failed')])).toMatchObject({
      kind: 'invariant_violation',
      reason: 'duplicate_key',
    })
    expect(
      decide([record('prepared'), record('provider_started', { idempotencyKeyHash: keyB })]),
    ).toMatchObject({ kind: 'invariant_violation', reason: 'multiple_unresolved_order' })
    expect(decide([record('committed', { orderId: 'order-2' })])).toEqual({
      kind: 'invariant_violation',
      launchAllowed: false,
      reason: 'key_order_mismatch',
    })
  })

  it('fails closed for inherited required fields and custom persisted record prototypes', () => {
    const inherited = Object.create(record('prepared'))
    expect(
      decideRefundIntentCreation({
        orderId: 'order-1',
        requestHash: hashA,
        idempotencyKeyHash: keyA,
        refundSequence: 1,
        existingRecords: [inherited],
      }),
    ).toMatchObject({ kind: 'invariant_violation', reason: 'corrupt_record' })

    const customPrototype = Object.assign(Object.create({}), record('prepared'))
    expect(
      decideRefundIntentCreation({
        orderId: 'order-1',
        requestHash: hashA,
        idempotencyKeyHash: keyA,
        refundSequence: 1,
        existingRecords: [customPrototype],
      }),
    ).toMatchObject({ kind: 'invariant_violation', reason: 'corrupt_record' })

    const accessor = record('prepared')
    Object.defineProperty(accessor, 'state', {
      enumerable: true,
      get: () => 'prepared',
    })
    expect(
      decideRefundIntentCreation({
        orderId: 'order-1',
        requestHash: hashA,
        idempotencyKeyHash: keyA,
        refundSequence: 1,
        existingRecords: [accessor],
      }),
    ).toMatchObject({ kind: 'invariant_violation', reason: 'corrupt_record' })
  })

  it('fails closed for malformed creation-decision input without throwing', () => {
    const validInput = {
      orderId: 'order-1',
      requestHash: hashA,
      idempotencyKeyHash: keyA,
      refundSequence: 1,
      existingRecords: [],
    }
    const decideInvalidInput = (value: unknown) => decideRefundIntentCreation(value as never)
    const customPrototype = Object.assign(Object.create({}), validInput)
    const missingRecords = {
      orderId: validInput.orderId,
      requestHash: validInput.requestHash,
      idempotencyKeyHash: validInput.idempotencyKeyHash,
    }
    const nonArrayRecords = { ...validInput, existingRecords: 'not-an-array' }
    const accessor = { ...validInput }
    Object.defineProperty(accessor, 'orderId', {
      enumerable: true,
      get: () => validInput.orderId,
    })

    for (const value of [customPrototype, missingRecords, nonArrayRecords, accessor]) {
      expect(() => decideInvalidInput(value)).not.toThrow()
      expect(decideInvalidInput(value)).toEqual({
        kind: 'invariant_violation',
        launchAllowed: false,
        reason: 'invalid_input',
      })
    }
  })

  it('treats NFC/NFD-equivalent persisted order IDs as one order', () => {
    const nfc = 'order-á'
    const nfd = 'order-a\u0301'
    const unresolved = record('provider_unknown', { orderId: nfd, idempotencyKeyHash: keyB })
    expect(
      decideRefundIntentCreation({
        orderId: nfc,
        requestHash: hashA,
        idempotencyKeyHash: keyA,
        refundSequence: 1,
        existingRecords: [unresolved],
      }),
    ).toEqual({ kind: 'conflict', launchAllowed: false, reason: 'order_blocked' })

    const replay = record('prepared', { orderId: nfd })
    expect(
      decideRefundIntentCreation({
        orderId: nfc,
        requestHash: hashA,
        idempotencyKeyHash: keyA,
        refundSequence: 1,
        existingRecords: [replay],
      }),
    ).toMatchObject({ kind: 'replay', record: { orderId: nfc } })
    expect(
      decideRefundIntentCreation({
        orderId: nfc,
        requestHash: hashB,
        idempotencyKeyHash: keyA,
        refundSequence: 1,
        existingRecords: [replay],
      }),
    ).toEqual({ kind: 'conflict', launchAllowed: false, reason: 'key_payload_mismatch' })
  })

  it('conflicts when the same sequence has already been committed under a new key', () => {
    expect(
      decideRefundIntentCreation({
        orderId: 'order-1',
        requestHash: hashB,
        idempotencyKeyHash: keyB,
        refundSequence: 1,
        existingRecords: [record('committed')],
      }),
    ).toEqual({ kind: 'conflict', launchAllowed: false, reason: 'sequence_already_committed' })
  })

  it('creates a new intent when a committed record has a different sequence', () => {
    expect(
      decideRefundIntentCreation({
        orderId: 'order-1',
        requestHash: hashB,
        idempotencyKeyHash: keyB,
        refundSequence: 2,
        existingRecords: [record('committed')],
      }),
    ).toEqual({ kind: 'create', launchAllowed: false })
  })

  it('prioritizes same-key payload mismatches before sequence mismatches', () => {
    expect(
      decideRefundIntentCreation({
        orderId: 'order-1',
        requestHash: hashB,
        idempotencyKeyHash: keyA,
        refundSequence: 2,
        existingRecords: [record('prepared')],
      }),
    ).toEqual({ kind: 'conflict', launchAllowed: false, reason: 'key_payload_mismatch' })
  })

  it('rejects a same-key replay whose sequence does not match its request hash', () => {
    expect(
      decideRefundIntentCreation({
        orderId: 'order-1',
        requestHash: hashA,
        idempotencyKeyHash: keyA,
        refundSequence: 2,
        existingRecords: [record('prepared')],
      }),
    ).toEqual({
      kind: 'invariant_violation',
      launchAllowed: false,
      reason: 'key_sequence_mismatch',
    })
  })

  it('fails closed when persisted or creation sequence data is missing or invalid', () => {
    const validInput = {
      orderId: 'order-1',
      requestHash: hashA,
      idempotencyKeyHash: keyA,
      refundSequence: 1,
      existingRecords: [],
    }
    const missingSequence = { ...validInput }
    delete (missingSequence as { refundSequence?: number }).refundSequence

    expect(
      decideRefundIntentCreation({
        ...validInput,
        existingRecords: [{ ...record('prepared'), refundSequence: 0 }],
      }),
    ).toEqual({ kind: 'invariant_violation', launchAllowed: false, reason: 'corrupt_record' })
    expect(
      decideRefundIntentCreation({
        ...validInput,
        existingRecords: [
          Object.fromEntries(
            Object.entries(record('prepared')).filter(([key]) => key !== 'refundSequence'),
          ),
        ],
      }),
    ).toEqual({ kind: 'invariant_violation', launchAllowed: false, reason: 'corrupt_record' })
    expect(decideRefundIntentCreation(missingSequence as never)).toEqual({
      kind: 'invariant_violation',
      launchAllowed: false,
      reason: 'invalid_input',
    })
    expect(decideRefundIntentCreation({ ...validInput, refundSequence: 0 })).toEqual({
      kind: 'invariant_violation',
      launchAllowed: false,
      reason: 'invalid_input',
    })
  })

  it('rejects duplicate committed records for the same order and sequence', () => {
    const duplicateCommitted = [
      record('committed'),
      record('committed', { idempotencyKeyHash: keyB, requestHash: hashB }),
    ]
    for (const [idempotencyKeyHash, requestHash] of [
      [keyA, hashA],
      [keyB, hashB],
      [keyC, hashB],
    ] as const) {
      expect(
        decideRefundIntentCreation({
          orderId: 'order-1',
          requestHash,
          idempotencyKeyHash,
          refundSequence: 1,
          existingRecords: duplicateCommitted,
        }),
      ).toEqual({
        kind: 'invariant_violation',
        launchAllowed: false,
        reason: 'duplicate_committed_sequence',
      })
    }
  })
})
