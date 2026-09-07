import type { Metadata } from 'next'

import { courseTitle } from './courses'
import { rewriteVisitorDashLeftover } from './gondolatjel-leftover'
import { resolveServerUrl } from '../env'
import type { Media, Post, Product } from '../payload-types'
import { resolveSeoKeywords, type SeoKeywordRow } from './seo-keywords'
import { cikkUtvonal } from './tudastar/hub-oldalak'
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

/** A márka egysoros jelmondata (keret-cím tartalék, manifest, WebSite séma). */
export const SITE_TAGLINE = 'Kézrehabilitációs online kurzusplatform'

/**
 * A márka alap-leírása: a keret-layout `description`-je, a WebSite és az
 * Organization séma leírása, a manifest és az llms.txt bevezetője.
 *
 * MÉRT kifejezésekből áll, nem fejből (`docs/ADATOK-mert.md`, Ahrefs HU,
 * 2026-08-21/24): kéztőalagút szindróma 1 200/hó (KD 5), ínhüvelygyulladás
 * 2 200/hó (KD 18), teniszkönyök 3 500/hó (KD 13), csuklófájdalom 150/hó
 * (KD 0). A meta description a Google szerint a lap tartalmának pontos,
 * egyedi összefoglalója, nem kulcsszólista (Google Search Central, *Control
 * your snippets*: https://developers.google.com/search/docs/appearance/snippet).
 * Hossza 120–160 karakter, mert a találati listában jellemzően 155–160
 * karakter látszik (`docs/seo-geo-llm.md` 5.4). Natív magyar mondat,
 * töltelék gondolatjel nélkül (`docs/ui-sztenderdek.md` §3.1).
 */
export const SITE_DESCRIPTION =
  'Kineticare: kézrehabilitáció gyógytornászoktól. Kéztőalagút szindróma, ínhüvelygyulladás, teniszkönyök, csuklófájdalom kezelése otthon és budapesti rendelőben.'

/**
 * A kapcsolati e-mail EGY forrásból: a lábléc ugyanezt írja ki
 * (`Footer.tsx` `FOOTER_CONTACT_EMAIL`), őr-teszt köti össze a kettőt. A
 * lábléc-komponens ide nem importálható (a robots/sitemap route-ok is ezt a
 * modult töltik, React-fa nélkül).
 */
export const CONTACT_EMAIL = 'info@kineticare.hu'

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

/**
 * Az alap megosztási kép: a `src/app/opengraph-image.tsx` ImageResponse-a
 * (1200×630, a márka betűivel és a csapatfotóval). Minden lap ezt örökli,
 * amelyiknek nincs saját CMS-képe.
 *
 * Miért 1200×630: az Open Graph protokoll nem ír elő méretet, de a
 * Facebook/LinkedIn megosztás-előnézete ezt az 1,91:1 arányt kéri, és a
 * Twitter `summary_large_image` kártyája is 2:1 közeli, ≥300×157 képet vár
 * (ogp.me: https://ogp.me/#structured; X Cards:
 * https://developer.x.com/en/docs/x-for-websites/cards/overview/summary-card-with-large-image).
 * Az `alt` az `og:image:alt` tulajdonságba kerül (ogp.me structured properties).
 */
export const DEFAULT_OG_IMAGE = {
  url: absoluteUrl('/opengraph-image'),
  width: 1200,
  height: 630,
  alt: 'Kineticare: kézrehabilitáció gyógytornászoktól',
} as const

/**
 * Indexelhető lap robots-metája.
 *
 * `max-image-preview:large` a nagy képes találat és a Discover előfeltétele,
 * `max-snippet:-1` és `max-video-preview:-1` pedig azt mondja, hogy a Google
 * annyi szöveget/videót mutathat a snippetben, amennyit jónak lát — enélkül
 * a keresőé a döntés, de az AI-válaszok (SGE/AI Overviews) is ezekből a
 * korlátokból dolgoznak (Google Search Central, *Robots meta tag
 * specifications*:
 * https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag).
 */
export const INDEX_ROBOTS: NonNullable<Metadata['robots']> = {
  index: true,
  follow: true,
  'max-image-preview': 'large',
  'max-snippet': -1,
  'max-video-preview': -1,
  googleBot: {
    index: true,
    follow: true,
    'max-image-preview': 'large',
    'max-snippet': -1,
    'max-video-preview': -1,
  },
}

/**
 * Bejelentkezés mögötti, tranzakciós vagy egyszer használatos lap robots-metája.
 *
 * A `robots.txt` tiltás önmagában NEM elég: a tiltott lapot a Google nem
 * járja be, tehát a `noindex`-et sem látná; viszont más oldalak linkjeiből
 * URL-ként mégis indexelheti (Google Search Central, *Block Search
 * indexing with noindex*:
 * https://developers.google.com/search/docs/crawling-indexing/block-indexing).
 * Ezért a lap saját meta-tagje mondja ki a noindexet. A `follow: true`
 * marad: a fejléc/lábléc nyilvános linkjei innen is bejárhatók.
 */
export const NOINDEX_ROBOTS: NonNullable<Metadata['robots']> = {
  index: false,
  follow: true,
  googleBot: { index: false, follow: true },
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

// ---------------------------------------------------------------------------
// <title>: a márka PONTOSAN egyszer
// ---------------------------------------------------------------------------

/**
 * A CMS-ből érkező címek végén álló márka-utótag (` | Kineticare`,
 * ` – Kineticare`, ` - Kineticare`). A keret-layout sablonja
 * (`%s | Kineticare`) ezt újra hozzáfűzné, és élesben pontosan ez történt:
 * „Szolgáltatások – Kineticare | Kineticare” (mérve 2026-09-07).
 */
const BRAND_SUFFIX = /\s*[|–—-]\s*Kineticare\s*$/iu

/**
 * A HTML-cím a keret-sablonhoz igazítva: a márka egyszer szerepel.
 *
 * - Ha a cím végén márka-utótag áll, levágjuk, és a sablon teszi vissza
 *   (` | Kineticare`), egységes alakban, gondolatjel nélkül.
 * - Ha a márka a cím BELSEJÉBEN áll (pl. `Kineticare | kézrehabilitáció…`),
 *   a sablont `title.absolute` kerüli meg (Next.js Metadata title:
 *   https://nextjs.org/docs/app/api-reference/functions/generate-metadata#title).
 * - Különben a nyers cím megy a sablon alá.
 *
 * A Google a title linket a `<title>` elemből képzi, és azt kéri, hogy legyen
 * rövid, egyedi, és a márkanév ne ismétlődjön benne (Google Search Central,
 * *Influencing your title links*:
 * https://developers.google.com/search/docs/appearance/title-link). Az NN/g
 * ugyanezt mondja a lapcímekre (Unique, Short Page Titles:
 * https://www.nngroup.com/articles/page-titles/). Töltelék gondolatjel a
 * címben tilos (`docs/ui-sztenderdek.md` §3.1.1).
 */
export function documentTitle(rawTitle: string): Metadata['title'] {
  const trimmed = rawTitle.trim()
  const stripped = trimmed.replace(BRAND_SUFFIX, '').trim()
  const title = stripped.length > 0 ? stripped : trimmed
  if (title.includes(SITE_NAME) || title.includes('|')) {
    return { absolute: title }
  }
  return title
}

/** A `documentTitle` eredményének szövege (a sablon nélkül). */
export function documentTitleText(title: Metadata['title']): string {
  if (typeof title === 'string') return title
  if (
    title &&
    typeof title === 'object' &&
    'absolute' in title &&
    typeof title.absolute === 'string'
  ) {
    return title.absolute
  }
  return ''
}

/**
 * A `<title>` teljes, sablonnal képzett alakja — a hosszmérő őr-teszteknek.
 * Sablon: `%s | Kineticare` (a keret-layout `title.template`-je).
 */
export function renderedDocumentTitle(title: Metadata['title']): string {
  if (title && typeof title === 'object' && 'absolute' in title) {
    return String(title.absolute)
  }
  return `${documentTitleText(title)} | ${SITE_NAME}`
}

/** A keresőben jellemzően megjelenő címhossz felső korlátja (karakter). */
export const DOCUMENT_TITLE_MAX = 60

// ---------------------------------------------------------------------------
// Metadata-építők
// ---------------------------------------------------------------------------

/** Egy megosztási kép a Next `openGraph.images` alakjában. */
type OgImageEntry = {
  url: string
  alt: string
  width?: number
  height?: number
}

/**
 * A közös meta-blokk minden nyilvános lapra: canonical, Open Graph, Twitter
 * kártya, robots. Egy helyen, hogy a lapok ne csúszhassanak szét.
 *
 * - `alternates.canonical`: relatív út, a `metadataBase` teszi abszolúttá
 *   (Google Search Central, *Consolidate duplicate URLs*:
 *   https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls).
 *   `alternates.languages` SZÁNDÉKOSAN nincs: egynyelvű oldal, kitalált
 *   hreflang hiba lenne.
 * - `openGraph`: `type`, `url`, `title`, `description`, `siteName`, `locale`
 *   és legalább egy `image` — az ogp.me négy kötelező tulajdonsága
 *   (`og:title`, `og:type`, `og:image`, `og:url`, https://ogp.me/#metadata)
 *   plusz a locale (`hu_HU`) és a site_name.
 * - `twitter.card: summary_large_image` a nagy képes kártya; a title,
 *   description és images mezőt a Next az Open Graph-ból tölti ki
 *   (X Cards markup: https://developer.x.com/en/docs/x-for-websites/cards/markup).
 */
function sharedMetadata(input: {
  title: string
  description?: string
  path: string
  image?: OgImageEntry
  type: 'website' | 'article'
  article?: ArticleMeta
}): Metadata {
  const { title, description, path, type } = input
  const image: OgImageEntry = input.image ?? { ...DEFAULT_OG_IMAGE }
  const article = input.article
  // `robots` itt SZÁNDÉKOSAN nincs: az indexelhető alapállapotot
  // (`INDEX_ROBOTS`) a keret-layout adja, és a Next a lap metaadatába
  // örökíti; a privát lapok `NOINDEX_ROBOTS`-szal írják felül. Így a lapok
  // metaadat-objektuma nem hordoz felesleges másolatot, és a kategória-lap
  // üres állapotában a `noindex` felülírás egyértelmű marad.
  return {
    alternates: { canonical: path },
    openGraph: {
      type,
      locale: 'hu_HU',
      siteName: SITE_NAME,
      title,
      ...(description ? { description } : {}),
      url: absoluteUrl(path),
      images: [image],
      ...(type === 'article' && article
        ? {
            ...(article.publishedTime ? { publishedTime: article.publishedTime } : {}),
            ...(article.modifiedTime ? { modifiedTime: article.modifiedTime } : {}),
            ...(article.authors && article.authors.length > 0
              ? { authors: [...article.authors] }
              : {}),
            ...(article.section ? { section: article.section } : {}),
            ...(article.tags && article.tags.length > 0 ? { tags: [...article.tags] } : {}),
          }
        : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      ...(description ? { description } : {}),
      images: [{ url: image.url, alt: image.alt }],
    },
  }
}

/**
 * Cikk-jellegű lap Open Graph kiegészítése (`og:type=article`).
 * A `article:published_time` / `article:modified_time` / `article:author`
 * az ogp.me `article` objektum tulajdonságai (https://ogp.me/#type_article).
 */
export interface ArticleMeta {
  publishedTime?: string | null
  modifiedTime?: string | null
  /** Szerzők NÉV szerint, ahogy a byline-ban állnak (kitalált profil-URL tilos). */
  authors?: readonly string[]
  section?: string
  tags?: readonly string[]
}

/**
 * Metadata statikus (nem CMS) oldalhoz — teljes Open Graph/Twitter/robots
 * blokkal, hogy egyetlen lap se essen vissza a keret-layout általános
 * megosztási adataira.
 */
export function buildStaticPageMetadata(input: {
  title: string
  description: string
  path: string
  keywords?: readonly string[]
  image?: OgImageEntry
}): Metadata {
  const keywords = resolveSeoKeywords(input.keywords?.map((phrase) => ({ phrase })))
  return {
    title: documentTitle(input.title),
    description: input.description,
    ...(keywords ? { keywords } : {}),
    ...sharedMetadata({
      title: input.title,
      description: input.description,
      path: input.path,
      type: 'website',
      ...(input.image ? { image: input.image } : {}),
    }),
  }
}

/**
 * Bejelentkezés mögötti, tranzakciós vagy egyszer használatos lap metaadata:
 * cím, leírás, canonical és NOINDEX. Megosztási kép nincs: ezeket a lapokat
 * nem osztja meg senki, és a Google sem indexeli.
 */
export function buildPrivatePageMetadata(input: {
  title: string
  description: string
  /**
   * Canonical út. Paraméteres privát lapnál (pl. `/kurzusaim/[id]`) elhagyva:
   * noindex mellett MÁSIK címre mutató canonical ellentmondó jelzés lenne.
   */
  path?: string
}): Metadata {
  return {
    title: documentTitle(input.title),
    description: input.description,
    ...(input.path ? { alternates: { canonical: input.path } } : {}),
    robots: NOINDEX_ROBOTS,
    openGraph: {
      type: 'website',
      locale: 'hu_HU',
      siteName: SITE_NAME,
      title: input.title,
      description: input.description,
      ...(input.path ? { url: absoluteUrl(input.path) } : {}),
    },
  }
}

/**
 * Next Metadata-objektum egy CMS-dokumentumhoz (page/post/product közös).
 * A title a keret-layout template-je (%s | Kineticare) alá kerül, a márkát
 * a `documentTitle` PONTOSAN egyszer engedi bele.
 */
export function buildDocMetadata(
  doc: SeoDoc,
  path: string,
  options: { article?: ArticleMeta } = {},
): Metadata {
  const title = resolveSeoTitle(doc)
  const description = resolveSeoDescription(doc)
  const keywords = resolveSeoKeywords(doc.seoKeywords)
  const ogImage = resolveOgImage(doc)
  const titleText = documentTitleText(documentTitle(title))
  return {
    title: documentTitle(title),
    ...(description ? { description } : {}),
    ...(keywords ? { keywords } : {}),
    ...sharedMetadata({
      title: titleText,
      ...(description ? { description } : {}),
      path,
      ...(ogImage ? { image: ogImage } : {}),
      type: options.article ? 'article' : 'website',
      ...(options.article ? { article: options.article } : {}),
    }),
  }
}

const HOME_FALLBACK_TITLE = 'Kineticare | Kézrehabilitációs online kurzusplatform'
const HOME_FALLBACK_DESCRIPTION = SITE_DESCRIPTION

/**
 * A `/` metaadata: a `kezdolap` CMS-oldal `buildDocMetadata` útján
 * (seoTitle / seoDescription / seoKeywords), nem a `/kezdolap` pathen.
 * Üres `seoKeywords` → a keywords kulcs kimarad; H1-ből nem töltjük.
 * Ha a CMS-oldal hiányzik, a statikus tartalék cím/leírás marad, keywords nélkül.
 */
export function buildHomeMetadata(home: SeoDoc | null | undefined): Metadata {
  if (!home) {
    return buildStaticPageMetadata({
      title: HOME_FALLBACK_TITLE,
      description: HOME_FALLBACK_DESCRIPTION,
      path: '/',
    })
  }
  return buildDocMetadata(
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
}

/** A `/kurzusok` lista címe — meta és JSON-LD közös forrás. */
export const COURSE_LISTING_TITLE = 'Kurzusok'

/**
 * A `/kurzusok` lista leírása — meta és JSON-LD közös forrás.
 *
 * Mért kifejezések (Search-lock 2026-08-24, `KURZUSLISTA_KULCSSZAVAK`;
 * Ahrefs HU `docs/kulcsszavak.md`): otthoni gyógytorna (10/hó, CPC $10, a
 * legdrágább kattintás a listán), kéztorna (100/hó, KD 0), kéztorna
 * gyakorlatok (Strale autocomplete, `docs/monid-adatok-teljes.md` 3.2),
 * csuklótörés utáni gyógytorna (100/hó, KD 0), kéztőalagút szindróma
 * (1 200/hó, KD 5).
 */
export const COURSE_LISTING_DESCRIPTION =
  'Online kézrehabilitációs kurzusok gyógytornászoktól: otthoni gyógytorna és kéztorna gyakorlatok, csuklótörés és kéztőalagút szindróma után is, saját tempódban.'

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
      imageUrl: DEFAULT_OG_IMAGE.url,
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
    imageUrl: resolveOgImageUrl(home) ?? DEFAULT_OG_IMAGE.url,
  })
}

/**
 * A `/kurzusok` lista CollectionPage JSON-LD-je. Nincs pages-rekord — a
 * Search-lock 3 kifejezés a `resolveSeoKeywords` úton megy a `keywords`
 * kulcsba. SOS termékoldal ezt a segédet nem hívja.
 *
 * A `courses` lista (a lapon TÉNYLEGESEN megjelenített kurzusok) `ItemList`-
 * ként a `mainEntity` mezőbe kerül: a Google a gyűjtő-lapok
 * felsorolását így érti (Google Search Central, *Carousel (ItemList)*:
 * https://developers.google.com/search/docs/appearance/structured-data/carousel).
 * Üres listánál a mező kimarad — nulla elemű lista hirdetése eltérés a
 * látható tartalomtól.
 */
export function courseListingJsonLd(
  courses: ReadonlyArray<{ name: string; path: string }> = [],
): Record<string, unknown> {
  const page = webPageJsonLd({
    name: COURSE_LISTING_TITLE,
    description: COURSE_LISTING_DESCRIPTION,
    path: '/kurzusok',
    type: 'CollectionPage',
    keywords: resolveSeoKeywords(KURZUSLISTA_KULCSSZAVAK.map((phrase) => ({ phrase }))),
  })
  if (courses.length === 0) {
    return page
  }
  return {
    ...page,
    mainEntity: {
      '@type': 'ItemList',
      '@id': `${absoluteUrl('/kurzusok')}#itemlist`,
      name: COURSE_LISTING_TITLE,
      numberOfItems: courses.length,
      itemListElement: courses.map((course, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: course.name,
        url: absoluteUrl(course.path),
      })),
    },
  }
}

/**
 * Oldal-szintű Metadata a CMS-oldalak/blogposztok generateMetadata-jához —
 * vékony wrapper a buildDocMetadata fölé (title/description/og fallbacklánc
 * + canonical). A path a hívó felelőssége (pl. `/blog/${slug}` vagy `/${slug}`).
 */
export function buildPageMetadata(
  doc: SeoDoc,
  path: string,
  options: { article?: ArticleMeta } = {},
): Metadata {
  return buildDocMetadata(doc, path, options)
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
        : `${name}: online kézrehabilitációs kurzus a Kineticare kínálatából, gyógytornászoktól, otthon, a saját tempódban.`,
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

/**
 * A gráf állandó azonosítói. Egy `@id` egy entitás: a lapok WebPage-e az
 * `isPartOf`/`publisher` mezőben ezekre hivatkozik, így a gépi olvasó minden
 * lapon UGYANAZT a szervezetet és webhelyet látja, nem lap-számú másolatot
 * (schema.org JSON-LD `@id` node identifiers:
 * https://schema.org/docs/datamodel.html; Google *General structured data
 * guidelines*:
 * https://developers.google.com/search/docs/appearance/structured-data/sd-policies).
 */
export const ORGANIZATION_ID = absoluteUrl('/#organization')
export const WEBSITE_ID = absoluteUrl('/#website')
export const LOGO_ID = absoluteUrl('/#logo')

/** Egy lap WebPage-csomópontjának `@id`-ja (a canonical URL + `#webpage`). */
export function webPageId(path: string): string {
  return `${absoluteUrl(path)}#webpage`
}

/** Egy lap BreadcrumbList-csomópontjának `@id`-ja (a canonical URL + `#breadcrumb`). */
export function breadcrumbId(path: string): string {
  return `${absoluteUrl(path)}#breadcrumb`
}

/** Hivatkozás a szervezet csomópontjára (`{"@id": …}`), duplikált leírás nélkül. */
export function organizationRef(): { '@id': string } {
  return { '@id': ORGANIZATION_ID }
}

/**
 * A szervezet logója ImageObject-ként. A Google az Organization `logo`
 * mezőhöz legalább 112×112 px-es, bejárható képet kér; a 180×180-as
 * `apple-icon.png` a Next fájl-konvenció szerint a gyökéren szolgál
 * (Google Search Central, *Organization*:
 * https://developers.google.com/search/docs/appearance/structured-data/organization).
 */
function logoNode(): Record<string, unknown> {
  return {
    '@type': 'ImageObject',
    '@id': LOGO_ID,
    url: absoluteUrl('/apple-icon.png'),
    contentUrl: absoluteUrl('/apple-icon.png'),
    width: 180,
    height: 180,
    caption: SITE_NAME,
  }
}

/**
 * Az Organization csomópont a gráfhoz (`@context` nélkül).
 *
 * CSAK ami a kódban/CMS-ben van: név, URL, leírás, logó, kapcsolati e-mail
 * (lábléc), nyelv, működési terület, szakterület. Telefon, cím, nyitvatartás
 * a Kapcsolat-lap CMS-blokkjából jön, és csak ott (`seo-graph.ts`); a
 * `sameAs` üres, mert a láblécben nincs közösségi link — kitalálni tilos.
 */
export function organizationNode(
  extra: {
    telephone?: readonly string[]
    location?: readonly Record<string, unknown>[]
    founder?: readonly Record<string, unknown>[]
  } = {},
): Record<string, unknown> {
  return {
    '@type': 'Organization',
    '@id': ORGANIZATION_ID,
    name: SITE_NAME,
    url: absoluteUrl('/'),
    description: SITE_DESCRIPTION,
    logo: logoNode(),
    image: { '@id': LOGO_ID },
    email: CONTACT_EMAIL,
    contactPoint: [
      {
        '@type': 'ContactPoint',
        contactType: 'customer service',
        email: CONTACT_EMAIL,
        availableLanguage: ['hu'],
        ...(extra.telephone && extra.telephone.length > 0 ? { telephone: extra.telephone[0] } : {}),
      },
    ],
    ...(extra.telephone && extra.telephone.length > 0 ? { telephone: [...extra.telephone] } : {}),
    ...(extra.location && extra.location.length > 0 ? { location: [...extra.location] } : {}),
    ...(extra.founder && extra.founder.length > 0 ? { founder: [...extra.founder] } : {}),
    // Az entitás egyértelműsítése AI-válaszokban: a nyelv és a működési terület
    // explicit megadása csökkenti a más márkákkal való összemosás esélyét.
    inLanguage: 'hu-HU',
    areaServed: 'HU',
    knowsAbout: [
      'kézrehabilitáció',
      'gyógytorna',
      'kéz- és csuklósérülés utáni rehabilitáció',
      'otthoni rehabilitációs gyakorlatok',
      'kéztőalagút szindróma',
      'ínhüvelygyulladás',
      'teniszkönyök',
    ],
  }
}

/** Organization JSON-LD a kezdőlaphoz (önálló script, `@context`-tel). */
export function organizationJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    ...organizationNode(),
  }
}

/**
 * A WebSite csomópont. `potentialAction` (SearchAction) SZÁNDÉKOSAN nincs:
 * az oldalon nincs kereső, a Google a sitelinks searchbox jelölést csak
 * működő keresőhöz fogadja el (és 2024 óta nem is jeleníti meg:
 * https://developers.google.com/search/docs/appearance/structured-data/sitelinks-searchbox).
 */
export function webSiteNode(): Record<string, unknown> {
  return {
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    url: absoluteUrl('/'),
    name: SITE_NAME,
    alternateName: `${SITE_NAME} ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    inLanguage: 'hu-HU',
    publisher: organizationRef(),
  }
}

/** WebSite JSON-LD önálló scriptként (a kezdőlap). */
export function webSiteJsonLd(): Record<string, unknown> {
  return { '@context': 'https://schema.org', ...webSiteNode() }
}

/**
 * WebPage / CollectionPage JSON-LD. A `keywords` a `resolveSeoKeywords` kimenete:
 * üresen a kulcs kimarad, H1-ből vagy listacímből nem töltjük.
 *
 * Minden WebPage `@id`-t kap és az `isPartOf` mezőben a WebSite-ra, a
 * `publisher`-ben a szervezetre mutat: ettől lesz a lapok halmaza egyetlen,
 * egymásra hivatkozó gráf.
 */
export function webPageJsonLd(args: {
  name: string
  description?: string
  path: string
  type?: 'WebPage' | 'CollectionPage' | 'AboutPage' | 'ContactPage' | 'ItemPage' | 'MedicalWebPage'
  keywords?: readonly string[]
  imageUrl?: string
  datePublished?: string | null
  dateModified?: string | null
  breadcrumbPath?: string
  mainEntityId?: string
}): Record<string, unknown> {
  const keywordText =
    args.keywords !== undefined && args.keywords.length > 0 ? args.keywords.join(', ') : undefined
  return {
    '@context': 'https://schema.org',
    '@type': args.type ?? 'WebPage',
    '@id': webPageId(args.path),
    name: args.name,
    url: absoluteUrl(args.path),
    inLanguage: 'hu-HU',
    isPartOf: { '@id': WEBSITE_ID },
    publisher: organizationRef(),
    ...(args.description ? { description: args.description } : {}),
    ...(keywordText !== undefined ? { keywords: keywordText } : {}),
    ...(args.imageUrl
      ? { primaryImageOfPage: { '@type': 'ImageObject', url: args.imageUrl } }
      : {}),
    // Csak nem üres ISO-érték kerül ki: az üres string hamis (és a Google
    // számára hibás) dátum lenne.
    ...(typeof args.datePublished === 'string' && args.datePublished.length > 0
      ? { datePublished: args.datePublished }
      : {}),
    ...(typeof args.dateModified === 'string' && args.dateModified.length > 0
      ? { dateModified: args.dateModified }
      : {}),
    ...(args.breadcrumbPath ? { breadcrumb: { '@id': breadcrumbId(args.breadcrumbPath) } } : {}),
    ...(args.mainEntityId ? { mainEntity: { '@id': args.mainEntityId } } : {}),
  }
}

/**
 * FAQPage JSON-LD.
 *
 * A GYIK a leggyakrabban kivonatolt tartalomtípus AI-válaszokban: a kérdés-válasz
 * pár önmagában is értelmes egység, ezért közvetlenül idézhető. A `text` mezőbe
 * mindig a TELJES válasz kerüljön, ne csonkolt változat — a csonkolt válasz
 * félreidézhető. (Google *FAQ* dokumentáció:
 * https://developers.google.com/search/docs/appearance/structured-data/faqpage)
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
 * Az `@id` az utolsó (aktuális) lap URL-jéből képződik, hogy a lap WebPage
 * csomópontja a `breadcrumb` mezőben hivatkozhasson rá (Google *Breadcrumb*:
 * https://developers.google.com/search/docs/appearance/structured-data/breadcrumb).
 */
export function breadcrumbJsonLd(
  items: ReadonlyArray<{ name: string; path: string }>,
): Record<string, unknown> {
  const last = items[items.length - 1]
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    ...(last ? { '@id': breadcrumbId(last.path) } : {}),
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
 * (Google *Course* és *Product* dokumentáció:
 * https://developers.google.com/search/docs/appearance/structured-data/course-info,
 * https://developers.google.com/search/docs/appearance/structured-data/product)
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
    '@id': ORGANIZATION_ID,
    name: SITE_NAME,
    url: absoluteUrl('/'),
  }
  return {
    '@context': 'https://schema.org',
    '@type': ['Course', 'Product'],
    '@id': `${url}#course`,
    name,
    ...(description ? { description } : {}),
    url,
    mainEntityOfPage: { '@id': webPageId(path) },
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
  /**
   * Poszt-slug → KANONIKUS útvonal térkép (`hubUtvonalTerkep`). Publikált
   * gyökér-hubbal bíró cikknél a `blogPost.url` a GYÖKÉR-címet hirdeti, nem a
   * 308-cal átirányító `/blog/{slug}`-ot: a strukturált adat sosem mutathat
   * átirányításra (Google Search Central, *Redirects and Google Search*,
   * https://developers.google.com/search/docs/crawling-indexing/301-redirects).
   * Elhagyva a mai viselkedés marad.
   */
  hubUtvonalak?: Readonly<Record<string, string>>
}): Record<string, unknown> {
  const { name, description, path, posts, hubUtvonalak } = args
  const entries = posts.filter((post) => typeof post.slug === 'string' && post.slug.length > 0)
  return {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    '@id': `${absoluteUrl(path)}#blog`,
    name,
    ...(description ? { description } : {}),
    url: absoluteUrl(path),
    mainEntityOfPage: { '@id': webPageId(path) },
    inLanguage: 'hu-HU',
    publisher: {
      '@type': 'Organization',
      '@id': ORGANIZATION_ID,
      name: SITE_NAME,
      url: absoluteUrl('/'),
    },
    ...(entries.length > 0
      ? {
          blogPost: entries.map((post) => ({
            '@type': 'BlogPosting',
            headline: post.title,
            url: absoluteUrl(cikkUtvonal(post.slug ?? '', hubUtvonalak)),
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
    '@id': `${absoluteUrl(path)}#article`,
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
      '@id': ORGANIZATION_ID,
      name: SITE_NAME,
      url: absoluteUrl('/'),
    },
  }
}
