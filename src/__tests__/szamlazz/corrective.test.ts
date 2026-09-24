import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

// These pre-ledger fixtures exercise the unchanged legacy invoice contract.
vi.mock('../../lib/refund/intent-store', () => ({ loadRefundIntentsForOrder: async () => [] }))

import { getSzamlazzConfig } from '../../lib/szamlazz/client'
import {
  buildCorrectiveInvoiceXml,
  CORRECTIVE_KULSO_AZON_INFIX,
  correctiveKulsoAzon,
  isRetryableCorrectiveError,
  issueCorrectiveInvoiceForOrder,
  MAX_CORRECTIVE_ATTEMPTS,
} from '../../lib/szamlazz/corrective'
import { computeLineAmounts, VAT_RATE_PERCENT } from '../../lib/szamlazz/invoice'
import type { InvoiceLookupResult } from '../../lib/szamlazz/pdf'
import { SzamlazzApiError } from '../../lib/szamlazz/types'
import type { Order } from '../../payload-types'

/**
 * Helyesbítő (módosító) számla egységtesztek (C5) — RÉSZLEGES visszatérítés
 * bizonylata: ugyanaz az xmlszamla-művelet, de
 * <helyesbitoszamla>true</helyesbitoszamla> + <helyesbitettSzamlaszam> az
 * eredeti számlára, és negatív korrekciós tétel a visszatérített összegre.
 *
 * DUMMY érték, egyértelműen jelölve — NEM valódi Számla Agent kulcs.
 */
const DUMMY_AGENT_KEY = 'DUMMY-AGENT-KULCS-NEM-VALODI-TITOK'

const ORDER_NUMBER = 'KH-2026-000123'
const ORIGINAL_INVOICE_NUMBER = 'KIN-2026-7'
const TOTAL_HUF = 19990
const REFUND_HUF = 5000

// Az áfakulcs 2026-08-17 óta KÖTELEZŐ bekapcsolt számlázásnál (a csendes '27'
// alapértelmezés megszűnt) — a fixtúra ezért kimondja.
const ENABLED_CONFIG = getSzamlazzConfig({
  SZAMLAZZ_AGENT_KEY: DUMMY_AGENT_KEY,
  SZAMLAZZ_AFAKULCS: '27',
})

/**
 * A bizonylat-lekérdezés MINDEN folyamat-tesztben injektált: injektálás nélkül a
 * retry- és a duplikátum-ág a VALÓDI Számlázz.hu-t hívná meg. A noLookup azokra
 * az ágakra való, ahol lekérdezésnek egyáltalán nem szabad futnia (korai
 * kilépés) — ha mégis fut, hangosan bukik. A kimerült plafonnál H3 óta a
 * záró lekérdezés lefut. Az emptyLookup a
 * beküldés előtti kapu „nincs találat" ága: a lekérdezés lefut, a POST mehet.
 */
const noLookup = async (): Promise<InvoiceLookupResult | null> => {
  throw new Error('TESZT-HIBA: ezen az ágon nem futhat bizonylat-lekérdezés')
}

const emptyLookup = async (): Promise<InvoiceLookupResult | null> => null

const BUYER = {
  nev: 'Teszt Anna',
  irsz: '1111',
  telepules: 'Budapest',
  cim: 'Példa utca 1.',
  email: 'anna@example.test',
}

function createOrder(overrides: Record<string, unknown> = {}): Order {
  return {
    id: 101,
    orderNumber: ORDER_NUMBER,
    status: 'paid',
    invoiceStatus: 'issued',
    invoiceNumber: ORIGINAL_INVOICE_NUMBER,
    correctiveInvoiceStatus: 'none',
    correctiveInvoiceSeq: 0,
    customerEmail: BUYER.email,
    totalHufSnapshot: TOTAL_HUF,
    items: [
      { product: 42, quantity: 1, titleSnapshot: 'DEMO-KEZREHAB-001', priceHufSnapshot: TOTAL_HUF },
    ],
    customerSnapshot: {
      name: BUYER.nev,
      email: BUYER.email,
      billingName: BUYER.nev,
      billingZip: BUYER.irsz,
      billingCity: BUYER.telepules,
      billingStreet: BUYER.cim,
    },
    ...overrides,
  } as unknown as Order
}

/** Szint + üzenet naplórögzítő (a RIASZTÁS-sorok ellenőrzéséhez). */
function captureLogs() {
  const logged: Array<{ level: 'debug' | 'info' | 'warn' | 'error'; message: string }> = []
  const logger = {
    debug: (message: string) => logged.push({ level: 'debug', message }),
    info: (message: string) => logged.push({ level: 'info', message }),
    warn: (message: string) => logged.push({ level: 'warn', message }),
    error: (message: string) => logged.push({ level: 'error', message }),
    child: () => logger,
  }
  return { logger, logged }
}

function createMockPayload(order: Order | null) {
  const updates: Array<Record<string, unknown>> = []
  const payload = {
    update: async ({ data }: { data: Record<string, unknown> }) => {
      updates.push(data)
      if (order) {
        Object.assign(order, data)
      }
      return order
    },
  }
  return { payload: payload as unknown as Payload, updates, order }
}

describe('buildCorrectiveInvoiceXml — helyesbítő számla séma', () => {
  const xml = buildCorrectiveInvoiceXml({
    agentKey: DUMMY_AGENT_KEY,
    originalInvoiceNumber: ORIGINAL_INVOICE_NUMBER,
    orderNumber: ORDER_NUMBER,
    invoicePrefix: 'KIN',
    refundSeq: 2,
    amountHuf: REFUND_HUF,
    issueDate: '2026-08-09',
    buyer: BUYER,
    reason: 'Kedvezmény utólag',
  })

  it('helyesbitoszamla=true ÉS helyesbitettSzamlaszam = az EREDETI számla száma', () => {
    expect(xml).toContain('<helyesbitoszamla>true</helyesbitoszamla>')
    expect(xml).toContain(
      `<helyesbitettSzamlaszam>${ORIGINAL_INVOICE_NUMBER}</helyesbitettSzamlaszam>`,
    )
  })

  it('a szamlaKulsoAzon a refund-sorszámmal képzett saját horgony (NEM az orderNumber)', () => {
    expect(xml).toContain(
      `<szamlaKulsoAzon>${ORDER_NUMBER}${CORRECTIVE_KULSO_AZON_INFIX}2</szamlaKulsoAzon>`,
    )
    expect(xml).not.toContain(`<szamlaKulsoAzon>${ORDER_NUMBER}</szamlaKulsoAzon>`)
    expect(correctiveKulsoAzon(ORDER_NUMBER, 2)).toBe(`${ORDER_NUMBER}-HELYESBITO-2`)
  })

  it('EGY negatív korrekciós tétel a visszatérített összegre; netto + afa = brutto', () => {
    const expected = computeLineAmounts(
      { megnevezes: 'x', mennyiseg: 1, bruttoEgysegar: REFUND_HUF },
      {},
    )
    expect(xml).toContain(`<bruttoErtek>-${expected.bruttoErtek}</bruttoErtek>`)
    expect(xml).toContain(`<nettoErtek>-${expected.nettoErtek}</nettoErtek>`)
    expect(xml).toContain(`<afaErtek>-${expected.afaErtek}</afaErtek>`)
    expect(xml).toContain(`<nettoEgysegar>-${expected.nettoEgysegar}</nettoEgysegar>`)
    expect(xml).toContain(`<afakulcs>${VAT_RATE_PERCENT}</afakulcs>`)
    // Pontosan egy tétel van a helyesbítőn.
    expect(xml.match(/<tetel>/g)).toHaveLength(1)
  })

  it('a megjegyzés az eredeti számlára és a visszatérítés indokára hivatkozik', () => {
    expect(xml).toContain(`Helyesbítő számla a(z) ${ORIGINAL_INVOICE_NUMBER} számú számlához`)
    expect(xml).toContain('indok: Kedvezmény utólag')
  })

  it('a vevőblokk a rendelés számlázási adataiból épül', () => {
    expect(xml).toContain(`<nev>${BUYER.nev}</nev>`)
    expect(xml).toContain(`<irsz>${BUYER.irsz}</irsz>`)
    expect(xml).toContain(`<email>${BUYER.email}</email>`)
  })

  it('a normál (nem helyesbítő) számlán a helyesbítő-tagok üresek maradnak', async () => {
    const { buildInvoiceXml } = await import('../../lib/szamlazz/invoice')
    const normal = buildInvoiceXml({
      agentKey: DUMMY_AGENT_KEY,
      orderNumber: ORDER_NUMBER,
      invoicePrefix: 'KIN',
      issueDate: '2026-08-09',
      buyer: BUYER,
      items: [{ megnevezes: 'Kurzus', mennyiseg: 1, bruttoEgysegar: TOTAL_HUF }],
    })
    expect(normal).toContain('<helyesbitoszamla>false</helyesbitoszamla>')
    expect(normal).toContain('<helyesbitettSzamlaszam></helyesbitettSzamlaszam>')
    expect(normal).toContain(`<szamlaKulsoAzon>${ORDER_NUMBER}</szamlaKulsoAzon>`)
  })
})

describe('computeLineAmounts — negatív (korrekciós) tétel', () => {
  it('a negatív összeg csak allowNegative mellett engedett', () => {
    expect(() =>
      computeLineAmounts({ megnevezes: 'x', mennyiseg: 1, bruttoEgysegar: -100 }),
    ).toThrow(SzamlazzApiError)
    expect(
      computeLineAmounts(
        { megnevezes: 'x', mennyiseg: 1, bruttoEgysegar: -100 },
        { allowNegative: true },
      ),
    ).toEqual({ nettoEgysegar: '-79', nettoErtek: -79, afaErtek: -21, bruttoErtek: -100 })
  })

  it('a kerekítés PONTOSAN az eredeti tétel tükre (teljes összegű helyesbítés nullázódik)', () => {
    const original = computeLineAmounts({
      megnevezes: 'x',
      mennyiseg: 1,
      bruttoEgysegar: TOTAL_HUF,
    })
    const correction = computeLineAmounts(
      { megnevezes: 'x', mennyiseg: 1, bruttoEgysegar: -TOTAL_HUF },
      { allowNegative: true },
    )
    expect(original.nettoErtek + correction.nettoErtek).toBe(0)
    expect(original.afaErtek + correction.afaErtek).toBe(0)
    expect(original.bruttoErtek + correction.bruttoErtek).toBe(0)
    expect(correction.nettoErtek + correction.afaErtek).toBe(correction.bruttoErtek)
  })
})

describe('issueCorrectiveInvoiceForOrder', () => {
  it('boldog út: pending → issued, a szám és a refund-sorszám a rendelésre kerül', async () => {
    const { payload, order, updates } = createMockPayload(createOrder())
    const sentXml: string[] = []
    const result = await issueCorrectiveInvoiceForOrder(order as Order, {
      payload,
      config: ENABLED_CONFIG,
      issueDate: '2026-08-09',
      queryByKulsoAzon: emptyLookup,
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      reason: 'Kedvezmény utólag',
      postXml: async (xml) => {
        sentXml.push(xml)
        return { szamlaszam: 'KIN-2026-9' }
      },
    })

    expect(result).toEqual({ outcome: 'issued', correctiveInvoiceNumber: 'KIN-2026-9' })
    // F1: a kísérlet-számláló a refund-sorszámhoz kulcsolva íródik.
    expect(updates[0]).toEqual({
      correctiveInvoiceStatus: 'pending',
      correctiveInvoiceAttempts: 1,
      correctiveInvoiceAttemptsSeq: 1,
    })
    expect(updates[1]).toEqual({
      correctiveInvoiceStatus: 'issued',
      correctiveInvoiceNumber: 'KIN-2026-9',
      correctiveInvoiceSeq: 1,
      correctiveInvoiceLastError: null,
    })
    expect(order?.correctiveInvoiceNumber).toBe('KIN-2026-9')
    expect(sentXml[0]).toContain(
      `<helyesbitettSzamlaszam>${ORIGINAL_INVOICE_NUMBER}</helyesbitettSzamlaszam>`,
    )
    expect(sentXml[0]).toContain(`<szamlaKulsoAzon>${ORDER_NUMBER}-HELYESBITO-1</szamlaKulsoAzon>`)
  })

  it('idempotens: ugyanahhoz a refund-sorszámhoz nem készül második helyesbítő', async () => {
    const order = createOrder({
      correctiveInvoiceStatus: 'issued',
      correctiveInvoiceNumber: 'KIN-2026-9',
      correctiveInvoiceSeq: 1,
    })
    const { payload, updates } = createMockPayload(order)
    let calls = 0
    const result = await issueCorrectiveInvoiceForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      queryByKulsoAzon: noLookup,
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      postXml: async () => {
        calls += 1
        return { szamlaszam: 'MASIK' }
      },
    })
    expect(result).toEqual({ outcome: 'already-issued', correctiveInvoiceNumber: 'KIN-2026-9' })
    expect(calls).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('a KÖVETKEZŐ részrefundhoz (nagyobb sorszám) viszont új helyesbítő készül', async () => {
    const order = createOrder({
      correctiveInvoiceStatus: 'issued',
      correctiveInvoiceNumber: 'KIN-2026-9',
      correctiveInvoiceSeq: 1,
    })
    const { payload } = createMockPayload(order)
    const sentXml: string[] = []
    const result = await issueCorrectiveInvoiceForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      queryByKulsoAzon: emptyLookup,
      refundSeq: 2,
      amountHuf: 2000,
      postXml: async (xml) => {
        sentXml.push(xml)
        return { szamlaszam: 'KIN-2026-10' }
      },
    })
    expect(result).toEqual({ outcome: 'issued', correctiveInvoiceNumber: 'KIN-2026-10' })
    expect(sentXml[0]).toContain(`<szamlaKulsoAzon>${ORDER_NUMBER}-HELYESBITO-2</szamlaKulsoAzon>`)
    expect(order.correctiveInvoiceSeq).toBe(2)
  })

  it('a KÉSŐBBI seq már kiállt, a KORÁBBI retry mégis továbbmegy a providerhez', async () => {
    // Sorrendtörés: a seq=1 kiállítása timeoutolt és jobba került, közben a
    // seq=2 inline sikerült (correctiveInvoiceSeq=2). A seq=1 retry-ja NEM
    // lehet no-op — a korábbi részrefund bizonylata még nem készült el; a
    // duplikáció ellen a provider-oldali kulsoAzon-horgony véd.
    const order = createOrder({
      correctiveInvoiceStatus: 'issued',
      correctiveInvoiceNumber: 'KIN-2026-10',
      correctiveInvoiceSeq: 2,
    })
    const { payload } = createMockPayload(order)
    const sentXml: string[] = []
    const result = await issueCorrectiveInvoiceForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      queryByKulsoAzon: emptyLookup,
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      postXml: async (xml) => {
        sentXml.push(xml)
        return { szamlaszam: 'KIN-2026-9' }
      },
    })
    expect(result).toEqual({ outcome: 'issued', correctiveInvoiceNumber: 'KIN-2026-9' })
    expect(sentXml[0]).toContain(`<szamlaKulsoAzon>${ORDER_NUMBER}-HELYESBITO-1</szamlaKulsoAzon>`)
    // A rendelésen rögzített LEGUTÓBBI szám/sorszám nem íródik vissza régebbire.
    expect(order.correctiveInvoiceSeq).toBe(2)
    expect(order.correctiveInvoiceNumber).toBe('KIN-2026-10')
    expect(order.correctiveInvoiceStatus).toBe('issued')
  })

  it('K4: más seq-es maradék job a lekérdezésen átveszi a meglévő helyesbítőt, nem POSTol', async () => {
    // leftover job refundSeq=1, miután a seq=2 már kiállt: a previousAttempts
    // 0 (más seq), de a lekérdezés AKKOR IS lefut. Találatnál adopt, vak POST nincs.
    const order = createOrder({
      correctiveInvoiceStatus: 'issued',
      correctiveInvoiceNumber: 'KIN-2026-10',
      correctiveInvoiceSeq: 2,
      correctiveInvoiceAttemptsSeq: 2,
      correctiveInvoiceAttempts: 1,
    })
    const { payload } = createMockPayload(order)
    const lookups: string[] = []
    let posts = 0
    const result = await issueCorrectiveInvoiceForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      queryByKulsoAzon: async (kulsoAzon) => {
        lookups.push(kulsoAzon)
        return { szamlaszam: 'KIN-2026-9' }
      },
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      postXml: async () => {
        posts += 1
        return { szamlaszam: 'VAK-POST' }
      },
    })

    expect(result).toEqual({ outcome: 'issued', correctiveInvoiceNumber: 'KIN-2026-9' })
    expect(lookups).toEqual([correctiveKulsoAzon(ORDER_NUMBER, 1)])
    expect(posts).toBe(0)
    // Korábbi seq átvétele: a rögzített seq/szám NEM íródik vissza.
    expect(order.correctiveInvoiceSeq).toBe(2)
    expect(order.correctiveInvoiceNumber).toBe('KIN-2026-10')
    expect(order.correctiveInvoiceStatus).toBe('issued')
  })

  it('kikapcsolt integrációnál disabled (a rendeléshez sem nyúl)', async () => {
    const { payload, order, updates } = createMockPayload(createOrder())
    const result = await issueCorrectiveInvoiceForOrder(order as Order, {
      payload,
      config: getSzamlazzConfig({}),
      queryByKulsoAzon: noLookup,
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      postXml: async () => expect.unreachable('nem hívható'),
    })
    expect(result.outcome).toBe('disabled')
    expect(updates).toHaveLength(0)
  })

  it('hiányzó eredeti számlaszámnál failed, NEM dob (emberi pótlás kell)', async () => {
    const order = createOrder({ invoiceNumber: null, invoiceStatus: 'failed' })
    const { payload } = createMockPayload(order)
    let calls = 0
    const result = await issueCorrectiveInvoiceForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      queryByKulsoAzon: noLookup,
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      postXml: async () => {
        calls += 1
        return { szamlaszam: 'X' }
      },
    })
    expect(result.outcome).toBe('failed')
    expect(result.reason).toContain('számlaszám')
    expect(calls).toBe(0)
    expect(order.correctiveInvoiceStatus).toBe('failed')
  })

  it('hiányos vevőadatnál failed (nem retryable)', async () => {
    const order = createOrder({ customerSnapshot: { name: 'Teszt Anna', email: BUYER.email } })
    const { payload } = createMockPayload(order)
    const result = await issueCorrectiveInvoiceForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      queryByKulsoAzon: noLookup,
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      postXml: async () => expect.unreachable('nem hívható'),
    })
    expect(result.outcome).toBe('failed')
    expect(result.reason).toContain('vevő')
  })

  it('érvénytelen összeg / sorszám → failed, hálózati hívás nélkül', async () => {
    const { payload, order } = createMockPayload(createOrder())
    const invalidAmount = await issueCorrectiveInvoiceForOrder(order as Order, {
      payload,
      config: ENABLED_CONFIG,
      queryByKulsoAzon: noLookup,
      refundSeq: 1,
      amountHuf: 0,
      postXml: async () => expect.unreachable('nem hívható'),
    })
    expect(invalidAmount.outcome).toBe('failed')
    const invalidSeq = await issueCorrectiveInvoiceForOrder(order as Order, {
      payload,
      config: ENABLED_CONFIG,
      queryByKulsoAzon: noLookup,
      refundSeq: 0,
      amountHuf: REFUND_HUF,
      postXml: async () => expect.unreachable('nem hívható'),
    })
    expect(invalidSeq.outcome).toBe('failed')
  })

  it('retryable provider-hibánál THROW + failed állapot (a job újrapróbálja)', async () => {
    const { payload, order } = createMockPayload(createOrder())
    const error = new SzamlazzApiError({ message: 'timeout', kind: 'timeout', retryable: true })
    await expect(
      issueCorrectiveInvoiceForOrder(order as Order, {
        payload,
        config: ENABLED_CONFIG,
        queryByKulsoAzon: emptyLookup,
        refundSeq: 1,
        amountHuf: REFUND_HUF,
        postXml: async () => {
          throw error
        },
      }),
    ).rejects.toThrow('timeout')
    expect(order?.correctiveInvoiceStatus).toBe('failed')
    expect(isRetryableCorrectiveError(error)).toBe(true)
  })

  it('agent-elutasításnál (nem retryable) failed kimenet, nem dob', async () => {
    const { payload, order } = createMockPayload(createOrder())
    const error = new SzamlazzApiError({
      message: 'Számla Agent elutasította a számlakiállítást: 259 — tételhiba',
      kind: 'agent',
      retryable: false,
    })
    const result = await issueCorrectiveInvoiceForOrder(order as Order, {
      payload,
      config: ENABLED_CONFIG,
      queryByKulsoAzon: emptyLookup,
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      postXml: async () => {
        throw error
      },
    })
    expect(result.outcome).toBe('failed')
    expect(isRetryableCorrectiveError(error)).toBe(false)
    expect(order?.correctiveInvoiceStatus).toBe('failed')
  })

  it('payload nélkül is működik (csak naplóz, DB-írás nincs)', async () => {
    const order = createOrder()
    const result = await issueCorrectiveInvoiceForOrder(order, {
      config: ENABLED_CONFIG,
      queryByKulsoAzon: emptyLookup,
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      postXml: async () => ({ szamlaszam: 'KIN-2026-9' }),
    })
    expect(result).toEqual({ outcome: 'issued', correctiveInvoiceNumber: 'KIN-2026-9' })
    expect(order.correctiveInvoiceNumber).toBeUndefined()
  })
})

/**
 * B4 (NAV-dátumszabály): a helyesbítő teljesítési dátumának naptári hónapja nem
 * térhet el az eredeti számláétól — ezért a helyesbítő az EREDETI teljesítési
 * dátumot (invoiceCompletionDate) ismétli meg, miközben a kelt-dátum a saját
 * kiállítási napja.
 */
describe('issueCorrectiveInvoiceForOrder — teljesítési dátum öröklése', () => {
  it('az eredeti számla teljesítési dátuma megy ki, a kelt viszont a mai kiállítás', async () => {
    const order = createOrder({ invoiceCompletionDate: '2026-07-15' })
    const { payload } = createMockPayload(order)
    const sentXml: string[] = []
    const result = await issueCorrectiveInvoiceForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      issueDate: '2026-08-09',
      queryByKulsoAzon: emptyLookup,
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      postXml: async (xml) => {
        sentXml.push(xml)
        return { szamlaszam: 'KIN-2026-9' }
      },
    })

    expect(result.outcome).toBe('issued')
    expect(sentXml[0]).toContain('<teljesitesDatum>2026-07-15</teljesitesDatum>')
    expect(sentXml[0]).toContain('<keltDatum>2026-08-09</keltDatum>')
  })

  it('rögzített teljesítési dátum nélkül a kiállítás napjára esik vissza (figyelmeztetéssel)', async () => {
    // Régi, a mező bevezetése előtti számláknál nincs mire visszanyúlni —
    // hónapforduló környékén ez kézi ellenőrzést kíván.
    const order = createOrder()
    const { payload } = createMockPayload(order)
    const sentXml: string[] = []
    await issueCorrectiveInvoiceForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      issueDate: '2026-08-09',
      queryByKulsoAzon: emptyLookup,
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      postXml: async (xml) => {
        sentXml.push(xml)
        return { szamlaszam: 'KIN-2026-9' }
      },
    })

    expect(sentXml[0]).toContain('<teljesitesDatum>2026-08-09</teljesitesDatum>')
    expect(sentXml[0]).toContain('<keltDatum>2026-08-09</keltDatum>')
  })
})

/**
 * A12/A14 — a helyesbítő ágon is: beküldés-ismétlés ELŐTT lekérdezés, a 71/152-es
 * duplikátum-jelzés feloldása, és a perzisztens beküldés-plafon. A lekérdezés
 * horgonya itt a helyesbítő SAJÁT kulsoAzon-ja (orderNumber-HELYESBITO-<seq>).
 */
describe('issueCorrectiveInvoiceForOrder — idempotencia-feloldás és kísérlet-plafon', () => {
  /** A 71/152-es duplikátum-jelzés (a Számlázz.hu „Már létező rendelésszám"-a). */
  function duplicateError(code: string): SzamlazzApiError {
    return new SzamlazzApiError({
      message: `Számla Agent hiba: ${code} — Már létező rendelésszám.`,
      kind: 'duplicate',
      agentErrors: [{ code, message: 'Már létező rendelésszám.' }],
      retryable: false,
    })
  }

  it('duplikátum-jelzés (71): a meglévő helyesbítő átvéve a saját kulsoAzon-nal', async () => {
    const order = createOrder()
    const { payload } = createMockPayload(order)
    const lookups: string[] = []
    const result = await issueCorrectiveInvoiceForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      queryByKulsoAzon: async (kulsoAzon) => {
        lookups.push(kulsoAzon)
        // K4: az első (beküldés előtti) lekérdezés üres — a 71-es ág a POST után fut.
        return lookups.length === 1 ? null : { szamlaszam: 'KIN-2026-11' }
      },
      refundSeq: 2,
      amountHuf: REFUND_HUF,
      postXml: async () => {
        throw duplicateError('71')
      },
    })

    expect(result).toEqual({ outcome: 'issued', correctiveInvoiceNumber: 'KIN-2026-11' })
    // NEM az orderNumber: a helyesbítőnek saját horgonya van a refund-sorszámmal.
    expect(lookups).toEqual([
      `${ORDER_NUMBER}${CORRECTIVE_KULSO_AZON_INFIX}2`,
      `${ORDER_NUMBER}${CORRECTIVE_KULSO_AZON_INFIX}2`,
    ])
    expect(order.correctiveInvoiceNumber).toBe('KIN-2026-11')
    expect(order.correctiveInvoiceSeq).toBe(2)
    expect(order.correctiveInvoiceStatus).toBe('issued')
    expect(order.correctiveInvoiceLastError).toBeNull()
  })

  it('duplikátum-jelzés TALÁLAT NÉLKÜL: failed + kézi egyeztetést kérő indoklás', async () => {
    const order = createOrder()
    const { payload } = createMockPayload(order)
    const result = await issueCorrectiveInvoiceForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      queryByKulsoAzon: async () => null,
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      postXml: async () => {
        throw duplicateError('152')
      },
    })

    expect(result.outcome).toBe('failed')
    expect(result.reason).toContain('kézi egyeztetés')
    expect(order.correctiveInvoiceStatus).toBe('failed')
    expect(order.correctiveInvoiceLastError).toContain('kézi egyeztetés')
  })

  it('duplikátum-jelzés + HIBÁZÓ lekérdezés: a 71/152-tény a hibaüzenetben marad (F11)', async () => {
    // A duplikátum-tény a legfontosabb információ az ügyintézőnek: a bizonylat
    // a szolgáltatónál MÁR LÉTEZIK. Ha a lekérdezés hibája felülírná, kézzel
    // kiállítanának egy másodikat (dupla NAV-adatszolgáltatás).
    const order = createOrder()
    const { payload } = createMockPayload(order)
    let lookups = 0
    await expect(
      issueCorrectiveInvoiceForOrder(order, {
        payload,
        config: ENABLED_CONFIG,
        queryByKulsoAzon: async () => {
          lookups += 1
          if (lookups === 1) {
            return null
          }
          throw new SzamlazzApiError({
            message: 'A Számlázz.hu nem válaszolt 15000 ms-en belül (bizonylat-lekérdezés).',
            kind: 'timeout',
            retryable: true,
          })
        },
        refundSeq: 1,
        amountHuf: REFUND_HUF,
        postXml: async () => {
          throw duplicateError('71')
        },
      }),
    ).rejects.toThrow('a bizonylat a Számlázz.hu szerint már létezik')

    expect(order.correctiveInvoiceLastError).toContain('71/152')
    expect(order.correctiveInvoiceLastError).toContain('már létezik')
    // Az eredeti lekérdezés-hiba részlete sem veszik el.
    expect(order.correctiveInvoiceLastError).toContain('nem válaszolt')
    expect(order.correctiveInvoiceStatus).toBe('failed')
  })

  it('retry ELŐTTI lekérdezés: találatnál a beküldés elmarad, a talált szám kerül a rendelésre', async () => {
    const order = createOrder({
      correctiveInvoiceAttempts: 1,
      correctiveInvoiceAttemptsSeq: 1,
    })
    const { payload } = createMockPayload(order)
    const lookups: string[] = []
    let posts = 0
    const result = await issueCorrectiveInvoiceForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      queryByKulsoAzon: async (kulsoAzon) => {
        lookups.push(kulsoAzon)
        return { szamlaszam: 'KIN-2026-9' }
      },
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      postXml: async () => {
        posts += 1
        return { szamlaszam: 'MASIK-HELYESBITO' }
      },
    })

    expect(result).toEqual({ outcome: 'issued', correctiveInvoiceNumber: 'KIN-2026-9' })
    expect(lookups).toEqual([`${ORDER_NUMBER}${CORRECTIVE_KULSO_AZON_INFIX}1`])
    expect(posts).toBe(0)
    expect(order.correctiveInvoiceNumber).toBe('KIN-2026-9')
    expect(order.correctiveInvoiceSeq).toBe(1)
    // F10: a lekérdezés NEM fogyaszt beküldési kísérletet.
    expect(order.correctiveInvoiceAttempts).toBe(1)
  })

  it('F10 — a lekérdezés HIBÁJA sem fogyaszt kísérletet (csak a tényleges POST)', async () => {
    const order = createOrder({
      correctiveInvoiceAttempts: 1,
      correctiveInvoiceAttemptsSeq: 1,
    })
    const { payload, updates } = createMockPayload(order)
    let posts = 0
    await expect(
      issueCorrectiveInvoiceForOrder(order, {
        payload,
        config: ENABLED_CONFIG,
        queryByKulsoAzon: async () => {
          throw new SzamlazzApiError({
            message: 'A Számlázz.hu elérhetetlen (bizonylat-lekérdezés).',
            kind: 'network',
            retryable: true,
          })
        },
        refundSeq: 1,
        amountHuf: REFUND_HUF,
        postXml: async () => {
          posts += 1
          return { szamlaszam: 'X' }
        },
      }),
    ).rejects.toThrow('elérhetetlen')

    expect(posts).toBe(0)
    expect(order.correctiveInvoiceAttempts).toBe(1)
    // Pending-írás sem történt: az egyetlen írás a hibaállapot rögzítése.
    expect(updates.some((data) => data.correctiveInvoiceStatus === 'pending')).toBe(false)
  })

  it('kísérlet-plafon (5): EGY záró lekérdezés, beküldés NINCS, failed + RIASZTÁS a kézi kiállítás előtti kereséssel', async () => {
    // H3: a plafon a lekérdezés UTÁN dönt (a modul-docblock ígérete szerint a
    // lekérdezés mindig lefut). Üres találatnál végleges failed, POST nélkül.
    // Az 5. beküldés bizonytalan kimenete miatt a helyesbítő később is
    // megjelenhet: a szöveg a keresést kéri, és az utolsó hibát is megtartja.
    const lastSubmissionError = 'A Számlázz.hu nem válaszolt 15000 ms-en belül.'
    const order = createOrder({
      correctiveInvoiceStatus: 'failed',
      correctiveInvoiceAttempts: MAX_CORRECTIVE_ATTEMPTS,
      correctiveInvoiceAttemptsSeq: 1,
      correctiveInvoiceLastError: lastSubmissionError,
    })
    const { payload } = createMockPayload(order)
    const { logger, logged } = captureLogs()
    const lookups: string[] = []
    let posts = 0
    const result = await issueCorrectiveInvoiceForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      logger,
      queryByKulsoAzon: async (kulsoAzon) => {
        lookups.push(kulsoAzon)
        return null
      },
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      postXml: async () => {
        posts += 1
        return { szamlaszam: 'X' }
      },
    })

    expect(result.outcome).toBe('failed')
    expect(result.reason).toContain('kimerült')
    expect(result.reason).toContain(
      `${correctiveKulsoAzon(ORDER_NUMBER, 1)} külső azonosítójú bizonylatot`,
    )
    expect(result.reason).toContain(lastSubmissionError)
    expect(lookups).toEqual([correctiveKulsoAzon(ORDER_NUMBER, 1)])
    expect(posts).toBe(0)
    expect(order.correctiveInvoiceStatus).toBe('failed')
    expect(order.correctiveInvoiceLastError).toBe(result.reason)
    expect(order.correctiveInvoiceAttempts).toBe(MAX_CORRECTIVE_ATTEMPTS)
    const alerts = logged.filter((entry) => entry.level === 'error')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.message).toMatch(/^RIASZTÁS: a helyesbítő-kiállítás beküldései kimerültek/)
  })

  it('H3 — kísérlet-plafon (5) + lekérdezés-TALÁLAT: az 5. beküldés helyesbítője átvéve, POST nélkül', async () => {
    const order = createOrder({
      correctiveInvoiceStatus: 'failed',
      correctiveInvoiceAttempts: MAX_CORRECTIVE_ATTEMPTS,
      correctiveInvoiceAttemptsSeq: 1,
    })
    const { payload } = createMockPayload(order)
    const result = await issueCorrectiveInvoiceForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      queryByKulsoAzon: async () => ({ szamlaszam: 'KIN-2026-HE-5' }),
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      postXml: async () => expect.unreachable('a plafonnál POST nem mehet ki'),
    })

    expect(result).toEqual({ outcome: 'issued', correctiveInvoiceNumber: 'KIN-2026-HE-5' })
    expect(order.correctiveInvoiceStatus).toBe('issued')
    expect(order.correctiveInvoiceNumber).toBe('KIN-2026-HE-5')
    expect(order.correctiveInvoiceSeq).toBe(1)
    expect(order.correctiveInvoiceAttempts).toBe(MAX_CORRECTIVE_ATTEMPTS)
  })

  it('H3 — kísérlet-plafon (5) + HIBÁZÓ lekérdezés: végleges failed + RIASZTÁS, dobás és POST nélkül', async () => {
    // A plafonnál beküldés úgysem mehet ki; a dobás csak a plafon-riasztást
    // nyelné el (a helyesbítőt semmi nem sweepeli vissza). A bizonylat az 5.
    // beküldésből létezhet: a szöveg a kézi kiállítás előtti ellenőrzést kéri.
    const order = createOrder({
      correctiveInvoiceStatus: 'pending',
      correctiveInvoiceAttempts: MAX_CORRECTIVE_ATTEMPTS,
      correctiveInvoiceAttemptsSeq: 1,
    })
    const { payload } = createMockPayload(order)
    const { logger, logged } = captureLogs()
    const result = await issueCorrectiveInvoiceForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      logger,
      queryByKulsoAzon: async () => {
        throw new SzamlazzApiError({
          message: 'A Számlázz.hu elérhetetlen (bizonylat-lekérdezés).',
          kind: 'network',
          retryable: true,
        })
      },
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      postXml: async () => expect.unreachable('a plafonnál POST nem mehet ki'),
    })

    expect(result.outcome).toBe('failed')
    expect(result.reason).toContain('kimerült')
    expect(result.reason).toContain(
      `${correctiveKulsoAzon(ORDER_NUMBER, 1)} külső azonosítójú bizonylatot`,
    )
    expect(order.correctiveInvoiceStatus).toBe('failed')
    expect(order.correctiveInvoiceAttemptsSeq).toBe(1)
    const alerts = logged.filter((entry) => entry.level === 'error')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.message).toMatch(/^RIASZTÁS: a helyesbítő-kiállítás beküldései kimerültek/)
  })

  it('56 (az értesítő nem ment ki, de a helyesbítő kiállt): issued + szám + RIASZTÁS a kézi kiküldéshez', async () => {
    const order = createOrder()
    const { payload } = createMockPayload(order)
    const { logger, logged } = captureLogs()
    const result = await issueCorrectiveInvoiceForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      logger,
      queryByKulsoAzon: emptyLookup,
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      postXml: async () => ({
        szamlaszam: 'KIN-2026-HE-56',
        notificationError: { code: '56', message: 'A számlaértesítő kézbesítése sikertelen.' },
      }),
    })

    expect(result).toEqual({ outcome: 'issued', correctiveInvoiceNumber: 'KIN-2026-HE-56' })
    expect(order.correctiveInvoiceStatus).toBe('issued')
    expect(order.correctiveInvoiceNumber).toBe('KIN-2026-HE-56')
    const alerts = logged.filter((entry) => entry.level === 'error')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.message).toMatch(/^RIASZTÁS: a helyesbítő számla kiállt/)
    expect(alerts[0]?.message).toContain('56-os kód')
  })
})

/**
 * F1 — a kísérlet-plafon BIZONYLAT-szintű: a correctiveInvoiceAttempts csak a
 * correctiveInvoiceAttemptsSeq-ben rögzített refund-sorszámhoz tartozik.
 * Rendelés-szintű számlálóval a KÉSŐBBI részrefund bizonylata jogtalanul
 * „kimerült"-re futna. Új seq-nél a lekérdezés lefut (K4), de üres találat
 * után a POST mehet, a számláló 1-ről indul.
 */
describe('issueCorrectiveInvoiceForOrder — seq-kulcsolt kísérlet-plafon (F1)', () => {
  it('a kimerült seq=1 NEM blokkolja a seq=2-t: friss számlálóval indul', async () => {
    const order = createOrder({
      correctiveInvoiceStatus: 'failed',
      correctiveInvoiceAttempts: MAX_CORRECTIVE_ATTEMPTS,
      correctiveInvoiceAttemptsSeq: 1,
    })
    const { payload, updates } = createMockPayload(order)
    const sentXml: string[] = []
    const lookups: string[] = []
    const result = await issueCorrectiveInvoiceForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      // K4: új seq-nél is lefut a lekérdezés; üres találat után a POST mehet.
      queryByKulsoAzon: async (kulsoAzon) => {
        lookups.push(kulsoAzon)
        return null
      },
      refundSeq: 2,
      amountHuf: 2000,
      postXml: async (xml) => {
        sentXml.push(xml)
        return { szamlaszam: 'KIN-2026-10' }
      },
    })

    expect(result).toEqual({ outcome: 'issued', correctiveInvoiceNumber: 'KIN-2026-10' })
    expect(lookups).toEqual([correctiveKulsoAzon(ORDER_NUMBER, 2)])
    expect(sentXml).toHaveLength(1)
    expect(updates[0]).toEqual({
      correctiveInvoiceStatus: 'pending',
      correctiveInvoiceAttempts: 1,
      correctiveInvoiceAttemptsSeq: 2,
    })
    expect(order.correctiveInvoiceAttempts).toBe(1)
    expect(order.correctiveInvoiceAttemptsSeq).toBe(2)
  })

  it('AZONOS seq újrapróbálása tovább számol (a plafon bizonylat-szinten fog)', async () => {
    const order = createOrder({
      correctiveInvoiceAttempts: 2,
      correctiveInvoiceAttemptsSeq: 3,
    })
    const { payload } = createMockPayload(order)
    const result = await issueCorrectiveInvoiceForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      queryByKulsoAzon: async () => null,
      refundSeq: 3,
      amountHuf: REFUND_HUF,
      postXml: async () => ({ szamlaszam: 'KIN-2026-12' }),
    })

    expect(result.outcome).toBe('issued')
    expect(order.correctiveInvoiceAttempts).toBe(3)
    expect(order.correctiveInvoiceAttemptsSeq).toBe(3)
  })

  it('a plafon-ág is a kért sorszámra állítja a számláló-kulcsot', async () => {
    const order = createOrder({
      correctiveInvoiceAttempts: MAX_CORRECTIVE_ATTEMPTS,
      correctiveInvoiceAttemptsSeq: 2,
    })
    const { payload } = createMockPayload(order)
    const result = await issueCorrectiveInvoiceForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      // H3 óta a plafonnál is lefut a (záró) lekérdezés; üres találat után dönt a plafon.
      queryByKulsoAzon: emptyLookup,
      refundSeq: 2,
      amountHuf: REFUND_HUF,
      postXml: async () => expect.unreachable('nem hívható'),
    })

    expect(result.outcome).toBe('failed')
    expect(order.correctiveInvoiceAttemptsSeq).toBe(2)
    expect(order.correctiveInvoiceStatus).toBe('failed')
  })
})
