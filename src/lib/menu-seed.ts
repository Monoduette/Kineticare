import type { Payload } from 'payload'

/**
 * Fejléc-navigáció alapstruktúrája — idempotens seed (`menus` collection).
 *
 * Dedup: `label` + szülő; meglévő sort sosem ír felül. A „Kurzusok" a Header.tsx
 * akciógombja, nem CMS-menü. A tiszta rész (`buildNavigationMenuPlan`) DB nélkül tesztelhető.
 */

/** A „Szolgáltatások" gyökér-menüpont céloldala (pages.slug). */
export const SERVICES_PAGE_SLUG = 'szolgaltatasok'

/** A szolgáltatás-oldal útvonala — tartalék, ha a CMS-oldal nem található. */
export const SERVICES_PAGE_PATH = `/${SERVICES_PAGE_SLUG}`

/** Rendelői kezelések horgonya (`sectionSettings.anchorId` a /szolgaltatasok oldalon). */
export const CLINIC_TREATMENTS_ANCHOR = 'rendeloi'

/** Rendelői kezelések útvonala — a /szolgaltatasok oldal szekció-horgonya. */
export const CLINIC_TREATMENTS_PATH = `${SERVICES_PAGE_PATH}#${CLINIC_TREATMENTS_ANCHOR}`

/** A ProBody Stúdióval közös, akkreditált szakmai képzés (külső oldal). */
export const PROFESSIONAL_TRAINING_URL = 'https://probodystudio.hu/kez-workshop/'

/** Az ingyenes SOS lead-magnet kurzus azonosítója (products.sku = megjelenő név). */
export const SOS_COURSE_SKU = 'SOS Kézrelax villámkurzus'

/**
 * Az SOS kurzus RÉGI, id-alapú útvonala — tartalék, ha a termék `sku` alapján
 * nem található (pl. a szerkesztő átnevezte). A /kurzusok/[slug] route a
 * numerikus szegmenst tartósan a kanonikus címre irányítja
 * (src/lib/course-url.ts), tehát a link ilyenkor is célba ér.
 */
export const SOS_COURSE_FALLBACK_PATH = '/kurzusok/2'

/** A Tudástár (blog) gyűjtőoldalának útvonala. */
export const KNOWLEDGE_BASE_PATH = '/blog'

export type MenuSeedType = 'page' | 'post' | 'url' | 'product'

export type MenuSeedRelation = {
  relationTo: 'pages' | 'posts' | 'products'
  value: number
}

export interface MenuSeedNode {
  label: string
  type: MenuSeedType
  order: number
  url?: string
  ref?: MenuSeedRelation
  openInNewTab?: boolean
  children: MenuSeedNode[]
}

/** A terv felépítéséhez feloldott célok (a hiányzó id-k tartalék-ágra váltanak). */
export interface MenuSeedContext {
  /** A `szolgaltatasok` CMS-oldal id-je, ha létezik. */
  servicesPageId?: number
  /** Az ingyenes SOS kurzus termék-id-je, ha létezik. */
  sosCourseId?: number
}

/** Gyökér-menüpont sorrend — legacy számozás; azonos order esetén magyar címke szerint. */
export const SERVICES_MENU_ORDER = 4
export const KNOWLEDGE_BASE_MENU_ORDER = 5

/**
 * A cél-menüstruktúra — TISZTA függvény, adatbázis nélkül tesztelhető.
 *
 * A visszaadott fa legfeljebb 2 szintű (a `menus` beforeValidate ennél
 * mélyebbet nem is engedne — src/lib/menu-validation.ts).
 */
export function buildNavigationMenuPlan(context: MenuSeedContext = {}): MenuSeedNode[] {
  const services: MenuSeedNode =
    context.servicesPageId !== undefined
      ? {
          label: 'Szolgáltatások',
          type: 'page',
          ref: { relationTo: 'pages', value: context.servicesPageId },
          order: SERVICES_MENU_ORDER,
          children: [],
        }
      : {
          label: 'Szolgáltatások',
          type: 'url',
          url: SERVICES_PAGE_PATH,
          order: SERVICES_MENU_ORDER,
          children: [],
        }

  const sosCourse: MenuSeedNode =
    context.sosCourseId !== undefined
      ? {
          label: 'SOS KézRelax',
          type: 'product',
          ref: { relationTo: 'products', value: context.sosCourseId },
          order: 2,
          children: [],
        }
      : {
          label: 'SOS KézRelax',
          type: 'url',
          url: SOS_COURSE_FALLBACK_PATH,
          order: 2,
          children: [],
        }

  services.children = [
    {
      label: 'Rendelői kezelések',
      type: 'url',
      url: CLINIC_TREATMENTS_PATH,
      order: 0,
      children: [],
    },
    {
      label: 'Szakmai képzés',
      type: 'url',
      url: PROFESSIONAL_TRAINING_URL,
      // Külső oldalra visz: új lapon nyílik, hogy a látogató ne veszítse el a
      // Kineticare munkamenetét (a NavAnchor ilyenkor rel="noopener noreferrer"-t ad).
      openInNewTab: true,
      order: 1,
      children: [],
    },
    sosCourse,
  ]

  return [
    services,
    {
      label: 'Tudástár',
      type: 'url',
      url: KNOWLEDGE_BASE_PATH,
      order: KNOWLEDGE_BASE_MENU_ORDER,
      children: [],
    },
  ]
}

export interface MenuSeedSummary {
  /** A létrehozott menüpontok feliratai (dry-run esetén: létrehozandók). */
  created: string[]
  /** A már létező, ezért ÉRINTETLENÜL hagyott menüpontok feliratai. */
  skipped: string[]
}

/** A cél-dokumentumok feloldása a tervhez (hiányzó cél → tartalék-ág). */
async function resolveMenuSeedContext(payload: Payload): Promise<MenuSeedContext> {
  const context: MenuSeedContext = {}

  const pages = await payload.find({
    collection: 'pages',
    where: { slug: { equals: SERVICES_PAGE_SLUG } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const servicesPageId = pages.docs[0]?.id
  if (typeof servicesPageId === 'number') {
    context.servicesPageId = servicesPageId
  }

  const products = await payload.find({
    collection: 'products',
    where: { sku: { equals: SOS_COURSE_SKU } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const sosCourseId = products.docs[0]?.id
  if (typeof sosCourseId === 'number') {
    context.sosCourseId = sosCourseId
  }

  return context
}

/**
 * Egy menüpont biztosítása. A dedup-kulcs a `label` + a szülő (gyökérnél:
 * „nincs szülő") — pontosan úgy, ahogy a seed.ts és a legacy-visszatöltés
 * teszi, hogy a három seed-út egymás sorait is felismerje, és ne duplikáljon.
 *
 * @returns a menüpont id-je; `undefined`, ha próbafutásban lett volna létrehozva
 */
async function ensureMenuNode(
  payload: Payload,
  node: MenuSeedNode,
  parentId: number | undefined,
  summary: MenuSeedSummary,
  dryRun: boolean,
): Promise<number | undefined> {
  const existing = await payload.find({
    collection: 'menus',
    where: {
      and: [
        { label: { equals: node.label } },
        parentId !== undefined ? { parent: { equals: parentId } } : { parent: { exists: false } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  const found = existing.docs[0]
  if (found) {
    summary.skipped.push(node.label)
    payload.logger.info(`Menü-seed: „${node.label}" már létezik — érintetlenül hagyva.`)
    return found.id
  }

  summary.created.push(node.label)
  if (dryRun) {
    payload.logger.info(`Menü-seed (PRÓBAFUTÁS): „${node.label}" létrehozandó.`)
    return undefined
  }

  const created = await payload.create({
    collection: 'menus',
    data: {
      label: node.label,
      type: node.type,
      order: node.order,
      visible: true,
      openInNewTab: node.openInNewTab === true,
      ...(node.url !== undefined ? { url: node.url } : {}),
      ...(node.ref !== undefined ? { ref: node.ref } : {}),
      ...(parentId !== undefined ? { parent: parentId } : {}),
    },
    overrideAccess: true,
  })
  payload.logger.info(`Menü-seed: „${node.label}" létrehozva.`)
  return created.id
}

/**
 * A menüstruktúra idempotens biztosítása.
 *
 * Többször futtatva sem duplikál és nem ír felül semmit: minden menüpontot a
 * felirata (+ a szülője) alapján keres meg, és csak a HIÁNYZÓKAT hozza létre.
 *
 * @param options.dryRun ha igaz, semmit nem ír az adatbázisba — csak összesít
 */
export async function ensureNavigationMenu(
  payload: Payload,
  options: { dryRun?: boolean } = {},
): Promise<MenuSeedSummary> {
  const dryRun = options.dryRun === true
  const summary: MenuSeedSummary = { created: [], skipped: [] }
  const plan = buildNavigationMenuPlan(await resolveMenuSeedContext(payload))

  for (const root of plan) {
    const rootId = await ensureMenuNode(payload, root, undefined, summary, dryRun)
    if (root.children.length === 0) {
      continue
    }
    if (rootId === undefined) {
      // Csak próbafutásban fordulhat elő (a szülő még nem létezik): a
      // gyermekeket nem tudjuk a szülőhöz kötni, ezért nem is állítunk róluk.
      payload.logger.info(
        `Menü-seed (PRÓBAFUTÁS): a(z) „${root.label}" almenüpontjai csak éles futáskor értékelhetők.`,
      )
      continue
    }
    for (const child of root.children) {
      await ensureMenuNode(payload, child, rootId, summary, dryRun)
    }
  }

  return summary
}
