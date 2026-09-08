import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RenderBlocks } from '../components/blocks/RenderBlocks'
import type { BlockCourseCards, Product } from '../payload-types'
import { ctaLabel } from '../lib/cta-vocabulary'

const products = [
  {
    id: 1,
    sku: 'Program',
    slug: 'program',
    status: 'published',
    priceInHUFEnabled: true,
    priceInHUF: 10000,
  },
  {
    id: 2,
    sku: 'SOS',
    slug: 'sos-kezrelax-villamkurzus',
    status: 'published',
    _status: 'published',
    priceInHUFEnabled: false,
  },
] as Product[]

function render(block: Partial<BlockCourseCards>) {
  return renderToStaticMarkup(
    <RenderBlocks
      layout={[{ blockType: 'courseCards', ...block }]}
      products={products}
      posts={[]}
      testimonials={[]}
    />,
  )
}

describe('courseCards CMS bindings', () => {
  it('renders the configured eyebrow and CTA through RenderBlocks, including the accessible name', () => {
    const html = render({ eyebrow: '  Valassz kurzust  ', ctaLabel: '  Ismerd meg a kurzust  ' })
    expect(html).toContain('class="kc-eyebrow">Valassz kurzust</p>')
    expect(html).toContain('class="kc-course-showcase__cta">Ismerd meg a kurzust</span>')
    expect(html).toContain('aria-label="Program: Ismerd meg a kurzust"')
    expect(html).toContain('href="/kurzusok/program"')
    expect(html).not.toContain('<button')
  })

  it.each([undefined, '', '   ', null])(
    'keeps the approved defaults with empty optional fields: %s',
    (value) => {
      expect(render({ eyebrow: value, ctaLabel: value })).toBe(render({}))
      expect(render({})).toContain(ctaLabel('course-sales-open'))
      expect(render({})).toContain(ctaLabel('free-course-claim'))
    },
  )
})
