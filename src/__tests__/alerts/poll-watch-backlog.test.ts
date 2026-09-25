import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LogContext, Logger } from '../../lib/logger'
import { createMemoryPayload } from './where-eval'

/**
 * PR #305 (Codex P2): a 24 óránál régebbi függő rendelések riasztása nagy
 * háttérlista mellett. A rögzített „legrégebbi 25” lekérdezés minden futásban
 * ugyanazt a 25 sort olvasta; azok fojtva kimaradtak, a 26.-tól kezdve pedig
 * egyik rendelés sem kapott riasztást. Itt a futásonkénti keret (25 riasztás,
 * korlátos lapszám) mellett az egész listának sorra kell kerülnie.
 *
 * A lapozás kurzora és a fojtás folyamaton belüli állapot, ezért minden teszt
 * friss modulpéldánnyal indul (vi.resetModules), ahogy egy újraindult folyamat.
 */

interface Recorded {
  level: string
  bindings: LogContext
}

function recordingLogger(entries: Recorded[], bindings: LogContext = {}): Logger {
  const push = (level: string) => () => entries.push({ level, bindings })
  return {
    debug: push('debug'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
    child: (extra) => recordingLogger(entries, { ...bindings, ...extra }),
  }
}

const NOW = Date.parse('2026-09-24T05:10:00Z')
const RUN_INTERVAL_MS = 5 * 60_000

/** `count` darab, 26–30 órája függő rendelés, a legrégebbivel kezdve. */
function stuckOrders(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    orderNumber: `KH-2026-${String(index + 1).padStart(6, '0')}`,
    status: 'payment_pending',
    createdAt: new Date(NOW - 30 * 60 * 60_000 + index * 1_000).toISOString(),
  }))
}

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('fetch', () => {
    throw new Error('valódi hálózati hívás tesztből tilos')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

type Throttle = typeof import('../../lib/alert-throttle')

async function runs(
  orderCount: number,
  runCount: number,
  options: {
    /** A futás ideje (alapból 5 percenként, NOW-tól). */
    runAt?: (run: number) => number
    /** Az első futás előtt, ugyanazzal a fojtás-példánnyal, amit a futások látnak. */
    beforeFirstRun?: (throttle: Throttle) => void
  } = {},
) {
  const { runAt = (run: number) => NOW + run * RUN_INTERVAL_MS, beforeFirstRun } = options
  const watch = await import('../../lib/alerts/poll-watch')
  beforeFirstRun?.(await import('../../lib/alert-throttle'))
  const { payload, findCalls } = createMemoryPayload({ orders: stuckOrders(orderCount) })
  const perRun: Array<{ alerted: number; orderIds: unknown[]; finds: number }> = []
  for (let run = 0; run < runCount; run += 1) {
    const entries: Recorded[] = []
    const findsBefore = findCalls.length
    const alerted = await watch.alertStuckPendingPayments({
      payload: payload as never,
      logger: recordingLogger(entries),
      nowMs: runAt(run),
    })
    const alerts = entries.filter((entry) => entry.level === 'error')
    expect(alerts).toHaveLength(alerted)
    perRun.push({
      alerted,
      orderIds: alerts.map((entry) => entry.bindings.orderId),
      finds: findCalls.length - findsBefore,
    })
  }
  return { perRun, watch }
}

describe('régi függő rendelések: a riasztás a teljes háttérlistán végigér', () => {
  it('30 régi függő rendelés: az első futás 25-öt, a második a maradék 5-öt riasztja, a harmadik semmit', async () => {
    const { perRun } = await runs(30, 3)
    expect(perRun.map((run) => run.alerted)).toEqual([25, 5, 0])
    const alertedIds = perRun.flatMap((run) => run.orderIds)
    expect(new Set(alertedIds).size).toBe(30)
    expect([...alertedIds].sort((a, b) => Number(a) - Number(b))).toEqual(
      Array.from({ length: 30 }, (_, index) => index + 1),
    )
  })

  it('a lapkorlátnál hosszabb listán a kurzor futásról futásra továbbhalad: minden rendelés pontosan egyszer riaszt, futásonként legfeljebb 25 riasztás és 8 lap', async () => {
    const orderCount = 230
    // 10 futás riaszthatja végig (25-ösével), a 11. már üres.
    const { perRun, watch } = await runs(orderCount, 11)

    const alertedIds = perRun.flatMap((run) => run.orderIds)
    expect(alertedIds).toHaveLength(orderCount)
    expect(new Set(alertedIds).size).toBe(orderCount)
    expect(perRun.at(-1)?.alerted).toBe(0)
    const pagesPerRun = watch.STUCK_PENDING_MAX_PAGES_PER_RUN
    const batch = watch.STUCK_PENDING_ALERT_BATCH
    // A lista hosszabb, mint amennyit egy futás a lapkorláttal elolvashat.
    expect(pagesPerRun * batch).toBeLessThan(orderCount)
    for (const run of perRun) {
      expect(run.alerted).toBeLessThanOrEqual(batch)
      expect(run.finds).toBeLessThanOrEqual(pagesPerRun)
    }
  })

  it('a lista végére érve a futás az elejéről folytatja: az első lap közben lejárt fojtású rendeléseit ugyanabban a futásban riasztja', async () => {
    const { DEFAULT_ALERT_COOLDOWN_MS } = await import('../../lib/alert-throttle')
    const pollServiceAlertedAt = NOW - DEFAULT_ALERT_COOLDOWN_MS + 7 * 60_000
    const { perRun } = await runs(55, 3, {
      runAt: (run) => NOW + run * 10 * 60_000,
      // Az első lap 25 rendeléséről a poll-szolgáltatás ugyanazzal a kulccsal
      // (src/lib/order-poll/service.ts) már riasztott; a fojtás NOW + 7 perckor jár le.
      beforeFirstRun: (throttle) => {
        for (let id = 1; id <= 25; id += 1) {
          expect(
            throttle.shouldEmitThrottledAlert(`stuck-order:${id}`, undefined, pollServiceAlertedAt),
          ).toBe(true)
        }
      },
    })
    const ids = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, index) => from + index)
    // 1. futás: az első lap fojtott, a második lap 25 riasztása kitölti a keretet.
    expect(perRun[0].orderIds).toEqual(ids(26, 50))
    // 2. futás (a fojtás már lejárt): a harmadik lap 5 rendelése után a lista
    // végéről az elejére fordul, és a keret maradékát (20) ott tölti ki.
    expect(perRun[1].orderIds).toEqual([...ids(51, 55), ...ids(1, 20)])
    // 3. futás: az első lap maradéka.
    expect(perRun[2].orderIds).toEqual(ids(21, 25))
  })

  it('körbeérve a futás a kezdőlapnál megáll, egy lapot sem olvas kétszer', async () => {
    const { perRun } = await runs(55, 4)
    expect(perRun.map((run) => run.alerted)).toEqual([25, 25, 5, 0])
    // 3. futás: 2. lap (fojtott), 3. lap, fordulás, 1. lap (fojtott), majd megáll
    // a kezdőlapnál; a 4. futás ugyanígy, riasztás nélkül.
    expect(perRun.map((run) => run.finds)).toEqual([1, 2, 3, 3])
  })
})
