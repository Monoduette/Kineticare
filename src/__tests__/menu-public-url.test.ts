import { describe, expect, it } from 'vitest'

import { buildMenuPublicUrl, normalizeOrigin } from '../lib/menu-public-url'
import { resolveMenuHref } from '../lib/menu-tree'
import type { Menu, Page, Post, Product } from '../payload-types'

/**
 * A „Rejtett link" doboz link-feloldása (src/lib/menu-public-url.ts).
 *
 * A lényegi állítás: a doboz UGYANAZT a relatív címet adja, mint a navigáció
 * (`resolveMenuHref`), csak abszolút alakban és piszkozat-jelzéssel. Ha a
 * kettő elcsúszna, a szerkesztő olyan linket másolna ki, amit a menü sosem ad.
 */

const ORIGIN = 'https://kineticare.hu'

const publishedPage = { id: 10, slug: 'rolunk', status: 'published' } as unknown as Page
const draftPage = { id: 11, slug: 'vazlat', status: 'draft' } as unknown as Page
const post = { id: 5, slug: 'alapok', status: 'published' } as unknown as Post
const product = { id: 7, slug: 'kez-torna', status: 'published' } as unknown as Product
const legacyProduct = { id: 8, status: 'published' } as unknown as Product

describe('normalizeOrigin', () => {
  it('a záró perjelet és az útvonalat levágja, az eredet marad', () => {
    expect(normalizeOrigin('https://kineticare.hu/')).toBe('https://kineticare.hu')
    expect(normalizeOrigin('  http://localhost:3000/admin  ')).toBe('http://localhost:3000')
  })

  it('üres, hibás vagy nem http(s) eredet → null', () => {
    expect(normalizeOrigin('')).toBeNull()
    expect(normalizeOrigin(undefined)).toBeNull()
    expect(normalizeOrigin('kineticare.hu')).toBeNull()
    expect(normalizeOrigin('javascript:alert(1)')).toBeNull()
  })
})

describe('buildMenuPublicUrl', () => {
  it('page: /{slug}, abszolút alakban, published jelzéssel', () => {
    const result = buildMenuPublicUrl(
      { type: 'page', ref: { relationTo: 'pages', value: publishedPage } },
      ORIGIN,
    )
    expect(result).toEqual({
      kind: 'ready',
      href: '/rolunk',
      absoluteUrl: 'https://kineticare.hu/rolunk',
      targetPublished: true,
    })
  })

  it('page piszkozat: a link elkészül, de targetPublished: false', () => {
    const result = buildMenuPublicUrl(
      { type: 'page', ref: { relationTo: 'pages', value: draftPage } },
      ORIGIN,
    )
    expect(result).toMatchObject({ kind: 'ready', href: '/vazlat', targetPublished: false })
  })

  it('post: /blog/{slug}', () => {
    const result = buildMenuPublicUrl(
      { type: 'post', ref: { relationTo: 'posts', value: post } },
      ORIGIN,
    )
    expect(result).toMatchObject({ absoluteUrl: 'https://kineticare.hu/blog/alapok' })
  })

  it('product: a kanonikus kurzus-cím (slug, ennek hiányában id)', () => {
    expect(
      buildMenuPublicUrl(
        { type: 'product', ref: { relationTo: 'products', value: product } },
        ORIGIN,
      ),
    ).toMatchObject({ absoluteUrl: 'https://kineticare.hu/kurzusok/kez-torna' })
    expect(
      buildMenuPublicUrl(
        { type: 'product', ref: { relationTo: 'products', value: legacyProduct } },
        ORIGIN,
      ),
    ).toMatchObject({ absoluteUrl: 'https://kineticare.hu/kurzusok/8' })
  })

  it('url: gyökér-relatív cím az eredetre illesztve, külső cím változatlanul', () => {
    expect(buildMenuPublicUrl({ type: 'url', url: '/kapcsolat' }, `${ORIGIN}/`)).toMatchObject({
      absoluteUrl: 'https://kineticare.hu/kapcsolat',
      targetPublished: null,
    })
    expect(buildMenuPublicUrl({ type: 'url', url: 'https://pelda.hu/x' }, ORIGIN)).toMatchObject({
      absoluteUrl: 'https://pelda.hu/x',
    })
  })

  it('url: tiltott séma vagy üres webcím → null (a safe-url allowlist)', () => {
    expect(buildMenuPublicUrl({ type: 'url', url: 'javascript:alert(1)' }, ORIGIN)).toBeNull()
    expect(buildMenuPublicUrl({ type: 'url', url: '//idegen.hu' }, ORIGIN)).toBeNull()
    expect(buildMenuPublicUrl({ type: 'url', url: '' }, ORIGIN)).toBeNull()
  })

  it('nem populált ref (csak azonosító) → needs-target, a hívó tölti be a célt', () => {
    expect(
      buildMenuPublicUrl({ type: 'page', ref: { relationTo: 'pages', value: 10 } }, ORIGIN),
    ).toEqual({ kind: 'needs-target', relationTo: 'pages', id: 10 })
  })

  it('hiányzó cél, ismeretlen típus vagy típusidegen collection → null', () => {
    expect(buildMenuPublicUrl({ type: 'page', ref: null }, ORIGIN)).toBeNull()
    expect(buildMenuPublicUrl({ type: 'valami', url: '/x' }, ORIGIN)).toBeNull()
    expect(
      buildMenuPublicUrl(
        { type: 'page', ref: { relationTo: 'media', value: publishedPage } },
        ORIGIN,
      ),
    ).toBeNull()
  })

  it('érvénytelen origin → null, még jó céllal is', () => {
    expect(buildMenuPublicUrl({ type: 'url', url: '/x' }, undefined)).toBeNull()
  })

  it('a relatív href megegyezik a navigáció feloldásával (WCAG 2.2 SC 3.2.4)', () => {
    const menus: Menu[] = [
      { id: 1, label: 'Oldal', type: 'page', ref: { relationTo: 'pages', value: publishedPage } },
      { id: 2, label: 'Cikk', type: 'post', ref: { relationTo: 'posts', value: post } },
      { id: 3, label: 'Kurzus', type: 'product', ref: { relationTo: 'products', value: product } },
      { id: 4, label: 'Külső', type: 'url', url: 'https://pelda.hu/x' },
    ].map((menu) => ({ ...menu, updatedAt: '', createdAt: '' }) as Menu)
    for (const menu of menus) {
      const result = buildMenuPublicUrl(menu, ORIGIN)
      expect(result?.kind).toBe('ready')
      expect(result && result.kind === 'ready' ? result.href : null).toBe(resolveMenuHref(menu))
    }
  })
})
