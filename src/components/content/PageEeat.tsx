import type { Page } from '../../payload-types'
import { resolveOgImageUrl } from '../../lib/seo'
import { cmsPageJsonLd } from '../../lib/seo-cikk'
import { Container } from '../ui/Container'
import { Section } from '../ui/Section'
import { JsonLd } from './JsonLd'
import { PostAuthorBox } from './PostAuthorBox'
import { PostFaq } from './PostFaq'
import { authorPersonOf, postFaqItems, reviewDatesOf, reviewerPersonOf } from './post-article'

/**
 * PageEeat — szerző-blokk, GYIK és MedicalWebPage JSON-LD a gyökér CMS-oldalon.
 *
 * ═══ MIÉRT A CIKKOLDAL UGYANAZ A NYELVE ═══
 * A Search E-E-A-T kapu a `pages` collection hubjain (pl. `/inhuvelygyulladas`)
 * ugyanazt kéri, mint a Tudástár cikkeken: látható szerző/lektor, kitöltött
 * GYIK, és a sémában Person + FAQPage. A Google *Creating helpful, reliable,
 * people-first content* (YMYL) a „who authored" kérdést a LÁTHATÓ byline-ra
 * köti (https://developers.google.com/search/docs/fundamentals/creating-helpful-content);
 * az NN/g byline-kutatása ugyanezt a hitelesítő blokkot a lap ALJÁN kéri
 * (https://www.nngroup.com/articles/bylines/); az NHS „Page last reviewed"
 * mintája a fő tartalomhoz közel teszi a dátumot, nem a láblécbe
 * (https://service-manual.nhs.uk/design-system/patterns/know-that-a-page-is-up-to-date).
 * WCAG 2.2 **3.2.4** (Consistent Identification): ugyanaz a dolog ugyanúgy
 * nézzen ki — ezért a `PostFaq` és a `PostAuthorBox` jön ide, nem új blokk.
 *
 * ═══ ÜRES MEZŐ = NINCS BLOKK, NINCS SÉMA ═══
 * Author nélkül nincs Person és nincs author kulcs (a kiadó a publisher
 * Organization). Üres faq[] mellett nincs FAQPage. reviewedBy nélkül nincs
 * reviewedBy a sémában. A kitöltetlen oldal úgy renderel, mint eddig.
 * Forráslistát ez a blokk sem tesz a lapra.
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
  const hasFaq = faqItems.length > 0
  const hasAuthorship = author !== null || reviewer !== null || reviewedAt !== null
  const hasSchema = hasAuthorship

  if (!hasFaq && !hasAuthorship) {
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
          })}
        />
      ) : null}
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
    </>
  )
}
