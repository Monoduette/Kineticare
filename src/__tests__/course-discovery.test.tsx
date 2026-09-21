import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ProductCard, isPubliclyVisibleProduct } from '../components/content/ProductCard'
import { courseCtaTargetOf, freeCourseCtaTargetOf } from '../components/content/post-article'
import { RelatedCourses } from '../components/courses/RelatedCourses'
import { isDiscoverableCourse } from '../lib/course-discovery'
import { resolveMenuHref, resolveMenuTargetPath } from '../lib/menu-tree'
import type { Menu, Post, Product } from '../payload-types'

const product = (unlisted?: boolean | null): Product =>
  ({
    id: 91,
    sku: 'discovery-fixture',
    slug: 'direct-course',
    displayTitle: 'Közvetlen kurzus',
    status: 'published',
    priceInHUFEnabled: true,
    priceInHUF: 39500,
    ...(unlisted === undefined ? {} : { unlisted }),
  }) as Product

describe('course discovery is separate from direct links', () => {
  it.each([false, null, undefined])('keeps legacy/public value %s discoverable', (value) => {
    const course = product(value)
    expect(isDiscoverableCourse(course)).toBe(true)
    expect(isPubliclyVisibleProduct(course)).toBe(true)
    expect(renderToStaticMarkup(<ProductCard product={course} />)).toContain(
      '/kurzusok/direct-course',
    )
    expect(renderToStaticMarkup(<RelatedCourses products={[course]} />)).toContain(
      'Közvetlen kurzus',
    )
    expect(courseCtaTargetOf({ ctaCourse: course } as Post)?.id).toBe(91)
    expect(freeCourseCtaTargetOf({ ...course, priceInHUFEnabled: false })?.id).toBe(91)
  })

  it('hides populated unlisted cards, related sections and editorial offers', () => {
    const course = product(true)
    expect(isDiscoverableCourse(course)).toBe(false)
    expect(renderToStaticMarkup(<ProductCard product={course} />)).toBe('')
    expect(renderToStaticMarkup(<RelatedCourses products={[course]} crossSell />)).toBe('')
    expect(courseCtaTargetOf({ ctaCourse: course } as Post)).toBeNull()
    expect(freeCourseCtaTargetOf({ ...course, priceInHUFEnabled: false })).toBeNull()
    expect(resolveMenuTargetPath('products', course)).toBe('/kurzusok/direct-course')
  })

  it.each(['draft', 'archived', null, undefined])(
    'preserves unpublished exclusion: %s',
    (status) => {
      expect(isDiscoverableCourse({ ...product(false), status })).toBe(false)
    },
  )

  it('removes only the unlisted product from a mixed related-products list', () => {
    const html = renderToStaticMarkup(
      <RelatedCourses
        products={[
          product(true),
          { ...product(false), id: 92, slug: 'listed', displayTitle: 'Listed course' },
        ]}
      />,
    )
    expect(html).not.toContain('/kurzusok/direct-course')
    expect(html).toContain('/kurzusok/listed')
  })

  it.each([true, false, null, undefined])('product menu reference follows flag %s', (unlisted) => {
    const menu = {
      type: 'product',
      ref: { relationTo: 'products', value: product(unlisted) },
    } as Menu
    expect(resolveMenuHref(menu)).toBe(unlisted === true ? null : '/kurzusok/direct-course')
  })

  it('does not apply the product discovery gate to page/post references or typed URLs', () => {
    for (const [collection, path] of [
      ['pages', '/example'],
      ['posts', '/blog/example'],
    ] as const) {
      const menu = {
        type: collection === 'pages' ? 'page' : 'post',
        ref: {
          relationTo: collection,
          value: { status: 'published', slug: 'example', unlisted: true },
        },
      } as unknown as Menu
      expect(resolveMenuHref(menu)).toBe(path)
    }
    expect(resolveMenuHref({ type: 'url', url: '/kurzusok/direct-course' } as Menu)).toBe(
      '/kurzusok/direct-course',
    )
  })

  it('does not turn paid or incompletely configured products into free offers', () => {
    expect(freeCourseCtaTargetOf(product(false))).toBeNull()
    expect(freeCourseCtaTargetOf({ ...product(false), priceInHUFEnabled: null })).toBeNull()
  })
})
