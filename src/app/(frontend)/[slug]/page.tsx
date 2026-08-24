import type { Metadata } from 'next'
import { draftMode } from 'next/headers'
import { notFound } from 'next/navigation'

import { RenderBlocks } from '@/components/blocks/RenderBlocks'
import { MediaImage } from '@/components/content/MediaImage'
import { PageEeat } from '@/components/content/PageEeat'
import { KNOWLEDGE_POSTS_FETCH_LIMIT } from '@/components/content/home/KnowledgeSection'
import { hasLexicalContent } from '@/components/lexical/serialize'
import { RichText } from '@/components/lexical/RichText'
import { PreviewBar } from '@/components/preview/PreviewBar'
import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { getAppointmentSectionContext } from '@/lib/appointment/section'
import { getLatestPosts, getPageBySlug, getPublishedProducts, getTestimonials } from '@/lib/cms'
import { withDraftRobots } from '@/lib/preview/draft-metadata'
import { buildPageMetadata } from '@/lib/seo'
import type { Post, Product, Testimonial } from '@/payload-types'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  // Draft mode-ban a piszkozat metaadata jön — és a válasz sosem indexelhető.
  const { isEnabled: isDraft } = await draftMode()
  const page = await getPageBySlug(slug, { draft: isDraft })
  if (!page) return withDraftRobots({}, isDraft)
  return withDraftRobots(buildPageMetadata(page, `/${slug}`), isDraft)
}

/**
 * CMS-oldal (Pages) renderelése — hero + SZEKCIÓSOR vagy rich-text.
 *
 * SZEKCIÓ-RENDSZER (docs/ux-belso-oldalak-kutatas.md, P3): a `Pages.layout`
 * blokk-mező 16 blokktípussal régóta létezik, és az admin súgója is azt ígéri,
 * hogy az „az oldal építőkockás része" — ez a route viszont SOHA nem
 * rendereli. A staff összerakhatott egy szekciósort, elmenthette, és semmi
 * nem jelent meg belőle: néma tartalomvesztés, egyben a „minden egymás alatt
 * van" gyökéroka. A javítás a KEZDŐLAP bevált mintája (HomeView): ha van
 * szekciósor, azt a `RenderBlocks` rendereli, üres layoutnál marad a mai
 * rich-text ág. A `RenderBlocks` maga változatlan — itt csak hívjuk.
 *
 * Egyetlen H1: a lap címét a hero adja. A `filmHero` blokk viszont SAJÁT h1-et
 * renderel (ScrollScrub), ezért ha a szerkesztő filmsávot tett a lapra, a
 * szöveges hero (és a hozzá tartozó hero-kép) kimarad — a filmsáv AZ oldal
 * heroja. Így a dokumentumban minden esetben pontosan egy h1 marad.
 *
 * Lekérdezés-takarékosság: a blokkok adatvezérelt fajtái (courseCards, freeSos,
 * knowledge, testimonials) termék-, poszt- és vélemény-listát igényelnek. Ezt a
 * három lekérdezést CSAK akkor indítjuk, ha tényleg van szekciósor — rich-text
 * oldalon egy fölösleges kör sem fut.
 */
export default async function CmsPage({ params }: Props) {
  const { slug } = await params
  // Előnézet (draft mode): a publikálatlan verzió is látszik. A sütit kizárólag
  // a /next/preview route adhatja, oda pedig csak staff/owner jut be.
  const { isEnabled: isDraft } = await draftMode()
  const page = await getPageBySlug(slug, { draft: isDraft })
  if (!page) notFound()

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
