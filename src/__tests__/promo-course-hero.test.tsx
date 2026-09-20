import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PromoHero, type PromoHeroProps } from '../components/courses/promo/PromoHero'
import { promoLastDayIso, promoUntilLabel } from '../components/courses/promo/promo-date'
import { checkoutHref, myCoursePlayerHref, resolveCourseCta } from '../lib/courses'
import { ctaLabel } from '../lib/cta-vocabulary'
import { formatPriceHuf } from '../lib/format-price'
import type { Product } from '../payload-types'

/**
 * PromoHero — az akciós kurzusoldal fejlécének SZERZŐDÉSEI (WP59).
 *  - az áthúzott eredeti ár CSAK akkor jelenik meg, ha van (course-promo.ts
 *    csak a tényleges árnál nagyobb eredeti árat adja tovább);
 *  - a két összeg előtt vizuálisan rejtett címke áll („Eredeti ár:",
 *    „Akciós ár:"), mert az áthúzás önmagában nem közvetít jelentést
 *    (WCAG 2.2 SC 1.3.1);
 *  - a CTA-ágak a resolveCourseCta állapotgépét követik: `buy` → gomb a
 *    pénztárba, `purchased` → a lejátszó gombja + magyarázat, nem cselekvő
 *    ág → csak a magyarázat, gomb nélkül (Á-3);
 *  - a jelzés statikus dátum („szeptember 30-ig"), nem visszaszámláló.
 */

const buyable = { id: 42, slug: 'kez-torna', status: 'published', priceInHUF: 79500, priceInHUFEnabled: true } as Pick<
  Product,
  'id' | 'slug' | 'status' | 'priceInHUF' | 'priceInHUFEnabled'
>

function hero(overrides: Partial<PromoHeroProps> = {}): string {
  return renderToStaticMarkup(
    createElement(PromoHero, {
      audienceLabel: 'Otthoni gyakorlóknak',
      categoryLabel: 'Kézrehabilitáció',
      cta: resolveCourseCta(buyable, false),
      ctaId: 'kurzus-vasarlas-gomb',
      facts: ['4 modul', '32 lecke', 'Örökös hozzáférés'],
      guaranteeLabel: '30 napos kipróbálási garancia',
      hasCurriculum: true,
      heroMedia: null,
      lead: 'Otthon végezhető kézrehabilitáció.',
      originalPriceHuf: 99000,
      priceHuf: 79500,
      title: 'Otthoni KézRehab Program',
      untilLabel: 'szeptember 30-ig',
      ...overrides,
    }),
  )
}

describe('PromoHero — ár-sor', () => {
  it('az eredeti ár áthúzva, mindkét összeg előtt képernyőolvasó-címkével', () => {
    const html = hero()
    expect(html).toContain(`<span class="kc-visually-hidden">Eredeti ár: </span><s>${formatPriceHuf(99000)}</s>`)
    expect(html).toContain(`<span class="kc-visually-hidden">Akciós ár: </span>${formatPriceHuf(79500)}`)
    expect(html).toContain('egyszeri díj, további költség nincs')
  })

  it('eredeti ár nélkül nincs áthúzott összeg, az akciós ár címkéje marad', () => {
    const html = hero({ originalPriceHuf: null })
    expect(html).not.toContain('<s>')
    expect(html).not.toContain('Eredeti ár:')
    expect(html).toContain(`<span class="kc-visually-hidden">Akciós ár: </span>${formatPriceHuf(79500)}`)
  })

  it('a jelzés statikus dátum; vég nélkül csak „Akciós ár"', () => {
    expect(hero()).toContain('<p class="kc-promo-hero__badge">Akciós ár szeptember 30-ig</p>')
    expect(hero({ untilLabel: null })).toContain('<p class="kc-promo-hero__badge">Akciós ár</p>')
  })
})

describe('PromoHero — CTA-ágak', () => {
  it('buy: a pénztár gombja a szótári felirattal, a ragadós sáv horgonyával', () => {
    const html = hero()
    expect(html).toContain('id="kurzus-vasarlas-gomb"')
    expect(html).toContain(`href="${checkoutHref(42)}"`)
    expect(html).toContain(`>${ctaLabel('course-buy')}</a>`)
    expect(html).toContain('kc-button--primary')
    expect(html).not.toContain('Már megvetted')
  })

  it('purchased: a lejátszó gombja másodlagos súllyal és a „már megvetted" mondat', () => {
    const html = hero({ cta: resolveCourseCta(buyable, true) })
    expect(html).toContain(`href="${myCoursePlayerHref(42)}"`)
    expect(html).toContain(`>${ctaLabel('course-start')}</a>`)
    expect(html).toContain('Már megvetted ezt a kurzust. A lejátszóban éred el.')
    expect(html).not.toContain(checkoutHref(42))
  })

  it('archivált: nincs gomb, csak a magyarázó mondat', () => {
    const cta = resolveCourseCta({ ...buyable, status: 'archived' }, false)
    const html = hero({ cta })
    expect(cta.note).not.toBeNull()
    expect(html).toContain(cta.note as string)
    expect(html).not.toContain('kc-button--primary')
    expect(html).not.toContain('/penztar')
  })

  it('másodlagos ugrás: tananyag-gomb, ha van tananyag; különben egyetlen gomb marad', () => {
    expect(hero()).toContain(`href="#tananyag"`)
    expect(hero()).toContain(ctaLabel('course-modules-jump'))
    const fallback = hero({ hasCurriculum: false })
    expect(fallback).not.toContain('href="#tananyag"')
    expect(fallback.match(/<a class="kc-button /g)).toHaveLength(1)
  })

  it('bizalmi sor: a garancia és a tényadatok', () => {
    const html = hero()
    expect(html).toContain('30 napos kipróbálási garancia')
    expect(html).toContain('4 modul')
    expect(html).toContain('Örökös hozzáférés')
  })
})

describe('akció-dátum segédek', () => {
  const promo = { end: new Date('2026-09-30T22:00:00.000Z') }
  it('ragozott, pont nélküli utolsó nap és ISO dátum Budapest szerint', () => {
    expect(promoUntilLabel(promo)).toBe('szeptember 30-ig')
    expect(promoLastDayIso(promo)).toBe('2026-09-30')
  })
  it('vég nélkül null', () => {
    expect(promoUntilLabel({ end: null })).toBeNull()
    expect(promoLastDayIso({ end: null })).toBeNull()
  })
})
