import type { Product } from '../../payload-types'
import { CourseCard } from './CourseCard'

/**
 * TopicCoursesSection — a teljes program oldalán a témakurzusok rácsa
 * („Csak egy területen fáj?”).
 *
 * Miért itt, a tananyag után: a látogató a tananyagban látja, mi mindent fed
 * le a program; aki csak egy panasz miatt jött, ott dönti el, hogy neki a
 * teljes csomag sok. A kisebb ajánlat ezért a tananyag UTÁN áll, nem a
 * vásárlógomb mellett: a program marad a lap elsődleges célja (GOV.UK: egy
 * oldal, egy elsődleges cselekvés,
 * https://design-system.service.gov.uk/components/button/ ), a témakurzus
 * kártyái linkek, nem második vásárlógomb. A Baymard termékoldal-kutatása
 * szerint a termékoldalon a szűkebb, ALTERNATÍV ajánlat külön elemként segít
 * annak, akinek a nézett termék nem illik a céljához
 * (https://baymard.com/research-articles/product-page-suggestions ), és az
 * ajánlott elemnek elég adatot kell mutatnia a döntéshez: cím, kép, ár
 * (https://baymard.com/research-articles/product-page-suggestions-information ,
 * a CourseCard mindhármat adja). A felvezető kimondja, miben más a kisebb
 * ajánlat, ár-összevetés és sürgetés nélkül.
 *
 * A rács UGYANAZ a kártya és rács, mint a kurzuslistán és a kapcsolódó
 * kurzusoknál (`kc-course-grid`, `CourseCard`): ugyanaz az elem ugyanúgy néz
 * ki és ugyanúgy működik (WCAG 2.2 SC 3.2.4 Consistent Identification).
 */
export const TOPIC_COURSES_SECTION_ID = 'temakurzusok'
export const TOPIC_COURSES_HEADING = 'Csak egy területen fáj?'
export const TOPIC_COURSES_LEAD =
  'Ha csak egy területen van panaszod, a program ide tartozó részét külön is megveheted. A teljes program mindegyik témát tartalmazza.'

export interface TopicCoursesSectionProps {
  topics: Product[]
}

export function TopicCoursesSection({ topics }: TopicCoursesSectionProps) {
  if (topics.length === 0) {
    return null
  }
  return (
    <section
      aria-labelledby={`${TOPIC_COURSES_SECTION_ID}-cim`}
      className="kc-course-section"
      id={TOPIC_COURSES_SECTION_ID}
    >
      <h2 className="kc-course-section__title" id={`${TOPIC_COURSES_SECTION_ID}-cim`}>
        {TOPIC_COURSES_HEADING}
      </h2>
      <p className="kc-course-related__lead">{TOPIC_COURSES_LEAD}</p>
      <ul className="kc-course-grid" role="list">
        {topics.map((topic) => (
          <li key={topic.id}>
            <CourseCard headingLevel="h3" product={topic} />
          </li>
        ))}
      </ul>
    </section>
  )
}
