import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  installShutdownDrain,
  readPayloadCrons,
  SHUTDOWN_CRON_DRAIN_BUDGET_MS,
  type DrainableCron,
  type ShutdownProcess,
} from '../instrumentation'
import { createLogger } from '../lib/logger'

/**
 * a-callback-2: redeploykor a Railway SIGTERM-et küld, majd a
 * drainingSeconds (railway.json, 60 s) után SIGKILL-t. A `next start` a
 * SIGTERM-re a saját takarítása végén process.exit(143)-at hív, a
 * Payload-cronokról nem tud: egy épp futó webhook-retry vagy order-poll job
 * `processing: true`-n ragadt, és az ütemezés a schedule-guardig állt.
 *
 * A szerződés: SIGTERM után új job nem indul (a cronok leállnak), a futó job a
 * keretig befejeződhet, és a Next kilépése csak utána történik meg, a kért
 * kilépési kóddal.
 */

class FakeProcess extends EventEmitter {
  readonly exits: Array<number | undefined> = []
  exit = ((code?: number) => {
    this.exits.push(code)
    return undefined as never
  }) as ShutdownProcess['exit']
}

function fakeCron(busyForMs: number, startedAt: () => number) {
  const stop = vi.fn()
  const cron: DrainableCron = {
    stop,
    isBusy: () => Date.now() - startedAt() < busyForMs,
  }
  return { cron, stop }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete (globalThis as { _payload?: unknown })._payload
})

describe('leállás: SIGTERM után a Payload-cronok lefolyatása', () => {
  it('a futó job befejeződéséig visszatartja a Next process.exit(143)-at, és a cronokat leállítja', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const proc = new FakeProcess()
    const startedAt = Date.now()
    const busy = fakeCron(10_000, () => startedAt)
    const idle = fakeCron(0, () => startedAt)
    installShutdownDrain({
      log: createLogger(),
      proc: proc as unknown as ShutdownProcess,
      getCrons: () => [busy.cron, idle.cron],
    })

    proc.emit('SIGTERM')
    // A Next takarítása azonnal kilépne:
    proc.exit(143)

    expect(busy.stop).toHaveBeenCalledTimes(1)
    expect(idle.stop).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(9_000)
    expect(proc.exits).toEqual([])
    await vi.advanceTimersByTimeAsync(1_500)
    expect(proc.exits).toEqual([143])
  })

  it('a keret lejártakor akkor is kilép, ha egy job még fut, és RIASZTÁS-t ír', async () => {
    vi.useFakeTimers()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const proc = new FakeProcess()
    const stuck: DrainableCron = { stop: vi.fn(), isBusy: () => true }
    installShutdownDrain({
      log: createLogger(),
      proc: proc as unknown as ShutdownProcess,
      getCrons: () => [stuck],
    })

    proc.emit('SIGTERM')
    proc.exit(143)
    await vi.advanceTimersByTimeAsync(SHUTDOWN_CRON_DRAIN_BUDGET_MS - 1_000)
    expect(proc.exits).toEqual([])
    await vi.advanceTimersByTimeAsync(2_000)

    expect(proc.exits).toEqual([143])
    expect(
      logSpy.mock.calls.some((call) =>
        String(call[0]).includes('RIASZTÁS: leállás közben a várakozási keret alatt sem'),
      ),
    ).toBe(true)
  })

  it('futó job nélkül nem késlelteti a kilépést', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const proc = new FakeProcess()
    installShutdownDrain({
      log: createLogger(),
      proc: proc as unknown as ShutdownProcess,
      getCrons: () => [{ stop: vi.fn(), isBusy: () => false }],
    })

    proc.emit('SIGTERM')
    proc.exit(143)
    await vi.advanceTimersByTimeAsync(0)

    expect(proc.exits).toEqual([143])
  })

  it('SIGTERM nélkül a process.exit érintetlen', () => {
    const proc = new FakeProcess()
    const originalExit = proc.exit
    installShutdownDrain({ log: createLogger(), proc: proc as unknown as ShutdownProcess })

    proc.exit(0)

    expect(proc.exit).toBe(originalExit)
    expect(proc.exits).toEqual([0])
  })

  it('a cronokat a már inicializált Payload-példányból olvassa, újat nem indít', () => {
    const cron: DrainableCron = { stop: vi.fn(), isBusy: () => false }
    expect(readPayloadCrons()).toEqual([])
    ;(globalThis as { _payload?: unknown })._payload = new Map([
      ['default', { payload: { crons: [cron, { nem: 'cron' }] } }],
    ])
    expect(readPayloadCrons()).toEqual([cron])
  })
})
