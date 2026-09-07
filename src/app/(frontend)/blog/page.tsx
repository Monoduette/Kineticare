import type { Metadata } from 'next'

import { BarionPageView } from '@/components/analytics/BarionPageView'
import { CategoryFilter } from '@/components/content/CategoryFilter'
import { JsonLd } from '@/components/content/JsonLd'
import { PostCard } from '@/components/content/PostCard'
import { PostsEmptyState } from '@/components/content/PostsEmptyState'
import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { shouldShowCategoryFilter } from '@/components/content/post-list'
import { BARION_PAGE_VIEW } from '@/lib/analytics/barion-events'
import {
  getCategoryBySlug,
  getContentCategories,
  getPosts,
  getPublishedPageSlugs,
  getPublishedProducts,
} from '@/lib/cms'
import { blogJsonLd, buildStaticPageMetadata } from '@/lib/seo'
import { categoriesWithPosts, freeCourseHref } from '@/lib/tudastar'
import { cikkUtvonal, hubUtvonalTerkep } from '@/lib/tudastar/hub-oldalak'

import '../styles/blocks/tudastar-lista.css'

/**
 * /blog — a Tudástár listája.
 * Nulla cikknél NEM egy szürke mondat marad a lapon, hanem a `PostsEmptyState`
 * 2026-08-21, JAVÍTÁS. A módosító 2026-08-21-ig NEM azt csinálta, amit ez a
 */

export const dynamic = 'force-dynamic'

const LEAD =
  'Kézrehabilitációs cikkek, gyakorlatok és szakmai tudástár a Kineticare-től.'

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
  const { kategoria } = await searchParams
  return buildStaticPageMetadata({
    title: 'Tudástár',
    description: LEAD,
    path: await canonicalPathFor(kategoria),
  })
}

export default async function BlogPage({ searchParams }: Props) {
  const { kategoria } = await searchParams
  const [posts, categories, publikaltOldalak] = await Promise.all([
    getPosts({ categorySlug: kategoria }),
    getContentCategories(),
    getPublishedPageSlugs(),
  ])
  // KANONIKUS belső link: ahol a cikknek PUBLIKÁLT gyökér-hubja van, oda
  // linkelünk, nem a 308-cal átirányító `/blog/{slug}`-ra. Piszkozat-hubnál a
  // régi cím marad (a gyökér ott 404 lenne). Mérve 2026-09-07: e nélkül a lap
  // 8 átirányító és 0 kanonikus cikk-linket adott
  // (`docs/oldal-audit-b-tudastar-2026-09-07.md` 1. találat).
  const hubUtvonalak = hubUtvonalTerkep(
    posts.map((post) => post.slug).filter((slug): slug is string => typeof slug === 'string'),
    publikaltOldalak,
  )

  const filtered = typeof kategoria === 'string' && kategoria.length > 0
  // Szűrt, üres nézetnél megnézzük, van-e EGYÁLTALÁN cikk. Ha nincs, a
  // „Vissza a Tudástárba" út egy ugyanilyen üres lapra vinne, tehát a
  // magyarázó (hub) állapotot mutatjuk helyette: zsákutcába nem küldünk
  // senkit (skill 5. pont).
  const hasAnyPost =
    posts.length > 0 || (filtered ? (await getPosts({ limit: 1 })).length > 0 : false)
  const variant = filtered && hasAnyPost ? 'kategoria' : 'tudastar'
  // Az ingyenes kurzus útját CSAK a magyarázó üres állapothoz kérdezzük le:
  // tele listán egyetlen fölösleges kör sem fut.
  const freeHref =
    posts.length === 0 && variant === 'tudastar'
      ? freeCourseHref(await getPublishedProducts(50))
      : null

  // A küszöböt a SZŰRETLEN listán mérjük — szűrt nézetben a `posts` már csak
  // az adott téma cikkeit tartalmazza, abból a szűrő hasznossága nem
  // állapítható meg. Szűrt nézetben ezért a sor mindig kint van: az „Összes"
  // chip a visszaút, és zsákutcába nem küldünk senkit. Extra lekérdezés
  // nincs: szűretlen nézetben a `posts` maga a teljes lista.
  const showFilter =
    filtered ||
    shouldShowCategoryFilter(categoriesWithPosts(categories, posts).length, posts.length)

  return (
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
          <JsonLd
            data={blogJsonLd({
              name: 'Tudástár',
              description: LEAD,
              path: '/blog',
              posts,
              hubUtvonalak,
            })}
          />
        )}
        {/* BreadcrumbList SZÁNDÉKOSAN nincs: a Tudástár maga a szekció
            gyökere, és egy egyelemű morzsa nem hordoz információt. A
            mélyebb lapok (kategória, bejegyzés) viszont kapnak morzsát, a
            kurzusoldalak bevett, kétszintű alakjában (Tudástár → lap). */}
        <div className="kc-tudastar-intro">
          <h1 className="kc-page-hero__title">Tudástár</h1>
          {/* A lead ugyanaz a mondat, ami a meta-leírásban áll: a látogató és
              a találati lista ugyanazt az ígéretet kapja (egy igazságforrás). */}
          <p className="kc-page-hero__lead">{LEAD}</p>
        </div>
        {showFilter ? <CategoryFilter categories={categories} activeSlug={kategoria} /> : null}
        {posts.length === 0 ? (
          <PostsEmptyState freeCourseHref={freeHref} variant={variant} />
        ) : (
          <div className="kc-card-grid kc-card-grid--posts">
            {posts.map((post) => (
              /* A lap egyetlen fölérendelt címsora a H1, tehát a kártyacím H2
                 — fix H3 mellett H1 → H3 ugrás keletkezne (WCAG 2.2 1.3.1).
                 A `list` változat (alapértelmezés) hozza a kivonatot: a
                 sorhossz mediánja mérve 48–64 karakter/sor 592 px felett. */
              <PostCard
                key={post.id}
                headingLevel={2}
                href={cikkUtvonal(post.slug ?? '', hubUtvonalak)}
                post={post}
              />
            ))}
          </div>
        )}
      </Container>
    </Section>
  )
}
