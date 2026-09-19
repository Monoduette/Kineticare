import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'

import sosManifest from '../../public/media/sos/manifest.json'
import teamManifest from '../../public/media/team/manifest.json'
import { RenderBlocks } from '../components/blocks/RenderBlocks'
import { COURSE_SHOWCASE_SCENE_PHOTOS } from '../lib/course-showcase'
import {
  ROLUNK_CTA_MONTAZS_FILE,
  resolveCtaBannerCourseCover,
  resolveCtaBannerFigure,
  rolunkCtaMontazs,
} from '../lib/cta-banner-course'
import { SZOLGALTATASOK_KEZELES_FOTO } from '../lib/home-help-states'
import { managedMediaAssets } from '../lib/media-recovery-provenance'
import type { BlockCtaBanner, Media, Page, Product } from '../payload-types'

/**
 * WP54 — a tulajdonosok (Kocsis Kata és Kiss Kata) 2. körös fotós kéréseinek
 * őre (2026-09-19). A Drive-fotózás kiválasztott felvételei webp-ként a repóba
 * kerültek, eredetigazolással (manifest: forrás-azonosító, sha256, méret,
 * alt). Ez a teszt a FÁJLOKAT méri (sharp metadata, sha256, fájlméret), nem a
 * kommentet hiszi el, és a három bekötést rögzíti: a kezdőlapi Kurzusaink
 * jelenet középső cellája, a /szolgaltatasok rendelői ajtó fotója és a
 * /rolunk CTA-sáv kurzus-montázsa (a kezdőlap a borítónál marad).
 * Hálózat és DB nélkül fut; a `payload` import hangosan bukik.
 */

vi.mock('payload', () => {
  throw new Error('A fotó-őr nem kérdezhet le: fájlokból és tiszta függvényekből dolgozik.')
})

const REPO = join(fileURLToPath(import.meta.url), '..', '..', '..')

type ManifestAsset = {
  role: string
  file: string
  sourceId: string
  sourceName: string
  sha256: string
  width: number
  height: number
  alt: string
}

const teamAssets: ManifestAsset[] = teamManifest.assets
const sosAssets: ManifestAsset[] = sosManifest.assets

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** Az 1600-as változat fájlméret-plafonja (bájt): 350 KB. */
const MAX_1600_BYTES = 350 * 1024

/** A tulajdonosi kör új fájljai, pontos néven (a CMS-ügynök ezekre hivatkozik). */
const UJ_TEAM_FAJLOK = [
  'founders-studio-pair-1600.webp',
  'treatment-wrist-smile-1600.webp',
  'home-exercise-ball-towel-1600.webp',
  'course-montage-rolunk-1600.webp',
  'treatment-table-hands-1600.webp',
] as const

const UJ_SOS_FAJLOK = [
  'sos-band-stretch-1600.webp',
  'sos-ball-squeeze-1600.webp',
  'sos-spiky-ball-forearm-1600.webp',
] as const

/** A WP54-ben előállított fájlok: hosszabbik oldal pontosan 1600 px. */
const WP54_FAJLOK: ReadonlySet<string> = new Set<string>([...UJ_TEAM_FAJLOK, ...UJ_SOS_FAJLOK])

async function manifestEgyezik(dir: 'team' | 'sos', assets: readonly ManifestAsset[]) {
  for (const asset of assets) {
    const file = join(REPO, 'public', 'media', dir, asset.file)
    const bytes = readFileSync(file)
    expect(sha256(bytes), asset.file).toBe(asset.sha256)
    const meta = await sharp(bytes).metadata()
    expect(meta.format, asset.file).toBe('webp')
    expect(meta.width, asset.file).toBe(asset.width)
    expect(meta.height, asset.file).toBe(asset.height)
    if (WP54_FAJLOK.has(asset.file)) {
      // A régebbi (WP-előtti) 1600×2276-os portrék nem e kör termékei.
      expect(Math.max(asset.width, asset.height), asset.file).toBe(1600)
    }
    if (asset.file.endsWith('-1600.webp')) {
      expect(statSync(file).size, asset.file).toBeLessThanOrEqual(MAX_1600_BYTES)
    }
    expect(asset.alt.trim().length, asset.file).toBeGreaterThan(0)
    // Vevői szöveg: natív magyar, gondolatjel-halmozás nélkül.
    expect(asset.alt, asset.file).not.toMatch(/[–—]/)
    expect(asset.sourceId.length, asset.file).toBeGreaterThan(0)
  }
}

describe('WP54/1: a manifestek és a fájlok egyeznek (sha256, méret, plafon)', () => {
  it('team manifest: minden bejegyzés a lemezen lévő webp-t írja le', async () => {
    await manifestEgyezik('team', teamAssets)
    const files = teamAssets.map((asset) => asset.file)
    for (const file of UJ_TEAM_FAJLOK) {
      expect(files).toContain(file)
    }
    // A szerepek és fájlnevek egyediek (az owner-review CLI és a
    // média-helyreállítás is erre épít).
    expect(new Set(files).size).toBe(files.length)
    expect(new Set(teamAssets.map((asset) => asset.role)).size).toBe(teamAssets.length)
  }, 30_000)

  it('sos manifest: a három galéria-fotó fekvő, 3:2, magyar alt-tal', async () => {
    await manifestEgyezik('sos', sosAssets)
    expect(sosAssets.map((asset) => asset.file)).toEqual([...UJ_SOS_FAJLOK])
    expect(sosAssets.map((asset) => asset.alt)).toEqual([
      'Gumiszalagos csuklónyújtás az asztal szélén.',
      'Puha labda szorítása a tenyérben.',
      'Tüskés labdás alkarlazítás.',
    ])
    for (const asset of sosAssets) {
      expect(asset.width, asset.file).toBe(1600)
      expect(asset.height, asset.file).toBe(1067)
    }
  }, 30_000)

  it('a média-helyreállítás kezelt forrásai közt az SOS-fotók is ott vannak', () => {
    const managed = managedMediaAssets()
    for (const file of UJ_SOS_FAJLOK) {
      const asset = managed.find((item) => item.filename === file)
      expect(asset?.directory, file).toBe('sos')
    }
    for (const file of UJ_TEAM_FAJLOK) {
      expect(managed.find((item) => item.filename === file)?.directory, file).toBe('team')
    }
  })

  it('a /rolunk fejléc-képe fekvő 3:2, a két alapító nevével az alt-ban', () => {
    const hero = teamAssets.find((asset) => asset.file === 'founders-studio-pair-1600.webp')
    expect(hero?.width).toBe(1600)
    expect(hero?.height).toBe(1067)
    expect(hero?.alt).toBe('Kocsis Kata és Kiss Kata a stúdióban.')
    expect(hero?.sourceName).toBe('SYL_9156.jpg')
  })

  it('WP54/6: a kezelőasztalos fotó (CMS-ből kötve) fekvő 3:2; 800-as változat NINCS (a Payload méretez)', () => {
    const asset = teamAssets.find((item) => item.file === 'treatment-table-hands-1600.webp')
    expect(asset?.width).toBe(1600)
    expect(asset?.height).toBe(1067)
    expect(asset?.sourceName).toBe('_MG_0033.png')
    expect(asset?.alt).toBe('Csuklókezelés a kezelőasztalon a Kineticare rendelőjében.')
    // A CMS-be töltött fájl a Payload saját méretváltozatait kapja; repóbeli
    // 800-as duplikátum nem kell (átnézés, 2026-09-19).
    expect(existsSync(join(REPO, 'public/media/team/treatment-table-hands-800.webp'))).toBe(false)
    expect(existsSync(join(REPO, 'public/media/team/treatment-wrist-table-800.webp'))).toBe(false)
  })
})

describe('WP54/2: a kezdőlapi Kurzusaink jelenet középső cellája', () => {
  it('a középső fotó a labdás-törölközős gyakorlat 800-as változata, mindhárom fekvő', async () => {
    expect(COURSE_SHOWCASE_SCENE_PHOTOS).toHaveLength(3)
    expect(COURSE_SHOWCASE_SCENE_PHOTOS[1]?.src).toBe(
      '/media/team/home-exercise-ball-towel-800.webp',
    )
    for (const image of COURSE_SHOWCASE_SCENE_PHOTOS) {
      const meta = await sharp(join(REPO, 'public', image.src)).metadata()
      expect(meta.width, image.src).toBe(image.width)
      expect(meta.height, image.src).toBe(image.height)
      // Fekvő, 3:2 közeli (1,45–1,6): a 4:3 cella mindhármat egyformán, szélességben vágja.
      const arany = image.width / image.height
      expect(arany, image.src).toBeGreaterThanOrEqual(1.45)
      expect(arany, image.src).toBeLessThanOrEqual(1.6)
    }
  })

  it('a 800-as változat az 1600-as manifest-fotó kicsinyítése (azonos arány)', async () => {
    const nagy = teamAssets.find((asset) => asset.file === 'home-exercise-ball-towel-1600.webp')
    expect(nagy).toBeDefined()
    const kicsi = await sharp(
      join(REPO, 'public/media/team/home-exercise-ball-towel-800.webp'),
    ).metadata()
    expect(kicsi.width).toBe(800)
    expect(
      Math.abs((nagy?.width ?? 0) / (nagy?.height ?? 1) - 800 / (kicsi.height ?? 1)),
    ).toBeLessThan(0.01)
  })

  it('a cella ablaka a bal széltől 3,1 %-tól látszik: az ujjhegyek (4,1 %) bent maradnak', () => {
    const css = readFileSync(
      join(REPO, 'src/app/(frontend)/styles/blocks/course-showcase.css'),
      'utf8',
    )
    const photo = css.match(/\.kc-course-showcase__photo\s*\{[^}]*\}/)?.[0] ?? ''
    expect(photo).toContain('aspect-ratio: 4 / 3')
    expect(photo).toContain('object-fit: cover')
    expect(photo).toContain('object-position: 25% 50%')
    // 3:2 fotó 4:3 cellában: 12,5 % marad ki; a 25 % ablak bal széle 3,125 %.
    expect(0.125 * 0.25).toBeLessThan(0.041)
  })
})

describe('WP54/3: a /szolgaltatasok rendelői ajtó fotója', () => {
  it('Kiss Kata csuklókezelés közben, álló, a manifest méretével', async () => {
    expect(SZOLGALTATASOK_KEZELES_FOTO.url).toBe('/media/team/treatment-wrist-smile-1600.webp')
    expect(SZOLGALTATASOK_KEZELES_FOTO.alt).toBe('Kiss Kata csuklókezelés közben a rendelőben.')
    const asset = teamAssets.find((item) => item.file === 'treatment-wrist-smile-1600.webp')
    expect(asset?.alt).toBe(SZOLGALTATASOK_KEZELES_FOTO.alt)
    expect(SZOLGALTATASOK_KEZELES_FOTO.width).toBe(asset?.width)
    expect(SZOLGALTATASOK_KEZELES_FOTO.height).toBe(asset?.height)
    const meta = await sharp(join(REPO, 'public', SZOLGALTATASOK_KEZELES_FOTO.url ?? '')).metadata()
    expect(meta.width).toBe(1067)
    expect(meta.height).toBe(1600)
  })
})

// ---------------------------------------------------------------------------
// WP54/4: a /rolunk CTA-sáv montázsa
// ---------------------------------------------------------------------------

function media(overrides: Partial<Media> & { id: number }): Media {
  return {
    alt: '',
    url: `/media/kurzus-${overrides.id}.jpg`,
    width: 1600,
    height: 1200,
    sizes: {
      sm: { url: `/media/kurzus-${overrides.id}-640.jpg`, width: 640, height: 480 },
    },
    updatedAt: '',
    createdAt: '',
    ...overrides,
  } as unknown as Media
}

function product(overrides: Partial<Product> & { id: number }): Product {
  return {
    sku: `Kurzus ${overrides.id}`,
    slug: `kurzus-${overrides.id}`,
    shortDescription: 'Otthon végezhető program.',
    coverImage: null,
    priceInHUF: 19990,
    priceInHUFEnabled: true,
    status: 'published',
    _status: 'published',
    updatedAt: '',
    createdAt: '',
    ...overrides,
  } as unknown as Product
}

const PROGRAM = product({
  id: 1,
  sku: 'Otthoni kézrehab program',
  slug: 'otthoni-kezrehab-program',
  coverImage: media({ id: 1, alt: 'Gyógytornász kézgyakorlatot mutat' }),
})
const BORITO_NELKUL = product({ id: 3, slug: 'borito-nelkul', coverImage: null })

function ctaBlock(url: string | null): BlockCtaBanner {
  return {
    id: 'zaro',
    blockType: 'ctaBanner',
    title: 'Kezdd el otthon, a saját tempódban',
    text: 'Az otthoni programmal a saját tempódban indulhatsz.',
    cta: { felirat: 'Nézd meg a kurzusokat', url, ujAblakban: false },
    sectionSettings: { visible: true, hatter: 'tint' },
  } as unknown as BlockCtaBanner
}

function render(
  layout: NonNullable<Page['layout']>,
  products: Product[],
  ctaBannerMontazs: Media | null = null,
): string {
  return renderToStaticMarkup(
    createElement(RenderBlocks, {
      layout,
      products,
      posts: [],
      testimonials: [],
      ctaBannerMontazs,
    }),
  )
}

const FIGURE = /<figure class="kc-cta-banner__figure">[\s\S]*?<img [^>]*>[\s\S]*?<\/figure>/

describe('WP54/4: a /rolunk CTA-sáv a kurzus-montázst mutatja, a kezdőlap a borítót', () => {
  it('a montázs fájlja 3:2, 1600 széles, három oszlop 8 px fehér hézaggal', async () => {
    const file = join(REPO, 'public/media/team', ROLUNK_CTA_MONTAZS_FILE)
    const asset = teamAssets.find((item) => item.file === ROLUNK_CTA_MONTAZS_FILE)
    expect(asset?.width).toBe(1600)
    expect(asset?.height).toBe(1067)
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
    expect(info.width).toBe(1600)
    // Oszlopok: 528 + 8 + 528 + 8 + 528 = 1600. A hézag közepén (x 530–533 és
    // 1066–1069) minden sor fehér közeli (webp-veszteség: ≥ 240 csatornánként).
    const gapMean = (x0: number, x1: number) => {
      let sum = 0
      let n = 0
      for (let y = 0; y < info.height; y += 7) {
        for (let x = x0; x <= x1; x += 1) {
          const i = (y * info.width + x) * info.channels
          sum += (data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0)
          n += 3
        }
      }
      return sum / n
    }
    expect(gapMean(530, 533)).toBeGreaterThanOrEqual(240)
    expect(gapMean(1066, 1069)).toBeGreaterThanOrEqual(240)
    // Az oszlopok nem üresek: a teljes kép átlaga messze a fehér alatt.
    expect(gapMean(0, info.width - 1)).toBeLessThan(225)
  })

  it('rolunkCtaMontazs(): a manifest fájlja, alt-tal, mérettel', () => {
    const montazs = rolunkCtaMontazs()
    const asset = teamAssets.find((item) => item.file === ROLUNK_CTA_MONTAZS_FILE)
    expect(montazs.url).toBe(`/media/team/${ROLUNK_CTA_MONTAZS_FILE}`)
    expect(montazs.alt).toBe(asset?.alt)
    expect(montazs.width).toBe(asset?.width)
    expect(montazs.height).toBe(asset?.height)
    expect(montazs.alt).not.toMatch(/[–—]/)
  })

  it('resolveCtaBannerFigure: montázs a borító elé, de csak kurzus-célnál', () => {
    const montazs = rolunkCtaMontazs()
    const kinalat = [PROGRAM, BORITO_NELKUL]
    // Kurzuslista és konkrét kurzus: a montázs, a borító címével/útvonalával.
    const lista = resolveCtaBannerFigure('/kurzusok', kinalat, montazs)
    expect(lista?.media.url).toBe(montazs.url)
    expect(lista?.href).toBe('/kurzusok/otthoni-kezrehab-program')
    expect(lista?.title).toBe('Otthoni kézrehab program')
    // Borító nélküli kurzus: a montázs akkor is jár (repó-fájl, nem termékadat).
    const nincsBorito = resolveCtaBannerFigure('/kurzusok/borito-nelkul', kinalat, montazs)
    expect(nincsBorito?.media.url).toBe(montazs.url)
    expect(nincsBorito?.href).toBe('/kurzusok/borito-nelkul')
    expect(resolveCtaBannerCourseCover('/kurzusok/borito-nelkul', kinalat)).toBeNull()
    // Nem kurzus-cél: nincs kép, montázzsal sem.
    for (const url of ['/kapcsolat', 'https://kineticare.hu/kurzusok', '', null, undefined]) {
      expect(resolveCtaBannerFigure(url, kinalat, montazs), String(url)).toBeNull()
    }
    // Montázs nélkül ugyanaz, mint a borító-feloldás.
    expect(resolveCtaBannerFigure('/kurzusok', kinalat)).toEqual(
      resolveCtaBannerCourseCover('/kurzusok', kinalat),
    )
  })

  it('RenderBlocks: a /rolunk-alak a montázst rendereli, a kezdőlap-alak a borítót', () => {
    const layout = [ctaBlock('/kurzusok')] as unknown as NonNullable<Page['layout']>
    const rolunk = render(layout, [PROGRAM], rolunkCtaMontazs())
    const figure = rolunk.match(FIGURE)?.[0] ?? ''
    expect(figure).toContain(ROLUNK_CTA_MONTAZS_FILE)
    expect(figure).not.toContain('kurzus-1-640.jpg')
    expect(figure).toContain(
      'alt="Három gyakorlat az otthoni kurzusból: gumiszalagos csuklónyújtás, puha labda szorítása és tüskés labdás alkarlazítás."',
    )
    // A montázs nem link és nem gomb: a figure-ben nincs <a> és <button>.
    expect(figure).not.toMatch(/<a |<button/)

    const kezdolap = render(layout, [PROGRAM])
    const cover = kezdolap.match(FIGURE)?.[0] ?? ''
    expect(cover).toContain('kurzus-1-640.jpg')
    expect(cover).not.toContain(ROLUNK_CTA_MONTAZS_FILE)

    // Nem kurzus-cél: montázzsal sem kap képet a sáv.
    const kapcsolat = render(
      [ctaBlock('/kapcsolat')] as unknown as NonNullable<Page['layout']>,
      [PROGRAM],
      rolunkCtaMontazs(),
    )
    expect(kapcsolat).not.toMatch(FIGURE)
  })

  it('a [slug] route csak a rolunk slugon adja át a montázst; a kezdőlap route nem', () => {
    const slugRoute = readFileSync(join(REPO, 'src/app/(frontend)/[slug]/page.tsx'), 'utf8')
    expect(slugRoute).toContain("ctaBannerMontazs={slug === 'rolunk' ? rolunkCtaMontazs() : null}")
    const homeRoute = readFileSync(join(REPO, 'src/app/(frontend)/page.tsx'), 'utf8')
    expect(homeRoute).not.toContain('ctaBannerMontazs')
  })
})
