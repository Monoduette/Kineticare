import type { Payload } from 'payload'

import type { Order, RefundIntent } from '../../payload-types'
import { ALERT_CODES } from '../alerts/classify'
import { auditLogStore, writeAuditLog } from '../audit'
import { KAPCSOLATI_EMAIL_TARTALEK } from '../contact-email'
import { kapcsolatiEmailPayloadbol } from '../contact-email-server'
import { courseTitle } from '../courses'
import { sendMail } from '../email'
import { maskEmail, maskEmailsInText } from '../email/mask'
import { isUsableReplyToAddress } from '../email/reply-to'
import type { SendResult } from '../email/types'
import {
  refundNoticeEmail,
  REFUND_NOTICE_TEMPLATE_VERSION,
  type RefundNoticeAccess,
  type RefundNoticeDocument,
  type RefundNoticeKind,
} from '../email/templates/refund'
import { logger as rootLogger, type Logger } from '../logger'
import { isRecord, productIds, readReceipt, RECEIPTS, relationId } from './recovery-receipts'
import type { OrderRefundEntry } from './refund-order'

/**
 * A vevői visszatérítési értesítő kiküldése a kísérlet lezárása (committed)
 * után, egyszer (a-refund-6).
 *
 * - Idempotencia: a Resend `Idempotency-Key` fejléce `refund:<intentId>`
 *   (https://resend.com/docs/dashboard/emails/idempotency-keys): ugyanaz a
 *   kulcs 24 órán belül nem indít második levelet. A committed átmenet
 *   egyetlen SQL CAS (intent-store.ts), ezért a küldést minden kísérletre
 *   pontosan egy hívó indítja.
 * - Újrapróbálás (W1B-5): az átmeneti hibát (429, 5xx, hálózati hiba,
 *   időtúllépés, egyidejű kérés miatti 409, azaz `retryable === true`) a
 *   függvény ugyanazzal a kulccsal legfeljebb kétszer újrapróbálja, rövid
 *   szünettel és időkereten belül (REFUND_NOTICE_RETRY_DELAYS_MS,
 *   REFUND_NOTICE_TIME_BUDGET_MS). Ha az első kérést a Resend már
 *   befogadta, a kulcs miatt a második nem küld új levelet. A szünet rövid,
 *   mert a küldés a tulajdonos visszatérítési kérésén belül fut, és a panel
 *   legfeljebb 30 másodpercet vár. A végleges elutasítás (`retryable ===
 *   false`) nem ismétlődik.
 * - A záró riasztás megkülönbözteti a biztosan el nem ment levelet (végleges
 *   elutasítás: kézzel kell pótolni) a bizonytalantól (időtúllépés vagy
 *   átmeneti hiba után a levél kimehetett: előbb a Resend naplójában kell
 *   megnézni a kulcsot, különben a vevő két levelet kap).
 * - Sorrend: a küldés a pénzügyi lezárás UTÁN, a rendelés-záron KÍVÜL fut
 *   (HTTP a zár alatt tilos, refund-order.ts fejléce). Ha a folyamat a
 *   lezárás és a küldés között áll le, a levél elmarad: ez elfogadott, mert
 *   a dupla értesítés rosszabb, mint az elmaradt udvariassági levél. A
 *   sikertelen vagy bizonytalan küldés error-szintű RIASZTÁS-t ad, saját
 *   riasztáskóddal (docs/uzemeltetes/11-riasztas-es-ugyelet.md), hogy a stáb
 *   kézzel pótolhassa.
 * - Sosem dob: a visszatérítés eredménye nem múlhat egy levélen.
 * - A küldés bizonyítéka (szolgáltatói üzenet-azonosító, sablonváltozat,
 *   címzett) a műveletnaplóba kerül.
 */
export const REFUND_NOTICE_AUDIT_ACTION = 'refund-notice-email'

/**
 * A szünetek az újrapróbálások előtt (ms): legfeljebb három kérés, összesen
 * 4 másodperc várakozással.
 *
 * A ciklus helyi: a közös `sendWithRetry` segéd (src/lib/email/retry.ts) még
 * csak a team/w1-fogyasztoi-rev1 ágon él, és egy ezen az ágon még nem létező
 * `deliveryUncertain` mezőre épít. A két ág összefésülése után ez a ciklus
 * arra cserélhető; ott a `deliveryUncertain === true` azt jelenti, hogy nincs
 * újrapróbálás, és a bizonytalan riasztás megy ki.
 */
export const REFUND_NOTICE_RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000]

/**
 * Az újrapróbálások időkerete (ms). A küldés a tulajdonos visszatérítési
 * kérésén belül fut, a panel 30 másodpercet vár (RefundPanel.tsx
 * REQUEST_TIMEOUT_MS), egy Resend-kérés pedig legfeljebb 10 másodpercig tart
 * (email/resend.ts). Újabb kísérlet csak akkor indul, ha az eddig eltelt idő
 * és a következő szünet együtt a kereten belül marad: két időtúllépéses
 * kísérlet után (10 + 1 + 10 másodperc) már nem indul harmadik, így a levél a
 * panel türelmét nem emészti fel. A gyors (azonnal visszautasított) átmeneti
 * hibákat mind a három kísérlet lefedi.
 */
export const REFUND_NOTICE_TIME_BUDGET_MS = 15_000

export function refundNoticeIdempotencyKey(intentId: number | string): string {
  return `refund:${intentId}`
}

export interface SendRefundNoticeInput {
  payload: Payload
  order: Order
  intent: RefundIntent
  entry: OrderRefundEntry
  kind: RefundNoticeKind
  document: RefundNoticeDocument
  logger?: Logger
  /** Injektálható várakozás az újrapróbálások között (teszteléshez); alapból valódi időzítő. */
  sleep?: (ms: number) => Promise<void>
}

function snapshotString(order: Order, key: 'name' | 'email'): string {
  const snapshot = isRecord(order.customerSnapshot) ? order.customerSnapshot : {}
  const value = snapshot[key]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * A rendelés kurzusainak a vevőnek látható neve; a hiányzót a rendelés
 * pillanatképe pótolja. Ha valamelyik tételnek így sincs neve (törölt kurzus,
 * üres pillanatkép), üres listát ad: a levél ilyenkor név nélkül, általánosan
 * fogalmaz, mert egy részleges névsor a többi kurzust elhallgatná, egy
 * kitalált cím („Kineticare online kurzus” kurzushoz) pedig hamis és esetlen.
 */
async function resolveCourseTitles(payload: Payload, order: Order, log: Logger): Promise<string[]> {
  const items = order.items ?? []
  const ids = items
    .map((item) => relationId(item.product))
    .filter((id): id is number => id !== null)
  const titles = new Map<number, string>()
  if (ids.length > 0) {
    try {
      const found = await payload.find({
        collection: 'products',
        where: { id: { in: ids } },
        depth: 0,
        limit: ids.length,
        pagination: false,
        overrideAccess: true,
        select: { displayTitle: true, sku: true },
      })
      for (const product of found.docs) titles.set(product.id, courseTitle(product))
    } catch (error) {
      log.warn('visszatérítési értesítő: a kurzusok neve nem olvasható, a pillanatkép megy', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const resolved = items.map((item) => {
    const id = relationId(item.product)
    // `||`: az üres pillanatkép sem név (a `??` átengedné).
    return ((id !== null ? titles.get(id) : undefined) || item.titleSnapshot || '').trim()
  })
  return resolved.every((title) => title.length > 0) ? resolved : []
}

/**
 * Teljes visszatérítésnél a hozzáférés sorsa a rendezés nyugtájából
 * (access-store.ts `preservedProductIds`): amit más kifizetett rendelés vagy
 * önálló jogosultság véd, az megmaradt, és a levél nem állíthatja az
 * ellenkezőjét.
 */
async function resolveAccess(
  payload: Payload,
  order: Order,
  intent: RefundIntent,
): Promise<RefundNoticeAccess> {
  const done = await readReceipt(payload, intent, RECEIPTS.cleanupDone)
  const preserved = Array.isArray(done?.preservedProductIds) ? done.preservedProductIds : []
  if (preserved.length === 0) return 'revoked'
  const products = productIds(order)
  return products.every((id) => preserved.includes(id)) ? 'kept' : 'mixed'
}

export async function sendRefundNotice(input: SendRefundNoticeInput): Promise<void> {
  const { payload, order, intent } = input
  const log = (input.logger ?? rootLogger).child({
    module: 'refund-notice',
    orderId: order.id,
    orderNumber: order.orderNumber ?? null,
    intentId: intent.id,
  })
  try {
    const recipient = (order.customerEmail ?? '').trim() || snapshotString(order, 'email')
    if (!recipient) {
      log.warn('visszatérítési értesítő kihagyva: nincs címzett a rendelésen')
      return
    }
    let access: RefundNoticeAccess = 'revoked'
    if (input.kind === 'full') {
      try {
        access = await resolveAccess(payload, order, intent)
      } catch (error) {
        // Bizonyíték nélkül a levél a hozzáférésről a közös, biztosan igaz
        // mondatot mondja („ami más vásárlásod alapján jár, az megmarad”).
        access = 'mixed'
        log.warn('visszatérítési értesítő: a hozzáférés-rendezés nyugtája nem olvasható', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    const supportEmail = await kapcsolatiEmailPayloadbol(payload).catch(
      () => KAPCSOLATI_EMAIL_TARTALEK,
    )
    const template = refundNoticeEmail({
      orderNumber: order.orderNumber ?? `#${order.id}`,
      buyerName: snapshotString(order, 'name') || null,
      amountHuf: input.entry.amountHuf,
      refundedAt: input.entry.refundedAt,
      kind: input.kind,
      access,
      courseTitles: await resolveCourseTitles(payload, order, log),
      // A teljes visszatérítés 1-nél nagyobb sorszámmal egy korábbi részleges
      // utáni maradékot zár le (refund-order.ts: a rendelés refund-nyoma).
      remainderAfterPartial: input.kind === 'full' && intent.refundSequence > 1,
      document: input.document,
      supportEmail,
    })
    const replyTo = isUsableReplyToAddress(supportEmail) ? supportEmail : undefined
    const idempotencyKey = refundNoticeIdempotencyKey(intent.id)
    const message = {
      to: recipient,
      ...template,
      ...(replyTo ? { replyTo } : {}),
      idempotencyKey,
    }
    const sleep =
      input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    const startedAt = Date.now()
    let attempts = 0
    let result: SendResult
    for (;;) {
      attempts += 1
      result = await sendMail(message)
      const delay = REFUND_NOTICE_RETRY_DELAYS_MS[attempts - 1]
      if (
        result.ok ||
        // Az SMTP-kapcsolat a tartalom átadása után szakadt meg: a levél célba
        // érhetett, és SMTP-n nincs idempotencia, az újraküldés második levelet
        // íratna a vevőnek.
        result.deliveryUncertain === true ||
        result.retryable !== true ||
        delay === undefined ||
        Date.now() - startedAt + delay > REFUND_NOTICE_TIME_BUDGET_MS
      ) {
        break
      }
      log.warn(
        'visszatérítési értesítő: átmeneti küldési hiba, újrapróbálom ugyanazzal a kulccsal',
        {
          attempt: attempts,
          error: result.error === undefined ? undefined : maskEmailsInText(result.error),
        },
      )
      await sleep(delay)
    }
    if (!result.ok && result.deliveryUncertain === true) {
      // A levél célba érhetett (SMTP: a kapcsolat a tartalom átadása után
      // szakadt meg, lásd SendResult.deliveryUncertain). A „NEM ment ki, küldd
      // el kézzel” itt második levelet íratna a vevőnek, ezért a riasztás előbb
      // ellenőrzést kér, ahogy a visszaigazolónál is (order-paid.ts).
      log.error(
        'RIASZTÁS: a vevői visszatérítési értesítő kézbesítése BIZONYTALAN. Az SMTP-kapcsolat a levél tartalmának átadása után megszakadt, a szerver átvehette, ezért automatikus újraküldés nincs. Nézd meg az SMTP-szolgáltató naplójában (vagy kérdezd meg a vevőt), megérkezett-e; csak akkor küldd el kézzel, ha nem.',
        {
          alertCode: ALERT_CODES.visszateritesiErtesitoBizonytalan,
          cimzett: maskEmail(recipient),
          attempts,
          error: result.error === undefined ? undefined : maskEmailsInText(result.error),
        },
      )
      return
    }
    if (!result.ok) {
      const context = {
        cimzett: maskEmail(recipient),
        attempts,
        retryable: result.retryable ?? null,
        error: result.error === undefined ? undefined : maskEmailsInText(result.error),
      }
      if (result.retryable === false) {
        log.error(
          'RIASZTÁS: a vevői visszatérítési értesítő NEM ment ki. A visszatérítés megtörtént; küldd el kézzel a vevőnek a rendelésszámmal és az összeggel.',
          { alertCode: ALERT_CODES.visszateritesiErtesitoNemMentKi, ...context },
        )
      } else {
        log.error(
          `RIASZTÁS: a vevői visszatérítési értesítő kiküldése bizonytalan, lehet, hogy kiment. Mielőtt kézzel elküldöd, nézd meg a Resend naplójában a ${idempotencyKey} kulcsú levelet.`,
          { alertCode: ALERT_CODES.visszateritesiErtesitoBizonytalan, ...context },
        )
      }
      return
    }
    if (result.provider === 'noop') {
      if (process.env.NODE_ENV === 'production') {
        log.error(
          'RIASZTÁS: nincs e-mail-szolgáltató beállítva (RESEND_API_KEY / SMTP_HOST), a vevői visszatérítési értesítő NEM ment ki. Küldd el kézzel a vevőnek.',
          { alertCode: ALERT_CODES.visszateritesiErtesitoNincsSzolgaltato },
        )
      } else {
        log.info('visszatérítési értesítő szimulálva (noop e-mail-szolgáltató)')
      }
      return
    }
    const recorded = await writeAuditLog({
      store: auditLogStore(payload),
      actor: relationId(intent.actor),
      action: REFUND_NOTICE_AUDIT_ACTION,
      entityType: 'refund-intents',
      entityId: intent.id,
      after: {
        version: 1,
        intentId: intent.id,
        orderId: order.id,
        orderNumber: order.orderNumber ?? null,
        sentAt: new Date().toISOString(),
        recipient,
        provider: result.provider,
        providerMessageId: result.id ?? null,
        idempotencyKey,
        templateVersion: REFUND_NOTICE_TEMPLATE_VERSION,
        kind: input.kind,
        document: input.document,
        amountHuf: input.entry.amountHuf,
        replyTo: replyTo ?? null,
      },
    })
    if (recorded) {
      log.info('visszatérítési értesítő elküldve és rögzítve', {
        provider: result.provider,
        providerMessageId: result.id ?? null,
      })
    } else {
      log.warn(
        'visszatérítési értesítő kiment, de a küldés bizonyítéka nem került a műveletnaplóba',
        {
          provider: result.provider,
          providerMessageId: result.id ?? null,
        },
      )
    }
  } catch (error) {
    // A kivétel a küldés UTÁN is érkezhet (például a műveletnapló írásakor),
    // ezért a levél akár ki is mehetett: a bizonytalan kód a helyes teendőt
    // adja (előbb a Resend naplója, csak utána kézi küldés).
    log.error(
      `RIASZTÁS: a vevői visszatérítési értesítő összeállítása vagy küldése kivétellel leállt, a levél kiküldése bizonytalan. Mielőtt kézzel elküldöd a vevőnek, nézd meg a Resend naplójában a ${refundNoticeIdempotencyKey(intent.id)} kulcsú levelet.`,
      {
        alertCode: ALERT_CODES.visszateritesiErtesitoBizonytalan,
        error: error instanceof Error ? maskEmailsInText(error.message) : String(error),
      },
    )
  }
}
