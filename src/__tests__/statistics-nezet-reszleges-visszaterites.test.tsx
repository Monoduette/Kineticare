import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  RESZLEGES_LEVONVA,
  RESZLEGES_NINCS_LEVONVA,
} from '../components/admin/statistics/TotalsCards'

/**
 * PR #305, Devin 🔴: a részleges visszatérítés a tulajdonos Statisztika- és
 * Webanalitika-oldalán is levonódjon, a munkatársén viszont a `refunds` mező
 * (tulajdonosi olvasású, CLAUDE.md 4.) be se kerüljön a lekérdezésbe.
 *
 * A két nézetet a valódi `queryRevenueReport`-tal rendereljük, csak a Payload
 * `find`/`count` a memóriából jön. A `find` a Payload `select`-szerződését
 * követi (csak a kért mezőket adja vissza), mert a lekérdezés
 * `overrideAccess: true`-val fut: a munkatársnál egyedül a select tartja
 * távol a `refunds` mezőt.
 *
 * A Devin-példa: 79 500 Ft-os szeptemberi rendelés, 20 000 Ft részleges
 * visszatérítés szeptemberben → a tulajdonos szeptemberi összege 59 500 Ft.
 */

vi.mock('../components/admin/AdminChrome', () => ({
  AdminChrome: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  AdminViewFrame: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}))

// A kurzus-hatás itt nem tárgy: a hibája a két nézetben csak a saját
// szekcióját viszi el, a bevételi részt nem.
vi.mock('../lib/statistics/engagement-query', () => ({
  queryCourseEngagement: async () => {
    throw new Error('a kurzus-hatás ebben a tesztben nem elérhető')
  },
}))

/** A kurzustábla leírása (`aria-describedby`), indoklás nélkül, mert mindkét nézetben igaz. */
const KURZUS_JEGYZET =
  /id="kc-stat-kurzus-bevetel-jegyzet"[^>]*>A részlegesen visszatérített rendelés ebben a táblában a teljes összegével szerepel\.</

const { StatisticsView } = await import('../components/admin/StatisticsView')
const { WebAnalyticsView } = await import('../components/admin/WebAnalyticsView')

const PAID_ORDER: Record<string, unknown> = {
  status: 'paid',
  createdAt: '2026-09-10T10:00:00.000Z',
  invoiceCompletionDate: '2026-09-10',
  totalHufSnapshot: 79_500,
  items: [
    {
      product: { id: 1, audience: 'laikus', displayTitle: 'Otthoni kézrehabilitáció' },
      quantity: 1,
      priceHufSnapshot: 79_500,
      titleSnapshot: 'Otthoni kézrehabilitáció',
    },
  ],
  refunds: [
    {
      type: 'partial',
      amountHuf: 20_000,
      refundedAt: '2026-09-15T09:00:00.000Z',
    },
  ],
}

function memoryPayload() {
  const findCalls: Array<Record<string, unknown>> = []
  const find = async (args: Record<string, unknown>) => {
    findCalls.push(args)
    if (args.collection !== 'orders') {
      return { docs: [], hasNextPage: false, totalDocs: 0 }
    }
    const select = (args.select ?? {}) as Record<string, unknown>
    const projected = Object.fromEntries(
      Object.entries(PAID_ORDER).filter(([field]) => select[field] === true),
    )
    return { docs: [projected], hasNextPage: false, totalDocs: 1 }
  }
  const count = async () => ({ totalDocs: 1 })
  return { payload: { find, count }, findCalls }
}

function props(role: 'owner' | 'staff', payload: unknown) {
  return {
    initPageResult: { req: { user: { role }, payload } },
    params: {},
    searchParams: {},
  } as unknown as Parameters<typeof StatisticsView>[0]
}

const huf = (value: number) => `${value.toLocaleString('hu-HU')} Ft`

function ordersSelect(findCalls: Array<Record<string, unknown>>): Record<string, unknown> {
  const call = findCalls.find((args) => args.collection === 'orders')
  return (call?.select ?? {}) as Record<string, unknown>
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-24T10:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Statisztika oldal: részleges visszatérítés szerepkör szerint', () => {
  it('a tulajdonosnál levonja, és azt írja, hogy levontuk', async () => {
    const { payload, findCalls } = memoryPayload()
    const html = renderToStaticMarkup(await StatisticsView(props('owner', payload)))

    expect(ordersSelect(findCalls)).toHaveProperty('refunds', true)
    // Az ág- és kurzusbontás bruttó marad (79 500), a hónap és az összesen
    // a levonás után áll, a levont összeg külön kártyán látszik.
    expect(html).toContain(huf(59_500))
    expect(html).toContain('Levont részleges visszatérítés')
    expect(html).toContain(huf(20_000))
    expect(html).toContain(RESZLEGES_LEVONVA)
    expect(html).not.toContain(RESZLEGES_NINCS_LEVONVA)
    // PR #305, Codex P2: az ág- és a kurzusbontás teljes összeggel marad (a
    // visszatérítés nem mondja meg, melyik kurzusra szólt); a kártyák alatti
    // mondat ezt indokolja, a kurzustábla leírása kimondja.
    expect(html).toContain(
      'Az otthoni és a szakmai ág összegéből, valamint a kurzusonkénti bevételből nem vontuk le, mert a visszatérítésnél nincs rögzítve, melyik kurzusra szólt.',
    )
    expect(html).toContain('aria-describedby="kc-stat-kurzus-bevetel-jegyzet"')
    expect(html).toMatch(KURZUS_JEGYZET)
  })

  it('a munkatársnál a refunds mezőt le sem kéri, bruttót mutat, és ezt ki is mondja', async () => {
    const { payload, findCalls } = memoryPayload()
    const html = renderToStaticMarkup(await StatisticsView(props('staff', payload)))

    expect(ordersSelect(findCalls)).not.toHaveProperty('refunds')
    expect(html).toContain(huf(79_500))
    expect(html).not.toContain(huf(59_500))
    expect(html).not.toContain('Levont részleges visszatérítés')
    expect(html).toContain(RESZLEGES_NINCS_LEVONVA)
    expect(html).not.toContain(RESZLEGES_LEVONVA)
    // A kurzustábla jegyzete itt is áll, de a tulajdonosi indoklás (a
    // visszatérítés tétele) nem: a munkatársnál az ok az, hogy a
    // visszatérítés nem olvasható, és a lap csak ezt az egy okot mondja.
    expect(html).toMatch(KURZUS_JEGYZET)
    expect(html).not.toContain('melyik kurzusra szólt')
  })
})

describe('Webanalitika oldal: ugyanaz a szám és ugyanaz a mondat, mint a Statisztikán', () => {
  it('a tulajdonos havi bevétele a részleges visszatérítés után áll, és ezt a mondat is mondja', async () => {
    const { payload, findCalls } = memoryPayload()
    const html = renderToStaticMarkup(await WebAnalyticsView(props('owner', payload)))

    expect(ordersSelect(findCalls)).toHaveProperty('refunds', true)
    expect(html).toContain(huf(59_500))
    expect(html).not.toContain(huf(79_500))
    expect(html).toContain(RESZLEGES_LEVONVA)
    expect(html).not.toContain(RESZLEGES_NINCS_LEVONVA)
  })

  it('a munkatársnál a refunds mezőt le sem kéri, bruttót mutat, és ezt ki is mondja', async () => {
    const { payload, findCalls } = memoryPayload()
    const html = renderToStaticMarkup(await WebAnalyticsView(props('staff', payload)))

    expect(ordersSelect(findCalls)).not.toHaveProperty('refunds')
    expect(html).toContain(huf(79_500))
    expect(html).not.toContain(huf(59_500))
    expect(html).toContain(RESZLEGES_NINCS_LEVONVA)
    expect(html).not.toContain(RESZLEGES_LEVONVA)
  })
})
