import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RenderBlocks } from '../components/blocks/RenderBlocks'
import { COURSE_SHOWCASE_MARK } from '../lib/course-showcase'
import type { Page, Product } from '../payload-types'

/**
 * ŐR — a Kurzuskártyák blokk Háttérfelirata (courseCards.hatterFelirat,
 * modul-térkép H22). A RenderBlocks a kitöltött mezőt adja a CourseShowcase
 * vízjelének; üresen vagy csupa szóközzel a beépített „Kurzusaink” marad.
 */

type Layout = NonNullable<Page['layout']>

function vizjel(hatterFelirat: string | null | undefined): string | null {
  const html = renderToStaticMarkup(
    createElement(RenderBlocks, {
      layout: [
        {
          blockType: 'courseCards',
          id: 'cc1',
          ...(hatterFelirat === undefined ? {} : { hatterFelirat }),
          sectionSettings: {},
        },
      ] as unknown as Layout,
      // Kurzus nélkül a sáv nem renderel (CourseShowcase), ezért egy fizetős kurzus.
      products: [
        {
          id: 1,
          sku: 'Kéztorna alapok',
          slug: 'keztorna-alapok',
          shortDescription: 'Otthon végezhető program.',
          coverImage: null,
          priceInHUF: 19990,
          priceInHUFEnabled: true,
          status: 'published',
          updatedAt: '',
          createdAt: '',
        } as unknown as Product,
      ],
      posts: [],
      testimonials: [],
    }),
  )
  return /<p class="kc-course-showcase__word">([^<]*)<\/p>/.exec(html)?.[1] ?? null
}

describe('Kurzusaink: a Háttérfelirat a vízjelben', () => {
  it('a beépített felirat a „Kurzusaink”', () => {
    expect(COURSE_SHOWCASE_MARK).toBe('Kurzusaink')
  })

  it('kitöltve a szerkesztő felirata áll a vízjelben', () => {
    expect(vizjel('Tanulj')).toBe('Tanulj')
  })

  it.each([undefined, null, '', '   '])('üresen (%o) a „Kurzusaink”', (ertek) => {
    expect(vizjel(ertek)).toBe(COURSE_SHOWCASE_MARK)
  })
})
