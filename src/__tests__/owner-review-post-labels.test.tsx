import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PostCard } from '../components/content/PostCard'
import type { Post } from '../payload-types'

function render(categories: unknown, variant: 'list' | 'compact' = 'list') {
  return renderToStaticMarkup(
    createElement(PostCard, {
      post: {
        id: 1,
        slug: 'teszt-cikk',
        title: 'A cikk címe',
        status: 'published',
        categories,
      } as Post,
      variant,
    }),
  )
}

function labels(html: string) {
  return [...html.matchAll(/<span class="kc-badge kc-badge--info"[^>]*>([^<]+)<\/span>/g)].map(
    (match) => match[1],
  )
}

describe('H12/K01: megtisztított, valós címke a kártyán', () => {
  // EGYETLEN címke: az ELSŐ feloldott, nem üres kategória neve (trimmelve).
  // docs/tudastar-ux-terv.md 3.2, tulajdonosi egységesítés-kérés 2026-09-07.
  it.each(['list', 'compact'] as const)('%s: trim, az első valós kategória, egyetlen biléta', (variant) => {
    const html = render(
      [
        99,
        { id: 4, title: '  ' },
        { id: 1, title: '  Kéz  ' },
        { id: 3, title: 'Csukló' },
      ],
      variant,
    )
    expect(labels(html)).toEqual(['Kéz'])
    expect([...html.matchAll(/<a\b/g)]).toHaveLength(1)
    expect(html).not.toMatch(/<button|role="button"|tabindex=/i)
    expect(html).toContain('href="/blog/teszt-cikk">A cikk címe</a>')
  })

  it.each(
    [undefined, null, [], [99], [{ id: 1, title: '  ' }], [null, 99, { title: 12 }]].map(
      (categories) => [categories],
    ),
  )(
    'hiányzó vagy fel nem oldott kategória: általános Tudástár-jelzés, nem kitalált besorolás (%j)',
    (categories) => {
      const html = render(categories)
      expect(labels(html)).toEqual(['Tudástár'])
      expect(html).not.toContain('/blog/kategoria/')
      expect(html).not.toContain('Besorolatlan')
      expect([...html.matchAll(/<a\b/g)]).toHaveLength(1)
    },
  )
})
