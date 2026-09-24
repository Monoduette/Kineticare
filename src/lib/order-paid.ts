import type { Payload } from 'payload'

import type { Order } from '../payload-types'
import { isSzamlazzEnabled } from './szamlazz'
import { ORDER_MAINTENANCE_QUEUE } from '../jobs/queues'
import {
  GUEST_ACTIVATION_TOKEN_TTL_DAYS,
  GUEST_ACTIVATION_TOKEN_TTL_MS,
} from './security/activation-token'
import { durationDaysFromProduct } from './access-grants'
import { auditLogStore, writeAuditLog, type AuditLogStore } from './audit'
import { sendMail, type SendResult } from './email'
import { maskEmail } from './email/mask'
import { isUsableReplyToAddress } from './email/reply-to'
import {
  orderConfirmationEmail,
  ORDER_CONFIRMATION_TEMPLATE_VERSION,
  type OrderConfirmationAccount,
} from './email/templates/order'
import { loadOrderLegalInfo, type OrderLegalInfo } from './email/templates/order-legal'
import type { MailAttachment } from './email/types'
import { logger as rootLogger, type Logger } from './logger'
import { buildPasswordResetUrl } from './password-reset-url'
import { signInHref } from './return-url'
import { postAuthLibraryOrPlayerHref, productIdsFromOrderItems } from './courses'

/**
 * Friss paid-átmenet mellékhatásai: invoice-issue job + visszaigazoló levél.
 * Csak `transitionedToPaid=true` esetén; sosem dob.
 *
 * A visszaigazoló levél NEM udvariassági levél: a 45/2014. (II. 26.) Korm.
 * rendelet 18. §-a szerinti, tartós adathordozón adott visszaigazolás, és a
 * 29. § (1) m) szerinti elállási kivétel csak akkor él, ha kiment. Ezért:
 * - átmeneti hibánál (hálózat, 429, 5xx) a küldést újrapróbáljuk, ugyanazzal
 *   az idempotencia-kulccsal, így a vevő akkor sem kap két levelet, ha egy
 *   időtúllépett kérés valójában célba ért;
 * - ha végül nem megy ki, `error`-szintű RIASZTÁS jelzi (a rendelés
 *   azonosítójával), hogy a stáb kézzel pótolhassa;
 * - a sikeres küldés bizonyítéka (időpont, szolgáltatói üzenet-azonosító,
 *   sablon- és ÁSZF-változat) a megváltoztathatatlan műveletnaplóba kerül
 *   (audit-logs), mert a tájékoztatás bizonyítása a vállalkozást terheli
 *   (45/2014. Korm. rendelet 11. § (7)).
 */

/** A műveletnapló-bejegyzés kódja a visszaigazoló levél elküldéséről. */
export const ORDER_CONFIRMATION_AUDIT_ACTION = 'order-confirmation-email'

/**
 * Várakozás az újrapróbák előtt: az első kísérlet után 2, a második után 6
 * másodperc. A Resend az 5xx hibákra növekvő várakozású újrapróbát ajánl
 * (https://resend.com/docs/dashboard/emails/idempotency-keys). A Barion-
 * callback ágon a feldolgozás a válasz UTÁN fut (`after()`), így a várakozás
 * a Barion felé adott választ nem késlelteti.
 */
export const CONFIRMATION_RETRY_DELAYS_MS: readonly number[] = [2_000, 6_000]

/** A visszaigazoló levél küldésének bemenete (a provider-réteg `sendMail`-jével egyező alak). */
export interface ConfirmationMailInput {
  to: string
  subject: string
  html: string
  text: string
  replyTo?: string
  idempotencyKey?: string
  attachments?: MailAttachment[]
}

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
  send?: (input: ConfirmationMailInput) => Promise<SendResult>
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
  /** Injektálható ÁSZF- és szolgáltatóadat-betöltő (teszteléshez); alapból az aszf.txt. */
  loadLegalInfo?: () => OrderLegalInfo
  /**
   * Injektálható hozzáférés-hossz lekérdezés termékazonosítónként (teszteléshez);
   * alapból a products collection `accessDurationDays` mezője. Érték: napok
   * száma, vagy `null`, ha a hozzáférés nem jár le.
   */
  loadAccessDurations?: (productIds: number[]) => Promise<Map<number, number | null>>
  /** Injektálható várakozás az újrapróbák között (teszteléshez). */
  sleep?: (ms: number) => Promise<void>
  /** Injektálható műveletnapló (teszteléshez); alapból a Payload audit-logs collection. */
  auditStore?: AuditLogStore
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

/** A termékek hozzáférési ideje a products collectionből (csak a szükséges mező). */
async function defaultAccessDurations(
  payload: Payload,
  productIds: number[],
): Promise<Map<number, number | null>> {
  const found = await payload.find({
    collection: 'products',
    where: { id: { in: productIds } },
    depth: 0,
    limit: productIds.length,
    pagination: false,
    overrideAccess: true,
    select: { accessDurationDays: true },
  })
  return new Map(found.docs.map((doc) => [doc.id, durationDaysFromProduct(doc)]))
}

/**
 * A rendelés tételeinek hozzáférési ideje. A populate-olt terméknél a
 * dokumentum mezőjét használja, a puszta azonosítónál lekérdez. Hiba esetén a
 * hiányzó termékek kimaradnak: a levél ilyenkor nem állít semmit a hozzáférés
 * hosszáról (inkább hallgat, mint hogy téveset írjon), a küldés ettől nem bukik.
 */
async function resolveAccessDurations(
  deps: OnOrderPaidDeps,
  log: Logger,
): Promise<Map<number, number | null>> {
  const durations = new Map<number, number | null>()
  for (const item of deps.order.items ?? []) {
    const product = item.product
    if (typeof product === 'object' && product !== null) {
      durations.set(product.id, durationDaysFromProduct(product))
    }
  }
  const missing = productIdsFromOrderItems(deps.order.items).filter((id) => !durations.has(id))
  if (missing.length === 0) {
    return durations
  }
  try {
    const load =
      deps.loadAccessDurations ?? ((ids: number[]) => defaultAccessDurations(deps.payload, ids))
    for (const [id, days] of await load(missing)) {
      durations.set(id, days)
    }
  } catch (error) {
    log.warn('a kurzusok hozzáférési ideje nem olvasható, a levél e nélkül megy', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return durations
}

/**
 * Az ÁSZF és a szolgáltató adatai. A hiba nem állítja meg a levelet (a
 * nyilatkozatok visszaigazolása és a rendelés adatai ettől még kimennek), de
 * RIASZTÁST ad, mert így a levélből hiányzik a kötelező tájékoztatás egy része.
 */
function resolveLegalInfo(deps: OnOrderPaidDeps, log: Logger): OrderLegalInfo | null {
  try {
    const legal = (deps.loadLegalInfo ?? (() => loadOrderLegalInfo()))()
    if (legal.seller === null) {
      log.error(
        'RIASZTÁS: az ÁSZF „KINETICARE adatai" blokkja hiányos vagy nem értelmezhető, ezért ' +
          'a visszaigazoló levélből kimaradnak a szolgáltató adatai. Ellenőrizd a ' +
          'src/lib/legal-source/aszf.txt fájlt, és küldd el kézzel a hiányzó adatokat a vevőnek.',
      )
    }
    return legal
  } catch (error) {
    log.error(
      'RIASZTÁS: az ÁSZF nem olvasható, ezért a visszaigazoló levél ÁSZF-melléklet és ' +
        'szolgáltatói adatok nélkül megy ki. Küldd el kézzel az ÁSZF-et a vevőnek.',
      { error: error instanceof Error ? error.message : String(error) },
    )
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

    const accessDurations = await resolveAccessDurations(deps, log)
    const items = (deps.order.items ?? []).map((item) => {
      const quantity = item.quantity ?? 1
      const unit = item.priceHufSnapshot ?? 0
      const productId = typeof item.product === 'object' ? item.product?.id : item.product
      return {
        title: item.titleSnapshot?.trim() || 'Kineticare online kurzus',
        quantity,
        totalHuf: unit * quantity,
        ...(typeof productId === 'number' && accessDurations.has(productId)
          ? { accessDurationDays: accessDurations.get(productId) ?? null }
          : {}),
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

    /**
     * Az elállási nyilatkozatok visszaigazolása CSAK akkor kerül a levélbe, ha
     * a vevő a pénztárban ténylegesen megtette őket (a rendelés rögzíti). Ha
     * a nyilatkozat hiányzik, a levél nem állíthatja, hogy megtörtént.
     */
    const waiverGiven = deps.order.consentWithdrawalWaiver === true
    const waiverAt = deps.order.consentWithdrawalWaiverAt ?? null
    if (!waiverGiven) {
      log.warn('a rendelésen nincs elállási nyilatkozat, a levél ilyet nem igazol vissza')
    } else if (waiverAt === null) {
      log.warn('az elállási nyilatkozat időpontja hiányzik, a levél időpont nélkül igazol vissza')
    }

    const legal = resolveLegalInfo(deps, log)
    const seller = legal?.seller ?? null
    const attachment = legal?.aszf.attachment ?? null
    const orderNumber = deps.order.orderNumber ?? `#${deps.order.id}`

    const template = orderConfirmationEmail({
      orderNumber,
      buyerName: snapshotString(snapshot, 'name') || null,
      items,
      totalHuf,
      coursesUrl: `${serverUrl}${returnPath}`,
      // `isSzamlazzEnabled()` — a levél sorsa ne függjön a számlázási konfig dobásától.
      invoiceNote: isSzamlazzEnabled(),
      ...(account ? { account } : {}),
      withdrawalWaiverAt: waiverGiven ? (waiverAt ?? '') : null,
      seller,
      terms: { url: `${serverUrl}/aszf`, attachment },
    })

    const replyTo = seller && isUsableReplyToAddress(seller.email) ? seller.email : undefined
    const message: ConfirmationMailInput = {
      to: recipient,
      ...template,
      ...(replyTo ? { replyTo } : {}),
      idempotencyKey: `kineticare-order-confirmation-${deps.order.id}`,
    }

    const send = deps.send ?? sendMail
    const sleep =
      deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    let attempts = 0
    let result: SendResult
    for (;;) {
      attempts += 1
      result = await send(message)
      const lastAttempt = attempts > CONFIRMATION_RETRY_DELAYS_MS.length
      if (result.ok || result.retryable === false || lastAttempt) {
        break
      }
      log.warn('visszaigazoló e-mail küldése sikertelen, újrapróbálom', {
        attempt: attempts,
        retryable: result.retryable,
        error: result.error,
      })
      await sleep(CONFIRMATION_RETRY_DELAYS_MS[attempts - 1])
    }

    if (!result.ok) {
      log.error(
        'RIASZTÁS: a kötelező visszaigazoló e-mail NEM ment ki (45/2014. Korm. rendelet 18. §). ' +
          'Amíg nem pótolod, az elállási jog kizárása erre a rendelésre nem érvényes. Küldd el ' +
          'kézzel a visszaigazolást, vagy javítsd az e-mail-szolgáltató beállítását.',
        { attempts, retryable: result.retryable, error: result.error },
      )
      return
    }

    if (result.provider === 'noop') {
      // Szolgáltató nélkül a küldés csak szimulált: élesben ez NEM visszaigazolás.
      if (process.env.NODE_ENV === 'production') {
        log.error(
          'RIASZTÁS: nincs e-mail-szolgáltató beállítva (RESEND_API_KEY / SMTP_HOST), a ' +
            'kötelező visszaigazoló e-mail NEM ment ki. Állítsd be a szolgáltatót, és küldd el ' +
            'kézzel a visszaigazolást.',
        )
      } else {
        log.info('visszaigazoló e-mail szimulálva (noop e-mail-szolgáltató)')
      }
      return
    }

    const recorded = await writeAuditLog({
      store: deps.auditStore ?? auditLogStore(deps.payload),
      action: ORDER_CONFIRMATION_AUDIT_ACTION,
      entityType: 'orders',
      entityId: deps.order.id,
      after: {
        orderNumber,
        sentAt: new Date().toISOString(),
        recipient,
        provider: result.provider,
        providerMessageId: result.id ?? null,
        attempts,
        templateVersion: ORDER_CONFIRMATION_TEMPLATE_VERSION,
        withdrawalWaiverConfirmed: waiverGiven,
        withdrawalWaiverAt: waiverGiven ? waiverAt : null,
        sellerIncluded: seller !== null,
        aszfAttached: attachment !== null,
        aszfSha256: legal?.aszf.sha256 ?? null,
        aszfKelt: legal?.aszf.kelt ?? null,
      },
    })
    if (recorded) {
      log.info('visszaigazoló e-mail elküldve és rögzítve', {
        provider: result.provider,
        providerMessageId: result.id ?? null,
        attempts,
      })
    } else {
      log.error(
        'RIASZTÁS: a visszaigazoló e-mail kiment, de a küldés bizonyítéka nem került a ' +
          'műveletnaplóba. Mentsd el a szolgáltatói üzenet-azonosítót a rendelés mellé.',
        { provider: result.provider, providerMessageId: result.id ?? null },
      )
    }
  } catch (error) {
    log.error(
      'RIASZTÁS: a visszaigazoló e-mail összeállítása vagy küldése kivétellel leállt, a ' +
        'levél valószínűleg NEM ment ki. Küldd el kézzel a visszaigazolást.',
      { error: error instanceof Error ? error.message : String(error) },
    )
  }
}
