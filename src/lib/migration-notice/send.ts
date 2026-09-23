/**
 * Az átköltöztetési értesítő (WP40) KIKÜLDÉSE és a kiküldés JELÖLÉSE.
 *
 * A küldő függvény INJEKTÁLT (`options.send`): élesben a `sendMail`
 * (`src/lib/email/provider.ts`), tesztben mock. Tesztből SOSEM mehet ki valódi
 * hálózati hívás (CLAUDE.md 15. tanulság).
 *
 * Idempotencia két rétegben:
 *  1. Resend `Idempotency-Key` fejléc címzettenként (`migracio-<userId>`): ha a
 *     script a kérés után, de a jelölés előtt hal meg, a 24 órán belüli
 *     újrafutás nem küld második levelet
 *     (https://resend.com/docs/dashboard/emails/idempotency-keys).
 *  2. `users.migrationNoticeSentAt`: tartós nyilvántartás, a címzett-kör ezt
 *     szűri; újraküldés csak `--force`-szal.
 *
 * Ütemezés: a Resend alap-korlátja 10 kérés / másodperc csapatonként
 * (https://resend.com/docs/api-reference/rate-limit); 429-re a provider
 * `retryable` hibát ad. A szünet 250 ms (4 kérés / mp), ami a korlát alatt
 * marad akkor is, ha közben az oldal maga is küld (jelszó-visszaállítás).
 * Újrapróbálás: legfeljebb 2 további kísérlet, növekvő szünettel.
 */

import type { Payload } from 'payload'

import { maskEmail } from '../email/mask'
import type { SendMailInput } from '../email/provider'
import { kapcsolatiEmailPayloadbol } from '../contact-email-server'
import { migrationNoticeEmail } from '../email/templates/migration'
import type { SendResult } from '../email/types'
import type { Logger } from '../logger'
import type { MigrationNoticeRecipient } from './recipients'

/** Két küldés közti szünet (ms). */
export const MIGRATION_NOTICE_SEND_DELAY_MS = 250

/** Újrapróbálási szünetek (ms) az 1., 2. újrapróbálás előtt. */
export const MIGRATION_NOTICE_RETRY_DELAYS_MS: readonly number[] = [1_500, 4_000]

/**
 * Resend idempotencia-kulcs címzettenként (≤ 256 karakter).
 *
 * A kulcs alapból csak a fiókból áll, így egy megszakadt kör újraindítása
 * nem küld második levelet. A Resend a kulcsot 24 óráig őrzi: ezalatt egy
 * `--force` újraküldés ugyanazzal a kulccsal a szolgáltatónál NÉMA no-op
 * lenne (a válasz „elküldve", levél nem megy ki). Ezért a szándékos
 * újraküldés külön kör-azonosítót kap, ami a kulcs része.
 */
export function migrationNoticeIdempotencyKey(
  userId: MigrationNoticeRecipient['id'],
  round?: string,
): string {
  const base = `migracio-${String(userId)}`
  return round === undefined || round === '' ? base : `${base}-${round}`
}

/** A `--force` kör azonosítója: percre kerekített időbélyeg, kulcsbiztos jelekkel. */
export function migrationNoticeForceRound(now: Date): string {
  return `ujra-${now.toISOString().slice(0, 16).replace(/[-:T]/g, '')}`
}

export type MigrationNoticeSender = (input: SendMailInput) => Promise<SendResult>

export interface MigrationNoticeSendOutcome {
  readonly email: string
  readonly userId: MigrationNoticeRecipient['id']
  readonly ok: boolean
  /** Magyar hibaüzenet, ha `ok: false`. */
  readonly error?: string
  /** A levél kiment, de a `migrationNoticeSentAt` jelölés nem sikerült. */
  readonly markFailed?: boolean
  /** Hányadik kísérletre sikerült / bukott végleg (1-től). */
  readonly attempts: number
}

export interface MigrationNoticeSendSummary {
  elkuldve: number
  sikertelen: number
  jelolesSikertelen: number
}

export interface MigrationNoticeSendResult {
  readonly outcomes: readonly MigrationNoticeSendOutcome[]
  readonly summary: MigrationNoticeSendSummary
}

export interface SendMigrationNoticesOptions {
  /** A NEXT_PUBLIC_SERVER_URL; a levél linkje ebből épül. */
  readonly serverUrl: string
  /** A küldő; élesben `sendMail`, tesztben mock. */
  readonly send: MigrationNoticeSender
  readonly log?: Logger
  /** Szünet két küldés közt ms-ban. Alap: MIGRATION_NOTICE_SEND_DELAY_MS. */
  readonly delayMs?: number
  /** Várakozás; tesztből felülírható, hogy ne teljen valós idő. */
  readonly sleep?: (ms: number) => Promise<void>
  /** Soronkénti visszajelzés a CLI-nek (a lib maga nem ír a kimenetre). */
  readonly onOutcome?: (outcome: MigrationNoticeSendOutcome) => void
  /** Az időbélyeg forrása (tesztelhetőség). */
  readonly now?: () => Date
  /**
   * Szándékos újraküldés (`--force`) kör-azonosítója; az idempotencia-kulcs
   * része lesz, hogy a szolgáltató ne nyelje el a levelet. Alapból nincs.
   */
  readonly idempotencyRound?: string
  /**
   * A feloldott kapcsolati e-mail (a Reply-To és a lábléc-mondat). A CLI a
   * futás elején egyszer feloldja és átadja; elhagyva a kiküldő maga oldja
   * fel a `kapcsolatiEmailPayloadbol`-lal (hibánál a kódtartalék).
   */
  readonly replyTo?: string
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/** Egy címzett küldése újrapróbálással; a hívó dönt a jelölésről. */
async function sendWithRetry(
  send: MigrationNoticeSender,
  input: SendMailInput,
  sleep: (ms: number) => Promise<void>,
): Promise<{ result: SendResult; attempts: number }> {
  let attempts = 0
  let last: SendResult = { ok: false, provider: 'noop', retryable: false, error: 'nem indult el' }
  for (;;) {
    attempts += 1
    try {
      last = await send(input)
    } catch (error) {
      last = {
        ok: false,
        provider: 'noop',
        retryable: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
    if (last.ok || last.retryable !== true) {
      return { result: last, attempts }
    }
    const delay = MIGRATION_NOTICE_RETRY_DELAYS_MS[attempts - 1]
    if (delay === undefined) {
      return { result: last, attempts }
    }
    await sleep(delay)
  }
}

/**
 * Az értesítő kiküldése a címzetteknek, sikeres küldés után a fiók jelölése.
 * Üres lista NEM hiba; egy bukott küldés nem állítja meg a kört.
 */
export async function sendMigrationNotices(
  payload: Payload,
  recipients: readonly MigrationNoticeRecipient[],
  options: SendMigrationNoticesOptions,
): Promise<MigrationNoticeSendResult> {
  const outcomes: MigrationNoticeSendOutcome[] = []
  const summary: MigrationNoticeSendSummary = { elkuldve: 0, sikertelen: 0, jelolesSikertelen: 0 }
  const delayMs = options.delayMs ?? MIGRATION_NOTICE_SEND_DELAY_MS
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? (() => new Date())
  // A kapcsolati e-mail a futás elején EGYSZER (nem címzettenként): minden
  // levél ugyanazt a Reply-To-t és lábléc-mondatot kapja.
  const replyTo = options.replyTo ?? (await kapcsolatiEmailPayloadbol(payload))

  for (const [index, recipient] of recipients.entries()) {
    if (index > 0 && delayMs > 0) {
      await sleep(delayMs)
    }

    const template = migrationNoticeEmail({
      name: recipient.name,
      email: recipient.email,
      serverUrl: options.serverUrl,
      replyTo,
    })
    const { result, attempts } = await sendWithRetry(
      options.send,
      {
        to: recipient.email,
        subject: template.subject,
        html: template.html,
        text: template.text,
        replyTo,
        idempotencyKey: migrationNoticeIdempotencyKey(recipient.id, options.idempotencyRound),
      },
      sleep,
    )

    let outcome: MigrationNoticeSendOutcome
    if (!result.ok) {
      outcome = {
        email: recipient.email,
        userId: recipient.id,
        ok: false,
        error: result.error ?? 'a levelező-szolgáltató elutasította a küldést',
        attempts,
      }
      summary.sikertelen += 1
      options.log?.warn('átköltöztetési értesítő: küldés sikertelen', {
        cimzett: maskEmail(recipient.email),
        userId: recipient.id,
        attempts,
        error: outcome.error,
      })
    } else {
      let markFailed = false
      try {
        await payload.update({
          collection: 'users',
          id: recipient.id,
          data: { migrationNoticeSentAt: now().toISOString() },
          overrideAccess: true,
          depth: 0,
        })
      } catch (error) {
        markFailed = true
        summary.jelolesSikertelen += 1
        options.log?.warn('átköltöztetési értesítő: a kiküldés jelölése sikertelen', {
          cimzett: maskEmail(recipient.email),
          userId: recipient.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      outcome = { email: recipient.email, userId: recipient.id, ok: true, markFailed, attempts }
      summary.elkuldve += 1
    }

    outcomes.push(outcome)
    options.onOutcome?.(outcome)
  }

  options.log?.info('átköltöztetési értesítők kiküldve', {
    elkuldve: summary.elkuldve,
    sikertelen: summary.sikertelen,
    jelolesSikertelen: summary.jelolesSikertelen,
  })

  return { outcomes, summary }
}
