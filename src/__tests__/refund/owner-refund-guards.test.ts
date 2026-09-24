import { afterEach, describe, expect, it, vi } from 'vitest'

// A közös tároló-, zár- és Barion-mockokat a szolgáltatás importja előtt kell regisztrálni.
import { documents, fixture, provider, store } from '../refund-fixture'
import { BarionApiError } from '../../lib/barion'
import type { Logger } from '../../lib/logger'
import { refundOrder } from '../../lib/refund/refund-order'

/**
 * A tulajdonosi visszatérítés 2. körös őrei a szolgáltatás határán
 * (refundOrder): K12 számla-kapu, K17 idegen visszatérítés felismerése a
 * GetState-ből (r-barion-8), és a Barion-válasz nyoma (a-refund-9,
 * a-riasztas-5: RIASZTÁS, műveletnapló-sor kérésazonosítóval, IP-vel, belső
 * indokkal).
 */

const OPERATION_KEY = 'A'.repeat(43)
/** A tulajdonosi szöveg eleje; a teljes szöveget a számla-kapu modulja adja. */
const INVOICE_PENDING = 'A számla még nem készült el, ezért a visszatérítés még nem indítható.'
const INVOICE_FAILED = 'A számla kiállítása nem sikerült, ezért a visszatérítés nem indítható'
const REQUEST_ID = 'SYNTHETIC-REQ-0001'
const CLIENT_IP = '203.0.113.7'

afterEach(() => {
  vi.unstubAllEnvs()
})

function spyLogger() {
  const errors: Array<{ message: string; context: Record<string, unknown> }> = []
  const log: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (message, context) => {
      errors.push({ message, context: (context ?? {}) as Record<string, unknown> })
    },
    child: () => log,
  }
  return {
    log,
    errors,
    alerts: () => errors.filter((entry) => entry.message.startsWith('RIASZTÁS')),
  }
}

function start(f: ReturnType<typeof fixture>, input: Record<string, unknown> = {}, log?: Logger) {
  return refundOrder({
    ...f.options,
    input: { operationKey: OPERATION_KEY, ...input },
    requestId: REQUEST_ID,
    ipAddress: CLIENT_IP,
    ...(log ? { logger: log } : {}),
  })
}

function rejection(code: string) {
  return new BarionApiError({
    kind: 'http',
    message: 'SYNTHETIC',
    endpoint: 'POST /v2/Payment/Refund',
    httpStatus: 400,
    providerErrors: [{ ErrorCode: code, Title: 'SYNTHETIC', Description: 'SYNTHETIC' }],
  })
}

describe('K12: bekapcsolt számlázásnál tulajdonosi visszatérítés csak kiállított számla után', () => {
  it.each([
    ['none', null, INVOICE_PENDING],
    ['pending', null, INVOICE_PENDING],
    ['issued', '   ', INVOICE_PENDING],
    ['failed', null, INVOICE_FAILED],
  ] as const)(
    'számla %s állapotban: 409 a teendővel, GetState, kísérlet és Barion-kérés nélkül',
    async (invoiceStatus, invoiceNumber, message) => {
      vi.stubEnv('SZAMLAZZ_AGENT_KEY', 'DUMMY-agent-key')
      const f = fixture()
      Object.assign(f.order, { invoiceStatus, invoiceNumber })
      const error = await start(f).catch((caught: unknown) => caught)
      expect(error).toMatchObject({ status: 409 })
      expect((error as Error).message).toMatch(
        new RegExp(`^${message}.*Pénzmozgás nem történt\\.$`, 'u'),
      )
      expect(provider.state).not.toHaveBeenCalled()
      expect(provider.refund).not.toHaveBeenCalled()
      expect(store.intents.get(f.payload)).toBeUndefined()
    },
  )

  it('kiállított számlánál a visszatérítés lefut, és a stornó elkészül', async () => {
    vi.stubEnv('SZAMLAZZ_AGENT_KEY', 'DUMMY-agent-key')
    const f = fixture()
    Object.assign(f.order, { invoiceStatus: 'issued', invoiceNumber: 'SYNTHETIC-INV' })
    await expect(start(f)).resolves.toMatchObject({ type: 'full', orderStatus: 'refunded' })
    expect(store.intents.get(f.payload)?.state).toBe('committed')
    expect(documents.storno).toHaveBeenCalledTimes(1)
  })

  it('kikapcsolt számlázásnál a számla állapota nem akadály', async () => {
    vi.stubEnv('SZAMLAZZ_AGENT_KEY', '')
    const f = fixture()
    Object.assign(f.order, { invoiceStatus: 'pending' })
    await expect(start(f)).resolves.toMatchObject({ type: 'full' })
    expect(provider.refund).toHaveBeenCalledTimes(1)
  })
})

describe('K17, r-barion-8: a Barion szerint visszatérített összeg egyezzen a rendelés nyilvántartásával', () => {
  const related = (overrides: Record<string, unknown>) => ({
    TransactionId: 'cccccccc-bbbb-cccc-dddd-000000000009',
    POSTransactionId: 'SYNTHETIC-RECOVERY-11-1',
    TransactionType: 'RefundToBankCard',
    Status: 'Succeeded',
    Total: 5000,
    RelatedId: 'SYNTHETIC-TX',
    ...overrides,
  })

  it.each([
    [
      'a Barion felületén indított, sikeres visszatérítés',
      related({}),
      'más összeg ment már vissza',
      5000,
    ],
    ['folyamatban lévő visszatérítés', related({ Status: 'Started' }), 'nem dönthető el', null],
    [
      'sikertelen kártyás visszatérítés sztornója',
      related({ TransactionType: 'StornoUnSuccessfulRefundToBankCard' }),
      'nem dönthető el',
      null,
    ],
  ] as const)(
    '%s: 409, új pénz-POST és kísérlet nélkül, RIASZTÁS-sal',
    async (_label, tx, text, barion) => {
      const f = fixture()
      f.barionRefunds.push(tx)
      const { log, alerts } = spyLogger()
      const error = await start(f, { amountHuf: 5000 }, log).catch((caught: unknown) => caught)
      expect(error).toMatchObject({ status: 409 })
      expect((error as Error).message).toContain(text)
      expect((error as Error).message).toContain('pénzmozgás nem történt')
      expect(provider.refund).not.toHaveBeenCalled()
      expect(store.intents.get(f.payload)).toBeUndefined()
      expect(alerts()).toEqual([
        expect.objectContaining({
          context: expect.objectContaining({
            barionRefundedHuf: barion,
            localRefundedHuf: 0,
            requestId: REQUEST_ID,
          }),
        }),
      ])
    },
  )
})

describe('a-refund-9, a-riasztas-5: a Barion-válasz nyoma a műveletnaplóban és riasztással', () => {
  it('TooLowBalanceToMakeRefund: RIASZTÁS a hibakóddal, műveletnapló-sor a kérés adataival, újra indítható kísérlet', async () => {
    const f = fixture()
    provider.refund.mockRejectedValueOnce(rejection('TooLowBalanceToMakeRefund'))
    const { log, alerts } = spyLogger()
    await expect(start(f, { note: 'elállás' }, log)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('Tölts fel'),
    })
    expect(store.intents.get(f.payload)?.state).toBe('provider_failed')
    expect(alerts()).toEqual([
      expect.objectContaining({
        context: expect.objectContaining({
          providerErrorCodes: ['TooLowBalanceToMakeRefund'],
          httpStatus: 400,
          amountHuf: 20000,
          requestId: REQUEST_ID,
        }),
      }),
    ])
    const rows = f.audits.filter((row) => row.action === 'refund-provider-rejected')
    expect(rows).toEqual([
      expect.objectContaining({
        entityType: 'refund-intents',
        entityId: String(store.intents.get(f.payload)!.id),
        actor: 1,
        requestId: REQUEST_ID,
        ipAddress: CLIENT_IP,
        after: expect.objectContaining({
          outcome: 'rejected',
          providerErrorCodes: ['TooLowBalanceToMakeRefund'],
          amountHuf: 20000,
          actorKind: 'owner',
          requestId: REQUEST_ID,
          note: 'elállás',
        }),
      }),
    ])
  })

  it('értékelhetetlen válasz (időtúllépés): RIASZTÁS és „unknown” sor, a kísérlet blokkol', async () => {
    const f = fixture()
    provider.refund.mockRejectedValueOnce(
      new BarionApiError({
        kind: 'timeout',
        message: 'SYNTHETIC',
        endpoint: 'POST /v2/Payment/Refund',
      }),
    )
    const { log, alerts } = spyLogger()
    await expect(start(f, {}, log)).rejects.toMatchObject({ status: 503 })
    expect(store.intents.get(f.payload)?.state).toBe('provider_unknown')
    expect(alerts()).toHaveLength(1)
    expect(alerts()[0]!.context).toMatchObject({ errorKind: 'timeout', requestId: REQUEST_ID })
    expect(f.audits.filter((row) => row.action === 'refund-provider-unknown')).toEqual([
      expect.objectContaining({
        requestId: REQUEST_ID,
        ipAddress: CLIENT_IP,
        after: expect.objectContaining({
          outcome: 'unknown',
          errorKind: 'timeout',
          amountHuf: 20000,
        }),
      }),
    ])
  })

  it('a belső indok csak a műveletnaplóba kerül: sem a kísérlet, sem a rendelés, sem a stornó nem kapja meg', async () => {
    const f = fixture()
    await expect(start(f, { note: 'méltányosság' })).resolves.toMatchObject({ type: 'full' })
    expect(f.audits.filter((row) => row.action === 'refund-provider-accepted')).toEqual([
      expect.objectContaining({
        requestId: REQUEST_ID,
        ipAddress: CLIENT_IP,
        after: expect.objectContaining({ outcome: 'succeeded', note: 'méltányosság' }),
      }),
    ])
    expect(JSON.stringify(store.intents.get(f.payload))).not.toContain('méltányosság')
    expect(JSON.stringify(f.order)).not.toContain('méltányosság')
    expect(JSON.stringify(documents.storno.mock.calls)).not.toContain('méltányosság')
    expect(JSON.stringify(provider.refund.mock.calls)).not.toContain('méltányosság')
  })

  it('a műveletnapló írási hibája nem akasztja meg a kísérlet lezárását', async () => {
    const f = fixture()
    provider.refund.mockRejectedValueOnce(rejection('TooLowBalanceToMakeRefund'))
    f.failures.receipt = 'refund-provider-rejected'
    await expect(start(f)).rejects.toMatchObject({ status: 409 })
    expect(store.intents.get(f.payload)).toMatchObject({
      state: 'provider_failed',
      activeOrderKey: null,
    })
  })

  it('a szabálytalan belső indok 400, GetState nélkül', async () => {
    const f = fixture()
    await expect(start(f, { note: 'első sor\nmásodik sor' })).rejects.toMatchObject({ status: 400 })
    expect(provider.state).not.toHaveBeenCalled()
  })
})
