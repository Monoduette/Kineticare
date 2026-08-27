import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { createLogger } from '../../lib/logger'
import {
  GuestBindPrivilegedAccountError,
  resolveOrderCustomer,
} from '../../lib/order-status/resolve-order-customer'
import type { Order, User } from '../../payload-types'

/**
 * FIÓK-FELOLDÁS a fizetés után (vendég-vásárlás, 2026-08-15).
 *
 * Amit ez a fájl bizonyít:
 *  1. ÚJ e-mail → `customer` szerepkörű fiók jön létre, jelszó-beállítás
 *     függőben jelzővel, és a rendelés hozzá kötődik;
 *  2. LÉTEZŐ aktivált customer → KÖT (teljesítés-első); staff/owner reject;
 *  3. PÁRHUZAMOS callback ugyanarra az e-mailre → PONTOSAN EGY fiók
 *     (idempotencia, e-mail-szintű advisory-zár alatt);
 *  4. bejelentkezett vásárlásnál csak beolvasás történik (alreadyLinked);
 *  5. e-mail nélküli rendelésnél HANGOS hiba (nem néma elnyelés);
 *  6. ÜRES users-kollekcióra nem születik fiók (owner-promóció veszélye);
 *  7. a napló SOSEM tartalmazza a teljes e-mail-címet és a generált jelszót.
 *
 * A valódi advisory-zár helyére kulcsonkénti in-memory mutex kerül (a
 * checkout-lock.test.ts mintája) — így a sorosítás valódi Postgres nélkül,
 * determinisztikusan megfigyelhető. Hálózati hívás sehol nem indul.
 */

const lockState = {
  chains: new Map<string, Promise<unknown>>(),
  keys: [] as string[],
  reset(): void {
    this.chains = new Map()
    this.keys = []
  },
}

vi.mock('../../lib/advisory-lock', () => ({
  withAdvisoryLock: async <T>(
    _payload: unknown,
    lockKey: string,
    fn: () => Promise<T>,
  ): Promise<T> => {
    lockState.keys.push(lockKey)
    const previous = lockState.chains.get(lockKey) ?? Promise.resolve()
    const run = previous.then(() => fn())
    lockState.chains.set(
      lockKey,
      run.then(
        () => undefined,
        () => undefined,
      ),
    )
    return run as Promise<T>
  },
}))

const log = createLogger({ module: 'teszt' })
const EMAIL = 'vendeg@example.test'

interface FakeUser {
  id: number
  email: string
  name: string
  role: string
  password?: string
  passwordSetupPending?: boolean
}

/**
 * A rendszerben MINDIG van legalább egy (tulajdonosi) fiók — a vendég-feloldás
 * üres kollekcióra szándékosan nem hoz létre semmit (owner-promóció veszélye,
 * lásd a külön tesztet). A fixtúra ezért ezzel az egy fiókkal indul.
 */
const OWNER: FakeUser = {
  id: 1,
  email: 'tulaj@example.test',
  name: 'Tulajdonos',
  role: 'owner',
}

function createFakePayload(users: FakeUser[] = []) {
  const state = {
    users: [OWNER, ...users],
    nextId: [OWNER, ...users].reduce((max, user) => Math.max(max, user.id), 0) + 1,
    creates: [] as Array<Record<string, unknown>>,
    orderUpdates: [] as Array<{ id: number | string; data: Record<string, unknown> }>,
  }
  const payload = {
    find: vi.fn(async (args: { collection: string; where?: { email?: { equals?: unknown } } }) => {
      if (args.collection !== 'users') {
        return { docs: [], totalDocs: 0 }
      }
      const wanted = args.where?.email?.equals
      const docs = state.users.filter((user) => user.email === wanted)
      return { docs, totalDocs: docs.length }
    }),
    findByID: vi.fn(async ({ id }: { id: number }) => {
      const user = state.users.find((entry) => entry.id === id)
      if (!user) {
        throw new Error('Not Found')
      }
      return user as unknown as User
    }),
    count: vi.fn(async () => ({ totalDocs: state.users.length })),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      state.creates.push(data)
      const email = String(data.email)
      if (state.users.some((user) => user.email === email)) {
        // A Payload egyedi-kényszere (registerLocalStrategy) így viselkedik.
        throw new Error('The email address is already registered.')
      }
      const user: FakeUser = {
        id: state.nextId,
        email,
        name: String(data.name ?? ''),
        role: String(data.role ?? 'customer'),
        password: typeof data.password === 'string' ? data.password : undefined,
        passwordSetupPending: data.passwordSetupPending === true,
      }
      state.nextId += 1
      state.users.push(user)
      return user as unknown as User
    }),
    update: vi.fn(
      async ({
        collection,
        id,
        data,
      }: {
        collection: string
        id: number | string
        data: Record<string, unknown>
      }) => {
        if (collection === 'orders') {
          state.orderUpdates.push({ id, data })
        }
        return { id, ...data }
      },
    ),
  }
  return { payload: payload as unknown as Payload, state }
}

function guestOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 101,
    orderNumber: 'KH-2026-000123',
    status: 'payment_pending',
    customerEmail: EMAIL,
    customerSnapshot: { id: null, email: EMAIL, name: 'Vendég Vevő' },
    items: [{ product: 42, quantity: 1 }],
    ...overrides,
  } as unknown as Order
}

const logOutput = (spy: MockInstance<(...args: unknown[]) => void>): string =>
  spy.mock.calls.map((call) => call.map((arg) => String(arg)).join(' ')).join('\n')

beforeEach(() => {
  lockState.reset()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveOrderCustomer — vendég-vásárlás fiók-feloldása', () => {
  it('ÚJ e-mail: customer szerepkörű fiók jön létre, jelszó-beállítás függőben, a rendelés hozzá kötve', async () => {
    const { payload, state } = createFakePayload()

    const result = await resolveOrderCustomer({ payload, order: guestOrder(), log })

    expect(result).toMatchObject({
      created: true,
      alreadyLinked: false,
      passwordSetupPending: true,
      email: EMAIL,
    })
    expect(state.creates).toHaveLength(1)
    expect(state.creates[0]).toMatchObject({
      email: EMAIL,
      name: 'Vendég Vevő',
      role: 'customer',
      passwordSetupPending: true,
    })
    // A jelszó véletlen és eldobható — de LÉTEZNIE kell (a Payload jelszó
    // nélkül nem hoz létre auth-rekordot).
    expect(typeof state.creates[0].password).toBe('string')
    // A rendelés a fiókhoz kötve.
    expect(state.orderUpdates).toEqual([{ id: 101, data: { customer: result.userId } }])
    // A zár az e-mail-címre szólt.
    expect(lockState.keys).toEqual([`order-customer:${EMAIL}`])
  })

  it('LÉTEZŐ staff fiók: NEM köt, GuestBindPrivilegedAccountError (terminális reject)', async () => {
    const { payload, state } = createFakePayload([
      {
        id: 7,
        email: EMAIL,
        name: 'Eredeti Név',
        role: 'staff',
        password: 'DUMMY-NEM-VALODI-HASH',
        passwordSetupPending: false,
      },
    ])

    const error = await resolveOrderCustomer({ payload, order: guestOrder(), log }).catch(
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(GuestBindPrivilegedAccountError)
    expect(error).toMatchObject({
      reason: 'guest-bind-privileged-account',
      name: 'GuestBindPrivilegedAccountError',
    })
    expect(state.creates).toHaveLength(0)
    expect(state.orderUpdates).toHaveLength(0)
    expect(state.users[1]).toMatchObject({
      name: 'Eredeti Név',
      role: 'staff',
      password: 'DUMMY-NEM-VALODI-HASH',
    })
  })

  it('LÉTEZŐ aktivált customer: KÖT, nincs új fiók, passwordSetupPending false', async () => {
    const { payload, state } = createFakePayload([
      {
        id: 8,
        email: EMAIL,
        name: 'Meglévő Vevő',
        role: 'customer',
        passwordSetupPending: false,
      },
    ])

    const result = await resolveOrderCustomer({ payload, order: guestOrder(), log })

    expect(result).toMatchObject({
      userId: 8,
      created: false,
      alreadyLinked: false,
      passwordSetupPending: false,
      email: EMAIL,
    })
    expect(state.creates).toHaveLength(0)
    expect(state.orderUpdates).toEqual([{ id: 101, data: { customer: 8 } }])
    expect(state.users.filter((user) => user.email === EMAIL)).toHaveLength(1)
  })

  it('LÉTEZŐ, de még AKTIVÁLATLAN fiók (import/korábbi vendég-vásárlás) → továbbra is jár a jelszó-beállító link', async () => {
    const { payload } = createFakePayload([
      { id: 9, email: EMAIL, name: 'Import Vevő', role: 'customer', passwordSetupPending: true },
    ])

    const result = await resolveOrderCustomer({ payload, order: guestOrder(), log })

    expect(result).toMatchObject({ userId: 9, created: false, passwordSetupPending: true })
  })

  it('PÁRHUZAMOS feldolgozás ugyanarra az e-mailre → PONTOSAN EGY fiók (idempotencia)', async () => {
    const { payload, state } = createFakePayload()

    const [first, second] = await Promise.all([
      resolveOrderCustomer({ payload, order: guestOrder({ id: 101 }), log }),
      resolveOrderCustomer({ payload, order: guestOrder({ id: 102 }), log }),
    ])

    expect(state.users.filter((user) => user.email === EMAIL)).toHaveLength(1)
    expect(first.userId).toBe(second.userId)
    // A második ág a MEGLÉVŐ fiókot találta meg (nem hozott létre újat).
    expect([first.created, second.created].filter(Boolean)).toHaveLength(1)
    // Mindkét rendelés ugyanahhoz a fiókhoz kötve.
    expect(state.orderUpdates.map((update) => update.data.customer)).toEqual([
      first.userId,
      first.userId,
    ])
  })

  it('VERSENYHELYZET-TARTALÉK: ha a create egyedi-kényszerbe ütközik, a MÁSIK szál fiókját fogadjuk el', async () => {
    // A zár kihagyását (nem-production, mockolt Payload) modellezi: a create
    // pillanatában már létezik a felhasználó.
    const { payload, state } = createFakePayload()
    const originalCreate = payload.create
    payload.create = (async (args: { data: Record<string, unknown> }) => {
      state.users.push({
        id: 42,
        email: String(args.data.email),
        name: 'Közben létrejött',
        role: 'customer',
        passwordSetupPending: true,
      })
      return originalCreate(args as never)
    }) as Payload['create']

    const result = await resolveOrderCustomer({ payload, order: guestOrder(), log })

    expect(result.userId).toBe(42)
    expect(result.created).toBe(false)
    expect(state.users.filter((user) => user.email === EMAIL)).toHaveLength(1)
  })

  it('BEJELENTKEZETT vásárlás (a rendelés már fiókhoz kötött): csak beolvasás, alreadyLinked', async () => {
    const { payload, state } = createFakePayload([
      { id: 7, email: 'belepett@example.test', name: 'Belépett Vevő', role: 'customer' },
    ])

    const result = await resolveOrderCustomer({
      payload,
      order: guestOrder({ customer: 7 } as Partial<Order>),
      log,
    })

    expect(result).toMatchObject({
      userId: 7,
      created: false,
      alreadyLinked: true,
      passwordSetupPending: false,
    })
    expect(state.creates).toHaveLength(0)
    expect(state.orderUpdates).toHaveLength(0)
    // Zárat sem foglaltunk — nincs mit sorosítani.
    expect(lockState.keys).toEqual([])
  })

  it('e-mail NÉLKÜLI rendelésnél HANGOS hiba (a hozzáférés nem adható ki némán)', async () => {
    const { payload, state } = createFakePayload()

    await expect(
      resolveOrderCustomer({
        payload,
        order: guestOrder({ customerEmail: null, customerSnapshot: {} } as Partial<Order>),
        log,
      }),
    ).rejects.toThrow(/e-mail-cím/)
    expect(state.creates).toHaveLength(0)
  })

  it('ÜRES users-kollekcióra NEM születik fiók (az első user owner lenne)', async () => {
    const { payload, state } = createFakePayload()
    payload.count = (async () => ({ totalDocs: 0 })) as Payload['count']

    await expect(resolveOrderCustomer({ payload, order: guestOrder(), log })).rejects.toThrow(
      /owner/,
    )
    expect(state.creates).toHaveLength(0)
  })

  it('a NAPLÓ sem a teljes e-mail-címet, sem a generált jelszót nem tartalmazza', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { payload, state } = createFakePayload()

    await resolveOrderCustomer({ payload, order: guestOrder(), log })

    const output = logOutput(logSpy)
    const password = String(state.creates[0].password)
    expect(output).not.toContain(EMAIL)
    expect(output).not.toContain(password)
    // A maszkolt cím viszont ott van — az üzemeltetés így is azonosítja a sort.
    expect(output).toContain('v***@example.test')
  })
})
