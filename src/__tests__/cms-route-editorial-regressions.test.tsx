import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RenderBlocksProps } from '@/components/blocks/RenderBlocks'
import { KNOWLEDGE_POSTS_FETCH_LIMIT } from '@/components/content/home/KnowledgeSection'
import { minimalRichText } from '@/lib/home-seed'
import { absoluteUrl } from '@/lib/seo'
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

import ContactPage, { generateMetadata as contactMetadata } from '../app/(frontend)/kapcsolat/page'
import BlogPostPage, { generateMetadata as blogMetadata } from '../app/(frontend)/blog/[slug]/page'
import CmsPage from '../app/(frontend)/[slug]/page'

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

describe('contact CMS route', () => {
  it('renders CMS title, excerpt, body and populated hero image', async () => {
    mocks.page.mockResolvedValue(
      page({
        heroImage: {
          id: 2,
          alt: 'Editorial hero',
          url: '/hero.jpg',
          width: 100,
          height: 100,
          updatedAt: '',
          createdAt: '',
        },
      }),
    )
    const html = renderToStaticMarkup(await ContactPage())
    expect(html).toContain('<h1>Editorial contact title</h1>')
    expect(html).toContain('<p class="kc-page-hero__lead">Editorial introduction</p>')
    expect(html).toContain('Editorial body')
    expect(html).toContain('alt="Editorial hero"')
    expect(html).toContain('"@type":"ContactPage"')
    expect(html).toContain('"name":"Editorial contact title"')
    expect(html).not.toContain('<form')
    expect(mocks.page).toHaveBeenCalledWith('kapcsolat', { draft: false })
    expect(mocks.products).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'uses all CMS SEO fields with fixed public canonical, draft=%s',
    async (draft) => {
      mocks.draft.mockResolvedValue({ isEnabled: draft })
      mocks.page.mockResolvedValue(
        page({
          seoTitle: 'Editorial SEO title',
          seoDescription: 'Editorial SEO description',
          seoKeywords: [{ phrase: 'editorial keyword' }],
        }),
      )
      const metadata = await contactMetadata()
      expect(metadata.title).toBe('Editorial SEO title')
      expect(metadata.description).toBe('Editorial SEO description')
      expect(metadata.keywords).toContain('editorial keyword')
      expect(metadata.alternates?.canonical).toBe('/kapcsolat')
      expect(metadata.openGraph?.url).toBe(absoluteUrl('/kapcsolat'))
      if (draft) expect(metadata.robots).toEqual({ index: false, follow: false })
      else expect(metadata.robots).toBeUndefined()
      expect(mocks.page).toHaveBeenCalledWith('kapcsolat', { draft })
    },
  )

  it('uses the excerpt as the SEO fallback', async () => {
    expect((await contactMetadata()).description).toBe('Editorial introduction')
  })

  it('preserves the CMS sharing image override and its accessible description', async () => {
    mocks.page.mockResolvedValue(
      page({
        ogImage: {
          id: 3,
          alt: 'Editorial sharing image',
          url: '/sharing.jpg',
          updatedAt: '',
          createdAt: '',
        },
      }),
    )
    const metadata = await contactMetadata()
    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({ url: absoluteUrl('/sharing.jpg'), alt: 'Editorial sharing image' }),
    ])
  })

  it('keeps an absent CMS page preview noindex', async () => {
    mocks.page.mockResolvedValue(null)
    mocks.draft.mockResolvedValue({ isEnabled: true })
    expect((await contactMetadata()).robots).toEqual({ index: false, follow: false })
  })

  it('shows the existing preview bar and queries draft page content', async () => {
    mocks.draft.mockResolvedValue({ isEnabled: true })
    const html = renderToStaticMarkup(await ContactPage())
    expect(html).toContain('data-preview-path="/kapcsolat"')
    expect(mocks.page).toHaveBeenCalledWith('kapcsolat', { draft: true })
  })

  it('keeps the empty CMS fallback without resurrecting a message form', async () => {
    mocks.page.mockResolvedValue(null)
    const html = renderToStaticMarkup(await ContactPage())
    expect(html).toContain('<h1>Kapcsolat</h1>')
    expect(html).not.toContain('<form')
    expect(html).not.toContain('data-preview-path')
    const metadata = await contactMetadata()
    expect(metadata.title).toBe('Kapcsolat')
    expect(metadata.description).toContain('telefonos')
    expect(metadata.alternates?.canonical).toBe('/kapcsolat')
  })

  it('populates layout lists and canonical hub links while preserving appointment context', async () => {
    const layout: NonNullable<Page['layout']> = [
      { blockType: 'knowledge' },
      { blockType: 'courseCards' },
      { blockType: 'testimonials' },
      { blockType: 'appointment', title: 'Appointment' },
    ]
    const products = [{ id: 3 }]
    const posts = [{ id: 4, slug: 'teniszkonyok' }]
    const testimonials = [{ id: 5 }]
    const appointment = { formId: 9, turnstileSiteKey: null }
    mocks.draft.mockResolvedValue({ isEnabled: true })
    mocks.page.mockResolvedValue(page({ layout }))
    mocks.products.mockResolvedValue(products)
    mocks.posts.mockResolvedValue(posts)
    mocks.testimonials.mockResolvedValue(testimonials)
    mocks.slugs.mockResolvedValue(new Set(['teniszkonyok']))
    mocks.appointment.mockResolvedValue(appointment)
    const html = renderToStaticMarkup(await ContactPage())
    expect(html).not.toContain('Editorial body')
    expect(mocks.blocks).toHaveBeenCalledWith(
      expect.objectContaining({
        layout,
        products,
        posts,
        testimonials,
        appointment,
        hubUtvonalak: { teniszkonyok: '/teniszkonyok' },
      }),
    )
    expect(mocks.products).toHaveBeenCalledWith()
    expect(mocks.posts).toHaveBeenCalledWith(KNOWLEDGE_POSTS_FETCH_LIMIT)
    expect(mocks.testimonials).toHaveBeenCalledWith()
    expect(mocks.appointment).toHaveBeenCalledWith(layout)
  })
})

describe('FilmHero header visibility', () => {
  // WCAG 2.4.6 Headings and Labels: https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html
  // GOV.UK Headings: https://design-system.service.gov.uk/styles/headings/
  it.each(['contact', 'cms'] as const)(
    '%s retains the header for a hidden FilmHero',
    async (route) => {
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
      const node =
        route === 'contact'
          ? await ContactPage()
          : await CmsPage({ params: Promise.resolve({ slug: 'example' }) })
      const html = renderToStaticMarkup(node)
      expect(html).toMatch(/<h1[^>]*>Editorial contact title<\/h1>/)
      expect(html).toContain('Editorial introduction')
      expect(html).not.toContain('Hidden film title')
    },
  )

  it.each(['contact', 'cms'] as const)(
    '%s has only the FilmHero heading for a visible film',
    async (route) => {
      mocks.page.mockResolvedValue(
        page({ layout: [{ blockType: 'filmHero', title: 'Visible film title' }] }),
      )
      const node =
        route === 'contact'
          ? await ContactPage()
          : await CmsPage({ params: Promise.resolve({ slug: 'example' }) })
      const html = renderToStaticMarkup(node)
      expect(html.match(/<h1[\s>]/g)).toHaveLength(1)
      expect(html).toContain('<h1>Visible film title</h1>')
      expect(html).not.toContain('Editorial introduction')
    },
  )
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
