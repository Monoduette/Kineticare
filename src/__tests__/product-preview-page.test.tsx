import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import CoursePage, { generateMetadata } from '../app/(frontend)/kurzusok/[slug]/page'

const props = { params: Promise.resolve({ slug: 'kez-torna' }) }
const product = {
  id: 12,
  slug: 'kez-torna',
  displayTitle: 'Mentett piszkozat',
  status: 'draft',
  priceInHUFEnabled: true,
  priceInHUF: 1000,
  modules: [
    {
      id: 'module',
      title: 'Alapok',
      lessons: [
        {
          id: 'lesson',
          title: 'Elso lecke',
          status: 'ready',
          streamAssetId: 'PROTECTED_GUID_SENTINEL',
          content: 'PRIVATE_LESSON_SENTINEL',
        },
      ],
    },
  ],
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.draft.mockResolvedValue({ isEnabled: true })
  mocks.auth.mockResolvedValue({ user: { id: 7, role: 'staff' } })
  mocks.find.mockResolvedValue({ docs: [product] })
})

describe('course landing preview boundary', () => {
  it('does not mistake business publication for Payload publication', async () => {
    mocks.draft.mockResolvedValue({ isEnabled: false })
    mocks.auth.mockResolvedValue({ user: null })
    mocks.find.mockResolvedValue({ docs: [{ ...product, status: 'published', _status: 'draft' }] })
    await expect(CoursePage(props)).rejects.toThrow('NOT_FOUND')
    expect(await generateMetadata(props)).toMatchObject({ title: 'A kurzus nem található' })
  })
  it.each([null, { id: 4, role: 'customer' }])(
    'denies draft content to %s with a leftover cookie',
    async (user) => {
      mocks.auth.mockResolvedValue({ user })
      await expect(CoursePage(props)).rejects.toThrow('NOT_FOUND')
      expect(mocks.find.mock.calls.every(([args]) => args.draft !== true)).toBe(true)
    },
  )

  it('renders a staff preview with no protected lesson data, tracking or purchase', async () => {
    const html = renderToStaticMarkup(await CoursePage(props))
    expect(html).toContain('Mentett piszkozat')
    expect(html).toContain('Előnézet:')
    expect(html).toContain('Elso lecke')
    for (const privateValue of [
      'PROTECTED_GUID_SENTINEL',
      'PRIVATE_LESSON_SENTINEL',
      'TRACKING',
      'BARION',
      '/penztar',
      'CLAIM_FORM',
    ])
      expect(html).not.toContain(privateValue)
    expect(await generateMetadata(props)).toMatchObject({ robots: { index: false, follow: false } })
  })

  it('keeps published requests outside draft reads', async () => {
    mocks.draft.mockResolvedValue({ isEnabled: false })
    mocks.auth.mockResolvedValue({ user: null })
    mocks.find.mockResolvedValue({ docs: [{ ...product, status: 'published' }] })
    const html = renderToStaticMarkup(await CoursePage(props))
    expect(html).not.toContain('Előnézet:')
    expect(html).toContain('TRACKING')
    expect(html).toContain('/penztar')
    expect(mocks.find.mock.calls.every(([args]) => args.draft !== true)).toBe(true)
  })

  it('never grants free course access in preview', async () => {
    mocks.find.mockResolvedValue({
      docs: [{ ...product, status: 'published', priceInHUFEnabled: false }],
    })
    const html = renderToStaticMarkup(await CoursePage(props))
    expect(html).not.toContain('CLAIM_FORM')
    expect(html).not.toContain('/kurzusaim')
  })
})
