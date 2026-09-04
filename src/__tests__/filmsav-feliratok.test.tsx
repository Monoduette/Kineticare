import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { FilmHero } from '@/components/blocks/FilmHero'
import { scrollScrubMediaFit, scrollScrubNeedsLayout } from '@/components/scroll-scrub/scroll-scrub'
import type { BlockFilmHero } from '@/payload-types'

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const FILM_HERO_SOURCE = readFileSync(join(REPO, 'src/components/blocks/FilmHero.tsx'), 'utf8')
const FILM_HERO_CSS = readFileSync(
  join(REPO, 'src/app/(frontend)/styles/blocks/film-hero.css'),
  'utf8',
)
const SCROLL_SCRUB_SOURCE = readFileSync(
  join(REPO, 'src/components/scroll-scrub/scroll-scrub.tsx'),
  'utf8',
)
const SCROLL_SCRUB_CSS = readFileSync(
  join(REPO, 'src/components/scroll-scrub/scroll-scrub.css'),
  'utf8',
)

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
    expect(scrollScrubMediaFit(true, 390, 844)).toBe('cover')
    expect(scrollScrubMediaFit(true, 430, 932)).toBe('cover')
    expect(scrollScrubMediaFit(true, 568, 320)).toBe('contain')
    expect(scrollScrubMediaFit(true, 768, 1024)).toBe('contain')
    expect(scrollScrubMediaFit(true, 860, 900)).toBe('contain')
    expect(scrollScrubMediaFit(true, 1024, 768)).toBe('contain')
    expect(scrollScrubMediaFit(false, 1440, 900)).toBe('cover')

    expect(SCROLL_SCRUB_SOURCE).toContain('root.dataset.scrollScrubMobileMedia =')
    expect(SCROLL_SCRUB_SOURCE).toContain('root.dataset.scrollScrubMediaFit =')
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
    expect(FILM_HERO_CSS).not.toContain('min-aspect-ratio')
    expect(FILM_HERO_CSS).not.toContain('orientation: landscape')
    expect(FILM_HERO_CSS).not.toMatch(/\((?:hover|pointer)\s*:/)

    const contain = FILM_HERO_CSS.slice(FILM_HERO_CSS.indexOf(containFeltetel))
    expect(contain).toMatch(
      /\.kc-film-hero \.scroll-scrub__poster,\s*\.kc-film-hero \.scroll-scrub__video\s*\{[^}]*object-fit: contain;[^}]*object-position: var\(--ss-mobile-position\);/s,
    )
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
