import type { Payload } from 'payload'

import type { Order } from '../payload-types'
import { isSzamlazzEnabled } from './szamlazz'
import { ORDER_MAINTENANCE_QUEUE } from '../jobs/queues'
import {
  GUEST_ACTIVATION_TOKEN_TTL_DAYS,
  GUEST_ACTIVATION_TOKEN_TTL_MS,
} from './security/activation-token'
import { sendMail, type SendResult } from './email'
import { maskEmail } from './email/mask'
import { orderConfirmationEmail, type OrderConfirmationAccount } from './email/templates/order'
import { logger as rootLogger, type Logger } from './logger'
import { buildPasswordResetUrl } from './password-reset-url'
import { signInHref } from './return-url'
import { postAuthLibraryOrPlayerHref, productIdsFromOrderItems } from './courses'

/**
 * Friss paid-átmenet mellékhatásai: invoice-issue job + visszaigazoló levél.
 * Csak `transitionedToPaid=true` esetén; best-effort, sosem dob.
 */

type JobsQueueLike = {
  queue?: (args: {
    task: string
    input?: Record<string, unknown>
    queue?: string
  }) => Promise<unknown>
}

/** invoice-issue job sorba állítása; hiányzó `payload.jobs.queue` → RIASZTÁS (nem néma). */
export async function queueInvoiceIssueJob(
  payload: Payload,
  orderId: number,
  log?: Logger,
): Promise<boolean> {
  try {
    const jobs = (payload as unknown as { jobs?: JobsQueueLike }).jobs
    if (typeof jobs?.queue !== 'function') {
      const alertLog = log ?? rootLogger
      alertLog.error(
        'RIASZTÁS: a Payload job-sor nem érhető el (payload.jobs.queue hiányzik) — a ' +
          'számlakiállítási job NEM állt sorba, a vevő számlája elmarad, holott a ' +
          'visszaigazoló levél ígéri. Ellenőrizd a Payload jobs-konfigurációt és az ' +
          'invoice-issue task regisztrációját.',
        { orderId },
      )
      return false
    }
    await jobs.queue({ task: 'invoice-issue', input: { orderId }, queue: ORDER_MAINTENANCE_QUEUE })
    log?.info('számlakiállítási job sorba állítva', { orderId })
    return true
  } catch (error) {
    log?.warn('számlakiállítási job sorba állítása sikertelen (best-effort)', {
      orderId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

interface CustomerSnapshotShape {
  name?: unknown
  email?: unknown
}

function snapshotString(snapshot: CustomerSnapshotShape, key: keyof CustomerSnapshotShape): string {
  const value = snapshot[key]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * A rendeléshez feloldott fiók — az apply-barion-state magja adja át.
 * Szándékosan a MINIMÁLIS felület (nem a teljes OrderCustomerResolution),
 * hogy a mellékhatás-modul ne függjön az állapotgéptől.
 */
export interface OrderPaidAccount {
  /** true, ha a vevőnek még nincs saját jelszava → jelszó-beállító link jár neki. */
  passwordSetupPending: boolean
  /** true, ha a rendelés már a fiókhoz volt kötve (bejelentkezett vásárlás). */
  alreadyLinked: boolean
  /** A fiók e-mail-címe (a levél és az aktiváló link címzettje). */
  email: string | null
}

export interface OnOrderPaidDeps {
  payload: Payload
  order: Order
  logger?: Logger
  /** Injektálható küldő (teszteléshez); alapból a provider-réteg sendMail-je. */
  send?: (input: { to: string; subject: string; html: string; text: string }) => Promise<SendResult>
  /** Injektálható job-queue (teszteléshez); alapból a valódi queueInvoiceIssueJob. */
  queueInvoice?: (orderId: number) => Promise<boolean>
  /**
   * A rendeléshez feloldott fiók. Hiányában a levél a KORÁBBI (bejelentkezett)
   * alakjában megy ki — így a régi hívási helyek viselkedése változatlan.
   */
  account?: OrderPaidAccount
  /**
   * Injektálható aktiváló-link-készítő (teszteléshez); alapból a Payload
   * `forgotPassword` tokenjéből épült jelszó-beállító link. `null` = a link nem
   * készíthető el (ilyenkor a levél a belépésre irányít).
   */
  createActivationUrl?: (input: {
    email: string
    serverUrl: string
    returnUrl: string
  }) => Promise<string | null>
}

/**
 * Jelszó-beállító (aktiváló) link a Payload SAJÁT reset-tokenjéből.
 *
 * A hiba NEM végzetes: `null` esetén a levél a belépésre irányító változatban
 * megy ki (ott is szerepel az „Elfelejtett jelszó" út), a fizetési főlánc pedig
 * érintetlen. A naplóba SEM a token, SEM a link nem kerül.
 */
async function defaultActivationUrl(
  payload: Payload,
  input: { email: string; serverUrl: string; returnUrl: string },
  log: Logger,
): Promise<string | null> {
  try {
    // A visszatérési érték a Payload típusa szerint string, futásidőben viszont
    // ismeretlen e-mailnél `null` — ezért unknown + típusszűkítés (az
    // src/lib/customer-import/invite.ts mintája).
    const token: unknown = await payload.forgotPassword({
      collection: 'users',
      data: { email: input.email },
      disableEmail: true,
      expiration: GUEST_ACTIVATION_TOKEN_TTL_MS,
    })
    if (typeof token !== 'string' || token === '') {
      log.warn('aktiváló link nem készült el (a felhasználó nem található)', {
        cimzett: maskEmail(input.email),
      })
      return null
    }
    return buildPasswordResetUrl(input.serverUrl, token, input.returnUrl)
  } catch (error) {
    log.warn('aktiváló link készítése sikertelen (best-effort — a levél belépés-linkkel megy)', {
      cimzett: maskEmail(input.email),
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/** A friss paid-átmenet mellékhatásai — sosem dob, minden hiba naplózva. */
export async function onOrderPaid(deps: OnOrderPaidDeps): Promise<void> {
  const log = (deps.logger ?? rootLogger).child({
    module: 'order-paid',
    orderId: deps.order.id,
    orderNumber: deps.order.orderNumber ?? null,
  })

  try {
    const queueInvoice =
      deps.queueInvoice ?? ((orderId: number) => queueInvoiceIssueJob(deps.payload, orderId, log))
    await queueInvoice(deps.order.id)
  } catch (error) {
    // A függvény sosem dob: a queue-hiba naplózva, az e-mail ettől megy,
    // a számla a következő order-poll resweepből is utolérhető.
    log.warn('számla-job sorba állítása kivétellel állt le (best-effort)', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    const snapshot =
      typeof deps.order.customerSnapshot === 'object' && deps.order.customerSnapshot !== null
        ? (deps.order.customerSnapshot as CustomerSnapshotShape)
        : {}
    const recipient = (deps.order.customerEmail ?? '').trim() || snapshotString(snapshot, 'email')
    if (!recipient) {
      log.warn('visszaigazoló e-mail kihagyva: nincs címzett a rendelésen')
      return
    }

    const items = (deps.order.items ?? []).map((item) => {
      const quantity = item.quantity ?? 1
      const unit = item.priceHufSnapshot ?? 0
      return {
        title: item.titleSnapshot?.trim() || 'Kineticare online kurzus',
        quantity,
        totalHuf: unit * quantity,
      }
    })
    const totalHuf =
      typeof deps.order.totalHufSnapshot === 'number'
        ? deps.order.totalHufSnapshot
        : items.reduce((sum, item) => sum + item.totalHuf, 0)

    const serverUrl = (process.env.NEXT_PUBLIC_SERVER_URL ?? '').replace(/\/+$/, '')
    const returnPath = postAuthLibraryOrPlayerHref(productIdsFromOrderItems(deps.order.items))

    /**
     * Levél változata: jelszó-beállító link (passwordSetupPending) vagy Kurzusaim/belépés.
     */
    const accountEmail = (deps.account?.email ?? '').trim() || recipient
    let account: OrderConfirmationAccount | undefined
    if (deps.account?.passwordSetupPending === true) {
      const createActivationUrl =
        deps.createActivationUrl ??
        ((activationInput: { email: string; serverUrl: string; returnUrl: string }) =>
          defaultActivationUrl(deps.payload, activationInput, log))
      const activationUrl = await createActivationUrl({
        email: accountEmail,
        serverUrl,
        returnUrl: returnPath,
      })
      account =
        activationUrl === null
          ? {
              kind: 'login',
              loginUrl: `${serverUrl}${signInHref(returnPath)}`,
              email: accountEmail,
            }
          : {
              kind: 'password-setup',
              activationUrl,
              expiresInDays: GUEST_ACTIVATION_TOKEN_TTL_DAYS,
              email: accountEmail,
            }
    } else if (deps.account && !deps.account.alreadyLinked) {
      account = {
        kind: 'login',
        loginUrl: `${serverUrl}${signInHref(returnPath)}`,
        email: accountEmail,
      }
    }

    const template = orderConfirmationEmail({
      orderNumber: deps.order.orderNumber ?? `#${deps.order.id}`,
      buyerName: snapshotString(snapshot, 'name') || null,
      items,
      totalHuf,
      coursesUrl: `${serverUrl}${returnPath}`,
      // `isSzamlazzEnabled()` — a levél sorsa ne függjön a számlázási konfig dobásától.
      invoiceNote: isSzamlazzEnabled(),
      ...(account ? { account } : {}),
    })

    const send = deps.send ?? sendMail
    const result = await send({ to: recipient, ...template })
    if (!result.ok) {
      log.warn('visszaigazoló e-mail küldése sikertelen (best-effort)', {
        retryable: result.retryable,
        error: result.error,
      })
    }
  } catch (error) {
    log.warn('visszaigazoló e-mail feldolgozása sikertelen (best-effort)', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
