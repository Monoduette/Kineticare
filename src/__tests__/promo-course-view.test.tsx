import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  PromoCourseView,
  type PromoCourseViewProps,
  type PromoPageSection,
  groupSectionsIntoBands,
  promoFacts,
} from '../components/courses/promo/PromoCourseView'
import type { CourseSalesContent } from '../components/courses/sales-content'
import { resolveCoursePromo } from '../lib/course-promo'
import { checkoutHref, resolveCourseCta } from '../lib/courses'
import type { CurriculumModule } from '../lib/curriculum/curriculum'
import { ctaLabel } from '../lib/cta-vocabulary'
import { formatPriceHuf } from '../lib/format-price'
import type { Product } from '../payload-types'

/**
 * PromoCourseView — az akciós sablon SZERZŐDÉSEI (WP59).
 *  - a szakaszok sorrendje és id-i a rendes kurzusoldaléval azonosak (a
 *    horgony-chipek és a JSON-LD változatlanul működnek);
 *  - a célpont nélküli elem (galéria-kép) az ELŐZŐ sávban marad, a sávok
 *    háttere felváltva default / tint;
 *  - a záró vásárlási sáv CSAK a `buy` ágon jelenik meg (Á-3);
 *  - a ragadós vásárlósáv a hero CTA-blokkját figyeli.
 */

const product = {
  id: 42,
  slug: 'kez-torna',
  status: 'published',
  // WP63: az Ár a rendes (áthúzott) ár, az akciós ár a promoPriceHuf.
  priceInHUF: 99000,
  priceInHUFEnabled: true,
  promoEnabled: true,
  promoPriceHuf: 79500,
  promoEnd: '2026-09-30T00:00:00.000Z',
  accessDurationDays: null,
  coverImage: null,
  relatedProducts: [],
} as unknown as Product

const NOW = new Date('2026-09-20T10:00:00.000Z')

function section(id: string, label: string, text: string): PromoPageSection {
  return { target: { id, label }, node: createElement('section', { id }, text) }
}

const sections: PromoPageSection[] = [
  section('mi-ez', 'Mi ez?', 'LEIRAS'),
  { target: null, node: createElement('figure', { className: 'kc-course-figure' }, 'GALERIA') },
  section('hogyan-mukodik', 'Hogyan működik?', 'LEPESEK'),
  section('tananyag', 'Tananyag', 'MODULOK'),
  section('kinek-valo', 'Kinek való?', 'KINEK'),
  section('garancia', 'Garancia', 'GARANCIA'),
  section('gyik', 'GYIK', 'GYIK'),
]

const modules: CurriculumModule[] = [
  {
    id: 'm1',
    title: 'Alapok',
    summary: null,
    lessons: [{ id: 'l1', title: 'Első', kind: 'video', durationSec: 60 }],
  },
  {
    id: 'm2',
    title: 'Haladó',
    summary: null,
    lessons: [{ id: 'l2', title: 'Második', kind: 'video', durationSec: 60 }],
  },
] as unknown as CurriculumModule[]

const sales: CourseSalesContent = {
  highlights: ['Örökös hozzáférés', '50+ videós gyakorlat'],
  steps: [],
  fitFor: [],
  notFitFor: [],
  guarantee: { title: '30 napos kipróbálási garancia', text: 'Ha nem válik be, visszakapod.' },
  faq: [],
  body: null,
}

function view(overrides: Partial<PromoCourseViewProps> = {}): string {
  const cta = overrides.cta ?? resolveCourseCta(product, false)
  return renderToStaticMarkup(
    createElement(PromoCourseView, {
      audienceLabel: 'Otthoni gyakorlóknak',
      category: 'Kézrehabilitáció',
      cta,
      ctaId: 'kurzus-vasarlas-gomb',
      curriculumModules: modules,
      guaranteeLabel: '30 napos kipróbálási garancia',
      jumpTargets: sections.flatMap((s) => (s.target === null ? [] : [s.target])),
      lead: 'Otthon végezhető kézrehabilitáció.',
      priceHuf: 79500,
      priceLabel: '79 500 Ft',
      product,
      promo: resolveCoursePromo(product, NOW),
      related: [],
      sales,
      sections,
      showBuyBar: cta.kind === 'buy',
      title: 'Otthoni KézRehab Program',
      ...overrides,
    }),
  )
}

function order(html: string, needles: string[]): number[] {
  return needles.map((needle) => {
    const index = html.indexOf(needle)
    expect(index, needle).toBeGreaterThanOrEqual(0)
    return index
  })
}

describe('PromoCourseView — szerkezet', () => {
  it('a szakaszok az eredeti sorrendben és id-kkel, a hero és a chipek után, a záró sáv előtt', () => {
    const html = view()
    const positions = order(html, [
      'kc-promo-hero',
      'Ugrás az oldal szakaszaira',
      'kc-promo-highlights',
      'id="mi-ez"',
      'GALERIA',
      'id="hogyan-mukodik"',
      'id="tananyag"',
      'id="kinek-valo"',
      'id="garancia"',
      'id="gyik"',
      'id="akcios-vasarlas"',
      'kc-course-buybar',
    ])
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('a galéria-kép a leírás sávjában marad, a sávok háttere váltakozik', () => {
    const bands = groupSectionsIntoBands(sections)
    expect(bands.map((band) => band.key)).toEqual([
      'mi-ez',
      'hogyan-mukodik',
      'tananyag',
      'kinek-valo',
      'garancia',
      'gyik',
    ])
    expect(bands[0]?.nodes).toHaveLength(2)
    expect(bands.map((band) => band.variant)).toEqual([
      'default',
      'tint',
      'default',
      'tint',
      'default',
      'tint',
    ])
  })

  it('a hero CTA-blokkja a ragadós sáv horgonya, egyetlen id-vel', () => {
    const html = view()
    expect(html.match(/id="kurzus-vasarlas-gomb"/g)).toHaveLength(1)
    expect(html).toContain('kc-course-buybar')
  })

  it('a fő előnyök sáv a highlights-ból épül', () => {
    const html = view()
    expect(html).toContain('A kurzus fő előnyei')
    expect(html).toContain('50+ videós gyakorlat')
    expect(view({ sales: { ...sales, highlights: [] } })).not.toContain('kc-promo-highlights')
  })
})

describe('PromoCourseView — záró vásárlási sáv', () => {
  it('buy ágon: cím, áthúzott rendes ár és akciós ár, ugyanaz a gomb, garancia', () => {
    const html = view()
    expect(html).toContain('Kezdd el az akciós áron')
    expect(html.split(`<s>${formatPriceHuf(99000)}</s>`).length - 1).toBe(2)
    expect(html).toContain(
      `<span class="kc-visually-hidden">Akciós ár: </span>${formatPriceHuf(79500)}`,
    )
    expect(html.split(`href="${checkoutHref(42)}"`).length - 1).toBeGreaterThanOrEqual(2)
    expect(html.split(ctaLabel('course-buy')).length - 1).toBeGreaterThanOrEqual(2)
    expect(html).toContain('kc-promo-closing__guarantee')
  })

  it('akciós ár nélkül nincs áthúzott összeg, a rendes ár a fizetendő', () => {
    const noPromoPrice = { ...product, promoPriceHuf: null } as Product
    const html = view({
      product: noPromoPrice,
      promo: resolveCoursePromo(noPromoPrice, NOW),
      priceHuf: 99000,
      priceLabel: formatPriceHuf(99000),
    })
    expect(html).not.toContain('<s>')
    expect(html).toContain(
      `<span class="kc-visually-hidden">Akciós ár: </span>${formatPriceHuf(99000)}`,
    )
  })

  it('purchased ágon nincs záró sáv és nincs ragadós sáv', () => {
    const html = view({ cta: resolveCourseCta(product, true), showBuyBar: false })
    expect(html).not.toContain('id="akcios-vasarlas"')
    expect(html).not.toContain('kc-course-buybar')
    expect(html).toContain('Már megvetted ezt a kurzust')
  })

  it('archivált ágon nincs záró sáv, nincs gomb', () => {
    const archived = { ...product, status: 'archived' } as Product
    const html = view({ cta: resolveCourseCta(archived, false), showBuyBar: false })
    expect(html).not.toContain('id="akcios-vasarlas"')
    expect(html).not.toContain('/penztar')
  })
})

describe('promoFacts', () => {
  it('modul- és leckeszám, hozzáférés — ellenőrizhető tényadatok', () => {
    expect(promoFacts(modules, null)).toEqual(['2 modul', '2 lecke'])
    expect(promoFacts(modules.slice(0, 1), 365)).toEqual(['1 lecke', '365 napos hozzáférés'])
  })
})

/** A `ReactNode` típus importja szándékos: a szekció-leíró szerződését rögzíti. */
export type _SectionNode = ReactNode
