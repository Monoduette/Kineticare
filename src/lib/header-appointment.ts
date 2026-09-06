import type { NavItem } from './menu-tree'

/**
 * Fejléc Időpontkérés — menüpont ÉS másodlagos gomb, ugyanazzal a céllal.
 *
 * A felirat főnév (N-3), nem a §3.2 #24 igei CTA (`Kérj időpontot üzenetben`).
 * A cél a kapcsolat-oldal callback-űrlapja, nem naptáras foglaló
 * (`/kapcsolat#idopontkeres`). A két megjelenés SZÁNDÉKOSAN azonos nevű:
 * WCAG 2.2 SC 3.2.4 ugyanazt a funkciót ugyanazon a néven kéri.
 *
 * A CMS-menübe NEM írunk: a seed meglévő sort sosem ír felül, az élő menü
 * szerkesztői. A fejléc a fát kód-szinten egészíti ki, mint a Kurzusok gomb.
 *
 * Források:
 * - NN/g, Utility Navigation — a tartós művelet a jobb felső sarokban él.
 *   https://www.nngroup.com/articles/utility-navigation/
 * - NN/g, The Same Link Twice — ismétlés megengedett, ha a két hely más
 *   szerepet visz (menüsor vs. állandó gomb).
 *   https://www.nngroup.com/articles/duplicate-links/
 * - GOV.UK Design System, Button — egy oldalon egy elsődleges gomb; a
 *   másodlagos cselekvés secondary.
 *   https://design-system.service.gov.uk/components/button/
 * - W3C, Understanding SC 3.2.4 Consistent Identification.
 *   https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html
 * - W3C, Understanding SC 1.4.10 Reflow — 320 CSS-pxen nincs vízszintes görgetés.
 *   https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
 */

export const HEADER_APPOINTMENT_LABEL = 'Időpontkérés'

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

function navListHasAppointment(items: readonly NavItem[]): boolean {
  for (const item of items) {
    if (item.label === HEADER_APPOINTMENT_LABEL) return true
    if (item.href === HEADER_APPOINTMENT_HREF) return true
    if (item.children.length > 0 && navListHasAppointment(item.children)) return true
  }
  return false
}

/**
 * A főmenü listájához fűzi az Időpontkérés pontot, ha a CMS-fa még nem hozza.
 * Üres fa (lekérdezési hiba) érintetlen marad: a sáv- és fiók-gomb ettől még él.
 */
export function withHeaderAppointmentNav(items: readonly NavItem[]): NavItem[] {
  if (items.length === 0) return []
  if (navListHasAppointment(items)) return [...items]
  return [...items, HEADER_APPOINTMENT_NAV_ITEM]
}
