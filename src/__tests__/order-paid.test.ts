import type { Payload } from 'payload'
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { KAPCSOLATI_EMAIL_TARTALEK } from '../lib/contact-email'
import { orderConfirmationEmail } from '../lib/email/templates/order'
import { JOGI_OLDALAK, jogiOldalTartalom } from '../lib/legal-content'
import { GUEST_ACTIVATION_TOKEN_TTL_MS } from '../lib/security/activation-token'
import type { LogContext, Logger } from '../lib/logger'
import {
  onOrderPaid as onOrderPaidEredeti,
  queueInvoiceIssueJob,
  type OnOrderPaidDeps,
} from '../lib/order-paid'
import { getSzamlazzConfig, isSzamlazzEnabled } from '../lib/szamlazz'
import type { Order } from '../payload-types'

/**
 * A levél az ÁSZF-et a KÖZZÉTETT /aszf oldalból, a válaszcímet a Kapcsolat
 * oldalból olvassa (H10, K14). Ezek a tesztek nem erről szólnak, ezért a mai
 * éles állapotot injektálják: így a hiányzó adatbázis tartalék-ágának (fojtott)
 * riasztása nem keveredik a mért riasztások közé, és a tesztek sorrendje sem
 * számít.
 */
const PUBLIKALT_ASZF = jogiOldalTartalom(
  JOGI_OLDALAK.find((oldal) => oldal.slug === 'aszf') ?? JOGI_OLDALAK[0],
)
const onOrderPaid = (deps: OnOrderPaidDeps): Promise<void> =>
  onOrderPaidEredeti({
    loadPublishedAszf: async () => ({ content: PUBLIKALT_ASZF }),
    loadSupportEmail: async () => KAPCSOLATI_EMAIL_TARTALEK,
    ...deps,
  })

/**
 * W4-03 visszaigazoló e-mail + a friss paid-átmenet mellékhatásainak tesztjei.
 * A küldés és a job-queue injektált — nincs valódi e-mail vagy job-rendszer.
 */

const ORDER_NUMBER = 'KH-2026-000123'

describe('orderConfirmationEmail sablon', () => {
  const template = orderConfirmationEmail({
    orderNumber: ORDER_NUMBER,
    buyerName: 'Teszt Anna <script>',
    items: [
      { title: 'DEMO-KEZREHAB-001', quantity: 1, totalHuf: 19990 },
      { title: 'Második kurzus', quantity: 2, totalHuf: 29980 },
    ],
    totalHuf: 49970,
    coursesUrl: 'https://staging.example.test/kurzusaim',
    invoiceNote: true,
  })

  it('tárgy a rendelésszámmal, magyar szöveg, CTA a kurzusaimra', () => {
    // §3.1.1: címke + érték kettősponttal, nem kvirtmínusszal.
    expect(template.subject).toBe(`Sikeres vásárlás: ${ORDER_NUMBER}`)
    expect(template.html).toContain(ORDER_NUMBER)
    expect(template.html).toContain('https://staging.example.test/kurzusaim')
    expect(template.text).toContain(ORDER_NUMBER)
    expect(template.text).toContain('https://staging.example.test/kurzusaim')
  })

  it('tételek és végösszeg (formázott HUF) szerepel', () => {
    const normalizedText = template.text.replace(/ /g, ' ')
    expect(normalizedText).toContain('DEMO-KEZREHAB-001, 1 db')
    expect(normalizedText).toContain('Második kurzus, 2 db')
    expect(normalizedText).toContain('49 970')
  })

  it('a vevő neve escape-elve (XSS-biztos e-mail)', () => {
    expect(template.html).not.toContain('<script>')
    expect(template.html).toContain('&lt;script&gt;')
  })

  it('invoiceNote=true esetén a számla-hivatkozás bekerül; false esetén nem', () => {
    expect(template.html).toContain('Számlázz.hu')
    const without = orderConfirmationEmail({
      orderNumber: ORDER_NUMBER,
      items: [],
      totalHuf: 0,
      coursesUrl: 'https://x.test/kurzusaim',
      invoiceNote: false,
    })
    expect(without.html).not.toContain('Számlázz.hu')
  })
})

// ---------------------------------------------------------------------------
// onOrderPaid — a mellékhatás-orchestrátor
// ---------------------------------------------------------------------------

function createOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 101,
    orderNumber: ORDER_NUMBER,
    status: 'paid',
    customerEmail: 'anna@example.test',
    totalHufSnapshot: 19990,
    items: [
      { product: 42, quantity: 1, titleSnapshot: 'DEMO-KEZREHAB-001', priceHufSnapshot: 19990 },
    ],
    customerSnapshot: { name: 'Teszt Anna', email: 'anna@example.test' },
    ...overrides,
  } as unknown as Order
}

describe('onOrderPaid', () => {
  it('sorba állítja az invoice-jobot ÉS kiküldi a visszaigazoló e-mailt a snapshotból', async () => {
    const queued: number[] = []
    const sent: Array<{ to: string; subject: string; text: string }> = []

    await onOrderPaid({
      payload: {} as never,
      order: createOrder(),
      queueInvoice: async (orderId) => {
        queued.push(orderId)
        return true
      },
      send: async (input) => {
        sent.push({ to: input.to, subject: input.subject, text: input.text })
        return { ok: true, provider: 'noop' }
      },
    })

    expect(queued).toEqual([101])
    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toBe('anna@example.test')
    expect(sent[0]?.subject).toContain(ORDER_NUMBER)
    expect(sent[0]?.text).toContain('DEMO-KEZREHAB-001')
  })

  it('queue-hiba esetén az e-mail akkor is kimegy (best-effort, nem dob)', async () => {
    const sent: string[] = []
    await onOrderPaid({
      payload: {} as never,
      order: createOrder(),
      queueInvoice: async () => {
        throw new Error('queue nem elérhető')
      },
      send: async (input) => {
        sent.push(input.to)
        return { ok: true, provider: 'noop' }
      },
    })
    expect(sent).toEqual(['anna@example.test'])
  })

  it('e-mail-küldési hiba (ok:false): újrapróbálja, végül RIASZT, de nem dob', async () => {
    const { log, entries } = createCapturingLogger()
    const send = vi.fn(async () => ({
      ok: false,
      provider: 'smtp' as const,
      retryable: true,
      error: 'SMTP down',
    }))
    await expect(
      onOrderPaid({
        payload: {} as never,
        order: createOrder(),
        logger: log,
        queueInvoice: async () => true,
        send,
        sleep: async () => {},
      }),
    ).resolves.toBeUndefined()
    expect(send).toHaveBeenCalledTimes(3)
    const alerts = entries.filter((entry) => entry.level === 'error')
    expect(alerts).toHaveLength(1)
    expect(alerts[0].msg).toContain('RIASZTÁS')
    expect(alerts[0].msg).toContain('visszaigazoló e-mail NEM ment ki')
  })

  it('címzett nélküli rendelésnél az e-mail kimarad (a job ettől megy)', async () => {
    const queued: number[] = []
    const sent: string[] = []
    const order = createOrder({ customerEmail: null, customerSnapshot: {} })
    await onOrderPaid({
      payload: {} as never,
      order,
      queueInvoice: async (orderId) => {
        queued.push(orderId)
        return true
      },
      send: async (input) => {
        sent.push(input.to)
        return { ok: true, provider: 'noop' }
      },
    })
    expect(queued).toEqual([101])
    expect(sent).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Vendég-vásárlás: a visszaigazoló levél HÁROM változata
// ---------------------------------------------------------------------------

/**
 * A vendég-vásárlás után a levél AKTIVÁLÓ levél is: a most létrehozott (vagy
 * még jelszó nélküli) fiókhoz jelszó-beállító linket visz. Meglévő, működő
 * fióknál viszont jelszó-beállítót SZÁNDÉKOSAN nem küldünk — ott a belépésre
 * irányítunk. A link TITOK: sem a token, sem a teljes link nem kerülhet naplóba.
 */

// DUMMY érték, egyértelműen jelölve — NEM valódi Payload reset-token.
const ACTIVATION_TOKEN = 'DUMMY-AKTIVALO-TOKEN-NEM-VALODI'
const ACTIVATION_URL = `https://shop.example.test/jelszo-visszaallitas?token=${ACTIVATION_TOKEN}`

const logOutput = (spy: MockInstance<(...args: unknown[]) => void>): string =>
  spy.mock.calls.map((call) => call.map((arg) => String(arg)).join(' ')).join('\n')

/** Hangosan dobó link-készítő: ahol linknek NEM szabad készülnie. */
const nemKeszulhetLink = async (): Promise<string | null> => {
  throw new Error('TESZT: ezen az ágon NEM szabad aktiváló linket készíteni')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('onOrderPaid — a levél változata a fiók állapotából', () => {
  it('MOST létrehozott (jelszó nélküli) fiók → aktiváló levél a jelszó-beállító linkkel', async () => {
    const sent: Array<{ subject: string; html: string; text: string }> = []

    await onOrderPaid({
      payload: {} as never,
      order: createOrder(),
      queueInvoice: async () => true,
      account: { passwordSetupPending: true, alreadyLinked: false, email: 'anna@example.test' },
      createActivationUrl: async () => ACTIVATION_URL,
      send: async (input) => {
        sent.push({ subject: input.subject, html: input.html, text: input.text })
        return { ok: true, provider: 'noop' }
      },
    })

    expect(sent).toHaveLength(1)
    expect(sent[0].text).toContain(ACTIVATION_URL)
    expect(sent[0].text).toContain('Beállítom az új jelszót')
    expect(sent[0].text).toContain('fiókot készítettünk')
    // Generált jelszó SOHA nem mehet ki levélben — csak a link.
    expect(sent[0].text).not.toMatch(/jelszavad:|ideiglenes jelszó/i)
  })

  it('MEGLÉVŐ, működő fiók (vendégként vásárolt) → belépés-link, jelszó-beállító NÉLKÜL', async () => {
    const sent: Array<{ text: string }> = []

    await onOrderPaid({
      payload: {} as never,
      order: createOrder(),
      queueInvoice: async () => true,
      account: { passwordSetupPending: false, alreadyLinked: false, email: 'anna@example.test' },
      // Ezen az ágon link-készítésnek NEM szabad futnia.
      createActivationUrl: nemKeszulhetLink,
      send: async (input) => {
        sent.push({ text: input.text })
        return { ok: true, provider: 'noop' }
      },
    })

    expect(sent).toHaveLength(1)
    expect(sent[0].text).toContain('/belepes')
    expect(sent[0].text).toContain('már elérhető a meglévő fiókodban')
    expect(sent[0].text).not.toContain('jelszo-visszaallitas')
  })

  it('BEJELENTKEZETT vásárlás → a levél változatlan (Kurzusaim CTA)', async () => {
    const sent: Array<{ text: string }> = []

    await onOrderPaid({
      payload: {} as never,
      order: createOrder(),
      queueInvoice: async () => true,
      account: { passwordSetupPending: false, alreadyLinked: true, email: 'anna@example.test' },
      createActivationUrl: nemKeszulhetLink,
      send: async (input) => {
        sent.push({ text: input.text })
        return { ok: true, provider: 'noop' }
      },
    })

    expect(sent[0].text).toContain('Kezdd el a kurzust')
    expect(sent[0].text).toContain('/kurzusaim/42')
    expect(sent[0].text).not.toContain('/belepes')
    expect(sent[0].text).not.toContain('jelszo-visszaallitas')
  })

  it('ha az aktiváló link NEM készül el, a levél akkor is kimegy (belépés-linkkel)', async () => {
    const sent: Array<{ text: string }> = []

    await onOrderPaid({
      payload: {} as never,
      order: createOrder(),
      queueInvoice: async () => true,
      account: { passwordSetupPending: true, alreadyLinked: false, email: 'anna@example.test' },
      createActivationUrl: async () => null,
      send: async (input) => {
        sent.push({ text: input.text })
        return { ok: true, provider: 'noop' }
      },
    })

    expect(sent).toHaveLength(1)
    expect(sent[0].text).toContain('/belepes')
    expect(sent[0].text).toContain('Elfelejtett jelszó')
  })

  it('az alapértelmezett link-készítő a Payload forgotPassword-jét használja (7 napos, e-mail nélkül)', async () => {
    const forgotPassword = vi.fn(async () => ACTIVATION_TOKEN)
    const sent: Array<{ text: string }> = []
    process.env.NEXT_PUBLIC_SERVER_URL = 'https://shop.example.test'

    await onOrderPaid({
      payload: { forgotPassword } as unknown as Payload,
      order: createOrder(),
      queueInvoice: async () => true,
      account: { passwordSetupPending: true, alreadyLinked: false, email: 'anna@example.test' },
      send: async (input) => {
        sent.push({ text: input.text })
        return { ok: true, provider: 'noop' }
      },
    })

    expect(forgotPassword).toHaveBeenCalledWith({
      collection: 'users',
      data: { email: 'anna@example.test' },
      disableEmail: true,
      expiration: GUEST_ACTIVATION_TOKEN_TTL_MS,
    })
    expect(sent[0].text).toContain(
      `https://shop.example.test/jelszo-visszaallitas?token=${ACTIVATION_TOKEN}`,
    )
    expect(sent[0].text).toContain('7 napig érvényes')
  })

  it('a NAPLÓ sem a tokent, sem a teljes linket nem tartalmazza', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await onOrderPaid({
      payload: {
        forgotPassword: async () => ACTIVATION_TOKEN,
      } as unknown as Payload,
      order: createOrder(),
      queueInvoice: async () => true,
      account: { passwordSetupPending: true, alreadyLinked: false, email: 'anna@example.test' },
      send: async () => ({ ok: true, provider: 'noop' }),
    })

    const output = logOutput(logSpy)
    expect(output).not.toContain(ACTIVATION_TOKEN)
    expect(output).not.toContain('jelszo-visszaallitas')
  })
})

// ---------------------------------------------------------------------------
// A visszaigazoló levelet nem viheti el egy SZÁMLÁZÁSI konfighiba
// ---------------------------------------------------------------------------

/**
 * REGRESSZIÓS ŐR egy VALÓS élesítési pillanatra (2026-08-17). Amikor a
 * Számla Agent kulcsa már be van állítva, de az áfakulcs még könyvelői
 * döntésre vár, a `getSzamlazzConfig()` SZÁNDÉKOSAN dob. Az `onOrderPaid`
 * viszont best-effort try/catch-ben küldi a levelet — ha a levél tartalma a
 * dobó konfigfeloldásból jönne, ez a dobás CSENDBEN elvinné a vásárló
 * EGYETLEN visszajelzését a sikeres fizetésről.
 *
 * A teszt ELŐBB bizonyítja, hogy a veszély valódi (a konfigfeloldás tényleg
 * dob ebben a környezetben), és csak UTÁNA várja el, hogy a levél mégis
 * kimenjen — különben egy későbbi „a konfig már nem dob" változtatás némán
 * kiürítené az őrt.
 */
describe('onOrderPaid — számlázási konfighiba mellett is kimegy a levél', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('agent-kulcs beállítva, áfakulcs hiányzik: a levél kimegy, benne a számla-ígéret', async () => {
    // DUMMY érték, egyértelműen jelölve — NEM valódi Számla Agent kulcs.
    vi.stubEnv('SZAMLAZZ_AGENT_KEY', 'DUMMY-AGENT-KULCS-NEM-VALODI')
    vi.stubEnv('SZAMLAZZ_AFAKULCS', '')

    // 1. A veszély valódi: ebben a környezetben a konfigfeloldás dob.
    expect(() => getSzamlazzConfig()).toThrow(/SZAMLAZZ_AFAKULCS/)
    // 2. A be/ki kérdés viszont dobás nélkül is megválaszolható.
    expect(isSzamlazzEnabled()).toBe(true)

    // 3. És a levél emiatt épségben kimegy, a számla-ígérettel együtt.
    const sent: Array<{ to: string; html: string }> = []
    await onOrderPaid({
      payload: {} as never,
      order: createOrder(),
      queueInvoice: async () => true,
      send: async (input) => {
        sent.push({ to: input.to, html: input.html })
        return { ok: true, provider: 'noop' }
      },
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toBe('anna@example.test')
    expect(sent[0]?.html).toContain('Számlázz.hu')
  })

  it('agent-kulcs nélkül nincs számla-ígéret a levélben', async () => {
    vi.stubEnv('SZAMLAZZ_AGENT_KEY', '')

    expect(isSzamlazzEnabled()).toBe(false)

    const sent: string[] = []
    await onOrderPaid({
      payload: {} as never,
      order: createOrder(),
      queueInvoice: async () => true,
      send: async (input) => {
        sent.push(input.html)
        return { ok: true, provider: 'noop' }
      },
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]).not.toContain('Számlázz.hu')
  })
})

// ---------------------------------------------------------------------------
// P2 — a NÉMA számla-kimaradás nem maradhat néma
// ---------------------------------------------------------------------------

/**
 * A MÉRÉS, ami ezt az őrt kikényszerítette. A `queueInvoiceIssueJob` a
 * `payload.jobs.queue` meglétét STRUKTURÁLISAN (`as unknown as`) ellenőrzi,
 * mert a generált típusok nem ismerik az invoice-issue taskot — egy
 * Payload-frissítés tehát FORDÍTÁSI HIBA NÉLKÜL kapcsolhatja ki a számlázást.
 * A segéd ilyenkor `false`-szal lépett ki EGYETLEN naplósor nélkül, a hívó
 * (`onOrderPaid`) pedig eldobja a visszatérést: a vevő megkapja a levelet
 * (benne a számla ígéretével), számla viszont sosem készül, és semmi nem jelzi.
 *
 * Az őr azt méri, hogy a kiesés MOST hangos: `error`-szintű, magyar RIASZTÁS a
 * rendelés azonosítójával — injektált loggerrel ÉS logger nélkül (root-logger
 * fallback) is.
 */

interface CapturedLogEntry {
  level: 'debug' | 'info' | 'warn' | 'error'
  msg: string
  context?: LogContext
}

/** Naplóba író helyett gyűjtő Logger — a szint és a kontextus is mérhető. */
function createCapturingLogger(entries: CapturedLogEntry[] = []): {
  log: Logger
  entries: CapturedLogEntry[]
} {
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

describe('queueInvoiceIssueJob — a hiányzó job-sor RIASZTÁST ad, nem csendet', () => {
  it('payload.jobs nélkül: false + error-szintű RIASZTÁS a rendelés azonosítójával', async () => {
    const { log, entries } = createCapturingLogger()

    const queued = await queueInvoiceIssueJob({} as unknown as Payload, 101, log)

    expect(queued).toBe(false)
    const alerts = entries.filter((entry) => entry.level === 'error')
    expect(alerts).toHaveLength(1)
    expect(alerts[0].msg).toContain('RIASZTÁS')
    expect(alerts[0].msg).toContain('számlakiállítási job')
    expect(alerts[0].context).toMatchObject({ orderId: 101 })
  })

  it('a `jobs.queue` NEM függvény (pl. típusváltozás után) — szintén RIASZTÁS', async () => {
    const { log, entries } = createCapturingLogger()

    const queued = await queueInvoiceIssueJob(
      { jobs: { queue: 'ez nem függvény' } } as unknown as Payload,
      202,
      log,
    )

    expect(queued).toBe(false)
    expect(entries.filter((entry) => entry.level === 'error')).toHaveLength(1)
  })

  it('logger NÉLKÜL is naplóz (root-logger fallback) — a kiesés sosem néma', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const queued = await queueInvoiceIssueJob({} as unknown as Payload, 303)

    expect(queued).toBe(false)
    const errorLines = logSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('"level":"error"'))
    expect(errorLines).toHaveLength(1)
    expect(errorLines[0]).toContain('RIASZTÁS')
    expect(errorLines[0]).toContain('"orderId":303')
  })

  it('működő job-sor mellett NINCS riasztás (negatív kontroll)', async () => {
    const { log, entries } = createCapturingLogger()
    const queue = vi.fn(async () => ({ id: 1 }))

    const queued = await queueInvoiceIssueJob({ jobs: { queue } } as unknown as Payload, 404, log)

    expect(queued).toBe(true)
    expect(queue).toHaveBeenCalledTimes(1)
    expect(entries.filter((entry) => entry.level === 'error')).toHaveLength(0)
  })

  /**
   * A TELJES HÍVÁSI LÁNC az audit futtatott bizonyítéka szerint: az
   * `onOrderPaid` eldobja a `queueInvoice` visszatérését, tehát a levél kimegy
   * (a számla ígéretével), a számla viszont nem áll sorba. A levél KIMENETELE
   * szándékosan változatlan — ami változik: a kiesés MOST látszik a naplóban.
   */
  it('onOrderPaid job-sor nélkül: a levél kimegy, de a kiesés RIASZTÁST kap', async () => {
    const { log, entries } = createCapturingLogger()
    const sent: string[] = []

    await onOrderPaid({
      payload: {} as unknown as Payload,
      order: createOrder(),
      logger: log,
      send: async (input) => {
        sent.push(input.to)
        return { ok: true, provider: 'noop' }
      },
    })

    expect(sent).toEqual(['anna@example.test'])
    const alerts = entries.filter((entry) => entry.level === 'error')
    expect(alerts).toHaveLength(1)
    expect(alerts[0].msg).toContain('RIASZTÁS')
    expect(alerts[0].context).toMatchObject({ orderId: 101 })
  })
})
