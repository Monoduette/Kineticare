import Link from 'next/link'

import type { Post } from '../../payload-types'
import { estimateReadingMinutes } from '../../lib/reading-time'
import { breadcrumbJsonLd, resolveOgImageUrl, resolveSeoKeywords } from '../../lib/seo'
import { postArticleJsonLd } from '../../lib/seo-cikk'
import { kulcsszoFor } from '../../lib/tudastar/seo-kulcsszavak'
import { Badge } from '../ui/Badge'
import { Container } from '../ui/Container'
import { Section } from '../ui/Section'
import { JsonLd } from './JsonLd'
import { MediaImage } from './MediaImage'
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
  postFaqItems,
  relatedHeading,
  reviewDatesOf,
  reviewerPersonOf,
  shouldShowPostCourseCta,
  shouldShowToc,
} from './post-article'
import { headingsOf, plainTextOf, wordCountOf } from './post-outline'

import '../../app/(frontend)/styles/blocks/post-view.css'

/**
 * PostArticle — a Tudástár cikkoldalának karmestere.
 *
 * ═══ A SZAKASZ-SORREND, ÉS MIÉRT PONT EZ ═══
 *
 *   HERO (tint sáv, szűk konténer): morzsamenü · kategória-címke · H1 ·
 *          lead · byline-sor
 *   BORÍTÓ (csak ha van, széles konténer)
 *   TÖRZS (szűk konténer): tartalomjegyzék · CMS-törzs · Gyakori kérdések ·
 *          szerző- és lektor-blokk
 *   KURZUS-CTA (tint sáv, kompakt panel)
 *   KAPCSOLÓDÓ CIKKEK (a Tudástár rácsán, `compact` kártyákkal)
 *
 * A sablon NEM tesz látható Források-listát a lapra. Ha a CMS-törzsben van
 * ilyen H2, az a Lexical-tartalom része; üres törzsnél a sablon nem talál ki
 * forráslistát (a hat élő `/blog/*` cikk és a későbbi, ugyanerre a sablonra
 * ülő posztok sem kapnak sablon-szintű forrásjegyzéket).
 *
 * A sorrend két, látszólag ütköző NN/g-ajánlást old fel. A *Related Content
 * Boosts Pageviews, When Done Right*
 * (https://www.nngroup.com/articles/related-content-pageviews/) szerint „don't
 * let anything come between the article and related links", mert a nagy üres
 * felület és a hirdetés-szerű doboz HAMIS LAPVÉGET jelez; ugyanez a cikk
 * viszont azt is kimondja: „Always offer related content and or strong calls
 * to action at the end of articles." A feloldás: a CTA közvetlenül a cikk
 * után áll, KOMPAKT panelként, és utána AZONNAL jönnek a kapcsolódó cikkek —
 * a két blokk közti üres táv mérve 56 px (post-view.css), a küszöb 72 px
 * (docs/tudastar-ux-terv.md 5.8).
 *
 * A szerző-blokk a TÖRZS zárása (nem a lábléc): az NHS mérése szerint a fő
 * tartalomtól elszakított, lábléc-közeli ellenőrzés-dátumot a felhasználók
 * nem veszik észre (lásd PostAuthorBox).
 *
 * ═══ SZŰK KONTÉNER, NEM KÉT HASÁB ═══
 * A 720 px-es `narrow` konténer + a `--kc-measure` korlát mért sorhossza
 * 47,5–72,2 karakter 390–1920 px között, vagyis végig a 45–85-ös tűrésen
 * belül, 1024 px felett a cél-sávban (docs/tudastar-ux-terv.md 5.2). Kétharmad
 * plusz ragadós oldalsáv (GOV.UK-minta) NEM kell hozzá, és a ragadó elem a
 * meglévő ragadós fejléc mellett WCAG 2.2 **2.4.11** kockázat lenne.
 *
 * ═══ FÁJL-TULAJDON (a vezetőnek) ═══
 * Ez a komponens a `docs/tudastar-technikai-terv.md` 3.9 pontjának
 * `PostView`-terve, ÚJ fájlban. A meglévő `PostView.tsx` ebben a körben nem
 * az én fájlom (más csapat is dolgozik párhuzamosan), ezért nem írtam át:
 * a cikk-útvonal (`blog/[slug]/page.tsx`) erre a komponensre vált, a
 * `PostView` érintetlen marad. Szüret után a vezető döntése, hogy a régi
 * komponenst törli-e (ma már csak a `home-cms.test.ts` hivatkozik rá).
 */
export interface PostArticleProps {
  post: Post
  /** Kívülről betöltött kapcsolódó cikkek (getRelatedPosts); alap: a poszt saját mezője. */
  related?: Post[]
}

/** Csak közzétett, sluggal rendelkező cikk jelenhet meg kapcsolódóként; max 3. */
function displayableRelated(posts: readonly (number | Post)[] | null | undefined): Post[] {
  if (!Array.isArray(posts)) return []
  return posts
    .filter((item): item is Post => typeof item === 'object' && item !== null)
    .filter((item) => item.status === 'published' && typeof item.slug === 'string')
    .slice(0, 3)
}

export function PostArticle({ post, related: relatedProp }: PostArticleProps) {
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

  const showCourseCta = shouldShowPostCourseCta(post)
  const ctaClasses = ['kc-post-cta', related.length > 0 ? 'kc-post-cta--elotte-kapcsolodo' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <article>
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
          path: `/blog/${post.slug}`,
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
          { name: post.title, path: `/blog/${post.slug}` },
        ])}
      />

      <Section className="kc-page-hero" variant="tint">
        <Container size="narrow">
          {/* MORZSAMENÜ (2026-08-21). A keresőből érkező látogató kihagyja a
              köztes szinteket, és a morzsa az, ami eligazítja: NN/g,
              *Breadcrumbs: 11 Design Guidelines* — „when they skip some of
              these levels (for example, because they arrived to the site by
              clicking on an external link such as a search-engine result),
              breadcrumbs orient them"
              (https://www.nngroup.com/articles/breadcrumbs/).

              A SZERKEZET a kurzusoldaléval AZONOS
              (`kurzusok/[slug]/page.tsx`): ugyanaz a `nav[aria-label]`,
              ugyanaz az `ol`, a gyűjtőoldal linkként, az aktuális lap
              `aria-current="page"`-dzsel és NEM linkként. A WCAG 2.2 **3.2.3**
              (Consistent Navigation) ezt kéri: az ismétlődő navigációs
              mechanizmus ugyanabban a relatív sorrendben álljon minden lapon —
              mérve a cikkoldalon eddig 0 link mutatott a `/blog`-ra, miközben
              a kurzusoldalnak volt morzsája. Az `aria-current="page"` a W3C
              ARIA APG morzsa-mintája („The link to the current page has
              aria-current set to page"; nem-link elemnél elhagyható, de a
              kurzusoldal is kiírja, ezért itt is).

              KÉT SZINT, a JSON-LD-vel AZONOS tartalommal (lásd a fenti
              `breadcrumbJsonLd`-t): a strukturált adat és a látható morzsa
              nem tud szétcsúszni. A kategória-oldalra a hero címkéje visz,
              ezért az nem ismétlődik meg itt harmadik szintként. */}
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
          <h1 className="kc-page-hero__title">{post.title}</h1>
          {post.excerpt ? <p className="kc-page-hero__lead">{post.excerpt}</p> : null}
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

      {/* A kurzuslista-lábléc a `befagyott-vall` slugon elmarad. A fejléc
          „Kurzusok" navigációja nem ide tartozik, az minden lapon marad. */}
      {showCourseCta ? (
        <Section className={ctaClasses} variant="tint">
          <Container size="narrow">
            <PostCourseCta course={courseCtaTargetOf(post)} />
          </Container>
        </Section>
      ) : null}

      {related.length > 0 ? (
        <Section className="kc-post-related">
          <Container>
            <h2 className="kc-section-title">{relatedHeading(post, related)}</h2>
            {/* A KAPCSOLÓDÓ BLOKK RÁCSA ÉS KÁRTYA-VÁLTOZATA (2026-08-21).

                Eddig a közös hármas `kc-card-grid` + az alapértelmezett
                `list` változat állt itt, kivonattal. Mérve (Chromium 141, a
                repó valódi betűivel) a kivonat sorhossza 1440 px-en
                27/33/38, 1024 px-en 23/30/34, 320 px-en 23/28/30
                karakter/sor volt — mindenhol a repó Ü6 szabályának 45-ös
                alsó tűrése ALATT (docs/ui-sztenderdek.md; a találat
                docs/tudastar-a11y-meres.md 3.1 és a séta 6.3 pontja).

                A javítás kettős, és a `PostCard` már kész eszközeit
                használja: a `compact` változat NEM ODATESZI a kivonatot (nem
                elrejti — úgy a képernyőolvasó és a keresőrobot még mindig
                végigolvasná), a `kc-card-grid--posts` módosító pedig a
                Tudástár mért rácsát hozza ide is, tehát a lista-oldal és a
                kapcsolódó blokk ugyanazt a kártya-nyelvet beszéli
                (WCAG 2.2 **3.2.4**, Consistent Identification).

                Miért elég a cím kivonat nélkül: NN/g, *Cards: UI-Component
                Definition* (https://www.nngroup.com/articles/cards-component/)
                szerint a kártya „a linked, short representation of a
                conceptual unit" — a teaser-sávban a cím önmagában elég
                információ-szag. A címsor-szint marad h3, mert fölötte a
                szekció h2-je áll. */}
            <div className="kc-card-grid kc-card-grid--posts">
              {related.map((relatedPost) => (
                <PostCard key={relatedPost.id} post={relatedPost} variant="compact" />
              ))}
            </div>
          </Container>
        </Section>
      ) : null}
    </article>
  )
}
