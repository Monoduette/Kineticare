import { formatFromAddress, maskEmail, parseFromAddress } from './mask'
import { logger } from '../logger'
import { sendViaResend } from './resend'
import { sendViaSmtp } from './smtp'
import {
  EmailSendError,
  type EmailProviderName,
  type MailAttachment,
  type MailMessage,
  type SendResult,
} from './types'

/**
 * Provider-választás és küldés (T-018).
 *
 * - RESEND_API_KEY beállítva → Resend HTTP API.
 * - Egyébként SMTP_HOST beállítva → SMTP (SMTP_PORT, SMTP_USER, SMTP_PASS).
 * - Egyik sincs → noop-provider: figyelmeztető napló, a küldés sikeresként
 *   tűnik el (dev/CI sosem crashel e-mail-konfig nélkül).
 *
 * A sendMail SOSEM dob hibát: a hiba strukturált SendResultként tér vissza
 * (retryable jelzéssel), a címzett maszkolva kerül a logba.
 */

export interface ResolvedEmailProvider {
  name: EmailProviderName
  from: { name: string; address: string }
  resendApiKey?: string
  smtp?: {
    host: string
    port: number
    user?: string
    pass?: string
  }
}

/** A provider-választáshoz szükséges env-kulcsok (mind opcionális). */
export interface EmailEnv {
  RESEND_API_KEY?: string
  SMTP_HOST?: string
  SMTP_PORT?: string
  SMTP_USER?: string
  SMTP_PASS?: string
  EMAIL_FROM?: string
  [key: string]: string | undefined
}

/** Tiszta, env-paraméterezhető feloldás — külön tesztelhető. */
export function resolveEmailProvider(env: EmailEnv): ResolvedEmailProvider {
  const from = parseFromAddress(env.EMAIL_FROM)
  if (env.RESEND_API_KEY) {
    return { name: 'resend', from, resendApiKey: env.RESEND_API_KEY }
  }
  if (env.SMTP_HOST) {
    const port = Number(env.SMTP_PORT ?? '587')
    return {
      name: 'smtp',
      from,
      smtp: {
        host: env.SMTP_HOST,
        port: Number.isFinite(port) ? port : 587,
        ...(env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : {}),
      },
    }
  }
  return { name: 'noop', from }
}

let cachedProvider: ResolvedEmailProvider | undefined
let noopWarned = false

function getProvider(): ResolvedEmailProvider {
  if (!cachedProvider) {
    cachedProvider = resolveEmailProvider(process.env)
    if (cachedProvider.name === 'noop' && !noopWarned) {
      noopWarned = true
      logger.warn(
        'e-mail provider nincs beállítva (RESEND_API_KEY / SMTP_HOST hiányzik) — noop-provider aktív, az e-mailek nem mennek ki',
      )
    } else {
      logger.info('e-mail provider kiválasztva', { provider: cachedProvider.name })
    }
  }
  return cachedProvider
}

/**
 * Tranzakciós e-mail küldése. Címzett maszkolva naplózva; a hiba sosem
 * propagálódik a hívó felé — a retryable jelzéssel a hívó (pl. egy későbbi
 * e-mail-queue job) eldöntheti, újrapróbálja-e.
 */
export interface SendMailInput {
  to: string | string[]
  subject: string
  html: string
  text: string
  /** Válasz-cím (Reply-To); lásd `MailMessage.replyTo`. */
  replyTo?: string
  /** Szolgáltató-oldali idempotencia-kulcs; lásd `MailMessage.idempotencyKey`. */
  idempotencyKey?: string
  /** Mellékletek; lásd `MailMessage.attachments`. */
  attachments?: MailAttachment[]
}

export async function sendMail(input: SendMailInput): Promise<SendResult> {
  const provider = getProvider()
  const message: MailMessage = {
    to: Array.isArray(input.to) ? input.to : [input.to],
    subject: input.subject,
    html: input.html,
    text: input.text,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    ...(input.attachments && input.attachments.length > 0
      ? { attachments: input.attachments }
      : {}),
  }
  const maskedTo = message.to.map(maskEmail)
  // A tárgy és a provider nyers hiba/azonosító szövege is tartalmazhat
  // látogatói adatot. Naplóba csak ez a zárt metaadatlista kerül; a valódi
  // üzenet és a SendResult ettől változatlanul jut el a címzetthez/hívóhoz.
  const logContext = {
    provider: provider.name,
    to: maskedTo,
    recipientCount: message.to.length,
    // A mellékletnek csak a DARABSZÁMA kerül a naplóba, a neve és a tartalma nem.
    ...(message.attachments ? { attachmentCount: message.attachments.length } : {}),
  }

  if (message.to.length === 0) {
    logger.warn('e-mail küldés kihagyva: nincs címzett', logContext)
    return { ok: false, provider: provider.name, retryable: false, error: 'nincs címzett' }
  }

  try {
    let id: string | undefined
    if (provider.name === 'resend') {
      const result = await sendViaResend(
        provider.resendApiKey as string,
        formatFromAddress(provider.from),
        message,
      )
      id = result.id
    } else if (provider.name === 'smtp') {
      const smtp = provider.smtp as NonNullable<ResolvedEmailProvider['smtp']>
      await sendViaSmtp(
        {
          host: smtp.host,
          port: smtp.port,
          ...(smtp.user ? { user: smtp.user, pass: smtp.pass } : {}),
          from: formatFromAddress(provider.from),
          fromAddress: provider.from.address,
        },
        message,
      )
    } else {
      logger.debug('noop e-mail provider — küldés szimulálva', logContext)
    }
    logger.info('e-mail elküldve', logContext)
    return { ok: true, provider: provider.name, ...(id ? { id } : {}) }
  } catch (error) {
    const retryable = error instanceof EmailSendError ? error.retryable : true
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.warn('e-mail küldés sikertelen', {
      ...logContext,
      retryable,
      errorKind: error instanceof EmailSendError ? 'email-send-error' : 'unexpected-error',
    })
    return { ok: false, provider: provider.name, retryable, error: errorMessage }
  }
}
