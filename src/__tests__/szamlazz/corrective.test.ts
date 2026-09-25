import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InvoiceDataResult } from '../../lib/szamlazz/invoice-data'
import type { SzamlazzClientConfig } from '../../lib/szamlazz/types'

// These pre-ledger fixtures exercise the unchanged legacy invoice contract.
vi.mock('../../lib/refund/intent-store', () => ({ loadRefundIntentsForOrder: async () => [] }))
// Az eredeti számla adat-lekérdezése (áfakulcs-ellenőrzés, a-szamlazz-13) a
// modul-határon mockolt (új fetch-es kódhoz nincs injektálási paraméter): a
// folyamat-tesztekben alapból egy 27%-os, élő eredeti számlát ad vissza, hogy
// valódi hálózati hívás ne mehessen ki; a saját tesztjei felülírják.
const invoiceData = vi.hoisted(() => {
  const liveOriginal = async (szamlaszam: string): Promise<InvoiceDataResult> => ({
    szamlaszam,
    vatKeys: ['27'],
    sztornozott: false,
  })
  return {
    liveOriginal,
    query:
      vi.fn<(szamlaszam: string, config?: SzamlazzClientConfig) => Promise<InvoiceDataResult>>(
        liveOriginal,
      ),
  }
})
vi.mock('../../lib/szamlazz/invoice-data', () => ({ queryInvoiceData: invoiceData.query }))
beforeEach(() => {
  invoiceData.query.mockReset()
  invoiceData.query.mockImplementation(invoiceData.liveOriginal)
})

import { getSzamlazzConfig } from '../../lib/szamlazz/client'
import {
  buildCorrectiveInvoiceXml,
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
/** A fixtúra-rendelés létrehozásának pillanata (Payload ISO-alakban írja). */
const ORDER_CREATED_AT = '2026-09-20T10:00:00.000Z'

/**
 * A helyesbítő globálisan egyedi külső azonosítója, kézzel kiszámolva:
 * rendelésszám - rendelés-id (101) - createdAt unix másodpercben
 * (2026-09-20T10:00:00Z = 1789898400) - HELYESBITO - refund-sorszám.
 */
function correctiveKey(seq: number): string {
  return `KH-2026-000123-101-1789898400-HELYESBITO-${seq}`
}

/** A PR #304-es, régi (rendelésszám-alapú) helyesbítő-kulcs. */
function legacyCorrectiveKey(seq: number): string {
  return `${ORDER_NUMBER}-HELYESBITO-${seq}`
}

/** Lekérdezés-találat a visszatérített összeggel egyező (negatív) bruttóval. */
function ownCorrective(szamlaszam: string, amountHuf = REFUND_HUF): InvoiceLookupResult {
  return { szamlaszam, szamlabrutto: -amountHuf }
}

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
    createdAt: ORDER_CREATED_AT,
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
  const input = {
    agentKey: DUMMY_AGENT_KEY,
    originalInvoiceNumber: ORIGINAL_INVOICE_NUMBER,
    orderNumber: ORDER_NUMBER,
    invoicePrefix: 'KIN',
    kulsoAzon: correctiveKey(2),
    rendelesSzam: legacyCorrectiveKey(2),
    amountHuf: REFUND_HUF,
    issueDate: '2026-08-09',
    buyer: BUYER,
  }
  const xml = buildCorrectiveInvoiceXml(input)

  it('helyesbitoszamla=true ÉS helyesbitettSzamlaszam = az EREDETI számla száma', () => {
    expect(xml).toContain('<helyesbitoszamla>true</helyesbitoszamla>')
    expect(xml).toContain(
      `<helyesbitettSzamlaszam>${ORIGINAL_INVOICE_NUMBER}</helyesbitettSzamlaszam>`,
    )
  })

  it('a szamlaKulsoAzon a helyesbítő egyedi kulcsa, a rendelesSzam a megadott rövid alak (egyik sem az orderNumber)', () => {
    expect(xml).toContain(`<szamlaKulsoAzon>${correctiveKey(2)}</szamlaKulsoAzon>`)
    expect(xml).toContain('<rendelesSzam>KH-2026-000123-HELYESBITO-2</rendelesSzam>')
    expect(xml).not.toContain(`<szamlaKulsoAzon>${ORDER_NUMBER}</szamlaKulsoAzon>`)
    expect(xml).not.toContain(`<rendelesSzam>${ORDER_NUMBER}</rendelesSzam>`)
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

  // Vezetői döntés (w1 integráció): a helyesbítő megjegyzését a vevő is
  // megkapja, ezért a visszatérítés belső indoka nem kerülhet rá. A kiállító
  // típusa nem fogad indokot (ezt a @ts-expect-error őrzi a típusellenőrzésben),
  // és a futás közben mégis átadott indokot sem írja ki.
  it('a megjegyzés az eredeti számlára és a rendelésre hivatkozik, a visszatérítés indokára nem', () => {
    const withReason = buildCorrectiveInvoiceXml({
      ...input,
      // @ts-expect-error -- a helyesbítő nem fogad indokot: a vevőnek látható megjegyzésbe kerülne
      reason: 'Kedvezmény utólag, telefonos egyeztetés után',
    })
    const note = /<megjegyzes>([\s\S]*?)<\/megjegyzes>/u.exec(withReason)?.[1] ?? ''
    expect(note).toContain(`Helyesbítő számla a(z) ${ORIGINAL_INVOICE_NUMBER} számú számlához`)
    expect(note).toContain(`rendelés: ${ORDER_NUMBER}`)
    expect(note).not.toContain('Kedvezmény utólag')
    expect(note).not.toMatch(/indok/iu)
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
    expect(sentXml[0]).toContain(`<szamlaKulsoAzon>${correctiveKey(1)}</szamlaKulsoAzon>`)
    // rev1: a rendelésszám a rövid, olvasható alak marad (a hosszú egyedi kulcs
    // a NAV-export mezőhossz-korlátjába ütközhetne; a visszakeresés a
    // szamlaKulsoAzon-on megy).
    expect(sentXml[0]).toContain('<rendelesSzam>KH-2026-000123-HELYESBITO-1</rendelesSzam>')
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
    expect(sentXml[0]).toContain(`<szamlaKulsoAzon>${correctiveKey(2)}</szamlaKulsoAzon>`)
    expect(order.correctiveInvoiceSeq).toBe(2)
  })

  it('a KÉSŐBBI seq már kiállt, a KORÁBBI retry mégis továbbmegy a providerhez', async () => {
    // Sorrendtörés: a seq=1 kiállítása timeoutolt és jobba került, közben a
    // seq=2 inline sikerült (correctiveInvoiceSeq=2). A seq=1 retry-ja NEM
    // lehet no-op — a korábbi részrefund bizonylata még nem készült el; a
    // duplikáció ellen a beküldés előtti, seq-kulcsolt lekérdezés véd.
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
    expect(sentXml[0]).toContain(`<szamlaKulsoAzon>${correctiveKey(1)}</szamlaKulsoAzon>`)
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
        return ownCorrective('KIN-2026-9')
      },
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      postXml: async () => {
        posts += 1
        return { szamlaszam: 'VAK-POST' }
      },
    })

    expect(result).toEqual({ outcome: 'issued', correctiveInvoiceNumber: 'KIN-2026-9' })
    expect(lookups).toEqual([correctiveKey(1)])
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
        return lookups.length === 1 ? null : ownCorrective('KIN-2026-11')
      },
      refundSeq: 2,
      amountHuf: REFUND_HUF,
      postXml: async () => {
        throw duplicateError('71')
      },
    })

    expect(result).toEqual({ outcome: 'issued', correctiveInvoiceNumber: 'KIN-2026-11' })
    // NEM az orderNumber: a helyesbítőnek saját horgonya van a refund-sorszámmal.
    expect(lookups).toEqual([correctiveKey(2), correctiveKey(2)])
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
        return ownCorrective('KIN-2026-9')
      },
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      postXml: async () => {
        posts += 1
        return { szamlaszam: 'MASIK-HELYESBITO' }
      },
    })

    expect(result).toEqual({ outcome: 'issued', correctiveInvoiceNumber: 'KIN-2026-9' })
    expect(lookups).toEqual([correctiveKey(1)])
    expect(posts).toBe(0)
    expect(order.correctiveInvoiceNumber).toBe('KIN-2026-9')
    expect(order.correctiveInvoiceSeq).toBe(1)
    // F10: a lekérdezés NEM fogyaszt beküldési kísérletet.
    expect(order.correctiveInvoiceAttempts).toBe(1)
  })

  // rev2: a beküldés előtti átmeneti hiba a státuszt sem írja át (mint az
  // átmeneti áfakulcs-olvasás), csak a hibaüzenetet; korábban 'failed' lett.
  it('F10 — a lekérdezés HIBÁJA sem kísérletet nem fogyaszt, sem a státuszt nem írja át (csak a hibaüzenetet)', async () => {
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
    // Az egyetlen írás a hibaüzenet rögzítése; státusz-írás (pending vagy
    // failed) nem történt.
    expect(updates).toEqual([
      { correctiveInvoiceLastError: 'A Számlázz.hu elérhetetlen (bizonylat-lekérdezés).' },
    ])
    expect(order.correctiveInvoiceStatus).toBe('none')
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
    expect(result.reason).toContain(`${correctiveKey(1)} külső azonosítójú bizonylatot`)
    expect(result.reason).toContain(lastSubmissionError)
    // Korábbi beküldések után az egyedi ÉS a régi (PR #304-es) kulcson is keres.
    expect(lookups).toEqual([correctiveKey(1), legacyCorrectiveKey(1)])
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
      queryByKulsoAzon: async () => ownCorrective('KIN-2026-HE-5'),
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
    expect(result.reason).toContain(`${correctiveKey(1)} külső azonosítójú bizonylatot`)
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
    // rev1 (breaker): a rendelésen korábban (seq=1) már volt beküldés, ezért a
    // régi, PR #304-es kulcson is keresünk, nem csak ugyanazon seq retryjén.
    expect(lookups).toEqual([correctiveKey(2), legacyCorrectiveKey(2)])
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

/** Szint + üzenet + kontextus naplórögzítő (a RIASZTÁS-kontextus ellenőrzéséhez). */
function captureLevels() {
  const logged: Array<{ level: string; message: string; context?: Record<string, unknown> }> = []
  const logger = {
    debug: () => undefined,
    info: (message: string) => logged.push({ level: 'info', message }),
    warn: (message: string) => logged.push({ level: 'warn', message }),
    error: (message: string, context?: Record<string, unknown>) =>
      logged.push({ level: 'error', message, ...(context ? { context } : {}) }),
    child: () => logger,
  }
  return { logger, logged, alerts: () => logged.filter((entry) => entry.level === 'error') }
}

const forbiddenPost = async (): Promise<never> => {
  throw new Error('TESZT-HIBA: ezen az ágon helyesbítő nem mehet ki')
}

describe('issueCorrectiveInvoiceForOrder — az eredeti számla áfakulcsa (a-szamlazz-13, r-szamlazz-7)', () => {
  it('egyező kulcs (27): a helyesbítő kiáll, az eredeti számla adatait a SZÁMÁVAL kérdezi le', async () => {
    const order = createOrder()
    const { payload } = createMockPayload(order)
    const queried: string[] = []
    invoiceData.query.mockImplementation(async (szamlaszam) => {
      queried.push(szamlaszam)
      return { szamlaszam, vatKeys: ['27'], sztornozott: false }
    })
    const result = await issueCorrectiveInvoiceForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      queryByKulsoAzon: emptyLookup,
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      postXml: async () => ({ szamlaszam: 'KIN-2026-HE-1' }),
    })
    expect(result).toEqual({ outcome: 'issued', correctiveInvoiceNumber: 'KIN-2026-HE-1' })
    expect(queried).toEqual([ORIGINAL_INVOICE_NUMBER])
  })

  it.each([
    ['AAM-os eredeti, 27-es konfig', { vatKeys: ['AAM'], sztornozott: false }, 'AAM'],
    ['vegyes kulcsú eredeti', { vatKeys: ['27', 'AAM'], sztornozott: false }, '27, AAM'],
    ['értelmezhetetlen kulcs', { vatKeys: ['ismeretlen'], sztornozott: false }, 'ismeretlen'],
    ['tétel nélküli válasz', { vatKeys: [], sztornozott: false }, 'nincs tétel'],
    ['már sztornózott eredeti', { vatKeys: ['27'], sztornozott: true }, 'sztornózták'],
  ])(
    '%s: nem találgat — failed + RIASZTÁS, helyesbítő NEM megy ki',
    async (_label, data, reasonPart) => {
      const order = createOrder()
      const { payload } = createMockPayload(order)
      const { logger, alerts } = captureLevels()
      invoiceData.query.mockImplementation(async (szamlaszam) => ({ szamlaszam, ...data }))
      const result = await issueCorrectiveInvoiceForOrder(order, {
        payload,
        logger,
        config: ENABLED_CONFIG,
        queryByKulsoAzon: emptyLookup,
        refundSeq: 1,
        amountHuf: REFUND_HUF,
        postXml: forbiddenPost,
      })
      expect(result.outcome).toBe('failed')
      expect(result.reason).toContain(reasonPart)
      expect(order.correctiveInvoiceStatus).toBe('failed')
      expect(order.correctiveInvoiceAttempts ?? 0).toBe(0)
      expect(alerts()).toHaveLength(1)
      expect(alerts()[0]?.message).toMatch(/^RIASZTÁS: az eredeti számla áfakulcsa nem igazolható/)
      expect(alerts()[0]?.context).toMatchObject({
        orderNumber: ORDER_NUMBER,
        originalInvoiceNumber: ORIGINAL_INVOICE_NUMBER,
      })
    },
  )

  it('az eredeti számla nem olvasható ki (7 — ismeretlen szám): failed + RIASZTÁS, dobás és beküldés nélkül', async () => {
    const order = createOrder()
    const { payload } = createMockPayload(order)
    const { logger, alerts } = captureLevels()
    invoiceData.query.mockImplementation(async () => {
      throw new SzamlazzApiError({
        message: 'Számla Agent hiba: 7',
        kind: 'agent',
        agentErrors: [{ code: '7', message: 'Hiányzó adat' }],
        retryable: false,
      })
    })
    const result = await issueCorrectiveInvoiceForOrder(order, {
      payload,
      logger,
      config: ENABLED_CONFIG,
      queryByKulsoAzon: emptyLookup,
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      postXml: forbiddenPost,
    })
    expect(result.outcome).toBe('failed')
    expect(alerts()[0]?.message).toMatch(/^RIASZTÁS: az eredeti számla áfakulcsa nem igazolható/)
  })

  // rev1 (lead + breaker): az átmeneti hiba NEM megtagadás. A korábbi
  // változat 'failed'-et írt és „kézi rendezés kell" RIASZTÁS-t adott, miközben
  // a job/helyreállítás automatikusan újrapróbált; a riasztást követő kézi
  // kiállítás mellett ez dupla helyesbítő lett volna.
  it('átmeneti olvasási hiba: újrapróbálható dobás, a státusz marad, RIASZTÁS nélkül, beküldés és kísérlet-fogyasztás nélkül', async () => {
    const order = createOrder()
    const { payload, updates } = createMockPayload(order)
    const { logger, logged, alerts } = captureLevels()
    invoiceData.query.mockImplementation(async () => {
      throw new SzamlazzApiError({ message: 'időtúllépés', kind: 'timeout', retryable: true })
    })
    await expect(
      issueCorrectiveInvoiceForOrder(order, {
        payload,
        logger,
        config: ENABLED_CONFIG,
        queryByKulsoAzon: emptyLookup,
        refundSeq: 1,
        amountHuf: REFUND_HUF,
        postXml: forbiddenPost,
      }),
    ).rejects.toMatchObject({ retryable: true })
    expect(order.correctiveInvoiceAttempts ?? 0).toBe(0)
    expect(order.correctiveInvoiceStatus).toBe('none')
    expect(updates).toEqual([])
    expect(alerts()).toEqual([])
    const warnings = logged.filter(
      (entry) => entry.level === 'warn' && entry.message.includes('átmeneti hiba'),
    )
    expect(warnings).toHaveLength(1)
    // rev2: automatikus újrapróbálás nincs (a corrective jobot semmi nem
    // állítja sorba); a valódi út a visszatérítési panel gombja.
    expect(warnings[0]?.message).toContain('„Feldolgozás folytatása” gombjával újrapróbálható')
    expect(warnings[0]?.message).not.toContain('automatikusan')
    expect(warnings[0]?.message).toContain('kézzel NE állítsd ki')
  })
})

describe('issueCorrectiveInvoiceForOrder — átvétel csak egyeztetett bizonylatra, régi kulcs is (a-szamlazz-5)', () => {
  it('a talált bizonylat bruttója eltér a helyesbítésétől: failed + RIASZTÁS, átvétel és beküldés NÉLKÜL', async () => {
    const order = createOrder()
    const { payload } = createMockPayload(order)
    const { logger, alerts } = captureLevels()
    const result = await issueCorrectiveInvoiceForOrder(order, {
      payload,
      logger,
      config: ENABLED_CONFIG,
      queryByKulsoAzon: async () => ({ szamlaszam: 'IDEGEN-HE', szamlabrutto: -3000 }),
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      postXml: forbiddenPost,
    })
    expect(result.outcome).toBe('failed')
    expect(order.correctiveInvoiceNumber).toBeUndefined()
    expect(order.correctiveInvoiceStatus).toBe('failed')
    expect(alerts()[0]?.message).toMatch(/^RIASZTÁS: a helyesbítő előtti bizonylat-lekérdezés/)
    expect(alerts()[0]?.context).toMatchObject({
      orderNumber: ORDER_NUMBER,
      foundInvoiceNumber: 'IDEGEN-HE',
    })
  })

  it('korábbi beküldés után a RÉGI kulcson talált, erre a számlára hivatkozó helyesbítő átvéve', async () => {
    const order = createOrder({
      correctiveInvoiceStatus: 'pending',
      correctiveInvoiceAttempts: 1,
      correctiveInvoiceAttemptsSeq: 1,
    })
    const { payload } = createMockPayload(order)
    const lookups: string[] = []
    invoiceData.query.mockImplementation(async (szamlaszam) => ({
      szamlaszam,
      vatKeys: ['27'],
      sztornozott: false,
      hivatkozottSzamlaszam: ORIGINAL_INVOICE_NUMBER,
    }))
    const result = await issueCorrectiveInvoiceForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      queryByKulsoAzon: async (kulsoAzon) => {
        lookups.push(kulsoAzon)
        return kulsoAzon === legacyCorrectiveKey(1) ? ownCorrective('KIN-2026-HE-REGI') : null
      },
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      postXml: forbiddenPost,
    })
    expect(result).toEqual({ outcome: 'issued', correctiveInvoiceNumber: 'KIN-2026-HE-REGI' })
    expect(lookups).toEqual([correctiveKey(1), legacyCorrectiveKey(1)])
  })

  // rev1 (breaker): a régi kulcsot a seq-kulcsolt számlálótól függetlenül is
  // keresni kell. PR #304 alatt a seq=1 beküldése elveszett válasszal (de
  // valójában kiállt) a régi kulcson; utána a seq=2 kiállt, így a seq=1
  // maradék jobja previousAttempts=0-val fut. Csak az új kulcsot keresve
  // második NAV-helyesbítőt küldött volna be a seq=1-hez. rev2: a
  // „bármely beküldés" feltétel két ágát külön sor rögzíti (csak a rögzített
  // seq=2, illetve csak a seq=2 kísérlet-számlálója).
  it.each([
    {
      eset: 'a seq=2 kiállt, saját kísérlettel',
      state: {
        correctiveInvoiceStatus: 'issued',
        correctiveInvoiceNumber: 'KIN-2026-HE-2',
        correctiveInvoiceSeq: 2,
        correctiveInvoiceAttempts: 1,
        correctiveInvoiceAttemptsSeq: 2,
      },
      recorded: { number: 'KIN-2026-HE-2', seq: 2 },
    },
    {
      eset: 'csak a rögzített seq=2 (átvett bizonylat, kísérlet nélkül)',
      state: {
        correctiveInvoiceStatus: 'issued',
        correctiveInvoiceNumber: 'KIN-2026-HE-2',
        correctiveInvoiceSeq: 2,
        correctiveInvoiceAttempts: 0,
        correctiveInvoiceAttemptsSeq: 0,
      },
      recorded: { number: 'KIN-2026-HE-2', seq: 2 },
    },
    {
      eset: 'csak a seq=2 kísérlet-számlálója (bizonytalan beküldés, rögzített szám nélkül)',
      state: {
        correctiveInvoiceStatus: 'pending',
        correctiveInvoiceSeq: 0,
        correctiveInvoiceAttempts: 1,
        correctiveInvoiceAttemptsSeq: 2,
      },
      recorded: { number: 'KIN-2026-HE-1', seq: 1 },
    },
  ])(
    'a seq=1 régi kulcson (PR #304) kiállt helyesbítőjét a későbbi retry sem küldi be újra — $eset',
    async ({ state, recorded }) => {
      const order = createOrder(state)
      const { payload } = createMockPayload(order)
      invoiceData.query.mockImplementation(async (szamlaszam) => ({
        szamlaszam,
        vatKeys: ['27'],
        sztornozott: false,
        hivatkozottSzamlaszam: ORIGINAL_INVOICE_NUMBER,
      }))
      const posts: string[] = []
      const result = await issueCorrectiveInvoiceForOrder(order, {
        payload,
        config: ENABLED_CONFIG,
        refundSeq: 1,
        amountHuf: REFUND_HUF,
        queryByKulsoAzon: async (kulsoAzon) =>
          kulsoAzon === 'KH-2026-000123-HELYESBITO-1' ? ownCorrective('KIN-2026-HE-1') : null,
        postXml: async (xml) => {
          posts.push(xml)
          return { szamlaszam: 'KIN-2026-HE-DUPLA' }
        },
      })
      expect(posts).toHaveLength(0)
      expect(result).toEqual({ outcome: 'issued', correctiveInvoiceNumber: 'KIN-2026-HE-1' })
      // A későbbi seq=2 rögzített száma nem íródik vissza a régebbire.
      expect(order.correctiveInvoiceNumber).toBe(recorded.number)
      expect(order.correctiveInvoiceSeq).toBe(recorded.seq)
    },
  )

  // rev2 (breaker): rendelésszám-újrahasznosítás. Egy törölt, azonos
  // rendelésszámú rendelés PR #304-es helyesbítője a régi
  // `<rendelésszám>-HELYESBITO-2` kulcson ül, és MÁS számlára hivatkozik. A
  // rev1 ezt minden későbbi seq-nél zártan elutasította, így a második
  // visszatérítés helyesbítője véglegesen elakadt.
  describe('rendelésszám-újrahasznosítás: a régi kulcson talált idegen bizonylat (ehhez a seq-hez még nem volt beküldés)', () => {
    const seq1IssuedOnNewKey = {
      correctiveInvoiceStatus: 'issued',
      correctiveInvoiceNumber: 'KIN-2026-HE-1',
      correctiveInvoiceSeq: 1,
      correctiveInvoiceAttempts: 1,
      correctiveInvoiceAttemptsSeq: 1,
    }
    const SECOND_REFUND_HUF = 3000

    it('igazoltan más számlára hivatkozik: átlépve, a seq=2 helyesbítő kimegy', async () => {
      invoiceData.query.mockImplementation(async (szamlaszam) =>
        szamlaszam === 'IDEGEN-HE-2'
          ? {
              szamlaszam,
              vatKeys: ['27'],
              sztornozott: false,
              hivatkozottSzamlaszam: 'KIN-2025-99',
            }
          : { szamlaszam, vatKeys: ['27'], sztornozott: false },
      )
      const order = createOrder(seq1IssuedOnNewKey)
      const { payload } = createMockPayload(order)
      const { logger, logged, alerts } = captureLevels()
      const lookups: string[] = []
      const posts: string[] = []
      const result = await issueCorrectiveInvoiceForOrder(order, {
        payload,
        logger,
        config: ENABLED_CONFIG,
        refundSeq: 2,
        amountHuf: SECOND_REFUND_HUF,
        queryByKulsoAzon: async (kulsoAzon) => {
          lookups.push(kulsoAzon)
          return kulsoAzon === legacyCorrectiveKey(2)
            ? { szamlaszam: 'IDEGEN-HE-2', szamlabrutto: -7000 }
            : null
        },
        postXml: async (xml) => {
          posts.push(xml)
          return { szamlaszam: 'KIN-2026-HE-2' }
        },
      })
      expect(result).toEqual({ outcome: 'issued', correctiveInvoiceNumber: 'KIN-2026-HE-2' })
      expect(posts).toHaveLength(1)
      expect(lookups).toEqual([correctiveKey(2), legacyCorrectiveKey(2)])
      expect(alerts()).toEqual([])
      expect(
        logged.some(
          (entry) => entry.level === 'warn' && entry.message.includes('más számlára hivatkozik'),
        ),
      ).toBe(true)
    })

    // A kivétel szűk: csak az IGAZOLTAN idegen hivatkozás léphető át.
    it.each([
      {
        eset: 'a hivatkozás hiányzik',
        found: { szamlaszam: 'KERDESES-HE-2', szamlabrutto: -SECOND_REFUND_HUF },
        reference: undefined,
        mismatch: `nem a(z) ${ORIGINAL_INVOICE_NUMBER} számú számlára hivatkozik`,
      },
      {
        eset: 'a mi számlánkra hivatkozik, de a bruttó eltér',
        found: { szamlaszam: 'KERDESES-HE-2', szamlabrutto: -7000 },
        reference: ORIGINAL_INVOICE_NUMBER,
        mismatch: 'bruttó végösszege -7000 Ft',
      },
    ])(
      '$eset: zártan elutasítva (failed + RIASZTÁS, beküldés nélkül)',
      async ({ found, reference, mismatch }) => {
        invoiceData.query.mockImplementation(async (szamlaszam) => ({
          szamlaszam,
          vatKeys: ['27'],
          sztornozott: false,
          ...(reference ? { hivatkozottSzamlaszam: reference } : {}),
        }))
        const order = createOrder(seq1IssuedOnNewKey)
        const { payload } = createMockPayload(order)
        const { logger, alerts } = captureLevels()
        const result = await issueCorrectiveInvoiceForOrder(order, {
          payload,
          logger,
          config: ENABLED_CONFIG,
          refundSeq: 2,
          amountHuf: SECOND_REFUND_HUF,
          queryByKulsoAzon: async (kulsoAzon) =>
            kulsoAzon === legacyCorrectiveKey(2) ? found : null,
          postXml: forbiddenPost,
        })
        expect(result.outcome).toBe('failed')
        expect(order.correctiveInvoiceStatus).toBe('failed')
        expect(alerts()).toHaveLength(1)
        expect(alerts()[0]?.context).toMatchObject({ foundInvoiceNumber: 'KERDESES-HE-2' })
        expect(String(alerts()[0]?.context?.mismatch)).toContain(mismatch)
      },
    )
  })

  it('a régi kulcson talált helyesbítő MÁS számlára hivatkozik: failed + RIASZTÁS, beküldés nélkül', async () => {
    const order = createOrder({
      correctiveInvoiceStatus: 'pending',
      correctiveInvoiceAttempts: 1,
      correctiveInvoiceAttemptsSeq: 1,
    })
    const { payload } = createMockPayload(order)
    const { logger, alerts } = captureLevels()
    invoiceData.query.mockImplementation(async (szamlaszam) => ({
      szamlaszam,
      vatKeys: ['27'],
      sztornozott: false,
      hivatkozottSzamlaszam: 'IDEGEN-SZAMLA-1',
    }))
    const result = await issueCorrectiveInvoiceForOrder(order, {
      payload,
      logger,
      config: ENABLED_CONFIG,
      queryByKulsoAzon: async (kulsoAzon) =>
        kulsoAzon === legacyCorrectiveKey(1) ? ownCorrective('IDEGEN-HE-REGI') : null,
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      postXml: forbiddenPost,
    })
    expect(result.outcome).toBe('failed')
    expect(order.correctiveInvoiceNumber).toBeUndefined()
    expect(alerts()[0]?.message).toMatch(/^RIASZTÁS: /)
  })
})

/**
 * rev1 (breaker): a helyesbítő a beküldés előtt akár három Számlázz.hu-hívást
 * végez (új és régi kulcsú lekérdezés, az eredeti számla áfakulcsa), a zár-
 * tranzakció közben tétlen, és a Postgres 60 s után leöli. A beküldés csak
 * akkor indul, ha a teljes timeoutja a 45 s-os közös keretbe fér
 * (lock-budget.ts); különben egy második futó a zár nélkül dupla helyesbítőt
 * küldhetne be.
 */
describe('issueCorrectiveInvoiceForOrder — a zár alatti hívások közös időkerete', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('három lassú (14 s-os) hívás után a beküldés NEM indul: újrapróbálható hiba, kísérlet-növelés nélkül', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-24T10:00:00Z'))
    const order = createOrder({
      correctiveInvoiceStatus: 'pending',
      correctiveInvoiceAttempts: 1,
      correctiveInvoiceAttemptsSeq: 1,
    })
    const { payload } = createMockPayload(order)
    const callTimeouts: number[] = []
    invoiceData.query.mockImplementation(async (szamlaszam, config) => {
      callTimeouts.push(config?.timeoutMs ?? -1)
      vi.setSystemTime(Date.now() + 14_000)
      return { szamlaszam, vatKeys: ['27'], sztornozott: false }
    })
    const posts: string[] = []
    await expect(
      issueCorrectiveInvoiceForOrder(order, {
        payload,
        config: ENABLED_CONFIG,
        refundSeq: 1,
        amountHuf: REFUND_HUF,
        queryByKulsoAzon: async (_kulsoAzon, config) => {
          callTimeouts.push(config.timeoutMs)
          vi.setSystemTime(Date.now() + 14_000)
          return null
        },
        postXml: async (xml) => {
          posts.push(xml)
          return { szamlaszam: 'KIN-2026-HE-KESO' }
        },
      }),
    ).rejects.toMatchObject({ retryable: true, kind: 'timeout' })

    expect(callTimeouts).toEqual([15_000, 15_000, 15_000])
    expect(posts).toHaveLength(0)
    expect(order.correctiveInvoiceAttempts).toBe(1)
  })

  // rev2 (breaker): a keret-ellenőrzés a pending-írás ELŐTT futott, a POST a
  // korábban kapott konfigurációval indult. Egy megakadt pending-írás (sorzár,
  // CLAUDE.md 6.) után a POST a teljes 15 s-os timeouttal a kereten túl indult,
  // a zárat pedig a 60 s-os tétlenségi korlát beküldés közben elengedte.
  it('a korai ellenőrzés után 20 s-ig álló pending-írás mellett a beküldés NEM indul (a POST pillanatában is ellenőriz)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-24T10:00:00Z'))
    const lockStart = Date.now()
    const order = createOrder()
    const payload = {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        if (data.correctiveInvoiceStatus === 'pending') vi.setSystemTime(Date.now() + 20_000)
        Object.assign(order, data)
        return order
      },
    } as unknown as Payload
    // 15 s lekérdezés + 5 s áfakulcs-olvasás: a korai ellenőrzés (15 s
    // timeout + 5 s tartalék) még átengedi, a pending-írás után a keret elfogy.
    invoiceData.query.mockImplementation(async (szamlaszam) => {
      vi.setSystemTime(Date.now() + 5_000)
      return { szamlaszam, vatKeys: ['27'], sztornozott: false }
    })
    const postOffsets: number[] = []
    await expect(
      issueCorrectiveInvoiceForOrder(order, {
        payload,
        config: ENABLED_CONFIG,
        refundSeq: 1,
        amountHuf: REFUND_HUF,
        queryByKulsoAzon: async () => {
          vi.setSystemTime(Date.now() + 15_000)
          return null
        },
        postXml: async () => {
          postOffsets.push(Date.now() - lockStart)
          return { szamlaszam: 'KIN-2026-HE-KESO' }
        },
      }),
    ).rejects.toMatchObject({ retryable: true, kind: 'timeout' })

    expect(postOffsets).toHaveLength(0)
    expect(order.correctiveInvoiceAttempts).toBe(1)
    // Igénylés (visszatérítési intent) nélküli ág: a státusz 'failed', az ok
    // pedig kimondja, hogy a kérés nem ment ki.
    expect(order.correctiveInvoiceStatus).toBe('failed')
    expect(order.correctiveInvoiceLastError).toContain('nem ment ki')
  })

  it('1 s-nál kevesebb hátralévő keretnél lekérdezés sem indul (a régi kulcsú keresés elmarad)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-24T10:00:00Z'))
    const order = createOrder({
      correctiveInvoiceStatus: 'pending',
      correctiveInvoiceAttempts: 1,
      correctiveInvoiceAttemptsSeq: 1,
    })
    const { payload } = createMockPayload(order)
    const lookups: string[] = []
    await expect(
      issueCorrectiveInvoiceForOrder(order, {
        payload,
        config: ENABLED_CONFIG,
        refundSeq: 1,
        amountHuf: REFUND_HUF,
        queryByKulsoAzon: async (kulsoAzon) => {
          lookups.push(kulsoAzon)
          vi.setSystemTime(Date.now() + 44_500)
          return null
        },
        postXml: forbiddenPost,
      }),
    ).rejects.toMatchObject({ retryable: true, kind: 'timeout' })
    expect(lookups).toEqual([correctiveKey(1)])
  })
})

describe('issueCorrectiveInvoiceForOrder — végleges hibák RIASZTÁS-a (a-riasztas-2)', () => {
  it('végleges agent-hiba (57): failed + error-szintű RIASZTÁS a rendelésszámmal és a hibakóddal', async () => {
    const order = createOrder()
    const { payload } = createMockPayload(order)
    const { logger, alerts } = captureLevels()
    const result = await issueCorrectiveInvoiceForOrder(order, {
      payload,
      logger,
      config: ENABLED_CONFIG,
      queryByKulsoAzon: emptyLookup,
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      postXml: async () => {
        throw new SzamlazzApiError({
          message: 'Számla Agent hiba: 57',
          kind: 'agent',
          agentErrors: [{ code: '57', message: 'XML beolvasási hiba' }],
          retryable: false,
        })
      },
    })
    expect(result.outcome).toBe('failed')
    expect(alerts()).toHaveLength(1)
    expect(alerts()[0]?.message).toMatch(
      /^RIASZTÁS: a helyesbítő számla kiállítása végleges hibával leállt/,
    )
    expect(alerts()[0]?.context).toMatchObject({ orderNumber: ORDER_NUMBER, agentErrorCode: '57' })
  })

  it('eredeti számla nélkül: error-szintű RIASZTÁS (a számla előtti részleges visszatérítés kézi rendezést kér)', async () => {
    const order = createOrder({ invoiceNumber: null, invoiceStatus: 'failed' })
    const { payload } = createMockPayload(order)
    const { logger, alerts } = captureLevels()
    const result = await issueCorrectiveInvoiceForOrder(order, {
      payload,
      logger,
      config: ENABLED_CONFIG,
      queryByKulsoAzon: noLookup,
      refundSeq: 1,
      amountHuf: REFUND_HUF,
      postXml: forbiddenPost,
    })
    expect(result.outcome).toBe('failed')
    expect(alerts()).toHaveLength(1)
    expect(alerts()[0]?.message).toMatch(/^RIASZTÁS: a rendeléshez nem tartozik kiállított számla/)
    expect(alerts()[0]?.context).toMatchObject({ orderNumber: ORDER_NUMBER })
  })

  it('AAM-os helyesbítő megjegyzése is hordozza az adómentességi utalást (r-ado-10)', () => {
    const xml = buildCorrectiveInvoiceXml({
      agentKey: DUMMY_AGENT_KEY,
      originalInvoiceNumber: ORIGINAL_INVOICE_NUMBER,
      orderNumber: ORDER_NUMBER,
      kulsoAzon: correctiveKey(1),
      invoicePrefix: 'KIN',
      amountHuf: REFUND_HUF,
      issueDate: '2026-08-09',
      vatMode: 'AAM',
      buyer: BUYER,
    })
    expect(xml).toMatch(
      /<megjegyzes>Helyesbítő számla [^<]*Alanyi adómentes \(Áfa tv\. XIII\. fejezet\)\.<\/megjegyzes>/,
    )
  })
})
