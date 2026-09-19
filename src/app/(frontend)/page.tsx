import type { Metadata } from 'next'
import { draftMode } from 'next/headers'
import { cache } from 'react'

import { BarionPageView } from '@/components/analytics/BarionPageView'
import { HomeView } from '@/components/content/HomeView'
import { JsonLd } from '@/components/content/JsonLd'
import { KNOWLEDGE_POSTS_FETCH_LIMIT } from '@/components/content/home/KnowledgeSection'
import { PreviewBar } from '@/components/preview/PreviewBar'
import { BARION_PAGE_VIEW } from '@/lib/analytics/barion-events'
import { getAppointmentSectionContext } from '@/lib/appointment/section'
import { CTA_TERMEK_LEKERDEZES_LIMIT } from '@/lib/cta-banner-course'
import {
  getHomePage,
  getLatestPosts,
  getPublishedPageSlugs,
  getPublishedProducts,
  getTestimonials,
} from '@/lib/cms'
import { withDraftRobots } from '@/lib/preview/draft-metadata'
import { buildHomeMetadata, webSiteJsonLd } from '@/lib/seo'
import { hubUtvonalTerkep } from '@/lib/tudastar/hub-oldalak'

export const dynamic = 'force-dynamic'

const homePageOf = cache((draft: boolean) => getHomePage({ draft }))

export async function generateMetadata(): Promise<Metadata> {
  // Draft mode-ban a piszkozat metaadata jön — és a válasz sosem indexelhető.
  const { isEnabled: isDraft } = await draftMode()
  const home = await homePageOf(isDraft)
  // A `/` a `kezdolap` CMS-oldal `buildDocMetadata` útján kapja a title /
  // description / seoKeywords mezőket (nem a `/kezdolap` path). Üres
  // seoKeywords → a keywords kulcs kimarad.
  return withDraftRobots(buildHomeMetadata(home), isDraft)
}

export default async function HomePage() {
  // Előnézet (draft mode): a kezdőlap CMS-oldalának publikálatlan verziója is
  // látszik. A sütit kizárólag a /next/preview route adhatja, oda pedig csak
  // staff/owner jut be. A termék-, poszt- és vélemény-listák published-szűrtek
  // maradnak — a piszkozat-előnézet a kezdőlap SAJÁT tartalmára vonatkozik.
  const { isEnabled: isDraft } = await draftMode()
  // A posztokból a knowledge blokk felső limitjéig (6) kérünk, hogy a
  // szekciósor bármely beállítása egyetlen párhuzamos lekérdezésből kijöjjön;
  // a rögzített kezdőlap továbbra is 3-at mutat (KnowledgeSection limit).
  const [home, products, posts, testimonials, publikaltOldalak] = await Promise.all([
    homePageOf(isDraft),
    getPublishedProducts(CTA_TERMEK_LEKERDEZES_LIMIT),
    getLatestPosts(KNOWLEDGE_POSTS_FETCH_LIMIT),
    getTestimonials(),
    getPublishedPageSlugs(),
  ])
  // A tudástár-kártyák KANONIKUS célja: publikált gyökér-hubnál a gyökér-cím,
  // különben a mai `/blog/{slug}` (a piszkozat-hub gyökere 404 lenne).
  const hubUtvonalak = hubUtvonalTerkep(
    posts.map((post) => post.slug).filter((slug): slug is string => typeof slug === 'string'),
    publikaltOldalak,
  )

  // A kezdőlap strukturált adatát (Organization + FAQPage) a HomeView adja —
  // az a komponens, amelyik a látható tartalmat is rendereli, és amelyet a
  // fixture-tesztek fognak. Itt NEM ismételjük meg: a duplikált Organization
  // séma egy oldalon validációs figyelmeztetést okoz, és fölöslegesen kétszer
  // írja le ugyanazt az entitást a gépi olvasónak.
  // Az időpontkérő szekció űrlapjához kell a form-azonosító és a Turnstile site
  // key. A lekérdezés csak akkor fut, ha a kezdőlapi szekciósorban tényleg van
  // ilyen blokk (a helper maga dönti el).
  const appointment = await getAppointmentSectionContext(home?.layout)

  return (
    <>
      {isDraft ? <PreviewBar path="/" /> : null}
      {/* WebSite csomópont (@id: /#website): a HomeView Organization- és
          WebPage-sémája erre és egymásra hivatkozik — a gráf harmadik tagja.
          BreadcrumbList a kezdőlapon nincs: egyelemű morzsa nem útvonal
          (src/lib/seo-graph.ts). SearchAction sincs: nincs kereső. */}
      <JsonLd data={webSiteJsonLd()} />
      {/* Barion Pixel `contentView` (contentType: 'Page'). A termékoldal SAJÁT
          Product-ágú eseményt küld (CourseBarionView) — a kettő sosem fut
          ugyanazon az oldalon, ezért nincs duplikált megtekintés. */}
      <BarionPageView
        list={BARION_PAGE_VIEW.home.list}
        pageId={BARION_PAGE_VIEW.home.id}
        pageName={BARION_PAGE_VIEW.home.name}
      />
      <HomeView
        appointment={appointment}
        home={home}
        hubUtvonalak={hubUtvonalak}
        posts={posts}
        products={products}
        testimonials={testimonials}
      />
    </>
  )
}
