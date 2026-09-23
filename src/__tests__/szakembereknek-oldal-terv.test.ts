import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  SZAKEMBEREKNEK_DESCRIPTION,
  SZAKEMBEREKNEK_LEAD,
  SZAKEMBEREKNEK_TITLE,
  szakembereknekAlapBlokk,
} from '../lib/szakembereknek'
import { SZAKEMBEREKNEK_OLDAL_SLUG, szakembereknekOldalTerv } from '../scripts/szakembereknek-oldal'

import { EM_DASH, EN_DASH } from './helpers/cta-mikroszoveg'

/**
 * ŐR — a „szakembereknek” Oldalak-rekord tartalom-szabálya (modul-térkép H11,
 * A7). Tiszta függvény: rekord nélkül a létrehozandó adat a mai lap
 * szövegével, meglévő rekordnál (bármilyen állapotban) semmi.
 */

const MOST = new Date('2026-09-23T08:00:00.000Z')

describe('szakembereknekOldalTerv', () => {
  it('rekord nélkül LETREHOZANDO, a mai lap adataival, közzétéve', () => {
    const terv = szakembereknekOldalTerv(null, MOST)
    expect(terv.allapot).toBe('LETREHOZANDO')
    expect(terv.adat).toEqual({
      title: SZAKEMBEREKNEK_TITLE,
      slug: 'szakembereknek',
      excerpt: SZAKEMBEREKNEK_LEAD,
      seoDescription: SZAKEMBEREKNEK_DESCRIPTION,
      content: expect.objectContaining({ root: expect.objectContaining({ type: 'root' }) }),
      layout: [szakembereknekAlapBlokk()],
      status: 'published',
      _status: 'published',
      publishedAt: '2026-09-23T08:00:00.000Z',
    })
    expect(SZAKEMBEREKNEK_OLDAL_SLUG).toBe('szakembereknek')
    expect(terv.uzenet).toContain('létrehozandó')
  })

  it('a kötelező Tartalom mező a bevezető egy bekezdésben (a Pages validálja)', () => {
    const tartalom = szakembereknekOldalTerv(null, MOST).adat?.content
    expect(JSON.stringify(tartalom)).toContain(JSON.stringify(SZAKEMBEREKNEK_LEAD))
    expect(tartalom?.root.children).toHaveLength(1)
  })

  it('a szekciósor egyetlen Ajánlat-kártyák szekció, a mai két kártyával, látható, fehér háttéren', () => {
    const blokk = szakembereknekOldalTerv(null, MOST).adat?.layout?.[0]
    expect(blokk?.blockType).toBe('offerCards')
    if (blokk?.blockType !== 'offerCards') throw new Error('nem offerCards')
    expect(blokk.kartyak?.map((kartya) => kartya.cim)).toEqual([
      'Akkreditált kézrehabilitációs képzés',
      'A Kineticare szakkönyve',
    ])
    expect(blokk.kartyak?.map((kartya) => kartya.gombSuly)).toEqual(['elsodleges', 'masodlagos'])
    expect(blokk.kartyak?.[1]).toMatchObject({
      url: '/kapcsolat',
      felirat: 'Érdeklődj a szakkönyvről',
      jegyzet: 'A kapcsolat-oldalunkra visz.',
      hamarosan: true,
    })
    expect(blokk.kartyak?.[0]).toMatchObject({
      ujAblakban: true,
      felirat: 'Nézd meg a kézworkshopot',
      jegyzet: null,
    })
    expect(blokk.sectionSettings).toEqual({ visible: true, hatter: 'feher' })
    // A lapfejet a route adja: a blokk címe üres, így a kártyák H2-k maradnak.
    expect(blokk.title ?? null).toBeNull()
  })

  it.each([{ id: 7 }, { id: 'abc' }])(
    'meglévő rekordnál (%o) MAR_LETEZIK, adat nélkül',
    (meglevo) => {
      const terv = szakembereknekOldalTerv(meglevo, MOST)
      expect(terv).toEqual({
        allapot: 'MAR_LETEZIK',
        adat: null,
        uzenet: expect.stringContaining(String(meglevo.id)),
      })
    },
  )

  it('idempotens: ugyanarra a bemenetre ugyanaz, a létrehozás után már nincs teendő', () => {
    expect(szakembereknekOldalTerv(null, MOST)).toEqual(szakembereknekOldalTerv(null, MOST))
    // A hívó a létrehozott rekordot adja vissza a következő futásnál.
    expect(szakembereknekOldalTerv({ id: 1 }, MOST).allapot).toBe('MAR_LETEZIK')
  })

  it('az üzenetekben és az adatban nincs töltelék gondolatjel', () => {
    for (const terv of [
      szakembereknekOldalTerv(null, MOST),
      szakembereknekOldalTerv({ id: 1 }, MOST),
    ]) {
      const szoveg = JSON.stringify(terv)
      expect(szoveg.includes(EN_DASH)).toBe(false)
      expect(szoveg.includes(EM_DASH)).toBe(false)
    }
  })

  it('tiszta szabály: nem importál adatbázist, konfigot vagy loggert', () => {
    const forras = readFileSync(
      fileURLToPath(new URL('../scripts/szakembereknek-oldal.ts', import.meta.url)),
      'utf8',
    )
    const importok = [...forras.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((t) => t[1])
    expect(importok).toEqual(['payload', '../lib/szakembereknek'])
    expect(forras).toMatch(/^import type \{ RequiredDataFromCollectionSlug \} from 'payload'$/m)
  })
})
