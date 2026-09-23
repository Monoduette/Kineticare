import type { Metadata } from 'next'
import { draftMode } from 'next/headers'
import { cache } from 'react'

import { pageBlocks } from '@/blocks'
import { RenderBlocks } from '@/components/blocks/RenderBlocks'
import { JsonLd } from '@/components/content/JsonLd'
import { szerkesztoReteg } from '@/components/editor/frontend/szerkeszto-szalag'
import { SzerkesztoOldalSzalag } from '@/components/editor/frontend/SzerkesztoSzalag'
import { szekcioMelylink } from '@/components/editor/szekcio-melylink'
import { PreviewBar } from '@/components/preview/PreviewBar'
import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { getAppointmentSectionContext } from '@/lib/appointment/section'
import { getPageBySlug } from '@/lib/cms'
import { getContactEmail } from '@/lib/contact-email-server'
import { withDraftRobots } from '@/lib/preview/draft-metadata'
import {
  buildStaticPageMetadata,
  documentTitle,
  documentTitleText,
  resolveOgImageUrl,
  resolveSeoDescription,
  resolveSeoTitle,
} from '@/lib/seo'
import {
  contactDataFromLayout,
  contactOrganizationNode,
  medicalBusinessNodes,
  personNodes,
  siteGraphJsonLd,
  teamPersonsFromLayout,
} from '@/lib/seo-graph'
import { getTudastarLathato } from '@/lib/tudastar-lathatosag'
import { layoutTudastarLinkekNelkul } from '@/lib/tudastar-link-szuro'
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

/**
 * A `kapcsolat` slugú CMS-oldal; előnézetben (draft mode) a legújabb
 * piszkozat. A sütit kizárólag a /next/preview route adhatja, oda pedig csak
 * staff/owner jut be. A metaadat és a lap ugyanazt a (kérésenként egyszer
 * lefutó) lekérdezést használja.
 */
const contactPageOf = cache((draft: boolean) => getPageBySlug(CONTACT_PAGE_SLUG, { draft }))

type ContactPage = Awaited<ReturnType<typeof contactPageOf>>

/** A lap címe (H1): a rekord Címe, üresen vagy rekord nélkül a kódtartalék. */
function contactHeading(page: ContactPage): string {
  return page?.title?.trim() || CONTACT_TITLE
}

/**
 * A <title> szövege a [slug] oldalakkal AZONOS feloldóval: `resolveSeoTitle`
 * (a SEO-cím, üresen a Cím), a márka-utótag nélkül (`documentTitle`, a keret
 * sablonja teszi hozzá: „%s | Kineticare”). Élő adattal (Cím: „Kapcsolat”,
 * SEO-cím: „Kapcsolat – Kineticare”) a <title> változatlanul „Kapcsolat |
 * Kineticare”, ahogy a /rolunk is „Rólunk | Kineticare”.
 */
function contactDocumentTitle(page: ContactPage): string {
  return documentTitleText(
    documentTitle(resolveSeoTitle({ title: contactHeading(page), seoTitle: page?.seoTitle })),
  )
}

/** A leírás: a SEO-leírás, üresen a kódtartalék (a Rövid bevezető itt nem forrás, H26). */
function contactDescription(page: ContactPage): string {
  return (
    (page
      ? resolveSeoDescription({
          title: CONTACT_TITLE,
          excerpt: null,
          seoDescription: page.seoDescription,
        })
      : undefined) ?? CONTACT_FALLBACK_DESCRIPTION
  )
}

/**
 * A Kapcsolat lap metaadata: cím, leírás, kulcsszavak és megosztási kép a
 * CMS-oldalról (ha ki van töltve), kódtartalékkal. A canonical, og:url,
 * og:image és robots a közös építőből jön (`buildStaticPageMetadata`) —
 * élesben 2026-09-07-én pont ezek hiányoztak erről a lapról. Előnézetben a
 * válasz sosem indexelhető (`withDraftRobots`).
 */
export async function generateMetadata(): Promise<Metadata> {
  const { isEnabled: isDraft } = await draftMode()
  const page = await contactPageOf(isDraft)
  const image = page ? resolveOgImageUrl(page) : undefined
  const keywords = (page?.seoKeywords ?? [])
    .map((sor) => sor.phrase)
    .filter((phrase): phrase is string => typeof phrase === 'string')
  return withDraftRobots(
    buildStaticPageMetadata({
      title: contactDocumentTitle(page),
      description: contactDescription(page),
      path: CONTACT_PATH,
      ...(keywords.length > 0 ? { keywords } : {}),
      ...(image && page ? { image: { url: image, alt: `${CONTACT_TITLE}: ${page.title}` } } : {}),
    }),
    isDraft,
  )
}

export default async function KapcsolatPage() {
  const { isEnabled: isDraft } = await draftMode()
  const page = await contactPageOf(isDraft)
  // Tudástár-kapcsoló (src/lib/tudastar-kapcsolo.ts): kikapcsolt Tudástárnál a
  // szekciósorból kikerül minden Tudástár-hivatkozás, és a lap ugyanúgy
  // renderel. Ezt a szűrt sort kapja minden felhasználó: az időpontkérő, a
  // strukturált adat (így az sem hirdethet /blog címet) és a megjelenítés.
  const [tudastarLathato, contactEmail] = await Promise.all([
    getTudastarLathato(),
    getContactEmail(),
  ])
  const rawLayout = page?.layout ?? []
  const layout = tudastarLathato ? rawLayout : layoutTudastarLinkekNelkul(rawLayout)
  const appointment = await getAppointmentSectionContext(layout)
  // ContactPage + a rendelők (MedicalBusiness) + a két szakember (Person) a
  // CMS időpontkérő és csapat-blokkjából; ami nincs kitöltve, az nincs a
  // sémában sem (nyitvatartás, geokoordináta). Google *Local business*:
  // https://developers.google.com/search/docs/appearance/structured-data/local-business
  const contact = contactDataFromLayout(layout)
  const persons = teamPersonsFromLayout(layout)
  const description = contactDescription(page)
  // A „Szerkesztem” réteg CSAK piszkozat-előnézetben (modul-térkép A3), a
  // MENTETT szekciósorból (rawLayout) és az eredeti sorindexből.
  const szerkesztes = isDraft && page ? szerkesztoReteg({ lap: page, blokkok: pageBlocks }) : null

  const tartalom = (
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
          // A lap saját Időpontkérőjének címe az első; ha az üres, a közös
          // feloldó (src/lib/contact-email.ts), a lábléccel azonos cím.
          organization: contactOrganizationNode(contact, contactEmail),
          nodes: [...medicalBusinessNodes(contact), ...personNodes(persons)],
        })}
      />
      {/* Lapfej széles konténerben — igazítva a szekciókhoz (nem narrow). */}
      <Section>
        <Container>
          <h1>{contactHeading(page)}</h1>
        </Container>
      </Section>

      {layout.length > 0 ? (
        <RenderBlocks
          appointment={appointment}
          layout={layout}
          posts={[]}
          products={[]}
          szerkesztes={szerkesztes}
          testimonials={[]}
        />
      ) : null}
    </>
  )
  // A látogató kimenete a réteg nélküli fa (nincs üres hely a gyerekek között).
  if (!isDraft) {
    return tartalom
  }
  return (
    <>
      <PreviewBar
        path={CONTACT_PATH}
        {...(page ? { szerkesztoHref: szekcioMelylink({ collection: 'pages', id: page.id }) } : {})}
      />
      {szerkesztes ? <SzerkesztoOldalSzalag szalag={szerkesztes.oldal} /> : null}
      {tartalom}
    </>
  )
}
