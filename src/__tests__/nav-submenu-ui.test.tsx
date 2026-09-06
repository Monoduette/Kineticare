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
