import type { Metadata } from 'next'
import { draftMode } from 'next/headers'
import { cache } from 'react'

import { RenderBlocks } from '@/components/blocks/RenderBlocks'
import { JsonLd } from '@/components/content/JsonLd'
import { MediaImage } from '@/components/content/MediaImage'
import { KNOWLEDGE_POSTS_FETCH_LIMIT } from '@/components/content/home/KnowledgeSection'
import { RichText } from '@/components/lexical/RichText'
import { hasLexicalContent } from '@/components/lexical/serialize'
import { PreviewBar } from '@/components/preview/PreviewBar'
import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { getAppointmentSectionContext } from '@/lib/appointment/section'
import {
  getLatestPosts,
  getPageBySlug,
  getPublishedPageSlugs,
  getPublishedProducts,
  getTestimonials,
} from '@/lib/cms'
import { withDraftRobots } from '@/lib/preview/draft-metadata'
import {
  buildPageMetadata,
  buildStaticPageMetadata,
  resolveOgImageUrl,
  resolveSeoDescription,
} from '@/lib/seo'
import { hubUtvonalTerkep } from '@/lib/tudastar/hub-oldalak'
import {
  contactDataFromLayout,
  contactOrganizationNode,
  medicalBusinessNodes,
  personNodes,
  siteGraphJsonLd,
  teamPersonsFromLayout,
} from '@/lib/seo-graph'
import './kapcsolat.css'

export const dynamic = 'force-dynamic'

/**
 * /kapcsolat — dedikált route; CMS szekciósor a kapcsolat slugú oldalból.
 * Üres layout esetén a CMS törzse jelenik meg, külön üzenetküldő űrlap nélkül.
 */
const CONTACT_PAGE_SLUG = 'kapcsolat'
const CONTACT_PATH = '/kapcsolat'
const CONTACT_TITLE = 'Kapcsolat'

/**
 * Tartalék leírás, ha a CMS `seoDescription` üres. Mért kifejezésekkel
 * (`docs/ADATOK-mert.md`): kézfájdalom 150/hó és csuklófájdalom 150/hó
 * (Ahrefs HU, KD 0). A két rendelő címe a CMS időpontkérő blokkjából
 * jön a lapon; itt a leírás a keresési szándékot (időpont, Budapest) írja le.
 */
const CONTACT_FALLBACK_DESCRIPTION =
  'Időpontkérés rendelői gyógytornára és manuálterápiára Budapesten, telefonos egyeztetéssel. Kézfájdalom, csuklófájdalom, műtét utáni kézrehabilitáció gyógytornászoktól.'

const contactPageOf = cache((draft: boolean) => getPageBySlug(CONTACT_PAGE_SLUG, { draft }))

/**
 * A CMS SEO-mezői a közös építőn át érvényesülnek; hiányzó oldalnál a
 * korábbi tartalék marad. A canonical minden esetben a dedikált útvonal.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { isEnabled: isDraft } = await draftMode()
  const page = await contactPageOf(isDraft)
  return withDraftRobots(
    page
      ? buildPageMetadata(
          { ...page, seoDescription: resolveSeoDescription(page) ?? CONTACT_FALLBACK_DESCRIPTION },
          CONTACT_PATH,
        )
      : buildStaticPageMetadata({
          title: CONTACT_TITLE,
          description: CONTACT_FALLBACK_DESCRIPTION,
          path: CONTACT_PATH,
        }),
    isDraft,
  )
}

export default async function KapcsolatPage() {
  const { isEnabled: isDraft } = await draftMode()
  const page = await contactPageOf(isDraft)
  const layout = page?.layout ?? []
  const hasLayout = layout.length > 0
  const hasFilmHero = layout.some(
    (block) => block.blockType === 'filmHero' && block.sectionSettings?.visible !== false,
  )
  const title = page?.title ?? CONTACT_TITLE
  const heroMedia = page?.heroImage && typeof page.heroImage === 'object' ? page.heroImage : null
  // Az előnézet csak az oldal saját tartalmára vonatkozik, a listák publikusak.
  const [products, posts, testimonials] = hasLayout
    ? await Promise.all([
        getPublishedProducts(),
        getLatestPosts(KNOWLEDGE_POSTS_FETCH_LIMIT),
        getTestimonials(),
      ])
    : [[], [], []]
  const hubUtvonalak = hasLayout
    ? hubUtvonalTerkep(
        posts.map((post) => post.slug).filter((slug): slug is string => typeof slug === 'string'),
        await getPublishedPageSlugs(),
      )
    : {}
  const appointment = await getAppointmentSectionContext(layout)
  // ContactPage + a rendelők (MedicalBusiness) + a két szakember (Person) a
  // CMS időpontkérő és csapat-blokkjából; ami nincs kitöltve, az nincs a
  // sémában sem (nyitvatartás, geokoordináta). Google *Local business*:
  // https://developers.google.com/search/docs/appearance/structured-data/local-business
  const contact = contactDataFromLayout(layout)
  const persons = teamPersonsFromLayout(layout)
  const description =
    (page
      ? resolveSeoDescription({
          title,
          excerpt: hasFilmHero ? null : page.excerpt,
          seoDescription: page.seoDescription,
        })
      : undefined) ?? CONTACT_FALLBACK_DESCRIPTION

  return (
    <>
      {isDraft ? <PreviewBar path={CONTACT_PATH} /> : null}
      <JsonLd
        data={siteGraphJsonLd({
          page: {
            path: CONTACT_PATH,
            name: title,
            description,
            type: 'ContactPage',
            dateModified: page?.updatedAt,
            ...(page ? { imageUrl: resolveOgImageUrl(page) } : {}),
          },
          breadcrumbs: [
            { name: 'Kezdőlap', path: '/' },
            { name: title, path: CONTACT_PATH },
          ],
          organization: contactOrganizationNode(contact),
          nodes: [...medicalBusinessNodes(contact), ...personNodes(persons)],
        })}
      />
      {/* Lapfej széles konténerben — igazítva a szekciókhoz (nem narrow). */}
      {hasFilmHero ? null : (
        <>
          <Section>
            <Container>
              <h1>{title}</h1>
              {page?.excerpt ? <p className="kc-page-hero__lead">{page.excerpt}</p> : null}
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
          hubUtvonalak={hubUtvonalak}
          layout={layout}
          posts={posts}
          products={products}
          testimonials={testimonials}
        />
      ) : hasLexicalContent(page?.content) ? (
        <Section>
          <Container size="narrow">
            <RichText content={page?.content} />
          </Container>
        </Section>
      ) : null}
    </>
  )
}
