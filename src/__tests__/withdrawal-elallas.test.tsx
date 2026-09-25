import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { NextRequest } from 'next/server'
import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))
vi.mock('../components/layout/NewsletterSignup', () => ({ NewsletterSignup: () => null }))

import { AccountView } from '../components/account/AccountView'
import { Footer } from '../components/layout/Footer'
import {
  WithdrawalForm,
  WithdrawalSuccess,
} from '../app/(frontend)/elallas/_components/WithdrawalForm'
import { resetAlertThrottle } from '../lib/alert-throttle'
import type { AuditLogStore } from '../lib/audit'
import type { RetryableMailInput } from '../lib/email/retry'
import type { SendResult } from '../lib/email/types'
import type { LogContext, Logger } from '../lib/logger'
import { SlidingWindowRateLimiter } from '../lib/security/rate-limit'
import { createWithdrawalHandler } from '../lib/withdrawal/route-handler'
import {
  WITHDRAWAL_RETRY_DELAYS_MS,
  submitWithdrawal,
  type SubmitWithdrawalDeps,
  type WithdrawalOrderMatch,
  type WithdrawalOutcome,
} from '../lib/withdrawal/service'
import type { Order, User } from '../payload-types'

/**
 * Az elállási funkció (45/2014. Korm. rendelet 22. § (1a)–(1c), hatályos
 * 2026. 06. 19-től): a nyilatkozat rögzítése, az átvételi elismervény, a
 * stáb-értesítő, a végpont kapui és a rá mutató linkek.
 *
 * Hálózat nincs: a küldő, a műveletnapló, a rendelés-keresés és a várakozás
 * injektált (CLAUDE.md 15. tanulság); a végpont-tesztek a feldolgozást is
 * helyettesítik, hogy a kapukat önmagukban mérjék.
 */

interface Naplosor {
  level: 'debug' | 'info' | 'warn' | 'error'
  msg: string
  context?: LogContext
}

function rogzitoLogger(): { log: Logger; sorok: Naplosor[] } {
  const sorok: Naplosor[] = []
  const ir =
    (level: Naplosor['level']) =>
    (msg: string, context?: LogContext): void => {
      sorok.push(context === undefined ? { level, msg } : { level, msg, context })
    }
  const log: Logger = {
    debug: ir('debug'),
    info: ir('info'),
    warn: ir('warn'),
    error: ir('error'),
    child: () => log,
  }
  return { log, sorok }
}

const riasztasok = (sorok: Naplosor[]): Naplosor[] => sorok.filter((sor) => sor.level === 'error')

function naploTar(fail = false): {
  store: AuditLogStore
  bejegyzesek: Array<Record<string, unknown>>
} {
  const bejegyzesek: Array<Record<string, unknown>> = []
  return {
    bejegyzesek,
    store: {
      create: async (args) => {
        if (fail) throw new Error('DB nem elérhető')
        bejegyzesek.push(args.data)
        return { id: bejegyzesek.length }
      },
    },
  }
}

function kuldo(eredmenyek: SendResult[] = [{ ok: true, provider: 'resend', id: 're_1' }]) {
  const hivasok: RetryableMailInput[] = []
  let index = 0
  const send = async (input: RetryableMailInput): Promise<SendResult> => {
    hivasok.push(input)
    const eredmeny = eredmenyek[Math.min(index, eredmenyek.length - 1)]
    index += 1
    return eredmeny
  }
  return { send, hivasok }
}

const nemVarhat = async (): Promise<void> => {
  throw new Error('TESZT: ezen az ágon NEM szabad újrapróbálni')
}

/** 22:30 UTC = 00:30 budapesti nyári idő, MÁSNAP: a naptári nap a zónán múlik. */
const BEERKEZES = new Date('2026-09-24T22:30:00.000Z')

const RENDELES: WithdrawalOrderMatch = {
  id: 501,
  orderNumber: 'KH-2026-000501',
  status: 'paid',
  customerEmail: 'Vevo@Example.test',
}

const ERTEKEK = {
  name: 'Teszt Vevő',
  orderReference: 'kh-2026-000501',
  email: 'vevo@example.test',
}

function futtat(felulir: Partial<SubmitWithdrawalDeps> = {}) {
  const { log, sorok } = rogzitoLogger()
  const { store, bejegyzesek } = naploTar()
  const { send, hivasok } = kuldo()
  const deps: SubmitWithdrawalDeps = {
    payload: {} as unknown as Payload,
    values: ERTEKEK,
    logger: log,
    env: {
      NODE_ENV: 'production',
      CONTACT_STAFF_EMAILS: 'stab@example.test, masik@example.test',
      NEXT_PUBLIC_SERVER_URL: 'https://kineticare.test/',
    },
    send,
    sleep: nemVarhat,
    now: () => BEERKEZES,
    newId: () => '0123abcd-4567-89ef-0123-456789abcdef',
    auditStore: store,
    findOrder: async () => RENDELES,
    loadSupportEmail: async () => 'info@kineticare.hu',
    ...felulir,
  }
  return { deps, sorok, bejegyzesek, hivasok, eredmeny: submitWithdrawal(deps) }
}

beforeEach(() => {
  resetAlertThrottle()
})

describe('submitWithdrawal: rögzítés, átvételi elismervény, stáb-értesítő', () => {
  it('rögzíti a nyilatkozatot, elismervényt küld a tartalommal és a két időponttal, értesíti a stábot', async () => {
    const { eredmeny, bejegyzesek, hivasok, sorok } = futtat()
    const outcome = await eredmeny

    expect(outcome).toEqual<WithdrawalOutcome>({
      reference: 'EL-0123ABCD45',
      receivedAt: BEERKEZES.toISOString(),
      recorded: true,
      receiptSent: true,
      staffNotified: true,
    })
    expect(bejegyzesek[0]).toMatchObject({
      action: 'withdrawal-request',
      entityType: 'orders',
      entityId: '501',
      after: {
        reference: 'EL-0123ABCD45',
        name: 'Teszt Vevő',
        orderReference: 'kh-2026-000501',
        email: 'vevo@example.test',
        receivedAt: BEERKEZES.toISOString(),
        orderFound: true,
        orderNumber: 'KH-2026-000501',
        emailMatchesOrder: true,
      },
    })
    expect(bejegyzesek[1]).toMatchObject({
      action: 'withdrawal-receipt-email',
      after: { reference: 'EL-0123ABCD45', recipient: 'vevo@example.test', attempts: 1 },
    })

    const [elismerveny, stab] = hivasok
    expect(elismerveny.to).toBe('vevo@example.test')
    expect(elismerveny.replyTo).toBe('info@kineticare.hu')
    expect(elismerveny.idempotencyKey).toBe(
      'withdrawal-receipt:0123abcd-4567-89ef-0123-456789abcdef',
    )
    // 22. § (1c): az elállás tartalma, valamint a megküldés napja és időpontja,
    // a szöveges ÉS a HTML-részben is (a levelezők a HTML-t mutatják).
    for (const resz of [elismerveny.text, elismerveny.html]) {
      expect(resz).toContain('Elállok a szerződéstől.')
      expect(resz).toContain('Teszt Vevő')
      expect(resz).toContain('kh-2026-000501')
      expect(resz).toContain('vevo@example.test')
      expect(resz).toContain('EL-0123ABCD45')
      expect(resz).toContain('2026. 09. 25. 00:30')
      expect(resz).toContain('Ezt az átvételi elismervényt 2026. 09. 25. 00:30-kor küldtük el.')
      expect(resz).toContain('https://kineticare.test/aszf')
      expect(resz).toContain('info@kineticare.hu')
    }

    expect(stab.to).toEqual(['stab@example.test', 'masik@example.test'])
    expect(stab.replyTo).toBe('vevo@example.test')
    expect(stab.idempotencyKey).toBe('withdrawal-staff:0123abcd-4567-89ef-0123-456789abcdef')
    // 23. § (1): 14 nap a beérkezéstől, budapesti naptár szerint (09. 25. + 14).
    expect(stab.text).toContain('legkésőbb 2026. 10. 09-ig')
    // Az állapot az admin feliratával, nem a belső kóddal („paid”).
    expect(stab.text).toContain('A rendelés megvan: KH-2026-000501, állapota: Fizetve.')
    expect(stab.text).toContain('Az átvételi elismervény kiment a vevőnek.')
    expect(riasztasok(sorok)).toEqual([])
  })

  // 23. § (1): 14 NAPTÁRI nap a budapesti beérkezési naptól, nem 14 × 24 óra.
  // Az óraátállítás hetében a 336 óra egy nappal elcsúszik: tavasszal a
  // 23:00–23:59 között beérkezett nyilatkozat határideje egy nappal KÉSŐBBI
  // lenne a törvényesnél (a stáb elkésne), ősszel a 00:00–00:59 közöttié
  // egy nappal korábbi.
  it.each([
    // 2027. 03. 15. 23:30 CET, az óraátállítás (03. 28.) a 14 napon belül.
    { beerkezes: '2027-03-15T22:30:00.000Z', hatarido: '2027. 03. 29' },
    { beerkezes: '2027-03-20T22:30:00.000Z', hatarido: '2027. 04. 03' },
    // 2026. 10. 12. 00:30 CEST, a visszaállítás (10. 25.) a 14 napon belül.
    { beerkezes: '2026-10-11T22:30:00.000Z', hatarido: '2026. 10. 26' },
    { beerkezes: '2026-10-19T22:30:00.000Z', hatarido: '2026. 11. 03' },
  ])(
    'óraátállításon át is a budapesti naptár szerint: $beerkezes -> $hatarido',
    async ({ beerkezes, hatarido }) => {
      const { eredmeny, hivasok } = futtat({ now: () => new Date(beerkezes) })
      await eredmeny
      const stab = hivasok.find((h) => h.idempotencyKey.startsWith('withdrawal-staff:'))
      expect(stab?.text).toContain(`legkésőbb ${hatarido}-ig`)
    },
  )

  it('átmeneti hibánál az elismervényt ugyanazzal a kulccsal újrapróbálja (1 és 3 mp)', async () => {
    const { send, hivasok } = kuldo([
      { ok: false, provider: 'resend', retryable: true, error: 'HTTP 503' },
      { ok: false, provider: 'resend', retryable: true, error: 'HTTP 429' },
      { ok: true, provider: 'resend', id: 're_2' },
    ])
    const varakozasok: number[] = []
    const { eredmeny } = futtat({
      send,
      sleep: async (ms) => {
        varakozasok.push(ms)
      },
    })

    expect((await eredmeny).receiptSent).toBe(true)
    const elismervenyek = hivasok.filter((h) => h.idempotencyKey.startsWith('withdrawal-receipt:'))
    expect(elismervenyek).toHaveLength(3)
    expect(new Set(elismervenyek.map((h) => h.idempotencyKey)).size).toBe(1)
    expect(new Set(elismervenyek.map((h) => h.text)).size).toBe(1)
    expect(varakozasok).toEqual([...WITHDRAWAL_RETRY_DELAYS_MS])
  })

  it('bizonytalan (SMTP) kézbesítésnél nincs újrapróba; RIASZT, és a stáb tudja, hogy pótolni kell', async () => {
    const { send, hivasok } = kuldo([
      { ok: false, provider: 'smtp', retryable: false, deliveryUncertain: true, error: 'x' },
      { ok: true, provider: 'smtp' },
    ])
    const { eredmeny, sorok } = futtat({ send })
    const outcome = await eredmeny

    expect(outcome).toMatchObject({ receiptSent: false, staffNotified: true, recorded: true })
    expect(hivasok.filter((h) => h.idempotencyKey.startsWith('withdrawal-receipt:'))).toHaveLength(
      1,
    )
    // A levél célba érhetett: a stáb előbb ellenőrizzen, ne pótoljon vakon
    // (az kettőzné), és a riasztás se kérjen feltétlen kézi küldést.
    expect(hivasok[1].text).toContain('kézbesítése bizonytalan')
    expect(hivasok[1].text).toContain('csak akkor küldd el kézzel, ha nem ért célba')
    expect(hivasok[1].text).not.toContain('NEM sikerült elküldeni')
    const [riasztas] = riasztasok(sorok)
    expect(riasztas.msg).toContain('22. § (1c)')
    expect(riasztas.msg).toContain('csak akkor küldd el kézzel, ha nem ért célba')
  })

  it('biztosan elbukott elismervénynél a stáb-levél kézi pótlást kér', async () => {
    const { send, hivasok } = kuldo([
      { ok: false, provider: 'resend', retryable: false, error: 'HTTP 422' },
      { ok: true, provider: 'resend', id: 're_stab' },
    ])
    const { eredmeny } = futtat({ send })
    expect(await eredmeny).toMatchObject({ receiptSent: false, staffNotified: true })
    expect(hivasok[1].text).toContain('NEM sikerült elküldeni a vevőnek: küldd el kézzel, még ma.')
  })

  it('visszatartott elismervénynél (spam-csapda): rögzít, a vevő címére nem megy levél, a stáb ellenőrzést és kézi elismervényt kér', async () => {
    const { eredmeny, bejegyzesek, hivasok, sorok } = futtat({ holdReceipt: true })

    expect(await eredmeny).toMatchObject({
      recorded: true,
      receiptSent: false,
      staffNotified: true,
    })
    expect(bejegyzesek.map((b) => b.action)).toEqual(['withdrawal-request'])
    expect(bejegyzesek[0]).toMatchObject({ after: { honeypotFilled: true } })
    expect(hivasok.map((h) => h.to)).toEqual([['stab@example.test', 'masik@example.test']])
    expect(hivasok[0].text).toContain('rejtett spam-csapda')
    expect(hivasok[0].text).toContain('küldd el kézzel az elismervényt még ma')
    expect(riasztasok(sorok)).toEqual([])
  })

  it('élesben a noop-szolgáltató nem elküldés: sem elismervény, sem stáb-levél nem számít kimentnek', async () => {
    const { send } = kuldo([{ ok: true, provider: 'noop' }])
    const { eredmeny, sorok, bejegyzesek } = futtat({ send })
    const outcome = await eredmeny

    expect(outcome).toMatchObject({ recorded: true, receiptSent: false, staffNotified: false })
    expect(bejegyzesek.map((b) => b.action)).toEqual(['withdrawal-request'])
    expect(riasztasok(sorok).map((s) => s.msg)).toEqual([
      expect.stringContaining('átvételi elismervény NEM ment ki'),
      expect.stringContaining('stáb-értesítő NEM ment ki'),
    ])
  })

  it('fejlesztői környezetben a noop szimulált küldés (nincs riasztás)', async () => {
    const { send } = kuldo([{ ok: true, provider: 'noop' }])
    const { eredmeny, sorok } = futtat({
      send,
      env: { NODE_ENV: 'development', CONTACT_STAFF_EMAILS: 'stab@example.test' },
    })
    expect(await eredmeny).toMatchObject({ receiptSent: true, staffNotified: true })
    expect(riasztasok(sorok)).toEqual([])
  })

  it('üres CONTACT_STAFF_EMAILS: az elismervény kimegy, a stáb helyett RIASZTÁS szól', async () => {
    const { eredmeny, sorok, hivasok } = futtat({ env: { NODE_ENV: 'production' } })
    expect(await eredmeny).toMatchObject({ receiptSent: true, staffNotified: false })
    expect(hivasok).toHaveLength(1)
    expect(riasztasok(sorok).map((s) => s.msg)).toEqual([
      expect.stringContaining('CONTACT_STAFF_EMAILS üres'),
    ])
  })

  it('szabad szöveges azonosítónál nem keres rendelést; a naplóbejegyzés a nyilatkozathoz kötött', async () => {
    const findOrder = vi.fn(async () => RENDELES)
    const { eredmeny, bejegyzesek, hivasok } = futtat({
      findOrder,
      values: { ...ERTEKEK, orderReference: '2026. szeptember 3., Otthoni KézRehab' },
    })
    await eredmeny
    expect(findOrder).not.toHaveBeenCalled()
    expect(bejegyzesek[0]).toMatchObject({
      entityType: 'withdrawal',
      entityId: 'EL-0123ABCD45',
      after: { orderFound: false, orderNumber: null },
    })
    expect(hivasok[1].text).toContain('keresd meg kézzel')
  })

  it('eltérő e-mail-cím: a stáb figyelmeztetést kap, a nyilatkozatot ettől még fogadjuk', async () => {
    const { eredmeny, hivasok } = futtat({
      findOrder: async () => ({ ...RENDELES, customerEmail: 'mas@example.test' }),
    })
    expect((await eredmeny).recorded).toBe(true)
    expect(hivasok[1].text).toContain('NEM egyezik')
  })

  it('a rendelés-keresés hibája nem akadály: a nyilatkozat rögzül és a levelek kimennek', async () => {
    const { eredmeny, bejegyzesek } = futtat({
      findOrder: async () => {
        throw new Error('DB nem elérhető')
      },
    })
    expect(await eredmeny).toMatchObject({ recorded: true, receiptSent: true, staffNotified: true })
    expect(bejegyzesek[0]).toMatchObject({ entityType: 'withdrawal' })
  })

  it('ha a műveletnapló nem írható, a levelek akkor is kimennek, és RIASZTÁS kéri a bizonyíték mentését', async () => {
    const { store } = naploTar(true)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { eredmeny, sorok } = futtat({ auditStore: store })
    expect(await eredmeny).toMatchObject({
      recorded: false,
      receiptSent: true,
      staffNotified: true,
    })
    expect(riasztasok(sorok).map((s) => s.msg)).toEqual([
      expect.stringContaining('Műveletnaplóba NEM került'),
    ])
    vi.restoreAllMocks()
  })
})

// ---------------------------------------------------------------------------
// A végpont kapui
// ---------------------------------------------------------------------------

function keres(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request('https://kineticare.test/api/elallas', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

const RENDBEN: WithdrawalOutcome = {
  reference: 'EL-1',
  receivedAt: BEERKEZES.toISOString(),
  recorded: true,
  receiptSent: true,
  staffNotified: true,
}

function vegpont(
  felulir: {
    submit?: (deps: SubmitWithdrawalDeps) => Promise<WithdrawalOutcome>
    env?: Record<string, string>
    verifyTurnstile?: (token: string | null) => Promise<boolean>
  } = {},
) {
  const submit = vi.fn(felulir.submit ?? (async () => RENDBEN))
  const { log, sorok } = rogzitoLogger()
  const handler = createWithdrawalHandler({
    getPayload: async () => ({}) as unknown as Payload,
    limiter: new SlidingWindowRateLimiter(),
    env: felulir.env ?? {},
    submit,
    logger: log,
    ...(felulir.verifyTurnstile ? { verifyTurnstile: felulir.verifyTurnstile } : {}),
  })
  return { handler, submit, sorok }
}

describe('POST /api/elallas: a végpont kapui', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('hiányzó adatnál 400, magyar mezőüzenetekkel, feldolgozás nélkül', async () => {
    const { handler, submit } = vegpont()
    const valasz = await handler(keres({ name: '', orderReference: '', email: 'nem-cim' }))
    expect(valasz.status).toBe(400)
    const { error } = (await valasz.json()) as { error: string }
    expect(error).toContain('Add meg a neved.')
    expect(error).toContain('Add meg a rendelésszámot')
    expect(error).toContain('Érvényes e-mail-címet adj meg')
    expect(submit).not.toHaveBeenCalled()
  })

  it('rendben lévő beküldés: 200, a vágott adatokkal fut a feldolgozás', async () => {
    const { handler, submit } = vegpont()
    const valasz = await handler(
      keres({
        name: '  Teszt\nVevő ',
        orderReference: ' KH-2026-000501 ',
        email: 'vevo@example.test',
      }),
    )
    expect(valasz.status).toBe(200)
    expect(await valasz.json()).toEqual({
      ok: true,
      reference: 'EL-1',
      receivedAt: BEERKEZES.toISOString(),
      receiptSent: true,
    })
    expect(submit.mock.calls[0][0].values).toEqual({
      name: 'Teszt Vevő',
      orderReference: 'KH-2026-000501',
      email: 'vevo@example.test',
    })
  })

  // Codex (PR #307): a spam-csapda mezőt a böngésző automatikus kitöltése is
  // kitöltheti, a jognyilatkozat ezért nem veszhet el egy látszólagos siker
  // mögött. Turnstile nélkül az elismervény a stáb ellenőrzéséig visszamarad.
  it.each<[string, Record<string, string>, boolean]>([
    ['Turnstile nélkül: rögzül, az elismervény visszamarad', {}, true],
    [
      'Turnstile-lal igazolt embernél: a szokásos feldolgozás',
      { TURNSTILE_SECRET_KEY: 'DUMMY-NEM-VALODI-TITOK' },
      false,
    ],
  ])(
    'kitöltött spam-csapda mező: a nyilatkozat nem vész el, %s',
    async (_eset, env, holdReceipt) => {
      const { handler, submit } = vegpont({ env, verifyTurnstile: async () => true })
      const valasz = await handler(keres({ ...ERTEKEK, website: 'https://autofill.example' }))
      expect(valasz.status).toBe(200)
      expect(await valasz.json()).toMatchObject({ ok: true, reference: 'EL-1' })
      expect(submit).toHaveBeenCalledTimes(1)
      expect(submit.mock.calls[0][0].holdReceipt).toBe(holdReceipt)
    },
  )

  it('ugyanarra a címre a 4. beküldés 10 percen belül 429 (levélbombázás ellen)', async () => {
    const { handler, submit } = vegpont()
    const statuszok: number[] = []
    for (let i = 0; i < 4; i += 1) {
      const valasz = await handler(
        keres({ ...ERTEKEK, email: 'VEVO@example.test' }, { 'x-forwarded-for': `203.0.113.${i}` }),
      )
      statuszok.push(valasz.status)
    }
    expect(statuszok).toEqual([200, 200, 200, 429])
    expect(submit).toHaveBeenCalledTimes(3)
  })

  it('a 429-es válasz is megadja az e-mailes utat (a jog gyakorlása nem várhat a keretre)', async () => {
    const { handler } = vegpont()
    let utolso: Response | null = null
    for (let i = 0; i < 4; i += 1) {
      utolso = await handler(keres(ERTEKEK, { 'x-forwarded-for': `203.0.113.${i}` }))
    }
    expect(utolso?.status).toBe(429)
    expect(((await utolso?.json()) as { error: string }).error).toContain(
      'e-mailben az info@kineticare.hu címre',
    )
  })

  it('a Turnstile-on elbukó kérések nem fogyasztják a vevő címkeretét (nem zárható ki idegen kérésekkel)', async () => {
    const { handler, submit } = vegpont({
      env: { TURNSTILE_SECRET_KEY: 'DUMMY-NEM-VALODI-TITOK' },
      verifyTurnstile: async (token) => token === 'valodi',
    })
    // Három idegen kérés a vevő címével, három különböző IP-ről, hamis tokennel.
    for (let i = 0; i < 3; i += 1) {
      const tamado = await handler(
        keres({ ...ERTEKEK, turnstileToken: 'hamis' }, { 'x-forwarded-for': `198.51.100.${i}` }),
      )
      expect(tamado.status).toBe(400)
    }
    const valasz = await handler(
      keres({ ...ERTEKEK, turnstileToken: 'valodi' }, { 'x-forwarded-for': '203.0.113.9' }),
    )
    expect(valasz.status).toBe(200)
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('Turnstile-secret mellett elutasított token: 400, és a hibaüzenet megadja az e-mailes utat', async () => {
    const verify = vi.fn(async () => false)
    const { handler, submit } = vegpont({
      env: { TURNSTILE_SECRET_KEY: 'DUMMY-NEM-VALODI-TITOK' },
      verifyTurnstile: verify,
    })
    const valasz = await handler(keres({ ...ERTEKEK, turnstileToken: 'rossz' }))
    expect(valasz.status).toBe(400)
    expect(((await valasz.json()) as { error: string }).error).toContain(
      'e-mailben az info@kineticare.hu címre',
    )
    expect(verify).toHaveBeenCalledWith('rossz')
    expect(submit).not.toHaveBeenCalled()
  })

  it('ha a nyilatkozatnak semmilyen tartós nyoma nincs, 503 (nem mondjuk, hogy megérkezett)', async () => {
    const { handler } = vegpont({
      submit: async () => ({
        ...RENDBEN,
        recorded: false,
        receiptSent: false,
        staffNotified: false,
      }),
    })
    const valasz = await handler(keres(ERTEKEK))
    expect(valasz.status).toBe(503)
    expect(((await valasz.json()) as { error: string }).error).toContain('info@kineticare.hu')
  })

  it('ha csak az elismervény nem ment ki, a nyilatkozat megérkezett: 200, receiptSent: false', async () => {
    const { handler } = vegpont({ submit: async () => ({ ...RENDBEN, receiptSent: false }) })
    const valasz = await handler(keres(ERTEKEK))
    expect(valasz.status).toBe(200)
    expect(await valasz.json()).toMatchObject({ ok: true, receiptSent: false })
  })

  it('a feldolgozás kivétele: 503 és RIASZTÁS', async () => {
    const { handler, sorok } = vegpont({
      submit: async () => {
        throw new Error('váratlan')
      },
    })
    expect((await handler(keres(ERTEKEK))).status).toBe(503)
    expect(riasztasok(sorok)[0].msg).toContain('RIASZTÁS')
  })
})

// ---------------------------------------------------------------------------
// A funkció elérhetősége: lábléc, fiók, űrlap
// ---------------------------------------------------------------------------

describe('az elállási funkció elérhetősége (22. § (1b))', () => {
  it('a lábléc minden oldalon a rendelet szövegével linkel a funkcióra', () => {
    const html = renderToStaticMarkup(createElement(Footer))
    expect(html).toMatch(/<a[^>]*href="\/elallas"[^>]*>Elállás a szerződéstől<\/a>/)
  })

  it('a fiókban a fizetett rendelésnél előtöltött rendelésszámmal linkel, a nem fizetettnél nem', () => {
    const user = { id: 1, email: 'vevo@example.test', name: 'Teszt Vevő' } as unknown as User
    const rendeles = (status: string, orderNumber: string) =>
      ({ id: orderNumber, orderNumber, status, totalHufSnapshot: 19990 }) as unknown as Order
    const html = renderToStaticMarkup(
      createElement(AccountView, {
        user,
        orders: [rendeles('paid', 'KH-2026-000501'), rendeles('refunded', 'KH-2026-000502')],
      }),
    )
    expect(html).toContain('href="/elallas?rendeles=KH-2026-000501"')
    expect(html).not.toContain('rendeles=KH-2026-000502')
    expect(html.match(/>Elállás a szerződéstől</g)).toHaveLength(1)
  })

  it('az űrlap a három adatot kéri, előtölti a rendelésszámot, a gombja „Elállás megerősítése”', () => {
    const html = renderToStaticMarkup(
      createElement(WithdrawalForm, {
        initialOrderReference: 'KH-2026-000501',
        turnstileSiteKey: null,
        supportEmail: 'info@kineticare.hu',
      }),
    )
    expect(html).toMatch(/<input[^>]*autoComplete="name"|<input[^>]*autocomplete="name"/i)
    expect(html).toMatch(
      /name="orderReference"[^>]*value="KH-2026-000501"|value="KH-2026-000501"[^>]*name="orderReference"/,
    )
    expect(html).toMatch(/type="email"/)
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Elállás megerősítése<\/button>/)
    // Hozzájárulás-jelölőnégyzet és bejelentkezés nincs (NKFH-tájékoztató).
    expect(html).not.toContain('type="checkbox"')
  })

  it.each([
    [true, 'elküldtük erre a címre'],
    [false, 'most nem tudtuk e-mailben elküldeni'],
  ] as const)(
    'a visszaigazoló panel (elismervény kiment: %s) a tartalmat, a budapesti időt és a hivatkozási számot mutatja',
    (receiptSent, mondat) => {
      const html = renderToStaticMarkup(
        createElement(WithdrawalSuccess, {
          receipt: { reference: 'EL-1', receivedAt: BEERKEZES.toISOString(), receiptSent },
          submitted: ERTEKEK,
          supportEmail: 'info@kineticare.hu',
        }),
      )
      expect(html).toContain('Beérkezett: 2026. 09. 25. 00:30.')
      expect(html).toContain('EL-1')
      expect(html).toContain('Elállok a szerződéstől.')
      expect(html).toContain('kh-2026-000501')
      expect(html).toContain(mondat)
      expect(html).toContain('href="mailto:info@kineticare.hu"')
    },
  )
})
