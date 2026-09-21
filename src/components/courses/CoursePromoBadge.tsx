import { isCoursePromoDisplayed, type CoursePromoDisplayFields } from '../../lib/course-promo'

/**
 * CoursePromoBadge: „Akció” címke a kurzuskártyákon (WP60, 2026-09-20).
 *
 * Egyetlen helyen dől el, hogy a kártya kap-e címkét: `isCoursePromoDisplayed`
 * (src/lib/course-promo.ts), ugyanaz a szabály, mint a kurzusoldalé és az
 * admin állapotjelzőé (WCAG 2.2 SC 3.2.4 Consistent Identification). Nem él
 * az akció: a komponens NEM renderel semmit, nincs üres doboz.
 *
 * MIT MOND, MIT NEM. A címke csak azt jelzi, hogy a kurzus MOST akciós; a
 * határidőt („szeptember 30-ig”) a kártya szándékosan NEM viszi, az a
 * kurzusoldal dolga (PromoPrice). NN/g, Indicators, Validations, and
 * Notifications: az indikátor passzív, a tárgya MELLETT áll, és csak akkor
 * jelenik meg, ha a feltétel teljesül; túlhasználva zsúfolttá teszi a
 * felületet (https://www.nngroup.com/articles/indicators-validations-notifications/).
 * GOV.UK Design System, Tag: a címke egy dolog állapotát mondja meg, rövid,
 * és a jelentést nem csak a szín hordozza
 * (https://design-system.service.gov.uk/components/tag/).
 *
 * KÉPERNYŐOLVASÓ. A látható szó „Akció”; a felolvasott név „Akciós kurzus”
 * (a látható szöveg a név ELEJE, WCAG 2.2 SC 2.5.3 Label in Name). A kártyák
 * egy része `aria-label`-es linkbe zárja a tartalmat (a link neve elfedi a
 * belső szöveget), ezért a hívó a `promoAccessibleName`-et a link nevébe is
 * beteszi; a címke maga ilyenkor `aria-hidden`, hogy ne hangozzon el kétszer.
 *
 * SZÍN. Nem csak szín hordozza a jelentést (SC 1.4.1 Use of Color: „all
 * sighted users can access information that is conveyed by color
 * differences”, https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html):
 * a szöveg maga a jelzés. A színpár számolt (ui.css `.kc-promo-badge`).
 */

/** A címke látható szava. */
export const PROMO_BADGE_LABEL = 'Akció'

/** A címke képernyőolvasónak szóló, teljes neve. */
export const PROMO_BADGE_ACCESSIBLE_NAME = 'Akciós kurzus'

export interface CoursePromoBadgeProps {
  product: CoursePromoDisplayFields
  /** Csak teszthez: a „most” pillanat. */
  now?: Date
  /**
   * `true`, ha a hívó a nevet már a befoglaló link `aria-label`-jébe tette:
   * ilyenkor a címke dekoratív (aria-hidden), a látható szó marad.
   */
  nameInLink?: boolean
  className?: string
}

/**
 * Az `aria-label`-es kártya-linkek nevének előtagja: „Akciós kurzus: ” ha az
 * akció él, különben üres. A hívó a saját nevét fűzi utána.
 */
export function promoAccessibleNamePrefix(product: CoursePromoDisplayFields, now?: Date): string {
  return isCoursePromoDisplayed(product, now) ? `${PROMO_BADGE_ACCESSIBLE_NAME}: ` : ''
}

export function CoursePromoBadge({
  product,
  now,
  nameInLink = false,
  className,
}: CoursePromoBadgeProps) {
  if (!isCoursePromoDisplayed(product, now)) {
    return null
  }
  const classes = ['kc-promo-badge', className ?? ''].filter(Boolean).join(' ')
  if (nameInLink) {
    return (
      <span aria-hidden="true" className={classes}>
        {PROMO_BADGE_LABEL}
      </span>
    )
  }
  return (
    <span className={classes}>
      <span aria-hidden="true">{PROMO_BADGE_LABEL}</span>
      <span className="kc-visually-hidden">{PROMO_BADGE_ACCESSIBLE_NAME}</span>
    </span>
  )
}
