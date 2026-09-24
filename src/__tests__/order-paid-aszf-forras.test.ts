import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetAlertThrottle } from '../lib/alert-throttle'
import type { AuditLogStore } from '../lib/audit'
import { KAPCSOLATI_EMAIL_TARTALEK } from '../lib/contact-email'
import { ASZF_MELLEKLET_FAJLNEV, ASZF_OLDAL_WEBCIM } from '../lib/email/templates/order-legal'
import type { SendResult } from '../lib/email/types'
import {
  JOGI_OLDALAK,
  jogiRichText,
  lexicalToJogiForras,
  parseJogiForras,
} from '../lib/legal-content'
import type { LogContext, Logger } from '../lib/logger'
import { onOrderPaid, type ConfirmationMailInput, type OnOrderPaidDeps } from '../lib/order-paid'
import type { Order } from '../payload-types'

/**
 * A vásárlás-visszaigazoló ÁSZF-FORRÁSA, válaszcíme és naplóhigiéniája.
 *
 * H10: a vevő a pénztárban a KÖZZÉTETT /aszf oldalt fogadja el (az adminban
 * szerkeszthető). A levél mellékletének és szolgáltatói blokkjának ebből kell
 * épülnie, nem a repó aszf.txt-jéből; az aszf.txt csak tartalék, RIASZTÁSSAL.
 * K14: a kérdések és panaszok címe (válaszcím, lábléc) a kapcsolati cím.
 * H9: a szolgáltatói hibaszövegben álló vevői cím csak maszkolva kerülhet a
 * naplóba. Végleges elutasításnál a levél egyszer melléklet nélkül megy.
 *
 * Hálózati hívás nincs: a Payload, a küldő és a műveletnapló csonk
 * (CLAUDE.md 15. tanulság).
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const ASZF = readFileSync(`${REPO_ROOT}src/lib/legal-source/aszf.txt`, 'utf8')
const CEG_EMAIL = 'egeszsegmozgastamogatas@gmail.com'
const BEKELTETO_EMAIL = 'bekelteto.testulet@bkik.hu'

/** Lexical tartalom egy jelölős forrásszövegből, ahogy a tartalom-job építi. */
const oldalTartalom = (forras: string): unknown => jogiRichText(parseJogiForras(forras))

/**
 * Az adminban átírt ÁSZF: új e-mail-cím és telefonszám az adatblokkban, és
 * egy új bekezdés. Egyik sem szerepel az aszf.txt-ben.
 */
const SZERKESZTETT_ASZF = ASZF.replace(`E-mail: \t${CEG_EMAIL}`, 'E-mail: \tjogi@pelda.hu')
  .replace('Telefonszám: +36203573493', 'Telefonszám: +36301112233')
  .replace(
    '# A szerződés létrejötte',
    'UJ-ASZF-2026-10: ez a bekezdés csak az adminban szerkesztett változatban áll.\n# A szerződés létrejötte',
  )

function createOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 901,
    orderNumber: 'KH-2026-000901',
    status: 'paid',
    customerEmail: 'anna.vevo@example.test',
    totalHufSnapshot: 119000,
    items: [
      { product: 4, quantity: 1, titleSnapshot: 'Otthoni KézRehab', priceHufSnapshot: 119000 },
    ],
    customerSnapshot: { name: 'Vevő Anna', email: 'anna.vevo@example.test' },
    consentWithdrawalWaiver: true,
    consentWithdrawalWaiverAt: '2026-09-24T12:05:00.000Z',
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

function createAuditStore(): { store: AuditLogStore; created: Array<Record<string, unknown>> } {
  const created: Array<Record<string, unknown>> = []
  return {
    created,
    store: {
      create: async (args) => {
        created.push(args.data)
        return { id: created.length }
      },
    },
  }
}

function createSender(results: SendResult[] = [{ ok: true, provider: 'resend', id: 're_901' }]) {
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

/** Hangosan dobó tartalék: ahol az aszf.txt-hez NEM szabad nyúlni. */
const tartalekTilos = (): never => {
  throw new Error('TESZT: ezen az ágon a repó aszf.txt-je NEM kellhet')
}

interface FindHivas {
  collection: string
  where?: unknown
  draft?: boolean
  select?: unknown
}

/**
 * Payload-csonk a KÉT alapértelmezett olvasóhoz: a pages/aszf a megadott
 * tartalmat adja (null: nincs közzétett oldal), a pages/kapcsolat az adott
 * kapcsolati címet (null: nincs oldal → kódtartalék).
 */
function payloadCsonk(opciok: { aszf: unknown | null; kapcsolatiCim?: string | null }): {
  payload: Payload
  hivasok: FindHivas[]
} {
  const hivasok: FindHivas[] = []
  const find = async (args: FindHivas): Promise<{ docs: unknown[] }> => {
    hivasok.push(args)
    const szoveg = JSON.stringify(args.where)
    if (args.collection === 'pages' && szoveg.includes(`"${ASZF_OLDAL_WEBCIM}"`)) {
      return { docs: opciok.aszf === null ? [] : [{ id: 7, content: opciok.aszf }] }
    }
    if (args.collection === 'pages' && szoveg.includes('"kapcsolat"')) {
      const cim = opciok.kapcsolatiCim ?? null
      return {
        docs: cim === null ? [] : [{ id: 8, layout: [{ blockType: 'appointment', email: cim }] }],
      }
    }
    throw new Error(`TESZT: váratlan lekérdezés: ${args.collection} ${szoveg}`)
  }
  return { payload: { find } as unknown as Payload, hivasok }
}

/** Közös függőségek: nincs újrapróba, a hozzáférés hossza ismert. */
function alap(extra: Partial<OnOrderPaidDeps> & Pick<OnOrderPaidDeps, 'payload'>): OnOrderPaidDeps {
  return {
    order: createOrder(),
    queueInvoice: async () => true,
    loadAccessDurations: async () => new Map([[4, null]]),
    sleep: nemVarhat,
    ...extra,
  }
}

beforeEach(() => {
  resetAlertThrottle()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// H10: a közzétett /aszf oldal a forrás
// ---------------------------------------------------------------------------

describe('H10: a levél a KÖZZÉTETT /aszf oldalból épül', () => {
  it('az adminban átírt ÁSZF eléri a mellékletet és a szolgáltatói blokkot, a lekérdezés csak közzétettet olvas', async () => {
    const tartalom = oldalTartalom(SZERKESZTETT_ASZF)
    const { payload, hivasok } = payloadCsonk({ aszf: tartalom })
    const { send, calls } = createSender()
    const { store, created } = createAuditStore()
    const { log, entries } = createCapturingLogger()

    await onOrderPaid(
      alap({ payload, logger: log, send, auditStore: store, loadLegalInfo: tartalekTilos }),
    )

    // A lekérdezés: pages, webcím aszf, CSAK közzétett (ugyanaz a szűrő, mint
    // a /aszf oldalon), piszkozat soha.
    const aszfHivas = hivasok.find((hivas) =>
      JSON.stringify(hivas.where).includes(`"${ASZF_OLDAL_WEBCIM}"`),
    )
    expect(aszfHivas).toMatchObject({
      collection: 'pages',
      draft: false,
      where: {
        and: [{ slug: { equals: 'aszf' } }, { status: { equals: 'published' } }],
      },
    })

    expect(calls).toHaveLength(1)
    const melleklet = String(calls[0].attachments?.[0]?.content ?? '')
    expect(calls[0].attachments?.[0]?.filename).toBe(ASZF_MELLEKLET_FAJLNEV)
    expect(melleklet).toContain('UJ-ASZF-2026-10')
    expect(melleklet).toContain('jogi@pelda.hu')
    expect(melleklet).not.toContain(CEG_EMAIL)
    // A fejezetcímek a mellékletben is fejezetcímek maradnak (aláhúzással).
    expect(melleklet).toContain('\r\nA szerződés létrejötte\r\n----------------------\r\n')

    const text = calls[0].text.replace(/ /g, ' ')
    expect(text).toContain('E-mail: jogi@pelda.hu')
    expect(text).toContain('Telefon: +36 30 111 2233')
    expect(text).not.toContain(CEG_EMAIL)

    expect(created[0]).toMatchObject({
      after: {
        aszfSource: 'cms',
        sellerSource: 'cms',
        aszfAttached: true,
        aszfSha256: createHash('sha256')
          .update(lexicalToJogiForras(tartalom), 'utf8')
          .digest('hex'),
      },
    })
    expect(errorsOf(entries)).toHaveLength(0)
  })

  it('az adatblokk egy bekezdésben, sortörésekkel (Shift+Enter) is értelmezhető', async () => {
    // Az admin a „KINETICARE adatai" blokkot egyetlen bekezdésbe írja, a
    // sorokat sortörés-csomópont választja el. A `richTextSzoveg` ezt egy
    // sorba fűzné, és a szolgáltatói blokk némán kimaradna.
    const alapTartalom = oldalTartalom(SZERKESZTETT_ASZF) as {
      root: { children: Array<{ type: string; children?: Array<{ text?: string }> }> }
    }
    const gyerekek = alapTartalom.root.children
    const eleje = gyerekek.findIndex(
      (csomopont) => csomopont.children?.[0]?.text === 'KINETICARE adatai:',
    )
    const vege = gyerekek.findIndex(
      (csomopont) =>
        csomopont.children?.[0]?.text?.startsWith('A KINETICARE székhelye egyben') === true,
    )
    expect(eleje).toBeGreaterThan(0)
    expect(vege).toBeGreaterThan(eleje)
    const sorok = gyerekek
      .slice(eleje, vege + 1)
      .map((csomopont) => csomopont.children?.[0]?.text ?? '')
    const egyBekezdes = {
      type: 'paragraph',
      version: 1,
      children: sorok.flatMap((sor, index) => [
        ...(index === 0 ? [] : [{ type: 'linebreak', version: 1 }]),
        { type: 'text', version: 1, text: sor },
      ]),
    }
    const tartalom = {
      root: {
        ...alapTartalom.root,
        children: [...gyerekek.slice(0, eleje), egyBekezdes, ...gyerekek.slice(vege + 1)],
      },
    }
    const { payload } = payloadCsonk({ aszf: tartalom })
    const { send, calls } = createSender()
    const { log, entries } = createCapturingLogger()

    await onOrderPaid(
      alap({
        payload,
        logger: log,
        send,
        auditStore: createAuditStore().store,
        loadLegalInfo: tartalekTilos,
      }),
    )

    const text = calls[0].text.replace(/ /g, ' ')
    expect(text).toContain('A szolgáltató adatai:')
    expect(text).toContain('Székhely: 8360 Keszthely, Kacsóh Pongrác utca 1. 2a. ép.')
    expect(text).toContain('E-mail: jogi@pelda.hu')
    expect(text).toContain('Telefon: +36 30 111 2233')
    expect(errorsOf(entries)).toHaveLength(0)
  })

  it('jelölő nélküli fejezetcímek és átnevezett e-mail-sor: a cég adata nem a békéltető testületé', async () => {
    // Az admin a címsorokat sima bekezdésre állítja, és az „E-mail:" címkét
    // átírja. A blokk így hiányos: a melléklet az elfogadott szöveg marad, a
    // szolgáltató adatai a repó szövegéből jönnek, RIASZTÁSSAL; a békéltető
    // testület „E-mail:" sora SOSEM kerülhet a cég adatai közé.
    const lapos = SZERKESZTETT_ASZF.replace(/^#{1,2} /gmu, '').replace(
      'E-mail: \tjogi@pelda.hu',
      'E-mail cím: jogi@pelda.hu',
    )
    const { payload } = payloadCsonk({ aszf: oldalTartalom(lapos) })
    const { send, calls } = createSender()
    const { store, created } = createAuditStore()
    const { log, entries } = createCapturingLogger()

    await onOrderPaid(alap({ payload, logger: log, send, auditStore: store }))

    const text = calls[0].text.replace(/ /g, ' ')
    expect(text).not.toContain(`E-mail: ${BEKELTETO_EMAIL}`)
    expect(text).toContain(`E-mail: ${CEG_EMAIL}`)
    expect(String(calls[0].attachments?.[0]?.content)).toContain('UJ-ASZF-2026-10')
    expect(created[0]).toMatchObject({ after: { aszfSource: 'cms', sellerSource: 'repo' } })
    const alerts = errorsOf(entries)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].msg).toContain('RIASZTÁS')
    expect(alerts[0].msg).toContain('„KINETICARE adatai" blokkja')
  })

  it.each([
    ['nincs közzétett oldal', async () => null, 'nincs közzétett ÁSZF-oldal'],
    [
      'az oldal nem olvasható',
      async () => {
        throw new Error('connection terminated')
      },
      'a közzétett ÁSZF-oldal nem olvasható',
    ],
    [
      'üres tartalom',
      async () => ({ content: { root: { children: [] } } }),
      'üres vagy nem értelmezhető',
    ],
    ['nem Lexical-tartalom', async () => ({ content: 'szöveg' }), 'üres vagy nem értelmezhető'],
  ])(
    '%s: a levél a repó szövegével megy, és (fojtva) RIASZT',
    async (_nev, loadPublishedAszf, uzenet) => {
      const { send, calls } = createSender()
      const { store, created } = createAuditStore()
      const { log, entries } = createCapturingLogger()

      await onOrderPaid(
        alap({
          payload: {} as unknown as Payload,
          logger: log,
          send,
          auditStore: store,
          loadPublishedAszf,
          loadSupportEmail: async () => KAPCSOLATI_EMAIL_TARTALEK,
        }),
      )

      expect(calls).toHaveLength(1)
      expect(String(calls[0].attachments?.[0]?.content)).toContain(
        'Általános Szerződési Feltételei',
      )
      expect(calls[0].text).toContain(`E-mail: ${CEG_EMAIL}`)
      expect(created[0]).toMatchObject({ after: { aszfSource: 'repo', sellerSource: 'repo' } })
      const alerts = errorsOf(entries)
      expect(alerts).toHaveLength(1)
      expect(alerts[0].msg).toContain('RIASZTÁS')
      expect(alerts[0].msg).toContain(uzenet)
      expect(alerts[0].msg).toContain('aszf.txt')
    },
  )

  it('a rendszerszintű riasztás fojtott: a következő rendelésnél warn, de a napló rendelésenként rögzít', async () => {
    const { log, entries } = createCapturingLogger()
    const { store, created } = createAuditStore()
    for (const id of [902, 903]) {
      await onOrderPaid(
        alap({
          payload: {} as unknown as Payload,
          order: createOrder({ id }),
          logger: log,
          send: createSender().send,
          auditStore: store,
          loadPublishedAszf: async () => null,
          loadSupportEmail: async () => KAPCSOLATI_EMAIL_TARTALEK,
        }),
      )
    }
    expect(errorsOf(entries)).toHaveLength(1)
    expect(
      entries.filter((entry) => entry.level === 'warn' && entry.msg.includes('a riasztás fojtva')),
    ).toHaveLength(1)
    expect(
      created.map((bejegyzes) => (bejegyzes.after as { aszfSource: unknown }).aszfSource),
    ).toEqual(['repo', 'repo'])
  })

  it('a webcím-konstans egyezik a jogi oldalak listájával (a pénztár és a lábléc linkjével)', () => {
    expect(JOGI_OLDALAK.map((oldal) => oldal.slug)).toContain(ASZF_OLDAL_WEBCIM)
  })
})

// ---------------------------------------------------------------------------
// K14: a válaszcím és a lábléc a kapcsolati cím
// ---------------------------------------------------------------------------

describe('K14: a kérdések és panaszok címe a kapcsolati cím', () => {
  it('a Kapcsolat oldal címe a válaszcím és a lábléc címe; a szolgáltatói blokk az ÁSZF-et követi', async () => {
    const { payload } = payloadCsonk({
      aszf: oldalTartalom(ASZF),
      kapcsolatiCim: 'rendelo@pelda.hu',
    })
    const { send, calls } = createSender()
    const { store, created } = createAuditStore()

    await onOrderPaid(
      alap({ payload, logger: createCapturingLogger().log, send, auditStore: store }),
    )

    expect(calls[0].replyTo).toBe('rendelo@pelda.hu')
    expect(calls[0].text).toContain('vagy írj a rendelo@pelda.hu címre.')
    expect(calls[0].text).toContain('e-mailben a rendelo@pelda.hu címre')
    expect(calls[0].text).toContain(`E-mail: ${CEG_EMAIL}`)
    expect(calls[0].replyTo).not.toBe(CEG_EMAIL)
    expect(created[0]).toMatchObject({ after: { replyTo: 'rendelo@pelda.hu' } })
  })

  it('Kapcsolat oldal nélkül a kódtartalék (info@kineticare.hu) a válaszcím', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { payload } = payloadCsonk({ aszf: oldalTartalom(ASZF), kapcsolatiCim: null })
    const { send, calls } = createSender()

    await onOrderPaid(
      alap({
        payload,
        logger: createCapturingLogger().log,
        send,
        auditStore: createAuditStore().store,
      }),
    )

    expect(calls[0].replyTo).toBe(KAPCSOLATI_EMAIL_TARTALEK)
    expect(calls[0].text).toContain(`vagy írj az ${KAPCSOLATI_EMAIL_TARTALEK} címre.`)
  })

  it('a dobó kapcsolati-cím-olvasó sem állítja meg a levelet: kódtartalék', async () => {
    const { send, calls } = createSender()
    const { log, entries } = createCapturingLogger()

    await onOrderPaid(
      alap({
        payload: {} as unknown as Payload,
        logger: log,
        send,
        auditStore: createAuditStore().store,
        loadPublishedAszf: async () => ({ content: oldalTartalom(ASZF) }),
        loadSupportEmail: async () => {
          throw new Error('váratlan')
        },
      }),
    )

    expect(calls[0].replyTo).toBe(KAPCSOLATI_EMAIL_TARTALEK)
    expect(errorsOf(entries)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Végleges elutasítás: egyszer melléklet nélkül, saját kulccsal
// ---------------------------------------------------------------------------

describe('végleges elutasítás mellékletes levélnél: melléklet nélküli pótküldés', () => {
  const deps = (
    send: OnOrderPaidDeps['send'],
    extra: Partial<OnOrderPaidDeps> = {},
  ): OnOrderPaidDeps =>
    alap({
      payload: {} as unknown as Payload,
      send,
      loadPublishedAszf: async () => ({ content: oldalTartalom(ASZF) }),
      loadSupportEmail: async () => KAPCSOLATI_EMAIL_TARTALEK,
      ...extra,
    })

  it('a második, melléklet nélküli levél kimegy, RIASZT a kézi ÁSZF-küldésért, és a napló rögzíti', async () => {
    const { send, calls } = createSender([
      { ok: false, provider: 'resend', retryable: false, error: 'Resend API hiba (HTTP 422)' },
      { ok: true, provider: 'resend', id: 're_link' },
    ])
    const { store, created } = createAuditStore()
    const { log, entries } = createCapturingLogger()

    await onOrderPaid(deps(send, { logger: log, auditStore: store }))

    expect(calls).toHaveLength(2)
    expect(calls[0].attachments).toHaveLength(1)
    expect(calls[0].idempotencyKey).toBe('kineticare-order-confirmation-901')
    expect(calls[1].attachments).toBeUndefined()
    expect(calls[1].idempotencyKey).toBe('kineticare-order-confirmation-901-link')
    expect(calls[1].replyTo).toBe(KAPCSOLATI_EMAIL_TARTALEK)
    expect(calls[1].text).toContain('a teljes szövegét a weboldalon olvashatod:')
    expect(calls[1].text).not.toContain('mellékeltük')
    // A levél többi jogi része változatlanul megvan.
    expect(calls[1].text).toContain('Az elállási jogodról')
    expect(calls[1].text).toContain('A szolgáltató adatai:')

    const alerts = errorsOf(entries)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].msg).toContain('ÁSZF-melléklet NÉLKÜL ment ki')
    expect(alerts[0].msg).toContain('küldd el kézzel az ÁSZF-et')
    expect(created[0]).toMatchObject({
      after: {
        providerMessageId: 're_link',
        attempts: 2,
        aszfAttached: false,
        aszfAttachmentDropped: true,
      },
    })
  })

  it('ha a pótküldés is elbukik: egyetlen „NEM ment ki" RIASZTÁS, küldés nincs rögzítve', async () => {
    const { send, calls } = createSender([
      { ok: false, provider: 'resend', retryable: false, error: 'Resend API hiba (HTTP 403)' },
    ])
    const { store, created } = createAuditStore()
    const { log, entries } = createCapturingLogger()

    await onOrderPaid(deps(send, { logger: log, auditStore: store }))

    expect(calls).toHaveLength(2)
    expect(created).toHaveLength(0)
    const alerts = errorsOf(entries)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].msg).toContain('NEM ment ki')
    expect(alerts[0].context).toMatchObject({ attempts: 2, attachmentDropped: true })
  })

  it('melléklet nélküli levélnél nincs pótküldés (nincs mit elhagyni)', async () => {
    const { send, calls } = createSender([
      { ok: false, provider: 'resend', retryable: false, error: 'HTTP 422' },
    ])
    const { log } = createCapturingLogger()

    await onOrderPaid(
      deps(send, {
        logger: log,
        auditStore: createAuditStore().store,
        loadPublishedAszf: async () => {
          throw new Error('DB')
        },
        loadLegalInfo: () => {
          throw new Error('ENOENT')
        },
      }),
    )

    expect(calls).toHaveLength(1)
  })

  it('átmeneti hibánál nincs pótküldés: mindhárom próba a mellékletes levél', async () => {
    const { send, calls } = createSender([
      { ok: false, provider: 'resend', retryable: true, error: 'HTTP 503' },
    ])

    await onOrderPaid(
      deps(send, {
        logger: createCapturingLogger().log,
        auditStore: createAuditStore().store,
        sleep: async () => {},
      }),
    )

    expect(calls).toHaveLength(3)
    for (const call of calls) {
      expect(call.attachments).toHaveLength(1)
      expect(call.idempotencyKey).toBe('kineticare-order-confirmation-901')
    }
  })
})

// ---------------------------------------------------------------------------
// H9: a vevő címe a szolgáltatói hibaszövegből sem kerülhet a naplóba
// ---------------------------------------------------------------------------

describe('H9: a szolgáltatói hibaszöveg a naplóban maszkolva', () => {
  const VEVO = 'anna.vevo@example.test'

  const naploSorok = (spy: { mock: { calls: unknown[][] } }): string[] =>
    spy.mock.calls.map((hivas) => hivas.map((resz) => String(resz)).join(' '))

  it('átmeneti SMTP-elutasítás (450) mindhárom sora maszkolt, a diagnózis megmarad', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { send } = createSender([
      {
        ok: false,
        provider: 'smtp',
        retryable: true,
        error: `SMTP 450: 450 4.1.2 <${VEVO}>: Recipient address rejected: Domain not found`,
      },
    ])

    // A VALÓDI (gyökér) logger: a redakció és a JSON-sor is az éles.
    await onOrderPaid(
      alap({
        payload: {} as unknown as Payload,
        send,
        sleep: async () => {},
        auditStore: createAuditStore().store,
        loadPublishedAszf: async () => ({ content: oldalTartalom(ASZF) }),
        loadSupportEmail: async () => KAPCSOLATI_EMAIL_TARTALEK,
      }),
    )

    const sorok = naploSorok(spy)
    expect(sorok.filter((sor) => sor.includes(VEVO))).toEqual([])
    const hibaSorok = sorok.filter((sor) => sor.includes('SMTP 450'))
    expect(hibaSorok).toHaveLength(3)
    for (const sor of hibaSorok) {
      expect(sor).toContain('a***@example.test')
      expect(sor).toContain('Recipient address rejected')
    }
    expect(sorok.some((sor) => sor.includes('"level":"error"') && sor.includes('RIASZTÁS'))).toBe(
      true,
    )
  })

  it('végleges elutasítás (553) és a pótküldés hibája sem írja ki a címet', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { send, calls } = createSender([
      {
        ok: false,
        provider: 'smtp',
        retryable: false,
        error: `SMTP 553: 553 5.1.3 The recipient address <${VEVO}> is not a valid RFC 5321 address`,
      },
    ])

    await onOrderPaid(
      alap({
        payload: {} as unknown as Payload,
        send,
        auditStore: createAuditStore().store,
        loadPublishedAszf: async () => ({ content: oldalTartalom(ASZF) }),
        loadSupportEmail: async () => KAPCSOLATI_EMAIL_TARTALEK,
      }),
    )

    expect(calls).toHaveLength(2)
    const sorok = naploSorok(spy)
    expect(sorok.filter((sor) => sor.includes(VEVO))).toEqual([])
    expect(sorok.filter((sor) => sor.includes('a***@example.test')).length).toBeGreaterThanOrEqual(
      2,
    )
  })
})
