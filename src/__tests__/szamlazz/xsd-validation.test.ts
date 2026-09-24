import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { buildCorrectiveInvoiceXml } from '../../lib/szamlazz/corrective'
import { buildInvoiceXml, type BuildInvoiceXmlInput } from '../../lib/szamlazz/invoice'
import { buildInvoiceLookupXml } from '../../lib/szamlazz/pdf'
import { buildStornoXml } from '../../lib/szamlazz/storno'
import { compileSchema, validateXml, type CompiledSchema } from './xsd-subset-validator'

/**
 * XSD-ŐR: minden kimenő Számla Agent kérés az élő XSD szerint érvényes.
 *
 * MIÉRT: a Számlázz.hu a beérkező XML-t az adott művelet XSD-je szerint
 * dolgozza fel, és az XSD-validáláson elbukó kérést 57-es „XML beolvasási
 * hibával" utasítja el (docs.szamlazz.hu/hu/agent/basics/error-handling). A
 * korábbi <arfolyam></arfolyam> (üres xs:double) így MINDEN számlát és
 * helyesbítőt elbuktatott volna — egyetlen teszt sem nézte a sémát.
 *
 * A sémák a https://www.szamlazz.hu/szamla/docs/xsds/ alatti élő fájlok
 * bájtra azonos másolatai (letöltve 2026-09-24, sha256 a docs/
 * szamlazz-megfeleles.md A3-sorában). Ha a Számlázz.hu módosítja őket, a
 * másolatot frissíteni kell — egy új, támogatatlan séma-szerkezetre a
 * validátor hangosan dob.
 *
 * Kettős ellenőrzés: a függőség nélküli részhalmaz-validátor MINDIG fut (CI-n
 * is); ahol az `xmllint` elérhető, a teljes libxml2-es sémavalidáció is lefut
 * ugyanazokon a mintákon, és a két ítéletnek egyeznie kell.
 *
 * DUMMY érték, egyértelműen jelölve — NEM valódi Számla Agent kulcs.
 */
const DUMMY_AGENT_KEY = 'DUMMY-AGENT-KULCS-NEM-VALODI-TITOK'

const XSD_DIR = fileURLToPath(new URL('./xsd/', import.meta.url))
const XSD = {
  szamla: `${XSD_DIR}xmlszamla.xsd`,
  storno: `${XSD_DIR}xmlszamlast.xsd`,
  lekerdezes: `${XSD_DIR}xmlszamlapdf.xsd`,
  valasz: `${XSD_DIR}xmlszamlavalasz.xsd`,
} as const

const schemas: Record<keyof typeof XSD, CompiledSchema> = {
  szamla: compileSchema(readFileSync(XSD.szamla, 'utf8')),
  storno: compileSchema(readFileSync(XSD.storno, 'utf8')),
  lekerdezes: compileSchema(readFileSync(XSD.lekerdezes, 'utf8')),
  valasz: compileSchema(readFileSync(XSD.valasz, 'utf8')),
}

const XMLLINT_AVAILABLE = spawnSync('xmllint', ['--version']).status === 0

/** libxml2-es sémavalidáció (csak ahol az xmllint elérhető). */
function xmllintValid(xml: string, xsdPath: string): { valid: boolean; output: string } {
  const result = spawnSync('xmllint', ['--noout', '--schema', xsdPath, '-'], {
    input: xml,
    encoding: 'utf8',
  })
  return { valid: result.status === 0, output: `${result.stdout}${result.stderr}` }
}

const BUYER_MAGANSZEMELY = {
  nev: 'Teszt Anna',
  irsz: '1111',
  telepules: 'Budapest',
  cim: 'Példa utca 1. & fsz. <2>',
  email: 'anna@example.test',
}

const BASE: BuildInvoiceXmlInput = {
  agentKey: DUMMY_AGENT_KEY,
  orderNumber: 'KH-2026-000123',
  invoicePrefix: 'KIN',
  issueDate: '2026-10-01',
  teljesitesDatum: '2026-09-30',
  buyer: BUYER_MAGANSZEMELY,
  items: [{ megnevezes: 'Kézrehabilitáció otthon', mennyiseg: 1, bruttoEgysegar: 19990 }],
  vatMode: '27',
}

/** Minden kimenő kérés-típus, a fő változataival. */
const SAMPLES: Array<{ name: string; xsd: keyof typeof XSD; xml: string }> = [
  { name: 'számla — magánszemély, 27%, 1 db', xsd: 'szamla', xml: buildInvoiceXml(BASE) },
  {
    name: 'számla — adószámos vevő, több tétel, 3 db',
    xsd: 'szamla',
    xml: buildInvoiceXml({
      ...BASE,
      buyer: { ...BUYER_MAGANSZEMELY, adoszam: '12345676-1-42' },
      items: [
        { megnevezes: 'Szakembereknek', mennyiseg: 3, bruttoEgysegar: 24990 },
        { megnevezes: 'Otthoni kurzus', mennyiseg: 1, bruttoEgysegar: 9990 },
      ],
    }),
  },
  {
    name: 'számla — AAM, e-mail nélkül',
    xsd: 'szamla',
    xml: buildInvoiceXml({ ...BASE, vatMode: 'AAM', buyer: { ...BUYER_MAGANSZEMELY, email: '' } }),
  },
  {
    name: 'helyesbítő — részleges visszatérítés',
    xsd: 'szamla',
    xml: buildCorrectiveInvoiceXml({
      agentKey: DUMMY_AGENT_KEY,
      originalInvoiceNumber: 'KIN-2026-7',
      orderNumber: 'KH-2026-000123',
      invoicePrefix: 'KIN',
      refundSeq: 2,
      amountHuf: 5000,
      issueDate: '2026-10-05',
      teljesitesDatum: '2026-09-30',
      vatMode: '27',
      buyer: BUYER_MAGANSZEMELY,
      reason: 'Részleges visszatérítés <kérésre>',
    }),
  },
  {
    name: 'stornó — indokkal és e-maillel',
    xsd: 'storno',
    xml: buildStornoXml({
      agentKey: DUMMY_AGENT_KEY,
      originalInvoiceNumber: 'KIN-2026-7',
      orderNumber: 'KH-2026-000123',
      reason: 'Teljes visszatérítés',
      buyerEmail: 'anna@example.test',
    }),
  },
  {
    name: 'stornó — indok és e-mail nélkül',
    xsd: 'storno',
    xml: buildStornoXml({
      agentKey: DUMMY_AGENT_KEY,
      originalInvoiceNumber: 'KIN-2026-7',
      orderNumber: 'KH-2026-000123',
    }),
  },
  {
    name: 'bizonylat-lekérdezés',
    xsd: 'lekerdezes',
    xml: buildInvoiceLookupXml({ agentKey: DUMMY_AGENT_KEY, kulsoAzon: 'KH-2026-000123' }),
  },
]

describe('XSD-őr — minden kimenő Számla Agent kérés érvényes az élő séma szerint', () => {
  for (const sample of SAMPLES) {
    it(`${sample.name}: a részhalmaz-validátor szerint érvényes`, () => {
      expect(validateXml(sample.xml, schemas[sample.xsd])).toEqual([])
    })

    it.skipIf(!XMLLINT_AVAILABLE)(`${sample.name}: az xmllint szerint is érvényes`, () => {
      const result = xmllintValid(sample.xml, XSD[sample.xsd])
      expect(result.valid, result.output).toBe(true)
    })
  }
})

/**
 * A validátor NEM üres ígéret: a régi (hibás) kimenetet és a tipikus
 * sémasértéseket el KELL utasítania. Ahol az xmllint elérhető, a két ítélet
 * egyezését is ellenőrizzük.
 */
describe('XSD-őr — a validátor a valódi sémasértéseket megfogja', () => {
  const valid = buildInvoiceXml(BASE)
  const NEGATIVE: Array<{ name: string; xml: string; expected: RegExp }> = [
    {
      name: 'üres <arfolyam> (xs:double) — a javított hiba',
      xml: valid.replace(
        '<rendelesSzam>',
        '<arfolyamBank></arfolyamBank>\n    <arfolyam></arfolyam>\n    <rendelesSzam>',
      ),
      expected: /arfolyam: '' nem érvényes xs:double/,
    },
    {
      name: 'üres <fizetve> (xs:boolean)',
      xml: valid.replace('<fizetve>true</fizetve>', '<fizetve></fizetve>'),
      expected: /fizetve: '' nem érvényes xs:boolean/,
    },
    {
      name: 'nem szám <adoalany> (xs:int)',
      xml: valid.replace('<adoalany>-1</adoalany>', '<adoalany>nincs</adoalany>'),
      expected: /adoalany: 'nincs' nem érvényes xs:int/,
    },
    {
      name: 'rossz helyen álló elem (adoalany az adoszam után)',
      xml: valid.replace(/(<adoalany>-1<\/adoalany>)(\s*)(<adoszam><\/adoszam>)/, '$3$2$1'),
      expected: /nem várt \(vagy rossz helyen álló\) elem <adoalany>/,
    },
    {
      name: 'hiányzó kötelező elem (teljesitesDatum)',
      xml: valid.replace(/\s*<teljesitesDatum>[^<]*<\/teljesitesDatum>/, ''),
      expected: /hiányzó kötelező elem <teljesitesDatum>/,
    },
    {
      name: 'nem létező dátum',
      xml: valid.replace('<keltDatum>2026-10-01</keltDatum>', '<keltDatum>2026-02-30</keltDatum>'),
      expected: /keltDatum: '2026-02-30' nem létező dátum/,
    },
    {
      name: 'ismeretlen számlanyelv (felsorolás)',
      xml: valid.replace('<szamlaNyelve>hu</szamlaNyelve>', '<szamlaNyelve>xx</szamlaNyelve>'),
      expected: /szamlaNyelve: 'xx' nincs a felsorolásban/,
    },
    {
      name: 'ismeretlen elem',
      xml: valid.replace(
        '<fizetve>true</fizetve>',
        '<fizetve>true</fizetve>\n    <kifizetesek></kifizetesek>',
      ),
      expected: /nem várt \(vagy rossz helyen álló\) elem <kifizetesek>/,
    },
    {
      name: 'nem deklarált attribútum (a tudástár cvc-complex-type.3.2.2 esete)',
      xml: valid.replace('<xmlszamla xmlns=', '<xmlszamla xsi="x" xmlns='),
      expected: /nem megengedett attribútum 'xsi'/,
    },
  ]

  for (const sample of NEGATIVE) {
    it(`${sample.name}: a részhalmaz-validátor elutasítja`, () => {
      const errors = validateXml(sample.xml, schemas.szamla)
      expect(errors.join('\n')).toMatch(sample.expected)
    })

    it.skipIf(!XMLLINT_AVAILABLE)(`${sample.name}: az xmllint is elutasítja`, () => {
      expect(xmllintValid(sample.xml, XSD.szamla).valid).toBe(false)
    })
  }

  it('a régi, <arfolyam></arfolyam>-t küldő alak ELBUKIK — ez okozta volna az 57-es hibát', () => {
    const legacy = valid
      .replace(
        '<rendelesSzam>',
        '<arfolyamBank></arfolyamBank>\n    <arfolyam></arfolyam>\n    <rendelesSzam>',
      )
      .replace(/\s*<fizetve>true<\/fizetve>/, '')
      .replace(/\s*<adoalany>-1<\/adoalany>/, '')
    expect(validateXml(legacy, schemas.szamla)).toEqual([
      "/xmlszamla/fejlec/arfolyam: '' nem érvényes xs:double",
    ])
  })
})

/**
 * A válasz-tesztek fixtúrái (CDATA, 56-os jelzés) a válasz-XSD szerint is
 * valósághűek — a parser tesztjei így nem kitalált alakra épülnek.
 */
describe('XSD-őr — a válasz-fixtúrák az xmlszamlavalasz séma szerint érvényesek', () => {
  const RESPONSES = [
    '<?xml version="1.0" encoding="UTF-8"?><xmlszamlavalasz xmlns="http://www.szamlazz.hu/xmlszamlavalasz">' +
      '<sikeres>true</sikeres><szamlaszam>KIN-2026-7</szamlaszam><szamlanetto>15740</szamlanetto>' +
      '<szamlabrutto>19990</szamlabrutto><kintlevoseg>0</kintlevoseg>' +
      '<vevoifiokurl><![CDATA[https://www.szamlazz.hu/szamla/?page=vevoifiokpay&partguid=abc]]></vevoifiokurl>' +
      '</xmlszamlavalasz>',
    '<?xml version="1.0" encoding="UTF-8"?><xmlszamlavalasz xmlns="http://www.szamlazz.hu/xmlszamlavalasz">' +
      '<sikeres>false</sikeres><hibakod>56</hibakod>' +
      '<hibauzenet><![CDATA[A számlaértesítő kézbesítése sikertelen.]]></hibauzenet>' +
      '<szamlaszam>KIN-2026-8</szamlaszam></xmlszamlavalasz>',
  ]
  for (const [index, xml] of RESPONSES.entries()) {
    it(`válasz-fixtúra #${index + 1} érvényes`, () => {
      expect(validateXml(xml, schemas.valasz)).toEqual([])
    })
    it.skipIf(!XMLLINT_AVAILABLE)(
      `válasz-fixtúra #${index + 1} az xmllint szerint is érvényes`,
      () => {
        const result = xmllintValid(xml, XSD.valasz)
        expect(result.valid, result.output).toBe(true)
      },
    )
  }
})
