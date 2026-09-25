import type { Payload } from 'payload'
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import {
  SESSION_LOCK_ACQUIRE_TIMEOUT_MS,
  withAdvisoryLock,
  withSessionAdvisoryLock,
} from '../lib/advisory-lock'
import { createLogger } from '../lib/logger'

/**
 * S2 — Postgres advisory-zár (src/lib/advisory-lock.ts).
 *
 * A tesztek a drizzle-példányt szerkezetileg utánozzák (tranzakció + execute),
 * és azt igazolják, hogy
 *  - a zár a `fn` ELŐTT kerül megszerzésre, a tranzakción belül,
 *  - a kulcs KÖTÖTT paraméterként megy át (nincs string-összefűzés),
 *  - a `fn` hibája a tranzakción keresztül propagál (a zárat a Postgres a
 *    rollbacknél elengedi — kézi unlock nincs),
 *  - drizzle nélkül production-ben DOB (nem fut némán, zár nélkül),
 *    nem-production környezetben viszont zár nélkül lefut.
 */

interface CapturedQuery {
  sql: string
  params: unknown[]
}

/** Szerkezeti drizzle-mock: a valódi példány `transaction` + `execute` felülete. */
function createDrizzleMock() {
  const queries: CapturedQuery[] = []
  const order: string[] = []
  const drizzle = {
    transaction: async <T>(
      run: (tx: { execute: (query: unknown) => Promise<unknown> }) => Promise<T>,
    ): Promise<T> => {
      order.push('transaction-start')
      try {
        return await run({
          execute: async (query: unknown) => {
            const candidate = query as { queryChunks?: unknown[] }
            // A drizzle `sql` template SQL-objektumot ad: a szöveges darabok
            // (StringChunk, `value` = string-tömb) és a kötött paraméterek
            // KÜLÖN élnek a queryChunks-ban — pont ezt akarjuk igazolni.
            const chunks = Array.isArray(candidate.queryChunks) ? candidate.queryChunks : []
            const text: string[] = []
            const params: unknown[] = []
            for (const chunk of chunks) {
              const stringChunk =
                typeof chunk === 'object' && chunk !== null
                  ? (chunk as { value?: unknown }).value
                  : undefined
              if (Array.isArray(stringChunk)) {
                text.push(stringChunk.join(''))
              } else {
                params.push(chunk)
              }
            }
            queries.push({ sql: text.join(''), params })
            order.push('lock-acquired')
            return { rows: [] }
          },
        })
      } finally {
        order.push('transaction-end')
      }
    },
  }
  const payload = { db: { drizzle } } as unknown as Payload
  return { payload, queries, order }
}

const logOutput = (spy: MockInstance<(...args: unknown[]) => void>): string =>
  spy.mock.calls.map((call) => call.map((arg) => String(arg)).join(' ')).join('\n')

afterEach(() => {
  // A NODE_ENV a Next.js típusaiban csak olvasható, ezért a vitest env-stubja
  // (nem közvetlen értékadás) állítja — a unstub visszaadja az eredetit.
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('withAdvisoryLock — drizzle-példánnyal', () => {
  it('a zárat a fn ELŐTT szerzi meg, tranzakción belül, és a fn értékét adja vissza', async () => {
    const { payload, order } = createDrizzleMock()

    const result = await withAdvisoryLock(
      payload,
      'checkout:7:42',
      async () => {
        order.push('fn')
        return 'kesz'
      },
      createLogger(),
    )

    expect(result).toBe('kesz')
    expect(order).toEqual(['transaction-start', 'lock-acquired', 'fn', 'transaction-end'])
  })

  it('pg_advisory_xact_lock + hashtextextended, a kulcs KÖTÖTT paraméterként', async () => {
    const { payload, queries } = createDrizzleMock()

    await withAdvisoryLock(payload, 'checkout:7:42', async () => undefined, createLogger())

    expect(queries).toHaveLength(1)
    const [query] = queries
    expect(query.sql).toContain('pg_advisory_xact_lock')
    expect(query.sql).toContain('hashtextextended')
    // A kulcs NEM része a lekérdezés szövegének — paraméterként utazik.
    expect(query.sql).not.toContain('checkout:7:42')
    expect(query.params).toEqual(['checkout:7:42'])
  })

  it('a fn hibája propagál (a zár a rollbackkel magától elengedődik)', async () => {
    const { payload, order } = createDrizzleMock()

    await expect(
      withAdvisoryLock(
        payload,
        'checkout:7:42',
        async () => {
          throw new Error('üzleti hiba a védett szakaszban')
        },
        createLogger(),
      ),
    ).rejects.toThrowError(/üzleti hiba a védett szakaszban/)

    expect(order).toEqual(['transaction-start', 'lock-acquired', 'transaction-end'])
  })
})

describe('withAdvisoryLock — drizzle nélkül', () => {
  const payloadWithoutDrizzle = { db: {} } as unknown as Payload

  it('PRODUCTION-ben riaszt és DOB (néma, zár nélküli futás TILOS)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubEnv('NODE_ENV', 'production')
    const fn = vi.fn(async () => 'nem futhat')

    await expect(
      withAdvisoryLock(payloadWithoutDrizzle, 'checkout:7:42', fn, createLogger()),
    ).rejects.toThrowError(/nem szerezhető meg/)

    expect(fn).not.toHaveBeenCalled()
    expect(logOutput(logSpy)).toContain('RIASZT')
  })

  it('nem-production környezetben a fn zár nélkül lefut, figyelmeztetéssel', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubEnv('NODE_ENV', 'test')

    const result = await withAdvisoryLock(
      payloadWithoutDrizzle,
      'checkout:7:42',
      async () => 'lefutott',
      createLogger(),
    )

    expect(result).toBe('lefutott')
    expect(logOutput(logSpy)).toContain('advisory-zár kihagyva')
  })
})

/**
 * Session-szintű zár dedikált kapcsolaton (a-callback-7, a-szamlazz-11): a
 * HTTP-t átívelő védett szakaszok zárja. A szerződés: a zár ÉS a kapcsolat
 * minden úton elengedődik, és egy zárat (esetleg) még tartó kapcsolat soha nem
 * kerül vissza a poolba.
 */
interface FakeClientOptions {
  /** A pg_try_advisory_lock egymás utáni válaszai (az utolsó ismétlődik). */
  lockResults?: boolean[]
  acquireError?: Error
  unlockError?: Error
  unlockResult?: boolean
}

function createPoolMock(options: FakeClientOptions = {}) {
  const events: string[] = []
  const listeners = new Set<(error: Error) => void>()
  const lockResults = [...(options.lockResults ?? [true])]
  const release = vi.fn((destroy?: Error | boolean) => {
    events.push(destroy ? 'release-destroy' : 'release')
  })
  const client = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      if (text.includes('pg_try_advisory_lock')) {
        events.push('try-lock')
        expect(values).toEqual(['barion-callback:teszt'])
        expect(text).not.toContain('barion-callback:teszt')
        if (options.acquireError) throw options.acquireError
        const locked = lockResults.length > 1 ? lockResults.shift() : lockResults[0]
        return { rows: [{ locked }] }
      }
      if (text.includes('pg_advisory_unlock')) {
        events.push('unlock')
        if (options.unlockError) throw options.unlockError
        return { rows: [{ unlocked: options.unlockResult ?? true }] }
      }
      throw new Error(`váratlan lekérdezés: ${text}`)
    }),
    on: vi.fn((_event: 'error', listener: (error: Error) => void) => {
      listeners.add(listener)
    }),
    removeListener: vi.fn((_event: 'error', listener: (error: Error) => void) => {
      listeners.delete(listener)
    }),
    release,
  }
  const pool = { connect: vi.fn(async () => client) }
  const payload = { db: { pool } } as unknown as Payload
  const emitClientError = (error: Error) => {
    for (const listener of listeners) listener(error)
  }
  return { payload, client, pool, events, listeners, release, emitClientError }
}

describe('withSessionAdvisoryLock — a zár és a kapcsolat minden úton elengedődik', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('siker: zár → fn → unlock → a kapcsolat vissza a poolba, a figyelő levéve', async () => {
    const mock = createPoolMock()
    const result = await withSessionAdvisoryLock(
      mock.payload,
      'barion-callback:teszt',
      async () => {
        mock.events.push('fn')
        expect(mock.listeners.size).toBe(1)
        return 'kesz'
      },
      createLogger(),
    )
    expect(result).toBe('kesz')
    expect(mock.events).toEqual(['try-lock', 'fn', 'unlock', 'release'])
    expect(mock.release).toHaveBeenCalledWith(undefined)
    expect(mock.listeners.size).toBe(0)
  })

  it('a fn hibája propagál, a zár mégis unlockkal elengedődik, a kapcsolat visszakerül', async () => {
    const mock = createPoolMock()
    await expect(
      withSessionAdvisoryLock(
        mock.payload,
        'barion-callback:teszt',
        async () => {
          throw new Error('üzleti hiba')
        },
        createLogger(),
      ),
    ).rejects.toThrowError('üzleti hiba')
    expect(mock.events).toEqual(['try-lock', 'unlock', 'release'])
    expect(mock.listeners.size).toBe(0)
  })

  it('foglalt zár: újrapróbál, és a felszabadulás után fut', async () => {
    vi.useFakeTimers()
    const mock = createPoolMock({ lockResults: [false, false, true] })
    const fn = vi.fn(async () => 'kesz')
    const run = withSessionAdvisoryLock(mock.payload, 'barion-callback:teszt', fn, createLogger())
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(run).resolves.toBe('kesz')
    expect(mock.events).toEqual(['try-lock', 'try-lock', 'try-lock', 'unlock', 'release'])
  })

  it('időtúllépés: a fn nem fut, nincs unlock, a kapcsolat visszakerül, beszédes hiba', async () => {
    vi.useFakeTimers()
    const mock = createPoolMock({ lockResults: [false] })
    const fn = vi.fn(async () => 'nem futhat')
    const run = withSessionAdvisoryLock(mock.payload, 'barion-callback:teszt', fn, createLogger())
    const settled = run.catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(SESSION_LOCK_ACQUIRE_TIMEOUT_MS + 1_000)
    const error = await settled
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/sem szerezhető meg/)
    expect(fn).not.toHaveBeenCalled()
    expect(mock.events).not.toContain('unlock')
    expect(mock.events.at(-1)).toBe('release')
    expect(mock.listeners.size).toBe(0)
  })

  it('a kapcsolat hibája a fn közben: RIASZTÁS, nincs unlock-kísérlet, a kapcsolat ELDOBVA', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const mock = createPoolMock()
    const result = await withSessionAdvisoryLock(
      mock.payload,
      'barion-callback:teszt',
      async () => {
        mock.emitClientError(new Error('Connection terminated unexpectedly'))
        return 'lefutott'
      },
      createLogger(),
    )
    expect(result).toBe('lefutott')
    expect(mock.events).toEqual(['try-lock', 'release-destroy'])
    expect(logOutput(logSpy)).toContain('RIASZTÁS: az advisory-zár kapcsolata megszakadt')
    expect(mock.listeners.size).toBe(0)
  })

  it('az unlock hibája vagy hamis válasza: a kapcsolat ELDOBVA (zárat tartó kapcsolat nem kerül vissza)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const failing = createPoolMock({ unlockError: new Error('unlock hiba') })
    await withSessionAdvisoryLock(
      failing.payload,
      'barion-callback:teszt',
      async () => 1,
      createLogger(),
    )
    expect(failing.events).toEqual(['try-lock', 'unlock', 'release-destroy'])

    const falseUnlock = createPoolMock({ unlockResult: false })
    await withSessionAdvisoryLock(
      falseUnlock.payload,
      'barion-callback:teszt',
      async () => 1,
      createLogger(),
    )
    expect(falseUnlock.events).toEqual(['try-lock', 'unlock', 'release-destroy'])
  })

  it('a zár-lekérdezés hibája: a fn nem fut, a kapcsolat ELDOBVA', async () => {
    const mock = createPoolMock({ acquireError: new Error('statement timeout') })
    const fn = vi.fn(async () => 1)
    await expect(
      withSessionAdvisoryLock(mock.payload, 'barion-callback:teszt', fn, createLogger()),
    ).rejects.toThrowError('statement timeout')
    expect(fn).not.toHaveBeenCalled()
    expect(mock.events).toEqual(['try-lock', 'release-destroy'])
  })

  it('pool nélkül production-ben dob, a fn nem fut', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubEnv('NODE_ENV', 'production')
    const fn = vi.fn(async () => 1)
    await expect(
      withSessionAdvisoryLock({ db: {} } as unknown as Payload, 'k', fn, createLogger()),
    ).rejects.toThrowError(/nem szerezhető meg/)
    expect(fn).not.toHaveBeenCalled()
  })
})
