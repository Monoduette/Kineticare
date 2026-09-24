import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { Payload } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AuditLogStore } from '../lib/audit'
import {
  ORDER_CONFIRMATION_TEMPLATE_VERSION,
  WAIVER_LOSS_STATEMENT,
  WAIVER_START_STATEMENT,
  orderConfirmationEmail,
} from '../lib/email/templates/order'
import {
  ASZF_MELLEKLET_FAJLNEV,
  loadOrderLegalInfo,
  orderLegalInfoFromAszf,
  type OrderLegalInfo,
} from '../lib/email/templates/order-legal'
import type { SendResult } from '../lib/email/types'
import type { LogContext, Logger } from '../lib/logger'
import {
  CONFIRMATION_RETRY_DELAYS_MS,
  ORDER_CONFIRMATION_AUDIT_ACTION,
  onOrderPaid,
  type ConfirmationMailInput,
} from '../lib/order-paid'
import type { Order } from '../payload-types'

/**
 * A vásárlás-visszaigazoló JOGI tartalma és a küldés megbízhatósága.
 *
 * MI A TÉT: a 45/2014. (II. 26.) Korm. rendelet 29. § (1) m) pontja szerint a
 * digitális tartalomra az elállási jog kizárása CSAK akkor él, ha a vállalkozás
 * a 18. § szerint tartós adathordozón visszaigazolta a vevő két nyilatkozatát,
 * és megadta a 11. § (1) szerinti tájékoztatást. Ha a levél ezt nem hordozza,
 * vagy nem megy ki, a vevő a teljes kurzus megnézése után is elállhat (27. §
 * b) bc)). Ezek a tesztek ezt a láncot őrzik: a levél tartalmát, az ÁSZF
 * mellékletet, az újrapróbát, a riasztást és a küldés bizonyítékát.
 *
 * Hálózati hívás nincs: a küldő, a műveletnapló és a várakozás injektált
 * (CLAUDE.md 15. tanulság).
 */

const ORDER_NUMBER = 'KH-2026-000777'
/** 12:05 UTC = 14:05 budapesti nyári idő (CEST, UTC+2). */
const WAIVER_AT = '2026-09-24T12:05:00.000Z'
const WAIVER_AT_BUDAPEST = '2026. 09. 24. 14:05'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const ASZF = readFileSync(`${REPO_ROOT}src/lib/legal-source/aszf.txt`, 'utf8')
const LEGAL: OrderLegalInfo = orderLegalInfoFromAszf(ASZF)

function createOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 777,
    orderNumber: ORDER_NUMBER,
    status: 'paid',
    customerEmail: 'anna@example.test',
    totalHufSnapshot: 19990,
    items: [
      { product: 42, quantity: 1, titleSnapshot: 'Otthoni KézRehab', priceHufSnapshot: 19990 },
    ],
    customerSnapshot: { name: 'Teszt Anna', email: 'anna@example.test' },
    consentWithdrawalWaiver: true,
    consentWithdrawalWaiverAt: WAIVER_AT,
    ...overrides,
  } as unknown as Order
}

interface CapturedLogEntry {
  level: 'debug' | 'info' | 'warn' | 'error'
  msg: string
  context?: LogContext
}

function createCapturingLogger(): { log: Logger; entries: CapturedLogEntry[] } {
  const entries: CapturedLogEntry[] = []
  const write =
    (level: CapturedLogEntry['level']) =>
    (msg: string, context?: LogContext): void => {
      entries.push(context === undefined ? { level, msg } : { level, msg, context })
    }
  const log: Logger = {
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    child: () => log,
  }
  return { log, entries }
}

const errorsOf = (entries: CapturedLogEntry[]): CapturedLogEntry[] =>
  entries.filter((entry) => entry.level === 'error')

/** Rögzítő műveletnapló: a `create` hívásait gyűjti. */
function createAuditStore(fail = false): {
  store: AuditLogStore
  created: Array<Record<string, unknown>>
} {
  const created: Array<Record<string, unknown>> = []
  const store: AuditLogStore = {
    create: async (args) => {
      if (fail) {
        throw new Error('DB nem elérhető')
      }
      created.push(args.data)
      return { id: created.length }
    },
  }
  return { store, created }
}

/** Sikeres Resend-küldést szimuláló küldő, a hívások gyűjtésével. */
function createSender(results: SendResult[] = [{ ok: true, provider: 'resend', id: 're_123' }]) {
  const calls: ConfirmationMailInput[] = []
  let index = 0
  const send = async (input: ConfirmationMailInput): Promise<SendResult> => {
    calls.push(input)
    const result = results[Math.min(index, results.length - 1)]
    index += 1
    return result
  }
  return { send, calls }
}

/** Hangosan dobó várakozás: ahol újrapróbának NEM szabad futnia. */
const nemVarhat = async (): Promise<void> => {
  throw new Error('TESZT: ezen az ágon NEM szabad újrapróbálni')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

// ---------------------------------------------------------------------------
// A sablon jogi tartalma
// ---------------------------------------------------------------------------

describe('orderConfirmationEmail: a 18. § szerinti visszaigazolás tartalma', () => {
  const level = orderConfirmationEmail({
    orderNumber: ORDER_NUMBER,
    buyerName: 'Teszt Anna',
    items: [
      { title: 'Otthoni KézRehab', quantity: 1, totalHuf: 19990, accessDurationDays: null },
      { title: 'Szakmai kurzus', quantity: 1, totalHuf: 49990, accessDurationDays: 90 },
      { title: 'Ismeretlen hosszú', quantity: 1, totalHuf: 1000 },
    ],
    totalHuf: 70980,
    coursesUrl: 'https://pelda.hu/kurzusaim',
    invoiceNote: true,
    withdrawalWaiverAt: WAIVER_AT,
    seller: LEGAL.seller,
    terms: { url: 'https://pelda.hu/aszf', attachment: LEGAL.aszf.attachment },
  })
  const text = level.text.replace(/ /g, ' ')

  it('visszaigazolja a két nyilatkozatot, szó szerint és a budapesti időponttal', () => {
    expect(text).toContain('Az elállási jogodról:')
    expect(text).toContain(`(${WAIVER_AT_BUDAPEST})`)
    expect(text).toContain(`„${WAIVER_START_STATEMENT}”`)
    expect(text).toContain(`„${WAIVER_LOSS_STATEMENT}”`)
    expect(text).toContain('mindkét nyilatkozatodat visszaigazoljuk')
    expect(level.html).toContain('<strong>Az elállási jogodról:</strong>')
  })

  it('a szolgáltató adatai az ÁSZF-ből: név, székhely, cégjegyzékszám, adószám, e-mail, telefon', () => {
    expect(text).toContain('A szolgáltató adatai:')
    expect(text).toContain('KINETICARE Kft.')
    expect(text).toContain('Székhely: 8360 Keszthely, Kacsóh Pongrác utca 1. 2a. ép.')
    expect(text).toContain('Cégjegyzékszám: 20-09-079468 (Zalaegerszegi Törvényszék Cégbírósága)')
    expect(text).toContain('Adószám: 32697865-1-20')
    expect(text).toContain('E-mail: egeszsegmozgastamogatas@gmail.com')
    expect(text).toContain('Telefon: +36 20 357 3493')
  })

  it('panaszkezelés: hova, milyen határidővel, és a békéltető testület', () => {
    expect(text).toContain('Ha panaszod van:')
    expect(text).toContain('a székhelyünk egyben a panaszügyintézés helye is')
    expect(text).toContain('Legkésőbb 30 napon belül írásban válaszolunk.')
    expect(text).toContain('békéltető testülethez')
    expect(text).toContain('www.bekeltetes.hu')
    expect(text).toContain('kellékszavatossági')
  })

  it('a kurzus fő jellemzői: online, nem tárgyi adathordozón nyújtott digitális tartalom', () => {
    expect(text).toContain('A kurzusról:')
    expect(text).toContain('nem tárgyi adathordozón nyújtott digitális tartalmat')
    expect(text).toContain('Google Chrome vagy a Safari')
  })

  it('bruttó végösszeg és tételenként a hozzáférés hossza, ha ismert', () => {
    expect(text).toContain('Végösszeg (bruttó): 70 980 Ft')
    expect(text).toContain('Otthoni KézRehab, 1 db, a hozzáférés nem jár le, 19 990 Ft')
    expect(text).toContain('Szakmai kurzus, 1 db, 90 napos hozzáférés, 49 990 Ft')
    // Ismeretlen hossznál a levél nem állít semmit. (A négyjegyű összeget a
    // hu-HU formázás nem tagolja: „1000 Ft".)
    expect(text).toContain('Ismeretlen hosszú, 1 db, 1000 Ft')
  })

  it('a szöveges változatban a jogi bekezdéseket üres sor választja el', () => {
    expect(text).toContain(
      'visszaigazoljuk. A hozzáférést a kérésednek megfelelően azonnal megnyitottuk.\n\nA kurzusról:',
    )
    expect(text).toContain('Telefon: +36 20 357 3493\n\nHa panaszod van:')
  })

  it('az ÁSZF mellékletként megy (link önmagában nem tartós adathordozó, C-49/11)', () => {
    expect(level.attachments).toHaveLength(1)
    expect(level.attachments?.[0]).toMatchObject({
      filename: ASZF_MELLEKLET_FAJLNEV,
      contentType: 'text/plain; charset=utf-8',
    })
    expect(level.attachments?.[0].content).toContain('Általános Szerződési Feltételei')
    expect(text).toContain(`mellékeltük ehhez a levélhez (${ASZF_MELLEKLET_FAJLNEV})`)
    expect(text).toContain('https://pelda.hu/aszf')
  })

  it('megválaszolható: a lábléc a szolgáltató címére terel, nem „ne válaszolj"', () => {
    expect(text).toContain(
      'Válaszolj erre a levélre, vagy írj a(z) egeszsegmozgastamogatas@gmail.com címre.',
    )
    expect(text).toContain(`rendelésszám: ${ORDER_NUMBER}`)
    expect(text).not.toContain('ne válaszolj')
  })

  it('a jogi rész a gomb UTÁN áll (elöl a rendelés és a hozzáférés, NN/g)', () => {
    const ctaIndex = level.html.indexOf('https://pelda.hu/kurzusaim')
    const legalIndex = level.html.indexOf('Az elállási jogodról')
    expect(ctaIndex).toBeGreaterThan(0)
    expect(legalIndex).toBeGreaterThan(ctaIndex)
  })

  it('natív magyar írásjelek: nincs kvirtmínusz és nincs töltelék-gondolatjel (§3.1.2)', () => {
    expect(level.text).not.toContain('—')
    expect(level.html).not.toContain('—')
    expect(level.text).not.toMatch(/ – /u)
  })

  it('nyilatkozat nélküli rendelésnél NEM igazol vissza olyat, ami nem történt meg', () => {
    const nelkul = orderConfirmationEmail({
      orderNumber: ORDER_NUMBER,
      items: [],
      totalHuf: 0,
      coursesUrl: 'https://pelda.hu/kurzusaim',
      invoiceNote: false,
      withdrawalWaiverAt: null,
      seller: LEGAL.seller,
      terms: { url: 'https://pelda.hu/aszf', attachment: LEGAL.aszf.attachment },
    })
    expect(nelkul.text).not.toContain('Az elállási jogodról')
    expect(nelkul.text).not.toContain(WAIVER_LOSS_STATEMENT)
  })

  it('hibás időbélyegnél a visszaigazolás időpont nélkül megy, nem dob', () => {
    const hibas = orderConfirmationEmail({
      orderNumber: ORDER_NUMBER,
      items: [],
      totalHuf: 0,
      coursesUrl: 'https://pelda.hu/kurzusaim',
      invoiceNote: false,
      withdrawalWaiverAt: 'nem-datum',
    })
    expect(hibas.text).toContain(
      'Az elállási jogodról: a rendelésed leadásakor két nyilatkozatot tettél.',
    )
  })

  it('melléklet nélkül csak a link áll, és a levél nem állítja, hogy csatoltuk', () => {
    const linkkel = orderConfirmationEmail({
      orderNumber: ORDER_NUMBER,
      items: [],
      totalHuf: 0,
      coursesUrl: 'https://pelda.hu/kurzusaim',
      invoiceNote: false,
      terms: { url: 'https://pelda.hu/aszf', attachment: null },
    })
    expect(linkkel.attachments).toBeUndefined()
    expect(linkkel.text).toContain(
      'a teljes szövegét a weboldalon olvashatod: https://pelda.hu/aszf',
    )
    expect(linkkel.text).not.toContain('mellékeltük')
  })

  it('szolgáltatói adatok nélkül a lábléc a megszokott „ne válaszolj" sor marad', () => {
    const regi = orderConfirmationEmail({
      orderNumber: ORDER_NUMBER,
      items: [],
      totalHuf: 0,
      coursesUrl: 'https://pelda.hu/kurzusaim',
      invoiceNote: false,
    })
    expect(regi.text).toContain('ne válaszolj')
    expect(regi.text).not.toContain('A szolgáltató adatai')
  })
})

/**
 * ŐR: a levél a pénztár jelölőnégyzeteinek SZÓ SZERINTI szövegét idézi. Ha a
 * pénztárban valaki átírja a nyilatkozatot, a levél már nem azt igazolná
 * vissza, amit a vevő elfogadott, ezért ez a teszt ilyenkor bukik.
 */
describe('a visszaigazolt nyilatkozat = a pénztárban elfogadott nyilatkozat', () => {
  const checkout = readFileSync(`${REPO_ROOT}src/components/checkout/CheckoutForm.tsx`, 'utf8')
  const normalized = checkout.replace(/\s+/g, ' ')

  it.each([
    ['azonnali hozzáférés kérése', WAIVER_START_STATEMENT],
    ['az elállási jog elvesztésének tudomásulvétele', WAIVER_LOSS_STATEMENT],
  ])('%s: a CheckoutForm.tsx pontosan ezt a szöveget jeleníti meg', (_nev, statement) => {
    expect(normalized).toContain(statement)
  })
})

// ---------------------------------------------------------------------------
// onOrderPaid: küldés, újrapróba, riasztás, bizonyíték
// ---------------------------------------------------------------------------

describe('onOrderPaid: a jogi visszaigazoló levél kiküldése', () => {
  it('a levél a nyilatkozatokkal, az ÁSZF-melléklettel és válaszcímmel megy, a küldés a műveletnaplóba kerül', async () => {
    const { send, calls } = createSender()
    const { store, created } = createAuditStore()
    const { log, entries } = createCapturingLogger()

    await onOrderPaid({
      payload: {} as unknown as Payload,
      order: createOrder(),
      logger: log,
      queueInvoice: async () => true,
      send,
      auditStore: store,
      loadAccessDurations: async () => new Map([[42, null]]),
      sleep: nemVarhat,
    })

    expect(calls).toHaveLength(1)
    const message = calls[0]
    expect(message.to).toBe('anna@example.test')
    expect(message.replyTo).toBe('egeszsegmozgastamogatas@gmail.com')
    expect(message.idempotencyKey).toBe('kineticare-order-confirmation-777')
    expect(message.attachments?.[0]?.filename).toBe(ASZF_MELLEKLET_FAJLNEV)
    expect(message.text).toContain(`„${WAIVER_START_STATEMENT}”`)
    expect(message.text).toContain(WAIVER_AT_BUDAPEST)
    expect(message.text).toContain('Adószám: 32697865-1-20')
    expect(message.text.replace(/ /g, ' ')).toContain('a hozzáférés nem jár le')

    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      action: ORDER_CONFIRMATION_AUDIT_ACTION,
      entityType: 'orders',
      entityId: '777',
      after: {
        orderNumber: ORDER_NUMBER,
        recipient: 'anna@example.test',
        provider: 'resend',
        providerMessageId: 're_123',
        attempts: 1,
        templateVersion: ORDER_CONFIRMATION_TEMPLATE_VERSION,
        withdrawalWaiverConfirmed: true,
        withdrawalWaiverAt: WAIVER_AT,
        sellerIncluded: true,
        aszfAttached: true,
        aszfSha256: LEGAL.aszf.sha256,
        aszfKelt: '2025. 07.05.',
      },
    })
    const after = created[0].after as Record<string, unknown>
    expect(after.aszfSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(typeof after.sentAt).toBe('string')
    expect(errorsOf(entries)).toHaveLength(0)
  })

  it('nyilatkozat nélküli rendelés: nincs visszaigazolt nyilatkozat, és a napló is ezt rögzíti', async () => {
    const { send, calls } = createSender()
    const { store, created } = createAuditStore()

    await onOrderPaid({
      payload: {} as unknown as Payload,
      order: createOrder({ consentWithdrawalWaiver: false, consentWithdrawalWaiverAt: null }),
      logger: createCapturingLogger().log,
      queueInvoice: async () => true,
      send,
      auditStore: store,
      loadAccessDurations: async () => new Map(),
      sleep: nemVarhat,
    })

    expect(calls[0].text).not.toContain('Az elállási jogodról')
    expect(created[0]).toMatchObject({
      after: { withdrawalWaiverConfirmed: false, withdrawalWaiverAt: null },
    })
  })

  it('átmeneti hiba: újrapróbál ugyanazzal az idempotencia-kulccsal, 2 és 6 mp várakozással', async () => {
    const { send, calls } = createSender([
      { ok: false, provider: 'resend', retryable: true, error: 'HTTP 503' },
      { ok: false, provider: 'resend', retryable: true, error: 'HTTP 429' },
      { ok: true, provider: 'resend', id: 're_retry' },
    ])
    const { store, created } = createAuditStore()
    const { log, entries } = createCapturingLogger()
    const waits: number[] = []

    await onOrderPaid({
      payload: {} as unknown as Payload,
      order: createOrder(),
      logger: log,
      queueInvoice: async () => true,
      send,
      auditStore: store,
      loadAccessDurations: async () => new Map(),
      sleep: async (ms) => {
        waits.push(ms)
      },
    })

    expect(calls).toHaveLength(3)
    expect(new Set(calls.map((call) => call.idempotencyKey)).size).toBe(1)
    expect(waits).toEqual([...CONFIRMATION_RETRY_DELAYS_MS])
    expect(waits).toEqual([2_000, 6_000])
    expect(created[0]).toMatchObject({ after: { attempts: 3, providerMessageId: 're_retry' } })
    expect(errorsOf(entries)).toHaveLength(0)
  })

  it('végleges hiba (retryable: false): nem próbálja újra, RIASZT, és nem rögzít küldést', async () => {
    const { send, calls } = createSender([
      { ok: false, provider: 'resend', retryable: false, error: 'HTTP 422' },
    ])
    const { store, created } = createAuditStore()
    const { log, entries } = createCapturingLogger()

    await onOrderPaid({
      payload: {} as unknown as Payload,
      order: createOrder(),
      logger: log,
      queueInvoice: async () => true,
      send,
      auditStore: store,
      loadAccessDurations: async () => new Map(),
      sleep: nemVarhat,
    })

    expect(calls).toHaveLength(1)
    expect(created).toHaveLength(0)
    const alerts = errorsOf(entries)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].msg).toContain('RIASZTÁS')
    expect(alerts[0].msg).toContain('18. §')
    expect(alerts[0].context).toMatchObject({ attempts: 1, retryable: false })
  })

  it('minden kísérlet elbukik: 3 próba után egyetlen RIASZTÁS, küldés nincs rögzítve', async () => {
    const { send, calls } = createSender([
      { ok: false, provider: 'resend', retryable: true, error: 'HTTP 500' },
    ])
    const { store, created } = createAuditStore()
    const { log, entries } = createCapturingLogger()

    await onOrderPaid({
      payload: {} as unknown as Payload,
      order: createOrder(),
      logger: log,
      queueInvoice: async () => true,
      send,
      auditStore: store,
      loadAccessDurations: async () => new Map(),
      sleep: async () => {},
    })

    expect(calls).toHaveLength(1 + CONFIRMATION_RETRY_DELAYS_MS.length)
    expect(created).toHaveLength(0)
    const alerts = errorsOf(entries)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].context).toMatchObject({ attempts: 3 })
  })

  it('élesben a noop-szolgáltató NEM visszaigazolás: RIASZT, és nem rögzít küldést', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { send } = createSender([{ ok: true, provider: 'noop' }])
    const { store, created } = createAuditStore()
    const { log, entries } = createCapturingLogger()

    await onOrderPaid({
      payload: {} as unknown as Payload,
      order: createOrder(),
      logger: log,
      queueInvoice: async () => true,
      send,
      auditStore: store,
      loadAccessDurations: async () => new Map(),
      sleep: nemVarhat,
    })

    expect(created).toHaveLength(0)
    const alerts = errorsOf(entries)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].msg).toContain('nincs e-mail-szolgáltató beállítva')
  })

  it('fejlesztői környezetben a noop csak szimuláció: nincs riasztás és nincs napló-bejegyzés', async () => {
    const { send } = createSender([{ ok: true, provider: 'noop' }])
    const { store, created } = createAuditStore()
    const { log, entries } = createCapturingLogger()

    await onOrderPaid({
      payload: {} as unknown as Payload,
      order: createOrder(),
      logger: log,
      queueInvoice: async () => true,
      send,
      auditStore: store,
      loadAccessDurations: async () => new Map(),
      sleep: nemVarhat,
    })

    expect(created).toHaveLength(0)
    expect(errorsOf(entries)).toHaveLength(0)
  })

  it('olvashatatlan ÁSZF: a levél kimegy (nyilatkozatokkal), de melléklet nélkül, és RIASZT', async () => {
    const { send, calls } = createSender()
    const { store, created } = createAuditStore()
    const { log, entries } = createCapturingLogger()

    await onOrderPaid({
      payload: {} as unknown as Payload,
      order: createOrder(),
      logger: log,
      queueInvoice: async () => true,
      send,
      auditStore: store,
      loadAccessDurations: async () => new Map(),
      loadLegalInfo: () => {
        throw new Error('ENOENT: aszf.txt')
      },
      sleep: nemVarhat,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].attachments).toBeUndefined()
    expect(calls[0].replyTo).toBeUndefined()
    expect(calls[0].text).toContain('Az elállási jogodról')
    expect(created[0]).toMatchObject({
      after: { aszfAttached: false, sellerIncluded: false, aszfSha256: null },
    })
    const alerts = errorsOf(entries)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].msg).toContain('az ÁSZF nem olvasható')
  })

  it('hiányos ÁSZF-adatblokk: a szolgáltatói blokk kimarad (nem találunk ki adatot), és RIASZT', async () => {
    const { send, calls } = createSender()
    const { store } = createAuditStore()
    const { log, entries } = createCapturingLogger()

    await onOrderPaid({
      payload: {} as unknown as Payload,
      order: createOrder(),
      logger: log,
      queueInvoice: async () => true,
      send,
      auditStore: store,
      loadAccessDurations: async () => new Map(),
      loadLegalInfo: () => orderLegalInfoFromAszf(ASZF.replace(/Adószám:[^\n]*\n/u, '')),
      sleep: nemVarhat,
    })

    expect(calls[0].text).not.toContain('A szolgáltató adatai')
    expect(calls[0].attachments).toHaveLength(1)
    const alerts = errorsOf(entries)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].msg).toContain('KINETICARE adatai')
  })

  it('ha a bizonyíték nem kerül a műveletnaplóba, az is RIASZTÁS (a levél ettől kiment)', async () => {
    const { send, calls } = createSender()
    const { store } = createAuditStore(true)
    const { log, entries } = createCapturingLogger()
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await onOrderPaid({
      payload: {} as unknown as Payload,
      order: createOrder(),
      logger: log,
      queueInvoice: async () => true,
      send,
      auditStore: store,
      loadAccessDurations: async () => new Map(),
      sleep: nemVarhat,
    })

    expect(calls).toHaveLength(1)
    const alerts = errorsOf(entries)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].msg).toContain('bizonyítéka nem került a műveletnaplóba')
    expect(alerts[0].context).toMatchObject({ providerMessageId: 're_123' })
    vi.restoreAllMocks()
  })

  it('kivételt dobó küldő: nem dob tovább, de error-szintű RIASZTÁS lesz (nem csendes warn)', async () => {
    const { log, entries } = createCapturingLogger()

    await expect(
      onOrderPaid({
        payload: {} as unknown as Payload,
        order: createOrder(),
        logger: log,
        queueInvoice: async () => true,
        send: async () => {
          throw new Error('váratlan')
        },
        auditStore: createAuditStore().store,
        loadAccessDurations: async () => new Map(),
        sleep: nemVarhat,
      }),
    ).resolves.toBeUndefined()

    const alerts = errorsOf(entries)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].msg).toContain('kivétellel leállt')
  })
})

describe('onOrderPaid: a hozzáférés hossza a termékből', () => {
  it('az alapértelmezett lekérdezés a products collectionből, csak a szükséges mezővel olvas', async () => {
    const find = vi.fn(async () => ({ docs: [{ id: 42, accessDurationDays: 30 }] }))
    const { send, calls } = createSender([{ ok: true, provider: 'noop' }])

    await onOrderPaid({
      payload: { find } as unknown as Payload,
      order: createOrder(),
      logger: createCapturingLogger().log,
      queueInvoice: async () => true,
      send,
      sleep: nemVarhat,
    })

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'products',
        where: { id: { in: [42] } },
        depth: 0,
        overrideAccess: true,
        select: { accessDurationDays: true },
      }),
    )
    expect(calls[0].text).toContain('30 napos hozzáférés')
  })

  it('populate-olt terméknél nem kérdez le, a dokumentum mezőjét használja', async () => {
    const { send, calls } = createSender([{ ok: true, provider: 'noop' }])
    const load = vi.fn(async () => new Map<number, number | null>())

    await onOrderPaid({
      payload: {} as unknown as Payload,
      order: createOrder({
        items: [
          {
            product: { id: 42, accessDurationDays: null },
            quantity: 1,
            titleSnapshot: 'Otthoni KézRehab',
            priceHufSnapshot: 19990,
          },
        ] as unknown as Order['items'],
      }),
      logger: createCapturingLogger().log,
      queueInvoice: async () => true,
      send,
      loadAccessDurations: load,
      sleep: nemVarhat,
    })

    expect(load).not.toHaveBeenCalled()
    expect(calls[0].text.replace(/ /g, ' ')).toContain('a hozzáférés nem jár le')
  })

  it('lekérdezési hibánál a levél kimegy, és nem állít semmit a hozzáférés hosszáról', async () => {
    const { send, calls } = createSender([{ ok: true, provider: 'noop' }])
    const { log, entries } = createCapturingLogger()

    await onOrderPaid({
      payload: {} as unknown as Payload,
      order: createOrder(),
      logger: log,
      queueInvoice: async () => true,
      send,
      loadAccessDurations: async () => {
        throw new Error('DB nem elérhető')
      },
      sleep: nemVarhat,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].text).not.toContain('hozzáférés nem jár le')
    expect(calls[0].text).not.toContain('napos hozzáférés')
    expect(entries.some((entry) => entry.level === 'warn')).toBe(true)
    expect(errorsOf(entries)).toHaveLength(0)
  })
})

describe('loadOrderLegalInfo: a futásidejű forrás', () => {
  it('a repó gyökeréből (process.cwd()) a valódi aszf.txt-t olvassa', () => {
    const legal = loadOrderLegalInfo()
    expect(legal.seller?.name).toBe('KINETICARE Kft.')
    expect(legal.aszf.sha256).toBe(LEGAL.aszf.sha256)
  })

  it('olvasási hibánál DOB (a hívó riaszt), nem ad vissza üres adatot', () => {
    expect(() =>
      loadOrderLegalInfo(() => {
        throw new Error('ENOENT')
      }),
    ).toThrow('ENOENT')
  })
})
