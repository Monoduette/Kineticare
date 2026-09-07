import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { pathnameMock } = vi.hoisted(() => ({
  pathnameMock: vi.fn(() => '/'),
}))

vi.mock('next/navigation', () => ({
  usePathname: pathnameMock,
}))

vi.mock('../components/layout/NewsletterSignup', () => ({
  NewsletterSignup: () => null,
}))

import { DesktopNav } from '../components/layout/DesktopNav'
import { Footer, FOOTER_LEGAL_LINKS } from '../components/layout/Footer'
import { HeaderCoursesNav } from '../components/layout/HeaderCoursesNav'
import { MobileNav } from '../components/layout/MobileNav'
import { NavAnchor } from '../components/layout/NavAnchor'
import type { NavItem } from '../lib/menu-tree'
import { getNavLinkRouteState, getNavRouteState } from '../lib/nav-route'

const render = (element: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(element)

function navItem(
  id: number,
  label: string,
  href: string,
  children: NavItem[] = [],
  isExternal = false,
): NavItem {
  return {
    id,
    label,
    href,
    openInNewTab: false,
    isExternal,
    children,
  }
}

const activeTree = (): NavItem[] => [
  navItem(1, 'Szolgáltatások', '/szolgaltatasok', [
    navItem(2, 'SOS KézRelax', '/kurzusok/sos/'),
    navItem(3, 'Külső képzés', 'https://pelda.hu/kurzusok/sos/', [], true),
  ]),
  navItem(4, 'Tudástár', '/blog'),
]

const hashChildTree = (): NavItem[] => [
  navItem(10, 'Szolgáltatások', '/szolgaltatasok', [
    navItem(11, 'Rendelői kezelések', '/szolgaltatasok#rendeloi'),
  ]),
]

const hashParentTree = (): NavItem[] => [
  navItem(12, 'Rendelői kezelések', '/szolgaltatasok#rendeloi', [
    navItem(13, 'Kézterápia', '/szolgaltatasok/kezterapia'),
  ]),
]

const externalParentTree = (): NavItem[] => [
  navItem(
    20,
    'Külső gyűjtő',
    'https://pelda.hu/kepzesek',
    [navItem(21, 'Belső kurzus', '/kurzusok/sos')],
    true,
  ),
]

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function anchorFor(html: string, href: string): string {
  const match = html.match(new RegExp(`<a\\b(?=[^>]*\\bhref="${escapeRegex(href)}")[^>]*>`))
  expect(match, `nem található link ehhez a hrefhez: ${href}`).not.toBeNull()
  return match?.[0] ?? ''
}

function firstButton(html: string): string {
  const match = html.match(/<button\b[^>]*>/)
  expect(match, 'nem található gomb a markupban').not.toBeNull()
  return match?.[0] ?? ''
}

describe('getNavRouteState — belső útvonal-egyezés', () => {
  const blog = navItem(1, 'Tudástár', '/blog/')

  it('az aktuális cím query/hash részét és a záró perjelet figyelmen kívül hagyja', () => {
    expect(getNavRouteState(blog, '/blog?oldal=2#cikkek')).toBe('current')
    expect(getNavRouteState(navItem(2, 'Tudástár', '/blog/?oldal=1'), '/blog/')).toBe('current')
  })

  it('hash-célú link nem állít oldal-current állapotot a hash nélküli pathname alapján', () => {
    expect(getNavRouteState(navItem(2, 'Rendelői kezelések', '/blog#rendeloi'), '/blog')).toBe(
      'inactive',
    )
  })

  it('szegmenshatáron ad ősállapotot, részleges szövegegyezésre nem', () => {
    expect(getNavRouteState(blog, '/blog/kezrehab')).toBe('ancestor')
    expect(getNavRouteState(blog, '/blogger')).toBe('inactive')
    expect(getNavRouteState(navItem(2, 'Kezdőlap', '/'), '/blog')).toBe('inactive')
  })

  it('külső URL sosem jelenlegi oldal', () => {
    const external = navItem(1, 'Külső', 'https://pelda.hu/blog', [], true)
    expect(getNavRouteState(external, '/blog')).toBe('inactive')
  })

  it('külső szülő aktív belső gyermek mellett sem kap ősállapotot', () => {
    const parent = externalParentTree()[0]
    expect(getNavRouteState(parent, '/kurzusok/sos')).toBe('inactive')
    expect(getNavRouteState(parent.children[0], '/kurzusok/sos')).toBe('current')
  })

  it('a szülőt ősállapotúnak jelöli, ha egy eltérő útvonalú gyermeke aktív', () => {
    const parent = activeTree()[0]
    expect(getNavRouteState(parent, '/kurzusok/sos')).toBe('ancestor')
    expect(getNavRouteState(parent.children[0], '/kurzusok/sos')).toBe('current')
  })

  it('belső hash-szülőt is ősállapotúnak jelöl az aktív gyermeke alapján', () => {
    const parent = hashParentTree()[0]
    expect(getNavRouteState(parent, '/szolgaltatasok/kezterapia')).toBe('ancestor')
    expect(getNavRouteState(parent.children[0], '/szolgaltatasok/kezterapia')).toBe('current')
  })
})

describe('getNavLinkRouteState — önálló oldallink', () => {
  it('query-t és záró perjelet normalizál, a pontos linket currentnek jelöli', () => {
    expect(getNavLinkRouteState('/aszf?forras=footer', '/aszf/?kampany=jogi#tartalom')).toBe(
      'current',
    )
  })

  it('hash-cél, külső URL és mailto sosem current', () => {
    expect(getNavLinkRouteState('/aszf#elfogadas', '/aszf')).toBe('inactive')
    expect(getNavLinkRouteState('https://pelda.hu/aszf', '/aszf')).toBe('inactive')
    expect(getNavLinkRouteState('mailto:info@kineticare.hu', '/aszf')).toBe('inactive')
  })

  it('leszármazott útvonalon ancestor, hasonló szövegű szegmensen inactive', () => {
    expect(getNavLinkRouteState('/kapcsolat', '/kapcsolat/idopont')).toBe('ancestor')
    expect(getNavLinkRouteState('/aszf', '/aszf-reszletes')).toBe('inactive')
  })
})

describe.each([
  ['DesktopNav', DesktopNav],
  ['MobileNav', MobileNav],
] as const)('%s — jelenlegi oldal szemantikája', (_name, Component) => {
  beforeEach(() => {
    pathnameMock.mockReturnValue('/kurzusok/sos/?forras=menu#elso-lecke')
  })

  it('csak a pontos belső link kap aria-current=page értéket, a szülő külön adatállapotot', () => {
    const html = render(createElement(Component, { items: activeTree() }))
    const parent = anchorFor(html, '/szolgaltatasok')
    // A Next Link a renderelt hrefből leveszi a záró perjelet; a NavItemben
    // szándékosan megmarad, mert épp a matcher normalizálását mérjük.
    const current = anchorFor(html, '/kurzusok/sos')
    const external = anchorFor(html, 'https://pelda.hu/kurzusok/sos/')

    expect(current).toContain('aria-current="page"')
    expect(current).not.toContain('data-ancestor-active')
    expect(parent).toContain('data-ancestor-active="true"')
    expect(parent).not.toContain('aria-current')
    expect(external).not.toContain('aria-current')
    expect(external).not.toContain('data-ancestor-active')
  })

  it('nem jelöli a /blog linket a /blogger útvonalon', () => {
    pathnameMock.mockReturnValue('/blogger')
    const html = render(createElement(Component, { items: activeTree() }))
    const blog = anchorFor(html, '/blog')

    expect(blog).not.toContain('aria-current')
    expect(blog).not.toContain('data-ancestor-active')
  })

  it('parent + hash-child esetén pontosan egy aria-current marad, a hash-link nem current', () => {
    pathnameMock.mockReturnValue('/szolgaltatasok')
    const html = render(createElement(Component, { items: hashChildTree() }))
    const parent = anchorFor(html, '/szolgaltatasok')
    const hashChild = anchorFor(html, '/szolgaltatasok#rendeloi')

    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(parent).toContain('aria-current="page"')
    expect(hashChild).not.toContain('aria-current')
    expect(hashChild).not.toContain('data-ancestor-active')
  })

  it('külső szülő aktív belső gyermek mellett sem kap route-active adatállapotot', () => {
    pathnameMock.mockReturnValue('/kurzusok/sos')
    const html = render(createElement(Component, { items: externalParentTree() }))
    const parent = anchorFor(html, 'https://pelda.hu/kepzesek')
    const child = anchorFor(html, '/kurzusok/sos')

    expect(parent).not.toContain('aria-current')
    expect(parent).not.toContain('data-ancestor-active')
    expect(child).toContain('aria-current="page"')
  })

  it('belső hash-szülő aktív gyermek mellett ősállapotot, de nem aria-current értéket kap', () => {
    pathnameMock.mockReturnValue('/szolgaltatasok/kezterapia')
    const html = render(createElement(Component, { items: hashParentTree() }))
    const parent = anchorFor(html, '/szolgaltatasok#rendeloi')
    const child = anchorFor(html, '/szolgaltatasok/kezterapia')

    expect(parent).toContain('data-ancestor-active="true"')
    expect(parent).not.toContain('aria-current')
    expect(child).toContain('aria-current="page"')
  })
})

describe('fejléc — nincs Időpontfoglalás belépő (WP10, 2026-09-07)', () => {
  // Tulajdonosi döntés: a „Kapcsolat" menüpont fedi az időpontkérést, a
  // keret nem ad második utat a /kapcsolat#idopontkeres célra.
  // NN/g Menu-Design Checklist: https://www.nngroup.com/articles/menu-design/
  // WCAG 2.2 SC 3.2.3 Consistent Navigation.
  it('sem a DesktopNav, sem a MobileNav nem renderel időpont-belépőt', () => {
    pathnameMock.mockReturnValue('/kapcsolat')
    const items = [navItem(1, 'Rólunk', '/rolunk'), navItem(2, 'Kapcsolat', '/kapcsolat')]
    const desktop = render(createElement(DesktopNav, { items }))
    const mobile = render(createElement(MobileNav, { items }))

    for (const html of [desktop, mobile]) {
      expect(html).not.toContain('idopontkeres')
      expect(html).not.toContain('Időpontfoglalás')
      expect(html).not.toContain('Időpontkérés')
      expect(html).not.toContain('appointment')
    }
    expect(anchorFor(mobile, '/kapcsolat')).toContain('aria-current="page"')
  })
})

describe('HeaderCoursesNav — állandó kurzus-link', () => {
  it('a kurzuslistán pontos aktuális oldal állapotot kap', () => {
    pathnameMock.mockReturnValue('/kurzusok')
    const link = anchorFor(render(createElement(HeaderCoursesNav)), '/kurzusok')

    expect(link).toContain('aria-current="page"')
    expect(link).not.toContain('data-ancestor-active')
  })

  it('kurzus-részletoldalon ősállapotot kap', () => {
    pathnameMock.mockReturnValue('/kurzusok/otthoni-kezrehab-program')
    const link = anchorFor(render(createElement(HeaderCoursesNav)), '/kurzusok')

    expect(link).not.toContain('aria-current')
    expect(link).toContain('data-ancestor-active="true"')
  })

  it('hasonló útvonalon inaktív marad', () => {
    pathnameMock.mockReturnValue('/kurzusok-extra')
    const link = anchorFor(render(createElement(HeaderCoursesNav)), '/kurzusok')

    expect(link).not.toContain('aria-current')
    expect(link).not.toContain('data-ancestor-active')
  })
})

describe('Footer — jelenlegi oldal szemantikája', () => {
  it('a pontos Kapcsolat oldalon egyetlen oldallink current; a mailto és süti-gomb nem', () => {
    pathnameMock.mockReturnValue('/kapcsolat')
    const html = render(createElement(Footer))
    const contactPage = anchorFor(html, '/kapcsolat')
    const email = anchorFor(html, 'mailto:info@kineticare.hu')

    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(contactPage).toContain('aria-current="page"')
    expect(contactPage).toContain('kc-site-footer__page-link')
    expect(email).not.toContain('aria-current')
    expect(email).not.toContain('data-ancestor-active')
    expect(firstButton(html)).not.toContain('aria-current')
    expect(firstButton(html)).not.toContain('data-ancestor-active')
  })

  it.each(FOOTER_LEGAL_LINKS)('$label pontos útvonalon az egyetlen current link', ({ href }) => {
    pathnameMock.mockReturnValue(`${href}/?forras=footer#jogi-dokumentum`)
    const html = render(createElement(Footer))
    const current = anchorFor(html, href)

    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(current).toContain('aria-current="page"')
    expect(current).toContain('kc-site-footer__page-link')
  })

  it('leszármazott kapcsolati útvonalon csak ancestor adatállapotot ad', () => {
    pathnameMock.mockReturnValue('/kapcsolat/idopont')
    const contactPage = anchorFor(render(createElement(Footer)), '/kapcsolat')

    expect(contactPage).not.toContain('aria-current')
    expect(contactPage).toContain('data-ancestor-active="true"')
  })

  it('szegmensnév-részletre nem jelöli az ÁSZF linket', () => {
    pathnameMock.mockReturnValue('/aszf-reszletes')
    const legal = anchorFor(render(createElement(Footer)), '/aszf')

    expect(legal).not.toContain('aria-current')
    expect(legal).not.toContain('data-ancestor-active')
  })

  it('a Footer szerverkomponens és a NewsletterSignup határa megmarad', () => {
    const footerSource = readFileSync(
      fileURLToPath(new URL('../components/layout/Footer.tsx', import.meta.url)),
      'utf8',
    )
    const pageLinkSource = readFileSync(
      fileURLToPath(new URL('../components/layout/FooterPageLink.tsx', import.meta.url)),
      'utf8',
    )

    expect(footerSource.trimStart()).not.toMatch(/^['"]use client['"]/)
    expect(footerSource).toContain('<NewsletterSignup />')
    expect(pageLinkSource.trimStart()).toMatch(/^'use client'/)
  })
})

describe('NavAnchor — route-state védelem', () => {
  it('külső linken közvetlenül átadott route-state sem renderel aktív szemantikát', () => {
    const external = navItem(30, 'Külső', 'https://pelda.hu/blog', [], true)
    const html = render(
      createElement(NavAnchor, {
        item: external,
        routeState: 'ancestor',
      }),
    )

    expect(html).not.toContain('aria-current')
    expect(html).not.toContain('data-ancestor-active')
  })
})

const LAYOUT_CSS = readFileSync(
  fileURLToPath(new URL('../app/(frontend)/styles/layout.css', import.meta.url)),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

const BASE_CSS = readFileSync(
  fileURLToPath(new URL('../app/(frontend)/styles/base.css', import.meta.url)),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

interface CssRule {
  selectors: string[]
  body: string
}

const CSS_RULES: CssRule[] = Array.from(LAYOUT_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g), (match) => ({
  selectors: match[1].split(',').map((selector) => selector.trim()),
  body: match[2],
}))

function ruleBodies(selector: string): string[] {
  return CSS_RULES.filter((rule) => rule.selectors.includes(selector)).map((rule) => rule.body)
}

function expectBlueUnderline(selector: string, colorToken = '--kc-header-accent'): void {
  const bodies = ruleBodies(selector)
  expect(bodies.length, `hiányzó CSS-szelektor: ${selector}`).toBeGreaterThan(0)
  expect(
    bodies.some(
      (body) =>
        new RegExp(`(?:^|;)\\s*color:\\s*var\\(${escapeRegex(colorToken)}\\)\\s*;`).test(body) &&
        /(?:^|;)\s*text-decoration-line:\s*underline\s*;/.test(body) &&
        new RegExp(
          `(?:^|;)\\s*text-decoration-color:\\s*var\\(${escapeRegex(colorToken)}\\)\\s*;`,
        ).test(body),
    ),
    `${selector} állapotban KC-kék szöveg, aláhúzás és explicit KC-kék aláhúzásszín kell`,
  ).toBe(true)
}

function expectUnderlineThickness(selector: string, thickness: '1px' | '2px' | '3px'): void {
  const bodies = ruleBodies(selector)
  expect(bodies.length, `hiányzó CSS-szelektor: ${selector}`).toBeGreaterThan(0)
  expect(
    bodies.some((body) =>
      new RegExp(`(?:^|;)\\s*text-decoration-thickness:\\s*${escapeRegex(thickness)}\\s*;`).test(
        body,
      ),
    ),
    `${selector} állapotban ${thickness} aláhúzás kell`,
  ).toBe(true)
}

describe('főmenü állapotstílus-őr', () => {
  const linkClasses = [
    '.kc-nav-desktop__link',
    '.kc-nav-desktop__sublink',
    '.kc-nav-mobile__link',
    '.kc-nav-mobile__sublink',
  ]

  const hoverSelectors = linkClasses.map((className) => `${className}:hover`)
  const persistentSelectors = linkClasses.flatMap((className) => [
    `${className}:active`,
    `${className}[aria-current='page']`,
    `${className}[data-ancestor-active='true']`,
  ])
  const stateSelectors = [...hoverSelectors, ...persistentSelectors]

  it.each(stateSelectors)('%s KC-kék szöveget és explicit KC-kék aláhúzást használ', (selector) => {
    expectBlueUnderline(
      selector,
      selector.startsWith('.kc-nav-desktop__link')
        ? '--kc-header-active-ink'
        : '--kc-header-accent',
    )
  })

  it.each(hoverSelectors)('%s átmeneti állapotban 1px aláhúzást használ', (selector) => {
    expectUnderlineThickness(selector, '1px')
  })

  it.each(persistentSelectors)(
    '%s tartós vagy lenyomott állapotban 2px aláhúzást használ',
    (selector) => {
      expectUnderlineThickness(selector, '2px')
    },
  )

  it.each(stateSelectors)('%s nem változtat betűvastagságot', (selector) => {
    expect(ruleBodies(selector).join('\n')).not.toMatch(/(?:^|;)\s*font-weight\s*:/)
  })

  it('a desktop focus-within nem írja felül az aktív vagy hover aláhúzás vastagságát', () => {
    const focusBody = ruleBodies('.kc-nav-desktop__item:focus-within > .kc-nav-desktop__link').join(
      '\n',
    )

    expect(focusBody).toMatch(/(?:^|;)\s*text-decoration-line:\s*underline\s*;/)
    expect(focusBody).not.toMatch(/(?:^|;)\s*text-decoration\s*:/)
    expect(focusBody).not.toMatch(/(?:^|;)\s*text-decoration-thickness\s*:/)
  })

  it('a desktop főlink állapotszíne a fátyollal együtt inkből akcentbe vált', () => {
    expect(LAYOUT_CSS).toContain('--kc-header-active-ink: color-mix(')
    expect(LAYOUT_CSS).toMatch(
      /--kc-header-active-ink:\s*color-mix\([\s\S]*?var\(--kc-header-accent\)[\s\S]*?var\(--kc-header-veil, 0\)[\s\S]*?var\(--kc-header-ink\)[\s\S]*?\);/,
    )
  })

  it('a desktop aktív szövegszín egyik interakcióban sem késik a fejlécfátyol mögött', () => {
    for (const selector of [
      '.kc-nav-desktop__link:hover',
      '.kc-nav-desktop__link:active',
      ".kc-nav-desktop__link[aria-current='page']",
      ".kc-nav-desktop__link[data-ancestor-active='true']",
      '.kc-nav-desktop__item:focus-within > .kc-nav-desktop__link',
    ]) {
      const body = ruleBodies(selector).join('\n')
      expect(body).toMatch(/transition-property:\s*text-underline-offset\s*;/)
      expect(body).not.toMatch(/transition-property:[^;]*\bcolor\b/)
    }
  })

  it('az állandó Kurzusok-link pontos és ősállapota is kap nem színalapú jelölést', () => {
    for (const selector of [
      ".kc-site-header .kc-site-header__cta[aria-current='page']",
      ".kc-site-header .kc-site-header__cta[data-ancestor-active='true']",
    ]) {
      const body = ruleBodies(selector).join('\n')
      expect(body).toMatch(/(?:^|;)\s*text-decoration-line:\s*underline\s*;/)
      expect(body).toMatch(/(?:^|;)\s*text-decoration-thickness:\s*2px\s*;/)
    }
  })

  it('a focus-visible külön 3px-es körvonal marad', () => {
    expect(BASE_CSS).toMatch(
      /:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--kc-color-focus\)\s*;/,
    )
    const focusRule = CSS_RULES.find((rule) =>
      rule.selectors.includes('.kc-site-header :focus-visible'),
    )
    expect(focusRule?.body).toMatch(/outline-color:\s*color-mix\(/)
  })

  it.each(linkClasses)('%s megtartja a 44px-es célmagasságot', (selector) => {
    const rule = CSS_RULES.find((candidate) => candidate.selectors.includes(selector))
    expect(rule?.body).toMatch(/min-height:\s*2\.75rem\s*;/)
  })
})

describe('lábléc current/ancestor állapotstílus-őr', () => {
  const stateSelectors = [
    ".kc-site-footer__page-link[aria-current='page']",
    ".kc-site-footer__page-link[data-ancestor-active='true']",
  ]

  it.each(stateSelectors)('%s KC-kék és nem csak színalapú jelölést használ', (selector) => {
    expectBlueUnderline(selector, '--kc-footer-accent')
    expectUnderlineThickness(selector, '2px')
    expect(ruleBodies(selector).join('\n')).not.toMatch(/(?:^|;)\s*text-decoration\s*:/)
  })

  it.each([
    ".kc-site-footer__link.kc-site-footer__page-link[aria-current='page']",
    ".kc-site-footer__link.kc-site-footer__page-link[data-ancestor-active='true']",
  ])('%s a már alapból aláhúzott nagy linket 3px vastagsággal különíti el', (selector) => {
    expectUnderlineThickness(selector, '3px')
  })

  it('a nagy Kapcsolat-link megtartja a projekt 44px-es célmagasságát', () => {
    const body = ruleBodies('.kc-site-footer__link').join('\n')

    expect(body).toMatch(/(?:^|;)\s*display:\s*inline-flex\s*;/)
    expect(body).toMatch(/(?:^|;)\s*align-items:\s*center\s*;/)
    expect(body).toMatch(/(?:^|;)\s*min-height:\s*2\.75rem\s*;/)
  })
})
