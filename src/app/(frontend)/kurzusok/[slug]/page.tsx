import type { Metadata } from 'next'
import { draftMode, headers } from 'next/headers'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'
import { getPayload } from 'payload'
import { Fragment, type ReactNode } from 'react'
import { cache } from 'react'

import { TrackEvent } from '@/components/analytics/TrackEvent'
import { JsonLd } from '@/components/content/JsonLd'
import { CourseBarionView } from '@/components/courses/CourseBarionView'
import { CourseBuyBar } from '@/components/courses/CourseBuyBar'
import { CourseBuybox } from '@/components/courses/CourseBuybox'
import { CourseGalleryFigure, firstGalleryMedia } from '@/components/courses/CourseGalleryFigure'
import { CourseCurriculum } from '@/components/courses/CourseCurriculum'
import { CourseFaq } from '@/components/courses/CourseFaq'
import { CourseFitCheck } from '@/components/courses/CourseFitCheck'
import { CourseGuarantee } from '@/components/courses/CourseGuarantee'
import { CourseHowItWorks } from '@/components/courses/CourseHowItWorks'
import { CourseJumpNav, type CourseJumpTarget } from '@/components/courses/CourseJumpNav'
import { FreeCourseFormLink } from '@/components/courses/FreeCourseFormLink'
import { FreeCourseRequestForm } from '@/components/courses/FreeCourseRequestForm'
import { LexicalContent } from '@/components/courses/LexicalContent'
import { PreviewVideo, hasPreviewVideo } from '@/components/courses/PreviewVideo'
import { PromoCourseView } from '@/components/courses/promo'
import { RelatedCourses } from '@/components/courses/RelatedCourses'
import { buildCourseSalesContent } from '@/components/courses/sales-content'
import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { PreviewBar } from '@/components/preview/PreviewBar'
import { withDraftRobots } from '@/lib/preview/draft-metadata'
import { loadProductPreview, previewCurriculum } from '@/lib/preview/product-preview'
import { resolveSingleCourseAccess } from '@/lib/course-access-lookup'
import { AUDIENCE_LABELS, normalizeAudience } from '@/lib/course-audience'
import { isCoursePromoDisplayed, resolveCoursePromo } from '@/lib/course-promo'
import { extractCoursePackage } from '@/lib/course-package'
import {
  canonicalCourseRedirect,
  courseHref,
  parseCourseRouteParam,
  withSearchParams,
  type CourseSearchParams,
} from '@/lib/course-url'
import {
  courseCover,
  coursePriceBadgeKind,
  coursePriceHuf,
  courseTitle,
  hasUserPurchased,
  resolveCourseCta,
} from '@/lib/courses'
import { buildCurriculum } from '@/lib/curriculum/curriculum'
import { formatPriceHuf } from '@/lib/format-price'
import { rewriteVisitorDashLeftover } from '@/lib/gondolatjel-leftover'
import { logger } from '@/lib/logger'
import {
  absoluteUrl,
  buildProductMetadata,
  courseJsonLd,
  faqPageJsonLd,
  productSeoDoc,
  resolveSeoDescription,
} from '@/lib/seo'
import { siteGraphJsonLd } from '@/lib/seo-graph'
import type { Product, User } from '@/payload-types'

import config from '../../../../payload.config'

/**
 * /kurzusok/[slug] — kurzus-oldal (az értékesítés motorja).
 * CTA INAKTÍV + „Ez a kurzus jelenleg nem vásárolható" jelölés (nem
 */

interface CoursePageProps {
  params: Promise<{ slug: string }>
  searchParams?: Promise<CourseSearchParams>
}

/**
 * Kérés-idejű dedupe: a generateMetadata és a page ugyanazt a lekérdezést
 * osztja meg. A szegmens slugként VAGY régi, numerikus id-ként oldódik fel
 * (parseCourseRouteParam) — a kettő névtere diszjunkt, lásd course-url.ts.
 */
const getCourseByRouteParam = cache(async (param: string): Promise<Product | null> => {
  const parsed = parseCourseRouteParam(param)
  if (parsed === null) {
    return null
  }
  try {
    const payload = await getPayload({ config })
    // depth: 2 — a relatedProducts és a borítóképek populate-olva jönnek.
    if (parsed.kind === 'id') {
      return await payload.findByID({
        collection: 'products',
        id: parsed.id,
        depth: 2,
        overrideAccess: true,
      })
    }
    const { docs } = await payload.find({
      collection: 'products',
      where: { slug: { equals: parsed.slug } },
      limit: 1,
      depth: 2,
      overrideAccess: true,
    })
    return docs[0] ?? null
  } catch (error) {
    logger.warn('kurzus-lekérdezés sikertelen — 404-cel renderelünk', {
      courseParam: param,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
})

// React cache deduplicates only within this request. No persistent draft/auth cache.
const getCourseView = cache(async (slug: string) => {
  const { isEnabled } = await draftMode()
  if (isEnabled) {
    try {
      const payload = await getPayload({ config })
      const product = await loadProductPreview({ payload, headers: await headers(), slug })
      if (product) return { product, isPreview: true }
    } catch {
      // Authentication or draft lookup failure never opens the draft boundary.
      return { product: null, isPreview: false }
    }
  }
  return { product: await getCourseByRouteParam(slug), isPreview: false }
})

/** A bejelentkezett felhasználó (anonim látogatónál null) — csak olvasás. */
async function getCurrentUser(): Promise<User | null> {
  try {
    const payload = await getPayload({ config })
    const { user } = await payload.auth({ headers: await headers() })
    return (user as User | null) ?? null
  } catch {
    return null
  }
}

/**
 * Él-e MÉG a vevő hozzáférése (A1). Lekérdezési hiba esetén true — a CTA
 * ilyenkor a mai, „már megvetted" viselkedést mutatja; a tényleges lejátszást
 * a stream-token végpont amúgy is újra ellenőrzi.
 */
async function hasLiveAccess(userId: number, product: Product): Promise<boolean> {
  try {
    const payload = await getPayload({ config })
    const access = await resolveSingleCourseAccess({ payload, userId, product, logger })
    return access.hasAccess
  } catch (error) {
    logger.warn('kurzus-oldal: hozzáférés-állapot számítása sikertelen', {
      userId,
      productId: product.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return true
  }
}

function categoryTitle(product: Product): string | null {
  const category = typeof product.category === 'object' ? product.category : null
  return category && typeof category.title === 'string' && category.title.length > 0
    ? category.title
    : null
}

function relatedProductsOf(product: Product): Product[] {
  if (!Array.isArray(product.relatedProducts)) {
    return []
  }
  return product.relatedProducts.filter(
    (entry): entry is Product => typeof entry === 'object' && entry !== null,
  )
}

/** A vásárlódoboz horgonya (a másodlagos szöveglinkek és a JSON-LD miatt). */
const BUYBOX_ID = 'kurzus-vasarlas'
/**
 * A vásárlógomb horgonya — a ragadós vásárlósáv EZT figyeli.
 * SZÁNDÉKOSAN a gomb, nem a doboz: a ragadós doboz teteje látszhat úgy is,
 * hogy a gomb már a doboz belső görgetésén kívül van (mérve 1280×720-on).
 */
const CTA_ID = 'kurzus-vasarlas-gomb'

/** A megjelenő szakaszok leírója (horgony-cél + tartalom). */
interface PageSection {
  target: CourseJumpTarget | null
  node: ReactNode
}

export async function generateMetadata({ params }: CoursePageProps): Promise<Metadata> {
  const { slug } = await params
  const { product, isPreview } = await getCourseView(slug)
  if (
    !product ||
    (!isPreview &&
      (product._status === 'draft' ||
        (product.status !== 'published' && product.status !== 'archived')))
  ) {
    return { title: 'A kurzus nem található' }
  }
  // Ugyanaz a fallback-lánc és canonical, mint a poszt- és az oldal-útvonalon
  // (src/lib/seo.ts): seoTitle → kurzusnév, seoDescription → rövid leírás,
  // ogImage → borítókép. Párhuzamos meta-logika itt nincs. A canonical MINDIG
  // a kanonikus (slugos) cím, akkor is, ha épp a régi id-s URL-t szolgáljuk ki.
  return withDraftRobots(buildProductMetadata(product, courseHref(product)), isPreview)
}

export default async function CoursePage({ params, searchParams }: CoursePageProps) {
  const { slug } = await params
  const { product, isPreview } = await getCourseView(slug)
  // Draft (és minden nem published/archived) termék nyilvánosan nem érhető el.
  if (
    !product ||
    (!isPreview &&
      (product._status === 'draft' ||
        (product.status !== 'published' && product.status !== 'archived')))
  ) {
    notFound()
  }

  // Régi, id-alapú (vagy nem kanonikus alakú) cím → TARTÓS átirányítás.
  // SZÁNDÉKOSAN a 404-ellenőrzés UTÁN: draft termék slugja így sem szivárog ki.
  // A cél mindig maga a kanonikus cím, amely önmagára már nem irányít → nincs
  // átirányítási kör (course-url.ts canonicalCourseRedirect).
  // Státuszkód: a Next App Router tartós átirányítása 308 (Permanent Redirect).
  // A keresők ezt a 301-gyel azonosan kezelik (a link-érték átöröklődik), és a
  // 308 a 301-gyel ellentétben a metódust sem írja át — DB-vezérelt cél mellett
  // ez az egyetlen elérhető tartós átirányítás (a next.config redirects() csak
  // statikus szabályt tud).
  // A bejövő query string (pl. UTM-paraméterek) változatlanul továbbmegy a
  // kanonikus címre — a kampány-attribúció nem veszhet el az átirányításon.
  const canonicalPath = isPreview ? null : canonicalCourseRedirect(slug, product)
  if (canonicalPath !== null) {
    permanentRedirect(withSearchParams(canonicalPath, (await searchParams) ?? {}))
  }

  const user = isPreview ? null : await getCurrentUser()
  // Lejárt hozzáférés = a CTA szempontjából „még nem vevő": újra megvásárolható.
  const purchased =
    user !== null &&
    hasUserPurchased(user.purchases, product.id) &&
    (await hasLiveAccess(user.id, product))

  const title = courseTitle(product)
  const cover = courseCover(product)
  const price = coursePriceHuf(product)
  // Az ár-címke fajtája: 'price' → PriceTag; 'free' (tudatosan ingyenes) →
  // „Ingyenes"; 'none' (ár-pipa BE, ár ÜRES — konfig-hiba) → NINCS címke
  // (az „Ingyenes" a „Megveszem" mellett megtévesztő lenne — courses.ts
  // coursePriceBadgeKind).
  const priceBadge = coursePriceBadgeKind(product)
  const category = categoryTitle(product)
  // Kétirányú kurzusstruktúra: visszafogott jelzés arról, melyik ághoz tartozik
  // a kurzus (audience nélküli, régi soroknál a laikus fallback látszik).
  const audienceLabel = AUDIENCE_LABELS[normalizeAudience(product.audience)]
  const showPreview = hasPreviewVideo(product.previewVideoStreamId)
  // A strukturált adat és a morzsamenü ugyanazt a KANONIKUS címet használja,
  // mint a canonical meta — különben a gépi olvasó két URL-t látna egy oldalra.
  const path = courseHref(product)

  // A tananyag NYILVÁNOS nézete: hozzáférés nélkül épül, ezért a fizetős
  // tartalom hordozói (Bunny-GUID, lecke-szöveg, melléklet, külső link) bele
  // sem kerülnek a modellbe (S2/b — curriculum.ts).
  const publicCurriculum = buildCurriculum(product, false)
  const curriculum = isPreview ? previewCurriculum(publicCurriculum) : publicCurriculum
  const sales = buildCourseSalesContent(product, {
    moduleCount: curriculum.modules.filter((module) => module.lessons.length > 0).length,
    lessonCount: curriculum.lessons.length,
    accessDurationDays:
      typeof product.accessDurationDays === 'number' ? product.accessDurationDays : null,
    free: priceBadge === 'free',
    hasPreview: showPreview,
  })

  // A CTA állapotgépe (courses.ts) — a checkout-útvonal és az árlogika
  // VÁLTOZATLAN. A ragadós vásárlósáv csak a ténylegesen vásárolható
  // állapotban jelenik meg: „már megvetted" vagy „nem vásárolható" mellett
  // egyedül a vásárlódoboz jelzése marad.
  const cta = resolveCourseCta(product, purchased)

  /**
   * A `free` ág (published + `isFreeCourse` + még nem a vevőé) eddig egy
   * linket adott a `/kurzusaim` oldalra. Be nem jelentkezett látogatónak ez
   * ZSÁKUTCA: fiókja nincs, a lista bejelentkezést kér, a kurzushoz sosem jut
   * hozzá — pedig ez az ingyenes anyag a teljes értékesítési tölcsér teteje.
   * A régi `www.kineticare.hu` ugyanitt űrlapot adott („KÉREM A
   * VILLÁMKURZUST" → név + e-mail → a link e-mailben), tehát a visszatérő
   */
  const showFreeRequestForm = !isPreview && cta.kind === 'free'
  // A site key szerver-oldalon olvasott (nem NEXT_PUBLIC): a spam-ellenőrző
  // widget csak beállított kulcs mellett jelenik meg — kulcs nélkül a szerver
  // sem ellenőriz, tehát a widget hamis biztonságérzet lenne (a kapcsolat-
  // űrlap ugyanezt a szabályt követi).
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY ?? null

  /**
   * A ragadós vásárlósáv a `free` ágon MEGSZŰNIK. A sáv egy LINK: `href`-re
   * navigál, az igénylés viszont ŰRLAP-BEKÜLDÉS, amit link nem tud elvégezni.
   * A látogató így sem marad út nélkül: az űrlap a DOM-ban a lap ELEJÉN áll
   * (a vásárlódoboz a rács első eleme), mobilon tehát a legelső dolog a
   * képernyőn, a tartalom VÉGÉN pedig ott az ISMÉTELT belépő (2026-08-17,
   * `FreeCourseFormLink`) — az saját, jóváhagyott szótári sort kapott
   * (§3.2 #27, `Kérd az ingyenes kurzust`, E/2 navigáció), pont a #24 ↔ #25
   * minta szerint.
   */
  const showBuyBar = !isPreview && cta.kind === 'buy'
  const priceLabel =
    priceBadge === 'price' && price !== null
      ? formatPriceHuf(price)
      : priceBadge === 'free'
        ? 'Ingyenes'
        : null
  const guaranteeLabel = sales.guarantee === null ? null : sales.guarantee.title

  const usePromoView =
    isCoursePromoDisplayed(product) && priceBadge === 'price' && price !== null && !isPreview
  // Csak explicit, szerkeszthető CMS-blokk választja az új tartalmi kiosztást.
  // A normál és az előnézeti oldalon a blokk a leírásban marad, tartalomvesztés nélkül.
  const packageContent = usePromoView
    ? extractCoursePackage(sales.body)
    : { package: null, body: sales.body }

  // ── A szakaszok, dokumentum-sorrendben ────────────────────────────────────
  const sections: PageSection[] = []

  if (packageContent.body && packageContent.body.root.children.length > 0) {
    sections.push({
      target: { id: 'mi-ez', label: 'Mi ez?' },
      node: (
        <section aria-labelledby="mi-ez-cim" className="kc-course-section" id="mi-ez">
          <h2 className="kc-course-section__title" id="mi-ez-cim">
            A kurzusról
          </h2>
          <LexicalContent className="kc-course-prose" content={packageContent.body} />
        </section>
      ),
    })
  }

  // WP51: a `gallery` első képe a leírás UTÁN, a lépések ELŐTT töri meg a
  // szöveget (CourseGalleryFigure). Nincs ugrócélja: kép, nem szakasz.
  if (firstGalleryMedia(product) !== null) {
    sections.push({ target: null, node: <CourseGalleryFigure product={product} /> })
  }

  if (sales.steps.length > 0) {
    sections.push({
      target: { id: 'hogyan-mukodik', label: 'Hogyan működik?' },
      node: (
        <CourseHowItWorks
          heading="Hogyan működik?"
          headingId="hogyan-mukodik-cim"
          steps={sales.steps}
        />
      ),
    })
  }

  const curriculumModules = curriculum.modules.filter((module) => module.lessons.length > 0)
  if (curriculumModules.length > 0) {
    sections.push({
      target: { id: 'tananyag', label: 'Tananyag' },
      node: (
        <CourseCurriculum heading="Tananyag" headingId="tananyag-cim" modules={curriculumModules} />
      ),
    })
  }

  if (sales.fitFor.length > 0 || sales.notFitFor.length > 0) {
    sections.push({
      target: { id: 'kinek-valo', label: 'Kinek való?' },
      node: (
        <CourseFitCheck
          fitFor={sales.fitFor}
          fitTitle="Neked való, ha…"
          heading="Kinek való, és kinek nem?"
          headingId="kinek-valo-cim"
          notFitFor={sales.notFitFor}
          notFitTitle="Nem javasoljuk, ha…"
        />
      ),
    })
  }

  if (sales.guarantee !== null) {
    sections.push({
      target: { id: 'garancia', label: 'Garancia' },
      node: <CourseGuarantee guarantee={sales.guarantee} headingId="garancia-cim" />,
    })
  }

  if (sales.faq.length > 0) {
    sections.push({
      target: { id: 'gyik', label: 'GYIK' },
      node: <CourseFaq heading="Gyakori kérdések" headingId="gyik-cim" items={sales.faq} />,
    })
  }

  // A szakaszok dokumentum-sorrendben, KÖZBEÉKELT vásárlási sáv NÉLKÜL: a lap
  // egyetlen vásárlási célja a ragadós vásárlódoboz (mobilon a ragadós alsó
  // sáv) — lásd a fájl fejlécének 4. pontját.
  const rendered = sections.map((section, index) => (
    <Fragment key={`szakasz-${index}`}>{section.node}</Fragment>
  ))

  const jumpTargets = sections
    .map((section) => section.target)
    .filter((target): target is CourseJumpTarget => target !== null)
  // A vásárlódoboz másodlagos, alacsonyabb súlyú útja: a legfontosabb
  // döntési szakaszra visz (kinek való → tananyag → az első létező szakasz).
  const secondaryTarget =
    jumpTargets.find((target) => target.id === 'kinek-valo') ??
    jumpTargets.find((target) => target.id === 'tananyag') ??
    jumpTargets[0] ??
    null

  /**
   * AKCIÓS SABLON (WP59, tulajdonosi kérés). Ha az admin „Akció" csoportja
   * szerint az akció MOST él (course-promo.ts), a lap a kampányoldal
   * dizájnját kapja a kurzus saját tartalmával (PromoCourseView) — a
   * számítások, a CTA-állapotgép, a szakaszok és az id-k UGYANAZOK, csak az
   * elrendezés más. Két kizárás:
   *  - `priceBadge !== 'price'`: az akció ÁR-üzenet; ingyenes kurzuson nincs
   *    mit akciózni, ár nélküli (hiányos konfigurációjú) terméken pedig az
   *    „akciós ár" hamis állítás lenne (a felirat legyen igaz, SKILL 2. pont);
   *  - `isPreview`: a szerkesztői előnézet a tartalom ellenőrzésére való, ott
   *    az akciós jelölés és a vásárlás-mentes sablon csak zavarná az ellenőrzést.
   * Minden más esetben a lap kimenete változatlan.
   */
  const promo = resolveCoursePromo(product)
  // Az akciós megjelenés közös szabálya (course-promo.ts isCoursePromoDisplayed):
  // élő időablak + közzétett kurzus + érvényes ár. Archivált kurzus (Devin,
  // #278) így a rendes oldalt kapja, ahol a vásárlás tiltása látszik.
  // priceValidUntil SZÁNDÉKOSAN nincs: a `price` a coursePriceHuf MOST fizetendő
  // ára (WP63: akcióban az akciós ár, utána magától a rendes ár), a végdátumot
  // az Offer-ben nem ígérjük (Codex, #278).

  // Az ingyenes előzetes videó MINDKÉT sablonon ugyanaz a csomópont: az
  // akciós oldal sem veszítheti el (Devin, #278), a kapu (hasPreviewVideo)
  // és a nyilvános stream-kezelés változatlan.
  const previewFigure = showPreview ? (
    <figure className="kc-course-media">
      <PreviewVideo streamId={product.previewVideoStreamId} title={`${title}: előzetes`} />
      <figcaption className="kc-course-media__caption">Ingyenes előzetes</figcaption>
    </figure>
  ) : null

  const structuredHead = !isPreview ? (
    <>
      {/* PostHog funnel-lépés: a kurzus-oldal megnyitása (no-op consent nélkül). */}
      <TrackEvent
        event="course_viewed"
        properties={{ courseId: product.id, courseSku: product.sku ?? undefined }}
      />
      {/* Barion Pixel `contentView` (termékoldal). Az ár ugyanabból a
      forrásból jön, mint a kiírt PriceTag és a strukturált adat: az
      `ingyenes` ág 0-t, a hiányos konfiguráció NaN-t ad — utóbbinál az
      esemény magától kimarad (barion-events.ts). */}
      <CourseBarionView
        course={{
          id: product.id,
          name: title,
          priceHuf: priceBadge === 'free' ? 0 : (price ?? Number.NaN),
          quantity: 1,
          ...(category !== null ? { category } : {}),
          ...(cover ? { imageUrl: absoluteUrl(cover.url) } : {}),
        }}
      />
      {/* Strukturált adat: Course + Product (egy entitás, kettős @type) és a
      hozzá tartozó Offer. Minden mezője a LÁTHATÓ tartalomból jön — a név a
      H1, a leírás a hero lead, a kép a buybox borítóképe, az ár pedig a
      kiírt PriceTag forrása (priceInHUF), tehát árváltozásnál automatikusan
      követi és nem tud elavulni. */}
      <JsonLd
        data={courseJsonLd({
          product,
          name: title,
          path,
          priceHuf: price,
          ...(cover ? { imageUrl: absoluteUrl(cover.url) } : {}),
        })}
      />
      {/* Oldal-gráf: Organization + WebSite + ItemPage (a kurzus lapja) +
      BreadcrumbList (Kurzusok → kurzus). Az ItemPage `mainEntity`-je a
      fenti Course/Product csomópont (@id …#course), így a lap és a termék
      egy gráfban áll (schema.org ItemPage: https://schema.org/ItemPage). */}
      <JsonLd
        data={siteGraphJsonLd({
          page: {
            path,
            name: title,
            description: resolveSeoDescription(productSeoDoc(product)),
            type: 'ItemPage',
            ...(cover ? { imageUrl: absoluteUrl(cover.url) } : {}),
            dateModified: product.updatedAt,
            mainEntityId: `${absoluteUrl(path)}#course`,
          },
          breadcrumbs: [
            { name: 'Kurzusok', path: '/kurzusok' },
            { name: title, path },
          ],
        })}
      />
      {/* A FAQPage strukturált adat UGYANABBÓL a listából készül, mint a
      látható harmonika — a kettő így sosem tud szétcsúszni (ez a
      leggyakoribb ok, amiért a keresők elvetik a rich resultot). */}
      {sales.faq.length > 0 ? <JsonLd data={faqPageJsonLd(sales.faq)} /> : null}
    </>
  ) : null

  if (usePromoView && price !== null) {
    return (
      <>
        {structuredHead}
        <PromoCourseView
          audienceLabel={audienceLabel}
          category={category}
          cta={cta}
          ctaId={CTA_ID}
          curriculumModules={curriculumModules}
          guaranteeLabel={guaranteeLabel}
          jumpTargets={jumpTargets}
          lead={
            typeof product.shortDescription === 'string'
              ? rewriteVisitorDashLeftover(product.shortDescription)
              : null
          }
          packageContent={packageContent.package}
          preview={previewFigure}
          priceHuf={price}
          priceLabel={priceLabel}
          product={product}
          promo={promo}
          related={relatedProductsOf(product)}
          sales={sales}
          sections={sections}
          showBuyBar={showBuyBar}
          title={title}
        />
      </>
    )
  }

  return (
    <>
      {isPreview ? <PreviewBar path={path} /> : null}
      {structuredHead}

      <Section>
        <Container>
          <nav aria-label="Morzsamenü" className="kc-course-breadcrumb">
            <ol role="list">
              <li>
                <Link href="/kurzusok">Kurzusok</Link>
              </li>
              <li aria-current="page">{title}</li>
            </ol>
          </nav>

          <div className="kc-course-layout">
            {/* DOM-sorrend: a vásárlódoboz ELÖL. Mobilon így a cím, az ár és a
                gomb a lap tetején van (a nézési idő 42%-a a felső 20%-ra esik),
                desktopon pedig a rács teszi a jobb hasábba — a fókusz-út
                végigjárva értelmes marad (B7.4). */}
            <div className="kc-course-layout__aside">
              <CourseBuybox
                audienceLabel={audienceLabel}
                categoryLabel={category}
                ctaId={CTA_ID}
                ctaSlot={
                  isPreview ? (
                    <p id={CTA_ID}>
                      Szerkesztői előnézet. Vásárlás és kurzusigénylés itt nem indítható.
                    </p>
                  ) : showFreeRequestForm ? (
                    <FreeCourseRequestForm
                      courseTitle={title}
                      id={CTA_ID}
                      productId={product.id}
                      turnstileSiteKey={turnstileSiteKey}
                      {...(user?.name ? { defaultName: user.name } : {})}
                      {...(user?.email ? { defaultEmail: user.email } : {})}
                    />
                  ) : null
                }
                guaranteeLabel={guaranteeLabel}
                hasPurchased={purchased}
                highlights={sales.highlights}
                id={BUYBOX_ID}
                lead={
                  typeof product.shortDescription === 'string'
                    ? rewriteVisitorDashLeftover(product.shortDescription)
                    : null
                }
                priceBadge={priceBadge}
                priceHuf={price}
                product={
                  isPreview
                    ? {
                        id: product.id,
                        slug: product.slug,
                        status: product.status,
                        priceInHUF: product.priceInHUF,
                        priceInHUFEnabled: product.priceInHUFEnabled,
                      }
                    : product
                }
                secondaryHref={secondaryTarget === null ? null : `#${secondaryTarget.id}`}
                secondaryLabel={secondaryTarget === null ? null : secondaryTarget.label}
                title={title}
              />
            </div>

            <div className="kc-course-layout__main">
              {previewFigure !== null ? (
                previewFigure
              ) : cover ? (
                <figure className="kc-course-media">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a Payload media méretei kézileg vannak bekötve (width/height a CMS-ből) */}
                  <img
                    alt={cover.alt}
                    className="kc-course-media__image"
                    decoding="async"
                    height={cover.height ?? undefined}
                    src={cover.url}
                    width={cover.width ?? undefined}
                  />
                </figure>
              ) : null}

              <CourseJumpNav targets={jumpTargets} />

              {rendered}

              {/* ISMÉTELT belépő az igénylő űrlaphoz, a tartalom VÉGÉN — csak
                  az ingyenes ágon, és csak ott látszik, ahol ragadós doboz
                  NINCS (1024px alatt, kurzusok.css). A hatókör indoklása és a
                  forrásai: FreeCourseFormLink. */}
              {showFreeRequestForm ? <FreeCourseFormLink formId={CTA_ID} /> : null}
            </div>
          </div>
        </Container>
      </Section>

      {/* Ragadós vásárlósáv: csak akkor, ha tényleg van mit indítani, és csak
          akkor látszik, ha a vásárlódoboz GOMBJA nem látszik — bármilyen
          méreten (mérve: asztali méreteken a gomb korábban a lap 90%-án
          kattinthatatlan volt). JS nélkül rejtve marad (CourseBuyBar).
          A `label !== null` nem formalitás: a nem cselekvő (archivált, hiányos
          konfigurációjú) állapotoknak SZÁNDÉKOSAN nincs feliratuk (Á-3), így a
          ragadós sáv sem kaphat hamis ígéretű gombot. */}
      {showBuyBar && cta.href !== null && cta.label !== null ? (
        <CourseBuyBar
          anchorId={CTA_ID}
          courseTitle={title}
          href={cta.href}
          label={cta.label}
          priceLabel={priceLabel}
        />
      ) : null}

      {/* Kapcsolódó kurzusok. Az INGYENES kurzus oldalán CROSS-SELL keretezést
          kap (cím + felvezető: mi jön az ingyenes anyag után), a fizetős
          kurzusoldalon a semleges sáv marad — a kapcsoló az ÁR-ÁLLAPOT, nem az
          űrlap láthatósága, mert a már igényelt ingyenes kurzus oldalán is ez a
          helyes keretezés. A megjelenő termékek forrása a `relatedProducts`
          mező (a szerkesztő állítja); beállítás nélkül a sáv nem renderelődik. */}
      {!isPreview ? (
        <RelatedCourses crossSell={priceBadge === 'free'} products={relatedProductsOf(product)} />
      ) : null}
    </>
  )
}
