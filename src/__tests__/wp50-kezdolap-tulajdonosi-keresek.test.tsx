import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderToStaticMarkup } from 'react-dom/server'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import {
  CAPTION_END,
  CAPTION_MID,
  FILM_LINGER,
  FILM_SCROLL,
  FilmHero,
  FOUNDERS_NAMES,
  FOUNDERS_ROLE,
  PINNED,
} from '../components/blocks/FilmHero'
import { PressLogos } from '../components/blocks/PressLogos'
import { CourseShowcase } from '../components/content/home/CourseShowcase'
import { TestimonialsSection } from '../components/content/home/TestimonialsSection'
import { CAPTION_FADE } from '../components/scroll-scrub/scroll-scrub'
import { COURSE_SHOWCASE_SCENE_PHOTOS } from '../lib/course-showcase'
import type { BlockFilmHero, BlockPressLogos, Media, Product, Testimonial } from '../payload-types'

/**
 * WP50 — a tulajdonosok (Kocsis Kata és Kiss Kata) kezdőlapi kéréseinek
 * kód-oldali őre (2026-09-19). Minden pont a tulajdonosi kérés + a mért
 * érték + a forrás hármasán áll (lásd a komponensek és stíluslapok
 * kommentjeit):
 *
 *  1. a kinyíló kéz filmsávja rövidebb: FILM_SCROLL 4,6 → 3,0 képernyő, a két
 *     úszó felirat sávja a tűzött szakaszra skálázva, egymást nem fedik;
 *  2. a két alapító arcképe a H1 fölött (szerző-sor), kis, 3:2-es, keretezett
 *     kép névvel és szereppel, `alt=""` (a név szövegként mellette áll);
 *  3. a vélemények nyitó idézőjele a magyar alsó „ a szöveggel közös
 *     alapvonalon, skálázás nélkül (owner-review-testimonial-alignment.test);
 *  4. a Kurzusaink-jelenet három fotója egyforma rácscella (course-showcase.test);
 *  5. a sajtólogók 41–54%-kal nagyobb keretben (kezdolap-szekcio-redesign.test).
 *
 * MÉRŐ-FIXTURE (opt-in): ha a WP50_FIXTURE_DIR környezeti változó be van
 * állítva, a teszt oda írja a négy szekció statikus HTML-jét, amit a
 * scratchpad Chromium-mérője (playwright-core) a repó stíluslapjaival és
 * betűivel tölt be, és leméri: görgetési távolság a H1 utáni első szekcióig,
 * a CTA hajtás-pozíciója 390×844-en, az idézőjel doboza és alapvonala, a
 * három fotó dobozmérete, a logók mérete 320/1440-en. A CI-ben a változó
 * nincs beállítva, a teszt csak az őr-állításokat futtatja.
 */

const REPO = fileURLToPath(new URL('../..', import.meta.url))

const filmBlock: BlockFilmHero = {
  blockType: 'filmHero',
  ctas: [
    { felirat: 'Nézd meg a kurzusokat', url: '/kurzusok' },
    { felirat: 'Nézd meg ingyenes SOS-kurzusunkat', url: '/#ingyenes' },
  ],
  lead: 'Online videós kézrehabilitációs program otthonra és rendelői kezelés Budapesten.',
  tags: [{ label: 'Kéz' }, { label: 'Csukló' }, { label: 'Könyök' }, { label: 'Váll' }],
  title: 'Hatékony és biztonságos módszerek a kéz és a kar fájdalmai ellen',
}

describe('WP50/1: rövidebb filmsáv', () => {
  it('a scrub 2,5 és 3,0 képernyő közé rövidült (4,6-ról), a lassítás megmaradt', () => {
    expect(FILM_SCROLL).toBeGreaterThanOrEqual(2.5)
    expect(FILM_SCROLL).toBeLessThanOrEqual(3)
    expect(FILM_LINGER).toBe(0.16)
    expect(PINNED).toBeCloseTo((FILM_SCROLL - 1) / FILM_SCROLL, 12)
  })

  it('a középső felirat olvasási sávja legalább 0,36 képernyőnyi, és a két felirat sosem áll egyszerre', () => {
    expect((CAPTION_MID.to - CAPTION_MID.from) * FILM_SCROLL).toBeGreaterThanOrEqual(0.36)
    // A közép kiúszásának vége a záró beúszásának kezdete előtt (a FADE-del).
    expect(CAPTION_MID.to + CAPTION_FADE).toBeLessThanOrEqual(CAPTION_END.from - CAPTION_FADE)
    // A záró felirat még a tűzött szakaszban úszik be (állva olvasható).
    expect(CAPTION_END.from).toBeLessThan(PINNED)
    expect(CAPTION_END.to).toBe(1)
  })

  it('a jelenet sávja a FILM_SCROLL-lal skálázott dvh (ez adja a görgetési távolságot)', () => {
    const html = renderToStaticMarkup(<FilmHero block={filmBlock} />)
    expect(html).toContain(`min-height:${FILM_SCROLL * 100}dvh`)
  })
})

describe('WP50/2: az alapítók arcképe a H1 fölött', () => {
  const html = renderToStaticMarkup(<FilmHero block={filmBlock} />)

  it('szerző-sor: figure + kis kép + név + szerep, a cím ELŐTT, a szöveghasábban', () => {
    const aside = html.indexOf('class="scroll-scrub__aside"')
    const title = html.indexOf('class="scroll-scrub__title"')
    expect(aside).toBeGreaterThan(-1)
    expect(aside).toBeLessThan(title)
    expect(html).toContain('<figure class="kc-film-hero__founders">')
    expect(html).toContain(`class="kc-film-hero__founders-names">${FOUNDERS_NAMES}<`)
    expect(html).toContain(`class="kc-film-hero__founders-role">${FOUNDERS_ROLE}<`)
    // A cím marad az egyetlen H1, a szerző-sor nem címsor.
    expect(html.match(/<h1\b/g)).toHaveLength(1)
    expect(html).not.toMatch(/<h[2-6][^>]*class="kc-film-hero__founders/)
  })

  it('a kép dekoratív (alt=""), a 320/640-es vágatot tölti, nem az 1600-as fájlt', () => {
    const img = html.match(/<img[^>]*kc-film-hero__founders-photo[^>]*>/)?.[0] ?? ''
    expect(img).toContain('alt=""')
    expect(img).toContain('founders-intro-white-hero-320.webp 320w')
    expect(img).toContain('founders-intro-white-hero-640.webp 640w')
    expect(img).toContain('sizes="108px"')
    expect(img).toMatch(/fetchpriority="low"/i)
    expect(html).not.toContain('founders-intro-white-1600')
  })

  it('a vágat fájljai léteznek és 3:2 arányúak (320×213, 640×427)', async () => {
    for (const [file, width, height] of [
      ['founders-intro-white-hero-320.webp', 320, 213],
      ['founders-intro-white-hero-640.webp', 640, 427],
    ] as const) {
      const meta = await sharp(join(REPO, 'public/media/team', file)).metadata()
      expect(meta.width, file).toBe(width)
      expect(meta.height, file).toBe(height)
    }
  })

  it('a névsor nem használ gondolatjelet és csak az S tokenről vesz betűméretet', () => {
    expect(`${FOUNDERS_NAMES} ${FOUNDERS_ROLE}`).not.toMatch(/[–—]/)
    const css = readFileSync(
      join(REPO, 'src/app/(frontend)/styles/blocks/film-hero.css'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '')
    const block = (selector: string) =>
      new RegExp(`${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
    expect(block('.kc-film-hero .kc-film-hero__founders-caption')).toContain(
      'font-size: var(--kc-font-s)',
    )
    const photo = block('.kc-film-hero .kc-film-hero__founders-photo')
    expect(photo).toContain('width: 6.75rem')
    expect(photo).toContain('height: 4.5rem')
    expect(photo).toContain('object-fit: cover')
    expect(photo).toContain('border-radius: var(--kc-radius-lg)')
    expect(photo).toMatch(/var\(--kc-color-navy-900\) 25%/)
    // Rövid mobil nézetben (≤ 700 px magas) a sor elmarad, a CTA-k kapják a helyet.
    expect(css).toMatch(
      /@media \(max-width: 860px\) and \(max-height: 700px\)\s*\{[^@]*\.kc-film-hero \.scroll-scrub__aside\s*\{\s*display: none;/,
    )
  })
})

describe('WP50/4: a Kurzusaink-jelenet fotói', () => {
  it('a három fotó a 800 px-es változat, a fájlok a deklarált mérettel léteznek', async () => {
    expect(COURSE_SHOWCASE_SCENE_PHOTOS).toHaveLength(3)
    for (const image of COURSE_SHOWCASE_SCENE_PHOTOS) {
      expect(image.src).toMatch(/-800\.webp$/)
      const meta = await sharp(join(REPO, 'public', image.src)).metadata()
      expect(meta.width, image.src).toBe(image.width)
      expect(meta.height, image.src).toBe(image.height)
    }
  })
})

describe('WP50/5: a sajtólogók `sizes` attribútuma a nagyobb keretet követi', () => {
  it('192 px mobilon, 20vw középen, 256 px nagy képernyőn; sm forrás', () => {
    const media: Media = {
      id: 1,
      url: '/media/press/tv2.webp',
      alt: 'A TV2 logója',
      width: 600,
      height: 200,
      createdAt: '2026-09-05T00:00:00.000Z',
      updatedAt: '2026-09-05T00:00:00.000Z',
    }
    const block: BlockPressLogos = {
      blockType: 'pressLogos',
      id: 'press',
      logos: [{ image: media }],
    }
    const html = renderToStaticMarkup(<PressLogos block={block} />)
    expect(html).toContain('sizes="(max-width: 960px) 192px, (max-width: 1280px) 20vw, 256px"')
  })
})

// ---------------------------------------------------------------------------
// Mérő-fixture (opt-in, WP50_FIXTURE_DIR)
// ---------------------------------------------------------------------------

const FIXTURE_DIR = process.env.WP50_FIXTURE_DIR

describe.skipIf(!FIXTURE_DIR)('WP50 mérő-fixture', () => {
  const page = (title: string, body: string, blockCss: string[]) =>
    [
      '<!doctype html><html lang="hu"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${title}</title>`,
      ...[
        'tokens',
        'fonts',
        'base',
        'motion',
        'ui',
        'progress',
        'layout',
        'content',
        ...blockCss.map((name) => `blocks/${name}`),
      ].map((name) => `<link rel="stylesheet" href="/styles/${name}.css">`),
      '<link rel="stylesheet" href="/scroll-scrub.css">',
      '</head><body>',
      body,
      '</body></html>',
    ].join('\n')

  it('kiírja a négy szekció statikus HTML-jét', () => {
    if (!FIXTURE_DIR) return
    mkdirSync(FIXTURE_DIR, { recursive: true })

    const press = readFileSync(join(REPO, 'public/media/press/manifest.json'), 'utf8')
    const pressAssets = (
      JSON.parse(press) as {
        assets: { file: string; alt: string; localWidth: number; localHeight: number }[]
      }
    ).assets.map((asset, index): Media => ({
      id: index + 1,
      url: `/media/press/${asset.file}`,
      alt: asset.alt,
      width: asset.localWidth,
      height: asset.localHeight,
      createdAt: '2026-09-05T00:00:00.000Z',
      updatedAt: '2026-09-05T00:00:00.000Z',
    }))
    const pressBlock: BlockPressLogos = {
      blockType: 'pressLogos',
      id: 'press',
      logos: [...pressAssets, ...pressAssets].map((image) => ({ image })),
    }

    const testimonials: Testimonial[] = [
      {
        id: 1,
        featured: true,
        visible: true,
        order: 1,
        authorName: 'Garami Gábor',
        authorTitle: 'zenész',
        quote:
          'Két hét után újra tudtam gitározni. A gyakorlatok rövidek, és pontosan tudtam, mit miért csinálok.',
      },
      {
        id: 2,
        featured: true,
        visible: true,
        order: 2,
        authorName: 'Bagdal Szilvia',
        authorTitle: 'jógaoktató',
        quote: 'A csuklóm hetek óta fájt, a harmadik hét végére elmúlt.',
      },
      {
        id: 3,
        featured: true,
        visible: true,
        order: 3,
        authorName: 'Tóth Anna',
        quote: 'Végre értem, mi történik a kezemben, és mit tehetek érte.',
      },
    ] as Testimonial[]

    const products = [1, 2, 3].map(
      (id) =>
        ({
          id,
          title: `Teszt kurzus ${id}`,
          slug: `teszt-kurzus-${id}`,
          priceInHUF: 19900,
          audience: 'home',
        }) as unknown as Product,
    )

    const header =
      '<header class="kc-site-header" style="position:sticky;top:0;height:var(--kc-header-height);background:var(--kc-color-surface)"></header>'

    writeFileSync(
      join(FIXTURE_DIR, 'hero.html'),
      page(
        'hero',
        `${header}<main>${renderToStaticMarkup(<FilmHero block={filmBlock} />)}<section id="kovetkezo" class="kc-section" style="min-height:40vh"></section></main>`,
        ['film-hero'],
      ),
    )
    writeFileSync(
      join(FIXTURE_DIR, 'testimonials.html'),
      page(
        'testimonials',
        `<main>${renderToStaticMarkup(<TestimonialsSection testimonials={testimonials} />)}</main>`,
        ['testimonials'],
      ),
    )
    writeFileSync(
      join(FIXTURE_DIR, 'showcase.html'),
      page(
        'showcase',
        `<main><section class="kc-section kc-course-showcase-band"><div class="kc-container">${renderToStaticMarkup(<CourseShowcase products={products} />)}</div></section></main>`,
        ['course-showcase'],
      ),
    )
    writeFileSync(
      join(FIXTURE_DIR, 'press.html'),
      page('press', `<main>${renderToStaticMarkup(<PressLogos block={pressBlock} />)}</main>`, [
        'press-logos',
      ]),
    )
    expect(true).toBe(true)
  })
})
