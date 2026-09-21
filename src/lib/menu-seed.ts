import type { Payload } from 'payload'

import { SOS_FREE_MENU_LABEL, SOS_MENU_LABEL } from './sos-offer-copy'

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

/**
 * A „Szakembereknek" menüpont (WP49, tulajdonosi kérés 2026-09): a korábbi
 * „Szakmai képzés" pont, amely EGYBŐL a ProBody workshopra vitt, a saját
 * választó oldalunkra mutat (képzés VAGY szakkönyv). Belső cél: nem nyílik
 * új lapon. Az élő CMS-sor átnevezése az owner-content szabály dolga; a seed
 * a régi feliratot ugyanannak a pontnak tekinti (nem duplikál).
 */
export const PROFESSIONALS_MENU_LABEL = 'Szakembereknek'
export const PROFESSIONALS_MENU_PATH = '/szakembereknek'
/** A menüpont 2026-09-19 előtti felirata (dedup-kulcs a meglévő sorhoz). */
export const LEGACY_PROFESSIONAL_TRAINING_MENU_LABEL = 'Szakmai képzés'
/**
 * A menüpont MINDEN régi felirata (egyes és többes szám): a seed dedupja és
 * az owner-content átnevező szabály UGYANEZT a listát használja, hogy egyik
 * se lásson „új" pontot ott, ahol a másik még a régit ismeri fel.
 */
export const LEGACY_PROFESSIONAL_TRAINING_MENU_LABELS: readonly string[] = [
  LEGACY_PROFESSIONAL_TRAINING_MENU_LABEL,
  'Szakmai képzések',
]

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
          label: SOS_FREE_MENU_LABEL,
          type: 'product',
          ref: { relationTo: 'products', value: context.sosCourseId },
          order: 2,
          children: [],
        }
      : {
          label: SOS_FREE_MENU_LABEL,
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
      label: PROFESSIONALS_MENU_LABEL,
      type: 'url',
      url: PROFESSIONALS_MENU_PATH,
      // Belső választó oldal (WP49): a külső ProBody-link a /szakembereknek
      // kártyájáról nyílik, ott jelölve (ikon + „új lapon nyílik" jegyzet).
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

function labelsMatchingSeedNode(node: MenuSeedNode): string[] {
  // A régi seed „SOS KézRelax"-szel hozta létre a sort. Az új terv felirata
  // „Ingyenes SOS KézRelax"; a dedup-kulcs továbbra is label+szülő, ezért a
  // régi feliratot ugyanannak a pontnak tekintjük, különben a következő seed
  // duplikálna. Meglévő sort nem írunk felül (szerkesztői elsőbbség).
  if (node.label === SOS_FREE_MENU_LABEL) {
    return [SOS_FREE_MENU_LABEL, SOS_MENU_LABEL]
  }
  // WP49: a „Szakmai képzés" sor a „Szakembereknek" tervpont elődje; az élő
  // CMS-sort az owner-content szabály nevezi át, a seed addig sem duplikál.
  if (node.label === PROFESSIONALS_MENU_LABEL) {
    return [PROFESSIONALS_MENU_LABEL, ...LEGACY_PROFESSIONAL_TRAINING_MENU_LABELS]
  }
  return [node.label]
}

async function findExistingMenuNode(payload: Payload, label: string, parentId: number | undefined) {
  const existing = await payload.find({
    collection: 'menus',
    where: {
      and: [
        { label: { equals: label } },
        parentId !== undefined ? { parent: { equals: parentId } } : { parent: { exists: false } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return existing.docs[0]
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
  let found: Awaited<ReturnType<typeof findExistingMenuNode>> | undefined
  for (const label of labelsMatchingSeedNode(node)) {
    found = await findExistingMenuNode(payload, label, parentId)
    if (found) break
  }
  if (found) {
    summary.skipped.push(found.label)
    payload.logger.info(`Menü-seed: „${found.label}" már létezik — érintetlenül hagyva.`)
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
 * A tervben nem szereplő, szerkesztői extra gyerek (például az élő menü
 * egykori „olcsó dolgok itt" pontja, ma „Akciós KézRehab kurzus", a
 * `akcios-kurzus-menupont` szabály után) megmarad — a seed nem töröl.
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
