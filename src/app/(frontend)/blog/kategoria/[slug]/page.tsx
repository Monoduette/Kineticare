import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'

import { JsonLd } from '@/components/content/JsonLd'
import { PostCard } from '@/components/content/PostCard'
import { PostsEmptyState } from '@/components/content/PostsEmptyState'
import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { getCategoryBySlug, getPosts, getPublishedProducts } from '@/lib/cms'
import { blogJsonLd, breadcrumbJsonLd, buildStaticPageMetadata } from '@/lib/seo'
import { freeCourseHref } from '@/lib/tudastar'

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

/**
 * Kérés-idejű dedupe: a generateMetadata és a page UGYANAZT a két lekérdezést
 * használja (a kategória létezik-e, és van-e benne cikk). A React `cache`
 * nélkül mindkettő kétszer futna minden kérésnél — a kurzusoldal ugyanezt a
 * mintát viszi.
 */
const categoryOf = cache((slug: string) => getCategoryBySlug(slug))
const postsOf = cache((slug: string) => getPosts({ categorySlug: slug }))
/** Van-e EGYÁLTALÁN cikk a Tudástárban (a visszaút értelmességéhez). */
const anyPost = cache(() => getPosts({ limit: 1 }))

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const category = await categoryOf(slug)
  if (!category) return {}
  const posts = await postsOf(slug)
  return {
    // A cím kötőjel-halmozás nélkül, magyarul olvasható mondatrészként. A
    // korábbi „<téma> — Tudástár" alak kvirtmínuszt (U+2014) használt
    // elválasztónak, amit a magyar mikroszöveg-szabályzat kizár
    // (docs/ui-sztenderdek.md §3.1.1).
    ...buildStaticPageMetadata({
      title: `${category.title} a Tudástárban`,
      description: `${category.title}: kézrehabilitációs cikkek és gyakorlatok a Kineticare Tudástárában.`,
      path: `/blog/kategoria/${category.slug}`,
    }),
    // Üres témánál nem kérünk indexelést (soft 404 elkerülése), de a linkek
    // bejárását igen.
    ...(posts.length === 0 ? { robots: { index: false, follow: true } } : {}),
  }
}

export default async function BlogCategoryPage({ params }: Props) {
  const { slug } = await params
  const category = await categoryOf(slug)
  if (!category) notFound()
  const posts = await postsOf(slug)

  // Üres témánál: van-e egyáltalán cikk a Tudástárban? Ettől függ, hogy a
  // visszaút értelmes-e (lásd a fejléc „ÜRES ÁLLAPOT" pontját).
  const hasAnyPost = posts.length > 0 || (await anyPost()).length > 0
  const variant = hasAnyPost ? 'kategoria' : 'tudastar'
  const freeHref =
    posts.length === 0 && variant === 'tudastar'
      ? freeCourseHref(await getPublishedProducts(50))
      : null

  return (
    <Section>
      <Container>
        <JsonLd
          // A `name` a LÁTHATÓ H1 szövege (a téma neve), nem a meta-cím: a
          // strukturált adatnak azzal kell egyeznie, amit az olvasó lát.
          data={blogJsonLd({
            name: category.title,
            path: `/blog/kategoria/${category.slug}`,
            posts,
          })}
        />
        {/* Morzsa a bejegyzés- és a kurzusoldal bevett alakjában: a szekció
            gyökere, majd az aktuális lap (PostView, kurzusok/[slug]). */}
        <JsonLd
          data={breadcrumbJsonLd([
            { name: 'Tudástár', path: '/blog' },
            { name: category.title, path: `/blog/kategoria/${category.slug}` },
          ])}
        />
        <h1>{category.title}</h1>
        {posts.length === 0 ? (
          <PostsEmptyState freeCourseHref={freeHref} variant={variant} />
        ) : (
          <div className="kc-card-grid kc-card-grid--posts">
            {posts.map((post) => (
              /* Ugyanaz a kártya-beállítás, mint a `/blog` listán (a terv 4.6
                 pontja: „Azonos a /blog-gal"): H1 alatt H2 kártyacím, és a
                 KÉTHASÁBOS poszt-rács. A közös hármas rácsban a kivonat mért
                 sorhossza 28,8–37,4 karakter/sor, a kéthasábosban 48,1–60,6 —
                 a repó Ü6 szabályának 45-ös alsó tűréshatára csak az utóbbiban
                 teljesül (styles/blocks/tudastar-lista.css). */
              <PostCard key={post.id} post={post} headingLevel={2} />
            ))}
          </div>
        )}
      </Container>
    </Section>
  )
}
