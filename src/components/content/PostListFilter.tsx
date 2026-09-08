'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import type { Category } from '../../payload-types'
import { CategoryFilter } from './CategoryFilter'
import { categoryPath, categorySlugFromPath, filterStatusText, findCategory } from './post-list'

/**
 * PostListFilter — a Tudástár AZONNALI, kliens-oldali kategória-szűrője.
 *
 * MIÉRT ÍGY (tulajdonosi kérés, 2026-09-08: a chipek maradjanak, csak az
 * aktív legyen kiemelve, és „egyből tudnék másikra kattintva váltani”).
 *  - Azonnali (interaktív) szűrés: az NN/g szerint a felfedező szándékú
 *    felhasználónak az azonnal frissülő eredmény való, a kötegelt „Alkalmaz”
 *    gomb csak sok szempontnál és lassú lapbetöltésnél éri meg
 *    (*Applying Filters: Interactive vs. Batch*,
 *    https://www.nngroup.com/articles/applying-filters/). Itt EGY szempont
 *    van, és lapbetöltés nincs: a lista már a kliensen van, a váltás nem
 *    hálózati kör. A GOV.UK Design System *Filter a list* mintája ugyanígy
 *    engedi a kattintásra frissülő szűrést, ha az eredmény gyorsan jön
 *    (https://design-system.service.gov.uk/patterns/filter-a-list/).
 *  - A kártyák a SZERVERRŐL jönnek kész React-csomópontként (`items[].card`):
 *    a PostCard szerver-komponens marad, a kliens csak választ közülük. A SSR
 *    HTML így a szűrt listát tartalmazza (a kereső a kategória-lapon csak a
 *    téma cikkeit látja), a többi kártya az RSC-csomagban utazik.
 *  - A cím a `window.history` API-val vált (`pushState`), Next-navigáció
 *    nélkül: a Next 14.1+ App Router a natív `pushState`-et integrálja
 *    (https://nextjs.org/docs/app/building-your-application/routing/linking-and-navigating#using-the-native-history-api),
 *    a Vissza gombot a `popstate` kezeli. A cím megosztható marad, és a
 *    kategória-URL-ek SEO-értéke (canonical, sitemap, JSON-LD) nem változik.
 *  - Állapotsor `role="status"`-szal: WCAG 2.2 SC 4.1.3 (a találatszám
 *    fókuszváltás nélkül hangzik el). A fókusz a kattintott chipen marad
 *    (SC 2.4.3 Focus Order: nem ugrik el, nem vész el).
 */
export interface PostListFilterItem {
  key: string | number
  categoryIds: readonly number[]
  card: ReactNode
}

export interface PostListFilterProps {
  categories: Pick<Category, 'id' | 'title' | 'slug'>[]
  /** A SSR-rel kirajzolt kezdő szűrő (undefined = Összes). */
  initialSlug?: string
  items: readonly PostListFilterItem[]
  /** A szűrt nézet üres állapota (PostsEmptyState, `kategoria` változat). */
  emptyState: ReactNode
  /** Kirajzolja-e a chipsort (a lista-lap küszöbe dönt; kategória-lapon mindig). */
  showFilter: boolean
  /**
   * A felvezető mondat a H1 alatt. A kategóriának a CMS-ben nincs saját
   * leírás-mezője (`Category`: title, slug, type, parent), ezért a témalapon
   * is a közös Tudástár-felvezető áll (vezetői döntés, WP35).
   */
  lead: string
}

/** A böngésző-lap címe a szűrőhöz, a keret „ | Kineticare” toldalékával. */
function documentTitleFor(categoryTitle: string | null): string {
  const current = typeof document === 'undefined' ? '' : document.title
  const suffixAt = current.lastIndexOf(' | ')
  const suffix = suffixAt >= 0 ? current.slice(suffixAt) : ''
  return `${categoryTitle === null ? 'Tudástár' : `${categoryTitle} a Tudástárban`}${suffix}`
}

export function PostListFilter({
  categories,
  initialSlug,
  items,
  emptyState,
  showFilter,
  lead,
}: PostListFilterProps) {
  const [activeSlug, setActiveSlug] = useState<string | undefined>(initialSlug)
  const active = findCategory(categories, activeSlug)

  const visible = useMemo(
    () => (active === null ? items : items.filter((item) => item.categoryIds.includes(active.id))),
    [active, items],
  )

  const select = useCallback(
    (slug: string | undefined) => {
      setActiveSlug(slug)
      if (typeof window === 'undefined') return
      const path = categoryPath(slug)
      if (window.location.pathname !== path || window.location.search.length > 0) {
        window.history.pushState(null, '', path)
      }
      document.title = documentTitleFor(findCategory(categories, slug)?.title ?? null)
    },
    [categories],
  )

  useEffect(() => {
    const onPopState = () => {
      const slug = categorySlugFromPath(window.location.pathname)
      if (slug === null) return
      setActiveSlug(slug)
      document.title = documentTitleFor(findCategory(categories, slug)?.title ?? null)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [categories])

  return (
    <>
      {/* A H1 a szűrővel EGYÜTT vált (vezetői döntés, WP35): a /blog-on és
          „Összes” állapotban „Tudástár”, témalapon és chip-váltás után a téma
          neve, a `<title>`-lel összhangban (Google, *Influencing your title
          links*: a címsor és a cím egyezzen,
          https://developers.google.com/search/docs/appearance/title-link;
          `docs/seo-geo-llm.md` kulcsszó-célzás). Így a SSR-lap és a
          kattintással elért állapot azonos DOM-ot ad. A címsor `key`-e a
          szöveg, tehát a képernyőolvasó nem kap külön bejelentést: a váltást a
          `role="status"` sor mondja el (SC 4.1.3). */}
      <div className="kc-tudastar-intro">
        <h1 className="kc-page-hero__title">{active === null ? 'Tudástár' : active.title}</h1>
        <p className="kc-page-hero__lead">{lead}</p>
      </div>
      {showFilter ? (
        <CategoryFilter activeSlug={activeSlug} categories={categories} onSelect={select} />
      ) : null}
      {/* Látható állapotsor: a sighted olvasó és a képernyőolvasó ugyanazt a
          mondatot kapja (SC 4.1.3). A SSR-tartalom nem hangzik el, csak a
          váltás utáni frissítés. */}
      <p className="kc-post-list__status" role="status">
        {filterStatusText(visible.length, active?.title ?? null)}
      </p>
      {visible.length === 0 ? (
        emptyState
      ) : (
        /* A `key` a szűrő váltásakor újraépíti a rácsot, így a közös
           `kc-fade-up` belépő (styles/motion.css) egyszer lefut: rövid
           keresztúsztatás a tokenből, `prefers-reduced-motion` alatt semmi
           (WCAG 2.2 SC 2.3.3). */
        <div className="kc-card-grid kc-card-grid--posts kc-post-list__grid" key={activeSlug ?? ''}>
          {visible.map((item) => (
            <div className="kc-post-list__item" key={item.key}>
              {item.card}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
