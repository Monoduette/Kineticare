import { randomUUID } from 'node:crypto'

import type { Payload } from 'payload'

import { auditLogStore, writeAuditLog, type AuditLogStore } from '../audit'
import { KAPCSOLATI_EMAIL_TARTALEK } from '../contact-email'
import { kapcsolatiEmailPayloadbol } from '../contact-email-server'
import { budapestDateTimeString } from '../date/budapest'
import { sendMail } from '../email'
import { maskEmail, maskEmailsInText } from '../email/mask'
import { isUsableReplyToAddress } from '../email/reply-to'
import { realSleep, sendWithRetry, type RetryableMailInput } from '../email/retry'
import { withdrawalReceiptEmail, withdrawalStaffEmail } from '../email/templates/withdrawal'
import type { SendResult } from '../email/types'
import type { Logger } from '../logger'
import { normalizeOrderNumber, type WithdrawalFormValues } from './validation'

/**
 * Az elállási nyilatkozat FELDOLGOZÁSA (45/2014. Korm. rendelet 22. § (1a)–(1c)).
 *
 * Sorrend és indok:
 * 1. RÖGZÍTÉS a megváltoztathatatlan műveletnaplóba (audit-logs), elsőként:
 *    a nyilatkozat a beérkezésével hatályos, a bizonyítása a vállalkozást
 *    terheli (11. § (7)). Séma-bővítés nincs: az audit-logs collection már
 *    létezik, csak rendszerfolyamat írhatja és csak a tulajdonos olvashatja
 *    (a nyilatkozat személyes adatot hordoz). A form-builder beküldései nem
 *    alkalmasak: a `form-submissions` hookjai a „Kapcsolat” űrlap
 *    szerződését (tárgy, üzenet, adatkezelési hozzájárulás) követelnék meg.
 * 2. ÁTVÉTELI ELISMERVÉNY a vevőnek, „indokolatlan késedelem nélkül” (22. §
 *    (1c)): még a kérésen belül, átmeneti hibánál rövid újrapróbával,
 *    Resend-idempotenciakulccsal (src/lib/email/retry.ts).
 * 3. STÁB-ÉRTESÍTŐ a CONTACT_STAFF_EMAILS címre, a 14 napos visszatérítési
 *    határidővel (23. § (1)). Ha nem megy ki (vagy nincs címzett), RIASZTÁS
 *    szól, amely a tulajdonoshoz is eljut (src/lib/alerts/sink.ts).
 *
 * Sosem dob: minden lépés eredménye a kimenetben áll, a hívó ebből dönti el,
 * mit mond a látogatónak. A naplóba a vevő címe csak maszkolva kerül.
 */

/** A műveletnapló-bejegyzés kódja a beérkezett nyilatkozatról. */
export const WITHDRAWAL_REQUEST_AUDIT_ACTION = 'withdrawal-request'
/** A műveletnapló-bejegyzés kódja az elküldött átvételi elismervényről. */
export const WITHDRAWAL_RECEIPT_AUDIT_ACTION = 'withdrawal-receipt-email'

/**
 * Újrapróba a kérésen belül: a látogató a válaszra vár, ezért rövidebb, mint a
 * háttérben futó visszaigazolóé (order-paid: 2 és 6 mp).
 */
export const WITHDRAWAL_RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000]

/** A 23. § (1) szerinti visszatérítési határidő napokban. */
export const WITHDRAWAL_REFUND_DAYS = 14

const DAY_MS = 24 * 60 * 60 * 1000

export interface WithdrawalOrderMatch {
  id: number | string
  orderNumber: string
  status: string | null
  customerEmail: string | null
}

export interface SubmitWithdrawalDeps {
  payload: Payload
  values: WithdrawalFormValues
  logger: Logger
  env?: Readonly<Record<string, string | undefined>>
  /** Kéréshez kötött fejlécek (a műveletnapló request ID-jához). */
  headers?: Headers
  /** Injektálható küldő (teszteléshez); alapból a provider-réteg sendMail-je. */
  send?: (input: RetryableMailInput) => Promise<SendResult>
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
  /** Egyedi azonosító (az idempotencia-kulcsok és a hivatkozási szám alapja). */
  newId?: () => string
  auditStore?: AuditLogStore
  /** Rendelés rendelésszám szerint; alapból az orders collection. */
  findOrder?: (orderNumber: string) => Promise<WithdrawalOrderMatch | null>
  /** A hivatalos kapcsolati cím (K14); alapból a Kapcsolat oldal feloldója. */
  loadSupportEmail?: () => Promise<string>
}

export interface WithdrawalOutcome {
  /** A nyilatkozat hivatkozási száma (a vevő és a stáb is ezt látja). */
  reference: string
  /** A beérkezés időpontja (ISO). */
  receivedAt: string
  /** Rögzült-e a műveletnaplóban. */
  recorded: boolean
  /** Kiment-e az átvételi elismervény (élesben a noop-szolgáltató nem számít). */
  receiptSent: boolean
  /** Kiment-e a stáb-értesítő. */
  staffNotified: boolean
}

async function defaultFindOrder(
  payload: Payload,
  orderNumber: string,
): Promise<WithdrawalOrderMatch | null> {
  const found = await payload.find({
    collection: 'orders',
    where: { orderNumber: { equals: orderNumber } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  } as unknown as Parameters<Payload['find']>[0])
  const doc = found.docs[0] as
    { id?: unknown; orderNumber?: unknown; status?: unknown; customerEmail?: unknown } | undefined
  if (doc === undefined || (typeof doc.id !== 'number' && typeof doc.id !== 'string')) {
    return null
  }
  return {
    id: doc.id,
    orderNumber: typeof doc.orderNumber === 'string' ? doc.orderNumber : orderNumber,
    status: typeof doc.status === 'string' ? doc.status : null,
    customerEmail: typeof doc.customerEmail === 'string' ? doc.customerEmail : null,
  }
}

/** „2026. 10. 08” (záró pont nélkül, a „-ig” rag elé), budapesti naptár szerint. */
function deadlineDay(date: Date): string {
  return new Intl.DateTimeFormat('hu-HU', {
    timeZone: 'Europe/Budapest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .replace(/\.$/u, '')
}

function isDelivered(result: SendResult, production: boolean): boolean {
  return result.ok && !(production && result.provider === 'noop')
}

export async function submitWithdrawal(deps: SubmitWithdrawalDeps): Promise<WithdrawalOutcome> {
  const env = deps.env ?? process.env
  const production = env.NODE_ENV === 'production'
  const now = deps.now ?? (() => new Date())
  const id = (deps.newId ?? randomUUID)()
  const reference = `EL-${id.replace(/-/g, '').slice(0, 10).toUpperCase()}`
  const received = now()
  const receivedAt = received.toISOString()
  const { name, orderReference, email } = deps.values
  const log = deps.logger.child({ module: 'withdrawal', withdrawalReference: reference })
  const send = deps.send ?? sendMail
  const sleep = deps.sleep ?? realSleep

  // A rendelés azonosítása csak segítség a stábnak: hibája nem akadály.
  let order: WithdrawalOrderMatch | null = null
  const orderNumber = normalizeOrderNumber(orderReference)
  if (orderNumber !== null) {
    try {
      order = await (deps.findOrder ?? ((n: string) => defaultFindOrder(deps.payload, n)))(
        orderNumber,
      )
    } catch (error) {
      log.warn('elállás: a rendelés nem kereshető, a stáb kézzel azonosítja', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const emailMatches =
    order !== null && (order.customerEmail ?? '').trim().toLowerCase() === email.toLowerCase()

  const recorded = await writeAuditLog({
    store: deps.auditStore ?? auditLogStore(deps.payload),
    action: WITHDRAWAL_REQUEST_AUDIT_ACTION,
    entityType: order ? 'orders' : 'withdrawal',
    entityId: order ? order.id : reference,
    after: {
      reference,
      statement: 'elállás a szerződéstől',
      name,
      orderReference,
      email,
      receivedAt,
      orderFound: order !== null,
      orderNumber: order?.orderNumber ?? null,
      orderStatus: order?.status ?? null,
      emailMatchesOrder: emailMatches,
    },
    ...(deps.headers ? { req: { headers: deps.headers } } : {}),
  })

  let supportEmail = KAPCSOLATI_EMAIL_TARTALEK
  try {
    const loaded = (
      await (deps.loadSupportEmail ?? (() => kapcsolatiEmailPayloadbol(deps.payload)))()
    ).trim()
    if (isUsableReplyToAddress(loaded)) supportEmail = loaded
  } catch (error) {
    log.warn('elállás: a kapcsolati cím nem oldható fel, a kódtartalék megy', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const serverUrl = (env.NEXT_PUBLIC_SERVER_URL ?? '').trim().replace(/\/+$/, '')
  const mailBase = {
    name,
    orderReference,
    email,
    receivedAt: budapestDateTimeString(received),
    reference,
  }

  // 2. Átvételi elismervény.
  let receiptSent = false
  try {
    const template = withdrawalReceiptEmail({
      ...mailBase,
      sentAt: budapestDateTimeString(now()),
      supportEmail,
      termsUrl: serverUrl ? `${serverUrl}/aszf` : null,
    })
    const { result, attempts } = await sendWithRetry(
      send,
      {
        to: email,
        ...template,
        replyTo: supportEmail,
        idempotencyKey: `withdrawal-receipt:${id}`,
      },
      {
        delaysMs: WITHDRAWAL_RETRY_DELAYS_MS,
        sleep,
        onRetry: ({ attempt, result: failed }) => {
          log.warn('elállás: az átvételi elismervény küldése sikertelen, újrapróbálom', {
            attempt,
            error: failed.error === undefined ? undefined : maskEmailsInText(failed.error),
          })
        },
      },
    )
    receiptSent = isDelivered(result, production)
    if (receiptSent) {
      const receiptRecorded = await writeAuditLog({
        store: deps.auditStore ?? auditLogStore(deps.payload),
        action: WITHDRAWAL_RECEIPT_AUDIT_ACTION,
        entityType: order ? 'orders' : 'withdrawal',
        entityId: order ? order.id : reference,
        after: {
          reference,
          recipient: email,
          sentAt: now().toISOString(),
          provider: result.provider,
          providerMessageId: result.id ?? null,
          attempts,
        },
      })
      if (!receiptRecorded) {
        log.warn('elállás: az elismervény kiment, de a küldés nem került a műveletnaplóba', {
          provider: result.provider,
          providerMessageId: result.id ?? null,
        })
      }
    } else {
      log.error(
        'RIASZTÁS: elállási nyilatkozat érkezett, de a vevőnek járó átvételi elismervény NEM ment ki' +
          (result.deliveryUncertain === true
            ? ' (a kézbesítés bizonytalan, a levél célba érhetett). '
            : '. ') +
          'A 45/2014. Korm. rendelet 22. § (1c) szerint haladéktalanul el kell küldeni: küldd el ' +
          'kézzel a nyilatkozat tartalmával és a küldés időpontjával. A nyilatkozat a ' +
          'Műveletnaplóban van, a hivatkozási számával.',
        {
          attempts,
          provider: result.provider,
          cimzett: maskEmail(email),
          error: result.error === undefined ? undefined : maskEmailsInText(result.error),
        },
      )
    }
  } catch (error) {
    log.error(
      'RIASZTÁS: elállási nyilatkozat érkezett, de az átvételi elismervény összeállítása vagy ' +
        'küldése kivétellel leállt. Küldd el kézzel a nyilatkozat tartalmával és a küldés időpontjával.',
      { cimzett: maskEmail(email), error: error instanceof Error ? error.message : String(error) },
    )
  }

  // 3. Stáb-értesítő.
  let staffNotified = false
  const recipients = (env.CONTACT_STAFF_EMAILS ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter((address) => address.length > 0)
  if (recipients.length === 0) {
    log.error(
      'RIASZTÁS: elállási nyilatkozat érkezett, de a CONTACT_STAFF_EMAILS üres, ezért a stáb nem ' +
        'kapott értesítőt. Nézd meg a Műveletnaplóban a nyilatkozatot, és intézd a visszatérítést ' +
        '14 napon belül (45/2014. Korm. rendelet 23. § (1)).',
      { orderNumber: order?.orderNumber ?? null, recorded },
    )
  } else {
    try {
      const template = withdrawalStaffEmail({
        ...mailBase,
        refundDeadline: deadlineDay(new Date(received.getTime() + WITHDRAWAL_REFUND_DAYS * DAY_MS)),
        order: order
          ? { orderNumber: order.orderNumber, status: order.status, emailMatches }
          : null,
        receiptSent,
      })
      const { result } = await sendWithRetry(
        send,
        {
          to: recipients,
          ...template,
          ...(isUsableReplyToAddress(email) ? { replyTo: email } : {}),
          idempotencyKey: `withdrawal-staff:${id}`,
        },
        { delaysMs: WITHDRAWAL_RETRY_DELAYS_MS, sleep },
      )
      staffNotified = isDelivered(result, production)
      if (!staffNotified) {
        log.error(
          'RIASZTÁS: elállási nyilatkozat érkezett, de a stáb-értesítő NEM ment ki. Nézd meg a ' +
            'Műveletnaplóban a nyilatkozatot, és intézd a visszatérítést 14 napon belül ' +
            '(45/2014. Korm. rendelet 23. § (1)).',
          {
            orderNumber: order?.orderNumber ?? null,
            recorded,
            provider: result.provider,
            error: result.error === undefined ? undefined : maskEmailsInText(result.error),
          },
        )
      }
    } catch (error) {
      log.error(
        'RIASZTÁS: elállási nyilatkozat érkezett, de a stáb-értesítő kivétellel leállt. Nézd meg a ' +
          'Műveletnaplóban a nyilatkozatot.',
        { recorded, error: error instanceof Error ? error.message : String(error) },
      )
    }
  }

  if (!recorded) {
    log.error(
      'RIASZTÁS: elállási nyilatkozat érkezett, de a Műveletnaplóba NEM került. A nyilatkozat ' +
        'bizonyítéka így csak a kiküldött levelekben él: mentsd el a stáb-értesítőt.',
      { orderNumber: order?.orderNumber ?? null, receiptSent, staffNotified },
    )
  }

  log.info('elállási nyilatkozat feldolgozva', {
    orderFound: order !== null,
    recorded,
    receiptSent,
    staffNotified,
  })
  return { reference, receivedAt, recorded, receiptSent, staffNotified }
}
