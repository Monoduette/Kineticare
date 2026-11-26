import { randomUUID } from 'node:crypto'

import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { getPayload, type Payload } from 'payload'
import type { Client as PgClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  CHECKOUT_INCLUDED_IN_OWNED_PROGRAM,
  CHECKOUT_PROGRAM_PAYMENT_UNRESOLVED,
  assertNotIncludedInOwnedProgram,
  checkoutProgramPaymentInProgressMessage,
} from '../lib/checkout/parent-course-block'
import { CHECKOUT_GUEST_FINISH_AFTER_LOGIN } from '../lib/checkout/form-submission'
import {
  COURSE_FAMILY_MESSAGES,
  DUPLICATE_SKU_PUBLISH_MESSAGE,
  topicCoversProgramMessage,
} from '../lib/course-family'
import type { Logger } from '../lib/logger'
import { FIRST_USER_BOOTSTRAP_HEADER, FIRST_USER_BOOTSTRAP_TOKEN_ENV } from '../collections/Users'
import configPromise from '../payload.config'
import { isDatabaseAvailable } from './helpers/db-available'

/**
 * Témakurzusok valódi Payload + Postgres úton (src/lib/course-family.ts):
 *
 * - a szerkezeti mentés-őr (course-family-guard.ts): egy szint, nincs önhivatkozás,
 *   és a két irányú kapcsolás a közös advisory-zárra vár;
 * - a duplikálás (ecommerce.ts beforeDuplicate): a másolat nem vásárolható,
 *   nem örökli a programot és az akciót, „- Copy” azonosítóval nem tehető közzé;
 * - a pénztár-kapu (checkout/parent-course-block.ts) a valódi `orders` és
 *   `users` sorokon: a program birtokosa és az élő program-fizetés nem fizet
 *   újra a témakurzusért.
 *
 * DB-függő: csak elérhető, migrált Postgres mellett fut (CI verify job).
 */
const hasDb = await isDatabaseAvailable()

type Doc = Record<string, unknown> & { id: number }

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const WINDOW_MS = 30 * 60 * 1000

const silentLog: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLog,
}

async function backendPid(client: PgClient): Promise<number> {
  const result = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
  return result.rows[0].pid
}

/** Megvárja, hogy legalább egy kérés a `holderPid` kapcsolat zárjára várjon. */
async function untilSomeoneWaitsBehind(observer: PgClient, holderPid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const result = await observer.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))',
      [holderPid],
    )
    if (result.rows[0].n >= 1) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return false
}

describe.skipIf(!hasDb)('témakurzusok valódi mentési és pénztári úton (DB)', () => {
  /**
   * Üres adatbázisnál az első felhasználó csak operátori bootstrap-tokennel
   * jöhet létre (Users.ts promoteFirstUserToOwner); jelölt, nem titok.
   */
  const bootstrapToken = 'DUMMY-temakurzus-db-bootstrap-token'
  let payload: Payload
  let categoryId: number
  const stamp = Date.now()
  const productIds: number[] = []
  const userIds: number[] = []
  const orderIds: number[] = []

  async function createCourse(key: string, data: Record<string, unknown> = {}): Promise<number> {
    const created = (await payload.create({
      collection: 'products',
      data: {
        sku: `TEMA ${key} ${stamp}`,
        category: categoryId,
        status: 'published',
        _status: 'published',
        priceInHUFEnabled: true,
        priceInHUF: 19_900,
        ...data,
      },
      overrideAccess: true,
    })) as unknown as Doc
    productIds.push(created.id)
    return created.id
  }

  /** A mentés eredménye: 'OK', vagy a mezőhibák üzenetei útvonal szerint. */
  async function setParents(id: number, parentCourses: number[]): Promise<'OK' | string[]> {
    try {
      await payload.update({
        collection: 'products',
        id,
        data: { parentCourses },
        overrideAccess: true,
      })
      return 'OK'
    } catch (error) {
      const errors = (error as { data?: { errors?: Array<{ path?: string; message?: string }> } })
        .data?.errors
      if (!Array.isArray(errors)) throw error
      return errors.map((entry) => `${entry.path}: ${entry.message}`)
    }
  }

  async function createCustomer(key: string, purchases: number[] = []): Promise<Doc> {
    const user = (await payload.create({
      collection: 'users',
      data: {
        email: `tema-${key}-${stamp}@example.test`,
        password: `DUMMY-tema-${key}-Nem-valodi-Jelszo-2026`,
        name: 'Téma Teszt',
        role: 'customer',
        purchases,
      },
      overrideAccess: true,
      req: { headers: new Headers({ [FIRST_USER_BOOTSTRAP_HEADER]: bootstrapToken }) },
    })) as unknown as Doc
    userIds.push(user.id)
    return user
  }

  /** Rendelés nyers SQL-lel: a státusz és a `created_at` így pontosan beállítható. */
  async function insertOrder(input: {
    productId: number
    status: 'paid' | 'payment_pending' | 'refunded'
    customerId?: number | null
    email: string
    createdAtMs: number
  }): Promise<number> {
    const pool = (payload.db as unknown as PostgresAdapter).pool
    const iso = new Date(input.createdAtMs).toISOString()
    const created = await pool.query<{ id: number }>(
      `INSERT INTO orders (status, amount, currency, order_number, customer_id, customer_email,
         total_huf_snapshot, created_at, updated_at)
       VALUES ($1, 79500, 'HUF', $2, $3, $4, 79500, $5, $5) RETURNING id`,
      [
        input.status,
        `TEMA-${stamp}-${orderIds.length}`,
        input.customerId ?? null,
        input.email,
        iso,
      ],
    )
    const orderId = created.rows[0].id
    orderIds.push(orderId)
    await pool.query(
      `INSERT INTO orders_items (_order, _parent_id, id, product_id, quantity)
       VALUES (1, $1, $2, $3, 1)`,
      [orderId, randomUUID(), input.productId],
    )
    return orderId
  }

  /** A pénztár-kapu kimenete: 'OK', vagy a státusz és az üzenet. */
  async function gate(input: {
    topicId: number
    accountId: number | null
    loggedIn: boolean
    email: string
    accountPurchases?: number[]
  }): Promise<'OK' | { status: number; message: string }> {
    const product = (await payload.findByID({
      collection: 'products',
      id: input.topicId,
      depth: 0,
      overrideAccess: true,
    })) as unknown as { id: number; parentCourses?: unknown }
    try {
      await assertNotIncludedInOwnedProgram({
        payload,
        product,
        loggedIn: input.loggedIn,
        accountId: input.accountId,
        ...(input.accountPurchases !== undefined
          ? { accountPurchases: input.accountPurchases }
          : {}),
        email: input.email,
        nowMs: Date.now(),
        paymentWindowMs: WINDOW_MS,
        log: silentLog,
      })
      return 'OK'
    } catch (error) {
      const { status, message } = error as { status: number; message: string }
      return { status, message }
    }
  }

  beforeAll(async () => {
    vi.stubEnv(FIRST_USER_BOOTSTRAP_TOKEN_ENV, bootstrapToken)
    vi.stubGlobal('fetch', () => {
      throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
    })
    payload = await getPayload({ config: configPromise })
    const category = (await payload.create({
      collection: 'categories',
      data: {
        title: `Témakurzus teszt ${stamp}`,
        slug: `temakurzus-teszt-${stamp}`,
        type: 'product',
      },
      overrideAccess: true,
    })) as unknown as Doc
    categoryId = category.id
  }, 240_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    if (payload === undefined) return
    const pool = (payload.db as unknown as PostgresAdapter).pool
    if (orderIds.length > 0) {
      await pool.query('DELETE FROM orders WHERE id = ANY($1::int[])', [orderIds])
    }
    for (const id of userIds) {
      await payload.delete({ collection: 'users', id, overrideAccess: true })
    }
    // A témakurzusok előbb mennek, hogy a program törlését ne tartsa vissza a hivatkozás.
    for (const id of [...productIds].reverse()) {
      await payload.delete({ collection: 'products', id, overrideAccess: true, trash: true })
    }
    if (categoryId !== undefined) {
      await payload.delete({ collection: 'categories', id: categoryId, overrideAccess: true })
    }
    await payload.db?.destroy?.()
  })

  describe('szerkezeti mentés-őr', () => {
    it.each([
      ['önmaga a programja', 'self'],
      ['a program maga is témakurzus', 'parent-is-topic'],
      ['a programra már témakurzus hivatkozik', 'topic-has-children'],
    ] as const)('elutasítja: %s', async (_name, violation) => {
      const program = await createCourse(`program-${violation}`)
      const topic = await createCourse(`tema-${violation}`, { parentCourses: [program] })
      const other = await createCourse(`masik-${violation}`)

      const outcome =
        violation === 'self'
          ? await setParents(other, [other])
          : violation === 'parent-is-topic'
            ? await setParents(other, [topic])
            : await setParents(program, [other])
      expect(outcome).toEqual([`parentCourses: ${COURSE_FAMILY_MESSAGES[violation]}`])
    })

    it('a két irányú egyidejű kapcsolás a közös zárra vár, és csak az egyik marad meg', async () => {
      // Egy külső kapcsolat tartja a szerkezeti zárat; a mentés ellenőrzése
      // csak a zár elengedése után futhat. Zár nélkül a két mentés egymás
      // nem commitolt írását sem látná, és mindkettő átmenne (A→B és B→A).
      const pg = await import('pg')
      const holder = new pg.default.Client({ connectionString: process.env.DATABASE_URI })
      const observer = new pg.default.Client({ connectionString: process.env.DATABASE_URI })
      await holder.connect()
      await observer.connect()
      try {
        const a = await createCourse('verseny-a')
        const b = await createCourse('verseny-b')
        const holderPid = await backendPid(holder)
        await holder.query('BEGIN')
        await holder.query(
          `SELECT pg_advisory_xact_lock(hashtext('kineticare:products:course-family'))`,
        )

        let firstDone = false
        const first = setParents(a, [b]).finally(() => {
          firstDone = true
        })
        expect(await untilSomeoneWaitsBehind(observer, holderPid)).toBe(true)
        expect(firstDone).toBe(false)
        await holder.query('COMMIT')
        expect(await first).toBe('OK')
        // A második irány már a commitolt első kapcsolást látja: `a` témakurzus.
        expect(await setParents(b, [a])).toEqual([
          `parentCourses: ${COURSE_FAMILY_MESSAGES['parent-is-topic']}`,
        ])
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined)
        await holder.end()
        await observer.end()
      }
    }, 60_000)
  })

  describe('duplikálás', () => {
    it('a közzétett, akciós témakurzus másolata piszkozat, program és akció nélkül', async () => {
      const program = await createCourse('dup-program')
      const source = await createCourse('dup-forras', {
        parentCourses: [program],
        promoEnabled: true,
        promoPriceHuf: 9_900,
        promoStart: new Date(Date.now() - DAY_MS).toISOString(),
        promoEnd: new Date(Date.now() + 10 * DAY_MS).toISOString(),
        seoTitle: 'Forrás SEO-cím',
      })
      const copy = (await payload.duplicate({
        collection: 'products',
        id: source,
        overrideAccess: true,
      })) as unknown as Doc
      productIds.push(copy.id)

      const row = (await payload.findByID({
        collection: 'products',
        id: copy.id,
        depth: 0,
        draft: false,
        overrideAccess: true,
      })) as unknown as Doc
      expect({
        status: row.status,
        _status: row._status,
        parentCourses: row.parentCourses,
        promoEnabled: row.promoEnabled,
        promoPriceHuf: row.promoPriceHuf ?? null,
        promoEnd: row.promoEnd ?? null,
        seoTitle: row.seoTitle ?? null,
      }).toEqual({
        status: 'draft',
        _status: 'draft',
        parentCourses: [],
        promoEnabled: false,
        promoPriceHuf: null,
        promoEnd: null,
        seoTitle: null,
      })
    })

    it('„- Copy” végű belső azonosítóval nem tehető közzé', async () => {
      const source = await createCourse('copy-forras')
      const copy = (await payload.duplicate({
        collection: 'products',
        id: source,
        overrideAccess: true,
      })) as unknown as Doc
      productIds.push(copy.id)

      await expect(
        payload.update({
          collection: 'products',
          id: copy.id,
          data: { status: 'published', _status: 'published' },
          overrideAccess: true,
        }),
      ).rejects.toMatchObject({
        data: { errors: [{ path: 'sku', message: DUPLICATE_SKU_PUBLISH_MESSAGE }] },
      })
    })
  })

  describe('közzététel leckeszám szerint', () => {
    function modulesWith(lessonCount: number): unknown[] {
      return [
        {
          title: 'Modul',
          lessons: Array.from({ length: lessonCount }, (_, index) => ({
            title: `Lecke ${index + 1}`,
            kind: 'szoveg',
          })),
        },
      ]
    }

    it('a programmal azonos leckeszámú témakurzus nem tehető közzé, a kisebb igen', async () => {
      const program = await createCourse('lecke-program', { modules: modulesWith(3) })
      const fullCopy = await createCourse('lecke-teljes', {
        status: 'draft',
        _status: 'draft',
        parentCourses: [program],
        modules: modulesWith(3),
      })
      await expect(
        payload.update({
          collection: 'products',
          id: fullCopy,
          data: { status: 'published', _status: 'published' },
          overrideAccess: true,
        }),
      ).rejects.toMatchObject({
        data: { errors: [{ path: 'modules', message: topicCoversProgramMessage(3, 3) }] },
      })

      const part = await createCourse('lecke-resz', {
        status: 'draft',
        _status: 'draft',
        parentCourses: [program],
        modules: modulesWith(1),
      })
      const published = (await payload.update({
        collection: 'products',
        id: part,
        data: { status: 'published', _status: 'published' },
        overrideAccess: true,
      })) as unknown as Doc
      expect(published.status).toBe('published')
    })
  })

  describe('pénztár-kapu', () => {
    it('a program birtokosa (purchases) bejelentkezve a program linkjére kap 409-et', async () => {
      const program = await createCourse('kapu-program')
      const topic = await createCourse('kapu-tema', { parentCourses: [program] })
      const owner = await createCustomer('birtokos', [program])

      expect(
        await gate({
          topicId: topic,
          accountId: owner.id,
          loggedIn: true,
          email: String(owner.email),
          accountPurchases: [program],
        }),
      ).toEqual({ status: 409, message: CHECKOUT_INCLUDED_IN_OWNED_PROGRAM })
      // Vendégként ugyanarra a fiókra: nem mondjuk meg, mi van a címen (W4).
      expect(
        await gate({
          topicId: topic,
          accountId: owner.id,
          loggedIn: false,
          email: String(owner.email),
        }),
      ).toEqual({ status: 409, message: CHECKOUT_GUEST_FINISH_AFTER_LOGIN })
    })

    it('fiók nélküli e-mail paid programmal: 409 a belépős üzenettel', async () => {
      const program = await createCourse('vendeg-program')
      const topic = await createCourse('vendeg-tema', { parentCourses: [program] })
      const email = `tema-vendeg-${stamp}@example.test`
      await insertOrder({
        productId: program,
        status: 'paid',
        email,
        createdAtMs: Date.now() - DAY_MS,
      })

      expect(await gate({ topicId: topic, accountId: null, loggedIn: false, email })).toEqual({
        status: 409,
        message: CHECKOUT_GUEST_FINISH_AFTER_LOGIN,
      })
    })

    it('lezáratlan program-fizetés egy napig tilt: ablakon belül a perccel, utána a várakozó üzenettel', async () => {
      const program = await createCourse('fuggo-program')
      const topic = await createCourse('fuggo-tema', { parentCourses: [program] })
      const email = `tema-fuggo-${stamp}@example.test`

      // Visszatérített rendelés és egy napnál régebbi függő sor nem tilt.
      await insertOrder({
        productId: program,
        status: 'refunded',
        email,
        createdAtMs: Date.now() - DAY_MS,
      })
      await insertOrder({
        productId: program,
        status: 'payment_pending',
        email,
        createdAtMs: Date.now() - 25 * HOUR_MS,
      })
      expect(await gate({ topicId: topic, accountId: null, loggedIn: false, email })).toBe('OK')

      // Ablakon túli, de egy napon belüli függő sor: a Barionnál már sikerülhetett.
      await insertOrder({
        productId: program,
        status: 'payment_pending',
        email,
        createdAtMs: Date.now() - 2 * HOUR_MS,
      })
      expect(await gate({ topicId: topic, accountId: null, loggedIn: false, email })).toEqual({
        status: 409,
        message: CHECKOUT_PROGRAM_PAYMENT_UNRESOLVED,
      })

      const freshEmail = `tema-fuggo-friss-${stamp}@example.test`
      await insertOrder({
        productId: program,
        status: 'payment_pending',
        email: freshEmail,
        createdAtMs: Date.now() - 5 * 60 * 1000,
      })
      expect(
        await gate({ topicId: topic, accountId: null, loggedIn: false, email: freshEmail }),
      ).toEqual({
        status: 409,
        message: checkoutProgramPaymentInProgressMessage(25),
      })
    })

    it('fiókos vevőnél a purchases dönt, mint a kurzusoldalon: purchases nélküli paid rendelés nem tilt', async () => {
      const program = await createCourse('igazit-program')
      const topic = await createCourse('igazit-tema', { parentCourses: [program] })
      const buyer = await createCustomer('igazit', [])
      await insertOrder({
        productId: program,
        status: 'paid',
        customerId: buyer.id,
        email: String(buyer.email),
        createdAtMs: Date.now() - DAY_MS,
      })

      expect(
        await gate({
          topicId: topic,
          accountId: buyer.id,
          loggedIn: true,
          email: String(buyer.email),
          accountPurchases: [],
        }),
      ).toBe('OK')
    })

    it('lejárt időkorlátos program: a témakurzus megvehető', async () => {
      const program = await createCourse('lejart-program', { accessDurationDays: 30 })
      const topic = await createCourse('lejart-tema', { parentCourses: [program] })
      const buyer = await createCustomer('lejart', [program])
      await insertOrder({
        productId: program,
        status: 'paid',
        customerId: buyer.id,
        email: String(buyer.email),
        createdAtMs: Date.now() - 60 * DAY_MS,
      })

      expect(
        await gate({
          topicId: topic,
          accountId: buyer.id,
          loggedIn: true,
          email: String(buyer.email),
          accountPurchases: [program],
        }),
      ).toBe('OK')
    })

    it('más programot birtokló vevő és a nem témakurzus változatlanul fizethet', async () => {
      const program = await createCourse('idegen-program')
      const other = await createCourse('idegen-masik')
      const topic = await createCourse('idegen-tema', { parentCourses: [program] })
      const buyer = await createCustomer('idegen', [other])

      expect(
        await gate({
          topicId: topic,
          accountId: buyer.id,
          loggedIn: true,
          email: String(buyer.email),
          accountPurchases: [other],
        }),
      ).toBe('OK')
      expect(
        await gate({
          topicId: other,
          accountId: buyer.id,
          loggedIn: true,
          email: String(buyer.email),
          accountPurchases: [other],
        }),
      ).toBe('OK')
    })
  })
})
