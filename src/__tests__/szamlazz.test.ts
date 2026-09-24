import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InvoiceDataResult } from '../lib/szamlazz/invoice-data'
import type { SzamlazzClientConfig } from '../lib/szamlazz/types'

// A számlaadat-lekérdezés (régi kulcson talált számla egyeztetése) a
// modul-határon mockolt (új fetch-es kódhoz nincs injektálási paraméter).
// Alapból hangosan bukik: ahol nem szabad futnia, ott nem is fut.
const invoiceData = vi.hoisted(() => {
  const unexpected = async (): Promise<InvoiceDataResult> => {
    throw new Error('TESZT-HIBA: ezen az ágon nem futhat számlaadat-lekérdezés')
  }
  return {
    unexpected,
    query:
      vi.fn<(szamlaszam: string, config?: SzamlazzClientConfig) => Promise<InvoiceDataResult>>(
        unexpected,
      ),
  }
})
vi.mock('../lib/szamlazz/invoice-data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/szamlazz/invoice-data')>()),
  queryInvoiceData: invoiceData.query,
}))
beforeEach(() => {
  invoiceData.query.mockReset()
  invoiceData.query.mockImplementation(invoiceData.unexpected)
})

import { resetAlertThrottle } from '../lib/alert-throttle'
import {
  getSzamlazzConfig,
  isDuplicateOrderError,
  parseAgentResponse,
} from '../lib/szamlazz/client'
import {
  buildInvoiceXml,
  buyerFromOrder,
  computeLineAmounts,
  escapeXml,
  isTrustedInvoicePdfUrl,
  issueInvoiceForOrder,
  itemsFromOrder,
  LOOKUP_FAILURE_ALERT_AFTER_MS,
  LOOKUP_FAILURE_ESCALATION_MS,
  MAX_INVOICE_ATTEMPTS,
  VAT_RATE_PERCENT,
  type InvoiceLineAmounts,
} from '../lib/szamlazz/invoice'
import type { OrderPaidMoment } from '../lib/szamlazz/paid-date'
import { queryInvoiceByKulsoAzon, type InvoiceLookupResult } from '../lib/szamlazz/pdf'
import { SzamlazzApiError, type IssueInvoiceResult } from '../lib/szamlazz/types'
import { budapestDateString, isIsoDateString } from '../lib/szamlazz/xml'
import type { Order } from '../payload-types'

/**
 * Számlázz.hu (T-024/W4-01) egységtesztek — config-feloldás, XML-építés a
 * hivatalos Számla Agent séma szerint, válasz-értelmezés (XML + szlahu_*
 * fejlécek), és a számlakiállítás idempotens folyamata mockolt payloaddal.
 *
 * DUMMY érték, egyértelműen jelölve — NEM valódi Számla Agent kulcs.
 */
const DUMMY_AGENT_KEY = 'DUMMY-AGENT-KULCS-NEM-VALODI-TITOK'

const ORDER_NUMBER = 'KH-2026-000123'

describe('getSzamlazzConfig', () => {
  it('SZAMLAZZ_AGENT_KEY nélkül kikapcsolt (enabled=false), nem hiba', () => {
    const config = getSzamlazzConfig({})
    expect(config.enabled).toBe(false)
    expect(config.agentKey).toBeUndefined()
    // ZÁRÓ PERJELLEL: a perjel nélküli alak redirectet kaphat, ami a POST-ot
    // GET-té alakítaná (a multipart törzs elveszne).
    expect(config.apiUrl).toBe('https://www.szamlazz.hu/szamla/')
    expect(config.invoicePrefix).toBe('KIN')
    expect(config.vatMode).toBe('27')
    expect(config.timeoutMs).toBe(15_000)
  })

  it('SZAMLAZZ_API_URL perjel nélkül megadva is záró perjelet kap', () => {
    const config = getSzamlazzConfig({ SZAMLAZZ_API_URL: 'https://www.szamlazz.hu/szamla' })
    expect(config.apiUrl).toBe('https://www.szamlazz.hu/szamla/')
  })

  it('SZAMLAZZ_AFAKULCS: AAM elfogadott, ismeretlen érték hangosan dob', () => {
    expect(getSzamlazzConfig({ SZAMLAZZ_AFAKULCS: 'AAM' }).vatMode).toBe('AAM')
    expect(() => getSzamlazzConfig({ SZAMLAZZ_AFAKULCS: '0' })).toThrowError(/SZAMLAZZ_AFAKULCS/)
    expect(() => getSzamlazzConfig({ SZAMLAZZ_AFAKULCS: 'TAM' })).toThrowError(/AAM/)
  })

  it('BEKAPCSOLT számlázásnál a hiányzó áfakulcs HANGOSAN dob, nem esik 27-re', () => {
    /**
     * MIÉRT ŐRIZZÜK: a csendes `'27'` alapértelmezés egy alanyi adómentes
     * eladónál minden bizonylatot elrontana, ráadásul némán — utólag csak
     * helyesbítő számlával javítható. A tulajdonos 2026-08-17-i jelzése
     * (a gyógytornászok AAM-ben dolgoznak) pont ezt a kockázatot élesítette.
     */
    expect(() => getSzamlazzConfig({ SZAMLAZZ_AGENT_KEY: DUMMY_AGENT_KEY })).toThrowError(
      /SZAMLAZZ_AFAKULCS nincs beállítva/,
    )
    // …de megadva rendben elindul, és pontosan azt a kulcsot használja.
    expect(
      getSzamlazzConfig({ SZAMLAZZ_AGENT_KEY: DUMMY_AGENT_KEY, SZAMLAZZ_AFAKULCS: 'AAM' }).vatMode,
    ).toBe('AAM')
    expect(
      getSzamlazzConfig({ SZAMLAZZ_AGENT_KEY: DUMMY_AGENT_KEY, SZAMLAZZ_AFAKULCS: '27' }).vatMode,
    ).toBe('27')
  })

  it('KIKAPCSOLT számlázásnál viszont nem kényszerít semmit (nincs bizonylat)', () => {
    // Fejlesztői és teszt-környezet: agent-kulcs nélkül számla nem keletkezik,
    // tehát nincs mit elrontani — az alapértelmezés ott ártalmatlan.
    const config = getSzamlazzConfig({})
    expect(config.enabled).toBe(false)
    expect(config.vatMode).toBe('27')
  })

  it('a-szamlazz-11 + a-refund-14: a SZAMLAZZ_TIMEOUT_MS felső korlátja 15 s (a zár-tranzakció és a refund-panel határideje miatt)', () => {
    const base = { SZAMLAZZ_AGENT_KEY: DUMMY_AGENT_KEY, SZAMLAZZ_AFAKULCS: 'AAM' }
    expect(getSzamlazzConfig({ ...base, SZAMLAZZ_TIMEOUT_MS: '60000' }).timeoutMs).toBe(15000)
    expect(getSzamlazzConfig({ ...base, SZAMLAZZ_TIMEOUT_MS: '15001' }).timeoutMs).toBe(15000)
    expect(getSzamlazzConfig({ ...base, SZAMLAZZ_TIMEOUT_MS: '8000' }).timeoutMs).toBe(8000)
  })

  it('kulccsal enabled; prefix és timeout felülírható', () => {
    const config = getSzamlazzConfig({
      SZAMLAZZ_AGENT_KEY: DUMMY_AGENT_KEY,
      SZAMLAZZ_AFAKULCS: '27',
      SZAMLAZZ_INVOICE_PREFIX: 'TESZT',
      SZAMLAZZ_TIMEOUT_MS: '5000',
    })
    expect(config.enabled).toBe(true)
    expect(config.agentKey).toBe(DUMMY_AGENT_KEY)
    expect(config.invoicePrefix).toBe('TESZT')
    expect(config.timeoutMs).toBe(5000)
  })

  it('nem https SZAMLAZZ_API_URL esetén dob (elgépelés ne csendben működjön)', () => {
    expect(() =>
      getSzamlazzConfig({ SZAMLAZZ_AGENT_KEY: DUMMY_AGENT_KEY, SZAMLAZZ_API_URL: 'http://x.hu' }),
    ).toThrow('SZAMLAZZ_API_URL')
  })
})

describe('computeLineAmounts — 27% ÁFA, bruttóból', () => {
  it('mennyiség=1: netto+afa=brutto pontosan, nettoEgysegar=nettoErtek', () => {
    const amounts = computeLineAmounts({
      megnevezes: 'Kurzus',
      mennyiseg: 1,
      bruttoEgysegar: 19990,
    })
    expect(amounts.bruttoErtek).toBe(19990)
    expect(amounts.nettoErtek).toBe(Math.round(19990 / 1.27)) // 15740
    expect(amounts.afaErtek).toBe(19990 - amounts.nettoErtek)
    expect(amounts.nettoEgysegar).toBe(String(amounts.nettoErtek))
  })

  it('mennyiseg>1: a tételösszegek konzisztensek (netto+afa=brutto)', () => {
    const amounts = computeLineAmounts({ megnevezes: 'Kurzus', mennyiseg: 3, bruttoEgysegar: 9999 })
    expect(amounts.bruttoErtek).toBe(29997)
    expect(amounts.nettoErtek + amounts.afaErtek).toBe(amounts.bruttoErtek)
  })

  it('érvénytelen mennyiség/ár esetén invalid_data hibát dob (nem retryable)', () => {
    expect(() =>
      computeLineAmounts({ megnevezes: 'x', mennyiseg: 0, bruttoEgysegar: 100 }),
    ).toThrow(SzamlazzApiError)
    expect(() => computeLineAmounts({ megnevezes: 'x', mennyiseg: 1, bruttoEgysegar: -5 })).toThrow(
      SzamlazzApiError,
    )
  })
})

/**
 * A Számlázz.hu NEM számol, hanem tételenként VALIDÁLJA a három egyenletet
 * (259–264 hibakódok):
 *   (1) nettoEgysegar × mennyiseg = nettoErtek
 *   (2) nettoErtek × afakulcs / 100 = afaErtek
 *   (3) nettoErtek + afaErtek = bruttoErtek
 * Egész forintos összegekkel mindhárom EGYSZERRE nem tartható — a HIBRID
 * számítás (bruttó tétel-érték + legfeljebb 2 tizedes nettó egységár) az
 * eltérést oda tolja, ahol a legkisebb: (3) pontos, (2) ≤ ~0,64 Ft
 * MENNYISÉGTŐL FÜGGETLENÜL, (1) ≤ 0,005 × mennyiseg (99 db-nál is ≤ 0,5 Ft).
 * A korábbi, egységár-szintű kerekítés a (2) hibáját a mennyiséggel szorozta
 * (7 db → 1,4 Ft; 99 db → ~20 Ft) — az a 260/263 hibakód kockázata volt.
 */
describe('computeLineAmounts — tétel-egyenletek mennyiség > 1 esetén', () => {
  /** A checkout 1–99 db-ot enged — a széleket és néhány közbenső értéket nézzük. */
  const QUANTITIES = [1, 3, 7, 10, 99] as const
  const PRICES = [9999, 19990, 1] as const

  /** A három hivatalos egyenlet a dokumentált tűréssel. */
  function expectLineEquations(
    amounts: InvoiceLineAmounts,
    mennyiseg: number,
    vatRate: number,
    label: string,
  ): void {
    expect(
      Math.abs(Number(amounts.nettoEgysegar) * mennyiseg - amounts.nettoErtek),
      `(1) egységár × mennyiség — ${label}`,
    ).toBeLessThanOrEqual(0.5)
    expect(
      Math.abs(amounts.nettoErtek * vatRate - amounts.afaErtek),
      `(2) nettó × áfakulcs — ${label}`,
    ).toBeLessThanOrEqual(1)
    expect(amounts.nettoErtek + amounts.afaErtek, `(3) nettó + áfa — ${label}`).toBe(
      amounts.bruttoErtek,
    )
  }

  it('27%: mindhárom egyenlet a tűrésen belül, a bruttó tétel-érték PONTOS', () => {
    for (const bruttoEgysegar of PRICES) {
      for (const mennyiseg of QUANTITIES) {
        const amounts = computeLineAmounts({ megnevezes: 'Kurzus', mennyiseg, bruttoEgysegar })
        const label = `${bruttoEgysegar} × ${mennyiseg}`
        expectLineEquations(amounts, mennyiseg, VAT_RATE_PERCENT / 100, label)
        expect(amounts.bruttoErtek, label).toBe(bruttoEgysegar * mennyiseg)
        // A nettó egységár alakja: pont tizedesjel, legfeljebb 2 tizedes.
        expect(amounts.nettoEgysegar, label).toMatch(/^\d+(\.\d{1,2})?$/)
      }
    }
  })

  it('mennyiseg=1: az egységár PONTOSAN a nettoErtek (visszafelé kompatibilis, tizedesek nélkül)', () => {
    const amounts = computeLineAmounts({
      megnevezes: 'Kurzus',
      mennyiseg: 1,
      bruttoEgysegar: 19990,
    })
    expect(amounts.nettoEgysegar).toBe(String(amounts.nettoErtek))
    expect(Number(amounts.nettoEgysegar) * 1).toBe(amounts.nettoErtek)
  })

  it('az áfa-egyenlet hibája NEM nő a mennyiséggel (a regresszió, amit a hibrid megszüntetett)', () => {
    const eltereses = QUANTITIES.map((mennyiseg) => {
      const amounts = computeLineAmounts({ megnevezes: 'Kurzus', mennyiseg, bruttoEgysegar: 19990 })
      return Math.abs(amounts.nettoErtek * (VAT_RATE_PERCENT / 100) - amounts.afaErtek)
    })
    // Az egységár-alapú kerekítés qty=99-nél ~20 Ft-ot adott volna itt.
    expect(Math.max(...eltereses)).toBeLessThanOrEqual(0.64)
  })

  it('AAM (alanyi adómentes): nettoErtek = bruttoErtek, afaErtek = 0 minden mennyiségre', () => {
    for (const mennyiseg of QUANTITIES) {
      const amounts = computeLineAmounts(
        { megnevezes: 'Kurzus', mennyiseg, bruttoEgysegar: 19990 },
        { vatMode: 'AAM' },
      )
      const label = `AAM × ${mennyiseg}`
      expect(amounts.bruttoErtek, label).toBe(19990 * mennyiseg)
      expect(amounts.nettoErtek, label).toBe(amounts.bruttoErtek)
      expect(amounts.afaErtek, label).toBe(0)
      expectLineEquations(amounts, mennyiseg, 0, label)
    }
  })

  it('negatív (korrekciós) tétel: mind a négy érték előjelet vált, az egyenletek állnak', () => {
    for (const mennyiseg of QUANTITIES) {
      const positive = computeLineAmounts({ megnevezes: 'x', mennyiseg, bruttoEgysegar: 9999 })
      const negative = computeLineAmounts(
        { megnevezes: 'x', mennyiseg, bruttoEgysegar: -9999 },
        { allowNegative: true },
      )
      const label = `helyesbítő × ${mennyiseg}`
      expect(negative.nettoEgysegar, label).toBe(`-${positive.nettoEgysegar}`)
      expect(negative.nettoErtek, label).toBe(-positive.nettoErtek)
      expect(negative.afaErtek, label).toBe(-positive.afaErtek)
      expect(negative.bruttoErtek, label).toBe(-positive.bruttoErtek)
      // Az egyenletek negatív tételen is teljesülnek (a helyesbítő így nullázza az eredetit).
      expectLineEquations(negative, mennyiseg, VAT_RATE_PERCENT / 100, label)
    }
  })
})

describe('buildInvoiceXml — hivatalos Számla Agent séma', () => {
  const xml = buildInvoiceXml({
    agentKey: DUMMY_AGENT_KEY,
    orderNumber: ORDER_NUMBER,
    invoicePrefix: 'KIN',
    issueDate: '2026-08-04',
    buyer: {
      nev: 'Teszt Anna',
      irsz: '1111',
      telepules: 'Budapest',
      cim: 'Példa utca 1.',
      email: 'anna@example.test',
      adoszam: '12345678-1-42',
    },
    items: [{ megnevezes: 'DEMO Kurzus <b>', mennyiseg: 1, bruttoEgysegar: 19990 }],
  })

  it('a kötelező váz-tagok megvannak, a sorrend kötött (beallitasok→fejlec→elado→vevo→fuvarlevel→tetelek)', () => {
    expect(xml).toContain('<xmlszamla xmlns="http://www.szamlazz.hu/xmlszamla"')
    const order = ['<beallitasok>', '<fejlec>', '<elado>', '<vevo>', '<fuvarlevel>', '<tetelek>']
    let previousIndex = -1
    for (const tag of order) {
      const index = xml.indexOf(tag)
      expect(index, tag).toBeGreaterThan(previousIndex)
      previousIndex = index
    }
    // Üresen is jelen lévő, SZÖVEGES (xs:string) váz-tagok.
    for (const tag of [
      '<bankszamlaszam></bankszamlaszam>',
      '<postazasiNev></postazasiNev>',
      '<azonosito></azonosito>',
    ]) {
      expect(xml).toContain(tag)
    }
  })

  it('forint-számlán NINCS <arfolyam>/<arfolyamBank> (az üres xs:double 57-es XSD-hiba volna)', () => {
    // Az élő XSD: <element name="arfolyam" type="double" minOccurs="0"> — az
    // üres érték érvénytelen, a HUF-számlán pedig nincs is jelentése.
    expect(xml).not.toContain('<arfolyam>')
    expect(xml).not.toContain('<arfolyam/>')
    expect(xml).not.toContain('<arfolyamBank>')
    // Semmilyen típusos tag nem mehet ki üresen (a szöveges váz-tagok igen).
    for (const typed of ['arfolyam', 'fizetve', 'adoalany', 'keltDatum', 'teljesitesDatum']) {
      expect(xml, typed).not.toContain(`<${typed}></${typed}>`)
    }
  })

  it('fejlec: <fizetve>true</fizetve> a szamlaszamElotag UTÁN (XSD-sorrend), kártyával kifizetett rendelés', () => {
    expect(xml).toMatch(
      /<szamlaszamElotag>KIN<\/szamlaszamElotag>\s*<fizetve>true<\/fizetve>\s*<\/fejlec>/,
    )
  })

  it('vevő: adószámmal <adoalany>1</adoalany>, a sendEmail és az adoszam között', () => {
    expect(xml).toMatch(
      /<sendEmail>true<\/sendEmail>\s*<adoalany>1<\/adoalany>\s*<adoszam>12345678-1-42<\/adoszam>/,
    )
  })

  it('beallitasok: agent-kulcs, eszamla, valaszVerzio 2, szamlaKulsoAzon = orderNumber', () => {
    expect(xml).toContain(`<szamlaagentkulcs>${DUMMY_AGENT_KEY}</szamlaagentkulcs>`)
    expect(xml).toContain('<eszamla>true</eszamla>')
    expect(xml).toContain('<valaszVerzio>2</valaszVerzio>')
    expect(xml).toContain(`<szamlaKulsoAzon>${ORDER_NUMBER}</szamlaKulsoAzon>`)
  })

  it('fejlec: dátumok, fizmod=Barion, HUF, hu, rendelesSzam, előtag', () => {
    expect(xml).toContain('<keltDatum>2026-08-04</keltDatum>')
    // A10: a fizmod normalizált értékkészletében a 'Barion' dedikált érték —
    // ez adja a legjobb fizmodunified-besorolást a kimenő-adatkapcsolatban.
    expect(xml).toContain('<fizmod>Barion</fizmod>')
    expect(xml).toContain('<penznem>HUF</penznem>')
    expect(xml).toContain('<szamlaNyelve>hu</szamlaNyelve>')
    expect(xml).toContain(`<rendelesSzam>${ORDER_NUMBER}</rendelesSzam>`)
    expect(xml).toContain('<szamlaszamElotag>KIN</szamlaszamElotag>')
  })

  it('vevő: adatok + sendEmail + adoszam; az azonosító ÜRES (sosem küldjük)', () => {
    expect(xml).toContain('<nev>Teszt Anna</nev>')
    expect(xml).toContain('<irsz>1111</irsz>')
    expect(xml).toContain('<email>anna@example.test</email>')
    expect(xml).toContain('<sendEmail>true</sendEmail>')
    expect(xml).toContain('<adoszam>12345678-1-42</adoszam>')
    expect(xml).toContain('<azonosito></azonosito>')
  })

  it('tétel: 27%-os ÁFA-kulcs és a visszaszámolt összegek', () => {
    expect(xml).toContain('<afakulcs>27</afakulcs>')
    expect(xml).toContain('<bruttoErtek>19990</bruttoErtek>')
    expect(xml).toContain('<nettoErtek>15740</nettoErtek>')
    expect(xml).toContain('<afaErtek>4250</afaErtek>')
    expect(xml).toContain('<mennyisegiEgyseg>db</mennyisegiEgyseg>')
  })

  it('XML-escape: a tétel megnevezésében a < jel entitás', () => {
    expect(xml).toContain('DEMO Kurzus &lt;b&gt;')
    expect(xml).not.toContain('DEMO Kurzus <b>')
  })
})

describe('buildInvoiceXml — áfakulcs és teljesítési dátum', () => {
  const BASE = {
    agentKey: DUMMY_AGENT_KEY,
    orderNumber: ORDER_NUMBER,
    invoicePrefix: 'KIN',
    issueDate: '2026-08-04',
    buyer: {
      nev: 'Teszt Anna',
      irsz: '1111',
      telepules: 'Budapest',
      cim: 'Példa utca 1.',
      email: 'anna@example.test',
    },
    items: [{ megnevezes: 'Kurzus', mennyiseg: 1, bruttoEgysegar: 19990 }],
  }

  it('vatMode=AAM: az afakulcs AAM, a tételen afaErtek=0 és netto=brutto', () => {
    const xml = buildInvoiceXml({ ...BASE, vatMode: 'AAM' })
    expect(xml).toContain('<afakulcs>AAM</afakulcs>')
    expect(xml).not.toContain('<afakulcs>27</afakulcs>')
    expect(xml).toContain('<afaErtek>0</afaErtek>')
    expect(xml).toContain('<nettoErtek>19990</nettoErtek>')
    expect(xml).toContain('<bruttoErtek>19990</bruttoErtek>')
  })

  it('r-ado-10 + a-szamlazz-15: AAM-számlán a fejléc-megjegyzés az adómentesség jogszabályi utalását EGYSZER hordozza, a fizetési mód semleges', () => {
    const aam = buildInvoiceXml({ ...BASE, vatMode: 'AAM' })
    expect(aam).toContain(
      `<megjegyzes>Kineticare online kurzus, rendelésszám: ${ORDER_NUMBER} (Barion, online fizetés). Alanyi adómentes (Áfa tv. XIII. fejezet).</megjegyzes>`,
    )
    expect(aam.split('Alanyi adómentes (Áfa tv. XIII. fejezet).')).toHaveLength(2)
    // A felülírt (helyesbítő) megjegyzés is megkapja az utalást.
    const override = buildInvoiceXml({ ...BASE, vatMode: 'AAM', megjegyzes: 'Egyedi szöveg.' })
    expect(override).toContain(
      '<megjegyzes>Egyedi szöveg. Alanyi adómentes (Áfa tv. XIII. fejezet).</megjegyzes>',
    )
    const vat27 = buildInvoiceXml({ ...BASE, vatMode: '27' })
    expect(vat27).toContain(
      `<megjegyzes>Kineticare online kurzus, rendelésszám: ${ORDER_NUMBER} (Barion, online fizetés).</megjegyzes>`,
    )
    expect(vat27).not.toContain('Alanyi adómentes')
    expect(vat27).not.toContain('bankkártya')
  })

  it('K11 + a-szamlazz-10: a vevő országa Magyarország, az élő XSD szerint a <nev> után', () => {
    const xml = buildInvoiceXml(BASE)
    expect(xml).toMatch(/<nev>[^<]*<\/nev>\s*<orszag>Magyarország<\/orszag>\s*<irsz>/)
  })

  it('teljesitesDatum megadva: eltér a kelt-dátumtól (a kelt marad az issueDate)', () => {
    // B4 (NAV-szabály): a helyesbítő az EREDETI teljesítési dátumot ismétli —
    // ezt a builder külön bemenetként kapja, a kelt-dátumot nem befolyásolja.
    const xml = buildInvoiceXml({ ...BASE, teljesitesDatum: '2026-07-15' })
    expect(xml).toContain('<keltDatum>2026-08-04</keltDatum>')
    expect(xml).toContain('<teljesitesDatum>2026-07-15</teljesitesDatum>')
    expect(xml).toContain('<fizetesiHataridoDatum>2026-08-04</fizetesiHataridoDatum>')
  })

  it('teljesitesDatum nélkül a teljesítés a kiállítás napja', () => {
    const xml = buildInvoiceXml(BASE)
    expect(xml).toContain('<teljesitesDatum>2026-08-04</teljesitesDatum>')
  })

  it('adószám nélkül (magánszemély) <adoalany>-1</adoalany> és üres adoszam', () => {
    // tudastar.szamlazz.hu/gyik/vevo-adoszama-szamlan: „Magánszemély vásárlása
    // esetén ezért az adóalanyiságnál a nincs adószáma értéket kell átadni."
    const xml = buildInvoiceXml(BASE)
    expect(xml).toMatch(/<adoalany>-1<\/adoalany>\s*<adoszam><\/adoszam>/)
    expect(xml).not.toContain('<adoalany>1</adoalany>')
  })

  it('csupa szóközből álló adószám magánszemélynek számít (-1), nem 1-nek', () => {
    const xml = buildInvoiceXml({ ...BASE, buyer: { ...BASE.buyer, adoszam: '   ' } })
    expect(xml).toContain('<adoalany>-1</adoalany>')
    expect(xml).toContain('<adoszam></adoszam>')
  })

  it('helyesbítőn is kimegy a <fizetve>true</fizetve> (a visszatérítést a Barion már kifizette)', () => {
    const xml = buildInvoiceXml({
      ...BASE,
      items: [{ megnevezes: 'Helyesbítés', mennyiseg: 1, bruttoEgysegar: -5000 }],
      corrective: {
        originalInvoiceNumber: 'KIN-2026-7',
        kulsoAzon: `${ORDER_NUMBER}-HELYESBITO-1`,
      },
    })
    expect(xml).toContain('<fizetve>true</fizetve>')
    expect(xml).toContain('<helyesbitoszamla>true</helyesbitoszamla>')
  })

  /**
   * A <rendelesSzam> a provider-oldali duplikátum-védelem kulcsa (a fiókban
   * bekapcsolt rendelésszám-ismétlés-tiltás ezt figyeli). A helyesbítő önálló
   * bizonylat: az eredeti számla rendelésszámával minden helyesbítő azonnal
   * 71/152-be futna, és a feloldó lekérdezés sem találna semmit.
   */
  describe('rendelesSzam — a helyesbítő saját, bizonylat-egyedi kulcsot küld', () => {
    const CORRECTIVE_KULSO_AZON = `${ORDER_NUMBER}-HELYESBITO-2`
    const corrective = buildInvoiceXml({
      ...BASE,
      corrective: {
        originalInvoiceNumber: 'KIN-2026-7',
        kulsoAzon: CORRECTIVE_KULSO_AZON,
      },
    })

    it('helyesbítőn a rendelesSzam a saját kulsoAzon (NEM az eredeti rendelésszám)', () => {
      expect(corrective).toContain(`<rendelesSzam>${CORRECTIVE_KULSO_AZON}</rendelesSzam>`)
      expect(corrective).not.toContain(`<rendelesSzam>${ORDER_NUMBER}</rendelesSzam>`)
      // A visszakeresési kulcs ugyanez — a 71/152 feloldása így a HELYES
      // bizonylatot találja meg.
      expect(corrective).toContain(`<szamlaKulsoAzon>${CORRECTIVE_KULSO_AZON}</szamlaKulsoAzon>`)
      expect(corrective).toContain('<helyesbitoszamla>true</helyesbitoszamla>')
    })

    it('normál számlán a rendelesSzam változatlanul az orderNumber', () => {
      const normal = buildInvoiceXml(BASE)
      expect(normal).toContain(`<rendelesSzam>${ORDER_NUMBER}</rendelesSzam>`)
      expect(normal).toContain(`<szamlaKulsoAzon>${ORDER_NUMBER}</szamlaKulsoAzon>`)
    })
  })

  /**
   * A teljesítési dátum forrása egy szabad szöveges DB-mező
   * (orders.invoiceCompletionDate) — az admin readOnly jelölés NEM API-védelem.
   * Kapu nélkül staff-jogosultsággal tetszőleges XML-részlet becsempészhető
   * lenne a bizonylatba.
   */
  describe('dátum-kapu — csak YYYY-MM-DD mehet ki', () => {
    /** A kapun elakadó érték: VÉGLEGES hiba (az újraküldés ugyanezt adná). */
    function expectDateRejected(input: Parameters<typeof buildInvoiceXml>[0], mezo: string): void {
      let thrown: unknown
      try {
        buildInvoiceXml(input)
      } catch (error) {
        thrown = error
      }
      expect(thrown, mezo).toBeInstanceOf(SzamlazzApiError)
      const error = thrown as SzamlazzApiError
      expect(error.kind, mezo).toBe('invalid_data')
      expect(error.retryable, mezo).toBe(false)
      expect(error.message, mezo).toContain(mezo)
      expect(error.message, mezo).toContain('YYYY-MM-DD')
    }

    it('XML-injektálás a teljesitesDatum-on keresztül: dobás, nem escape-elt kimenet', () => {
      expectDateRejected(
        {
          ...BASE,
          teljesitesDatum: '2026-01-31</teljesitesDatum><elonezetpdf>true</elonezetpdf>',
        },
        'teljesitesDatum',
      )
    })

    it('üres és rossz alakú dátumok elutasítva (teljesítés és kelt egyaránt)', () => {
      for (const rossz of [
        '',
        '   ',
        '2026-1-31',
        '2026.01.31',
        '31/01/2026',
        '2026-01-31T00:00:00Z',
      ]) {
        expectDateRejected({ ...BASE, teljesitesDatum: rossz }, 'teljesitesDatum')
        expectDateRejected({ ...BASE, issueDate: rossz }, 'keltDatum')
      }
    })

    it('helyes alakú dátum változatlanul kerül a kimenetre', () => {
      const xml = buildInvoiceXml({
        ...BASE,
        issueDate: '2026-08-04',
        teljesitesDatum: '2026-07-15',
      })
      expect(xml).toContain('<keltDatum>2026-08-04</keltDatum>')
      expect(xml).toContain('<teljesitesDatum>2026-07-15</teljesitesDatum>')
      expect(xml).toContain('<fizetesiHataridoDatum>2026-08-04</fizetesiHataridoDatum>')
    })
  })
})

/**
 * A bizonylat kelt-dátuma a SZÉKHELY szerinti naptári nap. UTC-ből képezve
 * magyar idő szerint 00:00–02:00 között az ELŐZŐ napra állna ki a számla —
 * hó elején ez már másik áfa-időszak.
 */
describe('budapestDateString / isIsoDateString', () => {
  it('00:30 CEST (nyári időszámítás): a magyar nap, nem az UTC-s előző nap', () => {
    // 2026-09-01T00:30 magyar idő = 2026-08-31T22:30Z
    const hajnal = new Date('2026-08-31T22:30:00Z')
    expect(budapestDateString(hajnal)).toBe('2026-09-01')
    // A régi (hibás) képzés bizonyítéka — ez adta volna az előző hónapot.
    expect(hajnal.toISOString().slice(0, 10)).toBe('2026-08-31')
  })

  it('00:30 CET (téli időszámítás) is a magyar napot adja', () => {
    // 2026-02-01T00:30 magyar idő = 2026-01-31T23:30Z
    expect(budapestDateString(new Date('2026-01-31T23:30:00Z'))).toBe('2026-02-01')
  })

  it('nappal a magyar és az UTC-nap egybeesik', () => {
    expect(budapestDateString(new Date('2026-08-10T09:00:00Z'))).toBe('2026-08-10')
  })

  it('isIsoDateString: kizárólag a YYYY-MM-DD alak megy át', () => {
    expect(isIsoDateString('2026-08-04')).toBe(true)
    expect(isIsoDateString(budapestDateString(new Date('2026-08-31T22:30:00Z')))).toBe(true)
    for (const rossz of [
      '',
      '2026-8-4',
      '2026/08/04',
      '2026-08-04T10:00:00Z',
      ' 2026-08-04',
      '2026-08-04</x>',
    ]) {
      expect(isIsoDateString(rossz), rossz).toBe(false)
    }
  })
})

describe('escapeXml', () => {
  it('mind az 5 XML-entitást cseréli', () => {
    expect(escapeXml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&apos;')
  })

  it('H5: az XML 1.0-ban tiltott karaktereket elhagyja (U+FFFF, U+FFFE, U+000B, U+0000, magányos surrogate)', () => {
    // Escape-pel ezek nem menthetők: a Számla Agent 57-tel utasítaná el a kérést.
    expect(escapeXml('Kovács\uFFFFÉva')).toBe('KovácsÉva')
    expect(escapeXml('a\u000Bb\uD800c\uFFFEd\u0000e\u001Ff')).toBe('abcdef')
    // Az elhagyás az escape ELŐTT fut, a maradék szöveg escape-je változatlan.
    expect(escapeXml('Kovács\u000B & <Társa>')).toBe('Kovács &amp; &lt;Társa&gt;')
  })

  it('H5: a megengedett karakterek maradnak (TAB, LF, CR, ékezet, emoji, U+FFFD)', () => {
    const allowed = 'a\tb\nc\rd Árvíztűrő \u{1F600} \uFFFD \uE000 \u{10FFFD}'
    expect(escapeXml(allowed)).toBe(allowed)
  })
})

describe('parseAgentResponse', () => {
  it('sikeres válasz: szamlaszam + vevoifiokurl', () => {
    const result = parseAgentResponse(
      '<?xml version="1.0"?><xmlszamlavalasz><sikeres>true</sikeres><szamlaszam>KIN-2026-7</szamlaszam><vevoifiokurl>https://www.szamlazz.hu/vevoifiok/abc</vevoifiokurl></xmlszamlavalasz>',
      new Headers(),
    )
    expect(result.szamlaszam).toBe('KIN-2026-7')
    expect(result.vevoifiokUrl).toBe('https://www.szamlazz.hu/vevoifiok/abc')
  })

  it('sikertelen válasz: hibakod/hibauzenet, agent-kind, nem retryable', () => {
    try {
      parseAgentResponse(
        '<?xml version="1.0"?><xmlszamlavalasz><sikeres>false</sikeres><hibak><hiba><hibakod>57</hibakod><hibauzenet>Hibás tételösszeg</hibauzenet></hiba></hibak></xmlszamlavalasz>',
        new Headers(),
      )
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(SzamlazzApiError)
      const apiError = error as SzamlazzApiError
      expect(apiError.kind).toBe('agent')
      expect(apiError.retryable).toBe(false)
      expect(apiError.agentErrors).toEqual([{ code: '57', message: 'Hibás tételösszeg' }])
    }
  })

  it('lapos hibakod-forma is értelmezhető', () => {
    try {
      parseAgentResponse(
        '<?xml version="1.0"?><xmlszamlavalasz><sikeres>false</sikeres><hibakod>201</hibakod><hibauzenet>Hiányzó vevő név</hibauzenet></xmlszamlavalasz>',
        new Headers(),
      )
      expect.unreachable()
    } catch (error) {
      const apiError = error as SzamlazzApiError
      expect(apiError.kind).toBe('agent')
      expect(apiError.agentErrors).toEqual([{ code: '201', message: 'Hiányzó vevő név' }])
    }
  })

  it('szlahu_down fejléc: retryable hiba akkor is, ha a body sikeres lenne', () => {
    try {
      parseAgentResponse(
        '<xmlszamlavalasz><sikeres>true</sikeres><szamlaszam>X</szamlaszam></xmlszamlavalasz>',
        new Headers({ szlahu_down: '1' }),
      )
      expect.unreachable()
    } catch (error) {
      const apiError = error as SzamlazzApiError
      expect(apiError.retryable).toBe(true)
    }
  })

  it('szlahu_error fejléc: agent-hiba a kóddal', () => {
    try {
      parseAgentResponse(
        'bármi',
        new Headers({ szlahu_error: 'Lépjen be', szlahu_error_code: '51' }),
      )
      expect.unreachable()
    } catch (error) {
      const apiError = error as SzamlazzApiError
      expect(apiError.kind).toBe('agent')
      expect(apiError.agentErrors[0]?.code).toBe('51')
    }
  })

  it('értelmezhetetlen válasz: invalid_response, RETRYABLE (bizonytalan kimenet, a következő kísérlet lekérdezéssel indul)', () => {
    // Pl. egy 200-as HTML-karbantartási oldal: a bizonylat sorsa ebből nem
    // dönthető el. Végleges 'failed' helyett újrapróbálás — a számla- és a
    // helyesbítő-ág a beküldés ELŐTT szamlaKulsoAzon-lekérdezéssel indul, a
    // beküldéseket pedig az 5-ös plafon fogja.
    try {
      parseAgentResponse('<html>500 oldal</html>', new Headers())
      expect.unreachable()
    } catch (error) {
      const apiError = error as SzamlazzApiError
      expect(apiError.kind).toBe('invalid_response')
      expect(apiError.retryable).toBe(true)
    }
  })
})

/**
 * Hivatalos hibakód-osztályozás (docs.szamlazz.hu/agent/basics/error-handling).
 * A besorolás dönti el, hogy a job újrapróbál-e: egy tévesen retryable-nek vett
 * végleges hiba feleslegesen égetné a max. 5 beküldés keretét, egy tévesen
 * véglegesnek vett karbantartás pedig elveszítené a számlát.
 */
describe('parseAgentResponse — hibakód-osztályozás (retry / duplikátum / végleges)', () => {
  /** A megadott hibakódra kapott SzamlazzApiError, típusbiztosan. */
  function agentErrorOf(code: string): SzamlazzApiError {
    let captured: unknown
    try {
      parseAgentResponse(
        `<?xml version="1.0"?><xmlszamlavalasz><sikeres>false</sikeres><hibak><hiba>` +
          `<hibakod>${code}</hibakod><hibauzenet>DUMMY hibaüzenet</hibauzenet>` +
          `</hiba></hibak></xmlszamlavalasz>`,
        new Headers(),
      )
    } catch (error) {
      captured = error
    }
    expect(captured, `a(z) ${code} hibakódnak hibát kell dobnia`).toBeInstanceOf(SzamlazzApiError)
    if (!(captured instanceof SzamlazzApiError)) {
      throw new Error(`TESZT-HIBA: a(z) ${code} hibakódra nem SzamlazzApiError érkezett`)
    }
    return captured
  }

  it('1 (rendszerkarbantartás): agent-hiba, de RETRYABLE — az egyetlen ilyen kód', () => {
    const error = agentErrorOf('1')
    expect(error.kind).toBe('agent')
    expect(error.retryable).toBe(true)
    expect(isDuplicateOrderError(error)).toBe(false)
  })

  it('71 és 152 (Már létező rendelésszám): duplicate-kind, nem retryable — idempotencia-találat', () => {
    for (const code of ['71', '152']) {
      const error = agentErrorOf(code)
      // NEM hiba, hanem jelzés: a hívó a szamlaKulsoAzon-lekérdezéssel veszi át
      // a meglévő bizonylatot — az újraküldés csak ugyanezt adná vissza.
      expect(error.kind, code).toBe('duplicate')
      expect(error.retryable, code).toBe(false)
      expect(isDuplicateOrderError(error), code).toBe(true)
    }
  })

  it('259 (tétel-matematika): agent-hiba, VÉGLEGES (az újraküldés ugyanezt adná)', () => {
    const error = agentErrorOf('259')
    expect(error.kind).toBe('agent')
    expect(error.retryable).toBe(false)
    expect(isDuplicateOrderError(error)).toBe(false)
  })

  it('55 (e-számla aláírás / időbélyeg-szerver): RETRYABLE — a szolgáltatói kiesés magától megszűnik', () => {
    // Hivatalos hibatábla: „A tanúsítvány lejárt vagy az időbélyegző szerverhez
    // nem lehetett kapcsolódni." Végleges 'failed' helyett újrapróbálás; a
    // lejárt tanúsítványt az 5-ös beküldési plafon állítja meg.
    const error = agentErrorOf('55')
    expect(error.kind).toBe('agent')
    expect(error.retryable).toBe(true)
  })

  it('136 (lejárt előfizetés) továbbra is VÉGLEGES — magától nem javul, a keretet ne égesse', () => {
    expect(agentErrorOf('136').retryable).toBe(false)
  })
})

/**
 * Válasz-értelmezés a valódi Agent-válaszok alakjaival: CDATA-ba csomagolt
 * értékek, a szlahu_* fejlécek mint tartalék forrás, és az 56-os
 * („számla kiállt, csak az értesítő nem ment ki") jelzés.
 */
describe('parseAgentResponse — CDATA, fejléc-tartalék és 56-os jelzés', () => {
  const VALASZ_NS = 'xmlns="http://www.szamlazz.hu/xmlszamlavalasz"'

  function apiErrorOf(fn: () => unknown): SzamlazzApiError {
    let captured: unknown
    try {
      fn()
    } catch (error) {
      captured = error
    }
    expect(captured).toBeInstanceOf(SzamlazzApiError)
    if (!(captured instanceof SzamlazzApiError)) {
      throw new Error('TESZT-HIBA: nem SzamlazzApiError érkezett')
    }
    return captured
  }

  it('CDATA-s vevoifiokurl: a link a jelölés NÉLKÜL jön ki, és átmegy az allowlisten', () => {
    // A valódi válaszok így hozzák a linket (rollethu/noe kazetta, pretix-szamlazz).
    const result = parseAgentResponse(
      `<?xml version="1.0" encoding="UTF-8"?><xmlszamlavalasz ${VALASZ_NS}>` +
        '<sikeres>true</sikeres><szamlaszam>KIN-2026-7</szamlaszam>' +
        '<vevoifiokurl><![CDATA[https://www.szamlazz.hu/szamla/?page=vevoifiokpay&partguid=abc]]></vevoifiokurl>' +
        '</xmlszamlavalasz>',
      new Headers(),
    )
    expect(result.vevoifiokUrl).toBe(
      'https://www.szamlazz.hu/szamla/?page=vevoifiokpay&partguid=abc',
    )
    expect(isTrustedInvoicePdfUrl(result.vevoifiokUrl ?? '')).toBe(true)
  })

  it('entitás-kódolt vevoifiokurl (&amp;) is dekódolva jön ki', () => {
    const result = parseAgentResponse(
      '<xmlszamlavalasz><sikeres>true</sikeres><szamlaszam>KIN-2026-7</szamlaszam>' +
        '<vevoifiokurl>https://www.szamlazz.hu/szamla/?page=vevoifiokpay&amp;partguid=abc</vevoifiokurl>' +
        '</xmlszamlavalasz>',
      new Headers(),
    )
    expect(result.vevoifiokUrl).toBe(
      'https://www.szamlazz.hu/szamla/?page=vevoifiokpay&partguid=abc',
    )
  })

  it('CDATA-s hibakód és hibaüzenet (a hivatalos hibaminta alakja) nyersen értelmezve', () => {
    const error = apiErrorOf(() =>
      parseAgentResponse(
        `<xmlszamlavalasz ${VALASZ_NS}><sikeres>false</sikeres>` +
          '<hibakod><![CDATA[57]]></hibakod>' +
          '<hibauzenet><![CDATA[XML beolvasási hiba. cvc-datatype-valid: <arfolyam> & társai]]></hibauzenet>' +
          '</xmlszamlavalasz>',
        new Headers(),
      ),
    )
    expect(error.agentErrors).toEqual([
      { code: '57', message: 'XML beolvasási hiba. cvc-datatype-valid: <arfolyam> & társai' },
    ])
    expect(error.message).not.toContain('CDATA')
  })

  it('sikeres=true, de a törzsből hiányzó számlaszám a szlahu_szamlaszam fejlécből jön', () => {
    // A hivatalos PHP SDK a számot a fejlécből olvassa (InvoiceResponse::parseData).
    const result = parseAgentResponse(
      '<xmlszamlavalasz><sikeres>true</sikeres></xmlszamlavalasz>',
      new Headers({
        szlahu_szamlaszam: 'KIN-2026-9',
        szlahu_vevoifiokurl:
          'https%3A%2F%2Fwww.szamlazz.hu%2Fszamla%2F%3Fpage%3Dvevoifiokpay%26partguid%3Da%2Bb',
      }),
    )
    // A '+' az URL-ben NEM szóköz (rawurldecode-szabály).
    expect(result).toEqual({
      szamlaszam: 'KIN-2026-9',
      vevoifiokUrl: 'https://www.szamlazz.hu/szamla/?page=vevoifiokpay&partguid=a+b',
    })
  })

  it('a törzs és a fejléc ELTÉRŐ számlaszáma: bizonytalan (retryable), NEM vesszük át egyiket sem', () => {
    const error = apiErrorOf(() =>
      parseAgentResponse(
        '<xmlszamlavalasz><sikeres>true</sikeres><szamlaszam>KIN-2026-7</szamlaszam></xmlszamlavalasz>',
        new Headers({ szlahu_szamlaszam: 'KIN-2026-8' }),
      ),
    )
    expect(error.kind).toBe('invalid_response')
    expect(error.retryable).toBe(true)
  })

  it('sikeres=true számlaszám nélkül: bizonytalan (retryable) — a lekérdezés veszi át a bizonylatot', () => {
    const error = apiErrorOf(() =>
      parseAgentResponse(
        '<xmlszamlavalasz><sikeres>true</sikeres></xmlszamlavalasz>',
        new Headers(),
      ),
    )
    expect(error.kind).toBe('invalid_response')
    expect(error.retryable).toBe(true)
  })

  it('56 + számlaszám a TÖRZSBEN: SIKER, az értesítő-hiba jelzésével (a hivatalos SDK szabálya)', () => {
    const result = parseAgentResponse(
      `<xmlszamlavalasz ${VALASZ_NS}><sikeres>false</sikeres><hibakod>56</hibakod>` +
        '<hibauzenet><![CDATA[A számlaértesítő kézbesítése sikertelen.]]></hibauzenet>' +
        '<szamlaszam>KIN-2026-8</szamlaszam></xmlszamlavalasz>',
      new Headers(),
    )
    expect(result.szamlaszam).toBe('KIN-2026-8')
    expect(result.notificationError).toEqual({
      code: '56',
      message: 'A számlaértesítő kézbesítése sikertelen.',
    })
  })

  it('56 a FEJLÉCBEN + szlahu_szamlaszam: SIKER (a számla kiállt és a NAV-hoz is ment)', () => {
    const result = parseAgentResponse(
      '',
      new Headers({
        szlahu_error_code: '56',
        szlahu_error: 'A+sz%C3%A1mla%C3%A9rtes%C3%ADt%C5%91+k%C3%A9zbes%C3%ADt%C3%A9se+sikertelen',
        szlahu_szamlaszam: 'KIN-2026-8',
      }),
    )
    expect(result.szamlaszam).toBe('KIN-2026-8')
    expect(result.notificationError?.code).toBe('56')
    expect(result.notificationError?.message).toBe('A számlaértesítő kézbesítése sikertelen')
  })

  it('56 számlaszám NÉLKÜL: bizonytalan, RETRYABLE (nem végleges failed)', () => {
    const error = apiErrorOf(() =>
      parseAgentResponse(
        '<xmlszamlavalasz><sikeres>false</sikeres><hibakod>56</hibakod></xmlszamlavalasz>',
        new Headers(),
      ),
    )
    expect(error.kind).toBe('invalid_response')
    expect(error.retryable).toBe(true)
    expect(error.agentErrors[0]?.code).toBe('56')
  })

  it('56 MÁS hibakóddal együtt: a másik kód dönt (itt 57 → végleges agent-hiba)', () => {
    const error = apiErrorOf(() =>
      parseAgentResponse(
        '<xmlszamlavalasz><sikeres>false</sikeres><hibak>' +
          '<hiba><hibakod>56</hibakod><hibauzenet>értesítő</hibauzenet></hiba>' +
          '<hiba><hibakod>57</hibakod><hibauzenet>XML</hibauzenet></hiba>' +
          '</hibak><szamlaszam>KIN-2026-8</szamlaszam></xmlszamlavalasz>',
        new Headers(),
      ),
    )
    expect(error.kind).toBe('agent')
    expect(error.retryable).toBe(false)
  })

  it('ELLENTMONDÁS — 56 a FEJLÉCBEN, 57 a TÖRZSBEN: a két csatorna uniója dönt, nem „értesítő-hibás siker"', () => {
    // Korábban a fejléc-hiba mellett a törzs kódjai elvesztek: az 56-os fejléc
    // + szlahu_szamlaszam SIKERKÉNT ment át, és egy el sem készült (57-tel
    // elutasított) bizonylat száma került volna a rendelésre.
    const error = apiErrorOf(() =>
      parseAgentResponse(
        '<xmlszamlavalasz><sikeres>false</sikeres><hibakod>57</hibakod>' +
          '<hibauzenet>XML beolvasási hiba</hibauzenet></xmlszamlavalasz>',
        new Headers({
          szlahu_error_code: '56',
          szlahu_error:
            'A+sz%C3%A1mla%C3%A9rtes%C3%ADt%C5%91+k%C3%A9zbes%C3%ADt%C3%A9se+sikertelen',
          szlahu_szamlaszam: 'KIN-2026-8',
        }),
      ),
    )
    expect(error.kind).toBe('agent')
    expect(error.retryable).toBe(false)
    expect(error.agentErrors.map((entry) => entry.code)).toEqual(['56', '57'])
    expect(error.message).toContain('fejléc és törzs')
    expect(error.message).toContain('57')
  })

  it('az unió a besorolásban is számít: 56-os fejléc + 55-ös törzs → újrapróbálható agent-hiba', () => {
    const error = apiErrorOf(() =>
      parseAgentResponse(
        '<xmlszamlavalasz><sikeres>false</sikeres><hibakod>55</hibakod>' +
          '<hibauzenet>E-számla aláírása sikertelen.</hibauzenet></xmlszamlavalasz>',
        new Headers({ szlahu_error_code: '56', szlahu_szamlaszam: 'KIN-2026-8' }),
      ),
    )
    expect(error.kind).toBe('agent')
    expect(error.retryable).toBe(true)
    expect(error.agentErrors.map((entry) => entry.code)).toEqual(['56', '55'])
  })

  it('56 a fejlécben ÉS a törzsben (azonos jelzés), számlaszámmal: továbbra is SIKER', () => {
    const result = parseAgentResponse(
      '<xmlszamlavalasz><sikeres>false</sikeres><hibakod>56</hibakod>' +
        '<hibauzenet>A számlaértesítő kézbesítése sikertelen</hibauzenet>' +
        '<szamlaszam>KIN-2026-8</szamlaszam></xmlszamlavalasz>',
      new Headers({
        szlahu_error_code: '56',
        szlahu_error: 'A+sz%C3%A1mla%C3%A9rtes%C3%ADt%C5%91+k%C3%A9zbes%C3%ADt%C3%A9se+sikertelen',
        szlahu_szamlaszam: 'KIN-2026-8',
      }),
    )
    expect(result.szamlaszam).toBe('KIN-2026-8')
    expect(result.notificationError?.code).toBe('56')
  })

  it('csak a szlahu_error_code fejléc (üzenet nélkül) is hibának számít', () => {
    const error = apiErrorOf(() =>
      parseAgentResponse(
        '<xmlszamlavalasz><sikeres>true</sikeres><szamlaszam>X</szamlaszam></xmlszamlavalasz>',
        new Headers({ szlahu_error_code: '3' }),
      ),
    )
    expect(error.kind).toBe('agent')
    expect(error.agentErrors[0]?.code).toBe('3')
  })

  it('a CDATA-ban álló záró tag NEM zárja le idő előtt az elemet', () => {
    const error = apiErrorOf(() =>
      parseAgentResponse(
        '<xmlszamlavalasz><sikeres>false</sikeres><hibakod>57</hibakod>' +
          '<hibauzenet><![CDATA[hiba a </hibauzenet> körül]]></hibauzenet></xmlszamlavalasz>',
        new Headers(),
      ),
    )
    expect(error.agentErrors).toEqual([{ code: '57', message: 'hiba a </hibauzenet> körül' }])
  })

  it('lezáratlan elem sok CDATA-szakasszal: gyorsan, bizonytalan hibával áll meg (nincs elszálló regex)', () => {
    const body =
      '<xmlszamlavalasz><sikeres>true</sikeres><szamlaszam>' + '<![CDATA[x]]>'.repeat(20_000)
    const startedAt = Date.now()
    const error = apiErrorOf(() => parseAgentResponse(body, new Headers()))
    expect(error.kind).toBe('invalid_response')
    expect(Date.now() - startedAt).toBeLessThan(2_000)
  })

  it('xs:boolean "1" alakú sikeres is siker', () => {
    const result = parseAgentResponse(
      '<xmlszamlavalasz><sikeres>1</sikeres><szamlaszam>KIN-2026-7</szamlaszam></xmlszamlavalasz>',
      new Headers(),
    )
    expect(result.szamlaszam).toBe('KIN-2026-7')
  })

  it('jelölőkaraktert tartalmazó „számlaszám" nem vehető át (sérült válasz)', () => {
    const error = apiErrorOf(() =>
      parseAgentResponse(
        '<xmlszamlavalasz><sikeres>true</sikeres><szamlaszam><![CDATA[KIN<b>7]]></szamlaszam></xmlszamlavalasz>',
        new Headers(),
      ),
    )
    expect(error.kind).toBe('invalid_response')
  })
})

// ---------------------------------------------------------------------------
// issueInvoiceForOrder — a folyamat mockolt payloaddal + injektált postXml-lel
// ---------------------------------------------------------------------------

/** A fixtúra-rendelés létrehozásának pillanata (Payload ISO-alakban írja). */
const ORDER_CREATED_AT = '2026-09-20T10:00:00.000Z'
/**
 * A 101-es fixtúra-rendelés globálisan egyedi külső azonosítója, kézzel
 * kiszámolva: rendelésszám - rendelés-id - createdAt unix másodpercben
 * (2026-09-20T10:00:00Z = 1789898400).
 */
const INVOICE_KULSO_AZON = 'KH-2026-000123-101-1789898400'
/** A fixtúra-rendelés végösszege (totalHufSnapshot). */
const ORDER_TOTAL_HUF = 19990

/** Lekérdezés-találat a rendelés végösszegével egyező bruttóval (a mi számlánk). */
function ownInvoice(szamlaszam: string): InvoiceLookupResult {
  return { szamlaszam, szamlabrutto: ORDER_TOTAL_HUF }
}

function createOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 101,
    orderNumber: ORDER_NUMBER,
    createdAt: ORDER_CREATED_AT,
    status: 'paid',
    invoiceStatus: 'none',
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

function createMockPayload(order: Order | null) {
  const updates: Array<Record<string, unknown>> = []
  const payload = {
    findByID: async () => order,
    update: async ({ data }: { data: Record<string, unknown> }) => {
      updates.push(data)
      if (order) {
        Object.assign(order, data)
      }
      return order
    },
  }
  return { payload: payload as never, updates, order }
}

// Az áfakulcs 2026-08-17 óta KÖTELEZŐ, ha a számlázás be van kapcsolva — a
// folyamat-tesztek fixtúrája ezért kimondja (a korábbi csendes '27' megszűnt).
const ENABLED_CONFIG = getSzamlazzConfig({
  SZAMLAZZ_AGENT_KEY: DUMMY_AGENT_KEY,
  SZAMLAZZ_AFAKULCS: '27',
})

/**
 * A bizonylat-lekérdezés MINDEN folyamat-tesztben injektált: injektálás nélkül a
 * retry- és duplikátum-ág a VALÓDI Számlázz.hu-t hívná meg. A noLookup azokra
 * az ágakra való, ahol lekérdezésnek nem szabad futnia (nem-paid, already-issued,
 * disabled, hiányos adat, kimerült plafon). Az első beküldés előtt a lookup
 * mindig lefut — ott silentLookup kell.
 */
const noLookup = async (): Promise<InvoiceLookupResult | null> => {
  throw new Error('TESZT-HIBA: ezen az ágon nem futhat bizonylat-lekérdezés')
}

const silentLookup = async (): Promise<InvoiceLookupResult | null> => null

describe('buyerFromOrder / itemsFromOrder', () => {
  it('a customerSnapshot-ból építkezik (billingName elsőbbség, email-fallback)', () => {
    const buyer = buyerFromOrder(createOrder())
    expect(buyer).toMatchObject({ nev: 'Teszt Anna', irsz: '1111', telepules: 'Budapest' })
    const items = itemsFromOrder(createOrder())
    expect(items).toEqual([
      { megnevezes: 'DEMO-KEZREHAB-001', mennyiseg: 1, bruttoEgysegar: 19990 },
    ])
  })

  it('hiányos számlázási adatnál null (a számla nem állítható ki)', () => {
    const order = createOrder()
    order.customerSnapshot = { name: 'Teszt Anna', email: 'a@b.hu' }
    expect(buyerFromOrder(order)).toBeNull()
  })
})

/**
 * A `<vevoifiokurl>` a Számlázz.hu válaszából jön (szabad szöveg), és a
 * rendelés `invoicePdfUrl` mezőjébe kerül, amit a fiók-oldal KATTINTHATÓ
 * linkként jelenít meg. Ellenőrzés nélkül egy hibás vagy manipulált válasz a
 * vásárlót a saját rendelés-oldaláról tetszőleges címre vinné.
 */
describe('isTrustedInvoicePdfUrl — a számlalink allowlistje', () => {
  it('elfogadja a szamlazz.hu-t és aldomainjeit, https-sel', () => {
    for (const url of [
      'https://szamlazz.hu/vevoifiok/abc',
      'https://www.szamlazz.hu/vevoifiok/abc',
      'https://SZAMLAZZ.HU/vevoifiok/abc',
      'https://barmi.aldomain.szamlazz.hu/x?y=1',
    ]) {
      expect(isTrustedInvoicePdfUrl(url), url).toBe(true)
    }
  })

  it('elutasít mindent, ami nem https + szamlazz.hu', () => {
    for (const url of [
      // Nem https — a link a vásárlónak megy, sima http nem elég.
      'http://www.szamlazz.hu/vevoifiok/abc',
      // Végződés-trükk: a hoszt NEM a szamlazz.hu aldomainje.
      'https://szamlazz.hu.tamado.example/vevoifiok/abc',
      'https://nemszamlazz.hu/vevoifiok/abc',
      // Idegen hoszt, illetve nem-URL alakok.
      'https://tamado.example/szamlazz.hu/abc',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '//www.szamlazz.hu/vevoifiok/abc',
      'vevoifiok/abc',
      '',
    ]) {
      expect(isTrustedInvoicePdfUrl(url), url).toBe(false)
    }
  })
})

describe('issueInvoiceForOrder', () => {
  it('boldog út: pending → issued + invoiceNumber + invoicePdfUrl; a küldött XML szamlaKulsoAzon-ja globálisan egyedi, a rendelesSzam a rendelésszám', async () => {
    const { payload, order, updates } = createMockPayload(createOrder())
    const sentXml: string[] = []
    const result = await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      issueDate: '2026-08-04',
      queryByKulsoAzon: silentLookup,
      postXml: async (xml) => {
        sentXml.push(xml)
        return { szamlaszam: 'KIN-2026-7', vevoifiokUrl: 'https://www.szamlazz.hu/vevoifiok/abc' }
      },
    })

    expect(result).toEqual({ outcome: 'issued', invoiceNumber: 'KIN-2026-7' })
    expect(order?.invoiceStatus).toBe('issued')
    expect(order?.invoiceNumber).toBe('KIN-2026-7')
    expect(order?.invoicePdfUrl).toBe('https://www.szamlazz.hu/vevoifiok/abc')
    // B4: a kiállításkor küldött teljesítési dátum RÖGZÜL — ezt ismétli később a helyesbítő.
    expect(order?.invoiceCompletionDate).toBe('2026-08-04')
    expect(order?.invoiceLastError).toBeNull()
    // F8: a dátum már a BEKÜLDÉS ELŐTTI (pending) írásban rögzül, hogy elveszett
    // válasz esetén se maradjon üresen — a helyesbítő B4-szabálya ezen múlik.
    expect(updates[0]).toEqual({
      invoiceStatus: 'pending',
      invoiceAttempts: 1,
      invoiceCompletionDate: '2026-08-04',
    })
    expect(sentXml).toHaveLength(1)
    // a-szamlazz-5: a külső azonosító nem újrahasznosítható (id + létrehozás
    // pillanata), a fiókbeli duplikátum-tiltás kulcsa (rendelesSzam) viszont
    // a puszta rendelésszám marad.
    expect(sentXml[0]).toContain(`<szamlaKulsoAzon>${INVOICE_KULSO_AZON}</szamlaKulsoAzon>`)
    expect(sentXml[0]).toContain(`<rendelesSzam>${ORDER_NUMBER}</rendelesSzam>`)
  })

  it('nem-paid rendelésre a kiállítás KIHAGYÓDIK (skipped) — számla nem készül, provider-hívás nincs', async () => {
    // A 'refunded' külön ág (a-egyeztetes-13, K12): lásd a „visszatérítés a
    // számla előtt" blokkot.
    for (const status of ['created', 'payment_pending', 'payment_failed', 'cancelled'] as Array<
      Order['status']
    >) {
      const { payload, order, updates } = createMockPayload(createOrder({ status }))
      const result = await issueInvoiceForOrder({
        payload,
        orderId: 101,
        config: ENABLED_CONFIG,
        issueDate: '2026-08-04',
        queryByKulsoAzon: noLookup,
        postXml: async () => {
          throw new Error('TESZT-HIBA: nem-paid rendelésre nem mehet ki számlakérés')
        },
      })

      expect(result.outcome).toBe('skipped')
      expect(result.reason).toContain('nem paid')
      // Az invoice-állapot érintetlen marad (a rendelés később paid lehet a rendes úton):
      expect(updates).toHaveLength(0)
      expect(order?.invoiceStatus).toBe('none')
    }
  })

  it('nem megbízható vevői fiók URL: a számla kiáll, de a LINK nem mentődik + figyelmeztetés', async () => {
    const { payload, order } = createMockPayload(createOrder())
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const result = await issueInvoiceForOrder({
        payload,
        orderId: 101,
        config: ENABLED_CONFIG,
        issueDate: '2026-08-04',
        queryByKulsoAzon: silentLookup,
        postXml: async () => ({
          szamlaszam: 'KIN-2026-8',
          vevoifiokUrl: 'https://szamlazz.hu.tamado.example/vevoifiok/abc',
        }),
      })

      expect(result).toEqual({ outcome: 'issued', invoiceNumber: 'KIN-2026-8' })
      expect(order?.invoiceStatus).toBe('issued')
      expect(order?.invoiceNumber).toBe('KIN-2026-8')
      // A hamis link SEHOL nem kerül a rendelésre.
      expect(order?.invoicePdfUrl).toBeUndefined()

      const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
      expect(output).toContain('nem megbízható vevői fiók URL')
      // A teljes URL nem kerül naplóba (query-string tokent hordozhat) — csak a hoszt.
      expect(output).toContain('szamlazz.hu.tamado.example')
      expect(output).not.toContain('/vevoifiok/abc')
    } finally {
      logSpy.mockRestore()
    }
  })

  it('idempotens: már issued rendelésnél no-op (nincs új hívás)', async () => {
    const order = createOrder({ invoiceStatus: 'issued', invoiceNumber: 'KIN-2026-7' })
    const { payload } = createMockPayload(order)
    let calls = 0
    const result = await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      queryByKulsoAzon: noLookup,
      postXml: async () => {
        calls += 1
        return { szamlaszam: 'X' }
      },
    })
    expect(result).toEqual({ outcome: 'already-issued', invoiceNumber: 'KIN-2026-7' })
    expect(calls).toBe(0)
  })

  it('kikapcsolt integrációnál disabled (a payloadhoz sem nyúl)', async () => {
    const { payload, updates } = createMockPayload(createOrder())
    const result = await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: getSzamlazzConfig({}),
      queryByKulsoAzon: noLookup,
      postXml: async () => expect.unreachable('nem hívható'),
    })
    expect(result.outcome).toBe('disabled')
    expect(updates).toHaveLength(0)
  })

  it.each([
    ['hiányzó számlázási mezők', { name: 'Teszt Anna' }],
    [
      // A pénztári szűrés ELŐTT mentett rendelés: az escapeXml a tiltott
      // karaktereket elhagyná, és üres <nev> menne ki.
      'csak XML-ben tiltott karakterekből álló név',
      {
        name: String.fromCodePoint(0xffff),
        email: 'anna@example.test',
        billingName: String.fromCodePoint(0xfffe, 0xffff),
        billingZip: '1111',
        billingCity: 'Budapest',
        billingStreet: 'Példa utca 1.',
      },
    ],
  ])(
    'hiányos vevő-adatnál (%s) invoiceStatus=failed, NEM dob (a job nem próbálja újra), és RIASZTÁS megy a naplóba',
    async (_label, customerSnapshot) => {
      const order = createOrder()
      order.customerSnapshot = customerSnapshot
      const { payload } = createMockPayload(order)
      let calls = 0
      // Ez VÉGLEGES vesztés-ág: a rendelés kifizetve, számla soha nem áll ki, és
      // a hívó nem dob, tehát nincs újrapróbálás. Ezért itt `error` + `RIASZTÁS:`
      // kell (a szomszédos, ugyanilyen ágak konvenciója) — `warn` mellett a
      // rendelés NÉMÁN veszne el.
      const logged: Array<{ level: 'warn' | 'error'; message: string }> = []
      const recordingLogger = {
        debug: () => undefined,
        info: () => undefined,
        warn: (message: string) => logged.push({ level: 'warn', message }),
        error: (message: string) => logged.push({ level: 'error', message }),
        child: () => recordingLogger,
      }

      const result = await issueInvoiceForOrder({
        payload,
        orderId: 101,
        config: ENABLED_CONFIG,
        logger: recordingLogger,
        queryByKulsoAzon: noLookup,
        postXml: async () => {
          calls += 1
          return { szamlaszam: 'X' }
        },
      })
      expect(result.outcome).toBe('failed')
      expect(order.invoiceStatus).toBe('failed')
      expect(calls).toBe(0)

      const alert = logged.find((entry) => entry.message.includes('hiányos vevő-számlázási adatok'))
      expect(alert).toBeDefined()
      expect(alert?.level).toBe('error')
      expect(alert?.message.startsWith('RIASZTÁS:')).toBe(true)
    },
  )

  it('agent-elutasításnál invoiceStatus=failed, nem dob (üzleti hiba, nem retryable)', async () => {
    const { payload, order } = createMockPayload(createOrder())
    const result = await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      queryByKulsoAzon: silentLookup,
      postXml: async () => {
        throw new SzamlazzApiError({
          message: 'Számla Agent hiba: 57',
          kind: 'agent',
          retryable: false,
        })
      },
    })
    expect(result.outcome).toBe('failed')
    expect(order?.invoiceStatus).toBe('failed')
  })

  it('F4 — retryable hibánál a státusz MARAD pending + THROW (így veszi fel újra a resweep)', async () => {
    // A hibát az invoiceLastError hordozza. A 'pending' kötelező: az order-poll
    // resweep csak a ['none','pending'] rendeléseket veszi fel újra, 'failed'
    // esetén a job-retryk kimerülése után a számla ÖRÖKRE elveszne.
    const { payload, order } = createMockPayload(createOrder())
    await expect(
      issueInvoiceForOrder({
        payload,
        orderId: 101,
        config: ENABLED_CONFIG,
        queryByKulsoAzon: silentLookup,
        postXml: async () => {
          throw new SzamlazzApiError({ message: 'timeout', kind: 'timeout', retryable: true })
        },
      }),
    ).rejects.toThrow('timeout')
    expect(order?.invoiceStatus).toBe('pending')
    expect(order?.invoiceLastError).toContain('timeout')
  })

  it('F4 — VÉGLEGES (nem retryable) hibánál viszont failed lesz', async () => {
    const { payload, order } = createMockPayload(createOrder())
    const result = await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      queryByKulsoAzon: silentLookup,
      postXml: async () => {
        throw new SzamlazzApiError({
          message: 'Számla Agent elutasította: hibás tétel',
          kind: 'agent',
          retryable: false,
        })
      },
    })
    expect(result.outcome).toBe('failed')
    expect(order?.invoiceStatus).toBe('failed')
  })
})

/**
 * A12/A14 — a „kérés elment, válasz elveszett" eset feloldása és a beküldések
 * plafonja. A lekérdezés MINDEN ágon injektált: e nélkül a teszt a valódi
 * Számlázz.hu-ra menne ki.
 */
describe('issueInvoiceForOrder — idempotencia-feloldás és kísérlet-plafon', () => {
  /** A 71/152-es duplikátum-jelzés (a Számlázz.hu „Már létező rendelésszám"-a). */
  function duplicateError(code: string): SzamlazzApiError {
    return new SzamlazzApiError({
      message: `Számla Agent hiba: ${code} — Már létező rendelésszám.`,
      kind: 'duplicate',
      agentErrors: [{ code, message: 'Már létező rendelésszám.' }],
      retryable: false,
    })
  }

  it('duplikátum-jelzés (71) + lekérdezés-találat: a meglévő számla átvéve, nem hiba', async () => {
    const { payload, order, updates } = createMockPayload(createOrder())
    const lookups: string[] = []
    let posts = 0
    const result = await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      issueDate: '2026-08-04',
      queryByKulsoAzon: async (kulsoAzon) => {
        lookups.push(kulsoAzon)
        // Az első (POST előtti) lookup üres — a 71 a POST után jön, a második
        // lookup veszi át a meglévő bizonylatot.
        return lookups.length === 1 ? null : ownInvoice('KIN-2026-7')
      },
      postXml: async () => {
        posts += 1
        throw duplicateError('71')
      },
    })

    expect(result).toEqual({ outcome: 'issued', invoiceNumber: 'KIN-2026-7' })
    expect(posts).toBe(1)
    expect(lookups).toEqual([INVOICE_KULSO_AZON, INVOICE_KULSO_AZON])
    expect(order?.invoiceStatus).toBe('issued')
    expect(order?.invoiceNumber).toBe('KIN-2026-7')
    expect(updates[1]).toEqual({
      invoiceStatus: 'issued',
      invoiceNumber: 'KIN-2026-7',
      invoiceLastError: null,
    })
  })

  it('duplikátum-jelzés TALÁLAT NÉLKÜL: failed + kézi egyeztetést kérő indoklás', async () => {
    const { payload, order } = createMockPayload(createOrder())
    const result = await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      issueDate: '2026-08-04',
      queryByKulsoAzon: async () => null,
      postXml: async () => {
        throw duplicateError('152')
      },
    })

    expect(result.outcome).toBe('failed')
    expect(result.reason).toContain('kézi egyeztetés')
    expect(order?.invoiceStatus).toBe('failed')
    expect(order?.invoiceLastError).toContain('kézi egyeztetés')
    expect(order?.invoiceNumber).toBeUndefined()
  })

  it('első kísérletnél (invoiceAttempts 0) is lefut a POST előtti lekérdezés', async () => {
    const { payload } = createMockPayload(createOrder({ invoiceAttempts: 0 }))
    const lookups: string[] = []
    const result = await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      issueDate: '2026-08-04',
      queryByKulsoAzon: async (kulsoAzon) => {
        lookups.push(kulsoAzon)
        return null
      },
      postXml: async () => ({ szamlaszam: 'KIN-2026-7' }),
    })

    expect(result).toEqual({ outcome: 'issued', invoiceNumber: 'KIN-2026-7' })
    // Beküldés még nem volt: a régi (rendelésszám) kulcson talált bizonylat
    // csak idegen lehetne, ezért ott nem keres.
    expect(lookups).toEqual([INVOICE_KULSO_AZON])
  })

  it('retry ELŐTTI lekérdezés: találatnál a beküldés elmarad (a bizonylat már létezik)', async () => {
    // invoiceAttempts=1: az előző kísérlet válasza elveszhetett — a beküldés
    // megismétlése előtt kötelező a szamlaKulsoAzon-lekérdezés.
    const { payload, order } = createMockPayload(createOrder({ invoiceAttempts: 1 }))
    const lookups: string[] = []
    let posts = 0
    const result = await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      issueDate: '2026-08-04',
      queryByKulsoAzon: async (kulsoAzon) => {
        lookups.push(kulsoAzon)
        return ownInvoice('KIN-2026-7')
      },
      postXml: async () => {
        posts += 1
        return { szamlaszam: 'MASIK-SZAMLA' }
      },
    })

    expect(result).toEqual({ outcome: 'issued', invoiceNumber: 'KIN-2026-7' })
    expect(lookups).toEqual([INVOICE_KULSO_AZON])
    expect(posts).toBe(0)
    expect(order?.invoiceNumber).toBe('KIN-2026-7')
    // F10: a LEKÉRDEZÉS nem fogyaszt beküldési kísérletet — a hivatalos 5-ös
    // plafon a kérés ismételt BEKÜLDÉSÉRE vonatkozik, nem a visszakeresésre.
    expect(order?.invoiceAttempts).toBe(1)
  })

  it('kísérlet-plafon (5): EGY záró lekérdezés, beküldés NINCS, failed + RIASZTÁS a kézi kiállítás előtti kereséssel; egy később futó job már nem kérdez le', async () => {
    // H3: a plafon a lekérdezés UTÁN dönt (az 5. bizonytalan beküldés
    // bizonylata is átvehető legyen). Üres találatnál a kimenet végleges
    // failed + RIASZTÁS, POST nélkül. Az 5. beküldés timeoutja miatt a
    // bizonylat később is megjelenhet: a szöveg a keresést kéri, és az utolsó
    // hibát is megtartja.
    const lastSubmissionError = 'A Számlázz.hu nem válaszolt 15000 ms-en belül.'
    const { payload, order } = createMockPayload(
      createOrder({
        invoiceStatus: 'failed',
        invoiceAttempts: MAX_INVOICE_ATTEMPTS,
        invoiceLastError: lastSubmissionError,
      }),
    )
    const { logger, logged } = captureLogs()
    const lookups: string[] = []
    let posts = 0
    const run = () =>
      issueInvoiceForOrder({
        payload,
        orderId: 101,
        config: ENABLED_CONFIG,
        logger,
        queryByKulsoAzon: async (kulsoAzon) => {
          lookups.push(kulsoAzon)
          return null
        },
        postXml: async () => {
          posts += 1
          return { szamlaszam: 'X' }
        },
      })
    const result = await run()

    expect(result.outcome).toBe('failed')
    expect(result.reason).toContain('kimerült')
    expect(result.reason).toContain(`${ORDER_NUMBER} rendelésszámú bizonylatot`)
    expect(result.reason).toContain(lastSubmissionError)
    // Korábbi beküldések után az egyedi ÉS a régi (PR #304-es, rendelésszám)
    // kulcson is keres: a régi kóddal beküldött számla is előkerüljön.
    expect(lookups).toEqual([INVOICE_KULSO_AZON, ORDER_NUMBER])
    expect(posts).toBe(0)
    expect(order?.invoiceStatus).toBe('failed')
    expect(order?.invoiceLastError).toBe(result.reason)
    expect(order?.invoiceAttempts).toBe(MAX_INVOICE_ATTEMPTS)
    const alerts = logged.filter((entry) => entry.level === 'error')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.message).toMatch(/^RIASZTÁS: a számlakiállítás beküldései kimerültek/)

    // Egy még sorban álló job: sem lekérdezés, sem beküldés, sem új riasztás.
    await expect(run()).resolves.toMatchObject({ outcome: 'skipped' })
    expect(lookups).toHaveLength(2)
    expect(posts).toBe(0)
    expect(logged.filter((entry) => entry.level === 'error')).toHaveLength(1)
  })

  it('H3 — kísérlet-plafon (5) + lekérdezés-TALÁLAT: a meglévő számla átvéve, beküldés nélkül', async () => {
    const { payload, order } = createMockPayload(
      createOrder({ invoiceStatus: 'pending', invoiceAttempts: MAX_INVOICE_ATTEMPTS }),
    )
    let posts = 0
    const result = await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      queryByKulsoAzon: async () => ownInvoice('E-KIN-2026-42'),
      postXml: async () => {
        posts += 1
        return { szamlaszam: 'MASODIK-SZAMLA' }
      },
    })

    expect(result).toEqual({ outcome: 'issued', invoiceNumber: 'E-KIN-2026-42' })
    expect(posts).toBe(0)
    expect(order?.invoiceStatus).toBe('issued')
    expect(order?.invoiceNumber).toBe('E-KIN-2026-42')
    expect(order?.invoiceLastError).toBeNull()
    expect(order?.invoiceAttempts).toBe(MAX_INVOICE_ATTEMPTS)
  })

  it('sikeres kiállítás: a megadott issueDate teljesítési dátumként a rendelésre íródik', async () => {
    const { payload, order, updates } = createMockPayload(createOrder())
    const result = await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      issueDate: '2026-07-15',
      queryByKulsoAzon: silentLookup,
      postXml: async () => ({ szamlaszam: 'KIN-2026-7' }),
    })

    expect(result).toEqual({ outcome: 'issued', invoiceNumber: 'KIN-2026-7' })
    expect(order?.invoiceCompletionDate).toBe('2026-07-15')
    expect(updates[1]).toEqual({
      invoiceStatus: 'issued',
      invoiceNumber: 'KIN-2026-7',
      invoiceCompletionDate: '2026-07-15',
      invoiceLastError: null,
    })
  })

  it('issueDate nélkül a kelt-dátum a MAGYAR naptári nap (hajnali 00:30 CEST)', async () => {
    // 2026-09-01T00:30 magyar idő = 2026-08-31T22:30Z — UTC-ből képezve a
    // számla az előző hónapra (más áfa-időszakra) állt volna ki.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-31T22:30:00Z'))
    try {
      const { payload, order } = createMockPayload(createOrder())
      const sentXml: string[] = []
      const result = await issueInvoiceForOrder({
        payload,
        orderId: 101,
        config: ENABLED_CONFIG,
        queryByKulsoAzon: silentLookup,
        postXml: async (xml) => {
          sentXml.push(xml)
          return { szamlaszam: 'KIN-2026-9' }
        },
      })

      expect(result).toEqual({ outcome: 'issued', invoiceNumber: 'KIN-2026-9' })
      expect(sentXml[0]).toContain('<keltDatum>2026-09-01</keltDatum>')
      expect(sentXml[0]).toContain('<teljesitesDatum>2026-09-01</teljesitesDatum>')
      expect(order?.invoiceCompletionDate).toBe('2026-09-01')
    } finally {
      vi.useRealTimers()
    }
  })
})

/**
 * W7 — a kezdeti paid-ellenőrzés és a POST között a refund refunded-re
 * állíthatja a rendelést (üres invoiceNumber → stornó nem indul). Az
 * `invoice:<orderId>` zár a párhuzamos kiállítót sorosítja; beküldés előtt
 * újraolvasás, kiállítás után pedig inline stornó, ha a rendelés közben
 * refunded lett.
 */
describe('issueInvoiceForOrder — refund-verseny a beküldés körül (W7)', () => {
  it('a beküldés előtti újraolvasás refunded: POST nincs, failed + K12-RIASZTÁS (utólagos számla + stornó nem megy ki)', async () => {
    const paid = createOrder({ status: 'paid' })
    const refunded = createOrder({ status: 'refunded' })
    let finds = 0
    const updates: Array<Record<string, unknown>> = []
    const payload = {
      findByID: async () => {
        finds += 1
        return finds === 1 ? paid : refunded
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data)
        return refunded
      },
    }
    let posts = 0
    const result = await issueInvoiceForOrder({
      payload: payload as never,
      orderId: 101,
      config: ENABLED_CONFIG,
      issueDate: '2026-08-04',
      queryByKulsoAzon: silentLookup,
      postXml: async () => {
        posts += 1
        return { szamlaszam: 'KIN-2026-7' }
      },
    })

    expect(result.outcome).toBe('failed')
    expect(result.reason).toContain('visszatérítették')
    expect(posts).toBe(0)
    expect(updates).toEqual([{ invoiceStatus: 'failed', invoiceLastError: result.reason }])
  })

  it('kiállítás után refunded, stornó nélkül: inline stornó, a számla issued marad', async () => {
    const order = createOrder({ status: 'paid' })
    let finds = 0
    const payload = {
      findByID: async () => {
        finds += 1
        if (finds <= 2) {
          return order
        }
        return {
          ...order,
          status: 'refunded' as const,
          invoiceNumber: order.invoiceNumber,
          stornoStatus: 'none' as const,
          stornoNumber: undefined,
        }
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(order, data)
        return order
      },
    }
    const stornoOrders: Order[] = []
    const result = await issueInvoiceForOrder({
      payload: payload as never,
      orderId: 101,
      config: ENABLED_CONFIG,
      issueDate: '2026-08-04',
      queryByKulsoAzon: silentLookup,
      postXml: async () => ({ szamlaszam: 'KIN-2026-7' }),
      issueStorno: async (ord) => {
        stornoOrders.push(ord)
        return { outcome: 'storned', stornoNumber: 'ST-1' }
      },
    })

    expect(result).toEqual({ outcome: 'issued', invoiceNumber: 'KIN-2026-7' })
    expect(stornoOrders).toHaveLength(1)
    expect(stornoOrders[0]?.invoiceNumber).toBe('KIN-2026-7')
    expect(stornoOrders[0]?.status).toBe('refunded')
  })
})

/**
 * A teljesítési dátum a FIZETÉS (hozzáférés-nyitás) budapesti napja, nem a
 * job futásáé (Áfa tv. 55. § (1)). A kelt és a fizetési határidő a
 * kiállítás napja marad: a Számlázz.hu-ban a határidő nem lehet korábbi a
 * keltnél, a teljesítés igen.
 */
describe('issueInvoiceForOrder — teljesítési dátum a fizetés napjából', () => {
  /** A felvett naplósorok (szint + üzenet) — a figyelmeztetések ellenőrzéséhez. */
  function recordingLogger() {
    const logged: Array<{ level: 'info' | 'warn' | 'error'; message: string }> = []
    const logger = {
      debug: () => undefined,
      info: (message: string) => logged.push({ level: 'info', message }),
      warn: (message: string) => logged.push({ level: 'warn', message }),
      error: (message: string) => logged.push({ level: 'error', message }),
      child: () => logger,
    }
    return { logger, logged }
  }

  it('23:58-as (Budapest) fizetés, éjfél utáni kiállítás: a teljesítés a FIZETÉS napja', async () => {
    // 2026-09-30T23:58 magyar idő = 2026-09-30T21:58Z; a job 10-01-jén fut.
    const { payload, order, updates } = createMockPayload(createOrder())
    const sentXml: string[] = []
    const result = await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      issueDate: '2026-10-01',
      resolvePaidMoment: async () => ({
        paidAt: new Date('2026-09-30T21:58:00Z'),
        paidDate: budapestDateString(new Date('2026-09-30T21:58:00Z')),
      }),
      queryByKulsoAzon: silentLookup,
      postXml: async (xml) => {
        sentXml.push(xml)
        return { szamlaszam: 'KIN-2026-10' }
      },
    })

    expect(result).toEqual({ outcome: 'issued', invoiceNumber: 'KIN-2026-10' })
    expect(sentXml[0]).toContain('<keltDatum>2026-10-01</keltDatum>')
    expect(sentXml[0]).toContain('<teljesitesDatum>2026-09-30</teljesitesDatum>')
    // A fizetési határidő NEM lehet korábbi a keltnél (Számlázz.hu-szabály).
    expect(sentXml[0]).toContain('<fizetesiHataridoDatum>2026-10-01</fizetesiHataridoDatum>')
    // A helyesbítő (B4) ezt a ténylegesen kiküldött dátumot ismétli.
    expect(updates[0]).toMatchObject({ invoiceCompletionDate: '2026-09-30' })
    expect(order?.invoiceCompletionDate).toBe('2026-09-30')
  })

  it('kiesés utáni, napokkal későbbi újrafuttatás: a teljesítés továbbra is a fizetés napja', async () => {
    const { payload, order } = createMockPayload(createOrder({ invoiceAttempts: 2 }))
    const sentXml: string[] = []
    await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      issueDate: '2026-10-09',
      resolvePaidMoment: async () => ({
        paidAt: new Date('2026-10-02T08:00:00Z'),
        paidDate: '2026-10-02',
      }),
      queryByKulsoAzon: silentLookup,
      postXml: async (xml) => {
        sentXml.push(xml)
        return { szamlaszam: 'KIN-2026-11' }
      },
    })
    expect(sentXml[0]).toContain('<teljesitesDatum>2026-10-02</teljesitesDatum>')
    expect(sentXml[0]).toContain('<keltDatum>2026-10-09</keltDatum>')
    expect(order?.invoiceCompletionDate).toBe('2026-10-02')
  })

  it('nincs fizetési időpont: a teljesítés a kiállítás napja, FIGYELMEZTETÉSSEL', async () => {
    const { payload, order } = createMockPayload(createOrder())
    const { logger, logged } = recordingLogger()
    const sentXml: string[] = []
    await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      logger,
      issueDate: '2026-10-01',
      resolvePaidMoment: async () => null,
      queryByKulsoAzon: silentLookup,
      postXml: async (xml) => {
        sentXml.push(xml)
        return { szamlaszam: 'KIN-2026-12' }
      },
    })
    expect(sentXml[0]).toContain('<teljesitesDatum>2026-10-01</teljesitesDatum>')
    expect(order?.invoiceCompletionDate).toBe('2026-10-01')
    const warning = logged.find((entry) => entry.message.includes('a fizetés napja nem található'))
    expect(warning?.level).toBe('warn')
  })

  it('a kiállításnál KÉSŐBBI fizetési nap (óraeltérés) nem kerül a számlára: a kiállítás napja marad', async () => {
    const { payload } = createMockPayload(createOrder())
    const { logger, logged } = recordingLogger()
    const sentXml: string[] = []
    await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      logger,
      issueDate: '2026-10-01',
      resolvePaidMoment: async () => ({
        paidAt: new Date('2026-10-02T10:00:00Z'),
        paidDate: '2026-10-02',
      }),
      queryByKulsoAzon: silentLookup,
      postXml: async (xml) => {
        sentXml.push(xml)
        return { szamlaszam: 'KIN-2026-13' }
      },
    })
    expect(sentXml[0]).toContain('<teljesitesDatum>2026-10-01</teljesitesDatum>')
    expect(
      logged.some((entry) => entry.level === 'warn' && entry.message.includes('későbbi')),
    ).toBe(true)
  })

  it('a fizetési időpont olvasásának hibája DOB, állapotírás és beküldés NÉLKÜL (a job újrapróbálja)', async () => {
    const { payload, updates } = createMockPayload(createOrder())
    await expect(
      issueInvoiceForOrder({
        payload,
        orderId: 101,
        config: ENABLED_CONFIG,
        issueDate: '2026-10-01',
        resolvePaidMoment: async () => {
          throw new Error('adatbázis-kapcsolat megszakadt')
        },
        queryByKulsoAzon: noLookup,
        postXml: async () => {
          throw new Error('TESZT-HIBA: olvasási hiba után nem mehet ki számlakérés')
        },
      }),
    ).rejects.toThrow('adatbázis-kapcsolat megszakadt')
    // Az invoiceStatus érintetlen (none): az order-poll resweep újra felveszi.
    expect(updates).toHaveLength(0)
  })

  it('ALAPÉRTELMEZETT feloldó: a vevő accessGrants-sorából (sourceOrder = rendelés) olvas', async () => {
    const order = createOrder({ customer: 7 })
    const reads: string[] = []
    const payload = {
      findByID: async ({ collection, id }: { collection: string; id: number }) => {
        reads.push(`${collection}:${id}`)
        if (collection === 'users') {
          return {
            id: 7,
            accessGrants: [
              // Másik rendelés (más óra) — nem számít.
              {
                product: 42,
                grantedAt: '2026-08-01T10:00:00.000Z',
                sourceKind: 'order',
                sourceOrder: 55,
              },
              // EZ a rendelés: 2026-09-30 23:58 Budapest.
              {
                product: 42,
                grantedAt: '2026-09-30T21:58:00.000Z',
                sourceKind: 'order',
                sourceOrder: 101,
              },
            ],
          }
        }
        return order
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(order, data)
        return order
      },
    }
    const sentXml: string[] = []
    await issueInvoiceForOrder({
      payload: payload as never,
      orderId: 101,
      config: ENABLED_CONFIG,
      issueDate: '2026-10-01',
      queryByKulsoAzon: silentLookup,
      postXml: async (xml) => {
        sentXml.push(xml)
        return { szamlaszam: 'KIN-2026-14' }
      },
    })
    expect(reads).toContain('users:7')
    expect(sentXml[0]).toContain('<teljesitesDatum>2026-09-30</teljesitesDatum>')
    expect(order.invoiceCompletionDate).toBe('2026-09-30')
  })

  it('56 (az értesítő nem ment ki, de a számla kiállt): issued + számlaszám + RIASZTÁS', async () => {
    const { payload, order } = createMockPayload(createOrder())
    const { logger, logged } = recordingLogger()
    const result = await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      logger,
      issueDate: '2026-10-01',
      resolvePaidMoment: async () => null,
      queryByKulsoAzon: silentLookup,
      postXml: async () => ({
        szamlaszam: 'KIN-2026-15',
        notificationError: { code: '56', message: 'A számlaértesítő kézbesítése sikertelen.' },
      }),
    })
    expect(result).toEqual({ outcome: 'issued', invoiceNumber: 'KIN-2026-15' })
    expect(order?.invoiceStatus).toBe('issued')
    expect(order?.invoiceNumber).toBe('KIN-2026-15')
    const alert = logged.find((entry) =>
      entry.message.includes('számlaértesítő e-mail NEM ment ki'),
    )
    expect(alert?.level).toBe('error')
    expect(alert?.message.startsWith('RIASZTÁS:')).toBe(true)
  })

  it('55 (időbélyeg-szerver) a beküldésnél: pending marad + THROW, nem végleges failed', async () => {
    const { payload, order } = createMockPayload(createOrder())
    await expect(
      issueInvoiceForOrder({
        payload,
        orderId: 101,
        config: ENABLED_CONFIG,
        issueDate: '2026-10-01',
        resolvePaidMoment: async () => null,
        queryByKulsoAzon: silentLookup,
        postXml: async () =>
          parseAgentResponse(
            '<xmlszamlavalasz><sikeres>false</sikeres><hibakod>55</hibakod>' +
              '<hibauzenet>E-számla aláírása sikertelen.</hibauzenet></xmlszamlavalasz>',
            new Headers(),
          ),
      }),
    ).rejects.toThrow('55')
    expect(order?.invoiceStatus).toBe('pending')
    expect(order?.invoiceLastError).toContain('55')
  })
})

/** Szint + üzenet (+ kontextus) naplórögzítő (a RIASZTÁS-sorok ellenőrzéséhez). */
function captureLogs() {
  const logged: Array<{
    level: 'debug' | 'info' | 'warn' | 'error'
    message: string
    context?: Record<string, unknown>
  }> = []
  const logger = {
    debug: (message: string) => logged.push({ level: 'debug', message }),
    info: (message: string) => logged.push({ level: 'info', message }),
    warn: (message: string) => logged.push({ level: 'warn', message }),
    error: (message: string, context?: Record<string, unknown>) =>
      logged.push({ level: 'error', message, ...(context ? { context } : {}) }),
    child: () => logger,
  }
  return { logger, logged }
}

const HOUR_MS = 60 * 60 * 1000

/** A fizetés pillanata `hoursAgo` órával a HÍVÁS pillanata előtt (rögzített érték). */
function paidHoursAgo(hoursAgo: number): () => Promise<OrderPaidMoment> {
  const paidAt = new Date(Date.now() - hoursAgo * HOUR_MS)
  return async () => ({ paidAt, paidDate: budapestDateString(paidAt) })
}

/**
 * Rögzített óra a H3/H4-tesztekhez: csak a Date hamis, így a lekérdezési
 * hibasorozat órái pontosan léptethetők, a fetch-mock és az AbortSignal
 * viszont valódi időzítőn fut.
 */
function useFrozenClock(): void {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.parse('2026-10-01T08:00:00.000Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })
}

function advanceClock(ms: number): void {
  vi.setSystemTime(Date.now() + ms)
}

/** A riasztási/leállási küszöbnél (2 órás hibasorozat) egy perccel hosszabb lépés. */
const PAST_STREAK_THRESHOLD_MS = LOOKUP_FAILURE_ALERT_AFTER_MS + 60 * 1000

/**
 * A job-újrapróbálás és a resweep modellje: a futást addig ismétli (közben a
 * hibasorozat küszöbén túlra lépteti az órát), amíg a kimenet nem
 * újrapróbálható dobás. Minden más hiba (pl. a tesztben hangosan dobó POST)
 * azonnal továbbmegy.
 */
async function runUntilSettled(
  run: () => Promise<IssueInvoiceResult>,
  maxRuns = 4,
): Promise<IssueInvoiceResult> {
  for (let attempt = 1; attempt < maxRuns; attempt += 1) {
    try {
      return await run()
    } catch (error) {
      if (!(error instanceof SzamlazzApiError) || !error.retryable) {
        throw error
      }
      advanceClock(PAST_STREAK_THRESHOLD_MS)
    }
  }
  return run()
}

const LOOKUP_TIMEOUT_MESSAGE =
  'A Számlázz.hu nem válaszolt 15000 ms-en belül (bizonylat-lekérdezés).'

function lookupTimeout(): SzamlazzApiError {
  return new SzamlazzApiError({ message: LOOKUP_TIMEOUT_MESSAGE, kind: 'timeout', retryable: true })
}

/**
 * H3 — a vadász-reprodukció: a Számlázz.hu időbélyeg-kiesése alatt az 1–4.
 * beküldés 55-öt kap (újrapróbálható, bizonylat nem készül), az 5. beküldés a
 * mi oldalunkon timeoutol, de a szerver KIÁLLÍTJA a számlát (NAV-hoz is
 * bejelenti). A régi kód a 6. futásban a plafont a lekérdezés ELŐTT nézte:
 * lekérdezés nélkül 'failed' lett, szám nélkül, és a RIASZTÁS kézi (DUPLA)
 * kiállítás felé tolta a tulajdonost.
 */
describe('issueInvoiceForOrder — H3: az 5. bizonytalan beküldés bizonylata átvehető', () => {
  useFrozenClock()

  beforeEach(() => {
    resetAlertThrottle()
  })

  afterEach(() => {
    resetAlertThrottle()
  })

  it('4 × 55, majd timeoutoló, de létrejött 5. beküldés: a 6. futás lekérdezéssel ÁTVESZI a számlát', async () => {
    const { payload, order } = createMockPayload(createOrder())
    let posts = 0
    let createdAtProvider: string | null = null
    const lookups: string[] = []
    const run = () =>
      issueInvoiceForOrder({
        payload,
        orderId: 101,
        config: ENABLED_CONFIG,
        issueDate: '2026-10-01',
        resolvePaidMoment: paidHoursAgo(1),
        queryByKulsoAzon: async (kulsoAzon) => {
          lookups.push(kulsoAzon)
          // A létrejött bizonylat a beküldött, egyedi külső azonosítón kereshető.
          return createdAtProvider && kulsoAzon === INVOICE_KULSO_AZON
            ? ownInvoice(createdAtProvider)
            : null
        },
        postXml: async () => {
          posts += 1
          if (posts <= 4) {
            return parseAgentResponse(
              '<xmlszamlavalasz><sikeres>false</sikeres><hibakod>55</hibakod>' +
                '<hibauzenet>E-számla aláírása sikertelen.</hibauzenet></xmlszamlavalasz>',
              new Headers(),
            )
          }
          createdAtProvider = 'E-KIN-2026-42'
          throw new SzamlazzApiError({
            message: 'A Számlázz.hu nem válaszolt 15000 ms-en belül.',
            kind: 'timeout',
            retryable: true,
          })
        },
      })

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(run()).rejects.toBeInstanceOf(SzamlazzApiError)
      expect(order?.invoiceStatus).toBe('pending')
    }
    expect(order?.invoiceAttempts).toBe(MAX_INVOICE_ATTEMPTS)

    const lookupsBefore = lookups.length
    const sixth = await run()
    expect(sixth).toEqual({ outcome: 'issued', invoiceNumber: 'E-KIN-2026-42' })
    expect(lookups.length - lookupsBefore).toBe(1)
    expect(posts).toBe(MAX_INVOICE_ATTEMPTS)
    expect(order?.invoiceStatus).toBe('issued')
    expect(order?.invoiceNumber).toBe('E-KIN-2026-42')
  })

  it('plafonnál újrapróbálható lekérdezés-hiba: AZONNALI, fojtott plafon-RIASZTÁS, pending + THROW; a lekérdezés ismétlődik, beküldés nincs', async () => {
    const { payload, order } = createMockPayload(
      createOrder({ invoiceStatus: 'pending', invoiceAttempts: MAX_INVOICE_ATTEMPTS }),
    )
    const { logger, logged } = captureLogs()
    let lookups = 0
    const paid = paidHoursAgo(1)
    for (let run = 0; run < 3; run += 1) {
      await expect(
        issueInvoiceForOrder({
          payload,
          orderId: 101,
          config: ENABLED_CONFIG,
          logger,
          resolvePaidMoment: paid,
          queryByKulsoAzon: async () => {
            lookups += 1
            throw lookupTimeout()
          },
          postXml: async () => expect.unreachable('a plafonnál POST nem mehet ki'),
        }),
      ).rejects.toThrow('bizonylat-lekérdezés')
      advanceClock(10 * 60 * 1000)
    }

    expect(lookups).toBe(3)
    expect(order?.invoiceStatus).toBe('pending')
    expect(order?.invoiceAttempts).toBe(MAX_INVOICE_ATTEMPTS)
    const alerts = logged.filter((entry) => entry.level === 'error')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.message).toMatch(
      /^RIASZTÁS: a számlakiállítás beküldései kimerültek, és a záró bizonylat-lekérdezés hibát adott/,
    )
    expect(alerts[0]?.message).toContain('keresd meg a Számlázz.hu-fiókban')
  })

  it('plafonnál a legalább 2 órás lekérdezési hibasorozat a fizetés után 24 órán túl: failed + RIASZTÁS, dobás és beküldés NÉLKÜL', async () => {
    const { payload, order } = createMockPayload(
      createOrder({ invoiceStatus: 'pending', invoiceAttempts: MAX_INVOICE_ATTEMPTS }),
    )
    const { logger, logged } = captureLogs()
    const paid = paidHoursAgo(25)
    const run = () =>
      issueInvoiceForOrder({
        payload,
        orderId: 101,
        config: ENABLED_CONFIG,
        logger,
        resolvePaidMoment: paid,
        queryByKulsoAzon: async () => {
          throw new SzamlazzApiError({
            message: 'Számlázz.hu HTTP-hiba (503) (bizonylat-lekérdezés).',
            kind: 'http',
            httpStatus: 503,
            retryable: true,
          })
        },
        postXml: async () => expect.unreachable('a plafonnál POST nem mehet ki'),
      })

    // Az első hiba csak elindítja a hibasorozatot: még nem végleges.
    await expect(run()).rejects.toMatchObject({ retryable: true })
    expect(order?.invoiceStatus).toBe('pending')

    advanceClock(PAST_STREAK_THRESHOLD_MS)
    const result = await run()
    expect(result.outcome).toBe('failed')
    expect(order?.invoiceStatus).toBe('failed')
    expect(result.reason).toMatch(/^A számla automatikus kiállítása leállt: /)
    // A korábbi beküldések miatt a bizonylat létezhet: a szöveg a kézi
    // kiállítás ELŐTTI keresést kéri, a külső azonosítóval.
    expect(result.reason).toContain(`${ORDER_NUMBER} rendelésszámú bizonylatot`)
    expect(order?.invoiceLastError).toBe(result.reason)
    expect(logged.filter((entry) => entry.level === 'error').map((entry) => entry.message)).toEqual(
      [
        expect.stringMatching(/^RIASZTÁS: a számlakiállítás beküldései kimerültek/),
        expect.stringMatching(/^RIASZTÁS: .*automatikus kiállítása leállt/),
      ],
    )
  })

  it('plafonnál VÉGLEGES lekérdezés-hiba: failed + RIASZTÁS (a bizonylat létezhet), beküldés nélkül', async () => {
    const { payload, order } = createMockPayload(
      createOrder({ invoiceStatus: 'pending', invoiceAttempts: MAX_INVOICE_ATTEMPTS }),
    )
    const { logger, logged } = captureLogs()
    const result = await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      logger,
      resolvePaidMoment: paidHoursAgo(1),
      queryByKulsoAzon: async () => {
        throw new SzamlazzApiError({
          message: 'Számla Agent elutasította a kérést: 3 — Sikertelen bejelentkezés',
          kind: 'agent',
          agentErrors: [{ code: '3', message: 'Sikertelen bejelentkezés' }],
          retryable: false,
        })
      },
      postXml: async () => expect.unreachable('a plafonnál POST nem mehet ki'),
    })
    expect(result.outcome).toBe('failed')
    expect(result.reason).toMatch(/^A számla automatikus kiállítása leállt: /)
    expect(result.reason).toContain(`${ORDER_NUMBER} rendelésszámú bizonylatot`)
    expect(order?.invoiceStatus).toBe('failed')
    const alerts = logged.filter((entry) => entry.level === 'error')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.message).toMatch(/^RIASZTÁS: /)
  })
})

/**
 * H4 — a beküldés ELŐTTI lekérdezés hibái nem fogyasztanak kísérletet (F10),
 * ezért a plafon nem fékezi őket: a fék a folyamatos HIBASOROZAT hossza és a
 * fizetés óta eltelt idő együtt. A lekérdezés itt a VALÓDI
 * queryInvoiceByKulsoAzon, mockolt fetch-csel (valódi hálózat nincs): az
 * alapválasz egy 200-as HTML-oldal, amit egy elgépelt SZAMLAZZ_API_URL (a
 * nyitóoldal) tartósan ad. Az invalid_response SZÁNDÉKOSAN újrapróbálható
 * marad (egy átmeneti karbantartási oldal ne tegye véglegessé a hibát).
 */
describe('issueInvoiceForOrder — H4: a lekérdezés-hibák időkorlátja', () => {
  useFrozenClock()

  let fetchCalls = 0
  /** true: a lekérdezés sikeres („nincs ilyen bizonylat", 7-es kód). */
  let lookupHealthy = false

  const HTML_PAGE = '<!doctype html><html><body>Számlázz.hu</body></html>'
  const NOT_FOUND_XML =
    '<xmlszamlavalasz><sikeres>false</sikeres><hibakod>7</hibakod>' +
    '<hibauzenet>Nincs ilyen bizonylat</hibauzenet></xmlszamlavalasz>'

  beforeEach(() => {
    fetchCalls = 0
    lookupHealthy = false
    resetAlertThrottle()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetchCalls += 1
        return lookupHealthy
          ? new Response(NOT_FOUND_XML, { status: 200 })
          : new Response(HTML_PAGE, {
              status: 200,
              headers: { 'content-type': 'text/html; charset=utf-8' },
            })
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetAlertThrottle()
  })

  const loudPost = async (): Promise<never> => {
    throw new Error('TESZT-HIBA: a lekérdezés hibája után POST nem mehet ki')
  }

  it('a konstansok: 2 órás hibasorozat után riasztás, a fizetés után 24 órán túl végleges hiba', () => {
    expect(LOOKUP_FAILURE_ALERT_AFTER_MS).toBe(2 * HOUR_MS)
    expect(LOOKUP_FAILURE_ESCALATION_MS).toBe(24 * HOUR_MS)
  })

  it('egyetlen átmeneti lekérdezés-hiba egy 72 órája fizetett, ki nem állított számlánál NEM végleges: pending + THROW, a következő futás kiállítja', async () => {
    // Kiesés utáni lemaradás: az első kiállítási kísérlet a fizetés után több
    // mint 24 órával fut, és a lekérdezés egyszer 503-at kap.
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1
        return call === 1
          ? new Response('<html>Service Unavailable</html>', { status: 503 })
          : new Response(NOT_FOUND_XML, { status: 200 })
      }),
    )
    const { payload, order } = createMockPayload(createOrder({ invoiceStatus: 'none' }))
    const { logger, logged } = captureLogs()
    let posts = 0
    const paid = paidHoursAgo(72)
    const run = () =>
      issueInvoiceForOrder({
        payload,
        orderId: 101,
        config: ENABLED_CONFIG,
        logger,
        resolvePaidMoment: paid,
        queryByKulsoAzon: queryInvoiceByKulsoAzon,
        postXml: async () => {
          posts += 1
          return { szamlaszam: 'E-KIN-2026-1' }
        },
      })

    await expect(run()).rejects.toMatchObject({ retryable: true })
    expect(order?.invoiceStatus).toBe('pending')
    expect(logged.filter((entry) => entry.level === 'error')).toEqual([])

    advanceClock(10 * 60 * 1000)
    await expect(run()).resolves.toEqual({ outcome: 'issued', invoiceNumber: 'E-KIN-2026-1' })
    expect(posts).toBe(1)
    expect(order?.invoiceStatus).toBe('issued')
    expect(order?.invoiceLastError).toBeNull()
  })

  it('legalább 2 órás hibasorozat a fizetés után 24 órán túl: failed + EGY RIASZTÁS, dobás és beküldés nélkül', async () => {
    const { payload, order } = createMockPayload(createOrder())
    const { logger, logged } = captureLogs()
    const paid = paidHoursAgo(72)
    const run = () =>
      issueInvoiceForOrder({
        payload,
        orderId: 101,
        config: ENABLED_CONFIG,
        logger,
        resolvePaidMoment: paid,
        queryByKulsoAzon: queryInvoiceByKulsoAzon,
        postXml: loudPost,
      })

    await expect(run()).rejects.toMatchObject({ kind: 'invalid_response', retryable: true })
    expect(order?.invoiceStatus).toBe('pending')

    advanceClock(PAST_STREAK_THRESHOLD_MS)
    const result = await run()
    expect(result.outcome).toBe('failed')
    expect(fetchCalls).toBe(2)
    expect(order?.invoiceStatus).toBe('failed')
    expect(order?.invoiceAttempts).toBeUndefined()
    expect(result.reason).toMatch(/^A számla automatikus kiállítása leállt: /)
    expect(result.reason).toContain('2 órája folyamatosan sikertelen')
    expect(result.reason).toContain('SZAMLAZZ_API_URL')
    // Beküldés még nem volt: bizonylat nem létezhet, keresésre nincs szükség.
    expect(result.reason).toContain('Beküldés még nem történt')
    expect(result.reason).not.toContain('rendelésszámú bizonylatot')
    const alerts = logged.filter((entry) => entry.level === 'error')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.message).toMatch(
      /^RIASZTÁS: a számla előtti bizonylat-lekérdezés legalább 2 órája folyamatosan sikertelen, és a fizetés óta több mint 24 óra telt el/,
    )
  })

  it('egy sikeres lekérdezés lezárja a hibasorozatot: a későbbi hiba ÚJ sorozatot indít, nem végleges', async () => {
    const { payload, order } = createMockPayload(createOrder())
    const { logger, logged } = captureLogs()
    const paid = paidHoursAgo(72)
    const run = () =>
      issueInvoiceForOrder({
        payload,
        orderId: 101,
        config: ENABLED_CONFIG,
        logger,
        resolvePaidMoment: paid,
        queryByKulsoAzon: queryInvoiceByKulsoAzon,
        postXml: async () => {
          throw new SzamlazzApiError({
            message: 'A Számlázz.hu nem válaszolt 15000 ms-en belül.',
            kind: 'timeout',
            retryable: true,
          })
        },
      })

    // T0: a lekérdezés hibás, a sorozat elindul.
    await expect(run()).rejects.toMatchObject({ kind: 'invalid_response' })
    // T0 + 1 óra: a lekérdezés sikeres („nincs ilyen bizonylat"), a beküldés timeoutol.
    advanceClock(HOUR_MS)
    lookupHealthy = true
    await expect(run()).rejects.toMatchObject({ kind: 'timeout' })
    expect(order?.invoiceAttempts).toBe(1)
    // T0 + 2 óra 1 perc: újra hibás lekérdezés. A T0-s sorozat lezárult, ez
    // egy friss sorozat első hibája.
    advanceClock(PAST_STREAK_THRESHOLD_MS - HOUR_MS)
    lookupHealthy = false
    await expect(run()).rejects.toMatchObject({ kind: 'invalid_response' })

    expect(order?.invoiceStatus).toBe('pending')
    expect(logged.filter((entry) => entry.level === 'error')).toEqual([])
  })

  it('a fizetés után 1 órával: pending + THROW (a resweep újrapróbálja), riasztás nélkül', async () => {
    const { payload, order } = createMockPayload(createOrder())
    const { logger, logged } = captureLogs()
    await expect(
      issueInvoiceForOrder({
        payload,
        orderId: 101,
        config: ENABLED_CONFIG,
        logger,
        resolvePaidMoment: paidHoursAgo(1),
        queryByKulsoAzon: queryInvoiceByKulsoAzon,
        postXml: loudPost,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_response', retryable: true })

    expect(order?.invoiceStatus).toBe('pending')
    expect(order?.invoiceAttempts).toBeUndefined()
    expect(logged.filter((entry) => entry.level === 'error')).toEqual([])
    expect(logged.some((entry) => entry.level === 'warn')).toBe(true)
  })

  it('2 órás hibasorozat a fizetés utáni 24 órán belül: pending + THROW, és a RIASZTÁS rendelésenként EGYSZER megy ki (fojtva)', async () => {
    const { payload, order } = createMockPayload(createOrder())
    const { logger, logged } = captureLogs()
    const paid = paidHoursAgo(1)
    const run = () =>
      issueInvoiceForOrder({
        payload,
        orderId: 101,
        config: ENABLED_CONFIG,
        logger,
        resolvePaidMoment: paid,
        queryByKulsoAzon: queryInvoiceByKulsoAzon,
        postXml: loudPost,
      })

    await expect(run()).rejects.toMatchObject({ retryable: true })
    expect(logged.filter((entry) => entry.level === 'error')).toEqual([])
    advanceClock(PAST_STREAK_THRESHOLD_MS)
    await expect(run()).rejects.toMatchObject({ retryable: true })
    advanceClock(10 * 60 * 1000)
    await expect(run()).rejects.toMatchObject({ retryable: true })

    expect(fetchCalls).toBe(3)
    expect(order?.invoiceStatus).toBe('pending')
    const alerts = logged.filter((entry) => entry.level === 'error')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.message).toMatch(
      /^RIASZTÁS: a számla előtti bizonylat-lekérdezés legalább 2 órája folyamatosan sikertelen\. Ha a hiba a fizetés után 24 órával is fennáll/,
    )
  })

  it('ismeretlen fizetési pillanat: a rendelés létrehozása az időalap, és ezt mondja az ok ÉS a RIASZTÁS is', async () => {
    const createdAt = new Date(Date.now() - 25 * HOUR_MS).toISOString()
    const { payload, order } = createMockPayload(createOrder({ createdAt }))
    const { logger, logged } = captureLogs()
    const result = await runUntilSettled(() =>
      issueInvoiceForOrder({
        payload,
        orderId: 101,
        config: ENABLED_CONFIG,
        logger,
        resolvePaidMoment: async () => null,
        queryByKulsoAzon: queryInvoiceByKulsoAzon,
        postXml: loudPost,
      }),
    )

    expect(result.outcome).toBe('failed')
    expect(order?.invoiceStatus).toBe('failed')
    expect(result.reason).toContain('a rendelés óta')
    expect(result.reason).not.toContain('a fizetés')
    const alert = logged.find((entry) => entry.level === 'error')
    expect(alert?.message).toContain('a rendelés óta több mint 24 óra')
    expect(alert?.message).not.toContain('a fizetés')
  })

  it('a leállás VÉGLEGES: egy még sorban álló job akkor sem kérdez le és nem küld be, ha a lekérdezés közben helyreállt', async () => {
    const { payload, order } = createMockPayload(createOrder())
    const { logger, logged } = captureLogs()
    let posts = 0
    const paid = paidHoursAgo(30)
    const run = () =>
      issueInvoiceForOrder({
        payload,
        orderId: 101,
        config: ENABLED_CONFIG,
        logger,
        resolvePaidMoment: paid,
        queryByKulsoAzon: queryInvoiceByKulsoAzon,
        postXml: async () => {
          posts += 1
          return { szamlaszam: 'E-KIN-2026-1' }
        },
      })

    const stopped = await runUntilSettled(run)
    expect(stopped.outcome).toBe('failed')
    expect(logged.find((entry) => entry.level === 'error')?.message).toContain(
      'automatikus kiállítása leállt',
    )

    // A tulajdonos a riasztás után kézzel rendez; közben a Számlázz.hu
    // helyreáll, és lefut egy korábban sorba állított job.
    const fetchCallsAtStop = fetchCalls
    lookupHealthy = true
    advanceClock(5 * 60 * 1000)
    await expect(run()).resolves.toMatchObject({ outcome: 'skipped' })
    expect(posts).toBe(0)
    expect(fetchCalls).toBe(fetchCallsAtStop)
    expect(order?.invoiceStatus).toBe('failed')
    expect(order?.invoiceLastError).toBe(stopped.reason)
  })

  it('71/152 után a „már létezik" tény a lekérdezési hibasorozaton át a leállás okáig és a RIASZTÁS kontextusáig megmarad', async () => {
    const { payload } = createMockPayload(createOrder())
    const { logger, logged } = captureLogs()
    let lookups = 0
    let posts = 0
    const paid = paidHoursAgo(30)
    const run = () =>
      issueInvoiceForOrder({
        payload,
        orderId: 101,
        config: ENABLED_CONFIG,
        logger,
        resolvePaidMoment: paid,
        queryByKulsoAzon: async () => {
          lookups += 1
          // Az első beküldés előtti lekérdezés sikeres; utána (a 71/152
          // feloldásánál és a későbbi futásokban) timeoutol.
          if (lookups === 1) {
            return null
          }
          throw lookupTimeout()
        },
        postXml: async () => {
          posts += 1
          throw new SzamlazzApiError({
            message: 'Számla Agent hiba: 152 — Már létező rendelésszám.',
            kind: 'duplicate',
            agentErrors: [{ code: '152', message: 'Már létező rendelésszám.' }],
            retryable: false,
          })
        },
      })

    const result = await runUntilSettled(run)

    expect(posts).toBe(1)
    expect(result.outcome).toBe('failed')
    expect(result.reason).toContain('MÁR LÉTEZIK (71/152): ne állítsd ki kézzel')
    expect(result.reason).toContain(`${ORDER_NUMBER} rendelésszámú bizonylatot`)
    const stopAlert = logged.find(
      (entry) => entry.level === 'error' && entry.message.includes('automatikus kiállítása leállt'),
    )
    expect(String(stopAlert?.context?.lastError)).toContain('már létezik')
    expect(result.reason).toMatch(/^A számla automatikus kiállítása leállt: /)
  })

  it('az időkorlát CSAK a lekérdezés hibájára él: a 25 órás rendelés POST-timeoutja pending + THROW marad', async () => {
    const { payload, order } = createMockPayload(createOrder())
    await expect(
      issueInvoiceForOrder({
        payload,
        orderId: 101,
        config: ENABLED_CONFIG,
        resolvePaidMoment: paidHoursAgo(25),
        queryByKulsoAzon: silentLookup,
        postXml: async () => {
          throw new SzamlazzApiError({ message: 'timeout', kind: 'timeout', retryable: true })
        },
      }),
    ).rejects.toThrow('timeout')
    expect(order?.invoiceStatus).toBe('pending')
    expect(order?.invoiceAttempts).toBe(1)
  })

  it('a lekérdezés sikere után a 25 órás rendelés számlája normálisan kiáll (nincs indokolatlan leállás)', async () => {
    lookupHealthy = true
    const { payload, order } = createMockPayload(createOrder())
    const result = await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      issueDate: '2026-10-01',
      resolvePaidMoment: paidHoursAgo(25),
      queryByKulsoAzon: queryInvoiceByKulsoAzon,
      postXml: async () => ({ szamlaszam: 'KIN-2026-77' }),
    })
    expect(result).toEqual({ outcome: 'issued', invoiceNumber: 'KIN-2026-77' })
    expect(order?.invoiceStatus).toBe('issued')
  })
})

// ---------------------------------------------------------------------------
// w1-szamlazz: végleges hibák riasztása, biztonságos átvétel, visszatérítés a
// számla előtt, lekérdezési fék
// ---------------------------------------------------------------------------

/** A 7-es („nincs ilyen bizonylat") xmlszamlavalasz-törzs. */
const NOT_FOUND_BODY =
  '<xmlszamlavalasz><sikeres>false</sikeres><hibakod>7</hibakod>' +
  '<hibauzenet>Hiányzó adat: számla xml (ismeretlen számlaszám, rendelésszám vagy külső azonosító).</hibauzenet></xmlszamlavalasz>'

/** Hangos POST-mock: azokon az ágakon, ahol beküldésnek nem szabad futnia. */
const forbiddenPost = async (): Promise<never> => {
  throw new Error('TESZT-HIBA: ezen az ágon POST nem mehet ki')
}

describe('issueInvoiceForOrder — végleges hibák RIASZTÁS-a (a-szamlazz-6, a-riasztas-2)', () => {
  it('végleges agent-hiba (54 — e-számla nincs engedélyezve): failed, error-szintű RIASZTÁS a rendelésszámmal és a hibakóddal, dobás nélkül', async () => {
    const { payload, order } = createMockPayload(createOrder())
    const { logger, logged } = captureLogs()
    const result = await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      logger,
      issueDate: '2026-08-04',
      queryByKulsoAzon: silentLookup,
      postXml: async () =>
        parseAgentResponse(
          '<xmlszamlavalasz><sikeres>false</sikeres><hibakod>54</hibakod>' +
            '<hibauzenet>E-számla készítés nincs engedélyezve.</hibauzenet></xmlszamlavalasz>',
          new Headers(),
        ),
    })

    expect(result.outcome).toBe('failed')
    expect(order?.invoiceStatus).toBe('failed')
    const alerts = logged.filter((entry) => entry.level === 'error')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.message).toMatch(/^RIASZTÁS: a számla kiállítása végleges hibával leállt/)
    expect(alerts[0]?.context).toMatchObject({ orderNumber: ORDER_NUMBER, agentErrorCode: '54' })
  })

  it('váratlan (nem Számlázz.hu-) hiba: RIASZTÁS a rendelésszámmal, és a hiba továbbmegy', async () => {
    const { payload } = createMockPayload(createOrder())
    const { logger, logged } = captureLogs()
    await expect(
      issueInvoiceForOrder({
        payload,
        orderId: 101,
        config: ENABLED_CONFIG,
        logger,
        issueDate: '2026-08-04',
        queryByKulsoAzon: silentLookup,
        postXml: async () => {
          throw new TypeError('TESZT: váratlan programhiba')
        },
      }),
    ).rejects.toThrow('váratlan programhiba')
    const alerts = logged.filter((entry) => entry.level === 'error')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.message).toMatch(/^RIASZTÁS: a számlakiállítás váratlan hibával állt le/)
    expect(alerts[0]?.context).toMatchObject({ orderNumber: ORDER_NUMBER })
  })
})

describe('issueInvoiceForOrder — a lekérdezés nem vesz át idegen bizonylatot (a-szamlazz-5, r-szamlazz-11)', () => {
  it('újrahasznosított rendelésszám: a régi kulcson ülő IDEGEN számlát az első kísérlet nem is keresi, saját számla áll ki', async () => {
    // A törölt (vagy mentésből visszaállított) rendelés ugyanezzel a
    // rendelésszámmal és ugyanakkora összeggel számlát kapott a PR #304-es
    // kóddal, amely a rendelésszámot küldte külső azonosítóként.
    const { payload, order } = createMockPayload(createOrder())
    const lookups: string[] = []
    let posts = 0
    const result = await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      issueDate: '2026-08-04',
      queryByKulsoAzon: async (kulsoAzon) => {
        lookups.push(kulsoAzon)
        return kulsoAzon === ORDER_NUMBER ? ownInvoice('IDEGEN-KIN-2026-1') : null
      },
      postXml: async () => {
        posts += 1
        return { szamlaszam: 'KIN-2026-SAJAT' }
      },
    })

    expect(result).toEqual({ outcome: 'issued', invoiceNumber: 'KIN-2026-SAJAT' })
    expect(order?.invoiceNumber).toBe('KIN-2026-SAJAT')
    expect(lookups).toEqual([INVOICE_KULSO_AZON])
    expect(posts).toBe(1)
  })

  it.each([
    ['eltérő bruttó végösszeg', { szamlaszam: 'IDEGEN-1', szamlabrutto: 5000 }],
    ['sztornó (negatív) végösszeg', { szamlaszam: 'IDEGEN-2', szamlabrutto: -ORDER_TOTAL_HUF }],
    ['hiányzó bruttó végösszeg', { szamlaszam: 'IDEGEN-3' }],
  ])(
    'a talált bizonylat nem egyeztethető (%s): failed + RIASZTÁS, átvétel és beküldés NÉLKÜL; egy később futó job sem küld be',
    async (_label, found: InvoiceLookupResult) => {
      const { payload, order } = createMockPayload(createOrder({ invoiceAttempts: 1 }))
      const { logger, logged } = captureLogs()
      let lookups = 0
      const run = () =>
        issueInvoiceForOrder({
          payload,
          orderId: 101,
          config: ENABLED_CONFIG,
          logger,
          issueDate: '2026-08-04',
          queryByKulsoAzon: async () => {
            lookups += 1
            return found
          },
          postXml: forbiddenPost,
        })

      const result = await run()
      expect(result.outcome).toBe('failed')
      expect(result.reason).toContain(found.szamlaszam)
      expect(order?.invoiceStatus).toBe('failed')
      expect(order?.invoiceNumber).toBeUndefined()
      const alerts = logged.filter((entry) => entry.level === 'error')
      expect(alerts).toHaveLength(1)
      expect(alerts[0]?.message).toMatch(
        /^RIASZTÁS: a bizonylat-lekérdezés olyan bizonylatot talált/,
      )
      expect(alerts[0]?.context).toMatchObject({
        orderNumber: ORDER_NUMBER,
        foundInvoiceNumber: found.szamlaszam,
      })

      await expect(run()).resolves.toMatchObject({ outcome: 'skipped' })
      expect(lookups).toBe(1)
    },
  )

  it('visszafelé kompatibilitás: korábbi beküldés után a RÉGI (rendelésszám) kulcson talált, egyeztetett számla átvéve', async () => {
    // A PR #304-es kód a rendelésszámot küldte külső azonosítóként; a válasz
    // elveszett, a számla ott létezik.
    const { payload, order } = createMockPayload(
      createOrder({ invoiceStatus: 'pending', invoiceAttempts: 1 }),
    )
    const lookups: string[] = []
    const dataQueries: string[] = []
    invoiceData.query.mockImplementation(async (szamlaszam) => {
      dataQueries.push(szamlaszam)
      return { szamlaszam, vatKeys: ['27'], sztornozott: false, vevoNev: '  teszt  ANNA ' }
    })
    const result = await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      issueDate: '2026-08-04',
      queryByKulsoAzon: async (kulsoAzon) => {
        lookups.push(kulsoAzon)
        return kulsoAzon === ORDER_NUMBER ? ownInvoice('KIN-2026-REGI') : null
      },
      postXml: forbiddenPost,
    })

    expect(result).toEqual({ outcome: 'issued', invoiceNumber: 'KIN-2026-REGI' })
    expect(lookups).toEqual([INVOICE_KULSO_AZON, ORDER_NUMBER])
    expect(dataQueries).toEqual(['KIN-2026-REGI'])
    expect(order?.invoiceNumber).toBe('KIN-2026-REGI')
  })

  it.each([
    ['már sztornózott', { sztornozott: true, vevoNev: 'Teszt Anna' }],
    ['más vevőé', { sztornozott: false, vevoNev: 'Idegen Béla' }],
    ['vevőnév nélküli', { sztornozott: false }],
  ])(
    'a régi kulcson talált, egyező összegű számla %s: NEM vesszük át, failed + RIASZTÁS, beküldés nélkül',
    async (_label, data: { sztornozott: boolean; vevoNev?: string }) => {
      const { payload, order } = createMockPayload(
        createOrder({ invoiceStatus: 'pending', invoiceAttempts: 1 }),
      )
      const { logger, logged } = captureLogs()
      invoiceData.query.mockImplementation(async (szamlaszam) => ({
        szamlaszam,
        vatKeys: ['27'],
        ...data,
      }))
      const result = await issueInvoiceForOrder({
        payload,
        orderId: 101,
        config: ENABLED_CONFIG,
        logger,
        issueDate: '2026-08-04',
        queryByKulsoAzon: async (kulsoAzon) =>
          kulsoAzon === ORDER_NUMBER ? ownInvoice('IDEGEN-REGI') : null,
        postXml: forbiddenPost,
      })

      expect(result.outcome).toBe('failed')
      expect(order?.invoiceNumber).toBeUndefined()
      expect(order?.invoiceStatus).toBe('failed')
      expect(logged.filter((entry) => entry.level === 'error')[0]?.message).toMatch(/^RIASZTÁS: /)
    },
  )
})

describe('issueInvoiceForOrder — visszatérítés a számla előtt (a-egyeztetes-13, a-szamlazz-12, K12)', () => {
  it('visszatérített rendelés, korábbi beküldéssel: a lekérdezés a státusz-kapu ELŐTT fut, a meglévő számlát átveszi és sztornózza', async () => {
    const { payload, order } = createMockPayload(
      createOrder({ status: 'refunded', invoiceStatus: 'pending', invoiceAttempts: 1 }),
    )
    const stornoFor: Array<string | null | undefined> = []
    const result = await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      issueDate: '2026-08-04',
      queryByKulsoAzon: async (kulsoAzon) =>
        kulsoAzon === INVOICE_KULSO_AZON ? ownInvoice('KIN-2026-ELVESZETT') : null,
      postXml: forbiddenPost,
      issueStorno: async (stornoOrder) => {
        stornoFor.push(stornoOrder.invoiceNumber)
        return { outcome: 'storned', stornoNumber: 'ST-1' }
      },
    })

    expect(result).toEqual({ outcome: 'issued', invoiceNumber: 'KIN-2026-ELVESZETT' })
    expect(order?.invoiceNumber).toBe('KIN-2026-ELVESZETT')
    expect(stornoFor).toEqual(['KIN-2026-ELVESZETT'])
  })

  it('visszatérített, még sosem beküldött rendelés: NEM állít ki számlát + stornót, lekérdezés nélkül failed + K12-RIASZTÁS', async () => {
    const { payload, order } = createMockPayload(createOrder({ status: 'refunded' }))
    const { logger, logged } = captureLogs()
    const result = await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      logger,
      queryByKulsoAzon: noLookup,
      postXml: forbiddenPost,
    })

    expect(result.outcome).toBe('failed')
    expect(order?.invoiceStatus).toBe('failed')
    expect(order?.invoiceLastError).toMatch(/^A számla automatikus kiállítása leállt: /)
    const alerts = logged.filter((entry) => entry.level === 'error')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.message).toMatch(
      /^RIASZTÁS: a rendelést a számla kiállítása előtt visszatérítették/,
    )
    expect(alerts[0]?.context).toMatchObject({ orderNumber: ORDER_NUMBER })
  })

  it('visszatérített rendelés, korábbi beküldés, de a lekérdezés nem talál számlát: failed + K12-RIASZTÁS, beküldés nélkül', async () => {
    const { payload, order } = createMockPayload(
      createOrder({ status: 'refunded', invoiceStatus: 'pending', invoiceAttempts: 2 }),
    )
    const { logger, logged } = captureLogs()
    const lookups: string[] = []
    const result = await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      logger,
      queryByKulsoAzon: async (kulsoAzon) => {
        lookups.push(kulsoAzon)
        return null
      },
      postXml: forbiddenPost,
    })

    expect(result.outcome).toBe('failed')
    expect(lookups).toEqual([INVOICE_KULSO_AZON, ORDER_NUMBER])
    expect(order?.invoiceStatus).toBe('failed')
    expect(logged.filter((entry) => entry.level === 'error')[0]?.message).toMatch(
      /^RIASZTÁS: a rendelést a számla kiállítása előtt visszatérítették/,
    )
  })

  it('részleges visszatérítés a számla ELŐTT: a számla kiáll, és RIASZTÁS kéri a helyesbítőt', async () => {
    const { payload } = createMockPayload(
      createOrder({
        refunds: [
          {
            transactionId: 'TESZT-REFUND-1',
            amountHuf: 5000,
            status: 'Succeeded',
            type: 'partial',
            refundedAt: '2026-08-03T10:00:00.000Z',
          },
        ],
      } as Partial<Order>),
    )
    const { logger, logged } = captureLogs()
    const result = await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      logger,
      issueDate: '2026-08-04',
      queryByKulsoAzon: silentLookup,
      postXml: async () => ({ szamlaszam: 'KIN-2026-TELJES' }),
    })

    expect(result).toEqual({ outcome: 'issued', invoiceNumber: 'KIN-2026-TELJES' })
    const alerts = logged.filter((entry) => entry.level === 'error')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.message).toMatch(
      /^RIASZTÁS: a számla kiállt, de a rendelésen a számla ELŐTT részleges visszatérítés történt/,
    )
  })
})

describe('issueInvoiceForOrder — a 7-es kód csak VÉGLEGES válasznál jelent „nincs számlát" (Codex, PR #304)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([503, 429])(
    '%i + 7-es kód a lekérdezésben: újrapróbálható hiba, a számla pending marad, beküldés NINCS',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(NOT_FOUND_BODY, { status })),
      )
      const { payload, order } = createMockPayload(
        createOrder({ invoiceStatus: 'pending', invoiceAttempts: 1 }),
      )
      await expect(
        issueInvoiceForOrder({
          payload,
          orderId: 101,
          config: ENABLED_CONFIG,
          issueDate: '2026-08-04',
          resolvePaidMoment: paidHoursAgo(1),
          queryByKulsoAzon: queryInvoiceByKulsoAzon,
          postXml: forbiddenPost,
        }),
      ).rejects.toMatchObject({ retryable: true })
      expect(order?.invoiceStatus).toBe('pending')
      expect(order?.invoiceAttempts).toBe(1)
    },
  )

  it('200 + 7-es kód: végleges „nincs ilyen bizonylat", a beküldés mehet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(NOT_FOUND_BODY, { status: 200 })),
    )
    const { payload } = createMockPayload(createOrder())
    let posts = 0
    const result = await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      issueDate: '2026-08-04',
      queryByKulsoAzon: queryInvoiceByKulsoAzon,
      postXml: async () => {
        posts += 1
        return { szamlaszam: 'KIN-2026-200' }
      },
    })
    expect(result).toEqual({ outcome: 'issued', invoiceNumber: 'KIN-2026-200' })
    expect(posts).toBe(1)
  })
})

describe('issueInvoiceForOrder — a lekérdezések gyakorisági féke (a-szamlazz-15)', () => {
  useFrozenClock()

  beforeEach(() => {
    resetAlertThrottle()
  })

  it('a hibasorozat 3. sikertelen lekérdezése után óránként legfeljebb egy lekérdezés megy ki; a közbeeső futás hálózat nélkül zár', async () => {
    const { payload, order } = createMockPayload(createOrder())
    let lookups = 0
    let healthy = false
    const run = () =>
      issueInvoiceForOrder({
        payload,
        orderId: 101,
        config: ENABLED_CONFIG,
        issueDate: '2026-10-01',
        resolvePaidMoment: paidHoursAgo(1),
        queryByKulsoAzon: async () => {
          lookups += 1
          if (!healthy) {
            throw lookupTimeout()
          }
          return null
        },
        postXml: async () => ({ szamlaszam: 'KIN-2026-FEK' }),
      })

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await expect(run()).rejects.toMatchObject({ retryable: true })
      advanceClock(10 * 60 * 1000)
    }
    expect(lookups).toBe(3)
    expect(order?.invoiceStatus).toBe('pending')

    // 10 perccel a 3. hiba után: nincs lekérdezés, nincs állapotírás.
    const lastErrorBefore = order?.invoiceLastError
    await expect(run()).resolves.toMatchObject({ outcome: 'skipped' })
    expect(lookups).toBe(3)
    expect(order?.invoiceLastError).toBe(lastErrorBefore)

    // Egy órával a 3. hiba után ismét lekérdez, és a helyreállt szolgáltatásnál kiállít.
    // 59 perccel a 3. hiba után még szünetel, egy perccel később már nem.
    advanceClock(49 * 60 * 1000)
    await expect(run()).resolves.toMatchObject({ outcome: 'skipped' })
    expect(lookups).toBe(3)
    advanceClock(60 * 1000)
    healthy = true
    await expect(run()).resolves.toEqual({ outcome: 'issued', invoiceNumber: 'KIN-2026-FEK' })
    expect(lookups).toBe(4)
  })

  it('a 24. egymást követő sikertelen lekérdezés után a számla automatikus kiállítása leáll: failed + RIASZTÁS, a H4-időkorláttól függetlenül', async () => {
    // A fizetés óta csak 5 óra telt el, tehát a H4-időkorlát (24 óra) még nem
    // állítaná le; a sorozat viszont már 23 sikertelen lekérdezésnél tart.
    const startedAt = new Date(Date.now() - 4 * HOUR_MS).toISOString()
    const lastAt = new Date(Date.now() - 2 * HOUR_MS).toISOString()
    const { payload, order } = createMockPayload(
      createOrder({
        invoiceStatus: 'pending',
        invoiceLastError: `[lekérdezési hiba ${startedAt} óta, 23 sikertelen lekérdezés, utolsó: ${lastAt}] ${LOOKUP_TIMEOUT_MESSAGE}`,
      }),
    )
    const { logger, logged } = captureLogs()
    const result = await issueInvoiceForOrder({
      payload,
      orderId: 101,
      config: ENABLED_CONFIG,
      logger,
      resolvePaidMoment: paidHoursAgo(5),
      queryByKulsoAzon: async () => {
        throw lookupTimeout()
      },
      postXml: forbiddenPost,
    })

    expect(result.outcome).toBe('failed')
    expect(order?.invoiceStatus).toBe('failed')
    expect(order?.invoiceLastError).toMatch(
      /^A számla automatikus kiállítása leállt: .*24 alkalommal/,
    )
    const alerts = logged.filter((entry) => entry.level === 'error')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.message).toMatch(
      /^RIASZTÁS: a számla előtti bizonylat-lekérdezés 24 alkalommal/,
    )
  })
})

/**
 * rev1 (breaker): a zár-tranzakció a védett szakasz alatt tétlen, és a
 * Postgres 60 s után leöli (idle_in_transaction_session_timeout). Ha ez egy
 * beküldés közben történik, egy második futó a zár nélkül dupla számlát
 * küldhet be. A beküldés ezért csak akkor indul, ha a teljes timeoutja a zár
 * 45 s-os közös időkeretébe fér (lock-budget.ts).
 */
describe('issueInvoiceForOrder — a zár alatti hívások közös időkerete', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('35 s-os adatbázis-akadás után a lekérdezés a maradék keretet kapja, a beküldés NEM indul, a hiba újrapróbálható', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-24T10:00:00Z'))
    const { payload, order } = createMockPayload(createOrder({ invoiceStatus: 'pending' }))
    const lookupTimeouts: number[] = []
    let posts = 0
    await expect(
      issueInvoiceForOrder({
        payload,
        orderId: 101,
        config: ENABLED_CONFIG,
        issueDate: '2026-09-24',
        // A fizetés napjának olvasása a záron belül 35 s-ig áll (halott
        // pool-kapcsolat, CLAUDE.md 7. tanulság).
        resolvePaidMoment: async () => {
          vi.setSystemTime(Date.now() + 35_000)
          return null
        },
        queryByKulsoAzon: async (_kulsoAzon, config) => {
          lookupTimeouts.push(config.timeoutMs)
          vi.setSystemTime(Date.now() + 1_000)
          return null
        },
        postXml: async () => {
          posts += 1
          return { szamlaszam: 'KIN-2026-KESO' }
        },
      }),
    ).rejects.toMatchObject({ retryable: true, kind: 'timeout' })

    expect(lookupTimeouts).toEqual([10_000])
    expect(posts).toBe(0)
    expect(order?.invoiceAttempts ?? 0).toBe(0)
    expect(order?.invoiceStatus).toBe('pending')
    expect(order?.invoiceLastError).toContain('időkeret')
  })
})
