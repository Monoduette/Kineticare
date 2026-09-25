import type { Payload } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  parseRefundPanelInfo,
  refundPaymentAgeText,
} from '../../components/admin/refund-panel-context'
import { INVOICE_PENDING_MESSAGE } from '../../lib/refund/invoice-gate'
import { daysSinceBudapestDate, readRefundPanelContext } from '../../lib/refund/panel-context'
import type { Order } from '../../payload-types'

/**
 * A panel rendelés-összefüggése (a-cms-11 / K3: a fizetés óta eltelt napok;
 * K12: a számla-kapu oka a panelen is). A szerver az egyetlen forrás; a
 * panel csak megjeleníti.
 */

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('a fizetés óta eltelt naptári napok Europe/Budapest szerint', () => {
  it.each([
    ['a fizetés napján, budapesti éjfél előtt', '2026-09-05', '2026-09-05T21:59:00.000Z', 0],
    [
      'budapesti éjfélkor már a következő nap (UTC szerint még ugyanaz)',
      '2026-09-05',
      '2026-09-05T22:00:00.000Z',
      1,
    ],
    ['a téli időszámításra váltás napján át', '2026-10-24', '2026-10-26T12:00:00.000Z', 2],
    ['a nyári időszámításra váltás napján át', '2026-03-28', '2026-03-30T12:00:00.000Z', 2],
  ] as const)('%s', (_label, paidDate, now, days) => {
    expect(daysSinceBudapestDate(paidDate, new Date(now))).toBe(days)
  })

  it.each(['2026-09-25', '2026-02-30', 'nem dátum'])(
    'jövőbeli vagy értelmetlen dátumra (%s) nincs szám',
    (paidDate) => {
      expect(daysSinceBudapestDate(paidDate, new Date('2026-09-24T10:00:00.000Z'))).toBeNull()
    },
  )
})

function payloadFor(order: Partial<Order>, grants: unknown[] = []) {
  return {
    find: vi.fn(async () => ({ docs: [order], totalDocs: 1 })),
    findByID: vi.fn(async () => ({ id: 7, accessGrants: grants })),
  } as unknown as Payload
}

const PAID_ORDER = {
  id: 11,
  orderNumber: 'SYNTHETIC-PANEL-11',
  status: 'paid',
  customer: 7,
  invoiceStatus: 'pending',
  invoiceNumber: null,
} as unknown as Order

describe('readRefundPanelContext', () => {
  const now = new Date('2026-09-24T10:00:00.000Z')

  it('bekapcsolt számlázásnál a kapu oka, és a fizetés napja a hozzáférés kezdetéből', async () => {
    vi.stubEnv('SZAMLAZZ_AGENT_KEY', 'DUMMY-agent-key')
    const payload = payloadFor(PAID_ORDER, [
      { sourceKind: 'order', sourceOrder: 11, product: 42, grantedAt: '2026-09-05T08:00:00.000Z' },
    ])
    expect(await readRefundPanelContext(payload, 'SYNTHETIC-PANEL-11', { now })).toEqual({
      refundGate: INVOICE_PENDING_MESSAGE,
      paidDate: '2026-09-05',
      daysSincePayment: 19,
    })
  })

  it('hozzáférés-óra nélkül a számla teljesítési dátuma a fizetés napja; kiállított számlánál nincs kapu', async () => {
    vi.stubEnv('SZAMLAZZ_AGENT_KEY', 'DUMMY-agent-key')
    const payload = payloadFor({
      ...PAID_ORDER,
      invoiceStatus: 'issued',
      invoiceNumber: 'SYNTHETIC-INV',
      invoiceCompletionDate: '2026-09-04',
    })
    expect(await readRefundPanelContext(payload, 'SYNTHETIC-PANEL-11', { now })).toEqual({
      refundGate: null,
      paidDate: '2026-09-04',
      daysSincePayment: 20,
    })
  })

  it('olvasási hibánál üres összefüggés, nem kivétel', async () => {
    const payload = {
      find: vi.fn(async () => {
        throw new Error('SYNTHETIC storage failure')
      }),
    } as unknown as Payload
    expect(await readRefundPanelContext(payload, 'SYNTHETIC-PANEL-11', { now })).toEqual({
      refundGate: null,
      paidDate: null,
      daysSincePayment: null,
    })
  })
})

describe('a panel oldali értelmezés és szöveg', () => {
  it('a hibás mezőket elhagyja, a helyeseket megtartja', () => {
    expect(
      parseRefundPanelInfo({
        panel: { refundGate: 'Számla-kapu.', paidDate: '2026-09-05', daysSincePayment: 19 },
      }),
    ).toEqual({ refundGate: 'Számla-kapu.', paidDate: '2026-09-05', daysSincePayment: 19 })
    expect(
      parseRefundPanelInfo({
        panel: { refundGate: 3, paidDate: '5/9/2026', daysSincePayment: -1 },
      }),
    ).toEqual({ refundGate: null, paidDate: null, daysSincePayment: null })
    expect(parseRefundPanelInfo({})).toEqual({
      refundGate: null,
      paidDate: null,
      daysSincePayment: null,
    })
  })

  it.each([
    [
      { paidDate: '2026-09-05', daysSincePayment: 19 },
      'A fizetés napja: 2026. 09. 05. (19 napja).',
    ],
    [{ paidDate: '2026-09-24', daysSincePayment: 0 }, 'A fizetés napja: 2026. 09. 24. (ma).'],
    [{ paidDate: null, daysSincePayment: null }, null],
  ] as const)('%j → %s', (info, text) => {
    expect(refundPaymentAgeText({ refundGate: null, ...info })).toBe(text)
  })
})
