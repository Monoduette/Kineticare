import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetAlertThrottle, shouldEmitThrottledAlert } from '../../lib/alert-throttle'
import {
  assemblyRetryDelayMs,
  budapestHour,
  createDigestState,
  isDigestDue,
  MAX_DIGEST_ATTEMPTS_PER_DAY,
  runDailyDigestIfDue,
  type DigestDeps,
  type DigestState,
} from '../../lib/alerts/digest'
import {
  HEARTBEAT_TIMEOUT_MS,
  pingHeartbeat,
  resetHeartbeatWarnings,
} from '../../lib/alerts/heartbeat'
import { afterOrderPoll, alertStuckPendingPayments } from '../../lib/alerts/poll-watch'
import type { SendMailInput } from '../../lib/email'
import type { SendResult } from '../../lib/email/types'
import type { LogContext, Logger } from '../../lib/logger'
import { createMemoryPayload, orderIdsOpenedByHref } from './where-eval'

/**
 * Napi összesítő (07:00 Budapest, `digest-ÉÉÉÉ-HH-NN` idempotenciakulcs, csak
 * ha van teendő), életjel (5 mp-es ping, hiba csak warn) és a poll utáni
 * 24 órás függő-fizetés riasztás. Minden hálózati hívó injektált; a globális
 * `fetch` hangosan dob, hogy véletlen valódi hívás ne mehessen ki.
 */

interface Recorded {
  level: string
  msg: string
  context?: LogContext
  bindings: LogContext
}

function recordingLogger(entries: Recorded[], bindings: LogContext = {}): Logger {
  return {
    debug: (msg, context) => entries.push({ level: 'debug', msg, context, bindings }),
    info: (msg, context) => entries.push({ level: 'info', msg, context, bindings }),
    warn: (msg, context) => entries.push({ level: 'warn', msg, context, bindings }),
    error: (msg, context) => entries.push({ level: 'error', msg, context, bindings }),
    child: (extra) => recordingLogger(entries, { ...bindings, ...extra }),
  }
}

// 2026-09-24 nyári idő (UTC+2): 05:10 UTC = 07:10 Budapest.
const MORNING = Date.parse('2026-09-24T05:10:00Z')
const minutesBefore = (base: number, minutes: number) =>
  new Date(base - minutes * 60_000).toISOString()

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('valódi hálózati hívás tesztből tilos')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetAlertThrottle()
  resetHeartbeatWarnings()
})

function openOrders(now: number) {
  return [
    {
      id: 1,
      orderNumber: 'KH-2026-000001',
      status: 'paid',
      invoiceStatus: 'none',
      createdAt: minutesBefore(now, 300),
      updatedAt: minutesBefore(now, 300),
    },
    {
      id: 2,
      orderNumber: 'KH-2026-000002',
      status: 'payment_pending',
      createdAt: minutesBefore(now, 26 * 60),
      updatedAt: minutesBefore(now, 5),
    },
  ]
}

function digestHarness(options: {
  orders?: ReadonlyArray<Record<string, unknown>>
  send?: (input: SendMailInput) => Promise<SendResult>
  recipients?: readonly string[]
  vatMode?: string
  /** A Payload `db`-je (a zár `pg` poolja); nélküle a zár teszt/mock módban kimarad. */
  db?: unknown
}) {
  const mails: SendMailInput[] = []
  const entries: Recorded[] = []
  const memory = createMemoryPayload({
    orders: options.orders ?? [],
    'refund-intents': [],
    'webhook-events': [],
    'audit-logs': [],
  })
  const sendMail = vi.fn(
    options.send ??
      (async (input: SendMailInput): Promise<SendResult> => {
        mails.push(input)
        return { ok: true, provider: 'resend', id: 'd1' }
      }),
  )
  const state = createDigestState()
  // Az OWNER_ALERT_EMAILS a futások között változhat (napközbeni beállítás).
  const settings = { recipients: options.recipients ?? ['tulajdonos@example.com'] }
  const payload = options.db === undefined ? memory.payload : { ...memory.payload, db: options.db }
  const deps = (nowMs: number, processState: DigestState = state): DigestDeps => ({
    payload: payload as never,
    sendMail,
    recipients: () => settings.recipients,
    logger: recordingLogger(entries),
    nowMs,
    serverUrl: 'https://kineticare.hu',
    ...(options.vatMode !== undefined ? { vatMode: options.vatMode } : {}),
    state: processState,
  })
  return { mails, entries, sendMail, state, deps, memory, settings }
}

/**
 * A `pg` pool határa a napi zárhoz: kivett kliens (valódi EventEmitter), a
 * zár- és feloldó-lekérdezés kötött válasza, és a `release` hívásainak
 * rögzítése (hibával hívva a pool eldobja a kapcsolatot).
 */
function fakeLockPool(options: {
  tryLock?: () => Promise<unknown>
  unlock?: () => Promise<unknown>
  release?: (error?: Error) => void
}) {
  const released: Array<Error | undefined> = []
  const client = Object.assign(new EventEmitter(), {
    query: async (text: string): Promise<unknown> => {
      if (text.includes('pg_try_advisory_lock(')) {
        return options.tryLock ? options.tryLock() : { rows: [{ locked: true }] }
      }
      if (text.includes('pg_advisory_unlock(')) {
        return options.unlock ? options.unlock() : { rows: [{ unlocked: true }] }
      }
      throw new Error(`váratlan lekérdezés a zár kapcsolatán: ${text}`)
    },
    release: (error?: Error): void => {
      released.push(error)
      options.release?.(error)
    },
  })
  const connect = vi.fn(async () => client)
  return { pool: { connect }, released, connect }
}

describe('napi összesítő — időzítés', () => {
  it('Budapest szerint 07:00 előtt nem esedékes, utána igen (nyári és téli időben is)', () => {
    const state = createDigestState()
    expect(budapestHour(Date.parse('2026-09-24T04:59:00Z'))).toBe(6)
    expect(isDigestDue(Date.parse('2026-09-24T04:59:00Z'), state)).toBe(false)
    expect(isDigestDue(Date.parse('2026-09-24T05:00:00Z'), state)).toBe(true)
    // Télen UTC+1: 06:00 UTC = 07:00 Budapest.
    expect(isDigestDue(Date.parse('2026-12-10T05:59:00Z'), state)).toBe(false)
    expect(isDigestDue(Date.parse('2026-12-10T06:00:00Z'), state)).toBe(true)
  })
})

describe('napi összesítő — küldés', () => {
  it('ha minden nulla, nem megy levél, és aznap többet nem próbálkozik', async () => {
    const h = digestHarness({})
    expect(await runDailyDigestIfDue(h.deps(MORNING))).toBe('nincs-teendo')
    expect(await runDailyDigestIfDue(h.deps(MORNING + 5 * 60_000))).toBe('nem-esedekes')
    expect(h.sendMail).not.toHaveBeenCalled()
  })

  it('van teendő → egy levél digest-ÉÉÉÉ-HH-NN kulccsal, szűrt admin-linkekkel, naponta egyszer', async () => {
    const h = digestHarness({ orders: openOrders(MORNING) })
    expect(await runDailyDigestIfDue(h.deps(MORNING))).toBe('elkuldve')
    expect(await runDailyDigestIfDue(h.deps(MORNING + 5 * 60_000))).toBe('nem-esedekes')

    expect(h.mails).toHaveLength(1)
    const mail = h.mails[0]
    expect(mail?.idempotencyKey).toBe('digest-2026-09-24')
    expect(mail?.to).toEqual(['tulajdonos@example.com'])
    expect(mail?.subject).toBe('Kineticare napi összesítő, 2026-09-24: 2 teendő')
    expect(mail?.text).toContain('1 fizetett rendelés számla nélkül')
    expect(mail?.text).toContain('1 függő fizetés egy óránál régebben (ebből 1 egy napnál régebbi)')
    expect(mail?.text).toContain('https://kineticare.hu/admin/collections/orders?where')
    expect(mail?.html).toContain('<a href="https://kineticare.hu/admin/collections/orders?where')
    // Személyes adat (vevő e-mail) nincs benne; rendelésszám sem kell a számokhoz.
    expect(mail?.text).not.toContain('@example.com')
  })

  it('a csak hiányzó helyesbítő miatt számolt rendelést a levél listalinkje meg is nyitja', async () => {
    // Az 1. részrefund helyesbítőjének nincs bizonyítéka, a pár a 2.-at igazolja.
    const order = {
      id: 21,
      orderNumber: 'KH-2026-000021',
      status: 'paid',
      invoiceStatus: 'issued',
      correctiveInvoiceStatus: 'issued',
      correctiveInvoiceSeq: 2,
      correctiveInvoiceNumber: 'E-KIN-2026-52',
      refunds: [
        { type: 'partial', amountHuf: 10_000, refundedAt: minutesBefore(MORNING, 2 * 24 * 60) },
        { type: 'partial', amountHuf: 5_000, refundedAt: minutesBefore(MORNING, 24 * 60) },
      ],
      createdAt: minutesBefore(MORNING, 5 * 24 * 60),
      updatedAt: minutesBefore(MORNING, 24 * 60),
    }
    const h = digestHarness({ orders: [order], vatMode: '27' })
    expect(await runDailyDigestIfDue(h.deps(MORNING))).toBe('elkuldve')
    const text = h.mails[0]?.text ?? ''
    expect(text).toContain('- 1 sikertelen számla, stornó vagy helyesbítő')
    // Devin (PR #305): a 14 napos ablakot a levél kimondja, és a teljes listára
    // (havi egyeztetés, runbook 08) mutat, a szöveges és a HTML-részben is.
    const ablak =
      'A 14 napnál régebbi hibák itt nem jelennek meg, ezeket a havi egyeztetés sorolja fel (tulajdonosi kézikönyv, 08. fejezet).'
    expect(text).toContain(ablak)
    expect(h.mails[0]?.html).toContain(ablak)
    const hrefs = [...text.matchAll(/Lista: (\S+)/g)].map((match) => match[1] ?? '')
    expect(hrefs.flatMap((href) => orderIdsOpenedByHref(href, [order]))).toEqual([21])
  })

  it('új nap → új összesítő', async () => {
    const h = digestHarness({ orders: openOrders(MORNING) })
    await runDailyDigestIfDue(h.deps(MORNING))
    const nextMorning = MORNING + 24 * 60 * 60_000
    expect(await runDailyDigestIfDue(h.deps(nextMorning))).toBe('elkuldve')
    expect(h.mails.map((mail) => mail.idempotencyKey)).toEqual([
      'digest-2026-09-24',
      'digest-2026-09-25',
    ])
  })

  it('újrapróbálható hibánál a következő futás újra küld, de naponta legfeljebb háromszor', async () => {
    const send = vi.fn(async (): Promise<SendResult> => ({
      ok: false,
      provider: 'resend',
      retryable: true,
      error: 'HTTP 503',
    }))
    const h = digestHarness({ orders: openOrders(MORNING), send })
    const outcomes: string[] = []
    for (let run = 0; run < MAX_DIGEST_ATTEMPTS_PER_DAY + 2; run += 1) {
      outcomes.push(await runDailyDigestIfDue(h.deps(MORNING + run * 5 * 60_000)))
    }
    expect(send).toHaveBeenCalledTimes(MAX_DIGEST_ATTEMPTS_PER_DAY)
    expect(outcomes).toEqual(['hiba', 'hiba', 'hiba', 'nem-esedekes', 'nem-esedekes'])
    // Sikertelen küldés után nincs napi nyom: egy újraindult folyamat még próbálhat.
    expect(h.memory.createCalls).toHaveLength(0)
  })

  it('nem újrapróbálható hibánál (pl. Resend 409: ma már ment) aznapra feladja', async () => {
    const send = vi.fn(async (): Promise<SendResult> => ({
      ok: false,
      provider: 'resend',
      retryable: false,
      error: 'HTTP 409',
    }))
    const h = digestHarness({ orders: openOrders(MORNING), send })
    expect(await runDailyDigestIfDue(h.deps(MORNING))).toBe('feladva')
    expect(await runDailyDigestIfDue(h.deps(MORNING + 5 * 60_000))).toBe('nem-esedekes')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('Devin (PR #305): címzett nélkül a nap nem zárul le, és a később beállított címzett még aznap megkapja a levelet', async () => {
    // 07:00 Budapest (05:00 UTC), nyitott teendőkkel, üres OWNER_ALERT_EMAILS.
    const seven = Date.parse('2026-09-24T05:00:00Z')
    const h = digestHarness({ orders: openOrders(seven), recipients: [] })
    const outcomes: string[] = []
    for (let minute = 0; minute <= 60; minute += 5) {
      outcomes.push(await runDailyDigestIfDue(h.deps(seven + minute * 60_000)))
    }
    expect(new Set(outcomes)).toEqual(new Set(['nincs-cimzett']))
    // Címzett nélkül nincs lekérdezés, és a hiányról naponta egy warn szól.
    expect(h.memory.countCalls).toHaveLength(0)
    expect(h.memory.findCalls).toHaveLength(0)
    const warns = h.entries.filter(
      (entry) => entry.level === 'warn' && entry.msg.includes('OWNER_ALERT_EMAILS'),
    )
    expect(warns).toHaveLength(1)

    // 08:05: a tulajdonos beállította a címzettet.
    h.settings.recipients = ['tulajdonos@example.com']
    expect(await runDailyDigestIfDue(h.deps(seven + 65 * 60_000))).toBe('elkuldve')
    expect(h.mails).toHaveLength(1)
    expect(h.mails[0]?.idempotencyKey).toBe('digest-2026-09-24')
  })

  it('a hiányzó címzettről másnap újra szól', async () => {
    const h = digestHarness({ recipients: [] })
    await runDailyDigestIfDue(h.deps(MORNING))
    await runDailyDigestIfDue(h.deps(MORNING + 5 * 60_000))
    await runDailyDigestIfDue(h.deps(MORNING + 24 * 60 * 60_000))
    const warns = h.entries.filter(
      (entry) => entry.level === 'warn' && entry.msg.includes('OWNER_ALERT_EMAILS'),
    )
    expect(warns).toHaveLength(2)
  })

  it('Codex P2 (PR #305): három lekérdezési hiba nem fogyasztja el a küldési keretet; a helyreállás után aznap kimegy a levél', async () => {
    const h = digestHarness({ orders: openOrders(MORNING) })
    const count = h.memory.payload.count
    const database = { down: true }
    h.memory.payload.count = async (args) => {
      if (database.down) {
        throw new Error('adatbázis nem érhető el')
      }
      return count(args)
    }

    const throwsAt: number[] = []
    const sentAt: number[] = []
    for (let minute = 0; minute <= 120; minute += 5) {
      // Az adatbázis a harmadik hiba után, 07:45-kor áll helyre.
      database.down = minute < 35
      try {
        if ((await runDailyDigestIfDue(h.deps(MORNING + minute * 60_000))) === 'elkuldve') {
          sentAt.push(minute)
        }
      } catch {
        throwsAt.push(minute)
      }
    }

    // A hibák között növekvő várakozás (10, 20, majd 40 perc), nem 5 percenkénti
    // lekérdezés és riasztás; a keret a valódi küldésé marad.
    expect(throwsAt).toEqual([0, 10, 30])
    expect(sentAt).toEqual([70])
    expect(h.sendMail).toHaveBeenCalledTimes(1)
  })

  it('Codex P2 (PR #305): újraindulás után a friss folyamat a napi nyom miatt nem küld még egy összesítőt', async () => {
    const h = digestHarness({ orders: openOrders(MORNING) })
    expect(await runDailyDigestIfDue(h.deps(MORNING))).toBe('elkuldve')
    const countsBeforeRestart = h.memory.countCalls.length

    // Deploy 07:40-kor: új folyamat, üres folyamaton belüli állapottal.
    expect(await runDailyDigestIfDue(h.deps(MORNING + 30 * 60_000, createDigestState()))).toBe(
      'mar-elkuldve',
    )
    expect(h.sendMail).toHaveBeenCalledTimes(1)
    // A nyom miatt a friss folyamat újra sem számol.
    expect(h.memory.countCalls).toHaveLength(countsBeforeRestart)
    expect(h.memory.createCalls).toEqual([
      expect.objectContaining({
        collection: 'audit-logs',
        overrideAccess: true,
        data: expect.objectContaining({
          action: 'daily-digest-sent',
          entityType: 'daily-digest',
          entityId: '2026-09-24',
        }),
      }),
    ])
    // A nyomba címzett (személyes adat) nem kerül.
    expect(JSON.stringify(h.memory.createCalls)).not.toContain('@')

    // Másnap a nyom nem gátol.
    const nextMorning = MORNING + 24 * 60 * 60_000
    expect(await runDailyDigestIfDue(h.deps(nextMorning, createDigestState()))).toBe('elkuldve')
  })

  it('breaker (PR #305): a noop-szolgáltató „küldése” nem ír napi nyomot, így a szolgáltató aznapi beállítása és a deploy után kimegy a levél', async () => {
    // 07:10: se RESEND_API_KEY, se SMTP_HOST; a sendMail noop-sikert ad.
    const provider = { name: 'noop' as 'noop' | 'smtp' }
    const h = digestHarness({
      orders: openOrders(MORNING),
      send: async () => ({ ok: true, provider: provider.name }),
    })
    expect(await runDailyDigestIfDue(h.deps(MORNING))).toBe('elkuldve')
    expect(h.memory.createCalls).toHaveLength(0)
    expect(h.entries.some((entry) => entry.level === 'warn' && entry.msg.includes('noop'))).toBe(
      true,
    )
    // A napló ne mondja, hogy kiment a levél, ha semmi nem ment ki.
    expect(h.entries.some((entry) => entry.msg.includes('levél elküldve'))).toBe(false)

    // 08:00: az üzemeltető beállítja az SMTP-t, a deploy új folyamatot indít.
    provider.name = 'smtp'
    expect(await runDailyDigestIfDue(h.deps(MORNING + 50 * 60_000, createDigestState()))).toBe(
      'elkuldve',
    )
    expect(h.sendMail).toHaveBeenCalledTimes(2)
    expect(h.memory.createCalls).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ action: 'daily-digest-sent', entityId: '2026-09-24' }),
      }),
    ])
  })

  it('ha a zár a küldés előtt hibázik, nincs küldés, a hiba a hívóé, és a következő próba a lekérdezési hiba várakozása után jön', async () => {
    const connect = vi.fn(async (): Promise<never> => {
      throw new Error('a zár kapcsolata nem jött létre')
    })
    const h = digestHarness({ orders: openOrders(MORNING), db: { pool: { connect } } })

    await expect(runDailyDigestIfDue(h.deps(MORNING))).rejects.toThrow('a zár kapcsolata')
    expect(h.sendMail).not.toHaveBeenCalled()

    // A várakozás alatt nincs újabb lekérdezés és zár-próba (se riasztás).
    const waitMs = assemblyRetryDelayMs(1)
    expect(await runDailyDigestIfDue(h.deps(MORNING + waitMs - 60_000))).toBe('nem-esedekes')
    expect(connect).toHaveBeenCalledTimes(1)
    await expect(runDailyDigestIfDue(h.deps(MORNING + waitMs))).rejects.toThrow()
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('breaker (PR #305): értelmezhetetlen zár-válasznál (pl. sorok tömbje a {rows} helyett) nem küld, dob, a kapcsolatot eldobja, és a lekérdezési hiba várakozása jön', async () => {
    // Ha ezt „foglalt”-nak vennénk, minden futás csendben `folyamatban` lenne:
    // aznap nem menne levél, és riasztás sem.
    const lock = fakeLockPool({ tryLock: async () => [{ locked: true }] })
    const h = digestHarness({ orders: openOrders(MORNING), db: { pool: lock.pool } })

    await expect(runDailyDigestIfDue(h.deps(MORNING))).rejects.toThrow('nem értelmezhető')
    expect(h.sendMail).not.toHaveBeenCalled()
    // Lehet, hogy a zárat mégis megkapta: a session nem mehet vissza a poolba.
    expect(lock.released).toEqual([expect.any(Error)])
    expect(await runDailyDigestIfDue(h.deps(MORNING + 5 * 60_000))).toBe('nem-esedekes')
    expect(lock.connect).toHaveBeenCalledTimes(1)
  })

  it('productionben pool nélkül a zár nem hagyható ki: nincs küldés, a hiba a hívóé', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const h = digestHarness({ orders: openOrders(MORNING), db: {} })
      await expect(runDailyDigestIfDue(h.deps(MORNING))).rejects.toThrow('Az adatbázis-zár')
      expect(h.sendMail).not.toHaveBeenCalled()
      expect(h.memory.createCalls).toHaveLength(0)
      expect(
        h.entries.some((entry) => entry.level === 'error' && entry.msg.startsWith('RIASZTÁS')),
      ).toBe(true)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('ha a zár elengedése a küldés után nem sikerül, a levél eredménye marad, és a zárat tartó kapcsolat nem kerül vissza a poolba', async () => {
    const lock = fakeLockPool({
      unlock: async () => {
        throw new Error('a kapcsolat megszakadt')
      },
    })
    const h = digestHarness({ orders: openOrders(MORNING), db: { pool: lock.pool } })

    expect(await runDailyDigestIfDue(h.deps(MORNING))).toBe('elkuldve')
    expect(h.sendMail).toHaveBeenCalledTimes(1)
    // Hibával elengedve a pool bontja a sessiont, és vele a Postgres a zárat.
    expect(lock.released).toEqual([expect.any(Error)])
    expect(await runDailyDigestIfDue(h.deps(MORNING + 5 * 60_000))).toBe('nem-esedekes')
    expect(h.sendMail).toHaveBeenCalledTimes(1)
  })

  it('ha a zár lezárása a küldés UTÁN dob, a kiment levél eredménye marad: nincs hamis riasztás és második levél', async () => {
    const lock = fakeLockPool({
      release: () => {
        throw new Error('Release called on client which has already been released to the pool.')
      },
    })
    const h = digestHarness({ orders: openOrders(MORNING), db: { pool: lock.pool } })

    expect(await runDailyDigestIfDue(h.deps(MORNING))).toBe('elkuldve')
    expect(h.sendMail).toHaveBeenCalledTimes(1)
    expect(
      h.entries.some(
        (entry) =>
          entry.level === 'warn' && entry.msg.includes('a zár a küldés után hibával zárult'),
      ),
    ).toBe(true)
    expect(await runDailyDigestIfDue(h.deps(MORNING + 5 * 60_000))).toBe('nem-esedekes')
    expect(h.sendMail).toHaveBeenCalledTimes(1)
  })

  it('a 70%-os AAM-keret AAM áfakulcsnál önmagában is levelet küld; hiányzó vagy 27%-os kulcsnál az AAM-sor kimarad', async () => {
    const invoiced = [
      {
        id: 10,
        status: 'paid',
        invoiceStatus: 'issued',
        invoiceCompletionDate: '2026-04-01',
        totalHufSnapshot: 14_500_000,
        createdAt: '2026-04-01T10:00:00.000Z',
        updatedAt: '2026-04-01T10:00:00.000Z',
      },
    ]
    const aam = digestHarness({ orders: invoiced, vatMode: 'AAM' })
    expect(await runDailyDigestIfDue(aam.deps(MORNING))).toBe('elkuldve')
    expect(aam.mails[0]?.text).toContain('Alanyi adómentes keret, 2026:')
    expect(aam.mails[0]?.text).toContain('A keret 70%-a elfogyott.')

    // Codex P2 (PR #305): a hiányzó kulcs (kikapcsolt számlázás) nem AAM.
    for (const vatMode of [undefined, '27']) {
      const nemAam = digestHarness({ orders: invoiced, vatMode })
      expect(await runDailyDigestIfDue(nemAam.deps(MORNING))).toBe('nincs-teendo')
      expect(nemAam.sendMail).not.toHaveBeenCalled()
      const szamok = nemAam.entries.find((entry) => entry.msg === 'napi összesítő: számok')
      expect(szamok?.context).toBeDefined()
      expect(szamok?.context).not.toHaveProperty('aamNetHuf')
    }
  })
})

describe('életjel', () => {
  it('beállított címre GET megy 5 mp-es időkorláttal', async () => {
    const fetchFn = vi.fn(async (): Promise<Response> => new Response('OK', { status: 200 }))
    const entries: Recorded[] = []
    const result = await pingHeartbeat({
      url: 'https://hc-ping.example/abc',
      logger: recordingLogger(entries),
      fetchFn,
    })
    expect(result).toBe('elkuldve')
    expect(fetchFn).toHaveBeenCalledWith(
      'https://hc-ping.example/abc',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
    )
    expect(HEARTBEAT_TIMEOUT_MS).toBe(5_000)
    expect(entries).toHaveLength(0)
  })

  it('hiányzó cím: nincs hívás, egyszer figyelmeztet', async () => {
    const entries: Recorded[] = []
    const fetchFn = vi.fn()
    await pingHeartbeat({ url: undefined, logger: recordingLogger(entries), fetchFn })
    await pingHeartbeat({ url: '  ', logger: recordingLogger(entries), fetchFn })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(entries.filter((entry) => entry.level === 'warn')).toHaveLength(1)
  })

  it('a ping hibája csak warn, a cím (titok) nem kerül a naplóba', async () => {
    const entries: Recorded[] = []
    const url = 'https://hc-ping.example/titkos-uuid'
    expect(
      await pingHeartbeat({
        url,
        logger: recordingLogger(entries),
        fetchFn: async () => {
          throw new Error(`connect ECONNREFUSED ${url}`)
        },
      }),
    ).toBe('hiba')
    expect(
      await pingHeartbeat({
        url,
        logger: recordingLogger(entries),
        fetchFn: async () => new Response('nope', { status: 404 }),
      }),
    ).toBe('hiba')
    expect(entries.map((entry) => entry.level)).toEqual(['warn', 'warn'])
    expect(JSON.stringify(entries)).not.toContain('titkos-uuid')
    expect(entries[1]?.context).toMatchObject({ httpStatus: 404 })
  })
})

describe('order-poll utáni őrfeladatok', () => {
  it('a 24 óránál régebbi függő rendelésről kóddal riaszt, rendelésszámmal, fojtva', async () => {
    const now = MORNING
    const { payload } = createMemoryPayload({ orders: openOrders(now) })
    const entries: Recorded[] = []
    const deps = { payload: payload as never, logger: recordingLogger(entries), nowMs: now }

    expect(await alertStuckPendingPayments(deps)).toBe(1)
    expect(await alertStuckPendingPayments({ ...deps, nowMs: now + 5 * 60_000 })).toBe(0)

    const alerts = entries.filter((entry) => entry.level === 'error')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.msg.startsWith('RIASZTÁS:')).toBe(true)
    expect(alerts[0]?.context).toMatchObject({
      alert: true,
      alertCode: 'fuggo-fizetes-24-ora',
      ageHours: 26,
    })
    expect(alerts[0]?.bindings).toMatchObject({ orderId: 2, orderNumber: 'KH-2026-000002' })
  })

  it('ha a poll-szolgáltatás már riasztott ugyanarra a rendelésre, nem riaszt még egyszer', async () => {
    const now = MORNING
    const { payload } = createMemoryPayload({ orders: openOrders(now) })
    // A szolgáltatás (src/lib/order-poll/service.ts) ugyanezzel a kulccsal fojt.
    expect(shouldEmitThrottledAlert('stuck-order:2', undefined, now)).toBe(true)
    const entries: Recorded[] = []
    expect(
      await alertStuckPendingPayments({
        payload: payload as never,
        logger: recordingLogger(entries),
        nowMs: now,
      }),
    ).toBe(0)
    expect(entries).toHaveLength(0)
  })

  it('az összesítő hibája riaszt, de az életjel a futás végén akkor is kimegy', async () => {
    const entries: Recorded[] = []
    const fetchFn = vi.fn(async (): Promise<Response> => new Response('OK', { status: 200 }))
    const payload = {
      find: async () => ({ docs: [], hasNextPage: false, totalDocs: 0 }),
      create: vi.fn(),
      count: async () => {
        throw new Error('adatbázis nem érhető el')
      },
    }
    const result = await afterOrderPoll({
      payload: payload as never,
      logger: recordingLogger(entries),
      nowMs: MORNING,
      sendMail: vi.fn(),
      recipients: () => ['tulajdonos@example.com'],
      serverUrl: 'https://kineticare.hu',
      heartbeatUrl: 'https://hc-ping.example/abc',
      fetchFn,
      digestState: createDigestState(),
    })
    expect(result.heartbeat).toBe('elkuldve')
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const alert = entries.find((entry) => entry.level === 'error')
    expect(alert?.context).toMatchObject({ alert: true, alertCode: 'napi-osszesito-hiba' })
  })

  it('a poll az áfakulcsot továbbadja az összesítőnek: AAM mellett az AAM-sor a levélben van, nélküle nincs', async () => {
    // Éles út: order-poll → afterOrderPoll → runDailyDigestIfDue. Ha a vatMode
    // útközben elveszne, a 70%-os keret-figyelmeztetés némán kimaradna.
    const invoiced = [
      {
        id: 10,
        status: 'paid',
        invoiceStatus: 'issued',
        invoiceCompletionDate: '2026-04-01',
        totalHufSnapshot: 14_500_000,
        createdAt: '2026-04-01T10:00:00.000Z',
        updatedAt: '2026-04-01T10:00:00.000Z',
      },
    ]
    const futtat = async (vatMode: string | undefined) => {
      const { payload } = createMemoryPayload({
        orders: invoiced,
        'refund-intents': [],
        'webhook-events': [],
      })
      const mails: SendMailInput[] = []
      await afterOrderPoll({
        payload: payload as never,
        logger: recordingLogger([]),
        nowMs: MORNING,
        sendMail: async (input: SendMailInput): Promise<SendResult> => {
          mails.push(input)
          return { ok: true, provider: 'resend', id: 'd1' }
        },
        recipients: () => ['tulajdonos@example.com'],
        serverUrl: 'https://kineticare.hu',
        heartbeatUrl: undefined,
        digestState: createDigestState(),
        ...(vatMode !== undefined ? { vatMode } : {}),
      })
      return mails
    }

    const aam = await futtat('AAM')
    expect(aam).toHaveLength(1)
    expect(aam[0]?.text).toContain('Alanyi adómentes keret, 2026:')
    expect(await futtat(undefined)).toHaveLength(0)
  })
})
