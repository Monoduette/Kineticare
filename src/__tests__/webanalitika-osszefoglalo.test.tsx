import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { CourseEngagementReport, CourseEngagementRow } from '../lib/statistics/engagement'
import type { RevenueReport } from '../lib/statistics/revenue'

/**
 * A Webanalitika-nézet eladás- és haladás-összefoglalója — POZITÍV ág.
 *
 * A kapu-kötés őre (admin-nezet-kapu-kotes.test.tsx) dobó kémekkel bizonyítja,
 * hogy a lekérdezések a kapu MÖGÖTT futnak; ez a teszt a másik felét méri:
 * sikeres jelentésből a hat kiemelt szám HELYESEN áll össze — a hónap-sor az
 * utolsó (aktuális) hónapból jön, a haladás-oszlopok pedig kurzusonként
 * összegződnek (ugyanúgy, ahogy a Statisztika kurzus-táblája).
 */

vi.mock('../components/admin/AdminChrome', () => ({
  AdminChrome: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-keret': 'chrome' }, children),
  AdminViewFrame: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-keret': 'frame' }, children),
}))

const REPORT: RevenueReport = {
  months: [
    {
      month: '2026-07',
      laikusHuf: 10000,
      szakemberHuf: 0,
      totalHuf: 10000,
      orderCount: 1,
    },
    {
      month: '2026-08',
      laikusHuf: 149800,
      szakemberHuf: 89900,
      totalHuf: 239700,
      orderCount: 7,
    },
  ],
  totals: { laikusHuf: 159800, szakemberHuf: 89900, totalHuf: 249700, orderCount: 8 },
  courses: [],
  funnel: {
    created: 0,
    paymentPending: 0,
    paid: 8,
    paymentFailed: 0,
    cancelled: 0,
    refunded: 0,
    other: 0,
    total: 8,
  },
  truncated: false,
}

function sor(reszlet: Partial<CourseEngagementRow>): CourseEngagementRow {
  return {
    productId: 1,
    title: 'Kurzus',
    audience: 'laikus',
    enrolled: 0,
    started: 0,
    completed: 0,
    notStarted: 0,
    totalLessons: 5,
    averagePercent: 0,
    completionRateOfEnrolled: 0,
    omitted: 0,
    ...reszlet,
  } as CourseEngagementRow
}

const ENGAGEMENT: CourseEngagementReport = {
  courses: [
    sor({ productId: 1, enrolled: 12, started: 9, completed: 4 }),
    sor({ productId: 2, enrolled: 5, started: 2, completed: 1 }),
  ],
  truncated: false,
  skipped: 0,
  omitted: 0,
}

vi.mock('../lib/statistics/query', () => ({
  queryRevenueReport: vi.fn(async () => REPORT),
}))

vi.mock('../lib/statistics/engagement-query', () => ({
  queryCourseEngagement: vi.fn(async () => ENGAGEMENT),
}))

const { WebAnalyticsView } = await import('../components/admin/WebAnalyticsView')

function props() {
  return {
    initPageResult: { req: { user: { role: 'staff' }, payload: {} } },
    params: {},
    searchParams: {},
  } as unknown as Parameters<typeof WebAnalyticsView>[0]
}

describe('Webanalitika: eladás- és haladás-összefoglaló sikeres lekérdezésből', () => {
  it('a hónap-számok az UTOLSÓ (aktuális) hónapból jönnek, az összesen a totals-ból', async () => {
    const html = renderToStaticMarkup(await WebAnalyticsView(props()))
    // formatHuf ezres tagolással ír (nem törhető szóközzel) — a konkrét
    // elválasztóra nem kötünk ki, a számjegy-sorrendre igen.
    expect(html.replace(/[  \s]/g, '')).toContain('239700')
    expect(html).toContain('Bevétel ebben a hónapban')
    expect(html).toContain('Fizetett rendelés ebben a hónapban')
    expect(html).toContain('Fizetett rendelés összesen')
    // A júliusi 10 000 Ft NEM szerepelhet kiemelt számként.
    expect(html.replace(/[  \s]/g, '')).not.toContain('>10000<')
  })

  it('a haladás-oszlopok kurzusonként összegződnek', async () => {
    const html = renderToStaticMarkup(await WebAnalyticsView(props()))
    expect(html).toContain('Kurzus-hozzáférés (vevő × kurzus)')
    expect(html).toContain('>17<')
    expect(html).toContain('Elkezdte a kurzust')
    expect(html).toContain('>11<')
    expect(html).toContain('Be is fejezte')
    expect(html).toContain('>5<')
  })
})
