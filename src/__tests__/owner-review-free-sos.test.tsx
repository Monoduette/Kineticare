import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FREE_SOS_STRIP_TITLE,
  FreeSos,
  resolveFreeSosCta,
} from '../components/content/home/FreeSos'
import { ctaLabel } from '../lib/cta-vocabulary'
import type { Product } from '../payload-types'

const freeProduct = {
  id: 2,
  slug: 'sos-kezrelax-villamkurzus',
  displayTitle: 'SOS Kézrelax',
  status: 'published',
  _status: 'published',
  priceInHUFEnabled: false,
} as Product

const photo = {
  url: '/media/owner-review-fixture.webp',
  width: 1200,
  height: 800,
  alt: 'Két gyógytornász a rendelőben',
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Hálózat tiltva a komponens-tesztben')
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('P03: ingyenesség csak az ismert ingyenes kurzushoz', () => {
  it.each([
    '/kurzusok/sos-kezrelax-villamkurzus',
    '/kurzusok/sos-kezrelax-villamkurzus/',
    '/kurzusok/sos-kezrelax-villamkurzus?utm_source=teszt#igenyles',
    '/kurzusok/2',
  ])('ismert cél: %s', (href) => {
    expect(resolveFreeSosCta(freeProduct, { href, newTab: true })).toEqual({
      href,
      newTab: true,
      label: ctaLabel('free-course-claim'),
    })
  })

  it.each([
    '/kurzusok/fizetos',
    '/kurzusok/masik-ingyenes-kurzus',
    '/kurzusok/23',
    '/kurzusok/sos-kezrelax-masolat',
    '/kurzusok/sos-kezrelax/../fizetos',
    '/kurzusok/%73os-kezrelax',
  ])('nem bizonyított cél: %s', (href) => {
    const cta = resolveFreeSosCta(freeProduct, { href, newTab: true, label: 'Elindítom ingyen' })
    expect(cta).toEqual({
      href: '/kurzusok/sos-kezrelax-villamkurzus',
      newTab: false,
      label: ctaLabel('free-course-claim'),
    })
  })

  it('termék nélkül egy ismertnek hangzó URL sem bizonyíték', () => {
    expect(
      resolveFreeSosCta(null, { href: '/kurzusok/sos-kezrelax-villamkurzus', newTab: true }),
    ).toEqual({
      href: '/kurzusok',
      newTab: false,
      label: ctaLabel('course-list-open'),
    })
  })

  it.each([
    { priceInHUFEnabled: true, priceInHUF: 10000 },
    { priceInHUFEnabled: true, priceInHUF: null },
    { priceInHUFEnabled: undefined },
    { status: 'draft' as const },
    { _status: 'draft' as const },
    { _status: null },
    { _status: undefined },
    { slug: 'masik-ingyenes' },
    { slug: null },
  ])('a prop neve nem helyettesíti az ingyenes, publikált állapotot: %j', (overrides) => {
    const product = { ...freeProduct, ...overrides }
    expect(resolveFreeSosCta(product).label).not.toBe(ctaLabel('free-course-claim'))
    expect(resolveFreeSosCta(product, { href: '/kurzusok/sos-kezrelax-villamkurzus' })).toEqual({
      href: '/kurzusok',
      newTab: false,
      label: ctaLabel('course-list-open'),
    })
  })

  it.each([
    'javascript:alert(1)',
    '//example.invalid/kurzusok/sos-kezrelax',
    '/kurzusok/\\example.invalid',
    '/kurzusok/sos\n-kezrelax',
  ])('nem biztonságos felülírás helyett a bizonyított alapcél: %s', (href) => {
    expect(resolveFreeSosCta(freeProduct, { href }).href).toBe(
      '/kurzusok/sos-kezrelax-villamkurzus',
    )
  })
})

describe('WP26/P03: kompakt, kép nélküli sáv; ingyenes jelzés csak az ismert ingyenes kurzushoz', () => {
  it('az ingyenes sáv fizetős felülírás mellett is az ingyenes termékre visz', () => {
    const html = renderToStaticMarkup(
      createElement(FreeSos, { freeProduct, cta: { href: '/kurzusok/fizetos' } }),
    )
    expect(html).toContain(`>${FREE_SOS_STRIP_TITLE}</h2>`)
    expect(html).toContain('href="/kurzusok/sos-kezrelax-villamkurzus"')
    expect(html).not.toContain('/kurzusok/fizetos')
  })

  it.each([
    null,
    { ...freeProduct, status: 'draft' as const },
    { ...freeProduct, _status: 'draft' as const },
    { ...freeProduct, _status: null },
    { ...freeProduct, _status: undefined },
    { ...freeProduct, status: 'archived' as const },
    { ...freeProduct, priceInHUFEnabled: true, priceInHUF: 10000 },
    { ...freeProduct, priceInHUFEnabled: undefined },
    { ...freeProduct, slug: 'masik-ingyenes' },
    { ...freeProduct, slug: null },
  ])('elérhető ingyenes termék nélkül a teljes ajánlat semleges: %j', (product) => {
    for (const cmsCopy of [{}, { title: 'Ingyenes SOS', body: 'Indítsd el ingyen!' }]) {
      const html = renderToStaticMarkup(
        createElement(FreeSos, {
          freeProduct: product,
          ...cmsCopy,
          cta: { href: '/kurzusok/fizetos', label: 'Kérem ingyen', newTab: true },
          backgroundImage: photo,
        }),
      )
      expect(html).toContain('>Kurzusaink</h2>')
      expect(html).toContain('href="/kurzusok"')
      expect(html).toContain(ctaLabel('course-list-open'))
      expect(html).not.toMatch(/Ingyenes|ingyen!|Elindítom ingyen|SOS|Kérem ingyen/)
      expect(html).not.toContain('/kurzusok/fizetos')
      expect(html).not.toContain('target="_blank"')
      expect(html).not.toContain('kc-free-sos__kicker')
      expect(html).not.toContain('<img')
    }
  })

  /**
   * WP26 (tulajdonos, 2026-09-07): „‚Ingyenes villámkurzus’ nagyon rövid
   * leírással, benne a gomb ugyanúgy, és hogy ez ingyenes.” A cím rögzített
   * (a CMS-cím inaktív, mert az élő érték kvirtmínuszt tartalmaz, §3.1); a
   * kurzus neve a felvezető sorban, a rács kártyájával azonos forrásból
   * (WCAG 2.2 SC 3.2.4); a szöveg a CMS-é; a gomb a §3.2 #4 szótári alak.
   */
  it('a sáv címe rögzített, a CMS-cím (gondolatjellel is) nem jelenik meg', () => {
    for (const title of ['Saját SOS-cím', 'SOS Kézrelax — ingyenes villámkurzus', undefined]) {
      const html = renderToStaticMarkup(
        createElement(FreeSos, { freeProduct, title, body: 'Megmutatjuk a gyakorlatokat.' }),
      )
      expect(html).toContain(`>${FREE_SOS_STRIP_TITLE}</h2>`)
      if (title) expect(html).not.toContain(title)
      expect(html).not.toContain('\u2014')
      expect(html).not.toContain('\u2013')
      expect(html).toContain('class="kc-free-sos__kicker">SOS Kézrelax</p>')
      expect(html).toContain('Megmutatjuk a gyakorlatokat.')
      expect(html).toContain(`${ctaLabel('free-course-claim')} <span aria-hidden="true">→</span>`)
      expect(html).toContain('kc-button--secondary')
    }
  })

  it('a felvezető sor a displayTitle → sku láncból jön; mindkettő nélkül elmarad', () => {
    const skuOnly = renderToStaticMarkup(
      createElement(FreeSos, { freeProduct: { ...freeProduct, displayTitle: null, sku: 'SKU-név' } }),
    )
    expect(skuOnly).toContain('class="kc-free-sos__kicker">SKU-név</p>')
    const nameless = renderToStaticMarkup(
      createElement(FreeSos, { freeProduct: { ...freeProduct, displayTitle: null, sku: ' ' } }),
    )
    expect(nameless).not.toContain('kc-free-sos__kicker')
    expect(nameless).toContain(`>${FREE_SOS_STRIP_TITLE}</h2>`)
  })

  it('a szekciót a saját címsora nevezi meg (landmark), a horgony az id-ből jön', () => {
    const html = renderToStaticMarkup(createElement(FreeSos, { freeProduct }))
    expect(html).toContain('aria-labelledby="ingyenes-cim"')
    expect(html).toContain('id="ingyenes-cim"')
    expect(html).toContain('id="ingyenes"')
  })

  it.each([undefined, null, {}, photo])(
    'kép SOHA nem kerül a sávba, akkor sem, ha a CMS ad fotót: %j',
    (backgroundImage) => {
      const html = renderToStaticMarkup(createElement(FreeSos, { freeProduct, backgroundImage }))
      expect(html).not.toContain('<img')
      expect(html).not.toContain('kc-free-sos__art')
      expect(html).not.toContain('kc-free-sos--with-image')
      expect(html).not.toContain(photo.url)
    },
  )

  it('a CSS-ben nincs kép-hasáb, háttérkép, animáció vagy átmenet; a szegély a 32 px-es token', () => {
    const css = readFileSync(
      new URL('../app/(frontend)/styles/blocks/free-sos.css', import.meta.url),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).not.toContain('kc-free-sos__art')
    expect(css).not.toContain('linear-gradient')
    expect(css).not.toContain('background-image')
    expect(css).not.toMatch(/\b(transition|animation|transform)\s*:/)
    expect(css).toMatch(
      /\.kc-section\.kc-free-sos\s*\{[^}]*padding-block:\s*var\(--kc-space-6\)/,
    )
    expect(css).toMatch(/\.kc-free-sos__layout\s*\{[^}]*flex-wrap:\s*wrap/)
  })
})
