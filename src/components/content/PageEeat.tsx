import type { Page } from '../../payload-types'
import { resolveOgImageUrl, resolveSeoKeywords } from '../../lib/seo'
import { cmsPageJsonLd } from '../../lib/seo-cikk'
import { Container } from '../ui/Container'
import { Section } from '../ui/Section'
import { JsonLd } from './JsonLd'
import { PostAuthorBox } from './PostAuthorBox'
import { PostFaq } from './PostFaq'
import { authorPersonOf, postFaqItems, reviewDatesOf, reviewerPersonOf } from './post-article'

/**
 * PageEeat — szerző-blokk, GYIK és MedicalWebPage JSON-LD a gyökér CMS-oldalon.
 * A Search E-E-A-T kapu a `pages` collection hubjain (pl. `/inhuvelygyulladas`)
 * ugyanazt kéri, mint a Tudástár cikkeken: látható szerző/lektor, kitöltött
 * GYIK, és a sémában Person + FAQPage. A Google *Creating helpful, reliable,
 * people-first content* (YMYL) a „who authored" kérdést a LÁTHATÓ byline-ra
 * köti (https://developers.google.com/search/docs/fundamentals/creating-helpful-content);
 */
export interface PageEeatProps {
  page: Page
  /** Az oldal relatív útvonala, pl. `/rolunk`. */
  path: string
}

export function PageEeat({ page, path }: PageEeatProps) {
  const author = authorPersonOf(page)
  const reviewer = reviewerPersonOf(page)
  const { reviewedAt, nextReviewAt } = reviewDatesOf(page)
  const faqItems = postFaqItems(page)
  const keywords = resolveSeoKeywords(page.seoKeywords)
  const hasFaq = faqItems.length > 0
  const hasAuthorship = author !== null || reviewer !== null || reviewedAt !== null
  const hasKeywords = keywords !== undefined
  const hasSchema = hasAuthorship || hasKeywords

  if (!hasFaq && !hasAuthorship && !hasKeywords) {
    return null
  }

  return (
    <>
      {hasSchema ? (
        <JsonLd
          data={cmsPageJsonLd({
            page,
            path,
            ...(author !== null
              ? { author: { name: author.name, credentials: author.credentials } }
              : {}),
            ...(reviewer !== null
              ? { reviewer: { name: reviewer.name, credentials: reviewer.credentials } }
              : {}),
            lastReviewed: reviewedAt,
            imageUrl: resolveOgImageUrl(page),
            ...(keywords !== undefined ? { keywords } : {}),
          })}
        />
      ) : null}
      {hasFaq || hasAuthorship ? (
        <Section>
          <Container size="narrow">
            <div className="kc-post-body">
              <PostFaq items={faqItems} />
              <PostAuthorBox
                author={author}
                nextReviewAt={nextReviewAt}
                reviewedAt={reviewedAt}
                reviewer={reviewer}
                surface="page"
              />
            </div>
          </Container>
        </Section>
      ) : null}
    </>
  )
}
