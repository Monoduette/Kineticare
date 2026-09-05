import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FreeSos, resolveFreeSosCta } from '../components/content/home/FreeSos'
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

describe('H04/P03: informatív CMS-fotó, szerkeszthető tartalom, ingyenes jelzés', () => {
  it('az ingyenes sáv fizetős felülírás mellett is az ingyenes termékre visz', () => {
    const html = renderToStaticMarkup(
      createElement(FreeSos, { freeProduct, cta: { href: '/kurzusok/fizetos' } }),
    )
    expect(html).toContain('>Ingyenes</span>')
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
      expect(html).toContain(`alt="${photo.alt}"`)
    }
  })

  it('a kép nem aria-hidden részfában van, az alt és a CMS-szövegek megmaradnak', () => {
    const html = renderToStaticMarkup(
      createElement(FreeSos, {
        freeProduct,
        backgroundImage: photo,
        title: 'Saját SOS-cím',
        body: 'Megmutatjuk a gyakorlatokat.',
      }),
    )
    expect(html).toContain(`alt="${photo.alt}"`)
    expect(html).not.toMatch(/<[^>]*aria-hidden="true"[^>]*class="kc-free-sos__art"/)
    expect(html).toContain('Saját SOS-cím')
    expect(html).toContain('Megmutatjuk a gyakorlatokat.')
    expect(html).toContain('>Ingyenes</span>')
    expect(html).toContain('kc-button--secondary')
  })

  it.each([undefined, null, {}])('kép nélkül nincs üres képhasáb: %j', (backgroundImage) => {
    const html = renderToStaticMarkup(createElement(FreeSos, { freeProduct, backgroundImage }))
    expect(html).not.toContain('kc-free-sos__art')
    expect(html).not.toContain('kc-free-sos--with-image')
  })

  it('a sizes és a CSS ugyanazon, inkluzív 900 px-es törésponttal vált', () => {
    const html = renderToStaticMarkup(
      createElement(FreeSos, { freeProduct, backgroundImage: photo }),
    )
    const sizes = /\bsizes="([^"]+)"/.exec(html)?.[1]
    expect(sizes).toBe('(min-width: 900px) 44vw, 100vw')
    const css = readFileSync(
      new URL('../app/(frontend)/styles/blocks/free-sos.css', import.meta.url),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toContain('@media (min-width: 900px)')
    expect(css).not.toMatch(/\.kc-free-sos__art\s*\{[^}]*display:\s*none/)
    expect(css).not.toContain('linear-gradient')
  })
})
