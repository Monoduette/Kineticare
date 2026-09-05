import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearRefundOperation,
  ensureRefundOperation,
  readRefundOperation,
} from '../components/admin/refund-operation'
import { digestRefundIdempotencyKey } from '../lib/refund/refund-intent'

const ORDER = 'SYNTHETIC-OPERATION-A'
const values = new Map<string, string>()
const storage = {
  getItem: vi.fn((key: string) => values.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    values.set(key, value)
  }),
  removeItem: vi.fn((key: string) => {
    values.delete(key)
  }),
}

beforeEach(() => {
  values.clear()
  vi.clearAllMocks()
  vi.stubGlobal('window', { sessionStorage: storage })
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('No network allowed')
    }),
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('persisted refund operation identity', () => {
  it('generates canonical 32-byte keys, persists only key+amount, and reuses an identical operation', () => {
    const operation = ensureRefundOperation(ORDER, 1250)
    expect(operation.key).toHaveLength(43)
    expect(() => digestRefundIdempotencyKey(operation.key)).not.toThrow()
    expect(readRefundOperation(ORDER)).toEqual(operation)
    expect(ensureRefundOperation(ORDER, 1250)).toEqual(operation)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(JSON.parse([...values.values()][0]!)).toEqual({ key: operation.key, amountHuf: 1250 })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('isolates orders and rejects amount changes without overwriting a previous key', () => {
    const first = ensureRefundOperation(ORDER, null)
    const other = ensureRefundOperation('SYNTHETIC-OPERATION-B', 1250)
    expect(first.key).not.toBe(other.key)
    expect(() => ensureRefundOperation(ORDER, 1250)).toThrow(/mismatch/)
    expect(readRefundOperation(ORDER)).toEqual(first)
    expect(readRefundOperation('SYNTHETIC-OPERATION-B')).toEqual(other)
  })

  it.each([
    '{',
    'null',
    '{}',
    JSON.stringify({ key: 'A'.repeat(42) + 'B', amountHuf: null }),
    JSON.stringify({ key: 'A'.repeat(43), amountHuf: -1 }),
  ])('never replaces malformed persisted state: %s', (value) => {
    values.set(`kineticare:refund-operation:${ORDER}`, value)
    expect(() => ensureRefundOperation(ORDER, null)).toThrow()
    expect(storage.setItem).not.toHaveBeenCalled()
    expect([...values.values()]).toEqual([value])
  })

  it('does not clear a different operation key and allows a new key only after exact-key clearing', () => {
    const operation = ensureRefundOperation(ORDER, null)
    expect(() => clearRefundOperation(ORDER, 'A'.repeat(43))).toThrow()
    expect(readRefundOperation(ORDER)).toEqual(operation)
    clearRefundOperation(ORDER, operation.key)
    expect(readRefundOperation(ORDER)).toBeNull()
    expect(ensureRefundOperation(ORDER, null).key).not.toBe(operation.key)
  })

  it('fails closed when storage cannot persist the operation', () => {
    storage.setItem.mockImplementationOnce(() => {
      throw new Error('Synthetic storage failure')
    })
    expect(() => ensureRefundOperation(ORDER, null)).toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
})
