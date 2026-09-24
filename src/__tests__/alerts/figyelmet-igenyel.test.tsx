import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BETOLTESI_HIBA_SZOVEG,
  FigyelmetIgenyel,
  NINCS_TEENDO_SZOVEG,
} from '../../components/admin/FigyelmetIgenyel'
import { GyakoriTeendok } from '../../components/admin/GyakoriTeendok'
import { createMemoryPayload } from './where-eval'

/**
 * A tulajdonosi „Figyelmet igényel" blokk: csak tulajdonosnak, a napi
 * összesítővel azonos számokkal, a szűrt listára mutató linkekkel, a mért
 * .kc-admin-notice szerződéssel. Adatbázis nélkül, memóriabeli where-kiértékelővel.
 */

const NOW = Date.parse('2026-09-24T08:00:00Z')
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()
const OWNER = { role: 'owner' as const }

async function htmlje(elem: Promise<ReactNode> | ReactNode): Promise<string> {
  return renderToStaticMarkup(<>{await elem}</>)
}

function payloadWith(collections: Parameters<typeof createMemoryPayload>[0]) {
  const memory = createMemoryPayload(collections)
  return {
    ...memory,
    payload: { ...memory.payload, config: { routes: { admin: '/admin' }, collections: [] } },
  }
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('FigyelmetIgenyel', () => {
  it('nem tulajdonosnak nem jelenik meg, és nem is kérdez le', async () => {
    const { payload, countCalls } = payloadWith({ orders: [] })
    expect(
      await htmlje(
        FigyelmetIgenyel({ payload: payload as never, user: { role: 'staff' }, nowMs: NOW }),
      ),
    ).toBe('')
    expect(countCalls).toHaveLength(0)
  })

  it('teendőnél figyelem-doboz, számmal kezdődő linkek a szűrt listára, a tulajdonos jogaival', async () => {
    const { payload, countCalls } = payloadWith({
      orders: [
        {
          id: 1,
          status: 'paid',
          invoiceStatus: 'none',
          createdAt: minutesAgo(300),
          updatedAt: minutesAgo(300),
        },
        {
          id: 2,
          status: 'payment_pending',
          createdAt: minutesAgo(26 * 60),
          updatedAt: minutesAgo(5),
        },
        { id: 3, status: 'payment_pending', createdAt: minutesAgo(90), updatedAt: minutesAgo(5) },
      ],
      'refund-intents': [],
      'webhook-events': [],
    })
    const html = await htmlje(
      FigyelmetIgenyel({ payload: payload as never, user: OWNER, nowMs: NOW, vatMode: 'AAM' }),
    )

    expect(html).toContain('class="kc-admin-notice kc-admin-notice--figyelem kc-figyelmet"')
    expect(html).toContain(
      '<h2 class="kc-admin-notice__cim kc-figyelmet__cim" id="kc-figyelmet-cim">Figyelmet igényel</h2>',
    )
    expect(html).toContain('3 ügy vár rád.')
    expect(html).toContain('>1 fizetett rendelés számla nélkül</a>')
    expect(html).toContain('>2 függő fizetés egy óránál régebben</a> (ebből 1 egy napnál régebbi)')
    expect(html).toContain('href="/admin/collections/orders?where%5Bor%5D%5B0%5D%5Band%5D')
    expect(html).toContain('aria-describedby="kc-figyelmet-fizetettSzamlaNelkul"')
    // A nulla kategória nem jelenik meg.
    expect(html).not.toContain('visszatérítés</a>')
    // AAM-sor: nincs számla, 0%.
    expect(html).toContain('Alanyi adómentes keret, 2026: 0 Ft a 20')
    for (const call of countCalls) {
      expect(call).toMatchObject({ overrideAccess: false, user: OWNER })
    }
  })

  it('nincs teendő → csendes tájékoztató sor, figyelem-szín nélkül', async () => {
    const { payload } = payloadWith({ orders: [], 'refund-intents': [], 'webhook-events': [] })
    const html = await htmlje(
      FigyelmetIgenyel({ payload: payload as never, user: OWNER, nowMs: NOW, vatMode: '27' }),
    )
    expect(html).toContain('class="kc-admin-notice kc-figyelmet"')
    expect(html).toContain(NINCS_TEENDO_SZOVEG)
    expect(html).not.toContain('Alanyi adómentes')
  })

  it('a lekérdezés hibájánál magyar magyarázat áll, az oldal nem dől el', async () => {
    const payload = {
      count: async () => {
        throw new Error('adatbázis nem érhető el')
      },
      find: async () => ({ docs: [] }),
      config: { routes: { admin: '/admin' } },
    }
    const html = await htmlje(
      FigyelmetIgenyel({ payload: payload as never, user: OWNER, nowMs: NOW }),
    )
    expect(html).toContain(BETOLTESI_HIBA_SZOVEG)
  })

  it('a Gyakori teendők panelen a tulajdonosnak a kártyák ELŐTT áll', async () => {
    const { payload } = payloadWith({ orders: [], 'refund-intents': [], 'webhook-events': [] })
    const html = await htmlje(
      GyakoriTeendok({
        payload: {
          ...payload,
          find: async () => ({ docs: [], hasNextPage: false, totalDocs: 0 }),
        } as never,
        permissions: { collections: { pages: { read: true } } },
        user: OWNER,
      }),
    )
    const figyelmet = html.indexOf('id="kc-figyelmet-cim"')
    const gyakori = html.indexOf('id="kc-gyakori-teendok-cim"')
    expect(figyelmet).toBeGreaterThan(-1)
    expect(figyelmet).toBeLessThan(gyakori)
  })
})
