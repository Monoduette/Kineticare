/**
 * Őr-teszt (modul-térkép H40, H48 A17): az onInit kezdőlap- és vélemény-seedje
 * CSAK friss telepítésen ír.
 *
 * A seed minden deploynál fut. Korábban webcím és név szerint keresett, így a
 * szerkesztő döntése (webcímcsere, törölt kezdőlap, kiürített szekciósor,
 * törölt vagy átnevezett vélemény) a következő induláskor csendben
 * visszafordult vagy megkettőződött. Az új szabály: kezdőlap csak teljesen
 * üres Oldalak-gyűjteménynél, vélemény csak üres Vélemények-gyűjteménynél.
 *
 * Valódi adatbázis nélkül: memóriabeli, a Payload Local API alakját követő
 * hamis payload (count, find, create, update).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Payload } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const naplo = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))
vi.mock('../lib/logger', () => ({ logger: naplo }))

import {
  HOME_TESTIMONIALS,
  buildHomeLayout,
  ensureHomeLayout,
  ensureHomeLayoutFrissTelepitesen,
  ensureHomeTestimonials,
  ensureHomeTestimonialsFrissTelepitesen,
} from '../lib/home-seed'
import { HOME_PAGE_SLUG } from '../lib/content-slugs'

type Doc = Record<string, unknown> & { id: number }
type Gyujtemeny = 'pages' | 'testimonials'

interface HamisPayload {
  payload: Payload
  adat: Record<Gyujtemeny, Doc[]>
  count: ReturnType<typeof vi.fn>
  find: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}

/** Egyszerű `where: { mezo: { equals } }` szűrő; más alakot a seed nem használ. */
function illeszkedik(doc: Doc, where: unknown): boolean {
  if (typeof where !== 'object' || where === null) return true
  return Object.entries(where).every(([mezo, feltetel]) => {
    if (typeof feltetel !== 'object' || feltetel === null || !('equals' in feltetel)) return false
    return doc[mezo] === (feltetel as { equals: unknown }).equals
  })
}

function hamisPayload(kezdo: Partial<Record<Gyujtemeny, Doc[]>> = {}): HamisPayload {
  const adat: Record<Gyujtemeny, Doc[]> = {
    pages: [...(kezdo.pages ?? [])],
    testimonials: [...(kezdo.testimonials ?? [])],
  }
  let kovetkezoId = 1000
  const count = vi.fn(async (args: { collection: Gyujtemeny; where?: unknown }) => ({
    totalDocs: adat[args.collection].filter((doc) => illeszkedik(doc, args.where)).length,
  }))
  const find = vi.fn(async (args: { collection: Gyujtemeny; where?: unknown; limit?: number }) => {
    const docs = adat[args.collection].filter((doc) => illeszkedik(doc, args.where))
    return { docs: docs.slice(0, args.limit ?? docs.length), totalDocs: docs.length }
  })
  const create = vi.fn(async (args: { collection: Gyujtemeny; data: Record<string, unknown> }) => {
    const doc: Doc = { ...args.data, id: kovetkezoId++ }
    adat[args.collection].push(doc)
    return doc
  })
  const update = vi.fn(
    async (args: { collection: Gyujtemeny; id: number; data: Record<string, unknown> }) => {
      const doc = adat[args.collection].find((elem) => elem.id === args.id)
      if (doc === undefined) throw new Error('nincs ilyen dokumentum')
      Object.assign(doc, args.data)
      return doc
    },
  )
  const payload = {
    count,
    find,
    create,
    update,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as Payload
  return { payload, adat, count, find, create, update }
}

/** Az onInit két seed-lépése, az ensureHomeBaseline sorrendjében. */
async function onInitSeed(hamis: HamisPayload): Promise<void> {
  await ensureHomeLayoutFrissTelepitesen(hamis.payload, {})
  await ensureHomeTestimonialsFrissTelepitesen(hamis.payload)
}

const kitoltottLayout = (): Doc['layout'] => buildHomeLayout({}).slice(0, 2)

beforeEach(() => {
  naplo.info.mockClear()
  naplo.warn.mockClear()
  naplo.error.mockClear()
})

describe('friss telepítés (üres adatbázis): a mai viselkedés', () => {
  it('egy közzétett kezdőlap az alap-szekciósorral és a három induló vélemény', async () => {
    const hamis = hamisPayload()
    await onInitSeed(hamis)

    const oldalCreate = hamis.create.mock.calls.filter(([a]) => a.collection === 'pages')
    expect(oldalCreate).toHaveLength(1)
    const data = oldalCreate[0][0].data as Record<string, unknown>
    expect(data.slug).toBe(HOME_PAGE_SLUG)
    expect(data._status).toBe('published')
    expect(data.layout).toEqual(buildHomeLayout({}))

    const velemenyCreate = hamis.create.mock.calls.filter(([a]) => a.collection === 'testimonials')
    expect(velemenyCreate).toHaveLength(3)
    expect(velemenyCreate.map(([a]) => (a.data as { authorName: string }).authorName)).toEqual(
      HOME_TESTIMONIALS.map((t) => t.authorName),
    )
    expect(hamis.update).not.toHaveBeenCalled()
  })

  it('a számlálás a teljes gyűjteményre megy (webcím- és névszűrő nélkül, lomtárral együtt)', async () => {
    const hamis = hamisPayload()
    await onInitSeed(hamis)
    const hivasok = hamis.count.mock.calls.map(([a]) => a)
    expect(hivasok).toEqual([
      { collection: 'pages', overrideAccess: true, trash: true },
      { collection: 'testimonials', overrideAccess: true, trash: true },
    ])
  })

  it('a második indulás már semmit nem ír (a friss telepítés egyszeri)', async () => {
    const hamis = hamisPayload()
    await onInitSeed(hamis)
    hamis.create.mockClear()
    await onInitSeed(hamis)
    expect(hamis.create).not.toHaveBeenCalled()
    expect(hamis.update).not.toHaveBeenCalled()
  })
})

describe('beállt rendszer: az onInit a pages és testimonials gyűjteménybe 0 írást végez', () => {
  const eset = (nev: string, pages: Doc[]): [string, Doc[]] => [nev, pages]
  it.each([
    eset('átnevezett kezdőlap (más webcím)', [
      { id: 1, slug: 'fooldal', title: 'Főoldal', layout: kitoltottLayout() },
    ]),
    eset('törölt kezdőlap (csak más oldalak maradtak)', [
      { id: 2, slug: 'rolunk', title: 'Rólunk', layout: kitoltottLayout() },
      { id: 3, slug: 'kapcsolat', title: 'Kapcsolat', layout: [] },
    ]),
    eset('üres szekciósorú kezdőlap', [{ id: 1, slug: HOME_PAGE_SLUG, title: 'K', layout: [] }]),
    eset('csak piszkozat-állapotú oldal', [
      { id: 4, slug: 'uj-oldal', title: 'Új', _status: 'draft', layout: [] },
    ]),
  ])('%s', async (_nev, pages) => {
    const hamis = hamisPayload({
      pages,
      testimonials: [{ id: 50, authorName: 'Valaki Más', quote: 'Szerkesztői vélemény.' }],
    })
    const elotte = structuredClone(hamis.adat)
    await onInitSeed(hamis)
    expect(hamis.create).not.toHaveBeenCalled()
    expect(hamis.update).not.toHaveBeenCalled()
    expect(hamis.adat).toEqual(elotte)
    expect(naplo.info).toHaveBeenCalledWith(
      expect.stringContaining('a kezdőlap-seed kimarad'),
      expect.objectContaining({ oldalak: pages.length }),
    )
  })

  it('meglévő, más nevű vélemények mellett nem jön létre induló vélemény', async () => {
    const hamis = hamisPayload({
      testimonials: [
        { id: 60, authorName: 'Garami G.', quote: 'Átnevezett induló vélemény.' },
        { id: 61, authorName: 'Új Páciens', quote: 'Új vélemény.' },
      ],
    })
    await ensureHomeTestimonialsFrissTelepitesen(hamis.payload)
    expect(hamis.create).not.toHaveBeenCalled()
    expect(hamis.find).not.toHaveBeenCalled()
    expect(hamis.adat.testimonials).toHaveLength(2)
  })

  it('összevetés: a név- és webcím-alapú seed (npm run seed) ugyanitt írna, ezért nem ez fut induláskor', async () => {
    const hamis = hamisPayload({
      pages: [{ id: 1, slug: HOME_PAGE_SLUG, title: 'K', layout: [] }],
      testimonials: [{ id: 60, authorName: 'Garami G.', quote: 'Átnevezett.' }],
    })
    await ensureHomeLayout(hamis.payload, {})
    await ensureHomeTestimonials(hamis.payload)
    expect(hamis.update).toHaveBeenCalledTimes(1)
    expect(hamis.create.mock.calls.filter(([a]) => a.collection === 'testimonials')).toHaveLength(3)
  })
})

describe('best-effort: a hiba nem szökik ki az onInitből', () => {
  it('count-hiba → figyelmeztetés, nincs kivétel és nincs írás', async () => {
    const hamis = hamisPayload()
    hamis.count.mockRejectedValue(new Error('relation "pages" does not exist'))
    await expect(onInitSeed(hamis)).resolves.toBeUndefined()
    expect(hamis.create).not.toHaveBeenCalled()
    expect(hamis.update).not.toHaveBeenCalled()
    expect(naplo.warn).toHaveBeenCalledTimes(2)
    expect(naplo.warn).toHaveBeenCalledWith(
      expect.stringContaining('kezdőlap friss telepítési seedje sikertelen'),
      { error: 'relation "pages" does not exist' },
    )
  })

  it('create-hiba üres Oldalak-gyűjteménynél → figyelmeztetés, nincs kivétel', async () => {
    const hamis = hamisPayload()
    hamis.create.mockRejectedValue(new Error('írási hiba'))
    await expect(ensureHomeLayoutFrissTelepitesen(hamis.payload, {})).resolves.toBeUndefined()
    expect(naplo.warn).toHaveBeenCalledWith(
      expect.stringContaining('kezdőlap friss telepítési seedje sikertelen'),
      { error: 'írási hiba' },
    )
  })
})

describe('forrás-őr: az onInit a FrissTelepitesen változatokat hívja', () => {
  const itt = path.dirname(fileURLToPath(import.meta.url))
  const config = readFileSync(path.join(itt, '../payload.config.ts'), 'utf8')
  const baseline =
    /async function ensureHomeBaseline\(payload: Payload\): Promise<void> \{([\s\S]*?)\n\}/.exec(
      config,
    )?.[1]

  it('az onInit az ensureHomeBaseline-t hívja', () => {
    expect(config).toMatch(
      /async function onInit\(payload: Payload\)[\s\S]*?await ensureHomeBaseline\(payload\)/,
    )
  })

  it('a sorrend: ensureMediaFiles → ensureHomeImages → kezdőlap → vélemények, mind a friss telepítési változat', () => {
    expect(baseline).toBeDefined()
    const torzs = baseline ?? ''
    const sorrend = [
      'await ensureMediaFiles(payload)',
      'const mediaIds = await ensureHomeImages(payload)',
      'await ensureHomeLayoutFrissTelepitesen(payload, mediaIds)',
      'await ensureHomeTestimonialsFrissTelepitesen(payload)',
    ].map((sor) => torzs.indexOf(sor))
    expect(sorrend.every((index) => index >= 0)).toBe(true)
    expect([...sorrend].sort((a, b) => a - b)).toEqual(sorrend)
  })

  it('a webcím- és név-alapú változatot az onInit nem hívja', () => {
    expect(config).not.toMatch(/ensureHomeLayout\(/)
    expect(config).not.toMatch(/ensureHomeTestimonials\(/)
  })

  it('a kézi seed (npm run seed) változatlanul a webcím- és név-alapú változatot hívja', () => {
    const seed = readFileSync(path.join(itt, '../scripts/seed.ts'), 'utf8')
    expect(seed).toContain('await ensureHomeLayout(payload, homeMediaIds)')
    expect(seed).toContain('await ensureHomeTestimonials(payload)')
    expect(seed).not.toContain('FrissTelepitesen')
  })
})
