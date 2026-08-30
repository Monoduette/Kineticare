import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FIRST_USER_BOOTSTRAP_FORBIDDEN_MESSAGE,
  FIRST_USER_BOOTSTRAP_HEADER,
  FIRST_USER_BOOTSTRAP_TOKEN_ENV,
  FIRST_USER_BOOTSTRAP_TOKEN_MIN_LENGTH,
  FIRST_USER_BOOTSTRAP_UNAVAILABLE_MESSAGE,
  Users,
} from '../../collections/Users'

const VALID_BOOTSTRAP_TOKEN = 'DUMMY-bootstrap-token-at-least-32-characters'

interface CapturedQuery {
  params: unknown[]
  sql: string
}

type HookReq = {
  context?: Record<string, unknown>
  headers: Headers
  payload: {
    count: (args: unknown) => Promise<{ totalDocs: number }>
    db: {
      execute: (args: { db: unknown; sql: unknown }) => Promise<unknown>
      sessions?: Record<string, { db: unknown }>
    }
  }
  transactionID?: Promise<string>
  url?: string
  user?: { id: number; role: 'customer' | 'owner' | 'staff' } | null
}

type HookArgs = {
  data: Record<string, unknown>
  operation: 'create' | 'update'
  originalDoc?: Record<string, unknown>
  req: HookReq
}

const beforeChangeHook = (name: string): ((args: HookArgs) => Promise<Record<string, unknown>>) => {
  const hook = (Users.hooks?.beforeChange ?? []).find((candidate) => candidate.name === name)
  if (!hook) {
    throw new Error(`a Users beforeChange láncában nincs '${name}' hook`)
  }
  return hook as unknown as (args: HookArgs) => Promise<Record<string, unknown>>
}

const promoteFirstUserToOwner = beforeChangeHook('promoteFirstUserToOwner')
const enforcePasswordPolicy = beforeChangeHook('enforcePasswordPolicy')

function captureQuery(query: unknown): CapturedQuery {
  const candidate = query as { queryChunks?: unknown[] }
  const chunks = Array.isArray(candidate.queryChunks) ? candidate.queryChunks : []
  const text: string[] = []
  const params: unknown[] = []
  for (const chunk of chunks) {
    const value =
      typeof chunk === 'object' && chunk !== null ? (chunk as { value?: unknown }).value : undefined
    if (Array.isArray(value)) {
      text.push(value.join(''))
    } else {
      params.push(chunk)
    }
  }
  return { params, sql: text.join('') }
}

function createRequest({
  context = {},
  counts = [0, 0],
  token = VALID_BOOTSTRAP_TOKEN,
  url = 'http://localhost/api/users/first-register',
  user = null,
}: {
  context?: Record<string, unknown> | null
  counts?: number[]
  token?: string | null
  url?: string
  user?: HookReq['user']
} = {}) {
  let countIndex = 0
  const order: string[] = []
  const queries: CapturedQuery[] = []
  const count = vi.fn(async () => {
    order.push('count')
    const value = counts[Math.min(countIndex, counts.length - 1)] ?? 0
    countIndex += 1
    return { totalDocs: value }
  })
  const transaction = { requestTransaction: true }
  const execute = vi.fn(async ({ sql }: { db: unknown; sql: unknown }) => {
    queries.push(captureQuery(sql))
    order.push('lock')
    return { rows: [] }
  })
  const headers = new Headers()
  if (token !== null) {
    headers.set(FIRST_USER_BOOTSTRAP_HEADER, token)
  }
  const req: HookReq = {
    context: context === null ? undefined : context,
    headers,
    payload: { count, db: { execute, sessions: { tx1: { db: transaction } } } },
    transactionID: Promise.resolve('tx1'),
    url,
    user,
  }
  return { count, execute, order, queries, req, transaction }
}

async function runBothHooks(req: HookReq, data: Record<string, unknown>) {
  const afterPromote = await promoteFirstUserToOwner({ data, operation: 'create', req })
  return enforcePasswordPolicy({ data: afterPromote, operation: 'create', req })
}

beforeEach(() => {
  vi.stubEnv(FIRST_USER_BOOTSTRAP_TOKEN_ENV, VALID_BOOTSTRAP_TOKEN)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('promoteFirstUserToOwner — operátori bootstrap', () => {
  it('valid tokennel ugyanabban a request tranzakcióban zár, újraszámol és ownert ad', async () => {
    const { count, execute, order, queries, req, transaction } = createRequest()

    const data = await promoteFirstUserToOwner({
      data: { email: 'elso@kineticare.test' },
      operation: 'create',
      req,
    })

    expect(data.role).toBe('owner')
    expect(order).toEqual(['count', 'lock', 'count'])
    expect(count).toHaveBeenCalledTimes(2)
    expect(count).toHaveBeenNthCalledWith(1, {
      collection: 'users',
      overrideAccess: true,
      req,
    })
    expect(count).toHaveBeenNthCalledWith(2, {
      collection: 'users',
      overrideAccess: true,
      req,
    })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith({ db: transaction, sql: expect.anything() })
    expect(queries[0]?.sql).toContain('pg_advisory_xact_lock')
    expect(queries[0]?.sql).toContain('hashtextextended')
    expect(queries[0]?.sql).not.toContain('kineticare:first-user-bootstrap')
    expect(queries[0]?.params).toEqual(['kineticare:first-user-bootstrap'])
  })

  it('hiányzó production secret esetén 503-mal fail-closed', async () => {
    vi.stubEnv(FIRST_USER_BOOTSTRAP_TOKEN_ENV, '')
    const { req } = createRequest()

    await expect(
      promoteFirstUserToOwner({ data: {}, operation: 'create', req }),
    ).rejects.toMatchObject({
      message: FIRST_USER_BOOTSTRAP_UNAVAILABLE_MESSAGE,
      status: 503,
    })
  })

  it('32 karakternél rövidebb production secretet konfigurációs hibának tekint', async () => {
    vi.stubEnv(
      FIRST_USER_BOOTSTRAP_TOKEN_ENV,
      'x'.repeat(FIRST_USER_BOOTSTRAP_TOKEN_MIN_LENGTH - 1),
    )
    const { req } = createRequest({ token: 'x'.repeat(FIRST_USER_BOOTSTRAP_TOKEN_MIN_LENGTH - 1) })

    await expect(
      promoteFirstUserToOwner({ data: {}, operation: 'create', req }),
    ).rejects.toMatchObject({
      message: FIRST_USER_BOOTSTRAP_UNAVAILABLE_MESSAGE,
      status: 503,
    })
  })

  it.each([
    ['hiányzó', null],
    ['hibás', 'DUMMY-wrong-bootstrap-token-at-least-32-chars'],
  ])('%s request token esetén 403-at ad', async (_label, token) => {
    const { req } = createRequest({ token })

    await expect(
      promoteFirstUserToOwner({ data: {}, operation: 'create', req }),
    ).rejects.toMatchObject({
      message: FIRST_USER_BOOTSTRAP_FORBIDDEN_MESSAGE,
      status: 403,
    })
  })

  it('üres DB-n a normál publikus create token nélkül nem hoz létre usert', async () => {
    const { req } = createRequest({ token: null, url: 'http://localhost/api/users' })

    await expect(
      promoteFirstUserToOwner({ data: { role: 'owner' }, operation: 'create', req }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('meglévő user után a publikus create mindig customer és nem kér plusz zárat', async () => {
    const { count, execute, req } = createRequest({
      counts: [1],
      token: null,
      url: 'http://localhost/api/users',
    })

    const data = await promoteFirstUserToOwner({
      data: { email: 'masodik@kineticare.test', role: 'owner' },
      operation: 'create',
      req,
    })

    expect(data.role).toBe('customer')
    expect(count).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalled()
  })

  it('meglévő usernél a first-register 403, nem hoz létre második customert', async () => {
    const { execute, req } = createRequest({ counts: [1] })

    await expect(
      promoteFirstUserToOwner({ data: {}, operation: 'create', req }),
    ).rejects.toMatchObject({ status: 403 })
    expect(execute).not.toHaveBeenCalled()
  })

  it('üres DB-n request tranzakció nélkül productionben és testben is 503', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    const { count, req } = createRequest()
    req.transactionID = undefined

    await expect(
      promoteFirstUserToOwner({ data: {}, operation: 'create', req }),
    ).rejects.toMatchObject({ status: 503 })
    expect(count).toHaveBeenCalledTimes(1)
  })

  it('hiányzó request session esetén sem esik vissza zár nélküli futásra', async () => {
    const { count, execute, req } = createRequest()
    req.payload.db.sessions = {}

    await expect(
      promoteFirstUserToOwner({ data: {}, operation: 'create', req }),
    ).rejects.toMatchObject({ status: 503 })
    expect(count).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalled()
  })

  it('belső, hitelesített create meglévő user után megőrzi az explicit szerepkört', async () => {
    const { req } = createRequest({
      counts: [1],
      url: 'http://localhost/internal',
      user: { id: 7, role: 'owner' },
    })

    const data = await promoteFirstUserToOwner({
      data: { role: 'staff' },
      operation: 'create',
      req,
    })

    expect(data.role).toBe('staff')
  })

  it('update műveletnél nem countol és nem zár', async () => {
    const { count, execute, req } = createRequest()

    const data = await promoteFirstUserToOwner({
      data: { name: 'Új név' },
      operation: 'update',
      req,
    })

    expect(data.role).toBeUndefined()
    expect(count).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })
})

describe('első owner jelszó-politikája', () => {
  it('a valid bootstrap-token sem enged gyenge owner-jelszót', async () => {
    const { count, req } = createRequest()

    await expect(
      runBothHooks(req, {
        email: 'elso@kineticare.test',
        password: 'gyenge',
      }),
    ).rejects.toThrow(/karakter/)
    expect(count).toHaveBeenCalledTimes(2)
  })

  it('az erős jelszavas, valid tokenes first-owner bootstrap sikeres', async () => {
    const { count, req } = createRequest()

    const data = await runBothHooks(req, {
      email: 'elso@kineticare.test',
      password: 'DUMMY-Eros-Teszt-Jelszo-42',
    })

    expect(data.role).toBe('owner')
    expect(data.password).toBe('DUMMY-Eros-Teszt-Jelszo-42')
    expect(count).toHaveBeenCalledTimes(2)
  })

  it('meglévő usernél egy count elég és a jelszó-politika érvényesül', async () => {
    const { count, req } = createRequest({
      counts: [1],
      token: null,
      url: 'http://localhost/api/users',
    })

    await expect(
      runBothHooks(req, { email: 'masodik@kineticare.test', password: 'gyenge' }),
    ).rejects.toThrow(/karakter/)
    expect(count).toHaveBeenCalledTimes(1)
  })

  it('context nélküli unit mockon is erős jelszó kell', async () => {
    const { count, req } = createRequest({ context: null })

    await expect(
      runBothHooks(req, {
        email: 'elso@kineticare.test',
        password: 'gyenge',
      }),
    ).rejects.toThrow(/karakter/)
    expect(count).toHaveBeenCalledTimes(2)
  })
})

describe('first-register konkurencia adapter-contract', () => {
  it('két nullás pre-countból a request-tx lock után egy owner és egy 403 születik', async () => {
    let users = 0
    let firstReads = 0
    let releaseInitialReads: (() => void) | undefined
    const initialReadsDone = new Promise<void>((resolve) => {
      releaseInitialReads = resolve
    })
    let lockTail = Promise.resolve()

    const createConcurrentRequest = () => {
      let countCalls = 0
      let releaseLock: (() => void) | undefined
      const count = vi.fn(async () => {
        countCalls += 1
        if (countCalls === 1) {
          firstReads += 1
          if (firstReads === 2) {
            releaseInitialReads?.()
          }
          await initialReadsDone
          return { totalDocs: 0 }
        }
        return { totalDocs: users }
      })
      const execute = vi.fn(async () => {
        const previous = lockTail
        let releaseCurrent: (() => void) | undefined
        const current = new Promise<void>((resolve) => {
          releaseCurrent = resolve
        })
        lockTail = previous.then(() => current)
        await previous
        releaseLock = releaseCurrent
        return { rows: [] }
      })
      const req: HookReq = {
        context: {},
        headers: new Headers({ [FIRST_USER_BOOTSTRAP_HEADER]: VALID_BOOTSTRAP_TOKEN }),
        payload: {
          count,
          db: {
            execute,
            sessions: { tx1: { db: { requestTransaction: true } } },
          },
        },
        transactionID: Promise.resolve('tx1'),
        url: 'http://localhost/api/users/first-register',
        user: null,
      }
      return {
        count,
        execute,
        release: () => releaseLock?.(),
        req,
      }
    }

    const first = createConcurrentRequest()
    const second = createConcurrentRequest()
    const claim = async (request: ReturnType<typeof createConcurrentRequest>) => {
      try {
        const data = await promoteFirstUserToOwner({
          data: { email: 'claim@kineticare.test' },
          operation: 'create',
          req: request.req,
        })
        users += 1
        return data
      } finally {
        request.release()
      }
    }

    const results = await Promise.allSettled([claim(first), claim(second)])
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Record<string, unknown>> =>
        result.status === 'fulfilled',
    )
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )

    expect(fulfilled).toHaveLength(1)
    expect(fulfilled[0]?.value.role).toBe('owner')
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toMatchObject({ status: 403 })
    expect(users).toBe(1)
    expect(first.execute).toHaveBeenCalledTimes(1)
    expect(second.execute).toHaveBeenCalledTimes(1)
    expect(first.count).toHaveBeenCalledTimes(2)
    expect(second.count).toHaveBeenCalledTimes(2)
  })
})
