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

import { DesktopNav } from '../components/layout/DesktopNav'
import { MobileNav } from '../components/layout/MobileNav'
import { NavAnchor } from '../components/layout/NavAnchor'
import type { NavItem } from '../lib/menu-tree'
import { getNavRouteState } from '../lib/nav-route'

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

function expectBlueUnderline(selector: string): void {
  const bodies = ruleBodies(selector)
  expect(bodies.length, `hiányzó CSS-szelektor: ${selector}`).toBeGreaterThan(0)
  expect(
    bodies.some(
      (body) =>
        /(?:^|;)\s*color:\s*var\(--kc-header-accent\)\s*;/.test(body) &&
        /(?:^|;)\s*text-decoration:\s*underline\s*;/.test(body) &&
        /(?:^|;)\s*text-decoration-color:\s*var\(--kc-header-accent\)\s*;/.test(body),
    ),
    `${selector} állapotban KC-kék szöveg, aláhúzás és explicit KC-kék aláhúzásszín kell`,
  ).toBe(true)
}

function expectUnderlineThickness(selector: string, thickness: '1px' | '2px'): void {
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
    expectBlueUnderline(selector)
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
