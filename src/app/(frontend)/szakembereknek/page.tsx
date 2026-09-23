import type { Metadata } from 'next'
import { draftMode } from 'next/headers'
import { cache } from 'react'

import { pageBlocks } from '@/blocks'
import { OfferCards } from '@/components/blocks/OfferCards'
import { RenderBlocks } from '@/components/blocks/RenderBlocks'
import { JsonLd } from '@/components/content/JsonLd'
import {
  kodSzalag,
  RESZBEN_KODBAN_VAN,
  szerkesztoReteg,
  KODBAN_VAN,
  type KodSzalag,
} from '@/components/editor/frontend/szerkeszto-szalag'
import {
  SzerkesztoKodSzalag,
  SzerkesztoOldalSzalag,
} from '@/components/editor/frontend/SzerkesztoSzalag'
import { szekcioMelylink } from '@/components/editor/szekcio-melylink'
import { PreviewBar } from '@/components/preview/PreviewBar'
import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { getAppointmentSectionContext } from '@/lib/appointment/section'
import { getPageBySlug } from '@/lib/cms'
import { getContactEmail } from '@/lib/contact-email-server'
import { withDraftRobots } from '@/lib/preview/draft-metadata'
import { UGRAS_FELIRAT } from '@/lib/section-row-label'
import {
  buildStaticPageMetadata,
  documentTitle,
  documentTitleText,
  resolveOgImageUrl,
  resolveSeoDescription,
  resolveSeoTitle,
} from '@/lib/seo'
import { siteGraphJsonLd } from '@/lib/seo-graph'
import {
  SZAKEMBEREKNEK_DESCRIPTION,
  SZAKEMBEREKNEK_EYEBROW,
  SZAKEMBEREKNEK_LEAD,
  SZAKEMBEREKNEK_PATH,
  SZAKEMBEREKNEK_TITLE,
  szakembereknekAlapBlokk,
} from '@/lib/szakembereknek'
import { getTudastarLathato } from '@/lib/tudastar-lathatosag'
import { layoutTudastarLinkekNelkul } from '@/lib/tudastar-link-szuro'

/**
 * /szakembereknek — a szakmai választó oldal (WP49), CMS-ből (modul-térkép
 * H11, a /kapcsolat mintája).
 *
 * MIÉRT VAN. A fejléc „Szakembereknek” menüpontja eddig egyből a ProBody
 * külső oldalára vitt: a látogató a menüből kilépett a Kineticare-ből, és a
 * második szakmai ajánlatról (szakkönyv) nem is tudott. Itt két EGYENRANGÚ
 * kártya közül választ: képzés vagy szakkönyv.
 *
 * HONNAN JÖN A TARTALOM. A „szakembereknek” webcímű Oldalak-rekordból: a
 * H1 a Cím, a bevezető a Rövid bevezető, a lapfej alatt a szekciósor
 * (jellemzően egy „Ajánlat-kártyák” szekció). A felső kis felirat a kódban
 * van (`SZAKEMBEREKNEK_EYEBROW`), piszkozatban a szalag ezt kimondja. Üres
 * Cím vagy Rövid bevezető helyén a kódbeli szöveg áll. Ha nincs rekord, vagy
 * a szekciósorban nincs látható szekció, a lap a kódtartalékot mutatja
 * (`szakembereknekAlapBlokk`): a WP49 lap szerkezete és látványa, egyetlen
 * szekcióban, ahogy eddig. A kártyák mintájának forrásai az OfferCards.tsx
 * fejkommentjében (NN/g Cards, Material 3 Cards, GOV.UK Button, WCAG 2.2 SC
 * 1.3.1 és 3.2.5).
 *
 * MIÉRT DEDIKÁLT ROUTE, ÉS NEM A [slug]. A /kapcsolat mintája: a lapfej (a
 * kódbeli felső felirattal és a WP49 térközeivel) és a kódtartalék a route-ban
 * él, a fájlrendszer-útvonal erősebb a `[slug]`-nál. A sitemap a
 * /szakembereknek címet a statikus listából egyszer írja ki (a rekord slugja
 * ott kimarad), a Tudástár-hub pedig nem épülhet erre a slugra
 * (HUB_TILTOTT_SLUGOK).
 *
 * A SZAKKÖNYV VÁSÁRLÁSI CÍMÉT A TULAJDONOSOK MÉG NEM ADTÁK MEG (`SZAKKONYV_URL`
 * = null): addig a kódtartalék kártyája a /kapcsolat oldalra visz érdeklődő
 * felirattal. Kitalált URL tilos.
 *
 * Mikroszöveg: natív magyar, tegező, töltelék gondolatjel nélkül (docs/
 * ui-sztenderdek.md §3.1).
 */

const SZAKEMBEREKNEK_SLUG = 'szakembereknek'

/** A lapfej H1-ének id-je (a szekció `aria-labelledby`-ja). */
const CIM_ID = 'szakembereknek-cim'

/** A kódtartalék kártyáinak id-előtagja (a jegyzetek: `szakembereknek-<n>-jegyzet`). */
const KODTARTALEK_ID_ELOTAG = 'szakembereknek'

/**
 * A „szakembereknek” slugú CMS-oldal; előnézetben (draft mode) a legújabb
 * piszkozat. A sütit kizárólag a /next/preview route adhatja, oda pedig csak
 * staff/owner jut be. A metaadat és a lap ugyanazt a (kérésenként egyszer
 * lefutó) lekérdezést használja.
 */
const pageOf = cache((draft: boolean) => getPageBySlug(SZAKEMBEREKNEK_SLUG, { draft }))

type SzakembereknekPageDoc = Awaited<ReturnType<typeof pageOf>>

/** A H1: a rekord Címe, üresen vagy rekord nélkül a kódtartalék. */
function heading(page: SzakembereknekPageDoc): string {
  return page?.title?.trim() || SZAKEMBEREKNEK_TITLE
}

/** A bevezető: a rekord Rövid bevezetője, üresen vagy rekord nélkül a kódtartalék. */
function lead(page: SzakembereknekPageDoc): string {
  return page?.excerpt?.trim() || SZAKEMBEREKNEK_LEAD
}

/** A <title> szövege a [slug] oldalakkal azonos feloldóval, márka-utótag nélkül. */
function pageDocumentTitle(page: SzakembereknekPageDoc): string {
  return documentTitleText(
    documentTitle(resolveSeoTitle({ title: heading(page), seoTitle: page?.seoTitle })),
  )
}

/**
 * A leírás: a SEO-leírás, üresen a Rövid bevezető (a Pages súgójának
 * ígérete), annak híján vagy rekord nélkül a kódtartalék.
 */
function pageDescription(page: SzakembereknekPageDoc): string {
  return (
    (page
      ? resolveSeoDescription({
          title: heading(page),
          excerpt: page.excerpt,
          seoDescription: page.seoDescription,
        })
      : undefined) ?? SZAKEMBEREKNEK_DESCRIPTION
  )
}

/**
 * A lap metaadata: cím, leírás, kulcsszavak és megosztási kép a CMS-oldalról
 * (ha ki van töltve), kódtartalékkal. A canonical, og:url, og:image és robots
 * a közös építőből jön (`buildStaticPageMetadata`). Előnézetben a válasz
 * sosem indexelhető (`withDraftRobots`).
 */
export async function generateMetadata(): Promise<Metadata> {
  const { isEnabled: isDraft } = await draftMode()
  const page = await pageOf(isDraft)
  const image = page ? resolveOgImageUrl(page) : undefined
  const keywords = (page?.seoKeywords ?? [])
    .map((sor) => sor.phrase)
    .filter((phrase): phrase is string => typeof phrase === 'string')
  return withDraftRobots(
    buildStaticPageMetadata({
      title: pageDocumentTitle(page),
      description: pageDescription(page),
      path: SZAKEMBEREKNEK_PATH,
      ...(keywords.length > 0 ? { keywords } : {}),
      ...(image && page
        ? { image: { url: image, alt: `${SZAKEMBEREKNEK_TITLE}: ${heading(page)}` } }
        : {}),
    }),
    isDraft,
  )
}

/** Az Oldalak listája az adminban (rekord nélkül ide visz a szalag). */
const OLDALAK_ADMIN_HREF = '/admin/collections/pages'

/**
 * Piszkozatban, rekord nélkül vagy látható szekció nélkül: a lap egésze a
 * kódból jön. A szalag kimondja, és megmondja, hogyan veheti át a CMS (NN/g,
 * Visibility of System Status, https://www.nngroup.com/articles/visibility-system-status/;
 * GOV.UK, Writing for user interfaces: mondd meg, mit tehet a felhasználó,
 * https://www.gov.uk/service-manual/design/writing-for-user-interfaces).
 */
function kodbolJonSzalag(vanRekord: boolean): KodSzalag {
  return kodSzalag({
    cimke: `Szakembereknek oldal · ${KODBAN_VAN}`,
    magyarazat: vanRekord
      ? 'A „szakembereknek” oldalnak nincs látható szekciója, ezért a kártyák a weboldal kódjából jönnek. Ha a Szekciók közé felveszel egy látható szekciót, az veszi át a kártyák helyét.'
      : 'Ez az oldal még a weboldal kódjából jön. Ha az Oldalak között létrehozol egy „szakembereknek” webcímű oldalt, az veszi át: a címét, a bevezetőjét és a szekcióit onnan szerkesztheted.',
    linkek: vanRekord
      ? []
      : [
          {
            felirat: `${UGRAS_FELIRAT}: Oldalak`,
            rejtettKontextus: ', új „szakembereknek” oldal',
            href: OLDALAK_ADMIN_HREF,
          },
        ],
  })
}

/** Piszkozatban: a lapfej felső felirata kódban van, a cím és a bevezető a rekordból. */
function lapfejSzalag(): KodSzalag {
  return kodSzalag({
    cimke: `Lapfej · ${RESZBEN_KODBAN_VAN}`,
    magyarazat: `A „${SZAKEMBEREKNEK_EYEBROW}” felső felirat a weboldal kódjában van. A lap címe az oldal Címe, a cím alatti szöveg a Rövid bevezetője; ha üresen hagyod, a kódbeli szöveg áll ott.`,
    linkek: [],
  })
}

export default async function SzakembereknekPage() {
  const { isEnabled: isDraft } = await draftMode()
  const [page, tudastarLathato, contactEmail] = await Promise.all([
    pageOf(isDraft),
    getTudastarLathato(),
    getContactEmail(),
  ])
  // Tudástár-kapcsoló (src/lib/tudastar-kapcsolo.ts): kikapcsolt Tudástárnál a
  // szekciósorból kikerül minden Tudástár-hivatkozás (a /kapcsolat mintája).
  const rawLayout = page?.layout ?? []
  const layout = tudastarLathato ? rawLayout : layoutTudastarLinkekNelkul(rawLayout)
  const vanLathatoSzekcio = layout.some((block) => block.sectionSettings?.visible !== false)
  const kodtartalek = page === null || !vanLathatoSzekcio
  const appointment = kodtartalek ? null : await getAppointmentSectionContext(layout)
  const cim = heading(page)
  const bevezeto = lead(page)
  const description = pageDescription(page)
  // A „Szerkesztem” réteg CSAK piszkozat-előnézetben (modul-térkép A3), a
  // MENTETT szekciósorból (rawLayout) és az eredeti sorindexből.
  const szerkesztes = isDraft && page ? szerkesztoReteg({ lap: page, blokkok: pageBlocks }) : null

  const lap = (
    <>
      <Section
        aria-labelledby={CIM_ID}
        className={kodtartalek ? 'kc-szakemberek' : 'kc-szakemberek kc-szakemberek--fej'}
      >
        {/* Oldal-gráf: Organization (a kapcsolati e-maillel) + WebSite +
            WebPage + BreadcrumbList (Kezdőlap → Szakembereknek). A szekción
            BELÜL áll, hogy a lapfej és az első szekció szomszédsága (CSS)
            ne törjön meg. */}
        <JsonLd
          data={siteGraphJsonLd({
            page: {
              path: SZAKEMBEREKNEK_PATH,
              name: cim,
              description,
              ...(page ? { dateModified: page.updatedAt } : {}),
            },
            breadcrumbs: [
              { name: 'Kezdőlap', path: '/' },
              { name: cim, path: SZAKEMBEREKNEK_PATH },
            ],
            contactEmail,
          })}
        />
        <Container>
          <header className="kc-szakemberek__head">
            <p className="kc-eyebrow">{SZAKEMBEREKNEK_EYEBROW}</p>
            <h1 className="kc-section-title" id={CIM_ID}>
              {cim}
            </h1>
            <p className="kc-section-lead kc-szakemberek__lead">{bevezeto}</p>
          </header>
          {kodtartalek ? (
            <OfferCards
              beagyazott
              block={szakembereknekAlapBlokk()}
              idElotag={KODTARTALEK_ID_ELOTAG}
            />
          ) : null}
        </Container>
      </Section>

      {/* A szekciósor: látható szekcióval mindig, piszkozatban a csupa rejtett
          sor is (a rejtett szekciók szalagja így a szerkesztő elé kerül). */}
      {!kodtartalek || (szerkesztes && layout.length > 0) ? (
        <RenderBlocks
          {...(appointment ? { appointment } : {})}
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
    return lap
  }
  return (
    <>
      <PreviewBar
        path={SZAKEMBEREKNEK_PATH}
        {...(page ? { szerkesztoHref: szekcioMelylink({ collection: 'pages', id: page.id }) } : {})}
      />
      {szerkesztes ? <SzerkesztoOldalSzalag szalag={szerkesztes.oldal} /> : null}
      {kodtartalek ? <SzerkesztoKodSzalag szalag={kodbolJonSzalag(page !== null)} /> : null}
      <SzerkesztoKodSzalag szalag={lapfejSzalag()} />
      {lap}
    </>
  )
}
