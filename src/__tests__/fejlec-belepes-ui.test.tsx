import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AccountNav, ACCOUNT_NAV_LABELS } from '../components/layout/AccountNav'
import { MobileNav } from '../components/layout/MobileNav'
import { buildNavTree } from '../lib/menu-tree'
import { LOGOUT_ERROR_MESSAGE, logoutUser } from '../lib/logout-client'
import type { Menu } from '../payload-types'

/**
 * A HITELESÍTÉSI BELÉPÉSI PONT az oldalkeretben (fejléc + mobil drawer).
 *
 * MIT BIZONYÍT. A 2026-08-16-i mérés szerint a site-kereten NULLA belépési pont
 * volt: 32 oldalváltozaton `/belepes` = 0 link, `/kurzusaim` = 0 link,
 * kijelentkezés sehol (docs/informacios-architektura.md §4 mátrix, TOP-10 #2 és
 * #6; docs/felhasznaloi-seta.md §6.1). Ez a teszt az őre annak, hogy ez ne
 * csússzon vissza.
 *
 * A tesztkörnyezet `node` (nincs jsdom), ezért a SZERVER-RENDERELT kimenetet
 * mérjük — pontosan azt, amit a látogató a hidratálás ELŐTT és JS nélkül kap.
 * A `logoutUser` hálózati szerződését injektált `fetch`-csel mérjük: valódi
 * hívás NEM megy ki (a repó 15. üzemeltetési tanulsága).
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

const menuTree = () =>
  buildNavTree([
    urlMenu(1, 'Szolgáltatások', '/szolgaltatasok', { order: 0 }),
    urlMenu(2, 'Tudástár', '/blog', { order: 1 }),
  ])

describe('AccountNav — kijelentkezett látogató', () => {
  const header = render(createElement(AccountNav, { signedIn: false, variant: 'header' }))

  it('a fejléc kap egy /belepes hivatkozást (a mátrix üres „Belépés" oszlopa)', () => {
    expect(header).toContain('href="/belepes"')
    expect(header).toContain(ACCOUNT_NAV_LABELS.signIn)
  })

  it('a belépés LINK (navigál), nem gomb — WAI-ARIA APG Button Pattern', () => {
    expect(header).toMatch(/<a[^>]*href="\/belepes"/)
    expect(header).not.toContain('<button')
  })

  it('kijelentkezett állapotban NINCS kijelentkezés és NINCS /kurzusaim', () => {
    expect(header).not.toContain(ACCOUNT_NAV_LABELS.signOut)
    expect(header).not.toContain('/kurzusaim')
  })

  /**
   * WP27 (2026-09-07, tulajdonosi kérés): a sávban a belépő profil-IKON, nem
   * kiírt szó. A hozzáférhető név mégis „Belépés" marad: a glif `aria-hidden`,
   * a nevet a vizuálisan rejtett szöveg adja (WCAG 2.2 SC 2.4.4, SC 4.1.2), a
   * `title` csak a mutatós tooltip. A fiókban (drawer) az ikon a LÁTHATÓ szó
   * mellett áll (NN/g Icon Usability: „icons with labels"), rejtett szöveg
   * nélkül — a két elhelyezés neve ugyanaz (SC 3.2.4).
   */
  it('a sávban ikon-link, rejtett „Belépés" névvel; a fiókban ikon + látható szó', () => {
    const link = header.match(/<a\b[^>]*href="\/belepes"[^>]*>[\s\S]*?<\/a>/)?.[0] ?? ''
    expect(link).toContain('kc-account-nav__link--icon')
    expect(link).toContain('title="Belépés"')
    expect(link).toMatch(/<svg[^>]*aria-hidden="true"[^>]*class="kc-account-nav__icon"/)
    expect(link).toContain('<span class="kc-visually-hidden">Belépés</span>')
    // Az ikon dekoratív: nincs saját neve (a képernyőolvasó egyszer olvas).
    expect(link).not.toMatch(/<svg[^>]*aria-label/)
    expect(link).not.toMatch(/<title>/)

    const drawer = render(createElement(AccountNav, { signedIn: false, variant: 'drawer' }))
    const drawerLink = drawer.match(/<a\b[^>]*href="\/belepes"[^>]*>[\s\S]*?<\/a>/)?.[0] ?? ''
    expect(drawerLink).not.toContain('kc-account-nav__link--icon')
    expect(drawerLink).toContain('kc-account-nav__icon')
    expect(drawerLink).toContain('<span>Belépés</span>')
    expect(drawerLink).not.toContain('kc-visually-hidden')
  })

  it('bejelentkezve a „Kurzusaim" szöveglink marad, ikon-only nincs', () => {
    const signedIn = render(createElement(AccountNav, { signedIn: true, variant: 'header' }))
    expect(signedIn).not.toContain('kc-account-nav__link--icon')
    expect(signedIn).toContain('>Kurzusaim</a>')
  })
})

describe('AccountNav — bejelentkezett felhasználó', () => {
  const header = render(createElement(AccountNav, { signedIn: true, variant: 'header' }))

  it('a fejléc kap egy /kurzusaim hivatkozást (a mátrix üres „Fiók/Kurzusaim" oszlopa)', () => {
    expect(header).toContain('href="/kurzusaim"')
    expect(header).toContain(ACCOUNT_NAV_LABELS.myCourses)
  })

  it('a KIJELENTKEZÉS <button>, NEM link — a cselekvés nem navigáció', () => {
    // Ez a teszt lényege: a kijelentkezés állapotot változtat, ezért gomb.
    // W3C WAI-ARIA APG, Button Pattern:
    // https://www.w3.org/WAI/ARIA/apg/patterns/button/
    expect(header).toMatch(
      /<button[^>]*class="kc-account-nav__signout"[^>]*type="button"[^>]*>[\s\S]*?Kijelentkezés<\/span><\/button>/,
    )
    expect(header).toContain(ACCOUNT_NAV_LABELS.signOut)
    // A felirat SEHOL nem <a>-ban ül.
    const anchors = header.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? []
    expect(anchors.some((anchor) => anchor.includes(ACCOUNT_NAV_LABELS.signOut))).toBe(false)
  })

  it('a kijelentkezés gomb alaphelyzetben NEM letiltott, és nem „foglalt"', () => {
    expect(header).toContain('aria-busy="false"')
    expect(header).not.toContain('disabled=""')
  })

  it('bejelentkezve NEM ajánlja a /belepes-t (nem lenne igaz állapot)', () => {
    expect(header).not.toContain('href="/belepes"')
  })
})

describe('AccountNav — a két elhelyezés UGYANAZOKAT a szavakat használja (WCAG 3.2.4)', () => {
  // „Components that have the same functionality within a set of web pages are
  // identified consistently."
  // https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html
  const headerOut = render(createElement(AccountNav, { signedIn: false, variant: 'header' }))
  const drawerOut = render(createElement(AccountNav, { signedIn: false, variant: 'drawer' }))
  const headerIn = render(createElement(AccountNav, { signedIn: true, variant: 'header' }))
  const drawerIn = render(createElement(AccountNav, { signedIn: true, variant: 'drawer' }))

  it('„Belépés" mindkét helyen ugyanaz a szó és ugyanaz a cél', () => {
    for (const html of [headerOut, drawerOut]) {
      expect(html).toContain(ACCOUNT_NAV_LABELS.signIn)
      expect(html).toContain('href="/belepes"')
    }
    expect(ACCOUNT_NAV_LABELS.signIn).toBe('Belépés')
  })

  it('„Kurzusaim" és „Kijelentkezés" mindkét helyen ugyanaz', () => {
    for (const html of [headerIn, drawerIn]) {
      expect(html).toContain(ACCOUNT_NAV_LABELS.myCourses)
      expect(html).toContain(ACCOUNT_NAV_LABELS.signOut)
      expect(html).toContain('href="/kurzusaim"')
    }
  })

  it('a drawer-változat a saját osztályát viszi (külön elrendezés, azonos szavak)', () => {
    expect(drawerOut).toContain('kc-account-nav--drawer')
    expect(headerOut).not.toContain('kc-account-nav--drawer')
  })
})

describe('AccountNav — magyar mikroszöveg (ui-sztenderdek §3.1)', () => {
  it('egyetlen feliratban sincs gondolatjel vagy kvirtmínusz', () => {
    // §3.1.2: gomb-, menü-, címke- és aria-label-szövegben 0 gondolatjel.
    for (const label of Object.values(ACCOUNT_NAV_LABELS)) {
      expect(label).not.toMatch(/[–—]/)
    }
  })

  it('a folyamatban-felirat három ponttal jelez (L-1), nem gondolatjellel', () => {
    expect(ACCOUNT_NAV_LABELS.signOutPending).toBe('Kijelentkezés…')
    expect(ACCOUNT_NAV_LABELS.signOutPending.startsWith(ACCOUNT_NAV_LABELS.signOut)).toBe(true)
  })

  it('a hibaüzenet magyar, és megmondja, mit tegyen a felhasználó', () => {
    expect(LOGOUT_ERROR_MESSAGE).toContain('Próbáld újra')
    expect(LOGOUT_ERROR_MESSAGE).not.toMatch(/[–—]/)
  })
})

describe('MobileNav — a fiók-blokk a drawer ELSŐ eleme', () => {
  const html = render(createElement(MobileNav, { items: menuTree(), signedIn: false }))

  it('a hamburger menüben ott a belépés (korábban 0 volt)', () => {
    expect(html).toContain('kc-account-nav--drawer')
    expect(html).toContain('href="/belepes"')
  })

  it('a fiók-blokk MEGELŐZI a CMS-menüpontokat', () => {
    const account = html.indexOf('kc-account-nav--drawer')
    const menu = html.indexOf('kc-nav-mobile__list')
    expect(account).toBeGreaterThan(-1)
    expect(menu).toBeGreaterThan(-1)
    expect(account).toBeLessThan(menu)
  })

  it('ÜRES CMS-menü esetén is van belépés (a keret nem marad ajtó nélkül)', () => {
    const empty = render(createElement(MobileNav, { items: [], signedIn: false }))
    expect(empty).toContain('href="/belepes"')
    expect(empty).toContain('A menü jelenleg üres.')
  })

  it('bejelentkezve a drawer a kurzusokhoz visz és kiléptet', () => {
    const signedIn = render(createElement(MobileNav, { items: menuTree(), signedIn: true }))
    expect(signedIn).toContain('href="/kurzusaim"')
    expect(signedIn).toContain(ACCOUNT_NAV_LABELS.signOut)
    expect(signedIn).toMatch(
      /<button[^>]*class="kc-account-nav__signout"[^>]*type="button"[^>]*>Kijelentkezés<\/button>/,
    )
  })
})

describe('logoutUser — a kijelentkezés hálózati szerződése', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POST-tal hívja a Payload /api/users/logout végpontját, sütivel', async () => {
    // MIÉRT POST: OWASP CSRF Prevention Cheat Sheet — „Do not use GET requests
    // for state changing operations."
    const calls: Array<[string, RequestInit | undefined]> = []
    const fake: typeof fetch = async (input, init) => {
      calls.push([String(input), init])
      return new Response('{}', { status: 200 })
    }

    const result = await logoutUser(fake)

    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('/api/users/logout')
    expect(calls[0][1]?.method).toBe('POST')
    expect(calls[0][1]?.credentials).toBe('include')
  })

  it('hibás válasznál nem hazudik sikert, magyar üzenetet ad', async () => {
    const fake: typeof fetch = async () => new Response('{}', { status: 400 })
    await expect(logoutUser(fake)).resolves.toEqual({
      ok: false,
      message: LOGOUT_ERROR_MESSAGE,
    })
  })

  it('hálózati hiba esetén sem dob, hanem kezelhető eredményt ad', async () => {
    const fake: typeof fetch = async () => {
      throw new Error('network down')
    }
    await expect(logoutUser(fake)).resolves.toEqual({
      ok: false,
      message: LOGOUT_ERROR_MESSAGE,
    })
  })
})

/**
 * WP31 (2026-09-07, tulajdonosi kérés, szó szerint: „ha be vagyok jelentkezve
 * akkor a kijelentkezés az utolsó gomb"). Bejelentkezve a Kijelentkezés a fiók
 * UTOLSÓ fókuszálható eleme (a CMS-menü után), a „Kurzusaim" a fiók elején
 * marad; kijelentkezve a „Belépés" a fiók elején áll és nincs kilépő fél. A
 * DOM-sorrend adja a Tab-sorrendet (WCAG 2.2 SC 2.4.3 Focus Order, SC 1.3.2):
 * https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html
 */
describe('MobileNav — bejelentkezve a Kijelentkezés az utolsó gomb (WP31)', () => {
  const signedIn = render(createElement(MobileNav, { items: menuTree(), signedIn: true }))
  const signedOut = render(createElement(MobileNav, { items: menuTree(), signedIn: false }))
  const tabbables = (html: string) => html.match(/<(a|button)\b[^>]*>[\s\S]*?<\/\1>/g) ?? []

  it('a Kurzusaim a menülista ELŐTT, a Kijelentkezés a menülista UTÁN áll', () => {
    const kurzusaim = signedIn.indexOf('href="/kurzusaim"')
    const lista = signedIn.indexOf('kc-nav-mobile__list')
    const kilepes = signedIn.indexOf('kc-account-nav__signout')
    expect(kurzusaim).toBeGreaterThan(-1)
    expect(lista).toBeGreaterThan(kurzusaim)
    expect(kilepes).toBeGreaterThan(lista)
    expect(signedIn).toContain('kc-account-nav--exit')
  })

  it('a fiók utolsó fókuszálható eleme a Kijelentkezés gomb', () => {
    const utolso = tabbables(signedIn).at(-1) ?? ''
    expect(utolso).toContain('kc-account-nav__signout')
    expect(utolso).toContain(ACCOUNT_NAV_LABELS.signOut)
  })

  it('a Kurzusaim link csak egyszer, a Kijelentkezés gomb csak egyszer szerepel', () => {
    expect(signedIn.match(/href="\/kurzusaim"/g)).toHaveLength(1)
    expect(signedIn.match(/kc-account-nav__signout/g)).toHaveLength(1)
  })

  it('kijelentkezve nincs kilépő fél, a Belépés a menülista előtt marad', () => {
    expect(signedOut).not.toContain('kc-account-nav--exit')
    expect(signedOut.indexOf('href="/belepes"')).toBeLessThan(
      signedOut.indexOf('kc-nav-mobile__list'),
    )
    expect(tabbables(signedOut).at(-1) ?? '').not.toContain('kc-account-nav__signout')
  })

  it('üres CMS-menüvel is a Kijelentkezés zárja a fiókot', () => {
    const empty = render(createElement(MobileNav, { items: [], signedIn: true }))
    expect(empty.indexOf('A menü jelenleg üres.')).toBeLessThan(
      empty.indexOf('kc-account-nav__signout'),
    )
  })
})

describe('AccountNav — `section` (a fiók belépő és kilépő fele)', () => {
  it('bejelentkezve az `entry` csak a Kurzusaim, az `exit` csak a Kijelentkezés', () => {
    const entry = render(
      createElement(AccountNav, { signedIn: true, variant: 'drawer', section: 'entry' }),
    )
    const exit = render(
      createElement(AccountNav, { signedIn: true, variant: 'drawer', section: 'exit' }),
    )
    expect(entry).toContain('href="/kurzusaim"')
    expect(entry).not.toContain('kc-account-nav__signout')
    expect(exit).toContain('kc-account-nav__signout')
    expect(exit).not.toContain('href="/kurzusaim"')
    expect(exit).toContain('kc-account-nav--exit')
  })

  it('kijelentkezve az `exit` nem renderel semmit, az `entry` a Belépés', () => {
    expect(
      render(createElement(AccountNav, { signedIn: false, variant: 'drawer', section: 'exit' })),
    ).toBe('')
    expect(
      render(createElement(AccountNav, { signedIn: false, variant: 'drawer', section: 'entry' })),
    ).toContain('href="/belepes"')
  })

  it('szekció nélkül (fejléc-sáv) minden egyben marad', () => {
    const header = render(createElement(AccountNav, { signedIn: true, variant: 'header' }))
    expect(header).toContain('href="/kurzusaim"')
    expect(header).toContain('kc-account-nav__signout')
    expect(header).not.toContain('kc-account-nav--exit')
  })
})

describe('Header + layout.css — a kilépő fél helye (WP31)', () => {
  const olvas = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

  it('az asztali sávban bejelentkezve a fiók-blokk a Kurzusok pirula UTÁN áll', () => {
    const header = olvas('../components/layout/Header.tsx')
    const pirula = header.indexOf('<HeaderCoursesNav />')
    const signedInNav = header.indexOf('<AccountNav signedIn variant="header" />')
    const signedOutNav = header.indexOf('<AccountNav signedIn={false} variant="header" />')
    expect(pirula).toBeGreaterThan(-1)
    expect(signedInNav).toBeGreaterThan(pirula)
    expect(signedOutNav).toBeLessThan(pirula)
    expect(signedOutNav).toBeGreaterThan(-1)
  })

  it('a kilépő fél a fiók aljára ül, és a süti-sáv mért magasságával számol (2.4.11)', () => {
    const css = olvas('../app/(frontend)/styles/layout.css').replace(/\/\*[\s\S]*?\*\//g, '')
    const szabaly =
      css.match(/\.kc-account-nav--drawer\.kc-account-nav--exit\s*\{[^}]*\}/)?.[0] ?? ''
    expect(szabaly).toContain('margin-top: auto')
    expect(szabaly).toMatch(/padding-bottom:\s*calc\([\s\S]*?--kc-consent-offset/)
    expect(szabaly).toContain('border-top: 1px solid var(--kc-header-hairline)')
  })
})

/**
 * WP31 pótlás (vezetői döntés, 2026-09-07): 56,25em és 75em között a sávban a
 * kijelentkezés IKON-GOMB (Lucide `log-out` geometriájú saját glif), a név
 * szöveg marad (SC 4.1.2), a `title` a mutatós tooltip; 75em-től a szöveges
 * pirula. A fiókban (drawer) a gomb szöveges marad, ikon nélkül.
 */
describe('AccountNav — a fejléc kijelentkezés-gombja ikon + rejtett szöveg (WP31 pótlás)', () => {
  const header = render(createElement(AccountNav, { signedIn: true, variant: 'header' }))
  const button =
    header.match(/<button\b[^>]*kc-account-nav__signout[^>]*>[\s\S]*?<\/button>/)?.[0] ?? ''

  it('dekoratív glif + a nevet adó szöveg-span + title', () => {
    expect(button).toMatch(
      /<svg[^>]*aria-hidden="true"[^>]*class="kc-account-nav__icon kc-account-nav__signout-icon"/,
    )
    expect(button).not.toMatch(/<svg[^>]*aria-label/)
    expect(button).toContain('<span class="kc-account-nav__signout-text">Kijelentkezés</span>')
    expect(button).toContain('title="Kijelentkezés"')
  })

  it('a fiókban szöveges marad, ikon és title nélkül', () => {
    const drawer = render(
      createElement(AccountNav, { signedIn: true, variant: 'drawer', section: 'exit' }),
    )
    expect(drawer).not.toContain('kc-account-nav__signout-icon')
    expect(drawer).not.toContain('title=')
    expect(drawer).toMatch(/<button[^>]*kc-account-nav__signout[^>]*>Kijelentkezés<\/button>/)
  })

  it('layout.css: 56,25em–75em között 44×44-es kör, klip-rejtett felirat; 75em-től a glif rejtve', () => {
    const css = readFileSync(
      fileURLToPath(new URL('../app/(frontend)/styles/layout.css', import.meta.url)),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '')
    const range = css.slice(css.indexOf('@media (min-width: 56.25em) and (max-width: 74.99em)'))
    const gomb = range.match(/\.kc-account-nav__signout\s*\{[^}]*\}/)?.[0] ?? ''
    expect(gomb).toContain('width: 2.75rem')
    expect(gomb).toContain('height: 2.75rem')
    const szoveg = range.match(/\.kc-account-nav__signout-text\s*\{[^}]*\}/)?.[0] ?? ''
    expect(szoveg).toContain('clip: rect(0 0 0 0)')
    expect(szoveg).toContain('width: 1px')
    expect(css).not.toMatch(/\.kc-account-nav__signout\s*\{\s*display:\s*none/)
    const wide = css.slice(css.indexOf('@media (min-width: 75em)'))
    expect(wide).toMatch(/\.kc-account-nav__signout-icon\s*\{\s*display:\s*none/)
  })
})
