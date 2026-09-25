import { parse } from 'qs-esm'
import { describe, expect, it } from 'vitest'

import {
  aamContribution,
  aamLimitForYear,
  computeAamStatus,
  formatAamLine,
  payloadAamFind,
  queryAamStatus,
} from '../../lib/alerts/aam'
import {
  attentionDefinitions,
  attentionListHref,
  attentionTotal,
  payloadAttentionSources,
  resolveAttention,
} from '../../lib/alerts/attention'
import { MAX_WEBHOOK_ATTEMPTS } from '../../lib/idempotency'
import {
  isRefundIntentUnresolved,
  NO_PROVIDER_REQUEST_REFERENCE,
  REFUND_INTENT_STATES,
} from '../../lib/refund/refund-intent'
import { createMemoryPayload, matchesWhere } from './where-eval'

/**
 * „Figyelmet igényel": a küszöbök (2 óra, 1 óra, 24 óra, 15 perc, 14 napos
 * visszatekintés) memóriabeli adaton, a Payload-where kiértékelésével; és az
 * alanyi adómentes keret becslése.
 */

const NOW = Date.parse('2026-09-24T08:00:00Z')
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()
const daysAgo = (days: number) => minutesAgo(days * 24 * 60)

const orders = [
  // fizetett, 3 órája, számla nélkül → számít
  {
    id: 1,
    status: 'paid',
    invoiceStatus: 'none',
    createdAt: minutesAgo(180),
    updatedAt: minutesAgo(180),
  },
  // fizetett, 1 órája → még nem számít (2 órás türelem)
  {
    id: 2,
    status: 'paid',
    invoiceStatus: 'pending',
    createdAt: minutesAgo(60),
    updatedAt: minutesAgo(60),
  },
  // kiállított számla → nem számít
  { id: 3, status: 'paid', invoiceStatus: 'issued', createdAt: daysAgo(3), updatedAt: daysAgo(3) },
  // függő, 90 perce → függő fizetés
  { id: 4, status: 'payment_pending', createdAt: minutesAgo(90), updatedAt: minutesAgo(5) },
  // függő, 2 napja (GetState hibázik) → függő és 24 órán túli
  { id: 5, status: 'payment_pending', createdAt: daysAgo(2), updatedAt: minutesAgo(5) },
  // függő, 20 perce → nem számít
  { id: 6, status: 'payment_pending', createdAt: minutesAgo(20), updatedAt: minutesAgo(20) },
  // sikertelen számla friss → bizonylathiba
  { id: 7, status: 'paid', invoiceStatus: 'failed', createdAt: daysAgo(1), updatedAt: daysAgo(1) },
  // sikertelen stornó régen (20 nap) → kívül esik a 14 napos ablakon
  {
    id: 8,
    status: 'refunded',
    invoiceStatus: 'issued',
    stornoStatus: 'failed',
    createdAt: daysAgo(30),
    updatedAt: daysAgo(20),
  },
  // sikertelen helyesbítő friss → bizonylathiba
  {
    id: 9,
    status: 'paid',
    invoiceStatus: 'issued',
    correctiveInvoiceStatus: 'failed',
    createdAt: daysAgo(5),
    updatedAt: daysAgo(2),
  },
]

const refundIntents = [
  { id: 1, state: 'provider_unknown', createdAt: minutesAgo(30), updatedAt: minutesAgo(30) },
  { id: 2, state: 'provider_started', createdAt: minutesAgo(5), updatedAt: minutesAgo(5) },
  { id: 3, state: 'committed', createdAt: daysAgo(1), updatedAt: daysAgo(1) },
  { id: 4, state: 'manual_review', createdAt: daysAgo(3), updatedAt: daysAgo(3) },
]

const webhookEvents = [
  { id: 1, status: 'failed', attempts: 1, createdAt: minutesAgo(10), updatedAt: minutesAgo(10) },
  {
    id: 2,
    status: 'received',
    attempts: MAX_WEBHOOK_ATTEMPTS,
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
  },
  { id: 3, status: 'processed', attempts: 1, createdAt: daysAgo(1), updatedAt: daysAgo(1) },
  { id: 4, status: 'received', attempts: 2, createdAt: minutesAgo(1), updatedAt: minutesAgo(1) },
]

/** A valódi Payload-adapteren át, memóriabeli gyűjteményekkel. */
function resolveOn(collections: Parameters<typeof createMemoryPayload>[0]) {
  const { payload } = createMemoryPayload(collections)
  return resolveAttention(payloadAttentionSources(payload as never, { overrideAccess: true }), NOW)
}

describe('resolveAttention', () => {
  it('a küszöbök szerint számol, a részhalmaz nem adódik hozzá kétszer', async () => {
    const { counts } = await resolveOn({
      orders,
      'refund-intents': refundIntents,
      'webhook-events': webhookEvents,
    })
    expect(counts).toEqual({
      fizetettSzamlaNelkul: 1,
      fuggoFizetes: 2,
      fuggoFizetesRegi: 1,
      bizonylatHiba: 2,
      visszateritesElakadt: 2,
      webhookHiba: 2,
    })
    expect(attentionTotal(counts)).toBe(9)
  })
})

/**
 * Codex P1 (PR #305, attention.ts:53): a Barion-siker rögzítve, de a helyi
 * lezárás elmaradt (`provider_succeeded`), az is elakadt visszatérítés. Az
 * elvárt értéket a refund-állapotgép saját definíciója adja
 * (`isRefundIntentUnresolved`, a tárolt `provider_failed` sor mindig
 * hatás nélküli bizonyítékkal él), nem a tesztelt lista.
 */
describe('elakadt visszatérítés: minden feloldatlan állapot', () => {
  const storedEvidence = {
    kind: 'provider_confirmed_no_effect' as const,
    confirmedAt: minutesAgo(40),
    reference: NO_PROVIDER_REQUEST_REFERENCE,
  }
  it.each(REFUND_INTENT_STATES.map((state) => [state] as const))(
    '%s állapotú, 30 perce indult szándék pontosan akkor számít, ha az állapotgép szerint feloldatlan',
    async (state) => {
      const expected = isRefundIntentUnresolved(
        state,
        state === 'provider_failed' ? storedEvidence : undefined,
      )
        ? 1
        : 0
      const { counts } = await resolveOn({
        orders: [],
        'refund-intents': [{ id: 1, state, createdAt: minutesAgo(30), updatedAt: minutesAgo(20) }],
        'webhook-events': [],
      })
      expect(counts.visszateritesElakadt).toBe(expected)
    },
  )
})

/**
 * Codex P1 (PR #305, attention.ts:156): a helyesbítő hiánya visszatérítésenként
 * dől el. Ha az 1. részrefund helyesbítője elbukott, és a 2.-é később kiállt,
 * a rendelés `correctiveInvoiceStatus`-a `issued` lesz, de az 1. bizonylat
 * továbbra is hiányzik. Bizonyíték sorszámonként: a tárolt (seq, szám) pár
 * (csak a `refunds[seq - 1]`-et igazolja), vagy az adott sorszámú lezárt
 * (`committed`) visszatérítési szándék.
 */
describe('hiányzó helyesbítő visszatérítésenként', () => {
  const partial = (amountHuf: number, refundedAt: string) => ({
    type: 'partial',
    amountHuf,
    refundedAt,
  })
  const twoPartials = {
    status: 'paid',
    invoiceStatus: 'issued',
    correctiveInvoiceStatus: 'issued',
    correctiveInvoiceSeq: 2,
    correctiveInvoiceNumber: 'E-KIN-2026-52',
    refunds: [partial(10_000, daysAgo(2)), partial(5_000, daysAgo(1))],
    createdAt: daysAgo(5),
    updatedAt: daysAgo(1),
  }

  it('a korábbi, bizonyíték nélküli helyesbítő számít, és a link pontosan azt a rendelést adja', async () => {
    const { counts, definitions } = await resolveOn({
      orders: [{ id: 21, ...twoPartials }],
      'refund-intents': [],
      'webhook-events': [],
    })
    expect(counts.bizonylatHiba).toBe(1)
    const definition = definitions.find((item) => item.key === 'bizonylatHiba')
    const listed = [{ id: 21, ...twoPartials }, ...orders].filter((order) =>
      matchesWhere(order, definition?.where ?? {}),
    )
    expect(listed.map((order) => order.id)).toEqual([21, 7, 9])
  })

  it.each([
    [
      'az 1. sorszámhoz lezárt szándék tartozik',
      { id: 22, ...twoPartials },
      [{ id: 5, order: 22, state: 'committed', refundSequence: 1 }],
    ],
    [
      'egyetlen részrefund, a pár a saját sorszámára szól',
      {
        id: 23,
        ...twoPartials,
        correctiveInvoiceSeq: 1,
        refunds: [partial(10_000, daysAgo(1))],
      },
      [],
    ],
    [
      'a helyesbítő még fut (két óránál frissebb visszatérítés, függő állapot)',
      {
        id: 24,
        ...twoPartials,
        correctiveInvoiceStatus: 'pending',
        correctiveInvoiceSeq: 1,
        refunds: [partial(10_000, daysAgo(2)), partial(5_000, minutesAgo(30))],
      },
      [],
    ],
  ])('nem számít, ha %s', async (_name, order, intents) => {
    const { counts } = await resolveOn({
      orders: [order],
      'refund-intents': intents.map((intent) => ({
        ...intent,
        createdAt: daysAgo(2),
        updatedAt: daysAgo(2),
      })),
      'webhook-events': [],
    })
    expect(counts.bizonylatHiba).toBe(0)
  })
})

describe('attentionListHref', () => {
  it('a szűrt admin-lista címe a Payload qs-formátumában visszaolvasható, ugyanazt a feltételt adja', () => {
    for (const definition of attentionDefinitions(NOW, { missingCorrectiveOrderIds: [21, 34] })) {
      const href = attentionListHref('/admin', definition.collection, definition.where)
      expect(href.startsWith(`/admin/collections/${definition.collection}?`)).toBe(true)
      // Ugyanúgy olvassuk vissza, mint a Payload admin RootPage-e
      // (@payloadcms/next/dist/views/Root/index.js: qs.parse, depth: 10).
      const parsed = parse(href.slice(href.indexOf('?') + 1), { depth: 10 }) as { where: unknown }
      // A qs a számokat szövegként adja vissza; a szerkezet és az értékek
      // (szövegként) egyeznek.
      expect(JSON.parse(JSON.stringify(parsed.where))).toEqual(
        JSON.parse(
          JSON.stringify(definition.where, (_key, value: unknown) =>
            typeof value === 'number' ? String(value) : value,
          ),
        ),
      )
    }
  })

  it('a link feltétele ugyanazokat a sorokat választja ki, mint a számláló', () => {
    const definition = attentionDefinitions(NOW).find((item) => item.key === 'bizonylatHiba')
    expect(definition).toBeDefined()
    const matched = orders.filter((order) => matchesWhere(order, definition?.where ?? {}))
    expect(matched.map((order) => order.id)).toEqual([7, 9])
  })
})

describe('alanyi adómentes keret', () => {
  it('a tárgyév kiállított számláit számolja; stornó 0, helyesbítővel lezárt részrefund levonva', () => {
    expect(
      aamContribution(
        { invoiceStatus: 'issued', invoiceCompletionDate: '2026-03-01', totalHufSnapshot: 79_500 },
        2026,
      ),
    ).toBe(79_500)
    expect(
      aamContribution(
        { invoiceStatus: 'issued', invoiceCompletionDate: '2025-12-31', totalHufSnapshot: 79_500 },
        2026,
      ),
    ).toBe(0)
    expect(
      aamContribution(
        { invoiceStatus: 'failed', invoiceCompletionDate: '2026-03-01', totalHufSnapshot: 79_500 },
        2026,
      ),
    ).toBe(0)
    expect(
      aamContribution(
        {
          invoiceStatus: 'issued',
          invoiceCompletionDate: '2026-03-01',
          totalHufSnapshot: 79_500,
          stornoStatus: 'storned',
        },
        2026,
      ),
    ).toBe(0)
    const partial = {
      invoiceStatus: 'issued',
      invoiceCompletionDate: '2026-03-01',
      totalHufSnapshot: 79_500,
      refunds: [{ type: 'partial', amountHuf: 20_000 }],
    }
    // Helyesbítő nélkül a levonás nem érvényes (Áfa tv. 153/B. §): a teljes összeg számít.
    expect(aamContribution(partial, 2026)).toBe(79_500)
    // A levonáshoz a refund SAJÁT helyesbítője kell: állapot, sorszám és szám
    // (a több részrefundos esetek: aam.test.ts).
    expect(
      aamContribution(
        {
          ...partial,
          correctiveInvoiceStatus: 'issued',
          correctiveInvoiceSeq: 1,
          correctiveInvoiceNumber: 'E-KIN-2026-41',
        },
        2026,
      ),
    ).toBe(59_500)
  })

  it('70, 90 és 100% fölött jelez; a 2026-os keret 20 millió, a 2027-es 22 millió', () => {
    expect(aamLimitForYear(2026)).toEqual({ limitHuf: 20_000_000, verified: true })
    expect(aamLimitForYear(2027)).toEqual({ limitHuf: 22_000_000, verified: true })
    expect(aamLimitForYear(2028)).toEqual({ limitHuf: 22_000_000, verified: false })
    const order = (total: number) => ({
      invoiceStatus: 'issued',
      invoiceCompletionDate: '2026-05-05',
      totalHufSnapshot: total,
    })
    expect(computeAamStatus([order(13_000_000)], 2026).level).toBe('rendben')
    expect(computeAamStatus([order(14_000_000)], 2026).level).toBe('figyelem-70')
    expect(computeAamStatus([order(18_000_000)], 2026).level).toBe('figyelem-90')
    expect(computeAamStatus([order(20_000_000)], 2026).level).toBe('tullepve')
    expect(formatAamLine(computeAamStatus([order(3_180_000)], 2026))).toBe(
      '2026: 3 180 000 Ft a 20 000 000 Ft-os keretből (15%)',
    )
  })

  it('a lekérdezés a tárgyévre szűr és lapoz', async () => {
    const { payload, findCalls } = createMemoryPayload({
      orders: [
        {
          id: 1,
          invoiceStatus: 'issued',
          invoiceCompletionDate: '2026-01-02',
          totalHufSnapshot: 100,
          createdAt: '2026-01-02T10:00:00.000Z',
        },
        {
          id: 2,
          invoiceStatus: 'issued',
          invoiceCompletionDate: '2025-06-02',
          totalHufSnapshot: 900,
          createdAt: '2025-06-02T10:00:00.000Z',
        },
        {
          id: 3,
          invoiceStatus: 'pending',
          totalHufSnapshot: 500,
          createdAt: '2026-02-02T10:00:00.000Z',
        },
      ],
    })
    const status = await queryAamStatus(
      payloadAamFind(payload as never, { overrideAccess: true }),
      NOW,
    )
    expect(status.netHuf).toBe(100)
    expect(findCalls[0]).toMatchObject({ collection: 'orders', overrideAccess: true })
  })
})
