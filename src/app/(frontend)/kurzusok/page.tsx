import type { Metadata } from 'next'
import Link from 'next/link'
import { getPayload } from 'payload'

import { BarionPageView } from '@/components/analytics/BarionPageView'
import { JsonLd } from '@/components/content/JsonLd'
import { CourseShowcase } from '@/components/content/home/CourseShowcase'
import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { BARION_PAGE_VIEW } from '@/lib/analytics/barion-events'
import {
  buildStaticPageMetadata,
  COURSE_LISTING_DESCRIPTION,
  COURSE_LISTING_TITLE,
  courseListingJsonLd,
} from '@/lib/seo'
import { siteGraphJsonLd } from '@/lib/seo-graph'
import { courseHref } from '@/lib/course-url'
import {
  CATEGORY_QUERY_PARAM,
  collectCourseCategories,
  courseTitle,
  filterCoursesByCategory,
  reportUnpricedPublishedCourses,
  resolveCategoryFilter,
} from '@/lib/courses'
import { logger } from '@/lib/logger'
import { KURZUSLISTA_KULCSSZAVAK } from '@/lib/tudastar/seo-kulcsszavak'
import type { Product } from '@/payload-types'

import config from '../../../payload.config'

/**
 * /kurzusok — kurzuslista (a kurzus-értékesítés belépőpontja).
 * - Csak `status === 'published'` termékek (a saját status select szerint —
 * draft sosem, archived NEM listázódik, de a meglévő vevő a közvetlen
 * linken keresztül tovább éri el a kurzus-oldalát).
 * - Kategória-szűrés: ?kategoria=<slug> — a szűrő-chipek a listában
 * ténylegesen előforduló kategóriák (üres szűrő nem kínálható fel);
 */

export const metadata: Metadata = buildStaticPageMetadata({
  title: COURSE_LISTING_TITLE,
  description: COURSE_LISTING_DESCRIPTION,
  path: '/kurzusok',
  // Nincs `kurzusok` pages-rekord — új page TILOS. A Search-lockolt lista
  // a `resolveSeoKeywords` úton megy a meta keywordsbe; a `/kezrehab` és
  // `/kezrelax` 308-asokhoz tilos nyúlni. Primér: otthoni gyógytorna.
  keywords: KURZUSLISTA_KULCSSZAVAK,
})

interface KurzusokPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

async function listPublishedCourses(): Promise<Product[]> {
  try {
    const payload = await getPayload({ config })
    const { docs } = await payload.find({
      collection: 'products',
      where: {
        status: { equals: 'published' },
      },
      depth: 1,
      limit: 100,
      sort: 'sku',
      // A published-szűrés explicit a where-ben (a menus.ts-minta szerint) —
      // így az anonim access-politika és a drafts _status-viselkedés nem
      // befolyásolja a listát.
      overrideAccess: true,
    })
    // Hangos jelzés a hiányosan konfigurált (beállítatlan ár-pipájú) publikált
    // kurzusokról — a lista ettől változatlanul renderel (lásd src/lib/courses.ts).
    reportUnpricedPublishedCourses(docs, logger)
    return docs
  } catch (error) {
    logger.warn('kurzuslista-lekérdezés sikertelen — üres állapottal renderelünk', {
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

export default async function KurzusokPage({ searchParams }: KurzusokPageProps) {
  const params = await searchParams
  const products = await listPublishedCourses()
  const categories = collectCourseCategories(products)
  const activeSlug = resolveCategoryFilter(params[CATEGORY_QUERY_PARAM], categories)
  const visible = filterCoursesByCategory(products, activeSlug)

  return (
    <Section>
      {/* Oldal-gráf (Organization + WebSite + BreadcrumbList Kezdőlap →
          Kurzusok); a CollectionPage csomópont a `courseListingJsonLd`, benne
          a LÁTHATÓ kurzusok ItemList-je (@id …#itemlist) — ugyanaz a lista,
          amit a CourseShowcase renderel, tehát nem tud eltérni tőle. */}
      <JsonLd
        data={siteGraphJsonLd({
          page: {
            path: '/kurzusok',
            name: COURSE_LISTING_TITLE,
            description: COURSE_LISTING_DESCRIPTION,
            type: 'CollectionPage',
          },
          breadcrumbs: [
            { name: 'Kezdőlap', path: '/' },
            { name: COURSE_LISTING_TITLE, path: '/kurzusok' },
          ],
        })}
      />
      <JsonLd
        data={courseListingJsonLd(
          visible.map((product) => ({ name: courseTitle(product), path: courseHref(product) })),
        )}
      />
      {/* Barion Pixel `contentView` (contentType: 'Page'). A KURZUS-OLDAL
          (/kurzusok/[slug]) ezt NEM kapja meg: ott a Product-ágú
          CourseBarionView fut, és két contentView némán duplázna. */}
      <BarionPageView
        pageId={BARION_PAGE_VIEW.courseList.id}
        pageName={BARION_PAGE_VIEW.courseList.name}
      />
      <Container>
        <header className="kc-course-list__header">
          <h1>Kurzusok</h1>
          <p className="kc-course-list__lead">
            Online kézrehabilitációs kurzusaink segítenek otthon, a saját tempódban felépülni.
            Válogass az otthoni gyakorlóprogramok és a szakmai továbbképzések között.
          </p>
        </header>

        {categories.length > 0 ? (
          <nav aria-label="Kurzusok szűrése kategória szerint" className="kc-course-filter">
            <ul role="list">
              <li>
                <Link
                  aria-current={activeSlug === null ? 'true' : undefined}
                  className="kc-course-filter__chip"
                  href="/kurzusok"
                >
                  Összes
                </Link>
              </li>
              {categories.map((category) => (
                <li key={category.id}>
                  <Link
                    aria-current={activeSlug === category.slug ? 'true' : undefined}
                    className="kc-course-filter__chip"
                    href={`/kurzusok?${CATEGORY_QUERY_PARAM}=${encodeURIComponent(category.slug)}`}
                  >
                    {category.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        {visible.length > 0 ? (
          <CourseShowcase products={visible} scenePhotos={false} />
        ) : (
          <div className="kc-course-empty" role="status">
            <h2>Jelenleg nincs megjeleníthető kurzus</h2>
            <p>
              Dolgozunk az új anyagokon. Nézz vissza később, vagy iratkozz fel, hogy értesítsünk az
              új kurzusokról.
            </p>
          </div>
        )}
      </Container>
    </Section>
  )
}
