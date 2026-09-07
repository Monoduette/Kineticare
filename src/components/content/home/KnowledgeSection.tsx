import Link from 'next/link'

import { ctaLabel } from '../../../lib/cta-vocabulary'
import type { Post } from '../../../payload-types'
import { Container } from '../../ui/Container'
import { Section } from '../../ui/Section'
import { cikkUtvonal } from '../../../lib/tudastar/hub-oldalak'
import { PostCard } from '../PostCard'

import '../../../app/(frontend)/styles/blocks/knowledge.css'

/**
 * KnowledgeSection — „Legfrissebb a tudástárból" (audit M7, SEO/hosszútáv).
 * A HomeView-ból kiemelt szekció, hogy a rögzített kezdőlap és a
 * szekció-rendszer `knowledge` blokkja (RenderBlocks) ugyanazt a megjelenést
 * kapja. A posztok published-szűrése itt védőháló — a lekérdezés is szűr.
 * A `limit` a MEGJELENŐ posztok száma (a blokk 1–6 között engedi); a
 * lekérdezésnek legalább ennyit kell hoznia — lásd KNOWLEDGE_POSTS_FETCH_LIMIT.
 */

/**
 * Ennyi posztot kér le a kezdőlap adatrétege (page.tsx), hogy a blokk
 * legnagyobb megengedett `limit`-je (6) is kiszolgálható legyen egyetlen,
 * párhuzamosítható lekérdezésből.
 */
export const KNOWLEDGE_POSTS_FETCH_LIMIT = 6

export interface KnowledgeSectionProps {
  posts: Post[]
  /** Szekciócím-felülírás — üresen a beépített cím marad. */
  heading?: string
  /** Megjelenő posztok száma; a lista ennél hosszabb részét levágja. */
  limit?: number
  id?: string
  variant?: 'default' | 'tint' | 'dark'
  /**
   * Poszt-slug → KANONIKUS útvonal térkép (`hubUtvonalTerkep`). Ahol egy
   * cikknek PUBLIKÁLT gyökér-hubja van, a kártya oda linkel; enélkül minden
   * belső hivatkozás 308-as átirányításon át vinne
   * (`docs/oldal-audit-b-tudastar-2026-09-07.md` 1. találat). Sima objektum,
   * nem függvény: a szerver → kliens határon szerializálhatónak kell lennie.
   * Elhagyva a mai `/blog/{slug}` viselkedés marad.
   */
  hubUtvonalak?: Readonly<Record<string, string>>
}

export function KnowledgeSection({
  posts,
  heading,
  limit,
  id,
  variant = 'tint',
  hubUtvonalak,
}: KnowledgeSectionProps) {
  const visiblePosts = posts.filter((post) => post.status === 'published' && post.slug)
  const shownPosts =
    typeof limit === 'number' && limit > 0 ? visiblePosts.slice(0, limit) : visiblePosts

  if (shownPosts.length === 0) {
    return null
  }

  const title = heading?.trim() || 'Legfrissebb a tudástárból'

  return (
    <Section className="kc-knowledge" id={id} variant={variant}>
      <Container>
        <h2 className="kc-section-title">{title}</h2>
        <div className="kc-card-grid">
          {shownPosts.map((post) => (
            /* `compact`: HÁRMAS rácsban állunk, ott a kivonat mért sorhossza
               24–38 karakter/sor (docs/tudastar-a11y-meres.md 3.1), a repó Ü6
               szabályának 45-ös alsó tűréshatára alatt. A kivonat ezért nem
               kerül a kártyára — a `headingLevel` alapértelmezett 3-as értéke
               pedig a fenti h2 szekciócím alá illeszkedik, hézag nélkül. */
            <PostCard
              key={post.id}
              href={cikkUtvonal(post.slug ?? '', hubUtvonalak)}
              post={post}
              variant="compact"
            />
          ))}
        </div>
        <p className="kc-section-more">
          <Link className="kc-text-link kc-knowledge__link" href="/blog">
            {/* §3.2 #35 — a tudástár BÖNGÉSZÉSE. A „Vissza a Tudástárba" (a
                #15 mintázata) SZÁNDÉKOSAN marad külön: az visszalépés, ez
                belépés — ugyanaz a kettősség, mint a #10 ↔ #15 párnál a
                /kurzusok célon. */}
            <span className="kc-text-link__label">{ctaLabel('knowledge-list-open')}</span>
            <span aria-hidden="true" className="kc-text-link__arrow">
              →
            </span>
          </Link>
        </p>
      </Container>
    </Section>
  )
}
