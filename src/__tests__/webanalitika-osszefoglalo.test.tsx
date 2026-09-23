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

const { EMBED_MISSING_STAFF_MESSAGE, EMBED_MISSING_TITLE, NEW_TAB_SUFFIX, WebAnalyticsView } =
  await import('../components/admin/WebAnalyticsView')

/** A tulajdonosi bekötési útmutató, szó szerint (a <code> a változó neve). */
const OWNER_GUIDE =
  'A PostHogban nyisd meg a Dashboards listát, és keresd meg azt a kimutatást, amelynek a nevében a „látogatók és érdeklődés” szerepel. Kapcsold be a megosztását (Share gomb), a kapott linket pedig állítsd be a Railway-en a <code>POSTHOG_SHARED_DASHBOARD_URL</code> változóba. A következő indulás után a kimutatás itt jelenik meg.'

/** Mondatokra bontás összevetéshez: kisbetű, záró írásjel nélkül. */
function sentences(text: string): string[] {
  return text
    .replace(/<[^>]+>/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) =>
      sentence
        .replace(/[.!?]+$/, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean)
}

/** A kimutatás-doboz címe és bekezdése a renderelt HTML-ből. */
function embedBox(html: string): { title: string; paragraph: string } {
  const match = /<h3[^>]*>([^<]*)<\/h3><p>(.*?)<\/p>/.exec(html)
  expect(match, 'a kimutatás-doboz címe és bekezdése hiányzik').not.toBeNull()
  return { title: match![1], paragraph: match![2] }
}

function props(role = 'staff') {
  return {
    initPageResult: { req: { user: { role }, payload: {} } },
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
    expect(html).toContain('Kurzus-hozzáférések száma')
    expect(html).toContain('>17<')
    expect(html).toContain('Elkezdte a kurzust')
    expect(html).toContain('>11<')
    expect(html).toContain('Be is fejezte')
    expect(html).toContain('>5<')
  })
})

describe('Webanalitika K13: azonosítható külső linkek, szerepkör szerinti bekötési útmutató', () => {
  it('minden külső link aláhúzott (a .kc-adminstat link-nyelve), token-keretes, és kimondja az új lapot', async () => {
    const html = renderToStaticMarkup(await WebAnalyticsView(props()))
    const links = html.match(/<a [^>]*target="_blank"[^>]*>[^<]*<\/a>/g) ?? []
    expect(links).toHaveLength(4)
    for (const link of links) {
      expect(link).toContain(NEW_TAB_SUFFIX)
      expect(link).toContain('border:1px solid var(--kc-as-hairline-strong)')
      // Inline szín vagy text-decoration:none felülírná a lap link-nyelvét.
      expect(link).not.toMatch(/color:|text-decoration:none/)
    }
    expect(html).not.toContain('--theme-elevation-150')
  })

  it('munkatársnak nincs környezeti változó, csak a teendő', async () => {
    const html = renderToStaticMarkup(await WebAnalyticsView(props('staff')))
    expect(html).toContain(EMBED_MISSING_STAFF_MESSAGE)
    expect(EMBED_MISSING_STAFF_MESSAGE).toBe(
      'A bekötést a tulajdonos végzi. Szólj neki, ha szeretnéd itt látni a kimutatást.',
    )
    expect(html).not.toContain('POSTHOG_SHARED_DASHBOARD_URL')
    expect(html).not.toContain('Railway')
  })

  it('a doboz címe és a bekezdése nem ugyanazt a mondatot mondja (mindkét szerepkörnél)', async () => {
    for (const role of ['staff', 'owner']) {
      const { title, paragraph } = embedBox(
        renderToStaticMarkup(await WebAnalyticsView(props(role))),
      )
      expect(title).toBe(EMBED_MISSING_TITLE)
      expect(title).toBe('A beágyazott kimutatás még nincs bekötve')
      const [heading] = sentences(title)
      expect(sentences(paragraph), `${role}: a bekezdés megismétli a címet`).not.toContain(heading)
      expect(paragraph.toLowerCase()).not.toContain(heading)
    }
  })

  it('a tulajdonos a bekötés lépéseit kapja, a PostHogban kereshető névrésszel', async () => {
    const html = renderToStaticMarkup(await WebAnalyticsView(props('owner')))
    expect(html).toContain('POSTHOG_SHARED_DASHBOARD_URL')
    expect(html).not.toContain(EMBED_MISSING_STAFF_MESSAGE)
    expect(embedBox(html).paragraph).toBe(OWNER_GUIDE)
  })

  it('a felületi szövegekben nincs gondolatjel és „dashboard” szó', async () => {
    const html = renderToStaticMarkup(await WebAnalyticsView(props('owner')))
    // A környezeti változó neve kód, nem felületi szöveg.
    const text = html.replace(/<code>[^<]*<\/code>/g, ' ').replace(/<[^>]+>/g, ' ')
    expect(text).not.toMatch(/[–—]/)
    // Egyetlen kivétel: a PostHog saját menüpontjának neve („Dashboards”), mert
    // a tulajdonos ott erre a szóra keres (külső felület tényleges neve). A
    // Kineticare saját szövege továbbra is „kimutatás”.
    expect(text.match(/dashboard/gi)).toEqual(['Dashboard'])
    expect(text.replace('a Dashboards listát', ' ')).not.toMatch(/dashboard/i)
  })
})
