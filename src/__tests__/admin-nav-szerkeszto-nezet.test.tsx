import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * H08/3: az admin oldalsávjának „Szerkesztő nézet” linkje
 * (src/components/admin/AdminNavLinks.tsx, „Leggyakrabban használt” csoport).
 *
 * - a kezdőlap piszkozat-előnézetére visz, betűre ugyanoda, ahova a weboldal
 *   fejlécének belépője a `/` útvonalon;
 * - sima `<a>`, nem next/link (a draft-süti miatt nincs előtöltés);
 * - új lapon nyílik, és ezt a látható szöveg mondja („(új lapon)”);
 * - a hozzáférhető név a látható felirattal kezdődik (WCAG 2.2 SC 2.5.3);
 * - `aria-current` nem kerül rá;
 * - vásárlónak és be nem jelentkezettnek nem rajzol.
 */

const allapot = vi.hoisted(() => ({
  user: null as { role: string } | null,
  pathname: '/admin' as string | null,
}))

vi.mock('@payloadcms/ui', () => ({
  useAuth: () => ({ user: allapot.user }),
  useConfig: () => ({ config: { routes: { admin: '/admin', api: '/api' } } }),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => allapot.pathname,
}))

// A next/link jelölt <a>-t ad, így a kimenetből látszik, melyik link ment rajta át.
vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children?: ReactNode; [kulcs: string]: unknown }) => {
    // A `prefetch` a next/link saját kapcsolója, a DOM-ra nem kerül.
    const attributumok: Record<string, unknown> = { ...props, 'data-next-link': 'igen' }
    delete attributumok.prefetch
    return createElement('a', attributumok, children)
  },
}))

const { ADMIN_NAV_CSOPORTOK, AdminNavLinks, SZERKESZTO_NEZET_LINK, UJ_LAPON, kulsoLink } =
  await import('../components/admin/AdminNavLinks')
const { ADMIN_UTAK } = await import('../components/admin/KezdolapCel')
const { SZERKESZTO_NEZET_FELIRAT } =
  await import('../components/editor/frontend/SzerkesztoNezetBelepo')
const { szerkesztoNezetCel, szerkesztoNezetHref } =
  await import('../components/editor/frontend/szerkeszto-nezet-cel')

const VART_HREF = '/next/preview?collection=pages&slug=kezdolap'

function menu(): string {
  return renderToStaticMarkup(createElement(AdminNavLinks))
}

/** Az összes <a> nyitócímkéje és szövegtartalma a kimenetben. */
function linkek(html: string): { nyito: string; szoveg: string; belso: string }[] {
  return [...html.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/g)].map((m) => ({
    nyito: m[1] ?? '',
    belso: m[2] ?? '',
    szoveg: (m[2] ?? '').replace(/<[^>]+>/g, ''),
  }))
}

function attr(nyito: string, nev: string): string | null {
  const m = new RegExp(`\\s${nev}="([^"]*)"`).exec(nyito)
  return m ? (m[1] ?? '').replace(/&amp;/g, '&') : null
}

function szerkesztoLink(html: string): { nyito: string; szoveg: string; belso: string } {
  const talalat = linkek(html).find((l) => attr(l.nyito, 'href')?.startsWith('/next/preview'))
  if (!talalat) throw new Error('Nincs „Szerkesztő nézet” link a menüben.')
  return talalat
}

beforeEach(() => {
  allapot.user = { role: 'staff' }
  allapot.pathname = '/admin'
})

describe('a „Leggyakrabban használt” csoport harmadik linkje', () => {
  it('a két admin-link után áll, a weboldal belépőjének feliratával', () => {
    const csoport = ADMIN_NAV_CSOPORTOK[0]
    expect(csoport?.cim).toBe('Leggyakrabban használt')
    expect(csoport?.linkek).toHaveLength(3)
    expect(csoport?.linkek[0]).toBe(ADMIN_UTAK.kezdolap)
    expect(csoport?.linkek[1]).toBe(ADMIN_UTAK.videoSzovegei)
    expect(csoport?.linkek[2]).toBe(SZERKESZTO_NEZET_LINK)
    expect(SZERKESZTO_NEZET_LINK.felirat).toBe(SZERKESZTO_NEZET_FELIRAT)
    expect(kulsoLink(SZERKESZTO_NEZET_LINK)).toBe(true)
    expect(kulsoLink(ADMIN_UTAK.kezdolap)).toBe(false)
    // Csak az első csoportban van külső link.
    expect(ADMIN_NAV_CSOPORTOK[1]?.linkek.some((link) => kulsoLink(link))).toBe(false)
  })

  it('célja betűre a kezdőlap előnézete, ugyanaz, mint a weboldal belépőjéé a / útvonalon', () => {
    expect(SZERKESZTO_NEZET_LINK.href).toBe(VART_HREF)
    const cel = szerkesztoNezetCel('/')
    if (cel === null) throw new Error('A / útvonalnak van előnézeti célja.')
    expect(szerkesztoNezetHref(cel)).toBe(VART_HREF)
  })
})

describe('a kirajzolt link', () => {
  it.each([['staff'], ['owner']])('%s: href, új lap, noopener', (role) => {
    allapot.user = { role }
    const link = szerkesztoLink(menu())
    expect(attr(link.nyito, 'href')).toBe(VART_HREF)
    expect(attr(link.nyito, 'target')).toBe('_blank')
    expect(attr(link.nyito, 'rel')?.split(/\s+/)).toContain('noopener')
    // Sima <a>, nem next/link: a draft-sütit állító route-ot nem tölti elő.
    expect(link.nyito).not.toContain('data-next-link')
    expect(attr(link.nyito, 'class')).toBe('nav__link kc-admin-nav__link')
  })

  it('a látható szöveg kimondja, hogy új lapon nyílik', () => {
    const link = szerkesztoLink(menu())
    expect(UJ_LAPON).toBe('(új lapon)')
    expect(link.szoveg).toBe(`${SZERKESZTO_NEZET_FELIRAT} (új lapon)`)
    // Az utótag látható elem, nem vizuálisan rejtett szöveg.
    expect(link.belso).toContain('<span class="kc-admin-nav__uj-lap">(új lapon)</span>')
    expect(link.belso).not.toMatch(/visually-hidden|sr-only/)
  })

  it('a hozzáférhető név a látható felirattal kezdődik (SC 2.5.3), nincs felülíró aria-label', () => {
    const link = szerkesztoLink(menu())
    expect(link.nyito).not.toMatch(/aria-label(ledby)?=/)
    expect(link.szoveg.startsWith(SZERKESZTO_NEZET_FELIRAT)).toBe(true)
    expect(link.szoveg).not.toMatch(/[–—]/)
  })

  it('aria-current és jelzősáv nem kerül rá, akármelyik nézet is nyitva', () => {
    for (const pathname of ['/admin', '/next/preview', '/admin/kezdolap', null]) {
      allapot.pathname = pathname
      const link = szerkesztoLink(menu())
      expect(link.nyito).not.toContain('aria-current')
      expect(link.belso).not.toContain('nav__link-indicator')
    }
  })

  it('a saját admin-nézetek továbbra is next/link-en át mennek, új lap nélkül', () => {
    const adminLinkek = linkek(menu()).filter((l) => attr(l.nyito, 'href')?.startsWith('/admin'))
    expect(adminLinkek).toHaveLength(Object.keys(ADMIN_UTAK).length)
    for (const l of adminLinkek) {
      expect(l.nyito).toContain('data-next-link')
      expect(attr(l.nyito, 'target')).toBeNull()
    }
  })

  it.each([
    ['be nem jelentkezett', null],
    ['vásárló', { role: 'customer' }],
  ])('%s felhasználónak semmit nem rajzol', (_nev, user) => {
    allapot.user = user
    expect(menu()).toBe('')
  })
})

describe('a stílus', () => {
  it('az „(új lapon)” utótag egyben törik', () => {
    const css = readFileSync(
      fileURLToPath(new URL('../components/admin/AdminNavLinks.css', import.meta.url)),
      'utf8',
    )
    expect(css).toMatch(/\.kc-admin-nav__uj-lap \{\s*white-space: nowrap;\s*\}/)
  })
})
