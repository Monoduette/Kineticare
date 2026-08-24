import { describe, expect, it, vi } from 'vitest'

/**
 * A két ÚJ Tudástár-poszt generateMetadata viselkedése: noindex csak náluk,
 * ha a Person author vagy a faq hiányzik. A hat élő URL indexelhető marad.
 */

const post = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))

vi.mock('next/headers', () => ({
  draftMode: vi.fn(async () => ({ isEnabled: false })),
}))

vi.mock('@/lib/cms', () => ({
  getPostBySlug: async () => post.current,
  getRelatedPosts: async () => [],
}))

import { generateMetadata } from '../app/(frontend)/blog/[slug]/page'

const gyik = [
  { question: 'Mennyi ideig tarthat?', answer: 'A lefolyás egyéni.' },
  { question: 'Mikor kell orvoshoz menni?', answer: 'Ha a panasz nem múlik.' },
]

function alap(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Teszt cikk',
    excerpt: 'Rövid bevezető a metateszthez.',
    seoTitle: null,
    seoDescription: null,
    heroImage: null,
    ogImage: null,
    ...overrides,
  }
}

describe('blog cikk generateMetadata — GEO noindex csak a két új slugra', () => {
  it('élő slug author=null / faq=[] mellett is indexelhető', async () => {
    post.current = alap({ slug: 'pattano-ujj', author: null, faq: [] })
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'pattano-ujj' }) })
    expect(meta.robots).toBeUndefined()
  })

  it('új slug üres authorral noindex, follow', async () => {
    post.current = alap({ slug: 'inhuvelygyulladas', author: null, faq: gyik })
    const meta = await generateMetadata({
      params: Promise.resolve({ slug: 'inhuvelygyulladas' }),
    })
    expect(meta.robots).toEqual({ index: false, follow: true })
  })

  it('új slug Organization szerzővel noindex', async () => {
    post.current = alap({
      slug: 'befagyott-vall',
      author: { type: 'Organization', name: 'Kineticare' },
      faq: gyik,
    })
    const meta = await generateMetadata({
      params: Promise.resolve({ slug: 'befagyott-vall' }),
    })
    expect(meta.robots).toEqual({ index: false, follow: true })
  })

  it('új slug Kiss Kata Person + faq mellett indexelhető', async () => {
    post.current = alap({
      slug: 'inhuvelygyulladas',
      author: { id: 3, name: 'Kiss Kata' },
      faq: gyik,
    })
    const meta = await generateMetadata({
      params: Promise.resolve({ slug: 'inhuvelygyulladas' }),
    })
    expect(meta.robots).toBeUndefined()
  })
})
