import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A /kurzusok/[slug] útvonal AKCIÓS kapcsolója (WP59).
 *  - élő akció + kiírt ár + nem előnézet → PromoCourseView (hero, záró sáv,
 *    `priceValidUntil` az Offer-ben);
 *  - kikapcsolt vagy lejárt akció → a rendes kurzusoldal (vásárlódoboz);
 *  - ingyenes kurzus és szerkesztői előnézet → SOHA nem akciós sablon.
 */

const mocks = vi.hoisted(() => ({
  draft: vi.fn(),
  auth: vi.fn(),
  find: vi.fn(),
}))
vi.mock('next/headers', () => ({ draftMode: mocks.draft, headers: async () => new Headers() }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
  permanentRedirect: () => {
    throw new Error('REDIRECT')
  },
}))
vi.mock('payload', () => ({ getPayload: async () => ({ auth: mocks.auth, find: mocks.find }) }))
vi.mock('../payload.config', () => ({ default: {} }))
vi.mock('../components/analytics/TrackEvent', () => ({ TrackEvent: () => <span>TRACKING</span> }))
vi.mock('../components/courses/CourseBarionView', () => ({
  CourseBarionView: () => <span>BARION</span>,
}))
vi.mock('../components/courses/FreeCourseRequestForm', () => ({
  FreeCourseRequestForm: () => <span>CLAIM_FORM</span>,
}))

import CoursePage from '../app/(frontend)/kurzusok/[slug]/page'
import { formatPriceHuf } from '../lib/format-price'

const props = { params: Promise.resolve({ slug: 'kez-torna' }) }
const base = {
  id: 12,
  slug: 'kez-torna',
  displayTitle: 'Akciós kéztorna',
  shortDescription: 'Otthon végezhető kézrehabilitáció.',
  status: 'published',
  priceInHUFEnabled: true,
  priceInHUF: 1000,
  promoEnabled: true,
  promoOriginalPriceHuf: 1500,
  promoStart: '2020-01-01T00:00:00.000Z',
  promoEnd: '2099-12-31T00:00:00.000Z',
  modules: [
    {
      id: 'module',
      title: 'Alapok',
      lessons: [{ id: 'lesson', title: 'Elso lecke', status: 'ready', streamAssetId: 'GUID' }],
    },
  ],
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.draft.mockResolvedValue({ isEnabled: false })
  mocks.auth.mockResolvedValue({ user: null })
  mocks.find.mockResolvedValue({ docs: [base] })
})

describe('kurzusoldal — akciós kapcsoló', () => {
  it('élő akciónál az akciós sablon megy, a strukturált adat priceValidUntil-lel', async () => {
    const html = renderToStaticMarkup(await CoursePage(props))
    expect(html).toContain('kc-promo-hero')
    expect(html).toContain('id="akcios-vasarlas"')
    expect(html).toContain(`<s>${formatPriceHuf(1500)}</s>`)
    expect(html).toContain('id="kurzus-vasarlas-gomb"')
    expect(html).toContain('id="tananyag"')
    expect(html).toContain('TRACKING')
    expect(html).toContain('BARION')
    expect(html).toContain('"priceValidUntil":"2099-12-31"')
    expect(html).not.toContain('kc-course-buybox')
    expect(html).not.toContain('kc-course-breadcrumb')
  })

  it('kikapcsolt akciónál a rendes kurzusoldal, priceValidUntil nélkül', async () => {
    mocks.find.mockResolvedValue({ docs: [{ ...base, promoEnabled: false }] })
    const html = renderToStaticMarkup(await CoursePage(props))
    expect(html).toContain('kc-course-buybox')
    expect(html).not.toContain('kc-promo-hero')
    expect(html).not.toContain('priceValidUntil')
  })

  it('lejárt akciónál a rendes kurzusoldal', async () => {
    mocks.find.mockResolvedValue({ docs: [{ ...base, promoEnd: '2020-01-02T00:00:00.000Z' }] })
    const html = renderToStaticMarkup(await CoursePage(props))
    expect(html).toContain('kc-course-buybox')
    expect(html).not.toContain('kc-promo-hero')
  })

  it('ingyenes kurzuson sosem akciós sablon', async () => {
    mocks.find.mockResolvedValue({ docs: [{ ...base, priceInHUFEnabled: false }] })
    const html = renderToStaticMarkup(await CoursePage(props))
    expect(html).not.toContain('kc-promo-hero')
    expect(html).toContain('CLAIM_FORM')
  })

  it('szerkesztői előnézetben sosem akciós sablon', async () => {
    mocks.draft.mockResolvedValue({ isEnabled: true })
    mocks.auth.mockResolvedValue({ user: { id: 7, role: 'staff' } })
    mocks.find.mockResolvedValue({ docs: [{ ...base, _status: 'draft' }] })
    const html = renderToStaticMarkup(await CoursePage(props))
    expect(html).toContain('Előnézet:')
    expect(html).not.toContain('kc-promo-hero')
    expect(html).not.toContain('/penztar')
  })
})
