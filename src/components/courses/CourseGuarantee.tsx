import type { SalesGuarantee } from './sales-content'

/**
 * CourseGuarantee — a garancia KIEMELT sávban, nem a lap alján folyószövegben.
 * Miért: a Baymard termékoldal-benchmarkja szerint az oldalak 44%-a nem
 * jeleníti meg és nem is linkeli a visszaküldési feltételeket, a
 * kosárelhagyások 13%-a pedig épp ezen múlik
 * (docs/ux-belso-oldalak-kutatas.md B6.3, K13). A mi oldalunkon a garancia
 * eddig a 821 szavas leírás LEGALJÁN volt — a nézési idő maradék ~19%-ának
 */
export interface CourseGuaranteeProps {
  guarantee: SalesGuarantee
  headingId: string
}

export function CourseGuarantee({ guarantee, headingId }: CourseGuaranteeProps) {
  return (
    <section aria-labelledby={headingId} className="kc-course-guarantee" id="garancia">
      <p aria-hidden="true" className="kc-course-guarantee__mark">
        ✓
      </p>
      <div className="kc-course-guarantee__body">
        <h2 className="kc-course-guarantee__title" id={headingId}>
          {guarantee.title}
        </h2>
        <p className="kc-course-guarantee__text">{guarantee.text}</p>
      </div>
    </section>
  )
}
