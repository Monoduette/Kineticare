import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import { stilusLapNezetablakra, tokenek } from './helpers/css-geometria'

vi.mock('node:fs', () => ({ readFileSync: vi.fn() }))

function mediaErtek(
  css: string,
  szelesseg: number,
  magassag: number,
  kezdoBetumeretPx = 16,
): string | undefined {
  vi.mocked(readFileSync).mockReturnValue(css)
  return tokenek(
    stilusLapNezetablakra(['meresi-fixture.css'], szelesseg, magassag, kezdoBetumeretPx),
  ).get('--meres')
}

describe('CSS-geometria: explicit viewportmagasság', () => {
  it.each([
    ['min', 699.5, 'alap'],
    ['min', 700, 'aktiv'],
    ['min', 700.5, 'aktiv'],
    ['max', 699.5, 'aktiv'],
    ['max', 700, 'aktiv'],
    ['max', 700.5, 'alap'],
  ])('%s-height: 700px @%s px → %s', (hatar, magassag, vart) => {
    expect(
      mediaErtek(
        `:root { --meres: alap; }
      @media (${hatar}-height: 700px) { :root { --meres: aktiv; } }`,
        390,
        Number(magassag),
      ),
    ).toBe(vart)
  })

  it.each([450, 480, 700, 450.5])('tetszőleges numerikus px-határ: %s', (hatar) => {
    const css = `:root { --meres: alap; }
      @media (max-width: 860px) and (max-height: ${hatar}px) { :root { --meres: aktiv; } }`
    expect(mediaErtek(css, 860, hatar)).toBe('aktiv')
    expect(mediaErtek(css, 860.5, hatar)).toBe('alap')
    expect(mediaErtek(css, 860, hatar + 0.5)).toBe('alap')
  })

  it.each([
    [390, 449.5, 'alap'],
    [390, 450, 'belso'],
    [390, 700, 'belso'],
    [390, 700.5, 'kulso'],
    [861, 600, 'alap'],
  ])('egymásba ágyazott media + AND + supports @%s×%s', (szelesseg, magassag, vart) => {
    const css = `:root { --meres: alap; }
      @media screen and (max-width: 860px) and (min-height: 450px) {
        :root { --meres: kulso; }
        @supports (display: grid) {
          @media (min-width: 320px) and (max-height: 700px) {
            :root { --meres: belso; }
          }
        }
      }`
    expect(mediaErtek(css, Number(szelesseg), Number(magassag))).toBe(vart)
  })

  it.each([
    [319, 1000, 'aktiv'],
    [390, 700, 'aktiv'],
    [390, 701, 'alap'],
  ])('a vessző VAGY @%s×%s', (szelesseg, magassag, vart) => {
    expect(
      mediaErtek(
        `:root { --meres: alap; }
        @media (max-width: 320px), (max-height: 700px) { :root { --meres: aktiv; } }`,
        Number(szelesseg),
        Number(magassag),
      ),
    ).toBe(vart)
  })

  it.each([
    '(orientation: landscape)',
    '(max-height: 40ch)',
    '(min-width: 75vw)',
    '(height <= 700px)',
    '(max-width: 1px) and (unknown-feature: 1)',
    'screen, (unknown-feature: 1)',
  ])('az ismeretlen feltételt nem nyeli el: %s', (query) => {
    expect(() => mediaErtek(`@media ${query} { :root { --meres: aktiv; } }`, 390, 844)).toThrow(
      /ismeretlen média-jellemző/,
    )
  })

  it('az inaktív szülőben lévő ismeretlen media sem kerülheti meg az őrt', () => {
    expect(() =>
      mediaErtek(
        `@media (max-height: 1px) {
      @media (unknown-feature: 1) { :root { --meres: aktiv; } }
    }`,
        390,
        844,
      ),
    ).toThrow(/ismeretlen média-jellemző/)
  })

  it.each([undefined, Number.NaN, Infinity, -1, 0])(
    'nem becsül hiányzó/hibás magasságot: %s',
    (magassag) => {
      expect(() => mediaErtek(':root { --meres: alap; }', 390, magassag as number)).toThrow(
        /nézetablak-magasság/,
      )
    },
  )

  it('a képernyős, alapmozgású mérés továbbra is kihagyja a print/reduce ágakat', () => {
    expect(
      mediaErtek(
        `:root { --meres: alap; }
      @media print { :root { --meres: nyomtatas; } }
      @media (prefers-reduced-motion: reduce) { :root { --meres: csokkentett; } }`,
        390,
        844,
      ),
    ).toBe('alap')
  })
})

describe('CSS media: initial font size, independent of authored root styles', () => {
  for (const unit of ['em', 'rem']) {
    for (const dimension of ['width', 'height']) {
      for (const bound of ['min', 'max']) {
        it.each([16, 20])(`${bound}-${dimension}: 75${unit}, initial font %spx`, (initial) => {
          const css = `:root { font-size: 48px; --meres: alap; }
            @media (${bound}-${dimension}: 75${unit}) { :root { --meres: aktiv; } }`
          for (const delta of [-0.5, 0, 0.5]) {
            const size = 75 * initial + delta
            expect(
              mediaErtek(
                css,
                dimension === 'width' ? size : 390,
                dimension === 'height' ? size : 844,
                initial,
              ),
            ).toBe((bound === 'min' ? delta >= 0 : delta <= 0) ? 'aktiv' : 'alap')
          }
        })
      }
    }
  }

  it('propagates the initial font through nested media/supports and mixed-unit AND/OR', () => {
    const css = `:root { --meres: alap; }
      @media (min-width: 75em) {
        @supports (display: grid) {
          @media (max-height: 40rem) and (min-width: 1500px), print { :root { --meres: aktiv; } }
        }
      }`
    expect(mediaErtek(css, 1500, 800, 20)).toBe('aktiv')
    expect(mediaErtek(css, 1499.5, 800, 20)).toBe('alap')
    expect(mediaErtek(css, 1500, 800.5, 20)).toBe('alap')
    expect(mediaErtek(css, 1500, 800, 16)).toBe('alap')
  })

  it('keeps unsupported units fail-closed even inside inactive relative queries', () => {
    expect(() =>
      mediaErtek(
        `@media (min-width: 75em) {
      @media (max-height: 40ch) { :root { --meres: aktiv; } }
    }`,
        390,
        844,
      ),
    ).toThrow(/ismeretlen média-jellemző.*40ch/)
  })

  it.each([0, -1, NaN, Infinity])('rejects invalid initial font size %s', (initial) => {
    expect(() => mediaErtek(':root { --meres: alap; }', 390, 844, initial)).toThrow(/betűméret/)
  })
})
