/**
 * A tartalom-job (npm run content:owner, src/scripts/apply-owner-content.ts)
 * két új lépésének bekötése (A8):
 *  - H15: a sín `elrendezes` / `hatter` mezője a kezdőlapon és a
 *    /szolgaltatasokon (src/scripts/sin-elrendezes-kitoltes.ts);
 *  - H11: a „szakembereknek” webcímű oldal létrehozása
 *    (src/scripts/szakembereknek-oldal.ts).
 *
 * Mért tulajdonságok: próbafutásban nem ír; élesben egyszer ír; az ismételt
 * futás nem ír; a sín-lépés mindkét lapon fut, a lap írása előtt.
 *
 * Valódi adatbázis és hálózat nélkül: a /szakembereknek lépés injektált, hamis
 * payloadot kap; a futtató (`futtat`) lánc-bekötését forrás-őr köti.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import {
  alkalmazSinElrendezes,
  szakembereknekOldalLepes,
  type SzakembereknekOldalPayload,
} from '../scripts/apply-owner-content'
import { SZAKEMBEREKNEK_OLDAL_SLUG } from '../scripts/szakembereknek-oldal'
import { buildHomeLayout } from '../lib/home-seed'
import { buildSzolgaltatasokLayout } from '../scripts/restore-legacy-content'
import type { Page } from '../payload-types'

type Szekciosor = NonNullable<Page['layout']>

const itt = path.dirname(fileURLToPath(import.meta.url))
const scriptForras = readFileSync(path.join(itt, '../scripts/apply-owner-content.ts'), 'utf8')

/** A services blokkok (elrendezes, hatter) párja, sorrendben. */
const sinMezok = (layout: Szekciosor): Array<[unknown, unknown]> =>
  layout
    .filter((blokk) => blokk.blockType === 'services')
    .map((blokk) => [
      (blokk as { elrendezes?: unknown }).elrendezes,
      (blokk as { sectionSettings?: { hatter?: unknown } }).sectionSettings?.hatter,
    ])

/**
 * Az élő kezdőlap állapota (modul-térkép H15): a háromajtós blokk mezője
 * „Tábla” és „Fehér”, a lapon mégis sín és világoskék áll.
 */
const eloKezdolap = (): Szekciosor =>
  buildHomeLayout().map((blokk) =>
    blokk.blockType === 'services'
      ? {
          ...blokk,
          elrendezes: 'tabla' as const,
          sectionSettings: { ...(blokk.sectionSettings ?? {}), hatter: 'feher' as const },
        }
      : blokk,
  )

// ===========================================================================
// H15: a sín-lépés a kezdőlapon és a /szolgaltatasokon
// ===========================================================================

describe('alkalmazSinElrendezes: a sín-szabály a futtató naplóalakjában', () => {
  it('kezdőlap: a „Tábla, Fehér” háromajtós blokk sínre és világoskékre áll, egyszer', () => {
    const elso = alkalmazSinElrendezes(eloKezdolap(), 'Kezdőlap', 'kezdolap')
    expect(elso.layout).not.toBeNull()
    expect(elso.modositasok).toHaveLength(1)
    expect(elso.modositasok[0]).toMatchObject({ szabaly: 'sin-elrendezes', indok: null })
    expect(elso.modositasok[0].uzenet).toContain('Kezdőlap')
    expect(sinMezok(elso.layout ?? [])).toEqual([['sin', 'tint']])

    const masodik = alkalmazSinElrendezes(elso.layout ?? [], 'Kezdőlap', 'kezdolap')
    expect(masodik.layout).toBeNull()
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.kihagyasok.map((sor) => sor.indok)).toEqual(['már javítva'])
  })

  it('/szolgaltatasok: az ajtó-blokk sínre áll, egyszer; a bemenet nem változik', () => {
    const kiindulas = buildSzolgaltatasokLayout({})
    const masolat = structuredClone(kiindulas)
    const elso = alkalmazSinElrendezes(kiindulas, 'Szolgáltatások oldal', 'szolgaltatasok')
    expect(kiindulas).toEqual(masolat)
    expect(elso.layout).not.toBeNull()
    expect(elso.modositasok.map((sor) => sor.szabaly)).toEqual(['sin-elrendezes'])
    expect(sinMezok(elso.layout ?? [])[0]).toEqual(['sin', 'tint'])

    const masodik = alkalmazSinElrendezes(
      elso.layout ?? [],
      'Szolgáltatások oldal',
      'szolgaltatasok',
    )
    expect(masodik.layout).toBeNull()
    expect(masodik.modositasok).toHaveLength(0)
  })

  it('services blokk nélkül: indokolt, csendes kihagyás, írás nélkül', () => {
    const eredmeny = alkalmazSinElrendezes([], 'Kezdőlap', 'kezdolap')
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok).toEqual([
      {
        szabaly: 'sin-elrendezes',
        uzenet: 'Kezdőlap: a szolgáltatás-szekciók elrendezése',
        indok: 'a szekciósorban nincs szolgáltatás-szekció',
      },
    ])
  })
})

describe('a futtató bekötése (forrás-őr)', () => {
  /** A `futtat` törzse, a futtatás-kapu előtt. */
  const futtat = scriptForras.slice(scriptForras.indexOf('async function futtat()'))

  it('a próbafutás az alapértelmezés: írni csak OWNER_CONTENT_CONFIRM=igen mellett lehet', () => {
    expect(futtat).toContain("const dryRun = !kapuNyitva('OWNER_CONTENT_CONFIRM')")
  })

  it('kezdőlap: a sín-lépés a lánc végén, a dryRun-kapus egyetlen lap-írás ELŐTT fut', () => {
    const lepes = futtat.indexOf(
      "kezdolapLepes(alkalmazSinElrendezes(kezdolapLayout, 'Kezdőlap', 'kezdolap'))",
    )
    const filmFeliratok = futtat.indexOf(
      "kezdolapLepes(alkalmazFilmFeliratok(kezdolapLayout, 'Kezdőlap'))",
    )
    const iras = futtat.indexOf('if (kezdolapValtozott && !dryRun) {')
    expect(lepes).toBeGreaterThan(filmFeliratok)
    expect(filmFeliratok).toBeGreaterThan(0)
    expect(iras).toBeGreaterThan(lepes)
  })

  it('/szolgaltatasok: a sín-lépés a szekciósor-lánc végén, a dryRun-kapus lap-írás ELŐTT fut', () => {
    const lepes = futtat.indexOf(
      "alkalmazSinElrendezes(szolgaltatasokLayout, 'Szolgáltatások oldal', 'szolgaltatasok')",
    )
    const kocsis = futtat.indexOf(
      "szolgaltatasokLepes(await kocsisCvFotoLepes(szolgaltatasokLayout, 'Szolgáltatások oldal'))",
    )
    const iras = futtat.indexOf('if (Object.keys(irandoSzolgaltatasok).length > 0 && !dryRun) {')
    expect(kocsis).toBeGreaterThan(0)
    expect(lepes).toBeGreaterThan(kocsis)
    expect(iras).toBeGreaterThan(lepes)
    expect(futtat.slice(kocsis, lepes)).toContain('szolgaltatasokLepes(')
  })

  it('a /szakembereknek lépés a futtató dryRun-jával és a mai dátummal fut', () => {
    expect(futtat).toContain(
      'await szakembereknekOldalLepes(payload, { dryRun, most: new Date() })',
    )
  })

  it('a fejkomment rögzíti a deploy-feltételt és az egyszeri jelleget', () => {
    const fej = scriptForras.slice(0, scriptForras.indexOf('*/'))
    expect(fej).toContain('CSAK')
    expect(fej).toContain('ugyanabban a deployban élesíthető')
    expect(fej).toContain('EGYSZERI')
  })
})

// ===========================================================================
// H11: a /szakembereknek oldal-rekord
// ===========================================================================

interface HamisOldalak {
  payload: SzakembereknekOldalPayload
  oldalak: Array<Record<string, unknown> & { id: number }>
  find: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
}

function hamisOldalak(kezdo: Array<Record<string, unknown> & { id: number }> = []): HamisOldalak {
  const oldalak = [...kezdo]
  const find = vi.fn(async (args: { where: { slug: { equals: string } }; limit: number }) => {
    const docs = oldalak.filter((oldal) => oldal.slug === args.where.slug.equals)
    return { docs: docs.slice(0, args.limit), totalDocs: docs.length }
  })
  const create = vi.fn(async (args: { data: Record<string, unknown> }) => {
    const doc = { ...args.data, id: 500 + oldalak.length }
    oldalak.push(doc)
    return doc
  })
  return {
    payload: { find, create } as unknown as SzakembereknekOldalPayload,
    oldalak,
    find,
    create,
  }
}

const MOST = new Date('2026-09-23T10:00:00.000Z')

describe('szakembereknekOldalLepes', () => {
  it('a keresés piszkozattal együtt, webcímre, egy találatra megy', async () => {
    const hamis = hamisOldalak()
    await szakembereknekOldalLepes(hamis.payload, { dryRun: true, most: MOST })
    expect(hamis.find).toHaveBeenCalledWith({
      collection: 'pages',
      where: { slug: { equals: SZAKEMBEREKNEK_OLDAL_SLUG } },
      limit: 1,
      depth: 0,
      draft: true,
      overrideAccess: true,
    })
  })

  it('próbafutás: naplózza a létrehozást, de nem ír', async () => {
    const hamis = hamisOldalak()
    const eredmeny = await szakembereknekOldalLepes(hamis.payload, { dryRun: true, most: MOST })
    expect(hamis.create).not.toHaveBeenCalled()
    expect(hamis.oldalak).toHaveLength(0)
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0]).toMatchObject({
      szabaly: 'szakembereknek-oldal',
      indok: null,
    })
    expect(eredmeny.kihagyasok).toHaveLength(0)
  })

  it('éles futás: egyetlen create, közzétett oldal a mai lap adataival', async () => {
    const hamis = hamisOldalak()
    await szakembereknekOldalLepes(hamis.payload, { dryRun: false, most: MOST })
    expect(hamis.create).toHaveBeenCalledTimes(1)
    const hivas = hamis.create.mock.calls[0][0] as {
      collection: string
      data: Record<string, unknown>
      overrideAccess: boolean
    }
    expect(hivas.collection).toBe('pages')
    expect(hivas.overrideAccess).toBe(true)
    expect(hivas.data).toMatchObject({
      slug: SZAKEMBEREKNEK_OLDAL_SLUG,
      _status: 'published',
      publishedAt: MOST.toISOString(),
    })
  })

  it('ismételt éles futás: MAR_LETEZIK, írás nélkül', async () => {
    const hamis = hamisOldalak()
    await szakembereknekOldalLepes(hamis.payload, { dryRun: false, most: MOST })
    const masodik = await szakembereknekOldalLepes(hamis.payload, { dryRun: false, most: MOST })
    expect(hamis.create).toHaveBeenCalledTimes(1)
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.kihagyasok).toHaveLength(1)
    expect(masodik.kihagyasok[0].szabaly).toBe('szakembereknek-oldal')
    expect(masodik.kihagyasok[0].uzenet).toContain('már létezik')
  })

  it('meglévő (akár piszkozat-állapotú, üres szekciósorú) oldalhoz nem nyúl', async () => {
    const hamis = hamisOldalak([
      { id: 7, slug: SZAKEMBEREKNEK_OLDAL_SLUG, _status: 'draft', layout: [] },
    ])
    const eredmeny = await szakembereknekOldalLepes(hamis.payload, { dryRun: false, most: MOST })
    expect(hamis.create).not.toHaveBeenCalled()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0].uzenet).toContain('azonosító: 7')
  })
})
