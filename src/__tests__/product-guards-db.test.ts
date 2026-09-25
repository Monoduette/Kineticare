import { sql, type SQL } from '@payloadcms/db-postgres/drizzle'
import { getPayload, type Payload } from 'payload'
import type { Client as PgClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  FREE_COURSE_GUARD_MESSAGE,
  OWNER_ONLY_CHANGE_MESSAGE,
  PRODUCT_CONFIRMATIONS_KEY,
  priceDropMessage,
} from '../components/admin/huf-price'
import { grantFreeCoursesToUser } from '../lib/free-course-grant'
import { requestFreeCourseAccess } from '../lib/free-course/request-access'
import { FIRST_USER_BOOTSTRAP_HEADER, FIRST_USER_BOOTSTRAP_TOKEN_ENV } from '../collections/Users'
import configPromise from '../payload.config'
import { unknownPriceReferenceMessage } from '../plugins/ecommerce'
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

/** A postgres-adapter kérés-tranzakciós felülete (a rev4 visszaállítás-kapcsolatához). */
interface SqlAdapter {
  execute: (args: { db: unknown; sql: SQL }) => Promise<{ rows: Array<Record<string, unknown>> }>
  sessions: Record<string, { db: unknown } | undefined>
}

async function backendPid(client: PgClient): Promise<number> {
  const result = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
  return result.rows[0].pid
}

/**
 * Hány kérés vár a `holderPid` kapcsolat zárja mögött: közvetlenül, vagy egy
 * ugyanerre a zárra előtte várakozó kérés mögött (a második sorzár-várakozót
 * a Postgres az elsőhöz köti, nem a tartóhoz). Csak ezt a láncot számolja, így
 * egy párhuzamosan futó DB-teszt zárvárakozása nem teljesítheti idő előtt.
 *
 * Az `observer` külön, tranzakción kívüli kapcsolat legyen: a Postgres a
 * `pg_stat_activity` tartalmát tranzakciónként egyszer olvassa be, így a
 * zárat tartó tranzakcióból nézve a később nyílt kapcsolatok nem látszanának.
 */
async function waitersBehind(observer: PgClient, holderPid: number): Promise<number> {
  const result = await observer.query<{ n: number }>(
    `WITH RECURSIVE behind(pid) AS (
       SELECT pid FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))
       UNION
       SELECT a.pid FROM pg_stat_activity a JOIN behind b ON b.pid = ANY(pg_blocking_pids(a.pid))
     )
     SELECT count(*)::int AS n FROM behind`,
    [holderPid],
  )
  return result.rows[0].n
}

/**
 * Megvárja, hogy legalább `count` kérés várjon a `holderPid` mögött. `false`,
 * ha közben a `gaveUp` igazzá vált (a várt kérés várakozás nélkül lefutott).
 */
async function untilWaitersBehind(
  observer: PgClient,
  holderPid: number,
  count: number,
  gaveUp: () => boolean = () => false,
): Promise<boolean> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if ((await waitersBehind(observer, holderPid)) >= count) return true
    if (gaveUp()) return false
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Nem várakozik ${count} kérés a(z) ${holderPid} kapcsolat zárja mögött.`)
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

  /**
   * A közzététel visszavonásának jelzője: a Local API boolean-t, a REST a
   * lekérdezés szövegét adja át (`?unpublishAllLocales=true`: 'true').
   */
  type UnpublishFlag = { unpublishAllLocales?: boolean | 'true' }

  /** A mentés eredménye: 'OK', vagy a Payload ValidationError mezőhibái. */
  async function save(
    id: number,
    user: Doc,
    data: Record<string, unknown>,
    extra: UnpublishFlag = {},
  ): Promise<'OK' | ErrorEntry[]> {
    try {
      await payload.update({
        collection: 'products',
        id,
        data,
        overrideAccess: false,
        user: asUser(user),
        ...(extra as { unpublishAllLocales?: boolean }),
      })
      return 'OK'
    } catch (error) {
      const errors = (error as { data?: { errors?: ErrorEntry[] } }).data?.errors
      if (!Array.isArray(errors)) throw error
      return errors.map(({ path, message }) => ({ path, message }))
    }
  }

  /**
   * Tömeges (where-es) mentés, ahogy a REST `PATCH /api/products?where…` és az
   * admin „visszaállítás” gombja küldi (@payloadcms/ui RestoreButton:
   * `?trash=true`, a `deletedAt exists` szűrővel). A tömeges mentés nem dob:
   * a dokumentumonkénti hibát az `errors` tömbben adja.
   */
  async function saveWhere(
    id: number,
    user: Doc,
    data: Record<string, unknown>,
    options: UnpublishFlag & { trashed?: boolean } = {},
  ): Promise<'OK' | string[]> {
    const { trashed = false, ...flag } = options
    const result = await payload.update({
      collection: 'products',
      where: trashed
        ? { and: [{ id: { equals: id } }, { deletedAt: { exists: true } }] }
        : { id: { equals: id } },
      data,
      trash: trashed,
      overrideAccess: false,
      user: asUser(user),
      ...(flag as { unpublishAllLocales?: boolean }),
    })
    const errors = result.errors.map((entry) => String(entry.message))
    if (errors.length > 0) return errors
    // A 0 találat nem „siker”: a szűrő nem az elvárt sort érte el.
    return result.docs.length === 1 ? 'OK' : [`${result.docs.length} dokumentum módosult`]
  }

  /** Egy idegen, névtelen látogató ingyenes igénylése (a nyilvános végpont útja). */
  function claimAsStranger(id: number, tag: string) {
    return requestFreeCourseAccess({
      payload,
      productId: id,
      name: 'Idegen Látogató',
      email: `db-guard-latogato-${tag}-${stamp}@example.test`,
      serverUrl: null,
      env: {},
    })
  }

  /** A kurzus közzétett verziója, ahogy az admin „Verziók” fülén látszik. */
  async function publishedVersionId(id: number): Promise<number | string> {
    const { docs } = await payload.findVersions({
      collection: 'products',
      where: { parent: { equals: id } },
      sort: 'createdAt',
      depth: 0,
      limit: 100,
      overrideAccess: true,
    })
    const published = docs.find(
      (entry) => (entry.version as { _status?: unknown })._status === 'published',
    )
    if (published === undefined) throw new Error(`Nincs közzétett verzió: ${id}`)
    return published.id
  }

  /**
   * Az admin „Visszaállítás” gombja (@payloadcms/ui Restore: POST
   * `/api/products/versions/<id>?draft=false`): a verzió-visszaállítás
   * közzétettként.
   */
  async function restoreVersion(versionId: number | string, user: Doc): Promise<void> {
    await payload.restoreVersion({
      collection: 'products',
      id: versionId as never,
      draft: false,
      overrideAccess: false,
      user: asUser(user),
    })
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

  /*
   * rev1: a Payload validálás nélkül írja a fő sort a közzététel
   * visszavonásakor, a lomtárba helyezéskor és a `_status: 'published'`
   * nélküli visszaállításkor (payload/dist/collections/operations/utilities/
   * update.js, skipValidation). Az admin ezeket `_status: 'draft'`-tal vagy
   * `_status` nélkül küldi; a munkatárs kézzel összerakott kérése viszont
   * `_status: 'published'`-et is küldhet. Egyik alak sem hagyhat élő sort.
   */
  it('rev1 (PROBE1, BRK-1a/1b): a visszavonás jelzőjével küldött `_status: published` piszkozat marad', async () => {
    const cases = [
      {
        key: 'unpub-free',
        draft: { priceInHUFEnabled: false },
        send: (id: number) =>
          save(id, staff, { _status: 'published' }, { unpublishAllLocales: true }),
      },
      {
        // A REST a `?unpublishAllLocales=true` lekérdezést szövegként adja át.
        key: 'unpub-price-promo',
        draft: { priceInHUF: 5, promoEnabled: true, promoPriceHuf: 39_500 },
        send: (id: number) =>
          save(id, staff, { _status: 'published' }, { unpublishAllLocales: 'true' }),
      },
      {
        key: 'unpub-bulk-free',
        draft: { priceInHUFEnabled: false },
        send: (id: number) =>
          saveWhere(id, staff, { _status: 'published' }, { unpublishAllLocales: 'true' }),
      },
    ]
    for (const { key, draft, send } of cases) {
      const id = await createPublished(key)
      await autosave(id, owner, draft)
      expect(await send(id), key).toBe('OK')
      expect((await mainRow(id))._status, key).toBe('draft')
      if (draft.priceInHUFEnabled === false) {
        expect((await claimAsStranger(id, key)).status, key).toBe('course-not-available')
      }
    }
  }, 180_000)

  it('rev1 (PROBE2/3, BRK-2a/2b): a `_status: published`-del küldött lomtár után a közzétett visszaállítás az őrökön akad fenn', async () => {
    // A lomtárban álló sor `_status: 'published'`-es mentése is validálás
    // nélküli: a Payload a hiányzó `deletedAt`-et a legutóbbi verzióból tölti.
    const craftedTrash = (id: number) =>
      save(id, staff, { deletedAt: new Date().toISOString(), _status: 'published' })
    const publishWhileTrashed = async (id: number) => {
      expect(await save(id, staff, { deletedAt: new Date().toISOString() })).toBe('OK')
      return saveWhere(id, staff, { _status: 'published' }, { trashed: true })
    }
    const cases = [
      { key: 'trash-pub-5', draft: { priceInHUF: 5 }, field: 'Ár (Ft)', trash: craftedTrash },
      {
        key: 'trash-pub-ar-2',
        draft: { priceInHUF: 7_950 },
        field: 'Ár (Ft)',
        trash: craftedTrash,
      },
      {
        key: 'trash-pub-promo',
        draft: { promoEnabled: true, promoPriceHuf: 39_500 },
        field: 'Akció vége',
        trash: craftedTrash,
      },
      {
        key: 'kukaban-kozzeteve',
        draft: { priceInHUF: 7_950 },
        field: 'Ár (Ft)',
        trash: publishWhileTrashed,
      },
    ]
    for (const { key, draft, field, trash } of cases) {
      const id = await createPublished(key)
      await autosave(id, owner, draft)
      expect(await trash(id), key).toBe('OK')
      expect((await mainRow(id))._status, key).toBe('draft')

      const restored = await saveWhere(
        id,
        staff,
        { deletedAt: null, _status: 'published' },
        { trashed: true },
      )
      expect(restored, key).toEqual([expect.stringContaining(field)])
      const row = await mainRow(id)
      expect({ key, trashed: Boolean(row.deletedAt) }).toEqual({ key, trashed: true })
    }
  }, 180_000)

  it('rev1 (PROBE4, BRK-2c; PROBE5 kontroll): lomtár, majd `_status` nélküli visszaállítás után a kurzus piszkozat, nem igényelhető ingyen', async () => {
    async function trashAfterUntick(key: string, extra: Record<string, unknown>) {
      const id = await createPublished(key)
      await autosave(id, owner, { priceInHUFEnabled: false })
      expect(await save(id, staff, { deletedAt: new Date().toISOString(), ...extra }), key).toBe(
        'OK',
      )
      return id
    }
    const trashed: Array<[string, () => Promise<number>]> = [
      ['restore-crafted', () => trashAfterUntick('restore-crafted', { _status: 'published' })],
      ['restore-admin', () => trashAfterUntick('restore-admin', {})],
      [
        // A javítás előtt így lomtárba tett sor: közzétett státusz, a kivett
        // pipa, verzió nélkül (a Payload ilyenkor a fő sort veszi legutóbbinak).
        'restore-legacy',
        async () => {
          const legacy = (await payload.db.create({
            collection: 'products',
            data: {
              sku: `DB-GUARD restore-legacy ${stamp}`,
              category: categoryId,
              status: 'published',
              _status: 'published',
              priceInHUFEnabled: false,
              priceInHUF: 79_500,
              deletedAt: new Date().toISOString(),
            },
          })) as unknown as Doc
          productIds.push(legacy.id)
          return legacy.id
        },
      ],
    ]
    for (const [key, prepare] of trashed) {
      const id = await prepare()
      expect(await saveWhere(id, staff, { deletedAt: null }, { trashed: true }), key).toBe('OK')
      const row = await mainRow(id)
      expect({ key, _status: row._status, deletedAt: row.deletedAt ?? null }).toEqual({
        key,
        _status: 'draft',
        deletedAt: null,
      })
      expect((await claimAsStranger(id, key)).status, key).toBe('course-not-available')
    }
  }, 180_000)

  it('zárás elleni védelem (rev1): lomtár után a változatlan kurzus, a régi vég nélküli akcióval is, közzétettként visszaállítható', async () => {
    // A lomtár mostantól mindig piszkozat-sort hagy, így a „visszaállítás
    // közzétettként” a napló lomtár előtti sorához mér (az élő 4. kurzus alakja).
    const legacy = (await payload.db.create({
      collection: 'products',
      data: {
        sku: `DB-GUARD trash-endless ${stamp}`,
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

    expect(await save(legacy.id, staff, { deletedAt: new Date().toISOString() })).toBe('OK')
    expect(
      await saveWhere(
        legacy.id,
        staff,
        { deletedAt: null, _status: 'published' },
        { trashed: true },
      ),
    ).toBe('OK')
    const row = await mainRow(legacy.id)
    expect({
      _status: row._status,
      deletedAt: row.deletedAt ?? null,
      priceInHUF: row.priceInHUF,
      promoEnabled: row.promoEnabled,
      promoEnd: row.promoEnd ?? null,
    }).toEqual({
      _status: 'published',
      deletedAt: null,
      priceInHUF: 79_500,
      promoEnabled: true,
      promoEnd: null,
    })
  }, 120_000)

  it('rev1 (a napló szűrője): sok lomtár + piszkozatként visszaállítás kör után is a legutóbb közzétett ár a mérce', async () => {
    // Minden kör két, közzétett oldal nélküli naplóbejegyzést ír; 11 kör (22
    // bejegyzés) kitolta a korábbi, 20-as ablakból a visszavonás bejegyzését, és
    // a mérce az elütött árat hordozó piszkozat-sor lett. A lekérdezés lapozva
    // megy végig rajtuk (rev2: a lánc ellenőrzéséhez ezek is kellenek, a
    // naplózott lomtár és visszaállítás a láncot nem szakítja meg).
    const id = await createPublished('lookback')
    expect(await save(id, owner, { _status: 'draft' }, { unpublishAllLocales: true })).toBe('OK')
    await autosave(id, owner, { priceInHUF: 7_950 })
    for (let round = 0; round < 11; round += 1) {
      expect(await save(id, staff, { deletedAt: new Date().toISOString() })).toBe('OK')
      expect(
        await saveWhere(id, staff, { deletedAt: null, _status: 'draft' }, { trashed: true }),
      ).toBe('OK')
    }
    expect((await mainRow(id)).priceInHUF).toBe(7_950)

    expect(await save(id, owner, { _status: 'published' })).toContainEqual({
      path: 'priceInHUF',
      message: priceDropMessage('rendes', 7_950, 79_500),
    })
  }, 180_000)

  it('rev2 (a napló lapozása): 20-nál több, lomtárban álló közzétett oldalú bejegyzés mögött is megtalálja a közzétett árat', async () => {
    // A rev1 előtti, `_status: 'published'`-del küldött lomtár-írások alakja: a
    // bejegyzés közzétett oldala lomtárban áll (mérce nem lehet). 21 ilyen
    // bejegyzés az első lapra nem fér, a visszavonás előtti közzétett sor a
    // második lapon van.
    // Az elütött ár autosave-je a visszavonás ELŐTT: a visszavonás a
    // piszkozatot (7 950) írja a fő sorba, így a napló nélkül nincs mihez mérni.
    const id = await createPublished('paging')
    await autosave(id, owner, { priceInHUF: 7_950 })
    expect(await save(id, owner, { _status: 'draft' }, { unpublishAllLocales: true })).toBe('OK')
    const row = await mainRow(id)
    expect(row.priceInHUF).toBe(7_950)
    // rev2: a beszúrt bejegyzések a fő sor írási idejét hordozzák, így a lánc
    // (before/after `updatedAt`) hiánytalan marad, és a teszt a lapozást méri.
    const poisoned = {
      _status: 'published',
      priceInHUFEnabled: true,
      priceInHUF: 7_950,
      deletedAt: new Date().toISOString(),
      updatedAt: row.updatedAt,
    }
    for (let index = 0; index < 21; index += 1) {
      await payload.create({
        collection: 'audit-logs',
        data: {
          action: 'trash',
          entityType: 'products',
          entityId: String(id),
          before: { ...poisoned, _status: 'draft', deletedAt: null },
          after: poisoned,
        },
        overrideAccess: true,
      })
    }
    expect(await save(id, owner, { _status: 'published' })).toContainEqual({
      path: 'priceInHUF',
      message: priceDropMessage('rendes', 7_950, 79_500),
    })
  }, 180_000)

  /*
   * rev2: a verzió-visszaállítás (restoreVersion) a munkatárs által nem
   * írható mezőket nem validálja és nem írja; a fő sorban marad, ami ott állt.
   * Visszavonás vagy lomtár után ez a tulajdonos meg nem erősített piszkozata.
   */
  it('rev2 (BRK-R1, R1b, R1c): a munkatárs verzió-visszaállítása nem élesíti a tulajdonos kivett pipáját', async () => {
    const cases: Array<[string, (id: number) => Promise<void>]> = [
      [
        'rv-staff-unpub',
        async (id) => {
          expect(await save(id, staff, { _status: 'draft' }, { unpublishAllLocales: true })).toBe(
            'OK',
          )
        },
      ],
      [
        'rv-trash',
        async (id) => {
          expect(await save(id, staff, { deletedAt: new Date().toISOString() })).toBe('OK')
          expect(
            await saveWhere(id, staff, { deletedAt: null, _status: 'draft' }, { trashed: true }),
          ).toBe('OK')
        },
      ],
      [
        'rv-owner-unpub',
        async (id) => {
          expect(await save(id, owner, { _status: 'draft' }, { unpublishAllLocales: true })).toBe(
            'OK',
          )
        },
      ],
    ]
    for (const [key, takeDown] of cases) {
      const id = await createPublished(key)
      await autosave(id, owner, { priceInHUFEnabled: false })
      await takeDown(id)
      await restoreVersion(await publishedVersionId(id), staff)
      const row = await mainRow(id)
      expect({ key, _status: row._status }).toEqual({ key, _status: 'draft' })
      expect((await claimAsStranger(id, key)).status, key).toBe('course-not-available')
    }
  }, 240_000)

  it('rev3 (BRK-RACE): a párhuzamos visszavonás és munkatársi visszaállítás nem hagy élő, ingyenes sort', async () => {
    // A két admin-kérés sorrendjét egy külső kapcsolat sorzára rögzíti: a
    // tulajdonos visszavonása áll be elsőnek a sorra, a munkatárs
    // visszaállítása másodiknak. READ COMMITTED mellett a visszaállítás
    // ellenőrzése zár nélkül még az élő sort látta, az írása pedig a
    // visszavonás után `_status: 'published'`-et tett a tulajdonos kivett
    // pipája mellé (mérve a7acf0b-n: élő, ingyenes, 79 500 Ft-os kurzus).
    const pg = await import('pg')
    const client = new pg.default.Client({ connectionString: process.env.DATABASE_URI })
    const observer = new pg.default.Client({ connectionString: process.env.DATABASE_URI })
    await client.connect()
    await observer.connect()
    try {
      const id = await createPublished('race')
      await autosave(id, owner, { priceInHUFEnabled: false })
      const versionId = await publishedVersionId(id)
      const holderPid = await backendPid(client)

      await client.query('BEGIN')
      await client.query('SELECT id FROM products WHERE id = $1 FOR UPDATE', [id])
      const unpublish = save(id, owner, { _status: 'draft' }, { unpublishAllLocales: true })
      expect(await untilWaitersBehind(observer, holderPid, 1)).toBe(true)
      const restore = restoreVersion(versionId, staff).then(
        () => 'OK',
        (error: unknown) => String(error),
      )
      expect(await untilWaitersBehind(observer, holderPid, 2)).toBe(true)
      await client.query('COMMIT')

      expect(await unpublish).toBe('OK')
      expect(await restore).toBe('OK')
      const row = await mainRow(id)
      expect({ _status: row._status, priceInHUFEnabled: row.priceInHUFEnabled }).toEqual({
        _status: 'draft',
        priceInHUFEnabled: false,
      })
      expect((await claimAsStranger(id, 'race')).status).toBe('course-not-available')
    } finally {
      await client.query('ROLLBACK').catch(() => undefined)
      await client.end()
      await observer.end()
    }
  }, 120_000)

  it('rev4 (BRK-RACE, fordított sorrend): a munkatárs visszaállításának sorzárja a commitjáig tart, a visszavonás kivárja', async () => {
    // A munkatárs visszaállítása zárol elsőnek, és még az élő sort olvassa.
    // Ha a zár nem a visszaállítás tranzakciójában tartana, a tulajdonos
    // visszavonása a zárolás és a visszaállítás írása között commitolna, és a
    // visszaállítás `_status: 'published'`-je a kivett pipa mellé kerülne
    // (élő, ingyenes kurzus). A visszaállítást a fő sor írása ELŐTT tartjuk
    // fel: ekkor a sort csak a hook `SELECT … FOR NO KEY UPDATE`-je zárolhatja, tehát
    // a visszavonás csak arra várhat.
    const pg = await import('pg')
    const observer = new pg.default.Client({ connectionString: process.env.DATABASE_URI })
    await observer.connect()
    const adapter = payload.db as unknown as SqlAdapter
    const updateOne = payload.db.updateOne
    let releaseRestore: () => void = () => undefined
    const restoreMayWrite = new Promise<void>((resolve) => {
      releaseRestore = resolve
    })
    let reportRestorePid: (pid: number) => void = () => undefined
    const restorePid = new Promise<number>((resolve) => {
      reportRestorePid = resolve
    })
    const spy = vi.spyOn(payload.db, 'updateOne').mockImplementation(async (args) => {
      if (args.collection === 'products' && args.req?.context?.isRestoringVersion === true) {
        const session = adapter.sessions[String(await args.req.transactionID)]
        const { rows } = await adapter.execute({
          db: session?.db,
          sql: sql`SELECT pg_backend_pid() AS pid`,
        })
        reportRestorePid(Number(rows[0]?.pid))
        await restoreMayWrite
      }
      return updateOne.call(payload.db, args)
    })
    let restore: Promise<string> | undefined
    let unpublish: Promise<'OK' | ErrorEntry[] | string> | undefined
    try {
      const id = await createPublished('race-reverse')
      await autosave(id, owner, { priceInHUFEnabled: false })
      const versionId = await publishedVersionId(id)

      restore = restoreVersion(versionId, staff).then(
        () => 'OK',
        (error: unknown) => String(error),
      )
      const holderPid = await Promise.race([
        restorePid,
        restore.then((outcome) => {
          throw new Error(`A visszaállítás a fő sor írása előtt véget ért: ${outcome}`)
        }),
      ])
      let unpublishSettled = false
      unpublish = save(id, owner, { _status: 'draft' }, { unpublishAllLocales: true }).then(
        (outcome) => outcome,
        (error: unknown) => String(error),
      )
      void unpublish.then(() => {
        unpublishSettled = true
      })
      expect(
        await untilWaitersBehind(observer, holderPid, 1, () => unpublishSettled),
        'a tulajdonos visszavonása nem várta meg a visszaállítás sorzárját',
      ).toBe(true)

      releaseRestore()
      expect(await restore).toBe('OK')
      expect(await unpublish).toBe('OK')
      const row = await mainRow(id)
      expect({ _status: row._status, priceInHUFEnabled: row.priceInHUFEnabled }).toEqual({
        _status: 'draft',
        priceInHUFEnabled: false,
      })
      expect((await claimAsStranger(id, 'race-reverse')).status).toBe('course-not-available')
    } finally {
      releaseRestore()
      await restore
      await unpublish
      spy.mockRestore()
      await observer.end()
    }
  }, 120_000)

  it('rev2 (BRK-R2a): a munkatárs verzió-visszaállítása nem élesíti a tulajdonos 5 Ft-os ár-piszkozatát', async () => {
    const id = await createPublished('rv-5ft')
    await autosave(id, owner, { priceInHUF: 5 })
    expect(await save(id, staff, { _status: 'draft' }, { unpublishAllLocales: true })).toBe('OK')
    await restoreVersion(await publishedVersionId(id), staff)
    const row = await mainRow(id)
    expect({ _status: row._status, priceInHUF: row.priceInHUF }).toEqual({
      _status: 'draft',
      priceInHUF: 5,
    })
    // A piszkozatot a szokásos közzététel sem viheti ki a tulajdonos nélkül.
    expect(await save(id, staff, { _status: 'published' })).toContainEqual({
      path: 'priceInHUF',
      message: OWNER_ONLY_CHANGE_MESSAGE,
    })
  }, 120_000)

  it('zárás elleni védelem (rev2): a tulajdonos visszaállítása validál és élesít; a munkatársé élő kurzuson is közzétesz', async () => {
    // A tulajdonos a visszavonás után a közzétett verziót állítja vissza: a
    // verzió értékei (pipa bent, 79 500 Ft) validálva élesednek.
    const id = await createPublished('rv-owner')
    await autosave(id, owner, { priceInHUFEnabled: false })
    expect(await save(id, owner, { _status: 'draft' }, { unpublishAllLocales: true })).toBe('OK')
    await restoreVersion(await publishedVersionId(id), owner)
    const row = await mainRow(id)
    expect({ _status: row._status, priceInHUFEnabled: row.priceInHUFEnabled }).toEqual({
      _status: 'published',
      priceInHUFEnabled: true,
    })

    // Élő kurzuson a munkatárs egy korábbi szöveg-verziót állít vissza: élő marad.
    const live = await createPublished('rv-staff-live')
    const versionId = await publishedVersionId(live)
    expect(await save(live, staff, { shortDescription: 'Új leírás.', _status: 'published' })).toBe(
      'OK',
    )
    await restoreVersion(versionId, staff)
    const liveRow = await mainRow(live)
    expect({ _status: liveRow._status, priceInHUF: liveRow.priceInHUF }).toEqual({
      _status: 'published',
      priceInHUF: 79_500,
    })
  }, 120_000)

  it('rev2 (BRK-U1): visszavonás után a rendelés nélküli fizetős kurzus nem lesz ingyenes megerősítés nélkül', async () => {
    const id = await createPublished('unpub-noorders')
    await autosave(id, owner, { priceInHUFEnabled: false, priceInHUF: null })
    expect(await save(id, owner, { _status: 'published' })).not.toBe('OK')
    expect(await save(id, staff, { _status: 'draft' }, { unpublishAllLocales: true })).toBe('OK')

    expect(await save(id, staff, { _status: 'published' })).toContainEqual({
      path: 'priceInHUFEnabled',
      message: OWNER_ONLY_CHANGE_MESSAGE,
    })
    // A tulajdonosnak is megerősítést kér: a legutóbb közzétett ár 79 500 Ft volt.
    expect(await save(id, owner, { _status: 'published' })).toContainEqual({
      path: 'priceInHUFEnabled',
      message: FREE_COURSE_GUARD_MESSAGE,
    })
    expect((await claimAsStranger(id, 'unpub-noorders')).status).toBe('course-not-available')
  }, 120_000)

  it('rev2 (BRK-D1): az admin piszkozat-másolata a munkatárs közzétételével sem lesz ingyenes, élő kurzus', async () => {
    // A tulajdonos piszkozatában a pipa és az ár is üres; a másolatnak nincs
    // közzétett múltja és rendelése, így az „ár és vásárló nélkül” kivétel a
    // munkatársnál ingyenes, élő másolatot adott.
    const id = await createPublished('dup2-source')
    await autosave(id, owner, { priceInHUFEnabled: false, priceInHUF: null })
    expect(await save(id, owner, { _status: 'published' })).not.toBe('OK')
    const copy = (await payload.duplicate({
      collection: 'products',
      id,
      draft: true,
      data: { _status: 'draft' },
      overrideAccess: false,
      user: asUser(staff),
    })) as unknown as Doc
    productIds.push(copy.id)

    expect(await save(copy.id, staff, { _status: 'published' })).toContainEqual({
      path: 'priceInHUFEnabled',
      message: OWNER_ONLY_CHANGE_MESSAGE,
    })
    expect((await mainRow(copy.id))._status).toBe('draft')
    expect((await claimAsStranger(copy.id, 'dup2')).status).toBe('course-not-available')
  }, 120_000)

  it('rev1 (duplikálás, `?draft=false`): a munkatárs azonnal közzétett másolata nem viszi élesbe a tulajdonos kivett pipáját', async () => {
    // A duplikálás a munkatárs által nem írható mezőt a forrás legutóbbi
    // verziójából (a tulajdonos piszkozatából) tölti; `?draft=false` +
    // `_status: 'published'` mellett a másolat azonnal élő, ingyenes kurzus lett
    // volna a fizetős kurzus tartalmával.
    const id = await createPublished('dup-source')
    await autosave(id, owner, { priceInHUFEnabled: false })

    async function duplicateAsStaff(draft: boolean): Promise<'OK' | ErrorEntry[]> {
      try {
        const copy = (await payload.duplicate({
          collection: 'products',
          id,
          draft,
          data: { _status: draft ? 'draft' : 'published' },
          overrideAccess: false,
          user: asUser(staff),
        })) as unknown as Doc
        productIds.push(copy.id)
        return 'OK'
      } catch (error) {
        const errors = (error as { data?: { errors?: ErrorEntry[] } }).data?.errors
        if (!Array.isArray(errors)) throw error
        return errors.map(({ path, message }) => ({ path, message }))
      }
    }

    expect(await duplicateAsStaff(false)).toContainEqual({
      path: 'priceInHUFEnabled',
      message: OWNER_ONLY_CHANGE_MESSAGE,
    })
    // Az admin Másolás gombja (piszkozat-másolat) a munkatársnak is működik.
    expect(await duplicateAsStaff(true)).toBe('OK')
  }, 120_000)
  /**
   * PR #305 (Codex P1): a legutóbb közzétett ár ismeretlen. A tulajdonos a
   * 79 500 Ft-os élő kurzuson elüt egy 7 950 Ft-os árat (autosave, piszkozat),
   * majd visszavonja a közzétételt: a fő sorba a piszkozat kerül, benne a
   * 7 950 Ft. Ha a visszavonás előtti közzétett állapot a naplóból nem
   * olvasható ki, a piszkozat-sor önmagához mérve „nem csökkent”, és a hibás ár
   * megerősítés nélkül ment volna élesbe.
   */
  async function unpublishWithMistypedPrice(key: string): Promise<number> {
    const id = await createPublished(key)
    await autosave(id, owner, { priceInHUF: 7_950 })
    expect(await save(id, owner, { _status: 'draft' }, { unpublishAllLocales: true })).toBe('OK')
    const row = await mainRow(id)
    expect({ _status: row._status, priceInHUF: row.priceInHUF }).toEqual({
      _status: 'draft',
      priceInHUF: 7_950,
    })
    return id
  }

  /**
   * A 7 950 Ft csak a tulajdonos megerősítésével élesedik: a munkatárs
   * elutasítást kap, a tulajdonos megerősítés nélküli közzététele az ár-mezőn
   * akad fenn (alapból ismeretlen mércével), a megerősített átmegy.
   */
  async function expectConfirmationRequired(
    id: number,
    ownerMessage: string = unknownPriceReferenceMessage('rendes', 7_950),
  ): Promise<void> {
    expect(await save(id, staff, { _status: 'published' })).toContainEqual({
      path: 'priceInHUF',
      message: OWNER_ONLY_CHANGE_MESSAGE,
    })
    expect(await save(id, owner, { _status: 'published' })).toContainEqual({
      path: 'priceInHUF',
      message: ownerMessage,
    })
    expect((await mainRow(id))._status).toBe('draft')
    expect(
      await save(id, owner, {
        _status: 'published',
        [PRODUCT_CONFIRMATIONS_KEY]: { priceInHUF: 7_950 },
      }),
    ).toBe('OK')
    const row = await mainRow(id)
    expect({ _status: row._status, priceInHUF: row.priceInHUF }).toEqual({
      _status: 'published',
      priceInHUF: 7_950,
    })
  }

  it('PR #305 (Codex P1): napló nélküli régi kurzus visszavonás után az elütött árat csak a tulajdonos megerősítésével teszi közzé', async () => {
    const id = await unpublishWithMistypedPrice('legacy-no-audit')
    // A régi kurzus alakja: a műveletnapló kurzus-bejegyzései előtt készült és
    // vonták vissza, így róla semmilyen bejegyzés nincs.
    await payload.db.deleteMany({
      collection: 'audit-logs',
      where: {
        and: [{ entityType: { equals: 'products' } }, { entityId: { equals: String(id) } }],
      },
    })
    await expectConfirmationRequired(id)
  }, 120_000)

  it('PR #305 (Codex P1): ha a napló olvasása elbukik, a piszkozat-sor nem mérce', async () => {
    const id = await unpublishWithMistypedPrice('audit-read-failure')
    const originalFind = payload.find.bind(payload)
    const findSpy = vi.spyOn(payload, 'find').mockImplementation(((
      args: Parameters<Payload['find']>[0],
    ) => {
      if (args.collection === 'audit-logs') {
        return Promise.reject(new Error('a napló átmenetileg nem olvasható'))
      }
      return originalFind(args)
    }) as Payload['find'])
    try {
      await expectConfirmationRequired(id)
    } finally {
      findSpy.mockRestore()
    }
  }, 120_000)

  /** Az admin „Új kurzus” útja: a tulajdonos piszkozatként hozza létre (naplózott létrehozás). */
  async function createDraftAsOwner(key: string): Promise<number> {
    const created = (await payload.create({
      collection: 'products',
      data: {
        sku: `DB-GUARD ${key} ${stamp}`,
        category: categoryId,
        status: 'published',
        _status: 'draft',
        priceInHUFEnabled: true,
        priceInHUF: 79_500,
      },
      draft: true,
      overrideAccess: false,
      user: asUser(owner),
    })) as unknown as Doc
    productIds.push(created.id)
    return created.id
  }

  it('kontroll (PR #305): a soha nem közzétett, új kurzus a tulajdonos közzétételével megerősítés nélkül élesedik', async () => {
    const id = await createDraftAsOwner('fresh')
    // Az autosave csak a verziótáblát írja: a kurzus továbbra is bizonyítottan
    // soha nem közzétett.
    await autosave(id, owner, { priceInHUF: 69_500 })
    expect((await mainRow(id))._status).toBe('draft')

    expect(await save(id, owner, { _status: 'published' })).toBe('OK')
    const row = await mainRow(id)
    expect({ _status: row._status, priceInHUF: row.priceInHUF }).toEqual({
      _status: 'published',
      priceInHUF: 69_500,
    })
  }, 120_000)

  /**
   * PR #305 rev1 (breaker): a verziótábla nem bizonyítja, hogy a kurzus soha
   * nem volt közzétéve, mert a visszavonás a közzétett verziót helyben
   * piszkozatra írja. A kurzus naplózottan jött létre, közzé volt téve, majd
   * visszavonták; a lomtár és az admin visszaállítása a piszkozat 7 950 Ft-os
   * árát a fő sorba írta. Ha a közzététel oldali naplóbejegyzések elvesznek
   * (best-effort naplóírás; a visszavonást a korábbi kód nem is naplózta), a
   * régi „soha” bizonyíték (létrehozási bejegyzés, közzétett verzió nélkül)
   * igaz lett volna, a piszkozat-sor önmagához mérve „nem csökkent”, és a
   * munkatárs megerősítés nélkül tette volna közzé.
   */
  it('PR #305 rev1: közzétett, visszavont, lomtárba tett és visszaállított kurzus elveszett közzétételi naplóval: az elütött ár csak a tulajdonos megerősítésével élesedik', async () => {
    const id = await createDraftAsOwner('published-then-lost-audit')
    expect(await save(id, owner, { _status: 'published' })).toBe('OK')
    expect(await save(id, owner, { _status: 'draft' }, { unpublishAllLocales: true })).toBe('OK')
    await autosave(id, owner, { priceInHUF: 7_950 })
    expect(await save(id, staff, { deletedAt: new Date().toISOString() })).toBe('OK')
    expect(await saveWhere(id, staff, { deletedAt: null }, { trashed: true })).toBe('OK')
    const row = await mainRow(id)
    expect({ _status: row._status, priceInHUF: row.priceInHUF }).toEqual({
      _status: 'draft',
      priceInHUF: 7_950,
    })
    // Csak a létrehozás bejegyzése marad meg.
    await payload.db.deleteMany({
      collection: 'audit-logs',
      where: {
        and: [
          { entityType: { equals: 'products' } },
          { entityId: { equals: String(id) } },
          { action: { not_equals: 'create' } },
        ],
      },
    })
    const remaining = await payload.find({
      collection: 'audit-logs',
      where: {
        and: [{ entityType: { equals: 'products' } }, { entityId: { equals: String(id) } }],
      },
      depth: 0,
      overrideAccess: true,
    })
    expect(remaining.docs.map((entry) => entry.action)).toEqual(['create'])
    // A verziótáblában nincs közzétett verzió: ez egymagában nem bizonyíték.
    const publishedVersions = await payload.findVersions({
      collection: 'products',
      where: {
        and: [{ parent: { equals: id } }, { 'version._status': { equals: 'published' } }],
      },
      depth: 0,
      overrideAccess: true,
    })
    expect(publishedVersions.totalDocs).toBe(0)

    await expectConfirmationRequired(id)
  }, 120_000)

  /**
   * A kurzus összes naplóbejegyzését törli a létrehozásé kivételével: a
   * best-effort naplóírás (src/lib/audit.ts writeAuditLog) elveszett
   * bejegyzéseinek alakja.
   */
  async function keepOnlyCreateEntry(id: number): Promise<void> {
    await payload.db.deleteMany({
      collection: 'audit-logs',
      where: {
        and: [
          { entityType: { equals: 'products' } },
          { entityId: { equals: String(id) } },
          { action: { not_equals: 'create' } },
        ],
      },
    })
  }

  /*
   * PR #305 rev2 (breaker, BRK305-1/2): a közzétettként létrehozott kurzus
   * (restore-legacy-content, seed, szkriptek) létrehozási bejegyzésének
   * „after” oldala élő, közzétett sor. Ha a későbbi közzététel és visszavonás
   * bejegyzése elvész, ez az elavult pillanatkép lett a „legutóbb közzétett”
   * állapot: a fő sort azóta naplózatlanul írták, mégis mérce maradt.
   */
  it('PR #305 rev2 (BRK305-1): ingyenesként létrehozott, később 79 500 Ft-on közzétett, visszavont kurzus elveszett naplóval nem tehető közzé ingyenesként megerősítés nélkül', async () => {
    const id = await createPublished('brk1', { priceInHUFEnabled: false, priceInHUF: null })
    expect(
      await save(id, owner, { priceInHUFEnabled: true, priceInHUF: 79_500, _status: 'published' }),
    ).toBe('OK')
    expect(await save(id, owner, { _status: 'draft' }, { unpublishAllLocales: true })).toBe('OK')
    await autosave(id, owner, { priceInHUFEnabled: false })
    await keepOnlyCreateEntry(id)

    expect(await save(id, staff, { _status: 'published' })).toContainEqual({
      path: 'priceInHUFEnabled',
      message: OWNER_ONLY_CHANGE_MESSAGE,
    })
    expect(await save(id, owner, { _status: 'published' })).toContainEqual({
      path: 'priceInHUFEnabled',
      message: FREE_COURSE_GUARD_MESSAGE,
    })
    expect((await mainRow(id))._status).toBe('draft')
    expect((await claimAsStranger(id, 'brk1b')).status).toBe('course-not-available')
  }, 120_000)

  it('PR #305 rev2 (BRK305-2): 12 900 Ft-on létrehozott, 79 500 Ft-on közzétett, visszavont kurzus elveszett naplóval: a 7 950 Ft csak megerősítéssel élesedik', async () => {
    const id = await createPublished('brk2', { priceInHUF: 12_900 })
    expect(await save(id, owner, { priceInHUF: 79_500, _status: 'published' })).toBe('OK')
    expect(await save(id, owner, { _status: 'draft' }, { unpublishAllLocales: true })).toBe('OK')
    await autosave(id, owner, { priceInHUF: 7_950 })
    await keepOnlyCreateEntry(id)
    await expectConfirmationRequired(id)
  }, 120_000)

  /*
   * A „fő sor azóta nem íródott” próba nem elég, ha az elveszett bejegyzések
   * után a lomtár és a visszaállítás naplózva fut: a legfrissebb bejegyzés
   * ideje ekkor már a fő sor írása utáni. A láncnak kell hiánytalannak lennie
   * (minden bejegyzés „before” oldala az előző „after” oldala).
   */
  it('PR #305 rev2 (BRK305-2, lánc): az elveszett közzétételi bejegyzések után naplózott lomtár és visszaállítás sem teszi mércévé az elavult pillanatképet', async () => {
    const id = await createPublished('brk2-chain', { priceInHUF: 12_900 })
    expect(await save(id, owner, { priceInHUF: 79_500, _status: 'published' })).toBe('OK')
    expect(await save(id, owner, { _status: 'draft' }, { unpublishAllLocales: true })).toBe('OK')
    await autosave(id, owner, { priceInHUF: 7_950 })
    await keepOnlyCreateEntry(id)
    expect(await save(id, staff, { deletedAt: new Date().toISOString() })).toBe('OK')
    expect(await saveWhere(id, staff, { deletedAt: null }, { trashed: true })).toBe('OK')
    const row = await mainRow(id)
    expect({ _status: row._status, priceInHUF: row.priceInHUF }).toEqual({
      _status: 'draft',
      priceInHUF: 7_950,
    })
    await expectConfirmationRequired(id)
  }, 120_000)

  /*
   * PR #305 rev2 (breaker, BRK305-3): az admin Másolás gombja a munkatárs által
   * nem írható ár-mezőket a forrás legutóbbi (autosave-es) verziójából tölti.
   * A másolat bizonyítottan soha nem közzétett, a csökkenést pedig a saját fő
   * sorához mérné, amelyben már a tulajdonos elütött ára áll. A soha nem
   * közzétett kurzus első áras közzététele ezért a tulajdonosé.
   */
  it('PR #305 rev2 (BRK305-3): a munkatárs piszkozat-másolata nem viszi élesbe a tulajdonos meg nem erősített 7 950 Ft-os ár-piszkozatát; a tulajdonos közzéteheti', async () => {
    const id = await createPublished('brk3-dup-source')
    await autosave(id, owner, { priceInHUF: 7_950 })
    const copy = (await payload.duplicate({
      collection: 'products',
      id,
      draft: true,
      data: { _status: 'draft' },
      overrideAccess: false,
      user: asUser(staff),
    })) as unknown as Doc
    productIds.push(copy.id)
    expect((await mainRow(copy.id)).priceInHUF).toBe(7_950)

    expect(await save(copy.id, staff, { _status: 'published' })).toContainEqual({
      path: 'priceInHUF',
      message: OWNER_ONLY_CHANGE_MESSAGE,
    })
    expect((await mainRow(copy.id))._status).toBe('draft')

    expect(await save(copy.id, owner, { _status: 'published' })).toBe('OK')
    const row = await mainRow(copy.id)
    expect({ _status: row._status, priceInHUF: row.priceInHUF }).toEqual({
      _status: 'published',
      priceInHUF: 7_950,
    })
  }, 120_000)

  it('PR #305 rev2 (BRK305-3, `?draft=false`): a munkatárs azonnal közzétett másolata sem viszi élesbe a tulajdonos ár-piszkozatát', async () => {
    const id = await createPublished('brk3-dup-live-source')
    await autosave(id, owner, { priceInHUF: 7_950 })
    let result: 'OK' | ErrorEntry[]
    try {
      const copy = (await payload.duplicate({
        collection: 'products',
        id,
        draft: false,
        data: { _status: 'published' },
        overrideAccess: false,
        user: asUser(staff),
      })) as unknown as Doc
      productIds.push(copy.id)
      result = 'OK'
    } catch (error) {
      const errors = (error as { data?: { errors?: ErrorEntry[] } }).data?.errors
      if (!Array.isArray(errors)) throw error
      result = errors.map(({ path, message }) => ({ path, message }))
    }
    expect(result).toContainEqual({ path: 'priceInHUF', message: OWNER_ONLY_CHANGE_MESSAGE })
  }, 120_000)

  /*
   * PR #305 rev1-b (breaker, B1): a napló a visszavonás „before” oldalát a
   * mentés előtt, sorzár nélkül olvassa. A tulajdonos 10 000 Ft-os élő
   * kurzuson közzétesz egy 79 500 Ft-os emelést, közben a munkatárs
   * visszavonja a közzétételt; a sorrendet egy külső kapcsolat sorzára rögzíti
   * (az emelés áll be elsőnek). A visszavonás „before” oldala így még a
   * 10 000 Ft-os sor, pedig a legutóbb közzétett ár 79 500 Ft volt. Ha ez az
   * elavult pillanatkép mérce, a tulajdonos 7 950 Ft-os elütését (nem kisebb a
   * 10 000 felénél) a munkatárs megerősítés nélkül tette volna közzé.
   *
   * rev2-b: a mentés a fő sort a napló olvasása előtt zárolja
   * (productUpdateLocksRow), így a visszavonás „before” oldala már a friss,
   * 79 500 Ft-os sor, és a tulajdonos a valódi mércéhez mért csökkenést látja.
   */
  it('PR #305 rev1-b (B1): párhuzamos áremelés és visszavonás után az elavult „before” pillanatkép nem mérce, a 7 950 Ft csak megerősítéssel élesedik', async () => {
    const pg = await import('pg')
    const client = new pg.default.Client({ connectionString: process.env.DATABASE_URI })
    const observer = new pg.default.Client({ connectionString: process.env.DATABASE_URI })
    await client.connect()
    await observer.connect()
    try {
      const id = await createPublished('b1-race', { priceInHUF: 10_000 })
      const holderPid = await backendPid(client)
      await client.query('BEGIN')
      await client.query('SELECT id FROM products WHERE id = $1 FOR UPDATE', [id])
      const raise = save(id, owner, { priceInHUF: 79_500, _status: 'published' })
      expect(await untilWaitersBehind(observer, holderPid, 1)).toBe(true)
      const unpublish = save(id, staff, { _status: 'draft' }, { unpublishAllLocales: true })
      expect(await untilWaitersBehind(observer, holderPid, 2)).toBe(true)
      await client.query('COMMIT')
      expect(await raise).toBe('OK')
      expect(await unpublish).toBe('OK')
      expect((await mainRow(id))._status).toBe('draft')

      await autosave(id, owner, { priceInHUF: 7_950 })
      await expectConfirmationRequired(id, priceDropMessage('rendes', 7_950, 79_500))
    } finally {
      await client.query('ROLLBACK').catch(() => undefined)
      await client.end()
      await observer.end()
    }
  }, 120_000)

  /*
   * Ismert súrlódás (PR #305 rev1-b, breaker B3, B4, B4b), a biztonságos
   * irányban. Két admin-művelet a visszavont kurzus fő sorát naplóbejegyzés
   * nélkül írja, mert egyik naplózott mező sem változik:
   * - a már visszavont kurzus újabb visszavonása (dupla kattintás, második
   *   fül, tömeges visszavonás, API-újrapróbálás);
   * - a munkatárs verzió-visszaállítása (a kurzus piszkozat marad, a napló
   *   „before” pillanatképe ezen az úton elvész).
   * A napló-lánc ezzel megszakad, ezért a változatlan, korábban közzétett ár
   * újbóli közzététele is a tulajdonos megerősítését kéri. Ez egy elveszett
   * közzétételi bejegyzéstől nem különböztethető meg (BRK305-1/2), tehát itt
   * nem lazítható. A javítás a naplóé (src/plugins/audit.ts: minden nem
   * piszkozat fő sor-írás naplózása, a verzió-visszaállítás pillanatképével);
   * ha az elkészül, ezek az elvárások megfordulnak (a munkatárs közzéteheti).
   */
  it('ismert súrlódás (B4, B4b): a visszavont kurzus második visszavonása (a tulajdonosé is) után a változatlan 79 500 Ft is a tulajdonos megerősítését kéri', async () => {
    const id = await createPublished('b4-double-unpublish')
    expect(await save(id, staff, { _status: 'draft' }, { unpublishAllLocales: true })).toBe('OK')
    expect(await save(id, owner, { _status: 'draft' }, { unpublishAllLocales: true })).toBe('OK')

    expect(await save(id, staff, { _status: 'published' })).toContainEqual({
      path: 'priceInHUF',
      message: OWNER_ONLY_CHANGE_MESSAGE,
    })
    expect(await save(id, owner, { _status: 'published' })).toContainEqual({
      path: 'priceInHUF',
      message: unknownPriceReferenceMessage('rendes', 79_500),
    })
    expect((await mainRow(id))._status).toBe('draft')
    expect(
      await save(id, owner, {
        _status: 'published',
        [PRODUCT_CONFIRMATIONS_KEY]: { priceInHUF: 79_500 },
      }),
    ).toBe('OK')
    expect((await mainRow(id))._status).toBe('published')
  }, 120_000)

  it('ismert súrlódás (B3): a munkatárs verzió-visszaállítása után a visszavont kurzus változatlan árát a munkatárs nem teheti közzé', async () => {
    const id = await createPublished('b3-staff-restore')
    const versionId = await publishedVersionId(id)
    expect(await save(id, owner, { _status: 'draft' }, { unpublishAllLocales: true })).toBe('OK')
    await restoreVersion(versionId, staff)
    const row = await mainRow(id)
    expect({ _status: row._status, priceInHUF: row.priceInHUF }).toEqual({
      _status: 'draft',
      priceInHUF: 79_500,
    })

    expect(await save(id, staff, { _status: 'published' })).toContainEqual({
      path: 'priceInHUF',
      message: OWNER_ONLY_CHANGE_MESSAGE,
    })
    expect((await mainRow(id))._status).toBe('draft')
  }, 120_000)

  /**
   * PR #305 rev2-b (breaker X1): a naplózatlan párhuzamos írás. A tulajdonos
   * „Visszaállítás” gombja (verzió-visszaállítás közzétettként) a 10 000 Ft-on
   * élő kurzust a régi, 79 500 Ft-os verzióra állítja; ez az írás naplóbejegyzés
   * nélkül fut (src/plugins/audit.ts, a verzió-visszaállítás útja). Közben a
   * munkatárs visszavonja a közzétételt; a sorrendet egy külső kapcsolat
   * sorzára rögzíti (a visszaállítás áll be elsőnek). Zár nélkül a visszavonás
   * „before” oldala még a 10 000 Ft-os sor lett, és mivel a régebbi bejegyzés
   * (10 000 Ft-ra csökkentés) nem későbbi nála, mérce lett: a tulajdonos
   * 7 950 Ft-os elütését a munkatárs megerősítés nélkül tette közzé, pedig a
   * legutóbb közzétett ár 79 500 Ft volt.
   */
  it('PR #305 rev2-b (X1): naplózatlan tulajdonosi visszaállítás és visszavonás versenye után a 7 950 Ft csak megerősítéssel élesedik', async () => {
    const pg = await import('pg')
    const client = new pg.default.Client({ connectionString: process.env.DATABASE_URI })
    const observer = new pg.default.Client({ connectionString: process.env.DATABASE_URI })
    await client.connect()
    await observer.connect()
    try {
      const id = await createPublished('x1-restore-race', { priceInHUF: 79_500 })
      const versionId = await publishedVersionId(id)
      expect(
        await save(id, owner, {
          priceInHUF: 10_000,
          _status: 'published',
          [PRODUCT_CONFIRMATIONS_KEY]: { priceInHUF: 10_000 },
        }),
      ).toBe('OK')
      const holderPid = await backendPid(client)
      await client.query('BEGIN')
      await client.query('SELECT id FROM products WHERE id = $1 FOR UPDATE', [id])
      const restore = restoreVersion(versionId, owner)
      expect(await untilWaitersBehind(observer, holderPid, 1)).toBe(true)
      const unpublish = save(id, staff, { _status: 'draft' }, { unpublishAllLocales: true })
      expect(await untilWaitersBehind(observer, holderPid, 2)).toBe(true)
      await client.query('COMMIT')
      await restore
      expect(await unpublish).toBe('OK')
      expect((await mainRow(id))._status).toBe('draft')

      await autosave(id, owner, { priceInHUF: 7_950 })
      await expectConfirmationRequired(id, priceDropMessage('rendes', 7_950, 79_500))
    } finally {
      await client.query('ROLLBACK').catch(() => undefined)
      await client.end()
      await observer.end()
    }
  }, 120_000)

  /**
   * Zárás elleni védelem (PR #305 rev2-b, breaker X2): az élő kurzus
   * naplózatlan mentése (csak a cikkszám változik, naplózott mező nem) a
   * létrehozás és a visszavonás bejegyzése között szabályos. A visszavonás
   * „before” oldala ekkor a friss sor, a régebbi (létrehozási) bejegyzés
   * „after” oldala korábbi nála: a pillanatkép mérce, a munkatárs a változatlan
   * árat közzéteheti. Ha az elavultság-vizsgálat azonos időt várna el, itt is
   * a tulajdonos megerősítése kellene.
   */
  it('zárás elleni védelem (rev2-b, X2): élő kurzus naplózatlan mentése, majd visszavonás után a munkatárs a változatlan árat közzéteheti', async () => {
    const id = await createPublished('x2-unlogged-live-save')
    expect(
      await save(id, owner, { sku: `DB-GUARD x2-uj-cikkszam ${stamp}`, _status: 'published' }),
    ).toBe('OK')
    const { docs } = await payload.find({
      collection: 'audit-logs',
      where: {
        and: [{ entityType: { equals: 'products' } }, { entityId: { equals: String(id) } }],
      },
      depth: 0,
      limit: 10,
      overrideAccess: true,
    })
    expect(docs.map((entry) => entry.action)).toEqual(['create'])

    expect(await save(id, staff, { _status: 'draft' }, { unpublishAllLocales: true })).toBe('OK')
    expect(await save(id, staff, { _status: 'published' })).toBe('OK')
    expect((await mainRow(id))._status).toBe('published')
  }, 120_000)

  /**
   * PR #305 rev3 (breaker BRK-L1): a mentés sorzárja nem ütközhet a kurzusra
   * hivatkozó sor beszúrásának idegenkulcs-zárjával (`FOR KEY SHARE`). Itt egy
   * vásárlás (users_rels.products_id) nyitott tranzakciója tartja; ugyanígy
   * zárol a kosár- és rendelés-tétel, a haladás és a menü. `FOR UPDATE`
   * erősségű zárnál a tulajdonos autosave-je e tranzakció mögött várt (egy
   * beragadt tranzakció mögött a `statement_timeout`-ig), és fordítva: a
   * vásárlás és a pénztár beszúrása várt minden autosave mögött.
   */
  it('PR #305 rev3 (BRK-L1): a kurzusra hivatkozó, nyitott vásárlás-beszúrás nem állítja meg a tulajdonos autosave-jét', async () => {
    const pg = await import('pg')
    const holder = new pg.default.Client({ connectionString: process.env.DATABASE_URI })
    const observer = new pg.default.Client({ connectionString: process.env.DATABASE_URI })
    await holder.connect()
    await observer.connect()
    try {
      const id = await createPublished('l1-autosave')
      const holderPid = await backendPid(holder)
      await holder.query('BEGIN')
      await holder.query(
        `INSERT INTO users_rels ("order", parent_id, path, products_id) VALUES (99, $1, 'purchases', $2)`,
        [staff.id, id],
      )
      let done = false
      const saving = autosave(id, owner, { shortDescription: 'autosave l1' }).finally(() => {
        done = true
      })
      const blocked = await untilWaitersBehind(observer, holderPid, 1, () => done)
      await holder.query('ROLLBACK')
      await saving
      expect(blocked, 'az autosave a vásárlás idegenkulcs-zárja mögött várt').toBe(false)
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined)
      await holder.end()
      await observer.end()
    }
  }, 60_000)

  /**
   * PR #305 rev3 (breaker BRK-L3): két kurzus, amelyek egymást „Kapcsolódó
   * kurzus”-ként sorolják fel (a szokásos keresztértékesítés), egyszerre
   * autosave-el. Mindkét mentés a saját fő sorát zárolja, majd a verzió
   * kapcsolat-sorait szúrja be a másik kurzusra (`_products_v_rels`,
   * idegenkulcs-zár a másik fő soron). `FOR UPDATE` erősségű zárnál ez
   * kölcsönös várakozás: a Postgres az egyiket `deadlock detected`-del
   * leállította, a tulajdonos autosave-je elbukott. A sorrendet egy külső
   * kapcsolat táblazára rögzíti: mindkét mentés a kapcsolat-soroknál áll be.
   */
  it('PR #305 rev3 (BRK-L3): két, egymásra „Kapcsolódó kurzus”-ként hivatkozó kurzus egyidejű autosave-je nem kerül holtpontba', async () => {
    const pg = await import('pg')
    const holder = new pg.default.Client({ connectionString: process.env.DATABASE_URI })
    const observer = new pg.default.Client({ connectionString: process.env.DATABASE_URI })
    await holder.connect()
    await observer.connect()
    try {
      const p = await createPublished('l3-p')
      const q = await createPublished('l3-q')
      await payload.update({
        collection: 'products',
        id: p,
        data: { relatedProducts: [q] },
        overrideAccess: true,
      })
      await payload.update({
        collection: 'products',
        id: q,
        data: { relatedProducts: [p] },
        overrideAccess: true,
      })
      const holderPid = await backendPid(holder)
      await holder.query('BEGIN')
      await holder.query('LOCK TABLE _products_v_rels IN SHARE MODE')
      const autosaveOutcome = (id: number) =>
        autosave(id, owner, { shortDescription: `autosave ${id}` }).then(
          () => 'OK',
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        )
      const first = autosaveOutcome(p)
      const second = autosaveOutcome(q)
      expect(await untilWaitersBehind(observer, holderPid, 2)).toBe(true)
      await holder.query('COMMIT')
      expect([await first, await second]).toEqual(['OK', 'OK'])
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined)
      await holder.end()
      await observer.end()
    }
  }, 60_000)
})
