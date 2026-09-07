import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DesktopNav } from '../components/layout/DesktopNav'
import { MobileNav } from '../components/layout/MobileNav'
import { buildNavTree } from '../lib/menu-tree'
import { SOS_FREE_MENU_LABEL, SOS_MENU_LABEL } from '../lib/sos-offer-copy'
import type { Menu, Product } from '../payload-types'

/**
 * A fejléc ALMENÜ-renderelése (desktop lenyíló + mobil drawer).
 *
 * A tesztkörnyezet `node` (nincs jsdom), ezért a SZERVER-RENDERELT kimenetet
 * mérjük: pontosan azt, amit a látogató a hidratálás ELŐTT és JS nélkül kap.
 * Ez a réteg a fontos a hozzáférhetőség szempontjából — ha itt hiányzik az
 * almenü, akkor a keresőrobot és a JS nélküli látogató sem látja.
 *
 * A kattintás/hover/Escape viselkedést a komponens állapotgépe adja
 * (DesktopNav), azt böngészőben kell próbálni; itt a SZERZŐDÉST rögzítjük:
 * milyen elemek, milyen ARIA-kapcsolatokkal kerülnek ki.
 */

const render = (element: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(element)

function urlMenu(id: number, label: string, url: string, overrides: Partial<Menu> = {}): Menu {
  return {
    id,
    label,
    type: 'url',
    url,
    ref: null,
    parent: null,
    order: null,
    visible: true,
    openInNewTab: false,
    updatedAt: '',
    createdAt: '',
    ...overrides,
  } as unknown as Menu
}

/** Két szintű próbafa: egy almenüs és egy almenü nélküli gyökér. */
const twoLevelTree = () =>
  buildNavTree([
    urlMenu(1, 'Szolgáltatások', '/szolgaltatasok', { order: 0 }),
    urlMenu(2, 'Rendelői kezelések', '/szolgaltatasok#rendeloi', { parent: 1, order: 0 }),
    urlMenu(3, 'Szakmai képzés', 'https://probodystudio.hu/kez-workshop/', {
      parent: 1,
      order: 1,
      openInNewTab: true,
    }),
    urlMenu(4, 'Tudástár', '/blog', { order: 1 }),
  ])

const attribute = (html: string, pattern: RegExp): string | undefined =>
  html.match(pattern)?.[1]

describe('DesktopNav — lenyíló almenü', () => {
  const html = render(createElement(DesktopNav, { items: twoLevelTree() }))

  it('az almenü elemei a szerver-renderelt HTML-ben is benne vannak', () => {
    expect(html).toContain('/szolgaltatasok#rendeloi')
    expect(html).toContain('https://probodystudio.hu/kez-workshop/')
    expect(html).toContain('kc-nav-desktop__submenu')
    expect(html).toContain('Szolgáltatások almenü')
  })

  it('a lenyitó gomb aria-controls-a a saját almenü-listára mutat', () => {
    const controls = attribute(html, /aria-controls="([^"]+)"/)
    const submenuId = attribute(html, /class="kc-nav-desktop__submenu" id="([^"]+)"/)

    expect(controls).toBeDefined()
    expect(submenuId).toBeDefined()
    expect(controls).toBe(submenuId)
  })

  it('a lenyitó gomb zárt állapotot jelez, és csak az almenüs menüpont kapja', () => {
    expect(html).toContain('aria-expanded="false"')
    // Egyetlen gomb: a „Tudástár" almenü nélküli, ahhoz nem tartozik lenyitó.
    expect(html.match(/kc-nav-desktop__toggle/g)).toHaveLength(1)
  })

  it('a szerver-renderelt HTML-ben NINCS data-open (JS nélkül a CSS hover/fókusz réteg dönt)', () => {
    expect(html).not.toContain('data-open')
  })

  it('a külső almenüpont új lapon nyílik, noopener/noreferrer-rel és jelöléssel', () => {
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('kc-nav__external-icon')
    expect(html).toContain('(külső hivatkozás)')
  })

  it('almenü nélküli menüpont nem kap üres lenyílót', () => {
    const single = render(
      createElement(DesktopNav, { items: buildNavTree([urlMenu(1, 'Tudástár', '/blog')]) }),
    )
    expect(single).not.toContain('kc-nav-desktop__submenu')
    expect(single).not.toContain('kc-nav-desktop__toggle')
  })
})

describe('MobileNav — drawer almenü', () => {
  const html = render(createElement(MobileNav, { items: twoLevelTree() }))

  it('az almenü a drawerben KIBONTVA renderel (egy gesztussal elérhető minden cél)', () => {
    expect(html).toContain('kc-nav-mobile__sublist')
    expect(html).toContain('kc-nav-mobile__sublink')
    expect(html).toContain('/szolgaltatasok#rendeloi')
    expect(html).toContain('https://probodystudio.hu/kez-workshop/')
  })

  it('az almenü-lista a szülő menüpont nevével azonosított', () => {
    expect(html).toContain('aria-label="Szolgáltatások almenü"')
  })

  it('a hamburger zárt drawert jelez, és az aria-controls a drawerre mutat', () => {
    const controls = attribute(html, /aria-controls="([^"]+)"/)
    const drawerId = attribute(html, /class="kc-nav-mobile__drawer"[^>]*id="([^"]+)"/)

    expect(html).toContain('aria-expanded="false"')
    expect(controls).toBeDefined()
    expect(controls).toBe(drawerId)
  })

  it('üres menü esetén beszédes üzenet, nem néma üres drawer', () => {
    const empty = render(createElement(MobileNav, { items: [] }))
    expect(empty).toContain('A menü jelenleg üres.')
  })
})

describe('SOS almenüfelirat — desktop és mobil', () => {
  const items = buildNavTree([
    urlMenu(1, 'Szolgáltatások', '/szolgaltatasok', { order: 0 }),
    {
      ...urlMenu(6, SOS_MENU_LABEL, '/kurzusok/sos-kezrelax-villamkurzus', {
        parent: 1,
        order: 2,
      }),
      type: 'product',
      url: null,
      ref: {
        relationTo: 'products',
        value: {
          id: 2,
          slug: 'sos-kezrelax-villamkurzus',
          status: 'published',
          _status: 'draft',
          priceInHUFEnabled: false,
        } as Product,
      },
    } as Menu,
  ])

  it('a storefront-látható ingyenes SOS mindkét navban Ingyenes feliratot kap', () => {
    const desktop = render(createElement(DesktopNav, { items }))
    const mobile = render(createElement(MobileNav, { items }))

    for (const html of [desktop, mobile]) {
      expect(html).toContain(`href="/kurzusok/sos-kezrelax-villamkurzus"`)
      expect(html).toContain(`>${SOS_FREE_MENU_LABEL}</a>`)
      expect(html).not.toMatch(new RegExp(`>${SOS_MENU_LABEL}<`))
    }
  })
})

/**
 * WP9 (2026-09-07) őrök: a billentyűs viselkedés böngészőben mérhető
 * (header-responsive.browser.mjs); itt a FORRÁS szerződését rögzítjük, hogy
 * a csapda és a nyílbillentyűk ne tűnjenek el egy átíráskor.
 */
const forras = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

describe('MobileNav — fókuszcsapda a nyitott fiókban (WCAG 2.2 SC 2.4.11, APG modális párbeszéd)', () => {
  const mobile = forras('../components/layout/MobileNav.tsx')

  it('a Tab a fiókon belül körbejár, az Escape zár', () => {
    expect(mobile).toContain("event.key === 'Tab'")
    expect(mobile).toContain('trapTabInDrawer(event, drawerRef.current)')
    expect(mobile).toContain("event.key === 'Escape'")
    // Az utolsóról az elsőre, az elsőről az utolsóra (APG: „Tab and
    // Shift + Tab do not move focus outside the dialog").
    expect(mobile).toMatch(/event\.shiftKey && active === first[\s\S]*last\.focus\(\)/)
    expect(mobile).toMatch(/!event\.shiftKey && active === last[\s\S]*first\.focus\(\)/)
    expect(mobile).toContain('focus-not-obscured-minimum')
    expect(mobile).toContain('patterns/dialog-modal/')
  })

  it('a fiók elemre ref mutat, és a rejtett elemek nem tabbolhatók a csapdában', () => {
    expect(mobile).toContain('ref={drawerRef}')
    expect(mobile).toContain('getClientRects().length > 0')
  })
})

describe('DesktopNav — nyílbillentyűk a lenyílóban (APG disclosure navigation, opcionális)', () => {
  const desktop = forras('../components/layout/DesktopNav.tsx')

  it('Le/Fel nyíl, Home és End kezelve, Escape megmarad', () => {
    expect(desktop).toContain("new Set(['ArrowDown', 'ArrowUp', 'Home', 'End'])")
    expect(desktop).toContain("event.key === 'Escape'")
    expect(desktop).toContain("event.key === 'ArrowUp'")
    expect(desktop).toContain("event.key === 'ArrowDown' && index !== -1")
    expect(desktop).toContain('disclosure/examples/disclosure-navigation/')
  })

  it('zárt lenyílón a nyitás utáni fókuszlépés a következő renderben történik (visibility: hidden)', () => {
    expect(desktop).toContain('pendingFocus')
    expect(desktop).toMatch(/useEffect\(\(\) => \{\s*const pending = pendingFocus\.current/)
  })
})

describe('layout.css — 320 px-es sáv és a lenyíló hierarchiája (WP9)', () => {
  const css = forras('../app/(frontend)/styles/layout.css').replace(/\/\*[\s\S]*?\*\//g, '')

  it('a sáv hamburgere 8 px-es optikai túlnyúlást kap, a fiók bezáró gombja nem', () => {
    expect(css).toMatch(
      /\.kc-site-header__actions \.kc-nav-mobile__toggle\s*\{[^}]*--kc-hamburger-overhang:\s*var\(--kc-space-2\)/,
    )
    expect(css).toMatch(/\.kc-nav-mobile__toggle\s*\{[^}]*--kc-hamburger-overhang:\s*0px/)
    expect(css).toMatch(
      /margin-inline-end:\s*calc\(-1 \* var\(--kc-hamburger-overhang\)\)/,
    )
  })

  it('400 px alatt a sáv és az akciósáv köze a 8 px-es lépcső', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 400px)'))
    expect(narrow).toMatch(
      /\.kc-site-header__bar,\s*\.kc-site-header__actions\s*\{\s*gap:\s*var\(--kc-space-2\);/,
    )
  })

  it('az almenüpont az asztali sávon a szülővel azonos S lépcsőn áll', () => {
    // Az alap `.kc-nav-desktop__sublink` szabály UTÁN, 900 px-es médiában.
    const base = css.indexOf('.kc-nav-desktop__sublink {')
    expect(base).toBeGreaterThan(-1)
    expect(css.slice(base)).toMatch(
      /@media \(min-width: 900px\)\s*\{\s*\.kc-nav-desktop__sublink\s*\{\s*font-size:\s*var\(--kc-font-s\);\s*\}\s*\}/,
    )
  })
})
