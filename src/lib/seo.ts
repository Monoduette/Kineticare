import type { Metadata } from 'next'

import { courseTitle } from './courses'
import { rewriteVisitorDashLeftover } from './gondolatjel-leftover'
import { resolveServerUrl } from '../env'
import type { Media, Post, Product } from '../payload-types'
import { resolveSeoKeywords, type SeoKeywordRow } from './seo-keywords'
import { KURZUSLISTA_KULCSSZAVAK } from './tudastar/seo-kulcsszavak'

/**
 * Storefront SEO — title/description/og fallback. SeoDoc: pages/posts/products közös alak.
 */
export interface SeoDoc {
  /** Megjelenített cím (pages/posts: `title`; products: a `sku`-ból számolt név). */
  title: string
  /** Rövid bevezető (pages/posts: `excerpt`; products: `shortDescription`). */
  excerpt?: string | null
  seoTitle?: string | null
  seoDescription?: string | null
  /**
   * Szerkesztő által felvett keresőszavak. Üresen nincs meta keywords és
   * nincs JSON-LD keywords — H1-ből nem töltjük.
   */
  seoKeywords?: readonly SeoKeywordRow[] | null
  /** Megosztási kép — csak populate-olva (Media) használható, nyers id-ként nem. */
  ogImage?: (number | null) | Media
  /** Kép-tartalék az og:image-hez (pages/posts: `heroImage`; products: `coverImage`). */
  heroImage?: (number | null) | Media
}

export const SITE_NAME = 'Kineticare'
/**
 * A kanonikus oldal-gyökér — a keret-layout `metadataBase`-ével KÖZÖS
 * forrásból (src/env.ts `resolveServerUrl`). A CORS/CSRF-engedélylista
 * ugyanennek az env-értéknek az EREDETÉT kapja (`buildOriginAllowlist`), így
 * nem védhet más URL-t, mint amit a linkek és a megosztási képek hirdetnek.
 */
export const SITE_URL = resolveServerUrl()

/** Relatív útvonal → abszolút URL (JSON-LD-hez és og:image-höz). */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path
  }
  const base = SITE_URL.replace(/\/+$/, '')
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

export function resolveSeoTitle(doc: SeoDoc): string {
  const seoTitle = typeof doc.seoTitle === 'string' ? doc.seoTitle.trim() : ''
  return seoTitle.length > 0 ? seoTitle : doc.title
}

export function resolveSeoDescription(doc: SeoDoc): string | undefined {
  const seoDescription = typeof doc.seoDescription === 'string' ? doc.seoDescription.trim() : ''
  if (seoDescription.length > 0) {
    return seoDescription
  }
  const excerpt = typeof doc.excerpt === 'string' ? doc.excerpt.trim() : ''
  return excerpt.length > 0 ? excerpt : undefined
}

export { resolveSeoKeywords, SEO_KEYWORDS_MAX_ROWS } from './seo-keywords'
export type { SeoKeywordRow } from './seo-keywords'

function isMedia(value: unknown): value is Media {
  return typeof value === 'object' && value !== null && 'url' in value
}

/** Feloldott megosztási kép: abszolút URL + a Media kötelező alt-szövege. */
interface ResolvedOgImage {
  url: string
  alt: string
}

/** og:image feloldása egy Media-rekordból: og-méret előnyben, aztán az eredeti fájl. */
function mediaOgImage(media: Media | null | undefined): ResolvedOgImage | undefined {
  if (!media) return undefined
  const sized = media.sizes?.og?.url
  if (typeof sized === 'string' && sized.length > 0) {
    return { url: absoluteUrl(sized), alt: media.alt }
  }
  if (typeof media.url === 'string' && media.url.length > 0) {
    return { url: absoluteUrl(media.url), alt: media.alt }
  }
  return undefined
}

function resolveOgImage(doc: SeoDoc): ResolvedOgImage | undefined {
  const og = isMedia(doc.ogImage) ? doc.ogImage : null
  const hero = isMedia(doc.heroImage) ? doc.heroImage : null
  return mediaOgImage(og) ?? mediaOgImage(hero)
}

export function resolveOgImageUrl(doc: SeoDoc): string | undefined {
  return resolveOgImage(doc)?.url
}

/**
 * Metadata statikus (nem CMS) oldalhoz. openGraph blokk, hogy ne a layout OG-jére essen vissza.
 */
export function buildStaticPageMetadata(input: {
  title: string
  description: string
  path: string
  keywords?: readonly string[]
}): Metadata {
  const keywords = resolveSeoKeywords(input.keywords?.map((phrase) => ({ phrase })))
  return {
    title: input.title,
    description: input.description,
    ...(keywords ? { keywords } : {}),
    alternates: { canonical: input.path },
    openGraph: {
      title: input.title,
      description: input.description,
      url: absoluteUrl(input.path),
    },
  }
}

/**
 * Next Metadata-objektum egy CMS-dokumentumhoz (page/post/product közös).
 * A title a keret-layout template-je (%s | Kineticare) alá kerül.
 */
export function buildDocMetadata(doc: SeoDoc, path: string): Metadata {
  const description = resolveSeoDescription(doc)
  const keywords = resolveSeoKeywords(doc.seoKeywords)
  const ogImage = resolveOgImage(doc)
  return {
    title: resolveSeoTitle(doc),
    ...(description ? { description } : {}),
    ...(keywords ? { keywords } : {}),
    alternates: { canonical: path },
    openGraph: {
      title: resolveSeoTitle(doc),
      ...(description ? { description } : {}),
      url: absoluteUrl(path),
      ...(ogImage ? { images: [{ url: ogImage.url, alt: ogImage.alt }] } : {}),
    },
  }
}

const HOME_FALLBACK_TITLE = 'Kineticare | Kézrehabilitációs online kurzusplatform'
const HOME_FALLBACK_DESCRIPTION =
  'Kineticare: kézrehabilitációs online videókurzusok otthoni gyógytornászati programmal.'

/**
 * A kezdőlap HTML-címe. A keret-layout sablonja `%s | Kineticare`.
 * A CMS `seoTitle` már a márkanevet viseli (`Kineticare | …`), ezért a sablon
 * `… | Kineticare` utótagot duplázná. `title.absolute` kihagyja a sablont
 * (Next.js Metadata title:
 * https://nextjs.org/docs/app/api-reference/functions/generate-metadata#title).
 * Töltelék gondolatjel a címben tilos (`docs/ui-sztenderdek.md` §3.1.1);
 * a keresőtalálat-cím legyen egyedi és rövid (NN/g, Unique, Short Page Titles:
 * https://www.nngroup.com/articles/page-titles/).
 */
function homeDocumentTitle(title: string): Metadata['title'] {
  if (title.includes(SITE_NAME) || title.includes('|')) {
    return { absolute: title }
  }
  return title
}

/**
 * A `/` metaadata: a `kezdolap` CMS-oldal `buildDocMetadata` útján
 * (seoTitle / seoDescription / seoKeywords), nem a `/kezdolap` pathen.
 * Üres `seoKeywords` → a keywords kulcs kimarad; H1-ből nem töltjük.
 * Ha a CMS-oldal hiányzik, a statikus tartalék cím/leírás marad, keywords nélkül.
 */
export function buildHomeMetadata(home: SeoDoc | null | undefined): Metadata {
  if (!home) {
    return {
      ...buildStaticPageMetadata({
        title: HOME_FALLBACK_TITLE,
        description: HOME_FALLBACK_DESCRIPTION,
        path: '/',
      }),
      title: homeDocumentTitle(HOME_FALLBACK_TITLE),
    }
  }
  const metadata = buildDocMetadata(
    {
      title: home.title.trim() ? home.title : HOME_FALLBACK_TITLE,
      excerpt: home.excerpt ?? HOME_FALLBACK_DESCRIPTION,
      seoTitle: home.seoTitle,
      seoDescription: home.seoDescription,
      seoKeywords: home.seoKeywords,
      ogImage: home.ogImage,
      heroImage: home.heroImage,
    },
    '/',
  )
  const title = typeof metadata.title === 'string' ? metadata.title : HOME_FALLBACK_TITLE
  return { ...metadata, title: homeDocumentTitle(title) }
}

/** A `/kurzusok` lista címe — meta és JSON-LD közös forrás. */
export const COURSE_LISTING_TITLE = 'Kurzusok'

/** A `/kurzusok` lista leírása — meta és JSON-LD közös forrás. */
export const COURSE_LISTING_DESCRIPTION =
  'Kineticare online kézrehabilitációs kurzusok: otthoni gyakorlóprogramok és szakmai továbbképzések videós anyagokkal. Válaszd ki a hozzád illő kurzust, és kezdj el gyógyulni.'

/**
 * A `/` WebPage JSON-LD-je. A `keywords` csak a CMS `seoKeywords` mezőből
 * jön (`resolveSeoKeywords`); üresen a kulcs kimarad, a H1-et nem másoljuk.
 */
export function homeWebPageJsonLd(home: SeoDoc | null | undefined): Record<string, unknown> {
  if (!home) {
    return webPageJsonLd({
      name: SITE_NAME,
      description: HOME_FALLBACK_DESCRIPTION,
      path: '/',
    })
  }
  const title = home.title.trim() ? home.title : HOME_FALLBACK_TITLE
  return webPageJsonLd({
    name: resolveSeoTitle({ title, seoTitle: home.seoTitle }),
    description: resolveSeoDescription({
      title,
      excerpt: home.excerpt ?? HOME_FALLBACK_DESCRIPTION,
      seoDescription: home.seoDescription,
    }),
    path: '/',
    keywords: resolveSeoKeywords(home.seoKeywords),
  })
}

/**
 * A `/kurzusok` lista CollectionPage JSON-LD-je. Nincs pages-rekord — a
 * Search-lock 3 kifejezés a `resolveSeoKeywords` úton megy a `keywords`
 * kulcsba. SOS termékoldal ezt a segédet nem hívja.
 */
export function courseListingJsonLd(): Record<string, unknown> {
  return webPageJsonLd({
    name: COURSE_LISTING_TITLE,
    description: COURSE_LISTING_DESCRIPTION,
    path: '/kurzusok',
    type: 'CollectionPage',
    keywords: resolveSeoKeywords(KURZUSLISTA_KULCSSZAVAK.map((phrase) => ({ phrase }))),
  })
}

/**
 * Oldal-szintű Metadata a CMS-oldalak/blogposztok generateMetadata-jához —
 * vékony wrapper a buildDocMetadata fölé (title/description/og fallbacklánc
 * + canonical). A path a hívó felelőssége (pl. `/blog/${slug}` vagy `/${slug}`).
 */
export function buildPageMetadata(doc: SeoDoc, path: string): Metadata {
  return buildDocMetadata(doc, path)
}

/**
 * Kurzus (products) → SeoDoc adapter.
 *
 * A products collectionnek nincs `title`/`excerpt`/`heroImage` mezője: a
 * megjelenített név a `displayTitle` → `sku` lánc (courseTitle), a bevezető a
 * `shortDescription`, a képtartalék a `coverImage`. Az adapter csak ÁTNEVEZ — a
 * fallback-lánc maga a közös `buildDocMetadata`-ban fut, hogy a kurzusoldal
 * ugyanazt a logikát használja, mint a poszt- és az oldal-útvonal.
 */
export function productSeoDoc(
  product: Pick<
    Product,
    | 'id'
    | 'sku'
    | 'displayTitle'
    | 'shortDescription'
    | 'seoTitle'
    | 'seoDescription'
    | 'seoKeywords'
    | 'ogImage'
    | 'coverImage'
  >,
): SeoDoc {
  const name = courseTitle(product)
  return {
    title: name,
    // A rövid leírás hiánya ne hagyja meta-description nélkül a fő céloldalt:
    // ilyenkor a kurzus nevével képzett általános mondat megy ki (ez a lánc
    // HARMADIK foka, a seoDescription és a rövid leírás után).
    excerpt:
      typeof product.shortDescription === 'string' && product.shortDescription.trim().length > 0
        ? rewriteVisitorDashLeftover(product.shortDescription)
        : `${name} — online kézrehabilitációs kurzus a Kineticare kínálatából.`,
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    seoKeywords: product.seoKeywords,
    ogImage: product.ogImage,
    heroImage: product.coverImage,
  }
}

/**
 * Kurzus-szintű Metadata a /kurzusok/[slug] generateMetadata-jához.
 * Ugyanaz a fallback-lánc + canonical, mint a pages/posts útvonalakon.
 */
export function buildProductMetadata(
  product: Parameters<typeof productSeoDoc>[0],
  path: string,
): Metadata {
  return buildDocMetadata(productSeoDoc(product), path)
}

// ---------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------

/** Organization JSON-LD a kezdőlaphoz. */
export function organizationJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: absoluteUrl('/'),
    description:
      'Kineticare: kézrehabilitációs online videókurzusok otthoni gyógytornászati programmal.',
    // Az entitás egyértelműsítése AI-válaszokban: a nyelv és a működési terület
    // explicit megadása csökkenti a más márkákkal való összemosás esélyét.
    inLanguage: 'hu-HU',
    areaServed: 'HU',
    knowsAbout: [
      'kézrehabilitáció',
      'gyógytorna',
      'kéz- és csuklósérülés utáni rehabilitáció',
      'otthoni rehabilitációs gyakorlatok',
    ],
  }
}

/**
 * WebPage / CollectionPage JSON-LD. A `keywords` a `resolveSeoKeywords` kimenete:
 * üresen a kulcs kimarad, H1-ből vagy listacímből nem töltjük.
 */
export function webPageJsonLd(args: {
  name: string
  description?: string
  path: string
  type?: 'WebPage' | 'CollectionPage'
  keywords?: readonly string[]
}): Record<string, unknown> {
  const keywordText =
    args.keywords !== undefined && args.keywords.length > 0
      ? args.keywords.join(', ')
      : undefined
  return {
    '@context': 'https://schema.org',
    '@type': args.type ?? 'WebPage',
    name: args.name,
    url: absoluteUrl(args.path),
    inLanguage: 'hu-HU',
    ...(args.description ? { description: args.description } : {}),
    ...(keywordText !== undefined ? { keywords: keywordText } : {}),
  }
}

/**
 * FAQPage JSON-LD.
 *
 * A GYIK a leggyakrabban kivonatolt tartalomtípus AI-válaszokban: a kérdés-válasz
 * pár önmagában is értelmes egység, ezért közvetlenül idézhető. A `text` mezőbe
 * mindig a TELJES válasz kerüljön, ne csonkolt változat — a csonkolt válasz
 * félreidézhető.
 */
export function faqPageJsonLd(
  items: ReadonlyArray<{ question: string; answer: string }>,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: 'hu-HU',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  }
}

/**
 * BreadcrumbList JSON-LD.
 *
 * A morzsa a gépi olvasónak (keresőnek és AI-ágensnek egyaránt) megmutatja,
 * hol helyezkedik el az oldal a struktúrában — ez az „agentic discovery"
 * alapja: az ágens így tudja, hogy egy kurzusoldal a kurzuskínálat része.
 */
export function breadcrumbJsonLd(
  items: ReadonlyArray<{ name: string; path: string }>,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  }
}

/**
 * Kurzusoldal JSON-LD: egy entitás `["Course","Product"]` + `Offer`. Látható
 * tartalommal egyezik (H1, shortDescription, borító, ár). Ár nélkül nincs offers;
 * rating/review nincs. `keywords` csak CMS-ből — kitalálni tilos.
 */
export function courseJsonLd(args: {
  product: Pick<Product, 'shortDescription' | 'status' | 'sku' | 'seoKeywords'>
  name: string
  path: string
  priceHuf: number | null
  imageUrl?: string
}): Record<string, unknown> {
  const { product, name, path, priceHuf, imageUrl } = args
  const url = absoluteUrl(path)
  const description =
    typeof product.shortDescription === 'string' && product.shortDescription.trim().length > 0
      ? rewriteVisitorDashLeftover(product.shortDescription).trim()
      : undefined
  const sku =
    typeof product.sku === 'string' && product.sku.trim().length > 0
      ? product.sku.trim()
      : undefined
  const keywords = resolveSeoKeywords(product.seoKeywords)
  const organization = {
    '@type': 'Organization',
    name: SITE_NAME,
    url: absoluteUrl('/'),
  }
  return {
    '@context': 'https://schema.org',
    '@type': ['Course', 'Product'],
    name,
    ...(description ? { description } : {}),
    url,
    inLanguage: 'hu-HU',
    ...(imageUrl ? { image: [imageUrl] } : {}),
    ...(sku ? { sku } : {}),
    ...(keywords !== undefined ? { keywords: keywords.join(', ') } : {}),
    brand: {
      '@type': 'Brand',
      name: SITE_NAME,
    },
    provider: organization,
    hasCourseInstance: {
      '@type': 'CourseInstance',
      courseMode: 'online',
      inLanguage: 'hu-HU',
    },
    ...(priceHuf !== null
      ? {
          offers: {
            '@type': 'Offer',
            price: priceHuf,
            priceCurrency: 'HUF',
            url,
            availability:
              product.status === 'published'
                ? 'https://schema.org/InStock'
                : 'https://schema.org/Discontinued',
            seller: organization,
          },
        }
      : {}),
  }
}

/**
 * Blog (lista) JSON-LD a Tudástár lap- és kategória-oldalaihoz.
 *
 * Miért `Blog` és nem `ItemList`: a lap maga a Tudástár (illetve annak egy
 * témája), nem egy tetszőleges felsorolás — a `Blog` típus mondja meg a gépi
 * olvasónak, hogy cikkgyűjteményről van szó, a `blogPost` pedig az egyes
 * bejegyzésekre mutat.
 *
 * A `blogPost` lista KIZÁRÓLAG a ténylegesen megjelenített cikkekből épül, és
 * ÜRES listánál a mező kimarad. Ez nem formalitás: a strukturált adatnak a
 * látható tartalommal kell egyeznie (docs/seo-geo-llm.md 1. fejezet), és egy
 * nulla elemű gyűjtemény meghirdetése pontosan az az eltérés, ami miatt a
 * keresők elvetik a strukturált adatot.
 */
export function blogJsonLd(args: {
  name: string
  description?: string
  path: string
  posts: ReadonlyArray<Pick<Post, 'title' | 'slug' | 'excerpt' | 'publishedAt'>>
}): Record<string, unknown> {
  const { name, description, path, posts } = args
  const entries = posts.filter((post) => typeof post.slug === 'string' && post.slug.length > 0)
  return {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name,
    ...(description ? { description } : {}),
    url: absoluteUrl(path),
    inLanguage: 'hu-HU',
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: absoluteUrl('/'),
    },
    ...(entries.length > 0
      ? {
          blogPost: entries.map((post) => ({
            '@type': 'BlogPosting',
            headline: post.title,
            url: absoluteUrl(`/blog/${post.slug}`),
            ...(typeof post.excerpt === 'string' && post.excerpt.trim().length > 0
              ? { description: post.excerpt.trim() }
              : {}),
            ...(typeof post.publishedAt === 'string' ? { datePublished: post.publishedAt } : {}),
          })),
        }
      : {}),
  }
}

/** Article JSON-LD a blogposzt-oldalakhoz. */
export function articleJsonLd(args: {
  post: Pick<Post, 'title' | 'excerpt' | 'publishedAt' | 'updatedAt'>
  path: string
  authorName?: string
  imageUrl?: string
  /**
   * A cikk CMS `seoKeywords` mezőjének kifejezései.
   *
   * A schema.org szerint (ellenőrizve 2026-08-21) a `keywords` a CreativeWork-ön
   * áll, tehát az Article-on is érvényes, és „multiple textual entries in a
   * keywords list are typically delimited by commas”. Üres mezőnél a kulcs
   * kimarad — H1-ből kitalálni tilos.
   */
  keywords?: readonly string[]
  /**
   * A cikk tárgya entitásként. Nevesített betegségnél `MedicalCondition`,
   * panasznál `MedicalSignOrSymptom` — a schema.org hierarchiája szerint az
   * utóbbi az előbbi leszármazottja.
   */
  about?: { tipus: 'MedicalCondition' | 'MedicalSignOrSymptom'; nev: string }
}): Record<string, unknown> {
  const { post, path, authorName, imageUrl, keywords, about } = args
  const trimmedAuthor =
    typeof authorName === 'string' && authorName.trim().length > 0 ? authorName.trim() : undefined
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    ...(post.excerpt ? { description: post.excerpt } : {}),
    // A nyelv explicit megadása ugyanaz az entitás-egyértelműsítő lépés, mint
    // az Organization/FAQPage/Course sémákban: magyar nyelvű, magyar
    // közönségnek szóló tartalom (docs/seo-geo-llm.md).
    inLanguage: 'hu-HU',
    mainEntityOfPage: absoluteUrl(path),
    ...(typeof post.publishedAt === 'string' ? { datePublished: post.publishedAt } : {}),
    ...(typeof post.updatedAt === 'string' ? { dateModified: post.updatedAt } : {}),
    ...(imageUrl ? { image: [imageUrl] } : {}),
    ...(keywords !== undefined && keywords.length > 0 ? { keywords: keywords.join(', ') } : {}),
    ...(about !== undefined ? { about: { '@type': about.tipus, name: about.nev } } : {}),
    // Kitöltött név → Person. Üres szerzőnél NINCS author kulcs: a SITE_NAME
    // soha nem áll Person-ként (a Kineticare nem személy), és Organization
    // sem szerző-tartalék — a kiadó a `publisher`.
    ...(trimmedAuthor !== undefined ? { author: { '@type': 'Person', name: trimmedAuthor } } : {}),
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: absoluteUrl('/'),
    },
  }
}
