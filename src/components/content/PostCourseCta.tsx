import Link from 'next/link'
import type { ReactNode } from 'react'

import { courseHref } from '../../lib/course-url'
import { coursePriceBadgeKind, coursePriceLabel, courseTitle } from '../../lib/courses'
import { ctaLabel } from '../../lib/cta-vocabulary'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'
import type { CourseCtaTarget, PostCtaVariant } from './post-article'

import '../../app/(frontend)/styles/blocks/post-view.css'

/**
 * PostCourseCta — cikk végi halk ajánló panel (nem sürget, nem ígér eredményt).
 * Kurzus-panel + opcionális időpontkérő doboz; FAQPage JSON-LD nélkül.
 */
export interface PostCourseCtaProps {
  /** A cikkhez kapcsolt, közzétett kurzus; null, ha nincs (vagy nem publikált). */
  course: CourseCtaTarget | null
  /** A tudatosan ingyenes belépő kurzus; null, ha nincs publikált ingyenes termék. */
  freeCourse: CourseCtaTarget | null
  /** A cikk témájához igazított változat (post-article.ts, postCtaVariantOf). */
  variant: PostCtaVariant
}

/**
 * A kurzus nélküli ág két mikroszövege.
 *
 * LEKTORÁLANDÓ (docs/tudastar-technikai-terv.md 11. fejezet, K-B3): vevői
 * szöveg, a tulajdonos jóváhagyása előtt nem végleges. A megfogalmazás
 * tudatosan tényszerű: nem ígér eredményt, nem sürget, és nem mond olyat,
 * ami ne lenne igaz minden kurzusra. Gondolatjel nincs benne (§3.1.2).
 */
const NO_COURSE_HEADING = 'Hogyan tovább?'
const NO_COURSE_TEXT =
  'A cikkek a tájékozódáshoz szólnak. Ha vezetett, videós gyakorlást keresel otthonra, azt a kurzusainkban találod meg.'

/**
 * Az időpontos mikroszövegek. Tényszerűek: a cikkek maguk is azt mondják ki,
 * hogy a panaszt vizsgálat tudja megítélni; a doboz ugyanezt a következő
 * lépést adja meg, ígéret nélkül. Gondolatjel és felkiáltójel nincs
 * (§3.1.2, G-UI7).
 *
 * Két változat van: a váll-cikk fő ajánlata maga az időpontkérés
 * (`APPOINTMENT_TEXT`), a kéz-cikkek alatt pedig a kurzus-panel UTÁN álló
 * külön doboz szövege általános (`APPOINTMENT_BOX_TEXT`) — tulajdonosi
 * kérés, 2026-08-25: az időpontkérés minden cikk alól elérhető legyen.
 */
export const APPOINTMENT_HEADING = 'Hogyan tovább?'
export const APPOINTMENT_TEXT =
  'A cikkek a tájékozódáshoz szólnak. A váll panaszát személyes vizsgálat tudja megítélni, időpontot írásban kérhetsz a rendelőnkbe.'
export const APPOINTMENT_BOX_HEADING = 'Időpontkérés a rendelőbe'
export const APPOINTMENT_BOX_TEXT =
  'A cikk nem helyettesíti a vizsgálatot. Ha a panaszod nem javul, vagy szeretnéd, hogy szakember nézze meg, időpontot írásban kérhetsz a rendelőnkbe.'
/** A §3.2 #24 dokumentált célja: a /kapcsolat időpontkérő szekciója. */
export const APPOINTMENT_HREF = '/kapcsolat#idopontkeres'

/**
 * Az ingyenes belépő mondat három rögzített darabja. A linkszöveg maga a
 * kurzus címe (a két darab közé kerül), a zárás a `FreeCourseFormLink`
 * jóváhagyott, igaz állítás-mintáját követi.
 */
export const FREE_LINE_LEAD = 'Ingyenes belépő kurzusunk is van: '
export const FREE_LINE_LEAD_KEZ = 'Ingyenes belépő kurzusunk is van, kézpanaszokra: '
export const FREE_LINE_TAIL = '. A hozzáférést a kurzus oldalán kérheted, fizetned nem kell érte.'

function FreeCourseLine({
  freeCourse,
  variant,
}: {
  freeCourse: CourseCtaTarget | null
  variant: PostCtaVariant
}) {
  if (freeCourse === null) return null
  const title = courseTitle(freeCourse)
  if (title === null) return null
  return (
    <p className="kc-post-cta__free">
      {variant === 'idopont' ? FREE_LINE_LEAD_KEZ : FREE_LINE_LEAD}
      <Link className="kc-post-cta__free-link" href={courseHref(freeCourse)}>
        {title}
      </Link>
      {FREE_LINE_TAIL}
    </p>
  )
}

/**
 * Külön időpontkérő doboz a kurzus-panel UTÁN (tulajdonosi kérés,
 * 2026-08-25): az írásos időpontkérés minden cikk alól elérhető, a §3.2 #24
 * feliratával, a /kapcsolat időpontkérő szekciójára. A váll-változat fő
 * panelje maga az időpontkérés, ott ez a doboz nem ismétlődik (NN/g,
 * The Same Link Twice on the Same Page: a duplikált linknek ára van).
 */
function AppointmentBox() {
  return (
    <Card as="section" className="kc-post-cta__panel">
      <h2 className="kc-post-cta__title">{APPOINTMENT_BOX_HEADING}</h2>
      <p className="kc-post-cta__text">{APPOINTMENT_BOX_TEXT}</p>
      <p className="kc-post-cta__action">
        <Link className="kc-button kc-button--secondary" href={APPOINTMENT_HREF}>
          {ctaLabel('appointment-request-link')}
        </Link>
      </p>
    </Card>
  )
}

/**
 * A két fehér panel (kurzus-ajánló + időpontkérő) közös rácsa. Mobilon egy
 * hasáb marad, asztali gépen (900 px, a repó közös töréspontja) két egyenlő
 * hasáb. A váll-cikk egyetlen panelje NEM kerül ide: ott nincs pár.
 */
function CtaPair({ children }: { children: ReactNode }) {
  return <div className="kc-post-cta__pair">{children}</div>
}

export function PostCourseCta({ course, freeCourse, variant }: PostCourseCtaProps) {
  if (variant === 'idopont') {
    return (
      <Card as="section" className="kc-post-cta__panel">
        <h2 className="kc-post-cta__title">{APPOINTMENT_HEADING}</h2>
        <p className="kc-post-cta__text">{APPOINTMENT_TEXT}</p>
        <p className="kc-post-cta__action">
          <Link className="kc-button kc-button--secondary" href={APPOINTMENT_HREF}>
            {ctaLabel('appointment-request-link')}
          </Link>
        </p>
        <FreeCourseLine freeCourse={freeCourse} variant={variant} />
      </Card>
    )
  }

  if (course === null) {
    return (
      <CtaPair>
        <Card as="section" className="kc-post-cta__panel">
          <h2 className="kc-post-cta__title">{NO_COURSE_HEADING}</h2>
          <p className="kc-post-cta__text">{NO_COURSE_TEXT}</p>
          <p className="kc-post-cta__action">
            <Link className="kc-button kc-button--primary" href="/kurzusok">
              {ctaLabel('course-list-open')}
            </Link>
          </p>
          <FreeCourseLine freeCourse={freeCourse} variant={variant} />
        </Card>
        <AppointmentBox />
      </CtaPair>
    )
  }

  const priceKind = coursePriceBadgeKind(course)
  const priceLabel = coursePriceLabel(course)

  return (
    <CtaPair>
      <Card as="section" className="kc-post-cta__panel">
        <h2 className="kc-post-cta__title">{courseTitle(course)}</h2>
        {course.shortDescription !== null ? (
          <p className="kc-post-cta__text">{course.shortDescription}</p>
        ) : null}
        <p className="kc-post-cta__action">
          {/* Az ÁR-TÉNY a gomb mellett áll. A 'none' állapot (bekapcsolt
              ár-pipa, üres ár) SZÁNDÉKOSAN néma: az konfigurációs hiba, és az
              „Ingyenes" felirat ott hazugság lenne (lib/courses.ts). */}
          {priceKind === 'price' && priceLabel !== null ? (
            <Badge tone="neutral">{priceLabel}</Badge>
          ) : null}
          {priceKind === 'free' ? <Badge tone="success">Ingyenes</Badge> : null}
          <Link className="kc-button kc-button--secondary" href={courseHref(course)}>
            {ctaLabel('course-sales-open')}
          </Link>
        </p>
        {/* Ha a KAPCSOLT kurzus maga az ingyenes termék, a sor nem ismétli meg
            ugyanazt a célt (NN/g, The Same Link Twice on the Same Page). */}
        {freeCourse !== null && freeCourse.id !== course.id ? (
          <FreeCourseLine freeCourse={freeCourse} variant={variant} />
        ) : null}
      </Card>
      <AppointmentBox />
    </CtaPair>
  )
}
