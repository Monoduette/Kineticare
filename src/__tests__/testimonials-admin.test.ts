import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Field, Payload } from 'payload'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  OLDAL_LEKERDEZES,
  TestimonialPlacementCell,
  VELEMENY_LEKERDEZES,
} from '../components/admin/TestimonialPlacementCell'
import {
  SHORT_QUOTE_MAX_LENGTH,
  Testimonials,
  validateFeaturedTestimonial,
} from '../collections/Testimonials'
import { NEM_MEGALLAPITHATO } from '../lib/admin/velemeny-helye'
import { logger } from '../lib/logger'

/**
 * A Vélemények gyűjtemény admin-felülete (modul-térkép H43/1–4): a leírások
 * igazat mondanak, a Rövid idézet a Teljes szöveg előtt áll, a „Hol látszik”
 * oszlop be van kötve, és kérésenként két lekérdezéssel dolgozik.
 *
 * A React `cache` a React Server Components környezetén kívül (így a
 * vitestben is) nem jegyez meg semmit (react.development.js: `cache(fn)`
 * egyszerű továbbhívás). A Next.js szerverén egy kérés idejére jegyez meg. Ezt
 * a viselkedést utánozza a lenti mock: a `cache` kérésenként egy tárat ad, a
 * `beforeEach` üríti (új kérés). Így az ellenőrzés azt méri, hogy a cella a
 * két lekérdezést tényleg a `cache`-en keresztül, ugyanazzal a kulccsal hívja.
 */

const cacheAllapot = vi.hoisted(() => ({ tarak: [] as Map<unknown, unknown>[] }))

vi.mock('react', async (importOriginal) => {
  const eredeti = await importOriginal<typeof import('react')>()
  return {
    ...eredeti,
    cache: <A, R>(fn: (arg: A) => R): ((arg: A) => R) => {
      const tar = new Map<unknown, unknown>()
      cacheAllapot.tarak.push(tar)
      return (arg: A): R => {
        if (!tar.has(arg)) {
          tar.set(arg, fn(arg))
        }
        return tar.get(arg) as R
      }
    },
  }
})

const SRC = fileURLToPath(new URL('..', import.meta.url))
const forras = (utvonal: string): string => readFileSync(join(SRC, utvonal), 'utf8')

type NevesMezo = Extract<Field, { name: string }>

const mezok = Testimonials.fields.filter((field): field is NevesMezo => 'name' in field)
const mezo = (nev: string): NevesMezo => {
  const talalat = mezok.find((field) => field.name === nev)
  if (!talalat) throw new Error(`Nincs ilyen mező: ${nev}`)
  return talalat
}
const leiras = (field: NevesMezo): string => {
  const description = field.admin && 'description' in field.admin ? field.admin.description : null
  return typeof description === 'string' ? description : ''
}

const gyujtemenyLeiras = (): string => {
  const description = Testimonials.admin?.description
  return typeof description === 'string' ? description : ''
}

describe('a mezők (séma változatlan)', () => {
  it('az adatmezők nevei és típusai ugyanazok, mint előtte; új csak a „Hol látszik” ui-mező', () => {
    const adat = Object.fromEntries(
      mezok.filter((field) => field.type !== 'ui').map((field) => [field.name, field.type]),
    )
    expect(adat).toEqual({
      quote: 'textarea',
      shortQuote: 'textarea',
      authorName: 'text',
      authorTitle: 'text',
      featured: 'checkbox',
      order: 'number',
      visible: 'checkbox',
    })
    expect(mezok.filter((field) => field.type === 'ui').map((field) => field.name)).toEqual([
      'holLatszik',
    ])
  })

  it('a Rövid idézet a Teljes szöveg előtt áll', () => {
    const nevek = mezok.map((field) => field.name)
    expect(nevek.indexOf('shortQuote')).toBeGreaterThanOrEqual(0)
    expect(nevek.indexOf('shortQuote')).toBeLessThan(nevek.indexOf('quote'))
  })

  it('a featured validate-je a validateFeaturedTestimonial-t hívja, ugyanazzal az eredménnyel', () => {
    const featured = mezo('featured')
    const validate = 'validate' in featured ? featured.validate : undefined
    if (typeof validate !== 'function') throw new Error('A featured mezőnek nincs validate-je')
    expect(validate.toString()).toContain('validateFeaturedTestimonial(value, siblingData)')
    const hosszu = 'a'.repeat(SHORT_QUOTE_MAX_LENGTH + 1)
    const esetek: [unknown, unknown][] = [
      [true, { quote: hosszu }],
      [true, { quote: hosszu, shortQuote: 'Rövid.' }],
      [false, { quote: hosszu }],
      [true, undefined],
    ]
    for (const [ertek, siblingData] of esetek) {
      const hivas = validate as (value: unknown, options: { siblingData?: unknown }) => unknown
      expect(hivas(ertek, { siblingData })).toBe(validateFeaturedTestimonial(ertek, siblingData))
    }
  })

  it('a shortQuote validate-je változatlan: a határig átmegy, fölötte a régi hibaüzenet', () => {
    const shortQuote = mezo('shortQuote')
    const validate = 'validate' in shortQuote ? shortQuote.validate : undefined
    if (typeof validate !== 'function') throw new Error('A shortQuote mezőnek nincs validate-je')
    const hivas = validate as (value: unknown) => unknown
    expect(hivas('a'.repeat(SHORT_QUOTE_MAX_LENGTH))).toBe(true)
    expect(hivas(null)).toBe(true)
    expect(hivas('a'.repeat(SHORT_QUOTE_MAX_LENGTH + 1))).toBe(
      `A rövid változat legfeljebb ${SHORT_QUOTE_MAX_LENGTH} karakter lehet (jelenleg ${SHORT_QUOTE_MAX_LENGTH + 1}).`,
    )
  })

  it('a többi mezőnek nincs validate-je (ahogy előtte)', () => {
    for (const nev of ['quote', 'authorName', 'authorTitle', 'order', 'visible', 'holLatszik']) {
      const field = mezo(nev)
      expect('validate' in field ? field.validate : undefined, nev).toBeUndefined()
    }
  })
})

describe('a leírások igazat mondanak', () => {
  it('a gyűjtemény leírása', () => {
    expect(gyujtemenyLeiras()).toBe(
      'Páciensek valódi visszajelzései. A Kiemelt és Látható pipás vélemények közül a Sorrend ' +
        'szerinti első három jelenik meg, minden Vélemények szekcióban ugyanaz (a Kapcsolat oldal ' +
        'kivételével). Amelyik vélemény nem kerül az első háromba, az sehol nem jelenik meg. Hogy ' +
        'melyik vélemény hol látszik, a „Hol látszik” oszlop mutatja.',
    )
  })

  it('a Teljes szöveg súgója', () => {
    expect(leiras(mezo('quote'))).toBe(
      'A vélemény teljes, eredeti szövege, pontosan úgy, ahogy elhangzott. Ha a Rövid idézet ki ' +
        'van töltve, a weboldalon az látszik, ez nem.',
    )
  })

  it('a Rövid idézet és a Kiemelt súgója a weboldalról szól, nem a kezdőlapról', () => {
    const rovid = leiras(mezo('shortQuote'))
    expect(rovid).toContain('egy-két mondatos')
    expect(rovid).toContain(`legfeljebb ${SHORT_QUOTE_MAX_LENGTH} karakter`)
    for (const szoveg of [rovid, leiras(mezo('featured'))]) {
      expect(szoveg).toContain('weboldal')
      expect(szoveg).not.toMatch(/főoldal|kezdőlapon/i)
    }
  })

  it('egyik leírásban sincs gondolatjel (U+2013, U+2014) és „főoldal”', () => {
    const osszes = [gyujtemenyLeiras(), ...mezok.map(leiras)]
    for (const szoveg of osszes) {
      expect(szoveg).not.toMatch(/[–—]/)
      expect(szoveg.toLowerCase()).not.toContain('főoldal')
    }
  })
})

describe('a „Hol látszik” oszlop bekötése', () => {
  it('ui-mező, csak Cell komponenssel', () => {
    const field = mezo('holLatszik')
    expect(field.type).toBe('ui')
    expect('label' in field ? field.label : undefined).toBe('Hol látszik')
    expect(field.admin?.components).toEqual({
      Cell: '/components/admin/TestimonialPlacementCell#TestimonialPlacementCell',
    })
  })

  it('az alapértelmezett oszlopok', () => {
    expect(Testimonials.admin?.defaultColumns).toEqual([
      'authorName',
      'holLatszik',
      'authorTitle',
      'featured',
      'order',
      'visible',
    ])
  })
})

describe('a cella lekérdezései egyeznek a weboldaléval', () => {
  const cms = forras('lib/cms.ts')

  it('(a) a vélemények: BETŰRE a getTestimonials lekérdezése', () => {
    const eleje = cms.indexOf('export async function getTestimonials(limit = 3)')
    expect(eleje).toBeGreaterThan(-1)
    const torzs = cms.slice(eleje, cms.indexOf('\n}\n', eleje))
    expect(torzs).toContain(
      `collection: 'testimonials',\n        where: { visible: { equals: true }, featured: { equals: true } },\n        limit,\n        sort: 'order',\n        depth: 0,\n        overrideAccess: true,\n      })`,
    )
    expect(VELEMENY_LEKERDEZES).toEqual({
      collection: 'testimonials',
      where: { visible: { equals: true }, featured: { equals: true } },
      limit: 3,
      sort: 'order',
      depth: 0,
      overrideAccess: true,
    })
  })

  it('(b) az oldalak: a közzétett változat, ahogy a getPageBySlug kéri', () => {
    expect(cms).toContain(
      "export const PUBLISHED_WHERE = { status: { equals: 'published' } } as const",
    )
    expect(cms).toContain(
      'const publishedWhere = (draft: boolean): Record<string, unknown> => (draft ? {} : PUBLISHED_WHERE)',
    )
    expect(cms).toContain('where: { slug: { equals: slug }, ...publishedWhere(draft) },')
    expect(OLDAL_LEKERDEZES.where).toEqual({ status: { equals: 'published' } })
    expect(OLDAL_LEKERDEZES.draft).toBe(false)
    expect(OLDAL_LEKERDEZES.pagination).toBe(false)
    expect(OLDAL_LEKERDEZES.depth).toBe(0)
    expect(OLDAL_LEKERDEZES.select).toEqual({ slug: true, title: true, layout: true })
  })
})

describe('TestimonialPlacementCell', () => {
  beforeEach(() => {
    for (const tar of cacheAllapot.tarak) tar.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const oldalak = [
    {
      id: 1,
      slug: 'kezdolap',
      title: 'Kéz-rehabilitáció otthon',
      layout: [{ blockType: 'testimonials', maxItems: 3 }],
    },
    {
      id: 2,
      slug: 'rolunk',
      title: 'Rólunk',
      layout: [{ blockType: 'testimonials', maxItems: 1 }],
    },
  ]

  type VelemenySor = { id: number; order: number | null }

  function mockPayload(
    hiba?: Error,
    velemenyek: readonly VelemenySor[] = [
      { id: 11, order: 1 },
      { id: 12, order: 2 },
    ],
  ) {
    const find = vi.fn(async (args: { collection: string }) => {
      if (hiba) throw hiba
      if (args.collection === 'testimonials') {
        return { docs: velemenyek }
      }
      if (args.collection === 'pages') {
        return { docs: oldalak }
      }
      throw new Error(`váratlan gyűjtemény: ${args.collection}`)
    })
    return { find, payload: { find } as unknown as Pick<Payload, 'find'> }
  }

  const cella = async (
    payload: Pick<Payload, 'find'>,
    rowData: Record<string, unknown>,
  ): Promise<string> => renderToStaticMarkup(await TestimonialPlacementCell({ payload, rowData }))

  it('a két betöltő a React cache-en megy át', () => {
    expect(cacheAllapot.tarak).toHaveLength(2)
  })

  it('két sor: pontosan két find-hívás, soronként a helyes szöveg', async () => {
    const { find, payload } = mockPayload()
    const elso = await cella(payload, { id: 11, featured: true, visible: true })
    const masodik = await cella(payload, { id: 12, featured: true, visible: true })

    expect(elso).toBe('<span class="kc-velemeny-helye">Kezdőlap, Rólunk</span>')
    expect(masodik).toBe('<span class="kc-velemeny-helye">Kezdőlap</span>')
    expect(find).toHaveBeenCalledTimes(2)
    expect(find.mock.calls.map(([args]) => args.collection).sort()).toEqual([
      'pages',
      'testimonials',
    ])
    expect(find).toHaveBeenCalledWith(VELEMENY_LEKERDEZES)
    expect(find).toHaveBeenCalledWith(OLDAL_LEKERDEZES)
  })

  it('a rang a szekció rendezéséből jön: az üres Sorrendű vélemény előre kerül', async () => {
    const { find, payload } = mockPayload(undefined, [
      { id: 21, order: 1 },
      { id: 22, order: 2 },
      { id: 23, order: null },
    ])
    expect(await cella(payload, { id: 23, featured: true, visible: true })).toBe(
      '<span class="kc-velemeny-helye">Kezdőlap, Rólunk</span>',
    )
    expect(await cella(payload, { id: 21, featured: true, visible: true })).toBe(
      '<span class="kc-velemeny-helye">Kezdőlap</span>',
    )
    expect(find).toHaveBeenCalledTimes(2)
    expect(find).toHaveBeenCalledWith(VELEMENY_LEKERDEZES)
  })

  it('„Sehol” sor is ugyanazt a két hívást használja', async () => {
    const { find, payload } = mockPayload()
    expect(await cella(payload, { id: 13, featured: false, visible: true })).toContain(
      'Sehol (nincs kiemelve)',
    )
    expect(await cella(payload, { id: 14, featured: true, visible: false })).toContain(
      'Sehol (rejtett)',
    )
    expect(find).toHaveBeenCalledTimes(2)
  })

  it('hibánál „Nem sikerült megállapítani”, és a napló figyelmeztet (kérésenként egyszer)', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const { find, payload } = mockPayload(new Error('adatbázis nem elérhető'))

    expect(await cella(payload, { id: 11, featured: true, visible: true })).toBe(
      `<span class="kc-velemeny-helye">${NEM_MEGALLAPITHATO}</span>`,
    )
    expect(await cella(payload, { id: 12, featured: true, visible: true })).toContain(
      NEM_MEGALLAPITHATO,
    )
    expect(find).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[0]?.[1]).toEqual({ error: 'adatbázis nem elérhető' })
  })

  it('payload nélkül is ad választ, és naplóz', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    expect(renderToStaticMarkup(await TestimonialPlacementCell({ rowData: { id: 1 } }))).toContain(
      NEM_MEGALLAPITHATO,
    )
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
