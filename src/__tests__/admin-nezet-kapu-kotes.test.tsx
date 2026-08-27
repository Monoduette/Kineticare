import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { STATISTICS_ACCESS_DENIED_MESSAGE } from '../lib/statistics/revenue'

/**
 * ŐR — A NYILVÁNOS ADMIN-NÉZETEK KAPUJA A LEKÉRDEZÉSEK ELŐTT FUT.
 * A Payload 3.86 a custom view-path-okat NYILVÁNOS admin-route-ként kezeli
 * (`isCustomAdminView`), ezért a Root view auth-átirányítása KIMARAD — ezt a
 * `StatisticsView.tsx` saját fejkommentje mondja ki. Be nem jelentkezett
 * látogató is eléri az URL-t; a komponensbe írt szerepkör-kapu az EGYETLEN
 */

const revenueKem = vi.fn()
const engagementKem = vi.fn()
const bunnyPanelKem = vi.fn()

vi.mock('../components/admin/AdminChrome', () => ({
  AdminChrome: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-keret': 'chrome' }, children),
  AdminViewFrame: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-keret': 'frame' }, children),
}))

vi.mock('../lib/statistics/query', () => ({
  queryRevenueReport: (...args: unknown[]) => {
    revenueKem(...args)
    throw new Error('TILTOTT ÁGON FUTOTT: queryRevenueReport a szerepkör-kapu előtt/nélkül')
  },
}))

vi.mock('../lib/statistics/engagement-query', () => ({
  queryCourseEngagement: (...args: unknown[]) => {
    engagementKem(...args)
    throw new Error('TILTOTT ÁGON FUTOTT: queryCourseEngagement a szerepkör-kapu előtt/nélkül')
  },
}))

vi.mock('../components/admin/BunnyLibraryPanel', () => ({
  // A kém a PROPOKAT is rögzíti: a nézet címsor-szintje ebből mérhető.
  BunnyLibraryPanel: (panelProps: unknown) => {
    bunnyPanelKem(panelProps)
    return createElement('div', null, 'panel')
  },
}))

const { StatisticsView } = await import('../components/admin/StatisticsView')
const { BunnyLibraryView } = await import('../components/admin/BunnyLibraryView')
const { WebAnalyticsView, WEB_ANALYTICS_ACCESS_DENIED_MESSAGE } = await import(
  '../components/admin/WebAnalyticsView'
)

interface Szerep {
  role: string
}

/** A nézet minimális props-a; csak azt tartalmazza, amit a kapu olvas. */
function props(user: Szerep | null) {
  return {
    initPageResult: { req: { user, payload: {} } },
    params: {},
    searchParams: {},
  } as unknown as Parameters<typeof StatisticsView>[0]
}

const TILTOTT: Array<[string, Szerep | null]> = [
  ['bejelentkezés nélkül (null)', null],
  ['vevőként (customer)', { role: 'customer' }],
]

describe('Statisztika nézet: a kapu a lekérdezések ELŐTT zár', () => {
  beforeEach(() => {
    revenueKem.mockClear()
    engagementKem.mockClear()
  })

  for (const [nev, user] of TILTOTT) {
    it(`${nev} egyetlen lekérdezés sem indul, és elutasítás jön`, async () => {
      const elem = await StatisticsView(props(user))
      const html = renderToStaticMarkup(elem)

      expect(revenueKem, 'a bevétel-lekérdezés lefutott a tiltott ágon').not.toHaveBeenCalled()
      expect(engagementKem, 'a kurzus-hatás lekérdezés lefutott a tiltott ágon').not.toHaveBeenCalled()
      expect(html).toContain('data-keret="frame"')
      // A KONSTANSRA hivatkozunk, nem egy beírt szóra: a korábbi
      // `toContain('jogosultság')` némán elengedte volna a szöveg cseréjét,
      // ha az új mondatban véletlenül benne marad a szó.
      expect(html).toContain(STATISTICS_ACCESS_DENIED_MESSAGE)
    })
  }

  it('staff szerepkörrel viszont ELINDUL a lekérdezés (a kapu nem zár túl)', async () => {
    // A dobó kém itt is dob — épp ez bizonyítja, hogy a hívás megtörtént;
    // a nézet a saját try/catch-ében kezeli, és a „nem elérhető" képernyőt adja.
    const elem = await StatisticsView(props({ role: 'staff' }))
    renderToStaticMarkup(elem)
    expect(revenueKem, 'staffnál sem indult el a bevétel-lekérdezés').toHaveBeenCalledTimes(1)
  })
})

describe('Videótár nézet: ugyanaz a kapu-kötés', () => {
  beforeEach(() => {
    bunnyPanelKem.mockClear()
  })

  for (const [nev, user] of TILTOTT) {
    it(`${nev} a panel nem renderel`, () => {
      const html = renderToStaticMarkup(BunnyLibraryView(props(user)))
      expect(bunnyPanelKem, 'a Bunny-panel rendereltetett a tiltott ágon').not.toHaveBeenCalled()
      expect(html).toContain('A Videótárat csak munkatárs vagy tulajdonos nézheti meg.')
    })
  }

  it('staff szerepkörrel a panel renderel', () => {
    renderToStaticMarkup(BunnyLibraryView(props({ role: 'staff' })))
    expect(bunnyPanelKem).toHaveBeenCalledTimes(1)
  })

  it('a nézet h2-t kér a paneltől — a lap h1-e alatt nincs címsor-ugrás', () => {
    // A panel alapértelmezése `h3` (a termék-szerkesztő környezete), itt
    // viszont közvetlenül a lap `h1`-e alatt ül: a h1 → h3 ugrásból a
    // képernyőolvasót használó munkatárs hiányzó szakaszt olvasna ki
    // (WCAG 2.2 SC 1.3.1, Info and Relationships).
    renderToStaticMarkup(BunnyLibraryView(props({ role: 'staff' })))
    expect(bunnyPanelKem).toHaveBeenCalledWith(
      expect.objectContaining({ headingLevel: 'h2' }),
    )
  })
})

describe('Webanalitika nézet: ugyanaz a kapu-kötés', () => {
  // Ez a nézet adatbázist nem kérdez, de a beágyazott PostHog-iframe és a
  // külső linkek is BELSŐ felület — a tiltott ágon egyik sem jelenhet meg.
  for (const [nev, user] of TILTOTT) {
    it(`${nev} sem iframe, sem külső link nem renderel`, () => {
      const html = renderToStaticMarkup(WebAnalyticsView(props(user)))
      expect(html).toContain('data-keret="frame"')
      expect(html).toContain(WEB_ANALYTICS_ACCESS_DENIED_MESSAGE)
      expect(html).not.toContain('<iframe')
      expect(html).not.toContain('Külső elemző-felületek')
    })
  }

  it('staff szerepkörrel a külső linkek megjelennek; env nélkül a beüzemelési útmutató', () => {
    const html = renderToStaticMarkup(WebAnalyticsView(props({ role: 'staff' })))
    expect(html).toContain('Külső elemző-felületek')
    expect(html).toContain('https://analytics.google.com/')
    // POSTHOG_SHARED_DASHBOARD_URL nincs beállítva a tesztben → nincs iframe,
    // helyette a beüzemelés lépései.
    expect(html).not.toContain('<iframe')
    expect(html).toContain('POSTHOG_SHARED_DASHBOARD_URL')
  })

  it('érvényes megosztási linkkel az iframe az embedded alakra normalizálva jelenik meg', () => {
    vi.stubEnv('POSTHOG_SHARED_DASHBOARD_URL', 'https://eu.posthog.com/shared/AbCd1234xyz')
    try {
      const html = renderToStaticMarkup(WebAnalyticsView(props({ role: 'owner' })))
      expect(html).toContain('<iframe')
      expect(html).toContain('https://eu.posthog.com/embedded/AbCd1234xyz')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('idegen hostra mutató env-vel NINCS iframe (a nézet nem ágyaz be idegen oldalt)', () => {
    vi.stubEnv('POSTHOG_SHARED_DASHBOARD_URL', 'https://evil.example/shared/AbCd1234xyz')
    try {
      const html = renderToStaticMarkup(WebAnalyticsView(props({ role: 'owner' })))
      expect(html).not.toContain('<iframe')
      expect(html).not.toContain('evil.example')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
