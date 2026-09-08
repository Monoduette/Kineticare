import type { Menu, Page, Post, Product } from '../payload-types'

import { COURSE_BASE_PATH, courseHref } from './course-url'
import { extractRelationshipId } from './menu-validation'
import { sanitizeCmsUrl } from './safe-url'
import { isStorefrontFreeSos } from './sos-offer'
import { SOS_FREE_MENU_LABEL, SOS_MENU_LABEL } from './sos-offer-copy'

/**
 * Menüfa → NavItem fa (tiszta logika). Csak visible + published cél; max 2 szint
 * (mélyebb lánc → legközelebbi gyökér). Kiesett szülő → gyerek gyökérré emelődik.
 * Rendezés: order, majd label (hu). Külső URL: safe-url allowlist.
 */

export interface NavItem {
  id: number
  label: string
  href: string
  openInNewTab: boolean
  /** Igaz, ha a href külső (http/https) hivatkozás — a UI ilyenkor target/rel-t és jelölést ad. */
  isExternal: boolean
  children: NavItem[]
}

/**
 * A „Kurzusok" főmenüpont — KÓDBAN rögzítve, a CMS-menütől függetlenül.
 *
 * WP36 (2026-09-08, tulajdonosi kérés, szó szerint: „a kurzusok mint gomb ami
 * itt van a főmenüben az pedig legyen egy sima egyszerű menüpont hasonló mint
 * a Tudástár vagy mint a kapcsolat nem kell hogy ilyen kiemelt legyen").
 * Korábban a fejléc jobb oldalán kitöltött pirula volt (`HeaderCoursesNav`);
 * most a főmenü ELSŐ tétele, ugyanazzal a linknyelvvel és aktív-jelöléssel,
 * mint a CMS-menüpontok (DesktopNav / MobileNav, `NavAnchor`).
 *
 * MIÉRT AZ ELSŐ HELY (nem az utolsó):
 * - NN/g, Menu-Design Checklist: a leggyakoribb / legfontosabb tételek a
 *   menüt indító célhoz közel (Fitts-törvény), és a lista elejét olvassák a
 *   legnagyobb eséllyel: https://www.nngroup.com/articles/menu-design/
 * - docs/ertekesitesi-ux-skill.md §3: a „Kurzusok" menüpont KÖTELEZŐ, mert az
 *   értékesítés fő útja; a repó saját seed-terve (src/scripts/seed.ts) is a
 *   Kezdőlap utáni első helyre (order 1) teszi, a Tudástár és a többi elé.
 * - WCAG 2.2 SC 3.2.3 Consistent Navigation: a sorrend minden oldalon és
 *   mindkét nézetben (asztali sor, mobil fiók) ugyanaz:
 *   https://www.w3.org/WAI/WCAG22/Understanding/consistent-navigation.html
 * Az `id: 0` nem ütközik a Payload 1-től induló azonosítóival.
 */
export const COURSES_NAV_ITEM: NavItem = {
  id: 0,
  label: 'Kurzusok',
  href: COURSE_BASE_PATH,
  openInNewTab: false,
  isExternal: false,
  children: [],
}

/**
 * A CMS-menüfa elé illeszti a „Kurzusok" tételt. Ha a szerkesztő már felvett
 * egy `/kurzusok` célú gyökér-menüpontot, NEM duplázunk: a CMS-tétel marad a
 * saját helyén (NN/g: ugyanarra a célra ne álljon két menüelem).
 */
export function withCoursesNavItem(items: NavItem[]): NavItem[] {
  const alreadyListed = items.some((item) => item.href === COURSES_NAV_ITEM.href)
  return alreadyListed ? items : [COURSES_NAV_ITEM, ...items]
}

/** A menü-célok URL-konvenciója (a storefront route-jai ezekre épülnek). */
export const MENU_HREF_PREFIX = {
  page: '',
  post: '/blog',
  // A kurzus-útvonalat a courseHref építi (slug vagy id) — a gyökér itt is a
  // közös konstansból jön, hogy egy helyen legyen definiálva.
  product: COURSE_BASE_PATH,
} as const

function resolveRef(menu: Menu): { relationTo: string; value: unknown } | null {
  const ref = menu.ref
  if (!ref || typeof ref !== 'object' || !('relationTo' in ref)) {
    return null
  }
  const relationTo = (ref as { relationTo?: unknown }).relationTo
  const value = (ref as { value?: unknown }).value
  if (typeof relationTo !== 'string' || typeof value !== 'object' || value === null) {
    // Nem populate-olt vagy hiányzó ref — a frontend nem tud státuszt/slugot ellenőrizni.
    return null
  }
  return { relationTo, value }
}

/** Published-ellenőrzés a cél-dokumentumon (collectionönként egyező szabály: saját status select). */
function isPublishedTarget(doc: Page | Post | Product): boolean {
  return doc.status === 'published'
}

/**
 * Egy menüpont href-feloldása; null, ha a cél nem publikált/feloldhatatlan.
 */
export function resolveMenuHref(menu: Menu): string | null {
  if (menu.type === 'url') {
    // A „Külső link" típusú menüpont webcíme szabadon gépelhető CMS-tartalom,
    // ezért allowlist-szűrésen megy át (src/lib/safe-url.ts). A `null` itt a
    // MEGLÉVŐ jelentést kapja — „a cél nem feloldható" —, tehát a menüpont
    // ugyanúgy kimarad a navigációból, mint egy nem publikált oldalra mutató
    // hivatkozás. Ez a menük EGYETLEN href-forrása: a NavItem.href-et csak a
    // `buildNavTree` állítja elő, tehát a fejléc és a mobil menü is fedve van.
    return sanitizeCmsUrl(menu.url)
  }

  const ref = resolveRef(menu)
  if (!ref) {
    return null
  }

  switch (ref.relationTo) {
    case 'pages': {
      const doc = ref.value as Page
      if (!isPublishedTarget(doc)) return null
      return doc.slug ? `${MENU_HREF_PREFIX.page}/${doc.slug}` : null
    }
    case 'posts': {
      const doc = ref.value as Post
      if (!isPublishedTarget(doc)) return null
      return doc.slug ? `${MENU_HREF_PREFIX.post}/${doc.slug}` : null
    }
    case 'products': {
      const doc = ref.value as Product
      if (!isPublishedTarget(doc)) return null
      // A kurzus kanonikus címe: slug, ennek hiányában a régi, id-alapú út
      // (a kurzus-route ezt átirányítja) — src/lib/course-url.ts.
      return courseHref(doc)
    }
    default:
      return null
  }
}

function toNavItem(menu: Menu, href: string): NavItem {
  let label = menu.label
  if (menu.type === 'product' && (label === SOS_MENU_LABEL || label === SOS_FREE_MENU_LABEL)) {
    const ref = resolveRef(menu)
    const product = ref?.relationTo === 'products' ? (ref.value as Product) : null
    if (product?.slug === 'sos-kezrelax-villamkurzus') {
      // A kurzusoldal a saját `status` + isFreeCourse kaput nézi; a nav ugyanazt.
      // A drafts `_status` a kezdőlap/GYIK szigorúbb kapuja marad (P03 HOLD).
      // Forrás: WCAG 2.2 SC 3.2.4
      // (https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html);
      // NN/g 4. heurisztika (https://www.nngroup.com/articles/consistency-and-standards/).
      label = isStorefrontFreeSos(product) ? SOS_FREE_MENU_LABEL : SOS_MENU_LABEL
    }
  }
  return {
    id: menu.id,
    label,
    href,
    openInNewTab: menu.openInNewTab === true,
    isExternal: /^https?:\/\//i.test(href),
    children: [],
  }
}

/**
 * A menus-sorokból maximum 2 szintű navigációs fa. A bemenet sorrendje
 * közömbös; a gyökerek és a children listák is rendezettek.
 */
export function buildNavTree(menus: Menu[]): NavItem[] {
  const visible = menus.filter((menu) => menu.visible !== false)
  const byId = new Map<number, Menu>(visible.map((menu) => [menu.id, menu]))
  const orderById = new Map<number, number>(
    visible.map((menu) => [menu.id, typeof menu.order === 'number' ? menu.order : 0]),
  )
  const hrefById = new Map<number, string>()
  for (const menu of visible) {
    const href = resolveMenuHref(menu)
    if (href !== null) {
      hrefById.set(menu.id, href)
    }
  }

  const parentIdOf = (menu: Menu): number | null => {
    const id = extractRelationshipId(menu.parent)
    return typeof id === 'number' ? id : null
  }

  /**
   * A legközelebbi renderelhető gyökér-ős feloldása a parent-láncban.
   * Visszatérés: a gyökér-ős id-je; az elem saját id-je, ha gyökérként kell
   * renderelni (nincs szülő, vagy a szülő-lánc kiesett); null ciklus esetén.
   */
  const rootAncestorIdOf = (menu: Menu): number | null => {
    const visited = new Set<number>([menu.id])
    let current = menu
    for (let depth = 0; depth < 8; depth += 1) {
      const parentId = parentIdOf(current)
      if (parentId === null) {
        return current.id
      }
      if (visited.has(parentId)) {
        return null // ciklus — a backend amúgy sem engedi, itt eldobjuk
      }
      visited.add(parentId)
      const parent = byId.get(parentId)
      if (!parent || !hrefById.has(parentId)) {
        // A szülő kiesett (nem látható / nem published / hiányzó): a current
        // elem emelkedik gyökér-szintre.
        return current.id
      }
      current = parent
    }
    return null
  }

  const items: NavItem[] = []
  const itemById = new Map<number, NavItem>()

  // 1. menet: explicit gyökerek (parent nélküli, renderelhető elemek).
  for (const menu of visible) {
    const href = hrefById.get(menu.id)
    if (href && parentIdOf(menu) === null) {
      const item = toNavItem(menu, href)
      items.push(item)
      itemById.set(menu.id, item)
    }
  }

  // 2. menet: minden más elem a legközelebbi renderelhető gyökér-őse alá;
  //    kiesett szülő-lánc esetén gyökér-szintre emelve.
  for (const menu of visible) {
    const href = hrefById.get(menu.id)
    if (!href || parentIdOf(menu) === null) {
      continue
    }
    const ancestorId = rootAncestorIdOf(menu)
    if (ancestorId === null) {
      continue
    }
    const item = toNavItem(menu, href)
    if (ancestorId === menu.id) {
      items.push(item)
      itemById.set(menu.id, item)
      continue
    }
    const root = itemById.get(ancestorId)
    if (!root) {
      // Biztonsági fallback: az ős nem regisztrált gyökér — gyökérként rendereljük.
      items.push(item)
      itemById.set(menu.id, item)
      continue
    }
    root.children.push(item)
    itemById.set(menu.id, item)
  }

  const byOrderThenLabel = (a: NavItem, b: NavItem): number => {
    const diff = (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0)
    // Az ajánlat változása nem rendezheti át az azonos sorszámú menüpontokat.
    return diff !== 0
      ? diff
      : (byId.get(a.id)?.label ?? a.label).localeCompare(byId.get(b.id)?.label ?? b.label, 'hu')
  }

  items.sort(byOrderThenLabel)
  for (const item of items) {
    item.children.sort(byOrderThenLabel)
  }

  return items
}
