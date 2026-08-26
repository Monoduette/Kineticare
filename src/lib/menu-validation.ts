/**
 * Menüfa-validáció — tiszta, dependency-injekciós logika (DB nélkül unit-tesztelhető).
 *
 * Szabályok (T-013):
 *  - A menüfa legfeljebb 2 szintű: gyökér → gyermek. Egy menüpont szülője
 *    csak gyökér (parent nélküli) menüpont lehet.
 *  - Tilos az önmagára mutatás és a kör (ciklus) a parent-láncban.
 *  - type: 'url' esetén az url mező kötelező; minden más type esetén a ref
 *    kötelező, és a ref relationTo-jának a type-hoz tartozó collectionre
 *    kell mutatnia (page → pages, post → posts, product → products).
 */

export const MENU_TYPES = ['page', 'post', 'url', 'product'] as const
export type MenuType = (typeof MENU_TYPES)[number]

export const MENU_TYPE_TO_COLLECTION = {
  page: 'pages',
  post: 'posts',
  product: 'products',
} as const

export const MAX_MENU_DEPTH = 2

export interface MenuValidationIssue {
  message: string
  path: string
}

/**
 * Relationship-mező értékéből az id kinyerése — a mező lehet nyers id
 * (number/string) vagy populate-olt dokumentum ({ id, … }).
 */
export const extractRelationshipId = (value: unknown): number | string | null => {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim().length > 0) return value
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'number' || typeof id === 'string') return id
  }
  return null
}

/** Polimorf relationship ({ relationTo, value }) relationTo-része. */
export const extractRelationTo = (value: unknown): string | null => {
  if (value && typeof value === 'object' && 'relationTo' in value) {
    const relationTo = (value as { relationTo?: unknown }).relationTo
    if (typeof relationTo === 'string') return relationTo
  }
  return null
}

const readSiblingType = (siblingData: unknown): string | undefined => {
  if (typeof siblingData !== 'object' || siblingData === null) return undefined
  const type = (siblingData as { type?: unknown }).type
  return typeof type === 'string' ? type : undefined
}

/**
 * A menü Cél (`ref`) listája: csak a `Hová mutat` típusnak megfelelő kollekció.
 * `false` = ez a kollekció ne jelenjen meg a lenyílóban.
 */
export const filterMenuRefOptions = (args: {
  relationTo: string
  siblingData?: unknown
}): boolean => {
  const type = readSiblingType(args.siblingData)
  if (type === undefined || type === 'url') return false
  if (!(type in MENU_TYPE_TO_COLLECTION)) return false
  return args.relationTo === MENU_TYPE_TO_COLLECTION[type as Exclude<MenuType, 'url'>]
}

/**
 * Típusváltásnál a másik kollekcióból maradt célt kiüríti, hogy a mentés
 * ne a régi, most már rejtett értéken bukjon el.
 */
export const clearMismatchedMenuRef = <T extends { ref?: unknown; type?: unknown }>(data: T): T => {
  const type = typeof data.type === 'string' ? data.type : undefined
  if (type === undefined || type === 'url' || !(type in MENU_TYPE_TO_COLLECTION)) {
    return data
  }
  const expected = MENU_TYPE_TO_COLLECTION[type as Exclude<MenuType, 'url'>]
  const relationTo = extractRelationTo(data.ref)
  if (relationTo === null || relationTo === expected) {
    return data
  }
  return { ...data, ref: null }
}

/**
 * Type-konzisztencia: url típusnál az url kötelező; egyéb típusnál a ref
 * kötelező és a relationTo-nak a type-hoz tartozó collectionre kell mutatnia.
 * Tiszta függvény.
 */
export const validateMenuTypeConsistency = (data: {
  ref?: unknown
  type?: unknown
  url?: unknown
}): MenuValidationIssue[] => {
  const type = typeof data.type === 'string' ? data.type : undefined

  if (type === 'url') {
    if (typeof data.url !== 'string' || data.url.trim().length === 0) {
      return [{ message: 'URL típusú menüpontnál az URL megadása kötelező.', path: 'url' }]
    }
    return []
  }

  if (!type || !(MENU_TYPES as readonly string[]).includes(type)) {
    return [
      {
        message: 'A menüpont típusának megadása kötelező (page, post, product vagy url).',
        path: 'type',
      },
    ]
  }

  const relationTo = extractRelationTo(data.ref)
  const hasRefValue =
    data.ref !== null &&
    data.ref !== undefined &&
    relationTo !== null &&
    extractRelationshipId((data.ref as { value?: unknown }).value) !== null

  if (!hasRefValue) {
    return [{ message: 'A menüponthoz kötelező célt (ref) választani.', path: 'ref' }]
  }

  const expectedCollection = MENU_TYPE_TO_COLLECTION[type as Exclude<MenuType, 'url'>]
  if (relationTo !== expectedCollection) {
    return [
      {
        message: `A menüpont célja a típusának megfelelő collectionből kell származzon (${type} → ${expectedCollection}).`,
        path: 'ref',
      },
    ]
  }

  return []
}

/** A parent-lánc bejárásához injektált lekérdező (így DB nélkül tesztelhető). */
export type MenuParentFetcher = (
  id: number | string,
) => Promise<{ id: number | string; parent?: unknown } | null>

/**
 * Parent-lánc validáció: legfeljebb maxDepth szint (gyökér → gyermek),
 * nincs önmagára mutatás, nincs ciklus.
 */
export const validateMenuParentChain = async ({
  docId,
  fetchById,
  maxDepth = MAX_MENU_DEPTH,
  parent,
}: {
  docId?: number | string | null
  fetchById: MenuParentFetcher
  maxDepth?: number
  parent: unknown
}): Promise<MenuValidationIssue[]> => {
  const parentId = extractRelationshipId(parent)
  if (parentId === null) return []

  if (docId !== null && docId !== undefined && String(parentId) === String(docId)) {
    return [{ message: 'A menüpont nem lehet önmaga szülője.', path: 'parent' }]
  }

  const visited = new Set<string>()
  if (docId !== null && docId !== undefined) visited.add(String(docId))

  // A vizsgált menüpont maga az 1. szint; minden parent-állom +1.
  let depth = 1
  let currentId: number | string | null = parentId

  while (currentId !== null) {
    if (visited.has(String(currentId))) {
      return [
        { message: 'A parent-lánc kört (ciklust) alkot — válassz másik szülőt.', path: 'parent' },
      ]
    }
    visited.add(String(currentId))

    const current = await fetchById(currentId)
    if (!current) {
      return [{ message: 'A megadott szülő menüpont nem található.', path: 'parent' }]
    }

    depth += 1
    if (depth > maxDepth) {
      return [
        {
          message: `A menüfa legfeljebb ${maxDepth} szintű lehet (gyökér → gyermek); ennél mélyebb lánc nem engedélyezett.`,
          path: 'parent',
        },
      ]
    }

    currentId = extractRelationshipId(current.parent)
  }

  return []
}
