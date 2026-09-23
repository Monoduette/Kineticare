import { readFileSync } from 'node:fs'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Az oldalsáv saját menücsoportjai és a fejléc videószöveg-linkje
 * (src/components/admin/AdminNavLinks.tsx, admin-audit K32, K33):
 * - csak munkatárs és tulajdonos látja (megjelenítés; a védelem a nézetekben);
 * - az aktív saját nézet linkje `aria-current="page"` és a Payload jelzősávja;
 * - a csoportcímek programozottan is a csoporthoz tartoznak (role=group +
 *   aria-labelledby);
 * - a videószöveg-link neve nem téveszthető össze a „Videótár”-ral;
 * - a régi, egyenkénti menülink-fájlok megszűntek. A config-bekötést
 *   (beforeNavLinks, actions, afterNavLinks nélkül) a payload-config.test.ts őrzi.
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

const { ADMIN_NAV_CSOPORTOK, AdminNavLinks, KezdolapVideoFejlecLink, aktivLink } =
  await import('../components/admin/AdminNavLinks')
const { ADMIN_UTAK } = await import('../components/admin/KezdolapCel')

function menu(): string {
  return renderToStaticMarkup(createElement(AdminNavLinks))
}

beforeEach(() => {
  allapot.user = { role: 'staff' }
  allapot.pathname = '/admin'
})

describe('szerepkör szerinti megjelenítés', () => {
  it.each([
    ['be nem jelentkezett', null],
    ['vásárló', { role: 'customer' }],
  ])('%s felhasználónak semmit nem rajzol', (_nev, user) => {
    allapot.user = user
    expect(menu()).toBe('')
    expect(renderToStaticMarkup(createElement(KezdolapVideoFejlecLink))).toBe('')
  })

  it.each([['staff'], ['owner']])('%s: mind az öt link, két csoportban', (role) => {
    allapot.user = { role }
    const html = menu()
    for (const ut of Object.values(ADMIN_UTAK)) {
      expect(html).toContain(`href="/admin${ut.utvonal}"`)
      expect(html).toContain(`>${ut.felirat}</span>`)
    }
    expect(html.match(/role="group"/g)).toHaveLength(2)
  })
})

describe('csoportok és nevek', () => {
  it('két csoport: a leggyakoribb teendők és a kimutatások a kurzusvideókkal', () => {
    expect(ADMIN_NAV_CSOPORTOK.map((csoport) => csoport.cim)).toEqual([
      'Leggyakrabban használt',
      'Kimutatások és kurzusvideók',
    ])
    expect(ADMIN_NAV_CSOPORTOK[0]?.linkek).toEqual([ADMIN_UTAK.kezdolap, ADMIN_UTAK.videoSzovegei])
    expect(ADMIN_NAV_CSOPORTOK[1]?.linkek).toEqual([
      ADMIN_UTAK.statisztika,
      ADMIN_UTAK.webanalitika,
      ADMIN_UTAK.videotar,
    ])
  })

  it('a csoportcím a csoport hozzáférhető neve (aria-labelledby → létező id)', () => {
    const html = menu()
    for (const csoport of ADMIN_NAV_CSOPORTOK) {
      expect(html).toContain(`aria-labelledby="${csoport.id}"`)
      expect(html).toContain(`id="${csoport.id}"`)
    }
  })

  it('a videószöveg-link a kezdőlapot mondja előre, nem a „Videó” szóval kezdődik', () => {
    const nev = ADMIN_UTAK.videoSzovegei.felirat
    expect(nev).toBe('Kezdőlapi videó szövegei')
    expect(nev.split(' ')[0]).not.toMatch(/^Vide/)
    expect(nev).not.toContain(ADMIN_UTAK.videotar.felirat)
    for (const felirat of [
      ...Object.values(ADMIN_UTAK).map((ut) => ut.felirat),
      ...ADMIN_NAV_CSOPORTOK.map((csoport) => csoport.cim),
    ]) {
      expect(felirat, 'gondolatjel a menüfeliratban').not.toMatch(/[–—]/)
    }
  })
})

describe('aktív állapot', () => {
  it.each([
    ['/admin/statisztika', 'Statisztika'],
    ['/admin/webanalitika', 'Webanalitika'],
    ['/admin/videok', 'Videótár'],
  ])('%s: pontosan egy aria-current="page", a jelzősávval', (pathname, felirat) => {
    allapot.pathname = pathname
    const html = menu()
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toContain(
      `aria-current="page" class="nav__link kc-admin-nav__link" href="${pathname}"><span class="nav__link-indicator"></span><span class="nav__link-label">${felirat}</span>`,
    )
  })

  it('más oldalon egyik saját link sem aktív', () => {
    for (const pathname of ['/admin', '/admin/collections/pages/1', '/admin/statisztika/x', null]) {
      allapot.pathname = pathname
      expect(menu()).not.toContain('aria-current')
      expect(menu()).not.toContain('nav__link-indicator')
    }
  })

  it('a záró perjel nem rontja el az egyezést, az előtag-egyezés nem aktív', () => {
    expect(aktivLink('/admin/statisztika/', '/admin/statisztika')).toBe(true)
    expect(aktivLink('/admin/statisztika-regi', '/admin/statisztika')).toBe(false)
  })
})

describe('a fejléc videószöveg-linkje', () => {
  it('munkatársnak a videószöveg-nézetre visz, ugyanazzal a névvel', () => {
    const html = renderToStaticMarkup(createElement(KezdolapVideoFejlecLink))
    expect(html).toContain('href="/admin/kezdolap-video"')
    expect(html).toContain('>Kezdőlapi videó szövegei</a>')
  })

  it('768 CSS px alatt rejtett (a Payload fejléc-akcióinak helye ott 150 px)', () => {
    const css = readFileSync(
      new URL('../components/admin/AdminNavLinks.css', import.meta.url),
      'utf8',
    )
    expect(css).toMatch(
      /@media \(max-width: 768px\) \{\s*\.kc-admin-fejlec-link \{\s*display: none;/,
    )
  })
})

describe('holt kód nincs', () => {
  it('a régi, egyenkénti menülink-fájlok megszűntek', () => {
    for (const regi of ['StatisticsNavLink', 'BunnyLibraryNavLink', 'WebAnalyticsNavLink']) {
      expect(() =>
        readFileSync(new URL(`../components/admin/${regi}.tsx`, import.meta.url), 'utf8'),
      ).toThrow()
    }
  })
})
