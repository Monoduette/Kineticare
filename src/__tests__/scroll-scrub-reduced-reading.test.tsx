import { readFileSync } from 'node:fs'
import Link from 'next/link'
import postcss, { type AtRule, type Rule } from 'postcss'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  ScrollScrub,
  captionOpacity,
  sceneCopyOpacity,
} from '@/components/scroll-scrub/scroll-scrub'

const css = postcss.parse(readFileSync('src/components/scroll-scrub/scroll-scrub.css', 'utf8'))
const reduced = css.nodes.find(
  (node): node is AtRule =>
    node.type === 'atrule' && node.params === '(prefers-reduced-motion: reduce)',
)!
const declaration = (nodes: (Rule | AtRule)[], selector: string, prop: string) => {
  const rule = nodes.find(
    (node): node is Rule => node.type === 'rule' && node.selector === selector,
  )
  return rule?.nodes.find((node) => node.type === 'decl' && node.prop === prop)
}

describe('reduced-motion static reading', () => {
  it('keeps the main copy and its scrim fully visible before and after the old handoff', () => {
    for (const progress of [0, 0.31, 180 / 470.8, 0.8, 1]) {
      expect(sceneCopyOpacity(progress, 0.31, true)).toBe(1)
      expect(sceneCopyOpacity(progress, 0.38, true)).toBe(1)
    }
  })

  it('preserves the normal film opacity curve exactly', () => {
    for (let step = 0; step <= 100; step++) {
      for (const handoff of [0.31, 0.38, 1]) {
        expect(sceneCopyOpacity(step / 100, handoff, false)).toBe(
          captionOpacity(step / 100, 0, handoff),
        )
      }
    }
  })

  it('uses natural text flow at every reduced viewport height and swaps caption presentations', () => {
    expect(
      declaration(reduced.nodes as Rule[], '.scroll-scrub__chapter-pin', 'position'),
    ).toMatchObject({ value: 'relative' })
    expect(
      declaration(reduced.nodes as Rule[], '.scroll-scrub__captions', 'display'),
    ).toMatchObject({ value: 'none' })
    expect(
      declaration(reduced.nodes as Rule[], '.scroll-scrub__reading-captions', 'display'),
    ).toMatchObject({ value: 'grid' })
    expect(
      declaration(css.nodes as Rule[], '.scroll-scrub__reading-captions', 'display'),
    ).toMatchObject({ value: 'none' })
    expect(
      declaration(reduced.nodes as Rule[], '.scroll-scrub__chapter', 'min-height'),
    ).toMatchObject({ value: '100dvh' })
  })

  it('puts every static caption title and body after the main story, with no duplicated actions', () => {
    const markup = renderToStaticMarkup(
      <ScrollScrub
        scenes={[
          {
            id: 'main',
            label: 'Main',
            poster: '/poster.webp',
            clip: '/film.mp4',
            title: 'Main title',
            body: 'Main body',
            scroll: 4.6,
            actions: <Link href="/courses">Courses</Link>,
          },
        ]}
        theme={{ background: '#fff', ink: '#111', muted: '#333', accent: '#00f' }}
        captions={[
          {
            id: 'mid',
            text: 'Middle title',
            body: 'Middle body',
            align: 'right',
            from: 0.4,
            to: 0.6,
          },
          { id: 'end', text: 'End title', body: 'End body', align: 'center', from: 0.8, to: 1 },
        ]}
      />,
    )
    const start = markup.indexOf('<ul class="scroll-scrub__reading-captions"')
    expect(start).toBeGreaterThan(markup.indexOf('</article>'))
    const reading = markup.slice(start, markup.indexOf('</ul>', start))
    for (const content of ['Middle title', 'Middle body', 'End title', 'End body']) {
      expect(reading).toContain(content)
    }
    expect(reading.match(/<li/g)).toHaveLength(2)
    expect(reading).not.toMatch(/aria-hidden|data-scroll-scrub-caption|<a /)
    expect(markup.match(/href="\/courses"/g)).toHaveLength(1)
  })
})
