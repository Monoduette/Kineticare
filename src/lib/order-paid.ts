import type { Payload } from 'payload'

import type { Order } from '../payload-types'
import { isSzamlazzEnabled } from './szamlazz'
import { ORDER_MAINTENANCE_QUEUE } from '../jobs/queues'
import {
  GUEST_ACTIVATION_TOKEN_TTL_DAYS,
  GUEST_ACTIVATION_TOKEN_TTL_MS,
} from './security/activation-token'
import { durationDaysFromProduct } from './access-grants'
import { shouldEmitThrottledAlert } from './alert-throttle'
import { auditLogStore, writeAuditLog, type AuditLogStore } from './audit'
import { KAPCSOLATI_EMAIL_TARTALEK } from './contact-email'
import { kapcsolatiEmailPayloadbol } from './contact-email-server'
import { sendMail, type SendResult } from './email'
import { maskEmail, maskEmailsInText } from './email/mask'
import { isUsableReplyToAddress } from './email/reply-to'
import { realSleep, sendWithRetry } from './email/retry'
import {
  orderConfirmationEmail,
  ORDER_CONFIRMATION_TEMPLATE_VERSION,
  type OrderConfirmationAccount,
} from './email/templates/order'
import {
  ASZF_OLDAL_WEBCIM,
  loadOrderLegalInfo,
  orderLegalInfoFromAszfPage,
  type OrderLegalInfo,
} from './email/templates/order-legal'
import type { MailAttachment } from './email/types'
import { logger as rootLogger, type Logger } from './logger'
import { buildPasswordResetUrl } from './password-reset-url'
import { signInHref } from './return-url'
import { postAuthLibraryOrPlayerHref, productIdsFromOrderItems } from './courses'
import { withdrawalHref } from './withdrawal/client'

/**
 * Friss paid-átmenet mellékhatásai: invoice-issue job + visszaigazoló levél.
 * Csak `transitionedToPaid=true` esetén; sosem dob.
 *
 * A visszaigazoló levél NEM udvariassági levél: a 45/2014. (II. 26.) Korm.
 * rendelet 18. §-a szerinti, tartós adathordozón adott visszaigazolás, és a
 * 29. § (1) m) szerinti elállási kivétel csak akkor él, ha kiment. Ezért:
 * - átmeneti hibánál (hálózat, 429, 5xx) a küldést újrapróbáljuk, ugyanazzal
 *   az idempotencia-kulccsal, így a vevő akkor sem kap két levelet, ha egy
 *   időtúllépett kérés valójában célba ért (src/lib/email/retry.ts);
 * - BIZONYTALAN kézbesítésnél (SMTP: a levél tartalma után szakadt meg a
 *   kapcsolat, `deliveryUncertain`) NINCS automatikus újraküldés, mert az SMTP
 *   nem szűri az ismétlést: RIASZTÁS kéri az egyeztetést, és a műveletnapló
 *   rögzíti a bizonytalan küldést;
 * - ha végül nem megy ki, `error`-szintű RIASZTÁS jelzi (a rendelés
 *   azonosítójával), hogy a stáb kézzel pótolhassa;
 * - ha a szolgáltató a mellékletes levelet VÉGLEG elutasítja (pl. a
 *   mellékletet kifogásolja), a levél egyszer melléklet nélkül, csak az ÁSZF
 *   linkjével megy ki, SAJÁT idempotencia-kulccsal (ugyanazzal a kulccsal
 *   más tartalmat a Resend elutasítana), és RIASZTÁS kéri az ÁSZF kézi
 *   megküldését;
 * - a sikeres küldés bizonyítéka (időpont, szolgáltatói üzenet-azonosító,
 *   sablon- és ÁSZF-változat, az ÁSZF forrása) a megváltoztathatatlan
 *   műveletnaplóba kerül (audit-logs), mert a tájékoztatás bizonyítása a
 *   vállalkozást terheli (45/2014. Korm. rendelet 11. § (7)).
 *
 * Az ÁSZF és a szolgáltató adatai a KÖZZÉTETT /aszf oldalból jönnek (azt
 * fogadta el a vevő), a repó aszf.txt-je csak tartalék (lásd
 * src/lib/email/templates/order-legal.ts). A kérdésekre és panaszokra szolgáló
 * cím (válaszcím, lábléc) a weboldal kapcsolati címe (tulajdonosi döntés K14).
 *
 * A szolgáltatói hibaszöveg a naplóba MASZKOLVA kerül (`maskEmailsInText`):
 * egy SMTP-elutasítás szó szerint megismételheti a vevő címét, a napló pedig
 * a címet csak maszkolva hordozhatja (src/lib/logger.ts).
 */

/** A műveletnapló-bejegyzés kódja a visszaigazoló levél elküldéséről. */
export const ORDER_CONFIRMATION_AUDIT_ACTION = 'order-confirmation-email'

/**
 * A műveletnapló-bejegyzés kódja a BIZONYTALAN kézbesítésű visszaigazolóról
 * (a levél célba érhetett, de a szolgáltató átvételét nem igazolta).
 */
export const ORDER_CONFIRMATION_UNCERTAIN_AUDIT_ACTION = 'order-confirmation-email-uncertain'

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
  /**
   * Injektálható olvasó a KÖZZÉTETT /aszf oldalhoz (teszteléshez); alapból a
   * pages collection. `null` = nincs közzétett ÁSZF-oldal; olvasási hibánál
   * dob.
   */
  loadPublishedAszf?: () => Promise<{ content: unknown } | null>
  /**
   * Injektálható TARTALÉK ÁSZF-betöltő (teszteléshez); alapból a repó
   * aszf.txt-je. Csak akkor fut, ha a közzétett oldal nem használható.
   */
  loadLegalInfo?: () => OrderLegalInfo
  /**
   * Injektálható kapcsolati cím (teszteléshez); alapból a Kapcsolat oldal
   * feloldott címe (src/lib/contact-email-server.ts), hibánál a kódtartalék.
   */
  loadSupportEmail?: () => Promise<string>
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

/** Honnan jött az ÁSZF, illetve a szolgáltató adatai (a műveletnaplóba kerül). */
export type OrderLegalSource = 'cms' | 'repo'

interface ResolvedLegalInfo {
  legal: OrderLegalInfo | null
  aszfSource: OrderLegalSource | null
  sellerSource: OrderLegalSource | null
}

/** A közzétett /aszf oldal tartalma; `null`, ha nincs közzétett oldal. */
async function defaultPublishedAszf(payload: Payload): Promise<{ content: unknown } | null> {
  // Ugyanaz a szűrő, mint a /aszf oldalon (src/lib/cms.ts getPageBySlug:
  // `status: published` + `draft: false`): pontosan azt a szöveget olvassuk,
  // amit a vevő a pénztár ÁSZF-linkjén látott, piszkozatot soha.
  const { docs } = await payload.find({
    collection: 'pages',
    where: {
      and: [{ slug: { equals: ASZF_OLDAL_WEBCIM } }, { status: { equals: 'published' } }],
    },
    draft: false,
    depth: 0,
    limit: 1,
    overrideAccess: true,
    select: { content: true },
  })
  const oldal = docs[0]
  return oldal === undefined ? null : { content: oldal.content }
}

/**
 * Rendszerszintű (nem rendelésenkénti) RIASZTÁS fojtva: a hiányzó vagy hibás
 * ÁSZF-oldal minden rendelést érint, a riasztás értéke a felszínre hozás, a
 * rendelésenkénti ismétlés csak zaj (src/lib/alert-throttle.ts). A fojtott
 * ismétlés warn-szinten, a rendelés azonosítójával megmarad a naplóban, és a
 * műveletnapló is rögzíti rendelésenként az ÁSZF forrását.
 */
function throttledLegalAlert(
  log: Logger,
  kulcs: string,
  uzenet: string,
  ismetles: string,
  context?: Record<string, unknown>,
): void {
  if (shouldEmitThrottledAlert(`order-legal:${kulcs}`)) {
    log.error(uzenet, context)
  } else {
    log.warn(ismetles, context)
  }
}

/**
 * Az ÁSZF és a szolgáltató adatai, abból az ÁSZF-ből, amit a vevő elfogadott.
 *
 * 1. A KÖZZÉTETT /aszf oldal (lásd order-legal.ts). Ha az oldal adatblokkja
 *    nem értelmezhető, a melléklet akkor is az elfogadott szöveg marad, a
 *    szolgáltató adatai pedig a repó szövegéből jönnek, fojtott RIASZTÁSSAL.
 * 2. Ha az oldal hiányzik, nem olvasható vagy nincs benne szöveg: a repó
 *    aszf.txt-je, fojtott RIASZTÁSSAL (a melléklet eltérhet az elfogadottól).
 *
 * A hiba nem állítja meg a levelet (a nyilatkozatok visszaigazolása és a
 * rendelés adatai ettől még kimennek); ha végül se ÁSZF, se szolgáltatói adat
 * nincs, rendelésenkénti RIASZTÁS kéri a kézi pótlást.
 */
async function resolveLegalInfo(deps: OnOrderPaidDeps, log: Logger): Promise<ResolvedLegalInfo> {
  let oldalCsomag: OrderLegalInfo | null = null
  let oldalHiba: { kod: 'hianyzik' | 'nem-olvashato' | 'nem-ertelmezheto'; error?: string } | null =
    null
  try {
    const load = deps.loadPublishedAszf ?? (() => defaultPublishedAszf(deps.payload))
    const oldal = await load()
    if (oldal === null) {
      oldalHiba = { kod: 'hianyzik' }
    } else {
      oldalCsomag = orderLegalInfoFromAszfPage(oldal.content)
      if (oldalCsomag === null) {
        oldalHiba = { kod: 'nem-ertelmezheto' }
      }
    }
  } catch (error) {
    oldalHiba = {
      kod: 'nem-olvashato',
      error: error instanceof Error ? error.message : String(error),
    }
  }

  const tartalek = (): OrderLegalInfo | null => {
    try {
      return (deps.loadLegalInfo ?? (() => loadOrderLegalInfo()))()
    } catch (error) {
      log.error(
        'RIASZTÁS: az ÁSZF nem olvasható, ezért a visszaigazoló levél ÁSZF-melléklet és ' +
          'szolgáltatói adatok nélkül megy ki. Küldd el kézzel az ÁSZF-et a vevőnek.',
        { error: error instanceof Error ? error.message : String(error) },
      )
      return null
    }
  }
  const szolgaltatoNelkul = (): void => {
    log.error(
      'RIASZTÁS: az ÁSZF „KINETICARE adatai" blokkja hiányos vagy nem értelmezhető (a ' +
        'közzétett /aszf oldalon és a repó aszf.txt-jében is), ezért a visszaigazoló levélből ' +
        'kimaradnak a szolgáltató adatai. Javítsd az ÁSZF adatblokkját (soronként egy adat, ' +
        '„Címke: érték" alakban), és küldd el kézzel a hiányzó adatokat a vevőnek.',
    )
  }

  if (oldalCsomag !== null) {
    if (oldalCsomag.seller !== null) {
      return { legal: oldalCsomag, aszfSource: 'cms', sellerSource: 'cms' }
    }
    throttledLegalAlert(
      log,
      'aszf-oldal-adatblokk',
      'RIASZTÁS: a közzétett ÁSZF (/aszf) „KINETICARE adatai" blokkja hiányos vagy nem ' +
        'értelmezhető. A visszaigazoló levél melléklete az elfogadott ÁSZF, de a szolgáltató ' +
        'adatait a repó aszf.txt-jéből vettük, és azok eltérhetnek. Javítsd az adminban az ' +
        'ÁSZF adatblokkját: soronként egy adat, „Címke: érték" alakban (Székhely, ' +
        'Cégjegyzékszám, Adószám, E-mail, Telefonszám).',
      'a közzétett ÁSZF adatblokkja továbbra sem értelmezhető, a szolgáltató adatai a repó ' +
        'szövegéből jönnek (a riasztás fojtva, lásd a korábbi RIASZTÁS-sort)',
    )
    const repoCsomag = tartalek()
    if (repoCsomag?.seller) {
      return {
        legal: { ...oldalCsomag, seller: repoCsomag.seller },
        aszfSource: 'cms',
        sellerSource: 'repo',
      }
    }
    szolgaltatoNelkul()
    return { legal: oldalCsomag, aszfSource: 'cms', sellerSource: null }
  }

  const ok =
    oldalHiba?.kod === 'hianyzik'
      ? 'nincs közzétett ÁSZF-oldal (webcím: aszf)'
      : oldalHiba?.kod === 'nem-ertelmezheto'
        ? 'a közzétett ÁSZF-oldal tartalma üres vagy nem értelmezhető'
        : 'a közzétett ÁSZF-oldal nem olvasható'
  throttledLegalAlert(
    log,
    `aszf-oldal-${oldalHiba?.kod ?? 'ismeretlen'}`,
    `RIASZTÁS: ${ok}, ezért a visszaigazoló levél a repó ÁSZF-szövegét (aszf.txt) mellékeli. ` +
      'Ez eltérhet attól, amit a vevő a pénztárban elfogadott. Ellenőrizd az adminban a ' +
      'Tartalom → Oldalak → ÁSZF oldalt (közzétett-e), és ha eltérés volt, küldd el kézzel ' +
      'az elfogadott ÁSZF-et az érintett vevőknek.',
    `a visszaigazoló levél a repó ÁSZF-szövegével megy (${ok}; a riasztás fojtva, lásd a ` +
      'korábbi RIASZTÁS-sort)',
    oldalHiba?.error === undefined ? undefined : { error: oldalHiba.error },
  )
  const repoCsomag = tartalek()
  if (repoCsomag === null) {
    return { legal: null, aszfSource: null, sellerSource: null }
  }
  if (repoCsomag.seller === null) {
    szolgaltatoNelkul()
  }
  return {
    legal: repoCsomag,
    aszfSource: 'repo',
    sellerSource: repoCsomag.seller === null ? null : 'repo',
  }
}

/**
 * A vevő kérdéseinek és panaszainak címe (K14): a weboldal kapcsolati címe.
 * Sosem dob; hibánál a kódtartalék.
 */
async function resolveSupportEmail(deps: OnOrderPaidDeps, log: Logger): Promise<string> {
  try {
    const load = deps.loadSupportEmail ?? (() => kapcsolatiEmailPayloadbol(deps.payload))
    return (await load()).trim() || KAPCSOLATI_EMAIL_TARTALEK
  } catch (error) {
    log.warn('a kapcsolati cím nem oldható fel, a levél a kódtartalékot adja meg', {
      error: error instanceof Error ? error.message : String(error),
    })
    return KAPCSOLATI_EMAIL_TARTALEK
  }
}

/** A szolgáltatói hibaszöveg naplózható alakja: a benne álló címek maszkolva. */
function maskedError(error: string | undefined): string | undefined {
  return error === undefined ? undefined : maskEmailsInText(error)
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

    const { legal, aszfSource, sellerSource } = await resolveLegalInfo(deps, log)
    const seller = legal?.seller ?? null
    const attachment = legal?.aszf.attachment ?? null
    const orderNumber = deps.order.orderNumber ?? `#${deps.order.id}`
    const supportEmail = await resolveSupportEmail(deps, log)
    const termsUrl = `${serverUrl}/${ASZF_OLDAL_WEBCIM}`

    const templateInput: Parameters<typeof orderConfirmationEmail>[0] = {
      orderNumber,
      buyerName: snapshotString(snapshot, 'name') || null,
      items,
      totalHuf,
      coursesUrl: `${serverUrl}${returnPath}`,
      // `isSzamlazzEnabled()` — a levél sorsa ne függjön a számlázási konfig dobásától.
      invoiceNote: isSzamlazzEnabled(),
      ...(account ? { account } : {}),
      withdrawalWaiver: { given: waiverGiven, at: waiverAt },
      // Az elállási funkció linkje (22. § (1b)); webcím nélkül nincs mire mutatni.
      withdrawalUrl: serverUrl ? `${serverUrl}${withdrawalHref(orderNumber)}` : null,
      seller,
      terms: { url: termsUrl, attachment },
      supportEmail,
    }
    const template = orderConfirmationEmail(templateInput)

    // K14: a válaszcím a kapcsolati cím, nem az ÁSZF-ben álló cég-e-mail.
    const replyTo = isUsableReplyToAddress(supportEmail) ? supportEmail : undefined
    const message: ConfirmationMailInput & { idempotencyKey: string } = {
      to: recipient,
      ...template,
      ...(replyTo ? { replyTo } : {}),
      idempotencyKey: `kineticare-order-confirmation-${deps.order.id}`,
    }

    const send = deps.send ?? sendMail
    const sent = await sendWithRetry(send, message, {
      delaysMs: CONFIRMATION_RETRY_DELAYS_MS,
      sleep: deps.sleep ?? realSleep,
      onRetry: ({ attempt, result: failed }) => {
        log.warn('visszaigazoló e-mail küldése sikertelen, újrapróbálom', {
          attempt,
          retryable: failed.retryable,
          error: maskedError(failed.error),
        })
      },
    })
    let attempts = sent.attempts
    let result: SendResult = sent.result

    // Végleges elutasítás mellékletes levélnél: a hiba oka lehet maga a
    // melléklet. A visszaigazolás többi része (nyilatkozatok, szolgáltató,
    // panaszkezelés) nem múlhat rajta, ezért egyszer melléklet nélkül, az ÁSZF
    // linkjével küldjük. SAJÁT kulccsal: ugyanazzal a kulccsal eltérő
    // tartalmat a Resend 409-cel elutasítana
    // (https://resend.com/docs/dashboard/emails/idempotency-keys).
    // Bizonytalan kézbesítésnél (az is `retryable: false`) NINCS pótlevél: az
    // első levél célba érhetett, a pótlevél kettőzné.
    let attachmentDropped = false
    if (
      !result.ok &&
      result.retryable === false &&
      result.deliveryUncertain !== true &&
      (message.attachments?.length ?? 0) > 0
    ) {
      log.warn(
        'a szolgáltató végleg elutasította a mellékletes visszaigazolót, melléklet nélkül újraküldöm',
        { attempts, error: maskedError(result.error) },
      )
      const linkOnly = orderConfirmationEmail({
        ...templateInput,
        terms: { url: termsUrl, attachment: null },
      })
      attempts += 1
      attachmentDropped = true
      result = await send({
        to: recipient,
        ...linkOnly,
        ...(replyTo ? { replyTo } : {}),
        idempotencyKey: `kineticare-order-confirmation-${deps.order.id}-link`,
      })
    }

    if (!result.ok && result.deliveryUncertain === true) {
      // A levél célba érhetett: sem újrapróba, sem (újabb) pótlevél, mert az
      // második levél lenne. Az első küldésre és a melléklet nélküli pótlevélre
      // egyaránt áll. A stáb egyeztet, mielőtt kézzel pótol.
      log.error(
        'RIASZTÁS: a kötelező visszaigazoló e-mail kézbesítése BIZONYTALAN: az SMTP-kapcsolat a ' +
          'levél tartalmának átadása után megszakadt, a szerver átvehette. Automatikus ' +
          'újraküldés nincs, mert kettőzné a levelet. Nézd meg az SMTP-szolgáltató naplójában ' +
          '(vagy kérdezd meg a vevőt), megérkezett-e; ha nem, küldd el kézzel a visszaigazolást ' +
          '(45/2014. Korm. rendelet 18. §).',
        {
          attempts,
          error: maskedError(result.error),
          ...(attachmentDropped ? { attachmentDropped } : {}),
        },
      )
      await writeAuditLog({
        store: deps.auditStore ?? auditLogStore(deps.payload),
        action: ORDER_CONFIRMATION_UNCERTAIN_AUDIT_ACTION,
        entityType: 'orders',
        entityId: deps.order.id,
        after: {
          orderNumber,
          attemptedAt: new Date().toISOString(),
          recipient,
          provider: result.provider,
          attempts,
          templateVersion: ORDER_CONFIRMATION_TEMPLATE_VERSION,
          attachmentDropped,
          error: maskedError(result.error) ?? null,
        },
      })
      return
    }

    if (!result.ok) {
      log.error(
        'RIASZTÁS: a kötelező visszaigazoló e-mail NEM ment ki (45/2014. Korm. rendelet 18. §). ' +
          'Amíg nem pótolod, az elállási jog kizárása erre a rendelésre nem érvényes. Küldd el ' +
          'kézzel a visszaigazolást, vagy javítsd az e-mail-szolgáltató beállítását.',
        {
          attempts,
          retryable: result.retryable,
          error: maskedError(result.error),
          ...(attachmentDropped ? { attachmentDropped } : {}),
        },
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

    if (attachmentDropped) {
      log.error(
        'RIASZTÁS: a visszaigazoló e-mail ÁSZF-melléklet NÉLKÜL ment ki, mert az e-mail-szolgáltató ' +
          'a mellékletes változatot végleg elutasította. A link nem tartós adathordozó: küldd el ' +
          'kézzel az ÁSZF-et a vevőnek (45/2014. Korm. rendelet 18. §), a rendelésszámmal.',
        { provider: result.provider, providerMessageId: result.id ?? null },
      )
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
        sellerSource,
        aszfAttached: attachment !== null && !attachmentDropped,
        aszfAttachmentDropped: attachmentDropped,
        aszfSource,
        aszfSha256: legal?.aszf.sha256 ?? null,
        aszfKelt: legal?.aszf.kelt ?? null,
        replyTo: replyTo ?? null,
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
