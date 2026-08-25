import Link from 'next/link'

import { courseHref } from '../../lib/course-url'
import { coursePriceBadgeKind, coursePriceLabel, courseTitle } from '../../lib/courses'
import { ctaLabel } from '../../lib/cta-vocabulary'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'
import type { CourseCtaTarget, PostCtaVariant } from './post-article'

import '../../app/(frontend)/styles/blocks/post-view.css'

/**
 * PostCourseCta — a cikk végi, halk ajánló panel.
 *
 * ═══ MIÉRT KELL ═══
 * NN/g, *Informational Articles Must Ask For the Order*
 * (https://www.nngroup.com/articles/product-links-on-informational-pages/):
 * a keresőből érkező látogató a navigációt nem járja be, ezért a
 * termék-hivatkozás helye „the page's body area and at the end of the
 * article"; a P&G-esettanulmányban a látogatók „didn't notice that P&G sold a
 * product". A hivatkozás nélküli cikk „attracts tons of freeloaders, but no
 * business".
 *
 * ═══ MIÉRT HALKAN ═══
 * Ugyanez a cikk: „Turn down the volume on the sales message. If you push too
 * hard, you lose credibility." Ezért kompakt panel a lap saját tokenjeivel,
 * kép nélkül, új szín nélkül — a bannervakság ellen is ez a védelem (NN/g,
 * *Banner Blindness*), és ez a `docs/ux-belso-oldalak-kutatas.md` B4.2 pontja.
 *
 * ═══ AMI TILOS A PANELBEN ═══
 * Gyógyulási arány, gyógyulási idő, „garantált eredmény", visszaszámláló,
 * kamu-készlet. A mért vevőhang szerint a versenytárs „80-20%-os gyógyulási
 * információja" NEGATÍV véleményt hozott
 * (docs/vevohang-es-hirdetesszoveg.md), és a feladatkiírás orvosi szabálya is
 * ezt tiltja.
 *
 * ═══ A HÁROM ÁG ÉS A GOMBOK SÚLYA (tulajdonosi döntés, 2026-08-25) ═══
 * - `kurzus` változat, kapcsolt kurzussal → „Nyisd meg a kurzusoldalt"
 *   (CTA-szótár #28, SECONDARY). Az ár vagy az „Ingyenes" tény a gomb
 *   KÖZVETLEN közelében áll (Baymard: a döntéshez szükséges tény a cselekvés
 *   mellé való, B6.2).
 * - `kurzus` változat kapcsolt kurzus nélkül → „Nézd meg a kurzusokat"
 *   (#10, PRIMARY).
 * - `idopont` változat (váll-cikk) → a releváns következő lépés a személyes
 *   vizsgálat, ezért „Kérj időpontot üzenetben" (#24, SECONDARY, a
 *   /kapcsolat időpontkérő szekciójára). Kéz-kurzust váll-panaszra nem
 *   ajánlunk elsődlegesként: a felirat és a törzs ígérete együtt maradjon
 *   igaz (WCAG 2.2 2.4.4, Link Purpose in Context).
 * - A `kurzus` változat MINDKÉT ága után külön időpontkérő doboz áll
 *   (AppointmentBox) — tulajdonosi kérés, 2026-08-25: az írásos
 *   időpontkérés minden cikk alól elérhető. A #24 súlya secondary, tehát
 *   az egy-elsődleges-gomb szabály sértetlen.
 * Laponként legfeljebb EGY elsődleges gomb áll (GOV.UK Buttons, B6.5).
 * Új gomb-feliratot kitalálni tilos — minden gombszöveg a
 * `cta-vocabulary.ts`-ből jön.
 *
 * ═══ AZ INGYENES BELÉPŐ SOR ═══
 * A tulajdonos 2026-08-25-i döntése: az ingyenes belépő MINDEN cikk alatt
 * megjelenik (korábban kizárólag a kezdőlapon élt). A megjelenés tudatosan
 * SZÖVEGES link, nem gomb: a panel hangerejét nem emeli (NN/g, „turn down
 * the volume"), és a linkszöveg a cél OLDAL NEVE — a kurzus címe —, ahogy a
 * GOV.UK linkszöveg-szabálya írja („use the name of the page the link goes
 * to as your link text",
 * https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/add-links/).
 * A mondat vége a jóváhagyott igaz-állítás mintáját követi
 * (`FreeCourseFormLink`): mit kell tenni érte, és hogy fizetni nem kell.
 * A váll-cikk alatt a mondat kimondja, hogy a kurzus kézpanaszokra szól —
 * enélkül az ajánlat mást ígérne, mint amit ad.
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
      <>
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
      </>
    )
  }

  const priceKind = coursePriceBadgeKind(course)
  const priceLabel = coursePriceLabel(course)

  return (
    <>
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
    </>
  )
}
