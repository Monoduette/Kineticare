import type { Metadata } from 'next'
import { draftMode } from 'next/headers'
import { notFound } from 'next/navigation'

import { PostArticle } from '@/components/content/PostArticle'
import { PreviewBar } from '@/components/preview/PreviewBar'
import { getPostBySlug, getRelatedPosts } from '@/lib/cms'
import { ujTudastarPostNoindex } from '@/lib/tudastar/eeat-kapu'
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
  const meta = buildPageMetadata(post, `/blog/${slug}`)
  // GEO-LOCK: noindex CSAK a két új slugra, ha a Person author vagy a faq hiányzik.
  // A hat élő Tudástár-poszt indexelhető marad (author/faq később, külön feladat).
  if (ujTudastarPostNoindex(post)) {
    return withDraftRobots({ ...meta, robots: { index: false, follow: true } }, isDraft)
  }
  return withDraftRobots(meta, isDraft)
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

  // Az Article JSON-LD-t és a morzsa-sémát a PostArticle rendereli (szerző +
  // og:image feloldással), mert a séma mezőinek a LÁTHATÓ tartalomból kell
  // jönniük — ott van egy helyen a kettő (docs/seo-geo-llm.md 1. fejezet).
  return (
    <>
      {isDraft ? <PreviewBar path={`/blog/${slug}`} /> : null}
      <PostArticle post={post} related={related} />
    </>
  )
}
