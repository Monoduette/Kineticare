import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BETOLTESI_HIBA_SZOVEG,
  FigyelmetIgenyel,
  NINCS_TEENDO_SZOVEG,
} from '../../components/admin/FigyelmetIgenyel'
import {
  GYAKORI_TEENDOK,
  GyakoriTeendok,
  type GyakoriTeendo,
} from '../../components/admin/GyakoriTeendok'
import { createMemoryPayload, orderIdsOpenedByHref } from './where-eval'

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
  vi.unstubAllEnvs()
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
    const { payload, countCalls, findCalls } = payloadWith({
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
    // A helyesbítő-bizonyíték (refunds, helyesbítő száma) tulajdonosi
    // olvasású mező: a keresés is a tulajdonos jogaival fut.
    expect(
      findCalls.some(
        (call) =>
          call.collection === 'orders' &&
          (call.select as Record<string, unknown> | undefined)?.refunds === true,
      ),
    ).toBe(true)
    for (const call of [...countCalls, ...findCalls]) {
      expect(call).toMatchObject({ overrideAccess: false, user: OWNER })
    }
  })

  it('a csak hiányzó helyesbítő miatt számolt rendelést a linkje meg is nyitja', async () => {
    // Az 1. részrefund helyesbítőjének nincs bizonyítéka, a pár a 2.-at igazolja.
    const order = {
      id: 21,
      status: 'paid',
      invoiceStatus: 'issued',
      correctiveInvoiceStatus: 'issued',
      correctiveInvoiceSeq: 2,
      correctiveInvoiceNumber: 'E-KIN-2026-52',
      refunds: [
        { type: 'partial', amountHuf: 10_000, refundedAt: minutesAgo(2 * 24 * 60) },
        { type: 'partial', amountHuf: 5_000, refundedAt: minutesAgo(24 * 60) },
      ],
      createdAt: minutesAgo(5 * 24 * 60),
      updatedAt: minutesAgo(24 * 60),
    }
    const { payload } = payloadWith({
      orders: [order],
      'refund-intents': [],
      'webhook-events': [],
    })
    const html = await htmlje(
      FigyelmetIgenyel({ payload: payload as never, user: OWNER, nowMs: NOW, vatMode: '27' }),
    )
    expect(html).toContain('>1 sikertelen számla, stornó vagy helyesbítő</a>')
    const hrefs = [...html.matchAll(/href="([^"]*collections\/orders[^"]*)"/g)].map((match) =>
      (match[1] ?? '').replaceAll('&amp;', '&'),
    )
    expect(hrefs.flatMap((href) => orderIdsOpenedByHref(href, [order]))).toEqual([21])
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

  it('hiányzó áfakulcsnál (kikapcsolt számlázás) nincs AAM-sor és AAM-lekérdezés sem', async () => {
    // Codex P2 (PR #305): a becslés csak a normalizált `AAM` mellett fut
    // (aamEstimateApplies); a prop hiányában a blokk a környezetből olvas.
    vi.stubEnv('SZAMLAZZ_AFAKULCS', undefined)
    const { payload, findCalls } = payloadWith({
      orders: [
        {
          id: 31,
          status: 'paid',
          invoiceStatus: 'issued',
          invoiceCompletionDate: '2026-04-01',
          totalHufSnapshot: 14_500_000,
          createdAt: '2026-04-01T10:00:00.000Z',
          updatedAt: '2026-04-01T10:00:00.000Z',
        },
      ],
      'refund-intents': [],
      'webhook-events': [],
    })
    const html = await htmlje(
      FigyelmetIgenyel({ payload: payload as never, user: OWNER, nowMs: NOW }),
    )
    expect(html).toContain(NINCS_TEENDO_SZOVEG)
    expect(html).not.toContain('Alanyi adómentes')
    expect(
      findCalls.some(
        (call) =>
          (call.select as Record<string, unknown> | undefined)?.invoiceCompletionDate === true,
      ),
    ).toBe(false)
  })

  it.each(['AAM', ' AAM\n'])(
    'éles út: a Gyakori teendők panel (vatMode nélkül) SZAMLAZZ_AFAKULCS=%j mellett megmutatja az AAM-sort',
    async (env) => {
      // Az Irányítópult nem ad át vatMode-ot: a blokk a környezetből olvas.
      // Ha ez a visszaesés elveszne, a tulajdonos 70/90%-os keret-figyelmeztetése
      // némán eltűnne élesben.
      vi.stubEnv('SZAMLAZZ_AFAKULCS', env)
      const { payload } = payloadWith({
        orders: [
          {
            id: 31,
            status: 'paid',
            invoiceStatus: 'issued',
            invoiceCompletionDate: '2026-04-01',
            totalHufSnapshot: 14_500_000,
            createdAt: '2026-04-01T10:00:00.000Z',
            updatedAt: '2026-04-01T10:00:00.000Z',
          },
        ],
        'refund-intents': [],
        'webhook-events': [],
      })
      const html = await htmlje(
        GyakoriTeendok({ payload: payload as never, permissions: {}, user: OWNER }),
      )
      expect(html).toContain('Alanyi adómentes keret, 2026:')
      expect(html).toContain('(72%)')
    },
  )

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

  it('a tulajdonos kártyák nélkül is látja a Figyelmet igényel blokkot', async () => {
    // Devin (PR #305, GyakoriTeendok.tsx): a panel a kártyák hiányában a
    // tulajdonosi blokk előtt tért vissza null-lal. Ma a Statisztika kártya
    // gyűjtemény-jog nélkül is látszik, ezért a kártyalistát a teszt idejére
    // kiürítjük: ez az az állapot, amikor egyetlen kártya sem látható.
    const kartyak = GYAKORI_TEENDOK as GyakoriTeendo[]
    const mentes = kartyak.splice(0, kartyak.length)
    try {
      const { payload } = payloadWith({
        orders: [
          {
            id: 1,
            status: 'paid',
            invoiceStatus: 'none',
            createdAt: minutesAgo(300),
            updatedAt: minutesAgo(300),
          },
        ],
        'refund-intents': [],
        'webhook-events': [],
      })
      const html = await htmlje(
        GyakoriTeendok({ payload: payload as never, permissions: {}, user: OWNER }),
      )
      expect(html).toContain('id="kc-figyelmet-cim"')
      expect(html).toContain('>1 fizetett rendelés számla nélkül</a>')
      expect(html).not.toContain('id="kc-gyakori-teendok-cim"')
    } finally {
      kartyak.push(...mentes)
    }
  })
})
