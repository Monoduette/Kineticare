import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { FilmHero } from '@/components/blocks/FilmHero'
import { PhotoFrieze } from '@/components/blocks/PhotoFrieze'
import type { BlockFilmHero } from '@/payload-types'

/**
 * ŐR — a kezdőlap fotó-fríze (tulajdonosi kérés, 2026-09-07: saját fotó az
 * oldal elején, a film alatt).
 *
 * Amit véd:
 *  - négy saját, manifest szerinti fotó, a manifest alt-jával (NN/g Photos as
 *    Web Content: a valódi arcokat nézik, a dekorációt átugorják);
 *  - a vevői szöveg natív magyar: nincs töltelék gondolatjel, nincs CTA;
 *  - a mozgás dekoratív és kikapcsolható (WCAG 2.2 SC 2.3.3): a csökkentett
 *    mozgás blokk minden animációt, átmenetet és transformot kikapcsol;
 *  - nem interaktív: nincs cursor: pointer;
 *  - a tipográfia a három tokenen marad;
 *  - a fríz a filmsáv UTÁN áll, a film DOM-ja nem változott.
 */

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const CSS = readFileSync(join(REPO, 'src/app/(frontend)/styles/blocks/photo-frieze.css'), 'utf8')
const MANIFEST = JSON.parse(
  readFileSync(join(REPO, 'public/media/team/manifest.json'), 'utf8'),
) as { assets: Array<{ file: string; alt: string; width: number; height: number }> }

const kommentNelkul = (forras: string): string => forras.replace(/\/\*[\s\S]*?\*\//g, '')

const markup = renderToStaticMarkup(<PhotoFrieze />)
const kepek = [...markup.matchAll(/<img\b[^>]*>/g)].map((talalat) => talalat[0])

const VART_FAJLOK = [
  'founders-standing-blazers-1600.webp',
  'portrait-standing-navy-portrait-1600.webp',
  'hand-treatment-detail-1600.webp',
  'portrait-standing-white-blazer-portrait-1600.webp',
]

describe('fotó-fríz — szerkezet és tartalom', () => {
  it('négy csík, a manifest szerinti saját fotókkal, ebben a sorrendben', () => {
    expect(kepek).toHaveLength(4)
    for (const [index, fajl] of VART_FAJLOK.entries()) {
      expect(kepek[index], `a(z) ${index + 1}. csík nem a ${fajl}`).toContain(
        encodeURIComponent(`/media/team/${fajl}`),
      )
    }
  })

  it('minden alt a manifest ellenőrzött szövege, és a width/height a manifesté', () => {
    for (const [index, fajl] of VART_FAJLOK.entries()) {
      const asset = MANIFEST.assets.find((a) => a.file === fajl)
      expect(asset, `nincs a manifestben: ${fajl}`).toBeDefined()
      expect(kepek[index]).toContain(`alt="${asset?.alt}"`)
      expect(kepek[index]).toContain(`width="${asset?.width}"`)
      expect(kepek[index]).toContain(`height="${asset?.height}"`)
    }
  })

  it('az első kép azonnal tölt, a többi lusta; mind aszinkron dekódol, valós sizes-szal', () => {
    expect(kepek[0]).toContain('loading="eager"')
    expect(kepek[0]).not.toContain('fetchpriority="high"')
    for (const kep of kepek.slice(1)) {
      expect(kep).toContain('loading="lazy"')
    }
    for (const kep of kepek) {
      expect(kep).toContain('decoding="async"')
      expect(kep).toMatch(/sizes="[^"]*vw[^"]*"/)
      expect(kep).toMatch(/srcset="[^"]*\bw=384\b[^"]*"/i)
    }
  })

  it('a fríz magyar aria-labellel jelölt szekció, `.kc-section`-ként (SectionReveal-horog)', () => {
    expect(markup).toMatch(/<section aria-label="[^"]*[áéíóöőúüű][^"]*" class="kc-section kc-photo-frieze"/)
    expect(markup).toContain('class="kc-container kc-photo-frieze__inner"')
  })

  it('a csíkok index-változót kapnak a lépcsőzött belépőhöz', () => {
    for (const index of [0, 1, 2, 3]) {
      expect(markup).toContain(`style="--kc-frieze-i:${index}"`)
    }
  })

  it('a felirat két fele a kért szöveg, gondolatjel, felkiáltójel és CTA nélkül', () => {
    expect(markup).toContain('Kiss Kata és Kocsis Kata, gyógytornászok')
    expect(markup).toContain('Két rendelő Budapesten, és egy otthoni program.')
    const szoveg = markup.replace(/<[^>]*>/g, ' ')
    expect(szoveg).not.toMatch(/[–—]/)
    expect(szoveg).not.toContain('!')
    expect(markup).not.toMatch(/<a\b|<button\b/)
  })
})

describe('fotó-fríz — CSS-őr', () => {
  const tiszta = kommentNelkul(CSS)

  it('csökkentett mozgásnál minden animáció, átmenet és transform kikapcsol', () => {
    const index = tiszta.indexOf('@media (prefers-reduced-motion: reduce)')
    expect(index).toBeGreaterThan(-1)
    const blokk = tiszta.slice(index)
    expect(blokk).toContain('.kc-photo-frieze__strip')
    expect(blokk).toContain('.kc-photo-frieze__img')
    expect(blokk).toContain('animation: none')
    expect(blokk).toContain('transition: none')
    expect(blokk).toContain('transform: none')
    // A hover-nyúlás is: a csík marad 1-es arányon.
    expect(blokk).toMatch(/:hover[^{]*\{[^}]*flex: 1;/)
  })

  it('nem interaktív: nincs cursor: pointer', () => {
    expect(tiszta).not.toMatch(/cursor\s*:\s*pointer/)
  })

  it('a betűméret kizárólag token', () => {
    const meretek = [...tiszta.matchAll(/font-size:\s*([^;]+);/g)].map((t) => t[1].trim())
    expect(meretek.length).toBeGreaterThan(0)
    for (const meret of meretek) {
      expect(meret).toMatch(/^var\(--kc-font-[lms]\)$/)
    }
  })

  it('a hover-nyúlás csak a desktop töréspont felett, 1,6-os arányra, a motion-tokenről', () => {
    const hover = tiszta.indexOf('@media (min-width: 900px)')
    expect(hover).toBeGreaterThan(-1)
    expect(tiszta.slice(hover)).toMatch(/:hover[^{]*\{[^}]*flex: 1\.6;/)
    // A geometria-őr csak width/height/reduced-motion médiát ismer.
    expect(tiszta).not.toContain('(hover: hover)')
    expect(tiszta).toContain('--kc-frieze-motion: calc(var(--kc-motion-base) * 6)')
    expect(tiszta).not.toMatch(/\b1\.2s\b/)
  })

  it('a belépő clip-path, 80 ms-os lépcsővel, a SectionReveal jelére', () => {
    expect(tiszta).toContain('@keyframes kc-frieze-enter')
    expect(tiszta).toContain('clip-path: inset(100% 0 0)')
    expect(tiszta).toContain('animation-delay: calc(var(--kc-frieze-i, 0) * 80ms)')
    expect(tiszta).toContain('.kc-photo-frieze.is-revealed .kc-photo-frieze__strip')
  })

  it('a parallax scroll-driven és @supports mögött áll (JS nélkül)', () => {
    const supports = tiszta.indexOf('@supports (animation-timeline: view())')
    expect(supports).toBeGreaterThan(-1)
    expect(tiszta.indexOf('animation-timeline: view()', supports + 1)).toBeGreaterThan(supports)
  })

  it('a magasság és a köz tokenről/rácsról jön, az ív a magasság feléből', () => {
    expect(tiszta).toContain('--kc-frieze-h: clamp(20rem, 30vw, 27.5rem)')
    expect(tiszta).toContain('--kc-frieze-arch: calc(var(--kc-frieze-h) / 2)')
    expect(tiszta).toContain('--kc-frieze-gap: var(--kc-space-3)')
    expect(tiszta).not.toContain('var(--kc-radius-full)')
    // Mobil: három ÁLLÓ csík, 18rem (288 px, rácson); a fekvő páros fotó
    // marad el (mérve: 106 px-es hasábban arc nélküli vágat lenne).
    const mobil = tiszta.indexOf('@media (max-width: 899px)')
    expect(mobil).toBeGreaterThan(-1)
    expect(tiszta.slice(mobil)).toContain('--kc-frieze-h: 18rem')
    expect(tiszta.slice(mobil)).toMatch(/:first-child\s*\{\s*display: none;/)
  })

  it('a nyitó páros portré külön vágat és külön arány nélkül fér ki (mérve 1440/1024)', () => {
    expect(kepek[0]).not.toContain('object-position')
    expect(tiszta).not.toMatch(/:first-child\s*\{\s*flex:/)
    // A Rólunk-szekció páros fotója nem ismétlődik a frízben.
    expect(markup).not.toContain('founders-intro-white')
  })
})

describe('fotó-fríz — bekötés a filmsáv után', () => {
  const blokk: BlockFilmHero = {
    blockType: 'filmHero',
    ctas: [],
    lead: 'Teszt-bevezető.',
    tags: [],
    title: 'Teszt-cím',
  }

  it('a FilmHero a scrub-színpad UTÁN, testvérként rendereli a frízt', () => {
    const html = renderToStaticMarkup(<FilmHero block={blokk} />)
    const film = html.indexOf('class="scroll-scrub kc-film-hero"')
    const friz = html.indexOf('class="kc-section kc-photo-frieze"')
    // A markup elején a next/image eager-preload linkje áll; az ELSŐ szekció
    // a film, a `.kc-film-hero:first-of-type` fejléc-alá-húzás így él.
    expect(html.indexOf('<section')).toBe(html.indexOf('<section class="scroll-scrub kc-film-hero"'))
    expect((html.match(/<link rel="preload"/g) ?? []).length).toBe(1)
    expect(html).not.toContain('fetchpriority="high"')
    expect(film).toBeGreaterThan(0)
    expect(friz).toBeGreaterThan(film)
    // A fríz NEM a filmszekción belül van: a film záró </section>-je megelőzi.
    const filmVege = html.lastIndexOf('</section>', friz)
    expect(filmVege).toBeGreaterThan(film)
    expect(filmVege).toBeLessThan(friz)
  })

  it('a cím nélküli blokk frízt sem ad (a fríz a film kísérője)', () => {
    expect(renderToStaticMarkup(<FilmHero block={{ ...blokk, title: '' }} />)).toBe('')
  })
})
