import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { About } from '../components/blocks/About'
import { PressLogos } from '../components/blocks/PressLogos'
import { TeamMembers } from '../components/blocks/TeamMembers'
import type { BlockAbout, BlockPressLogos, BlockTeamMembers, Media } from '../payload-types'

const photo = {
  id: 1,
  url: '/media/founders.jpg',
  alt: 'Kiss Kata és Kocsis Kata',
  width: 1000,
  height: 1500,
  createdAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z',
} satisfies Media

const about = (extra: Partial<BlockAbout> = {}): BlockAbout => ({
  blockType: 'about',
  id: 'about-owner',
  title: 'Kiss Kata és Kocsis Kata vagyunk',
  paragraphs: [{ text: 'Megmutatjuk a gyakorlatokat.' }],
  photo,
  ...extra,
})

const css = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../app/(frontend)/styles/blocks/${name}.css`, import.meta.url)),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '')

describe('owner review: About tartalomhoz igazodó elrendezés', () => {
  it('statisztika nélkül is páros kép-szöveg elrendezés, természetes magasságú sáv', () => {
    const html = renderToStaticMarkup(<About block={about()} />)
    expect(html).toContain('kc-about--paired')
    expect(html).toContain('kc-board--band')
    expect(html).not.toContain('kc-board--edge')
    expect(html).not.toContain('<dl')
    expect(html).toContain(photo.alt)
    expect(html).not.toContain('56vw')
  })

  it.each([undefined, 19, { ...photo, url: null }])(
    'feloldatlan vagy URL nélküli fotó nem hagy üres képhasábot: %s',
    (missing) => {
      const html = renderToStaticMarkup(<About block={about({ photo: missing })} />)
      expect(html).not.toContain('kc-about--paired')
      expect(html).not.toContain('<figure')
      expect(html).toContain('Megmutatjuk a gyakorlatokat.')
    },
  )

  it('a statisztikák megmaradnak, az üres tételek kimaradnak', () => {
    const html = renderToStaticMarkup(
      <About
        block={about({
          stats: [
            { value: '12', label: 'kreditpont' },
            { value: '', label: '' },
          ],
        })}
      />,
    )
    expect(html.match(/<dl/g)).toHaveLength(1)
    expect(html.match(/<dt/g)).toHaveLength(1)
    expect(html).toContain('kreditpont')
    expect(css('about')).toMatch(/\.kc-about__stats\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s)
  })

  it('csak kép esetén nincs üres szöveghasáb; teljesen üres blokk nem renderel', () => {
    const html = renderToStaticMarkup(<About block={about({ title: '', paragraphs: [] })} />)
    expect(html).not.toContain('kc-about__copy')
    expect(html).not.toContain('kc-about--paired')
    expect(html).toContain('<img')
    expect(
      renderToStaticMarkup(<About block={about({ title: '', paragraphs: [], photo: null })} />),
    ).toBe('')
  })

  it('a statisztikafelirat a teljes cellaszélességet használja, nem a régi 12ch hasábot', () => {
    expect(css('about')).toMatch(/\.kc-about__stat-label\s*\{[^}]*max-width:\s*100%/s)
  })

  it('az A01 statikus hullámszéle csak a Rólunk horgony alsó 3px-es képszélére vonatkozik', () => {
    const html = renderToStaticMarkup(
      <About block={about({ sectionSettings: { anchorId: 'rolunk' } })} />,
    )
    expect(html).toContain('id="rolunk"')
    const rule = css('about').match(/\.kc-about#rolunk \.kc-about__figure\s*\{([^}]+)\}/)?.[1]
    expect(rule).toBeDefined()
    expect(rule).toContain('calc(100% - 3px)')
    expect(rule).toContain('radial-gradient(ellipse 24px 3px at 50% 0, #000 100%, #0000 100%)')
    expect(rule).not.toMatch(/animation|transition|filter|opacity/)
  })
})

describe('owner review: nevesített, közepes portrék', () => {
  it('a név, a saját fotó és a CMS-sorrend megmarad', () => {
    const block: BlockTeamMembers = {
      blockType: 'teamMembers',
      title: 'Szakmai hátterünk',
      members: [
        { name: 'Kocsis Kata', photo: { ...photo, url: '/media/kocsis.png', alt: 'Kocsis Kata' } },
        { name: 'Kiss Kata', photo: { ...photo, url: '/media/kiss.png', alt: 'Kiss Kata' } },
      ],
    }
    const html = renderToStaticMarkup(<TeamMembers block={block} />)
    expect(html.match(/<article/g)).toHaveLength(2)
    expect(html.match(/<img/g)).toHaveLength(2)
    expect(html.indexOf('kocsis.png')).toBeLessThan(html.indexOf('kiss.png'))
    expect(html).toContain('<h3 class="kc-team__name">Kocsis Kata</h3>')
    expect(html).toContain('<h3 class="kc-team__name">Kiss Kata</h3>')
    expect(html).not.toContain('540px')
    expect(css('team-members')).toMatch(/\.kc-team__figure\s*\{[^}]*18rem/s)
    expect(css('team-members')).toMatch(/\.kc-team__figure img\s*\{[^}]*object-fit:\s*contain/s)
  })
})

describe('owner review: logósor SSR és link-szerződés', () => {
  const logos: BlockPressLogos = {
    blockType: 'pressLogos',
    id: 'press-owner',
    logos: [
      { image: photo, alt: 'Belső partner', url: '/rolunk' },
      { image: photo, alt: 'Külső partner', url: 'https://example.org', ujAblakban: true },
      { image: photo, alt: 'Tiltott célú partner', url: 'javascript:alert(1)' },
    ],
  }

  it('a szerver teljes statikus listát ad, másolt linkek és automatikus mozgás nélkül', () => {
    const html = renderToStaticMarkup(<PressLogos block={logos} />)
    expect(html.match(/<li\b/g)).toHaveLength(3)
    expect(html.match(/<a\b/g)).toHaveLength(2)
    expect(html).toContain('data-motion="static"')
    expect(html).not.toContain('aria-hidden="true"')
    expect(html).not.toContain('<button')
    expect(html).toContain('href="/rolunk"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('Tiltott célú partner')
  })

  it('URL nélküli Media objektum nem hoz létre üres logót vagy üres linket', () => {
    expect(
      renderToStaticMarkup(
        <PressLogos
          block={{ ...logos, logos: [{ image: { ...photo, url: null }, url: '/rolunk' }] }}
        />,
      ),
    ).toBe('')
  })
})
