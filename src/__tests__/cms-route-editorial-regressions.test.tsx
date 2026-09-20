import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RenderBlocksProps } from '@/components/blocks/RenderBlocks'
import { minimalRichText } from '@/lib/home-seed'
import type { Page } from '@/payload-types'

const mocks = vi.hoisted(() => ({
  page: vi.fn(),
  post: vi.fn(),
  draft: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`)
  }),
  products: vi.fn(),
  posts: vi.fn(),
  testimonials: vi.fn(),
  slugs: vi.fn(),
  appointment: vi.fn(),
  blocks: vi.fn(),
}))

vi.mock('next/headers', () => ({ draftMode: mocks.draft }))
vi.mock('next/navigation', () => ({
  permanentRedirect: mocks.redirect,
  notFound: () => {
    throw new Error('notFound')
  },
}))
vi.mock('@/lib/cms', () => ({
  getPageBySlug: mocks.page,
  getPostBySlug: mocks.post,
  getPublishedProducts: mocks.products,
  getLatestPosts: mocks.posts,
  getTestimonials: mocks.testimonials,
  getPublishedPageSlugs: mocks.slugs,
  getRelatedPosts: vi.fn(async () => []),
  getFreeProduct: vi.fn(async () => null),
}))
vi.mock('@/lib/appointment/section', () => ({ getAppointmentSectionContext: mocks.appointment }))
vi.mock('@/components/blocks/RenderBlocks', () => ({
  RenderBlocks: (props: RenderBlocksProps) => {
    mocks.blocks(props)
    return (
      <>
        {props.layout.map((block, index) =>
          block.blockType === 'filmHero' && block.sectionSettings?.visible !== false ? (
            <h1 key={index}>{block.title}</h1>
          ) : null,
        )}
      </>
    )
  },
}))
vi.mock('@/components/content/PostArticle', () => ({
  PostArticle: ({ post }: { post: { title: string } }) => <article>{post.title}</article>,
}))
vi.mock('@/components/content/PageEeat', () => ({ PageEeat: () => null }))
vi.mock('@/components/preview/PreviewBar', () => ({
  PreviewBar: ({ path }: { path: string }) => <aside data-preview-path={path}>Preview</aside>,
}))

import BlogPostPage, { generateMetadata as blogMetadata } from '../app/(frontend)/blog/[slug]/page'
import CmsPage, { generateMetadata as cmsMetadata } from '../app/(frontend)/[slug]/page'

function page(overrides: Partial<Page> = {}): Page {
  return {
    id: 1,
    title: 'Editorial contact title',
    slug: 'kapcsolat',
    excerpt: 'Editorial introduction',
    content: minimalRichText('Editorial body'),
    layout: [],
    status: 'published',
    updatedAt: '2026-09-09T00:00:00.000Z',
    createdAt: '2026-09-09T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected network call in route test')
    }),
  )
  mocks.draft.mockResolvedValue({ isEnabled: false })
  mocks.page.mockResolvedValue(page())
  mocks.post.mockResolvedValue({ id: 1, slug: 'teniszkonyok', title: 'Draft article' })
  mocks.products.mockResolvedValue([])
  mocks.posts.mockResolvedValue([])
  mocks.testimonials.mockResolvedValue([])
  mocks.slugs.mockResolvedValue(new Set<string>())
  mocks.appointment.mockResolvedValue({ formId: null, turnstileSiteKey: null })
})

afterEach(() => vi.unstubAllGlobals())

describe('FilmHero header visibility', () => {
  // WCAG 2.4.6 Headings and Labels: https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html
  // GOV.UK Headings: https://design-system.service.gov.uk/styles/headings/
  it('az örökölt demólap (akcios-kurzus) közzétéve is noindex (legacy-noindex), más CMS-oldal nem', async () => {
    const demo = await cmsMetadata({ params: Promise.resolve({ slug: 'akcios-kurzus' }) })
    expect(demo.robots).toEqual({
      index: false,
      follow: true,
      googleBot: { index: false, follow: true },
    })
    const other = await cmsMetadata({ params: Promise.resolve({ slug: 'rolunk' }) })
    expect(other.robots).not.toEqual(demo.robots)
  })

  it('the CMS page retains the header for a hidden FilmHero', async () => {
    mocks.page.mockResolvedValue(
      page({
        layout: [
          {
            blockType: 'filmHero',
            title: 'Hidden film title',
            sectionSettings: { visible: false },
          },
        ],
      }),
    )
    const html = renderToStaticMarkup(
      await CmsPage({ params: Promise.resolve({ slug: 'example' }) }),
    )
    expect(html).toMatch(/<h1[^>]*>Editorial contact title<\/h1>/)
    expect(html).toContain('Editorial introduction')
    expect(html).not.toContain('Hidden film title')
  })

  it('the CMS page has only the FilmHero heading for a visible film', async () => {
    mocks.page.mockResolvedValue(
      page({ layout: [{ blockType: 'filmHero', title: 'Visible film title' }] }),
    )
    const html = renderToStaticMarkup(
      await CmsPage({ params: Promise.resolve({ slug: 'example' }) }),
    )
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1)
    expect(html).toContain('<h1>Visible film title</h1>')
    expect(html).not.toContain('Editorial introduction')
  })
})

describe('blog hub redirect and draft preview', () => {
  const props = { params: Promise.resolve({ slug: 'teniszkonyok' }) }

  it('preserves the permanent public redirect when the hub is published', async () => {
    await expect(BlogPostPage(props)).rejects.toThrow('redirect:/teniszkonyok')
    expect(mocks.page).toHaveBeenCalledWith('teniszkonyok')
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('renders the published post when there is no published hub', async () => {
    mocks.page.mockResolvedValue(null)
    expect(renderToStaticMarkup(await BlogPostPage(props))).toContain('Draft article')
    expect(mocks.post).toHaveBeenCalledWith('teniszkonyok', { draft: false })
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('renders the draft post without querying or redirecting to its published hub', async () => {
    mocks.draft.mockResolvedValue({ isEnabled: true })
    const html = renderToStaticMarkup(await BlogPostPage(props))
    expect(html).toContain('Draft article')
    expect(html).toContain('data-preview-path="/blog/teniszkonyok"')
    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(mocks.page).not.toHaveBeenCalled()
    expect(mocks.post).toHaveBeenCalledWith('teniszkonyok', { draft: true })
    const metadata = await blogMetadata(props)
    expect(metadata.robots).toEqual({ index: false, follow: false })
    expect(metadata.alternates?.canonical).toBe('/blog/teniszkonyok')
  })
})
