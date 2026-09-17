import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Media, Product } from '../payload-types'

const mocks = vi.hoisted(() => ({ find: vi.fn(), auth: vi.fn() }))
vi.mock('../payload.config', () => ({ default: {} }))
vi.mock('payload', () => ({ getPayload: async () => mocks }))
vi.mock('next/headers', () => ({
  draftMode: async () => ({ isEnabled: false }),
  headers: async () => new Headers(),
}))
vi.mock('@/components/analytics/TrackEvent', () => ({ TrackEvent: () => null }))
vi.mock('@/components/courses/CourseBarionView', () => ({ CourseBarionView: () => null }))
vi.mock('@/components/courses/CourseBuybox', () => ({ CourseBuybox: () => null }))
vi.mock('@/components/courses/CourseBuyBar', () => ({ CourseBuyBar: () => null }))

import CoursePage from '../app/(frontend)/kurzusok/[slug]/page'

const photo = (id: number, overrides: Partial<Media> = {}): Media => ({
  id,
  url: `/media/gallery-${id}.jpg`,
  alt: `Exercise photo ${id}`,
  mimeType: 'image/jpeg',
  width: 1200,
  height: 800,
  updatedAt: '',
  createdAt: '',
  ...overrides,
})

const product = (gallery: Product['gallery']): Product =>
  ({
    id: 11,
    sku: 'Program',
    slug: 'program',
    status: 'published',
    priceInHUFEnabled: true,
    priceInHUF: 10000,
    gallery,
    updatedAt: '',
    createdAt: '',
  }) as Product

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ user: null })
  vi.stubGlobal('fetch', () => {
    throw new Error('No network allowed')
  })
})
afterEach(() => vi.unstubAllGlobals())

async function render(gallery: Product['gallery']) {
  mocks.find.mockResolvedValue({ docs: [product(gallery)] })
  return renderToStaticMarkup(await CoursePage({ params: Promise.resolve({ slug: 'program' }) }))
}

describe('course gallery CMS consumption', () => {
  it('renders populated images in editorial order, with alt text and a reachable section', async () => {
    const html = await render([
      { id: 'second', image: photo(2) },
      { id: 'first', image: photo(1) },
    ])
    expect(html).toContain('id="kurzus-kepek"')
    expect(html).toContain('href="#kurzus-kepek"')
    expect(html).toContain('alt="Exercise photo 2"')
    expect(html.indexOf('alt="Exercise photo 2"')).toBeLessThan(
      html.indexOf('alt="Exercise photo 1"'),
    )
    expect(html).toContain('width="1200"')
    expect(html).toContain('loading="lazy"')
  })

  it.each([
    undefined,
    null,
    [],
    [{ image: 123 }, { image: null }, {}],
    [{ image: photo(1, { url: null }) }],
  ])('omits an empty or unresolved gallery and its jump target: %j', async (gallery) => {
    const html = await render(gallery)
    expect(html).not.toContain('kurzus-kepek')
  })

  it('skips unresolved/non-image entries without discarding valid media', async () => {
    const html = await render([
      { image: 22 },
      { image: photo(3, { mimeType: 'application/pdf', url: '/media/document.pdf' }) },
      { image: photo(4) },
    ])
    expect(html).not.toContain('document.pdf')
    expect(html).toContain('alt="Exercise photo 4"')
  })

  it('renders legacy images without dimensions and images with only a responsive source', async () => {
    const html = await render([
      { image: photo(5, { width: null, height: null }) },
      {
        image: photo(6, {
          url: null,
          sizes: { md: { url: '/media/resized.jpg', width: 800, height: 600 } },
        }),
      },
    ])
    expect(html).toContain('src="/media/gallery-5.jpg"')
    expect(html).toContain('alt="Exercise photo 5"')
    expect(html).toContain('resized.jpg')
  })
})
