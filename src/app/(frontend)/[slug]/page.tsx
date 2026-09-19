import type { Metadata } from 'next'
import { draftMode } from 'next/headers'
import { notFound } from 'next/navigation'
import { cache } from 'react'

import { RenderBlocks } from '@/components/blocks/RenderBlocks'
import { JsonLd } from '@/components/content/JsonLd'
import { PageEeat } from '@/components/content/PageEeat'
import { PageHero } from '@/components/content/PageHero'
import { PostArticle } from '@/components/content/PostArticle'
import { KNOWLEDGE_POSTS_FETCH_LIMIT } from '@/components/content/home/KnowledgeSection'
import { hasLexicalContent } from '@/components/lexical/serialize'
import { RichText } from '@/components/lexical/RichText'
import { authorPersonOf } from '@/components/content/post-article'
import { PreviewBar } from '@/components/preview/PreviewBar'
import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { getAppointmentSectionContext } from '@/lib/appointment/section'
import {
  getFreeProduct,
  getLatestPosts,
  getPageBySlug,
  getPostBySlug,
  getPublishedPageSlugs,
  getPublishedProducts,
  getRelatedPosts,
  getTestimonials,
} from '@/lib/cms'
import { HUB_OLDALAK, hubUtvonalTerkep } from '@/lib/tudastar/hub-oldalak'
import { presentHomeLayout, presentSzolgaltatasokLayout } from '@/lib/home-help-states'
import { withDraftRobots } from '@/lib/preview/draft-metadata'
import {
  absoluteUrl,
  buildPageMetadata,
  organizationNode,
  resolveOgImageUrl,
  resolveSeoDescription,
} from '@/lib/seo'
import {
  personNodes,
  serviceNodesFromLayout,
  siteGraphJsonLd,
  teamPersonsFromLayout,
} from '@/lib/seo-graph'
import type { Post, Product, Testimonial } from '@/payload-types'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string }> }

const pageOf = cache((slug: string, draft: boolean) => getPageBySlug(slug, { draft }))
/** A hub forrás-cikke (published-szűrt) — a generateMetadata és a lap közös, kérés-idejű lekérdezése. */
const hubPostOf = cache((cikkSlug: string) => getPostBySlug(cikkSlug))

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  // Draft mode-ban a piszkozat metaadata jön — és a válasz sosem indexelhető.
  const { isEnabled: isDraft } = await draftMode()
  const page = await pageOf(slug, isDraft)
  if (!page) return withDraftRobots({}, isDraft)
  // Gyökér tünet-hub: a lap a forrás-cikk teljes cikkélményét adja, ezért a
  // megosztási típusa `article` (published/modified time, szerző), ahogy a
  // `/blog/[slug]` útvonalon is (ogp.me article: https://ogp.me/#type_article).
  const hub = HUB_OLDALAK.find((jelolt) => jelolt.slug === slug)
  const post = hub !== undefined ? await hubPostOf(hub.cikkSlug) : null
  if (post) {
    const author = authorPersonOf(post)
    return withDraftRobots(
      buildPageMetadata(page, `/${slug}`, {
        article: {
          publishedTime: post.publishedAt,
          modifiedTime: post.updatedAt,
          ...(author !== null ? { authors: [author.name] } : {}),
        },
      }),
      isDraft,
    )
  }
  return withDraftRobots(buildPageMetadata(page, `/${slug}`), isDraft)
}

/**
 * CMS-oldal (Pages) renderelése — hero + SZEKCIÓSOR vagy rich-text.
 * SZEKCIÓ-RENDSZER (docs/ux-belso-oldalak-kutatas.md, P3): a `Pages.layout`
 * blokk-mező 16 blokktípussal régóta létezik, és az admin súgója is azt ígéri,
 * hogy az „az oldal építőkockás része" — ez a route viszont SOHA nem
 * rendereli. A staff összerakhatott egy szekciósort, elmenthette, és semmi
 * nem jelent meg belőle: néma tartalomvesztés, egyben a „minden egymás alatt
 */
export default async function CmsPage({ params }: Props) {
  const { slug } = await params
  // Előnézet (draft mode): a publikálatlan verzió is látszik. A sütit kizárólag
  // a /next/preview route adhatja, oda pedig csak staff/owner jut be.
  const { isEnabled: isDraft } = await draftMode()
  const page = await pageOf(slug, isDraft)
  if (!page) notFound()

  // GYÖKÉR TÜNET-HUB: a hub a `pages`-ben él (ő a publikálási kapcsoló és a
  // SEO-metaadat gazdája), a LÁTHATÓ lap viszont a forrás-cikk TELJES
  // cikkélménye — jegyzék, források, GYIK, kurzus-ajánló, ingyenes sor,
  // időpont-doboz, kapcsolódó cikkek. Enélkül a gyökérre költözéskor pont a
  // cikk alatti híd-rendszer veszne el (tulajdonosi döntés, 2026-08-25:
  // ajánló minden cikk alatt). A séma-útvonal a gyökér-URL (path prop), a
  // generic CMS-render és a PageEeat ilyenkor kimarad — kettős GYIK/séma
  // nélkül. A cikk maga published-szűrt: a hub a publikált cikk tükre.
  const hub = HUB_OLDALAK.find((jelolt) => jelolt.slug === slug)
  if (hub !== undefined) {
    const post = await hubPostOf(hub.cikkSlug)
    if (post) {
      const [related, freeCourse, publikaltOldalak] = await Promise.all([
        getRelatedPosts(post),
        getFreeProduct(),
        getPublishedPageSlugs(),
      ])
      // A kapcsolódó cikkek kártyái is a KANONIKUS gyökér-címre linkelnek, ahol
      // a hub publikált — a hub-lapról 308-as átirányításra mutatni különösen
      // fölösleges kör (`docs/oldal-audit-b-tudastar-2026-09-07.md` 1. találat).
      const hubUtvonalak = hubUtvonalTerkep(
        related
          .map((relatedPost) => relatedPost.slug)
          .filter((relatedSlug): relatedSlug is string => typeof relatedSlug === 'string'),
        publikaltOldalak,
      )
      return (
        <>
          {isDraft ? <PreviewBar path={`/${slug}`} /> : null}
          {/* Oldal-gráf: Organization + WebSite + WebPage. A cikk-csomópontot
              (Article + MedicalWebPage, @id …#article) és a morzsát a
              PostArticle rendereli — a WebPage `mainEntity`/`breadcrumb`
              mezője @id-vel hivatkozik rájuk, nem írja le kétszer. */}
          <JsonLd
            data={siteGraphJsonLd({
              page: {
                path: `/${slug}`,
                name: post.title,
                description: resolveSeoDescription(post),
                imageUrl: resolveOgImageUrl(post),
                datePublished: post.publishedAt,
                dateModified: post.updatedAt,
                mainEntityId: `${absoluteUrl(`/${slug}`)}#article`,
              },
              breadcrumbRef: true,
            })}
          />
          <PostArticle
            freeCourse={freeCourse}
            hubUtvonalak={hubUtvonalak}
            path={`/${slug}`}
            post={post}
            related={related}
          />
        </>
      )
    }
    // Ha a forrás-cikk valamiért nem elérhető, a lap a CMS-oldal tartalmára
    // esik vissza — ugyanaz a lektorált törzs, cikk-extrák nélkül.
  }

  const rawLayout = page.layout ?? []
  const layout =
    slug === 'szolgaltatasok'
      ? presentSzolgaltatasokLayout(rawLayout)
      : slug === 'kezdolap'
        ? presentHomeLayout(rawLayout)
        : rawLayout
  const hasLayout = layout.length > 0
  // A film-hero saját h1-et renderel — ilyenkor a szöveges hero elmarad.
  const hasFilmHero = layout.some(
    (block) => block.blockType === 'filmHero' && block.sectionSettings?.visible !== false,
  )
  const heroMedia = page.heroImage && typeof page.heroImage === 'object' ? page.heroImage : null

  // A posztokból a knowledge blokk felső limitjéig kérünk, hogy a szekciósor
  // bármely beállítása egyetlen párhuzamos lekérdezésből kijöjjön (a kezdőlap
  // route ugyanezt teszi). A listák published-szűrtek maradnak: a
  // piszkozat-előnézet az oldal SAJÁT tartalmára vonatkozik.
  const [products, posts, testimonials]: [Product[], Post[], Testimonial[]] = hasLayout
    ? await Promise.all([
        getPublishedProducts(),
        getLatestPosts(KNOWLEDGE_POSTS_FETCH_LIMIT),
        getTestimonials(),
      ])
    : [[], [], []]
  // A knowledge blokk kártyáinak KANONIKUS célja (publikált gyökér-hubnál a
  // gyökér-cím). Lekérdezés csak akkor fut, ha van egyáltalán szekciósor.
  const hubUtvonalak = hasLayout
    ? hubUtvonalTerkep(
        posts
          .map((post) => post.slug)
          .filter((postSlug): postSlug is string => typeof postSlug === 'string'),
        await getPublishedPageSlugs(),
      )
    : {}

  // Az időpontkérő szekció űrlapjához kell a form-azonosító és a Turnstile
  // site key. A lekérdezés CSAK akkor fut, ha van ilyen blokk a lapon
  // (getAppointmentSectionContext maga dönti el) — ugyanaz a takarékossági
  // elv, mint a fenti három listánál.
  const appointment = await getAppointmentSectionContext(layout)

  // Oldal-gráf (src/lib/seo-graph.ts): Organization + WebSite + WebPage +
  // BreadcrumbList (Kezdőlap → lap). A /rolunk AboutPage, a két szakember
  // Person-ként a csapat-blokkból (Google *Organization* / schema.org
  // AboutPage: https://schema.org/AboutPage); a /szolgaltatasok a services-
  // blokk sorait Service-ként hirdeti. A PageEeat MedicalWebPage-csomópontja
  // ugyanazt az @id-t viseli (…#webpage), így a két script EGY entitást ír le.
  const persons = slug === 'rolunk' ? teamPersonsFromLayout(rawLayout) : []
  const services = slug === 'szolgaltatasok' ? serviceNodesFromLayout(rawLayout, `/${slug}`) : []
  const siteGraph = siteGraphJsonLd({
    page: {
      path: `/${slug}`,
      name: page.title,
      // Film-hero mellett a szöveges bevezető (excerpt) NEM látszik a lapon,
      // ezért a séma leírása ilyenkor csak a seoDescription lehet (a
      // strukturált adat a látható tartalmat írja le).
      description: hasFilmHero
        ? resolveSeoDescription({ title: page.title, seoDescription: page.seoDescription })
        : resolveSeoDescription(page),
      ...(slug === 'rolunk' ? { type: 'AboutPage' } : {}),
      imageUrl: resolveOgImageUrl(page),
      datePublished: page.publishedAt,
      dateModified: page.updatedAt,
    },
    breadcrumbs: [
      { name: 'Kezdőlap', path: '/' },
      { name: page.title, path: `/${slug}` },
    ],
    ...(persons.length > 0
      ? {
          organization: organizationNode({
            founder: personNodes(persons).map((node) => ({ '@id': node['@id'] })),
          }),
        }
      : {}),
    nodes: [...personNodes(persons), ...services],
  })

  return (
    <>
      {isDraft ? <PreviewBar path={`/${slug}`} /> : null}
      <JsonLd data={siteGraph} />
      <article className="kc-cms-page">
        {/* WP51: a /rolunk fejléc-képe a cím MELLETT áll (PageHero `paired`);
            minden más CMS-oldal a képet a fejléc alatt, természetes arányán
            kapja (`stacked`), mert a heroImage mező általános. */}
        {hasFilmHero ? null : (
          <PageHero
            lead={page.excerpt}
            media={heroMedia}
            title={page.title}
            variant={slug === 'rolunk' ? 'paired' : 'stacked'}
          />
        )}
        {hasLayout ? (
          <RenderBlocks
            appointment={appointment}
            hubUtvonalak={hubUtvonalak}
            layout={layout}
            posts={posts}
            products={products}
            testimonials={testimonials}
          />
        ) : hasLexicalContent(page.content) ? (
          <Section>
            <Container size="narrow">
              <RichText content={page.content} />
            </Container>
          </Section>
        ) : null}
        {/* E-E-A-T: szerző-blokk + GYIK + MedicalWebPage/FAQPage JSON-LD.
            Üres mezőnél a komponens null — a lap a mai viselkedést adja.
            A hub a `pages` collectionben marad, nem a `/blog/` útvonalon. */}
        <PageEeat page={page} path={`/${slug}`} />
      </article>
    </>
  )
}
