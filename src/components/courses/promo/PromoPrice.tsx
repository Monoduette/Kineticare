import { formatPriceHuf } from '../../../lib/format-price'

/**
 * PromoPrice — az akciós ár-sor (eredeti ár áthúzva + akciós ár).
 *
 * Az áthúzás önmagában NEM közvetít jelentést a képernyőolvasónak: a `<s>`
 * elemet a legtöbb felolvasó nem jelenti be, ezért a két összeg elé
 * vizuálisan rejtett címke kerül („Eredeti ár:", „Akciós ár:") — WCAG 2.2
 * SC 1.3.1 Info and Relationships
 * (https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html)
 * és a WAI „strikethrough" tanácsa a `<s>` elemről (a jelentést szöveg
 * hordozza, nem a stílus). Az áthúzott ár csak akkor jelenik meg, ha a
 * `course-promo.ts` szerint valóban NAGYOBB a tényleges árnál (Baymard,
 * Product Page: az „eredeti ár" csak valódi, korábbi ár lehet,
 * https://baymard.com/blog/list-price-discount-display).
 * A számok tabuláris számjegyekkel állnak, hogy a két összeg egy vonalban
 * olvasható legyen (Material 3 Typography, tabular figures az árakhoz:
 * https://m3.material.io/styles/typography/applying-type).
 */
export interface PromoPriceProps {
  priceHuf: number
  originalPriceHuf: number | null
  /** A díj-megjegyzés (a vásárlódoboz szövegével azonosan) — a záró sávban elhagyható. */
  note?: string | null
  className?: string
}

export function PromoPrice({ priceHuf, originalPriceHuf, note = null, className }: PromoPriceProps) {
  const classes = ['kc-promo-price', className ?? ''].filter(Boolean).join(' ')
  return (
    <p className={classes}>
      {originalPriceHuf !== null ? (
        <span className="kc-promo-price__old">
          <span className="kc-visually-hidden">Eredeti ár: </span>
          <s>{formatPriceHuf(originalPriceHuf)}</s>
        </span>
      ) : null}
      <span className="kc-promo-price__now">
        <span className="kc-visually-hidden">Akciós ár: </span>
        {formatPriceHuf(priceHuf)}
      </span>
      {note ? <span className="kc-promo-price__note">{note}</span> : null}
    </p>
  )
}
