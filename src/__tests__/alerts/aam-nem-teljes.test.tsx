import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BETOLTESI_HIBA_SZOVEG, FigyelmetIgenyel } from '../../components/admin/FigyelmetIgenyel'
import { logger } from '../../lib/logger'

/**
 * Codex P1 (aam.ts, lapozási korlát): ha a tárgyév számlás rendelései nem
 * olvashatók be teljesen, a tulajdonos NEM láthat keret-sort a részösszegből.
 * A gazda-szintű szerződést az aam.test.ts `queryAamStatus` blokkja őrzi; ez a
 * teszt a külön kockázatot fedi: a Figyelmet igényel blokk a hibát nem nyelheti
 * le úgy, hogy helyette „rendben” szintű keret-sort rajzol.
 */

const NOW = Date.parse('2026-09-24T08:00:00Z')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('FigyelmetIgenyel: nem teljes AAM-adatnál nincs keret-sor', () => {
  it('a lapozási korlát után is van adat → betöltési hiba, keret-szint nélkül', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const payload = {
      count: async () => ({ totalDocs: 0 }),
      find: async () => ({
        docs: Array.from({ length: 500 }, () => ({
          invoiceStatus: 'issued',
          invoiceCompletionDate: '2026-03-01',
          totalHufSnapshot: 1,
        })),
        hasNextPage: true,
      }),
      config: { routes: { admin: '/admin' } },
    }

    const html = renderToStaticMarkup(
      <>
        {await FigyelmetIgenyel({
          payload: payload as never,
          user: { role: 'owner' },
          nowMs: NOW,
          vatMode: 'AAM',
        })}
      </>,
    )

    expect(html).toContain(BETOLTESI_HIBA_SZOVEG)
    expect(html).not.toContain('Alanyi adómentes keret')
    expect(html).not.toContain('data-aam-szint')
  })
})
