import { describe, expect, it } from 'vitest'

import {
  BarionApiError,
  buildRefundRequest,
  type BarionPaymentStateResponse,
} from '../../lib/barion'
import {
  classifyRefundRejection,
  DEFINITIVE_REFUND_REJECTION_CODES,
  expectedPosTransactionId,
  PROVIDER_SETTLE_DELAY_MS,
  refundComment,
  refundEvidenceFromPaymentState,
  refundRejectionMessage,
  rejectionCodesFromReference,
  rejectionReference,
  sameBarionId,
} from '../../lib/refund/barion-refund-evidence'

const PAYMENT = '11111111-2222-3333-4444-555555555555'
const SOURCE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const REFUND = 'bbbbbbbb-0000-0000-0000-000000000001'
const EARLIER_REFUND = 'bbbbbbbb-0000-0000-0000-000000000002'
const POS = 'KH-2026-000123-1'
const STARTED = '2026-09-24T10:00:00.000Z'
const LATER = Date.parse(STARTED) + PROVIDER_SETTLE_DELAY_MS

function apiError(
  kind: BarionApiError['kind'],
  httpStatus: number | undefined,
  codes: string[],
): BarionApiError {
  return new BarionApiError({
    kind,
    message: 'SYNTHETIC',
    endpoint: 'POST /v2/Payment/Refund',
    httpStatus,
    providerErrors: codes.map((ErrorCode) => ({ ErrorCode, Title: '', Description: '' })),
  })
}

describe('classifyRefundRejection (végleges Barion-elutasítás)', () => {
  it.each(DEFINITIVE_REFUND_REJECTION_CODES)('HTTP 400 + %s → végleges', (code) => {
    expect(classifyRefundRejection(apiError('http', 400, [code]))).toEqual({ codes: [code] })
  })

  it('HTTP 401 AuthenticationFailed és HTTP 200 + Errors is válasz, tehát végleges', () => {
    expect(classifyRefundRejection(apiError('http', 401, ['AuthenticationFailed']))).toEqual({
      codes: ['AuthenticationFailed'],
    })
    expect(
      classifyRefundRejection(apiError('provider', 200, ['TooLowBalanceToMakeRefund'])),
    ).toEqual({ codes: ['TooLowBalanceToMakeRefund'] })
  })

  it('ismétlődő kódot egyszer rögzít, a Barion sorrendjében', () => {
    expect(
      classifyRefundRejection(
        apiError('http', 400, [
          'ModelValidationError',
          'TooLowBalanceToMakeRefund',
          'ModelValidationError',
        ]),
      ),
    ).toEqual({ codes: ['ModelValidationError', 'TooLowBalanceToMakeRefund'] })
  })

  it.each([
    ['timeout', undefined, []],
    ['network', undefined, []],
    ['invalid_response', 400, ['TooLowBalanceToMakeRefund']],
    ['http', 500, ['TooLowBalanceToMakeRefund']],
    ['http', 503, []],
    ['http', 408, ['TooLowBalanceToMakeRefund']],
    ['http', 400, []],
    ['http', 400, ['InternalServerError']],
    ['http', 400, ['TooLowBalanceToMakeRefund', 'InternalServerError']],
    ['http', 400, ['Unknown']],
    ['provider', 500, ['TooLowBalanceToMakeRefund']],
  ] as const)('%s %s %j → ismeretlen kimenet (nem végleges)', (kind, status, codes) => {
    expect(classifyRefundRejection(apiError(kind, status, [...codes]))).toBeNull()
  })

  it('nem Barion-hiba soha nem végleges', () => {
    expect(classifyRefundRejection(new Error('TooLowBalanceToMakeRefund'))).toBeNull()
    expect(classifyRefundRejection('TooLowBalanceToMakeRefund')).toBeNull()
  })

  it('a tartós hivatkozás visszaolvasható, más hivatkozásból nem olvas kódot', () => {
    const reference = rejectionReference({
      codes: ['TooLowBalanceToMakeRefund', 'ModelValidationError'],
    })
    expect(reference).toBe('barion:refund-rejected:TooLowBalanceToMakeRefund+ModelValidationError')
    expect(rejectionCodesFromReference(reference)).toEqual([
      'TooLowBalanceToMakeRefund',
      'ModelValidationError',
    ])
    expect(rejectionCodesFromReference('barion:paymentstate:no-refund-transaction')).toEqual([])
    expect(rejectionCodesFromReference(null)).toEqual([])
  })
})

describe('refundRejectionMessage (tulajdonosi szöveg)', () => {
  it('a kevés egyenlegnél megmondja az okot, a pénzmozgás hiányát és a teendőt az összeggel', () => {
    expect(refundRejectionMessage({ codes: ['TooLowBalanceToMakeRefund'] }, 79_500)).toBe(
      'A Barion elutasította a visszatérítést, mert a Barion-tárcádban nincs elég egyenleg. Pénzmozgás nem történt. Tölts fel annyit, hogy legalább 79 500 Ft legyen a tárcában, majd indítsd újra a visszatérítést.',
    )
  })

  it('vegyes kódoknál a legfontosabb (javítható) ok nyer', () => {
    expect(
      refundRejectionMessage(
        { codes: ['ModelValidationError', 'TooLowBalanceToMakeRefund'] },
        1000,
      ),
    ).toContain('nincs elég egyenleg')
  })

  it.each(DEFINITIVE_REFUND_REJECTION_CODES)(
    '%s: magyar, okot és teendőt mond, hibakód, töltelék-gondolatjel és tiltott szó nélkül',
    (code) => {
      const message = refundRejectionMessage({ codes: [code] }, 20_000)
      expect(message).toContain('Pénzmozgás nem történt.')
      expect(message).not.toContain(code)
      expect(message).not.toMatch(/[–—]/u)
      expect(message).not.toMatch(/kérjük|érvénytelen|hiba történt/iu)
      expect(message.split('. ').length).toBeGreaterThanOrEqual(3)
    },
  )
})

describe('azonosítók, megjegyzés, kereskedői azonosító', () => {
  it('ugyanazt a GUID-ot kötőjellel, anélkül és nagybetűvel is egyezőnek veszi (guid.ts)', () => {
    expect(sameBarionId(PAYMENT, PAYMENT.replaceAll('-', '').toUpperCase())).toBe(true)
    expect(sameBarionId('SYNTHETIC-TX', 'SYNTHETIC-TX')).toBe(true)
    expect(sameBarionId(PAYMENT, SOURCE)).toBe(false)
    expect(sameBarionId('', '')).toBe(false)
    expect(sameBarionId(undefined, undefined)).toBe(false)
  })

  it('a checkout-azonosítót és a fizetőnek látható megjegyzést a rendelésszámból képzi', () => {
    expect(expectedPosTransactionId('KH-2026-000123')).toBe('KH-2026-000123-1')
    expect(expectedPosTransactionId('  ')).toBeNull()
    expect(refundComment('KH-2026-000123')).toBe('Kineticare visszatérítés KH-2026-000123')
    expect(refundComment(null)).toBeUndefined()
  })

  it('a Comment csak megadva kerül a Payment/Refund kérésbe (TransactionToRefund.Comment)', () => {
    const base = { transactionId: SOURCE, posTransactionId: POS, amountToRefund: 5000 }
    expect(
      buildRefundRequest({ paymentId: PAYMENT, transactionsToRefund: [base] })
        .TransactionsToRefund[0],
    ).not.toHaveProperty('Comment')
    expect(
      buildRefundRequest({
        paymentId: PAYMENT,
        transactionsToRefund: [{ ...base, comment: '  ' }],
      }).TransactionsToRefund[0],
    ).not.toHaveProperty('Comment')
    expect(
      buildRefundRequest({
        paymentId: PAYMENT,
        transactionsToRefund: [{ ...base, comment: refundComment('KH-2026-000123') }],
      }).TransactionsToRefund[0],
    ).toEqual({
      TransactionId: SOURCE,
      POSTransactionId: POS,
      AmountToRefund: 5000,
      Comment: 'Kineticare visszatérítés KH-2026-000123',
    })
  })
})

describe('refundEvidenceFromPaymentState (GetState-egyeztetés)', () => {
  function state(
    extra: BarionPaymentStateResponse['Transactions'] = [],
    total = 20_000,
  ): BarionPaymentStateResponse {
    return {
      PaymentId: PAYMENT,
      Status: 'Succeeded',
      Total: total,
      Transactions: [
        {
          TransactionId: SOURCE,
          POSTransactionId: POS,
          TransactionType: 'CardPayment',
          Status: 'Succeeded',
          Total: 20_000,
        },
        {
          TransactionId: 'fee00000-0000-0000-0000-000000000001',
          POSTransactionId: '',
          TransactionType: 'GatewayFee',
          Status: 'Succeeded',
          Total: 298,
          RelatedId: SOURCE,
        },
        ...extra,
      ],
    }
  }
  const refundTx = (id: string, total: number, status = 'Succeeded') => ({
    TransactionId: id,
    POSTransactionId: POS,
    TransactionType: 'RefundToBankCard',
    Status: status,
    Total: total,
    RelatedId: SOURCE,
  })
  const input = (
    paymentState: BarionPaymentStateResponse,
    overrides: Partial<Parameters<typeof refundEvidenceFromPaymentState>[0]> = {},
  ) =>
    refundEvidenceFromPaymentState({
      state: paymentState,
      paymentId: PAYMENT.replaceAll('-', ''),
      sourceTransactionId: SOURCE,
      amountHuf: 5000,
      consumedRefundTransactionIds: [],
      expectedRemainingHuf: 20_000,
      providerStartedAt: STARTED,
      now: LATER,
      ...overrides,
    })

  it('egyetlen új, sikeres, azonos összegű refund-tranzakció → siker, a díj nem számít', () => {
    expect(input(state([refundTx(REFUND, 5000)], 15_000))).toEqual({
      kind: 'succeeded',
      refundTransactionId: REFUND,
      posTransactionId: POS,
    })
  })

  it('a korábbi, már rögzített visszatérítést nem tulajdonítja a mostaninak', () => {
    const paymentState = state([refundTx(EARLIER_REFUND, 5000)], 15_000)
    const options = { consumedRefundTransactionIds: [EARLIER_REFUND], expectedRemainingHuf: 15_000 }
    expect(input(paymentState, options)).toEqual({ kind: 'no_effect' })
    expect(
      input(state([refundTx(EARLIER_REFUND, 5000), refundTx(REFUND, 5000)], 10_000), options),
    ).toMatchObject({ kind: 'succeeded', refundTransactionId: REFUND })
  })

  it('folyamatban lévő refund-tranzakció → in_progress', () => {
    expect(input(state([refundTx(REFUND, 5000, 'Prepared')], 20_000))).toEqual({
      kind: 'in_progress',
    })
  })

  it('refund-tranzakció nélkül csak a várakozási idő után és egyező Total mellett nullhatás', () => {
    expect(input(state())).toEqual({ kind: 'no_effect' })
    expect(input(state(), { now: LATER - 1 })).toEqual({
      kind: 'too_early',
      notBefore: new Date(LATER).toISOString(),
    })
    expect(input(state([], 15_000))).toEqual({ kind: 'unprovable' })
    expect(input(state(), { expectedRemainingHuf: null })).toEqual({ kind: 'unprovable' })
    expect(input(state(), { providerStartedAt: null })).toEqual({ kind: 'unprovable' })
  })

  it.each([
    ['két új refund-tranzakció', state([refundTx(REFUND, 5000), refundTx(EARLIER_REFUND, 5000)])],
    ['eltérő összeg', state([refundTx(REFUND, 4000)], 16_000)],
    ['nem GUID refund-azonosító', state([refundTx('SYNTHETIC-REFUND', 5000)], 15_000)],
    [
      'sikertelen visszatérítés sztornója',
      state([
        refundTx(REFUND, 5000),
        {
          ...refundTx(EARLIER_REFUND, 5000),
          TransactionType: 'StornoUnSuccessfulRefundToBankCard',
        },
      ]),
    ],
    ['idegen fizetés', { ...state(), PaymentId: '99999999-2222-3333-4444-555555555555' }],
    ['nem Succeeded fizetés', { ...state(), Status: 'Canceled' as const }],
  ])('%s → nem bizonyítható', (_label, paymentState) => {
    expect(input(paymentState)).toEqual({ kind: 'unprovable' })
  })

  it('nem bizonyítható, ha egy rögzített korábbi visszatérítés nem látszik, vagy a lista hiányos', () => {
    expect(input(state(), { consumedRefundTransactionIds: [EARLIER_REFUND] })).toEqual({
      kind: 'unprovable',
    })
    expect(input(state(), { consumedRefundTransactionIds: null })).toEqual({ kind: 'unprovable' })
  })
})
