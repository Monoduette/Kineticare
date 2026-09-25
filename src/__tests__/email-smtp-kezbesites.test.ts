import type { EventEmitter } from 'node:events'

import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuditLogStore } from '../lib/audit'
import { JOGI_OLDALAK, jogiOldalTartalom } from '../lib/legal-content'
import type { LogContext, Logger } from '../lib/logger'
import type { Order } from '../payload-types'

/**
 * A visszaigazoló levél SMTP-n: az újrapróba nem kettőzheti a levelet.
 *
 * MI A TÉT (PR #304 átnézés, Codex P2): a vevő kettő-három azonos
 * visszaigazolót kapott volna, ha az SMTP-kapcsolat a levél tartalma (DATA)
 * UTÁN szakad meg. A szerver ilyenkor már átvehette a levelet, csak a „250”
 * válasza veszett el (RFC 1047), az SMTP-nek pedig nincs idempotencia-kulcsa.
 * A lezáró pont előtti hibánál (kapcsolódás) viszont semmi nem ment át, ott az
 * újrapróba a helyes.
 *
 * A teszt a VALÓDI láncot futtatja: onOrderPaid → sendMail → sendViaSmtp →
 * SMTP-párbeszéd. Csak a TCP/TLS-socket hamis (egy forgatókönyv szerint
 * válaszoló szerver), így hálózati hívás nincs (CLAUDE.md 15. tanulság), és
 * az ÉLES kód dönti el, újrapróbál-e.
 */

type Forgatokonyv =
  | 'rendben'
  | 'kapcsolodas-elutasitva'
  | 'data-utan-kapcsolat-bontva'
  | 'data-utan-hiba'
  | 'data-utan-idotullepes'
  | 'data-utan-451'

const allapot = vi.hoisted(() => ({
  forgatokonyv: 'rendben' as Forgatokonyv,
  kapcsolodasok: 0,
  dataParancsok: 0,
}))

/**
 * Forgatókönyv szerint válaszoló hamis SMTP-szerver a socket helyén. Gyár,
 * mert a `vi.mock` gyára a modul többi része ELŐTT fut.
 */
const hamisSocket = vi.hoisted(() => ({
  osztaly: (Base: typeof EventEmitter) => {
    return class HamisSmtpSocket extends Base {
      destroyed = false
      private dataModban = false
      private bejovo = ''

      connect(_port: number, _host: string, onConnect: () => void): this {
        allapot.kapcsolodasok += 1
        setImmediate(() => {
          if (allapot.forgatokonyv === 'kapcsolodas-elutasitva') {
            this.emit(
              'error',
              Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
            )
            return
          }
          onConnect()
          this.valaszol('220 hamis.example.test ESMTP')
        })
        return this
      }

      setTimeout(_ms: number, onTimeout?: () => void): this {
        if (onTimeout) this.once('timeout', onTimeout)
        return this
      }

      destroy(error?: Error): this {
        if (this.destroyed) return this
        this.destroyed = true
        setImmediate(() => {
          if (error && this.listenerCount('error') > 0) this.emit('error', error)
          this.emit('close')
        })
        return this
      }

      write(chunk: string, callback?: (error?: Error | null) => void): boolean {
        setImmediate(() => {
          callback?.(null)
          this.fogad(chunk)
        })
        return true
      }

      private valaszol(sor: string): void {
        setImmediate(() => this.emit('data', Buffer.from(`${sor}\r\n`, 'utf8')))
      }

      private fogad(chunk: string): void {
        if (this.dataModban) {
          this.bejovo += chunk
          if (!this.bejovo.endsWith('\r\n.\r\n')) return
          this.dataModban = false
          this.bejovo = ''
          switch (allapot.forgatokonyv) {
            case 'data-utan-kapcsolat-bontva':
              // A szerver FIN-nel bont, hiba-esemény nélkül.
              setImmediate(() => {
                this.destroyed = true
                this.emit('end')
                this.emit('close')
              })
              return
            case 'data-utan-hiba':
              setImmediate(() =>
                this.emit(
                  'error',
                  Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
                ),
              )
              return
            case 'data-utan-idotullepes':
              setImmediate(() => this.emit('timeout'))
              return
            case 'data-utan-451':
              this.valaszol('451 4.3.0 átmeneti hiba, a levelet nem vettük át')
              return
            default:
              this.valaszol('250 2.0.0 átvéve')
              return
          }
        }
        const parancs = chunk.trim().split(' ')[0].toUpperCase()
        if (parancs === 'EHLO') this.valaszol('250-hamis.example.test\r\n250 STARTTLS')
        else if (parancs === 'STARTTLS') this.valaszol('220 mehet')
        else if (parancs === 'MAIL' || parancs === 'RCPT') this.valaszol('250 rendben')
        else if (parancs === 'DATA') {
          allapot.dataParancsok += 1
          this.dataModban = true
          this.valaszol('354 jöhet')
        } else if (parancs === 'QUIT') this.valaszol('221 viszlát')
        else this.valaszol('500 ismeretlen parancs')
      }
    }
  },
}))

vi.mock('node:net', async () => {
  const { EventEmitter: Base } = await import('node:events')
  return { Socket: hamisSocket.osztaly(Base) }
})
vi.mock('node:tls', () => ({
  // A STARTTLS-váltás itt átlátszó: ugyanaz a hamis socket folytatja.
  connect: (options: { socket?: unknown }, onSecure: () => void) => {
    setImmediate(onSecure)
    return options.socket
  },
}))

const ASZF_LEIRAS = JOGI_OLDALAK.find((oldal) => oldal.slug === 'aszf')
if (ASZF_LEIRAS === undefined) {
  throw new Error('TESZT: nincs ÁSZF a JOGI_OLDALAK-ban')
}
/** A közzétett /aszf oldal tartalma (a levél melléklete ebből épül). */
const PUBLIKALT_ASZF = jogiOldalTartalom(ASZF_LEIRAS)

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

function rendeles(): Order {
  return {
    id: 901,
    orderNumber: 'KH-2026-000901',
    status: 'paid',
    customerEmail: 'vevo@example.test',
    totalHufSnapshot: 19990,
    items: [
      { product: 42, quantity: 1, titleSnapshot: 'Otthoni KézRehab', priceHufSnapshot: 19990 },
    ],
    customerSnapshot: { name: 'Teszt Vevő', email: 'vevo@example.test' },
    consentWithdrawalWaiver: true,
    consentWithdrawalWaiverAt: '2026-09-24T12:05:00.000Z',
  } as unknown as Order
}

async function futtat(): Promise<{
  sorok: Naplosor[]
  naplo: Array<Record<string, unknown>>
  varakozasok: number[]
}> {
  const { onOrderPaid } = await import('../lib/order-paid')
  const { log, sorok } = rogzitoLogger()
  const naplo: Array<Record<string, unknown>> = []
  const store: AuditLogStore = {
    create: async (args) => {
      naplo.push(args.data)
      return { id: naplo.length }
    },
  }
  const varakozasok: number[] = []
  await onOrderPaid({
    payload: {} as unknown as Payload,
    order: rendeles(),
    logger: log,
    queueInvoice: async () => true,
    auditStore: store,
    loadPublishedAszf: async () => ({ content: PUBLIKALT_ASZF }),
    loadSupportEmail: async () => 'info@kineticare.hu',
    loadAccessDurations: async () => new Map(),
    sleep: async (ms) => {
      varakozasok.push(ms)
    },
  })
  return { sorok, naplo, varakozasok }
}

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('RESEND_API_KEY', '')
  vi.stubEnv('SMTP_HOST', 'smtp.example.test')
  vi.stubEnv('SMTP_PORT', '587')
  vi.stubEnv('SMTP_USER', '')
  vi.stubGlobal('fetch', () => {
    throw new Error('TESZT: valódi hálózati hívás tilos')
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  allapot.kapcsolodasok = 0
  allapot.dataParancsok = 0
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('visszaigazoló levél SMTP-n: újrapróba csak ott, ahol nem kettőzhet', () => {
  it.each([
    { forgatokonyv: 'data-utan-hiba', leiras: 'a kapcsolat hibával szakad meg' },
    { forgatokonyv: 'data-utan-kapcsolat-bontva', leiras: 'a szerver válasz nélkül bont' },
    { forgatokonyv: 'data-utan-idotullepes', leiras: 'a válasz nem érkezik meg időben' },
  ] as const)(
    'a levél tartalma után ($leiras) PONTOSAN egy küldés, bizonytalan-riasztás és naplóbejegyzés',
    async ({ forgatokonyv }) => {
      allapot.forgatokonyv = forgatokonyv

      const { sorok, naplo, varakozasok } = await futtat()

      expect(allapot.dataParancsok).toBe(1)
      expect(allapot.kapcsolodasok).toBe(1)
      expect(varakozasok).toEqual([])
      const riasztasok = sorok.filter((sor) => sor.level === 'error')
      expect(riasztasok.map((sor) => sor.msg)).toEqual([
        expect.stringContaining('kézbesítése BIZONYTALAN'),
      ])
      // A „küldés megtörtént” bizonyíték NEM keletkezik, a bizonytalan küldés igen.
      expect(naplo).toHaveLength(1)
      expect(naplo[0]).toMatchObject({
        action: 'order-confirmation-email-uncertain',
        entityType: 'orders',
        entityId: '901',
        after: { orderNumber: 'KH-2026-000901', provider: 'smtp', attempts: 1 },
      })
    },
    10_000,
  )

  it('kapcsolódási hibánál (a levél el sem indult) újrapróbál, a 3. kísérletnél elküldi', async () => {
    allapot.forgatokonyv = 'kapcsolodas-elutasitva'
    const { onOrderPaid } = await import('../lib/order-paid')
    const { log, sorok } = rogzitoLogger()
    const naplo: Array<Record<string, unknown>> = []
    const varakozasok: number[] = []

    await onOrderPaid({
      payload: {} as unknown as Payload,
      order: rendeles(),
      logger: log,
      queueInvoice: async () => true,
      auditStore: {
        create: async (args) => {
          naplo.push(args.data)
          return { id: naplo.length }
        },
      },
      loadPublishedAszf: async () => ({ content: PUBLIKALT_ASZF }),
      loadSupportEmail: async () => 'info@kineticare.hu',
      loadAccessDurations: async () => new Map(),
      sleep: async (ms) => {
        varakozasok.push(ms)
        // A 2. újrapróbára a szerver már fogad.
        if (varakozasok.length === 2) allapot.forgatokonyv = 'rendben'
      },
    })

    expect(allapot.kapcsolodasok).toBe(3)
    expect(allapot.dataParancsok).toBe(1)
    expect(varakozasok).toEqual([2_000, 6_000])
    expect(naplo).toHaveLength(1)
    expect(naplo[0]).toMatchObject({
      action: 'order-confirmation-email',
      after: { provider: 'smtp', attempts: 3 },
    })
    expect(sorok.filter((sor) => sor.msg.includes('BIZONYTALAN'))).toEqual([])
  })

  it('a tartalomra adott kifejezett 4xx (nem vette át) újrapróbálható marad', async () => {
    allapot.forgatokonyv = 'data-utan-451'

    const { naplo, varakozasok } = await futtat()

    expect(allapot.dataParancsok).toBe(3)
    expect(varakozasok).toEqual([2_000, 6_000])
    expect(naplo).toEqual([])
  })
})
