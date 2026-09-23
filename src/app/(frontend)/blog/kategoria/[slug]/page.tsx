import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'

import { JsonLd } from '@/components/content/JsonLd'
import { PostCard } from '@/components/content/PostCard'
import { PostListFilter } from '@/components/content/PostListFilter'
import { PostsEmptyState } from '@/components/content/PostsEmptyState'
import { postCategoryIds } from '@/components/content/post-list'
import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import {
  getCategoryBySlug,
  getContentCategories,
  getPosts,
  getPublishedPageSlugs,
  getPublishedProducts,
} from '@/lib/cms'
import { absoluteUrl, blogJsonLd, buildStaticPageMetadata, NOINDEX_ROBOTS } from '@/lib/seo'
import { siteGraphJsonLd } from '@/lib/seo-graph'
import { freeCourseHref } from '@/lib/tudastar'
import { getTudastarLathato } from '@/lib/tudastar-lathatosag'
import { cikkUtvonal, hubUtvonalTerkep } from '@/lib/tudastar/hub-oldalak'

import '../../../styles/blocks/tudastar-lista.css'

/**
 * /blog/kategoria/[slug] — a Tudástár egy témájának listája.
 * Ugyanaz a panel, mint a bloglistán (PostsEmptyState). Ha a témában nincs
 * cikk, de máshol VAN, a panel visszavisz a teljes Tudástárba; ha sehol
 * nincs cikk, a magyarázó (hub) állapot jelenik meg — így a visszaút nem egy
 * ugyanilyen üres lapra mutat.
 * Az ÜRES kategória-oldal `noindex, follow` jelzést kap. A Google a 200-zal
 */

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string }> }

/** A Tudástár felvezető mondata: ugyanaz, mint a `/blog` lapon (egy igazságforrás). */
const LEAD = 'Kézrehabilitációs cikkek, gyakorlatok és szakmai tudástár a Kineticare-től.'

/**
 * Kérés-idejű dedupe: a generateMetadata és a page UGYANAZT a két lekérdezést
 * használja (a kategória létezik-e, és van-e benne cikk). A React `cache`
 * nélkül mindkettő kétszer futna minden kérésnél — a kurzusoldal ugyanezt a
 * mintát viszi.
 */
const categoryOf = cache((slug: string) => getCategoryBySlug(slug))
/**
 * A TELJES publikált lista (a mai 60-as limittel): a kliens-oldali szűrő
 * ebből választ, a SSR csak a téma cikkeit rajzolja ki (WP35). A téma
 * cikkei ebből szűrődnek, DB-független szabállyal — ugyanazzal, amit a
 * kliens is futtat kattintáskor.
 */
const allPosts = cache(() => getPosts())
const postsOf = cache(async (slug: string) => {
  const category = await categoryOf(slug)
  if (!category) return []
  return (await allPosts()).filter((post) => postCategoryIds(post).includes(category.id))
})

/**
 * A téma-lap leírása: a téma neve elöl (ez a keresett kifejezés), utána a
 * Tudástár mért ígérete: otthoni gyógytorna (mért HU 10/hó, CPC $10,
 * `docs/kulcsszavak.md`), kéztorna gyakorlatok (Strale autocomplete,
 * `docs/monid-adatok-teljes.md` 3.2). A hossz a témanévvel együtt 120–160
 * karakter közé esik a tipikus, 8–40 karakteres témaneveknél (mérve: „Kéz és
 * csukló” → 142).
 */
function categoryDescription(title: string): string {
  return `${title}: kézrehabilitációs cikkek a Kineticare Tudástárában, otthoni gyógytorna és kéztorna gyakorlatok gyógytornászoktól, közérthetően.`
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const category = await categoryOf(slug)
  if (!category) return {}
  const [posts, tudastarLathato] = await Promise.all([postsOf(slug), getTudastarLathato()])
  return {
    // A cím kötőjel-halmozás nélkül, magyarul olvasható mondatrészként. A
    // korábbi „<téma> — Tudástár" alak kvirtmínuszt (U+2014) használt
    // elválasztónak, amit a magyar mikroszöveg-szabályzat kizár
    // (docs/ui-sztenderdek.md §3.1.1).
    ...buildStaticPageMetadata({
      title: `${category.title} a Tudástárban`,
      description: categoryDescription(category.title),
      path: `/blog/kategoria/${category.slug}`,
    }),
    // Üres témánál nem kérünk indexelést (soft 404 elkerülése), de a linkek
    // bejárását igen.
    ...(posts.length === 0 ? { robots: { index: false, follow: true } } : {}),
    // Tudástár-kapcsoló: rejtett /blog menüpontnál a téma-lap elérhető marad
    // (200), de nem kér indexelést; a robots.txt nem tiltja (lásd /blog).
    ...(tudastarLathato ? {} : { robots: NOINDEX_ROBOTS }),
  }
}

export default async function BlogCategoryPage({ params }: Props) {
  const { slug } = await params
  const category = await categoryOf(slug)
  if (!category) notFound()
  const [posts, everyPost, categories] = await Promise.all([
    postsOf(slug),
    allPosts(),
    getContentCategories(),
  ])
  // KANONIKUS belső link (lásd a `/blog` lap azonos lépését): publikált
  // gyökér-hubnál a kártya a gyökér-címre megy, piszkozatnál marad a
  // `/blog/{slug}` — a piszkozat-hub gyökér-URL-je 404 lenne. A térkép a
  // TELJES listára készül: a kliens bármelyik témára válthat.
  const hubUtvonalak = hubUtvonalTerkep(
    everyPost
      .map((post) => post.slug)
      .filter((postSlug): postSlug is string => typeof postSlug === 'string'),
    await getPublishedPageSlugs(),
  )

  // Üres témánál: van-e egyáltalán cikk a Tudástárban? Ettől függ, hogy a
  // visszaút értelmes-e (lásd a fejléc „ÜRES ÁLLAPOT" pontját).
  const hasAnyPost = everyPost.length > 0
  const freeHref = hasAnyPost ? null : freeCourseHref(await getPublishedProducts(50))

  return (
    <Section>
      <Container>
        <JsonLd
          // A `name` a téma LÁTHATÓ neve (az aktív chip és az állapotsor
          // szövege), nem a meta-cím: a strukturált adat azzal egyezik, amit
          // az olvasó a lapon lát.
          data={blogJsonLd({
            name: category.title,
            path: `/blog/kategoria/${category.slug}`,
            posts,
            hubUtvonalak,
          })}
        />
        {/* Oldal-gráf: Organization + WebSite + CollectionPage + morzsa a
            bejegyzés- és a kurzusoldal bevett alakjában (Tudástár → lap). A
            CollectionPage `mainEntity`-je a fenti Blog csomópont (@id …#blog). */}
        <JsonLd
          data={siteGraphJsonLd({
            page: {
              path: `/blog/kategoria/${category.slug}`,
              name: category.title,
              description: categoryDescription(category.title),
              type: 'CollectionPage',
              mainEntityId: `${absoluteUrl(`/blog/kategoria/${category.slug}`)}#blog`,
            },
            breadcrumbs: [
              { name: 'Tudástár', path: '/blog' },
              { name: category.title, path: `/blog/kategoria/${category.slug}` },
            ],
          })}
        />
        {/* A H1 (a téma neve) és a felvezető a PostListFilter-ben él, és a
            chip-váltással együtt cserélődik: a SSR-lap és a kattintással
            elért állapot ugyanazt a DOM-ot adja. */}
        {hasAnyPost ? (
          <PostListFilter
            categories={categories}
            emptyState={<PostsEmptyState variant="kategoria" />}
            initialSlug={category.slug ?? undefined}
            items={everyPost.map((post) => ({
              key: post.id,
              categoryIds: postCategoryIds(post),
              /* Ugyanaz a kártya-beállítás, mint a `/blog` listán (a terv 4.6
                 pontja: „Azonos a /blog-gal"): H1 alatt H2 kártyacím, és a
                 KÉTHASÁBOS poszt-rács (styles/blocks/tudastar-lista.css). */
              card: (
                <PostCard
                  headingLevel={2}
                  href={cikkUtvonal(post.slug ?? '', hubUtvonalak)}
                  post={post}
                />
              ),
            }))}
            lead={LEAD}
            showFilter
          />
        ) : (
          <>
            <div className="kc-tudastar-intro">
              <h1 className="kc-page-hero__title">{category.title}</h1>
              <p className="kc-page-hero__lead">{LEAD}</p>
            </div>
            <PostsEmptyState freeCourseHref={freeHref} variant="tudastar" />
          </>
        )}
      </Container>
    </Section>
  )
}
