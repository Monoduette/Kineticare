import Link from 'next/link'

import type { Post } from '../../payload-types'
import { estimateReadingMinutes } from '../../lib/reading-time'
import { breadcrumbJsonLd, resolveOgImageUrl, resolveSeoKeywords } from '../../lib/seo'
import { postArticleJsonLd } from '../../lib/seo-cikk'
import { cikkUtvonal } from '../../lib/tudastar/hub-oldalak'
import { kulcsszoFor } from '../../lib/tudastar/seo-kulcsszavak'
import { Badge } from '../ui/Badge'
import { Container } from '../ui/Container'
import { Section } from '../ui/Section'
import { JsonLd } from './JsonLd'
import { PageHero } from './PageHero'
import { formatPostDate, PostCard } from './PostCard'
import { PostAuthorBox } from './PostAuthorBox'
import { PostBody } from './PostBody'
import { PostCourseCta } from './PostCourseCta'
import { PostFaq, POST_FAQ_HEADING, POST_FAQ_HEADING_ID } from './PostFaq'
import { PostToc } from './PostToc'
import {
  authorPersonOf,
  bylineOf,
  courseCtaTargetOf,
  firstCategoryOf,
  freeCourseCtaTargetOf,
  postCtaShowsFreeCourse,
  postCtaVariantOf,
  postFaqItems,
  relatedHeading,
  reviewDatesOf,
  reviewerPersonOf,
  shouldShowToc,
} from './post-article'
import { headingsOf, plainTextOf, wordCountOf } from './post-outline'
import { ArticleEngagement } from '../analytics/ArticleEngagement'

import '../../app/(frontend)/styles/blocks/post-view.css'

/**
 * PostArticle — a Tudástár cikkoldalának karmestere.
 * A sablon NEM tesz látható Források-listát a lapra. Ha a CMS-törzsben van
 * plusz ragadós oldalsáv (GOV.UK-minta) NEM kell hozzá, és a ragadó elem a
 */
export interface PostArticleProps {
  post: Post
  /** Kívülről betöltött kapcsolódó cikkek (getRelatedPosts); alap: a poszt saját mezője. */
  related?: Post[]
  /**
   * A tudatosan ingyenes belépő kurzus (getFreeProduct) a cikk végi
   * ajánlóhoz; kihagyva vagy null értékkel a panel ingyenes sora elmarad.
   */
  freeCourse?: unknown
  /**
   * A cikk kanonikus útvonala a sémákban (Article JSON-LD, morzsa).
   * Alap: `/blog/{slug}`. A gyökér-hub útvonal (`/[slug]`) ugyanazt a
   * cikk-élményt rendereli a saját címén — ilyenkor a séma-útvonalnak a
   * gyökér-URL-t kell mondania, különben a JSON-LD a 308-cal átirányító
   * régi címre mutatna.
   */
  path?: string
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

/** Csak közzétett, sluggal rendelkező cikk jelenhet meg kapcsolódóként; max 3. */
function displayableRelated(posts: readonly (number | Post)[] | null | undefined): Post[] {
  if (!Array.isArray(posts)) return []
  return posts
    .filter((item): item is Post => typeof item === 'object' && item !== null)
    .filter((item) => item.status === 'published' && typeof item.slug === 'string')
    .slice(0, 3)
}

export function PostArticle({
  post,
  related: relatedProp,
  freeCourse,
  path,
  hubUtvonalak,
}: PostArticleProps) {
  const canonicalPath = path ?? `/blog/${post.slug}`
  const author = authorPersonOf(post)
  const reviewer = reviewerPersonOf(post)
  const { reviewedAt, nextReviewAt } = reviewDatesOf(post)
  const category = firstCategoryOf(post)
  const date = formatPostDate(post.publishedAt)
  // A becslés a SIMA SZÖVEGBŐL számol, nem a nyers Lexical-fából: a fa
  // bejárása a mezők értékeit (`ltr`, `paragraph`, `normal`) is szónak
  // számolná, csomópontonként 2–3 fantomszóval (technikai terv D5).
  const readingMinutes = estimateReadingMinutes(plainTextOf(post.content))
  const faqItems = postFaqItems(post)
  // A keywords a CMS mezőből jön. Az `about` továbbra is a mért tábla
  // `targy` mezője (betegség-entitás, nem szerkesztői kulcsszó).
  const keywords = resolveSeoKeywords(post.seoKeywords)
  const kulcsszoOf = typeof post.slug === 'string' ? kulcsszoFor(post.slug) : undefined
  const related = displayableRelated(relatedProp ?? post.relatedPosts)
  const heroMedia = post.heroImage && typeof post.heroImage === 'object' ? post.heroImage : null

  // Tartalomjegyzék: a törzs H2-i, és ha van GYIK, annak a címsora a lista
  // VÉGÉN — az nem a Lexical-tartalomban él, ezért a bejáró nem látja. A
  // küszöb viszont csak a TARTALMI H2-ket számolja.
  const contentHeadings = headingsOf(post.content).filter((heading) => heading.tag === 'h2')
  const tocItems = [
    ...contentHeadings.map((heading) => ({ id: heading.id, text: heading.text })),
    ...(faqItems.length > 0 ? [{ id: POST_FAQ_HEADING_ID, text: POST_FAQ_HEADING }] : []),
  ]
  const showToc = shouldShowToc(wordCountOf(post.content), contentHeadings.length)

  const ctaVariant = postCtaVariantOf(post)
  const ctaClasses = ['kc-post-cta', related.length > 0 ? 'kc-post-cta--elotte-kapcsolodo' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <article>
      {/* Tartalmi funnel-mérés: article_viewed/read, CTA- és GYIK-kattintás.
          Láthatatlan kliens-komponens, delegált figyelőkkel — a cikk
          szerver-komponensei nem hidratálódnak miatta. Consent nélkül no-op. */}
      <ArticleEngagement
        articleSlug={typeof post.slug === 'string' ? post.slug : ''}
        path={canonicalPath}
      />
      {/* A CIKK SÉMÁJA: EGY node, `['Article', 'MedicalWebPage']` kettős
          típussal (`src/lib/seo-cikk.ts`). A `MedicalWebPage`-tag nem
          dísz: a `WebPage` altípusa, és CSAK ettől lesz érvényes a
          `reviewedBy` és a `lastReviewed` tulajdonság — `Article` típuson
          mindkettő érvénytelen lenne (https://schema.org/reviewedBy,
          https://schema.org/lastReviewed).

          A séma-réteg SOSEM látja a nyers user-dokumentumot (technikai terv
          2.4): a populált szerző a jelszó-hasht és a session-listát is viszi,
          ezért csak a byline-ban IS LÁTHATÓ nevet és titulust adjuk át. */}
      <JsonLd
        data={postArticleJsonLd({
          post,
          path: canonicalPath,
          ...(author !== null
            ? { author: { name: author.name, credentials: author.credentials } }
            : {}),
          ...(reviewer !== null
            ? { reviewer: { name: reviewer.name, credentials: reviewer.credentials } }
            : {}),
          // Ellenőrzés-dátum ellenőrzés nélkül hazugság (docs/tudastar-ux-terv.md
          // 5.6): a séma-réteg üres mezőnél kihagyja a kulcsot, ahogy a látható
          // szerző-blokk is elhagyja a sort.
          lastReviewed: reviewedAt,
          imageUrl: resolveOgImageUrl(post),
          // Kulcsszó: CSAK a CMS mező. Üresen a séma-kulcs kimarad, a H1-et
          // nem töltjük bele. Az `about` a mért tábla tárgya marad.
          ...(keywords !== undefined ? { keywords } : {}),
          ...(kulcsszoOf === undefined ? {} : { about: kulcsszoOf.targy }),
        })}
      />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'Tudástár', path: '/blog' },
          { name: post.title, path: canonicalPath },
        ])}
      />

      {/* A CIKK FEJLÉCE A PageHero (WP57, tulajdonosi kérés 2026-09-19: a
          cikkek „lehetnek szélesebbek, olyan szélesek, mint amit kiemeltek a
          lányok, hogy túl keskeny"). Mérve élőben (Chromium, 1440 px,
          /befagyott-vall): a fejléc 720 px-es sávjában a cím 672, a bevezető
          544 px (64 karakter/sor) volt, ugyanaz a hasáb, amit a /szolgaltatasok
          fejlécén a tulajdonos szűknek látott (WP51: 672 px, a sáv 53 %-a
          üres). Borítóképpel a fejléc a PageHero PÁROS alakját kapja: széles
          konténer, a cím és a bevezető balra, a fotó jobbra, 900 px alatt a
          kép a szöveg alatt. Borítókép nélkül a szűk, egymás alatti alak
          marad (ma egyik élő cikknek sincs borítója: a széles fejléc a kép
          feltöltésével lép életbe, kódváltozás nélkül). A morzsa, a
          kategória-címke és a meta-sor ugyanabban a szöveghasábban áll, a
          régi sorrendben (eyebrow, cím, bevezető, meta). Egy markup-forrás
          (PageHero), nem másolat: a CMS-oldal és a cikk fejléce egy család
          (WCAG 2.2 SC 3.2.4 Consistent Identification). Források: NN/g Common
          Region, Material 3 supporting pane, GOV.UK Images (PageHero.tsx). */}
      <PageHero
        className="kc-post-hero"
        eyebrow={
          <>
            {/* Morzsa: két szint, JSON-LD-vel azonos; kurzusoldal mintájára. */}
            <nav aria-label="Morzsamenü" className="kc-post-breadcrumb">
              <ol role="list">
                <li>
                  <Link href="/blog">Tudástár</Link>
                </li>
                <li aria-current="page">{post.title}</li>
              </ol>
            </nav>
            {/* PONTOSAN egy kategória-címke (docs/tudastar-ux-terv.md 5.3): a
                következetesség ugyanaz a Baymard-elv, mint a kártyákon, és a
                címke a kategória-oldalra vezető visszaút is. */}
            {category !== null && typeof category.slug === 'string' ? (
              <p className="kc-post-hero__categories">
                <Link href={`/blog/kategoria/${category.slug}`}>
                  <Badge tone="info">{category.title}</Badge>
                </Link>
              </p>
            ) : null}
          </>
        }
        lead={post.excerpt}
        media={heroMedia}
        meta={
          <p className="kc-post-meta">
            {author !== null ? (
              <span className="kc-post-meta__author">
                {bylineOf(author.name, author.credentials)}
              </span>
            ) : null}
            {date !== null ? (
              <time dateTime={typeof post.publishedAt === 'string' ? post.publishedAt : undefined}>
                {date}
              </time>
            ) : null}
            {/* A „kb." kimondja, hogy BECSLÉS: a 200 szó/perc a legjobb
                elérhető közelítés (Brysbaert 2019, 238 szó/perc angol
                nem-fikcióra), magyarra validált érték nincs. */}
            <span>kb. {readingMinutes} perc olvasás</span>
          </p>
        }
        title={post.title}
        variant="paired"
      />

      <Section>
        <Container size="narrow">
          <div className="kc-post-body">
            {showToc ? <PostToc items={tocItems} /> : null}
            <PostBody content={post.content} />
            <PostFaq items={faqItems} />
            <PostAuthorBox
              author={author}
              nextReviewAt={nextReviewAt}
              reviewedAt={reviewedAt}
              reviewer={reviewer}
            />
          </div>
        </Container>
      </Section>

      {/* A cikk végi ajánló MINDEN cikk alatt áll (tulajdonosi döntés,
          2026-08-25), a témához igazított változattal: a váll-cikk időpontot
          ajánl, a többi kurzust. A fejléc „Kurzusok" navigációja nem ide
          tartozik, az minden lapon marad. */}
      {/* Két paneles (kurzus + időpont) sávnál a SZÉLES konténer jár
          (tulajdonosi kérés, 2026-08-29): a kártyapár így pontosan olyan
          széles, mint alatta a kapcsolódó cikkek rácsa — a keskeny (720px)
          konténerben a két kártya kényelmetlenül összenyomódott. Az egy
          paneles időpont-változat (váll) marad keskeny: egy magányos, 1120
          px-es kártya hamis „szekció-hero" benyomást keltene. */}
      <Section className={ctaClasses} variant="tint">
        <Container size={ctaVariant === 'idopont' ? 'narrow' : 'wide'}>
          <PostCourseCta
            course={courseCtaTargetOf(post)}
            freeCourse={postCtaShowsFreeCourse(post) ? freeCourseCtaTargetOf(freeCourse) : null}
            variant={ctaVariant}
          />
        </Container>
      </Section>

      {related.length > 0 ? (
        <Section className="kc-post-related">
          <Container>
            <h2 className="kc-section-title">{relatedHeading(post, related)}</h2>
            {/* compact PostCard + kc-card-grid--posts: kivonat nélkül, lista-nyelvvel. */}
            <div className="kc-card-grid kc-card-grid--posts">
              {related.map((relatedPost) => (
                <PostCard
                  key={relatedPost.id}
                  href={cikkUtvonal(relatedPost.slug ?? '', hubUtvonalak)}
                  post={relatedPost}
                  variant="compact"
                />
              ))}
            </div>
          </Container>
        </Section>
      ) : null}
    </article>
  )
}
