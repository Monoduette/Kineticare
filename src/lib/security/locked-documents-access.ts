import type { SanitizedConfig } from 'payload'

import { isStaffOrOwner } from '../../access/isStaffOrOwner'

/**
 * A generált `payload-locked-documents` collection REST CRUD-jának lezárása
 * (customer ne írhassa). A Payload saját zár-olvasása db-rétegen marad.
 * Hiányzó collection → dob (ne nyíljon vissza némán).
 */
export const LOCKED_DOCUMENTS_COLLECTION_SLUG = 'payload-locked-documents'

export function restrictLockedDocumentsAccess(config: SanitizedConfig): SanitizedConfig {
  const lockedDocuments = config.collections.find(
    (collection) => collection.slug === LOCKED_DOCUMENTS_COLLECTION_SLUG,
  )

  if (!lockedDocuments) {
    throw new Error(
      `A(z) „${LOCKED_DOCUMENTS_COLLECTION_SLUG}" collection nincs a szanitált configban — ` +
        'a Payload feltehetően átnevezte vagy a lockolást alapértelmezését változtatta. ' +
        'A jogosultsági zár így NEM alkalmazható, és a zártábla bármely bejelentkezett ' +
        'felhasználó írhatná. Emberi felülvizsgálat szükséges ' +
        '(src/lib/security/locked-documents-access.ts).',
    )
  }

  // A zárszerkesztés szerkesztői művelet: staff/owner. A customer (és az anonim)
  // a REST-felületen ne lássa és ne írhassa a zárakat.
  lockedDocuments.access.read = isStaffOrOwner
  lockedDocuments.access.create = isStaffOrOwner
  lockedDocuments.access.update = isStaffOrOwner
  lockedDocuments.access.delete = isStaffOrOwner
  lockedDocuments.access.readVersions = isStaffOrOwner

  return config
}
