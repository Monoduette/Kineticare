import type { FieldAccess } from 'payload'

import { hasUserPurchased } from '../lib/courses'
import { hasStaffOrOwnerRole } from './roles'

/**
 * streamAssetId olvasás: staff/owner mindig; customer ha megvette; anonim soha.
 * Lejárat itt nem számít (N+1); jegykiadásnál 403. overrideAccess:true lejátszási út nem érintett.
 */
export const streamAssetReadAccess: FieldAccess = ({ doc, id, req }) => {
  if (hasStaffOrOwnerRole(req.user)) {
    return true
  }
  const user = req.user
  if (!user) {
    return false
  }
  const productId = resolveProductId(id, doc)
  if (productId === null) {
    return false
  }
  return hasUserPurchased(user.purchases, productId)
}

/** A szülő-termék numerikus azonosítója az `id`, majd a `doc.id` argumentumból. */
function resolveProductId(id: unknown, doc: unknown): number | null {
  const fromId = toProductId(id)
  if (fromId !== null) {
    return fromId
  }
  if (typeof doc === 'object' && doc !== null && 'id' in doc) {
    return toProductId((doc as { id?: unknown }).id)
  }
  return null
}

function toProductId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? value : null
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim())
    return Number.isSafeInteger(parsed) ? parsed : null
  }
  return null
}
