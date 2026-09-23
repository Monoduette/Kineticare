import type { Metadata } from 'next'
import { draftMode } from 'next/headers'

import { BarionPageView } from '@/components/analytics/BarionPageView'
import { JsonLd } from '@/components/content/JsonLd'
import { PostCard } from '@/components/content/PostCard'
import { PostListFilter } from '@/components/content/PostListFilter'
import { PostsEmptyState } from '@/components/content/PostsEmptyState'
import { listaFejSzalag } from '@/components/editor/frontend/szerkeszto-szalag'
import { SzerkesztoKodSzalag } from '@/components/editor/frontend/SzerkesztoSzalag'
import { PreviewBar } from '@/components/preview/PreviewBar'
import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import {
  findCategory,
  postCategoryIds,
  shouldShowCategoryFilter,
} from '@/components/content/post-list'
import { BARION_PAGE_VIEW } from '@/lib/analytics/barion-events'
import {
  getCategoryBySlug,
  getContentCategories,
  getPosts,
  getPublishedPageSlugs,
  getPublishedProducts,
} from '@/lib/cms'
import { getContactEmail } from '@/lib/contact-email-server'
import { absoluteUrl, blogJsonLd, buildStaticPageMetadata, NOINDEX_ROBOTS } from '@/lib/seo'
import { siteGraphJsonLd } from '@/lib/seo-graph'
import { categoriesWithPosts, freeCourseHref } from '@/lib/tudastar'
import { getTudastarLathato } from '@/lib/tudastar-lathatosag'
import { cikkUtvonal, hubUtvonalTerkep } from '@/lib/tudastar/hub-oldalak'

import '../styles/blocks/tudastar-lista.css'

/**
 * /blog — a Tudástár listája.
 * Nulla cikknél NEM egy szürke mondat marad a lapon, hanem a `PostsEmptyState`
 * 2026-08-21, JAVÍTÁS. A módosító 2026-08-21-ig NEM azt csinálta, amit ez a
 */

export const dynamic = 'force-dynamic'

const LEAD = 'Kézrehabilitációs cikkek, gyakorlatok és szakmai tudástár a Kineticare-től.'

/**
 * A meta description a látható lead MONDATÁVAL kezd (egy igazságforrás), és a
 * Tudástár MÉRT témáival folytatja (`src/lib/tudastar/seo-kulcsszavak.ts`,
 * mérés 2026-08-21/24, `docs/ADATOK-mert.md`): kéz zsibbadás 450/hó (forgalmi potenciál 2 200),
 * kéztőalagút szindróma 1 200/hó, teniszkönyök 3 500/hó, pattanó ujj 800/hó
 * (KD 0), ínhüvelygyulladás 2 200/hó. 120–160 karakter, hogy a találati
 * snippet ne vágja (Google *Control your snippets*:
 * https://developers.google.com/search/docs/appearance/snippet).
 */
const BLOG_DESCRIPTION =
  'Kézrehabilitációs cikkek és gyakorlatok a Kineticare Tudástárában: kéz zsibbadás, kéztőalagút szindróma, teniszkönyök, pattanó ujj, ínhüvelygyulladás.'

type Props = { searchParams: Promise<{ kategoria?: string }> }

/** A `?kategoria=` szűrés kanonikus címe a dedikált kategória-oldal. */
async function canonicalPathFor(kategoria: string | undefined): Promise<string> {
  if (typeof kategoria !== 'string' || kategoria.length === 0) {
    return '/blog'
  }
  const category = await getCategoryBySlug(kategoria)
  return category ? `/blog/kategoria/${category.slug}` : '/blog'
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const [{ kategoria }, tudastarLathato] = await Promise.all([searchParams, getTudastarLathato()])
  const metadata = buildStaticPageMetadata({
    title: 'Tudástár',
    description: BLOG_DESCRIPTION,
    path: await canonicalPathFor(kategoria),
  })
  // Tudástár-kapcsoló (src/lib/tudastar-kapcsolo.ts): rejtett /blog
  // menüpontnál a lista közvetlen linkkel elérhető marad (200), de nem kér
  // indexelést. A robots.txt szándékosan nem tiltja, különben a kereső a
  // noindexet sem látná (Google Search Central, Block Search indexing with
  // noindex: https://developers.google.com/search/docs/crawling-indexing/block-indexing).
  return tudastarLathato ? metadata : { ...metadata, robots: NOINDEX_ROBOTS }
}

export default async function BlogPage({ searchParams }: Props) {
  const { kategoria } = await searchParams
  // A TELJES publikált lista jön le egyszer (a mai 60-as limittel): a
  // kategória-váltás a kliensen történik, hálózati kör nélkül (WP35,
  // tulajdonosi kérés). A `?kategoria=` csak a KEZDŐ szűrőt adja; ismeretlen
  // értéknél a szűretlen lista jelenik meg (a canonical is oda mutat).
  // Piszkozat-előnézet (csak staff/owner): a lap elején az előnézet-sáv és a
  // lapfej „Kódban van” szalagja (H21). A kapcsolati e-mail (H18, H46) a
  // szervezet-csomópontba; a feloldó nem dob, hibánál a kódtartalék.
  const [posts, categories, publikaltOldalak, { isEnabled: isDraft }, kapcsolatiEmail] =
    await Promise.all([
      getPosts(),
      getContentCategories(),
      getPublishedPageSlugs(),
      draftMode(),
      getContactEmail(),
    ])
  const activeCategory = findCategory(categories, kategoria)
  const activeSlug = activeCategory?.slug ?? undefined
  // KANONIKUS belső link: ahol a cikknek PUBLIKÁLT gyökér-hubja van, oda
  // linkelünk, nem a 308-cal átirányító `/blog/{slug}`-ra. Piszkozat-hubnál a
  // régi cím marad (a gyökér ott 404 lenne). Mérve 2026-09-07: e nélkül a lap
  // 8 átirányító és 0 kanonikus cikk-linket adott
  // (`docs/oldal-audit-b-tudastar-2026-09-07.md` 1. találat).
  const hubUtvonalak = hubUtvonalTerkep(
    posts.map((post) => post.slug).filter((slug): slug is string => typeof slug === 'string'),
    publikaltOldalak,
  )

  const filtered = activeSlug !== undefined
  // Az ingyenes kurzus útját CSAK a magyarázó üres állapothoz kérdezzük le:
  // tele listán egyetlen fölösleges kör sem fut. A szűrt, üres nézet a
  // `kategoria` panelt kapja (máshol VAN cikk), tehát zsákutca nincs.
  const freeHref = posts.length === 0 ? freeCourseHref(await getPublishedProducts(50)) : null

  // A küszöböt a SZŰRETLEN listán mérjük (a `posts` most mindig a teljes
  // lista). Szűrt kezdőnézetben a sor mindig kint van: az „Összes" chip a
  // visszaút, és zsákutcába nem küldünk senkit.
  const showFilter =
    filtered ||
    shouldShowCategoryFilter(categoriesWithPosts(categories, posts).length, posts.length)

  const lap = (
    <Section>
      {/* Barion Pixel `contentView` (contentType: 'Page'). A `list` kimarad: a
          bp.js kötött listájában nincs a Tudástárra illő érték, és a 'Misc'
          nem mond többet a hiányzó mezőnél. */}
      <BarionPageView
        pageId={BARION_PAGE_VIEW.knowledgeBase.id}
        pageName={BARION_PAGE_VIEW.knowledgeBase.name}
      />
      <Container>
        {/* A gyűjtemény-séma csak a KANONIKUS (szűretlen) címen jelenik meg:
            a `?kategoria=` nézet canonicalja a dedikált kategória-oldalra
            mutat, és ott az a lap viseli a saját sémáját. Így ugyanaz a
            gyűjtemény nem íródik le kétszer, két URL-lel. */}
        {filtered ? null : (
          <>
            {/* Oldal-gráf: Organization + WebSite + CollectionPage +
                BreadcrumbList (Kezdőlap → Tudástár). A CollectionPage
                `mainEntity`-je az alábbi Blog csomópont (@id …#blog). */}
            <JsonLd
              data={siteGraphJsonLd({
                page: {
                  path: '/blog',
                  name: 'Tudástár',
                  description: BLOG_DESCRIPTION,
                  type: 'CollectionPage',
                  mainEntityId: `${absoluteUrl('/blog')}#blog`,
                },
                breadcrumbs: [
                  { name: 'Kezdőlap', path: '/' },
                  { name: 'Tudástár', path: '/blog' },
                ],
                contactEmail: kapcsolatiEmail,
              })}
            />
            <JsonLd
              data={blogJsonLd({
                name: 'Tudástár',
                description: LEAD,
                path: '/blog',
                posts,
                hubUtvonalak,
              })}
            />
          </>
        )}
        {/* BreadcrumbList SZÁNDÉKOSAN nincs: a Tudástár maga a szekció
            gyökere, és egy egyelemű morzsa nem hordoz információt. A
            mélyebb lapok (kategória, bejegyzés) viszont kapnak morzsát, a
            kurzusoldalak bevett, kétszintű alakjában (Tudástár → lap).
            A H1 + felvezető a PostListFilter-ben él: a szűrővel együtt vált. */}
        {posts.length === 0 ? (
          <>
            <div className="kc-tudastar-intro">
              <h1 className="kc-page-hero__title">Tudástár</h1>
              <p className="kc-page-hero__lead">{LEAD}</p>
            </div>
            <PostsEmptyState freeCourseHref={freeHref} variant="tudastar" />
          </>
        ) : (
          <PostListFilter
            categories={categories}
            emptyState={<PostsEmptyState variant="kategoria" />}
            initialSlug={activeSlug}
            items={posts.map((post) => ({
              key: post.id,
              categoryIds: postCategoryIds(post),
              /* A lap egyetlen fölérendelt címsora a H1, tehát a kártyacím H2
                 — fix H3 mellett H1 → H3 ugrás keletkezne (WCAG 2.2 1.3.1).
                 A `list` változat (alapértelmezés) hozza a kivonatot: a
                 sorhossz mediánja mérve 48–64 karakter/sor 592 px felett. */
              card: (
                <PostCard
                  headingLevel={2}
                  href={cikkUtvonal(post.slug ?? '', hubUtvonalak)}
                  post={post}
                />
              ),
            }))}
            lead={LEAD}
            showFilter={showFilter}
          />
        )}
      </Container>
    </Section>
  )
  // Nem piszkozatban PONTOSAN a korábbi elem, csomagoló nélkül: a látogató
  // HTML-je és RSC-adata nem változik.
  if (!isDraft) {
    return lap
  }
  return (
    <>
      <PreviewBar path="/blog" />
      <SzerkesztoKodSzalag szalag={listaFejSzalag('tudastar')} />
      {lap}
    </>
  )
}
