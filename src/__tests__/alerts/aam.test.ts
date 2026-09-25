import { afterEach, describe, expect, it, vi } from 'vitest'

import { resetAlertThrottle } from '../../lib/alert-throttle'
import {
  AAM_INCOMPLETE_ALERT_CODE,
  AamIncompleteError,
  aamContribution,
  payloadAamFind,
  queryAamStatus,
  type AamFindFn,
  type AamIntentFindFn,
  type AamOrderInput,
  type AamSources,
} from '../../lib/alerts/aam'
import { createAlertSink, MAX_ALERT_MAILS_PER_HOUR } from '../../lib/alerts/sink'
import type { SendMailInput } from '../../lib/email'
import type { SendResult } from '../../lib/email/types'
import { createLogger, logger, setAlertSink, type Logger } from '../../lib/logger'
import { createMemoryPayload } from './where-eval'

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

/**
 * Minden teszt után: a riasztás-fojtás (folyamaton belüli állapot) és a
 * riasztás-csatorna alaphelyzetbe áll, így egy teszt riasztási kulcsa sem
 * némíthat el egy későbbit.
 */
afterEach(() => {
  setAlertSink(undefined)
  resetAlertThrottle()
  vi.restoreAllMocks()
})

/** Memóriabeli Payload a `select`-szerződéssel: csak a kért mezők jönnek vissza. */
function selectHonoringPayload(collections: Parameters<typeof createMemoryPayload>[0]) {
  const memory = createMemoryPayload(collections)
  const find = async (
    args: Parameters<typeof memory.payload.find>[0] & { select?: Record<string, unknown> },
  ) => {
    const result = await memory.payload.find(args)
    const select = args.select
    return select
      ? {
          ...result,
          docs: result.docs.map((doc) =>
            Object.fromEntries(Object.entries(doc).filter(([field]) => select[field] === true)),
          ),
        }
      : result
  }
  return { payload: { ...memory.payload, find }, findCalls: memory.findCalls }
}

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

/**
 * PR #305, Codex P1 (aam.ts): két kiállt helyesbítőnél a rendelésen tárolt
 * pár csak a legutóbbit mutatja. A korábbi helyesbítőt a sorszámára szóló
 * `committed` visszatérítési szándék igazolja (a kézi lezárás csak a kiállt
 * helyesbítő nyugtájával ír `committed`-et, lásd corrective-evidence.ts),
 * ugyanúgy, mint a Figyelmet igényel hiányzó-helyesbítő számolásában. A
 * lekérdezés a Payload `select`-szerződését követi: csak a kért mezők jönnek
 * vissza, így a hiányzó `id` vagy `refundSequence` is buktatja a tesztet.
 */
describe('queryAamStatus: minden kiállt helyesbítő levonódik, nem csak a legutóbbi', () => {
  const NOW = Date.parse('2026-09-24T08:00:00Z')

  const order = (fields: Record<string, unknown>) => ({
    id: 1,
    createdAt: '2026-03-01T10:00:00.000Z',
    ...BASE,
    refunds: TWO_PARTIALS,
    ...fields,
  })
  const intent = (id: number, orderId: number, refundSequence: number, state: string) => ({
    id,
    order: orderId,
    refundSequence,
    state,
  })

  it.each<[string, Record<string, unknown>, Record<string, unknown>[], number]>([
    [
      'két kiállt helyesbítő sorrendben: a pár a 2.-at, a lezárt szándék az 1.-t igazolja → 10 000 + 20 000 levonva',
      {
        correctiveInvoiceStatus: 'issued',
        correctiveInvoiceSeq: 2,
        correctiveInvoiceNumber: 'E-KIN-2026-42',
      },
      [intent(1, 1, 1, 'committed'), intent(2, 1, 2, 'committed')],
      70_000,
    ],
    [
      'sorrenden kívül: az 1. újrapróbálása a 2. után állt ki, a pár a 2.-nél maradt, az 1.-t csak a szándéka igazolja',
      {
        correctiveInvoiceStatus: 'issued',
        correctiveInvoiceSeq: 2,
        correctiveInvoiceNumber: 'E-KIN-2026-42',
      },
      [intent(1, 1, 1, 'committed')],
      70_000,
    ],
    [
      'egy kiállt és egy sikertelen: a 2. szándéka nem lezárt, ezért a 20 000 Ft a keretben marad',
      {
        correctiveInvoiceStatus: 'failed',
        correctiveInvoiceSeq: 1,
        correctiveInvoiceNumber: 'E-KIN-2026-41',
      },
      [intent(1, 1, 1, 'committed'), intent(2, 1, 2, 'manual_review')],
      90_000,
    ],
    [
      'egy másik rendelés lezárt szándéka nem igazolja ennek a rendelésnek a sorszámát',
      {
        correctiveInvoiceStatus: 'issued',
        correctiveInvoiceSeq: 2,
        correctiveInvoiceNumber: 'E-KIN-2026-42',
      },
      [intent(1, 99, 1, 'committed')],
      80_000,
    ],
    [
      'stornó mellett a lezárt szándékok sem számítanak: a rendelés 0',
      {
        stornoStatus: 'storned',
        correctiveInvoiceStatus: 'issued',
        correctiveInvoiceSeq: 2,
        correctiveInvoiceNumber: 'E-KIN-2026-42',
      },
      [intent(1, 1, 1, 'committed')],
      0,
    ],
  ])('%s', async (_name, fields, intents, expected) => {
    const { payload } = selectHonoringPayload({
      orders: [order(fields)],
      'refund-intents': intents,
    })
    const status = await queryAamStatus(
      payloadAamFind(payload as never, { overrideAccess: true }),
      NOW,
    )
    expect(status.netHuf).toBe(expected)
  })

  it('a szándékokat egy lekérdezés hozza, és csak azokra a rendelésekre, amelyeket a pár nem igazol teljesen', async () => {
    const unproven = [11, 12, 13].map((id) =>
      order({
        id,
        correctiveInvoiceStatus: 'issued',
        correctiveInvoiceSeq: 2,
        correctiveInvoiceNumber: `E-KIN-2026-${String(id)}`,
      }),
    )
    // Egyetlen részrefund, amelyet a pár igazol: ehhez nem kell szándék.
    const proven = order({
      id: 14,
      refunds: [TWO_PARTIALS[0]],
      correctiveInvoiceStatus: 'issued',
      correctiveInvoiceSeq: 1,
      correctiveInvoiceNumber: 'E-KIN-2026-14',
    })
    const { payload, findCalls } = selectHonoringPayload({
      orders: [...unproven, proven],
      'refund-intents': [11, 12, 13].map((id) => intent(id, id, 1, 'committed')),
    })

    const status = await queryAamStatus(
      payloadAamFind(payload as never, { overrideAccess: true }),
      NOW,
    )

    expect(status.netHuf).toBe(3 * 70_000 + 90_000)
    const intentCalls = findCalls.filter((call) => call.collection === 'refund-intents')
    expect(intentCalls).toHaveLength(1)
    expect(intentCalls[0]?.where).toEqual({
      and: [{ order: { in: [11, 12, 13] } }, { state: { equals: 'committed' } }],
    })
  })
})

/**
 * PR #305, Devin 🔴 (aam.ts): a `totalHufSnapshot` nélküli régi, kiállított
 * számla eddig 0 Ft-tal számított a keretbe, így egy küszöb-átlépés
 * észrevétlen maradhatott. A számla összegét a rendelés nem tárolja; a számla
 * sorai a tételek ár-snapshotjából készülnek (src/lib/szamlazz/invoice.ts,
 * `itemsFromOrder`), a végösszeg tükre a plugin `amount` mezője. Ha egyik sem
 * ismert, 0 helyett hiba és riasztás jön. A lekérdezés a `select`-szerződést
 * követi, így a ki nem kért `items` vagy `amount` is buktatja a tesztet.
 */
describe('queryAamStatus: a snapshot nélküli régi számla összege nem vész el', () => {
  const NOW = Date.parse('2026-09-24T08:00:00Z')
  // Novemberi rendelés, 2026-os teljesítés, snapshot nélkül.
  const LEGACY = {
    createdAt: '2025-11-20T10:00:00.000Z',
    invoiceStatus: 'issued',
    invoiceCompletionDate: '2026-03-01',
    totalHufSnapshot: null,
  }

  const sourcesOf = (orders: Record<string, unknown>[]) =>
    payloadAamFind(selectHonoringPayload({ orders, 'refund-intents': [] }).payload as never, {
      overrideAccess: true,
    })

  it.each<[string, Record<string, unknown>, number]>([
    [
      'Devin-példa: snapshot nélkül a tételek ára számít',
      { items: [{ priceHufSnapshot: 79_500, quantity: 1 }] },
      79_500,
    ],
    [
      'a tétel ára a mennyiséggel szorzódik',
      {
        items: [
          { priceHufSnapshot: 19_900, quantity: 2 },
          { priceHufSnapshot: 39_700, quantity: 1 },
        ],
      },
      79_500,
    ],
    [
      'hiányos tétel-ár mellett az amount mező számít, nem a tételek részösszege',
      {
        items: [
          { priceHufSnapshot: 60_000, quantity: 1 },
          { priceHufSnapshot: null, quantity: 1 },
        ],
        amount: 79_500,
      },
      79_500,
    ],
    [
      'a meglévő snapshotot egy kisebb tétel- és amount-érték sem írja felül',
      {
        totalHufSnapshot: 100_000,
        items: [{ priceHufSnapshot: 50_000, quantity: 1 }],
        amount: 50_000,
      },
      100_000,
    ],
    [
      'a 0 Ft-os snapshot mellett a tartalék pozitív összege számít (kétség esetén túlbecslés)',
      { totalHufSnapshot: 0, amount: 79_500 },
      79_500,
    ],
    [
      'ingyenes tétel: ha minden forrás 0 Ft, a hozzájárulás 0, hiba nélkül',
      { totalHufSnapshot: 0, items: [{ priceHufSnapshot: 0, quantity: 1 }], amount: 0 },
      0,
    ],
    ['a stornózott régi számla összeg nélkül is 0, hiba nélkül', { stornoStatus: 'storned' }, 0],
  ])('%s', async (_name, fields, expected) => {
    const status = await queryAamStatus(sourcesOf([{ id: 1, ...LEGACY, ...fields }]), NOW)
    expect(status.netHuf).toBe(expected)
  })

  it('ha egyik forrásból sem ismert az összeg: hiba az érintett rendelésekkel és fojtott RIASZTÁS a darabszámmal, keret-szint nélkül', async () => {
    const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const orders = [
      { id: 1, ...LEGACY, items: [{ priceHufSnapshot: null, quantity: 1 }] },
      { id: 2, ...LEGACY },
      { id: 3, ...LEGACY, totalHufSnapshot: 100_000 },
    ]
    const sources = sourcesOf(orders)

    // devin5: a hibát a tiszta számoló (egyetlen őr) dobja a rendelések
    // azonosítóival; a lekérdezés csak riaszt és továbbdobja.
    const failure = await queryAamStatus(sources, NOW).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AamIncompleteError)
    expect(failure).toMatchObject({
      year: 2026,
      ordersWithoutAmount: 2,
      orderIds: [1, 2],
      message: expect.stringContaining('2 rendelésnél nem ismert a kiállított számla összege'),
    })
    expect(errorLog).toHaveBeenCalledTimes(1)
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringMatching(
        /^RIASZTÁS: az alanyi adómentes keret .* 2 rendelésnél nem ismert a kiállított számla összege\./,
      ),
      expect.objectContaining({
        alertCode: AAM_INCOMPLETE_ALERT_CODE,
        year: 2026,
        ordersWithoutAmount: 2,
        orderIds: [1, 2],
      }),
    )

    // A következő megnyitás is hibát kap, a riasztás viszont fojtott.
    await expect(queryAamStatus(sources, NOW + 60_000)).rejects.toBeInstanceOf(AamIncompleteError)
    expect(errorLog).toHaveBeenCalledTimes(1)
  })
})

const HOUR_MS = 60 * 60 * 1000

/** A lapozási korláton túl is teli oldalak: a tárgyév nem olvasható be teljesen. */
const fullPageSources = (): AamSources => ({
  orders: async () => ({
    docs: Array.from({ length: 500 }, () => ({
      invoiceStatus: 'issued',
      invoiceCompletionDate: '2026-03-01',
      totalHufSnapshot: 1,
    })),
    hasNextPage: true,
  }),
  committedIntents: async () => {
    throw new Error('a lapozási korlátnál nem kell visszatérítési szándék')
  },
})

/** Ismeretlen összegű, számlás rendelések a megadott teljesítési dátumokkal. */
const missingAmountSources =
  (...completionDates: string[]) =>
  (): AamSources =>
    payloadAamFind(
      selectHonoringPayload({
        orders: completionDates.map((invoiceCompletionDate, index) => ({
          id: 5 + index,
          invoiceStatus: 'issued',
          invoiceCompletionDate,
          totalHufSnapshot: null,
        })),
        'refund-intents': [],
      }).payload as never,
      { overrideAccess: true },
    )

/**
 * PR #305, devin5: az `aam-keret-nem-teljes` RIASZTÁS mindkét okra az egyetlen
 * riasztás. A Figyelmet igényel blokk minden megnyitáskor, a napi összesítő
 * minden próbálkozáskor újraszámol, ezért okonként és tárgyévenként naponta
 * legfeljebb egyszer szólhat. A lapozási korlát riasztása eddig egyáltalán nem
 * volt fojtva (minden megnyitás új riasztás), az ismeretlen összegé 6 óránként
 * szólt újra. Az időtartamok szó szerint állnak, nem a konstansból: a konstans
 * elrontását a teszt így észreveszi.
 */
describe('queryAamStatus: a nem teljes keret riasztása okonként naponta legfeljebb egyszer szól', () => {
  const NOW = Date.parse('2026-09-24T08:00:00Z')

  it.each<[string, () => AamSources]>([
    ['lapozási korlát', fullPageSources],
    ['ismeretlen összegű számla', missingAmountSources('2026-02-01')],
  ])(
    '%s: minden hívó hibát kap, a riasztás 23 óra múlva még fojtott, 24 óra múlva újra szól',
    async (_ok, sources) => {
      const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
      const alerts = () =>
        errorLog.mock.calls.filter(
          ([, context]) => context?.alertCode === AAM_INCOMPLETE_ALERT_CODE,
        )

      for (const at of [NOW, NOW + 5 * 60_000, NOW + 7 * HOUR_MS, NOW + 23 * HOUR_MS]) {
        await expect(queryAamStatus(sources(), at)).rejects.toBeInstanceOf(AamIncompleteError)
      }
      expect(alerts()).toHaveLength(1)

      await expect(queryAamStatus(sources(), NOW + 24 * HOUR_MS)).rejects.toBeInstanceOf(
        AamIncompleteError,
      )
      expect(alerts()).toHaveLength(2)
    },
  )

  /**
   * Breaker BRK-2 (devin5 rev1): a fojtás kulcsa okonként és tárgyévenként
   * külön. Az egyik ok vagy tárgyév riasztása egy napon belül sem némítja el
   * a másikat: a közös kulcs a másodikat elnyelné.
   */
  it.each<[string, [() => AamSources, number, number], [() => AamSources, number, number]]>([
    [
      'másik ok: a lapozási korlát után egy órával az ismeretlen összeg is riaszt',
      [fullPageSources, NOW, 2026],
      [missingAmountSources('2026-02-01'), NOW + HOUR_MS, 2026],
    ],
    [
      'új tárgyév: 2026-12-31 20:00 után 2027-01-01 07:10-kor (Budapest) az új év ismeretlen összege is riaszt',
      [missingAmountSources('2026-12-20', '2027-01-01'), Date.parse('2026-12-31T19:00:00Z'), 2026],
      [missingAmountSources('2026-12-20', '2027-01-01'), Date.parse('2027-01-01T06:10:00Z'), 2027],
    ],
  ])(
    '%s',
    async (_eset, [firstSources, firstAt, firstYear], [secondSources, secondAt, secondYear]) => {
      const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
      const alertYears = () =>
        errorLog.mock.calls
          .filter(([, context]) => context?.alertCode === AAM_INCOMPLETE_ALERT_CODE)
          .map(([, context]) => context?.year)

      await expect(queryAamStatus(firstSources(), firstAt)).rejects.toMatchObject({
        year: firstYear,
      })
      await expect(queryAamStatus(secondSources(), secondAt)).rejects.toMatchObject({
        year: secondYear,
      })
      expect(alertYears()).toEqual([firstYear, secondYear])
    },
  )
})

/**
 * Breaker BRK-1 (devin5 rev1): a napi fojtás nem nyelheti el a kézbesítést.
 * Ha az `aam-keret-nem-teljes` riasztás-levele nem ment ki (szolgáltatói
 * hiba), vagy a vihar-plafon miatt vár, a riasztás-csatorna a forrás
 * fojtását is feloldja, és a következő számolás (Irányítópult, napi
 * összesítő) újra riaszt. Korábban a levél 24 óráig nem pótlódott, miközben a
 * kijelzés a levélre mutatott. Ahol a levél kiment, vagy ki sem mehetne
 * (noop-szolgáltató, nincs címzett), a fojtás marad. Valódi logger és
 * riasztás-csatorna; csak a levélküldő kapcsolható, hálózati hívás nincs.
 */
describe('queryAamStatus: a ki nem ment riasztás-levelet a következő számolás pótolja (BRK-1)', () => {
  const NOW = Date.parse('2026-09-24T05:10:00Z')

  const silentLogger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => silentLogger,
  }

  /** A valódi csatorna a gyökér-loggeren; a levélküldő kiesett, működik vagy noop. */
  function realSink(clock: { now: number }) {
    const provider: { state: 'kiesett' | 'mukodik' | 'noop' } = { state: 'kiesett' }
    const recipients: { list: readonly string[] } = { list: ['tulajdonos@example.com'] }
    const delivered: SendMailInput[] = []
    const sendMail = vi.fn(async (input: SendMailInput): Promise<SendResult> => {
      if (provider.state === 'kiesett') {
        return { ok: false, provider: 'resend', retryable: true, error: 'HTTP 503' }
      }
      if (provider.state === 'noop') {
        return { ok: true, provider: 'noop' }
      }
      delivered.push(input)
      return { ok: true, provider: 'resend', id: `m${String(delivered.length)}` }
    })
    const handle = createAlertSink({
      sendMail,
      capture: async () => ({ allapot: 'rogzitve' as const }),
      recipients: () => recipients.list,
      logger: silentLogger,
      now: () => clock.now,
      environment: 'production',
    })
    setAlertSink(handle.sink)
    const aamMails = () =>
      delivered.filter((mail) => mail.text.includes(`Riasztáskód: ${AAM_INCOMPLETE_ALERT_CODE}`))
    return { provider, recipients, sendMail, handle, aamMails }
  }

  it.each<[string, () => AamSources]>([
    ['lapozási korlát', fullPageSources],
    ['ismeretlen összegű számla', missingAmountSources('2026-02-01')],
  ])(
    '%s: ha a levél a szolgáltató hibája miatt nem ment ki, egy óra múlva a következő számolás elküldi',
    async (_ok, sources) => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined)
      const clock = { now: NOW }
      const sink = realSink(clock)

      await expect(queryAamStatus(sources(), clock.now)).rejects.toBeInstanceOf(AamIncompleteError)
      await sink.handle.flush()
      expect(sink.sendMail).toHaveBeenCalledTimes(1)
      expect(sink.aamMails()).toHaveLength(0)

      sink.provider.state = 'mukodik'
      clock.now = NOW + HOUR_MS
      await expect(queryAamStatus(sources(), clock.now)).rejects.toBeInstanceOf(AamIncompleteError)
      await sink.handle.flush()
      expect(sink.aamMails()).toHaveLength(1)
    },
  )

  it('a vihar-plafon miatt visszatartott levelet egy óra múlva a következő számolás elküldi', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const clock = { now: NOW }
    const sink = realSink(clock)
    sink.provider.state = 'mukodik'
    const storm = createLogger()
    for (let index = 0; index < MAX_ALERT_MAILS_PER_HOUR; index += 1) {
      storm.error(`RIASZTÁS: vihar ${String.fromCharCode(97 + index)}`)
    }
    await sink.handle.flush()
    expect(sink.sendMail).toHaveBeenCalledTimes(MAX_ALERT_MAILS_PER_HOUR)

    const sources = missingAmountSources('2026-02-01')
    await expect(queryAamStatus(sources(), clock.now)).rejects.toBeInstanceOf(AamIncompleteError)
    await sink.handle.flush()
    // A plafon miatt küldési kísérlet sem volt.
    expect(sink.sendMail).toHaveBeenCalledTimes(MAX_ALERT_MAILS_PER_HOUR)

    clock.now = NOW + HOUR_MS
    await expect(queryAamStatus(sources(), clock.now)).rejects.toBeInstanceOf(AamIncompleteError)
    await sink.handle.flush()
    expect(sink.aamMails()).toHaveLength(1)
  })

  it.each<[string, (sink: ReturnType<typeof realSink>) => void]>([
    [
      'a levél kiment',
      (sink) => {
        sink.provider.state = 'mukodik'
      },
    ],
    [
      'nincs e-mail-szolgáltató (noop)',
      (sink) => {
        sink.provider.state = 'noop'
      },
    ],
    [
      'nincs címzett (üres OWNER_ALERT_EMAILS)',
      (sink) => {
        sink.recipients.list = []
      },
    ],
  ])(
    '%s: a fojtás marad, egy óra múlva a következő számolás nem riaszt újra',
    async (_eset, setup) => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined)
      const errorLog = vi.spyOn(logger, 'error')
      const alerts = () =>
        errorLog.mock.calls.filter(
          ([, context]) => context?.alertCode === AAM_INCOMPLETE_ALERT_CODE,
        )
      const clock = { now: NOW }
      const sink = realSink(clock)
      setup(sink)
      const sources = missingAmountSources('2026-02-01')

      for (const at of [NOW, NOW + HOUR_MS]) {
        clock.now = at
        await expect(queryAamStatus(sources(), at)).rejects.toBeInstanceOf(AamIncompleteError)
        await sink.handle.flush()
      }
      expect(alerts()).toHaveLength(1)
    },
  )
})

describe('queryAamStatus: részösszegből nem lesz éves összeg (Codex P1, lapozási korlát)', () => {
  const NOW = Date.parse('2026-09-24T08:00:00Z')
  const fullPage = (): AamOrderInput[] =>
    Array.from({ length: 500 }, () => ({
      invoiceStatus: 'issued',
      invoiceCompletionDate: '2026-03-01',
      totalHufSnapshot: 1,
    }))

  // Visszatérítés nélküli rendeléseknél a szándék-lekérdezésnek nem szabad futnia.
  const noIntentLookup: AamIntentFindFn = async () => {
    throw new Error('ehhez a rendeléshez nem kell visszatérítési szándék')
  }

  it('a korlát után is van még adat → RIASZTÁS és hiba, nem keret-szint', async () => {
    const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    let calls = 0
    const find: AamFindFn = async () => {
      calls += 1
      return { docs: fullPage(), hasNextPage: true }
    }

    await expect(
      queryAamStatus({ orders: find, committedIntents: noIntentLookup }, NOW),
    ).rejects.toBeInstanceOf(AamIncompleteError)
    expect(calls).toBe(40)
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringMatching(/^RIASZTÁS: az alanyi adómentes keret/),
      expect.objectContaining({ alertCode: AAM_INCOMPLETE_ALERT_CODE, year: 2026 }),
    )
  })

  it('a korlát utolsó oldala zárja a listát → teljes összeg, riasztás nélkül', async () => {
    const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const find: AamFindFn = async ({ page }) => ({ docs: fullPage(), hasNextPage: page < 40 })

    const status = await queryAamStatus({ orders: find, committedIntents: noIntentLookup }, NOW)
    expect(status.netHuf).toBe(20_000)
    expect(errorLog).not.toHaveBeenCalled()
  })
})

/**
 * Codex P2 (PR #305): a lapozott AAM-lekérdezés rendezésének egyedi
 * holtverseny-döntővel kell végződnie. A Postgres nem egyedi `ORDER BY`
 * mellett az azonos kulcsú sorokat nem rögzített sorrendben adja, és
 * `LIMIT/OFFSET`-nél lekérdezésenként más sorrendet adhat
 * (https://www.postgresql.org/docs/current/queries-limit.html): egy sor két
 * oldalon is megjöhet, egy másik egyiken sem, és az adóhatár-összeg hamis
 * lesz. A hamis adatbázis a kért rendezési kulcsokat betartja, a maradék
 * holtversenyt viszont oldalanként másképp dönti el, ahogy a Postgres is
 * teheti.
 */
describe('queryAamStatus: a lapozás azonos létrehozási idő mellett is minden sort egyszer olvas', () => {
  it('a lapozott lekérdezés rendezése id-val zárul, és az összeg a lapok határán is pontos', async () => {
    const SOROK = 600
    const rows = Array.from({ length: SOROK }, (_, index) => ({
      id: index + 1,
      createdAt: '2026-03-01T10:00:00.000Z',
      invoiceStatus: 'issued',
      invoiceCompletionDate: '2026-03-01',
      totalHufSnapshot: index + 1,
    }))
    const calls: Array<{ sort?: unknown; page?: number }> = []
    const payload = {
      find: async (args: { sort?: string | string[]; page?: number; limit?: number }) => {
        calls.push(args)
        const kulcsok = typeof args.sort === 'string' ? [args.sort] : (args.sort ?? [])
        const page = args.page ?? 1
        const limit = args.limit ?? 10
        const rendezett = [...rows].sort((a, b) => {
          for (const kulcs of kulcsok) {
            const mezo = kulcs.replace(/^-/, '') as keyof (typeof rows)[number]
            const irany = kulcs.startsWith('-') ? -1 : 1
            const x = a[mezo]
            const y = b[mezo]
            if (x !== y) return (x < y ? -1 : 1) * irany
          }
          // A kulcsokkal el nem döntött sorrend lekérdezésenként más lehet.
          return page % 2 === 1 ? a.id - b.id : b.id - a.id
        })
        return {
          docs: rendezett.slice((page - 1) * limit, page * limit),
          hasNextPage: page * limit < rendezett.length,
        }
      },
    }

    const status = await queryAamStatus(
      payloadAamFind(payload as never, { overrideAccess: true }),
      Date.parse('2026-09-24T08:00:00Z'),
    )

    expect(calls.length).toBeGreaterThan(1)
    for (const { sort } of calls) {
      const kulcsok = typeof sort === 'string' ? [sort] : (sort as string[] | undefined)
      expect(kulcsok?.at(-1)?.replace(/^-/, '')).toBe('id')
    }
    expect(status.netHuf).toBe((SOROK * (SOROK + 1)) / 2)
  })
})
