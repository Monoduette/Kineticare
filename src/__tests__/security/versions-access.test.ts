import { executeAccess, type Access, type PayloadRequest, type SanitizedConfig } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import configPromise from '../../payload.config'

/**
 * A VERZIÓ-VÉGPONTOK (`/api/<collection>/versions…`) JOGOSULTSÁGA (S2/d).
 * A drafts-szal működő collectionök két külön REST-végpontot kapnak:
 * GET /api/<slug>/versions           (findVersions)
 * GET /api/<slug>/versions/:id       (findVersionByID; a :id a VERZIÓ azonosítója)
 * Ezek NEM az `access.read`-en, hanem az `access.readVersions`-ön múlnak
 */

type Role = 'owner' | 'staff' | 'customer'

const asAccessArgs = (user: { id: number; role: Role } | null) =>
  ({ req: { user } }) as unknown as Parameters<Access>[0]

const asReq = (user: { id: number; role: Role } | null) =>
  ({ user }) as unknown as PayloadRequest

/**
 * A HIÁNYZÓ access-szabály. A Payload típusa `Access`-t vár, a FUTÁSIDEJŰ
 * `executeAccess` viszont pontosan az `undefined` esetet kezeli le a
 * „bejelentkezett = szabad" ággal — a negatív kontroll éppen ezt méri, ezért a
 * cast szándékos és szűk (`any` nélkül).
 */
const MISSING_ACCESS = undefined as unknown as Access

const CUSTOMER = { id: 3, role: 'customer' as const }
const STAFF = { id: 2, role: 'staff' as const }
const OWNER = { id: 1, role: 'owner' as const }

let config: SanitizedConfig

beforeAll(async () => {
  config = await configPromise
})

/**
 * A drafts-os collectionök a CONFIGBÓL, nem kézzel felsorolva: ha egy későbbi
 * változás új drafts-os collectiont hoz be `readVersions` nélkül, ez a fájl
 * elbukik, nem hallgat.
 */
const draftCollections = (): SanitizedConfig['collections'] =>
  (config.collections ?? []).filter((collection) => Boolean(collection.versions))

describe('NEGATÍV KONTROLL — a Payload saját executeAccess-e hiányzó szabálynál', () => {
  it('hiányzó access-függvénnyel a BEJELENTKEZETT customer bejut', async () => {
    await expect(executeAccess({ req: asReq(CUSTOMER) }, MISSING_ACCESS)).resolves.toBe(true)
  })

  it('anonim kérőt ugyanez elutasít (tehát a rés csak a bejelentkezetteké volt)', async () => {
    await expect(executeAccess({ req: asReq(null) }, MISSING_ACCESS)).rejects.toThrow()
  })
})

describe('readVersions a VÉGLEGES, szanitált configban', () => {
  it('van legalább egy drafts-os collection (a mérés értelmes)', () => {
    expect(draftCollections().length).toBeGreaterThan(0)
    // A products a fizetős tartalom hordozója — ennek MINDIG a listában kell lennie.
    expect(draftCollections().map((collection) => collection.slug)).toContain('products')
  })

  it('MINDEN drafts-os collectionnek van readVersions szabálya', () => {
    for (const collection of draftCollections()) {
      expect(typeof collection.access.readVersions, collection.slug).toBe('function')
    }
  })

  it('a szabály anonim és customer felé zár, staff és owner felé nyit', async () => {
    for (const collection of draftCollections()) {
      const readVersions = collection.access.readVersions
      expect(await readVersions(asAccessArgs(null)), `${collection.slug}/anonim`).toBe(false)
      expect(await readVersions(asAccessArgs(CUSTOMER)), `${collection.slug}/customer`).toBe(false)
      expect(await readVersions(asAccessArgs(STAFF)), `${collection.slug}/staff`).toBe(true)
      expect(await readVersions(asAccessArgs(OWNER)), `${collection.slug}/owner`).toBe(true)
    }
  })

  /**
   * A szabály a Payload SAJÁT access-futtatóján át is helyes: a customer
   * kérése `Forbidden`-nel áll meg, a staffé továbbmegy. Ez zárja a kört a
   * fenti negatív kontrollal.
   */
  it('a Payload executeAccess-én át a customer Forbidden-t kap, a staff nem', async () => {
    for (const collection of draftCollections()) {
      await expect(
        executeAccess({ req: asReq(CUSTOMER) }, collection.access.readVersions),
      ).rejects.toThrow()
      await expect(
        executeAccess({ req: asReq(STAFF) }, collection.access.readVersions),
      ).resolves.toBe(true)
    }
  })
})
