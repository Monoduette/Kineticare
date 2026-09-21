import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ find: vi.fn() }))
vi.mock('payload', () => ({ getPayload: async () => ({ find: mocks.find }) }))
vi.mock('../payload.config', () => ({ default: {} }))
vi.mock('../components/analytics/BarionPageView', () => ({ BarionPageView: () => null }))

import CourseListing from '../app/(frontend)/kurzusok/page'
import {
  getFeaturedProducts,
  getFreeProduct,
  getPublishedProducts,
  getSitemapProducts,
  PUBLISHED_WHERE,
} from '../lib/cms'
import { DISCOVERABLE_COURSES_WHERE } from '../lib/course-discovery'

beforeEach(() => {
  mocks.find.mockReset().mockResolvedValue({ docs: [] })
})

describe('public discovery queries exclude unlisted courses before LIMIT', () => {
  it.each([getFeaturedProducts, getPublishedProducts, getSitemapProducts])(
    'uses the product-only predicate for %s',
    async (query) => {
      await query(2)
      expect(mocks.find).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'products',
          where: DISCOVERABLE_COURSES_WHERE,
          limit: 2,
        }),
      )
    },
  )

  it('combines the free offer constraint with discovery before selecting its one result', async () => {
    await getFreeProduct()
    expect(mocks.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'products',
        limit: 1,
        where: { and: [DISCOVERABLE_COURSES_WHERE, { priceInHUFEnabled: { equals: false } }] },
      }),
    )
  })

  it('filters the listing query before categories, cards and JSON-LD are constructed', async () => {
    const html = renderToStaticMarkup(await CourseListing({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('Jelenleg nincs megjeleníthető kurzus')
    expect(mocks.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'products',
        where: DISCOVERABLE_COURSES_WHERE,
        limit: 100,
      }),
    )
  })

  it('retains NULL/missing legacy rows and does not alter the page/post published predicate', () => {
    expect(DISCOVERABLE_COURSES_WHERE).toEqual({
      and: [
        { status: { equals: 'published' } },
        { or: [{ unlisted: { equals: false } }, { unlisted: { exists: false } }] },
      ],
    })
    expect(PUBLISHED_WHERE).toEqual({ status: { equals: 'published' } })
  })
})
