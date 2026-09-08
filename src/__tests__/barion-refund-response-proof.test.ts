import { describe, expect, it } from 'vitest'

import {
  validateRefundResponseProof,
  type RefundResponseExpected,
} from '../lib/barion/refund-response-proof'

// Kizárólag szintetikus azonosítók: a dokumentált formátumot őrzik, nem valódi fizetést.
const expected: RefundResponseExpected = {
  paymentId: '11111111111111111111111111111111',
  sourceTransactionId: '22222222222222222222222222222222',
  posTransactionId: 'DUMMY-ORDER-REFUND-01',
  amountHuf: 4900,
}
const newRefundId = '33333333333333333333333333333333'

function response(transaction: Record<string, unknown> = {}, root: Record<string, unknown> = {}) {
  return {
    PaymentId: expected.paymentId,
    RefundedTransactions: [
      {
        TransactionId: newRefundId,
        POSTransactionId: expected.posTransactionId,
        Total: expected.amountHuf,
        Status: 'Succeeded',
        ...transaction,
      },
    ],
    Errors: [],
    ...root,
  }
}

describe('Barion közvetlen refund-válasz: dokumentált, szigorúan kötött bizonyíték', () => {
  it('elfogadja a dokumentált új refund-ID-t az eredeti POS-hoz kötve', () => {
    expect(validateRefundResponseProof(response(), expected)).toEqual({
      refundTransactionId: newRefundId,
      status: 'Succeeded',
    })
  })

  it('elfogadja a dokumentált forrás-ID-visszaadó válaszformát is', () => {
    expect(
      validateRefundResponseProof(
        response({ TransactionId: expected.sourceTransactionId }),
        expected,
      ),
    ).toEqual({ refundTransactionId: expected.sourceTransactionId, status: 'Succeeded' })
  })

  it('kötőjeles GUID és egyező opcionális AmountToRefund mellett megőrzi a kapott ID-t', () => {
    const id = '33333333-3333-4333-a333-333333333333'
    expect(
      validateRefundResponseProof(response({ TransactionId: id, AmountToRefund: 4900 }), expected),
    ).toEqual({ refundTransactionId: id, status: 'Succeeded' })
  })

  it('a hiányzó Errors mező is elfogadható; minden kiadott mező minimális', () => {
    const value = response({ Comment: 'DUMMY privát indok' }, { Errors: undefined, Debug: 'DUMMY' })
    expect(validateRefundResponseProof(value, expected)).toEqual({
      refundTransactionId: newRefundId,
      status: 'Succeeded',
    })
  })

  it('a GUID hex karaktereinek kis- és nagybetűs alakja is dokumentált azonosító', () => {
    const id = 'ABCDEF1233334333A333333333333333'
    expect(validateRefundResponseProof(response({ TransactionId: id }), expected)).toEqual({
      refundTransactionId: id,
      status: 'Succeeded',
    })
  })

  it.each(['DUMMY-OTHER-POS', '', '  ', undefined, null, 41])(
    'a forrás-ID egyezése sem enged át hibás/hiányzó merchant POS-t: %s',
    (pos) => {
      const value = response({ TransactionId: expected.sourceTransactionId, POSTransactionId: pos })
      expect(validateRefundResponseProof(value, expected)).toBeNull()
    },
  )

  it.each([
    { PaymentId: '44444444444444444444444444444444' },
    { PaymentId: undefined },
    { Errors: [{ ErrorCode: 'DUMMY_PROVIDER_REJECTED' }] },
    { Errors: null },
    { Errors: 'DUMMY' },
    { RefundedTransactions: [] },
    { RefundedTransactions: [{}, {}] },
    { RefundedTransactions: [null] },
    { RefundedTransactions: {} },
  ])('elutasítja az eltérő fizetést, hibát vagy nem egyértelmű tömböt: %j', (root) => {
    expect(validateRefundResponseProof(response({}, root), expected)).toBeNull()
  })

  it.each([
    0,
    -1,
    4901,
    4899,
    4900.5,
    '4900',
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    undefined,
  ])('csak pontos, pozitív egész HUF összeget fogad el: %s', (amount) =>
    expect(validateRefundResponseProof(response({ Total: amount }), expected)).toBeNull(),
  )

  it('az opcionális összegellentmondás miatt nem állít sikert', () => {
    expect(validateRefundResponseProof(response({ AmountToRefund: 4901 }), expected)).toBeNull()
  })

  it.each([
    'Prepared',
    'Started',
    'Reserved',
    'RefundFailed',
    'Unknown',
    'Refunded',
    'PartiallyRefunded',
    'succeeded',
    '',
    undefined,
    null,
    2,
  ])('a közvetlen proof nem fogadja terminális Succeeded helyett: %s', (status) =>
    expect(validateRefundResponseProof(response({ Status: status }), expected)).toBeNull(),
  )

  it.each([
    '',
    ' ',
    'trx-1',
    '3'.repeat(31),
    '3'.repeat(33),
    'g'.repeat(32),
    `${newRefundId}\n`,
    undefined,
    null,
    1,
  ])('hiányzó vagy nem dokumentált GUID-ból nem készít bizonyítékot: %s', (id) =>
    expect(validateRefundResponseProof(response({ TransactionId: id }), expected)).toBeNull(),
  )

  it.each([undefined, null, [], 'DUMMY', 200])(
    'nem objektum válasz nem bizonyíték: %s',
    (value) => {
      expect(validateRefundResponseProof(value, expected)).toBeNull()
    },
  )

  it.each([0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'hibás helyi összeg sem igazolható vissza: %s',
    (amountHuf) => {
      expect(
        validateRefundResponseProof(
          response({ TransactionId: expected.sourceTransactionId, Total: amountHuf }),
          { ...expected, amountHuf },
        ),
      ).toBeNull()
    },
  )

  it.each(['paymentId', 'sourceTransactionId', 'posTransactionId'] as const)(
    'hiányzó helyi %s mellett nem készít bizonyítékot',
    (field) => {
      const invalid = { ...expected, [field]: '' }
      const value = response(
        { POSTransactionId: invalid.posTransactionId },
        { PaymentId: invalid.paymentId },
      )
      expect(validateRefundResponseProof(value, invalid)).toBeNull()
    },
  )

  it('a bemenetet nem módosítja és a bizonyíték nem tartalmaz nyers provider payloadot', () => {
    const value = response()
    const before = JSON.stringify(value)
    const proof = validateRefundResponseProof(value, expected)
    expect(JSON.stringify(value)).toBe(before)
    expect(Object.keys(proof ?? {}).sort()).toEqual(['refundTransactionId', 'status'])
  })
})
