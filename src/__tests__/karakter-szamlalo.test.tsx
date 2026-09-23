// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BEJELENTES_KESLELTETES_MS,
  karakterHossz,
  szamlaloModell,
} from '@/components/admin/KarakterSzamlaloLogika'

/**
 * Az admin élő karakterszámlálója (src/components/admin/KarakterSzamlalo.tsx):
 * a tiszta logika, a megjelenés akadálymentességi szerződése és a késleltetett
 * képernyőolvasós bejelentés (GOV.UK Character count minta).
 */

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let mezoErtek: unknown = ''
let kornyezetiUt: string | null = 'layout.0.captions.midTitle'

vi.mock('@payloadcms/ui', () => ({
  useFieldPath: () => kornyezetiUt,
  useFormFields: (selector: (state: [Record<string, { value: unknown }>]) => unknown) =>
    selector([{ 'layout.0.captions.midTitle': { value: mezoErtek } }]),
}))

const { KarakterSzamlalo, KarakterSzamlaloView } =
  await import('@/components/admin/KarakterSzamlalo')

/** A számláló stíluslapja, kommentek nélkül (a fejkomment mért hexa-értékeket idéz). */
const CSS = readFileSync(
  path.join(process.cwd(), 'src/components/admin/KarakterSzamlalo.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

describe('szamlaloModell', () => {
  it('a korláton belül „N / max karakter”', () => {
    expect(szamlaloModell('a'.repeat(38), 60)).toMatchObject({
      hossz: 38,
      tullepes: 0,
      tullepve: false,
      lathatoSzoveg: '38 / 60 karakter',
      bejelentes: 'Eddig 38 karakter, legfeljebb 60 lehet.',
    })
    expect(szamlaloModell('a'.repeat(60), 60)?.lathatoSzoveg).toBe('60 / 60 karakter')
    expect(szamlaloModell('', 60)?.lathatoSzoveg).toBe('0 / 60 karakter')
    expect(szamlaloModell(null, 120)?.lathatoSzoveg).toBe('0 / 120 karakter')
  })

  it('túllépésnél szövegesen mondja meg, mennyivel hosszabb', () => {
    expect(szamlaloModell('a'.repeat(72), 60)).toMatchObject({
      hossz: 72,
      tullepes: 12,
      tullepve: true,
      lathatoSzoveg: '12 karakterrel hosszabb a megengedettnél',
      bejelentes: '12 karakterrel hosszabb a megengedettnél. Legfeljebb 60 karakter lehet.',
    })
    expect(szamlaloModell('a'.repeat(61), 60)?.lathatoSzoveg).toBe(
      '1 karakterrel hosszabb a megengedettnél',
    )
  })

  it('ugyanúgy számol, mint a validátor: trim, NFC, kódpont', () => {
    expect(karakterHossz('  őű 😀  ')).toBe(4)
    expect(karakterHossz('o\u030B')).toBe(1)
    expect(szamlaloModell('😀'.repeat(60), 60)?.tullepve).toBe(false)
    expect(szamlaloModell('😀'.repeat(61), 60)?.tullepes).toBe(1)
  })

  it('érvénytelen korlátnál nem jelenik meg', () => {
    for (const max of [undefined, null, 0, -5, 1.5, '60']) {
      expect(szamlaloModell('abc', max)).toBeNull()
    }
  })

  it('a szövegek natív magyarok: nincs gondolatjel és felkiáltójel', () => {
    for (const modell of [szamlaloModell('abc', 60), szamlaloModell('a'.repeat(99), 60)]) {
      expect(`${modell?.lathatoSzoveg} ${modell?.bejelentes}`).not.toMatch(/[–—!]/)
    }
  })
})

describe('KarakterSzamlaloView: akadálymentességi szerződés', () => {
  const alap = szamlaloModell('a'.repeat(38), 60)
  const tul = szamlaloModell('a'.repeat(72), 60)
  if (!alap || !tul) {
    throw new Error('A modellnek léteznie kell.')
  }

  it('a látható szám aria-hidden, a bejelentés külön polite élő régióban van', () => {
    const html = renderToStaticMarkup(
      createElement(KarakterSzamlaloView, { modell: alap, bejelentes: '' }),
    )
    expect(html).toContain(
      '<p aria-hidden="true" class="kc-karakter-szamlalo__szoveg">38 / 60 karakter</p>',
    )
    expect(html).toMatch(
      /<div aria-atomic="true" aria-live="polite" class="kc-karakter-szamlalo__bejelentes"><\/div>/,
    )
  })

  it('nem fókuszálható: nincs tabindex, gomb, link vagy beviteli elem', () => {
    const html = renderToStaticMarkup(
      createElement(KarakterSzamlaloView, { modell: tul, bejelentes: tul.bejelentes }),
    )
    expect(html).not.toMatch(/tabindex|<button|<a\s|<input|<textarea|role="alert"/)
  })

  it('túllépésnél szöveg ÉS külön állapot-osztály (szín, súly) jelez', () => {
    const html = renderToStaticMarkup(
      createElement(KarakterSzamlaloView, { modell: tul, bejelentes: '' }),
    )
    expect(html).toContain('kc-karakter-szamlalo kc-karakter-szamlalo--tul')
    expect(html).toContain('12 karakterrel hosszabb a megengedettnél')
  })

  it('a CSS a Payload témaváltozóit használja, és a bejelentő régió vizuálisan rejtett', () => {
    const szabaly = (sel: string) =>
      CSS.match(
        new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`),
      )?.[1] ?? ''
    expect(szabaly('.kc-karakter-szamlalo')).toContain('color: var(--theme-elevation-650)')
    expect(szabaly('.kc-karakter-szamlalo--tul')).toContain('color: var(--theme-error-750)')
    expect(szabaly('.kc-karakter-szamlalo--tul')).toContain('font-weight: 600')
    const rejtett = szabaly('.kc-karakter-szamlalo__bejelentes')
    expect(rejtett).toContain('clip-path: inset(50%)')
    expect(rejtett).toContain('position: absolute')
    expect(rejtett).not.toMatch(/display:\s*none|visibility:\s*hidden/)
    expect(szabaly('.kc-karakter-szamlalo')).toContain('overflow-wrap: anywhere')
    expect(CSS).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i)
  })
})

describe('KarakterSzamlalo: késleltetett bejelentés', () => {
  let container: HTMLDivElement
  let root: Root

  const rajzol = (props: { max?: number; path?: string } = { max: 60 }) =>
    act(() => {
      root.render(createElement(KarakterSzamlalo, props))
    })
  const bejelentes = () =>
    container.querySelector('.kc-karakter-szamlalo__bejelentes')?.textContent ?? null
  const lathato = () => container.querySelector('.kc-karakter-szamlalo__szoveg')?.textContent

  beforeEach(() => {
    vi.useFakeTimers()
    mezoErtek = 'Minden alkalommal egy mozdulattal több'
    kornyezetiUt = 'layout.0.captions.midTitle'
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it('betöltéskor nem szól, csak a látható szám áll', async () => {
    await rajzol()
    expect(lathato()).toBe('38 / 60 karakter')
    await act(async () => {
      vi.advanceTimersByTime(BEJELENTES_KESLELTETES_MS * 3)
    })
    expect(bejelentes()).toBe('')
  })

  it('gépelés után a csend kivárásával jelent be, a látható szám azonnal frissül', async () => {
    await rajzol()
    mezoErtek = 'a'.repeat(59)
    await rajzol()
    expect(lathato()).toBe('59 / 60 karakter')
    await act(async () => {
      vi.advanceTimersByTime(BEJELENTES_KESLELTETES_MS - 1)
    })
    expect(bejelentes()).toBe('')
    mezoErtek = 'a'.repeat(72)
    await rajzol()
    await act(async () => {
      vi.advanceTimersByTime(BEJELENTES_KESLELTETES_MS - 1)
    })
    expect(bejelentes(), 'új leütés újraindítja a várakozást').toBe('')
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(bejelentes()).toBe(
      '12 karakterrel hosszabb a megengedettnél. Legfeljebb 60 karakter lehet.',
    )
    expect(container.querySelector('.kc-karakter-szamlalo--tul')).not.toBeNull()
  })

  it('a mezőkörnyezet útvonala hiányában a prop útvonalát olvassa', async () => {
    kornyezetiUt = null
    await rajzol({ max: 60, path: 'layout.0.captions.midTitle' })
    expect(lathato()).toBe('38 / 60 karakter')
  })

  it('korlát nélkül semmit nem rajzol', async () => {
    await rajzol({})
    expect(container.innerHTML).toBe('')
  })
})
