import { describe, expect, it } from 'vitest'

import {
  aamContribution,
  payloadAamFind,
  queryAamStatus,
  type AamOrderInput,
} from '../../lib/alerts/aam'

/**
 * PR #305, Devin 🔴: az AAM-keretből csak az a visszatérítés vonható le,
 * amelynek a SAJÁT helyesbítő számlája igazoltan kiállt. A rendelésen a
 * helyesbítő állapota egyetlen érték (a LEGUTÓBBI helyesbítő sorszáma és
 * száma), ezért csak a `correctiveInvoiceSeq` bejegyzése igazolt; a kiállítás
 * nem feltétlenül sorrendi (src/lib/szamlazz/corrective.ts). Az AAM adóhatár:
 * kétség esetén a használatot túlbecsüljük.
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
      'a legutóbbi helyesbítő függőben: a korábbi szám és sorszám nem igazol semmit',
      {
        ...BASE,
        refunds: TWO_PARTIALS,
        correctiveInvoiceStatus: 'pending',
        correctiveInvoiceSeq: 1,
        correctiveInvoiceNumber: 'E-KIN-2026-41',
      },
      100_000,
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
