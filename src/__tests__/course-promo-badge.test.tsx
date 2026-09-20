import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ProductCard } from '../components/content/ProductCard'
import { CourseShowcase } from '../components/content/home/CourseShowcase'
import { CourseCard } from '../components/courses/CourseCard'
import {
  CoursePromoBadge,
  PROMO_BADGE_ACCESSIBLE_NAME,
  PROMO_BADGE_LABEL,
  promoAccessibleNamePrefix,
} from '../components/courses/CoursePromoBadge'
import type { Product } from '../payload-types'

/**
 * WP60 (2026-09-20): az „Akció” címke a kurzuskártyákon. Élő akciónál a
 * címke megjelenik (látható szó + képernyőolvasó-név), kikapcsolt vagy
 * lejárt akciónál NEM. A három kártya (CourseCard, ShowcaseCard, ProductCard)
 * ugyanabból az egy szabályból dönt (src/lib/course-promo.ts).
 */

const NOW = new Date('2026-09-20T12:00:00.000Z')

function render(node: ReactNode): string {
  return renderToStaticMarkup(createElement(Fragment, null, node))
}

function product(promo: Partial<Product> = {}): Product {
  return {
    id: 4,
    sku: 'Otthoni KézRehab Program',
    slug: 'otthoni-kezrehab-program',
    displayTitle: 'Otthoni KézRehab Program',
    shortDescription: 'Otthon végezhető program.',
    status: 'published',
    priceInHUFEnabled: true,
    priceInHUF: 79500,
    audience: 'home',
    updatedAt: '2026-09-01T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...promo,
  } as Product
}

const ELO = {
  promoEnabled: true,
  promoStart: '2026-09-01T00:00:00.000Z',
  promoEnd: '2026-09-30T00:00:00.000Z',
}
const LEJART = {
  promoEnabled: true,
  promoStart: '2026-08-01T00:00:00.000Z',
  promoEnd: '2026-08-31T00:00:00.000Z',
}
const KIKAPCSOLT = {
  promoEnabled: false,
  promoStart: '2026-09-01T00:00:00.000Z',
  promoEnd: '2026-09-30T00:00:00.000Z',
}

describe('CoursePromoBadge', () => {
  it('ingyenes vagy archivált kurzuson élő időablak mellett sincs címke (a kártya és az oldal egyet mond)', () => {
    const ingyenes = product({ ...ELO, priceInHUFEnabled: false })
    const archivalt = product({ ...ELO, status: 'archived' })
    expect(render(createElement(CoursePromoBadge, { now: NOW, product: ingyenes }))).toBe('')
    expect(render(createElement(CoursePromoBadge, { now: NOW, product: archivalt }))).toBe('')
    expect(promoAccessibleNamePrefix(ingyenes, NOW)).toBe('')
    expect(promoAccessibleNamePrefix(archivalt, NOW)).toBe('')
  })

  it('élő akciónál látható „Akció” szó és „Akciós kurzus” felolvasott név', () => {
    const html = render(createElement(CoursePromoBadge, { product: product(ELO), now: NOW }))
    expect(html).toContain('kc-promo-badge')
    expect(html).toContain(`aria-hidden="true">${PROMO_BADGE_LABEL}<`)
    expect(html).toContain(`kc-visually-hidden">${PROMO_BADGE_ACCESSIBLE_NAME}<`)
  })

  it('a látható szó a felolvasott név eleje (WCAG 2.2 SC 2.5.3)', () => {
    expect(PROMO_BADGE_ACCESSIBLE_NAME.startsWith(PROMO_BADGE_LABEL)).toBe(true)
    expect(PROMO_BADGE_LABEL).not.toMatch(/[–—]/u)
    expect(PROMO_BADGE_ACCESSIBLE_NAME).not.toMatch(/[–—]/u)
  })

  it('kikapcsolt vagy lejárt akciónál nem renderel semmit', () => {
    for (const eset of [KIKAPCSOLT, LEJART, {}]) {
      expect(render(createElement(CoursePromoBadge, { product: product(eset), now: NOW }))).toBe('')
    }
  })

  it('a link-név előtagja csak élő akciónál nem üres', () => {
    expect(promoAccessibleNamePrefix(product(ELO), NOW)).toBe('Akciós kurzus: ')
    expect(promoAccessibleNamePrefix(product(LEJART), NOW)).toBe('')
    expect(promoAccessibleNamePrefix(product(KIKAPCSOLT), NOW)).toBe('')
  })
})

describe('kurzuskártyák: a címke csak élő akciónál', () => {
  it('CourseCard (kapcsolódó kurzusok sáv): élő akciónál a cím felett a címke', () => {
    const elo = render(createElement(CourseCard, { product: product(ELO) }))
    expect(elo).toContain('kc-promo-badge')
    expect(elo.indexOf('kc-promo-badge')).toBeLessThan(elo.indexOf('kc-course-card__title'))
    expect(elo).toContain(PROMO_BADGE_ACCESSIBLE_NAME)
    for (const eset of [KIKAPCSOLT, LEJART]) {
      expect(render(createElement(CourseCard, { product: product(eset) }))).not.toContain(
        'kc-promo-badge',
      )
    }
  })

  it('CourseShowcase (kezdőlap és /kurzusok): a címke a felirat élén, a link nevében az előtag', () => {
    const elo = render(
      createElement(CourseShowcase, { products: [product(ELO)], scenePhotos: false }),
    )
    expect(elo).toContain('kc-promo-badge')
    expect(elo).toContain('aria-label="Akciós kurzus: Otthoni KézRehab Program:')
    // A címke a link belsejében dekoratív: a nevet a link viszi, nem hangzik el kétszer.
    expect(elo).not.toContain(`kc-visually-hidden">${PROMO_BADGE_ACCESSIBLE_NAME}<`)
    const lejart = render(
      createElement(CourseShowcase, { products: [product(LEJART)], scenePhotos: false }),
    )
    expect(lejart).not.toContain('kc-promo-badge')
    expect(lejart).toContain('aria-label="Otthoni KézRehab Program:')
  })

  it('ProductCard (kezdőlapi kurzus-kiemelés): a címke a címkesorban, a link nevében az előtag', () => {
    const elo = render(createElement(ProductCard, { product: product(ELO) }))
    expect(elo).toContain('kc-promo-badge')
    expect(elo).toContain(
      'aria-label="Akciós kurzus: Otthoni KézRehab Program: a kurzus részletei"',
    )
    const ki = render(createElement(ProductCard, { product: product(KIKAPCSOLT) }))
    expect(ki).not.toContain('kc-promo-badge')
    expect(ki).toContain('aria-label="Otthoni KézRehab Program: a kurzus részletei"')
  })

  it('a kártyán nincs határidő-szöveg (a „meddig” a kurzusoldalé)', () => {
    const elo = render(createElement(CourseCard, { product: product(ELO) }))
    expect(elo).not.toMatch(/-ig\b/u)
    expect(elo).not.toContain('szeptember')
  })
})
