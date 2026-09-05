import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { FilmHero } from '@/components/blocks/FilmHero'
import { scrollScrubUsesMobileMedia } from '@/components/scroll-scrub/scroll-scrub'
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
  ctas: [{ felirat: 'Nézd meg a kurzusokat', id: 'c1', ujAblakban: false, url: '/kurzusok' }],
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
  const ujAssetek = [
    'public/media/film/one-hand-header-v1.mp4',
    'public/media/film/one-hand-header-v1-mobile.mp4',
    'public/media/film/one-hand-header-v1-poster.webp',
    'public/media/film/one-hand-header-v1-mobile-poster.webp',
  ] as const

  it('a verziózott egykezes klipeket és a hozzájuk tartozó posztereket köti be', () => {
    for (const ut of ujAssetek) {
      expect(FILM_HERO_SOURCE).toContain(ut.replace('public', ''))
    }
    expect(FILM_HERO_SOURCE).not.toContain('/media/film/scene-02')
  })

  it('az auditált média byte-ra változatlan, a klipek a deploy-kereten belül maradnak', () => {
    expect(sha256(ujAssetek[0])).toBe(
      '6802e75d25bc7c296b3307202ea6c601a037ed04055f2d5a4ac12ffbfb30907e',
    )
    expect(sha256(ujAssetek[1])).toBe(
      'd9b076541937f941585d8d16a2611eb59ebd2d407d4dd07ce52de1c0677fc417',
    )
    expect(sha256(ujAssetek[2])).toBe(
      '8d6c0a8afecdbc1c184dacb509ce86fea653b5dbdc5ead71e0a81bac8752fe13',
    )
    expect(sha256(ujAssetek[3])).toBe(
      '8252b884c2252ff19cdb9b05455c67934af91869c742a489c988a159c240ef0d',
    )
    expect(statSync(join(REPO, ujAssetek[0])).size).toBeLessThanOrEqual(5 * 1024 * 1024)
    expect(statSync(join(REPO, ujAssetek[1])).size).toBeLessThanOrEqual(2.5 * 1024 * 1024)
  })

  it('a korábbi filmassetek megmaradnak az azonnali rollbackhez', () => {
    for (const nev of [
      'scene-02.mp4',
      'scene-02-mobile.mp4',
      'scene-02-poster.png',
      'scene-02-mobile-poster.png',
    ]) {
      expect(statSync(join(REPO, 'public/media/film', nev)).size).toBeGreaterThan(0)
    }
  })

  it('a portré art direction csak keskeny álló nézetben töltődik', () => {
    expect(markup).toContain('media="(max-width: 860px) and (orientation: portrait)"')
    expect(SCROLL_SCRUB_SOURCE).toContain(
      'const usesMobileVideoTuning = () => coarsePointer || smallViewport.matches',
    )
    expect(scrollScrubUsesMobileMedia(390, 844)).toBe(true)
    expect(scrollScrubUsesMobileMedia(430, 932)).toBe(true)
    expect(scrollScrubUsesMobileMedia(768, 1024)).toBe(true)
    expect(scrollScrubUsesMobileMedia(860, 900)).toBe(true)
    expect(scrollScrubUsesMobileMedia(568, 320)).toBe(false)
    expect(scrollScrubUsesMobileMedia(1024, 768)).toBe(false)
    expect(FILM_HERO_CSS).not.toContain('object-fit: contain')
    expect(FILM_HERO_CSS).not.toContain('orientation: landscape')
  })

  it('az 52%-os papírfátyol scrolltól függetlenül a média és minden szöveg között marad', () => {
    const fatyol = cssSzabaly('.kc-film-hero .scroll-scrub__stage::before')
    expect(fatyol).toContain('z-index: 2')
    expect(fatyol).toContain('var(--kc-color-bg) 52%')
    expect(fatyol).not.toMatch(/--ss-(?:progress|copy-scrim)|opacity|animation|transition/)
    expect(cssSzabaly('.kc-film-hero .scroll-scrub__stage::after')).toContain('z-index: 4')
    expect(cssSzabaly('.scroll-scrub__media', SCROLL_SCRUB_CSS)).toContain('z-index: 0')
    expect(cssSzabaly('.scroll-scrub__captions', SCROLL_SCRUB_CSS)).toContain('z-index: 5')
    expect(cssSzabaly('.scroll-scrub__story', SCROLL_SCRUB_CSS)).toContain('z-index: 3')
  })

  it('nem tesz kártyát vagy teljes vásznas blur-effektet a szöveg mögé', () => {
    expect(cssSzabaly('.scroll-scrub__copy', SCROLL_SCRUB_CSS)).not.toMatch(/background/)
    expect(cssSzabaly('.scroll-scrub__caption', SCROLL_SCRUB_CSS)).not.toMatch(/background/)
    expect(FILM_HERO_CSS).not.toMatch(/(?:backdrop-filter|filter)\s*:/)
  })

  it('a csökkentett mozgás továbbra is álló poszterre vált', () => {
    expect(SCROLL_SCRUB_SOURCE).toContain(
      "window.matchMedia('(prefers-reduced-motion: reduce)').matches",
    )
    const reduced = SCROLL_SCRUB_CSS.slice(
      SCROLL_SCRUB_CSS.indexOf('@media (prefers-reduced-motion: reduce)'),
    )
    expect(reduced).toContain('min-height: 100dvh !important')
    expect(reduced).toContain('display: none')
  })

  it('az M1 továbbra is legfeljebb egy elsődleges és egy halk CTA-t renderel', () => {
    const html = renderToStaticMarkup(
      <FilmHero
        block={{
          ...BLOKK,
          ctas: [
            ...(BLOKK.ctas ?? []),
            { felirat: 'Második CTA', id: 'c2', ujAblakban: false, url: '/masodik' },
            { felirat: 'Harmadik CTA', id: 'c3', ujAblakban: false, url: '/harmadik' },
          ],
        }}
      />,
    )
    expect(html.match(/class="[^"]*kc-film-hero__cta[^"]*"/g)).toHaveLength(2)
    expect(html).not.toContain('/harmadik')
  })
})
