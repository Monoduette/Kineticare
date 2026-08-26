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

/**
 * sitemap.xml — a Next.js metadata-API generálja (`/sitemap.xml`).
 * `force-dynamic`: a sitemap a CMS-ből épül, ezért NEM generálható build-időben.
 * BENNE VAN
 */
export const dynamic = 'force-dynamic'

/** Statikus, mindig létező storefront-útvonalak. */
const STATIC_ROUTES: ReadonlyArray<{ path: string; priority: number; changeFrequency: 'daily' | 'weekly' | 'monthly' }> = [
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
