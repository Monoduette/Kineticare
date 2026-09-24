import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AAM_INCOMPLETE_ALERT_CODE,
  AamIncompleteError,
  aamContribution,
  payloadAamFind,
  queryAamStatus,
  type AamFindFn,
  type AamOrderInput,
} from '../../lib/alerts/aam'
import { logger } from '../../lib/logger'

/**
 * PR #305, Devin 🔴: az AAM-keretből csak az a visszatérítés vonható le,
 * amelynek a SAJÁT helyesbítő számlája igazoltan kiállt. A rendelésen a
 * helyesbítő állapota egyetlen érték (a LEGUTÓBBI helyesbítő sorszáma és
 * száma), ezért csak a `correctiveInvoiceSeq` bejegyzése igazolt; a kiállítás
 * nem feltétlenül sorrendi (src/lib/szamlazz/corrective.ts). Codex P1: a
 * tárolt sorszám + szám pár egy későbbi függő vagy sikertelen helyesbítő
 * mellett is igazolja a saját bejegyzését (a pár csak kiállításkor íródik, és
 * semmi nem törli). Az AAM adóhatár: kétség esetén a használatot túlbecsüljük.
 *
 * Az egyetlen, igazolt részrefund esete az attention.test.ts
 * „alanyi adómentes keret” blokkjában van.
 */

const BASE: AamOrderInput = {
  invoiceStatus: 'issued',
  invoiceCompletionDate: '2026-03-01',
  totalHufSnapshot: 100_000,
}

const TWO_PARTIALS = [
  { type: 'partial', amountHuf: 10_000, refundedAt: '2026-03-05T09:00:00.000Z' },
  { type: 'partial', amountHuf: 20_000, refundedAt: '2026-03-06T09:00:00.000Z' },
]

describe('aamContribution: csak a saját helyesbítővel igazolt visszatérítés vonódik le', () => {
  it.each<[string, AamOrderInput, number]>([
    [
      'Devin-példa: az 1. refund helyesbítője kiállt, a 2.-é nem → csak a 10 000 Ft vonódik le',
      {
        ...BASE,
        refunds: TWO_PARTIALS,
        correctiveInvoiceStatus: 'issued',
        correctiveInvoiceSeq: 1,
        correctiveInvoiceNumber: 'E-KIN-2026-41',
      },
      90_000,
    ],
    [
      'sorrenden kívül: a 2. helyesbítője kiállt, az 1.-é nem igazolt → csak a 20 000 Ft vonódik le',
      {
        ...BASE,
        refunds: TWO_PARTIALS,
        correctiveInvoiceStatus: 'issued',
        correctiveInvoiceSeq: 2,
        correctiveInvoiceNumber: 'E-KIN-2026-42',
      },
      80_000,
    ],
    [
      'Codex P1: az 1. helyesbítője kiállt, a 2.-é függő → az 1. levonva marad, a 2. nem',
      {
        ...BASE,
        refunds: TWO_PARTIALS,
        correctiveInvoiceStatus: 'pending',
        correctiveInvoiceSeq: 1,
        correctiveInvoiceNumber: 'E-KIN-2026-41',
      },
      90_000,
    ],
    [
      'Codex P1: az 1. helyesbítője kiállt, a 2.-é sikertelen → az 1. levonva marad, a 2. nem',
      {
        ...BASE,
        refunds: TWO_PARTIALS,
        correctiveInvoiceStatus: 'failed',
        correctiveInvoiceSeq: 1,
        correctiveInvoiceNumber: 'E-KIN-2026-41',
      },
      90_000,
    ],
    [
      'szám nélkül (például munkatársi olvasásnál a tulajdonosi mező hiányzik) nincs levonás',
      {
        ...BASE,
        refunds: TWO_PARTIALS,
        correctiveInvoiceStatus: 'issued',
        correctiveInvoiceSeq: 1,
      },
      100_000,
    ],
    [
      'a sorszám a refund-nyomon túlmutat → nincs levonás',
      {
        ...BASE,
        refunds: TWO_PARTIALS,
        correctiveInvoiceStatus: 'issued',
        correctiveInvoiceSeq: 3,
        correctiveInvoiceNumber: 'E-KIN-2026-43',
      },
      100_000,
    ],
    [
      'a rendelést lezáró, nem első teljes bejegyzés is helyesbítőt kap → az is levonható',
      {
        ...BASE,
        refunds: [
          { type: 'partial', amountHuf: 10_000, refundedAt: '2026-03-05T09:00:00.000Z' },
          { type: 'full', amountHuf: 90_000, refundedAt: '2026-03-06T09:00:00.000Z' },
        ],
        correctiveInvoiceStatus: 'issued',
        correctiveInvoiceSeq: 2,
        correctiveInvoiceNumber: 'E-KIN-2026-44',
      },
      10_000,
    ],
    [
      'az első, teljes visszatérítés stornót kap, nem helyesbítőt → a pár nem vonja le',
      {
        ...BASE,
        refunds: [{ type: 'full', amountHuf: 100_000, refundedAt: '2026-03-05T09:00:00.000Z' }],
        correctiveInvoiceStatus: 'issued',
        correctiveInvoiceSeq: 1,
        correctiveInvoiceNumber: 'E-KIN-2026-45',
      },
      100_000,
    ],
    [
      'stornó mellett a levonható helyesbítő sem számít: a rendelés 0',
      {
        ...BASE,
        refunds: TWO_PARTIALS,
        stornoStatus: 'storned',
        correctiveInvoiceStatus: 'issued',
        correctiveInvoiceSeq: 1,
        correctiveInvoiceNumber: 'E-KIN-2026-41',
      },
      0,
    ],
  ])('%s', (_name, order, expected) => {
    expect(aamContribution(order, 2026)).toBe(expected)
  })
})

describe('queryAamStatus: a levonáshoz szükséges mezők a lekérdezésből is megjönnek', () => {
  it('a select a helyesbítő sorszámát és számát is kéri, így az igazolt refund levonódik', async () => {
    const stored: Record<string, unknown> = {
      ...BASE,
      createdAt: '2026-03-01T10:00:00.000Z',
      refunds: TWO_PARTIALS,
      correctiveInvoiceStatus: 'issued',
      correctiveInvoiceSeq: 1,
      correctiveInvoiceNumber: 'E-KIN-2026-41',
    }
    // A Payload `select`-szerződése: csak a kért mezők jönnek vissza.
    const payload = {
      find: async (args: { select?: Record<string, unknown> }) => ({
        docs: [
          Object.fromEntries(
            Object.entries(stored).filter(([field]) => args.select?.[field] === true),
          ),
        ],
        hasNextPage: false,
      }),
    }
    const status = await queryAamStatus(
      payloadAamFind(payload as never, { overrideAccess: true }),
      Date.parse('2026-09-24T08:00:00Z'),
    )
    expect(status.netHuf).toBe(90_000)
  })
})

describe('queryAamStatus: részösszegből nem lesz éves összeg (Codex P1, lapozási korlát)', () => {
  const NOW = Date.parse('2026-09-24T08:00:00Z')
  const fullPage = (): AamOrderInput[] =>
    Array.from({ length: 500 }, () => ({
      invoiceStatus: 'issued',
      invoiceCompletionDate: '2026-03-01',
      totalHufSnapshot: 1,
    }))

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('a korlát után is van még adat → RIASZTÁS és hiba, nem keret-szint', async () => {
    const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    let calls = 0
    const find: AamFindFn = async () => {
      calls += 1
      return { docs: fullPage(), hasNextPage: true }
    }

    await expect(queryAamStatus(find, NOW)).rejects.toBeInstanceOf(AamIncompleteError)
    expect(calls).toBe(40)
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringMatching(/^RIASZTÁS: az alanyi adómentes keret/),
      expect.objectContaining({ alertCode: AAM_INCOMPLETE_ALERT_CODE, year: 2026 }),
    )
  })

  it('a korlát utolsó oldala zárja a listát → teljes összeg, riasztás nélkül', async () => {
    const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const find: AamFindFn = async ({ page }) => ({ docs: fullPage(), hasNextPage: page < 40 })

    const status = await queryAamStatus(find, NOW)
    expect(status.netHuf).toBe(20_000)
    expect(errorLog).not.toHaveBeenCalled()
  })
})
