import type { Payload } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/refund/intent-store', () => ({ loadRefundIntentsForOrder: async () => [] }))

import { getSzamlazzConfig } from '../../lib/szamlazz/client'
import { issueCorrectiveInvoiceForOrder } from '../../lib/szamlazz/corrective'
import type { Order } from '../../payload-types'

/**
 * A helyesbítő előtti áfakulcs-ellenőrzés a VALÓDI számlaadat-lekérdezővel
 * (action-szamla_agent_xml), mockolt fetch-csel: a <szamla> válasz-dokumentum
 * értelmezése a gazdahatáron (issueCorrectiveInvoiceForOrder) bizonyított. A
 * válasz-fixtúrák a hivatalos „Kimenő számlák" minta (docs.szamlazz.hu,
 * szamla.xsd) szerkezetét követik: szallito → alap → vevo → tetelek → osszegek,
 * a tételen az opcionális <afatipus> (AAM, TAM, …) és a numerikus <afakulcs>.
 *
 * DUMMY érték, egyértelműen jelölve — NEM valódi Számla Agent kulcs.
 */
const DUMMY_AGENT_KEY = 'DUMMY-AGENT-KULCS-NEM-VALODI-TITOK'
const ORIGINAL_INVOICE_NUMBER = 'KIN-2026-7'

function config(afakulcs: '27' | 'AAM') {
  return getSzamlazzConfig({ SZAMLAZZ_AGENT_KEY: DUMMY_AGENT_KEY, SZAMLAZZ_AFAKULCS: afakulcs })
}

/** Az eredeti számla adat-dokumentuma egy tétellel. */
function invoiceDocument(tetelAfa: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<szamla xmlns="http://www.szamlazz.hu/szamla">
  <szallito><id>1</id><nev>KINETICARE Kft.</nev><adoszam>12345676-1-42</adoszam></szallito>
  <alap>
    <id>123456</id>
    <szamlaszam>${ORIGINAL_INVOICE_NUMBER}</szamlaszam>
    <tipus>SZ</tipus>
    <kelt>2026-09-20</kelt>
    <telj>2026-09-20</telj>
    <rendelesszam>KH-2026-000123</rendelesszam>
    <teszt>false</teszt>
  </alap>
  <vevo><id>7</id><nev>Teszt Anna</nev><cim><orszag>Magyarország</orszag><irsz>1111</irsz><telepules>Budapest</telepules><cim>Példa utca 1.</cim></cim><lokacio>1</lokacio></vevo>
  <tetelek>
    <tetel>
      <nev>Kézrehabilitáció otthon</nev>
      <mennyiseg>1.0</mennyiseg>
      <mennyisegiegyseg>db</mennyisegiegyseg>
      <nettoegysegar>19990.0</nettoegysegar>
      ${tetelAfa}
      <netto>19990.0</netto>
      <afa>0.0</afa>
      <brutto>19990.0</brutto>
    </tetel>
  </tetelek>
</szamla>`
}

function createOrder(): Order {
  return {
    id: 101,
    orderNumber: 'KH-2026-000123',
    createdAt: '2026-09-20T10:00:00.000Z',
    status: 'paid',
    invoiceStatus: 'issued',
    invoiceNumber: ORIGINAL_INVOICE_NUMBER,
    correctiveInvoiceStatus: 'none',
    correctiveInvoiceSeq: 0,
    customerEmail: 'anna@example.test',
    totalHufSnapshot: 19990,
    customerSnapshot: {
      name: 'Teszt Anna',
      email: 'anna@example.test',
      billingName: 'Teszt Anna',
      billingZip: '1111',
      billingCity: 'Budapest',
      billingStreet: 'Példa utca 1.',
    },
  } as unknown as Order
}

function createMockPayload(order: Order): Payload {
  return {
    update: async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(order, data)
      return order
    },
  } as unknown as Payload
}

/** A fetch-mock csak a számlaadat-lekérdezést szolgálja ki; minden más kérés hangos hiba. */
function stubInvoiceDataResponse(response: () => Response): { multipartFields: string[] } {
  const multipartFields: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: FormData }) => {
      const fields = [...init.body.keys()]
      multipartFields.push(...fields)
      if (!fields.includes('action-szamla_agent_xml')) {
        throw new Error(`TESZT-HIBA: váratlan Számlázz.hu-kérés (${fields.join(', ')})`)
      }
      return response()
    }),
  )
  return { multipartFields }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

async function run(afakulcs: '27' | 'AAM') {
  const order = createOrder()
  let posts = 0
  const outcome = issueCorrectiveInvoiceForOrder(order, {
    payload: createMockPayload(order),
    config: config(afakulcs),
    queryByKulsoAzon: async () => null,
    refundSeq: 1,
    amountHuf: 5000,
    postXml: async () => {
      posts += 1
      return { szamlaszam: 'KIN-2026-HE-1' }
    },
  })
  return { order, outcome, posts: () => posts }
}

describe('helyesbítő — az eredeti számla áfakulcsa a Számlázz.hu számlaadat-válaszából', () => {
  it('AAM-os eredeti (afatipus AAM, afakulcs 0) és AAM-os konfig: a helyesbítő kiáll', async () => {
    const { multipartFields } = stubInvoiceDataResponse(
      () =>
        new Response(invoiceDocument('<afatipus>AAM</afatipus><afakulcs>0</afakulcs>'), {
          status: 200,
        }),
    )
    const { outcome, posts } = await run('AAM')
    await expect(outcome).resolves.toEqual({
      outcome: 'issued',
      correctiveInvoiceNumber: 'KIN-2026-HE-1',
    })
    expect(posts()).toBe(1)
    expect(multipartFields).toEqual(['action-szamla_agent_xml'])
  })

  it('27%-os eredeti (afatipus nélkül, afakulcs 27.0) és AAM-os konfig: failed, helyesbítő NEM megy ki', async () => {
    stubInvoiceDataResponse(
      () => new Response(invoiceDocument('<afakulcs>27.0</afakulcs>'), { status: 200 }),
    )
    const { order, outcome, posts } = await run('AAM')
    const result = await outcome
    expect(result.outcome).toBe('failed')
    expect(result.reason).toContain('(27)')
    expect(posts()).toBe(0)
    expect(order.correctiveInvoiceStatus).toBe('failed')
  })

  it('ismeretlen számlaszám (200 + 7-es kód): végleges, failed, helyesbítő NEM megy ki', async () => {
    stubInvoiceDataResponse(
      () =>
        new Response(
          '<xmlszamlavalasz><sikeres>false</sikeres><hibakod>7</hibakod>' +
            '<hibauzenet>Hiányzó adat: számla xml</hibauzenet></xmlszamlavalasz>',
          { status: 200 },
        ),
    )
    const { outcome, posts } = await run('27')
    await expect(outcome).resolves.toMatchObject({ outcome: 'failed' })
    expect(posts()).toBe(0)
  })

  it('503: újrapróbálható dobás, helyesbítő NEM megy ki', async () => {
    stubInvoiceDataResponse(() => new Response('<html>Service Unavailable</html>', { status: 503 }))
    const { outcome, posts } = await run('27')
    await expect(outcome).rejects.toMatchObject({ retryable: true })
    expect(posts()).toBe(0)
  })
})
