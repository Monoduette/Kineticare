import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as freeSosKomponens from '../components/content/home/FreeSos'
import { FreeSos } from '../components/content/home/FreeSos'
import {
  FREE_SOS_NEUTRAL_TITLE,
  FREE_SOS_STRIP_TITLE,
  freeSosStripTitle,
} from '../lib/free-sos-title'
import { isAvailableSosProduct } from '../lib/sos-offer'
import type { Product } from '../payload-types'

/**
 * Őr (modul-térkép H07/H46, „Egy mező, egy feloldó”): az SOS-sáv címének
 * EGYETLEN szabálya a src/lib/free-sos-title.ts. A lap (FreeSos.tsx), az admin
 * sorcímkéje, a szerkesztői szalag és az llms-full.txt ezt hívja, így ugyanaz
 * a szekció mindenhol ugyanazon a néven szerepel (WCAG 2.2 SC 3.2.4).
 */

const sos = {
  id: 2,
  slug: 'sos-kezrelax-villamkurzus',
  displayTitle: 'SOS Kézrelax',
  status: 'published',
  _status: 'published',
  priceInHUFEnabled: false,
} as Product

const forras = (relativ: string): string => readFileSync(new URL(relativ, import.meta.url), 'utf8')

/** A FreeSos h2-jének szövege, ahogy a látogató olvassa (a szóközök összeesnek). */
function lapCime(html: string): string {
  const talalat = /id="ingyenes-cim">([^<]*)<\/h2>/.exec(html)
  if (!talalat?.[1]) throw new Error('A FreeSos h2-je nem található')
  return talalat[1]
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Hálózat tiltva a komponens-tesztben')
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('free-sos-title.ts: tiszta modul, import nélkül', () => {
  const kod = forras('../lib/free-sos-title.ts')

  it('nincs benne import, require és dinamikus import (React, next, Payload sem)', () => {
    expect(kod).not.toMatch(/^\s*import\s/m)
    expect(kod).not.toMatch(/\brequire\(/)
    expect(kod).not.toMatch(/\bimport\(/)
    expect(kod).not.toMatch(/['"](react|next|payload)(\/[^'"]*)?['"]/)
    expect(kod).not.toMatch(/['"]@payloadcms\//)
    expect(kod).not.toContain("'use client'")
    expect(kod).not.toContain("'server-only'")
  })

  it('a két állandó a tulajdonos címe és a semleges cím', () => {
    expect(FREE_SOS_STRIP_TITLE).toBe('Ingyenes villámkurzus')
    expect(FREE_SOS_NEUTRAL_TITLE).toBe('Kurzusaink')
  })
})

describe('freeSosStripTitle: a FreeSos.tsx szabálya', () => {
  it.each([
    [{ title: 'Saját SOS-cím' }, 'Saját SOS-cím'],
    [{ title: '  Ingyenes villámkurzus  ' }, 'Ingyenes villámkurzus'],
    [{ title: '\nPróbáld ki ingyen\t' }, 'Próbáld ki ingyen'],
    [{ title: 'SOS Kézrelax — ingyenes villámkurzus' }, 'SOS Kézrelax — ingyenes villámkurzus'],
  ])('ingyenes SOS-nál a trimmelt CMS-cím: %j', (block, vart) => {
    expect(freeSosStripTitle(block, true)).toBe(vart)
  })

  it.each([
    { title: '' },
    { title: '   \t\n ' },
    { title: null },
    { title: undefined },
    { title: 42 },
    {},
    null,
    undefined,
    'Ingyenes SOS',
    ['Ingyenes SOS'],
  ])('ingyenes SOS-nál üres vagy nem szöveges címre a tartalék áll: %j', (block) => {
    expect(freeSosStripTitle(block, true)).toBe(FREE_SOS_STRIP_TITLE)
  })

  it.each([{ title: 'Saját SOS-cím' }, { title: 'Ingyenes villámkurzus' }, { title: '' }, null])(
    'elérhető ingyenes SOS nélkül mindig „Kurzusaink”: %j',
    (block) => {
      expect(freeSosStripTitle(block, false)).toBe(FREE_SOS_NEUTRAL_TITLE)
    },
  )

  it('a bemenetet nem módosítja (a megjelenítés nem írja át a mentett szöveget)', () => {
    const block = Object.freeze({
      blockType: 'freeSos',
      title: '  SOS Kézrelax — ingyenes villámkurzus  ',
    })
    expect(freeSosStripTitle(block, true)).toBe('SOS Kézrelax — ingyenes villámkurzus')
    expect(block.title).toBe('  SOS Kézrelax — ingyenes villámkurzus  ')
  })
})

describe('A lap h2-je a közös feloldó kimenete', () => {
  const termekek: ReadonlyArray<readonly [string, Product | null]> = [
    ['elérhető SOS', sos],
    ['nincs termék', null],
    ['piszkozat SOS', { ...sos, _status: 'draft' }],
    ['fizetős SOS', { ...sos, priceInHUFEnabled: true, priceInHUF: 10000 }],
    ['más slug', { ...sos, slug: 'masik-ingyenes' }],
  ]
  const cimek = [
    'Saját SOS-cím',
    '  Ingyenes villámkurzus  ',
    'SOS Kézrelax — ingyenes villámkurzus',
    '',
    '   ',
    undefined,
  ]

  it.each(termekek)('%s: minden címre a h2 = freeSosStripTitle', (_nev, termek) => {
    for (const title of cimek) {
      const html = renderToStaticMarkup(createElement(FreeSos, { freeProduct: termek, title }))
      expect(lapCime(html)).toBe(freeSosStripTitle({ title }, isAvailableSosProduct(termek)))
    }
  })

  it('a FreeSos.tsx a feloldót hívja, saját cím-szabály és „Kurzusaink” literál nélkül', () => {
    const kod = forras('../components/content/home/FreeSos.tsx')
    expect(kod).toContain("from '../../../lib/free-sos-title'")
    expect(kod).toMatch(/freeSosStripTitle\(\{ title \}, knownFree\)/)
    expect(kod).not.toMatch(/['"]Kurzusaink['"]/)
    expect(kod).not.toMatch(/title\?\.trim\(\)/)
    expect(kod).not.toMatch(/export const FREE_SOS_STRIP_TITLE\s*=/)
  })

  it('a FreeSos.tsx a tartalékot változatlan néven továbbadja (a régi importok nem törnek)', () => {
    expect(freeSosKomponens.FREE_SOS_STRIP_TITLE).toBe(FREE_SOS_STRIP_TITLE)
  })
})
