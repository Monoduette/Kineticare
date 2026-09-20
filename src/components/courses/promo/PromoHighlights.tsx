import type { CSSProperties } from 'react'

import { Container } from '../../ui/Container'
import { Section } from '../../ui/Section'

/**
 * PromoHighlights — a fő előnyök pipás sávja a hero alatt, tint háttéren.
 *
 * A rendes kurzusoldalon ugyanez a lista a vásárlódobozban áll; az akciós
 * sablonon nincs doboz, ezért a lista saját, teljes szélességű sávot kap
 * közvetlenül a hero után: a NN/g szerint a látogató az első képernyő után
 * a „mit kapok" választ keresi, és a pipás lista az egy pillantással
 * átfutható forma (NN/g, How Users Read on the Web: F-minta, lista, tömör
 * sorok, https://www.nngroup.com/articles/how-users-read-on-the-web/ ).
 * 900 px felett két oszlop, alatta egy (WCAG 2.2 SC 1.4.10 Reflow). A cím
 * vizuálisan rejtett: a szakasz a képernyőolvasó szakasz-listájában így is
 * nevet kap (SC 2.4.6 Headings and Labels), a látó olvasónak viszont a pipák
 * önmagukban beszélnek, a felesleges címsor csak távolítaná a herótól.
 */
export interface PromoHighlightsProps {
  highlights: string[]
}

export const PROMO_HIGHLIGHTS_ID = 'elonyok'

export function PromoHighlights({ highlights }: PromoHighlightsProps) {
  if (highlights.length === 0) {
    return null
  }
  return (
    <Section
      aria-labelledby={`${PROMO_HIGHLIGHTS_ID}-cim`}
      className="kc-promo-highlights"
      id={PROMO_HIGHLIGHTS_ID}
      variant="tint"
    >
      <Container>
        <h2 className="kc-visually-hidden" id={`${PROMO_HIGHLIGHTS_ID}-cim`}>
          A kurzus fő előnyei
        </h2>
        <ul className="kc-course-checklist kc-promo-highlights__list" role="list">
          {highlights.map((item, index) => (
            <li
              className="kc-course-checklist__item"
              key={`${index}-${item}`}
              style={{ '--kc-course-stagger': index } as CSSProperties}
            >
              <span aria-hidden="true" className="kc-course-checklist__mark">
                ✓
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  )
}
