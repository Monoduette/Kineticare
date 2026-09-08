import type { MouseEvent } from 'react'

import type { Category } from '../../payload-types'
import { categoryPath } from './post-list'

/**
 * CategoryFilter — a Tudástár kategória-szűrőjének chipsora.
 *
 * MIÉRT LINK, ÉS NEM `aria-pressed` GOMB VAGY TAB (vezetői kérdés, WP35).
 *  - A chip a lap CÍMÉT váltja (`/blog` ↔ `/blog/kategoria/<slug>`): ami
 *    navigál, az link (termektervezés-skill 4. pont; jobbklikk, új lap,
 *    Ctrl+kattintás elvárt módon működik). JS nélkül és a keresőrobotnak
 *    ugyanez a `<a href>` a működő, bejárható út (progresszív ráépítés).
 *  - Az `aria-pressed` a linken NEM megengedett attribútum (ARIA in HTML,
 *    „a element with href”: csak a globális és a megengedett szerepek
 *    attribútumai, https://www.w3.org/TR/html-aria/#el-a); a jelenlegi
 *    állapotot linken az `aria-current="page"` viszi (globális attribútum,
 *    WAI-ARIA 1.2, https://www.w3.org/TR/wai-aria-1.2/#aria-current).
 *  - A tab-minta (WAI-ARIA APG Tabs, https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
 *    roving tabindexet, nyílbillentyűs mozgást és `tabpanel`-t ír elő, és
 *    elrejti, hogy a cím is változik; a Tudástár egyetlen, egyszerű
 *    egyválasztós szűrője ennél kevesebb szerkezetet igényel (NN/g,
 *    *Filters vs. Facets*: az egyszerű szűrő egy szempont szerinti szűkítés,
 *    https://www.nngroup.com/articles/filters-vs-facets/).
 *
 * A kattintást a szülő (`PostListFilter`) fogja el: kliens-oldalon azonnal
 * szűr és `history.pushState`-tel írja a címet, teljes navigáció nélkül.
 * Ez a komponens maga állapotmentes; szerveren és kliensen egyaránt fut.
 */
export interface CategoryFilterProps {
  categories: Pick<Category, 'id' | 'title' | 'slug'>[]
  /** Az aktív kategória slugja (lista-oldalon undefined). */
  activeSlug?: string
  /**
   * Kliens-oldali választás. Ha a szülő megadja, a link alap-navigációja
   * elmarad (`preventDefault`), kivéve a módosítós kattintást (Ctrl/Cmd/
   * Shift/középső gomb): az új lapon nyitást a böngészőre hagyjuk.
   */
  onSelect?: (slug: string | undefined, event: MouseEvent<HTMLAnchorElement>) => void
}

function isModifiedClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0
}

export function CategoryFilter({ categories, activeSlug, onSelect }: CategoryFilterProps) {
  if (categories.length === 0) {
    return null
  }
  // Az „Összes” felirat literálként áll a linkben, hogy a G-UI2 felirat-őr
  // (cta-a-termekben) lássa; a kategória-címke a CMS-ből jön.
  const chip = (slug: string | undefined, label?: string) => {
    const active = slug === activeSlug
    return (
      <a
        aria-current={active ? 'page' : undefined}
        className={`kc-category-filter__chip${active ? ' kc-category-filter__chip--active' : ''}`}
        href={categoryPath(slug)}
        onClick={
          onSelect
            ? (event) => {
                if (isModifiedClick(event)) return
                event.preventDefault()
                onSelect(slug, event)
              }
            : undefined
        }
      >
        {slug === undefined ? 'Összes' : label}
      </a>
    )
  }
  return (
    <nav aria-label="Kategória-szűrő" className="kc-category-filter">
      <ul className="kc-category-filter__list">
        <li>{chip(undefined)}</li>
        {categories.map((category) =>
          typeof category.slug === 'string' && category.slug.length > 0 ? (
            <li key={category.id}>{chip(category.slug, category.title)}</li>
          ) : null,
        )}
      </ul>
    </nav>
  )
}
