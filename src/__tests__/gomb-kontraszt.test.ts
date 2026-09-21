import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * GOMB- ÉS FÓKUSZ-KONTRASZT ŐR (G-K1…G-K6) — a WCAG 2.2 AA gépi párja.
 * A repóban a kontraszt-protokoll eddig KOMMENTEKBEN élt (tokens.css, ui.css,
 * layout.css, progress.css, player.css fejléce). A 2026-08-16-i audit
 * (docs/gomb-kontraszt-audit.md) három olyan hibát talált, amit SEMMILYEN
 * komment nem tudott megakadályozni:
 */

const SRC = fileURLToPath(new URL('..', import.meta.url))
const FRONTEND = join(SRC, 'app', '(frontend)')
const COMPONENTS = join(SRC, 'components')
const TOKENS_CSS = join(FRONTEND, 'styles', 'tokens.css')

// ───────────────────────────────────────────────────────────────────────────
// 1. KONTRASZT-MOTOR — tiszta függvények, a WCAG 2.2 normatív definíciója
//    https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
//    https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
// ───────────────────────────────────────────────────────────────────────────

export type RGB = readonly [number, number, number]

const csatorna = (c: number): number => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export const luminancia = ([r, g, b]: RGB): number =>
  0.2126 * csatorna(r) + 0.7152 * csatorna(g) + 0.0722 * csatorna(b)

/** Kontraszt-arány két tömör színre. */
export const arany = (a: RGB, b: RGB): number => {
  const la = luminancia(a)
  const lb = luminancia(b)
  const [vilagos, sotet] = la >= lb ? [la, lb] : [lb, la]
  return (vilagos + 0.05) / (sotet + 0.05)
}

/**
 * sRGB alfa-kompozit — az `opacity` és a `color-mix(in srgb, …)` feloldásához,
 * pontosan úgy, ahogy a böngésző rajzol: az `elo` szín `alfa` arányban a
 * `hatter` fölött.
 */
export const keverek = (elo: RGB, hatter: RGB, alfa: number): RGB => [
  Math.round(elo[0] * alfa + hatter[0] * (1 - alfa)),
  Math.round(elo[1] * alfa + hatter[1] * (1 - alfa)),
  Math.round(elo[2] * alfa + hatter[2] * (1 - alfa)),
]

/** `#rgb` / `#rrggbb` → RGB. */
export const hexRgb = (hex: string): RGB => {
  const jel = hex.trim().replace('#', '')
  const teljes =
    jel.length === 3
      ? jel
          .split('')
          .map((c) => c + c)
          .join('')
      : jel
  return [
    Number.parseInt(teljes.slice(0, 2), 16),
    Number.parseInt(teljes.slice(2, 4), 16),
    Number.parseInt(teljes.slice(4, 6), 16),
  ]
}

/** Két tizedesre kerekített arány (a jegyzőkönyvek formátuma). */
const ker2 = (x: number): number => Math.round(x * 100) / 100

// ───────────────────────────────────────────────────────────────────────────
// 2. FÁJL- ÉS CSS-BEJÁRÓ
// ───────────────────────────────────────────────────────────────────────────

function fajlok(gyoker: string, kiterjesztesek: readonly string[]): string[] {
  const ki: string[] = []
  const bejar = (dir: string): void => {
    for (const nev of readdirSync(dir)) {
      if (nev === 'node_modules' || nev.startsWith('.')) {
        continue
      }
      const teljes = join(dir, nev)
      if (statSync(teljes).isDirectory()) {
        bejar(teljes)
      } else if (kiterjesztesek.some((k) => nev.endsWith(k))) {
        ki.push(teljes)
      }
    }
  }
  bejar(gyoker)
  return ki.sort()
}

const CSS_FAJLOK = [...fajlok(FRONTEND, ['.css']), ...fajlok(COMPONENTS, ['.css'])]
const TSX_FAJLOK = [...fajlok(FRONTEND, ['.tsx']), ...fajlok(COMPONENTS, ['.tsx', '.ts'])]

const utvonal = (f: string): string => relative(SRC, f).replace(/\\/g, '/')

interface Szabaly {
  szelektor: string
  torzs: string
  fajl: string
}

/**
 * Egyszerű CSS-szabály-kigyűjtő: kommentek nélkül, `@media`/`@supports`/`@layer`
 * blokkokba lépve, `@keyframes` és `@font-face` kihagyásával (azok „szelektorai"
 * nem elemek, és a bennük lévő `opacity` animáció, nem állapotjelölés).
 */
function szabalyok(css: string, fajl: string): Szabaly[] {
  const tiszta = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const ki: Szabaly[] = []
  const bejar = (kezdet: number, veg: number): void => {
    let elozoVeg = kezdet
    let i = kezdet
    while (i < veg) {
      if (tiszta[i] !== '{') {
        i += 1
        continue
      }
      const prelude = tiszta.slice(elozoVeg, i).trim()
      let melyseg = 1
      let j = i + 1
      while (j < veg && melyseg > 0) {
        if (tiszta[j] === '{') melyseg += 1
        else if (tiszta[j] === '}') melyseg -= 1
        j += 1
      }
      const torzs = tiszta.slice(i + 1, j - 1)
      if (prelude.startsWith('@')) {
        if (/^@(media|supports|layer|container)/.test(prelude)) {
          bejar(i + 1, j - 1)
        }
      } else if (prelude.length > 0) {
        ki.push({ szelektor: prelude.replace(/\s+/g, ' '), torzs, fajl })
      }
      i = j
      elozoVeg = j
    }
  }
  bejar(0, tiszta.length)
  return ki
}

const MINDEN_SZABALY: Szabaly[] = CSS_FAJLOK.flatMap((f) =>
  szabalyok(readFileSync(f, 'utf8'), utvonal(f)),
)

// ───────────────────────────────────────────────────────────────────────────
// 3. TOKEN-TÁBLA — a tokens.css-ből, alias-feloldással
// ───────────────────────────────────────────────────────────────────────────

const TOKENS_FORRAS = readFileSync(TOKENS_CSS, 'utf8')

function nyersTokenek(css: string): Map<string, string> {
  const tiszta = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const map = new Map<string, string>()
  for (const egyezes of tiszta.matchAll(/(--kc-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    map.set(egyezes[1], egyezes[2].trim())
  }
  return map
}

const NYERS = nyersTokenek(TOKENS_FORRAS)

/** Egy szín-token feloldása hexára (a `var(--x)` aliasokat követve). */
function szinToken(nev: string, mélység = 0): RGB {
  const ertek = NYERS.get(nev)
  if (ertek === undefined || mélység > 8) {
    throw new Error(`Ismeretlen vagy körkörös szín-token: ${nev}`)
  }
  const alias = /^var\(\s*(--kc-[a-z0-9-]+)\s*\)$/.exec(ertek)
  if (alias !== null) {
    return szinToken(alias[1], mélység + 1)
  }
  const hex = /^#[0-9a-fA-F]{3,8}$/.exec(ertek.trim())
  if (hex === null) {
    throw new Error(`A(z) ${nev} token értéke nem hexa szín: ${ertek}`)
  }
  return hexRgb(hex[0])
}

const SZIN = (nev: string): RGB => szinToken(`--kc-color-${nev}`)

// ───────────────────────────────────────────────────────────────────────────
// 4. A MÉRT KOMPOZITOK — a repó saját, filmkockákból vett értékeiből
// ───────────────────────────────────────────────────────────────────────────

/**
 * A fejlécsávban a legsötétebb filmblokk (layout.css kontraszt-levezetés:
 * `rgb(34,49,62)`), amire a film-hero felső világosító lejtője legalább 0,50
 * lap-háttér-fedést tesz. Erre jön a fejléc saját fátyla: nem szolid paper,
 * hanem legfeljebb 72% lap-fedés (fagyott üveg). A `layout.css` ::before
 * `color-mix(... * 72%)` plafonjával kell egyeznie.
 */
const FILM_FEJLEC_NYERS: RGB = [34, 49, 62]
const FEJLEC_FAGY_FEDES = 0.72
const FILM_FEJLEC_ALAP: RGB = keverek(SZIN('paper'), FILM_FEJLEC_NYERS, 0.5)
const filmFejlec = (veil: number): RGB =>
  keverek(SZIN('paper'), FILM_FEJLEC_ALAP, veil * FEJLEC_FAGY_FEDES)

/**
 * A hero-szövegdoboz alatti legsötétebb filmblokk (film-hero.css levezetése:
 * `rgb(1,0,0)`), a bal lejtő 0,64-es lap-háttér-fedésével.
 */
const FILM_HERO: RGB = keverek(SZIN('paper'), [1, 0, 0], 0.64)

/** A fejléc fókuszgyűrűjének futásidejű színe: color-mix(focus veil%, ink). */
const fejlecGyuru = (veil: number): RGB => keverek(SZIN('focus'), SZIN('ink'), veil)

/**
 * Az új logó (WP49) wordmark-sötétkékje: a `public/assets/brand/*.svg`
 * fájlokban rögzített szín, NEM token (a tokeneket a logó miatt nem írjuk át).
 * A `--kc-color-ink` (#10243e) párja, csatornánként legfeljebb 1 egységnyi
 * eltéréssel — lásd src/lib/brand-logo.ts.
 */
const LOGO_INK: RGB = hexRgb('#11233d')

// ───────────────────────────────────────────────────────────────────────────
// 5. A PÁR-MÁTRIX — az audit 4.1–4.10 tábláinak gépi párja
// ───────────────────────────────────────────────────────────────────────────

type SC = '1.4.3' | '1.4.11'

interface Par {
  elem: string
  allapot: string
  elo: RGB
  hatter: RGB
  kuszob: 4.5 | 3
  sc: SC
}

const p = (elem: string, allapot: string, elo: RGB, hatter: RGB, kuszob: 4.5 | 3, sc: SC): Par => ({
  elem,
  allapot,
  elo,
  hatter,
  kuszob,
  sc,
})

const PAROK: readonly Par[] = [
  // --- kc-button, a három alapváltozat ---
  p('kc-button--primary', 'alap', SZIN('on-primary'), SZIN('primary'), 4.5, '1.4.3'),
  p('kc-button--primary', 'hover', SZIN('on-primary'), SZIN('primary-hover'), 4.5, '1.4.3'),
  p('kc-button--primary', 'kitöltés / paper', SZIN('primary'), SZIN('bg'), 3, '1.4.11'),
  p('kc-button--primary', 'kitöltés / fehér', SZIN('primary'), SZIN('surface-raised'), 3, '1.4.11'),
  p('kc-button--primary', 'kitöltés / tint', SZIN('primary'), SZIN('surface-tint'), 3, '1.4.11'),
  p('kc-button--secondary', 'alap', SZIN('text'), SZIN('bg'), 4.5, '1.4.3'),
  p('kc-button--secondary', 'hover (invertál)', SZIN('on-dark'), SZIN('text'), 4.5, '1.4.3'),
  p('kc-button--secondary', 'sötét sáv', SZIN('on-dark'), SZIN('surface-dark'), 4.5, '1.4.3'),
  p('kc-button--ghost', 'alap', SZIN('primary'), SZIN('bg'), 4.5, '1.4.3'),
  p('kc-button--ghost', 'alap / tint', SZIN('primary'), SZIN('surface-tint'), 4.5, '1.4.3'),
  p(
    'kc-button--ghost',
    'sötét sáv hover',
    SZIN('on-dark-muted'),
    SZIN('surface-dark'),
    4.5,
    '1.4.3',
  ),

  // --- B8: a letiltott gomb ÚJ, szándékos token-párja (nem opacity) ---
  p('kc-button:disabled', 'felirat / kitöltés', SZIN('text-muted'), SZIN('border'), 4.5, '1.4.3'),
  p('kc-button:disabled', 'keret / paper', SZIN('border-strong'), SZIN('bg'), 3, '1.4.11'),
  p(
    'kc-button:disabled',
    'keret / fehér',
    SZIN('border-strong'),
    SZIN('surface-raised'),
    3,
    '1.4.11',
  ),
  p('kc-button:disabled', 'keret / tint', SZIN('border-strong'), SZIN('surface-tint'), 3, '1.4.11'),
  p(
    'kc-button:disabled',
    'keret / saját kitöltés',
    SZIN('border-strong'),
    SZIN('border'),
    3,
    '1.4.11',
  ),
  p(
    'kc-button:disabled',
    'sötét sáv felirat',
    SZIN('on-dark-muted'),
    SZIN('surface-dark'),
    4.5,
    '1.4.3',
  ),
  p(
    'kc-button:disabled',
    'sötét sáv keret',
    SZIN('on-dark-muted'),
    SZIN('surface-dark'),
    3,
    '1.4.11',
  ),
  p(
    'kc-free-sos .kc-button:disabled',
    'felirat/keret a sávon',
    SZIN('on-primary'),
    SZIN('primary'),
    4.5,
    '1.4.3',
  ),

  // --- WP25/WP51: a szolgáltatás-sín ajtó-ikonjai (Lucide, currentColor vonal) ---
  // Az ikon a kör állapotszínét örökli: inaktívan help-chrome a FEHÉR körön
  // (a marker háttere --kc-services-fade = white), hoverre help-ink a fehéren,
  // aktívan on-dark a help-ink (surface-dark alias) körön. Nem-szöveges
  // grafika → SC 1.4.11 (3:1); az aktív fehér az inken a kiírás szerint a
  // 4,5:1-es szöveg-küszöböt is hozza (14,32:1).
  p(
    'kc-services-sin__marker svg',
    'inaktív: chrome a fehér körön',
    SZIN('help-chrome'),
    SZIN('white'),
    3,
    '1.4.11',
  ),
  p(
    'kc-services-sin__marker svg',
    'hover: ink a fehér körön',
    SZIN('help-ink'),
    SZIN('white'),
    3,
    '1.4.11',
  ),
  p(
    'kc-services-sin__marker svg',
    'aktív: fehér a help-ink körön',
    SZIN('on-dark'),
    SZIN('help-ink'),
    4.5,
    '1.4.11',
  ),
  p(
    'kc-services-sin__marker',
    'inaktív gyűrű a help-paperen',
    SZIN('help-chrome'),
    SZIN('help-paper'),
    3,
    '1.4.11',
  ),
  p(
    'kc-services-sin__marker',
    'inaktív gyűrű a help-panelen',
    SZIN('help-chrome'),
    SZIN('help-panel'),
    3,
    '1.4.11',
  ),

  // --- AUDIT-D: a lejátszó hibapaneljének mentőgombjai a sötét videó-felületen ---
  // A javítás előtt a felirat ÉS a 2 px-es keret is ink volt az ink felületen
  // (1,00:1): videóhiba esetén a fizető vevő nem látta az „Újrapróbálom”, az
  // „Írj nekünk” és a „Belépés” gombot.
  p(
    'kc-player__media-error .kc-button--secondary',
    'felirat a sötét videó-felületen',
    SZIN('on-dark'),
    SZIN('surface-dark'),
    4.5,
    '1.4.3',
  ),
  p(
    'kc-player__media-error .kc-button--secondary',
    'keret a sötét videó-felületen',
    SZIN('on-dark'),
    SZIN('surface-dark'),
    3,
    '1.4.11',
  ),
  p(
    'kc-player__media-error .kc-button--secondary:hover',
    'felirat a fehérre telt gombon',
    SZIN('surface-dark'),
    SZIN('on-dark'),
    4.5,
    '1.4.3',
  ),

  // --- B1: a fejléc fókuszgyűrűje a filmsávon, a fátyol minden állásában ---
  p('kc-site-header :focus-visible', 'veil 0,00', fejlecGyuru(0), filmFejlec(0), 3, '1.4.11'),
  p('kc-site-header :focus-visible', 'veil 0,25', fejlecGyuru(0.25), filmFejlec(0.25), 3, '1.4.11'),
  p('kc-site-header :focus-visible', 'veil 0,50', fejlecGyuru(0.5), filmFejlec(0.5), 3, '1.4.11'),
  p('kc-site-header :focus-visible', 'veil 0,75', fejlecGyuru(0.75), filmFejlec(0.75), 3, '1.4.11'),
  p('kc-site-header :focus-visible', 'veil 1,00', fejlecGyuru(1), filmFejlec(1), 3, '1.4.11'),
  // WP49 (2026-09-19): a szöveges wordmark helyén az új SVG-logó áll
  // (src/lib/brand-logo.ts). A wordmark sötétkékje (#11233d) a logó rögzített
  // színe, nem token; a logotípia az SC 1.4.3/1.4.11 alól kivétel, a párokat
  // mégis mérjük, hogy a fejléc-fátyol változása ne csúszhasson át némán.
  p(
    'kc-site-header__logo',
    'logó-wordmark (#11233d) a filmen (veil 0)',
    LOGO_INK,
    filmFejlec(0),
    4.5,
    '1.4.3',
  ),
  p(
    'kc-site-header__logo',
    'logó-wordmark (#11233d) a fagyott filmen (veil 1)',
    LOGO_INK,
    filmFejlec(1),
    4.5,
    '1.4.3',
  ),
  // WP36 (2026-09-08): a „Kurzusok" pirula a sávból KIKERÜLT (a főmenü sima
  // tétele lett), a kijelentkezés-pirula pedig csak a fehér mobil fiókban él —
  // a keretét a fehér felülethez mérjük (SC 1.4.11).
  p(
    'kc-account-nav__signout',
    'keret a fehér fiókban (drawer)',
    SZIN('border-strong'),
    SZIN('surface-raised'),
    3,
    '1.4.11',
  ),
  p(
    'kc-site-header__logo',
    'logó-wordmark (#11233d) a paperen (belső oldal)',
    LOGO_INK,
    SZIN('paper'),
    4.5,
    '1.4.3',
  ),
  p(
    'kc-site-footer__logo',
    'logó-wordmark (#11233d) a lábléc paperjén',
    LOGO_INK,
    SZIN('paper'),
    4.5,
    '1.4.3',
  ),

  // --- WP27: a fejléc profil-IKONJA a „Belépés” szöveglink helyén (nem
  //     szöveges elem, SC 1.4.11: a 2 px-es vonal a fátyol minden állásán,
  //     belső oldalon és a hover tint-rétegen is ≥ 3:1) ---
  p('kc-account-nav__icon', 'ink a filmen (veil 0)', SZIN('ink'), filmFejlec(0), 3, '1.4.11'),
  p(
    'kc-account-nav__icon',
    'ink a fagyott filmen (veil 1)',
    SZIN('ink'),
    filmFejlec(1),
    3,
    '1.4.11',
  ),
  p('kc-account-nav__icon', 'ink a paperen (belső oldal)', SZIN('ink'), SZIN('paper'), 3, '1.4.11'),
  p(
    'kc-account-nav__link--icon:hover',
    'accent-deeper ikon a tint állapotrétegen',
    SZIN('accent-deeper'),
    SZIN('surface-tint'),
    3,
    '1.4.11',
  ),

  // --- WP36: a fejléc FIÓKMENÜJE (bejelentkezve a profil-ikon menügomb) —
  //     a tételek fehér panelen (SC 1.4.3), hover/fókusz a tint rétegen; a
  //     kitöltött ikon-állapot a vonal színét viszi (SC 1.4.11) ---
  p(
    'kc-account-nav__menu-item',
    'ink a fehér panelen',
    SZIN('ink'),
    SZIN('surface-raised'),
    4.5,
    '1.4.3',
  ),
  p(
    'kc-account-nav__menu-item:hover',
    'accent-deeper felirat a tint állapotrétegen',
    SZIN('accent-deeper'),
    SZIN('surface-tint'),
    4.5,
    '1.4.3',
  ),
  p(
    "kc-account-nav__menu-item[aria-current='page']",
    'accent-deeper felirat + aláhúzás a fehér panelen',
    SZIN('accent-deeper'),
    SZIN('surface-raised'),
    4.5,
    '1.4.3',
  ),
  p(
    'kc-account-nav__menu-button[aria-expanded=true]',
    'accent-deeper ikon a tint állapotrétegen',
    SZIN('accent-deeper'),
    SZIN('surface-tint'),
    3,
    '1.4.11',
  ),
  p(
    'kc-account-nav__icon-fill',
    'kitöltött glif ink a filmen (veil 0)',
    SZIN('ink'),
    filmFejlec(0),
    3,
    '1.4.11',
  ),
  p(
    'kc-account-nav__menu',
    'panel hajszálkerete a fehér paneltől (border) — dekoratív, a szöveg adja a határt',
    SZIN('border-strong'),
    SZIN('surface-raised'),
    3,
    '1.4.11',
  ),

  // --- WP27: a harmonika forgó +/− jele — vonal, nem karakter (SC 1.4.11) ---
  p(
    'kc-accordion__summary::after',
    'halk vonal / paper',
    SZIN('text-muted'),
    SZIN('bg'),
    3,
    '1.4.11',
  ),
  p(
    'kc-accordion__summary::after',
    'halk vonal / tint sáv',
    SZIN('text-muted'),
    SZIN('surface-tint'),
    3,
    '1.4.11',
  ),
  p(
    'kc-accordion__summary::after',
    'halk vonal / sötét sáv',
    SZIN('on-dark-muted'),
    SZIN('surface-dark'),
    3,
    '1.4.11',
  ),

  // --- B7: a film-hero fókuszgyűrűjének MINDKÉT éle ---
  p(
    'kc-film-hero__cta:focus-visible',
    'belső él (fehér haló)',
    SZIN('ink'),
    SZIN('white'),
    3,
    '1.4.11',
  ),
  p('kc-film-hero__cta:focus-visible', 'külső él (film)', SZIN('ink'), FILM_HERO, 3, '1.4.11'),
  p('kc-film-hero__cta--quiet', '2px ink keret a filmen', SZIN('ink'), FILM_HERO, 3, '1.4.11'),

  // --- B2: a süti-sáv ---
  p('kc-consent-banner', 'törzsszöveg', SZIN('on-dark'), SZIN('surface-dark'), 4.5, '1.4.3'),
  p(
    'kc-consent-banner',
    'tájékoztató-link',
    SZIN('on-dark-muted'),
    SZIN('surface-dark'),
    4.5,
    '1.4.3',
  ),
  p('kc-consent-banner', 'fókuszgyűrű', SZIN('focus-on-dark'), SZIN('surface-dark'), 3, '1.4.11'),
  p(
    'kc-consent-banner__button--accept',
    'felirat',
    SZIN('surface-dark'),
    SZIN('on-dark'),
    4.5,
    '1.4.3',
  ),
  p(
    'kc-consent-banner__button--accept',
    'hover felirat',
    SZIN('surface-dark'),
    SZIN('on-dark-muted'),
    4.5,
    '1.4.3',
  ),
  p(
    'kc-consent-banner__button--decline',
    'felirat + keret',
    SZIN('on-dark'),
    SZIN('surface-dark'),
    4.5,
    '1.4.3',
  ),

  // --- B3 / B5 / B6 / B11: linkek (a szín a HÁTTÉRHEZ mérve; a nem-szín
  //     jelölőt — aláhúzás — a G-K3 melletti külön teszt ellenőrzi) ---
  p('kc-contact-form__consent-label a', 'alap', SZIN('text'), SZIN('bg'), 4.5, '1.4.3'),
  p('kc-contact-form__consent-label a', 'hover', SZIN('link-hover'), SZIN('bg'), 4.5, '1.4.3'),
  p('kc-auth-alt a', 'alap', SZIN('primary'), SZIN('bg'), 4.5, '1.4.3'),
  p('kc-account__course', 'alap', SZIN('primary'), SZIN('bg'), 4.5, '1.4.3'),
  p('kc-cart__title', 'alap', SZIN('text'), SZIN('bg'), 4.5, '1.4.3'),

  // --- B9: az info állapotpár ---
  p('kc-cart-notice', 'keret / paper', SZIN('info'), SZIN('bg'), 3, '1.4.11'),
  p('kc-cart-notice', 'ink szöveg a felületén', SZIN('text'), SZIN('info-surface'), 4.5, '1.4.3'),
  p('kc-thankyou--timeout', 'keret / paper', SZIN('info'), SZIN('bg'), 3, '1.4.11'),
  p(
    'kc-thankyou--timeout',
    'ink-soft szöveg',
    SZIN('text-muted'),
    SZIN('info-surface'),
    4.5,
    '1.4.3',
  ),

  // --- B10: a haladás-sáv --sm ---
  p(
    'kc-progress-bar--sm',
    'gyűrű / fehér fejléc',
    SZIN('border-strong'),
    SZIN('surface-raised'),
    3,
    '1.4.11',
  ),
  p('kc-progress-bar--sm', 'kitöltés / sín', SZIN('primary'), SZIN('border'), 3, '1.4.11'),
  p('kc-progress-bar--sm', 'kész / sín', SZIN('success'), SZIN('border'), 3, '1.4.11'),

  // --- egyéb, az auditban ✓-t kapott, de visszacsúszásra hajlamos párok ---
  p('kc-field__input', 'keret / fehér', SZIN('border-strong'), SZIN('surface-raised'), 3, '1.4.11'),
  p('kc-field__input:focus', 'keret / fehér', SZIN('focus'), SZIN('surface-raised'), 3, '1.4.11'),
  p('kc-badge--success', 'felirat', SZIN('success'), SZIN('success-surface'), 4.5, '1.4.3'),
  p('kc-badge--warning', 'felirat', SZIN('warning'), SZIN('warning-surface'), 4.5, '1.4.3'),
  p('kc-badge--danger', 'felirat', SZIN('danger'), SZIN('danger-surface'), 4.5, '1.4.3'),
  p('kc-badge--info', 'felirat', SZIN('text'), SZIN('accent-quiet'), 4.5, '1.4.3'),
  p('::selection', 'globális', SZIN('ink'), SZIN('accent-quiet'), 4.5, '1.4.3'),
  p(
    'kc-preview-bar__exit',
    'fókuszgyűrű',
    SZIN('focus-on-dark'),
    SZIN('surface-dark'),
    3,
    '1.4.11',
  ),
  p('kc-player__media', 'fókuszgyűrű', SZIN('focus-on-dark'), SZIN('surface-dark'), 3, '1.4.11'),
  p('kc-richtext__video', 'fókuszgyűrű', SZIN('focus-on-dark'), SZIN('surface-dark'), 3, '1.4.11'),
  p(
    'kc-checkout-form__block-hint',
    'magyarázat a gomb mellett',
    SZIN('text-muted'),
    SZIN('bg'),
    4.5,
    '1.4.3',
  ),
]

// ───────────────────────────────────────────────────────────────────────────
// TESZTEK
// ───────────────────────────────────────────────────────────────────────────

describe('a kontraszt-motor önmagán (a WCAG 2.2 ismert értékei)', () => {
  it('a szélső esetek pontosak', () => {
    expect(ker2(arany([0, 0, 0], [255, 255, 255]))).toBe(21)
    expect(ker2(arany([255, 255, 255], [255, 255, 255]))).toBe(1)
    expect(ker2(arany([0, 0, 0], [0, 0, 0]))).toBe(1)
    // szimmetrikus: a sorrend nem számít
    expect(arany([16, 36, 62], [246, 249, 252])).toBeCloseTo(
      arany([246, 249, 252], [16, 36, 62]),
      10,
    )
  })

  it('a W3C-példaértékeket reprodukálja', () => {
    // #767676 a fehéren pontosan a 4,5:1-es küszöb legkisebb szürkéje
    expect(ker2(arany(hexRgb('#767676'), hexRgb('#ffffff')))).toBe(4.54)
    // #949494 a fehéren a 3:1-es (nem-szöveges) küszöb környéke
    expect(ker2(arany(hexRgb('#949494'), hexRgb('#ffffff')))).toBe(3.03)
    // a repó saját, filmkockákból mért horgonyai
    expect(ker2(arany(hexRgb('#10243e'), hexRgb('#f6f9fc')))).toBe(14.79)
    expect(ker2(arany(hexRgb('#2f6e9f'), hexRgb('#10243e')))).toBe(2.87)
  })

  it('a hexa-értelmezés a rövid alakot is kezeli', () => {
    expect(hexRgb('#fff')).toEqual([255, 255, 255])
    expect(hexRgb('#10243e')).toEqual([16, 36, 62])
  })

  it('az alfa-kompozit a böngésző rajzolását követi', () => {
    expect(keverek([0, 0, 0], [255, 255, 255], 0)).toEqual([255, 255, 255])
    expect(keverek([0, 0, 0], [255, 255, 255], 1)).toEqual([0, 0, 0])
    expect(keverek([0, 0, 0], [255, 255, 255], 0.5)).toEqual([128, 128, 128])
  })

  it('a token-tábla feloldja az aliasokat', () => {
    expect(SZIN('primary')).toEqual(hexRgb('#2f6e9f')) // → accent-deep
    expect(SZIN('focus-on-dark')).toEqual(hexRgb('#ffffff')) // → white
    expect(SZIN('info')).toEqual(hexRgb('#2f6e9f')) // → accent-deep
  })
})

describe('G-K1 — minden var(--kc-*) hivatkozás LÉTEZŐ tokenre mutat', () => {
  /**
   * Ez fogta volna el a B9-et: a `--kc-color-info` / `--kc-color-info-surface`
   * sehol nem volt definiálva, a `var()` „invalid at computed-value time"-ra
   * esett, és a `/kosar` értesítő-doboza meg a „fizetés folyamatban" köszönő
   * doboz némán elvesztette a keretét és a hátterét.
   */
  const DEFINICIO_MINTA = /(--kc-[a-z0-9-]+)\s*:/g
  const HIVATKOZAS_MINTA = /var\(\s*(--kc-[a-z0-9-]+)/g

  /* Az admin Statisztika nézet márka-rétege (tulajdonosi döntés, 2026-08-20)
     a Payload route-groupban él, és scope-olt --kc-as-* tokeneket definiál
     — a src/components/admin/statistics/** inline stílusai ezekre
     hivatkoznak Payload-tartalékkal. A B9-védelem rá is vonatkozik: a
     definíció- ÉS a hivatkozás-gyűjtésbe is belép, így az ottani elgépelt
     token ugyanúgy megbukik itt. A storefront-kontrasztőrökbe (G-K2…K6)
     viszont NEM kerül be: azok a storefront szelektorait mérik. */
  const ADMIN_BRAND_CSS = join(SRC, 'app', '(payload)', 'custom.scss')

  const definialt = new Set<string>()
  for (const fajl of [...CSS_FAJLOK, ADMIN_BRAND_CSS]) {
    for (const e of readFileSync(fajl, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .matchAll(DEFINICIO_MINTA)) {
      definialt.add(e[1])
    }
  }
  for (const fajl of TSX_FAJLOK) {
    const forras = readFileSync(fajl, 'utf8')
    // inline stílus-objektum: { '--kc-valami': érték }
    for (const e of forras.matchAll(/['"](--kc-[a-z0-9-]+)['"]\s*:/g)) {
      definialt.add(e[1])
    }
    // futásidejű írás: root.style.setProperty('--kc-valami', …)
    for (const e of forras.matchAll(/setProperty\(\s*['"](--kc-[a-z0-9-]+)['"]/g)) {
      definialt.add(e[1])
    }
    // konstansba emelt változónév: const X = '--kc-valami'
    for (const e of forras.matchAll(/=\s*['"](--kc-[a-z0-9-]+)['"]/g)) {
      definialt.add(e[1])
    }
  }

  const hivatkozasok: Array<{ token: string; hol: string }> = []
  for (const fajl of [...CSS_FAJLOK, ...TSX_FAJLOK, ADMIN_BRAND_CSS]) {
    const forras = readFileSync(fajl, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const e of forras.matchAll(HIVATKOZAS_MINTA)) {
      hivatkozasok.push({ token: e[1], hol: utvonal(fajl) })
    }
  }

  it('van mit ellenőrizni (a bejáró nem néma)', () => {
    expect(CSS_FAJLOK.length).toBeGreaterThanOrEqual(20)
    expect(hivatkozasok.length).toBeGreaterThanOrEqual(300)
    expect(definialt.size).toBeGreaterThanOrEqual(60)
  })

  it('nincs ismeretlen tokenre mutató var() a storefront CSS-eiben és a TSX inline stílusaiban', () => {
    const ismeretlen = hivatkozasok
      .filter(({ token }) => !definialt.has(token))
      .map(({ token, hol }) => `${hol}: ${token}`)
    expect(
      [...new Set(ismeretlen)].sort(),
      'nem létező --kc-* tokenre mutató var(): a deklaráció ilyenkor NÉMÁN a ' +
        'tulajdonság kezdőértékére esik vissza (rövidítésnél az EGÉSZ rövidítés ' +
        'elvész). Vagy definiáld a tokent a tokens.css-ben, vagy írd át meglévő ' +
        'szerep-tokenre. Lásd docs/gomb-kontraszt-audit.md B9.',
    ).toEqual([])
  })

  it('a B9 két tokenje definiálva van és a helyes szerepre mutat', () => {
    expect(NYERS.get('--kc-color-info')).toBe('var(--kc-color-accent-deep)')
    expect(NYERS.get('--kc-color-info-surface')).toBe('var(--kc-color-tint-cool)')
  })
})

describe('G-K2 — a mért párok mátrixa a küszöbeit tartja', () => {
  it.each(PAROK.map((par) => [`${par.elem} · ${par.allapot}`, par] as const))('%s', (_nev, par) => {
    const ertek = arany(par.elo, par.hatter)
    expect(
      ker2(ertek),
      `${par.elem} (${par.allapot}) — WCAG ${par.sc}, küszöb ${par.kuszob}:1, ` +
        `mért ${ker2(ertek)}:1. Ha egy token értéke változott, vagy ez a pár ` +
        'már nem érvényes, a mátrix sorát KELL frissíteni, nem a küszöböt.',
    ).toBeGreaterThanOrEqual(par.kuszob)
  })

  it('a mátrix lefedi a P1 bukások mindegyikét (B1, B2, B7, B9, B10)', () => {
    const elemek = new Set(PAROK.map((par) => par.elem))
    for (const kotelezo of [
      'kc-site-header :focus-visible',
      'kc-consent-banner',
      'kc-film-hero__cta:focus-visible',
      'kc-cart-notice',
      'kc-progress-bar--sm',
      'kc-button:disabled',
    ]) {
      expect(elemek.has(kotelezo), `hiányzó mátrix-sor: ${kotelezo}`).toBe(true)
    }
  })

  it('B1 — a RÉGI, fix fókuszgyűrű tényleg bukott volna (a teszt nem vakon zöld)', () => {
    // A rögzítés célja: ha valaki visszaírja a fix accent-deep gyűrűt, lássa,
    // mekkora a különbség. veil = 0 a kezdőlap teteje, az első Tab-lenyomás.
    expect(ker2(arany(SZIN('focus'), filmFejlec(0)))).toBeLessThan(3)
    expect(ker2(arany(fejlecGyuru(0), filmFejlec(0)))).toBeGreaterThanOrEqual(3)
  })

  it('a fagyott fátyol veil=1-nél NEM szolid paper a filmsávon', () => {
    expect(filmFejlec(1)).not.toEqual(SZIN('paper'))
    expect(filmFejlec(1)).toEqual(hexRgb('#d8dde1'))
    expect(filmFejlec(0)).toEqual(hexRgb('#8c959d'))
  })
})

describe('G-K-frost — a fejléc fátyla fagyott üveg, nem réteg-opacity', () => {
  /**
   * A korábbi modell `opacity: var(--kc-header-veil)` a ::before-on a
   * backdrop-filtert is kifakította, veil=1-nél szolid papírlapot adott.
   * A fagyott üveghez a fedés a background-color ALFÁJA, a blur a
   * pszeudo-elemen marad (a MobileNav drawer miatt nem a fejlécen).
   */
  const layoutForras = readFileSync(join(FRONTEND, 'styles', 'layout.css'), 'utf8')
  const fagyRetegek = MINDEN_SZABALY.filter((sz) => sz.szelektor === '.kc-site-header::before')

  it('a ::before réteg létezik (a bejáró nem néma)', () => {
    expect(fagyRetegek.length).toBeGreaterThanOrEqual(1)
  })

  it('a fátyolréteg NEM opacity-vel fedi a blurrt', () => {
    const opacityVeil = fagyRetegek.filter((sz) =>
      /opacity\s*:\s*var\(\s*--kc-header-veil/.test(sz.torzs),
    )
    expect(
      opacityVeil.map((sz) => sz.torzs.trim()),
      'opacity a ::before-on a backdrop-filtert is kifakítja; a fedés legyen color-mix alfa.',
    ).toEqual([])
  })

  it('a 72%-os fagy-fedés color-mix alfaként él, a blur a ::before-on', () => {
    const alap = fagyRetegek.find(
      (sz) => /background-color\s*:/.test(sz.torzs) && /72%/.test(sz.torzs),
    )
    expect(alap, 'hiányzik a 72%-os color-mix fedés a ::before-on').toBeDefined()
    expect((alap as Szabaly).torzs).toMatch(/color-mix\(/)
    expect((alap as Szabaly).torzs).toMatch(/transparent/)
    expect(fagyRetegek.some((sz) => /backdrop-filter\s*:/.test(sz.torzs))).toBe(true)
    expect(layoutForras).toMatch(/-webkit-backdrop-filter\s*:/)
  })

  it('a backdrop-filter a fejlécen magán NINCS (a drawer tartalmazó-blokkja miatt)', () => {
    const fejlecMagan = MINDEN_SZABALY.filter(
      (sz) => sz.szelektor === '.kc-site-header' && /backdrop-filter\s*:/.test(sz.torzs),
    )
    expect(fejlecMagan.map((sz) => sz.fajl)).toEqual([])
  })
})

describe('G-K3 — minden sötét felület definiál fókusz-felülírást', () => {
  /**
   * Ez fogta volna el a B2-t: a süti-sáv ink hátterű, de nem
   * `.kc-section--dark` leszármazottja, ezért a `ui.css` fehérre váltó
   * felülírása nem érte el — a két gomb fókuszgyűrűje 2,87:1 maradt.
   *
   * A REGISZTER kézzel karbantartott, és a teszt KÉT irányban fog:
   *  (a) minden regiszter-bejegyzésnek vagy van élő `:focus-visible`
   *      outline-color felülírása a CSS-ben, vagy indokolt kivétel;
   *  (b) új sötét háttér a CSS-ben (ami nincs a regiszterben) BUKTAT — így egy
   *      jövőbeli sötét sáv nem csúszhat be fókusz-felülírás nélkül.
   */
  const SOTET_HATTER =
    /background(-color)?\s*:\s*var\(\s*--kc-color-(surface-dark|ink|navy-900|primary|primary-hover|accent-deep|accent-deeper)\s*\)/

  interface Bejegyzes {
    /** A sötét hátteret beállító szelektor (a CSS-ben pontosan így szerepel). */
    szelektor: string
    /** A fókusz-felülírást tartalmazó szelektor, vagy null, ha kivétel. */
    felulir: string | null
    /** Kivételnél kötelező indoklás. */
    indok?: string
  }

  const REGISZTER: readonly Bejegyzes[] = [
    // Sötét KONTÉNEREK, amelyekben fókuszálható tartalom ül:
    { szelektor: '.kc-section--dark', felulir: '.kc-section--dark :focus-visible' },
    { szelektor: '.kc-section.kc-free-sos', felulir: '.kc-free-sos :focus-visible' },
    { szelektor: '.kc-consent-banner', felulir: '.kc-consent-banner :focus-visible' },
    { szelektor: '.kc-preview-bar', felulir: '.kc-preview-bar__exit:focus-visible' },
    { szelektor: '.kc-player__media', felulir: '.kc-player__media :focus-visible' },
    { szelektor: '.kc-richtext__video', felulir: '.kc-richtext__video :focus-visible' },
    {
      szelektor: '.kc-section--dark .kc-cta-banner__action .kc-button--primary',
      felulir: '.kc-section--dark .kc-cta-banner__action .kc-button:focus-visible',
    },
    // Kivételek — mind mérve, indokkal:
    { szelektor: '.kc-course-preview', felulir: '.kc-course-preview :focus-visible' },
    {
      szelektor: '.kc-states__caption',
      felulir: null,
      indok:
        'A States-kártya figcaption-je: cím + szöveg, fókuszálható tartalom ' +
        'NINCS benne (a kártya nem link — States.tsx figure/figcaption).',
    },
    {
      szelektor: '.kc-skip-link',
      felulir: null,
      indok:
        'MAGA a fókuszálható elem sötét, nem a mögötte lévő felület. Az ' +
        'outline-offset 2px miatt a gyűrű a LAPRA esik: accent-deep a paperen ' +
        '5,16:1 ✓.',
    },
    {
      szelektor: '.kc-button--primary',
      felulir: null,
      indok:
        'Gomb-KITÖLTÉS, nem konténer: a 2px-es outline-offset miatt a gyűrű a ' +
        'LAPRA esik (paper 5,16 · fehér 5,45 · tint 4,72:1), nem a kitöltésre.',
    },
    {
      szelektor: '.kc-button--primary:hover:not(:disabled):not(.kc-button--disabled)',
      felulir: null,
      indok: 'Ua.: hover-kitöltés, a fókuszgyűrű az offset miatt a lapra esik.',
    },
    {
      szelektor: '.kc-category-filter__chip--active, .kc-category-filter__chip--active:hover',
      felulir: null,
      indok:
        'Chip-KITÖLTÉS: a chip MAGA a fókuszálható link, a gyűrű az ' +
        'outline-offset miatt a lapra esik (5,16:1).',
    },
    {
      szelektor: ".kc-course-filter__chip[aria-current='true']",
      felulir: null,
      indok:
        'Chip-KITÖLTÉS a kurzuslistán (kurzusok.css): a chip maga a fókuszálható ' +
        'link, a gyűrű az outline-offset miatt a lapra esik (5,16:1).',
    },
    {
      szelektor: '.kc-richtext__exercise-item--done::before',
      felulir: null,
      indok:
        'Dekoratív pipa-jelölő pszeudo-elem a gyakorlatlistán — nem ' +
        'fókuszálható, és nem is tartalmaz fókuszálható leszármazottat.',
    },
    {
      szelektor: '.kc-preview-bar__exit:hover',
      felulir: null,
      indok:
        'Hover-kitöltés azon az elemen, aminek a fókusz-felülírása külön ' +
        'szabályban már megvan (.kc-preview-bar__exit:focus-visible).',
    },
    {
      szelektor: '.kc-promo-badge',
      felulir: null,
      indok:
        'Az „Akció” címke (CoursePromoBadge, WP60) kitöltött tabletta, nem ' +
        'interaktív és nincs fókuszálható leszármazottja; a kártya-link ' +
        'fókuszgyűrűje a kártyára/lapra esik (accent-deep a paperen 5,16:1).',
    },
    {
      szelektor: '.kc-product-card .kc-product-card__cta',
      felulir: null,
      indok: 'Dekoráció (nem interaktív) — a kártya EGÉSZE a link, a gyűrű a kártyán.',
    },
    {
      szelektor:
        '.kc-card--interactive.kc-product-card:hover .kc-product-card__cta, .kc-card--interactive.kc-product-card:focus-within .kc-product-card__cta',
      felulir: null,
      indok:
        'Ua.: a kártya hover/focus-within állapota festi át a DEKORÁCIÓS ' +
        'álgombot; a fókusz a kártya-linken van, a gyűrű a lapra esik.',
    },
    {
      szelektor: '.kc-progress-bar__fill',
      felulir: null,
      indok: 'A haladás-sáv kitöltése — grafika, nem fókuszálható vezérlő.',
    },
    {
      szelektor: ".kc-progress-bar[aria-valuenow='100'] .kc-progress-bar__fill",
      felulir: null,
      indok: 'Ua.: a haladás-sáv kész-állapotú kitöltése, nem fókuszálható elem.',
    },
    {
      szelektor: '.kc-player-actions__primary',
      felulir: null,
      indok:
        'Gomb-KITÖLTÉS a lejátszó akciósávján: a gyűrű az outline-offset miatt ' +
        'a fehér lapra esik (accent-deep a fehéren 5,45:1).',
    },
    {
      szelektor: '.kc-player-actions__primary:hover:not(.kc-player-actions__primary--inactive)',
      felulir: null,
      indok: 'Ua.: hover-kitöltés a gombon, a gyűrű az offset miatt a lapra esik.',
    },
    {
      szelektor:
        '.kc-services-sin__input:nth-of-type(1):checked ~ .kc-services-sin__layout .kc-services-sin__rail-label:nth-of-type(1) .kc-services-sin__marker, .kc-services-sin__input:nth-of-type(2):checked ~ .kc-services-sin__layout .kc-services-sin__rail-label:nth-of-type(2) .kc-services-sin__marker, .kc-services-sin__input:nth-of-type(3):checked ~ .kc-services-sin__layout .kc-services-sin__rail-label:nth-of-type(3) .kc-services-sin__marker, .kc-services-sin__input:nth-of-type(4):checked ~ .kc-services-sin__layout .kc-services-sin__rail-label:nth-of-type(4) .kc-services-sin__marker, .kc-services-sin__input:nth-of-type(5):checked ~ .kc-services-sin__layout .kc-services-sin__rail-label:nth-of-type(5) .kc-services-sin__marker',
      felulir: null,
      indok:
        'A sín aktív körjelölője dekoratív (aria-hidden), nem fókuszálható. ' +
        'A fókusz a címkén van, a gyűrű accent-deep a paper lapon (5,16:1).',
    },
    {
      szelektor: '.kc-services-sin__cta',
      felulir: null,
      indok:
        'Gomb-KITÖLTÉS a C sín paneljén: ink felület, a 2px-es outline-offset ' +
        'miatt a gyűrű a LAPRA esik (fehér az inken 15,63:1, paperen 14,79:1).',
    },
    {
      szelektor: '.kc-services-sin__cta:hover:not(:disabled):not(.kc-button--disabled)',
      felulir: null,
      indok: 'Ua.: hover-kitöltés a gombon, a gyűrű az offset miatt a lapra esik.',
    },
  ]

  const sotetSzabalyok = MINDEN_SZABALY.filter((sz) => SOTET_HATTER.test(sz.torzs))

  it('van mit ellenőrizni (a bejáró nem néma)', () => {
    expect(sotetSzabalyok.length).toBeGreaterThanOrEqual(15)
  })

  it('minden sötét hátterű szabály szerepel a regiszterben', () => {
    const regisztralt = new Set(REGISZTER.map((b) => b.szelektor))
    const hianyzo = sotetSzabalyok
      .map((sz) => `${sz.fajl}: ${sz.szelektor}`)
      .filter((sor) => !regisztralt.has(sor.slice(sor.indexOf(': ') + 2)))
    expect(
      hianyzo.sort(),
      'ÚJ sötét felület a CSS-ben, ami nincs a G-K3 regiszterben. Vedd fel a ' +
        'REGISZTER-be: vagy adj neki `:focus-visible { outline-color: ' +
        'var(--kc-color-focus-on-dark) }` felülírást, vagy írj INDOKLÁST, hogy ' +
        'miért nem kell (nincs benne fókuszálható tartalom / a gyűrű a lapra ' +
        'esik). Lásd docs/gomb-kontraszt-audit.md B2.',
    ).toEqual([])
  })

  it('minden regisztrált fókusz-felülírás ÉL a CSS-ben', () => {
    const szelektorok = new Set(MINDEN_SZABALY.map((sz) => sz.szelektor))
    const hianyzo = REGISZTER.filter((b) => b.felulir !== null).filter(
      (b) => !szelektorok.has(b.felulir as string),
    )
    expect(
      hianyzo.map((b) => `${b.szelektor} → ${b.felulir as string}`),
      'a regiszterben ígért fókusz-felülírás eltűnt a CSS-ből.',
    ).toEqual([])
  })

  it('a felülírások a sötét felületre való szerep-tokent használják', () => {
    const gyanus: string[] = []
    for (const bejegyzes of REGISZTER) {
      if (bejegyzes.felulir === null) {
        continue
      }
      const szabaly = MINDEN_SZABALY.find((sz) => sz.szelektor === bejegyzes.felulir)
      if (szabaly === undefined) {
        continue
      }
      const jo =
        /outline(-color)?\s*:[^;]*var\(\s*--kc-color-(focus-on-dark|on-dark|white)\s*\)/.test(
          szabaly.torzs,
        ) ||
        /outline(-color)?\s*:[^;]*var\(\s*--kc-(free-sos-on-band|color-white)\s*\)/.test(
          szabaly.torzs,
        )
      if (!jo) {
        gyanus.push(`${szabaly.fajl}: ${szabaly.szelektor}`)
      }
    }
    expect(
      gyanus,
      'sötét felületen a fókuszgyűrűnek a világos szerep-tokent kell viselnie ' +
        '(--kc-color-focus-on-dark / on-dark / a sáv saját ellenszíne); az ' +
        'accent-deep az inken csak 2,87:1.',
    ).toEqual([])
  })

  it('minden kivétel INDOKLÁST hordoz', () => {
    const indoklatlan = REGISZTER.filter(
      (b) => b.felulir === null && (b.indok === undefined || b.indok.trim().length < 20),
    ).map((b) => b.szelektor)
    expect(indoklatlan, 'kivétel indoklás nélkül nem maradhat a regiszterben').toEqual([])
  })
})

describe('G-K4 — `opacity` nem jelölheti a letiltott állapotot', () => {
  /**
   * Ez fogta volna el a B8-at: a `.kc-button:disabled { opacity: .5 }` a
   * feliratot ÉS a kitöltést egyszerre keverte a lappal, ezért a felirat
   * kontrasztja 2,06–2,16:1-re esett — pontosan akkor, amikor a felirat a
   * legfontosabb információt hordozza („Feldolgozás…”, „Megrendelés és
   * fizetés”). A letiltás vizuális jelzése szándékos token-pár, nem
   * áttetszőség (IBM Carbon: nevesített disabled-tokenek).
   */
  const ALLAPOT_MINTA = /(:disabled|\[aria-disabled|--disabled|--inactive|\[disabled)/

  /** A `:not(:disabled)` NEM letiltott-állapot: hover-kizárás. */
  const allapotSzelektor = (szelektor: string): boolean =>
    ALLAPOT_MINTA.test(szelektor.replace(/:not\([^)]*\)/g, ''))

  const allapotSzabalyok = MINDEN_SZABALY.filter((sz) => allapotSzelektor(sz.szelektor))

  it('van mit ellenőrizni (a bejáró nem néma)', () => {
    expect(allapotSzabalyok.length).toBeGreaterThanOrEqual(3)
    expect(
      allapotSzabalyok.some((sz) => sz.szelektor.includes('.kc-button:disabled')),
      'a kc-button letiltott szabálya nem található — átnevezték?',
    ).toBe(true)
  })

  it('egyetlen letiltott/inaktív állapotú szabályblokk sem használ opacity-t', () => {
    const vetok = allapotSzabalyok
      .filter((sz) => /(^|[;{\s])opacity\s*:/.test(sz.torzs))
      .map((sz) => `${sz.fajl}: ${sz.szelektor}`)
    expect(
      vetok.sort(),
      'letiltott/inaktív állapot jelölése `opacity`-vel TILOS: az áttetszőség a ' +
        'feliratot és a kitöltést egyszerre mossa el, a felirat olvashatatlanná ' +
        'válik (mérve 2,06–2,16:1). Használj szándékos token-párt — a minta: ' +
        '`ui.css .kc-button:disabled` és `player.css ' +
        '.kc-player-actions__primary--inactive`. Lásd docs/gomb-kontraszt-audit.md B8.',
    ).toEqual([])
  })

  it('a letiltott gomb explicit felirat-, keret- és háttérszínt kap', () => {
    const szabaly = MINDEN_SZABALY.find((sz) => sz.szelektor.startsWith('.kc-button:disabled'))
    expect(szabaly, 'a .kc-button:disabled szabály eltűnt').toBeDefined()
    const torzs = (szabaly as Szabaly).torzs
    expect(torzs).toMatch(/color\s*:\s*var\(--kc-color-text-muted\)/)
    expect(torzs).toMatch(/background-color\s*:\s*var\(--kc-color-border\)/)
    expect(torzs).toMatch(/border-color\s*:\s*var\(--kc-color-border-strong\)/)
    expect(torzs).toMatch(/cursor\s*:\s*not-allowed/)
  })
})

describe('G-K5 — célfelület: minden `cursor: pointer` elem mérete indokolt', () => {
  /**
   * WCAG 2.2 2.5.8 (AA) 24×24 CSS px; a projekt szabálya szigorúbb: 44×44
   * (2.5.5 AAA, docs/ui-sztenderdek.md §2.4). A `cursor: pointer` a
   * legmegbízhatóbb statikus jel arra, hogy az elem kattintható.
   */
  /** Deklarált magasság: `min-height` / `min-block-size` / fix `height` /
   *  `block-size` — a repó mindegyiket használja (44px-es ikon-gomboknál
   *  fix méret, szöveges gomboknál minimum). */
  const MERET = /(?:min-height|min-block-size|block-size|height)\s*:\s*([0-9.]+)(rem|px)/

  /** Indokolt kivételek — a szelektor pontosan úgy, ahogy a CSS-ben áll. */
  const KIVETELEK: ReadonlyMap<string, string> = new Map([
    [
      '.kc-contact-form__summary',
      'NEM kattintható elem: a /kapcsolat hiba-összefoglaló doboza, ami csak ' +
        'programozottan fókuszálható (tabIndex -1). A `cursor: pointer` itt a ' +
        'natív <summary> öröksége — célfelület-követelmény nem vonatkozik rá.',
    ],
  ])

  const mutatoSzabalyok = MINDEN_SZABALY.filter((sz) => /cursor\s*:\s*pointer/.test(sz.torzs))

  it('van mit ellenőrizni (a bejáró nem néma)', () => {
    expect(mutatoSzabalyok.length).toBeGreaterThanOrEqual(10)
  })

  it('minden kattintható elem vagy ≥ 1.5rem (24px) magas, vagy indokolt kivétel', () => {
    const vetok: string[] = []
    for (const szabaly of mutatoSzabalyok) {
      const talalat = MERET.exec(szabaly.torzs)
      if (talalat !== null) {
        const ertek = Number.parseFloat(talalat[1])
        const px = talalat[2] === 'rem' ? ertek * 16 : ertek
        if (px >= 24) {
          continue
        }
        vetok.push(`${szabaly.fajl}: ${szabaly.szelektor} (${talalat[0]} < 24px)`)
        continue
      }
      if (KIVETELEK.has(szabaly.szelektor)) {
        continue
      }
      vetok.push(`${szabaly.fajl}: ${szabaly.szelektor} (nincs min-height)`)
    }
    expect(
      vetok.sort(),
      'kattintható elem deklarált célfelület nélkül. Adj neki ' +
        '`min-height: 2.75rem`-et (44px, a projekt szabálya), vagy vedd fel a ' +
        'KIVETELEK listára INDOKLÁSSAL. WCAG 2.2 2.5.8 (AA, 24px) / 2.5.5 ' +
        '(AAA, 44px), docs/ui-sztenderdek.md §2.4.',
    ).toEqual([])
  })

  it('minden kivétel élő szelektorra mutat (nincs elárvult mentesség)', () => {
    const eloSzelektorok = new Set(MINDEN_SZABALY.map((sz) => sz.szelektor))
    const arva = [...KIVETELEK.keys()].filter((sz) => !eloSzelektorok.has(sz))
    expect(arva, 'a kivétel-listán olyan szelektor áll, ami már nincs a CSS-ben').toEqual([])
  })
})

describe('G-K6 — a tokens.css kontraszt-jegyzőkönyve újraszámolva', () => {
  /**
   * A jegyzőkönyv ma pontos — de ha valaki átszínez egy tokent és a kommentet
   * nem írja át, a dokumentáció némán hazudni kezd. Ez a teszt a komment MINDEN
   * arányát újraszámolja a tényleges token-értékekből.
   */
  const NEV_HEX: ReadonlyMap<string, string> = new Map([
    ['ink-soft', '--kc-color-ink-soft'],
    ['accent-deeper', '--kc-color-accent-deeper'],
    ['accent-deep', '--kc-color-accent-deep'],
    ['accent-quiet', '--kc-color-accent-quiet'],
    ['hairline-strong', '--kc-color-hairline-strong'],
    ['info-surface', '--kc-color-info-surface'],
    ['text-muted', '--kc-color-text-muted'],
    ['border-strong', '--kc-color-border-strong'],
    ['border', '--kc-color-border'],
    ['info', '--kc-color-info'],
    ['paper', '--kc-color-paper'],
    ['fehér', '--kc-color-white'],
    ['tint', '--kc-color-tint-cool'],
    ['ink', '--kc-color-ink'],
  ])
  interface Sor {
    nyers: string
    elo: string
    hatter: string
    kozolt: number
  }

  /**
   * A jegyzőkönyv SORAI (nem a próza): `<elő><≥2 szóköz><háttér><pontok>X,YY:1`.
   * A ≥ 2 szóköz a táblázat oszlopköze — ez választja el a jegyzőkönyv-sorokat
   * a körülöttük futó magyarázó bekezdésektől, amelyekben ugyanezek a nevek
   * mondat közben, egy szóközzel állnak.
   */
  const SOR_MINTA = /^\s*([a-zá-űA-ZÁ-Ű-]+)\s{2,}([a-zá-űA-ZÁ-Ű-]+)\s*\.*\s*(\d+),(\d+):1/

  const sorok: Sor[] = []
  for (const nyers of TOKENS_FORRAS.split('\n')) {
    const talalat = SOR_MINTA.exec(nyers.replace(/\(#[0-9a-f]{3,8}\)/gi, ''))
    if (talalat === null) {
      continue
    }
    const [, elo, hatter, egesz, tort] = talalat
    if (!NEV_HEX.has(elo) || !NEV_HEX.has(hatter)) {
      continue
    }
    sorok.push({
      nyers: nyers.trim(),
      elo,
      hatter,
      kozolt: Number.parseFloat(`${egesz}.${tort}`),
    })
  }

  it('a jegyzőkönyv-táblázat megvan és teljes (a parser nem néma)', () => {
    expect(
      sorok.length,
      'a tokens.css kontraszt-jegyzőkönyve eltűnt vagy átformázódott — ' +
        'a G-K6 őr így semmit nem ellenőrizne',
    ).toBeGreaterThanOrEqual(20)
  })

  it('minden közölt arány megegyezik az újraszámolttal', () => {
    const elteres: string[] = []
    for (const sor of sorok) {
      const elo = szinToken(NEV_HEX.get(sor.elo) as string)
      const hatter = szinToken(NEV_HEX.get(sor.hatter) as string)
      const szamolt = ker2(arany(elo, hatter))
      if (Math.abs(szamolt - sor.kozolt) > 0.005) {
        elteres.push(`„${sor.nyers}" → újraszámolva ${szamolt.toFixed(2)}:1`)
      }
    }
    expect(
      elteres,
      'a tokens.css kontraszt-jegyzőkönyve nem egyezik a tényleges ' +
        'token-értékekkel. Ha a színt szándékosan változtattad, írd át a ' +
        'kommentet is — a néma, hazug jegyzőkönyv rosszabb, mint a semmilyen.',
    ).toEqual([])
  })

  it('az AKCENT-KORLÁT három száma is helyes (az accent nem vihet szöveget)', () => {
    const accent = szinToken('--kc-color-accent')
    expect(ker2(arany(accent, szinToken('--kc-color-tint-cool')))).toBe(4.07)
    expect(ker2(arany(accent, szinToken('--kc-color-paper')))).toBe(4.45)
    expect(ker2(arany(accent, szinToken('--kc-color-white')))).toBe(4.7)
    // …és mindhárom a normál szöveg 4,5:1-es küszöbe ALATT vagy azon van:
    expect(ker2(arany(accent, szinToken('--kc-color-tint-cool')))).toBeLessThan(4.5)
  })

  it('a focus-on-dark indoklása (accent-deep az inken 2,87:1) áll', () => {
    expect(TOKENS_FORRAS).toContain('2,87:1')
    expect(ker2(arany(szinToken('--kc-color-accent-deep'), szinToken('--kc-color-ink')))).toBe(2.87)
  })
})

describe('1.4.1 — a linkeket nem csak a szín jelöli', () => {
  /**
   * A G183 technika 3:1-et kér a link és a környező szöveg között, HA nincs
   * más jelölő. A projekt válasza az aláhúzás — ezért itt a jelölő MEGLÉTÉT
   * őrizzük, nem a szín-különbséget.
   */
  const KOTELEZO_ALAHUZAS: readonly string[] = [
    '.kc-contact-form__consent-label a',
    '.kc-auth-alt a',
    '.kc-account__course',
    '.kc-cart__title',
    '.kc-newsletter__consent-label a',
    '.kc-consent-banner__text a',
  ]

  it.each(KOTELEZO_ALAHUZAS)('%s aláhúzott (nem csak színnel jelölt)', (szelektor) => {
    const szabaly = MINDEN_SZABALY.find((sz) => sz.szelektor === szelektor)
    expect(szabaly, `hiányzó szabály: ${szelektor}`).toBeDefined()
    expect(
      (szabaly as Szabaly).torzs,
      `${szelektor}: a link jelölését nem hordozhatja egyedül a szín (WCAG 1.4.1, ` +
        'G183). A projekt jelölője az aláhúzás.',
    ).toMatch(/text-decoration\s*:\s*underline/)
  })
})

describe('2.4.11 — a ragadós süti-sáv nem takarhatja el a fókuszált elemet', () => {
  it('a gyökér-osztály alsó görgetési párnát ad a MÉRT sáv-magasságból', () => {
    const szabaly = MINDEN_SZABALY.find((sz) => sz.szelektor === '.kc-has-consent-banner')
    expect(szabaly, 'a .kc-has-consent-banner szabály hiányzik').toBeDefined()
    expect((szabaly as Szabaly).torzs).toMatch(
      /scroll-padding-bottom\s*:[^;]*var\(--kc-consent-offset\)/,
    )
  })

  it('a sáv ÉS a mobil vásárlósáv együtt is elfér (két-osztályos, összegző szabály)', () => {
    const egyutt = MINDEN_SZABALY.find(
      (sz) => sz.szelektor === '.kc-has-consent-banner.kc-has-buybar',
    )
    expect(
      egyutt,
      'hiányzik a két ragadós sáv ÖSSZEGÉT adó szabály — a kurzusoldalon ' +
        'mindkettő látszhat egyszerre',
    ).toBeDefined()
    expect((egyutt as Szabaly).torzs).toMatch(/scroll-padding-bottom/)
  })

  it('a komponens futásidőben MÉRI a sáv magasságát (nem fix érték)', () => {
    const forras = readFileSync(join(COMPONENTS, 'analytics', 'ConsentBanner.tsx'), 'utf8')
    expect(forras).toContain('kc-has-consent-banner')
    expect(forras).toContain('--kc-consent-offset')
    expect(forras).toContain('getBoundingClientRect')
    expect(forras).toContain('ResizeObserver')
  })
})
