import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { FRIZ_HELY_NEVEK, about } from '../blocks/about'
import { KURZUSAINK_KEPHELYEK, courseCards } from '../blocks/course-cards'
import { PhotoFrieze } from '../components/blocks/PhotoFrieze'
import { CourseShowcase } from '../components/content/home/CourseShowcase'
import { COURSE_SHOWCASE_SCENE_PHOTOS } from '../lib/course-showcase'
import { FRIEZE_PHOTOS } from '../lib/foto-friz'
import { fokuszPozicio, kepHelyMedia } from '../lib/kep-helyek'
import type { Product } from '../payload-types'

/**
 * #12 (2026-09-23): a kezdőlapi mozgó fotósor négy íve és a „Kurzusaink”
 * jelenet három fotója helyenként cserélhető az adminban. Az üres hely a
 * beépített fotót mutatja; a kitöltött hely a CMS-képet, a fókuszpontja
 * szerinti kivágással.
 */

const cmsKep = (id: number, focalX: number | null = 30, focalY: number | null = 70) => ({
  id,
  url: `/api/media/file/sajat-${id}.webp`,
  width: 1600,
  height: 1200,
  alt: `Saját kép ${id}.`,
  focalX,
  focalY,
  sizes: { md: { url: `/api/media/file/sajat-${id}-1280.webp`, width: 1280, height: 960 } },
})

const kurzusok = [1, 2].map(
  (id) =>
    ({
      id,
      sku: `Teszt kurzus ${id}`,
      slug: `teszt-kurzus-${id}`,
      priceInHUF: 19900,
      audience: 'home',
    }) as unknown as Product,
)

describe('kepHelyMedia és fokuszPozicio', () => {
  it('csak URL-lel bíró, feloldott Media-dokumentumot fogad el', () => {
    expect(kepHelyMedia(cmsKep(1))).not.toBeNull()
    expect(kepHelyMedia(null)).toBeNull()
    expect(kepHelyMedia(undefined)).toBeNull()
    expect(kepHelyMedia(42)).toBeNull()
    expect(kepHelyMedia({ id: 3, url: null })).toBeNull()
  })

  it('a fókuszpontból object-position lesz, hiányzó vagy hibás értéknél a közép', () => {
    expect(fokuszPozicio(cmsKep(1, 30, 70))).toBe('30% 70%')
    expect(fokuszPozicio(cmsKep(1, null, null))).toBe('50% 50%')
    expect(fokuszPozicio(cmsKep(1, 140, -3))).toBe('50% 50%')
  })
})

describe('a séma helyei a beépített fotókhoz igazodnak', () => {
  it('a fríz négy helye a négy beépített fotónak felel meg', () => {
    const csoport = about.fields.find((mezo) => 'name' in mezo && mezo.name === 'frieze')
    expect(csoport?.type).toBe('group')
    if (csoport?.type !== 'group') return
    expect(csoport.fields.map((mezo) => ('name' in mezo ? mezo.name : null))).toEqual([
      'photo1',
      'photo2',
      'photo3',
      'photo4',
    ])
    expect(FRIZ_HELY_NEVEK).toHaveLength(FRIEZE_PHOTOS.length)
    csoport.fields.forEach((mezo, index) => {
      expect(mezo.type).toBe('upload')
      if (mezo.type !== 'upload') return
      expect(mezo.required).toBeFalsy()
      expect(mezo.admin?.description).toContain(FRIEZE_PHOTOS[index]?.alt)
    })
  })

  it('a jelenet három helye a három beépített fotónak felel meg', () => {
    const csoport = courseCards.fields.find((mezo) => 'name' in mezo && mezo.name === 'scenePhotos')
    expect(csoport?.type).toBe('group')
    if (csoport?.type !== 'group') return
    expect(csoport.fields.map((mezo) => ('name' in mezo ? mezo.name : null))).toEqual([
      'left',
      'middle',
      'right',
    ])
    expect(KURZUSAINK_KEPHELYEK).toHaveLength(COURSE_SHOWCASE_SCENE_PHOTOS.length)
  })
})

describe('PhotoFrieze helyenként', () => {
  it('üres helyekkel ugyanaz, mint mezők nélkül (a lap nem változik)', () => {
    expect(renderToStaticMarkup(<PhotoFrieze photos={[null, undefined, null, 7]} />)).toBe(
      renderToStaticMarkup(<PhotoFrieze />),
    )
  })

  it('a kitöltött hely a CMS-képet mutatja a fókuszpont szerinti kivágással, a többi a beépített', () => {
    const html = renderToStaticMarkup(<PhotoFrieze photos={[null, cmsKep(9), null, null]} />)
    expect(html).toContain('sajat-9')
    expect(html).toContain('Saját kép 9.')
    expect(html).toContain('--kc-frieze-focus:30% 70%')
    expect(html).not.toContain(FRIEZE_PHOTOS[1]?.file)
    for (const index of [0, 2, 3]) {
      expect(html).toContain(FRIEZE_PHOTOS[index]?.file)
    }
  })
})

describe('CourseShowcase jelenet helyenként', () => {
  it('üres helyekkel ugyanaz, mint mezők nélkül', () => {
    expect(renderToStaticMarkup(<CourseShowcase products={kurzusok} />)).toContain(
      COURSE_SHOWCASE_SCENE_PHOTOS[0]?.src,
    )
    expect(
      renderToStaticMarkup(
        <CourseShowcase products={kurzusok} sceneMedia={[null, undefined, null]} />,
      ),
    ).toBe(renderToStaticMarkup(<CourseShowcase products={kurzusok} />))
  })

  it('a kitöltött hely dekoratív CMS-kép (alt=""), a fókuszpont szerinti kivágással', () => {
    const html = renderToStaticMarkup(
      <CourseShowcase products={kurzusok} sceneMedia={[cmsKep(4, 20, 40), null, null]} />,
    )
    expect(html).toContain('sajat-4')
    expect(html).toContain('object-position:20% 40%')
    expect(html).not.toContain('Saját kép 4.')
    expect(html).not.toContain(COURSE_SHOWCASE_SCENE_PHOTOS[0]?.src)
    expect(html).toContain(COURSE_SHOWCASE_SCENE_PHOTOS[1]?.src)
    expect(html).toContain(COURSE_SHOWCASE_SCENE_PHOTOS[2]?.src)
  })
})
