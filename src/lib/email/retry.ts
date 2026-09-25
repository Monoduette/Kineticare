import type { SendMailInput } from './provider'
import type { SendResult } from './types'

/**
 * Tranzakciós levél küldése átmeneti hibánál újrapróbálással.
 *
 * Újrapróba CSAK ott, ahol az ismétlés nem kettőzheti a levelet:
 * - a hiba kifejezetten újrapróbálható (`retryable === true`: Resend 429, 5xx,
 *   hálózati hiba vagy időtúllépés; SMTP-n a levél tartalma előtti hiba vagy
 *   a szerver kifejezett 4xx-e);
 * - a kézbesítés NEM bizonytalan (`deliveryUncertain`): az SMTP a lezáró pont
 *   után megszakadt kapcsolatnál már átvehette a levelet, és nem szűri az
 *   ismétlést (RFC 1047), ezért ott nincs automatikus újraküldés;
 * - minden kísérlet UGYANAZT az idempotencia-kulcsot viszi (a típus
 *   kötelezővé teszi): a Resend a kulccsal 24 órán belül a második kérést nem
 *   küldi ki újra, így egy célba ért, de időtúllépett kérés ismétlése sem
 *   kettőz (https://resend.com/docs/dashboard/emails/idempotency-keys).
 *
 * A várakozás injektált (`sleep`), hogy a teszt ne töltsön valós időt. A küldő
 * kivételét a hívó kapja meg (a `sendMail` maga sosem dob).
 */

export type RetryableMailInput = SendMailInput & { idempotencyKey: string }

export interface SendWithRetryOptions {
  /** Várakozás az 1., 2., … újrapróba előtt; a hossza adja az újrapróbák számát. */
  readonly delaysMs: readonly number[]
  readonly sleep: (ms: number) => Promise<void>
  /** Minden újrapróba ELŐTT hívódik (naplózáshoz). */
  readonly onRetry?: (info: { attempt: number; result: SendResult }) => void
}

export interface SendWithRetryOutcome {
  readonly result: SendResult
  readonly attempts: number
}

/** Szabad-e ugyanazt a levelet automatikusan újra elküldeni. */
export function shouldRetrySend(result: SendResult): boolean {
  return !result.ok && result.retryable === true && result.deliveryUncertain !== true
}

export async function sendWithRetry<TInput extends RetryableMailInput>(
  send: (input: TInput) => Promise<SendResult>,
  input: TInput,
  options: SendWithRetryOptions,
): Promise<SendWithRetryOutcome> {
  let attempts = 0
  for (;;) {
    attempts += 1
    const result = await send(input)
    const delay = options.delaysMs[attempts - 1]
    if (!shouldRetrySend(result) || delay === undefined) {
      return { result, attempts }
    }
    options.onRetry?.({ attempt: attempts, result })
    await options.sleep(delay)
  }
}

/** Valós várakozás (az éles hívók alapértelmezése). */
export const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
