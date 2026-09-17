import type { Metadata } from 'next'
import { cache } from 'react'

import { RenderBlocks } from '@/components/blocks/RenderBlocks'
import { JsonLd } from '@/components/content/JsonLd'
import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { getAppointmentSectionContext } from '@/lib/appointment/section'
import { getPageBySlug } from '@/lib/cms'
import { buildStaticPageMetadata, resolveOgImageUrl, resolveSeoDescription } from '@/lib/seo'
import {
  contactDataFromLayout,
  contactOrganizationNode,
  medicalBusinessNodes,
  personNodes,
  siteGraphJsonLd,
  teamPersonsFromLayout,
} from '@/lib/seo-graph'
import './kapcsolat.css'

/**
 * /kapcsolat — dedikált route; CMS szekciósor a kapcsolat slugú oldalból.
 * Üres layout esetén: cím + bevezető + üzenetküldő űrlap (mai viselkedés).
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

const contactPageOf = cache(() => getPageBySlug(CONTACT_PAGE_SLUG))

/**
 * A Kapcsolat lap metaadata: leírás és megosztási kép a CMS-oldalról (ha ki
 * van töltve), a cím a látható H1 („Kapcsolat”). A canonical, og:url,
 * og:image és robots a közös építőből jön (`buildStaticPageMetadata`) —
 * élesben 2026-09-07-én pont ezek hiányoztak erről a lapról.
 */
export async function generateMetadata(): Promise<Metadata> {
  const page = await contactPageOf()
  const description =
    (page
      ? resolveSeoDescription({
          title: CONTACT_TITLE,
          excerpt: null,
          seoDescription: page.seoDescription,
        })
      : undefined) ?? CONTACT_FALLBACK_DESCRIPTION
  const image = page ? resolveOgImageUrl(page) : undefined
  return buildStaticPageMetadata({
    title: CONTACT_TITLE,
    description,
    path: CONTACT_PATH,
    ...(image && page ? { image: { url: image, alt: `${CONTACT_TITLE}: ${page.title}` } } : {}),
  })
}

export default async function KapcsolatPage() {
  const page = await contactPageOf()
  const layout = page?.layout ?? []
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
          title: CONTACT_TITLE,
          excerpt: null,
          seoDescription: page.seoDescription,
        })
      : undefined) ?? CONTACT_FALLBACK_DESCRIPTION

  return (
    <>
      <JsonLd
        data={siteGraphJsonLd({
          page: {
            path: CONTACT_PATH,
            name: CONTACT_TITLE,
            description,
            type: 'ContactPage',
            dateModified: page?.updatedAt,
            ...(page ? { imageUrl: resolveOgImageUrl(page) } : {}),
          },
          breadcrumbs: [
            { name: 'Kezdőlap', path: '/' },
            { name: CONTACT_TITLE, path: CONTACT_PATH },
          ],
          organization: contactOrganizationNode(contact),
          nodes: [...medicalBusinessNodes(contact), ...personNodes(persons)],
        })}
      />
      {/* Lapfej széles konténerben — igazítva a szekciókhoz (nem narrow). */}
      <Section>
        <Container>
          <h1>Kapcsolat</h1>
        </Container>
      </Section>

      {layout.length > 0 ? (
        <RenderBlocks
          appointment={appointment}
          layout={layout}
          posts={[]}
          products={[]}
          testimonials={[]}
        />
      ) : null}
    </>
  )
}
