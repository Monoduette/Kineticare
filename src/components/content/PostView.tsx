import Link from 'next/link'

import type { Category, Post, User } from '../../payload-types'
import { estimateReadingMinutes } from '../../lib/reading-time'
import { absoluteUrl, breadcrumbJsonLd, resolveOgImageUrl, resolveSeoKeywords } from '../../lib/seo'
import { postArticleJsonLd } from '../../lib/seo-cikk'
import { Badge } from '../ui/Badge'
import { Container } from '../ui/Container'
import { Section } from '../ui/Section'
import { RichText } from '../lexical/RichText'
import { formatPostDate, PostCard } from './PostCard'
import { JsonLd } from './JsonLd'
import { MediaImage } from './MediaImage'

/**
 * PostView — blogposzt-oldal prezentációs komponense (fixture-ből tesztelhető).
 *
 * Tartalma: cím + meta (szerző, dátum, becsült olvasási idő), kategóriák
 * (kategória-oldalakra linkelve), heroImage, a Lexical-renderelt tartalom,
 * kapcsolódó posztok (max 3, csak published) és Article JSON-LD.
 */
export interface PostViewProps {
  post: Post
  /**
   * Opcionális, kívülről betöltött kapcsolódó posztok (pl. getRelatedPosts
   * kategória-alapú találatai). Alapértelmezetten a poszt relatedPosts
   * mezőjéből dolgozunk (visibleRelatedPosts).
   */
  related?: Post[]
  /** A meta-sor (szerző/dátum/olvasási idő) megjelenítése — alapértelmezett: igen. */
  showMeta?: boolean
}

function authorNameOf(post: Post): string | null {
  const author = post.author
  if (typeof author === 'object' && author !== null) {
    const name = (author as User).name
    if (typeof name === 'string' && name.trim().length > 0) {
      return name.trim()
    }
  }
  return null
}

function postCategories(post: Post): Category[] {
  if (!Array.isArray(post.categories)) return []
  return post.categories.filter(
    (cat): cat is Category =>
      typeof cat === 'object' && cat !== null && typeof cat.slug === 'string',
  )
}

/** Kapcsolódó posztok: max 3 (a séma maxRows-ja), csak published, slug-gal. */
export function visibleRelatedPosts(post: Post): Post[] {
  if (!Array.isArray(post.relatedPosts)) return []
  return post.relatedPosts
    .filter((related): related is Post => typeof related === 'object' && related !== null)
    .filter((related) => related.status === 'published' && typeof related.slug === 'string')
    .slice(0, 3)
}

/** Csak a published, slug-gal rendelkező posztok jelenhetnek meg kapcsolódóként. */
function displayableRelated(posts: Post[]): Post[] {
  return posts
    .filter((related) => related.status === 'published' && typeof related.slug === 'string')
    .slice(0, 3)
}

export function PostView({ post, related: relatedProp, showMeta = true }: PostViewProps) {
  const author = authorNameOf(post)
  const date = formatPostDate(post.publishedAt)
  const readingMinutes = estimateReadingMinutes(post.content)
  const categories = postCategories(post)
  const related = relatedProp ? displayableRelated(relatedProp) : visibleRelatedPosts(post)
  const heroMedia = post.heroImage && typeof post.heroImage === 'object' ? post.heroImage : null
  const keywords = resolveSeoKeywords(post.seoKeywords)

  return (
    <article>
      {/* A cikk sémáját a KÖZÖS `postArticleJsonLd` adja — ugyanaz a függvény,
          amit az élő cikkoldal (`PostArticle`) hív. A régi `articleJsonLd`
          hívás azért került ki innen, mert így a repóban két, egymástól
          eltérő Article-séma élt: ez a komponens `Article` típust adott,
          `MedicalWebPage` nélkül, tehát a `reviewedBy`/`lastReviewed` sosem
          lett volna érvényes rajta. A bemenetek ugyanazok, amiket a
          `PostArticle` is átad — annyi, amennyit ez a komponens ismer: a
          látható byline neve és a megosztási kép. */}
      <JsonLd
        data={postArticleJsonLd({
          post,
          path: `/blog/${post.slug}`,
          ...(author ? { author: { name: author } } : {}),
          imageUrl: resolveOgImageUrl(post),
          ...(keywords !== undefined ? { keywords } : {}),
        })}
      />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'Tudástár', path: '/blog' },
          { name: post.title, path: `/blog/${post.slug}` },
        ])}
      />
      <Section className="kc-page-hero" variant="tint">
        <Container size="narrow">
          {categories.length > 0 ? (
            <p className="kc-post-hero__categories">
              {categories.map((category) => (
                <Link key={category.id} href={`/blog/kategoria/${category.slug}`}>
                  <Badge tone="info">{category.title}</Badge>
                </Link>
              ))}
            </p>
          ) : null}
          <h1 className="kc-page-hero__title">{post.title}</h1>
          {post.excerpt ? <p className="kc-page-hero__lead">{post.excerpt}</p> : null}
          {showMeta ? (
            <p className="kc-post-meta">
              {author ? <span className="kc-post-meta__author">{author}</span> : null}
              {date ? (
                <time
                  dateTime={typeof post.publishedAt === 'string' ? post.publishedAt : undefined}
                >
                  {date}
                </time>
              ) : null}
              {readingMinutes !== null ? <span>{readingMinutes} perc olvasás</span> : null}
            </p>
          ) : null}
        </Container>
      </Section>
      {heroMedia ? (
        <Section flush>
          <Container>
            <div className="kc-page-hero__media">
              <MediaImage
                media={heroMedia}
                preferredSize="lg"
                priority
                sizes="(max-width: 1120px) 100vw, 1120px"
              />
            </div>
          </Container>
        </Section>
      ) : null}
      <Section>
        <Container size="narrow">
          <RichText content={post.content} />
        </Container>
      </Section>
      {related.length > 0 ? (
        <Section variant="tint">
          <Container>
            <h2 className="kc-section-title">Kapcsolódó bejegyzések</h2>
            <div className="kc-card-grid">
              {related.map((relatedPost) => (
                /* `compact`: a kapcsolódó blokk HÁRMAS rácsban áll, ott a
                   kivonat mért sorhossza 24–38 karakter/sor
                   (docs/tudastar-a11y-meres.md 3.1) — a repó Ü6 szabályának
                   45-ös alsó tűréshatára alatt. A kártyacím a fenti h2
                   szekciócím alá h3-ként kerül (a `headingLevel` alapja). */
                <PostCard key={relatedPost.id} post={relatedPost} variant="compact" />
              ))}
            </div>
          </Container>
        </Section>
      ) : null}
    </article>
  )
}

/** A poszt og:image/meta abszolút URL-jei a route generateMetadata-jához. */
export function postCanonicalPath(post: Pick<Post, 'slug'>): string {
  return absoluteUrl(`/blog/${post.slug}`)
}
