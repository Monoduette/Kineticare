import { isDiscoverableCourse } from '../../lib/course-discovery'
import { coursePriceHuf } from '../../lib/courses'
import type { Product } from '../../payload-types'
import { Container } from '../ui/Container'
import { Section } from '../ui/Section'
import { CourseCard } from './CourseCard'

/**
 * RelatedCourses — kapcsolódó kurzusok sáv a kurzus-oldal alján.
 * (`docs/regi-oldal-valaszok.md` 21. ellentmondás) — ezt NEM hozzuk át. A
 */

/** A sáv címsorának horgonya — ettől kap a `section` hozzáférhető nevet. */
export const RELATED_COURSES_HEADING_ID = 'kapcsolodo-kurzusok-cim'

/** A semleges (fizetős kurzus) ág címe. VÁLTOZATLAN a 2026-08-17 előtti állapothoz képest. */
export const RELATED_COURSES_HEADING = 'Kapcsolódó kurzusok'

/**
 * A cross-sell ág címe. Kérdő alak, mint a lap többi szakaszcíme („Hogyan
 * működik?", „Kinek való, és kinek nem?") — a látogató szemszögéből mondja meg,
 * mire szolgál a sáv (Baymard: a felirat tegye egyértelművé, mire vonatkozik az
 * ajánlás). Felkiáltójel és sürgetés nincs benne.
 */
export const CROSS_SELL_HEADING = 'Mi jön az ingyenes kurzus után?'

/**
 * A cross-sell felvezető, ha a kapcsolt kurzuson LÁTSZIK ár. A második mondat
 * csak akkor állítja, hogy az ár alább van, ha tényleg ott van — különben a
 * szöveg hazudna (NN/g „Sincere").
 */
export const CROSS_SELL_LEAD_WITH_PRICE =
  'Ha az ingyenes anyag után rendszeresen gyakorolnál, itt folytathatod. Az árat alább látod, a teljes tananyagot pedig a kurzus oldalán.'

/** Ugyanaz, ár nélküli (pl. hiányosan konfigurált) kapcsolt kurzusnál. */
export const CROSS_SELL_LEAD =
  'Ha az ingyenes anyag után rendszeresen gyakorolnál, itt folytathatod. A teljes tananyagot a kurzus oldalán találod.'

export interface RelatedCoursesProps {
  products: Product[]
  /**
   * Cross-sell keretezés (cím + felvezető). Az INGYENES kurzus oldalán `true`;
   * a fizetős kurzusoldal alapértelmezésben a semleges sávot kapja.
   */
  crossSell?: boolean
}

export function RelatedCourses({ products, crossSell = false }: RelatedCoursesProps) {
  const published = products.filter(isDiscoverableCourse)
  if (published.length === 0) {
    return null
  }

  // Az ÁR ugyanabból az egyetlen forrásból dől el, mint a kártyán (courses.ts):
  // a felvezető és a kártya így nem tud szétcsúszni.
  const hasVisiblePrice = published.some((product) => coursePriceHuf(product) !== null)
  const lead = crossSell ? (hasVisiblePrice ? CROSS_SELL_LEAD_WITH_PRICE : CROSS_SELL_LEAD) : null

  return (
    <Section aria-labelledby={RELATED_COURSES_HEADING_ID} variant="tint">
      <Container>
        <h2 className="kc-course-related__title" id={RELATED_COURSES_HEADING_ID}>
          {crossSell ? CROSS_SELL_HEADING : RELATED_COURSES_HEADING}
        </h2>
        {lead === null ? null : <p className="kc-course-related__lead">{lead}</p>}
        <ul className="kc-course-grid" role="list">
          {published.map((product) => (
            <li key={product.id}>
              <CourseCard headingLevel="h3" product={product} />
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  )
}
