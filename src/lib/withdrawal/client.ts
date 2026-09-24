import type { WithdrawalFormValues } from './validation'

/**
 * Az elállási űrlap beküldése a POST /api/elallas végpontra (böngészőből).
 * Tiszta modul: se React, se Next import, a `fetch` injektálható.
 */

/** A /elallas oldal és a rá mutató linkek webcíme. */
export const WITHDRAWAL_PATH = '/elallas'

/** A rendelésszámot előtöltő lekérdezési paraméter (a fiók és a visszaigazoló levél linkje). */
export const WITHDRAWAL_ORDER_PARAM = 'rendeles'

/**
 * A link felirata a lábléctől a levélig mindenhol. A szöveget a 45/2014.
 * Korm. rendelet 22. § (1b) írja elő („elállás a szerződéstől”); mondat
 * elején nagy kezdőbetűvel.
 */
export const WITHDRAWAL_LINK_LABEL = 'Elállás a szerződéstől'

/**
 * A nyilatkozat tartalmának mondata: ezt igazolja vissza az elismervény és a
 * visszaigazoló panel (a funkció gombja: „Elállás megerősítése”).
 */
export const WITHDRAWAL_STATEMENT = 'Elállok a szerződéstől.'

/** A beküldő gomb felirata, ugyancsak a 22. § (1b) szerint („elállás megerősítése”). */
export const WITHDRAWAL_SUBMIT_LABEL = 'Elállás megerősítése'

/** Az elállási oldal webcíme egy rendelésre, előtöltött rendelésszámmal. */
export function withdrawalHref(orderNumber?: string | null): string {
  const value = orderNumber?.trim()
  return value
    ? `${WITHDRAWAL_PATH}?${WITHDRAWAL_ORDER_PARAM}=${encodeURIComponent(value)}`
    : WITHDRAWAL_PATH
}

export interface WithdrawalReceipt {
  reference: string
  receivedAt: string
  receiptSent: boolean
}

export type WithdrawalSubmitResult =
  { ok: true; receipt: WithdrawalReceipt } | { ok: false; message: string }

export const WITHDRAWAL_GENERIC_ERROR =
  'A nyilatkozatot most nem tudtuk elküldeni. Próbáld újra néhány perc múlva, vagy írd meg e-mailben az elállási szándékodat.'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function submitWithdrawalForm(
  values: WithdrawalFormValues & { turnstileToken?: string | null; website?: string },
  fetchImpl: FetchLike = fetch,
): Promise<WithdrawalSubmitResult> {
  try {
    const response = await fetchImpl('/api/elallas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    })
    const body: unknown = await response.json().catch(() => null)
    if (
      response.ok &&
      isRecord(body) &&
      body.ok === true &&
      typeof body.reference === 'string' &&
      typeof body.receivedAt === 'string'
    ) {
      return {
        ok: true,
        receipt: {
          reference: body.reference,
          receivedAt: body.receivedAt,
          receiptSent: body.receiptSent === true,
        },
      }
    }
    const message = isRecord(body) && typeof body.error === 'string' ? body.error : null
    return { ok: false, message: message ?? WITHDRAWAL_GENERIC_ERROR }
  } catch {
    return { ok: false, message: WITHDRAWAL_GENERIC_ERROR }
  }
}
