import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { STATISTICS_ACCESS_DENIED_MESSAGE } from '../lib/statistics/revenue'

/**
 * ŐR — A NYILVÁNOS ADMIN-NÉZETEK KAPUJA A LEKÉRDEZÉSEK ELŐTT FUT.
 * A Payload 3.88.0 a custom view-path-okat NYILVÁNOS admin-route-ként kezeli
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

const posthogKem = vi.fn()

vi.mock('../lib/admin/posthog-web-stats', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/admin/posthog-web-stats')>()),
  loadPosthogWebStats: async () => {
    posthogKem()
    return { status: 'not_configured' }
  },
}))

vi.mock('../components/admin/BunnyLibraryPanel', () => ({
  BunnyVideoLibrary: (panelProps: unknown) => {
    bunnyPanelKem(panelProps)
    return createElement('section', { 'aria-label': 'Védett videók' }, 'panel')
  },
}))

const { StatisticsView } = await import('../components/admin/StatisticsView')
const { BunnyLibraryView } = await import('../components/admin/BunnyLibraryView')
const {
  WebAnalyticsView,
  WEB_ANALYTICS_ACCESS_DENIED_MESSAGE,
  WEB_ANALYTICS_DB_UNAVAILABLE_MESSAGE,
} = await import('../components/admin/WebAnalyticsView')

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
      expect(
        engagementKem,
        'a kurzus-hatás lekérdezés lefutott a tiltott ágon',
      ).not.toHaveBeenCalled()
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

  it('az önálló tár megtartja a lap h1-ét és nem kér régi h3 panelcímsort', () => {
    const html = renderToStaticMarkup(BunnyLibraryView(props({ role: 'staff' })))
    expect(bunnyPanelKem).toHaveBeenCalledTimes(1)
    expect(html).toContain('<h1 style="margin-top:0">Videótár</h1>')
    expect(html).toContain('aria-label="Védett videók"')
    expect(html).not.toContain('<h3')
  })
})

describe('Webanalitika nézet: ugyanaz a kapu-kötés', () => {
  beforeEach(() => {
    revenueKem.mockClear()
    engagementKem.mockClear()
    posthogKem.mockClear()
  })

  // 2026-08-27 óta a nézet a Statisztika lekérdezőit is hívja (eladás- és
  // haladás-összefoglaló), 2026-11-07 óta a PostHog-adatot is natívan kéri
  // le: a tiltott ágon egyik lekérdezés SEM indulhat el.
  for (const [nev, user] of TILTOTT) {
    it(`${nev} se DB-, se PostHog-lekérdezés`, async () => {
      const html = renderToStaticMarkup(await WebAnalyticsView(props(user)))
      expect(revenueKem, 'a bevétel-lekérdezés lefutott a tiltott ágon').not.toHaveBeenCalled()
      expect(
        engagementKem,
        'a kurzus-hatás lekérdezés lefutott a tiltott ágon',
      ).not.toHaveBeenCalled()
      expect(posthogKem, 'a PostHog-lekérdezés lefutott a tiltott ágon').not.toHaveBeenCalled()
      expect(html).toContain('data-keret="frame"')
      expect(html).toContain(WEB_ANALYTICS_ACCESS_DENIED_MESSAGE)
    })
  }

  it('staff szerepkörrel a lekérdezés ELINDUL, és a hibája nem dönti el az oldalt', async () => {
    // A dobó kém itt is dob — épp ez bizonyítja, hogy a hívás megtörtént; a
    // nézet a saját try/catch-ében kezeli, és a szekció helyén a magyar
    // magyarázat áll, miközben a látogatói szekció változatlanul megjelenik.
    const html = renderToStaticMarkup(await WebAnalyticsView(props({ role: 'staff' })))
    expect(revenueKem, 'staffnál sem indult el a bevétel-lekérdezés').toHaveBeenCalledTimes(1)
    expect(posthogKem, 'staffnál sem indult el a PostHog-lekérdezés').toHaveBeenCalledTimes(1)
    expect(html).toContain(WEB_ANALYTICS_DB_UNAVAILABLE_MESSAGE)
    expect(html).toContain('aria-label="Látogatók az elmúlt 7 napban"')
  })
})
