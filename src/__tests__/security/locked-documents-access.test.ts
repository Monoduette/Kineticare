import { type Access, type SanitizedConfig } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  LOCKED_DOCUMENTS_COLLECTION_SLUG,
  restrictLockedDocumentsAccess,
} from '../../lib/security/locked-documents-access'
import { isStaffOrOwner } from '../../access/isStaffOrOwner'
import configPromise from '../../payload.config'

/**
 * A GENERÁLT `payload-locked-documents` COLLECTION JOGOSULTSÁGA.
 * A dokumentum-zárakat tároló collectiont a Payload a szanitizálás közben
 * hozza létre `defaultAccess`-szel (payload/dist/locked-documents/config.js) —
 * vagyis a teljes CRUD BÁRMELY bejelentkezett felhasználónak (customer is)
 * nyitva állt a REST-felületen. Egy customer így dokumentum-zárat
 */

type Role = 'owner' | 'staff' | 'customer'

const asReq = (user: { id: number; role: Role } | null) =>
  ({ req: { user } }) as unknown as Parameters<Access>[0]

const ANONYMOUS = null
const CUSTOMER = { id: 3, role: 'customer' as const }
const STAFF = { id: 2, role: 'staff' as const }
const OWNER = { id: 1, role: 'owner' as const }

let config: SanitizedConfig

beforeAll(async () => {
  config = await configPromise
})

describe('a payload-locked-documents collection a VÉGLEGES, szanitált configban', () => {
  it('létezik (a Payload a lockolható collectionök miatt tolja be)', () => {
    expect(
      config.collections.find((collection) => collection.slug === LOCKED_DOCUMENTS_COLLECTION_SLUG),
    ).toBeDefined()
  })

  it('mind az öt access-pont az isStaffOrOwner-re van kötve', () => {
    const lockedDocuments = config.collections.find(
      (collection) => collection.slug === LOCKED_DOCUMENTS_COLLECTION_SLUG,
    )
    expect(lockedDocuments?.access.read).toBe(isStaffOrOwner)
    expect(lockedDocuments?.access.create).toBe(isStaffOrOwner)
    expect(lockedDocuments?.access.update).toBe(isStaffOrOwner)
    expect(lockedDocuments?.access.delete).toBe(isStaffOrOwner)
    expect(lockedDocuments?.access.readVersions).toBe(isStaffOrOwner)
  })

  it('viselkedés-mátrix: anonim és customer NEM, staff és owner IGEN', async () => {
    const lockedDocuments = config.collections.find(
      (collection) => collection.slug === LOCKED_DOCUMENTS_COLLECTION_SLUG,
    )
    for (const access of [
      lockedDocuments?.access.read,
      lockedDocuments?.access.create,
      lockedDocuments?.access.update,
      lockedDocuments?.access.delete,
    ]) {
      expect(await access?.(asReq(ANONYMOUS))).toBe(false)
      expect(await access?.(asReq(CUSTOMER))).toBe(false)
      expect(await access?.(asReq(STAFF))).toBe(true)
      expect(await access?.(asReq(OWNER))).toBe(true)
    }
  })

  it('a zár FAIL-LOUD: hiányzó collectionnél dob (nem nyílik vissza némán)', () => {
    const withoutLockedDocuments = {
      ...config,
      collections: config.collections.filter(
        (collection) => collection.slug !== LOCKED_DOCUMENTS_COLLECTION_SLUG,
      ),
    }
    expect(() => restrictLockedDocumentsAccess(withoutLockedDocuments)).toThrow(
      /payload-locked-documents/,
    )
  })
})
