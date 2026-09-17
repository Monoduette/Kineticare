import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AdminViewServerProps } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { template, stepNav, revenue, engagement, bunnyPanel } = vi.hoisted(() => ({
  template: vi.fn(),
  stepNav: vi.fn(),
  revenue: vi.fn(),
  engagement: vi.fn(),
  bunnyPanel: vi.fn(),
}))

vi.mock('@payloadcms/next/templates', () => ({
  DefaultTemplate: (props: { children: ReactNode }) => {
    template(props)
    return createElement('div', { 'data-admin-template': true }, props.children)
  },
}))

vi.mock('@payloadcms/ui', () => ({
  SetStepNav: (props: unknown) => {
    stepNav(props)
    return null
  },
}))

vi.mock('../lib/statistics/query', () => ({ queryRevenueReport: revenue }))
vi.mock('../lib/statistics/engagement-query', () => ({ queryCourseEngagement: engagement }))
vi.mock('../lib/logger', () => ({ logger: { error: vi.fn() } }))
vi.mock('../lib/admin/web-analytics-config', () => ({
  EXTERNAL_ANALYTICS_LINKS: [{ label: 'PostHog', href: 'https://eu.posthog.com/' }],
  posthogEmbedUrl: () => 'https://eu.posthog.com/embedded/DUMMY_TEST_DASHBOARD',
}))
vi.mock('../components/admin/BunnyLibraryPanel', () => ({
  BunnyVideoLibrary: () => {
    bunnyPanel()
    return createElement('div', null, 'DUMMY_BUNNY_PANEL')
  },
}))

import { BunnyLibraryView } from '../components/admin/BunnyLibraryView'
import { StatisticsView } from '../components/admin/StatisticsView'
import { WebAnalyticsView } from '../components/admin/WebAnalyticsView'

const views = [
  { label: 'Videótár', render: BunnyLibraryView, queries: false },
  { label: 'Statisztika', render: StatisticsView, queries: true },
  { label: 'Webanalitika', render: WebAnalyticsView, queries: true },
]

function viewProps(role: string | null): AdminViewServerProps {
  const user = role === null ? null : { id: 1, collection: 'users', role }
  const payload = {}
  const i18n = {}
  // Payload 3.88.0 RootPage: user/permissions/locale csak az initPageResult alatt.
  return {
    payload,
    i18n,
    initPageResult: {
      req: { user, payload, i18n },
      locale: { code: 'hu', label: 'Magyar' },
      permissions: { canAccessAdmin: role === 'owner' || role === 'staff' },
      visibleEntities: { collections: ['pages'], globals: [] },
    },
    params: {},
    searchParams: {},
  } as unknown as AdminViewServerProps
}

beforeEach(() => {
  vi.clearAllMocks()
  revenue.mockResolvedValue({
    months: [],
    totals: { laikusHuf: 0, szakemberHuf: 0, totalHuf: 0, orderCount: 0 },
    courses: [],
    funnel: {
      created: 0,
      paymentPending: 0,
      paid: 0,
      paymentFailed: 0,
      cancelled: 0,
      refunded: 0,
      other: 0,
      total: 0,
    },
    truncated: false,
  })
  engagement.mockResolvedValue({ courses: [], truncated: false, skipped: 0, omitted: 0 })
})

describe.each(views)('$label: a Payload szerver-kontextus szerződése', (view) => {
  it.each(['owner', 'staff'])('%s a request user alapján hozzáfér', async (role) => {
    const props = viewProps(role)
    const html = renderToStaticMarkup(await view.render(props))

    expect(html).toContain('data-admin-template="true"')
    expect(html).not.toContain('csak munkatárs vagy tulajdonos')
    if (view.queries) {
      expect(revenue).toHaveBeenCalledWith({ payload: props.initPageResult.req.payload })
      expect(engagement).toHaveBeenCalledWith({ payload: props.initPageResult.req.payload })
    } else {
      expect(bunnyPanel).toHaveBeenCalledOnce()
    }
  })

  it('a requestet is továbbadja a sablonnak a mentett navigációs beállításokhoz', async () => {
    const props = viewProps('staff')
    renderToStaticMarkup(await view.render(props))

    expect(template).toHaveBeenCalledWith(
      expect.objectContaining({
        req: props.initPageResult.req,
        user: props.initPageResult.req.user,
        payload: props.payload,
        i18n: props.i18n,
        locale: props.initPageResult.locale,
        permissions: props.initPageResult.permissions,
        visibleEntities: props.initPageResult.visibleEntities,
      }),
    )
  })

  it('a saját címmel helyettesíti a korábbi nézet breadcrumbját', async () => {
    renderToStaticMarkup(await view.render(viewProps('staff')))
    expect(stepNav).toHaveBeenCalledWith({ nav: [{ label: view.label }] })
  })

  it.each([null, 'customer', 'unknown'])('%s nem kap védett tartalmat', async (role) => {
    const html = renderToStaticMarkup(await view.render(viewProps(role)))

    expect(revenue).not.toHaveBeenCalled()
    expect(engagement).not.toHaveBeenCalled()
    expect(bunnyPanel).not.toHaveBeenCalled()
    expect(html).toContain('csak munkatárs vagy tulajdonos')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('https://eu.posthog.com/')
    if (role === null) {
      expect(template).not.toHaveBeenCalled()
      expect(stepNav).not.toHaveBeenCalled()
    } else {
      expect(stepNav).toHaveBeenCalledWith({ nav: [{ label: view.label }] })
    }
  })

  it.each([null, 'customer'])(
    'a felső szintű user nem írja felül a request %s állapotát',
    async (role) => {
      const props = {
        ...viewProps(role),
        user: viewProps('owner').initPageResult.req.user,
      } as AdminViewServerProps
      const html = renderToStaticMarkup(await view.render(props))

      expect(html).toContain('csak munkatárs vagy tulajdonos')
      expect(revenue).not.toHaveBeenCalled()
      expect(engagement).not.toHaveBeenCalled()
      expect(bunnyPanel).not.toHaveBeenCalled()
      expect(html).not.toContain('<iframe')
    },
  )
})

it('bevételi hiba esetén is a Statisztika breadcrumbja jelenik meg', async () => {
  revenue.mockRejectedValue(new Error('DUMMY_QUERY_FAILURE'))
  renderToStaticMarkup(await StatisticsView(viewProps('owner')))
  expect(stepNav).toHaveBeenCalledWith({ nav: [{ label: 'Statisztika' }] })
})
