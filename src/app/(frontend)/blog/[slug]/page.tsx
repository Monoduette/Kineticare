import type { Metadata } from 'next'
import { draftMode } from 'next/headers'
import { notFound } from 'next/navigation'

import { PostArticle } from '@/components/content/PostArticle'
import { PreviewBar } from '@/components/preview/PreviewBar'
import { getFreeProduct, getPostBySlug, getRelatedPosts } from '@/lib/cms'
import { withDraftRobots } from '@/lib/preview/draft-metadata'
import { buildPageMetadata } from '@/lib/seo'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  // Draft mode-ban a piszkozat metaadata jön — és a válasz sosem indexelhető.
  const { isEnabled: isDraft } = await draftMode()
  const post = await getPostBySlug(slug, { draft: isDraft })
  if (!post) return withDraftRobots({}, isDraft)
  return withDraftRobots(buildPageMetadata(post, `/blog/${slug}`), isDraft)
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params
  // Előnézet (draft mode): a publikálatlan verzió is látszik. A sütit kizárólag
  // a /next/preview route adhatja, oda pedig csak staff/owner jut be. A
  // kapcsolódó posztok listája marad published-szűrt: azok nyilvános tartalmak.
  const { isEnabled: isDraft } = await draftMode()
  const post = await getPostBySlug(slug, { draft: isDraft })
  if (!post) notFound()
  const related = await getRelatedPosts(post)
  // Az ingyenes belépő a cikk végi ajánló halk sora (PostCourseCta); hiba
  // vagy hiányzó ingyenes termék esetén null, a sor egyszerűen elmarad.
  const freeCourse = await getFreeProduct()

  // Az Article JSON-LD-t és a morzsa-sémát a PostArticle rendereli (szerző +
  // og:image feloldással), mert a séma mezőinek a LÁTHATÓ tartalomból kell
  // jönniük — ott van egy helyen a kettő (docs/seo-geo-llm.md 1. fejezet).
  return (
    <>
      {isDraft ? <PreviewBar path={`/blog/${slug}`} /> : null}
      <PostArticle post={post} related={related} freeCourse={freeCourse} />
    </>
  )
}
