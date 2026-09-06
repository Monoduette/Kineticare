import type { NavItem } from './menu-tree'

/**
 * Fejléc Időpontfoglalás — másodlagos sáv-gomb, NEM menüpont.
 *
 * A főmenü a CMS-fáé (production `main`): Szolgáltatások, Rólunk, Tudástár,
 * Kapcsolat. A Kurzusok pirula külön komponens (N-21). Ez a lock CSAK a
 * körvonalas gombot adja, a nav-fába nem ír.
 *
 * A felirat főnév (N-3), mint a „Kurzusok”: nem a §3.2 #24 igei CTA
 * (`Kérj időpontot üzenetben`). A cél a kapcsolat-oldal callback-űrlapja
 * (`/kapcsolat#idopontkeres`), nem naptáras foglaló.
 *
 * Kompakt sávon (75em alatt) a gomb a fiók ALJÁN él, nem a listában —
 * a 320px-es sávot a wordmark + Kurzusok + hamburger tölti ki (WCAG 1.4.10).
 *
 * Források:
 * - GOV.UK Design System, Button — egy oldalon egy elsődleges gomb
 *   (Kurzusok); a másodlagos cselekvés secondary / outline.
 *   https://design-system.service.gov.uk/components/button/
 * - NN/g, Utility Navigation — a tartós művelet a jobb felső sarokban él.
 *   https://www.nngroup.com/articles/utility-navigation/
 * - W3C, Understanding SC 3.2.4 Consistent Identification.
 *   https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html
 * - W3C, Understanding SC 1.4.10 Reflow — 320 CSS-pxen nincs vízszintes görgetés.
 *   https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
 * - W3C, Understanding SC 2.5.8 Target Size (Minimum) — 24×24, projekt 44×44.
 *   https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
 */

export const HEADER_APPOINTMENT_LABEL = 'Időpontfoglalás'

export const HEADER_APPOINTMENT_HREF = '/kapcsolat#idopontkeres'

/** Negatív id: a Payload menü-sorok pozitívak; a Kurzusok gomb a 0-t viszi. */
export const HEADER_APPOINTMENT_NAV_ID = -17

export const HEADER_APPOINTMENT_NAV_ITEM: NavItem = {
  id: HEADER_APPOINTMENT_NAV_ID,
  label: HEADER_APPOINTMENT_LABEL,
  href: HEADER_APPOINTMENT_HREF,
  openInNewTab: false,
  isExternal: false,
  children: [],
}
