import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { FilmHero } from '@/components/blocks/FilmHero'
import { scrollScrubMediaFit, scrollScrubNeedsLayout } from '@/components/scroll-scrub/scroll-scrub'
import type { BlockFilmHero } from '@/payload-types'

import { sajatErtek, stilusLapNezetablakra, type Elem } from './helpers/css-geometria'

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const FILM_HERO_SOURCE = readFileSync(join(REPO, 'src/components/blocks/FilmHero.tsx'), 'utf8')
const FILM_HERO_CSS_PATH = join(REPO, 'src/app/(frontend)/styles/blocks/film-hero.css')
const FILM_HERO_CSS = readFileSync(FILM_HERO_CSS_PATH, 'utf8')
const SCROLL_SCRUB_SOURCE = readFileSync(
  join(REPO, 'src/components/scroll-scrub/scroll-scrub.tsx'),
  'utf8',
)
const SCROLL_SCRUB_CSS_PATH = join(REPO, 'src/components/scroll-scrub/scroll-scrub.css')
const SCROLL_SCRUB_CSS = readFileSync(SCROLL_SCRUB_CSS_PATH, 'utf8')

/**
 * ŐR — a filmsáv 2. és 3. „állása" CÍM + LEÍRÁS párban áll.
 *
 * A tulajdonos 2026-08-17-i kifogása szó szerint: a két görgetés-álláson „nem
 * csak valami titulus és alatta semmi, mert az üres" — kell alá leírás, mint
 * az 1. állás szekciójában. Ez a teszt azt akadályozza meg, hogy a leírás egy
 * későbbi szerkesztéssel némán kiürüljön: a szöveg KÓDBAN él (nem CMS-mező),
 * tehát nincs szerkesztői visszajelzés, ami az eltűnését jelezné.
 *
 * Amit még véd:
 *  - a leírás UGYANABBAN a `[data-scroll-scrub-caption]` burkolóban van, mint
 *    a cím. A görgetés-vezérelt áttűnés és az `aria-hidden` a burkolóra megy
 *    (scroll-scrub.tsx), tehát külön dobozban a leírás a címtől függetlenül
 *    jelenne meg, vagy képernyőolvasóval kiszakadva maradna a fában;
 *  - a felirat címe NEM címsor-elem. A vászon a DOM-ban megelőzi a jelenet
 *    H1-ét, így egy h2 a lap első címsora lenne — fordított dokumentum-vázlat;
 *  - a mikroszöveg-szabályok (docs/ui-sztenderdek.md §3.1): nincs töltelék
 *    gondolatjel és nincs felkiáltójel a vevői szövegben.
 */

const BLOKK: BlockFilmHero = {
  blockType: 'filmHero',
  ctas: [
    { felirat: 'Nézd meg a kurzusokat', id: 'c1', ujAblakban: false, url: '/kurzusok' },
    { felirat: 'Nézd meg az SOS-kurzust', id: 'c2', ujAblakban: false, url: '#ingyenes' },
  ],
  lead: 'Teszt-bevezető.',
  tags: [{ id: 't1', label: 'Kéz' }],
  title: 'Teszt-cím',
}

/** A `[data-scroll-scrub-caption]` burkolók nyers HTML-je, sorrendben. */
function feliratBlokkok(markup: string): string[] {
  return [...markup.matchAll(/<div class="scroll-scrub__caption[^"]*"[^>]*>(.*?)<\/div>/gs)].map(
    (talalat) => talalat[1],
  )
}

/** Egy adott osztályú bekezdés szövege a burkolón belül. */
function bekezdes(blokk: string, osztaly: string): string | null {
  const talalat = blokk.match(new RegExp(`<p class="${osztaly}">(.*?)</p>`, 's'))
  return talalat === null ? null : talalat[1]
}

/** Egy FilmHero-specifikus CSS-szabály törzse, az első előfordulásból. */
function cssSzabaly(selector: string, forras = FILM_HERO_CSS): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const talalat = forras.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'))
  expect(talalat, `hiányzó CSS-szabály: ${selector}`).not.toBeNull()
  return talalat?.[1] ?? ''
}

function sha256(ut: string): string {
  return createHash('sha256')
    .update(readFileSync(join(REPO, ut)))
    .digest('hex')
}

function kezdoMediaStilus(
  szelesseg: number,
  magassag: number,
  hover: 'hover' | 'none',
  pointer: 'coarse' | 'fine',
): { readonly fit: string | null; readonly opacity: string | null } {
  const lap = stilusLapNezetablakra([SCROLL_SCRUB_CSS_PATH, FILM_HERO_CSS_PATH], szelesseg, {
    hover,
    magassagPx: magassag,
    pointer,
  })
  const hero: Elem = { elemnev: '', osztaly: '.kc-film-hero', ostagOsztaly: null, szulo: null }
  const poster: Elem = {
    elemnev: '',
    osztaly: '.scroll-scrub__poster',
    ostagOsztaly: '.kc-film-hero',
    szulo: hero,
  }
  return {
    fit: sajatErtek(lap, poster, 'object-fit'),
    opacity: sajatErtek(lap, hero, '--kc-film-media-opacity'),
  }
}

const markup = renderToStaticMarkup(<FilmHero block={BLOKK} />)
const blokkok = feliratBlokkok(markup)

describe('filmsáv-feliratok', () => {
  it('mindkét állás megjelenik', () => {
    expect(blokkok).toHaveLength(2)
    expect(markup).toContain('scroll-scrub__caption--right')
    expect(markup).toContain('scroll-scrub__caption--center')
  })

  it('minden álláson van cím ÉS alatta leírás, ugyanabban a burkolóban', () => {
    for (const blokk of blokkok) {
      const cim = bekezdes(blokk, 'scroll-scrub__caption-title')
      const leiras = bekezdes(blokk, 'scroll-scrub__caption-body')
      expect(cim, 'a felirat címe hiányzik').toBeTruthy()
      expect(leiras, 'a felirat leírása hiányzik — a tulajdonos ezt kérte').toBeTruthy()
      expect((cim ?? '').trim().length).toBeGreaterThan(0)
      // Két rövid mondatnál hosszabb leírást a néző görgetés közben nem olvas el.
      expect((leiras ?? '').trim().length).toBeGreaterThan(20)
      expect((leiras ?? '').trim().length).toBeLessThanOrEqual(160)
      // A leírás a cím UTÁN áll a burkolón belül.
      expect(blokk.indexOf('scroll-scrub__caption-body')).toBeGreaterThan(
        blokk.indexOf('scroll-scrub__caption-title'),
      )
    }
  })

  it('a felirat címe nem címsor-elem (a H1 a DOM-ban KÉSŐBB jön)', () => {
    for (const blokk of blokkok) {
      expect(blokk).not.toMatch(/<h[1-6][\s>]/)
    }
  })

  it('a feliratok szövege betartja a magyar mikroszöveg-szabályokat', () => {
    for (const blokk of blokkok) {
      const szoveg = blokk.replace(/<[^>]*>/g, ' ')
      expect(szoveg, 'töltelék gondolatjel nem lehet vevői szövegben').not.toMatch(/[–—]/)
      expect(szoveg, 'felkiáltójel nem lehet vevői szövegben').not.toContain('!')
    }
  })
})

describe('filmsáv egykezes média-szerződése', () => {
  it('kizárólag a verziózott egykezes klipeket és WebP-posztereket köti be', () => {
    const utak = [
      '/media/film/one-hand-header-v1.mp4',
      '/media/film/one-hand-header-v1-mobile.mp4',
      '/media/film/one-hand-header-v1-poster.webp',
      '/media/film/one-hand-header-v1-mobile-poster.webp',
    ]

    for (const ut of utak) {
      expect(FILM_HERO_SOURCE).toContain(ut)
    }
    expect(markup).toContain('/media/film/one-hand-header-v1-poster.webp')
    expect(markup).toContain('/media/film/one-hand-header-v1-mobile-poster.webp')
    expect(FILM_HERO_SOURCE).not.toContain('/media/film/scene-02')
  })

  it('az auditált videók és poszterek bitre változatlanok', () => {
    expect(sha256('public/media/film/one-hand-header-v1.mp4')).toBe(
      '6802e75d25bc7c296b3307202ea6c601a037ed04055f2d5a4ac12ffbfb30907e',
    )
    expect(sha256('public/media/film/one-hand-header-v1-mobile.mp4')).toBe(
      'f3fa26f3291e2ffe3ef983998fe8d965b938fa0f769de11a33ec86ace17da432',
    )
    expect(sha256('public/media/film/one-hand-header-v1-poster.webp')).toBe(
      '8d6c0a8afecdbc1c184dacb509ce86fea653b5dbdc5ead71e0a81bac8752fe13',
    )
    expect(sha256('public/media/film/one-hand-header-v1-mobile-poster.webp')).toBe(
      '1f62a90d0df74978562caf74090537a0f57b6ec030fb0e23200dc701e98599d8',
    )
  })

  it('a hűvös gradiens az auditált sRGB interpolációt használja', () => {
    expect(FILM_HERO_CSS).toContain('152deg in srgb')
  })

  it('a mobil assetet SSR-ben és runtime is kizárólag 860px-ig választja', () => {
    expect(markup).toContain('media="(max-width: 860px)"')
    expect(markup).not.toContain('(pointer: coarse)')
    expect(SCROLL_SCRUB_SOURCE).toContain('const isMobile = () => smallViewport.matches')
    expect(SCROLL_SCRUB_SOURCE).not.toContain('coarsePointer || smallViewport.matches')
    expect(SCROLL_SCRUB_SOURCE).toContain(
      'const usesMobileVideoTuning = () => coarsePointer || isMobile()',
    )
    expect(SCROLL_SCRUB_SOURCE).toContain('if (!video || !usesMobileVideoTuning())')
    expect(SCROLL_SCRUB_SOURCE).toContain('const epsilon = usesMobileVideoTuning() ? 0.02 : 0.008')
    expect(scrollScrubMediaFit(false, true, true)).toBe('cover')
  })

  it('a klipek a deploy-méretkereten belül maradnak', () => {
    const desktop = statSync(join(REPO, 'public/media/film/one-hand-header-v1.mp4')).size
    const mobile = statSync(join(REPO, 'public/media/film/one-hand-header-v1-mobile.mp4')).size

    expect(desktop).toBeLessThanOrEqual(5 * 1024 * 1024)
    expect(mobile).toBeLessThanOrEqual(2.5 * 1024 * 1024)
  })

  it('a sütött mobil kompozíciót középen tartja, további vágási eltolás nélkül', () => {
    expect(markup).toContain('--ss-object-position:50% 50%')
    expect(markup).toContain('--ss-mobile-position:50% 50%')
  })

  it('desktopon 0,48-as papír-hátterű média, mobilon egyszeres sütött média látszik', () => {
    expect(cssSzabaly('.kc-film-hero')).toContain('--kc-film-media-opacity: 0.48')
    expect(cssSzabaly('.kc-film-hero .scroll-scrub__media')).toContain(
      'opacity: var(--kc-film-media-opacity)',
    )
    expect(cssSzabaly(".kc-film-hero[data-scroll-scrub-mobile-media='true']")).toContain(
      '--kc-film-media-opacity: 1',
    )

    const mobilFeltetel = '@media (max-width: 860px)'
    expect(FILM_HERO_CSS).toContain(mobilFeltetel)
    const mobil = FILM_HERO_CSS.slice(FILM_HERO_CSS.indexOf(mobilFeltetel))
    expect(cssSzabaly('.kc-film-hero', mobil)).toContain('--kc-film-media-opacity: 1')
  })

  it('tableten és fekvő mobilon a teljes vágatot, keskeny portrén a cover képet tartja', () => {
    expect(scrollScrubMediaFit(true, false, false)).toBe('cover')
    expect(scrollScrubMediaFit(true, false, true)).toBe('contain')
    expect(scrollScrubMediaFit(true, true, false)).toBe('contain')
    expect(scrollScrubMediaFit(true, true, true)).toBe('contain')
    expect(scrollScrubMediaFit(false, true, true)).toBe('cover')

    expect(SCROLL_SCRUB_SOURCE).toContain('root.dataset.scrollScrubMobileMedia =')
    expect(SCROLL_SCRUB_SOURCE).toContain('root.dataset.scrollScrubMediaFit =')
    expect(SCROLL_SCRUB_SOURCE).toContain("window.matchMedia('(min-width: 640px)')")
    expect(SCROLL_SCRUB_SOURCE).toContain("window.matchMedia('(orientation: landscape)')")
    expect(SCROLL_SCRUB_SOURCE).toContain('atLeastTabletWidth.matches')
    expect(SCROLL_SCRUB_SOURCE).toContain('landscapeViewport.matches')
    expect(SCROLL_SCRUB_SOURCE).not.toContain(
      'scrollScrubMediaFit(isMobile(), window.innerWidth, window.innerHeight)',
    )
    expect(SCROLL_SCRUB_SOURCE).toContain('delete root.dataset.scrollScrubMediaFit')
    expect(SCROLL_SCRUB_SOURCE).toContain('delete root.dataset.scrollScrubMobileMedia')

    expect(scrollScrubNeedsLayout(true, 568, 568, 'cover', 'contain')).toBe(true)
    expect(scrollScrubNeedsLayout(true, 568, 568, 'contain', 'cover')).toBe(true)
    expect(scrollScrubNeedsLayout(true, 568, 568, 'cover', 'cover')).toBe(false)
    expect(scrollScrubNeedsLayout(true, 568, 640, 'cover', 'contain')).toBe(true)
    expect(scrollScrubNeedsLayout(false, 1440, 1440, 'cover', 'cover')).toBe(true)
    expect(SCROLL_SCRUB_SOURCE).toContain('scrollScrubNeedsLayout(')

    const containFeltetel = '@media (min-width: 640px) and (max-width: 860px)'
    expect(FILM_HERO_CSS).toContain(containFeltetel)

    const contain = FILM_HERO_CSS.slice(FILM_HERO_CSS.indexOf(containFeltetel))
    expect(contain).toMatch(
      /\.kc-film-hero \.scroll-scrub__poster,\s*\.kc-film-hero \.scroll-scrub__video\s*\{[^}]*object-fit: contain;[^}]*object-position: var\(--ss-mobile-position\);/s,
    )
  })

  it('az első festés és a runtime ugyanazt a mobil opacity/fit állapotot használja', () => {
    expect(markup).toContain('media="(max-width: 860px)"')
    expect(kezdoMediaStilus(390, 844, 'none', 'coarse')).toEqual({ fit: 'cover', opacity: '1' })
    expect(kezdoMediaStilus(568, 320, 'hover', 'fine')).toEqual({ fit: 'contain', opacity: '1' })
    expect(kezdoMediaStilus(639.5, 320, 'hover', 'fine')).toEqual({ fit: 'contain', opacity: '1' })
    expect(kezdoMediaStilus(639.5, 844, 'hover', 'fine')).toEqual({ fit: 'cover', opacity: '1' })
    expect(kezdoMediaStilus(768, 1024, 'hover', 'fine')).toEqual({ fit: 'contain', opacity: '1' })
    expect(kezdoMediaStilus(1024, 768, 'none', 'coarse')).toEqual({ fit: 'cover', opacity: '0.48' })
    expect(kezdoMediaStilus(1024, 768, 'hover', 'fine')).toEqual({ fit: 'cover', opacity: '0.48' })
  })

  it('a halk másodlagos CTA hover-felirata nem válik fehérré a világos tinten', () => {
    const hover = cssSzabaly(
      '.kc-film-hero .kc-film-hero__cta--quiet:hover:not(:disabled):not(.kc-button--disabled)',
    )
    expect(hover).toContain('background-color: var(--kc-color-tint-cool)')
    expect(hover).toContain('color: var(--kc-color-ink)')
  })

  it('a latens fejezet-gomb aktív jele és fókusza is ink marad a filmen', () => {
    const focus = cssSzabaly('.scroll-scrub__route-button:focus-visible', SCROLL_SCRUB_CSS)
    expect(SCROLL_SCRUB_CSS).toMatch(
      /\.scroll-scrub__route-button\[aria-current='step'\]\s*\{[^}]*text-decoration-color:\s*var\(--ss-ink\)/,
    )
    expect(focus).toContain('outline: 3px solid var(--ss-ink)')
  })

  it('a média a scrim alatt, a hero-szöveg és a vászonfeliratok fölötte maradnak', () => {
    expect(cssSzabaly('.kc-film-hero .scroll-scrub__stage')).toContain('z-index: 0')
    expect(cssSzabaly('.kc-film-hero .scroll-scrub__media')).toContain('z-index: 0')
    expect(cssSzabaly('.kc-film-hero .scroll-scrub__stage::after')).toContain('z-index: 4')
    expect(cssSzabaly('.kc-film-hero .scroll-scrub__captions')).toContain('z-index: 5')
    expect(cssSzabaly('.kc-film-hero .scroll-scrub__story')).toContain('z-index: 3')
  })

  it('a szöveg mögé nem tesz kártyát vagy elmosást', () => {
    expect(cssSzabaly('.scroll-scrub__copy', SCROLL_SCRUB_CSS)).not.toMatch(/background/)
    expect(cssSzabaly('.scroll-scrub__caption', SCROLL_SCRUB_CSS)).not.toMatch(/background/)
    expect(FILM_HERO_CSS).not.toMatch(/(?:backdrop-filter|filter)\s*:/)
  })

  it('a csökkentett mozgás továbbra sem tölti le a videót, és egy álló szakaszra vált', () => {
    expect(SCROLL_SCRUB_SOURCE).toContain(
      "window.matchMedia('(prefers-reduced-motion: reduce)').matches",
    )
    expect(SCROLL_SCRUB_SOURCE).toMatch(/if \(\s*reduceMotion \|\|[\s\S]*?\) \{\s*return/)

    const reduced = SCROLL_SCRUB_CSS.slice(
      SCROLL_SCRUB_CSS.indexOf('@media (prefers-reduced-motion: reduce)'),
    )
    expect(reduced).toContain('min-height: 100dvh !important')
    expect(reduced).toContain('display: none')
  })

  it('az M1 továbbra is legfeljebb 1+1 CTA-t renderel', () => {
    const haromCta: BlockFilmHero = {
      ...BLOKK,
      ctas: [
        ...(BLOKK.ctas ?? []),
        { felirat: 'Harmadik CTA', id: 'c3', ujAblakban: false, url: '/harmadik' },
      ],
    }
    const html = renderToStaticMarkup(<FilmHero block={haromCta} />)

    expect(html.match(/<a [^>]*class="[^"]*kc-film-hero__cta[^"]*"/g)).toHaveLength(2)
    expect(html.match(/href=/g)).toHaveLength(2)
    expect(html).not.toContain('/harmadik')
  })
})
