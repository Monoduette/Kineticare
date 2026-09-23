import { readFileSync } from 'node:fs'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RenderBlocks } from '../components/blocks/RenderBlocks'
import { CourseShowcase } from '../components/content/home/CourseShowcase'
import { COURSE_SHOWCASE_HEADING, COURSE_SHOWCASE_LEAD } from '../lib/course-showcase'
import {
  COURSE_SHORT_DESCRIPTION_FIXED,
  COURSE_SHORT_DESCRIPTION_LEFTOVER,
  HOW_IT_WORKS_STEP1_FIXED,
  HOW_IT_WORKS_STEP1_LEFTOVER,
  ROLUNK_ACCORDION_LEFTOVERS,
  ROLUNK_SZEKCIO_LEFTOVERS,
  rewriteVisitorDashLeftover,
} from '../lib/gondolatjel-leftover'
import type { Page, Product } from '../payload-types'

/**
 * A Kurzusaink-sáv (kezdőlapi `courseCards` blokk → CourseShowcase) a
 * szerkesztő lead-szövegét BETŰRE változatlanul adja (A5, 2026-09-22): a
 * megjelenítés nem futtat gondolatjel-cserét a mentett CMS-szövegen. Üres
 * leadnél a beépített `COURSE_SHOWCASE_LEAD` tartalék áll.
 *
 * A látvány élőben nem változik: a production kezdőlap leadje (2026-09-22-i
 * CMS-lekérés, modul-térkép live-pages.json) nem maradék-minta, tehát a
 * korábbi `rewriteVisitorDashLeftover` is változatlanul adta vissza.
 */

/** A production kezdőlap Kurzusaink-leadje, 2026-09-22 (live-pages.json, docs[14].layout[5]). */
const ELO_LEAD =
  'Online kézrehabilitációs kurzusaink lépésről lépésre vezetnek végig az otthoni felépülésen.'

function product(overrides: Partial<Product> & { id: number }): Product {
  return {
    sku: `Kurzus ${overrides.id}`,
    slug: `kurzus-${overrides.id}`,
    audience: 'laikus',
    priceInHUF: 19990,
    priceInHUFEnabled: true,
    status: 'published',
    updatedAt: '',
    createdAt: '',
    ...overrides,
  } as unknown as Product
}

const termekek = [product({ id: 1 }), product({ id: 2, audience: 'szakember' })]

function leadOf(html: string): string | null {
  const talalat = /<p class="kc-course-showcase__lead">([\s\S]*?)<\/p>/.exec(html)
  return talalat?.[1] ?? null
}

const showcaseLead = (lead: string | undefined): string | null =>
  leadOf(renderToStaticMarkup(createElement(CourseShowcase, { products: termekek, lead })))

/** Minden olyan szöveg, amelyet a gondolatjel-csere ÁTÍRNA (pontos egyezésű kulcsok). */
const MARADEK_MINTAK: readonly string[] = [
  HOW_IT_WORKS_STEP1_LEFTOVER,
  COURSE_SHORT_DESCRIPTION_LEFTOVER,
  ...ROLUNK_ACCORDION_LEFTOVERS.map(([regi]) => regi),
  ...ROLUNK_SZEKCIO_LEFTOVERS.map(([regi]) => regi),
]

describe('Kurzusaink-sáv: a lead a szerkesztő szövege, betűre', () => {
  it.each(MARADEK_MINTAK)('maradék-mintát sem ír át: %s', (szoveg) => {
    expect(rewriteVisitorDashLeftover(szoveg)).not.toBe(szoveg)
    expect(showcaseLead(szoveg)).toBe(szoveg)
  })

  it('a javított alakot és bármely más szöveget is változatlanul adja', () => {
    for (const szoveg of [
      HOW_IT_WORKS_STEP1_FIXED,
      COURSE_SHORT_DESCRIPTION_FIXED,
      'Saját bevezető, kettősponttal: és gondolatjellel – ahogy a szerkesztő írta.',
      'Tíz perc naponta. Otthon, a saját tempódban.',
    ]) {
      expect(showcaseLead(szoveg)).toBe(szoveg)
    }
  })

  it('csak a szélső szóközt hagyja el, a belső tagolást nem', () => {
    expect(showcaseLead('  Első mondat.  Második mondat.\n')).toBe('Első mondat.  Második mondat.')
  })

  it.each([undefined, '', '   ', '\n\t '])('üres leadnél a beépített tartalék áll: %j', (lead) => {
    expect(showcaseLead(lead)).toBe(COURSE_SHOWCASE_LEAD)
  })
})

describe('Kurzusaink-sáv: az élő látvány nem változik', () => {
  it('az élő lead nem maradék-minta, a régi és az új megjelenítés betűre azonos', () => {
    expect(MARADEK_MINTAK).not.toContain(ELO_LEAD)
    expect(rewriteVisitorDashLeftover(ELO_LEAD)).toBe(ELO_LEAD)
    expect(showcaseLead(ELO_LEAD)).toBe(ELO_LEAD)
  })

  it('a kezdőlapi courseCards blokk a CMS címét és leadjét adja át, változatlanul', () => {
    const layout = [
      {
        blockType: 'courseCards' as const,
        heading: 'Kurzusaink',
        lead: COURSE_SHORT_DESCRIPTION_LEFTOVER,
        sectionSettings: { visible: true, anchorId: 'kurzusok', hatter: 'feher' as const },
      },
    ] as unknown as NonNullable<Page['layout']>
    const html = renderToStaticMarkup(
      createElement(RenderBlocks, { layout, products: termekek, posts: [], testimonials: [] }),
    )
    expect(html).toContain('<h2 class="kc-course-showcase__heading">Kurzusaink</h2>')
    expect(leadOf(html)).toBe(COURSE_SHORT_DESCRIPTION_LEFTOVER)
    expect(html).not.toContain(COURSE_SHORT_DESCRIPTION_FIXED)
  })

  it('üres CMS-cím és -lead mellett a beépített cím és lead áll', () => {
    const html = renderToStaticMarkup(createElement(CourseShowcase, { products: termekek }))
    expect(html).toContain(
      `<h2 class="kc-course-showcase__heading">${COURSE_SHOWCASE_HEADING}</h2>`,
    )
    expect(leadOf(html)).toBe(COURSE_SHOWCASE_LEAD)
  })

  it('a komponens forrása nem futtat gondolatjel-cserét a leaden', () => {
    const forras = readFileSync(
      new URL('../components/content/home/CourseShowcase.tsx', import.meta.url),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(forras).not.toContain('rewriteVisitorDashLeftover')
    expect(forras).not.toContain('gondolatjel-leftover')
    expect(forras).toContain('const leadText = lead?.trim() || COURSE_SHOWCASE_LEAD')
  })
})
