import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'

import { buildNavTree } from '../lib/menu-tree'
import {
  CLINIC_TREATMENTS_PATH,
  KNOWLEDGE_BASE_MENU_ORDER,
  KNOWLEDGE_BASE_PATH,
  LEGACY_PROFESSIONAL_TRAINING_MENU_LABEL,
  PROFESSIONAL_TRAINING_URL,
  PROFESSIONALS_MENU_LABEL,
  PROFESSIONALS_MENU_PATH,
  SERVICES_MENU_ORDER,
  SERVICES_PAGE_PATH,
  SERVICES_PAGE_SLUG,
  SOS_COURSE_FALLBACK_PATH,
  SOS_COURSE_SKU,
  buildNavigationMenuPlan,
  ensureNavigationMenu,
  type MenuSeedNode,
} from '../lib/menu-seed'
import { SOS_FREE_MENU_LABEL, SOS_MENU_LABEL } from '../lib/sos-offer-copy'
import { validateMenuTypeConsistency } from '../lib/menu-validation'
import { sanitizeCmsUrl } from '../lib/safe-url'
import type { Menu, Page, Product } from '../payload-types'

/**
 * A fejléc-menü seedje (src/lib/menu-seed.ts).
 *
 * Két réteg:
 *  1. a TISZTA terv (`buildNavigationMenuPlan`) — struktúra, sorrend, célok;
 *  2. az IDEMPOTENCIA (`ensureNavigationMenu`) — memóriabeli, mockolt Payloaddal.
 *
 * A teszt szándékosan a MÁR MEGLÉVŐ szabályrendszerhez méri a tervet: a
 * menüpontok átmennek a collection type-konzisztencia-validációján
 * (src/lib/menu-validation.ts), az URL-ek a CMS-url szűrőn
 * (src/lib/safe-url.ts), és a fából a `buildNavTree` a várt 2 szintű
 * navigációt építi (src/lib/menu-tree.ts). Így nem elég, hogy a terv
 * „ránézésre jó" — a valódi kapukon is átjut.
 */

const findNode = (nodes: MenuSeedNode[], label: string): MenuSeedNode | undefined =>
  nodes.find((node) => node.label === label)

/** A terv minden csomópontja (gyökér + gyermek) lapítva. */
const flatten = (nodes: MenuSeedNode[]): MenuSeedNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)])

describe('buildNavigationMenuPlan — struktúra', () => {
  it('két gyökér-menüpont: Szolgáltatások (almenüvel) és Tudástár', () => {
    const plan = buildNavigationMenuPlan()

    expect(plan.map((node) => node.label)).toEqual(['Szolgáltatások', 'Tudástár'])
    expect(findNode(plan, 'Szolgáltatások')?.children.map((child) => child.label)).toEqual([
      'Rendelői kezelések',
      PROFESSIONALS_MENU_LABEL,
      SOS_FREE_MENU_LABEL,
    ])
    // A Tudástár gyökér-pont, nem almenü: az UX-skill M7 szerint másodlagos,
    // de ELÉRHETŐNEK kell lennie (eddig sehonnan nem volt az).
    expect(findNode(plan, 'Tudástár')?.url).toBe(KNOWLEDGE_BASE_PATH)
    expect(findNode(plan, 'Tudástár')?.children).toEqual([])
  })

  it('a fa legfeljebb 2 szintű (a menus-validáció felső korlátja)', () => {
    for (const root of buildNavigationMenuPlan()) {
      for (const child of root.children) {
        expect(child.children).toEqual([])
      }
    }
  })

  it('a „Kurzusok" NEM a menüfából jön (kód-szintű CTA marad a fejlécben)', () => {
    expect(flatten(buildNavigationMenuPlan()).map((node) => node.label)).not.toContain('Kurzusok')
  })

  it('a seed nem hozza létre az élő „olcsó dolgok itt" CMS-menüpontot', () => {
    // 2026-09-06 élő menü: Szolgáltatások alatt `/akcios-kurzus`, felirat
    // „olcsó dolgok itt". A seed csak hiányzó pontokat hoz létre, meglévőt
    // nem töröl — ez CMS-only, kódból nem szűrjük.
    expect(flatten(buildNavigationMenuPlan()).map((node) => node.label)).not.toContain(
      'olcsó dolgok itt',
    )
  })
})

describe('buildNavigationMenuPlan — sorrend', () => {
  /**
   * A sorrendet nem a terv tömb-sorrendje, hanem a `buildNavTree` dönti el
   * (order, majd magyar címke szerint) — ezért a VALÓDI rendezőn mérünk.
   */
  it('a gyökér-sorrend a legacy számozásba illeszkedik: Szolgáltatások → Rólunk → Tudástár → Kapcsolat', () => {
    const plan = buildNavigationMenuPlan()
    const seeded = plan.map((node, index) =>
      urlMenu(100 + index, node.label, node.url ?? SERVICES_PAGE_PATH, { order: node.order }),
    )
    // A legacy-visszatöltés gyökérpontjai (restore-legacy-content.ts).
    const legacy = [
      urlMenu(200, 'Rólunk', '/rolunk', { order: 5 }),
      urlMenu(201, 'Kapcsolat', '/kapcsolat', { order: 6 }),
    ]

    const tree = buildNavTree([...legacy, ...seeded])

    expect(tree.map((item) => item.label)).toEqual([
      'Szolgáltatások',
      'Rólunk',
      'Tudástár',
      'Kapcsolat',
    ])
  })

  it('az almenü sorrendje: Rendelői kezelések → Szakembereknek → Ingyenes SOS KézRelax', () => {
    const services = findNode(buildNavigationMenuPlan(), 'Szolgáltatások')
    expect(services?.children.map((child) => child.order)).toEqual([0, 1, 2])
    expect(SERVICES_MENU_ORDER).toBeLessThan(KNOWLEDGE_BASE_MENU_ORDER)
  })
})

describe('buildNavigationMenuPlan — célok', () => {
  it('feloldott oldal/termék esetén ref-es menüpont (kanonikus cím, published-szűréssel)', () => {
    const plan = buildNavigationMenuPlan({ servicesPageId: 12, sosCourseId: 34 })
    const services = findNode(plan, 'Szolgáltatások')
    const sos = services?.children.find((child) => child.label === SOS_FREE_MENU_LABEL)

    expect(services?.type).toBe('page')
    expect(services?.ref).toEqual({ relationTo: 'pages', value: 12 })
    expect(sos?.type).toBe('product')
    expect(sos?.ref).toEqual({ relationTo: 'products', value: 34 })
  })

  it('feloldatlan cél esetén útvonal-tartalék (a menüpont nem tűnik el)', () => {
    const plan = buildNavigationMenuPlan()
    const services = findNode(plan, 'Szolgáltatások')
    const sos = services?.children.find((child) => child.label === SOS_FREE_MENU_LABEL)

    expect(services?.type).toBe('url')
    expect(services?.url).toBe(SERVICES_PAGE_PATH)
    expect(sos?.type).toBe('url')
    expect(sos?.url).toBe(SOS_COURSE_FALLBACK_PATH)
  })

  it('a rendelői kezelések a szolgáltatás-oldal horgonyára mutatnak (nincs még önálló oldal)', () => {
    const services = findNode(buildNavigationMenuPlan(), 'Szolgáltatások')
    const clinic = services?.children.find((child) => child.label === 'Rendelői kezelések')

    expect(clinic?.url).toBe(CLINIC_TREATMENTS_PATH)
    expect(CLINIC_TREATMENTS_PATH.startsWith(`${SERVICES_PAGE_PATH}#`)).toBe(true)
  })

  it('a „Szakembereknek" BELSŐ választó oldalra visz, nem egyből a ProBodyra (WP49)', () => {
    const services = findNode(buildNavigationMenuPlan(), 'Szolgáltatások')
    const professionals = services?.children.find(
      (child) => child.label === PROFESSIONALS_MENU_LABEL,
    )

    expect(professionals?.url).toBe(PROFESSIONALS_MENU_PATH)
    expect(professionals?.url).toBe('/szakembereknek')
    expect(professionals?.openInNewTab).toBeUndefined()
    // A ProBody workshop címe a választó oldal képzés-kártyájáé marad.
    expect(/^https:\/\//.test(PROFESSIONAL_TRAINING_URL)).toBe(true)
    expect(professionals?.url).not.toBe(PROFESSIONAL_TRAINING_URL)
  })

  it('a menüfában nincs külső cél, és belső pont sosem nyílik új lapon', () => {
    const nodes = flatten(buildNavigationMenuPlan({ servicesPageId: 1, sosCourseId: 2 }))
    const external = nodes.filter((node) => /^https?:\/\//i.test(node.url ?? ''))

    expect(external.map((node) => node.label)).toEqual([])
    for (const node of nodes) {
      expect(node.openInNewTab === true, node.label).toBe(false)
    }
  })
})

describe('buildNavigationMenuPlan — a meglévő kapukon is átjut', () => {
  it('minden menüpont átmegy a collection type-konzisztencia-validációján', () => {
    for (const node of flatten(buildNavigationMenuPlan({ servicesPageId: 1, sosCourseId: 2 }))) {
      expect(validateMenuTypeConsistency(node), node.label).toEqual([])
    }
    // Tartalék-ágon (csupa url típus) ugyanígy.
    for (const node of flatten(buildNavigationMenuPlan())) {
      expect(validateMenuTypeConsistency(node), node.label).toEqual([])
    }
  })

  it('minden webcím túlél a CMS-url szűrőn (nem esik ki némán a navigációból)', () => {
    for (const node of flatten(buildNavigationMenuPlan())) {
      if (node.url === undefined) continue
      expect(sanitizeCmsUrl(node.url), node.url).not.toBeNull()
    }
  })

  it('a tervből a buildNavTree a várt 2 szintű navigációt építi', () => {
    const tree = buildNavTree(planToMenus(buildNavigationMenuPlan()))
    const services = tree.find((item) => item.label === 'Szolgáltatások')

    expect(tree.map((item) => item.label)).toEqual(['Szolgáltatások', 'Tudástár'])
    expect(services?.children.map((child) => child.label)).toEqual([
      'Rendelői kezelések',
      PROFESSIONALS_MENU_LABEL,
      SOS_FREE_MENU_LABEL,
    ])
    const professionals = services?.children.find(
      (child) => child.label === PROFESSIONALS_MENU_LABEL,
    )
    expect(professionals?.isExternal).toBe(false)
    expect(professionals?.openInNewTab).toBe(false)
    expect(professionals?.href).toBe(PROFESSIONALS_MENU_PATH)
  })
})

// ---------------------------------------------------------------------------
// Idempotencia — memóriabeli Payload-mock
// ---------------------------------------------------------------------------

type MenuRow = {
  id: number
  label: string
  type: string
  order: number
  url?: string
  ref?: { relationTo: string; value: number }
  parent?: number
  visible: boolean
  openInNewTab: boolean
}

type FakeStore = {
  menus: MenuRow[]
  pages: { id: number; slug: string }[]
  products: { id: number; sku: string }[]
}

/** A `where` alakok, amelyeket a menu-seed használ — csak ezeket értelmezzük. */
function readEquals(condition: unknown, field: string): unknown {
  if (typeof condition !== 'object' || condition === null) return undefined
  const value = (condition as Record<string, unknown>)[field]
  if (typeof value !== 'object' || value === null) return undefined
  return (value as Record<string, unknown>).equals
}

function matchesMenuWhere(row: MenuRow, where: unknown): boolean {
  const conditions =
    typeof where === 'object' && where !== null && Array.isArray((where as { and?: unknown }).and)
      ? ((where as { and: unknown[] }).and as unknown[])
      : []
  return conditions.every((condition) => {
    const label = readEquals(condition, 'label')
    if (typeof label === 'string') return row.label === label
    const parent = readEquals(condition, 'parent')
    if (typeof parent === 'number') return row.parent === parent
    const parentExists =
      typeof condition === 'object' &&
      condition !== null &&
      typeof (condition as Record<string, unknown>).parent === 'object'
        ? ((condition as Record<string, { exists?: unknown }>).parent.exists as boolean | undefined)
        : undefined
    if (parentExists === false) return row.parent === undefined
    return true
  })
}

function createFakePayload(store: FakeStore): { payload: Payload; createCount: () => number } {
  let nextId = 1000
  let creates = 0
  const payload = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    find: async ({ collection, where }: { collection: string; where?: unknown }) => {
      if (collection === 'pages') {
        const slug = readEquals(typeof where === 'object' && where !== null ? where : {}, 'slug')
        return { docs: store.pages.filter((page) => page.slug === slug) }
      }
      if (collection === 'products') {
        const sku = readEquals(typeof where === 'object' && where !== null ? where : {}, 'sku')
        return { docs: store.products.filter((product) => product.sku === sku) }
      }
      return { docs: store.menus.filter((row) => matchesMenuWhere(row, where)) }
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      creates += 1
      nextId += 1
      const row = { id: nextId, ...data } as MenuRow
      store.menus.push(row)
      return row
    },
  }
  return { payload: payload as unknown as Payload, createCount: () => creates }
}

describe('ensureNavigationMenu — idempotencia', () => {
  it('üres adatbázisban a teljes struktúrát létrehozza, másodszor semmit', async () => {
    const store: FakeStore = { menus: [], pages: [], products: [] }
    const { payload, createCount } = createFakePayload(store)

    const first = await ensureNavigationMenu(payload)
    expect(first.created).toEqual([
      'Szolgáltatások',
      'Rendelői kezelések',
      PROFESSIONALS_MENU_LABEL,
      SOS_FREE_MENU_LABEL,
      'Tudástár',
    ])
    expect(first.skipped).toEqual([])
    expect(createCount()).toBe(5)

    const second = await ensureNavigationMenu(payload)
    expect(second.created).toEqual([])
    expect(second.skipped).toHaveLength(5)
    // A második futás EGYETLEN sort sem írt.
    expect(createCount()).toBe(5)
    expect(store.menus).toHaveLength(5)
  })

  it('a gyermekek a Szolgáltatások menüpont ALÁ kerülnek (nem gyökér-szintre)', async () => {
    const store: FakeStore = { menus: [], pages: [], products: [] }
    const { payload } = createFakePayload(store)
    await ensureNavigationMenu(payload)

    const services = store.menus.find((row) => row.label === 'Szolgáltatások')
    const children = store.menus.filter((row) => row.parent !== undefined)
    expect(services?.parent).toBeUndefined()
    expect(children).toHaveLength(3)
    expect(children.every((row) => row.parent === services?.id)).toBe(true)
  })

  it('SZERKESZTŐI ELSŐBBSÉG: meglévő menüpontot nem ír felül és nem hoz vissza', async () => {
    const store: FakeStore = {
      menus: [
        // A szerkesztő átírta a célt ÉS kivette a „Látható" pipát.
        {
          id: 1,
          label: 'Tudástár',
          type: 'url',
          url: '/sajat-tudastar',
          order: 99,
          visible: false,
          openInNewTab: false,
        },
      ],
      pages: [],
      products: [],
    }
    const { payload } = createFakePayload(store)

    const summary = await ensureNavigationMenu(payload)

    expect(summary.skipped).toContain('Tudástár')
    expect(summary.created).not.toContain('Tudástár')
    const tudastar = store.menus.filter((row) => row.label === 'Tudástár')
    expect(tudastar).toHaveLength(1)
    expect(tudastar[0].url).toBe('/sajat-tudastar')
    expect(tudastar[0].visible).toBe(false)
    expect(tudastar[0].order).toBe(99)
  })

  it('meglévő „Szolgáltatások" gyökér alá fűzi az almenüt (a legacy menüpontot használja)', async () => {
    const store: FakeStore = {
      menus: [
        {
          id: 7,
          label: 'Szolgáltatások',
          type: 'page',
          ref: { relationTo: 'pages', value: 3 },
          order: 4,
          visible: true,
          openInNewTab: false,
        },
      ],
      pages: [],
      products: [],
    }
    const { payload } = createFakePayload(store)

    const summary = await ensureNavigationMenu(payload)

    expect(summary.skipped).toContain('Szolgáltatások')
    expect(store.menus.filter((row) => row.parent === 7)).toHaveLength(3)
  })

  it('feloldott oldal/termék esetén ref-es sorokat ír (nem beégetett útvonalat)', async () => {
    const store: FakeStore = {
      menus: [],
      pages: [{ id: 42, slug: SERVICES_PAGE_SLUG }],
      products: [{ id: 43, sku: SOS_COURSE_SKU }],
    }
    const { payload } = createFakePayload(store)
    await ensureNavigationMenu(payload)

    expect(store.menus.find((row) => row.label === 'Szolgáltatások')).toMatchObject({
      type: 'page',
      ref: { relationTo: 'pages', value: 42 },
    })
    expect(store.menus.find((row) => row.label === SOS_FREE_MENU_LABEL)).toMatchObject({
      type: 'product',
      ref: { relationTo: 'products', value: 43 },
    })
  })

  it('a régi SOS KézRelax sort az Ingyenes tervponttal azonosnak tekinti, nem duplikálja', async () => {
    const store: FakeStore = {
      menus: [
        {
          id: 1,
          label: 'Szolgáltatások',
          type: 'url',
          url: SERVICES_PAGE_PATH,
          order: 4,
          visible: true,
          openInNewTab: false,
        },
        {
          id: 6,
          label: SOS_MENU_LABEL,
          type: 'product',
          ref: { relationTo: 'products', value: 43 },
          parent: 1,
          order: 2,
          visible: true,
          openInNewTab: false,
        },
      ],
      pages: [],
      products: [{ id: 43, sku: SOS_COURSE_SKU }],
    }
    const { payload, createCount } = createFakePayload(store)

    const summary = await ensureNavigationMenu(payload)

    expect(summary.created).not.toContain(SOS_FREE_MENU_LABEL)
    expect(summary.skipped).toContain(SOS_MENU_LABEL)
    expect(summary.created).toEqual(['Rendelői kezelések', PROFESSIONALS_MENU_LABEL, 'Tudástár'])
    expect(createCount()).toBe(3)
    expect(
      store.menus.filter(
        (row) => row.label === SOS_MENU_LABEL || row.label === SOS_FREE_MENU_LABEL,
      ),
    ).toHaveLength(1)
    expect(store.menus.find((row) => row.label === SOS_MENU_LABEL)).toMatchObject({
      type: 'product',
      ref: { relationTo: 'products', value: 43 },
    })
  })

  it('a régi „Szakmai képzés" sort a „Szakembereknek" tervponttal azonosnak tekinti (WP49)', async () => {
    const store: FakeStore = {
      menus: [
        {
          id: 1,
          label: 'Szolgáltatások',
          type: 'url',
          url: SERVICES_PAGE_PATH,
          order: 4,
          visible: true,
          openInNewTab: false,
        },
        {
          // Az élő CMS-sor a 2026-09-19 előtti felirattal és külső céllal: az
          // átnevezés az owner-content szabály dolga, a seed NEM ír felül és
          // nem hoz létre mellé második pontot.
          id: 5,
          label: LEGACY_PROFESSIONAL_TRAINING_MENU_LABEL,
          type: 'url',
          url: PROFESSIONAL_TRAINING_URL,
          parent: 1,
          order: 1,
          visible: true,
          openInNewTab: true,
        },
      ],
      pages: [],
      products: [],
    }
    const { payload, createCount } = createFakePayload(store)

    const summary = await ensureNavigationMenu(payload)

    expect(summary.created).not.toContain(PROFESSIONALS_MENU_LABEL)
    expect(summary.skipped).toContain(LEGACY_PROFESSIONAL_TRAINING_MENU_LABEL)
    expect(summary.created).toEqual(['Rendelői kezelések', SOS_FREE_MENU_LABEL, 'Tudástár'])
    expect(createCount()).toBe(3)
    expect(
      store.menus.filter(
        (row) =>
          row.label === PROFESSIONALS_MENU_LABEL ||
          row.label === LEGACY_PROFESSIONAL_TRAINING_MENU_LABEL,
      ),
    ).toHaveLength(1)
    expect(store.menus.find((row) => row.id === 5)?.url).toBe(PROFESSIONAL_TRAINING_URL)
  })

  it('próbafutás (dryRun) semmit nem ír az adatbázisba', async () => {
    const store: FakeStore = { menus: [], pages: [], products: [] }
    const { payload, createCount } = createFakePayload(store)

    const summary = await ensureNavigationMenu(payload, { dryRun: true })

    expect(createCount()).toBe(0)
    expect(store.menus).toEqual([])
    // A gyökerek megjelennek a tervben; a gyermekekről szülő nélkül nem állítunk.
    expect(summary.created).toEqual(['Szolgáltatások', 'Tudástár'])
  })
})

// ---------------------------------------------------------------------------
// Fixture-segédek
// ---------------------------------------------------------------------------

function urlMenu(id: number, label: string, url: string, overrides: Partial<Menu> = {}): Menu {
  return {
    id,
    label,
    type: 'url',
    url,
    ref: null,
    parent: null,
    order: null,
    visible: true,
    openInNewTab: false,
    updatedAt: '',
    createdAt: '',
    ...overrides,
  } as unknown as Menu
}

/** A tervből `Menu`-sorok (id-kiosztás + parent-kötés), hogy a buildNavTree futhasson. */
function planToMenus(plan: MenuSeedNode[]): Menu[] {
  const rows: Menu[] = []
  let nextId = 1
  for (const root of plan) {
    const rootId = nextId++
    rows.push(planNodeToMenu(root, rootId, null))
    for (const child of root.children) {
      rows.push(planNodeToMenu(child, nextId++, rootId))
    }
  }
  return rows
}

function planNodeToMenu(node: MenuSeedNode, id: number, parent: number | null): Menu {
  const published = { status: 'published' as const }
  const ref =
    node.ref === undefined
      ? null
      : {
          relationTo: node.ref.relationTo,
          value:
            node.ref.relationTo === 'pages'
              ? ({ id: node.ref.value, slug: SERVICES_PAGE_SLUG, ...published } as Page)
              : ({ id: node.ref.value, slug: 'sos-kezrelax', ...published } as Product),
        }
  return {
    id,
    label: node.label,
    type: node.type,
    url: node.url ?? null,
    ref,
    parent,
    order: node.order,
    visible: true,
    openInNewTab: node.openInNewTab === true,
    updatedAt: '',
    createdAt: '',
  } as unknown as Menu
}
