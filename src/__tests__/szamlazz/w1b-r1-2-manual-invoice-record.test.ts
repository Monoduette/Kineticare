import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  parseManualInvoiceArgs,
  runRecordManualInvoice,
  type ManualInvoiceArgs,
} from '../../scripts/record-manual-invoice'

/**
 * A kézzel kiállított számla számának rögzítése (W1B-3, W1B-7): a K12 kapu
 * egyetlen kijárata a 'failed' számlájú rendelésnél. A szabályokat a
 * modul határán (recordManualInvoiceNumber), a CLI határán
 * (runRecordManualInvoice: megerősítő kapu, kilépési kód, kimenet) és a
 * script valódi belépési pontján (kapcsolók a Payload indítása előtt) nézzük.
 */

const STOPPED = 'A számla automatikus kiállítása leállt: SYNTHETIC'
const repo = fileURLToPath(new URL('../../../', import.meta.url))

afterEach(() => {
  vi.useRealTimers()
})

function failedOrder(overrides: Record<string, unknown> = {}) {
  const f = fixture()
  Object.assign(f.order, {
    orderNumber: 'KH-2026-000011',
    createdAt: '2026-09-05T09:55:00.000Z',
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

const reasonsOf = (result: Awaited<ReturnType<typeof record>>) =>
  result.status === 'refused' ? result.reasons.join('\n') : ''

describe('rögzítés a failed számlájú, fizetett rendelésen', () => {
  it('próbafutás: kiírja a változást és a számlával összevetendő adatokat, és semmit nem ír', async () => {
    const f = failedOrder()
    const result = await record(f, { dryRun: true })
    expect(result).toMatchObject({
      status: 'dry-run',
      invoiceNumber: 'E-KIN-2026-42',
      completionDate: '2026-09-05',
      before: { invoiceStatus: 'failed', invoiceNumber: null },
      facts: { totalHuf: 20000, paidDate: null, refunds: [] },
      warnings: [],
    })
    expect(f.payload.update).not.toHaveBeenCalled()
    expect(auditRows(f)).toEqual([])
    expect(f.order).toMatchObject({ invoiceStatus: 'failed', invoiceNumber: null })
  })

  it('éles futás: issued + szám + teljesítés, a hiba szövege marad, egy műveletnapló-sor a zár alatt, a futtatóval', async () => {
    const f = failedOrder()
    const heldAtWrite: Array<{ collection: string; held: string[] }> = []
    for (const method of ['update', 'create'] as const) {
      const mock = f.payload[method] as unknown as ReturnType<typeof vi.fn>
      const original = mock.getMockImplementation() as (args: unknown) => Promise<unknown>
      mock.mockImplementation(async (args: { collection: string }) => {
        heldAtWrite.push({ collection: args.collection, held: [...locks.held] })
        return original(args)
      })
    }
    const result = await record(f, { operator: 'teszt-uzemelteto' })
    expect(result).toMatchObject({ status: 'recorded', auditRecorded: true })
    expect(f.order).toMatchObject({
      invoiceStatus: 'issued',
      invoiceNumber: 'E-KIN-2026-42',
      invoiceCompletionDate: '2026-09-05',
      invoiceLastError: STOPPED,
    })
    // A rendelés írása és a műveletnapló-sor is a számlakiállító zárja alatt.
    const lock = `invoice:${f.order.id}`
    expect(heldAtWrite).toEqual([
      { collection: 'orders', held: [lock] },
      { collection: 'audit-logs', held: [lock] },
    ])
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
          operator: 'teszt-uzemelteto',
        }),
      }),
    ])
  })

  it('a másolt szóközt és sortörést a két szélén levágja: a rendelést megtalálja, és a tiszta számot rögzíti', async () => {
    const f = failedOrder()
    const result = await record(f, {
      orderNumber: ' KH-2026-000011 ',
      invoiceNumber: '\tE-KIN-2026-42\n',
    })
    expect(result).toMatchObject({ status: 'recorded', invoiceNumber: 'E-KIN-2026-42' })
    expect(f.order.invoiceNumber).toBe('E-KIN-2026-42')
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
    expect(reasonsOf(result)).toMatch(reason)
    expect(f.payload.update).not.toHaveBeenCalled()
    expect(auditRows(f)).toEqual([])
  })

  it.each([
    ['üres szám', { invoiceNumber: '   ' }, /üres/u],
    ['szóköz a számban', { invoiceNumber: 'E KIN 2026 42' }, /szóköz/u],
    ['vezérlőkarakter a számban', { invoiceNumber: 'E-KIN-2026-42\u0007' }, /nem fordul elő/u],
    // Az alakra jó, csak túl hosszú szám: egyedül a hossz az ok.
    ['túl hosszú szám', { invoiceNumber: `E-KIN-2026-${'9'.repeat(54)}` }, /túl hosszú/u],
    // W1B-3 törő B3: PDF-ből másolt, kötőjelnek látszó jelek és egy cirill betű.
    ['U+2010 kötőjel', { invoiceNumber: 'E‐KIN‐2026‐42' }, /nem fordul elő/u],
    ['U+2011 nem törő kötőjel', { invoiceNumber: 'E‑KIN‑2026‑42' }, /nem fordul elő/u],
    ['U+2013 nagykötőjel', { invoiceNumber: 'E–KIN–2026–42' }, /nem fordul elő/u],
    ['cirill К', { invoiceNumber: 'E-КIN-2026-42' }, /nem fordul elő/u],
    // Rev2 (vezető): csevegőüzenetből másolt szám, a végén írásjellel, és kisbetű.
    ['a végén pont', { invoiceNumber: 'E-KIN-2026-42.' }, /nem fordul elő/u],
    ['a végén vessző', { invoiceNumber: 'E-KIN-2026-42,' }, /nem fordul elő/u],
    ['a végén zárójel', { invoiceNumber: 'E-KIN-2026-42)' }, /nem fordul elő/u],
    ['a végén idézőjel', { invoiceNumber: 'E-KIN-2026-42"' }, /nem fordul elő/u],
    ['kisbetűs szám', { invoiceNumber: 'e-kin-2026-42' }, /nem fordul elő/u],
    // A jelek jók, az alak nem a Számlázz.hu sorszámáé.
    [
      'kötőjel az előtagban',
      { invoiceNumber: 'E-KIN-B-2026-42' },
      /nem a Számlázz\.hu sorszámának alakja/u,
    ],
    [
      'hatjegyű előtag',
      { invoiceNumber: 'E-KINETI-2026-42' },
      /nem a Számlázz\.hu sorszámának alakja/u,
    ],
    ['kétjegyű év', { invoiceNumber: 'E-KIN-26-42' }, /nem a Számlázz\.hu sorszámának alakja/u],
    ['hiányzó sorszám', { invoiceNumber: 'E-KIN-2026-' }, /nem a Számlázz\.hu sorszámának alakja/u],
    ['csak a sorszám', { invoiceNumber: '42' }, /nem a Számlázz\.hu sorszámának alakja/u],
    // W1B-3 törő B2: a teljesítés dátuma kötelező.
    [
      'kihagyott teljesítési dátum',
      { completionDate: undefined as unknown as string },
      /Hiányzik a teljesítés dátuma/u,
    ],
    ['üres teljesítési dátum', { completionDate: '' }, /Hiányzik a teljesítés dátuma/u],
    ['csupa szóköz dátum', { completionDate: '   ' }, /Hiányzik a teljesítés dátuma/u],
    ['nem ISO dátum', { completionDate: '2026.09.05.' }, /ÉÉÉÉ-HH-NN/u],
    ['lehetetlen dátum', { completionDate: '2026-02-30' }, /ÉÉÉÉ-HH-NN/u],
    ['jövőbeli dátum', { completionDate: '2999-01-01' }, /jövőben/u],
    // B2c: évszám-elütés, vagy egy korábbi, ugyanezt a rendelésszámot viselő
    // rendelés számlája (rev2, vezető); a rendelés 2026-09-05-i.
    [
      'a rendelés előtti dátum',
      { completionDate: '2025-09-05' },
      /korábbi, mint a rendelés[\s\S]*évszámot[\s\S]*nem ehhez a rendeléshez tartozik[\s\S]*ne rögzítsd/u,
    ],
  ] as const)('%s', async (_label, input, reason) => {
    const f = failedOrder()
    const result = await record(f, input)
    expect(result.status).toBe('refused')
    expect(reasonsOf(result)).toMatch(reason)
    expect(f.payload.update).not.toHaveBeenCalled()
    expect(auditRows(f)).toEqual([])
  })

  // Minden ágnak saját esete van: egy vagy-feltétel törlése a saját esetét
  // buktatja (a tároló-mock a feltételt ténylegesen kiértékeli).
  it.each(['invoiceNumber', 'stornoNumber', 'correctiveInvoiceNumber'] as const)(
    'a szám egy másik rendelés %s mezőjében áll: elutasít, egyedi számmal rögzít',
    async (field) => {
      const f = failedOrder()
      const other = { id: 90, orderNumber: 'KH-2026-000090', [field]: 'E-KIN-2026-42' }
      const find = f.payload.find as unknown as ReturnType<typeof vi.fn>
      const original = find.getMockImplementation() as (args: unknown) => Promise<unknown>
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
            const docs = [other].filter((doc) => matches(doc, args.where!))
            return { docs, totalDocs: docs.length, hasNextPage: false }
          }
          return original(args)
        },
      )

      const clash = await record(f)
      expect(clash.status).toBe('refused')
      expect(reasonsOf(clash)).toContain('KH-2026-000090')
      expect(f.payload.update).not.toHaveBeenCalled()
      expect(auditRows(f)).toEqual([])

      // Negatív kontroll: egyedi számmal ugyanez a rendelés rögzíthető.
      await expect(record(f, { invoiceNumber: 'E-KIN-2026-44' })).resolves.toMatchObject({
        status: 'recorded',
      })
    },
  )

  // A 05-ös útmutató szerint a próbafutás minden okot kiír, amiért nem írna:
  // az ütközés sem derülhet ki csak az éles futáskor.
  it('a próbafutás is kimutatja, ha a szám egy másik rendelésen áll', async () => {
    const f = failedOrder()
    const find = f.payload.find as unknown as ReturnType<typeof vi.fn>
    const original = find.getMockImplementation() as (args: unknown) => Promise<unknown>
    find.mockImplementation(
      async (args: { collection: string; where?: Record<string, unknown> }) =>
        args.collection === 'orders' && args.where && 'and' in args.where
          ? { docs: [{ id: 90, orderNumber: 'KH-2026-000090' }], totalDocs: 1, hasNextPage: false }
          : original(args),
    )
    const result = await record(f, { dryRun: true })
    expect(result.status).toBe('refused')
    expect(reasonsOf(result)).toContain('KH-2026-000090')
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

describe('dátum, előtag és a számlával összevetendő adatok', () => {
  it('a jövő a budapesti naptár szerint számít: UTC szerint még tegnap van, Budapesten már ma', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-24T22:30:00.000Z'))
    const f = failedOrder({ createdAt: '2026-09-20T10:00:00.000Z' })
    await expect(record(f, { completionDate: '2026-09-25', dryRun: true })).resolves.toMatchObject({
      status: 'dry-run',
    })
    const tomorrow = await record(f, { completionDate: '2026-09-26', dryRun: true })
    expect(tomorrow.status).toBe('refused')
  })

  it('a rendelés napja is budapesti: az UTC szerint előző napi, Budapesten éjfél utáni rendelés napja előtti dátum elutasítva', async () => {
    // 2026-09-04T22:30Z = 2026-09-05 00:30 Budapesten.
    const f = failedOrder({ createdAt: '2026-09-04T22:30:00.000Z' })
    const before = await record(f, { completionDate: '2026-09-04', dryRun: true })
    expect(reasonsOf(before)).toMatch(
      /korábbi, mint a rendelés létrehozásának napja \(2026-09-05\)/u,
    )
    await expect(record(f, { completionDate: '2026-09-05', dryRun: true })).resolves.toMatchObject({
      status: 'dry-run',
    })
  })

  // A Számlázz.hu sorszáma ELŐTAG-ÉV-SORSZÁM, e-számlán E- kezdettel; az
  // előtag legfeljebb 5 nagybetű vagy számjegy. Az előtagot a szám alakjából
  // olvassuk ki, és pontosan vetjük össze a beállítottal.
  it.each([
    ['saját e-számla', 'E-KIN-2026-42', false],
    ['saját papírszámla', 'KIN-2026-42', false],
    ['más sorozat (ötjegyű előtag számjeggyel)', 'SZLA2-2026-7', true],
    ['az előtag csak tartalmazza a beállítottat', 'E-AKIN-2026-42', true],
    ['az előtag a beállítottal kezdődik', 'KINB-2026-42', true],
  ] as const)('%s: rögzíthető, előtag-figyelmeztetés: %s', async (_label, invoiceNumber, warns) => {
    const f = failedOrder()
    const result = await record(f, { invoicePrefix: 'KIN', invoiceNumber, dryRun: true })
    expect(result.status).toBe('dry-run')
    const prefixWarnings = result.warnings.filter((warning) => warning.includes('„KIN” előtaggal'))
    expect(prefixWarnings).toHaveLength(warns ? 1 : 0)
  })

  // A számlakiállító a nem egyeztethető (idegen vagy sztornózott) talált
  // bizonylat számát a hibaszövegbe írja. Ha éppen azt rögzítenénk, hangos
  // figyelmeztetés kell (a lekérdezés hiányos válasza miatt mégis lehet a
  // rendelésé, ezért nem tiltás). Egy hosszabb szám részeként nem találat.
  it.each([
    ['éppen ezt a számot', 'E-KIN-2026-42', true],
    ['egy hosszabb számot, amelynek ez az eleje', 'E-KIN-2026-421', false],
  ] as const)(
    'a korábbi hibaszöveg %s említi: figyelmeztetés: %s',
    async (_label, rejectedNumber, warns) => {
      const f = failedOrder({
        invoiceLastError: `A számla automatikus kiállítása leállt: a(z) KH-2026-000011-11-1757066100 külső azonosítón talált ${rejectedNumber} számú bizonylat nem egyeztethető ezzel a rendeléssel (a bizonylat bruttó végösszege 30000 Ft, a rendelésé 20000 Ft).`,
      })
      // Más előtag is be van állítva, így egy második figyelmeztetés is van:
      // a hibaszövegre utaló az első, azt olvassa elsőként az üzemeltető.
      const result = await record(f, { dryRun: true, invoicePrefix: 'SZLA' })
      expect(result.status).toBe('dry-run')
      const identity = result.warnings.filter((warning) =>
        warning.includes('„Számlázás utolsó hibája” mezője éppen ezt a számot'),
      )
      expect(identity).toHaveLength(warns ? 1 : 0)
      expect(result.warnings).toHaveLength(warns ? 2 : 1)
      if (warns) {
        expect(identity[0]).toMatch(/a vevő neve és a végösszeg is ugyanaz/u)
        expect(result.warnings[0]).toBe(identity[0])
      }
    },
  )

  it('ha a fizetés napja nem olvasható, a próbafutás figyelmeztet, és nem állít dátum-egyezést', async () => {
    const f = failedOrder()
    const findByID = f.payload.findByID as unknown as ReturnType<typeof vi.fn>
    const original = findByID.getMockImplementation() as (args: unknown) => Promise<unknown>
    findByID.mockImplementation(async (args: { collection: string }) => {
      if (args.collection === 'users') throw new Error('SYNTHETIC olvasási hiba')
      return original(args)
    })
    const result = await record(f, { dryRun: true })
    expect(result).toMatchObject({ status: 'dry-run', facts: { paidDate: null } })
    expect(result.warnings.join('\n')).toContain('A fizetés napja most nem olvasható')
  })

  it('a fizetés napját és a korábbi visszatérítést kiírja, és figyelmeztet az eltérő teljesítési dátumra', async () => {
    const f = failedOrder({
      refunds: [
        {
          transactionId: 'SYNTHETIC-TX',
          amountHuf: 5000,
          status: 'Succeeded',
          refundedAt: '2026-09-09T22:30:00.000Z',
          type: 'partial',
        },
      ],
    })
    Object.assign(f.user, {
      accessGrants: [
        {
          product: 42,
          grantedAt: '2026-09-05T10:00:00.000Z',
          sourceKind: 'order',
          sourceOrder: f.order.id,
        },
      ],
    })
    const result = await record(f, { completionDate: '2026-09-06', dryRun: true })
    expect(result).toMatchObject({
      status: 'dry-run',
      facts: {
        totalHuf: 20000,
        paidDate: '2026-09-05',
        refunds: [{ amountHuf: 5000, refundedAt: '2026-09-09T22:30:00.000Z', type: 'partial' }],
      },
    })
    const warnings = result.warnings.join('\n')
    expect(warnings).toContain('(2026-09-06) eltér a fizetés napjától (2026-09-05)')
    // A visszatérítés budapesti napja 2026-09-10 (UTC szerint még 09-09).
    expect(warnings).toMatch(/már van visszatérítés \(2026-09-10: 5\s?000\sFt\)/u)
    expect(f.payload.update).not.toHaveBeenCalled()

    // Negatív kontroll: a fizetés napjával nincs dátum-figyelmeztetés.
    const same = await record(f, { completionDate: '2026-09-05', dryRun: true })
    expect(same.warnings.join('\n')).not.toContain('eltér a fizetés napjától')
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
  const args = parseManualInvoiceArgs(argv) as ManualInvoiceArgs

  it('a kapcsolók mindkét alakja beolvasható', () => {
    expect(args).toEqual({
      order: 'KH-2026-000011',
      invoice: 'E-KIN-2026-42',
      teljesites: '2026-09-05',
    })
  })

  it.each([
    ['nincs beállítva', {}],
    ['más érték', { [MANUAL_INVOICE_CONFIRM_ENV]: 'yes' }],
  ])(
    'megerősítés nélkül (%s) próbafutás: 0-s kód, írás nélkül, a számlával összevetendő adatokkal',
    async (_label, env) => {
      const f = failedOrder()
      const { log, lines } = cliLog()
      await expect(runRecordManualInvoice({ payload: f.payload, args, env, log })).resolves.toBe(0)
      expect(f.payload.update).not.toHaveBeenCalled()
      const output = lines.join('\n')
      expect(output).toContain('PRÓBAFUTÁS')
      expect(output).toContain('végösszeg a megrendeléskor: 20')
      // A rendelésszám nem egyedi: a próbafutás a vevőnév összevetésére is emlékeztet.
      expect(output).toMatch(/a vevő neve: .*ha a számla más vevőé, ne rögzítsd/u)
      expect(lines).not.toContain('MANUAL_INVOICE_RECORD_OK')
    },
  )

  it('OWNER_MANUAL_INVOICE_CONFIRM=igen: ír a teljesítési dátummal, a futtatót naplózza, és OK-val zár', async () => {
    const f = failedOrder()
    const { log, lines } = cliLog()
    const env = { [MANUAL_INVOICE_CONFIRM_ENV]: ' Igen ' }
    await expect(
      runRecordManualInvoice({ payload: f.payload, args, env, operator: 'uzemelteto', log }),
    ).resolves.toBe(0)
    expect(f.order).toMatchObject({
      invoiceStatus: 'issued',
      invoiceNumber: 'E-KIN-2026-42',
      invoiceCompletionDate: '2026-09-05',
    })
    expect(auditRows(f)).toEqual([
      expect.objectContaining({
        after: expect.objectContaining({
          invoiceCompletionDate: '2026-09-05',
          operator: 'uzemelteto',
        }),
      }),
    ])
    expect(lines).toContain('MANUAL_INVOICE_RECORD_OK')
  })

  it('ha a műveletnapló-sor nem jön létre: 1-es kód, OK nélkül, és kiírja, hogy a rögzítés megtörtént', async () => {
    const f = failedOrder()
    f.failures.receipt = MANUAL_INVOICE_RECORD_AUDIT_ACTION
    const { log, lines } = cliLog()
    const env = { [MANUAL_INVOICE_CONFIRM_ENV]: 'igen' }
    await expect(runRecordManualInvoice({ payload: f.payload, args, env, log })).resolves.toBe(1)
    expect(f.order).toMatchObject({ invoiceStatus: 'issued', invoiceNumber: 'E-KIN-2026-42' })
    expect(lines.join('\n')).toContain('a műveletnapló-sor nem jött létre')
    expect(lines).not.toContain('MANUAL_INVOICE_RECORD_OK')
  })

  // A Payload a hozzáférés miatt eldobott mezőt hiba nélkül hagyja ki a
  // mentésből: ha a rendelés nem lett 'issued', nem mondhatjuk, hogy
  // rögzítettük, és a műveletnaplóba sem kerülhet 'issued' sor (törő, rev2).
  it('ha a mentés csendben elhagyja a mezőket: hiba, OK nélkül, műveletnapló-sor nélkül', async () => {
    const f = failedOrder()
    const update = f.payload.update as unknown as ReturnType<typeof vi.fn>
    update.mockImplementation(async () => structuredClone(f.order))
    const { log, lines } = cliLog()
    const env = { [MANUAL_INVOICE_CONFIRM_ENV]: 'igen' }
    await expect(runRecordManualInvoice({ payload: f.payload, args, env, log })).rejects.toThrow(
      /nem a várt/u,
    )
    expect(lines).not.toContain('MANUAL_INVOICE_RECORD_OK')
    expect(auditRows(f)).toEqual([])
    expect(f.order).toMatchObject({ invoiceStatus: 'failed', invoiceNumber: null })
  })

  it('elutasításnál 1-es kód, és kiírja az okot', async () => {
    const f = failedOrder({ invoiceStatus: 'pending' })
    const { log, lines } = cliLog()
    const env = { [MANUAL_INVOICE_CONFIRM_ENV]: 'igen' }
    await expect(runRecordManualInvoice({ payload: f.payload, args, env, log })).resolves.toBe(1)
    expect(lines.join('\n')).toContain('még folyamatban')
    expect(f.payload.update).not.toHaveBeenCalled()
  })

  it.each([
    [['--order', 'KH-2026-000011'], /kötelező/u],
    [['--order', 'KH-2026-000011', '--invoice', 'E-KIN-2026-42'], /--teljesites kötelező/u],
    [['--order', 'KH-2026-000011', '--invoice', '--teljesites', '2026-09-05'], /érték kell/u],
    [
      ['--order', 'KH-2026-000011', '--invoice', 'E-KIN-2026-42', '--szamla', 'x'],
      /Ismeretlen kapcsoló: --szamla/u,
    ],
    [
      ['--order', 'A', '--order', 'B', '--invoice', 'E-KIN-2026-42', '--teljesites', '2026-09-05'],
      /kétszer szerepel/u,
    ],
  ] as const)(
    'hibás kapcsolók (%j): kapcsolók helyett a magyar okot adja vissza',
    (badArgv, reason) => {
      const parsed = parseManualInvoiceArgs(badArgv)
      expect(typeof parsed).toBe('string')
      expect(parsed).toMatch(reason)
    },
  )
})

describe('a script belépési pontja', () => {
  // A valódi indítás, ahogy az üzemeltető futtatja. A környezet szándékosan
  // üres (nincs DATABASE_URI, PAYLOAD_SECRET): ha a script a kapcsolók előtt
  // indítaná a Payloadot, itt 1-es kóddal, „missing secret key” hibával állna le.
  it('hiányzó --teljesites: 2-es kód és a használati sor, a Payload indítása nélkül', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'src/scripts/record-manual-invoice.ts',
        '--order',
        'KH-2026-000011',
        '--invoice',
        'E-KIN-2026-42',
      ],
      {
        cwd: repo,
        env: { PATH: dirname(process.execPath), NODE_ENV: 'test', LANG: 'C' },
        encoding: 'utf8',
        timeout: 60_000,
      },
    )
    const output = `${result.stdout}${result.stderr}`
    expect(result.status).toBe(2)
    expect(output).toContain('Használat: npm run record:manual-invoice')
    expect(output).toContain('--teljesites')
    expect(output).not.toContain('hiba történt')
  }, 90_000)
})
