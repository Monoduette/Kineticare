import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A közös tároló-, zár- és Barion-mockokat a szolgáltatások importja előtt kell regisztrálni.
import { documents, fixture, store } from '../refund-fixture'
import {
  createReceipt,
  REFUND_INVOICE_NO_EFFECT_ACTION,
  REFUND_INVOICE_RESUBMIT_STARTED_ACTION,
  writeReceipt,
} from '../../lib/refund/recovery-receipts'
import { getSzamlazzConfig } from '../../lib/szamlazz/client'
import {
  CORRECTIVE_LOCAL_ERROR_PREFIX,
  issueCorrectiveInvoiceForOrder,
  type IssueCorrectiveInvoiceDeps,
} from '../../lib/szamlazz/corrective'
import type { InvoiceLookupResult } from '../../lib/szamlazz/pdf'
import {
  claimManagedRefundDocument,
  CORRECTIVE_RETRY_ESCALATION_MS,
  RefundDocumentGuardError,
} from '../../lib/szamlazz/refund-guard'
import { issueStornoForOrder } from '../../lib/szamlazz/storno'
import type { Order } from '../../payload-types'

type StornoDeps = Parameters<typeof issueStornoForOrder>[1]

/**
 * W1B-2 (a-refund-4 (1)): ha a helyesbítő ELSŐ beküldése igazoltan hatás
 * nélkül maradt, a sorba állított job a beküldés előtti negatív lekérdezés után
 * pontosan egyszer újra beküldi. Minden más igénylés utáni esetben csak átvesz.
 *
 * Valódi lánc: refund-folyamat → corrective.ts → refund-őr → Számlázz.hu-kliens.
 * A Számla Agent végpontját fetch-stub adja, a bizonylat-lekérdezést a meglévő
 * injektálási pont (queryByKulsoAzon), az eredeti számla adatait modul-mock
 * (CLAUDE.md 15.: tesztből nincs valódi hálózati hívás).
 */

// Az eredeti számla adat-lekérdezése (áfakulcs-ellenőrzés): egy AAM-es, élő
// számla, ahogy élesben (alanyi adómentes eladó).
vi.mock('../../lib/szamlazz/invoice-data', () => ({
  queryInvoiceData: async (szamlaszam: string) => ({
    szamlaszam,
    vatKeys: ['AAM'],
    sztornozott: false,
  }),
}))

/** DUMMY érték, egyértelműen jelölve: NEM valódi Számla Agent kulcs. */
const config = getSzamlazzConfig({
  SZAMLAZZ_AGENT_KEY: 'DUMMY-W1B-R1-1-AGENT-KEY',
  SZAMLAZZ_AFAKULCS: 'AAM',
})

/** A Számla Agent végpontjának előkészített válaszai, érkezési sorrendben. */
const answers: Array<() => Promise<Response>> = []
const agent = vi.fn(async (url: string | URL | Request): Promise<Response> => {
  if (String(url) !== config.apiUrl) {
    throw new Error(`TESZT: váratlan hálózati hívás: ${String(url)}`)
  }
  const next = answers.shift()
  if (!next) throw new Error('TESZT: nincs több előkészített Számlázz.hu-válasz')
  return next()
})

/** Karbantartás: a Számlázz.hu a dokumentált `szlahu_down: true` fejlécet küldi. */
const down = async () =>
  new Response('<html>Karbantartás</html>', { status: 200, headers: { szlahu_down: 'true' } })
/** Időtúllépés: a kérés elmehetett, a kimenet ismeretlen. */
const timedOut = async (): Promise<Response> => {
  throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
}
function issued(number: string) {
  return async () =>
    new Response(
      `<?xml version="1.0" encoding="UTF-8"?><xmlszamlavalasz><sikeres>true</sikeres><szamlaszam>${number}</szamlaszam><szamlanetto>-5000</szamlanetto><szamlabrutto>-5000</szamlabrutto></xmlszamlavalasz>`,
      { status: 200 },
    )
}

beforeEach(() => {
  answers.length = 0
  // A refund-fixture a fetch-et hangosan dobóra állítja; itt a Számla Agent válaszol.
  vi.stubGlobal('fetch', agent)
})

afterEach(() => {
  vi.useRealTimers()
})

/** Részleges visszatérítés a valódi bizonylat-kiállítókkal. */
function realFlow() {
  const f = fixture()
  Object.assign(f.order, {
    customerSnapshot: {
      name: 'Synthetic Buyer',
      email: 'synthetic@example.test',
      billingName: 'Synthetic Buyer',
      billingZip: '1111',
      billingCity: 'Budapest',
      billingStreet: 'Synthetic street 1',
    },
    invoiceCompletionDate: '2026-09-05',
  } satisfies Partial<Order>)
  const query = vi.fn<() => Promise<InvoiceLookupResult | null>>(async () => null)
  documents.corrective.mockImplementation((order: Order, options: IssueCorrectiveInvoiceDeps) =>
    issueCorrectiveInvoiceForOrder(order, {
      ...options,
      config,
      queryByKulsoAzon: query,
    }),
  )
  documents.storno.mockImplementation((order: Order, options: StornoDeps) =>
    issueStornoForOrder(order, { ...options, config }),
  )
  documents.queue.mockResolvedValue(true)
  return {
    ...f,
    query,
    /** A sorba állított corrective-invoice-issue job hívása (friss rendelés, ugyanaz a belépő). */
    job: () =>
      issueCorrectiveInvoiceForOrder(structuredClone(f.order), {
        payload: f.payload,
        refundSeq: 1,
        amountHuf: 5000,
        config,
        queryByKulsoAzon: query,
      }).catch((error: unknown) => error),
  }
}

function receipts(f: ReturnType<typeof realFlow>, action: string): unknown[] {
  return f.audits.filter((row) => row.action === action).map((row) => row.after)
}

describe('W1B-2: egyetlen ismételt beküldés igazoltan hatás nélküli első beküldés után', () => {
  it('szlahu_down az első beküldésnél: a job negatív lekérdezés után egyszer újra beküld, és a helyesbítő elkészül', async () => {
    const f = realFlow()
    answers.push(down, issued('E-KIN-2026-10'))
    await expect(f.start({ amountHuf: 5000 })).rejects.toMatchObject({ status: 503 })
    expect(documents.queue).toHaveBeenCalledTimes(1)

    const run = await f.job()

    expect(agent).toHaveBeenCalledTimes(2)
    expect(run).toEqual({ outcome: 'issued', correctiveInvoiceNumber: 'E-KIN-2026-10' })
    expect(f.order).toMatchObject({
      correctiveInvoiceStatus: 'issued',
      correctiveInvoiceNumber: 'E-KIN-2026-10',
      correctiveInvoiceSeq: 1,
      correctiveInvoiceAttempts: 2,
    })
    // Az ismételt beküldést negatív lekérdezés előzte meg ugyanabban a futásban.
    expect(Math.max(...f.query.mock.invocationCallOrder)).toBeLessThan(
      agent.mock.invocationCallOrder[1],
    )
    expect(receipts(f, REFUND_INVOICE_NO_EFFECT_ACTION)).toEqual([
      expect.objectContaining({ kind: 'corrective', attempt: 1, errorKind: 'http' }),
    ])
    expect(receipts(f, REFUND_INVOICE_RESUBMIT_STARTED_ACTION)).toEqual([
      expect.objectContaining({ kind: 'corrective', attempt: 2 }),
    ])
    expect(store.intents.get(f.payload)?.state).toBe('provider_succeeded')
  })

  it('időtúllépés az első beküldésnél (a helyesbítő létrejöhetett): a job nem küld be újra', async () => {
    const f = realFlow()
    answers.push(timedOut)
    await expect(f.start({ amountHuf: 5000 })).rejects.toMatchObject({ status: 503 })

    const run = await f.job()

    expect(run).toBeInstanceOf(RefundDocumentGuardError)
    expect(agent).toHaveBeenCalledTimes(1)
    expect(receipts(f, REFUND_INVOICE_NO_EFFECT_ACTION)).toEqual([])
    expect(receipts(f, REFUND_INVOICE_RESUBMIT_STARTED_ACTION)).toEqual([])
  })

  it('a második beküldés is szlahu_down: pontosan két beküldés, harmadik soha', async () => {
    const f = realFlow()
    answers.push(down, down)
    await expect(f.start({ amountHuf: 5000 })).rejects.toMatchObject({ status: 503 })

    const second = await f.job()
    const third = await f.job()

    expect(second).toMatchObject({ kind: 'http', retryable: true, noEffect: true })
    expect(third).toBeInstanceOf(RefundDocumentGuardError)
    expect(agent).toHaveBeenCalledTimes(2)
    expect(receipts(f, REFUND_INVOICE_NO_EFFECT_ACTION)).toHaveLength(1)
    expect(receipts(f, REFUND_INVOICE_RESUBMIT_STARTED_ACTION)).toHaveLength(1)
  })

  it('a nyugta megvan, de a lekérdezés megtalálja a helyesbítőt: átveszi, új beküldés nincs', async () => {
    const f = realFlow()
    answers.push(down)
    await expect(f.start({ amountHuf: 5000 })).rejects.toMatchObject({ status: 503 })
    f.query.mockResolvedValueOnce({
      szamlaszam: 'E-KIN-2026-10',
      szamlanetto: -5000,
      szamlabrutto: -5000,
    })

    const run = await f.job()

    expect(run).toEqual({ outcome: 'issued', correctiveInvoiceNumber: 'E-KIN-2026-10' })
    expect(agent).toHaveBeenCalledTimes(1)
    expect(receipts(f, REFUND_INVOICE_RESUBMIT_STARTED_ACTION)).toEqual([])
  })

  it('ha a hatás nélküliség nyugtája nem írható, ismételt beküldés sincs (zárt irányba hibázik)', async () => {
    const f = realFlow()
    answers.push(down)
    f.failures.receipt = REFUND_INVOICE_NO_EFFECT_ACTION
    await expect(f.start({ amountHuf: 5000 })).rejects.toMatchObject({ status: 503 })
    f.failures.receipt = ''

    const run = await f.job()

    expect(run).toBeInstanceOf(RefundDocumentGuardError)
    expect(agent).toHaveBeenCalledTimes(1)
  })

  // A sorba állítás jelzése (queuedAt) adja a határidőt, és erre mutat a panel
  // tiltása is. Nélküle a panel nem tiltja a kézi kiállítást, ezért egy késve
  // futó job sem küldhet be ismét.
  it('ha a sorba állítás jelzése nem íródott meg, ismételt beküldés sincs', async () => {
    const f = realFlow()
    answers.push(down)
    f.failures.receipt = 'refund-invoice-retry-queued'
    await expect(f.start({ amountHuf: 5000 })).rejects.toMatchObject({ status: 503 })
    f.failures.receipt = ''
    expect(documents.queue).toHaveBeenCalledTimes(1)
    expect(receipts(f, REFUND_INVOICE_NO_EFFECT_ACTION)).toHaveLength(1)

    const run = await f.job()

    expect(run).toBeInstanceOf(RefundDocumentGuardError)
    expect(agent).toHaveBeenCalledTimes(1)
  })

  it('ha az ismételt beküldés igénylése rögzült, de a folyamat a kísérletszám írása előtt leállt, újabb beküldés nincs', async () => {
    const f = realFlow()
    answers.push(down)
    await expect(f.start({ amountHuf: 5000 })).rejects.toMatchObject({ status: 503 })
    // Egy korábbi job-futás már igényelte az ismételt beküldést (a kísérletszám 1 maradt).
    await createReceipt(
      f.payload,
      store.intents.get(f.payload)!,
      REFUND_INVOICE_RESUBMIT_STARTED_ACTION,
      {
        version: 1,
        kind: 'corrective',
        sequence: 1,
        attempt: 2,
      },
    )

    const run = await f.job()

    expect(run).toBeInstanceOf(RefundDocumentGuardError)
    expect(agent).toHaveBeenCalledTimes(1)
  })

  it('két egyidejű job-futásból is csak egy ismételt beküldés lesz', async () => {
    const f = realFlow()
    answers.push(down, issued('E-KIN-2026-10'))
    await expect(f.start({ amountHuf: 5000 })).rejects.toMatchObject({ status: 503 })

    const runs = await Promise.all([f.job(), f.job()])

    expect(agent).toHaveBeenCalledTimes(2)
    expect(runs).toEqual(
      expect.arrayContaining([
        { outcome: 'issued', correctiveInvoiceNumber: 'E-KIN-2026-10' },
        { outcome: 'already-issued', correctiveInvoiceNumber: 'E-KIN-2026-10' },
      ]),
    )
    expect(receipts(f, REFUND_INVOICE_RESUBMIT_STARTED_ACTION)).toHaveLength(1)
  })
})

describe('W1B-2: az ismételt beküldés határideje (CORRECTIVE_RETRY_ESCALATION_MS)', () => {
  const T0 = Date.parse('2026-09-25T08:00:00.000Z')

  async function noEffectThenJobAt(elapsedMs: number) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    const f = realFlow()
    answers.push(down, issued('E-KIN-2026-10'))
    await expect(f.start({ amountHuf: 5000 })).rejects.toMatchObject({ status: 503 })
    vi.setSystemTime(T0 + elapsedMs)
    return { f, run: await f.job() }
  }

  it('a job idején belül még beküld', async () => {
    const { run } = await noEffectThenJobAt(CORRECTIVE_RETRY_ESCALATION_MS - 1000)
    expect(run).toEqual({ outcome: 'issued', correctiveInvoiceNumber: 'E-KIN-2026-10' })
    expect(agent).toHaveBeenCalledTimes(2)
  })

  it('a határidőtől kezdve nem: a panel ekkor már a kézi rendezést kéri, egy késői job nem küldhet mellé', async () => {
    const { f, run } = await noEffectThenJobAt(CORRECTIVE_RETRY_ESCALATION_MS)
    expect(run).toBeInstanceOf(RefundDocumentGuardError)
    expect(agent).toHaveBeenCalledTimes(1)
    expect(receipts(f, REFUND_INVOICE_RESUBMIT_STARTED_ACTION)).toEqual([])
  })
})

describe('W1B-2: stornónál nincs ismételt beküldés (F3)', () => {
  it('a hatás nélküli első stornó-beküldés után sem a stornó-kiállító, sem a refund-őr nem enged újat', async () => {
    const f = realFlow()
    answers.push(down)
    await expect(f.start()).rejects.toMatchObject({ status: 503 })
    expect(documents.queue).not.toHaveBeenCalled()

    const again = await issueStornoForOrder(structuredClone(f.order), {
      payload: f.payload,
      config,
    })
    expect(again).toMatchObject({ outcome: 'failed' })

    // A refund-őr akkor sem enged stornót, ha egy hatás nélküliségi nyugta
    // (a helyesbítő alakjában) ott volna.
    const intent = store.intents.get(f.payload)!
    await writeReceipt(f.payload, intent, REFUND_INVOICE_NO_EFFECT_ACTION, {
      version: 1,
      kind: 'corrective',
      sequence: 1,
      attempt: 1,
      errorKind: 'http',
    })
    await expect(
      claimManagedRefundDocument(f.payload, { intent, kind: 'storno', number: null }, 1),
    ).rejects.toBeInstanceOf(RefundDocumentGuardError)
    expect(agent).toHaveBeenCalledTimes(1)
    expect(receipts(f, REFUND_INVOICE_RESUBMIT_STARTED_ACTION)).toEqual([])
  })
})

describe('W1B-4: a helyi hiba nem a Számlázz.hu üzeneteként kerül a rendelésre', () => {
  it('a sikeres beküldés utáni mentési hiba előtagot kap, és a job kereséssel veheti át a bizonylatot', async () => {
    const f = realFlow()
    answers.push(issued('E-KIN-2026-10'))
    const update = vi.mocked(f.payload.update)
    const write = update.getMockImplementation()!
    update.mockImplementation(async (args) => {
      if (args.collection === 'orders' && 'correctiveInvoiceNumber' in args.data)
        throw new Error('Connection terminated unexpectedly')
      return write(args)
    })

    await expect(f.start({ amountHuf: 5000 })).rejects.toMatchObject({ status: 503 })

    expect(f.order).toMatchObject({
      correctiveInvoiceStatus: 'failed',
      correctiveInvoiceLastError: `${CORRECTIVE_LOCAL_ERROR_PREFIX}Connection terminated unexpectedly`,
    })
    expect(documents.queue).toHaveBeenCalledTimes(1)
    expect(agent).toHaveBeenCalledTimes(1)
  })

  it('a Számlázz.hu-kliens hibaüzenete előtag nélkül marad', async () => {
    const f = realFlow()
    answers.push(timedOut)

    await expect(f.start({ amountHuf: 5000 })).rejects.toMatchObject({ status: 503 })

    expect(f.order.correctiveInvoiceLastError).toMatch(
      /^A Számlázz\.hu nem válaszolt \d+ ms-en belül\.$/,
    )
  })
})
