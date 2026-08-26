import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import GlobalError from '../app/global-error'
import GlobalNotFound from '../app/global-not-found'
import ErrorPage from '../app/(frontend)/error'
import NotFound, { metadata as notFoundMetadata } from '../app/(frontend)/not-found'
import {
  NOT_FOUND_CHECKS,
  NOT_FOUND_CONTACT_EMAIL,
  NOT_FOUND_DESTINATIONS,
  NOT_FOUND_LEAD,
  NOT_FOUND_PRIMARY_ACTION,
  NOT_FOUND_SECONDARY_ACTION,
  NOT_FOUND_TITLE,
} from '../components/error/not-found-content'
import { FOOTER_CONTACT_EMAIL, FOOTER_LEGAL_LINKS } from '../components/layout/Footer'

/**
 * ŐR — HIBAOLDALAK (nem található + váratlan hiba).
 * Az élő 404-lap teljesen üres volt: `<body>` = `<div hidden>` + scriptek,
 * 0 link, 0 szöveg, se fejléc, se lábléc (docs/informacios-architektura.md,
 * TOP-10 #1). Minden elgépelt vagy elavult URL végleges zsákutca volt.
 * A GYÖKÉROK KÉT RÉTEGŰ, és mindkettőt külön teszt őrzi:
 */

const REPO = fileURLToPath(new URL('..', import.meta.url))

const notFoundMarkup = renderToStaticMarkup(<NotFound />)
const globalNotFoundMarkup = renderToStaticMarkup(<GlobalNotFound />)

/** A `<a href="…">` célok kigyűjtése egy renderelt HTML-darabból. */
function hrefs(markup: string): string[] {
  return [...markup.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((talalat) => talalat[1])
}

/** Címkék és szöveg tag nélkül, a szövegvizsgálatokhoz. */
function szoveg(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

describe('404 — a (frontend) not-found határa', () => {
  it('van pontosan egy h1, és az a magyar cím', () => {
    const h1 = [...notFoundMarkup.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((t) => szoveg(t[1]))
    expect(h1).toEqual([NOT_FOUND_TITLE])
  })

  it('a lap NEM zsákutca: legalább öt kattintható cél van benne', () => {
    // A 2026-08-16-i mérés szerint az élő lapon NULLA link volt.
    expect(hrefs(notFoundMarkup).length).toBeGreaterThanOrEqual(5)
  })

  it('a továbbvezető célok MIND szerepelnek, kód-útvonalra mutatva', () => {
    const celok = hrefs(notFoundMarkup)
    for (const destination of NOT_FOUND_DESTINATIONS) {
      expect(celok, `hiányzó cél: ${destination.href}`).toContain(destination.href)
    }
  })

  it('a kurzus- és a kezdőlap-CTA is jelen van (a két elsődleges kimenet)', () => {
    expect(hrefs(notFoundMarkup)).toEqual(
      expect.arrayContaining([NOT_FOUND_PRIMARY_ACTION.href, NOT_FOUND_SECONDARY_ACTION.href]),
    )
  })

  it('EGYETLEN cél sem szerepel kétszer (nincs kettőzött hivatkozás)', () => {
    // A gombok és a lista korábban ugyanazt a két célt kínálták — zaj, amit az
    // NN/g 404-cikke kifejezetten kerülendőnek tart.
    const belsoCelok = hrefs(notFoundMarkup).filter((h) => h.startsWith('/'))
    expect(new Set(belsoCelok).size).toBe(belsoCelok.length)
  })

  it('a CMS-független szöveg (nyitómondat + a három ellenőrző sor) ott van', () => {
    const tartalom = szoveg(notFoundMarkup)
    expect(tartalom).toContain(NOT_FOUND_LEAD)
    for (const check of NOT_FOUND_CHECKS) {
      expect(tartalom).toContain(check)
    }
  })

  it('a kapcsolatfelvétel elérhető a lapról (mailto)', () => {
    expect(hrefs(notFoundMarkup)).toContain(`mailto:${NOT_FOUND_CONTACT_EMAIL}`)
  })

  it('a második navigációs landmark meg van nevezve (WCAG 2.2 · 1.3.1)', () => {
    expect(notFoundMarkup).toMatch(/<nav\b[^>]*aria-labelledby="kc-404-celok"/)
    expect(notFoundMarkup).toMatch(/id="kc-404-celok"/)
  })

  it('a böngészőfül címe beszédes (WCAG 2.2 · 2.4.2)', () => {
    expect(notFoundMetadata.title).toBe(NOT_FOUND_TITLE)
  })
})

describe('404 — global-not-found (nem illeszkedő URL-ek)', () => {
  it('teljes, magyar nyelvű dokumentumot renderel (nem layout-függő)', () => {
    expect(globalNotFoundMarkup).toContain('<html lang="hu">')
    expect(globalNotFoundMarkup).toContain('<body>')
    expect(globalNotFoundMarkup).toContain('id="tartalom"')
  })

  it('a keretben ott a márkajelzés és a jogi sor (nincs kopasz lap)', () => {
    expect(globalNotFoundMarkup).toContain('kc-site-header__brand')
    for (const link of FOOTER_LEGAL_LINKS) {
      expect(hrefs(globalNotFoundMarkup), `hiányzó jogi link: ${link.href}`).toContain(link.href)
    }
  })

  it('UGYANAZT a szöveget adja, mint a (frontend) not-found (WCAG 2.2 · 3.2.4)', () => {
    const tartalom = szoveg(globalNotFoundMarkup)
    expect(tartalom).toContain(NOT_FOUND_TITLE)
    expect(tartalom).toContain(NOT_FOUND_LEAD)
    for (const check of NOT_FOUND_CHECKS) {
      expect(tartalom).toContain(check)
    }
  })

  it('van benne ugrás-a-tartalomra link (billentyűzetes belépés)', () => {
    expect(hrefs(globalNotFoundMarkup)).toContain('#tartalom')
  })

  it('a fájl ÉS az `experimental.globalNotFound` kapcsoló EGYÜTT él', () => {
    // Bármelyik kiesése némán visszahozza a Next beépített, ANGOL 404-lapját.
    const config = readFileSync(join(REPO, '..', 'next.config.ts'), 'utf8')
    expect(config).toMatch(/globalNotFound:\s*true/)
    expect(() => readFileSync(join(REPO, 'app/global-not-found.tsx'), 'utf8')).not.toThrow()
  })
})

describe('404 — a státuszkód 404 marad', () => {
  const ROUTEOK = [
    'app/(frontend)/[slug]/page.tsx',
    'app/(frontend)/kurzusok/[slug]/page.tsx',
    'app/(frontend)/blog/[slug]/page.tsx',
    'app/(frontend)/blog/kategoria/[slug]/page.tsx',
  ]

  it.each(ROUTEOK)('a %s hiányzó tartalomnál notFound()-ot hív', (ut) => {
    // A `notFound()` adja a 404-es státuszt. Ha valaki „üres állapotra"
    // cserélné, a válasz 200 lenne — Google szerint az soft 404.
    expect(readFileSync(join(REPO, ut), 'utf8')).toContain('notFound()')
  })
})

describe('hibaoldal — CMS-függetlenség és mikroszöveg', () => {
  const tartalomModul = readFileSync(join(REPO, 'components/error/not-found-content.ts'), 'utf8')
  const nezetModul = readFileSync(join(REPO, 'components/error/NotFoundView.tsx'), 'utf8')

  it('a szövegmodul NEM importál CMS-t vagy Payloadot (adatbázis-hiba esetén is áll)', () => {
    for (const modul of [tartalomModul, nezetModul]) {
      expect(modul).not.toMatch(/from '[^']*\/(cms|payload[^']*)'/)
      expect(modul).not.toMatch(/from 'payload'/)
    }
  })

  it('a látható szövegben nincs „404" szakzsargon (GOV.UK page-not-found minta)', () => {
    const tartalom = szoveg(notFoundMarkup)
    expect(tartalom).not.toMatch(/\b404\b/)
    expect(szoveg(globalNotFoundMarkup)).not.toMatch(/\b404\b/)
  })

  it('nincs gondolatjel-halmozás a vevői szövegben (magyar mikroszöveg 3.1)', () => {
    const mondatok = [
      NOT_FOUND_TITLE,
      NOT_FOUND_LEAD,
      NOT_FOUND_PRIMARY_ACTION.label,
      NOT_FOUND_SECONDARY_ACTION.label,
      ...NOT_FOUND_CHECKS,
    ]
    for (const mondat of mondatok) {
      expect(mondat, `gondolatjel a szövegben: ${mondat}`).not.toMatch(/[–—]/)
    }
    for (const destination of NOT_FOUND_DESTINATIONS) {
      expect(destination.label).not.toMatch(/[–—]/)
      expect(destination.hint).not.toMatch(/[–—]/)
    }
  })

  it('a kapcsolati e-mail egyezik a láblécével (egy cím, két helyen)', () => {
    expect(NOT_FOUND_CONTACT_EMAIL).toBe(FOOTER_CONTACT_EMAIL)
  })

  it('a global-not-found jogi listája egyezik a láblécével', () => {
    const forras = readFileSync(join(REPO, 'app/global-not-found.tsx'), 'utf8')
    for (const link of FOOTER_LEGAL_LINKS) {
      expect(forras).toContain(link.href)
      expect(forras).toContain(link.label)
    }
  })
})

describe('hibaoldal — stíluslap', () => {
  const css = readFileSync(join(REPO, 'app/(frontend)/styles/hibaoldal.css'), 'utf8')

  it('be van kötve a (frontend) globális stíluslapjába', () => {
    const belepo = readFileSync(join(REPO, 'app/(frontend)/styles.css'), 'utf8')
    expect(belepo).toContain("@import './styles/hibaoldal.css';")
  })

  it('NEM vezet be új betűméretet (a három-méretes skála sértetlen)', () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/font-size:/)
  })

  it('az érintőcél legalább 44px (WCAG 2.2 · 2.5.8 küszöbe 24px)', () => {
    expect(css).toMatch(/\.kc-error-page__dest-link\s*\{[^}]*min-height:\s*2\.75rem/)
  })

  it('a cél-kártya AZONOSÍTÓ keretet kap (≥ 3:1), nem dekoratív hajszálvonalat', () => {
    expect(css).toMatch(/\.kc-error-page__dest-link\s*\{[^}]*--kc-color-border-strong/)
  })
})

describe('hibaoldal — váratlan hiba (error + global-error)', () => {
  const errorMarkup = renderToStaticMarkup(<ErrorPage error={new Error('teszt')} reset={() => {}} />)
  const globalErrorMarkup = renderToStaticMarkup(
    <GlobalError error={new Error('teszt')} reset={() => {}} />,
  )

  it('a hibaoldal nem üres: van címe és továbbvezető linkje', () => {
    expect(errorMarkup).toMatch(/<h1\b/)
    expect(hrefs(errorMarkup)).toEqual(expect.arrayContaining(['/', '/kapcsolat']))
  })

  it('nincs benne technikai hibakód a látható szövegben (GOV.UK minta)', () => {
    expect(szoveg(errorMarkup)).not.toMatch(/\b500\b/)
    expect(szoveg(globalErrorMarkup)).not.toMatch(/\b500\b/)
  })

  it('az újrapróbálás gombnak van „folyamatban" állapota', () => {
    const forras = readFileSync(join(REPO, 'app/(frontend)/error.tsx'), 'utf8')
    expect(forras).toContain('useTransition')
    expect(forras).toContain('Újratöltés folyamatban…')
    // Három pont jelzi a folyamatot, nem gondolatjel (mikroszöveg 3.1).
    expect(forras).not.toContain('Újratöltés folyamatban —')
  })

  it('a naplózás a strukturált loggeren megy, nem console-on', () => {
    const forras = readFileSync(join(REPO, 'app/(frontend)/error.tsx'), 'utf8')
    expect(forras).toContain("from '@/lib/logger'")
    expect(forras).not.toContain('console.error')
  })

  it('a global-error SAJÁT dokumentumot ad (a gyökér-layout dőlt el)', () => {
    expect(globalErrorMarkup).toContain('<html lang="hu">')
    expect(globalErrorMarkup).toContain('<body>')
    expect(hrefs(globalErrorMarkup)).toEqual(expect.arrayContaining(['/', '/kapcsolat']))
  })
})
