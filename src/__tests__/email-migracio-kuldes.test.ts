import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import type { SendMailInput } from '../lib/email/provider'
import type { SendResult } from '../lib/email/types'
import {
  collectMigrationNoticeRecipients,
  type MigrationNoticeRecipient,
} from '../lib/migration-notice/recipients'
import {
  MIGRATION_NOTICE_RETRY_DELAYS_MS,
  MIGRATION_NOTICE_SEND_DELAY_MS,
  migrationNoticeForceRound,
  migrationNoticeIdempotencyKey,
  sendMigrationNotices,
} from '../lib/migration-notice/send'

/**
 * WP40 – címzett-kör és küldés (src/lib/migration-notice/).
 *
 * A Payload egy memóriában élő utánzat; a küldő INJEKTÁLT mock. Tesztből SOSEM
 * megy ki valódi hálózati hívás (CLAUDE.md 15. tanulság). MINDEN ADAT KITALÁLT.
 */

interface FakeUser {
  [field: string]: unknown
  id: number
  email: string
  name: string
  role: 'owner' | 'staff' | 'customer'
  passwordSetupPending: boolean
  purchases: number[]
  accessGrants: { product: number; grantedAt: string }[]
  migrationNoticeSentAt: string | null
}

interface FakeDb {
  users: FakeUser[]
  /** userId-k, akiknek van rendelésük az új oldalon. */
  ordersFor: number[]
  /** userId-k, akiknél a jelölés (update) hibára fut. */
  failMarkFor: number[]
  updates: { id: number; data: Record<string, unknown> }[]
}

function user(overrides: Partial<FakeUser> & { id: number; email: string }): FakeUser {
  return {
    name: 'Teszt Elek',
    role: 'customer',
    passwordSetupPending: true,
    purchases: [1],
    accessGrants: [],
    migrationNoticeSentAt: null,
    ...overrides,
  }
}

function fakePayload(db: FakeDb, pageSize = 200): Payload {
  const fake = {
    find: async (args: { collection: string; where?: unknown; page?: number; limit?: number }) => {
      expect(args.collection).toBe('users')
      // A where alakja: { and: [{ role: { equals } }, { passwordSetupPending: { equals } }] }
      const conds = (args.where as { and: Record<string, { equals: unknown }>[] }).and
      const matches = db.users.filter((doc) =>
        conds.every((cond) => Object.entries(cond).every(([f, c]) => doc[f] === c.equals)),
      )
      const limit = args.limit ?? pageSize
      const page = args.page ?? 1
      const docs = matches.slice((page - 1) * limit, page * limit)
      return { docs, hasNextPage: page * limit < matches.length }
    },
    count: async (args: { collection: string; where: { customer: { equals: number } } }) => {
      expect(args.collection).toBe('orders')
      return { totalDocs: db.ordersFor.includes(args.where.customer.equals) ? 1 : 0 }
    },
    update: async (args: { collection: string; id: number; data: Record<string, unknown> }) => {
      expect(args.collection).toBe('users')
      if (db.failMarkFor.includes(args.id)) {
        throw new Error('adatbázis-hiba (teszt)')
      }
      db.updates.push({ id: args.id, data: args.data })
      const doc = db.users.find((entry) => entry.id === args.id)
      if (doc && typeof args.data.migrationNoticeSentAt === 'string') {
        doc.migrationNoticeSentAt = args.data.migrationNoticeSentAt
      }
      return doc
    },
  }
  return fake as unknown as Payload
}

function db(users: FakeUser[], overrides: Partial<FakeDb> = {}): FakeDb {
  return { users, ordersFor: [], failMarkFor: [], updates: [], ...overrides }
}

const ok = (): SendResult => ({ ok: true, provider: 'resend', id: 'e-1' })

describe('WP40 – címzett-kör', () => {
  it('csak customer + passwordSetupPending; staff/owner és a már belépett vevő kimarad', async () => {
    const store = db([
      user({ id: 1, email: 'Import@Example.com' }),
      user({ id: 2, email: 'belepett@example.com', passwordSetupPending: false }),
      user({ id: 3, email: 'staff@example.com', role: 'staff' }),
      user({ id: 4, email: 'owner@example.com', role: 'owner' }),
      user({
        id: 5,
        email: 'ingyenes@example.com',
        purchases: [],
        accessGrants: [{ product: 9, grantedAt: 'x' }],
      }),
      user({ id: 6, email: 'ures@example.com', purchases: [] }),
    ])
    const selection = await collectMigrationNoticeRecipients(fakePayload(store))
    expect(selection.recipients.map((r) => r.email)).toEqual([
      'import@example.com',
      'ingyenes@example.com',
    ])
    expect(selection.recipients.every((r) => r.hasAccess)).toBe(true)
    // Hozzáférés nélkül ALAPBÓL kimarad, de külön listában látszik (vezetői döntés 2026-09-16).
    expect(selection.excludedNoAccess.map((r) => r.email)).toEqual(['ures@example.com'])
    expect(selection.skipped).toEqual({ alreadySent: 0, hasNewSiteOrder: 0, filteredOut: 0 })
  })

  it('--include-no-access: a hozzáférés nélküli fiók is címzett lesz, hasAccess: false jelzéssel', async () => {
    const store = db([
      user({ id: 1, email: 'van@example.com' }),
      user({ id: 2, email: 'ures@example.com', purchases: [] }),
    ])
    const selection = await collectMigrationNoticeRecipients(fakePayload(store), {
      includeNoAccess: true,
    })
    expect(selection.recipients.map((r) => [r.email, r.hasAccess])).toEqual([
      ['van@example.com', true],
      ['ures@example.com', false],
    ])
    expect(selection.excludedNoAccess).toEqual([])
  })

  it('a már jelölt fiók kimarad, --force-szal viszont újra bekerül', async () => {
    const store = db([
      user({ id: 1, email: 'a@example.com', migrationNoticeSentAt: '2026-09-16T10:00:00.000Z' }),
      user({ id: 2, email: 'b@example.com' }),
    ])
    const alap = await collectMigrationNoticeRecipients(fakePayload(store))
    expect(alap.recipients.map((r) => r.email)).toEqual(['b@example.com'])
    expect(alap.skipped.alreadySent).toBe(1)

    const force = await collectMigrationNoticeRecipients(fakePayload(store), { force: true })
    expect(force.recipients.map((r) => r.email)).toEqual(['a@example.com', 'b@example.com'])
    expect(force.recipients[0].sentAt).toBe('2026-09-16T10:00:00.000Z')
  })

  it('aki az új oldalon rendelt (vendég-vásárló), kimarad', async () => {
    const store = db(
      [user({ id: 1, email: 'vendeg@example.com' }), user({ id: 2, email: 'regi@example.com' })],
      { ordersFor: [1] },
    )
    const selection = await collectMigrationNoticeRecipients(fakePayload(store))
    expect(selection.recipients.map((r) => r.email)).toEqual(['regi@example.com'])
    expect(selection.skipped.hasNewSiteOrder).toBe(1)
  })

  it('--only egy címre szűr (kis-nagybetű független), --limit az első N-t adja', async () => {
    const store = db([
      user({ id: 1, email: 'a@example.com' }),
      user({ id: 2, email: 'b@example.com' }),
      user({ id: 3, email: 'c@example.com' }),
    ])
    const only = await collectMigrationNoticeRecipients(fakePayload(store), {
      only: 'B@Example.com',
    })
    expect(only.recipients.map((r) => r.email)).toEqual(['b@example.com'])
    expect(only.skipped.filteredOut).toBe(2)

    const limit = await collectMigrationNoticeRecipients(fakePayload(store), { limit: 2 })
    expect(limit.recipients.map((r) => r.id)).toEqual([1, 2])
    expect(limit.skipped.filteredOut).toBe(1)

    const nulla = await collectMigrationNoticeRecipients(fakePayload(store), { limit: 0 })
    expect(nulla.recipients).toEqual([])
  })

  it('lapozva olvas, nem csak az első oldalt', async () => {
    const users = Array.from({ length: 5 }, (_, i) =>
      user({ id: i + 1, email: `u${i}@example.com` }),
    )
    const selection = await collectMigrationNoticeRecipients(fakePayload(db(users), 2))
    expect(selection.recipients).toHaveLength(5)
  })
})

describe('WP40 – küldés', () => {
  const recipient = (id: number, email: string): MigrationNoticeRecipient => ({
    id,
    email,
    name: 'Teszt Elek',
    sentAt: null,
    hasAccess: true,
  })

  it('minden címzettnek küld reply-to-val és saját idempotencia-kulccsal, majd jelöli a fiókot', async () => {
    const store = db([
      user({ id: 7, email: 'a@example.com' }),
      user({ id: 8, email: 'b@example.com' }),
    ])
    const send = vi.fn<(input: SendMailInput) => Promise<SendResult>>(async () => ok())
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined)
    const now = () => new Date('2026-09-16T12:00:00.000Z')

    const result = await sendMigrationNotices(
      fakePayload(store),
      [recipient(7, 'a@example.com'), recipient(8, 'b@example.com')],
      { serverUrl: 'https://kineticare.example.com', send, sleep, now },
    )

    expect(result.summary).toEqual({ elkuldve: 2, sikertelen: 0, jelolesSikertelen: 0 })
    expect(send).toHaveBeenCalledTimes(2)
    const first = send.mock.calls[0]?.[0]
    if (first === undefined) {
      throw new Error('nem történt küldés')
    }
    expect(first).toMatchObject({
      to: 'a@example.com',
      replyTo: 'info@kineticare.hu',
      idempotencyKey: 'migracio-7',
    })
    expect(first.html).toContain('https://kineticare.example.com/belepes-atallas')
    expect(first.text).toContain('Kedves Teszt Elek!')
    expect(migrationNoticeIdempotencyKey(7)).toBe('migracio-7')
    expect(migrationNoticeIdempotencyKey(7).length).toBeLessThanOrEqual(256)
    expect(store.updates).toEqual([
      { id: 7, data: { migrationNoticeSentAt: '2026-09-16T12:00:00.000Z' } },
      { id: 8, data: { migrationNoticeSentAt: '2026-09-16T12:00:00.000Z' } },
    ])
    // Szünet CSAK a küldések között (az első elé nem), a Resend-korlát alatt.
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(MIGRATION_NOTICE_SEND_DELAY_MS)
    expect(MIGRATION_NOTICE_SEND_DELAY_MS).toBeGreaterThanOrEqual(100) // ≤ 10 kérés/mp
  })

  it('--force kör: az idempotencia-kulcs a kör-azonosítót is hordozza, így a szolgáltató nem nyeli el', async () => {
    // Cáfolható állítás: a Resend a kulcsot 24 óráig őrzi; az alap kulccsal
    // egy szándékos újraküldés a szolgáltatónál néma no-op lenne.
    const store = db([user({ id: 7, email: 'a@example.com' })])
    const send = vi.fn<(input: SendMailInput) => Promise<SendResult>>(async () => ok())
    const round = migrationNoticeForceRound(new Date('2026-09-17T08:05:00.000Z'))
    expect(round).toBe('ujra-202609170805')
    expect(migrationNoticeIdempotencyKey(7, round)).toBe(`migracio-7-${round}`)
    expect(migrationNoticeIdempotencyKey(7, '')).toBe('migracio-7')
    await sendMigrationNotices(fakePayload(store), [recipient(7, 'a@example.com')], {
      serverUrl: 'https://kineticare.example.com',
      send,
      sleep: async () => undefined,
      idempotencyRound: round,
    })
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      idempotencyKey: migrationNoticeIdempotencyKey(7, round),
    })
    // Kör-azonosító nélkül (normál kör) marad a fiók-alapú kulcs.
    const alap = vi.fn<(input: SendMailInput) => Promise<SendResult>>(async () => ok())
    await sendMigrationNotices(
      fakePayload(db([user({ id: 7, email: 'a@example.com' })])),
      [recipient(7, 'a@example.com')],
      {
        serverUrl: 'https://kineticare.example.com',
        send: alap,
        sleep: async () => undefined,
      },
    )
    expect(alap.mock.calls[0]?.[0]).toMatchObject({ idempotencyKey: 'migracio-7' })
  })

  it('a bukott küldés nem állítja meg a kört, nem jelöl, és a végén listázódik', async () => {
    const store = db([
      user({ id: 1, email: 'a@example.com' }),
      user({ id: 2, email: 'b@example.com' }),
    ])
    const send = vi.fn(async (input: { to: string | string[] }): Promise<SendResult> =>
      input.to === 'a@example.com'
        ? { ok: false, provider: 'resend', retryable: false, error: 'HTTP 422' }
        : ok(),
    )
    const outcomes: string[] = []
    const result = await sendMigrationNotices(
      fakePayload(store),
      [recipient(1, 'a@example.com'), recipient(2, 'b@example.com')],
      {
        serverUrl: 'https://kineticare.example.com',
        send,
        sleep: async () => undefined,
        onOutcome: (o) => outcomes.push(`${o.email}:${o.ok ? 'ok' : o.error}`),
      },
    )
    expect(outcomes).toEqual(['a@example.com:HTTP 422', 'b@example.com:ok'])
    expect(result.summary).toEqual({ elkuldve: 1, sikertelen: 1, jelolesSikertelen: 0 })
    expect(store.updates.map((u) => u.id)).toEqual([2])
  })

  it('újrapróbálható hibát (429) legfeljebb kétszer újrapróbál, növekvő szünettel', async () => {
    const store = db([user({ id: 1, email: 'a@example.com' })])
    const send = vi
      .fn<() => Promise<SendResult>>()
      .mockResolvedValueOnce({ ok: false, provider: 'resend', retryable: true, error: '429' })
      .mockResolvedValueOnce({ ok: false, provider: 'resend', retryable: true, error: '429' })
      .mockResolvedValueOnce(ok())
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined)
    const result = await sendMigrationNotices(fakePayload(store), [recipient(1, 'a@example.com')], {
      serverUrl: 'https://kineticare.example.com',
      send,
      sleep,
    })
    expect(result.outcomes[0]).toMatchObject({ ok: true, attempts: 3 })
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([...MIGRATION_NOTICE_RETRY_DELAYS_MS])
    // Ugyanaz a kulcs megy minden kísérletben: a szolgáltató nem duplikál.
    expect(new Set(send.mock.calls.map(() => 'migracio-1')).size).toBe(1)
  })

  it('a harmadik 429 után végleg sikertelen (nem végtelen ciklus)', async () => {
    const store = db([user({ id: 1, email: 'a@example.com' })])
    const send = vi.fn(async (): Promise<SendResult> => ({
      ok: false,
      provider: 'resend',
      retryable: true,
      error: '429',
    }))
    const result = await sendMigrationNotices(fakePayload(store), [recipient(1, 'a@example.com')], {
      serverUrl: 'https://kineticare.example.com',
      send,
      sleep: async () => undefined,
    })
    expect(send).toHaveBeenCalledTimes(1 + MIGRATION_NOTICE_RETRY_DELAYS_MS.length)
    expect(result.outcomes[0]).toMatchObject({ ok: false, attempts: 3, error: '429' })
    expect(store.updates).toEqual([])
  })

  it('a küldő kivétele sem dönti el a kört (végleges hibaként könyvelődik)', async () => {
    const store = db([user({ id: 1, email: 'a@example.com' })])
    const send = vi.fn(async (): Promise<SendResult> => {
      throw new Error('hálózat (teszt)')
    })
    const result = await sendMigrationNotices(fakePayload(store), [recipient(1, 'a@example.com')], {
      serverUrl: 'https://kineticare.example.com',
      send,
      sleep: async () => undefined,
    })
    expect(result.outcomes[0]).toMatchObject({ ok: false, error: 'hálózat (teszt)', attempts: 1 })
  })

  it('ha a levél kiment, de a jelölés bukik: elküldve marad, markFailed jelzéssel', async () => {
    const store = db([user({ id: 1, email: 'a@example.com' })], { failMarkFor: [1] })
    const result = await sendMigrationNotices(fakePayload(store), [recipient(1, 'a@example.com')], {
      serverUrl: 'https://kineticare.example.com',
      send: async () => ok(),
      sleep: async () => undefined,
    })
    expect(result.outcomes[0]).toMatchObject({ ok: true, markFailed: true })
    expect(result.summary).toEqual({ elkuldve: 1, sikertelen: 0, jelolesSikertelen: 1 })
  })

  it('üres címzettlista: nem küld, nem hiba', async () => {
    const send = vi.fn(async () => ok())
    const result = await sendMigrationNotices(fakePayload(db([])), [], {
      serverUrl: 'https://kineticare.example.com',
      send,
      sleep: async () => undefined,
    })
    expect(send).not.toHaveBeenCalled()
    expect(result.summary.elkuldve).toBe(0)
  })
})
