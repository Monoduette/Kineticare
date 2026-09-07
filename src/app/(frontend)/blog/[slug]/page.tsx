import type { Metadata } from 'next'
import { draftMode } from 'next/headers'
import { notFound, permanentRedirect } from 'next/navigation'
import { cache } from 'react'

import { PostArticle } from '@/components/content/PostArticle'
import { PreviewBar } from '@/components/preview/PreviewBar'
import {
  getFreeProduct,
  getPageBySlug,
  getPostBySlug,
  getPublishedPageSlugs,
  getRelatedPosts,
} from '@/lib/cms'
import { withDraftRobots } from '@/lib/preview/draft-metadata'
import { buildPageMetadata } from '@/lib/seo'
import { hubSlugForPost, hubUtvonalTerkep } from '@/lib/tudastar/hub-oldalak'

/**
 * Blog→gyökér 308 (URL-mátrix lock): ha a cikk témájának gyökér-hubja már
 * PUBLIKÁLT a `pages` collectionben, a cikk-URL tartósan a hubra irányít —
 * a kanonikus cím onnantól a gyökér. Amíg a hub piszkozat (vagy nincs), a
 * cikk változatlanul él: a lekérdezés published-szűrt, tehát a piszkozat-hub
 * SOHA nem irányít át. A döntés kérésidőben dől el, kód-kapcsoló nélkül —
 * a Katák publikálása maga az élesítés.
 */
async function hubraIranyit(slug: string): Promise<void> {
  const hubSlug = hubSlugForPost(slug)
  if (hubSlug === null) return
  const hub = await getPageBySlug(hubSlug)
  if (hub) permanentRedirect(`/${hubSlug}`)
}

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string }> }

const postOf = cache((slug: string, draft: boolean) => getPostBySlug(slug, { draft }))

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  // Draft mode-ban a piszkozat metaadata jön — és a válasz sosem indexelhető.
  const { isEnabled: isDraft } = await draftMode()
  const post = await postOf(slug, isDraft)
  if (!post) return withDraftRobots({}, isDraft)
  return withDraftRobots(buildPageMetadata(post, `/blog/${slug}`), isDraft)
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params
  // Publikált gyökér-hub esetén a cikk-URL tartósan (308) a hubra irányít.
  await hubraIranyit(slug)
  // Előnézet (draft mode): a publikálatlan verzió is látszik. A sütit kizárólag
  // a /next/preview route adhatja, oda pedig csak staff/owner jut be. A
  // kapcsolódó posztok listája marad published-szűrt: azok nyilvános tartalmak.
  const { isEnabled: isDraft } = await draftMode()
  const post = await postOf(slug, isDraft)
  if (!post) notFound()
  // Az ingyenes belépő a cikk végi ajánló halk sora (PostCourseCta); hiba
  // vagy hiányzó ingyenes termék esetén null, a sor egyszerűen elmarad.
  const [related, freeCourse, publikaltOldalak] = await Promise.all([
    getRelatedPosts(post),
    getFreeProduct(),
    getPublishedPageSlugs(),
  ])
  // A kapcsolódó cikkek kártyái a KANONIKUS gyökér-címre mennek, ahol a hub
  // publikált — ez a lap maga is csak azért él, mert a SAJÁT hubja piszkozat
  // (különben 308 vinne a gyökérre), a többi cikké viszont lehet publikált.
  const hubUtvonalak = hubUtvonalTerkep(
    related
      .map((relatedPost) => relatedPost.slug)
      .filter((relatedSlug): relatedSlug is string => typeof relatedSlug === 'string'),
    publikaltOldalak,
  )

  // Az Article JSON-LD-t és a morzsa-sémát a PostArticle rendereli (szerző +
  // og:image feloldással), mert a séma mezőinek a LÁTHATÓ tartalomból kell
  // jönniük — ott van egy helyen a kettő (docs/seo-geo-llm.md 1. fejezet).
  return (
    <>
      {isDraft ? <PreviewBar path={`/blog/${slug}`} /> : null}
      <PostArticle
        freeCourse={freeCourse}
        hubUtvonalak={hubUtvonalak}
        post={post}
        related={related}
      />
    </>
  )
}
