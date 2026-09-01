import type { Metadata } from 'next'
import { draftMode } from 'next/headers'
import { notFound } from 'next/navigation'
import { cache } from 'react'

import { RenderBlocks } from '@/components/blocks/RenderBlocks'
import { MediaImage } from '@/components/content/MediaImage'
import { PageEeat } from '@/components/content/PageEeat'
import { PostArticle } from '@/components/content/PostArticle'
import { KNOWLEDGE_POSTS_FETCH_LIMIT } from '@/components/content/home/KnowledgeSection'
import { hasLexicalContent } from '@/components/lexical/serialize'
import { RichText } from '@/components/lexical/RichText'
import { PreviewBar } from '@/components/preview/PreviewBar'
import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { getAppointmentSectionContext } from '@/lib/appointment/section'
import {
  getFreeProduct,
  getLatestPosts,
  getPageBySlug,
  getPostBySlug,
  getPublishedProducts,
  getRelatedPosts,
  getTestimonials,
} from '@/lib/cms'
import { HUB_OLDALAK } from '@/lib/tudastar/hub-oldalak'
import { withDraftRobots } from '@/lib/preview/draft-metadata'
import { buildPageMetadata } from '@/lib/seo'
import type { Post, Product, Testimonial } from '@/payload-types'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string }> }

const pageOf = cache((slug: string, draft: boolean) => getPageBySlug(slug, { draft }))

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  // Draft mode-ban a piszkozat metaadata jön — és a válasz sosem indexelhető.
  const { isEnabled: isDraft } = await draftMode()
  const page = await pageOf(slug, isDraft)
  if (!page) return withDraftRobots({}, isDraft)
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
    const post = await getPostBySlug(hub.cikkSlug)
    if (post) {
      const [related, freeCourse] = await Promise.all([getRelatedPosts(post), getFreeProduct()])
      return (
        <>
          {isDraft ? <PreviewBar path={`/${slug}`} /> : null}
          <PostArticle post={post} related={related} freeCourse={freeCourse} path={`/${slug}`} />
        </>
      )
    }
    // Ha a forrás-cikk valamiért nem elérhető, a lap a CMS-oldal tartalmára
    // esik vissza — ugyanaz a lektorált törzs, cikk-extrák nélkül.
  }

  const layout = page.layout ?? []
  const hasLayout = layout.length > 0
  // A film-hero saját h1-et renderel — ilyenkor a szöveges hero elmarad.
  const hasFilmHero = layout.some((block) => block.blockType === 'filmHero')
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

  // Az időpontkérő szekció űrlapjához kell a form-azonosító és a Turnstile
  // site key. A lekérdezés CSAK akkor fut, ha van ilyen blokk a lapon
  // (getAppointmentSectionContext maga dönti el) — ugyanaz a takarékossági
  // elv, mint a fenti három listánál.
  const appointment = await getAppointmentSectionContext(layout)

  return (
    <>
      {isDraft ? <PreviewBar path={`/${slug}`} /> : null}
      <article className="kc-cms-page">
        {hasFilmHero ? null : (
          <>
            <Section className="kc-page-hero" variant="tint">
              <Container size="narrow">
                <h1 className="kc-page-hero__title">{page.title}</h1>
                {page.excerpt ? <p className="kc-page-hero__lead">{page.excerpt}</p> : null}
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
          </>
        )}
        {hasLayout ? (
          <RenderBlocks
            appointment={appointment}
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
