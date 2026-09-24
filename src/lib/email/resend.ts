import { EmailSendError, type MailMessage } from './types'

/**
 * Resend provider — extra dependency nélkül, a Resend HTTP API-ján (fetch).
 * https://resend.com/docs/api-reference/emails/send-email
 *
 * Retry-szabály: 429 és 5xx (illetve hálózati hiba/timeout) újrapróbálható,
 * a többi 4xx végleges hiba. Kivétel a 409 `concurrent_idempotent_requests`:
 * ugyanazzal az idempotencia-kulccsal még fut egy korábbi kérés (pl. egy
 * időtúllépés után újrapróbáltunk), és a Resend szerint ezt később
 * biztonságosan meg lehet ismételni
 * (https://resend.com/docs/dashboard/emails/idempotency-keys).
 */
const RESEND_API_URL = 'https://api.resend.com/emails'
const RESEND_TIMEOUT_MS = 10_000

interface ResendSuccessBody {
  id?: string
}

/** A Resend hibakódja, amely szerint a kérés később biztonságosan megismételhető. */
const RESEND_CONCURRENT_IDEMPOTENT = 'concurrent_idempotent_requests'

/**
 * Mellékletek a Resend API alakjában: a tartalom base64, a MIME-típus
 * kifejezetten megadva (a karakterkészlettel együtt), nem a fájlnévből
 * kikövetkeztetve.
 */
function resendAttachments(message: MailMessage): Record<string, string>[] | undefined {
  if (!message.attachments || message.attachments.length === 0) {
    return undefined
  }
  return message.attachments.map((attachment) => ({
    filename: attachment.filename,
    content: Buffer.from(attachment.content, 'utf8').toString('base64'),
    content_type: attachment.contentType,
  }))
}

export async function sendViaResend(
  apiKey: string,
  from: string,
  message: MailMessage,
): Promise<{ id?: string }> {
  const attachments = resendAttachments(message)
  let response: Response
  try {
    response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        // Idempotencia-kulcs FEJLÉCBEN (nem a törzsben), a Resend dokumentációja
        // szerint; ugyanaz a kulcs 24 órán belül nem indít második levelet.
        ...(message.idempotencyKey ? { 'Idempotency-Key': message.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        ...(attachments ? { attachments } : {}),
      }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    })
  } catch (error) {
    // Hálózati hiba / timeout — mindig újrapróbálható.
    throw new EmailSendError(
      `Resend API elérhetetlen: ${error instanceof Error ? error.message : String(error)}`,
      true,
    )
  }

  if (response.ok) {
    const body = (await response.json().catch(() => ({}))) as ResendSuccessBody
    return { id: body.id }
  }

  const bodyText = await response.text().catch(() => '')
  const retryable =
    response.status === 429 ||
    response.status >= 500 ||
    (response.status === 409 && bodyText.includes(RESEND_CONCURRENT_IDEMPOTENT))
  throw new EmailSendError(
    `Resend API hiba (HTTP ${response.status}): ${bodyText.slice(0, 200)}`,
    retryable,
  )
}
