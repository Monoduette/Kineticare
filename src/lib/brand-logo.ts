/**
 * Az új Kineticare logócsomag (a tulajdonosok 2026-09-14-i csomagja) —
 * a `public/assets/brand/` alatt VÁLTOZTATÁS NÉLKÜL szolgált SVG-k adatai.
 *
 * Sima `<img>` és nem `next/image`: az SVG-t bitre azonosan kell kiszolgálni
 * (a Barion-logósor mintája, `BarionFizetesJelzes.tsx`). A `width`/`height`
 * az EREDETI rajzméret (viewBox, egészre kerekítve): a böngésző így a
 * betöltés ELŐTT is a helyes oldalarányú dobozt foglalja, nincs elrendezés-
 * ugrás (CLS). A megjelenített méretet a CSS adja (`layout.css`).
 *
 * A logó két színe (a csomag SVG-jeiben rögzítve, nem token):
 * - `#11233d` sötétkék wordmark: a tokens.css `--kc-color-ink` (#10243e)
 *   párja, csatornánként legfeljebb 1 egységnyi eltéréssel (mérve, WP49);
 * - `#8cb0d9` világoskék kéz: a `--kc-color-accent-quiet` (#9ec4df) halkabb
 *   rokona (a csatorna-eltérés 18/20/6).
 * A tokeneket NEM írjuk át (tulajdonosi kikötés): a logó a márka rajza,
 * a felület színei a tokenekből jönnek.
 */
export interface BrandLogoAsset {
  /** Nyilvános útvonal (a `public/` gyökerétől). */
  readonly src: string
  /** A rajz eredeti szélessége (viewBox). */
  readonly width: number
  /** A rajz eredeti magassága (viewBox). */
  readonly height: number
}

/** Vízszintes, színes logó világos felületre (fejléc, lábléc). */
export const BRAND_LOGO_HORIZONTAL: BrandLogoAsset = {
  src: '/assets/brand/kineticare-horizontal.svg',
  width: 383,
  height: 51,
}

/** Vízszintes, fehér logó sötét felületre (ma nincs sötét fejléc-állapot; tartalék). */
export const BRAND_LOGO_HORIZONTAL_WHITE: BrandLogoAsset = {
  src: '/assets/brand/kineticare-horizontal-white.svg',
  width: 383,
  height: 51,
}

/**
 * Vízszintes, színes logó „KÉZREHABILITÁCIÓ” felirattal (a csomag
 * `04-Horizontal-Tagline/KINETICARE_Horizontal_Tagline_Colour_Default.svg`,
 * bitre azonosan). A tulajdonosok kérése (2026-09-23): a fejléc, a lábléc és
 * a 404-oldal ezt viseli a felirat nélküli változat helyett.
 *
 * Mérve (a rajz saját egységeiben, Chromium `getBBox`): a „KINETICARE”
 * betűmagassága mindkét vízszintes rajzban 36,4 egység, a felirat nagybetűi
 * 10,5 egység magasak; a teljes rajz 67,16 egység. A felirat nagybetűje tehát
 * a megjelenített logómagasság 15,6%-a (a méretek levezetése: `layout.css`).
 */
export const BRAND_LOGO_HORIZONTAL_TAGLINE: BrandLogoAsset = {
  src: '/assets/brand/kineticare-horizontal-tagline.svg',
  width: 417,
  height: 67,
}

/** A feliratos vízszintes logó fehér változata sötét felületre (tartalék). */
export const BRAND_LOGO_HORIZONTAL_TAGLINE_WHITE: BrandLogoAsset = {
  src: '/assets/brand/kineticare-horizontal-tagline-white.svg',
  width: 417,
  height: 67,
}

/** Csak a két kéz (az app-ikonok forrása). */
export const BRAND_LOGO_ICON: BrandLogoAsset = {
  src: '/assets/brand/kineticare-icon.svg',
  width: 1960,
  height: 1042,
}

/**
 * A logókép alternatív szövege: a márkanév, semmi más (WCAG 2.2 SC 1.1.1;
 * W3C WAI Images Tutorial, „Functional Images": a logó-linknél a szöveg a
 * márkát nevezi meg, nem azt, hogy „logó":
 * https://www.w3.org/WAI/tutorials/images/functional/). A LINK hozzáférhető
 * nevét a fejlécben az `aria-label="Kineticare kezdőlap"` adja (a 404-oldallal
 * bitre azonosan, SC 3.2.4).
 */
export const BRAND_LOGO_ALT = 'Kineticare'
