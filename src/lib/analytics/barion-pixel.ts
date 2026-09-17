/**
 * Barion alap (Base) pixel — Smart Gateway feltétel; nem kerül süti-kapu mögé (csalásmegelőzés).
 * Pixel ID szigorú minta (XSS ellen).
 */

/** A Barion Pixel origója (a script, az iframe-ek és a noscript-kép hostja). */
export const BARION_PIXEL_ORIGIN = 'https://pixel.barion.com'

/** Az alap Pixel betöltendő scriptje (a hivatalos snippet `src`-je). */
export const BARION_PIXEL_SCRIPT_SRC = `${BARION_PIXEL_ORIGIN}/bp.js`

/**
 * A JS nélküli tartalék-képpont hostja.
 *
 * Külön néven is közzétéve, mert a szerződés (más modulok importja) erre a
 * névre épül; értéke azonos a `BARION_PIXEL_ORIGIN`-nal — a Barion mindent
 * ugyanarról a hostról szolgál ki.
 */
export const BARION_PIXEL_NOSCRIPT_HOST = BARION_PIXEL_ORIGIN

/**
 * A Pixel-azonosító megengedett alakja: `BP-` + 10 jel + `-` + 2 jel
 * (pl. `BP-0000000000-00`, a Barion doksi mintája), összesen 16 karakter.
 *
 * A hosszakat a bp.js maga is így kezeli: a saját tartalék-kikeresője a
 * `/.*BP-.{10}-.*​/` mintát futtatja, és 16 karaktert vág ki
 * (`script.substr(script.indexOf("BP-"), 16, 16)`).
 *
 * KIS-NAGYBETŰ SZÁMÍT: a Barion-azonosítók vegyes betűállásúak (a hivatalos
 * kiadott azonosítók is azok), ezért — a GA4-azonosítóval ellentétben —
 * NEM normalizáljuk nagybetűsre, csak a körüli szóközöket vágjuk le.
 *
 * A `BPT`-vel kezdődő azonosító (a Barion admin más felületén látható érték)
 * NEM Pixel-azonosító, a Pixellel nem működik — a horgonyzott `^BP-` előtag
 * ezt eleve kizárja.
 */
const BARION_PIXEL_ID_PATTERN = /^BP-[A-Za-z0-9]{10}-[A-Za-z0-9]{2}$/

/** Szabályos alakú-e a megadott Pixel-azonosító. */
export function isBarionPixelId(value: string): boolean {
  return BARION_PIXEL_ID_PATTERN.test(value)
}

/**
 * A beállított Pixel-azonosító (`NEXT_PUBLIC_BARION_PIXEL_ID`), ALAKRA is
 * ellenőrizve. Hiányzó vagy formailag hibás érték esetén `null` — ilyenkor a
 * Pixel teljesen kimarad (fejlesztésben és CI-ben nincs kulcs, ez nem hiba).
 *
 * @param env teszteléshez injektálható környezet. Elhagyva a valódi
 *   `process.env`-ből olvas. A `process.env.NEXT_PUBLIC_BARION_PIXEL_ID`
 *   SZÓ SZERINTI hivatkozás — a Next.js a `NEXT_PUBLIC_` változókat csak így,
 *   statikus alakban tudja build-időben beégetni a kliens-csomagba.
 */
export function getBarionPixelId(env?: Record<string, string | undefined>): string | null {
  const raw =
    env === undefined ? process.env.NEXT_PUBLIC_BARION_PIXEL_ID : env.NEXT_PUBLIC_BARION_PIXEL_ID
  const candidate = (typeof raw === 'string' ? raw : '').trim()
  return isBarionPixelId(candidate) ? candidate : null
}

/**
 * A JS nélküli tartalék-képpont URL-je.
 *
 * A hivatalos snippet alakját követi (a `ba_pixel_id` értéke a dokumentációban
 * aposztrófok között áll — szándékosan nem térünk el tőle).
 */
export function barionPixelNoscriptUrl(pixelId: string): string {
  return `${BARION_PIXEL_NOSCRIPT_HOST}/a.gif?ba_pixel_id='${pixelId}'&ev=contentView&noscript=1`
}

/** A globális `bp` várt alakja (a snippet sorbaállítója, majd a valódi bp.js). */
type BarionPixelFunction = (...args: readonly unknown[]) => void

/**
 * Biztonságos Pixel-hívás.
 *
 * - SSR/teszt (nincs `window`) → néma no-op.
 * - A snippet még nem futott le (nincs `window.bp`) → néma no-op. Ez NEM
 *   elméleti eset: azonosító nélküli környezetben (fejlesztés, CI) a snippet
 *   egyáltalán nem kerül ki, az eseményküldő kódnak mégis futnia kell.
 * - A hívás SOSEM dob: egy elszálló Pixel nem viheti magával a pénztárat.
 *
 * A hívás előtti sorbaállítás magától megoldott: a hivatalos snippet `bp`-je a
 * bp.js megérkezéséig a `bp.q` sorba gyűjti az `arguments`-eket.
 */
export function bp(...args: readonly unknown[]): void {
  if (typeof window === 'undefined') {
    return
  }
  const candidate = (window as unknown as { bp?: unknown }).bp
  if (typeof candidate !== 'function') {
    return
  }
  try {
    ;(candidate as BarionPixelFunction)(...args)
  } catch {
    // Szándékosan elnyelve: a mérés hibája nem törheti meg a vásárlói folyamatot.
  }
}
