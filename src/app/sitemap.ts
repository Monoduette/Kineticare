import type { MetadataRoute } from 'next'

import {
  HOME_PAGE_SLUG,
  getAllPublishedPages,
  getContentCategories,
  getPosts,
  getPublishedProducts,
} from '@/lib/cms'
import { courseHref } from '@/lib/course-url'
import { absoluteUrl } from '@/lib/seo'
import { categoriesWithPosts } from '@/lib/tudastar'
import { ujTudastarSlug } from '@/lib/tudastar/eeat-kapu'

/**
 * sitemap.xml — a Next.js metadata-API generálja (`/sitemap.xml`).
 *
 * `force-dynamic`: a sitemap a CMS-ből épül, ezért NEM generálható build-időben.
 * A CI-ben (és bármely DB nélküli buildnél) a lekérdezés amúgy is üres listát
 * adna vissza — az a sitemap pedig hetekig kint ragadna. Kérésidőben generálva
 * mindig a valós, aktuális tartalom kerül bele.
 *
 * A `getAll*` lekérdezések a cms.ts `safeQuery` burkolójában futnak: DB-hiba
 * esetén üres listát adnak és naplóznak, tehát a sitemap sosem 500-azik —
 * legfeljebb a statikus útvonalakat tartalmazza.
 *
 * ═══ MI KERÜL BE, ÉS MI NEM (a döntés indoklása) ═══
 *
 * A vezérelv a Google saját megfogalmazása: „Include the URLs in your sitemap
 * that you want to see in Google's search results", és duplikáció esetén
 * „choose the URL you prefer and include that in the sitemap instead of all
 * URLs that lead to the same content"
 * (https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).
 *
 * BENNE VAN
 *  - `/`, `/kurzusok`, `/blog`, `/kapcsolat` — a négy állandó, statikus lap.
 *  - MINDEN published CMS-oldal (`pages`): `/szolgaltatasok`, `/rolunk`, és a
 *    jogi lapok (`/aszf`, `/adatvedelem`, `/impresszum`) is. Ezek nem külön
 *    route-ok, hanem a `[slug]` útvonalon élő CMS-oldalak, ezért a
 *    `getAllPublishedPages` automatikusan hozza őket — új jogi vagy tájékoztató
 *    lap külön kódmódosítás nélkül bekerül.
 *  - MINDEN published blogposzt (`/blog/<slug>`).
 *  - Azok a tartalom-kategóriák, amelyekhez van legalább egy published poszt.
 *  - MINDEN published kurzus, a KANONIKUS (slugos) címén.
 *
 * NINCS BENNE, és miért
 *  - ÜRES kategória-oldal: tartalom nélküli, 200-zal válaszoló lap, amit a
 *    Google „soft 404"-ként kezel; a route maga is `noindex, follow` jelzést
 *    ad rá (blog/kategoria/[slug]/page.tsx). Amint az első cikk megjelenik a
 *    témában, a cím MAGÁTÓL bekerül — külön teendő nincs.
 *  - `/kurzusok?kategoria=<slug>` és `/blog?kategoria=<slug>`: ugyanaz a
 *    tartalom más címen; a kanonikus alak a szűretlen lista, illetve a
 *    dedikált `/blog/kategoria/<slug>` oldal.
 *  - Régi, id-alapú kurzus-URL (`/kurzusok/2`): tartós (308) átirányítást ad a
 *    beszédes címre, tehát átirányított cím lenne a sitemapben.
 *  - Tranzakciós és bejelentkezés mögötti útvonalak (`/kosar`, `/penztar`,
 *    `/fizetes/…`, `/sikertelen`, `/belepes`, `/regisztracio`,
 *    `/elfelejtett-jelszo`, `/jelszo-visszaallitas`, `/fiok`, `/kurzusaim`,
 *    `/admin`, `/api/…`, `/next/…`): a `robots.txt` mindet tiltja
 *    (src/app/robots.ts), és felhasználóhoz kötött vagy egyszer használatos
 *    állapotot mutatnak.
 *  - 404-oldal, előnézeti (draft) tartalom: nem nyilvános, indexelhető lap.
 */
export const dynamic = 'force-dynamic'

/** Statikus, mindig létező storefront-útvonalak. */
const STATIC_ROUTES: ReadonlyArray<{
  path: string
  priority: number
  changeFrequency: 'daily' | 'weekly' | 'monthly'
}> = [
  { path: '/', priority: 1, changeFrequency: 'weekly' },
  { path: '/kurzusok', priority: 0.9, changeFrequency: 'weekly' },
  { path: '/blog', priority: 0.8, changeFrequency: 'daily' },
  { path: '/kapcsolat', priority: 0.5, changeFrequency: 'monthly' },
]

/** A doc `updatedAt` mezője Date-ként; hiányzó/érvénytelen érték esetén undefined. */
function lastModified(value: unknown): Date | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** Slug-gal rendelkező dokumentum (üres slug esetén a cím értelmetlen lenne). */
function hasSlug(doc: { slug?: string | null }): boolean {
  return typeof doc.slug === 'string' && doc.slug.length > 0
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [pages, posts, categories, products] = await Promise.all([
    getAllPublishedPages(),
    getPosts({ limit: 500 }),
    getContentCategories(),
    getPublishedProducts(500),
  ])

  const entries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: absoluteUrl(route.path),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }))

  // A statikus lista útvonalai (normalizált alakban): amit már felvettünk, azt
  // a CMS-oldalak körében nem szabad MÉGEGYSZER kiírni.
  const staticPaths = new Set(STATIC_ROUTES.map((route) => route.path))

  // CMS-oldalak — a kezdőlap kimarad, mert a `/` már a statikus listában van.
  // A jogi lapok (/aszf, /adatvedelem, /impresszum) is ezen az ágon kerülnek be.
  //
  // Ugyanígy kimarad minden olyan slug, amihez DEDIKÁLT route tartozik, és az
  // már szerepel a statikus listában: a /kapcsolat lap például saját route, de
  // a szekciósorát egy azonos slugú CMS-oldal adja (lásd a kapcsolat/page.tsx
  // fejlécét). A fájlrendszer-útvonal erősebb a `[slug]`-nál, tehát a CMS-oldal
  // úgysem látszana; a sitemapben viszont duplikált sor lenne ugyanarra a címre.
  //
  // A `hasSlug` őr a slug NÉLKÜLI (piszkozat, elrontott) rekordot zárja ki:
  // enélkül `/undefined` alakú cím kerülne a sitemapbe.
  for (const page of pages) {
    if (page.slug === HOME_PAGE_SLUG || !hasSlug(page) || staticPaths.has(`/${page.slug}`)) {
      continue
    }
    // URL-LOCK: a két új cikk kanonikus címe `/blog/<slug>`. Gyökér pages-URL
    // a sitemapbe nem kerül, még ha a CMS-ben létezne is a rekord.
    if (ujTudastarSlug(page.slug)) {
      continue
    }
    entries.push({
      url: absoluteUrl(`/${page.slug}`),
      lastModified: lastModified(page.updatedAt),
      changeFrequency: 'monthly',
      priority: 0.6,
    })
  }

  for (const post of posts) {
    if (!hasSlug(post)) {
      continue
    }
    entries.push({
      url: absoluteUrl(`/blog/${post.slug}`),
      lastModified: lastModified(post.updatedAt),
      changeFrequency: 'monthly',
      priority: 0.7,
    })
  }

  // Csak a NEM ÜRES kategóriák: az üres témalap tartalom nélküli (soft 404),
  // és a route maga is noindexeli. A szűrés a már lekérdezett posztokból
  // dolgozik, tehát egyetlen plusz adatbázis-kör sincs.
  for (const category of categoriesWithPosts(categories, posts)) {
    entries.push({
      url: absoluteUrl(`/blog/kategoria/${category.slug}`),
      changeFrequency: 'weekly',
      priority: 0.5,
    })
  }

  // A kurzus KANONIKUS címe a slug (C3); slug nélküli, régi terméknél marad az
  // id-alapú út — a sitemapbe így sosem kerül átirányított (301-es) URL.
  for (const product of products) {
    entries.push({
      url: absoluteUrl(courseHref(product)),
      lastModified: lastModified(product.updatedAt),
      changeFrequency: 'weekly',
      priority: 0.9,
    })
  }

  return entries
}
