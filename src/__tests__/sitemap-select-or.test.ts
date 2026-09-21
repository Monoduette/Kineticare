import { describe, expect, it, vi } from 'vitest'

import { SITEMAP_POST_SELECT, SITEMAP_PRODUCT_SELECT } from '../lib/cms'
import { courseHref } from '../lib/course-url'
import { reportUnpricedPublishedCourses, unpricedPublishedCourseIds } from '../lib/courses'
import { categoriesWithPosts, freeCourseHref } from '../lib/tudastar'
import type { Post, Product } from '../payload-types'

/**
 * ŐR — a sitemap SZŰKÍTETT lekérdezéseinek mezőlistája.
 *
 * A `select` a néma hibák tipikus forrása: a lekérdezés lefut, a sitemap
 * felépül, csak éppen hiányzik belőle valami. Két konkrét veszély:
 *  - a `categories` nélkül a nem üres kategória-lapok szűrése üres halmazt
 *    adna, és MINDEN témalap kiesne a sitemapből;
 *  - a `status` / `priceInHUFEnabled` nélkül a beállítatlan ár-pipájú,
 *    publikált kurzusok RIASZTÁSA (`reportUnpricedPublishedCourses`) némán
 *    elhallgatna — pont az a hiba, ami a tulajdonos gomb-hibáját hetekig
 *    elrejtette.
 * Ezért a lista PINNELVE van, és a mezőkre épülő fogyasztók a szűkített
 * dokumentum-alakkal is bizonyítottan működnek.
 */

const postFields = Object.keys(SITEMAP_POST_SELECT).sort()
const productFields = Object.keys(SITEMAP_PRODUCT_SELECT).sort()

/** A szűkített poszt-dokumentum (a Payload az `id`-t select nélkül is adja). */
const SITEMAP_POST = {
  id: 11,
  slug: 'gipsz-utan-mit-csinalj',
  updatedAt: '2026-08-10T10:00:00.000Z',
  status: 'published',
  categories: [1],
} satisfies Pick<Post, 'id' | 'slug' | 'updatedAt' | 'status' | 'categories'>

/** Beállítatlan ár-pipájú, PUBLIKÁLT kurzus — erre kell szólnia a riasztásnak. */
const UNPRICED_PRODUCT = {
  id: 7,
  slug: 'kezrehabilitacio-otthon',
  updatedAt: '2026-08-11T10:00:00.000Z',
  status: 'published',
  priceInHUF: null,
  priceInHUFEnabled: null,
} satisfies Pick<
  Product,
  'id' | 'slug' | 'updatedAt' | 'status' | 'priceInHUF' | 'priceInHUFEnabled'
>

/** Tudatosan ingyenes kurzus (`priceInHUFEnabled: false`). */
const FREE_PRODUCT = {
  id: 9,
  slug: 'sos-kezrelax',
  updatedAt: '2026-08-12T10:00:00.000Z',
  status: 'published',
  priceInHUF: null,
  priceInHUFEnabled: false,
} satisfies Pick<
  Product,
  'id' | 'slug' | 'updatedAt' | 'status' | 'priceInHUF' | 'priceInHUFEnabled'
>

describe('sitemap select — a mezőlista pinnelve', () => {
  it('a poszt-lekérdezés PONTOSAN ezeket a mezőket kéri', () => {
    expect(postFields).toEqual(['categories', 'slug', 'status', 'updatedAt'])
  })

  it('a kurzus-lekérdezés PONTOSAN ezeket a mezőket kéri', () => {
    // WP63: a fizetendő ár az akció mezőitől is függ (coursePriceHuf), ezért
    // a sitemap is kéri őket, hogy a szűkített dokumentum ugyanazt az árat adja.
    expect(productFields).toEqual([
      'coverImage',
      'priceInHUF',
      'priceInHUFEnabled',
      'promoEnabled',
      'promoEnd',
      'promoPriceHuf',
      'promoStart',
      'slug',
      'status',
      'updatedAt',
    ])
  })

  it('minden kért mező BE van kapcsolva (a `false` némán kihagyná)', () => {
    for (const value of Object.values(SITEMAP_POST_SELECT)) {
      expect(value).toBe(true)
    }
    for (const value of Object.values(SITEMAP_PRODUCT_SELECT)) {
      expect(value).toBe(true)
    }
  })
})

describe('sitemap select — a fogyasztók a szűkített alakkal is működnek', () => {
  it('az ÁR-RIASZTÁS útvonala él: a rosszul konfigurált kurzus hangos marad', () => {
    expect(unpricedPublishedCourseIds([UNPRICED_PRODUCT])).toEqual([7])

    const error = vi.fn()
    const ids = reportUnpricedPublishedCourses([UNPRICED_PRODUCT], { error })
    expect(ids).toEqual([7])
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('a riasztáshoz kellő mezők mind benne vannak a selectben (az `id` mindig jön)', () => {
    for (const field of ['status', 'priceInHUFEnabled']) {
      expect(productFields).toContain(field)
    }
  })

  it('a kategória-szűrés a poszt `categories` mezőjéből dolgozik', () => {
    const categories = [
      { id: 1, slug: 'kezrehabilitacio' },
      { id: 2, slug: 'ures-tema' },
    ]
    expect(categoriesWithPosts(categories, [SITEMAP_POST])).toEqual([
      { id: 1, slug: 'kezrehabilitacio' },
    ])
  })

  it('a kanonikus kurzus-cím a `slug`/`id` párosból áll össze', () => {
    expect(courseHref(UNPRICED_PRODUCT)).toBe('/kurzusok/kezrehabilitacio-otthon')
    expect(courseHref({ id: 9, slug: null })).toBe('/kurzusok/9')
  })

  it('az ingyenes kurzus felismerése is a szűkített mezőkből megy', () => {
    expect(freeCourseHref([UNPRICED_PRODUCT, FREE_PRODUCT])).toBe('/kurzusok/sos-kezrelax')
    expect(freeCourseHref([UNPRICED_PRODUCT])).toBeNull()
  })
})
