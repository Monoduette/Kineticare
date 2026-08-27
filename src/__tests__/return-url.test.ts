import { describe, expect, it } from 'vitest'

import { sanitizeReturnPath } from '../lib/preview/exit-preview'
import {
  DEFAULT_AUTH_RETURN_URL,
  hasControlCharacter,
  sanitizeReturnUrl,
  signInHref,
} from '../lib/return-url'

/**
 * Visszatérési útvonal (returnUrl) — open-redirect védelem.
 *
 * A belépés és a regisztráció a query-ből kapja a returnUrl-t, és a sikeres
 * művelet után oda ugrik (`window.location.href`). A korábbi, hívási helyenként
 * megírt `startsWith('/')` ellenőrzés átengedte a `//evil.example` és a
 * `/\evil.example` alakot: ezeket a böngésző PROTOKOLL-RELATÍV, tehát idegen
 * eredetű címként értelmezi — a belépés utáni ugrás adathalász oldalra vitt
 * volna. Ez a fájl azt őrzi, hogy a közös szűrő ezt (és a séma-, illetve
 * vezérlőkarakteres változatokat) kizárja.
 *
 * A vezérlőkarakterek a tesztben ESCAPE-KÉNT szerepelnek (`\u0000`, `\u007f`),
 * hogy a forrás sose tartalmazzon nyers vezérlőbájtot.
 */

/** Kitalált (nem létező) hosztok — a `.test` TLD kifejezetten erre való. */
const ORIGIN = 'https://kineticare.test'
const HOSTILE_HOST = 'evil.example.test'

const FALLBACK = '/kurzusaim'

describe('sanitizeReturnUrl — engedélyezett értékek', () => {
  it.each([
    ['gyökér', '/'],
    ['egyszerű útvonal', '/kurzusaim'],
    ['többszegmensű útvonal', '/kurzusaim/12'],
    ['query-paraméterrel', '/penztar?termek=12'],
    ['horgonnyal', '/blog/elso-cikk#tetejere'],
    ['query és horgony együtt', '/fizetes/koszonom?order=KIN-1#osszegzes'],
  ])('%s átmegy', (_label, value) => {
    expect(sanitizeReturnUrl(value, FALLBACK)).toBe(value)
  })

  it('a körülvevő whitespace-t levágja', () => {
    expect(sanitizeReturnUrl('  /kurzusaim  ', FALLBACK)).toBe('/kurzusaim')
    expect(sanitizeReturnUrl(' /fiok', FALLBACK)).toBe('/fiok')
  })

  it('a szóközzel megtört perjelpár nem idegen eredet, ezért átmehet', () => {
    // A `/ /host` alakot a böngésző saját eredetű ÚTVONALKÉNT oldja fel,
    // ellentétben a `//host`-tal — ezt nem kell kizárni.
    expect(sanitizeReturnUrl(`/ /${HOSTILE_HOST}`, FALLBACK)).toBe(`/ /${HOSTILE_HOST}`)
    expect(new URL(`/ /${HOSTILE_HOST}`, ORIGIN).origin).toBe(ORIGIN)
  })
})

describe('sanitizeReturnUrl — protokoll-relatív (a lezárt rés)', () => {
  it.each([
    ['dupla perjel', `//${HOSTILE_HOST}`],
    ['dupla perjel útvonallal', `//${HOSTILE_HOST}/belepes`],
    ['dupla perjel felhasználó-résszel', `//user@${HOSTILE_HOST}`],
    ['perjel + visszaperjel', `/\\${HOSTILE_HOST}`],
    ['perjel + visszaperjel útvonallal', `/\\${HOSTILE_HOST}/belepes`],
    ['csupa perjel', '///'],
    ['dupla visszaperjel', `\\\\${HOSTILE_HOST}`],
    ['whitespace után dupla perjel', `   //${HOSTILE_HOST}`],
  ])('%s → fallback', (_label, value) => {
    expect(sanitizeReturnUrl(value, FALLBACK)).toBe(FALLBACK)
  })
})

describe('sanitizeReturnUrl — abszolút URL és séma', () => {
  it.each([
    ['http', `http://${HOSTILE_HOST}/atveres`],
    ['https', `https://${HOSTILE_HOST}/atveres`],
    ['nagybetűs séma', `HTTPS://${HOSTILE_HOST}`],
    ['javascript', 'javascript:alert(1)'],
    ['javascript vegyes kis-nagybetűvel', 'JaVaScRiPt:alert(1)'],
    ['data', 'data:text/html,<script></script>'],
    ['mailto', 'mailto:valaki@example.test'],
    ['séma nélküli relatív útvonal', 'kurzusaim'],
    ['szülőkönyvtár-ugrás', '../kurzusaim'],
    ['aktuális könyvtár', './kurzusaim'],
    ['csak horgony', '#tetejere'],
    ['csak query', '?termek=12'],
  ])('%s → fallback', (_label, value) => {
    expect(sanitizeReturnUrl(value, FALLBACK)).toBe(FALLBACK)
  })
})

describe('sanitizeReturnUrl — vezérlőkarakterek', () => {
  it.each([
    ['soremelés (fejléc-injekció)', `/kurzusaim\nLocation: https://${HOSTILE_HOST}`],
    ['kocsivissza', '/kurzusaim\r\nSet-Cookie: a=b'],
    ['tabulátor', '/kurzusaim\tvalami'],
    ['nullbájt', '/kurzusaim\u0000'],
    ['DEL karakter', '/kurzusaim\u007f'],
    ['vezérlőkarakterrel megtört perjelpár', `/\n/${HOSTILE_HOST}`],
  ])('%s → fallback', (_label, value) => {
    expect(sanitizeReturnUrl(value, FALLBACK)).toBe(FALLBACK)
  })
})

describe('sanitizeReturnUrl — üres és nem szöveg értékek', () => {
  it.each([
    ['üres szöveg', ''],
    ['csak szóköz', '   '],
    ['csak sortörés', '\n\n'],
  ])('%s → fallback', (_label, value) => {
    expect(sanitizeReturnUrl(value, FALLBACK)).toBe(FALLBACK)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['szám', 42],
    ['logikai', true],
    ['objektum', { returnUrl: '/kurzusaim' }],
    // Többször megadott query-paramétert a Next tömbként ad át.
    ['tömb', ['/kurzusaim', `//${HOSTILE_HOST}`]],
  ])('nem szöveg (%s) → fallback', (_label, value) => {
    expect(sanitizeReturnUrl(value, FALLBACK)).toBe(FALLBACK)
  })
})

describe('sanitizeReturnUrl — a fallback paraméterezhető', () => {
  it('a hívó által megadott értékre esik vissza', () => {
    expect(sanitizeReturnUrl(`//${HOSTILE_HOST}`, '/fiok')).toBe('/fiok')
    expect(sanitizeReturnUrl(undefined, '/penztar')).toBe('/penztar')
    expect(sanitizeReturnUrl('', '/')).toBe('/')
  })

  it('a fallback nem írja felül az érvényes értéket', () => {
    expect(sanitizeReturnUrl('/kurzusaim', '/fiok')).toBe('/kurzusaim')
  })

  it('a belépés/regisztráció alapértelmezése maga is biztonságos', () => {
    expect(DEFAULT_AUTH_RETURN_URL).toBe('/kurzusaim')
    expect(sanitizeReturnUrl(DEFAULT_AUTH_RETURN_URL, '/')).toBe(DEFAULT_AUTH_RETURN_URL)
  })
})

describe('sanitizeReturnUrl — az eredmény sosem idegen eredetű', () => {
  it.each([
    `//${HOSTILE_HOST}`,
    `/\\${HOSTILE_HOST}`,
    `https://${HOSTILE_HOST}/atveres`,
    `//user@${HOSTILE_HOST}`,
    'javascript:alert(1)',
    `/kurzusaim\r\nLocation: https://${HOSTILE_HOST}`,
    '///',
    // Ez átmegy a szűrőn (gyökér-relatív), de az URL-feloldás után is a saját
    // eredeten marad — a `..` szegmens nem tud hosztot csempészni.
    `/..//${HOSTILE_HOST}`,
  ])('%s a saját eredeten belül marad', (value) => {
    const target = new URL(sanitizeReturnUrl(value, FALLBACK), ORIGIN)
    expect(target.origin).toBe(ORIGIN)
    expect(target.host).not.toContain(HOSTILE_HOST)
    expect(target.protocol).toBe('https:')
  })
})

describe('hasControlCharacter', () => {
  it('a szokásos útvonalakra hamis', () => {
    expect(hasControlCharacter('/kurzusaim/12?a=b#c')).toBe(false)
    expect(hasControlCharacter('/kezrehabilitacio/gyakorlatok')).toBe(false)
    expect(hasControlCharacter('/kézrehabilitáció')).toBe(false)
  })

  it.each([
    ['soremelés', '\n'],
    ['kocsivissza', '\r'],
    ['tabulátor', '\t'],
    ['nullbájt', '\u0000'],
    ['DEL', '\u007f'],
  ])('%s → igaz', (_label, value) => {
    expect(hasControlCharacter(`/kurzusaim${value}`)).toBe(true)
  })
})

describe('sanitizeReturnPath (előnézet) — visszafelé kompatibilis', () => {
  it('a közös szűrőt használja, a kezdőlapra eső fallbackkal', () => {
    expect(sanitizeReturnPath('/blog/elso-cikk')).toBe('/blog/elso-cikk')
    expect(sanitizeReturnPath('  /rolunk  ')).toBe('/rolunk')
    expect(sanitizeReturnPath(`//${HOSTILE_HOST}`)).toBe('/')
    expect(sanitizeReturnPath(`/\\${HOSTILE_HOST}`)).toBe('/')
    expect(sanitizeReturnPath(null)).toBe('/')
  })
})

describe('signInHref', () => {
  it('alapból a Kurzusaimra visz vissza', () => {
    expect(signInHref()).toBe('/belepes?returnUrl=%2Fkurzusaim')
    expect(signInHref('/kurzusaim')).toBe('/belepes?returnUrl=%2Fkurzusaim')
  })

  it('a pénztár termék-paraméterét megtartja', () => {
    expect(signInHref('/penztar?termek=12')).toBe('/belepes?returnUrl=%2Fpenztar%3Ftermek%3D12')
  })

  it('idegen eredetű célnál a Kurzusaimra esik', () => {
    expect(signInHref(`//${HOSTILE_HOST}`)).toBe('/belepes?returnUrl=%2Fkurzusaim')
  })
})
