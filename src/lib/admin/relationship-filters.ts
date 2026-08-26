import type { Where } from 'payload'

/**
 * Admin relationship-listák kontextus szerinti szűrése.
 *
 * A Payload a polimorf `relationTo: ['pages', 'posts', 'products']` mezőben
 * MINDHÁROM kollekciót felsorolja, ha nincs `filterOptions`. A menü Cél
 * mezőjénél ez azt jelenti, hogy „Bejegyzés" típusnál is ott vannak a
 * kurzusok. A szerző / szakmai lektor mezőknél pedig a vásárlók is.
 *
 * Itt csak a listát szűrjük: collection-access-t nem írunk át.
 */

type RelationshipFilterArgs = {
  id?: number | string
}

/** Szerző és szakmai lektor: csak munkatárs vagy tulajdonos, vásárló nem. */
export const STAFF_OR_OWNER_USER_WHERE: Where = {
  role: { in: ['staff', 'owner'] },
}

export const staffOrOwnerUserFilter = (): Where => STAFF_OR_OWNER_USER_WHERE

/**
 * A szerkesztett dokumentumot kiveszi a saját listájából (kapcsolódó cikkek,
 * fölérendelt menüpont). Üres / create-űrlapon nincs mit kizárni.
 */
export function excludeSelfWhere(id: unknown): true | Where {
  if (typeof id !== 'string' && typeof id !== 'number') return true
  if (typeof id === 'string' && id.trim() === '') return true
  return { id: { not_equals: id } }
}

export const relatedPostsFilter = ({ id }: RelationshipFilterArgs): true | Where =>
  excludeSelfWhere(id)

/**
 * Fölérendelt menüpont: csak gyökér (parent nélküli) menüpont, és nem önmaga.
 * A 2 szintes fa szabálya (`validateMenuParentChain`) így a listában is látszik.
 */
export function rootMenuParentWhere(id: unknown): Where {
  const rootOnly: Where = { parent: { exists: false } }
  const self = excludeSelfWhere(id)
  if (self === true) return rootOnly
  return { and: [rootOnly, self] }
}

export const rootMenuParentFilter = ({ id }: RelationshipFilterArgs): Where =>
  rootMenuParentWhere(id)
