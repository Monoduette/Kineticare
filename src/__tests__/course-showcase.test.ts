import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CourseShowcase } from '../components/content/home/CourseShowcase'
import {
  COURSE_SHOWCASE_HEADING,
  COURSE_SHOWCASE_MARK,
  showcaseFallbackAt,
  splitEditorialTitle,
} from '../lib/course-showcase'
import type { Product } from '../payload-types'

function product(overrides: Partial<Product> & { id: number }): Product {
  return {
    sku: `Kurzus ${overrides.id}`,
    audience: 'laikus',
    priceInHUF: 19990,
    priceInHUFEnabled: true,
    status: 'published',
    updatedAt: '',
    createdAt: '',
    ...overrides,
  } as unknown as Product
}

function render(node: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(node)
}

describe('splitEditorialTitle', () => {
  it('az első vessző utáni tagot dőltre választja', () => {
    expect(splitEditorialTitle('A place, imagined.')).toEqual({
      head: 'A place,',
      tail: 'imagined.',
    })
  })

  it('vessző nélkül a teljes címet a főágon hagyja', () => {
    expect(splitEditorialTitle('Kézrehab')).toEqual({ head: 'Kézrehab', tail: null })
  })
})

describe('CourseShowcase', () => {
  it('üres listán semmit nem renderel', () => {
    expect(render(createElement(CourseShowcase, { products: [] }))).toBe('')
  })

  it('egy galéria, audience kickerben, ár a kártyán, Kurzusaink vízjel', () => {
    const html = render(
      createElement(CourseShowcase, {
        products: [
          product({ id: 1, sku: 'Otthoni program', slug: 'otthoni', audience: 'laikus' }),
          product({ id: 2, sku: 'Szakmai képzés', slug: 'pro', audience: 'szakember' }),
        ],
      }),
    )
    expect(html).toContain('kc-course-showcase')
    expect(html).toContain(COURSE_SHOWCASE_HEADING)
    expect(html).toContain(COURSE_SHOWCASE_MARK)
    expect(html).toContain('Otthoni gyakorlóknak')
    expect(html).toContain('Szakembereknek')
    expect(html).toContain('/kurzusok/otthoni')
    expect(html).toContain('/kurzusok/pro')
    expect(html).not.toContain('id="otthoni"')
    expect(html).not.toContain('id="szakembereknek"')
  })

  it('borító nélkül a csapatportré-tartalékot teszi be', () => {
    const html = render(createElement(CourseShowcase, { drift: false, products: [product({ id: 1 })] }))
    expect(html).toContain(showcaseFallbackAt(0).src)
  })
})

describe('course-showcase.css — token-őr', () => {
  const css = readFileSync(
    fileURLToPath(new URL('../app/(frontend)/styles/blocks/course-showcase.css', import.meta.url)),
    'utf8',
  )

  it('900 px-en három hasáb, reduced-motion leállítja a sodródást', () => {
    expect(css).toContain('repeat(3, minmax(0, 1fr))')
    expect(css).toContain('prefers-reduced-motion: reduce')
    expect(css).toContain('color: var(--kc-color-accent)')
    expect(css).toContain('font-size: var(--kc-font-l)')
    expect(css).toContain('font-size: var(--kc-font-m)')
    expect(css).toContain('font-size: var(--kc-font-s)')
  })
})

describe('bekötés — egy galéria, nem két sáv', () => {
  it('a /kurzusok oldal CourseShowcase-t renderel, nem két CourseAudienceBand-et', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../app/(frontend)/kurzusok/page.tsx', import.meta.url)),
      'utf8',
    )
    expect(source).toContain('CourseShowcase')
    expect(source).not.toContain('CourseAudienceBand')
    expect(source).not.toContain('AUDIENCE_BANDS')
  })

  it('a kezdőlap fallback és a CMS courseCards blokk a galériát kapja', () => {
    const home = readFileSync(
      fileURLToPath(new URL('../components/content/HomeView.tsx', import.meta.url)),
      'utf8',
    )
    const blocks = readFileSync(
      fileURLToPath(new URL('../components/blocks/RenderBlocks.tsx', import.meta.url)),
      'utf8',
    )
    expect(home).toContain('<CourseShowcase')
    expect(blocks).toContain('<CourseShowcase')
    expect(home).not.toContain('<CourseCards')
    expect(blocks).not.toContain('<CourseCards')
  })
})
