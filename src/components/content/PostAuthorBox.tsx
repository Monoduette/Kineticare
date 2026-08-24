import Link from 'next/link'

import { ctaLabel } from '../../lib/cta-vocabulary'
import { Card } from '../ui/Card'
import { MediaImage } from './MediaImage'
import { formatPostDate } from './PostCard'
import type { ArticlePerson } from './post-article'

import '../../app/(frontend)/styles/blocks/post-view.css'

/**
 * PostAuthorBox — szerző- és lektor-blokk a cikk törzsének zárásaként.
 *
 * ═══ MIÉRT EZ A LAP LEGFONTOSABB BLOKKJA ═══
 * A tartalom egészségügyi, tehát a Google szóhasználatával YMYL: „our systems
 * give even more weight to content that aligns with strong E-E-A-T for topics
 * that could significantly impact the health, financial stability, or safety
 * of people" (*Creating helpful, reliable, people-first content*,
 * https://developers.google.com/search/docs/fundamentals/creating-helpful-content).
 * Ugyanez a dokumentum kérdezi: „Is it self-evident to your visitors who
 * authored your content? Do pages carry a byline…? Do bylines lead to further
 * information about the author?" — a blokk pontosan erre a három kérdésre
 * válaszol.
 *
 * Az NN/g byline-kutatása a mi esetünket nevesíti: a byline akkor kell, „if
 * the author has credentials or status that support the article's
 * credibility. The classic example is a medical doctor writing about a health
 * issue." (https://www.nngroup.com/articles/bylines/) — és ugyanez mondja ki,
 * hogy a rövid byline a lap TETEJÉN, a bemutatkozás a lap ALJÁN áll.
 *
 * ═══ AZ ELLENŐRZÉS-DÁTUM ═══
 * Az NHS „Page last reviewed" / „Next review due" mintája
 * (https://service-manual.nhs.uk/design-system/patterns/know-that-a-page-is-up-to-date).
 * A minta 2018-as tesztelése azt mutatta, hogy a LÁBLÉCBE, elválasztó vonal
 * mögé tett dátumot a felhasználók nem vették észre, a fő tartalomhoz
 * közelebb tettet igen — ezért van a szerző-blokkban, nem a láblécben.
 *
 * SZIGORÚ SZABÁLY: dátum csak akkor jelenik meg, ha az adat LÉTEZIK, és a
 * címsor is csak azt állítja, ami megtörtént („A cikket írta" ↔ „A cikket
 * írta és ellenőrizte"). Ellenőrzés-dátum ellenőrzés nélkül hazugság, és pont
 * azt a bizalmat rombolná, amiért a blokk létezik (docs/tudastar-ux-terv.md
 * 5.6 és 8. fejezet).
 *
 * ═══ AZ ARCKÉPRŐL ═══
 * Az NN/g szemmozgás-mérése szerint a valódi embert ábrázoló portré az
 * egyetlen kép-típus, amit az olvasók ténylegesen néznek (a dekoratív képet
 * teljesen figyelmen kívül hagyják). A kép DEKORATÍV alt-tal megy ki: a nevet
 * a szomszédos szöveg már kimondja, kétszer felolvasni zaj (WCAG 1.1.1).
 */
export interface PostAuthorBoxProps {
  author: ArticlePerson | null
  reviewer: ArticlePerson | null
  /** ISO dátum; csak akkor jelenik meg, ha tényleg megtörtént az ellenőrzés. */
  reviewedAt?: string | null
  nextReviewAt?: string | null
  /**
   * A címsor a tartalom típusához igazodik (WCAG 2.2 **3.2.4**: ugyanaz a
   * blokk, a kijelentés pontos). A blog `cikk`, a gyökér CMS-oldal `oldal`
   * — az NHS „Page last reviewed" mintája az utóbbi.
   * (https://service-manual.nhs.uk/design-system/patterns/know-that-a-page-is-up-to-date)
   */
  surface?: 'post' | 'page'
}

/** A blokk címe pontosan azt állítja, ami megtörtént. */
function headingFor(hasAuthor: boolean, hasReview: boolean, surface: 'post' | 'page'): string {
  const alany = surface === 'page' ? 'Az oldalt' : 'A cikket'
  if (hasAuthor && hasReview) return `${alany} írta és ellenőrizte`
  if (hasAuthor) return `${alany} írta`
  return `${alany} ellenőrizte`
}

/** „Név, végzettség" — végzettség nélkül csak a név (titulust nem találunk ki). */
function nameWithCredentials(person: ArticlePerson): string {
  return person.credentials === null ? person.name : `${person.name}, ${person.credentials}`
}

export function PostAuthorBox({
  author,
  reviewer,
  reviewedAt = null,
  nextReviewAt = null,
  surface = 'post',
}: PostAuthorBoxProps) {
  const reviewedDate = formatPostDate(reviewedAt)
  const nextReviewDate = formatPostDate(nextReviewAt)
  // A lektor sora csak akkor külön sor, ha MÁS ember, mint a szerző: ugyanaz
  // a név kétszer kiírva nem információ, hanem zaj.
  const separateReviewer = reviewer !== null && reviewer.name !== author?.name
  const hasReview = separateReviewer || reviewedDate !== null

  if (author === null && !hasReview) {
    // Se szerző, se ellenőrzés: nincs mit állítani. A strukturált adat
    // kiadója a `publisher` Organization; author kulcs nincs.
    return null
  }

  return (
    <Card as="section" className="kc-post-author">
      <h2 className="kc-post-author__title">{headingFor(author !== null, hasReview, surface)}</h2>
      {author !== null ? (
        <div className="kc-post-author__head">
          {author.portrait !== null ? (
            <span className="kc-post-author__portrait">
              <MediaImage decorative media={author.portrait} preferredSize="xs" sizes="72px" />
            </span>
          ) : null}
          <div className="kc-post-author__person">
            <p className="kc-post-author__name">{author.name}</p>
            {author.credentials !== null ? (
              <p className="kc-post-author__credentials">{author.credentials}</p>
            ) : null}
            {author.bioShort !== null ? (
              <p className="kc-post-author__bio">{author.bioShort}</p>
            ) : null}
            {/* Google E-E-A-T: „Do bylines lead to further information about
                the author?" — a /rolunk oldal a bővebb válasz. A felirat a
                CTA-szótár #34 sora (docs/ui-sztenderdek.md §3.2). */}
            <Link className="kc-text-link kc-post-author__link" href="/rolunk">
              <span className="kc-text-link__label">{ctaLabel('about-open')}</span>
              <span aria-hidden="true" className="kc-text-link__arrow">
                →
              </span>
            </Link>
          </div>
        </div>
      ) : null}
      {hasReview ? (
        <div className="kc-post-author__reviewed">
          {separateReviewer && reviewer !== null ? (
            <p>Szakmailag ellenőrizte: {nameWithCredentials(reviewer)}</p>
          ) : null}
          {reviewedDate !== null ? <p>Utoljára ellenőrizve: {reviewedDate}</p> : null}
          {nextReviewDate !== null ? <p>Következő ellenőrzés: {nextReviewDate}</p> : null}
        </div>
      ) : null}
    </Card>
  )
}
