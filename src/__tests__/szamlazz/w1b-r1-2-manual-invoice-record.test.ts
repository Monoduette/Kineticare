import { afterEach, describe, expect, it, vi } from 'vitest'

// A zár-mock (kulcsonként soros, a kulcsokat naplózza) és a tároló-fixtúra a
// modulok importja előtt regisztrálódik.
import { fixture, locks } from '../refund-fixture'
import { withAdvisoryLock } from '../../lib/advisory-lock'
import type { Logger } from '../../lib/logger'
import { issueInvoiceForOrder } from '../../lib/szamlazz/invoice'
import {
  MANUAL_INVOICE_RECORD_AUDIT_ACTION,
  recordManualInvoiceNumber,
  type RecordManualInvoiceInput,
} from '../../lib/szamlazz/manual-invoice-record'
import type { SzamlazzClientConfig } from '../../lib/szamlazz/types'
import {
  MANUAL_INVOICE_CONFIRM_ENV,
  runRecordManualInvoice,
} from '../../scripts/record-manual-invoice'

/**
 * A kézzel kiállított számla számának rögzítése (W1B-3, W1B-7): a K12 kapu
 * egyetlen kijárata a 'failed' számlájú rendelésnél. A szabályokat a
 * modul határán (recordManualInvoiceNumber) és a CLI határán
 * (runRecordManualInvoice: kapcsolók, megerősítő kapu, kilépési kód) nézzük.
 */

const STOPPED = 'A számla automatikus kiállítása leállt: SYNTHETIC'

afterEach(() => {
  vi.useRealTimers()
})

function failedOrder(overrides: Record<string, unknown> = {}) {
  const f = fixture()
  Object.assign(f.order, {
    orderNumber: 'KH-2026-000011',
    invoiceStatus: 'failed',
    invoiceNumber: null,
    invoiceLastError: STOPPED,
    ...overrides,
  })
  f.options.orderNumber = 'KH-2026-000011'
  return f
}

function record(
  f: ReturnType<typeof fixture>,
  input: Partial<Omit<RecordManualInvoiceInput, 'payload'>> = {},
) {
  return recordManualInvoiceNumber({
    payload: f.payload,
    orderNumber: 'KH-2026-000011',
    invoiceNumber: 'E-KIN-2026-42',
    completionDate: '2026-09-05',
    dryRun: false,
    ...input,
  })
}

const auditRows = (f: ReturnType<typeof fixture>) =>
  f.audits.filter((row) => row.action === MANUAL_INVOICE_RECORD_AUDIT_ACTION)

describe('rögzítés a failed számlájú, fizetett rendelésen', () => {
  it('próbafutás: kiírja a változást, és semmit nem ír', async () => {
    const f = failedOrder()
    const result = await record(f, { dryRun: true })
    expect(result).toMatchObject({
      status: 'dry-run',
      invoiceNumber: 'E-KIN-2026-42',
      before: { invoiceStatus: 'failed', invoiceNumber: null },
    })
    expect(f.payload.update).not.toHaveBeenCalled()
    expect(auditRows(f)).toEqual([])
    expect(f.order).toMatchObject({ invoiceStatus: 'failed', invoiceNumber: null })
  })

  it('éles futás: issued + szám + teljesítés, a hiba szövege marad, egy műveletnapló-sor a zár alatt', async () => {
    const f = failedOrder()
    const heldAtWrite: string[][] = []
    const update = f.payload.update as unknown as ReturnType<typeof vi.fn>
    const original = update.getMockImplementation() as (args: unknown) => Promise<unknown>
    update.mockImplementation(async (args: unknown) => {
      heldAtWrite.push([...locks.held])
      return original(args)
    })
    const result = await record(f)
    expect(result).toMatchObject({ status: 'recorded', auditRecorded: true })
    expect(f.order).toMatchObject({
      invoiceStatus: 'issued',
      invoiceNumber: 'E-KIN-2026-42',
      invoiceCompletionDate: '2026-09-05',
      invoiceLastError: STOPPED,
    })
    expect(heldAtWrite).toEqual([[`invoice:${f.order.id}`]])
    expect(auditRows(f)).toEqual([
      expect.objectContaining({
        entityType: 'orders',
        entityId: String(f.order.id),
        before: expect.objectContaining({ invoiceStatus: 'failed', invoiceNumber: null }),
        after: expect.objectContaining({
          invoiceStatus: 'issued',
          invoiceNumber: 'E-KIN-2026-42',
          invoiceCompletionDate: '2026-09-05',
          recordedBy: 'script:record-manual-invoice',
        }),
      }),
    ])
  })

  it('a második éles futás elutasít: nincs második írás és második műveletnapló-sor', async () => {
    const f = failedOrder()
    await record(f)
    const again = await record(f, { invoiceNumber: 'E-KIN-2026-43' })
    expect(again.status).toBe('refused')
    expect(f.payload.update).toHaveBeenCalledTimes(1)
    expect(f.order.invoiceNumber).toBe('E-KIN-2026-42')
    expect(auditRows(f)).toHaveLength(1)
  })

  it('a rögzítés után egy még sorban álló számlajob no-op: ugyanazt a zárat veszi, és nem küld be semmit', async () => {
    const f = failedOrder()
    await record(f)
    const recordKeys = [...locks.events]
    locks.events = []
    const loud = () => {
      throw new Error('a számlajob nem hívhatja a Számlázz.hu-t')
    }
    const config: SzamlazzClientConfig = {
      enabled: true,
      apiUrl: 'https://www.szamlazz.hu/szamla/',
      agentKey: 'DUMMY-agent-key',
      invoicePrefix: 'KIN',
      vatMode: 'AAM',
      timeoutMs: 1000,
    }
    const outcome = await issueInvoiceForOrder({
      payload: f.payload,
      orderId: f.order.id,
      config,
      postXml: loud,
      queryByKulsoAzon: loud,
    })
    expect(outcome).toMatchObject({ outcome: 'already-issued', invoiceNumber: 'E-KIN-2026-42' })
    // A két kulcsnak szó szerint egyeznie kell, különben a kettő párhuzamosan futhat.
    expect(locks.events).toEqual(recordKeys)
  })

  it('a zárat tartó számlajob közben kiállította a számlát: a zár alatti újraolvasás után elutasít', async () => {
    const f = failedOrder()
    let pending: ReturnType<typeof record> | undefined
    await withAdvisoryLock(f.payload, `invoice:${f.order.id}`, async () => {
      pending = record(f)
      await new Promise((resolve) => setTimeout(resolve, 10))
      Object.assign(f.order, { invoiceStatus: 'issued', invoiceNumber: 'E-KIN-2026-7' })
    })
    const result = await pending!
    expect(result).toMatchObject({ status: 'refused' })
    expect(f.payload.update).not.toHaveBeenCalled()
    expect(f.order.invoiceNumber).toBe('E-KIN-2026-7')
  })
})

describe('elutasítás: semmi nem íródik, és az ok a valódi akadályt nevezi meg', () => {
  it.each([
    [
      'már kiállított számla',
      { invoiceStatus: 'issued', invoiceNumber: 'E-KIN-2026-1' },
      /már kiállított/u,
    ],
    ['függőben lévő számla', { invoiceStatus: 'pending' }, /még folyamatban/u],
    ['el sem indult számla', { invoiceStatus: 'none' }, /el sem indult/u],
    ['failed, de már van száma', { invoiceNumber: 'E-KIN-2026-1' }, /már áll számlaszám/u],
    ['visszatérített rendelés', { status: 'refunded' }, /már visszatérített/u],
    ['nem fizetett rendelés', { status: 'payment_pending' }, /nem fizetett/u],
  ] as const)('%s', async (_label, overrides, reason) => {
    const f = failedOrder(overrides)
    const result = await record(f)
    expect(result.status).toBe('refused')
    expect(result.status === 'refused' ? result.reasons.join('\n') : '').toMatch(reason)
    expect(f.payload.update).not.toHaveBeenCalled()
    expect(auditRows(f)).toEqual([])
  })

  it.each([
    ['üres szám', { invoiceNumber: '   ' }, /üres/u],
    ['szóköz a számban', { invoiceNumber: 'E KIN 2026 42' }, /szóköz/u],
    ['vezérlőkarakter a számban', { invoiceNumber: 'E-KIN-2026-42\u0007' }, /nem nyomtatható/u],
    ['túl hosszú szám', { invoiceNumber: `E-${'9'.repeat(63)}` }, /túl hosszú/u],
    ['nem ISO dátum', { completionDate: '2026.09.05.' }, /ÉÉÉÉ-HH-NN/u],
    ['lehetetlen dátum', { completionDate: '2026-02-30' }, /ÉÉÉÉ-HH-NN/u],
    ['jövőbeli dátum', { completionDate: '2999-01-01' }, /jövőben/u],
  ] as const)('%s', async (_label, input, reason) => {
    const f = failedOrder()
    const result = await record(f, input)
    expect(result.status).toBe('refused')
    expect(result.status === 'refused' ? result.reasons.join('\n') : '').toMatch(reason)
    expect(f.payload.update).not.toHaveBeenCalled()
  })

  it('a szám egy másik rendelés számlája, stornója vagy helyesbítője: elutasít', async () => {
    const f = failedOrder()
    const others = [
      { id: 90, orderNumber: 'KH-2026-000090', invoiceNumber: 'E-KIN-2026-40' },
      { id: 91, orderNumber: 'KH-2026-000091', stornoNumber: 'E-KIN-2026-42' },
    ]
    const find = f.payload.find as unknown as ReturnType<typeof vi.fn>
    const original = find.getMockImplementation() as (args: unknown) => Promise<unknown>
    // A többi rendelés tárolója: a feltételt ténylegesen kiértékeli (and/or/equals/not_equals).
    const matches = (doc: Record<string, unknown>, where: Record<string, unknown>): boolean =>
      Object.entries(where).every(([key, condition]) => {
        if (key === 'and')
          return (condition as Array<Record<string, unknown>>).every((w) => matches(doc, w))
        if (key === 'or')
          return (condition as Array<Record<string, unknown>>).some((w) => matches(doc, w))
        const rule = condition as { equals?: unknown; not_equals?: unknown }
        if ('equals' in rule) return doc[key] === rule.equals
        if ('not_equals' in rule) return doc[key] !== rule.not_equals
        return false
      })
    find.mockImplementation(
      async (args: { collection: string; where?: Record<string, unknown> }) => {
        if (args.collection === 'orders' && args.where && 'and' in args.where) {
          const docs = others.filter((doc) => matches(doc, args.where!))
          return { docs, totalDocs: docs.length, hasNextPage: false }
        }
        return original(args)
      },
    )

    const clash = await record(f)
    expect(clash.status).toBe('refused')
    expect(clash.status === 'refused' ? clash.reasons.join('\n') : '').toContain('KH-2026-000091')
    expect(f.payload.update).not.toHaveBeenCalled()

    // Negatív kontroll: egyedi számmal ugyanez a rendelés rögzíthető.
    await expect(record(f, { invoiceNumber: 'E-KIN-2026-44' })).resolves.toMatchObject({
      status: 'recorded',
    })
  })

  it('nincs ilyen rendelésszám: elutasít zár és írás nélkül', async () => {
    const f = failedOrder()
    const find = f.payload.find as unknown as ReturnType<typeof vi.fn>
    find.mockImplementation(async () => ({ docs: [], totalDocs: 0, hasNextPage: false }))
    const result = await record(f)
    expect(result).toMatchObject({ status: 'refused' })
    expect(locks.events).toEqual([])
    expect(f.payload.update).not.toHaveBeenCalled()
  })
})

describe('dátum és előtag', () => {
  it('a teljesítés napja a budapesti naptár szerint számít: UTC szerint még tegnap van, Budapesten már ma', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-24T22:30:00.000Z'))
    const f = failedOrder()
    await expect(record(f, { completionDate: '2026-09-25', dryRun: true })).resolves.toMatchObject({
      status: 'dry-run',
    })
    const tomorrow = await record(f, { completionDate: '2026-09-26', dryRun: true })
    expect(tomorrow.status).toBe('refused')
  })

  it('más sorozatú számot rögzít, de figyelmeztet; a beállított előtagú e-számla nem figyelmeztet', async () => {
    const f = failedOrder()
    const own = await record(f, { invoicePrefix: 'KIN', dryRun: true })
    expect(own.warnings.filter((warning) => warning.includes('előtag'))).toEqual([])
    const foreign = await record(f, {
      invoicePrefix: 'KIN',
      invoiceNumber: 'SZLA-2026-7',
      dryRun: true,
    })
    expect(foreign.status).toBe('dry-run')
    expect(foreign.warnings.join('\n')).toContain('„KIN” előtaggal')
  })
})

function cliLog() {
  const lines: string[] = []
  const log: Logger = {
    debug: () => {},
    info: (message) => {
      lines.push(message)
    },
    warn: (message) => {
      lines.push(message)
    },
    error: (message) => {
      lines.push(message)
    },
    child: () => log,
  }
  return { log, lines }
}

describe('a CLI határa: kapcsolók, megerősítő kapu, kilépési kód', () => {
  const argv = [
    '--order',
    'KH-2026-000011',
    '--invoice=E-KIN-2026-42',
    '--teljesites',
    '2026-09-05',
  ]

  it.each([
    ['nincs beállítva', {}],
    ['más érték', { [MANUAL_INVOICE_CONFIRM_ENV]: 'yes' }],
  ])('megerősítés nélkül (%s) próbafutás: 0-s kód, írás nélkül', async (_label, env) => {
    const f = failedOrder()
    const { log, lines } = cliLog()
    await expect(runRecordManualInvoice({ payload: f.payload, argv, env, log })).resolves.toBe(0)
    expect(f.payload.update).not.toHaveBeenCalled()
    expect(lines.join('\n')).toContain('PRÓBAFUTÁS')
    expect(lines).not.toContain('MANUAL_INVOICE_RECORD_OK')
  })

  it('OWNER_MANUAL_INVOICE_CONFIRM=igen: ír, és OK-val zár', async () => {
    const f = failedOrder()
    const { log, lines } = cliLog()
    const env = { [MANUAL_INVOICE_CONFIRM_ENV]: ' Igen ' }
    await expect(runRecordManualInvoice({ payload: f.payload, argv, env, log })).resolves.toBe(0)
    expect(f.order).toMatchObject({ invoiceStatus: 'issued', invoiceNumber: 'E-KIN-2026-42' })
    expect(lines).toContain('MANUAL_INVOICE_RECORD_OK')
  })

  it('elutasításnál 1-es kód, és kiírja az okot', async () => {
    const f = failedOrder({ invoiceStatus: 'pending' })
    const { log, lines } = cliLog()
    const env = { [MANUAL_INVOICE_CONFIRM_ENV]: 'igen' }
    await expect(runRecordManualInvoice({ payload: f.payload, argv, env, log })).resolves.toBe(1)
    expect(lines.join('\n')).toContain('még folyamatban')
    expect(f.payload.update).not.toHaveBeenCalled()
  })

  it.each([
    [['--order', 'KH-2026-000011']],
    [['--order', 'KH-2026-000011', '--invoice']],
    [['--order', 'KH-2026-000011', '--invoice', 'E-KIN-2026-42', '--szamla', 'x']],
    [['--order', 'A', '--order', 'B', '--invoice', 'E-KIN-2026-42']],
  ])('hibás kapcsolók (%j): 2-es kód, adatbázis nélkül', async (badArgv) => {
    const f = failedOrder()
    const { log } = cliLog()
    const env = { [MANUAL_INVOICE_CONFIRM_ENV]: 'igen' }
    await expect(
      runRecordManualInvoice({ payload: f.payload, argv: badArgv, env, log }),
    ).resolves.toBe(2)
    expect(f.payload.find).not.toHaveBeenCalled()
  })
})
