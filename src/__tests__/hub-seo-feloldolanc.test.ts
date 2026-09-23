import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Page, Post } from '../payload-types'

/**
 * ŐR — A GYÖKÉR TÜNET-HUB META ÉS JSON-LD EGY FELOLDÓLÁNCBÓL (H05, A20).
 *
 * A hub metája az Oldalból, a WebPage-séma leírása és az Article kulcsszavai
 * korábban a Blogbejegyzésből jöttek; ma a párok azonosak, de egy
 * szerkesztés szétválasztotta volna őket. A közös lánc: src/lib/hub-seo.ts.
 * A teszt a route-ot rendereli (mockolt CMS, adatbázis és hálózat nélkül),
 * és a kész HTML JSON-LD-jét veti össze a generateMetadata kimenetével.
 */

const h = vi.hoisted(() => ({
  page: null as unknown,
  post: null as unknown,
}))

vi.mock('next/headers', () => ({ draftMode: async () => ({ isEnabled: false }) }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound')
  },
  usePathname: () => '/',
}))
vi.mock('@/lib/cms', () => ({
  getPageBySlug: async () => h.page,
  getPostBySlug: async () => h.post,
  getRelatedPosts: async () => [],
  getFreeProduct: async () => null,
  getPublishedPageSlugs: async () => new Set<string>(),
  getPublishedProducts: async () => [],
  getLatestPosts: async () => [],
  getTestimonials: async () => [],
}))
vi.mock('@/lib/tudastar-lathatosag', () => ({ getTudastarLathato: async () => true }))
vi.mock('@/lib/contact-email-server', async () => {
  const { KAPCSOLATI_EMAIL_TARTALEK } = await import('../lib/contact-email')
  return { getContactEmail: async () => KAPCSOLATI_EMAIL_TARTALEK }
})

const { hubSeoForras } = await import('../lib/hub-seo')
const { buildPageMetadata, resolveSeoDescription, resolveSeoKeywords } = await import('../lib/seo')
const { HUB_OLDALAK } = await import('../lib/tudastar/hub-oldalak')
const route = await import('../app/(frontend)/[slug]/page')

const HUB = HUB_OLDALAK[0]!
const props = { params: Promise.resolve({ slug: HUB.slug }) }

const sorok = (...phrases: string[]) => phrases.map((phrase, i) => ({ id: String(i), phrase }))

function lexikai(szoveg: string) {
  return {
    root: {
      type: 'root',
      version: 1,
      direction: 'ltr',
      format: '',
      indent: 0,
      children: [
        {
          type: 'paragraph',
          version: 1,
          direction: 'ltr',
          format: '',
          indent: 0,
          children: [{ type: 'text', version: 1, text: szoveg, format: 0 }],
        },
      ],
    },
  }
}

function oldal(overrides: Partial<Page> = {}): Page {
  return {
    id: 11,
    title: 'Hub oldal címe',
    slug: HUB.slug,
    status: 'published',
    excerpt: 'Az oldal kivonata.',
    seoDescription: 'Az oldal SEO-leírása, amely a meta leírás forrása.',
    seoKeywords: sorok('oldal kulcsszó egy', 'oldal kulcsszó kettő'),
    updatedAt: '2026-09-20T10:00:00.000Z',
    createdAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  } as Page
}

function bejegyzes(overrides: Partial<Post> = {}): Post {
  return {
    id: 22,
    title: 'A cikk címe',
    slug: HUB.cikkSlug,
    status: 'published',
    excerpt: 'A cikk kivonata, a látható bevezető.',
    seoDescription: 'A cikk SEO-leírása.',
    seoKeywords: sorok('cikk kulcsszó'),
    content: lexikai('A cikk törzse.'),
    publishedAt: '2026-09-02T10:00:00.000Z',
    updatedAt: '2026-09-21T10:00:00.000Z',
    createdAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  } as Post
}

function jsonLd(markup: string): Record<string, unknown>[] {
  return [...markup.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((talalat) => JSON.parse(talalat[1]!) as Record<string, unknown>)
    .flatMap((dok) =>
      Array.isArray(dok['@graph']) ? (dok['@graph'] as Record<string, unknown>[]) : [dok],
    )
}

function tipusu(csomopontok: Record<string, unknown>[], tipus: string) {
  return csomopontok.find((node) => {
    const t = node['@type']
    return Array.isArray(t) ? t.includes(tipus) : t === tipus
  })
}

async function renderHub() {
  const metadata = await route.generateMetadata(props)
  const markup = renderToStaticMarkup(await route.default(props))
  const csomopontok = jsonLd(markup)
  return {
    metadata,
    webPage: tipusu(csomopontok, 'WebPage'),
    article: tipusu(csomopontok, 'Article'),
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  h.page = null
  h.post = null
})

describe('hubSeoForras: a lánc sorrendje', () => {
  it('leírás: Oldal SEO → cikk SEO → cikk kivonat → Oldal kivonat, trimmelve', () => {
    const p = { seoDescription: ' P-seo ', excerpt: 'P-kiv', seoKeywords: null }
    const c = { seoDescription: 'C-seo', excerpt: 'C-kiv', seoKeywords: null }
    expect(hubSeoForras({ page: p, post: c }).description).toBe('P-seo')
    expect(hubSeoForras({ page: { ...p, seoDescription: '  ' }, post: c }).description).toBe(
      'C-seo',
    )
    expect(
      hubSeoForras({ page: { ...p, seoDescription: null }, post: { ...c, seoDescription: '' } })
        .description,
    ).toBe('C-kiv')
    expect(
      hubSeoForras({ page: { ...p, seoDescription: null }, post: { seoDescription: null } })
        .description,
    ).toBe('P-kiv')
    expect(hubSeoForras({ page: {}, post: {} }).description).toBeUndefined()
  })

  it('kulcsszavak: az Oldaléi, ha van érvényes sor; különben a cikkéi', () => {
    const oldalSorok = sorok('a', 'b')
    const cikkSorok = sorok('c')
    expect(
      hubSeoForras({ page: { seoKeywords: oldalSorok }, post: { seoKeywords: cikkSorok } })
        .keywords,
    ).toEqual(oldalSorok)
    for (const ures of [null, undefined, [], sorok('  ', '')]) {
      expect(
        hubSeoForras({ page: { seoKeywords: ures }, post: { seoKeywords: cikkSorok } }).keywords,
      ).toEqual(cikkSorok)
    }
    expect(hubSeoForras({ page: {}, post: {} }).keywords).toBeNull()
  })
})

describe('mai adatokkal (a hub-pár azonos) a kimenet betűre a korábbi', () => {
  it('a meta ugyanaz, mint a korábbi buildPageMetadata(page), a WebPage leírása, mint a cikké', () => {
    // Azonos pár: az Oldal SEO-mezői a cikk SEO-mezőivel egyeznek (ahogy élőben).
    const kozos = {
      seoDescription: 'Közös SEO-leírás a hubhoz és a cikkhez.',
      seoKeywords: sorok('kéztőalagút szindróma', 'zsibbadó kéz'),
    }
    const page = oldal(kozos)
    const post = bejegyzes(kozos)
    const forras = hubSeoForras({ page, post })
    const article = { publishedTime: post.publishedAt, modifiedTime: post.updatedAt }
    expect(buildPageMetadata(page, `/${HUB.slug}`, { article, seoForras: forras })).toEqual(
      buildPageMetadata(page, `/${HUB.slug}`, { article }),
    )
    expect(forras.description).toBe(resolveSeoDescription(post))
    expect(resolveSeoKeywords(forras.keywords)).toEqual(resolveSeoKeywords(post.seoKeywords))
  })

  it('azonos párral a renderelt hub JSON-LD-je a cikk leírását és kulcsszavait viszi', async () => {
    const kozos = {
      seoDescription: 'Közös SEO-leírás a hubhoz és a cikkhez.',
      seoKeywords: sorok('kéztőalagút szindróma', 'zsibbadó kéz'),
    }
    h.page = oldal(kozos)
    h.post = bejegyzes(kozos)
    const { webPage, article } = await renderHub()
    expect(webPage?.description).toBe(kozos.seoDescription)
    expect(article?.keywords).toBe('kéztőalagút szindróma, zsibbadó kéz')
    // Az Article leírása a látható bevezető (a cikk kivonata) marad.
    expect(article?.description).toBe('A cikk kivonata, a látható bevezető.')
  })
})

describe('eltérő pár: a meta és a JSON-LD ugyanazt mondja', () => {
  it.each([
    ['az Oldal SEO-mezői kitöltve', {}, {}],
    ['az Oldal SEO-leírása és kulcsszavai üresek', { seoDescription: null, seoKeywords: [] }, {}],
    [
      'csak a kivonatok vannak',
      { seoDescription: null, seoKeywords: null },
      { seoDescription: null, seoKeywords: null },
    ],
  ] as const)('%s', async (_nev, oldalMezok, cikkMezok) => {
    h.page = oldal(oldalMezok as Partial<Page>)
    h.post = bejegyzes(cikkMezok as Partial<Post>)
    const { metadata, webPage, article } = await renderHub()
    expect(webPage?.description).toBe(metadata.description)
    const metaKulcsszavak = metadata.keywords
    const cikkKulcsszavak = article?.keywords
    if (metaKulcsszavak === undefined) {
      expect(cikkKulcsszavak).toBeUndefined()
    } else {
      expect(cikkKulcsszavak).toBe((metaKulcsszavak as string[]).join(', '))
    }
    // A cím és a megosztási kép továbbra is az Oldalé (nem ennek a körnek a része).
    expect(String(metadata.title)).toContain('Hub oldal címe')
  })

  it('kitöltött Oldal SEO-mezőknél a JSON-LD az Oldal szövegét viszi, nem a cikkét', async () => {
    h.page = oldal()
    h.post = bejegyzes()
    const { metadata, webPage, article } = await renderHub()
    expect(metadata.description).toBe('Az oldal SEO-leírása, amely a meta leírás forrása.')
    expect(webPage?.description).toBe('Az oldal SEO-leírása, amely a meta leírás forrása.')
    expect(metadata.keywords).toEqual(['oldal kulcsszó egy', 'oldal kulcsszó kettő'])
    expect(article?.keywords).toBe('oldal kulcsszó egy, oldal kulcsszó kettő')
  })
})

describe('a /blog/[slug] útvonal változatlan: a PostArticle a cikk saját kulcsszavait adja', () => {
  it('jsonLdKulcsszavak nélkül a cikk mezője, a hub-lánc csak átadva hat', async () => {
    const { PostArticle } = await import('../components/content/PostArticle')
    const { createElement } = await import('react')
    const post = bejegyzes()
    const sajat = jsonLd(renderToStaticMarkup(createElement(PostArticle, { post })))
    expect(tipusu(sajat, 'Article')?.keywords).toBe('cikk kulcsszó')
    const hubbal = jsonLd(
      renderToStaticMarkup(
        createElement(PostArticle, { post, jsonLdKulcsszavak: sorok('hub kulcsszó') }),
      ),
    )
    expect(tipusu(hubbal, 'Article')?.keywords).toBe('hub kulcsszó')
    const uressel = jsonLd(
      renderToStaticMarkup(createElement(PostArticle, { post, jsonLdKulcsszavak: null })),
    )
    expect(tipusu(uressel, 'Article') ?? {}).not.toHaveProperty('keywords')
  })
})
