import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PageHero, PAROS_FEJLEC_SLUGOK } from '../components/content/PageHero'
import { CourseGalleryFigure, firstGalleryMedia } from '../components/courses/CourseGalleryFigure'
import type { Media, Product } from '../payload-types'

/**
 * ŐR — WP51, a tulajdonosok aloldali kérései (2026-09-19), KÓD-oldal.
 *
 * A pontok és az élőben MÉRT kiindulás (Chromium, 1440 px, ha más nincs írva):
 *  2a. /rolunk: a H1 („A kéz a mindenünk") a lap-hero, fejléc-kép nélkül; a
 *      korábbi kód a `heroImage`-et a hero ALATT, külön sávban mutatta →
 *      PageHero páros alak: cím és bevezető balra, fotó jobbra, egy vonalban.
 *  2b. /rolunk About-törzs: 544 px-es sapka a 656 px-es hasábban (65
 *      karakter/sor, 112 px üres a jobb szélen), ink-soft szín → 40rem-es
 *      sapka (a hasáb 631 px-e, ≈ 75 karakter), ink szín (13,53:1 a tinten).
 *  2c. A statisztikasor auto-fit: 390 px-en EGY oszlop, négy sor → ≥ 600 px
 *      mindig egy sor (`grid-auto-flow: column`), alatta két oszlop.
 *  2d. Kezdőlapi alapítók-fríz: 556 px magas, a szöveghasáb 752 → a kiemelés
 *      195 px-szel a képek alá → ≥ 1200 px a fríz a sort tölti ki.
 *  3.  /szolgaltatasok: hero-lead 480 px (57 karakter) → 34rem (65); a welcome
 *      6:5 hasábja 1024-en 393 px (46 karakter) → fele-fele; az 1. ajtó
 *      kezelés közbeni fotót kap (home-help-states.test.ts).
 *  4.  Ingyenes kurzus: garancia null (course-sales-content.test.ts); a
 *      `gallery` első képe a leírás után (CourseGalleryFigure).
 *  6.  /blog kártyacím: Tenor Sans 400 = a kivonat súlya → Nunito Sans 700.
 * Források a komponens- és CSS-kommentekben (NN/g, Baymard, Material 3,
 * Apple HIG, GOV.UK, Lucide, WCAG 2.2 1.4.3 / 1.4.8 / 1.4.10 / 1.4.11).
 */

const REPO = fileURLToPath(new URL('..', import.meta.url))
const css = (rel: string): string => readFileSync(`${REPO}app/(frontend)/styles/${rel}`, 'utf8')

/** A szelektor SAJÁT (sor elején álló) szabálytörzse (a `{ … }` belseje). */
function torzs(forras: string, szelektor: string): string {
  const szokott = szelektor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const minta = new RegExp(`^\\s*${szokott} \\{([^}]*)\\}`, 'm')
  const talalat = minta.exec(forras)
  if (talalat === null) throw new Error(`nincs szabály: ${szelektor}`)
  return talalat[1] ?? ''
}

/** A megadott feltételű `@media` blokkok belseje, egybefűzve. */
function media(forras: string, feltetel: string): string {
  const fej = `@media ${feltetel} {`
  const darabok: string[] = []
  let idx = forras.indexOf(fej)
  while (idx !== -1) {
    let melyseg = 0
    let veg = -1
    for (let i = forras.indexOf('{', idx); i < forras.length; i += 1) {
      if (forras[i] === '{') melyseg += 1
      if (forras[i] === '}') {
        melyseg -= 1
        if (melyseg === 0) {
          veg = i
          break
        }
      }
    }
    if (veg === -1) throw new Error('lezáratlan @media')
    darabok.push(forras.slice(idx, veg + 1))
    idx = forras.indexOf(fej, veg)
  }
  if (darabok.length === 0) throw new Error(`nincs @media: ${feltetel}`)
  return darabok.join('\n')
}

const foto: Media = {
  id: 1,
  alt: 'Kiss Kata és Kocsis Kata a stúdióban',
  url: '/api/media/file/katak-team.webp',
  filename: 'katak-team.webp',
  mimeType: 'image/webp',
  width: 1600,
  height: 1067,
  createdAt: '',
  updatedAt: '',
}

describe('2a. PageHero — a fejléc-kép a cím MELLETT', () => {
  it('kép nélkül a mai szűk hero (720 px-es hasáb), páros osztály nélkül', () => {
    const html = renderToStaticMarkup(
      createElement(PageHero, { title: 'A kéz a mindenünk', lead: 'Bevezető.', media: null }),
    )
    expect(html).toContain('kc-container--narrow')
    expect(html).toContain('<h1 class="kc-page-hero__title">A kéz a mindenünk</h1>')
    expect(html).toContain('kc-page-hero__lead')
    expect(html).not.toContain('kc-page-hero--paired')
    expect(html).not.toContain('<figure')
  })

  it('képpel, de variant nélkül (általános CMS-oldal): a kép a fejléc ALATT, saját sávban, vágás nélkül', () => {
    const html = renderToStaticMarkup(
      createElement(PageHero, { title: 'Bármely oldal', lead: 'Bevezető.', media: foto }),
    )
    expect(html).toContain('kc-container--narrow')
    expect(html).not.toContain('kc-page-hero--paired')
    expect(html).toContain('kc-page-hero__media')
    expect(html).not.toContain('<figure class="kc-page-hero__figure">')
    // A cím megelőzi a képet; a kép nem lusta (LCP-jelölt).
    expect(html.indexOf('kc-page-hero__title')).toBeLessThan(html.indexOf('kc-page-hero__media'))
    expect(html).not.toContain('loading="lazy"')
  })

  it('képpel, paired (a /rolunk): széles konténer, a cím és a bevezető ELŐBB, a fotó UTÁNA a DOM-ban (mobilon a cím alatt)', () => {
    const html = renderToStaticMarkup(
      createElement(PageHero, {
        title: 'A kéz a mindenünk',
        lead: 'Bevezető.',
        media: foto,
        variant: 'paired',
      }),
    )
    expect(html).toContain('kc-page-hero--paired')
    expect(html).not.toContain('kc-container--narrow')
    expect(html).toContain('kc-page-hero__grid')
    const cim = html.indexOf('kc-page-hero__title')
    const lead = html.indexOf('kc-page-hero__lead')
    const figure = html.indexOf('<figure class="kc-page-hero__figure">')
    expect(cim).toBeGreaterThan(-1)
    expect(lead).toBeGreaterThan(cim)
    expect(figure).toBeGreaterThan(lead)
    // A fotó a lap LCP-jelöltje: nem lusta, és a leírása a Media alt-ja.
    expect(html).not.toContain('loading="lazy"')
    expect(html).toContain('alt="Kiss Kata és Kocsis Kata a stúdióban"')
    // A régi „kép a hero alatt" sáv nem renderel.
    expect(html).not.toContain('kc-page-hero__media')
  })

  it('CSS: 900 px-től fele-fele rács, felül igazítva; a bevezető a törzs mértékén (34rem)', () => {
    const c = css('content.css')
    expect(torzs(c, '.kc-page-hero__grid')).toContain('align-items: start')
    const asztal = media(c, '(min-width: 900px)')
    expect(asztal).toMatch(
      /\.kc-page-hero__grid\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/,
    )
    expect(torzs(c, '.kc-page-hero__lead')).toContain('max-width: var(--kc-measure)')
    expect(torzs(c, '.kc-page-hero__lead')).not.toContain('measure-comfort')
    expect(torzs(c, '.kc-page-hero__figure')).toContain('margin: 0')
    expect(torzs(c, '.kc-page-hero__figure')).toContain('max-width: 28rem')
    expect(asztal).toMatch(/\.kc-page-hero__figure\s*\{[^}]*max-width: none/)
    // A CMS-oldal route a PageHero-t használja, a régi inline hero-t nem.
    const route = readFileSync(`${REPO}app/(frontend)/[slug]/page.tsx`, 'utf8')
    expect(route).toContain('<PageHero')
    expect(route).not.toContain('kc-page-hero__media')
    // A páros (arcra hangolt, 3:2-re vágó) alak KIZÁRÓLAG a /rolunk-é; minden
    // más CMS-oldal a képet a természetes arányán, a fejléc alatt kapja.
    expect(route).toContain("variant={PAROS_FEJLEC_SLUGOK.has(slug) ? 'paired' : 'stacked'}")
    expect([...PAROS_FEJLEC_SLUGOK].sort()).toEqual(['rolunk', 'szolgaltatasok'])
  })
})

describe('2b–2d. About — törzs, számsor, fríz', () => {
  const about = css('blocks/about.css')

  it('a törzs a fő szövegszínen áll, a sapka 33em (≈ 75 karakter minden lépcsőn), a súly marad 400', () => {
    const t = torzs(about, '.kc-about__text')
    expect(t).toContain('color: var(--kc-about-ink)')
    expect(t).not.toContain('--kc-about-muted')
    expect(t).toContain('max-width: 33em')
    expect(t).not.toContain('font-weight')
    expect(t).toContain('font-size: var(--kc-font-m)')
  })

  it('a számok ≥ 600 px-en MINDIG egy sorban (auto-flow column), alatta két oszlop', () => {
    expect(torzs(about, '.kc-about__stats')).toContain(
      'grid-template-columns: repeat(2, minmax(0, 1fr))',
    )
    const tablet = media(about, '(min-width: 600px)')
    expect(tablet).toContain('grid-auto-flow: column')
    expect(tablet).toContain('grid-auto-columns: minmax(0, 1fr)')
    expect(about).not.toContain('repeat(auto-fit, minmax(min(10rem, 100%), 1fr))')
  })

  it('≥ 1200 px az alapítók-fríz a rács sorát tölti ki, a két sora egyenlően nő', () => {
    const szeles = media(about, '(min-width: 1200px)')
    expect(szeles).toMatch(/\.kc-about--founders \.kc-photo-frieze\s*\{[^}]*align-self: stretch/)
    expect(szeles).toMatch(
      /\.kc-about--founders \.kc-photo-frieze__strips\s*\{[^}]*grid-template-rows: repeat\(2, minmax\(var\(--kc-frieze-h\), 1fr\)\)/,
    )
    // A csempe belső mérete nem számít a sorba: a sor a szöveghasábé.
    expect(szeles).toMatch(/\.kc-about--founders \.kc-photo-frieze__strip\s*\{[^}]*contain: size/)
    // A /rolunk páros fotója nem nyúlik (WP24): a szabály csak a frízé.
    expect(szeles).not.toContain('.kc-about__figure')
  })
})

describe('3. Szolgáltatások — welcome hasábok', () => {
  it('900 px-től fele-fele hasáb, a bekezdés sapkája 40rem', () => {
    const w = css('blocks/welcome.css')
    const asztal = media(w, '(min-width: 900px)')
    expect(asztal).toMatch(
      /\.kc-welcome__grid\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/,
    )
    expect(w).not.toContain('minmax(0, 6fr) minmax(0, 5fr)')
    expect(torzs(w, '.kc-welcome__side-text')).toContain('max-width: 33em')
  })
})

describe('4. Kurzusoldal — a galéria első képe a leírás után', () => {
  const kep = (id: number): Media => ({ ...foto, id, alt: `Kezelés ${id}` })

  it('kép nélkül nem renderel, az első feloldott képet adja, a feloldatlan id-t átlépi', () => {
    expect(firstGalleryMedia({ gallery: null })).toBeNull()
    expect(firstGalleryMedia({ gallery: [{ image: 12 }] })).toBeNull()
    expect(
      firstGalleryMedia({ gallery: [{ image: 12 }, { image: kep(2) }, { image: kep(3) }] }),
    ).toEqual(kep(2))
    expect(
      renderToStaticMarkup(createElement(CourseGalleryFigure, { product: { gallery: [] } })),
    ).toBe('')
  })

  it('egy figure, a Media alt-jával; a route a leírás után, a lépések előtt fűzi be', () => {
    const html = renderToStaticMarkup(
      createElement(CourseGalleryFigure, { product: { gallery: [{ image: kep(5) }] } }),
    )
    expect(html.match(/<figure/g)).toHaveLength(1)
    expect(html).toContain('class="kc-course-figure"')
    expect(html).toContain('alt="Kezelés 5"')
    const route = readFileSync(`${REPO}app/(frontend)/kurzusok/[slug]/page.tsx`, 'utf8')
    const galeria = route.indexOf('<CourseGalleryFigure')
    const leiras = route.indexOf("id: 'mi-ez'")
    const lepesek = route.indexOf("id: 'hogyan-mukodik'")
    expect(leiras).toBeGreaterThan(-1)
    expect(galeria).toBeGreaterThan(leiras)
    expect(lepesek).toBeGreaterThan(galeria)
    const k = readFileSync(`${REPO}app/(frontend)/kurzusok/kurzusok.css`, 'utf8')
    expect(torzs(k, '.kc-course-figure')).toContain('aspect-ratio: 3 / 2')
    expect(torzs(k, '.kc-course-figure img')).toContain('object-fit: cover')
  })

  it('a Product típus gallery mezője a figure-nek átadható', () => {
    const product = { gallery: [{ image: kep(1) }] } as Pick<Product, 'gallery'>
    expect(firstGalleryMedia(product)?.id).toBe(1)
  })
})

describe('6. Blog — a kártyacím félkövér, az M lépcsőn', () => {
  it('Nunito Sans 700 (a Tenor Sansnak nincs félkövér metszete), méret változatlan', () => {
    const k = css('blocks/knowledge.css')
    const t = torzs(k, '.kc-post-card .kc-post-card__title')
    expect(t).toContain('font-family: var(--kc-font-body)')
    expect(t).toContain('font-weight: var(--kc-font-weight-bold)')
    expect(t).not.toContain('font-size')
    // A közös alap (content.css) az M tokent adja: a skála három lépcsője marad.
    const c = css('content.css')
    expect(c).toMatch(/\.kc-post-card__title\s*\{[^}]*font-size: var\(--kc-font-m\)/)
    // A fonts.css-ben a Tenor Sans csak 400-as; a Nunito Sans 400–700 variábilis.
    const f = css('fonts.css')
    expect(f).not.toMatch(/font-family: 'Tenor Sans';[^}]*font-weight: (600|700|400 700)/)
    expect(f).toMatch(/font-family: 'Nunito Sans';[^}]*font-weight: 400 700/)
  })
})
