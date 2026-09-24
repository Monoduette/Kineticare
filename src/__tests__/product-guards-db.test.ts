import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  OWNER_ONLY_CHANGE_MESSAGE,
  PRODUCT_CONFIRMATIONS_KEY,
  priceDropMessage,
} from '../components/admin/huf-price'
import { grantFreeCoursesToUser } from '../lib/free-course-grant'
import { requestFreeCourseAccess } from '../lib/free-course/request-access'
import { FIRST_USER_BOOTSTRAP_HEADER, FIRST_USER_BOOTSTRAP_TOKEN_ENV } from '../collections/Users'
import configPromise from '../payload.config'
import { isDatabaseAvailable } from './helpers/db-available'

/**
 * r2-termekor, valódi Payload + Postgres (a regressziókeresés mért útjai): a
 * kurzus ár-őrei az admin által küldött kérés-alakokkal. Az őrök egységtesztje
 * (product-price-guards.test.ts) stubolt sorral mér; ez a fájl azt bizonyítja,
 * hogy a Payload valódi mentési útja (a munkatárs értékének cseréje a
 * legutóbbi verzióra, a közzététel visszavonása, a lomtár és a visszaállítás,
 * a műveletnapló) mellett is az történik, amit az őrök ígérnek.
 *
 * Az admin kérései (@payloadcms/ui 3.88): autosave `?draft=true&autosave=true`;
 * közzététel `_status: 'published'`; visszavonás `?unpublishAllLocales=true`
 * `{ _status: 'draft' }`; lomtár `{ deletedAt }`; visszaállítás (alapból
 * piszkozatként) `?trash=true` a `deletedAt exists` szűrővel,
 * `{ deletedAt: null, _status: 'draft' }`.
 *
 * DB-függő: csak elérhető, migrált Postgres mellett fut (helpers/db-available;
 * CI-ban a verify job adja). Hálózat nincs: a fetch hangosan dob.
 */
const hasDb = await isDatabaseAvailable()

type Doc = Record<string, unknown> & { id: number }

interface ErrorEntry {
  path?: string
  message?: string
}

describe.skipIf(!hasDb)('kurzus ár-őrök valódi mentési úton (DB)', () => {
  /**
   * Üres adatbázisnál (a CI service-konténere mindig az) az első felhasználó
   * csak operátori bootstrap-tokennel jöhet létre (src/collections/Users.ts
   * promoteFirstUserToOwner); a webhook-audit-db.test.ts mintája. Jelölt,
   * nem titok.
   */
  const bootstrapToken = 'DUMMY-product-guards-db-bootstrap-token'
  let payload: Payload
  let owner: Doc
  let staff: Doc
  let categoryId: number
  const stamp = Date.now()
  const productIds: number[] = []
  const userIds: number[] = []

  const asUser = (user: Doc) => ({ ...user, collection: 'users' }) as never

  async function createPublished(key: string, data: Record<string, unknown> = {}): Promise<number> {
    const created = (await payload.create({
      collection: 'products',
      data: {
        sku: `DB-GUARD ${key} ${stamp}`,
        category: categoryId,
        status: 'published',
        _status: 'published',
        priceInHUFEnabled: true,
        priceInHUF: 79_500,
        ...data,
      },
      overrideAccess: true,
    })) as unknown as Doc
    productIds.push(created.id)
    return created.id
  }

  async function mainRow(id: number): Promise<Doc> {
    return (await payload.findByID({
      collection: 'products',
      id,
      depth: 0,
      draft: false,
      overrideAccess: true,
      trash: true,
    })) as unknown as Doc
  }

  async function autosave(id: number, user: Doc, data: Record<string, unknown>): Promise<void> {
    await payload.update({
      collection: 'products',
      id,
      data: { ...data, _status: 'draft' },
      draft: true,
      autosave: true,
      overrideAccess: false,
      user: asUser(user),
    })
  }

  /** A mentés eredménye: 'OK', vagy a Payload ValidationError mezőhibái. */
  async function save(
    id: number,
    user: Doc,
    data: Record<string, unknown>,
    extra: { unpublishAllLocales?: boolean } = {},
  ): Promise<'OK' | ErrorEntry[]> {
    try {
      await payload.update({
        collection: 'products',
        id,
        data,
        overrideAccess: false,
        user: asUser(user),
        ...extra,
      })
      return 'OK'
    } catch (error) {
      const errors = (error as { data?: { errors?: ErrorEntry[] } }).data?.errors
      if (!Array.isArray(errors)) throw error
      return errors.map(({ path, message }) => ({ path, message }))
    }
  }

  async function createUser(role: 'owner' | 'staff'): Promise<Doc> {
    const user = (await payload.create({
      collection: 'users',
      data: {
        email: `db-guard-${role}-${stamp}@example.test`,
        password: `Helyi-teszt-${stamp}-${role}`,
        name: role === 'owner' ? 'Teszt Tulajdonos' : 'Teszt Munkatárs',
        role,
      },
      overrideAccess: true,
      req: { headers: new Headers({ [FIRST_USER_BOOTSTRAP_HEADER]: bootstrapToken }) },
    })) as unknown as Doc
    userIds.push(user.id)
    return user
  }

  beforeAll(async () => {
    vi.stubEnv(FIRST_USER_BOOTSTRAP_TOKEN_ENV, bootstrapToken)
    vi.stubGlobal('fetch', () => {
      throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
    })
    payload = await getPayload({ config: configPromise })
    owner = await createUser('owner')
    staff = await createUser('staff')
    const category = (await payload.create({
      collection: 'categories',
      data: { title: `Ár-őr teszt ${stamp}`, slug: `ar-or-teszt-${stamp}`, type: 'product' },
      overrideAccess: true,
    })) as unknown as Doc
    categoryId = category.id
  }, 240_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    if (payload === undefined) return
    for (const id of productIds) {
      await payload.delete({ collection: 'products', id, overrideAccess: true, trash: true })
    }
    if (categoryId !== undefined) {
      await payload.delete({ collection: 'categories', id: categoryId, overrideAccess: true })
    }
    for (const id of userIds) {
      await payload.delete({ collection: 'users', id, overrideAccess: true })
    }
    await payload.db?.destroy?.()
  })

  it('H2: a munkatárs közzététele nem viszi élesbe a tulajdonos piszkozatban kivett „Fizetős kurzus” pipáját', async () => {
    const id = await createPublished('free')
    await autosave(id, owner, { priceInHUFEnabled: false })

    // A munkatárs egy elírást javít és közzétesz; a tulajdonosi mezőt a
    // Payload a piszkozat (kivett pipa) értékével tölti.
    const result = await save(id, staff, {
      shortDescription: 'Elírás javítva.',
      _status: 'published',
    })
    expect(result).toContainEqual({ path: 'priceInHUFEnabled', message: OWNER_ONLY_CHANGE_MESSAGE })

    const row = await mainRow(id)
    expect({ _status: row._status, priceInHUFEnabled: row.priceInHUFEnabled }).toEqual({
      _status: 'published',
      priceInHUFEnabled: true,
    })
    const claim = await requestFreeCourseAccess({
      payload,
      productId: id,
      name: 'Idegen Látogató',
      email: `db-guard-latogato-a-${stamp}@example.test`,
      serverUrl: null,
      env: {},
    })
    expect(claim.status).toBe('course-not-available')
  }, 120_000)

  it('H2: a munkatárs közzététele nem viszi élesbe a tulajdonos 5 Ft-os ár- és vég nélküli akció-piszkozatát', async () => {
    const id = await createPublished('price-promo')
    await autosave(id, owner, { priceInHUF: 5, promoEnabled: true, promoPriceHuf: 39_500 })

    const result = await save(id, staff, { _status: 'published' })
    expect(result).toEqual(
      expect.arrayContaining([
        { path: 'priceInHUF', message: OWNER_ONLY_CHANGE_MESSAGE },
        { path: 'promoEnd', message: OWNER_ONLY_CHANGE_MESSAGE },
      ]),
    )
    const row = await mainRow(id)
    expect({ priceInHUF: row.priceInHUF, promoEnabled: row.promoEnabled }).toEqual({
      priceInHUF: 79_500,
      promoEnabled: false,
    })
  }, 120_000)

  it('zárás elleni védelem: a munkatárs a tulajdonosi módosítás nélküli kurzust közzéteheti', async () => {
    const id = await createPublished('clean')
    expect(
      await save(id, staff, { shortDescription: 'Elírás javítva.', _status: 'published' }),
    ).toBe('OK')
  }, 120_000)

  it('H3: a közzététel visszavonása után az elütött ár (7 950 Ft) megerősítést kér', async () => {
    const id = await createPublished('unpublish-price')
    expect(await save(id, owner, { _status: 'draft' }, { unpublishAllLocales: true })).toBe('OK')
    await autosave(id, owner, { priceInHUF: 7_950 })

    expect(await save(id, owner, { _status: 'published' })).toContainEqual({
      path: 'priceInHUF',
      message: priceDropMessage('rendes', 7_950, 79_500),
    })
    expect(
      await save(id, owner, {
        _status: 'published',
        [PRODUCT_CONFIRMATIONS_KEY]: { priceInHUF: 7_950 },
      }),
    ).toBe('OK')
    expect((await mainRow(id)).priceInHUF).toBe(7_950)
  }, 120_000)

  it('H3: a közzététel visszavonása után a meglévő, vég nélküli akció újra közzétehető', async () => {
    // Az élő 4. kurzus alakja: még az őr előtt, vég nélkül közzétett akció
    // (a sort közvetlenül írjuk, ahogy a régi, őr nélküli mentés hagyta).
    const legacy = (await payload.db.create({
      collection: 'products',
      data: {
        sku: `DB-GUARD endless ${stamp}`,
        category: categoryId,
        status: 'published',
        _status: 'published',
        priceInHUFEnabled: true,
        priceInHUF: 79_500,
        promoEnabled: true,
        promoEnd: null,
        promoPriceHuf: 39_500,
      },
    })) as unknown as Doc
    productIds.push(legacy.id)

    expect(await save(legacy.id, owner, { _status: 'draft' }, { unpublishAllLocales: true })).toBe(
      'OK',
    )
    expect(await save(legacy.id, owner, { _status: 'published' })).toBe('OK')
    const row = await mainRow(legacy.id)
    expect({
      _status: row._status,
      promoEnabled: row.promoEnabled,
      promoEnd: row.promoEnd,
    }).toEqual({ _status: 'published', promoEnabled: true, promoEnd: null })
  }, 120_000)

  it('H4: lomtár + „visszaállítás piszkozatként” után a kivett pipájú fizetős kurzus nem igényelhető ingyen', async () => {
    const id = await createPublished('trash')
    await autosave(id, owner, { priceInHUFEnabled: false })
    expect(await save(id, owner, { deletedAt: new Date().toISOString() })).toBe('OK')
    await payload.update({
      collection: 'products',
      where: { and: [{ id: { equals: id } }, { deletedAt: { exists: true } }] },
      data: { deletedAt: null, _status: 'draft' },
      trash: true,
      overrideAccess: false,
      user: asUser(owner),
    })

    // A Payload validálás nélkül a piszkozatot írta a fő sorba.
    const row = await mainRow(id)
    expect({
      _status: row._status,
      status: row.status,
      priceInHUFEnabled: row.priceInHUFEnabled,
      deletedAt: row.deletedAt ?? null,
    }).toEqual({ _status: 'draft', status: 'published', priceInHUFEnabled: false, deletedAt: null })

    const claim = await requestFreeCourseAccess({
      payload,
      productId: id,
      name: 'Idegen Látogató',
      email: `db-guard-latogato-b-${stamp}@example.test`,
      serverUrl: null,
      env: {},
    })
    expect(claim.status).toBe('course-not-available')
    expect(
      await grantFreeCoursesToUser({
        payload,
        user: { id: owner.id, purchases: [] },
        productId: id,
      }),
    ).toEqual({ grantedProductIds: [], freeProductCount: 0 })
  }, 120_000)
})
