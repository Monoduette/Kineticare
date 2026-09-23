import type { Metadata } from 'next'
import { isLegacyNoindexPage } from '@/lib/legacy-noindex'
import { draftMode } from 'next/headers'
import { notFound } from 'next/navigation'
import { cache } from 'react'

import { pageBlocks } from '@/blocks'
import { RenderBlocks } from '@/components/blocks/RenderBlocks'
import { JsonLd } from '@/components/content/JsonLd'
import { PageEeat } from '@/components/content/PageEeat'
import { PageHero, PAROS_FEJLEC_SLUGOK } from '@/components/content/PageHero'
import { PostArticle } from '@/components/content/PostArticle'
import { KNOWLEDGE_POSTS_FETCH_LIMIT } from '@/components/content/home/KnowledgeSection'
import { hasLexicalContent } from '@/components/lexical/serialize'
import { RichText } from '@/components/lexical/RichText'
import { authorPersonOf } from '@/components/content/post-article'
import { hubSzalag, szerkesztoReteg } from '@/components/editor/frontend/szerkeszto-szalag'
import { SzerkesztoOldalSzalag } from '@/components/editor/frontend/SzerkesztoSzalag'
import { szekcioMelylink } from '@/components/editor/szekcio-melylink'
import { PreviewBar } from '@/components/preview/PreviewBar'
import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { getAppointmentSectionContext } from '@/lib/appointment/section'
import { getContactEmail } from '@/lib/contact-email-server'
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
import { hubSeoForras } from '@/lib/hub-seo'
import { HUB_OLDALAK, hubUtvonalTerkep } from '@/lib/tudastar/hub-oldalak'
import { CTA_TERMEK_LEKERDEZES_LIMIT, rolunkCtaMontazs } from '@/lib/cta-banner-course'
import { presentHomeLayout, presentSzolgaltatasokLayout } from '@/lib/home-help-states'
import { withDraftRobots } from '@/lib/preview/draft-metadata'
import {
  absoluteUrl,
  buildPageMetadata,
  NOINDEX_ROBOTS,
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
import { getTudastarLathato } from '@/lib/tudastar-lathatosag'
import { layoutTudastarLinkekNelkul, lexicalTudastarLinkekNelkul } from '@/lib/tudastar-link-szuro'
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
  // Tudástár-kapcsoló: a tünet-hub Tudástár-cikk. Kikapcsolt Tudástárnál a lap
  // közvetlen linkkel elérhető marad (200), de `noindex, follow` jelölést kap;
  // a robots.txt nem tiltja, különben a kereső a noindexet sem látná
  // (https://developers.google.com/search/docs/crawling-indexing/block-indexing).
  // Az előnézet (draft) robots-metája ettől függetlenül felülír (withDraftRobots).
  const hubRejtett = hub !== undefined && !(await getTudastarLathato())
  const post = hub !== undefined ? await hubPostOf(hub.cikkSlug) : null
  if (post) {
    const author = authorPersonOf(post)
    // A leírás és a kulcsszavak a hub KÖZÖS feloldóláncából (src/lib/hub-seo.ts,
    // modul-térkép H05/A20): a lap WebPage- és Article-sémája ugyanezt kapja,
    // így a meta és a strukturált adat nem válhat szét. Cím és megosztási kép:
    // továbbra is az Oldalé.
    const hubMetadata = buildPageMetadata(page, `/${slug}`, {
      article: {
        publishedTime: post.publishedAt,
        modifiedTime: post.updatedAt,
        ...(author !== null ? { authors: [author.name] } : {}),
      },
      seoForras: hubSeoForras({ page, post }),
    })
    return withDraftRobots(
      hubRejtett ? { ...hubMetadata, robots: NOINDEX_ROBOTS } : hubMetadata,
      isDraft,
    )
  }
  const metadata = buildPageMetadata(page, `/${slug}`)
  if (hubRejtett) {
    return withDraftRobots({ ...metadata, robots: NOINDEX_ROBOTS }, isDraft)
  }
  if (isLegacyNoindexPage({ slug, title: page.title })) {
    // Örökölt demólap: amíg a CMS-ben közzétett, kódszintű noindex védi
    // (src/lib/legacy-noindex.ts). A `follow: true` a belső linkeket meghagyja.
    return withDraftRobots(
      {
        ...metadata,
        robots: { index: false, follow: true, googleBot: { index: false, follow: true } },
      },
      isDraft,
    )
  }
  return withDraftRobots(metadata, isDraft)
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
      const [related, freeCourse, publikaltOldalak, contactEmail] = await Promise.all([
        getRelatedPosts(post),
        getFreeProduct(),
        getPublishedPageSlugs(),
        getContactEmail(),
      ])
      // Ugyanaz a lánc, mint a generateMetadata-ban: a WebPage leírása = a meta
      // leírása, az Article kulcsszavai = a meta kulcsszavai.
      const seoForras = hubSeoForras({ page, post })
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
          {isDraft ? (
            <>
              <PreviewBar
                path={`/${slug}`}
                szerkesztoHref={szekcioMelylink({ collection: 'pages', id: page.id })}
              />
              {/* A hub két dokumentumból áll: a látható cikk a blogbejegyzés,
                  a meta az oldal (modul-térkép H05), ezért két szerkesztő-link. */}
              <SzerkesztoOldalSzalag szalag={hubSzalag({ lap: page, bejegyzes: post })} />
            </>
          ) : null}
          {/* Oldal-gráf: Organization + WebSite + WebPage. A cikk-csomópontot
              (Article + MedicalWebPage, @id …#article) és a morzsát a
              PostArticle rendereli — a WebPage `mainEntity`/`breadcrumb`
              mezője @id-vel hivatkozik rájuk, nem írja le kétszer. */}
          <JsonLd
            data={siteGraphJsonLd({
              page: {
                path: `/${slug}`,
                name: post.title,
                description: seoForras.description,
                imageUrl: resolveOgImageUrl(post),
                datePublished: post.publishedAt,
                dateModified: post.updatedAt,
                mainEntityId: `${absoluteUrl(`/${slug}`)}#article`,
              },
              breadcrumbRef: true,
              contactEmail,
            })}
          />
          <PostArticle
            freeCourse={freeCourse}
            hubUtvonalak={hubUtvonalak}
            jsonLdKulcsszavak={seoForras.keywords}
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

  // Tudástár-kapcsoló (src/lib/tudastar-kapcsolo.ts): kikapcsolt Tudástárnál a
  // lap szekciósorából és rich textjéből kikerül minden Tudástár-hivatkozás, a
  // Tudástár-ajánló pedig üres posztlistát kap (így nem renderel, és a posztok
  // lekérdezése sem fut). A szűrő a MEGJELENÍTÉS UTÁN fut, hogy egy kiürült
  // link ne váltsa át a lap elrendezését (pl. a /szolgaltatasok ajtó-blokkja a
  // három kitöltött CTA-ból ismeri fel magát).
  // A hub (forrás-cikk nélküli tartalék-render) maga is Tudástár-felület: a
  // belső hivatkozásai maradnak, csak a nem Tudástár lapokon szűrünk.
  const tudastarLathato = await getTudastarLathato()
  const linkSzures = !tudastarLathato && hub === undefined
  const tudastarNelkul = (blocks: NonNullable<typeof page.layout>) =>
    linkSzures ? layoutTudastarLinkekNelkul(blocks) : blocks
  const rawLayout = page.layout ?? []
  const layout = tudastarNelkul(
    slug === 'szolgaltatasok'
      ? presentSzolgaltatasokLayout(rawLayout)
      : slug === 'kezdolap'
        ? presentHomeLayout(rawLayout)
        : rawLayout,
  )
  const pageContent = linkSzures ? lexicalTudastarLinkekNelkul(page.content) : page.content
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
        getPublishedProducts(CTA_TERMEK_LEKERDEZES_LIMIT),
        tudastarLathato ? getLatestPosts(KNOWLEDGE_POSTS_FETCH_LIMIT) : Promise.resolve<Post[]>([]),
        getTestimonials(),
      ])
    : [[], [], []]
  // A knowledge blokk kártyáinak KANONIKUS célja (publikált gyökér-hubnál a
  // gyökér-cím). Lekérdezés csak akkor fut, ha van egyáltalán szekciósor, és
  // a Tudástár látható.
  const hubUtvonalak =
    hasLayout && tudastarLathato
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
  const [appointment, contactEmail] = await Promise.all([
    getAppointmentSectionContext(layout),
    getContactEmail(),
  ])

  // Oldal-gráf (src/lib/seo-graph.ts): Organization + WebSite + WebPage +
  // BreadcrumbList (Kezdőlap → lap). A /rolunk AboutPage, a két szakember
  // Person-ként a csapat-blokkból (Google *Organization* / schema.org
  // AboutPage: https://schema.org/AboutPage); a /szolgaltatasok a services-
  // blokk sorait Service-ként hirdeti. A PageEeat MedicalWebPage-csomópontja
  // ugyanazt az @id-t viseli (…#webpage), így a két script EGY entitást ír le.
  // A strukturált adat is a Tudástár-szűrt sorból épül: a Service-csomópont
  // `url`-je a sor CTA-céljából jön, és rejtett Tudástárnál az sem hirdethet
  // /blog címet.
  const semaLayout = tudastarNelkul(rawLayout)
  const persons = slug === 'rolunk' ? teamPersonsFromLayout(semaLayout) : []
  const services = slug === 'szolgaltatasok' ? serviceNodesFromLayout(semaLayout, `/${slug}`) : []
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
            email: contactEmail,
          }),
        }
      : {}),
    nodes: [...personNodes(persons), ...services],
    contactEmail,
  })

  // A „Szerkesztem” réteg CSAK piszkozat-előnézetben (modul-térkép A3), a
  // MENTETT szekciósorból (rawLayout) és az eredeti sorindexből: a
  // megjelenítésre átalakított vagy Tudástár-szűrt sor nem a címke forrása.
  const szerkesztes = isDraft ? szerkesztoReteg({ lap: page, blokkok: pageBlocks }) : null

  return (
    <>
      {szerkesztes ? (
        <>
          <PreviewBar
            path={`/${slug}`}
            szerkesztoHref={szekcioMelylink({ collection: 'pages', id: page.id })}
          />
          <SzerkesztoOldalSzalag szalag={szerkesztes.oldal} />
        </>
      ) : null}
      <JsonLd data={siteGraph} />
      <article className="kc-cms-page">
        {/* WP51/WP55: a /rolunk és a /szolgaltatasok fejléc-képe a cím MELLETT
            áll (PageHero `paired`, csapat- és kezelés-fotó); minden más
            CMS-oldal a képet a fejléc alatt, természetes arányán kapja
            (`stacked`), mert a heroImage mező általános. */}
        {hasFilmHero ? null : (
          <PageHero
            lead={page.excerpt}
            media={heroMedia}
            title={page.title}
            variant={PAROS_FEJLEC_SLUGOK.has(slug) ? 'paired' : 'stacked'}
          />
        )}
        {hasLayout ? (
          <RenderBlocks
            appointment={appointment}
            // WP54: a /rolunk CTA-sávja a kurzus-montázst mutatja a borító
            // helyett; minden más lap (kezdőlap is) a kurzus-borítónál marad.
            ctaBannerMontazs={slug === 'rolunk' ? rolunkCtaMontazs() : null}
            hubUtvonalak={hubUtvonalak}
            layout={layout}
            posts={posts}
            products={products}
            szerkesztes={szerkesztes}
            testimonials={testimonials}
          />
        ) : hasLexicalContent(pageContent) ? (
          <Section>
            <Container size="narrow">
              <RichText content={pageContent} />
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
