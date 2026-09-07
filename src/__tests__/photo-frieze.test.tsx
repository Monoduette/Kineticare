import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { About } from '@/components/blocks/About'
import { FilmHero } from '@/components/blocks/FilmHero'
import { PhotoFrieze } from '@/components/blocks/PhotoFrieze'
import type { BlockAbout, BlockFilmHero, Media } from '@/payload-types'

/**
 * ŐR — a kezdőlapi alapítók-szekció fotó-fríze (WP11, tulajdonosi kérés
 * 2026-09-07: „az alapítók és a fölső mozgó 4 kép mehetne egybe").
 *
 * Amit véd:
 *  - a fríz NEM önálló szekció: a Rólunk-blokk (`kc-about--founders`)
 *    rácsában áll, a filmsáv már nem rendereli (NN/g Common Region: egy
 *    határ = egy tartalmi egység; WCAG 2.2 SC 2.4.6: egy H2 nevezi meg);
 *  - négy saját, manifest szerinti fotó, a manifest alt-jával (NN/g Photos as
 *    Web Content: a valódi arcokat nézik, a dekorációt átugorják);
 *  - az alapítók-alakban a CMS páros fotó NEM renderel (nincs ismétlődő
 *    arcpár egy régióban), a sima/páros alakban viszont változatlanul igen;
 *  - a mozgás dekoratív és kikapcsolható (WCAG 2.2 SC 2.3.3): a csökkentett
 *    mozgás blokk minden animációt, átmenetet és transformot kikapcsol;
 *  - nem interaktív: nincs cursor: pointer, nincs link, nincs gomb;
 *  - a CSS nem visz betűméretet (szöveg nincs a frízben).
 */

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const CSS = readFileSync(join(REPO, 'src/app/(frontend)/styles/blocks/photo-frieze.css'), 'utf8')
const ABOUT_CSS = readFileSync(join(REPO, 'src/app/(frontend)/styles/blocks/about.css'), 'utf8')
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

const parosFoto = {
  id: 7,
  url: '/media/founders-intro-white.jpg',
  alt: 'Kiss Kata és Kocsis Kata',
  width: 1600,
  height: 1067,
  createdAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z',
} satisfies Media

const aboutBlokk = (extra: Partial<BlockAbout> = {}): BlockAbout => ({
  blockType: 'about',
  id: 'alapitok',
  eyebrow: 'Rólunk',
  title: 'Kiss Kata és Kocsis Kata vagyunk',
  paragraphs: [
    { text: 'Gyógytornászok vagyunk.', emphasized: true },
    { text: 'A kéz rehabilitációjával foglalkozunk.', emphasized: false },
  ],
  feature: { label: 'Személyre szabott kezelések', note: 'Minden terápiát személyre szabunk.' },
  photo: parosFoto,
  stats: [
    { value: '10+', label: 'év szakmai tapasztalat' },
    { value: '1000+', label: 'elégedett páciens' },
  ],
  ...extra,
})

describe('fotó-fríz — szerkezet és tartalom', () => {
  it('négy ív, a manifest szerinti saját fotókkal, ebben a sorrendben', () => {
    expect(kepek).toHaveLength(4)
    for (const [index, fajl] of VART_FAJLOK.entries()) {
      expect(kepek[index], `a(z) ${index + 1}. ív nem a ${fajl}`).toContain(
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

  it('a fríz `figure`, nem szekció és nem landmark: a nevet a befogadó About H2-je adja', () => {
    expect(markup).toContain('<figure class="kc-photo-frieze">')
    expect(markup).not.toContain('<section')
    expect(markup).not.toContain('kc-section')
    expect(markup).not.toContain('aria-label')
    expect(markup).not.toContain('<figcaption')
  })

  it('a csíkok index-változót kapnak a lépcsőzött belépőhöz', () => {
    for (const index of [0, 1, 2, 3]) {
      expect(markup).toContain(`style="--kc-frieze-i:${index}"`)
    }
  })

  it('nincs benne szöveg, link vagy gomb (a felirat szerepét az About címe viszi)', () => {
    const szoveg = markup.replace(/<[^>]*>/g, '').trim()
    expect(szoveg).toBe('')
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
  })

  it('nem interaktív: nincs cursor: pointer, és nincs hover-nyúlás (flex); a hover-blokk nem mozgat (transform/opacity/filter)', () => {
    expect(tiszta).not.toMatch(/cursor\s*:\s*pointer/)
    expect(tiszta).not.toMatch(/:hover[^{]*\{[^}]*flex/)
    const hoverBlokk = tiszta.slice(
      tiszta.indexOf('@media (hover: hover)'),
      tiszta.indexOf('@media (prefers-reduced-motion: reduce)'),
    )
    expect(hoverBlokk).not.toMatch(/transform|translate|filter|opacity/)
  })

  it('a CSS nem visz betűméretet (a frízben nincs szöveg)', () => {
    expect(tiszta).not.toMatch(/font-size/)
  })

  it('a belépő clip-path, 80 ms-os lépcsővel, a befogadó szekció is-revealed jelére', () => {
    expect(tiszta).toContain('@keyframes kc-frieze-enter')
    expect(tiszta).toContain('clip-path: inset(100% 0 0)')
    expect(tiszta).toContain('animation-delay: calc(var(--kc-frieze-i, 0) * 80ms)')
    expect(tiszta).toContain('.is-revealed .kc-photo-frieze__strip')
    expect(tiszta).toContain('--kc-frieze-motion: calc(var(--kc-motion-base) * 6)')
    expect(tiszta).not.toMatch(/\b1\.2s\b/)
  })

  it('a parallax scroll-driven és @supports mögött áll (JS nélkül)', () => {
    const supports = tiszta.indexOf('@supports (animation-timeline: view())')
    expect(supports).toBeGreaterThan(-1)
    expect(tiszta.indexOf('animation-timeline: view()', supports + 1)).toBeGreaterThan(supports)
  })

  it('desktop: 2×2 rács, 17rem-es sorok, a felső sor íves; az ív a csempe magasságából', () => {
    expect(tiszta).toContain('--kc-frieze-h: 17rem')
    expect(tiszta).toContain('--kc-frieze-arch: var(--kc-frieze-h)')
    expect(tiszta).toContain('--kc-frieze-gap: var(--kc-space-3)')
    expect(tiszta).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(tiszta).toContain('grid-auto-rows: var(--kc-frieze-h)')
    expect(tiszta).toMatch(/:nth-child\(-n \+ 2\)\s*\{\s*border-radius: var\(--kc-frieze-arch\)/)
    expect(tiszta).not.toContain('var(--kc-radius-full)')
  })

  it('mobil: egy sor, 18rem, a páros portré elmarad, a páros csíkok ívesek', () => {
    const mobil = tiszta.indexOf('@media (max-width: 899px)')
    expect(mobil).toBeGreaterThan(-1)
    const blokk = tiszta.slice(mobil)
    expect(blokk).toContain('--kc-frieze-h: 18rem')
    expect(blokk).toMatch(/:first-child\s*\{\s*display: none;/)
    expect(blokk).toMatch(/:nth-child\(2n\)\s*\{\s*border-radius: var\(--kc-frieze-arch\)/)
  })

  it('a nyitó páros portré külön vágat nélkül fér ki; a CMS páros fotója nem ismétlődik', () => {
    expect(kepek[0]).not.toContain('object-position')
    expect(markup).not.toContain('founders-intro-white')
  })
})

describe('fotó-fríz — bekötés az alapítók-szekcióba (About), nem a filmsávba', () => {
  const filmBlokk: BlockFilmHero = {
    blockType: 'filmHero',
    ctas: [],
    lead: 'Teszt-bevezető.',
    tags: [],
    title: 'Teszt-cím',
  }

  it('a FilmHero csak a scrub-színpadot rendereli, frízt nem', () => {
    const html = renderToStaticMarkup(<FilmHero block={filmBlokk} />)
    expect(html).toContain('class="scroll-scrub kc-film-hero"')
    expect(html).not.toContain('kc-photo-frieze')
    expect(html).not.toContain('/media/team/')
  })

  it('frieze=true: a fríz az About rácsában, a szöveg ELŐTT, a CMS páros fotó nélkül', () => {
    const html = renderToStaticMarkup(<About block={aboutBlokk()} frieze />)
    expect(html).toContain('kc-about--founders')
    expect(html).not.toContain('kc-about--paired')
    expect(html).not.toContain('kc-about__figure')
    expect(html).not.toContain('founders-intro-white')
    expect((html.match(/<section\b/g) ?? []).length).toBe(1)
    expect((html.match(/<h2\b/g) ?? []).length).toBe(1)
    expect(html).toMatch(/aria-labelledby="about-cim-alapitok"/)
    const friz = html.indexOf('<figure class="kc-photo-frieze">')
    const szoveg = html.indexOf('class="kc-about__copy"')
    const szamok = html.indexOf('class="kc-about__stats"')
    expect(friz).toBeGreaterThan(html.indexOf('kc-about__grid'))
    expect(friz).toBeLessThan(szoveg)
    expect(szoveg).toBeLessThan(szamok)
    // Négy saját fotó, és egyetlen arc-pár sem kétszer.
    expect((html.match(/%2Fmedia%2Fteam%2F|\/media\/team\//g) ?? []).length).toBeGreaterThan(0)
    expect((html.match(/<img\b/g) ?? []).length).toBe(4)
  })

  it('frieze nélkül (pl. /rolunk) a blokk a páros alak: CMS-fotó, fríz nincs', () => {
    const html = renderToStaticMarkup(<About block={aboutBlokk()} />)
    expect(html).toContain('kc-about--paired')
    expect(html).not.toContain('kc-about--founders')
    expect(html).not.toContain('kc-photo-frieze')
    expect(html).toContain('founders-intro-white')
  })

  it('szöveg nélkül a frieze jel nem ad alapítók-alakot (a fríz a bemutatkozás fele)', () => {
    const html = renderToStaticMarkup(
      <About
        block={aboutBlokk({ eyebrow: '', title: '', paragraphs: [], feature: undefined })}
        frieze
      />,
    )
    expect(html).not.toContain('kc-about--founders')
    expect(html).not.toContain('kc-photo-frieze')
    expect(html).toContain('kc-about__figure')
  })

  it('a szöveghasáb három csoportra oszlik (fej, törzs, láb), természetes folyással, felül igazítva', () => {
    const html = renderToStaticMarkup(<About block={aboutBlokk()} frieze />)
    const fej = html.indexOf('class="kc-about__head"')
    const torzs = html.indexOf('class="kc-about__body"')
    const lab = html.indexOf('class="kc-about__foot"')
    expect(fej).toBeGreaterThan(-1)
    expect(torzs).toBeGreaterThan(fej)
    expect(lab).toBeGreaterThan(torzs)
    const tiszta = kommentNelkul(ABOUT_CSS)
    const desktop = tiszta.indexOf('@media (min-width: 900px)')
    expect(desktop).toBeGreaterThan(-1)
    expect(tiszta.slice(desktop)).toMatch(
      /\.kc-about--founders \.kc-about__copy,\s*\.kc-about--paired \.kc-about__copy\s*\{[^}]*justify-content: flex-start;[^}]*align-self: stretch;/,
    )
    // WP18: a space-between 1440 px-en 106 px-es réseket adott — tilos.
    expect(tiszta).not.toContain('space-between')
    // A bekezdésköz tokenes (space-4), nem kézi érték.
    expect(tiszta).toMatch(/\.kc-about__text\s*\{[^}]*margin: 0 0 var\(--kc-space-4\);/)
  })

  it('WP24 hover: a hullám-maszk mérete változik (nem a kép nagyít), csak hover-eszközön, 240 ms ease-out-tal; reduced-motion alatt semmi', () => {
    const about = kommentNelkul(ABOUT_CSS)
    const friz = kommentNelkul(CSS)
    // A nyugalmi és a hover maszk-méret egy helyen, tokenként (a fríz is ezt kapja).
    expect(about).toMatch(/--kc-about-wave-rest:\s*100% 92\.5%,\s*100% 8%;/)
    expect(about).toMatch(/--kc-about-wave-hover:\s*100% 89\.5%,\s*112% 11%;/)
    for (const [forras, elem, hover] of [
      [about, '.kc-about#rolunk .kc-about__figure', '.kc-about#rolunk .kc-about__figure:hover'],
      [
        friz,
        '.kc-photo-frieze__strips',
        '.kc-photo-frieze__strips:has(.kc-photo-frieze__strip:nth-child(n + 3):hover)',
      ],
    ] as const) {
      const hoverKezdet = forras.indexOf('@media (hover: hover)')
      expect(hoverKezdet).toBeGreaterThan(-1)
      const hoverBlokk = forras.slice(hoverKezdet)
      const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      expect(hoverBlokk).toMatch(
        new RegExp(
          `${esc(elem)}\\s*\\{[^}]*transition-property: -webkit-mask-size, mask-size;[^}]*transition-duration: calc\\(var\\(--kc-motion-base\\) \\* 1\\.2\\);[^}]*transition-timing-function: var\\(--kc-ease-out\\);`,
        ),
      )
      expect(hoverBlokk).toMatch(
        new RegExp(
          `${esc(hover)}\\s*\\{[^}]*-webkit-mask-size: var\\(--kc-about-wave-hover\\);[^}]*mask-size: var\\(--kc-about-wave-hover\\);`,
        ),
      )
      // A hover-állapot NEM a hover-blokkon kívül él (érintőn nincs ragadó állapot).
      expect(forras.slice(0, hoverKezdet)).not.toContain('--kc-about-wave-hover)')
      const csokkentett = forras.slice(forras.indexOf('@media (prefers-reduced-motion: reduce)'))
      expect(csokkentett).toContain('transition: none')
      expect(csokkentett).toContain('mask-size: var(--kc-about-wave-rest)')
      // A régi nagyítás és a ragadó hasáb nem térhet vissza.
      expect(forras).not.toContain('scale: 1.03')
      expect(forras).not.toContain('position: sticky')
      // Nem link, nem gomb: nincs kattintás-ígéret.
      expect(forras).not.toContain('cursor: pointer')
    }
    // A fríz felső sorának íve lapul hoverre (border-radius), és reduce alatt visszaáll.
    const frizHover = friz.slice(friz.indexOf('@media (hover: hover)'))
    expect(frizHover).toMatch(
      /\.kc-photo-frieze__strip:nth-child\(-n \+ 2\):hover\s*\{\s*border-radius: 50% 50% 0 0 \/ 40% 40% 0 0;/,
    )
    expect(friz.slice(friz.indexOf('@media (prefers-reduced-motion: reduce)'))).toMatch(
      /\.kc-photo-frieze__strip:nth-child\(-n \+ 2\):hover\s*\{\s*border-radius: var\(--kc-frieze-arch\) var\(--kc-frieze-arch\) 0 0;/,
    )
  })

  it('az alapítók-alak rácsa fele-fele, a fríz a jobb hasábban, hullámos alsó éllel', () => {
    const tiszta = kommentNelkul(ABOUT_CSS)
    expect(tiszta).toMatch(
      /\.kc-about--founders \.kc-about__grid,\s*\.kc-about--paired \.kc-about__grid\s*\{[^}]*grid-template-columns: minmax\(0, 50%\) minmax\(0, 1fr\)/,
    )
    expect(tiszta).toMatch(/\.kc-about--founders \.kc-photo-frieze\s*\{[^}]*grid-column: 2;/)
    // WP24: a képhasáb NEM ragad (tulajdonos: „mozog vele a kép"), felül igazítva áll;
    // a szöveghasáb a sor magasságát tölti ki, a kiemelés a hasáb aljára ül.
    expect(tiszta).toMatch(
      /\.kc-about--founders \.kc-photo-frieze,\s*\.kc-about--paired \.kc-about__figure\s*\{\s*align-self: start;\s*\}/,
    )
    expect(tiszta).not.toContain('position: sticky')
    expect(tiszta).toMatch(
      /\.kc-about--founders \.kc-about__foot,\s*\.kc-about--paired \.kc-about__foot\s*\{\s*margin-top: auto;\s*\}/,
    )
    expect(tiszta).toMatch(/\.kc-about--founders \.kc-about__copy\s*\{[^}]*grid-column: 1;/)
    expect(tiszta).toMatch(
      /\.kc-about--founders \.kc-photo-frieze__strips,\s*\.kc-about#rolunk \.kc-about__figure\s*\{[^}]*mask-image: linear-gradient\(#000 0 0\), var\(--kc-about-wave\)/,
    )
    // Mobilon a három szám egymás alatt.
    const keskeny = tiszta.indexOf('@media (max-width: 599px)')
    expect(keskeny).toBeGreaterThan(-1)
    expect(tiszta.slice(keskeny)).toMatch(
      /\.kc-about--founders \.kc-about__stats\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/,
    )
  })
})
