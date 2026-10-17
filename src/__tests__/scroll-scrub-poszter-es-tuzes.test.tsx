// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'

import postcss, { type AtRule, type Rule } from 'postcss'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FilmHero } from '@/components/blocks/FilmHero'
import type { BlockFilmHero } from '@/payload-types'

/**
 * A ScrollScrub JS-ága a poszter-módban és a tűzött elrendezésben
 * (2026-10-17, a PR #328 kritikus köreinek találatai).
 *
 * Három hihető regressziót fog:
 *  1. a `staticLayout` visszaáll a csak csökkentett mozgásra: 900 px alatt
 *     és legfeljebb 480 px magas nézetben a főszöveg (benne a CTA) a fejezet
 *     közepén kiúszik és kattinthatatlan lesz;
 *  2. a `--ss-pin-need` mérése kimarad: alacsony, széles ablakban a tűzött
 *     szöveg a CTA-ig nem fér a nézetbe, és a CTA sosem kattintható;
 *  3. a poszter-mód határának átlépése csak magasságváltozással (osztott
 *     képernyő, érintőképernyő) nem méri újra a pint.
 *
 * A happy-dom nem számol elrendezést és nem tölti a stíluslapot: a nézet
 * méretét, a média-lekérdezéseket és a pin `position` értékét a teszt adja
 * (a stíluslap szerződését a lenti CSS-őr fogja). A viselkedés böngészős
 * bizonyítéka a PR-leírás 19 nézetes mérése.
 */

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const BLOKK: BlockFilmHero = {
  blockType: 'filmHero',
  title: 'Teszt-cím',
  lead: 'Teszt-bevezető.',
}

/** A szöveg alja a pin tetejétől (px), a mért elrendezés helyett. */
const COPY_BOTTOM = 600

interface Nezet {
  width: number
  height: number
}

let nezet: Nezet = { width: 1280, height: 720 }
const lekerdezesek: Array<{ query: string; matches: boolean; listeners: Set<() => void> }> = []

/** Egy média-lekérdezés a szimulált nézetre (vessző = VAGY, `and` = ÉS). */
function illeszkedik(query: string): boolean {
  return query.split(',').some((resz) =>
    [...resz.matchAll(/\(([^)]+)\)/g)].every(([, feltetel]) => {
      const [kulcs, ertek] = feltetel.split(':').map((s) => s.trim())
      if (kulcs === 'max-width') return nezet.width <= parseFloat(ertek)
      if (kulcs === 'max-height') return nezet.height <= parseFloat(ertek)
      if (kulcs === 'prefers-reduced-motion') return false
      if (kulcs === 'hover' || kulcs === 'pointer') return false
      throw new Error(`ismeretlen média-feltétel: ${feltetel}`)
    }),
  )
}

/** Csak magasság-/szélességváltozás `resize` esemény nélkül (a `change` jön). */
function nezetValtozik(kovetkezo: Nezet): void {
  nezet = kovetkezo
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: nezet.width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: nezet.height })
  for (const mql of lekerdezesek) {
    const most = illeszkedik(mql.query)
    if (most !== mql.matches) {
      mql.matches = most
      for (const listener of mql.listeners) listener()
    }
  }
}

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  lekerdezesek.length = 0
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function mount(kezdo: Nezet, scrollY: number): Promise<HTMLElement> {
  nezetValtozik(kezdo)
  vi.stubGlobal('matchMedia', (query: string) => {
    const mql = { query, matches: illeszkedik(query), listeners: new Set<() => void>() }
    lekerdezesek.push(mql)
    return {
      get matches() {
        return mql.matches
      },
      media: query,
      onchange: null,
      addEventListener: (_tipus: string, listener: () => void) => mql.listeners.add(listener),
      removeEventListener: (_tipus: string, listener: () => void) => mql.listeners.delete(listener),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }
  })
  vi.stubGlobal('fetch', () => Promise.reject(new Error('a tesztben klip nem töltődhet')))
  Object.defineProperty(window, 'scrollY', { configurable: true, value: scrollY })

  const rect = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains('scroll-scrub')) {
      return new DOMRect(0, -window.scrollY, nezet.width, 0)
    }
    if (this.classList.contains('scroll-scrub__copy')) {
      return new DOMRect(0, COPY_BOTTOM - 300, 500, 300)
    }
    if (this.classList.contains('scroll-scrub__chapter-pin')) {
      return new DOMRect(0, 0, nezet.width, nezet.height)
    }
    return rect.call(this)
  })
  // A stíluslap szerint a pin tűzött, kivéve a poszter-módot (lásd a CSS-őrt).
  // A ScrollScrub a pinről csak a `position` értéket olvassa.
  const computed = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((elem, pseudo) => {
    if (elem instanceof HTMLElement && elem.classList.contains('scroll-scrub__chapter-pin')) {
      const poszter = illeszkedik('(max-width: 899px), (max-height: 480px)')
      return { position: poszter ? 'relative' : 'sticky' } as CSSStyleDeclaration
    }
    return computed(elem, pseudo)
  })

  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<FilmHero block={BLOKK} />))
  await act(async () => {
    window.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => setTimeout(resolve, 100))
  })
  return document.querySelector<HTMLElement>('.scroll-scrub__copy')!
}

const pin = () => document.querySelector<HTMLElement>('.scroll-scrub__chapter-pin')!

describe('ScrollScrub poszter-mód (statikus olvasó elrendezés)', () => {
  it.each([
    ['álló telefon', 390, 844],
    ['fekvő telefon', 932, 430],
    ['alacsony asztali ablak', 1280, 480],
  ])('%s (%i×%i): a főszöveg a fejezet közepén is látszik és kattintható', async (_n, w, h) => {
    const copy = await mount({ width: w, height: h }, Math.round(h * 0.7))
    expect(copy.style.opacity).toBe('1')
    expect(copy.style.pointerEvents).toBe('')
    expect(pin().style.getPropertyValue('--ss-pin-need')).toBe('')
  })

  it('negatív kontroll: tűzött nézetben a főszöveg ugyanott kiúszik', async () => {
    const copy = await mount({ width: 1280, height: 720 }, 504)
    expect(Number(copy.style.opacity)).toBeLessThan(0.05)
    expect(copy.style.pointerEvents).toBe('none')
  })
})

describe('ScrollScrub tűzött pin: a szöveg kiterjedése', () => {
  it('tűzött elrendezésben a szöveg aljáig mért kiterjedés (és a ráhagyás) a pinre kerül', async () => {
    await mount({ width: 1280, height: 560 }, 0)
    expect(pin().style.getPropertyValue('--ss-pin-need')).toBe(`${COPY_BOTTOM + 16}px`)
  })

  it('a poszter-mód határának átlépése resize nélkül is újraméri a pint', async () => {
    await mount({ width: 1280, height: 560 }, 0)
    await act(async () => nezetValtozik({ width: 1280, height: 470 }))
    expect(pin().style.getPropertyValue('--ss-pin-need')).toBe('')
    await act(async () => nezetValtozik({ width: 1280, height: 560 }))
    expect(pin().style.getPropertyValue('--ss-pin-need')).toBe(`${COPY_BOTTOM + 16}px`)
  })
})

describe('scroll-scrub.css: a pin eltolása', () => {
  const css = postcss.parse(readFileSync('src/components/scroll-scrub/scroll-scrub.css', 'utf8'))
  const pinTop = (szulo: postcss.Container) =>
    (szulo.nodes ?? [])
      .filter((node): node is Rule => node.type === 'rule')
      .filter((rule) => rule.selector === '.scroll-scrub__chapter-pin')
      .flatMap((rule) => rule.nodes)
      .filter((node) => node.type === 'decl' && node.prop === 'top')
      .map((node) => (node.type === 'decl' ? node.value : ''))

  it('tűzött pinnél a sütisáv és a mért kiterjedés adja a felső eltolást, legfeljebb 0', () => {
    expect(pinTop(css)).toEqual([
      'min(0px, 100dvh - var(--kc-consent-offset, 0px) - var(--ss-pin-need, 0px))',
    ])
  })

  it('a statikus (relatív) pinre az eltolás nem hat', () => {
    const statikus = css.nodes.find(
      (node): node is AtRule =>
        node.type === 'atrule' &&
        node.name === 'media' &&
        node.params.split(',')[0].trim() === '(prefers-reduced-motion: reduce)',
    )
    expect(statikus).toBeDefined()
    expect(pinTop(statikus!)).toEqual(['0'])
  })
})
