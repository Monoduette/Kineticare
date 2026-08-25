import { getPayload } from 'payload'

import config from '../payload.config'
import type { Category, Page, Post, Product, Testimonial } from '../payload-types'
import { HOME_PAGE_SLUG } from './content-slugs'
import { reportUnpricedPublishedCourses } from './courses'
import { logger } from './logger'

/**
 * Storefront CMS-adatforrás (server component oldali lekérdezések).
 *
 * Konvenciók (az src/lib/menus.ts mintáját követve):
 * - Payload local API, ELŐ adat (kliensoldali fetch nincs).
 * - overrideAccess: true + EXPLICIT `status: published` szűrő: a nyilvános
 *   read-politika (src/access/publishedOrAdmin.ts) ezt anonim olvasóra már
 *   kikényszerítené, de így a draft-tartalom kizárása a kód egyetlen,
 *   tesztelt útvonalán, determinisztikusan történik — a draft sosem
 *   jelenhet meg publikusan.
 * - draft: false: a draft-verziózás miatti piszkozat-tartalom sem szivároghat
 *   be (mindig a legutóbb publikált verzió jön).
 * - Hibatűrés: lekérdezési hiba (pl. build-időben nincs DB) esetén biztonságos
 *   üres érték + logger.warn — az oldal ettől még renderel.
 */

/** A publikáltsági where-feltétel — a draft/published viselkedés egységes forrása. */
export const PUBLISHED_WHERE = { status: { equals: 'published' } } as const

// A slug definíciója az src/lib/content-slugs.ts-ben él (a Payload-config oldala
// is hivatkozik rá); itt csak továbbexportáljuk, hogy a meglévő
// `import { HOME_PAGE_SLUG } from '@/lib/cms'` hívások változatlanul működjenek.
export { HOME_PAGE_SLUG }

/**
 * Az egy-dokumentumos getterek opcionális kapcsolói.
 *
 * `draft: true` esetén a lekérdezés a legutóbbi PISZKOZAT verziót adja vissza, és
 * a published-szűrő is kikapcsol — enélkül a még sosem publikált tartalom
 * egyáltalán nem lenne megtalálható. Ezt kizárólag a szerkesztői előnézet
 * (Next draft mode, `/next/preview`) használhatja: oda csak staff/owner jut be.
 * A paraméter opcionális, a meglévő hívások viselkedése változatlan.
 */
export interface CmsDocQueryOptions {
  draft?: boolean
}

/** A publikáltsági szűrő — előnézetben (draft) szándékosan üres. */
const publishedWhere = (draft: boolean): Record<string, unknown> => (draft ? {} : PUBLISHED_WHERE)

async function safeQuery<T>(label: string, query: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await query()
  } catch (error) {
    logger.warn(`CMS-lekérdezés sikertelen (${label}) — üres értékkel renderelünk`, {
      error: error instanceof Error ? error.message : String(error),
    })
    return fallback
  }
}

/** Kezdőlap-tartalom: a 'kezdolap' slugú published oldal (hero + bevezető forrása). */
export async function getHomePage(options: CmsDocQueryOptions = {}): Promise<Page | null> {
  const draft = options.draft === true
  return safeQuery(
    'kezdolap',
    async () => {
      const payload = await getPayload({ config })
      const { docs } = await payload.find({
        collection: 'pages',
        where: { slug: { equals: HOME_PAGE_SLUG }, ...publishedWhere(draft) },
        limit: 1,
        depth: 1,
        draft,
        overrideAccess: true,
      })
      return docs[0] ?? null
    },
    null,
  )
}

/**
 * CMS-oldal slug alapján (alapból csak published; előnézetben a piszkozat is).
 *
 * `depth: 2` — a szerző- és lektor-blokk a populált user `name` / `credentials`
 * / `bioShort` / `portrait` mezőiből épül (ugyanaz a szerződés, mint a
 * `getPostBySlug`-nál). Depth 1 a usert feloldja, a portré médiáját nem;
 * nyers id-ként a Person JSON-LD és a látható blokk némán elmaradna, holott
 * a kapcsolat ki van töltve.
 */
export async function getPageBySlug(
  slug: string,
  options: CmsDocQueryOptions = {},
): Promise<Page | null> {
  const draft = options.draft === true
  return safeQuery(
    `oldal:${slug}`,
    async () => {
      const payload = await getPayload({ config })
      const { docs } = await payload.find({
        collection: 'pages',
        where: { slug: { equals: slug }, ...publishedWhere(draft) },
        limit: 1,
        depth: 2,
        draft,
        overrideAccess: true,
      })
      return docs[0] ?? null
    },
    null,
  )
}

/** Legfrissebb published posztok (publishedAt desc; publishedAt nélküliek a végén). */
export async function getLatestPosts(limit = 3): Promise<Post[]> {
  return safeQuery(
    'friss-posztok',
    async () => {
      const payload = await getPayload({ config })
      const { docs } = await payload.find({
        collection: 'posts',
        where: PUBLISHED_WHERE,
        limit,
        sort: '-publishedAt',
        depth: 1,
        draft: false,
        overrideAccess: true,
      })
      return docs
    },
    [],
  )
}

/** Bloglista: published posztok, opcionális kategória-szűréssel (id VAGY slug alapján). */
export async function getPosts(
  options: { categoryId?: number; categorySlug?: string; limit?: number } = {},
): Promise<Post[]> {
  const { categorySlug, limit = 60 } = options
  let { categoryId } = options
  // Kategória-slug → id feloldás: ismeretlen slug esetén nincs találat (üres
  // lista), nem esünk vissza a szűretlen listára.
  if (
    typeof categoryId !== 'number' &&
    typeof categorySlug === 'string' &&
    categorySlug.length > 0
  ) {
    const category = await getCategoryBySlug(categorySlug)
    if (!category) {
      return []
    }
    categoryId = category.id
  }
  return safeQuery(
    'poszt-lista',
    async () => {
      const payload = await getPayload({ config })
      const { docs } = await payload.find({
        collection: 'posts',
        where:
          typeof categoryId === 'number'
            ? { ...PUBLISHED_WHERE, categories: { contains: categoryId } }
            : PUBLISHED_WHERE,
        limit,
        sort: '-publishedAt',
        depth: 1,
        draft: false,
        overrideAccess: true,
      })
      return docs
    },
    [],
  )
}

/**
 * Összes published CMS-oldal a sitemaphoz.
 *
 * `depth: 0` — a sitemapnak csak a slug és az updatedAt kell, a relációk
 * populate-olása fölösleges kör lenne. A kezdőlapot a hívó kezeli külön
 * (a `kezdolap` slug a `/` útvonalon él, nem `/kezdolap`-on).
 */
export async function getAllPublishedPages(limit = 500): Promise<Page[]> {
  return safeQuery(
    'sitemap-oldalak',
    async () => {
      const payload = await getPayload({ config })
      const { docs } = await payload.find({
        collection: 'pages',
        where: PUBLISHED_WHERE,
        limit,
        depth: 0,
        draft: false,
        overrideAccess: true,
      })
      return docs
    },
    [],
  )
}

/** Poszt slug alapján — author/categories/relatedPosts populate-olva (depth 2). */
export async function getPostBySlug(
  slug: string,
  options: CmsDocQueryOptions = {},
): Promise<Post | null> {
  const draft = options.draft === true
  return safeQuery(
    `poszt:${slug}`,
    async () => {
      const payload = await getPayload({ config })
      const { docs } = await payload.find({
        collection: 'posts',
        where: { slug: { equals: slug }, ...publishedWhere(draft) },
        limit: 1,
        depth: 2,
        draft,
        overrideAccess: true,
      })
      return docs[0] ?? null
    },
    null,
  )
}

/**
 * Kapcsolódó posztok: az aktuális poszt kategóriáinak más published posztjai,
 * az aktuális poszt kizárásával (publishedAt desc). Kategória nélküli posztnál
 * nincs értelmezhető „kapcsolódó" halmaz — üres lista.
 */
export async function getRelatedPosts(post: Post, limit = 3): Promise<Post[]> {
  const categoryIds = Array.isArray(post.categories)
    ? post.categories.map((category) =>
        typeof category === 'object' && category !== null ? category.id : category,
      )
    : []
  if (categoryIds.length === 0) {
    return []
  }
  return safeQuery(
    `kapcsolodo-posztok:${post.id}`,
    async () => {
      const payload = await getPayload({ config })
      const { docs } = await payload.find({
        collection: 'posts',
        where: {
          ...PUBLISHED_WHERE,
          id: { not_equals: post.id },
          categories: { in: categoryIds },
        },
        limit,
        sort: '-publishedAt',
        depth: 1,
        draft: false,
        overrideAccess: true,
      })
      return docs
    },
    [],
  )
}

/** Tartalom-kategóriák (a blog kategória-szűrőjéhez és a kategória-oldalakhoz). */
export async function getContentCategories(): Promise<Category[]> {
  return safeQuery(
    'kategoriak',
    async () => {
      const payload = await getPayload({ config })
      const { docs } = await payload.find({
        collection: 'categories',
        where: { type: { equals: 'content' } },
        limit: 100,
        sort: 'title',
        depth: 0,
        overrideAccess: true,
      })
      return docs
    },
    [],
  )
}

/** Kategória slug alapján (content-típusú; a kategória-oldal 404-jéhez). */
export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  return safeQuery(
    `kategoria:${slug}`,
    async () => {
      const payload = await getPayload({ config })
      const { docs } = await payload.find({
        collection: 'categories',
        where: { slug: { equals: slug }, type: { equals: 'content' } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })
      return docs[0] ?? null
    },
    null,
  )
}

/**
 * A HIÁNYOSAN konfigurált (publikált, de beállítatlan ár-pipájú) termékek
 * hangos jelzése — a storefront MINDEN termék-listázó lekérdezése ezen megy át.
 *
 * Miért itt: ez az a pont, ahol a rosszul konfigurált termék a LÁTOGATÓ elé
 * kerülne. A riasztás (`logger.error`, „RIASZTÁS:" előtag) így pontosan akkor
 * szól, amikor a hibának üzleti következménye van — a szerkesztő hibája nem
 * marad némán (a tulajdonos gomb-hibájának gyökere ez volt).
 */
function withUnpricedCourseAlert(docs: Product[]): Product[] {
  reportUnpricedPublishedCourses(docs, logger)
  return docs
}

/**
 * Kurzus-kiemelés a kezdőlaphoz: published termékek (cover/cím/ár kártyákhoz).
 * A products publikáltsága a saját `status` selectje (draft/published/archived);
 * az archived sosem kerül ki a storefrontra.
 */
export async function getFeaturedProducts(limit = 3): Promise<Product[]> {
  return safeQuery(
    'kurzus-kiemeles',
    async () => {
      const payload = await getPayload({ config })
      const { docs } = await payload.find({
        collection: 'products',
        where: PUBLISHED_WHERE,
        limit,
        sort: '-createdAt',
        depth: 1,
        draft: false,
        overrideAccess: true,
      })
      return withUnpricedCourseAlert(docs)
    },
    [],
  )
}

/**
 * Összes published termék (a kezdőlap kurzus-kiemeléséhez): ugyanaz a
 * published-szűrt lekérdezés, mint a getFeaturedProducts, nagyobb alap-limittel.
 * Az archived/draft sosem kerül ki a storefrontra.
 */
export async function getPublishedProducts(limit = 12): Promise<Product[]> {
  return safeQuery(
    'published-termekek',
    async () => {
      const payload = await getPayload({ config })
      const { docs } = await payload.find({
        collection: 'products',
        where: PUBLISHED_WHERE,
        limit,
        sort: '-createdAt',
        depth: 1,
        draft: false,
        overrideAccess: true,
      })
      return withUnpricedCourseAlert(docs)
    },
    [],
  )
}

/**
 * A tudatosan ingyenes belépő kurzus (a cikk végi ajánló ingyenes sorához).
 *
 * „Ingyenes" definíció: KIZÁRÓLAG `priceInHUFEnabled === false` — a
 * beállítatlan (NULL) ár-pipa hiányos konfiguráció, nem ingyenes ajánlat
 * (lib/courses.ts, free-course-grant.ts ugyanezt a szabályt követi).
 * Hiba vagy találat hiánya esetén null: az ingyenes sor egyszerűen elmarad.
 */
export async function getFreeProduct(): Promise<Product | null> {
  return safeQuery(
    'ingyenes-termek',
    async () => {
      const payload = await getPayload({ config })
      const { docs } = await payload.find({
        collection: 'products',
        where: { and: [PUBLISHED_WHERE, { priceInHUFEnabled: { equals: false } }] },
        limit: 1,
        sort: '-createdAt',
        depth: 0,
        draft: false,
        overrideAccess: true,
      })
      return docs[0] ?? null
    },
    null,
  )
}

/**
 * Kiemelt vélemények a kezdőlapra (M6): látható ÉS kiemelt rekordok, `order`
 * szerint növekvő sorrendben, legfeljebb 3.
 *
 * A testimonials collectionben nincs verziózás/piszkozat (a láthatóságot a
 * `visible` pipa dönti el), ezért itt sem draft-, sem published-szűrő nem kell.
 * `depth: 0` — a szekciónak csak a szöveg és a szerző kell, reláció nincs.
 * Hiba esetén üres lista: a kezdőlap véleményszekciója ilyenkor egyszerűen
 * elmarad (kitalált idézet helykitöltőként sem jelenhet meg).
 */
export async function getTestimonials(limit = 3): Promise<Testimonial[]> {
  return safeQuery(
    'velemenyek',
    async () => {
      const payload = await getPayload({ config })
      const { docs } = await payload.find({
        collection: 'testimonials',
        where: { visible: { equals: true }, featured: { equals: true } },
        limit,
        sort: 'order',
        depth: 0,
        overrideAccess: true,
      })
      return docs
    },
    [],
  )
}
