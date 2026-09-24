import type { Payload } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'

// These pre-ledger fixtures exercise the unchanged legacy invoice contract.
vi.mock('../../lib/refund/intent-store', () => ({ loadRefundIntentsForOrder: async () => [] }))

import { getSzamlazzConfig } from '../../lib/szamlazz/client'
import type { Logger } from '../../lib/logger'
import {
  buildStornoXml,
  isRetryableStornoError,
  issueStornoForOrder,
  MAX_STORNO_ATTEMPTS,
  postStornoXml,
} from '../../lib/szamlazz/storno'
import { SzamlazzApiError } from '../../lib/szamlazz/types'
import type { Order } from '../../payload-types'

/**
 * Stornó-számla (T-WSD) egységtesztek — a dedikált Számla Agent sztornó
 * interfész (xmlszamlast / action-szamla_agent_st) XML-építése és az
 * issueStornoForOrder idempotens folyamata.
 *
 * Séma-forrás: https://www.szamlazz.hu/szamla/docs/xsds/agentst/xmlszamlast.xsd
 * (fejlec.szamlaszam = a stornózandó eredeti számla száma, tipus=SS,
 * tétel-/összegblokk nélkül).
 *
 * DUMMY érték, egyértelműen jelölve — NEM valódi Számla Agent kulcs.
 */
const DUMMY_AGENT_KEY = 'DUMMY-AGENT-KULCS-NEM-VALODI-TITOK'

const ORDER_NUMBER = 'KH-2026-000123'
const ORIGINAL_INVOICE_NUMBER = 'KIN-2026-7'

// Az áfakulcs 2026-08-17 óta KÖTELEZŐ bekapcsolt számlázásnál (a csendes '27'
// alapértelmezés megszűnt) — a fixtúra ezért kimondja.
const ENABLED_CONFIG = getSzamlazzConfig({
  SZAMLAZZ_AGENT_KEY: DUMMY_AGENT_KEY,
  SZAMLAZZ_AFAKULCS: '27',
})

function createOrder(overrides: Record<string, unknown> = {}): Order {
  return {
    id: 101,
    orderNumber: ORDER_NUMBER,
    status: 'refunded',
    invoiceStatus: 'issued',
    invoiceNumber: ORIGINAL_INVOICE_NUMBER,
    customerEmail: 'anna@example.test',
    totalHufSnapshot: 19990,
    items: [
      { product: 42, quantity: 1, titleSnapshot: 'DEMO-KEZREHAB-001', priceHufSnapshot: 19990 },
    ],
    customerSnapshot: {
      name: 'Teszt Anna',
      email: 'anna@example.test',
      billingName: 'Teszt Anna',
      billingZip: '1111',
      billingCity: 'Budapest',
      billingStreet: 'Példa utca 1.',
    },
    ...overrides,
  } as unknown as Order
}

function createMockPayload(order: Order) {
  const updates: Array<Record<string, unknown>> = []
  const payload = {
    update: async ({ data }: { data: Record<string, unknown> }) => {
      updates.push(data)
      Object.assign(order, data)
      return order
    },
  }
  return { payload: payload as unknown as Payload, updates, order }
}

/**
 * Naplófigyelő: a RIASZTÁS-ágakat error-szinten kell jelezni (F3) — a teszt a
 * tényleges naplóhívást ellenőrzi, nem csak a visszatérési értéket.
 */
function createCapturingLogger(): { logger: Logger; errors: string[] } {
  const errors: string[] = []
  const build = (): Logger => ({
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (msg: string) => {
      errors.push(msg)
    },
    child: () => build(),
  })
  return { logger: build(), errors }
}

describe('buildStornoXml — hivatalos Számla Agent sztornó séma (xmlszamlast)', () => {
  const xml = buildStornoXml({
    agentKey: DUMMY_AGENT_KEY,
    originalInvoiceNumber: ORIGINAL_INVOICE_NUMBER,
    orderNumber: ORDER_NUMBER,
    reason: 'Elállás a vásárlástól',
    buyerEmail: 'anna@example.test',
  })

  it('a gyökér xmlszamlast, az agentst XSD-vel; a sorrend kötött (beallitasok→fejlec→elado→vevo)', () => {
    expect(xml).toContain('<xmlszamlast xmlns="http://www.szamlazz.hu/xmlszamlast"')
    expect(xml).toContain('https://www.szamlazz.hu/szamla/docs/xsds/agentst/xmlszamlast.xsd')
    const order = ['<beallitasok>', '<fejlec>', '<elado>', '<vevo>']
    let previousIndex = -1
    for (const tag of order) {
      const index = xml.indexOf(tag)
      expect(index, tag).toBeGreaterThan(previousIndex)
      previousIndex = index
    }
  })

  it('hivatkozás: a fejlec szamlaszam mezője az EREDETI számla száma; tipus=SS', () => {
    expect(xml).toContain(`<szamlaszam>${ORIGINAL_INVOICE_NUMBER}</szamlaszam>`)
    expect(xml).toContain('<tipus>SS</tipus>')
  })

  it('C6 — dátumokat NEM küldünk: a teljesítésnek az eredetivel kell egyeznie, ezt a rendszer garantálja', () => {
    // A keltDatum/teljesitesDatum opcionális; kihagyva a Számlázz.hu tölti ki
    // őket — a teljesítést garantáltan az eredeti számláéval egyezően. Explicit
    // (mai napos) érték küldése a szabályt sértené, ha a refund később történik.
    expect(xml).not.toContain('<keltDatum>')
    expect(xml).not.toContain('<teljesitesDatum>')
  })

  it('beallitasok: agent-kulcs, eszamla, valaszVerzio 2', () => {
    expect(xml).toContain(`<szamlaagentkulcs>${DUMMY_AGENT_KEY}</szamlaagentkulcs>`)
    expect(xml).toContain('<eszamla>true</eszamla>')
    expect(xml).toContain('<valaszVerzio>2</valaszVerzio>')
  })

  it('F3 — szamlaKulsoAzon NINCS a stornó-kérésben (a hivatkozás a fejlec.szamlaszam)', () => {
    // A C3 szerint az xmlszamlast szamlaKulsoAzon mezője a SZTORNÓZANDÓ számlát
    // hivatkozza, NEM ad azonosítót a létrejövő stornónak — a rá épített
    // visszakeresés semmit nem bizonyítana, a vak újraküldés dupla stornót
    // okozhatna (C5: már nem javítható).
    expect(xml).not.toContain('<szamlaKulsoAzon>')
    expect(xml).not.toContain('-STORNO')
  })

  it('a stornó XML NEM tartalmaz tétel-/összegblokkot (a Számlázz.hu az eredeti számlából generál)', () => {
    for (const absent of ['<tetelek>', '<tetel>', '<nettoErtek>', '<afaErtek>', '<bruttoErtek>']) {
      expect(xml).not.toContain(absent)
    }
  })

  it('a megjegyzes a stornó indoka; a vevő csak e-mailt kap', () => {
    expect(xml).toContain('<megjegyzes>Elállás a vásárlástól</megjegyzes>')
    expect(xml).toContain('<email>anna@example.test</email>')
    expect(xml).not.toContain('<nev>')
  })

  it('indok nélkül a rendelésszámra utaló alap-megjegyzés kerül bele', () => {
    const withoutReason = buildStornoXml({
      agentKey: DUMMY_AGENT_KEY,
      originalInvoiceNumber: ORIGINAL_INVOICE_NUMBER,
      orderNumber: ORDER_NUMBER,
    })
    expect(withoutReason).toContain(
      `<megjegyzes>Visszatérítés (refund) — rendelés: ${ORDER_NUMBER}</megjegyzes>`,
    )
  })

  it('XML-escape: az indokban a < jel entitás', () => {
    const escaped = buildStornoXml({
      agentKey: DUMMY_AGENT_KEY,
      originalInvoiceNumber: ORIGINAL_INVOICE_NUMBER,
      orderNumber: ORDER_NUMBER,
      reason: 'Ár <eltérés> & "jelölés"',
    })
    expect(escaped).toContain('Ár &lt;eltérés&gt; &amp; &quot;jelölés&quot;')
  })
})

describe('issueStornoForOrder', () => {
  it('boldog út: storned + stornoNumber; a küldött XML az eredeti számlára hivatkozik', async () => {
    const sentXml: string[] = []
    const result = await issueStornoForOrder(createOrder(), {
      config: ENABLED_CONFIG,
      reason: 'Elállás',
      postXml: async (xml) => {
        sentXml.push(xml)
        return { szamlaszam: 'KIN-2026-8' }
      },
    })

    expect(result).toEqual({ outcome: 'storned', stornoNumber: 'KIN-2026-8' })
    expect(sentXml).toHaveLength(1)
    expect(sentXml[0]).toContain(`<szamlaszam>${ORIGINAL_INVOICE_NUMBER}</szamlaszam>`)
    expect(sentXml[0]).not.toContain('<szamlaKulsoAzon>')
    expect(sentXml[0]).toContain('<tipus>SS</tipus>')
  })

  it('idempotens: rögzített stornoNumber mellett already-storned (nincs új hívás)', async () => {
    const order = createOrder({ stornoNumber: 'KIN-2026-8', stornoStatus: 'storned' })
    let calls = 0
    const result = await issueStornoForOrder(order, {
      config: ENABLED_CONFIG,
      postXml: async () => {
        calls += 1
        return { szamlaszam: 'X' }
      },
    })
    expect(result).toEqual({ outcome: 'already-storned', stornoNumber: 'KIN-2026-8' })
    expect(calls).toBe(0)
  })

  it('kikapcsolt integrációnál disabled (no-op, NEM hiba)', async () => {
    const result = await issueStornoForOrder(createOrder(), {
      config: getSzamlazzConfig({}),
      postXml: async () => expect.unreachable('nem hívható'),
    })
    expect(result.outcome).toBe('disabled')
  })

  it('hiányzó eredeti számlaszámnál failed, NEM dob (emberi pótlás kell, nem retry)', async () => {
    const order = createOrder({ invoiceNumber: null, invoiceStatus: 'failed' })
    let calls = 0
    const result = await issueStornoForOrder(order, {
      config: ENABLED_CONFIG,
      postXml: async () => {
        calls += 1
        return { szamlaszam: 'X' }
      },
    })
    expect(result.outcome).toBe('failed')
    expect(result.reason).toContain('számlaszám')
    expect(calls).toBe(0)
  })

  it('retryable provider-hibánál THROW (a hívó RIASZTÁST ír, automatikus retry tilos)', async () => {
    await expect(
      issueStornoForOrder(createOrder(), {
        config: ENABLED_CONFIG,
        postXml: async () => {
          throw new SzamlazzApiError({ message: 'timeout', kind: 'timeout', retryable: true })
        },
      }),
    ).rejects.toThrow('timeout')
  })

  it('agent-elutasításnál (nem retryable) failed kimenet, nem dob', async () => {
    const result = await issueStornoForOrder(createOrder(), {
      config: ENABLED_CONFIG,
      postXml: async () => {
        throw new SzamlazzApiError({
          message: 'Számla Agent hiba: a számla már stornózva van',
          kind: 'agent',
          retryable: false,
        })
      },
    })
    expect(result.outcome).toBe('failed')
    expect(result.reason).toContain('stornózva')
  })
})

/**
 * C4 — a stornó ÁLLAPOTA a rendelésen (stornoStatus/stornoNumber/
 * stornoAttempts/stornoLastError) és a retry-döntés.
 */
describe('issueStornoForOrder — állapot a rendelésen (C4)', () => {
  it('boldog út: pending → storned, a stornó száma és a kísérletszám rögzül', async () => {
    const { payload, order, updates } = createMockPayload(createOrder())
    const result = await issueStornoForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      postXml: async () => ({ szamlaszam: 'KIN-2026-8' }),
    })

    expect(result).toEqual({ outcome: 'storned', stornoNumber: 'KIN-2026-8' })
    expect(updates[0]).toEqual({ stornoStatus: 'pending', stornoAttempts: 1 })
    expect(updates[1]).toEqual({
      stornoStatus: 'storned',
      stornoNumber: 'KIN-2026-8',
      stornoAttempts: 1,
      stornoLastError: null,
    })
    expect(order.stornoStatus).toBe('storned')
    expect(order.stornoNumber).toBe('KIN-2026-8')
  })

  it('retryable hibánál failed állapot + hibaüzenet, és a hiba DOBÓDIK (job-retry)', async () => {
    const { payload, order } = createMockPayload(createOrder())
    const error = new SzamlazzApiError({
      message: 'A Számlázz.hu nem válaszolt 15000 ms-en belül.',
      kind: 'timeout',
      retryable: true,
    })
    await expect(
      issueStornoForOrder(order, {
        payload,
        config: ENABLED_CONFIG,
        postXml: async () => {
          throw error
        },
      }),
    ).rejects.toThrow('nem válaszolt')

    expect(order.stornoStatus).toBe('failed')
    expect(order.stornoAttempts).toBe(1)
    expect(order.stornoLastError).toContain('nem válaszolt')
    expect(isRetryableStornoError(error)).toBe(true)
  })

  it('F3 — korábbi beküldés után NINCS vak újraküldés: failed + RIASZTÁS, kézi ellenőrzés', async () => {
    // A stornó nem kereshető vissza saját kulccsal (a szamlaKulsoAzon a
    // SZTORNÓZANDÓ számlát hivatkozná), ezért bizonytalan állapotban a
    // szolgáltatás megáll — a vak újraküldés dupla stornót okozhatna.
    const { payload, order } = createMockPayload(createOrder({ stornoAttempts: 1 }))
    const { logger, errors } = createCapturingLogger()
    let posts = 0
    const result = await issueStornoForOrder(order, {
      payload,
      logger,
      config: ENABLED_CONFIG,
      postXml: async () => {
        posts += 1
        return { szamlaszam: 'X' }
      },
    })

    expect(result.outcome).toBe('failed')
    expect(result.reason).toContain('bizonytalan')
    expect(result.reason).toContain('kézi ellenőrzés')
    expect(posts).toBe(0)
    expect(order.stornoStatus).toBe('failed')
    expect(order.stornoAttempts).toBe(1)
    expect(order.stornoLastError).toContain('bizonytalan')
    expect(errors.some((msg) => msg.startsWith('RIASZTÁS'))).toBe(true)
  })

  it('F3 — 71/152 duplikátum-jelzés: failed + RIASZTÁS, lekérdezés NÉLKÜL, kézi egyeztetéssel', async () => {
    const { payload, order } = createMockPayload(createOrder())
    const { logger, errors } = createCapturingLogger()
    const result = await issueStornoForOrder(order, {
      payload,
      logger,
      config: ENABLED_CONFIG,
      postXml: async () => {
        throw new SzamlazzApiError({
          message: 'Számla Agent hiba: 152 — Már létező rendelésszám.',
          kind: 'duplicate',
          agentErrors: [{ code: '152', message: 'Már létező rendelésszám.' }],
          retryable: false,
        })
      },
    })

    expect(result.outcome).toBe('failed')
    expect(result.reason).toContain('kézi egyeztetés')
    // A LEGFONTOSABB tény az üzenetben: a bizonylat vélhetően már létezik.
    expect(result.reason).toContain('MÁR LÉTEZIK')
    expect(order.stornoStatus).toBe('failed')
    expect(order.stornoNumber).toBeUndefined()
    expect(order.stornoLastError).toContain('kézi egyeztetés')
    expect(errors.some((msg) => msg.startsWith('RIASZTÁS'))).toBe(true)
  })

  it('nem retryable hibánál failed állapot, de NEM dob (nincs job-retry)', async () => {
    const { payload, order } = createMockPayload(createOrder())
    const error = new SzamlazzApiError({
      message: 'Számla Agent elutasította: a számla már stornózva van',
      kind: 'agent',
      retryable: false,
    })
    const result = await issueStornoForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      postXml: async () => {
        throw error
      },
    })
    expect(result.outcome).toBe('failed')
    expect(order.stornoStatus).toBe('failed')
    expect(isRetryableStornoError(error)).toBe(false)
  })

  it('a kísérletszám kimerülése után failed, hálózati hívás NÉLKÜL', async () => {
    const { payload, order } = createMockPayload(
      createOrder({ stornoStatus: 'failed', stornoAttempts: MAX_STORNO_ATTEMPTS }),
    )
    let calls = 0
    const result = await issueStornoForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      postXml: async () => {
        calls += 1
        return { szamlaszam: 'X' }
      },
    })
    expect(result.outcome).toBe('failed')
    expect(result.reason).toContain('kimerült')
    expect(calls).toBe(0)
  })

  it('hiányzó eredeti számlaszámnál a failed állapot a rendelésre kerül', async () => {
    const { payload, order } = createMockPayload(createOrder({ invoiceNumber: null }))
    const result = await issueStornoForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      postXml: async () => expect.unreachable('nem hívható'),
    })
    expect(result.outcome).toBe('failed')
    expect(order.stornoStatus).toBe('failed')
    expect(order.stornoLastError).toContain('számlaszám')
  })

  it('a rendelésszám nélküli rendelésnél failed, hálózati hívás NÉLKÜL', async () => {
    const { payload, order } = createMockPayload(createOrder({ orderNumber: null }))
    const result = await issueStornoForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      postXml: async () => expect.unreachable('nem hívható'),
    })
    expect(result.outcome).toBe('failed')
    expect(order.stornoStatus).toBe('failed')
  })

  it('a már stornózott rendelésnél egyetlen DB-írás sincs (idempotens no-op)', async () => {
    const { payload, order, updates } = createMockPayload(
      createOrder({ stornoStatus: 'storned', stornoNumber: 'KIN-2026-8' }),
    )
    const result = await issueStornoForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      postXml: async () => expect.unreachable('nem hívható'),
    })
    expect(result.outcome).toBe('already-storned')
    expect(updates).toHaveLength(0)
  })
})

describe('issueStornoForOrder — 56-os jelzés (a stornó kiállt, az értesítő nem ment ki)', () => {
  it('storned + stornószám rögzítve, és error-szintű RIASZTÁS a kézi újraküldéshez', async () => {
    const { payload, order } = createMockPayload(createOrder())
    const { logger, errors } = createCapturingLogger()
    const result = await issueStornoForOrder(order, {
      payload,
      config: ENABLED_CONFIG,
      logger,
      postXml: async () => ({
        szamlaszam: 'KIN-2026-8',
        notificationError: { code: '56', message: 'A számlaértesítő kézbesítése sikertelen.' },
      }),
    })
    expect(result).toEqual({ outcome: 'storned', stornoNumber: 'KIN-2026-8' })
    expect(order.stornoNumber).toBe('KIN-2026-8')
    expect(order.stornoStatus).toBe('storned')
    const alert = errors.find((message) => message.includes('számlaértesítő e-mail NEM ment ki'))
    expect(alert?.startsWith('RIASZTÁS:')).toBe(true)
  })
})

/**
 * F6 — a válasz-TÖRZS olvasása is megszakadhat (streamelés közbeni timeout,
 * TCP-vágás). Ha ez nyers TypeError-ként lépne ki, elveszne a retryable
 * osztályozás, és a refund-ág nem tudná, hogy a POST már elindult
 * (bizonytalan állapot, RIASZTÁS nélkül).
 *
 * A fetch stubolt: a teszt SOHA nem megy ki a valódi Számlázz.hu-ra.
 */
describe('postStornoXml — a törzs-olvasás hibája is osztályozott (F6)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Válasz-váz, amelynek a text() metódusa a megadott hibával bukik. */
  function stubFetchWithFailingBody(error: unknown): void {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => {
        throw error
      },
    }))
  }

  async function captureError(): Promise<unknown> {
    return postStornoXml('<xmlszamlast />', ENABLED_CONFIG).then(
      () => expect.unreachable('a hívásnak hibáznia kell'),
      (error: unknown) => error,
    )
  }

  it('megszakadt törzs-olvasás → timeout-kind, retryable SzamlazzApiError', async () => {
    const aborted = new Error('The operation was aborted.')
    aborted.name = 'AbortError'
    stubFetchWithFailingBody(aborted)

    const error = await captureError()
    expect(error).toBeInstanceOf(SzamlazzApiError)
    expect((error as SzamlazzApiError).kind).toBe('timeout')
    expect((error as SzamlazzApiError).retryable).toBe(true)
  })

  it('egyéb olvasási hiba → network-kind, retryable (a nyers TypeError nem szivárog ki)', async () => {
    stubFetchWithFailingBody(new TypeError('terminated'))

    const error = await captureError()
    expect(error).toBeInstanceOf(SzamlazzApiError)
    expect((error as SzamlazzApiError).kind).toBe('network')
    expect((error as SzamlazzApiError).retryable).toBe(true)
  })

  it('a Számla Agent üzleti hibája VÁLTOZATLAN marad (nem minősül át retryable-re)', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () =>
        '<?xml version="1.0"?><xmlszamlavalasz><sikeres>false</sikeres><hibakod>57</hibakod><hibauzenet>Hibás tételösszeg</hibauzenet></xmlszamlavalasz>',
    }))

    const error = await captureError()
    expect(error).toBeInstanceOf(SzamlazzApiError)
    expect((error as SzamlazzApiError).kind).toBe('agent')
    expect((error as SzamlazzApiError).retryable).toBe(false)
  })
})
