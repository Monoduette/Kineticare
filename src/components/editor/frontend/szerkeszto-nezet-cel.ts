import { HOME_PAGE_SLUG } from '../../../lib/content-slugs'

/**
 * A fejléc „Szerkesztő nézet” belépőjének célja: az aktuális nyilvános
 * útvonalból a piszkozat-előnézet címe (`/next/preview?collection=…&slug=…`).
 *
 * Tiszta, függőségmentes modul (a kliens-komponens és a tesztek is hívják).
 * A leképezés a `/next/preview` route leképezésének (src/lib/preview/
 * preview-target.ts `previewTargetPath`) FORDÍTOTTJA: csak az az útvonal kap
 * belépőt, amelyre a route pontosan ugyanide irányít vissza. Így a belépő
 * sosem visz másik lapra (NN/g, Better Link Labels: „A link is a promise”,
 * https://www.nngroup.com/articles/better-link-labels/).
 *
 * MIÉRT NEM IMPORTÁLJA A preview-target.ts-t. A belépő kliens-komponense a
 * fejléc többi kliens-komponensével egy csomagba kerül, amelyet minden
 * látogató letölt (mérve a 3100-as szerveren, turbopack). A route saját
 * modulja a return-url.ts-t is behúzná; a két szabályt (egy szegmens, tiltott
 * `/`, `\`, `:` és vezérlőkarakter; kurzusnál a slug-minta) ezért itt
 * írjuk le, és az oda-vissza egyezést a teszt méri a route függvényével
 * (src/__tests__/szerkeszto-nezet-belepo.test.tsx).
 *
 *   /                 → pages / kezdolap
 *   /<slug>           → pages / <slug> (a kódbeli útvonalak kivételével)
 *   /blog/<slug>      → posts / <slug>
 *   /kurzusok/<slug>  → products / <slug>
 *   minden más        → nincs belépő
 */

/**
 * Az egyszegmensű, KÓDBAN élő útvonalak (a src/app/(frontend) statikus
 * könyvtárai): ezeknek nincs Oldalak-rekordja, a belépő ott nem jelenhet meg.
 * A /kapcsolat és a /szakembereknek kivétel (CMS_KODBELI_UTVONALAK): a
 * szekciósorukat az azonos slugú oldal adja, és a piszkozat-előnézetet
 * támogatják. Őr: a teszt a könyvtárlistával veti össze.
 */
export const KODBELI_UTVONALAK: ReadonlySet<string> = new Set([
  'api',
  'belepes',
  'belepes-atallas',
  'blog',
  'elfelejtett-jelszo',
  'fiok',
  'fizetes',
  'jelszo-visszaallitas',
  'kosar',
  'kurzusaim',
  'kurzusok',
  'next',
  'penztar',
  'regisztracio',
  'sikertelen',
  'styles',
])

/** A CMS-oldalból szekciósort kapó kódbeli útvonalak (a belépő itt is megjelenik). */
export const CMS_KODBELI_UTVONALAK: ReadonlySet<string> = new Set(['kapcsolat', 'szakembereknek'])

/** A blog és a kurzusok statikus alútvonalai (pl. /blog/kategoria/…): nem dokumentumok. */
const STATIKUS_ALUTVONALAK: Readonly<Record<string, ReadonlySet<string>>> = {
  blog: new Set(['kategoria']),
  kurzusok: new Set(),
}

/** Az előnézetet bekapcsoló route útvonala (a preview-target.ts `PREVIEW_PATH`-ja; a teszt összeveti). */
export const ELONEZET_UTVONAL = '/next/preview'

export interface SzerkesztoNezetCel {
  collection: 'pages' | 'posts' | 'products'
  slug: string
}

/** Oldal- és blog-slug: egy szegmens, elválasztó, séma-jel és vezérlőkarakter nélkül. */
function ervenyesSlug(slug: string): boolean {
  return (
    slug.trim() === slug &&
    slug.length > 0 &&
    !/[/\\:]/.test(slug) &&
    ![...slug].some((jel) => {
      const kod = jel.codePointAt(0) ?? 0
      return kod < 0x20 || kod === 0x7f
    })
  )
}

/** Kurzus-slug: kisbetű, szám, kötőjel; csupa szám (régi azonosító) nem. */
function ervenyesKurzusSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && !/^\d+$/.test(slug)
}

/** A dekódolt útvonal-szegmensek; hibás százalék-kódolásnál null. */
function szegmensek(pathname: string): string[] | null {
  const ut = pathname.split(/[?#]/, 1)[0] ?? ''
  if (!ut.startsWith('/')) {
    return null
  }
  const nyers = ut.replace(/\/+$/, '').split('/').slice(1)
  try {
    return nyers.map((resz) => decodeURIComponent(resz))
  } catch {
    return null
  }
}

/** Az útvonal előnézeti célja, vagy null (nincs belépő). */
export function szerkesztoNezetCel(pathname: string): SzerkesztoNezetCel | null {
  const reszek = szegmensek(pathname)
  if (reszek === null) {
    return null
  }
  if (reszek.length === 0) {
    return { collection: 'pages', slug: HOME_PAGE_SLUG }
  }
  if (reszek.length === 1) {
    const [slug = ''] = reszek
    // A /kezdolap nem a kezdőlap útvonala: a route a `/`-ra irányítana.
    return slug !== HOME_PAGE_SLUG && !KODBELI_UTVONALAK.has(slug) && ervenyesSlug(slug)
      ? { collection: 'pages', slug }
      : null
  }
  if (reszek.length === 2) {
    const [elso = '', slug = ''] = reszek
    if (elso === 'blog' && !STATIKUS_ALUTVONALAK.blog?.has(slug) && ervenyesSlug(slug)) {
      return { collection: 'posts', slug }
    }
    if (
      elso === 'kurzusok' &&
      !STATIKUS_ALUTVONALAK.kurzusok?.has(slug) &&
      ervenyesKurzusSlug(slug)
    ) {
      return { collection: 'products', slug }
    }
  }
  return null
}

/** A piszkozat-előnézet címe a célhoz (a `/next/preview` route paraméterei). */
export function szerkesztoNezetHref(cel: SzerkesztoNezetCel): string {
  const params = new URLSearchParams({ collection: cel.collection, slug: cel.slug })
  return `${ELONEZET_UTVONAL}?${params.toString()}`
}
