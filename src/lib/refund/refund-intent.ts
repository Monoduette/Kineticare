import { createHash } from 'node:crypto'

export const REFUND_INTENT_SCHEMA_VERSION = 1 as const
export const REFUND_INTENT_HASH_ALGORITHM = 'sha256' as const
export const REFUND_INTENT_HASH_ENCODING = 'hex' as const
export const REFUND_INTENT_PROVIDER = 'barion' as const
export const REFUND_INTENT_CURRENCY = 'HUF' as const
export const REFUND_INTENT_REQUEST_DOMAIN = 'kineticare/refund-intent/request/v1' as const
export const REFUND_INTENT_KEY_DOMAIN = 'kineticare/refund-intent/idempotency-key/v1' as const
export const REFUND_INTENT_ACTIVE_ORDER_DOMAIN = 'kineticare/refund-intent/active-order/v1' as const

export const REFUND_INTENT_STATES = [
  'prepared',
  'provider_started',
  'provider_failed',
  'provider_unknown',
  'provider_succeeded',
  'committed',
  'manual_review',
] as const

export type RefundIntentState = (typeof REFUND_INTENT_STATES)[number]

export const REFUND_INTENT_UNRESOLVED_STATES = [
  'prepared',
  'provider_started',
  'provider_failed',
  'provider_unknown',
  'provider_succeeded',
  'manual_review',
] as const satisfies readonly RefundIntentState[]

export const REFUND_INTENT_RESOLVED_STATES = [
  'committed',
] as const satisfies readonly RefundIntentState[]

const STATE_SET = new Set<string>(REFUND_INTENT_STATES)
const UNRESOLVED_STATE_SET = new Set<string>(REFUND_INTENT_UNRESOLVED_STATES)
const IDENTIFIER_MAX_LENGTH = 256
const REASON_MAX_LENGTH = 1_000
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u
const BASE64URL_32_BYTES = /^[A-Za-z0-9_-]{43}$/u
const PROVIDER_NO_EFFECT_EVIDENCE_KEYS = new Set(['kind', 'confirmedAt', 'reference'])

/**
 * A prepared → provider_failed él egyetlen megengedett bizonyítéka: a
 * provider_started CAS (az indítási engedély) sosem futott le, tehát a
 * Barionnak kérés sem mehetett. Fordítva is kötött: elindított kísérletre ez a
 * hivatkozás nem használható, így a providerStartedAt nélküli provider_failed
 * sor mindig ezt a hivatkozást hordozza.
 */
export const NO_PROVIDER_REQUEST_REFERENCE = 'kineticare:no-provider-request' as const

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasOwn(record: object, key: string): boolean {
  return Object.hasOwn(record, key)
}

function hasOwnDataProperties(record: object, keys: readonly string[]): boolean {
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(record, key)
    return descriptor !== undefined && 'value' in descriptor
  })
}

export type RefundIntentRequestV1 = {
  schemaVersion: 1
  actorId: string
  orderId: string
  provider: 'barion'
  providerPaymentId: string
  providerTransactionId: string
  refundSequence: number
  requestedAmountHuf: number
  currency: 'HUF'
  reason?: string | null
}

export type RefundIntentActorIdentity =
  | { actorKind: 'owner'; actorId: number; systemActor: null }
  | { actorKind: 'system'; actorId: null; systemActor: 'paid-reject-recovery' }

/** V1 owner sorok változatlanul olvashatók; V2 rendszereredethez nincs hamis user FK. */
export function parseRefundIntentActorIdentity(input: {
  schemaVersion: unknown
  actor: unknown
  actorKind?: unknown
  systemActor?: unknown
}): RefundIntentActorIdentity {
  const actor = isPlainRecord(input.actor) ? input.actor.id : input.actor
  const isOwner = Number.isSafeInteger(actor) && typeof actor === 'number' && actor > 0
  if (
    ((input.schemaVersion === 1 && (input.actorKind == null || input.actorKind === 'owner')) ||
      (input.schemaVersion === 2 && input.actorKind === 'owner')) &&
    isOwner &&
    input.systemActor == null
  ) {
    return { actorKind: 'owner', actorId: actor as number, systemActor: null }
  }
  if (
    input.schemaVersion === 2 &&
    input.actorKind === 'system' &&
    input.actor == null &&
    input.systemActor === 'paid-reject-recovery'
  ) {
    return { actorKind: 'system', actorId: null, systemActor: 'paid-reject-recovery' }
  }
  throw new TypeError('Invalid refund intent actor identity')
}

export type CanonicalRefundIntentRequestV1 = Omit<RefundIntentRequestV1, 'reason'> & {
  reason: string | null
}

export type CanonicalRefundIntentRequestV2 = Omit<
  CanonicalRefundIntentRequestV1,
  'schemaVersion' | 'actorId'
> & {
  schemaVersion: 2
} & (
    | { actorId: null; actorKind: 'system'; systemActor: 'paid-reject-recovery' }
    | { actorId: string; actorKind: 'owner'; systemActor: null }
  )
export type CanonicalRefundIntentRequest =
  CanonicalRefundIntentRequestV1 | CanonicalRefundIntentRequestV2

const REQUEST_KEYS = new Set<keyof RefundIntentRequestV1>([
  'schemaVersion',
  'actorId',
  'orderId',
  'provider',
  'providerPaymentId',
  'providerTransactionId',
  'refundSequence',
  'requestedAmountHuf',
  'currency',
  'reason',
])

function sha256(value: string | Uint8Array): string {
  return createHash(REFUND_INTENT_HASH_ALGORITHM).update(value).digest(REFUND_INTENT_HASH_ENCODING)
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) return false
      index += 1
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false
    }
  }
  return true
}

function strictIdentifier(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(
      `${name} must be a non-empty identifier of at most ${IDENTIFIER_MAX_LENGTH} characters`,
    )
  }
  if (!isWellFormedUnicode(value)) {
    throw new TypeError(`${name} must contain well-formed Unicode`)
  }
  const normalized = value.normalize('NFC')
  if (normalized.length === 0 || normalized.length > IDENTIFIER_MAX_LENGTH) {
    throw new TypeError(
      `${name} must be a non-empty identifier of at most ${IDENTIFIER_MAX_LENGTH} characters`,
    )
  }
  if (normalized !== normalized.trim() || CONTROL_CHARACTERS.test(normalized)) {
    throw new TypeError(`${name} must be canonical and contain no control characters`)
  }
  return normalized
}

function positiveSafeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || Object.is(value, -0)) {
    throw new TypeError(`${name} must be a positive safe integer`)
  }
  return value as number
}

export type RefundIntentProviderNoEffectEvidence = {
  kind: 'provider_confirmed_no_effect'
  confirmedAt: string
  reference: string
}

export type RefundIntentProviderNoEffectPersistence = {
  reconciliationCheckedAt: string
  reconciliationReference: string
}

function providerNoEffectPersistence(
  value: unknown,
): RefundIntentProviderNoEffectPersistence | null {
  if (!isPlainRecord(value)) return null
  for (const key of Reflect.ownKeys(value)) {
    if (
      typeof key !== 'string' ||
      !PROVIDER_NO_EFFECT_EVIDENCE_KEYS.has(key) ||
      !hasOwnDataProperties(value, [key])
    ) {
      return null
    }
  }
  if (
    !hasOwnDataProperties(value, ['kind', 'confirmedAt', 'reference']) ||
    value.kind !== 'provider_confirmed_no_effect' ||
    typeof value.confirmedAt !== 'string'
  ) {
    return null
  }
  const confirmedAtMs = Date.parse(value.confirmedAt)
  if (Number.isNaN(confirmedAtMs) || new Date(confirmedAtMs).toISOString() !== value.confirmedAt) {
    return null
  }
  let reference: string
  try {
    reference = strictIdentifier(value.reference, 'provider no-effect reference')
  } catch {
    return null
  }
  return {
    reconciliationCheckedAt: value.confirmedAt,
    reconciliationReference: reference,
  }
}

export function normalizeRefundReason(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new TypeError('reason must be a string or null')
  if (!isWellFormedUnicode(value)) {
    throw new TypeError('reason must contain well-formed Unicode')
  }
  const normalized = value.trim().normalize('NFC')
  if (normalized.length === 0) return null
  if (normalized.length > REASON_MAX_LENGTH) {
    throw new TypeError(`reason must be at most ${REASON_MAX_LENGTH} characters`)
  }
  if (CONTROL_CHARACTERS.test(normalized)) {
    throw new TypeError('reason must contain no control characters')
  }
  return normalized
}

export function validateRefundIntentRequestV1(input: unknown): CanonicalRefundIntentRequestV1 {
  if (!isPlainRecord(input)) {
    throw new TypeError('refund intent request must be an object')
  }
  const record = input
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== 'string') {
      throw new TypeError('refund intent request fields must have string names')
    }
    if (!REQUEST_KEYS.has(key as keyof RefundIntentRequestV1)) {
      throw new TypeError(`unknown refund intent request field: ${key}`)
    }
    if (!hasOwnDataProperties(record, [key])) {
      throw new TypeError(`refund intent request field must be an own data property: ${key}`)
    }
  }
  for (const key of REQUEST_KEYS) {
    if (key !== 'reason' && !hasOwnDataProperties(record, [key])) {
      throw new TypeError(`missing refund intent request field: ${key}`)
    }
  }
  if (record.schemaVersion !== REFUND_INTENT_SCHEMA_VERSION)
    throw new TypeError('unsupported schemaVersion')
  if (record.provider !== REFUND_INTENT_PROVIDER) throw new TypeError('unsupported provider')
  if (record.currency !== REFUND_INTENT_CURRENCY) throw new TypeError('unsupported currency')

  return {
    schemaVersion: REFUND_INTENT_SCHEMA_VERSION,
    actorId: strictIdentifier(record.actorId, 'actorId'),
    orderId: strictIdentifier(record.orderId, 'orderId'),
    provider: REFUND_INTENT_PROVIDER,
    providerPaymentId: strictIdentifier(record.providerPaymentId, 'providerPaymentId'),
    providerTransactionId: strictIdentifier(record.providerTransactionId, 'providerTransactionId'),
    refundSequence: positiveSafeInteger(record.refundSequence, 'refundSequence'),
    requestedAmountHuf: positiveSafeInteger(record.requestedAmountHuf, 'requestedAmountHuf'),
    currency: REFUND_INTENT_CURRENCY,
    reason: normalizeRefundReason(hasOwn(record, 'reason') ? record.reason : undefined),
  }
}

export function canonicalRefundIntentRequestTuple(input: unknown): readonly unknown[] {
  const request = validateRefundIntentRequestV1(input)
  return [
    REFUND_INTENT_REQUEST_DOMAIN,
    request.schemaVersion,
    request.actorId,
    request.orderId,
    request.provider,
    request.providerPaymentId,
    request.providerTransactionId,
    request.refundSequence,
    request.requestedAmountHuf,
    request.currency,
    request.reason,
  ] as const
}

export function hashRefundIntentRequestV1(input: unknown): string {
  return sha256(JSON.stringify(canonicalRefundIntentRequestTuple(input)))
}

/** Separate hash domain keeps all existing V1 owner fingerprints byte compatible. */
export function validateRefundIntentRequest(input: unknown): CanonicalRefundIntentRequest {
  if (
    !isPlainRecord(input) ||
    !hasOwnDataProperties(input, ['schemaVersion']) ||
    input.schemaVersion !== 2
  )
    return validateRefundIntentRequestV1(input)
  for (const key of Reflect.ownKeys(input)) {
    if (
      typeof key !== 'string' ||
      (!REQUEST_KEYS.has(key as keyof RefundIntentRequestV1) &&
        !['actorKind', 'systemActor'].includes(key)) ||
      !hasOwnDataProperties(input, [key])
    )
      throw new TypeError('Invalid refund intent V2 fields')
  }
  if (!hasOwnDataProperties(input, ['actorId', 'actorKind', 'systemActor']))
    throw new TypeError('Missing refund intent V2 identity')
  const actor =
    typeof input.actorId === 'string' && /^[1-9][0-9]*$/u.test(input.actorId)
      ? Number(input.actorId)
      : input.actorId
  const identity = parseRefundIntentActorIdentity({
    schemaVersion: 2,
    actor,
    actorKind: input.actorKind,
    systemActor: input.systemActor,
  })
  if (
    identity.actorKind === 'owner' &&
    (typeof input.actorId !== 'string' || String(identity.actorId) !== input.actorId)
  )
    throw new TypeError('Noncanonical refund intent owner identity')
  const shared = Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== 'actorKind' && key !== 'systemActor'),
  )
  const fields = validateRefundIntentRequestV1({ ...shared, schemaVersion: 1, actorId: 'system' })
  return identity.actorKind === 'system'
    ? {
        ...fields,
        schemaVersion: 2,
        actorId: null,
        actorKind: 'system',
        systemActor: 'paid-reject-recovery',
      }
    : {
        ...fields,
        schemaVersion: 2,
        actorId: String(identity.actorId),
        actorKind: 'owner',
        systemActor: null,
      }
}

export function hashRefundIntentRequest(input: unknown): string {
  const request = validateRefundIntentRequest(input)
  if (request.schemaVersion === 1) return hashRefundIntentRequestV1(request)
  return sha256(
    JSON.stringify([
      'kineticare/refund-intent/request/v2',
      request.schemaVersion,
      request.actorKind,
      request.actorId,
      request.systemActor,
      request.orderId,
      request.provider,
      request.providerPaymentId,
      request.providerTransactionId,
      request.refundSequence,
      request.requestedAmountHuf,
      request.currency,
      request.reason,
    ]),
  )
}

/**
 * Application identity only: Barion does not promise provider idempotency for this key.
 * Az első kísérlet kulcsa változatlan (a korábbi sorokkal bájtra egyező); egy
 * igazoltan hatástalan kísérlet után az újabb kísérlet a sorszámától kap új kulcsot.
 */
export function autoRefundOperationKey(input: {
  orderId: number
  paymentId: string
  transactionId: string
  reason: string
  attempt?: number
}): string {
  const attempt = input.attempt === undefined ? 1 : positiveSafeInteger(input.attempt, 'attempt')
  return createHash('sha256')
    .update(
      JSON.stringify([
        'kineticare/paid-reject-recovery/operation/v2',
        positiveSafeInteger(input.orderId, 'orderId'),
        strictIdentifier(input.paymentId, 'paymentId'),
        strictIdentifier(input.transactionId, 'transactionId'),
        strictIdentifier(input.reason, 'reason'),
        ...(attempt === 1 ? [] : [attempt]),
      ]),
    )
    .digest('base64url')
}

export function digestRefundIdempotencyKey(key: unknown): string {
  if (typeof key !== 'string' || !BASE64URL_32_BYTES.test(key)) {
    throw new TypeError('idempotency key must be an unpadded 32-byte base64url value')
  }
  const decoded = Buffer.from(key, 'base64url')
  if (decoded.length !== 32 || decoded.toString('base64url') !== key) {
    throw new TypeError('idempotency key must be a canonical 32-byte base64url value')
  }
  return sha256(`${REFUND_INTENT_KEY_DOMAIN}\u0000${key}`)
}

export function isRefundIntentState(value: unknown): value is RefundIntentState {
  return typeof value === 'string' && STATE_SET.has(value)
}

export function isRefundIntentUnresolved(
  state: RefundIntentState,
  providerNoEffectEvidence?: RefundIntentProviderNoEffectEvidence,
): boolean {
  if (state === 'provider_failed') {
    return providerNoEffectPersistence(providerNoEffectEvidence) === null
  }
  return UNRESOLVED_STATE_SET.has(state)
}

export function activeRefundOrderKey(
  orderId: unknown,
  state: RefundIntentState,
  providerNoEffectEvidence?: RefundIntentProviderNoEffectEvidence,
): string | null {
  const validatedOrderId = strictIdentifier(orderId, 'orderId')
  if (!isRefundIntentState(state)) throw new TypeError('invalid refund intent state')
  return isRefundIntentUnresolved(state, providerNoEffectEvidence)
    ? `v1:${sha256(`${REFUND_INTENT_ACTIVE_ORDER_DOMAIN}\u0000${validatedOrderId}`)}`
    : null
}

const ALLOWED_TRANSITIONS: Readonly<Record<RefundIntentState, readonly RefundIntentState[]>> = {
  prepared: ['provider_started', 'provider_failed'],
  provider_started: ['provider_failed', 'provider_unknown', 'provider_succeeded'],
  provider_failed: [],
  provider_unknown: ['manual_review'],
  provider_succeeded: ['committed'],
  committed: [],
  manual_review: ['provider_failed', 'provider_succeeded'],
}

export type RefundIntentTransitionDecision = {
  allowed: boolean
  launchAllowed: boolean
  action: 'transition' | 'authorize_provider_launch' | 'none'
  reason?: 'provider_no_effect_evidence_required'
  persistence?: RefundIntentProviderNoEffectPersistence
}

export function decideRefundIntentTransition(
  from: RefundIntentState,
  to: RefundIntentState,
  providerNoEffectEvidence?: RefundIntentProviderNoEffectEvidence,
): RefundIntentTransitionDecision {
  if (!isRefundIntentState(from) || !isRefundIntentState(to) || from === to) {
    return { allowed: false, launchAllowed: false, action: 'none' }
  }
  const allowed = ALLOWED_TRANSITIONS[from].includes(to)
  if (!allowed) return { allowed: false, launchAllowed: false, action: 'none' }
  if (from === 'prepared' && to === 'provider_started') {
    return { allowed: true, launchAllowed: true, action: 'authorize_provider_launch' }
  }
  if (to === 'provider_failed') {
    const persistence = providerNoEffectPersistence(providerNoEffectEvidence)
    if (
      !persistence ||
      (from === 'prepared') !==
        (persistence.reconciliationReference === NO_PROVIDER_REQUEST_REFERENCE)
    ) {
      return {
        allowed: false,
        launchAllowed: false,
        action: 'none',
        reason: 'provider_no_effect_evidence_required',
      }
    }
    return { allowed: true, launchAllowed: false, action: 'transition', persistence }
  }
  return { allowed: true, launchAllowed: false, action: 'transition' }
}

export type RefundIntentDecisionRecord = {
  orderId: string
  state: RefundIntentState
  requestHash: string
  idempotencyKeyHash: string
  refundSequence: number
  reconciliationCheckedAt?: string
  reconciliationReference?: string
}

export type RefundIntentCreationDecision =
  | { kind: 'create'; launchAllowed: false }
  | { kind: 'replay'; launchAllowed: false; record: RefundIntentDecisionRecord }
  | {
      kind: 'conflict'
      launchAllowed: false
      reason: 'key_payload_mismatch' | 'order_blocked' | 'sequence_already_committed'
    }
  | { kind: 'invariant_violation'; launchAllowed: false; reason: string }

const SHA256_HEX = /^[a-f0-9]{64}$/u

function parseDecisionRecord(value: unknown): RefundIntentDecisionRecord | null {
  if (!isPlainRecord(value)) return null
  const record = value
  if (
    !hasOwnDataProperties(record, [
      'state',
      'orderId',
      'requestHash',
      'idempotencyKeyHash',
      'refundSequence',
    ]) ||
    !isRefundIntentState(record.state) ||
    typeof record.orderId !== 'string' ||
    record.orderId.length === 0 ||
    typeof record.requestHash !== 'string' ||
    !SHA256_HEX.test(record.requestHash) ||
    typeof record.idempotencyKeyHash !== 'string' ||
    !SHA256_HEX.test(record.idempotencyKeyHash)
  )
    return null
  let orderId: string
  let refundSequence: number
  try {
    orderId = strictIdentifier(record.orderId, 'orderId')
    refundSequence = positiveSafeInteger(record.refundSequence, 'refundSequence')
  } catch {
    return null
  }
  const parsed: RefundIntentDecisionRecord = {
    orderId,
    state: record.state,
    requestHash: record.requestHash,
    idempotencyKeyHash: record.idempotencyKeyHash,
    refundSequence,
  }
  if (record.state === 'provider_failed') {
    if (!hasOwnDataProperties(record, ['reconciliationCheckedAt', 'reconciliationReference'])) {
      return null
    }
    const persistence = providerNoEffectPersistence({
      kind: 'provider_confirmed_no_effect',
      confirmedAt: record.reconciliationCheckedAt,
      reference: record.reconciliationReference,
    })
    if (!persistence) return null
    parsed.reconciliationCheckedAt = persistence.reconciliationCheckedAt
    parsed.reconciliationReference = persistence.reconciliationReference
  }
  return parsed
}

function providerNoEffectEvidenceFromRecord(
  record: RefundIntentDecisionRecord,
): RefundIntentProviderNoEffectEvidence | undefined {
  if (
    record.state !== 'provider_failed' ||
    !record.reconciliationCheckedAt ||
    !record.reconciliationReference
  ) {
    return undefined
  }
  return {
    kind: 'provider_confirmed_no_effect',
    confirmedAt: record.reconciliationCheckedAt,
    reference: record.reconciliationReference,
  }
}

export function decideRefundIntentCreation(input: {
  orderId: string
  requestHash: string
  idempotencyKeyHash: string
  refundSequence: number
  existingRecords: readonly unknown[]
}): RefundIntentCreationDecision {
  if (
    !isPlainRecord(input) ||
    !hasOwnDataProperties(input, [
      'orderId',
      'requestHash',
      'idempotencyKeyHash',
      'refundSequence',
      'existingRecords',
    ]) ||
    !Array.isArray(input.existingRecords)
  ) {
    return { kind: 'invariant_violation', launchAllowed: false, reason: 'invalid_input' }
  }
  let orderId: string
  let refundSequence: number
  try {
    orderId = strictIdentifier(input.orderId, 'orderId')
    refundSequence = positiveSafeInteger(input.refundSequence, 'refundSequence')
  } catch {
    return { kind: 'invariant_violation', launchAllowed: false, reason: 'invalid_input' }
  }
  if (!SHA256_HEX.test(input.requestHash) || !SHA256_HEX.test(input.idempotencyKeyHash)) {
    return { kind: 'invariant_violation', launchAllowed: false, reason: 'invalid_input' }
  }
  const records = input.existingRecords.map(parseDecisionRecord)
  if (records.some((record) => record === null)) {
    return { kind: 'invariant_violation', launchAllowed: false, reason: 'corrupt_record' }
  }
  const validRecords = records as RefundIntentDecisionRecord[]
  const sameKey = validRecords.filter(
    (record) => record.idempotencyKeyHash === input.idempotencyKeyHash,
  )
  const unresolvedForOrder = validRecords.filter(
    (record) =>
      record.orderId === orderId &&
      isRefundIntentUnresolved(record.state, providerNoEffectEvidenceFromRecord(record)),
  )
  const committedForSequence = validRecords.filter(
    (record) =>
      record.orderId === orderId &&
      record.refundSequence === refundSequence &&
      record.state === 'committed',
  )
  if (sameKey.length > 1) {
    return { kind: 'invariant_violation', launchAllowed: false, reason: 'duplicate_key' }
  }
  if (unresolvedForOrder.length > 1) {
    return {
      kind: 'invariant_violation',
      launchAllowed: false,
      reason: 'multiple_unresolved_order',
    }
  }
  if (committedForSequence.length > 1) {
    return {
      kind: 'invariant_violation',
      launchAllowed: false,
      reason: 'duplicate_committed_sequence',
    }
  }
  if (sameKey.length === 1) {
    if (sameKey[0].orderId !== orderId) {
      return { kind: 'invariant_violation', launchAllowed: false, reason: 'key_order_mismatch' }
    }
    if (sameKey[0].requestHash !== input.requestHash) {
      return { kind: 'conflict', launchAllowed: false, reason: 'key_payload_mismatch' }
    }
    return sameKey[0].refundSequence === refundSequence
      ? { kind: 'replay', launchAllowed: false, record: sameKey[0] }
      : { kind: 'invariant_violation', launchAllowed: false, reason: 'key_sequence_mismatch' }
  }
  if (unresolvedForOrder.length === 1) {
    return { kind: 'conflict', launchAllowed: false, reason: 'order_blocked' }
  }
  if (committedForSequence.length === 1) {
    return { kind: 'conflict', launchAllowed: false, reason: 'sequence_already_committed' }
  }
  return { kind: 'create', launchAllowed: false }
}
