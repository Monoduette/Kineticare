import type { CSSProperties, ReactNode } from 'react'

import type { Product } from '../../payload-types'
import { Badge } from '../ui/Badge'
import { PriceTag } from '../ui/PriceTag'
import { CourseCta } from './CourseCta'

/**
 * CourseBuybox — a kurzusoldal vásárlódoboza (a lap egyetlen elsődleges célja).
 */
export interface CourseBuyboxProps {
  id: string
  /**
   * A CTA-blokk horgonya — a ragadós vásárlósáv (CourseBuyBar) EZT figyeli.
   * A doboz `id`-je erre nem elég: a doboz TETEJE látszhat úgy is, hogy a
   * gomb már a belső görgetésen kívül van (mérve 1280×720-on).
   */
  ctaId: string
  title: string
  lead: string | null
  categoryLabel: string | null
  audienceLabel: string
  /** A courses.ts coursePriceBadgeKind döntése — az árlogika KANONIKUS forrása. */
  priceBadge: 'price' | 'free' | 'none'
  priceHuf: number | null
  highlights: string[]
  guaranteeLabel: string | null
  /** Másodlagos, alacsonyabb súlyú horgony (pl. „Kinek való?"). */
  secondaryHref: string | null
  secondaryLabel: string | null
  /**
   * A `priceInHUF` KÖTELEZŐ: a CourseCta állapotgépe az ÉRVÉNYES árat kérdezi
   * (nem csak az ár-pipát), különben a hiányosan konfigurált termék olyan
   * vásárlást kínálna, amit a checkout 400-zal elutasít.
   */
  product: Pick<Product, 'id' | 'slug' | 'status' | 'priceInHUF' | 'priceInHUFEnabled'>
  hasPurchased: boolean
  /**
 * A CTA HELYÉRE kerülő egyedi tartalom. Megadva a `CourseCta` állapotgép
 * helyett ez renderelődik, ugyanazon a helyen és ugyanabban a sorrendben
 * (ár → cselekvés → előnyök), tehát a kutatás szerinti felépítés nem sérül.
 * MA EGY HÍVÓJA VAN: az INGYENES kurzus igénylő űrlapja
 * (`FreeCourseRequestForm`). Ott a cselekvés nem link, hanem beküldés (név +
 * e-mail → hozzáférés + belépő link), amit egy `href`-alapú gomb nem tud
 */
  ctaSlot?: ReactNode
}

export function CourseBuybox({
  id,
  ctaId,
  title,
  lead,
  categoryLabel,
  audienceLabel,
  priceBadge,
  priceHuf,
  highlights,
  guaranteeLabel,
  secondaryHref,
  secondaryLabel,
  product,
  hasPurchased,
  ctaSlot,
}: CourseBuyboxProps) {
  return (
    <div className="kc-card kc-card--padded kc-course-buybox" id={id}>
      <p className="kc-course-buybox__meta">
        {categoryLabel ? <Badge tone="info">{categoryLabel}</Badge> : null}
        <Badge tone="neutral">{audienceLabel}</Badge>
      </p>
      <h1 className="kc-course-buybox__title">{title}</h1>
      {lead ? <p className="kc-course-buybox__lead">{lead}</p> : null}

      {priceBadge === 'price' && priceHuf !== null ? (
        <p className="kc-course-buybox__price">
          <PriceTag label="Ár:" priceHuf={priceHuf} />
          <span className="kc-course-buybox__price-note">egyszeri díj, további költség nincs</span>
        </p>
      ) : priceBadge === 'free' ? (
        <p className="kc-course-buybox__price kc-course-buybox__price--free">Ingyenes</p>
      ) : null}

      {ctaSlot ?? <CourseCta hasPurchased={hasPurchased} id={ctaId} product={product} />}

      {highlights.length > 0 ? (
        <ul className="kc-course-checklist" role="list">
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
      ) : null}

      {secondaryHref && secondaryLabel ? (
        <p className="kc-course-buybox__secondary">
          <a className="kc-course-textlink" href={secondaryHref}>
            {secondaryLabel}
          </a>
        </p>
      ) : null}

      {guaranteeLabel ? (
        <p className="kc-course-buybox__trust">
          <span aria-hidden="true" className="kc-course-buybox__trust-mark">
            ●
          </span>
          {guaranteeLabel}
        </p>
      ) : null}
    </div>
  )
}
