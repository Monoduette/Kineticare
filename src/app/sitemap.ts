import type { MetadataRoute } from 'next'
import { isLegacyNoindexPage } from '@/lib/legacy-noindex'

import {
  HOME_PAGE_SLUG,
  getAllPublishedPages,
  getContentCategories,
  getSitemapPosts,
  getSitemapProducts,
  type SitemapPost,
} from '@/lib/cms'
import { courseHref } from '@/lib/course-url'
import { absoluteUrl } from '@/lib/seo'
import { categoriesWithPosts } from '@/lib/tudastar'
import { isHubSlug, TUDASTAR_UTVONAL } from '@/lib/tudastar-kapcsolo'
import { getTudastarLathato } from '@/lib/tudastar-lathatosag'
import { hubAtiranyitasCel } from '@/lib/tudastar/hub-oldalak'
import type { Category } from '@/payload-types'

/**
 * sitemap.xml — a Next.js metadata-API generálja (`/sitemap.xml`).
 * `force-dynamic`: a sitemap a CMS-ből épül, ezért NEM generálható build-időben.
 *
 * BENNE VAN: a négy állandó útvonal, a publikált CMS-oldalak (jogi lapok,
 * tünet-hubok, rólunk, szolgáltatások), a cikkek KANONIKUS címükön, a nem
 * üres kategória-lapok, a kurzusok slugos címükön (borítóképpel).
 * NINCS BENNE: noindex/bejelentkezés mögötti/tranzakciós út (a robots.txt
 * tiltó listája és a `NOINDEX_ROBOTS`-os lapok), átirányító URL, piszkozat.
 * Kikapcsolt Tudástárnál (rejtett /blog menüpont, src/lib/tudastar-kapcsolo.ts)
 * a /blog, a cikkek, a kategóriák és a tünet-hubok sem: ezek a lapok ilyenkor
 * `noindex`-esek, a sitemap pedig csak indexelendő címet sorolhat fel.
 * A Google a sitemapet a KANONIKUS, 200-as, indexelhető URL-ek listájaként
 * kezeli (Google Search Central, *Build and submit a sitemap*:
 * https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap);
 * a `lastModified` csak valós módosítási dátum lehet, különben a Google
 * figyelmen kívül hagyja (ugyanott, „lastmod”). Képbejegyzés: *Image
 * sitemaps* (https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps).
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
  // WP49: a szakmai választó oldal (képzés vagy szakkönyv), kód-útvonal.
  { path: '/szakembereknek', priority: 0.6, changeFrequency: 'monthly' },
]

/** A doc `updatedAt` mezője Date-ként; hiányzó/érvénytelen érték esetén undefined. */
function lastModified(value: unknown): Date | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** A legkésőbbi dátum egy listából; üres/érvénytelen listánál undefined. */
function latestDate(values: ReadonlyArray<Date | undefined>): Date | undefined {
  let latest: Date | undefined
  for (const value of values) {
    if (value !== undefined && (latest === undefined || value.getTime() > latest.getTime())) {
      latest = value
    }
  }
  return latest
}

/** A populált borítókép abszolút URL-je; id-ként (populálatlanul) vagy üresen undefined. */
function coverImageUrl(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('url' in value)) {
    return undefined
  }
  const url = (value as { url?: unknown }).url
  return typeof url === 'string' && url.length > 0 ? absoluteUrl(url) : undefined
}

/** Slug-gal rendelkező dokumentum (üres slug esetén a cím értelmetlen lenne). */
function hasSlug(doc: { slug?: string | null }): boolean {
  return typeof doc.slug === 'string' && doc.slug.length > 0
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Rejtett Tudástárnál a cikkek és a kategóriák lekérdezése sem fut: üres
  // listával a lenti ágak egyetlen Tudástár-címet sem írnak ki.
  const tudastarLathato = await getTudastarLathato()
  const [allPages, posts, categories, products] = await Promise.all([
    getAllPublishedPages(),
    tudastarLathato ? getSitemapPosts(500) : Promise.resolve<SitemapPost[]>([]),
    tudastarLathato ? getContentCategories() : Promise.resolve<Category[]>([]),
    getSitemapProducts(500),
  ])
  // A tünet-hub (pages) Tudástár-cikk: rejtett Tudástárnál kimarad.
  const pages = tudastarLathato ? allPages : allPages.filter((page) => !isHubSlug(page.slug))

  // A statikus utak `lastModified`-ja a mögöttük álló CMS-tartalom VALÓS
  // módosítási ideje: a `/` és a `/kapcsolat` a saját CMS-oldaláé, a
  // `/kurzusok` a legfrissebb kurzusé, a `/blog` a legfrissebb cikké.
  // Ahol nincs ilyen adat, a mező kimarad (kitalált dátum nem kerül ki).
  const pageUpdatedAt = new Map<string, Date | undefined>(
    pages.filter(hasSlug).map((page) => [page.slug as string, lastModified(page.updatedAt)]),
  )
  const staticLastModified: Readonly<Record<string, Date | undefined>> = {
    '/': pageUpdatedAt.get(HOME_PAGE_SLUG),
    '/kapcsolat': pageUpdatedAt.get('kapcsolat'),
    '/kurzusok': latestDate(products.map((product) => lastModified(product.updatedAt))),
    '/blog': latestDate(posts.map((post) => lastModified(post.updatedAt))),
  }

  const staticRoutes = tudastarLathato
    ? STATIC_ROUTES
    : STATIC_ROUTES.filter((route) => route.path !== TUDASTAR_UTVONAL)
  const entries: MetadataRoute.Sitemap = staticRoutes.map((route) => {
    const modified = staticLastModified[route.path]
    return {
      url: absoluteUrl(route.path),
      ...(modified ? { lastModified: modified } : {}),
      changeFrequency: route.changeFrequency,
      priority: route.priority,
    }
  })

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
    if (
      page.slug === HOME_PAGE_SLUG ||
      !hasSlug(page) ||
      isLegacyNoindexPage(page) ||
      staticPaths.has(`/${page.slug}`)
    ) {
      continue
    }
    entries.push({
      url: absoluteUrl(`/${page.slug}`),
      lastModified: lastModified(page.updatedAt),
      changeFrequency: 'monthly',
      priority: 0.6,
    })
  }

  // A publikált pages-slugok halmaza a blog→gyökér átirányítás-döntéshez:
  // amelyik cikk témájának gyökér-hubja már publikált, annak a `/blog/…` címe
  // 308-cal a hubra irányít (blog/[slug]/page.tsx) — átirányított URL pedig
  // nem való a sitemapbe (lásd fent a Google-idézetet). A hub maga a pages-
  // ágon már bekerült.
  const publishedPageSlugs: ReadonlySet<string> = new Set(
    pages.filter(hasSlug).map((page) => page.slug as string),
  )

  for (const post of posts) {
    if (!hasSlug(post)) {
      continue
    }
    if (
      typeof post.slug === 'string' &&
      hubAtiranyitasCel(post.slug, publishedPageSlugs) !== null
    ) {
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
    const cover = coverImageUrl(product.coverImage)
    entries.push({
      url: absoluteUrl(courseHref(product)),
      lastModified: lastModified(product.updatedAt),
      changeFrequency: 'weekly',
      priority: 0.9,
      // Képbejegyzés a borítóképpel, ha van: a Google képkeresője a
      // sitemapból is felveszi a képet (Image sitemaps).
      ...(cover ? { images: [cover] } : {}),
    })
  }

  return entries
}
