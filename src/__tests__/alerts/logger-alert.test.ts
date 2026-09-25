import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  alertCodeFromMessage,
  ALERT_CODES,
  isValidAlertCode,
  resolveAlertCode,
} from '../../lib/alerts/classify'
import { emitAlert } from '../../lib/alerts/emit'
import { createLogger, setAlertSink, type AlertLogEntry } from '../../lib/logger'

/**
 * A logger riasztás-horga: a RIASZTÁS-sor (vagy az `alert: true`-t hordozó
 * error-sor) a legfelső szinten `alert: true` és `alertCode` mezőt kap (Railway:
 * `@alert:true`), és a regisztrált csatorna redaktált bejegyzést kap. A
 * csatorna hibája nem juthat vissza a hívóhoz, és nem rekurzálhat.
 */

let lines: Array<Record<string, unknown>> = []

beforeEach(() => {
  lines = []
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    lines.push(JSON.parse(String(line)) as Record<string, unknown>)
  })
})

afterEach(() => {
  setAlertSink(undefined)
  vi.restoreAllMocks()
})

describe('riasztáskód', () => {
  it('az ismert szolgáltatás-üzenet ugyanazt a kódot kapja, mint a saját 24 órás riasztás', () => {
    expect(
      alertCodeFromMessage(
        'RIASZTÁS: a rendelés 24 órája payment_pending — manuális ellenőrzés szükséges',
      ),
    ).toBe(ALERT_CODES.fuggoFizetes24Ora)
    expect(
      alertCodeFromMessage(
        'RIASZTÁS: tartós refund ellenőrzésre vár — a sor forgatható új pénzművelet nélkül',
      ),
    ).toBe(ALERT_CODES.refundEllenorzesreVar)
  })

  it('ismeretlen üzenetnél az első tagmondatból ékezet nélküli, kötőjeles kód lesz', () => {
    expect(
      alertCodeFromMessage(
        'RIASZTÁS: invoice-issue: a Számlázz.hu-konfiguráció hibás — a task nem POSTol',
      ),
    ).toBe('invoice-issue-a-szamlazz-hu-konfiguracio-hibas')
    expect(alertCodeFromMessage('RIASZTÁS: dupla-fizetés-őr — a termék nem olvasható')).toBe(
      'dupla-fizetes-or',
    )
  })

  it('a kód legfeljebb 64 karakter, szóhatáron vágva, és mindig érvényes', () => {
    const code = alertCodeFromMessage(`RIASZTÁS: ${'nagyon hosszú szó '.repeat(20)}`)
    expect(code.length).toBeLessThanOrEqual(64)
    expect(isValidAlertCode(code)).toBe(true)
    expect(code.endsWith('-')).toBe(false)
  })

  it('csak RIASZTÁS-előtag vagy alert: true tesz riasztássá; az érvénytelen explicit kód helyett képzett kód jön', () => {
    expect(resolveAlertCode('sima hiba', {}, {})).toBeNull()
    expect(resolveAlertCode('sima hiba', {}, { alertCode: 'x' })).toBeNull()
    expect(resolveAlertCode('valami elromlott', {}, { alert: true, alertCode: 'sajat-kod' })).toBe(
      'sajat-kod',
    )
    expect(
      resolveAlertCode('RIASZTÁS: Kód Hiba', {}, { alert: true, alertCode: 'Rossz Kód!' }),
    ).toBe('kod-hiba')
    expect(resolveAlertCode('valami', { alert: true, alertCode: 'kotesbol' }, undefined)).toBe(
      'kotesbol',
    )
  })
})

describe('logger — riasztás-sor', () => {
  it('a RIASZTÁS error-sor felső szinten alert: true és alertCode mezőt kap', () => {
    createLogger({ module: 'order-poll' }).error('RIASZTÁS: dupla-fizetés-őr — blokkolva', {
      productId: 3,
    })
    expect(lines[0]).toMatchObject({
      level: 'error',
      alert: true,
      alertCode: 'dupla-fizetes-or',
      module: 'order-poll',
    })
  })

  it('sima error-sor és a warn-szintű RIASZTÁS nem riasztás', () => {
    const log = createLogger()
    log.error('request_error', { path: '/x' })
    log.warn('RIASZTÁS: csak figyelmeztetés')
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      expect(line).not.toHaveProperty('alert')
      expect(line).not.toHaveProperty('alertCode')
    }
  })

  it('az emitAlert a megadott kódot a felső szintre emeli', () => {
    emitAlert(createLogger(), 'beragadt-job', 'Beragadt feladat lezárva', { queue: 'q' })
    expect(lines[0]).toMatchObject({ alert: true, alertCode: 'beragadt-job' })
  })

  it('a csatorna REDAKTÁLT kötést és contextet kap', () => {
    const received: AlertLogEntry[] = []
    setAlertSink((entry) => {
      received.push(entry)
    })
    createLogger({ requestId: 'req-1', token: 'titok' }).error('RIASZTÁS: teszt', {
      password: 'jelszo',
      orderNumber: 'KH-2026-000001',
    })
    expect(received).toHaveLength(1)
    expect(received[0]?.alertCode).toBe('teszt')
    expect(received[0]?.bindings).toMatchObject({ requestId: 'req-1', token: '[REDACTED]' })
    expect(received[0]?.context).toMatchObject({
      password: '[REDACTED]',
      orderNumber: 'KH-2026-000001',
    })
  })

  it('nem riasztás-sornál a csatorna nem hívódik', () => {
    const sink = vi.fn()
    setAlertSink(sink)
    const log = createLogger()
    log.error('sima hiba')
    log.info('RIASZTÁS: info-szinten')
    expect(sink).not.toHaveBeenCalled()
  })

  it('a csatorna hibája nem jut vissza a hívóhoz, a sor megmarad', () => {
    setAlertSink(() => {
      throw new Error('a csatorna elszállt')
    })
    expect(() => createLogger().error('RIASZTÁS: teszt')).not.toThrow()
    expect(lines).toHaveLength(1)
  })

  it('a csatornán belül írt riasztás-sor nem hívja újra a csatornát (nincs rekurzió)', () => {
    const log = createLogger()
    const sink = vi.fn(() => {
      log.error('RIASZTÁS: a csatorna maga is hibát ír')
    })
    setAlertSink(sink)
    log.error('RIASZTÁS: eredeti')
    expect(sink).toHaveBeenCalledTimes(1)
    expect(lines).toHaveLength(2)
  })
})
