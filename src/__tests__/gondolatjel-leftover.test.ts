import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { HowItWorks, type HowItWorksProps } from '../components/content/home/HowItWorks'
import { ProductCard } from '../components/content/ProductCard'
import { CourseCard } from '../components/courses/CourseCard'
import { buildHomeLayout } from '../lib/home-seed'
import {
  COURSE_SHORT_DESCRIPTION_FIXED,
  COURSE_SHORT_DESCRIPTION_LEFTOVER,
  HOW_IT_WORKS_STEP1_FIXED,
  HOW_IT_WORKS_STEP1_LEFTOVER,
  rewriteVisitorDashLeftover,
} from '../lib/gondolatjel-leftover'
import { courseJsonLd, productSeoDoc } from '../lib/seo'
import type { Product } from '../payload-types'

/**
 * Élő kezdőlap gondolatjel-maradék (mért 2026-09-06). A seed már vesszős;
 * a CMS-t a seed nem írja felül. A látogatói felület a két pontos egyezést
 * vesszőre cseréli; más szöveget nem.
 */

function render(node: ReactNode): string {
  return renderToStaticMarkup(createElement(Fragment, null, node))
}

function product(shortDescription: string): Product {
  return {
    id: 7,
    slug: 'otthoni-kezrehab-program',
    sku: 'Otthoni KézRehab Program',
    displayTitle: 'Otthoni KézRehab Program',
    shortDescription,
    category: 1,
    cardHighlights: [{ id: 'a', text: '50+ videós gyakorlat' }],
    coverImage: {
      id: 3,
      alt: 'Borító',
      url: '/media/borito.webp',
      width: 1200,
      height: 800,
      updatedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    priceInHUF: 79500,
    priceInHUFEnabled: true,
    accessDurationDays: 365,
    audience: 'laikus',
    status: 'published',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('rewriteVisitorDashLeftover — a két élő maradék', () => {
  it('a how-it-works leftover U+2014, a kurzus-lead leftover U+2013', () => {
    expect(HOW_IT_WORKS_STEP1_LEFTOVER).toContain('\u2014')
    expect(HOW_IT_WORKS_STEP1_LEFTOVER).not.toContain('\u2013')
    expect(COURSE_SHORT_DESCRIPTION_LEFTOVER).toContain('\u2013')
    expect(COURSE_SHORT_DESCRIPTION_LEFTOVER).not.toContain('\u2014')
  })

  it('a javított mondatokban nincs töltelék gondolatjel, a csukló- kiskötőjel megmarad', () => {
    expect(HOW_IT_WORKS_STEP1_FIXED).not.toMatch(/[–—]/)
    expect(COURSE_SHORT_DESCRIPTION_FIXED).not.toMatch(/[–—]/)
    expect(COURSE_SHORT_DESCRIPTION_FIXED).toContain('csukló-, ujj-')
    expect(rewriteVisitorDashLeftover(HOW_IT_WORKS_STEP1_LEFTOVER)).toBe(HOW_IT_WORKS_STEP1_FIXED)
    expect(rewriteVisitorDashLeftover(COURSE_SHORT_DESCRIPTION_LEFTOVER)).toBe(
      COURSE_SHORT_DESCRIPTION_FIXED,
    )
  })

  it('más mondatot, hyphenes szóösszetételt és a már javított szöveget nem nyúlja', () => {
    expect(rewriteVisitorDashLeftover(HOW_IT_WORKS_STEP1_FIXED)).toBe(HOW_IT_WORKS_STEP1_FIXED)
    expect(rewriteVisitorDashLeftover(COURSE_SHORT_DESCRIPTION_FIXED)).toBe(
      COURSE_SHORT_DESCRIPTION_FIXED,
    )
    expect(rewriteVisitorDashLeftover('csukló-, ujj-, alkar- és könyökfájdalmakra')).toBe(
      'csukló-, ujj-, alkar- és könyökfájdalmakra',
    )
    expect(rewriteVisitorDashLeftover(` ${HOW_IT_WORKS_STEP1_LEFTOVER}`)).toBe(
      ` ${HOW_IT_WORKS_STEP1_LEFTOVER}`,
    )
  })
})

describe('HowItWorks — CMS leftover em dash', () => {
  it('a beépített lépés már a vesszős mondat', () => {
    const html = render(createElement(HowItWorks))
    expect(html).toContain(HOW_IT_WORKS_STEP1_FIXED)
    expect(html).not.toContain('\u2014')
  })

  it('a production CMS-mondatot vesszőre cseréli, a többi lépést nem', () => {
    const props: HowItWorksProps = {
      steps: [
        { title: 'Kiválasztod a kurzust', text: HOW_IT_WORKS_STEP1_LEFTOVER },
        { title: 'Azonnal hozzáférsz', text: 'A videós anyagokat a fiókodban éred el.' },
      ],
    }
    const html = render(createElement<HowItWorksProps>(HowItWorks, props))
    expect(html).toContain(HOW_IT_WORKS_STEP1_FIXED)
    expect(html).not.toContain('\u2014')
    expect(html).toContain('A videós anyagokat a fiókodban éred el.')
  })
})

describe('kurzuskártya lead — CMS leftover en dash', () => {
  it('a kezdőlapi kártyán vesszőre cseréli, a csukló- kötőjelet meghagyja', () => {
    const html = render(
      createElement(ProductCard, { product: product(COURSE_SHORT_DESCRIPTION_LEFTOVER) }),
    )
    expect(html).toContain(COURSE_SHORT_DESCRIPTION_FIXED)
    expect(html).not.toContain('\u2013')
    expect(html).toContain('csukló-, ujj-')
  })

  it('a /kurzusok listakártyán ugyanazt a mondatot cseréli', () => {
    const html = render(
      createElement(CourseCard, { product: product(COURSE_SHORT_DESCRIPTION_LEFTOVER) }),
    )
    expect(html).toContain(COURSE_SHORT_DESCRIPTION_FIXED)
    expect(html).not.toContain('\u2013')
  })

  it('más rövid leírást nem nyúl', () => {
    const html = render(
      createElement(ProductCard, { product: product('Otthon végezhető program.') }),
    )
    expect(html).toContain('Otthon végezhető program.')
  })
})

describe('seed és SEO a javított mondattal egyezik', () => {
  it('a home-seed howItWorks első lépése a vesszős mondat', () => {
    const how = buildHomeLayout().find((blokk) => blokk.blockType === 'howItWorks')
    const elso = how?.blockType === 'howItWorks' ? how.steps?.[0]?.text : null
    expect(elso).toBe(HOW_IT_WORKS_STEP1_FIXED)
  })

  it('a kurzus JSON-LD leírása a látható, vesszős mondatot viszi', () => {
    const doc = product(COURSE_SHORT_DESCRIPTION_LEFTOVER)
    expect(productSeoDoc(doc).excerpt).toBe(COURSE_SHORT_DESCRIPTION_FIXED)
    expect(
      courseJsonLd({
        product: doc,
        name: 'Otthoni KézRehab Program',
        path: '/kurzusok/otthoni-kezrehab-program',
        priceHuf: 79500,
      }).description,
    ).toBe(COURSE_SHORT_DESCRIPTION_FIXED)
  })
})
