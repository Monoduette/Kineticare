import type { Payload, Where } from 'payload'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetAlertThrottle } from '../../lib/alert-throttle'
import { createBarionCallbackProcessor } from '../../lib/barion-callback/process-callback'
import {
  MAX_WEBHOOK_ATTEMPTS,
  processWebhook,
  registerWebhookProcessor,
  type WebhookEventDoc,
  type WebhookEventStore,
} from '../../lib/idempotency'
import { webhookRetryTask } from '../../jobs/tasks/webhook-retry'

/**
 * K7 — a webhook-retry TASK-HANDLER dedikált tesztje (src/jobs/tasks/webhook-retry.ts).
 *
 * A lefedett ágak: scan → (backoff / regisztrálatlan provider) szűrés → retry →
 * siker / újrapróbálható hiba / KIMERÜLÉS / terminális rejected (M6). A
 * webhook-events tárhely őszinte, in-memory megvalósítás: a where-szűrőket
 * (status in, attempts less_than/exists, and/or) VALÓBAN kiértékeli, a sort és
 * a limitet is betartja — különben a K3-as ablak-teszt (25 kimerült + 1 új
 * failed) nem bizonyítana semmit.
 *
 * A processzorok a valódi registerWebhookProcessor-regisztráción át mennek be
 * (tesztenként felülírva). CLAUDE.md 15.: valódi hálózati hívás NEM futhat —
 * a fetch alapértelmezésben HANGOSAN DOB, és csak az M6-os integrációs teszt
 * ad neki előkészített 404-es választ.
 */

// DUMMY érték, egyértelműen jelölve — NEM valódi Barion POSKey.
const DUMMY_POS_KEY = 'DUMMY-POSKEY-NEM-VALODI-TITOK'
const PAYMENT_ID = '11111111-2222-3333-4444-555555555555'

const savedEnv: Record<string, string | undefined> = {}

beforeAll(() => {
  for (const key of ['BARION_API_URL', 'BARION_PAYEE_EMAIL', 'BARION_POSKEY_TEST']) {
    savedEnv[key] = process.env[key]
  }
  process.env.BARION_API_URL = 'https://api.test.barion.com'
  process.env.BARION_PAYEE_EMAIL = 'payee@example.test'
  process.env.BARION_POSKEY_TEST = DUMMY_POS_KEY
})

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('TESZT: valódi hálózati hívás nem futhat')
  })
  // A handler a gyökér-loggert használja — a naplózaj elnyomva.
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  // A riasztás-fojtás folyamat-szintű állapota nem szivároghat át tesztek között.
  resetAlertThrottle()
})

// ---------------------------------------------------------------------------
// Őszinte in-memory webhook-events tárhely
// ---------------------------------------------------------------------------

/** A Where-feltétel TÉNYLEGES kiértékelése (a handler szűrőinek részhalmaza). */
function matches(doc: WebhookEventDoc, where: Where): boolean {
  const and = (where as { and?: Where[] }).and
  if (Array.isArray(and)) {
    return and.every((entry) => matches(doc, entry))
  }
  const or = (where as { or?: Where[] }).or
  if (Array.isArray(or)) {
    return or.some((entry) => matches(doc, entry))
  }
  return Object.entries(where).every(([field, rawCondition]) => {
    const value = (doc as unknown as Record<string, unknown>)[field]
    const condition = rawCondition as Record<string, unknown>
    if ('equals' in condition) {
      return value === condition.equals
    }
    if ('in' in condition) {
      return Array.isArray(condition.in) && (condition.in as unknown[]).includes(value)
    }
    if ('less_than' in condition) {
      return typeof value === 'number' && value < (condition.less_than as number)
    }
    if ('exists' in condition) {
      const exists = value !== undefined && value !== null
      return condition.exists ? exists : !exists
    }
    throw new Error(`teszthiba: ismeretlen where-feltétel a mock-tárhelyben: ${field}`)
  })
}

interface CapturedFind {
  where?: Where
  sort?: string
  limit?: number
}

function createWebhookStore(initial: WebhookEventDoc[] = []) {
  const docs = [...initial]
  const finds: CapturedFind[] = []
  let nextId = docs.length + 1

  const store: WebhookEventStore = {
    find: async ({ where, sort, limit }) => {
      finds.push({
        ...(where ? { where } : {}),
        ...(sort ? { sort } : {}),
        ...(limit ? { limit } : {}),
      })
      let matched = docs.filter((doc) => (where ? matches(doc, where) : true))
      if (sort === 'updatedAt') {
        matched = [...matched].sort(
          (a, b) => Date.parse(a.updatedAt ?? '') - Date.parse(b.updatedAt ?? ''),
        )
      }
      if (typeof limit === 'number') {
        matched = matched.slice(0, limit)
      }
      return { docs: matched, totalDocs: matched.length }
    },
    create: async ({ data }) => {
      const doc: WebhookEventDoc = {
        id: nextId++,
        provider: data.provider as WebhookEventDoc['provider'],
        externalId: data.externalId as string,
        status: (data.status as WebhookEventDoc['status']) ?? 'received',
        attempts: (data.attempts as number) ?? 0,
        payload: data.payload,
        updatedAt: new Date().toISOString(),
      }
      docs.push(doc)
      return doc
    },
    update: async ({ id, data }) => {
      const doc = docs.find((candidate) => candidate.id === id)
      if (!doc) {
        throw new Error(`nincs ilyen rekord: ${id}`)
      }
      Object.assign(doc, data)
      // A valódi adatbázis minden íráskor frissíti — a backoff-számítás miatt
      // a mocknak is kötelező.
      doc.updatedAt = new Date().toISOString()
      return doc
    },
  }

  return { store, docs, finds }
}

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString()
}

let eventSeq = 0

function createEvent(overrides: Partial<WebhookEventDoc> = {}): WebhookEventDoc {
  eventSeq += 1
  return {
    id: eventSeq,
    provider: 'barion',
    externalId: `evt-${eventSeq}`,
    status: 'failed',
    attempts: 1,
    updatedAt: hoursAgoIso(2), // régen frissült → a backoff már letelt
    ...overrides,
  }
}

interface TaskResult {
  output: {
    scanned: number
    retried: number
    succeeded: number
    failed: number
    skipped: number
    exhausted: number
  }
}

/** A task handler futtatása (a szamlazz-tasks.test.ts runTask-mintája). */
function runHandler(store: WebhookEventStore): Promise<TaskResult> {
  const { handler } = webhookRetryTask
  if (typeof handler !== 'function') {
    throw new Error('a webhook-retry handlere nem függvény')
  }
  const req = { payload: store as unknown as Payload }
  return (handler as (args: unknown) => Promise<TaskResult>)({ req })
}

describe('webhook-retry handler — scan-szűrő (K3 szerződés)', () => {
  it('a scan kizárja a kimerült rekordokat (attempts < MAX), a legrégebbit veszi elöl, 25 az ablak', async () => {
    const { store, finds } = createWebhookStore()

    const result = await runHandler(store)

    expect(result.output.scanned).toBe(0)
    expect(finds).toHaveLength(1)
    expect(finds[0]?.where).toMatchObject({
      and: [
        { status: { in: ['received', 'failed'] } },
        {
          or: [{ attempts: { less_than: MAX_WEBHOOK_ATTEMPTS } }, { attempts: { exists: false } }],
        },
      ],
    })
    expect(finds[0]?.sort).toBe('updatedAt')
    expect(finds[0]?.limit).toBe(25)
  })
})

describe('webhook-retry handler — K3 ablak-védelem', () => {
  it('25 kimerült + 1 új failed esetén az ÚJ kerül sorra (a kimerültek nem tömítik az ablakot)', async () => {
    const exhausted = Array.from({ length: 25 }, () =>
      createEvent({ attempts: MAX_WEBHOOK_ATTEMPTS, updatedAt: hoursAgoIso(72) }),
    )
    const fresh = createEvent({ attempts: 1, updatedAt: hoursAgoIso(2) })
    const { store, docs } = createWebhookStore([...exhausted, fresh])

    const processorCalls: string[] = []
    registerWebhookProcessor('barion', async (event) => {
      processorCalls.push(event.externalId)
      return { ok: true }
    })

    const result = await runHandler(store)

    // A 25 kimerült sor NEM jutott az ablakba — a scan-szűrő kizárta őket.
    expect(result.output.scanned).toBe(1)
    expect(result.output.retried).toBe(1)
    expect(result.output.succeeded).toBe(1)
    expect(processorCalls).toEqual([fresh.externalId])
    // A kimerült rekordok érintetlenek (nem „dolgozódtak fel" és nem is lettek újrapróbálva).
    for (const doc of exhausted) {
      expect(doc.attempts).toBe(MAX_WEBHOOK_ATTEMPTS)
      expect(doc.status).toBe('failed')
    }
    expect(docs.find((doc) => doc.id === fresh.id)?.status).toBe('processed')
  })
})

describe('webhook-retry handler — retry-kimenetelek', () => {
  it('sikeres újrapróbálás → processed, attempts növekszik, lastError törlődik', async () => {
    const event = createEvent({ attempts: 2, lastError: 'korábbi hiba' })
    const { store, docs } = createWebhookStore([event])
    registerWebhookProcessor('barion', async () => ({ ok: true }))

    const result = await runHandler(store)

    expect(result.output).toMatchObject({ scanned: 1, retried: 1, succeeded: 1, failed: 0 })
    expect(docs[0]).toMatchObject({ status: 'processed', attempts: 3, lastError: null })
  })

  it('sikertelen, de ÚJRAPRÓBÁLHATO hiba → failed marad, owner-riasztás NÉLKÜL', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const event = createEvent({ attempts: 1 })
    const { store, docs } = createWebhookStore([event])
    registerWebhookProcessor('barion', async () => {
      throw new Error('átmeneti provider-hiba')
    })

    const result = await runHandler(store)

    expect(result.output).toMatchObject({ retried: 1, succeeded: 0, failed: 1, exhausted: 0 })
    expect(docs[0]).toMatchObject({
      status: 'failed',
      attempts: 2,
      lastError: 'átmeneti provider-hiba',
    })
    const logs = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(logs).not.toContain('kimerültek')
  })

  it('az UTOLSÓ kísérlet hibája → kimerülés: owner-riasztás pontosan egyszer, és többé nem kerül scanbe', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const event = createEvent({ attempts: MAX_WEBHOOK_ATTEMPTS - 1 })
    const { store } = createWebhookStore([event])
    registerWebhookProcessor('barion', async () => {
      throw new Error('véglegesen elhasal')
    })

    const first = await runHandler(store)

    expect(first.output).toMatchObject({ retried: 1, failed: 1, exhausted: 1 })
    expect(event.attempts).toBe(MAX_WEBHOOK_ATTEMPTS)
    expect(event.status).toBe('failed')
    const firstLogs = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(firstLogs).toContain('kimerültek')
    expect(firstLogs).toContain('owner')

    // A következő futásban a kimerült rekord már a scanben sincs benne (K3),
    // tehát a riasztás sem ismétlődik percenként.
    logSpy.mockClear()
    const second = await runHandler(store)
    expect(second.output).toMatchObject({ scanned: 0, retried: 0, exhausted: 0 })
    expect(logSpy.mock.calls.map((call) => String(call[0])).join('\n')).not.toContain('kimerültek')
  })

  it('a backoffon belüli esemény kimarad (skipped), a processor nem fut', async () => {
    const event = createEvent({ attempts: 2, updatedAt: new Date().toISOString() })
    const { store } = createWebhookStore([event])
    const processor = vi.fn(async () => ({ ok: true }))
    registerWebhookProcessor('barion', processor)

    const result = await runHandler(store)

    expect(result.output).toMatchObject({ scanned: 1, retried: 0, skipped: 1 })
    expect(processor).not.toHaveBeenCalled()
  })

  it('W13 — pending_repoll UTOLSÓ kísérlete → exhausted, NEM succeeded, rekord received marad; későbbi processWebhook még lefut', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const event = createEvent({
      status: 'received',
      attempts: MAX_WEBHOOK_ATTEMPTS - 1,
      result: 'pending_repoll',
    })
    const { store, docs } = createWebhookStore([event])
    registerWebhookProcessor('barion', async () => ({ webhookNonTerminal: true }))

    const first = await runHandler(store)

    expect(first.output).toMatchObject({ retried: 1, exhausted: 1, succeeded: 0, failed: 0 })
    expect(docs[0]).toMatchObject({
      status: 'received',
      result: 'pending_repoll',
      attempts: MAX_WEBHOOK_ATTEMPTS,
    })
    const firstLogs = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(firstLogs).toContain('RIASZTÁS')
    expect(firstLogs).toContain('pending_repoll')

    // A retry-scan többé nem viszi (attempts >= MAX), a riasztás nem ismétlődik.
    logSpy.mockClear()
    const second = await runHandler(store)
    expect(second.output).toMatchObject({ scanned: 0, retried: 0, exhausted: 0, succeeded: 0 })
    expect(logSpy.mock.calls.map((call) => String(call[0])).join('\n')).not.toContain('kimerültek')

    // A route-handler (processWebhook) viszont még mindig feldolgozhat egy
    // későbbi Succeeded callbacket — nem already-processed.
    const paid = await processWebhook({
      store,
      provider: 'barion',
      externalId: event.externalId,
      handler: async () => ({ status: 'paid' }),
    })
    expect(paid.kind).toBe('processed')
    expect(paid).not.toMatchObject({ kind: 'already-processed' })
    expect(docs[0]?.status).toBe('processed')
  })

  it('regisztrálatlan provider eseménye kimarad (skipped), érintetlen marad', async () => {
    const event = createEvent({ provider: 'stream' })
    const { store, docs } = createWebhookStore([event])
    registerWebhookProcessor('barion', async () => ({ ok: true }))

    const result = await runHandler(store)

    expect(result.output).toMatchObject({ scanned: 1, retried: 0, skipped: 1 })
    expect(docs[0]?.status).toBe('failed')
  })
})

describe('webhook-retry handler — K8 per-esemény hibaizoláció', () => {
  it('egy mérgezett rekord (státuszgépen kívüli throw) nem állítja le a batch-et — a mögötte álló esemény feldolgozódik, a mérgezett pedig kimerülésig backoffol', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    // A mérgezett a RÉGEBBI updatedAt-tel az ablak ELEJÉN áll — pont az az
    // eset, ami korábban minden futást ugyanott ölt meg, és a mögötte álló
    // érvényes fizetéseket véglegesen kiéheztette.
    const poisoned = createEvent({ attempts: MAX_WEBHOOK_ATTEMPTS - 1, updatedAt: hoursAgoIso(72) })
    const healthy = createEvent({ attempts: 1, updatedAt: hoursAgoIso(2) })
    const { store, docs } = createWebhookStore([poisoned, healthy])
    registerWebhookProcessor('barion', async () => ({ ok: true }))

    // A processWebhook a mérgezett externalId-jére már a findByKey-nél dob
    // (pl. sérült azonosító, amin a paraméterezett lekérdezés hibázik) — ez a
    // státuszgép TRY-CATCH-én KÍVÜLI út.
    const baseFind = store.find
    store.find = async (args) => {
      if (JSON.stringify(args.where ?? {}).includes(poisoned.externalId)) {
        throw new Error('szimulált DB-hiba a mérgezett azonosító lekérdezésén')
      }
      return baseFind(args)
    }

    const first = await runHandler(store)

    // A batch NEM állt meg: a mérgezett failed-del könyvelt, az egészséges lefutott.
    expect(first.output).toMatchObject({
      scanned: 2,
      retried: 2,
      succeeded: 1,
      failed: 1,
      exhausted: 1,
    })
    expect(docs.find((doc) => doc.id === healthy.id)?.status).toBe('processed')
    // Best-effort attempts-bump: a mérgezett kimerült, és kikerül a scanből.
    expect(docs.find((doc) => doc.id === poisoned.id)).toMatchObject({
      status: 'failed',
      attempts: MAX_WEBHOOK_ATTEMPTS,
    })
    expect(String(docs.find((doc) => doc.id === poisoned.id)?.lastError)).toContain('szimulált')
    const firstLogs = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(firstLogs).toContain('owner beavatkozás szükséges')

    // A következő futás: a mérgezett már a scanben sincs (K3) — nincs újabb
    // percenkénti riasztás, és semmi nem éhezik mögötte.
    logSpy.mockClear()
    const second = await runHandler(store)
    expect(second.output).toMatchObject({ scanned: 0, retried: 0, failed: 0 })
    expect(logSpy.mock.calls.map((call) => String(call[0])).join('\n')).not.toContain(
      'owner beavatkozás szükséges',
    )
  })

  it('a mérgezett rekord kimerülés ELŐTT: warn + backoff, a batch többi tagja fut, a task nem dob', async () => {
    const poisoned = createEvent({ attempts: 1, updatedAt: hoursAgoIso(72) })
    const healthy = createEvent({ attempts: 1, updatedAt: hoursAgoIso(2) })
    const { store, docs } = createWebhookStore([poisoned, healthy])
    registerWebhookProcessor('barion', async () => ({ ok: true }))
    const baseFind = store.find
    store.find = async (args) => {
      if (JSON.stringify(args.where ?? {}).includes(poisoned.externalId)) {
        throw new Error('szimulált DB-hiba a mérgezett azonosító lekérdezésén')
      }
      return baseFind(args)
    }

    const result = await runHandler(store)

    expect(result.output).toMatchObject({ retried: 2, succeeded: 1, failed: 1, exhausted: 0 })
    // attempts-bump → a sor updatedAt-je mozdul, backoffal hátrébb sorolódik.
    expect(docs.find((doc) => doc.id === poisoned.id)).toMatchObject({
      status: 'failed',
      attempts: 2,
    })
    expect(docs.find((doc) => doc.id === healthy.id)?.status).toBe('processed')
  })
})

describe('webhook-retry handler — M6 terminális rejected ág (valódi Barion-processzor)', () => {
  it('404 + PaymentNotFound az újrapróbáláson → rejected VÉGLEGES lezárás, 0 további újrapróba és Barion-hívás', async () => {
    const event = createEvent({ externalId: PAYMENT_ID, attempts: 1 })
    const { store, docs } = createWebhookStore([event])
    // A VALÓDI Barion callback-processzor fut — a fetch egy előkészített, kifejezett
    // not-found válasz. A puszta 404 (Errors tömb nélkül) már NEM terminális
    // (process-callback.ts isPaymentDefinitelyNotFound, a-callback-5).
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            Errors: [{ ErrorCode: 'PaymentNotFound', Title: 'DUMMY', Description: 'DUMMY' }],
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    registerWebhookProcessor(
      'barion',
      createBarionCallbackProcessor({ payload: {} as unknown as Payload, store }),
    )

    const first = await runHandler(store)

    // A terminális ág NEM dob: a processWebhook processed-re zárja, result rejected.
    expect(first.output).toMatchObject({ retried: 1, succeeded: 1, failed: 0, exhausted: 0 })
    expect(docs[0]).toMatchObject({ status: 'processed', result: 'rejected', attempts: 2 })
    expect(typeof docs[0]?.processedAt).toBe('string')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // A következő scan már nem látja (processed) — újabb Barion-hívás NEM indul.
    const second = await runHandler(store)
    expect(second.output.scanned).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
