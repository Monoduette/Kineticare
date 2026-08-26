import { describe, expect, it } from 'vitest'

import { budapestDateString, budapestMonthKey, isIsoDateString } from '../lib/date/budapest'
import { buildInvoiceXml } from '../lib/szamlazz/invoice'
import {
  budapestDateString as budapestDateStringXml,
  isIsoDateString as isIsoDateStringXml,
} from '../lib/szamlazz/xml'

/**
 * A közös Budapest-dátum modul őrei (F4, 2026-08-21-i vizsgálat).
 * Ugyanez a modul szolgálja ki a SZÁMLÁZÁST (a Számla Agent `keltDatum` és
 * `teljesitesDatum` mezője a `src/lib/szamlazz/xml.ts` re-exportján át) és a
 * bevétel-statisztikát. Az ÉRVÉNYES dátumok viselkedése ezért egy hajszálnyit
 * sem mozdulhat: az alábbi első két blokk pontosan ezt mondja ki, számokkal.
 */

describe('budapestDateString — az ÉRVÉNYES dátumok viselkedése változatlan', () => {
  it('00:30 CEST (nyári időszámítás): a magyar napot adja, nem az UTC-s előzőt', () => {
    // 2026-09-01T00:30 magyar idő = 2026-08-31T22:30Z
    const hajnal = new Date('2026-08-31T22:30:00Z')
    expect(budapestDateString(hajnal)).toBe('2026-09-01')
    // A hibás (UTC-s) képzés bizonyítéka — ez az ELŐZŐ hónapot adná.
    expect(hajnal.toISOString().slice(0, 10)).toBe('2026-08-31')
  })

  it('00:30 CET (téli időszámítás) is a magyar napot adja', () => {
    expect(budapestDateString(new Date('2026-01-31T23:30:00Z'))).toBe('2026-02-01')
  })

  it('nappal a magyar és az UTC-nap egybeesik', () => {
    expect(budapestDateString(new Date('2026-08-10T09:00:00Z'))).toBe('2026-08-10')
  })

  it('a zóna-váltás pillanatai (CET→CEST és CEST→CET) is a magyar napot adják', () => {
    // 2026-03-29 02:00 CET → 03:00 CEST (tavaszi óraátállítás)
    expect(budapestDateString(new Date('2026-03-29T00:59:00Z'))).toBe('2026-03-29')
    expect(budapestDateString(new Date('2026-03-29T01:01:00Z'))).toBe('2026-03-29')
    // 2026-10-25 03:00 CEST → 02:00 CET (őszi óraátállítás)
    expect(budapestDateString(new Date('2026-10-25T00:59:00Z'))).toBe('2026-10-25')
    expect(budapestDateString(new Date('2026-10-25T01:01:00Z'))).toBe('2026-10-25')
  })

  it('a szamlazz/xml re-exportja UGYANAZ a függvény (a számlakelt nem ágazik el)', () => {
    expect(budapestDateStringXml).toBe(budapestDateString)
    expect(isIsoDateStringXml).toBe(isIsoDateString)
  })
})

describe('isIsoDateString — érvényes dátum: változatlanul átmegy', () => {
  it('a Számla Agent felé menő alakok átmennek', () => {
    for (const jo of [
      '2026-08-04',
      '2026-01-01',
      '2026-12-31',
      '2026-01-31',
      '2026-02-28',
      '2026-04-30',
      '2026-06-30',
      '2026-09-30',
      '2026-11-30',
    ]) {
      expect(isIsoDateString(jo), jo).toBe(true)
    }
  })

  it('a budapestDateString kimenete mindig átmegy a kapun (hónapfordulón is)', () => {
    expect(isIsoDateString(budapestDateString(new Date('2026-08-31T22:30:00Z')))).toBe(true)
    expect(isIsoDateString(budapestDateString(new Date('2026-01-31T23:30:00Z')))).toBe(true)
    expect(isIsoDateString(budapestDateString(new Date('2026-12-31T23:00:00Z')))).toBe(true)
  })

  it('szökőév: a VALÓDI szökőnap átmegy, a nem létező nem', () => {
    // FIGYELEM: 2026 NEM szökőév (2026 % 4 = 2), ezért a 2026-02-29 nem
    // létező nap. A 4/100/400 szabály mindhárom ága mérve:
    expect(isIsoDateString('2024-02-29')).toBe(true) // 4-gyel osztható
    expect(isIsoDateString('2000-02-29')).toBe(true) // 400-zal osztható
    expect(isIsoDateString('2028-02-29')).toBe(true)
    expect(isIsoDateString('2025-02-29')).toBe(false)
    expect(isIsoDateString('2026-02-29')).toBe(false)
    expect(isIsoDateString('2100-02-29')).toBe(false) // 100-zal osztható, 400-zal nem
  })
})

describe('isIsoDateString — érvénytelen dátum: elbukik', () => {
  it('rossz ALAK (a korábbi viselkedés változatlan)', () => {
    for (const rossz of [
      '',
      '   ',
      '2026-8-4',
      '2026/08/04',
      '2026.08.04',
      '31/01/2026',
      '20260804',
      '2026-08-04T10:00:00Z',
      ' 2026-08-04',
      '2026-08-04 ',
      '2026-08-04</x>',
      '2026-08-04&amp;',
    ]) {
      expect(isIsoDateString(rossz), rossz).toBe(false)
    }
  })

  it('NAPTÁRILAG lehetetlen dátum (F4: korábban mind átment)', () => {
    for (const rossz of [
      '2026-13-45',
      '2026-13-01',
      '2026-00-10',
      '2026-01-00',
      '2026-01-32',
      '2026-02-30',
      '2026-04-31',
      '2026-06-31',
      '2026-09-31',
      '2026-11-31',
      '2026-99-99',
    ]) {
      expect(isIsoDateString(rossz), rossz).toBe(false)
    }
  })
})

describe('budapestMonthKey — a JSDoc szerződése: érvénytelen dátumra null, nem RangeError', () => {
  it('érvényes pillanatra a magyar hónap-kulcsot adja', () => {
    expect(budapestMonthKey(new Date('2026-08-10T09:00:00Z'))).toBe('2026-08')
  })

  it('hónapforduló hajnalán a KÖVETKEZŐ hónapot adja (Budapest 00:30)', () => {
    expect(budapestMonthKey(new Date('2026-08-31T22:30:00Z'))).toBe('2026-09')
    expect(budapestMonthKey(new Date('2026-01-31T23:30:00Z'))).toBe('2026-02')
    // Év- és hónapforduló egyszerre.
    expect(budapestMonthKey(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01')
  })

  it('Invalid Date esetén null — NEM dob (a nézet nem 500-azhat egy rossz dátumtól)', () => {
    const invalid = new Date('nem-datum')
    expect(Number.isNaN(invalid.getTime())).toBe(true)
    expect(() => budapestMonthKey(invalid)).not.toThrow()
    expect(budapestMonthKey(invalid)).toBeNull()
    expect(budapestMonthKey(new Date(Number.NaN))).toBeNull()
  })
})

/**
 * A SZIGORÍTÁS mérése a számlázási felületen. A naptári ellenőrzés ugyanazt a
 * kaput szigorítja, amelyen a Számla Agent `keltDatum` / `teljesitesDatum`
 * mezője átmegy (`isoDateForXml`, src/lib/szamlazz/invoice.ts) — ezért itt
 * kimondjuk mindkét irányt: az érvényes dátum VÁLTOZATLANUL kimegy, a
 * naptárilag lehetetlen viszont már a kapun elbukik, magyar hibaüzenettel.
 * A kulcs kifejezetten jelölt DUMMY érték, nem titok.
 */
describe('a Számla Agent dátum-kapuja: érvényes változatlan, naptárilag lehetetlen elbukik', () => {
  const DUMMY_AGENT_KEY = 'DUMMY-AGENT-KULCS-NEM-VALODI-TITOK'
  const BASE = {
    agentKey: DUMMY_AGENT_KEY,
    orderNumber: 'KH-2026-000123',
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

  it('érvényes dátumok VÁLTOZATLANUL kerülnek a kimenetre', () => {
    const xml = buildInvoiceXml({ ...BASE, teljesitesDatum: '2026-07-15' })
    expect(xml).toContain('<keltDatum>2026-08-04</keltDatum>')
    expect(xml).toContain('<teljesitesDatum>2026-07-15</teljesitesDatum>')
    // Valódi szökőnap: átmegy.
    const szokoXml = buildInvoiceXml({ ...BASE, teljesitesDatum: '2024-02-29' })
    expect(szokoXml).toContain('<teljesitesDatum>2024-02-29</teljesitesDatum>')
  })

  it('naptárilag lehetetlen nap NEM megy ki a Számla Agent felé (szigorítás)', () => {
    for (const rossz of ['2026-13-45', '2026-02-30', '2026-02-29']) {
      expect(() => buildInvoiceXml({ ...BASE, teljesitesDatum: rossz }), rossz).toThrow(
        /nem valódi dátum/,
      )
      expect(() => buildInvoiceXml({ ...BASE, issueDate: rossz }), rossz).toThrow(
        /nem valódi dátum/,
      )
    }
  })
})
