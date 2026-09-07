import Link from 'next/link'

import { postCardLabel } from '../../lib/tudastar-kategoriak'
import type { Post } from '../../payload-types'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'
import { MediaImage } from './MediaImage'

import '../../app/(frontend)/styles/blocks/knowledge.css'

/**
 * PostCard — blogposzt-kártya (borító / kategória / cím / kivonat / dátum).
 * továbbra is végigolvasná —, hanem NEM ODATENNI. A kártya-definíció
 */
export interface PostCardProps {
  post: Pick<
    Post,
    'id' | 'title' | 'slug' | 'excerpt' | 'heroImage' | 'publishedAt' | 'categories' | 'status'
  >
  /**
   * `list` (alapértelmezés): a kivonattal együtt — a `/blog` lista és a
   * kategória-oldal kéthasábos rácsához. `compact`: kivonat NÉLKÜL — a hármas
   * rácsú kezdőlapi szekcióhoz és a kapcsolódó blokkhoz.
   */
  variant?: 'list' | 'compact'
  /** A kártyacím címsor-szintje. Alapértelmezés: 3 (h2 szekciócím alatt). */
  headingLevel?: 2 | 3
}

/** Magyar dátumformázás (pl. 2025. március 4.); érvénytelen/hiányzó dátumra null. */
export function formatPostDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return new Intl.DateTimeFormat('hu-HU', { dateStyle: 'long' }).format(date)
}

export function PostCard({ post, variant = 'list', headingLevel = 3 }: PostCardProps) {
  if (post.status !== 'published' || !post.slug) {
    return null
  }

  const date = formatPostDate(post.publishedAt)
  // EGYETLEN címke: az első feloldott kategória neve (docs/tudastar-ux-terv.md
  // 3.2: „Pontosan egy, az első kategória"; több címke tördel, a kártyák
  // magassága szétcsúszik). A tartalék „Tudástár" igaz fallback, nem kitalált
  // besorolás; az importált készletben nincs kategória nélküli cikk
  // (src/lib/tudastar-kategoriak.ts, őr-teszt). Egységes elv minden felületen
  // (WCAG 2.2 3.2.4; GOV.UK Tag: azonos címke azonos színnel mindenhol).
  const label = postCardLabel(post.categories)
  const heroMedia = post.heroImage && typeof post.heroImage === 'object' ? post.heroImage : null
  const Cim = headingLevel === 2 ? 'h2' : 'h3'

  return (
    <Card as="article" className="kc-post-card" interactive padded={false}>
      {heroMedia ? (
        <div className="kc-post-card__cover">
          <MediaImage
            media={heroMedia}
            preferredSize="sm"
            sizes="(max-width: 720px) 100vw, 352px"
          />
        </div>
      ) : null}
      <div className="kc-post-card__body">
        <div className="kc-post-card__categories">
          <Badge tone="info">{label}</Badge>
        </div>
        {/* A kártya EGYETLEN linkje. A hozzáférhető neve pontosan a cikk címe
            (mérve: 42 / 51 / 40 karakter a három mintacímen, a terv 80-as
            felső határa alatt) — a kategória, a kivonat és a dátum
            SZÁNDÉKOSAN a linken kívül áll. */}
        <Cim className="kc-post-card__title">
          <Link className="kc-post-card__link" href={`/blog/${post.slug}`}>
            {post.title}
          </Link>
        </Cim>
        {variant === 'list' && post.excerpt ? (
          <p className="kc-post-card__excerpt">{post.excerpt}</p>
        ) : null}
        <div className="kc-post-card__foot">
          {date ? (
            <span className="kc-post-card__date">
              <time dateTime={typeof post.publishedAt === 'string' ? post.publishedAt : undefined}>
                {date}
              </time>
            </span>
          ) : null}
          {/* A cím-link overlay-e az egész kártyát kattinthatóvá teszi, ezért a
              CTA dekoratív nyíl (aria-hidden) — beágyazott gomb vagy második
              link nem lehet a kártyán (az overlay elnyelné). */}
          <span aria-hidden="true" className="kc-post-card__arrow">
            →
          </span>
        </div>
      </div>
    </Card>
  )
}
