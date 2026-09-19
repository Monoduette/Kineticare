import { COURSE_BASE_PATH, courseHref } from './course-url'
import { courseTitle, isPaidCourse, parseCourseIdParam } from './courses'
import type { Media, Product } from '../payload-types'

/**
 * A CTA-sáv (ctaBanner) kurzus-borítója — a gomb CÉLJÁBÓL feloldva.
 *
 * Tulajdonosi kérés (2026-09-19): a kezdőlap záró „Kezdd el még ma" sávjába
 * és a /rolunk „Kezdd el otthon, a saját tempódban" sávjába „picibe" kerüljön
 * a kurzus képe. Új upload-mező a blokkon adatbázis-migrációt igényelne (a
 * postgres-adapter a blokkmezőket oszlopként tárolja), ezért a kép NEM új
 * CMS-mező: a sáv a gomb webcíméből találja ki, melyik kurzusról szól, és a
 * termék meglévő borítóképét (`products.coverImage`) mutatja. Nincs migráció,
 * nincs séma- és `payload-types`-változás, a szerkesztő ugyanazzal a három
 * link-mezővel dolgozik tovább.
 *
 * A feloldás szabálya (tiszta függvény, DB nélkül tesztelhető):
 *  1. `/kurzusok/<slug>` (vagy a régi, id-alapú `/kurzusok/<id>`) → PONTOSAN az
 *     a kurzus, amelynek kanonikus címe (`courseHref`) egyezik; query és
 *     horgony (`?utm…`, `#kurzus-vasarlas-gomb`) nem számít.
 *  2. `/kurzusok` (a kurzuslista) → a kínálat ELSŐ FIZETŐS kurzusa. Ez az
 *     élő tartalom esete: a két kért sáv gombja ma a listára mutat (lásd
 *     src/lib/home-seed.ts és src/scripts/restore-legacy-content.ts), a
 *     szövegük viszont az otthoni programról beszél, tehát a „kurzusos kép"
 *     ott a fizetős program borítója. A sorrend a `showcaseProducts`
 *     rácsé (fizetős elöl), így ugyanaz a kurzus vezet itt is, mint a
 *     kurzusrácsban.
 *  3. Minden más cél (/kapcsolat, külső URL, üres) → nincs kép, a sáv
 *     változatlan. Borítókép nélküli kurzusnál szintén nincs kép: tartalék
 *     illusztrációt nem találunk ki.
 *
 * MIÉRT másodlagos elem a kép, és miért kicsi: NN/g, Visual Hierarchy
 * (https://www.nngroup.com/articles/visual-hierarchy-ux-definition/): a méret
 * a hangsúly eszköze, a sáv EGY elsődleges cselekvése a gomb, ezért a kép a
 * címnél és a gombnál kisebb súlyú; NN/g, Photos as Web Content
 * (https://www.nngroup.com/articles/photos-as-web-content/): a látogató a
 * VALÓDI, tartalomhoz kötött képet nézi meg, a töltelék-fotót átugorja, ezért
 * kizárólag a kurzus saját borítója jöhet szóba; NN/g, Image-Focused Design
 * (https://www.nngroup.com/articles/image-focused-design/): a nagy kép a
 * szöveg és a CTA elől veszi el a helyet, „nagyobb" nem jobb.
 */

/** A sáv képének megjelenítéséhez szükséges adat. */
export interface CtaBannerCourseCover {
  /** A populált média (url + sizes + alt), a MediaImage bemenete. */
  media: Media
  /** A kurzus címe: az alt-szöveg tartaléka, ha a médiának nincs alt-ja. */
  title: string
  /** A feloldott kurzus kanonikus címe (teszt és naplózás). */
  href: string
}

/**
 * A gomb webcímének útvonal-része: query és horgony nélkül, záró perjel
 * nélkül. Csak a belső (perjellel kezdődő) címeket tekinti útvonalnak; a
 * teljes URL-ek (https://…) sosem kurzus-hivatkozások a sávban.
 */
function ctaPathname(url: string | null | undefined): string | null {
  const trimmed = typeof url === 'string' ? url.trim() : ''
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return null
  }
  const withoutHash = trimmed.split('#', 1)[0] ?? ''
  const withoutQuery = withoutHash.split('?', 1)[0] ?? ''
  const pathname = withoutQuery.replace(/\/+$/, '')
  return pathname.length > 0 ? pathname : '/'
}

/** A termék populált borítóképe, ha url-lel együtt megvan; különben null. */
function populatedCover(product: Pick<Product, 'coverImage'>): Media | null {
  const cover = product.coverImage
  if (typeof cover !== 'object' || cover === null) {
    return null
  }
  const hasUrl =
    (typeof cover.url === 'string' && cover.url.length > 0) ||
    Object.values(cover.sizes ?? {}).some(
      (size) => typeof size?.url === 'string' && size.url.length > 0,
    )
  return hasUrl ? cover : null
}

/**
 * A CTA-sáv gombjához tartozó kurzus borítója, vagy null.
 *
 * @param url      a `cta.url` mező nyers értéke
 * @param products a lapon kiadható kurzusok, a kurzusrács sorrendjében
 *                 (`showcaseProducts`: publikált, fizetős elöl, igazolt
 *                 ingyenes SOS hátul) — a hívó (RenderBlocks) már megszűrte
 */
export function resolveCtaBannerCourseCover(
  url: string | null | undefined,
  products: readonly Product[],
): CtaBannerCourseCover | null {
  const pathname = ctaPathname(url)
  if (pathname === null) {
    return null
  }

  let product: Product | undefined
  if (pathname === COURSE_BASE_PATH) {
    product = products.find((candidate) => isPaidCourse(candidate))
  } else if (pathname.startsWith(`${COURSE_BASE_PATH}/`)) {
    // A régi, id-alapú /kurzusok/<id> cím akkor is ugyanaz a kurzus, ha a
    // terméknek AZÓTA van slugja (a route tartósan a kanonikus címre
    // irányít, lásd course-url.ts) — a sáv sem veszítheti el a borítót.
    const segment = pathname.slice(COURSE_BASE_PATH.length + 1)
    const legacyId = segment.includes('/') ? null : parseCourseIdParam(segment)
    product = products.find(
      (candidate) =>
        courseHref(candidate) === pathname || (legacyId !== null && candidate.id === legacyId),
    )
  }
  if (!product) {
    return null
  }

  const media = populatedCover(product)
  if (!media) {
    return null
  }
  return { media, title: courseTitle(product), href: courseHref(product) }
}

/**
 * A /rolunk CTA-sávjának („Kezdd el otthon, a saját tempódban") statikus
 * kurzus-montázsa (WP54, tulajdonosi 2. kör, 2026-09-19: ide „összevágott
 * képet a kurzusból" kértek a borító helyett).
 *
 * A kép a fotózás három otthoni gyakorlat-fotójából sharp-pal összeállított
 * triptichon (public/media/team/course-montage-rolunk-1600.webp, manifest
 * `rolunk-cta-montage`): 1600×1067 (3:2), három 528 px-es oszlop, köztük
 * 8 px fehér hézag, lekerekítés nélkül. Az arány a sáv `.kc-cta-banner__figure`
 * keretének 3:2-es, `contain` dobozát tölti ki vágás nélkül (cta-banner.css).
 * Nem CMS-mező (migrációt kívánna), nem lekérdezés: tiszta függvény, a
 * [slug] route adja át a `rolunk` slugon, a kezdőlap a kurzus-borítónál marad.
 *
 * MIÉRT a gyakorlatok és nem a packshot: NN/g, Photos as Web Content: a
 * látogató a tartalomhoz kötött, valódi jelenetet nézi meg, a termékborító
 * a Rólunk-történet végén nem mond újat
 * (https://www.nngroup.com/articles/photos-as-web-content/); Material 3,
 * Cards: a média a tartalom kísérője, nem önálló cselekvés, ezért a montázs
 * nem link (https://m3.material.io/components/cards/guidelines); WCAG 2.2
 * SC 1.1.1: a három jelenetet az alt sorolja fel
 * (https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html).
 */
export const ROLUNK_CTA_MONTAZS_FILE = 'course-montage-rolunk-1600.webp'

export function rolunkCtaMontazs(): Media {
  return {
    id: 87020,
    alt: 'Három gyakorlat az otthoni kurzusból: gumiszalagos csuklónyújtás, puha labda szorítása és tüskés labdás alkarlazítás.',
    url: `/media/team/${ROLUNK_CTA_MONTAZS_FILE}`,
    filename: ROLUNK_CTA_MONTAZS_FILE,
    mimeType: 'image/webp',
    width: 1600,
    height: 1067,
    createdAt: '',
    updatedAt: '',
  }
}

/** A gomb célja kurzus-e (a lista vagy egy kurzus): ekkor jár a montázs. */
function ctaCoursePathname(url: string | null | undefined): string | null {
  const pathname = ctaPathname(url)
  if (pathname === null) {
    return null
  }
  return pathname === COURSE_BASE_PATH || pathname.startsWith(`${COURSE_BASE_PATH}/`)
    ? pathname
    : null
}

/**
 * A CTA-sáv képe: a lap statikus montázsa, ha a route adott ilyet (ma csak a
 * /rolunk) ÉS a gomb kurzusra mutat; különben a kurzus-borító feloldása.
 * A montázs a borító ELÉ sorol, de ugyanahhoz a feltételhez kötött (kurzus-
 * cél): /kapcsolat vagy külső cél mellett kép nélkül marad a sáv, ahogy a
 * borítós ág is. Borítókép nélküli kurzusnál a montázs akkor is megjelenik,
 * mert a fájl a repóban van, nem a termék adata.
 */
export function resolveCtaBannerFigure(
  url: string | null | undefined,
  products: readonly Product[],
  montazs: Media | null = null,
): CtaBannerCourseCover | null {
  if (!montazs) {
    return resolveCtaBannerCourseCover(url, products)
  }
  const pathname = ctaCoursePathname(url)
  if (pathname === null) {
    return null
  }
  const cover = resolveCtaBannerCourseCover(url, products)
  return { media: montazs, title: cover?.title ?? montazs.alt, href: cover?.href ?? pathname }
}
