import type { Access, Where } from 'payload'

import { hasOwnerRole, hasStaffOrOwnerRole } from './roles'

/**
 * users update access: owner minden; staff saját + customer; customer csak saját.
 * Olvasás továbbra is isSelfOrAdmin. role/purchases mező + blockForeignCredentialChange is véd.
 */
export const canUpdateUser: Access = ({ req }) => {
  if (hasOwnerRole(req.user)) {
    return true
  }
  if (hasStaffOrOwnerRole(req.user) && req.user) {
    // A `Where[]` annotáció kell: enélkül a TypeScript a két objektum-literálból
    // olyan uniót következtet, amelyben a hiányzó kulcs `undefined` típust kap
    // (`role?: undefined`), az pedig nem illeszkedik a Where index-szignatúrájára.
    const sajatVagyVevo: Where[] = [
      { id: { equals: req.user.id } },
      { role: { equals: 'customer' } },
    ]
    return { or: sajatVagyVevo }
  }
  if (req.user) {
    const csakSajat: Where = { id: { equals: req.user.id } }
    return csakSajat
  }
  return false
}
