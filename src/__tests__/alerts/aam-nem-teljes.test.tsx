import type { Where } from 'payload'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  BETOLTESI_HIBA_SZOVEG,
  FigyelmetIgenyel,
  NINCS_TEENDO_SZOVEG,
} from '../../components/admin/FigyelmetIgenyel'
import { resetAlertThrottle } from '../../lib/alert-throttle'
import { AAM_INCOMPLETE_ALERT_CODE } from '../../lib/alerts/aam'
import { logger } from '../../lib/logger'
import { createMemoryPayload } from './where-eval'

/**
 * PR #305, devin5 (a devin4 mindkét átnézője): egyetlen ismeretlen összegű
 * tárgyévi számla vagy a lapozási korlát (`AamIncompleteError`) eddig a teljes
 * Figyelmet igényel blokkot a betöltési hibára cserélte, így a teendők sem
 * látszottak. Most a teendők kirajzolódnak, és az AAM-sor helyén szám nélküli
 * „nem számolható” mondat áll: a hiányzó érték sem 0, sem „rendben”. Más hiba
 * (adatbázis) változatlanul a teljes betöltési hibát adja.
 *
 * A korábbi teszt minden `find`-ra teli oldalt adott, így a betöltési hibát
 * valójában a teendő-számolás saját lapozási korlátja okozta
 * (`AttentionIncompleteError`), nem az AAM: más okból ment át. Itt csak az
 * AAM-lekérdezés tér el, a teendők a memóriabeli Payloadból jönnek.
 */

const NOW = Date.parse('2026-09-24T08:00:00Z')
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()
const OWNER = { role: 'owner' as const }

/** Fizetett rendelés számla nélkül, öt órája: egy teendő. */
const TEENDO = {
  id: 1,
  status: 'paid',
  invoiceStatus: 'none',
  createdAt: minutesAgo(300),
  updatedAt: minutesAgo(300),
}

/** Tárgyévi kiállított számla, amelynek az összege egyik forrásból sem ismert. */
const OSSZEG_NELKUL = {
  id: 7,
  status: 'paid',
  invoiceStatus: 'issued',
  invoiceCompletionDate: '2026-03-01',
  totalHufSnapshot: null,
  createdAt: '2025-11-20T10:00:00.000Z',
  updatedAt: '2025-11-20T10:00:00.000Z',
}

/** A tulajdonosnak megjelenő mondat, szó szerint (nem a formázóból). */
const NEM_SZAMOLHATO_SOR =
  'Alanyi adómentes keret, 2026: most nem számolható, mennyi fogyott el belőle. Az okát és a teendőt az erről szóló riasztás-levélben találod (riasztáskód: aam-keret-nem-teljes).'

type AamLekerdezes = 'memoria' | 'teli-oldalak' | 'dob'

/**
 * Memóriabeli Payload; az AAM-lekérdezés (az egyetlen, amely a teljesítési
 * dátumot kéri) igény szerint teli oldalakat ad a lapozási korláton túl is,
 * vagy adatbázis-hibával dob. Minden más lekérdezés a memóriából jön.
 */
function payloadFor(orders: ReadonlyArray<Record<string, unknown>>, aam: AamLekerdezes) {
  const memory = createMemoryPayload({ orders, 'refund-intents': [], 'webhook-events': [] })
  const find = async (args: {
    collection: string
    where?: Where
    page?: number
    limit?: number
    select?: Readonly<Record<string, unknown>>
  }) => {
    if (args.collection === 'orders' && args.select?.invoiceCompletionDate === true) {
      if (aam === 'dob') {
        throw new Error('adatbázis nem érhető el')
      }
      if (aam === 'teli-oldalak') {
        return {
          docs: Array.from({ length: 500 }, () => ({
            invoiceStatus: 'issued',
            invoiceCompletionDate: '2026-03-01',
            totalHufSnapshot: 1,
          })),
          hasNextPage: true,
          totalDocs: 20_500,
        }
      }
    }
    return memory.payload.find(args)
  }
  return { ...memory.payload, find, config: { routes: { admin: '/admin' } } }
}

async function htmlje(elem: Promise<ReactNode> | ReactNode): Promise<string> {
  return renderToStaticMarkup(<>{await elem}</>)
}

afterEach(() => {
  resetAlertThrottle()
  vi.restoreAllMocks()
})

describe('FigyelmetIgenyel: a nem számolható AAM-keret nem viszi el a teendőket', () => {
  it.each<[string, ReadonlyArray<Record<string, unknown>>, AamLekerdezes]>([
    ['ismeretlen összegű tárgyévi számla', [TEENDO, OSSZEG_NELKUL], 'memoria'],
    ['a lapozási korlát után is van adat', [TEENDO], 'teli-oldalak'],
  ])(
    '%s: a teendők kirajzolódnak, az AAM-sor helyén szám nélküli „nem számolható” mondat áll',
    async (_eset, orders, aam) => {
      const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
      const html = await htmlje(
        FigyelmetIgenyel({
          payload: payloadFor(orders, aam) as never,
          user: OWNER,
          nowMs: NOW,
          vatMode: 'AAM',
        }),
      )

      expect(html).not.toContain(BETOLTESI_HIBA_SZOVEG)
      expect(html).toContain('class="kc-admin-notice kc-admin-notice--figyelem kc-figyelmet"')
      expect(html).toContain('1 ügy vár rád.')
      expect(html).toContain('>1 fizetett rendelés számla nélkül</a>')
      expect(html).toContain(
        `<p class="kc-admin-notice__szoveg" data-aam-szint="nem-szamolhato"><strong>${NEM_SZAMOLHATO_SOR}</strong></p>`,
      )
      // A hiányzó érték sem 0, sem valamelyik keret-szint.
      expect(html).not.toContain(' Ft a ')
      expect(html).not.toMatch(/data-aam-szint="(rendben|figyelem-70|figyelem-90|tullepve)"/)
      // Egyetlen hibanapló: az aam.ts riasztása; a blokk nem ír mellé betöltési hibát.
      expect(errorLog.mock.calls.map(([, context]) => context?.alertCode)).toEqual([
        AAM_INCOMPLETE_ALERT_CODE,
      ])
    },
  )

  it('teendő nélkül is figyelem-doboz: az ismeretlen keret-szint 70% fölött is lehet', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const html = await htmlje(
      FigyelmetIgenyel({
        payload: payloadFor([OSSZEG_NELKUL], 'memoria') as never,
        user: OWNER,
        nowMs: NOW,
        vatMode: 'AAM',
      }),
    )

    expect(html).toContain('class="kc-admin-notice kc-admin-notice--figyelem kc-figyelmet"')
    expect(html).toContain(NINCS_TEENDO_SZOVEG)
    expect(html).toContain(NEM_SZAMOLHATO_SOR)
  })

  it('más hiba az AAM-lekérdezésben (adatbázis): változatlanul a teljes betöltési hiba, számok és keret-sor nélkül', async () => {
    const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const html = await htmlje(
      FigyelmetIgenyel({
        payload: payloadFor([TEENDO], 'dob') as never,
        user: OWNER,
        nowMs: NOW,
        vatMode: 'AAM',
      }),
    )

    expect(html).toContain(BETOLTESI_HIBA_SZOVEG)
    expect(html).not.toContain('fizetett rendelés számla nélkül')
    expect(html).not.toContain('data-aam-szint')
    expect(errorLog).toHaveBeenCalledWith('a Figyelmet igényel blokk nem tölthető be', {
      error: 'adatbázis nem érhető el',
    })
  })
})
