import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CourseShowcase } from '../components/content/home/CourseShowcase'
import {
  COURSE_SHOWCASE_HEADING,
  COURSE_SHOWCASE_LEAD,
  COURSE_SHOWCASE_MARK,
  COURSE_SHOWCASE_SCENE_PHOTOS,
  showcaseFallbackAt,
  splitEditorialTitle,
} from '../lib/course-showcase'
import { ctaLabel } from '../lib/cta-vocabulary'
import type { Product } from '../payload-types'

function product(overrides: Partial<Product> & { id: number }): Product {
  return {
    sku: `Kurzus ${overrides.id}`,
    audience: 'laikus',
    priceInHUF: 19990,
    priceInHUFEnabled: true,
    status: 'published',
    updatedAt: '',
    createdAt: '',
    ...overrides,
  } as unknown as Product
}

function render(node: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(node)
}

describe('splitEditorialTitle', () => {
  it('az első vessző utáni tagot dőltre választja', () => {
    expect(splitEditorialTitle('A place, imagined.')).toEqual({
      head: 'A place,',
      tail: 'imagined.',
    })
  })

  it('vessző nélkül a teljes címet a főágon hagyja', () => {
    expect(splitEditorialTitle('Kézrehab')).toEqual({ head: 'Kézrehab', tail: null })
  })
})

describe('CourseShowcase', () => {
  it('üres listán semmit nem renderel', () => {
    expect(render(createElement(CourseShowcase, { products: [] }))).toBe('')
  })

  it('egy galéria, audience kickerben, ár a kártyán, Kurzusaink vízjel', () => {
    const html = render(
      createElement(CourseShowcase, {
        products: [
          product({ id: 1, sku: 'Otthoni program', slug: 'otthoni', audience: 'laikus' }),
          product({ id: 2, sku: 'Szakmai képzés', slug: 'pro', audience: 'szakember' }),
        ],
      }),
    )
    expect(html).toContain('kc-course-showcase')
    expect(html).toContain(COURSE_SHOWCASE_HEADING)
    expect(html).toContain(COURSE_SHOWCASE_MARK)
    expect(html).toContain('Otthoni gyakorlóknak')
    expect(html).toContain('Szakembereknek')
    expect(html).toContain('/kurzusok/otthoni')
    expect(html).toContain('/kurzusok/pro')
    expect(html).not.toContain('id="otthoni"')
    expect(html).not.toContain('id="szakembereknek"')
  })

  it('WP19: a kártya alján szótári hívás áll egy span-ben, a link az egész kártya (nincs beágyazott gomb)', () => {
    const html = render(
      createElement(CourseShowcase, {
        scenePhotos: false,
        products: [
          product({ id: 1, sku: 'Fizetős', slug: 'fizetos' }),
          product({
            id: 2,
            sku: 'SOS',
            slug: 'sos-kezrelax-villamkurzus',
            priceInHUF: null,
            priceInHUFEnabled: false,
          }),
        ],
      }),
    )
    expect(html).toContain(
      `class="kc-course-showcase__cta">${ctaLabel('course-sales-open')}</span>`,
    )
    expect(html).toContain(
      `class="kc-course-showcase__cta">${ctaLabel('free-course-claim')}</span>`,
    )
    expect(html).toContain(`aria-label="Fizetős: ${ctaLabel('course-sales-open')}"`)
    expect(html).not.toContain('<button')
    expect(html.match(/<a\b/g)).toHaveLength(2)
  })

  it('borító nélkül a csapatportré-tartalékot teszi be', () => {
    const html = render(
      createElement(CourseShowcase, { scenePhotos: false, products: [product({ id: 1 })] }),
    )
    expect(html).toContain(showcaseFallbackAt(0).src)
    // A tartalék fotó `cover`-t kap (a packshot-doboz `contain`-je csíkot adna).
    expect(html).toContain('kc-course-showcase__media kc-course-showcase__media--photo')
  })

  /**
   * ŐR — a 2026-09-07-i mért hiba: a vízjel a lead bekezdésre csúszott és
   * átfedte („Online kézrehabilitációs kurzusaink…” + „Kurzusaink”), a
   * jelenet-fotók pedig a kártya alatt lebegtek bélyegként. A jelenet (vízjel +
   * fotók) azóta KÜLÖN, aria-hidden színpad a rács és a lead KÖZÖTT: a DOM-
   * sorrend rács → jelenet → lead, és a vízjel meg a lead sosem egy elemben.
   */
  it('DOM-sorrend: rács → jelenet (vízjel + fotók) → lead; a vízjel nem a lead-ben áll', () => {
    const html = render(createElement(CourseShowcase, { products: [product({ id: 1 })] }))
    const grid = html.indexOf('kc-course-showcase__grid')
    const scene = html.indexOf('kc-course-showcase__scene')
    const word = html.indexOf('kc-course-showcase__word')
    const photo = html.indexOf('kc-course-showcase__photo')
    const lead = html.indexOf('kc-course-showcase__lead')
    expect(grid).toBeGreaterThanOrEqual(0)
    expect(scene).toBeGreaterThan(grid)
    expect(word).toBeGreaterThan(scene)
    expect(photo).toBeGreaterThan(word)
    expect(lead).toBeGreaterThan(photo)
    // A jelenet dekoratív: a képernyőolvasó a lead-et olvassa, a vízjelet nem.
    expect(html).toMatch(/<div aria-hidden="true" class="kc-course-showcase__scene"/)
    expect(html).toContain(`class="kc-course-showcase__lead">${COURSE_SHOWCASE_LEAD}</p>`)
    expect(html).not.toContain(`${COURSE_SHOWCASE_LEAD}${COURSE_SHOWCASE_MARK}`)
    for (const image of COURSE_SHOWCASE_SCENE_PHOTOS) {
      expect(html).toContain(`src="${image.src}"`)
    }
    // Takarítás (2026-09-19): a halott indexelt osztály és a `data-drift`
    // attribútum nem renderel; a fotó egyetlen osztálya a rács-cella.
    expect(html).not.toMatch(/kc-course-showcase__photo--\d/)
    expect(html).not.toContain('data-drift')
    expect(html).toContain('class="kc-course-showcase__photo"')
  })

  it('1 terméknél a rács data-count="1", három fölött legfeljebb 3', () => {
    const one = render(createElement(CourseShowcase, { products: [product({ id: 1 })] }))
    expect(one).toContain('class="kc-course-showcase__grid" data-count="1"')
    const four = render(
      createElement(CourseShowcase, {
        products: [product({ id: 1 }), product({ id: 2 }), product({ id: 3 }), product({ id: 4 })],
      }),
    )
    expect(four).toContain('class="kc-course-showcase__grid" data-count="3"')
  })

  it('jelenet-fotók nélkül (kurzuslista) a jelenet csak a vízjelet viszi, fotó nélkül', () => {
    const html = render(
      createElement(CourseShowcase, { scenePhotos: false, products: [product({ id: 1 })] }),
    )
    expect(html).toContain('kc-course-showcase__scene')
    expect(html).toContain('kc-course-showcase__word')
    expect(html).not.toContain('kc-course-showcase__photo')
  })

  it('vízjel és jelenet-fotók nélkül nincs jelenet, a lead akkor is a rács után áll', () => {
    const html = render(
      createElement(CourseShowcase, {
        scenePhotos: false,
        mark: null,
        products: [product({ id: 1 })],
      }),
    )
    expect(html).not.toContain('kc-course-showcase__scene')
    expect(html.indexOf('kc-course-showcase__lead')).toBeGreaterThan(
      html.indexOf('kc-course-showcase__grid'),
    )
  })
})

describe('course-showcase.css — token- és jelenet-őr', () => {
  const css = readFileSync(
    fileURLToPath(new URL('../app/(frontend)/styles/blocks/course-showcase.css', import.meta.url)),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '')

  /** Egy szelektor blokkjának törzse (az első találat). */
  const blokk = (szelektor: string): string => {
    const m = new RegExp(`${szelektor.replace(/[.[\]()*+?]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)
    if (!m) throw new Error(`hiányzó szabály: ${szelektor}`)
    return m[1]
  }

  it('900 px-en három hasáb; a három betűméret-token mind jelen van', () => {
    expect(css).toContain('repeat(3, minmax(0, 1fr))')
    expect(css).toContain('font-size: var(--kc-font-l)')
    expect(css).toContain('font-size: var(--kc-font-m)')
    expect(css).toContain('font-size: var(--kc-font-s)')
    expect(css).not.toMatch(/font-size:(?!\s*var\(--kc-font-[lms]\))/)
  })

  it('1 termék: desktopon a kártya legfeljebb a rács felét kapja (nem teljes szélességű óriáskártya)', () => {
    expect(blokk(".kc-course-showcase__grid[data-count='1']")).toMatch(
      /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    )
    expect(blokk(".kc-course-showcase__grid[data-count='2']")).toMatch(
      /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    )
    // A kártya képaránya fekvő 3/2 (tulajdonosi kérés 2026-09-19: kisebb kép,
    // több kurzusnál is áttekinthető rács); nem álló 3/4 és nem 16/9 (az az élő
    // borítókat csonkolta, lásd a következő őrt).
    expect(blokk('.kc-course-showcase__media')).toMatch(/aspect-ratio:\s*3 \/ 2/)
    expect(css).not.toContain('aspect-ratio: 3 / 4')
    expect(css).not.toContain('aspect-ratio: 16 / 9')
  })

  /**
   * ŐR — design-átvétel 2026-09-19 (cover-crop.png): a 16/9 + `cover` az élő
   * kurzusborítókat (átlátszó packshotok, 1080×750 és 1080×880, a rajz a
   * keret széléig ér) csonkolta. A doboz `contain`-ben mutatja a képet, és a
   * két élő aránynál a festett kép sosem nagyobb a doboznál.
   */
  it('az élő borító-arányok (1080×750, 1080×880) a 3/2-es dobozban contain-ben nem vágódnak', () => {
    const media = blokk('.kc-course-showcase__media')
    const img = blokk('.kc-course-showcase__media img')
    expect(img).toContain('object-fit: contain')
    expect(img).not.toContain('object-fit: cover')
    const arany = /aspect-ratio:\s*(\d+) \/ (\d+)/.exec(media)
    if (!arany) throw new Error('hiányzó aspect-ratio a __media dobozon')
    const doboz = { w: 300 * Number(arany[1]), h: 300 * Number(arany[2]) }
    for (const [w, h] of [
      [1080, 750],
      [1080, 880],
    ]) {
      const kepArany = w / h
      const dobozArany = doboz.w / doboz.h
      // contain: a nagyobbik oldal éri el a doboz élét, a másik kisebb marad.
      const festett =
        kepArany > dobozArany
          ? { w: doboz.w, h: doboz.w / kepArany }
          : { w: doboz.h * kepArany, h: doboz.h }
      expect(festett.w).toBeLessThanOrEqual(doboz.w + 1e-9)
      expect(festett.h).toBeLessThanOrEqual(doboz.h + 1e-9)
      // 3/2 mellett a kép a doboz szélességének legalább 80 %-át kitölti
      // (16/9-nél a 1080×880 csak 69 %-ot adna): nem „bélyeg a keretben".
      expect(festett.w / doboz.w).toBeGreaterThanOrEqual(0.8)
    }
  })

  it('a vízjel L token + scale, egy sorban, egyedi --kc- tulajdonsággal méretezve; a színpad vág', () => {
    const word = blokk('.kc-course-showcase__word')
    expect(word).toContain('font-size: var(--kc-font-l)')
    expect(word).toMatch(/transform:\s*scale\(var\(--kc-showcase-mark-scale\)\)/)
    expect(word).toContain('white-space: nowrap')
    expect(word).toMatch(/color:\s*color-mix\(in srgb, var\(--kc-color-accent-quiet\)/)
    // `clip`, nem `hidden`: a hidden görgető-konténer lenne, és a view() idővonal
    // ahhoz kötné a fotókat, nem a nézetablakhoz (mérve 2026-09-07).
    expect(blokk('.kc-course-showcase__scene')).toContain('overflow: clip')
    // A scale lépcsői a konténerhez mérve nőnek (320 → 1440), sosem egy fix szám.
    const lepcsok = [...css.matchAll(/--kc-showcase-mark-scale:\s*([\d.]+)/g)].map((m) =>
      Number(m[1]),
    )
    expect(lepcsok.length).toBeGreaterThanOrEqual(4)
    expect([...lepcsok].sort((a, b) => a - b)).toEqual(lepcsok)
  })

  it('WP50: a jelenet három EGYFORMA, statikus fotócella (nincs dőlés, átfedés, mozgás)', () => {
    const scene = blokk('.kc-course-showcase__scene')
    expect(scene).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/)
    const photo = blokk('.kc-course-showcase__photo')
    expect(photo).toMatch(/aspect-ratio:\s*4 \/ 3/)
    expect(photo).toContain('object-fit: cover')
    // Az álló középső fotón a kéz a kép alsó harmadában van: az ablak az alsó
    // élhez zár (design-átvétel 2026-09-19; a 35 % a kezet vágta le).
    expect(photo).toContain('object-position: 50% 100%')
    expect(photo).toContain('width: 100%')
    expect(photo).not.toMatch(/position:\s*absolute|rotate|animation|translate/)
    // A vízjel a fotók fölött, a teljes sorban.
    expect(blokk('.kc-course-showcase__word')).toMatch(/grid-column:\s*1 \/ -1/)
    // Az Astra-féle döntött, görgetéshez kötött kompozíció nem szivárog vissza.
    expect(css).not.toMatch(/rotate\(|animation-timeline|@keyframes|__photo--[012]\s*\{/)
    expect(css).not.toContain('kc-course-showcase-drift')
    expect(css).not.toContain('infinite')
  })

  it('a lead a jelenet alatt középre zárt, mértéke tokenről', () => {
    const lead = blokk('.kc-course-showcase__lead')
    expect(lead).toContain('text-align: center')
    expect(lead).toContain('max-width: var(--kc-measure-comfort)')
  })
})

describe('bekötés — egy galéria, nem két sáv', () => {
  it('a /kurzusok oldal CourseShowcase-t renderel, nem két CourseAudienceBand-et', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../app/(frontend)/kurzusok/page.tsx', import.meta.url)),
      'utf8',
    )
    expect(source).toContain('CourseShowcase')
    expect(source).not.toContain('CourseAudienceBand')
    expect(source).not.toContain('AUDIENCE_BANDS')
  })

  it('a kezdőlap fallback és a CMS courseCards blokk a galériát kapja', () => {
    const home = readFileSync(
      fileURLToPath(new URL('../components/content/HomeView.tsx', import.meta.url)),
      'utf8',
    )
    const blocks = readFileSync(
      fileURLToPath(new URL('../components/blocks/RenderBlocks.tsx', import.meta.url)),
      'utf8',
    )
    expect(home).toContain('<CourseShowcase')
    expect(blocks).toContain('<CourseShowcase')
    expect(home).not.toContain('<CourseCards')
    expect(blocks).not.toContain('<CourseCards')
  })
})
