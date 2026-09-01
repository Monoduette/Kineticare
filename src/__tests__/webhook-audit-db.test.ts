import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getPayload, type Payload } from 'payload'

import configPromise from '../payload.config'
import { FIRST_USER_BOOTSTRAP_HEADER, FIRST_USER_BOOTSTRAP_TOKEN_ENV } from '../collections/Users'
import { processWebhook, webhookEventStore } from '../lib/idempotency'
import { isDatabaseAvailable } from './helpers/db-available'

/**
 * DB-s integrációs tesztek (T-014/T-015).
 *
 * Feltétel: a DATABASE_URI-n TÉNYLEGESEN elérhető Postgres (TCP-próba —
 * a CI álértékű DATABASE_URI-jánál az env-alapú kapcsoló hamis pozitívot
 * adna, és a getPayload-kísérlet kezeletlen rejectiont hagyna a pg poolból)
 * ÉS a webhook_events / audit_logs táblák léteznek (a konszolidáló migrációs
 * loop hozza létre őket — addig a tesztek szépészedve kihagyódnak, lásd a
 * probe-logikát).
 */
const hasDb = await isDatabaseAvailable()

describe.skipIf(!hasDb)('webhook + audit (DB)', () => {
  const bootstrapToken = 'DUMMY-webhook-db-bootstrap-token-32-chars'
  let payload: Payload
  let tablesReady = false
  /** A bootstrap-user azonosítója, ha EZ a futás hozta létre (lásd lent). */
  let bootstrapUserId: number | string | null = null

  beforeAll(async () => {
    vi.stubEnv(FIRST_USER_BOOTSTRAP_TOKEN_ENV, bootstrapToken)
    try {
      payload = await getPayload({ config: configPromise })
      await webhookEventStore(payload).find({ collection: 'webhook-events', limit: 1 })
      await payload.find({ collection: 'audit-logs' as 'users', limit: 1, overrideAccess: true })
      tablesReady = true
    } catch {
      // Nincs elérhető DB, vagy a konszolidáló migráció még nem futott —
      // a tesztek kihagyódnak (lásd a fájl fejlécét).
      tablesReady = false
      await payload?.db?.destroy?.().catch(() => undefined)
    }

    /**
     * ÜRES ADATBÁZIS ELŐKÉSZÍTÉSE — a `promoteFirstUserToOwner` miatt.
     *
     * A rendszer ELSŐ felhasználója csak explicit operátori tokennel kap
     * `owner` szerepkört (src/collections/Users.ts). A
     * role-change teszt alanya `customer`-ként jön létre — de ha az adatbázis
     * üres, ő maga az első user, tehát a hook `owner`-ré teszi, és a
     * role-change audit-bejegyzés `before.role`-ja is `owner` lesz.
     *
     * A teszt eddig NÉMÁN egy „bejáratott" fejlesztői adatbázisra
     * támaszkodott (ott már volt user), és sosem futott CI-ban — a CI
     * service-konténer viszont MINDIG üres adatbázissal indul. Ezért itt
     * gondoskodunk róla, hogy legyen már felhasználó, mielőtt az alany
     * létrejön: így a mérés az első-user-bootstrapre nem érzékeny.
     *
     * SZÁNDÉKOSAN a fenti try/catch-en KÍVÜL: ha a bootstrap elhasal, az
     * HANGOS hiba legyen, ne „nincsenek táblák" címén csendes kihagyás.
     */
    if (tablesReady) {
      const { totalDocs } = await payload.count({ collection: 'users' })
      if (totalDocs === 0) {
        const bootstrap = await payload.create({
          collection: 'users',
          data: {
            email: `audit-bootstrap-${Date.now()}@example.com`,
            password: `Bootstrap-${Date.now()}!`,
            name: 'Audit Bootstrap',
            // A bootstrap hook a hitelesített első create-ot ownerre írja.
            role: 'customer',
          },
          overrideAccess: true,
          req: {
            headers: new Headers({ [FIRST_USER_BOOTSTRAP_HEADER]: bootstrapToken }),
          },
        })
        bootstrapUserId = bootstrap.id
      }
    }
  }, 120_000)

  afterAll(async () => {
    if (bootstrapUserId !== null) {
      await payload
        .delete({ collection: 'users', id: bootstrapUserId, overrideAccess: true })
        .catch(() => undefined)
    }
    await payload?.db?.destroy?.()
    vi.unstubAllEnvs()
  })

  it('(provider, externalId) unique constraint + dedup: a handler csak egyszer fut', async (ctx) => {
    if (!tablesReady) {
      ctx.skip()
      return
    }
    const store = webhookEventStore(payload)
    const externalId = `test-dedup-${Date.now()}`
    let handlerCalls = 0

    const first = await processWebhook({
      store,
      provider: 'barion',
      externalId,
      handler: async () => {
        handlerCalls += 1
        return 'ok'
      },
    })
    const second = await processWebhook({
      store,
      provider: 'barion',
      externalId,
      handler: async () => {
        handlerCalls += 1
        return 'ok'
      },
    })

    expect(first.kind).toBe('processed')
    expect(second.kind).toBe('already-processed')
    expect(handlerCalls).toBe(1)

    // A DB-unique is kikényszeríti: közvetlen create duplikátummal hibát dob.
    await expect(
      store.create({
        collection: 'webhook-events',
        data: { provider: 'barion', externalId, status: 'received' },
        overrideAccess: true,
      }),
    ).rejects.toThrow()
  }, 60_000)

  it('users role-change → audit-bejegyzés before/after-rel (injekciós hook)', async (ctx) => {
    if (!tablesReady) {
      ctx.skip()
      return
    }
    const suffix = Date.now()
    const subject = await payload.create({
      collection: 'users',
      data: {
        email: `audit-test-${suffix}@example.com`,
        password: `Teszt-${suffix}!`,
        name: 'Audit Teszt',
        role: 'customer',
      },
      overrideAccess: true,
    })

    await payload.update({
      collection: 'users',
      id: subject.id,
      data: { role: 'staff' },
      overrideAccess: true,
    })

    const logs = await payload.find({
      collection: 'audit-logs' as 'users',
      where: {
        and: [
          { action: { equals: 'role-change' } },
          { entityType: { equals: 'users' } },
          { entityId: { equals: String(subject.id) } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    expect(logs.totalDocs).toBe(1)
    const entry = logs.docs[0] as unknown as {
      before?: { role?: string }
      after?: { role?: string }
    }
    expect(entry.before?.role).toBe('customer')
    expect(entry.after?.role).toBe('staff')

    // Cleanup (overrideAccess-szel a rendszer-only access ellenére is megy).
    await payload.delete({ collection: 'users', id: subject.id, overrideAccess: true })
    await payload.delete({
      collection: 'audit-logs' as 'users',
      id: logs.docs[0].id,
      overrideAccess: true,
    })
  }, 60_000)
})
