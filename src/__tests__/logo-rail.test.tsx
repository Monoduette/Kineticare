// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LogoRail } from '../components/blocks/LogoRail'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const css = readFileSync(
  path.join(process.cwd(), 'src/app/(frontend)/styles/blocks/press-logos.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

function logos(count = 2): ReactNode {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <li className="kc-press__item" key={index}>
          <a className="kc-press__link" href={`https://example.com/${index}`}>
            {index + 1}. logó
          </a>
        </li>
      ))}
    </>
  )
}

describe('LogoRail', () => {
  let container: HTMLDivElement
  let root: Root
  let reduced = false

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: reduced,
        media: '(prefers-reduced-motion: reduce)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function renderRail(count = 2) {
    await act(async () => root.render(<LogoRail count={count}>{logos(count)}</LogoRail>))
  }

  it('normál módban automatikusan indul, a vizuális másolat rejtett és inert', async () => {
    await renderRail()

    const rail = container.querySelector<HTMLElement>('.kc-press__rail')
    const rows = container.querySelectorAll<HTMLUListElement>('.kc-press__row')
    const clone = rows[1]

    expect(rail?.dataset.motion).toBe('marquee')
    expect(rail?.dataset.paused).toBe('false')
    expect(rows).toHaveLength(2)
    expect(rows[0].getAttribute('aria-hidden')).toBeNull()
    expect(clone.getAttribute('aria-hidden')).toBe('true')
    expect(clone.hasAttribute('inert')).toBe(true)
  })

  it.each([2, 6, 10])(
    '%i logónál két azonos elemszámú csoportot köt a mért viewport-szélességhez',
    async (count) => {
      await renderRail(count)
      const rows = container.querySelectorAll('.kc-press__row')
      const viewport = container.querySelector<HTMLElement>('.kc-press__viewport')
      const rail = container.querySelector<HTMLElement>('.kc-press__rail')

      expect(rows).toHaveLength(2)
      expect(rows[0].children).toHaveLength(count)
      expect(rows[1].children).toHaveLength(count)
      expect(rail?.dataset.measured).toBe('true')
      expect(viewport?.style.getPropertyValue('--kc-press-viewport-width')).toBe('390px')
      expect(viewport?.style.getPropertyValue('--kc-press-cycle-width')).toBe('390px')
      expect(viewport?.style.getPropertyValue('--kc-press-cycle-offset')).toMatch(/^-[\d.]+px$/)
    },
  )

  it('a gomb tartósan szünetelteti, majd ugyanonnan újraindítja a sort', async () => {
    await renderRail()
    const button = container.querySelector<HTMLButtonElement>('.kc-press__control')
    const rail = container.querySelector<HTMLElement>('.kc-press__rail')

    expect(button?.getAttribute('aria-label')).toBe('Megállítom a logósort')
    expect(button?.getAttribute('aria-pressed')).toBe('false')
    expect(button?.querySelector('.kc-press__control-icon')?.textContent).toBe('Ⅱ')
    expect(button?.querySelector('svg')).toBeNull()

    await act(async () => button?.click())
    expect(rail?.dataset.paused).toBe('true')
    expect(button?.getAttribute('aria-label')).toBe('Elindítom a logósort')
    expect(button?.getAttribute('aria-pressed')).toBe('true')
    expect(button?.querySelector('.kc-press__control-icon')?.textContent).toBe('▶')

    await act(async () => button?.click())
    expect(rail?.dataset.paused).toBe('false')
  })

  it('csökkentett mozgásnál és egyetlen logónál teljes statikus listát ad vezérlő nélkül', async () => {
    reduced = true
    await renderRail()
    expect(container.querySelector('.kc-press__rail')?.getAttribute('data-motion')).toBe('static')
    expect(container.querySelectorAll('.kc-press__row')).toHaveLength(1)
    expect(container.querySelector('.kc-press__control')).toBeNull()

    await act(async () => root.render(<LogoRail count={1}>{logos(1)}</LogoRail>))
    expect(container.querySelectorAll('.kc-press__row')).toHaveLength(1)
    expect(container.querySelector('.kc-press__control')).toBeNull()
  })

  it('azonos logókeretet ad a linkelt és önálló képeknek, torzítás nélkül', () => {
    expect(css).toMatch(/--kc-press-logo-width:\s*clamp\(9rem, 14vw, 11rem\)/)
    expect(css).toMatch(/\.kc-press__item\s*\{[^}]*width:\s*var\(--kc-press-logo-width\)/s)
    expect(css).toMatch(/\.kc-press__link\s*\{[^}]*width:\s*100%/s)
    expect(css).toMatch(/\.kc-press__row img\s*\{[^}]*width:\s*100%/s)
    expect(css).toMatch(/\.kc-press__row img\s*\{[^}]*height:\s*var\(--kc-press-logo-height\)/s)
    expect(css).toMatch(/\.kc-press__row img\s*\{[^}]*object-fit:\s*contain/s)
    expect(css).toMatch(/\.kc-press__row img\s*\{[^}]*object-position:\s*center/s)
  })

  it('a CSS content-width, folytonos és minden előírt módon megállítható', () => {
    expect(css).toMatch(/\.kc-press__track\s*\{[^}]*width:\s*max-content/s)
    expect(css).toMatch(
      /\.kc-press__row\s*\{[^}]*min-width:\s*var\(--kc-press-viewport-width,\s*100vw\)/s,
    )
    expect(css).toMatch(
      /\.kc-press__row\s*\{[^}]*width:\s*var\(--kc-press-cycle-width,\s*max-content\)/s,
    )
    expect(css).not.toMatch(/min-width:\s*(?:100%|100cq[wi])/)
    expect(css).toMatch(
      /\[data-measured='true'\][^{]*\.kc-press__track[^}]*animation:\s*kc-press-marquee[^;]+linear\s+infinite/s,
    )
    expect(css).toMatch(/translate3d\(var\(--kc-press-cycle-offset\),\s*0,\s*0\)/)
    expect(css).not.toMatch(/translate3d\([^)]*-50%/)
    expect(css).toMatch(/mask-image:\s*linear-gradient/)
    expect(css).toMatch(
      /\[data-paused='true'\][^{]*\.kc-press__track[^}]*animation-play-state:\s*paused/s,
    )
    expect(css).toMatch(/\.kc-press__viewport:hover[^}]*animation-play-state:\s*paused/s)
    expect(css).toMatch(/\.kc-press__viewport:focus-within\s*\{[^}]*mask-image:\s*none/s)
    expect(css).toMatch(
      /\.kc-press__viewport:focus-within \.kc-press__track\s*\{[^}]*animation:\s*none/s,
    )
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*animation:\s*none/)
    expect(css).not.toContain('13.75rem')
  })
})
