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
 * - Újrapróbálás (W1B-5): a GYORS átmeneti hibát (429, gyors 5xx, hálózati
 *   hiba, egyidejű kérés miatti 409, azaz `retryable === true`, és a válasz
 *   legfeljebb 1 másodperc alatt megjött) a függvény ugyanazzal a kulccsal
 *   egyszer újrapróbálja, 1 másodperc szünet után. Többre nincs idő: a küldés
 *   ma a hívók zárja alatt fut (lásd REFUND_NOTICE_TIME_BUDGET_MS). Ha az első
 *   kérést a Resend már befogadta, a kulcs miatt a második nem küld új
 *   levelet. Nem ismétlődik a végleges elutasítás (`retryable === false`), a
 *   bizonytalan kézbesítés (`deliveryUncertain`) és az időtúllépés sem: az
 *   utóbbi után a második kísérlet a keretbe már nem férne, a levél pedig
 *   kimehetett, ezért a bizonytalan riasztás megy ki.
 * - A záró riasztás megkülönbözteti a biztosan el nem ment levelet (végleges
 *   elutasítás: kézzel kell pótolni) a bizonytalantól (időtúllépés, átmeneti
 *   hiba vagy bizonytalan kézbesítés után a levél kimehetett: előbb a Resend
 *   felületén kell megkeresni a vevő címére küldött levelet a tárgya alapján,
 *   különben a vevő két levelet kap).
 * - Sorrend: a küldés a pénzügyi lezárás UTÁN, a rendelés-záron
 *   (`order:mutate:<id>`) KÍVÜL fut (HTTP a zár alatt tilos, refund-order.ts
 *   fejléce), de ma még a hívók egy tágabb zárján belül: a
 *   visszatérítés-helyreállítás koordinátor-zárja (`refund-recovery:order:<id>`,
 *   refund-recovery.ts), illetve a pénztár duplavásárlás-ágán a
 *   vevőnkénti `checkout:<vevő>` zár (start-checkout.ts) alatt. Ezért korlátos
 *   az időkerete (REFUND_NOTICE_TIME_BUDGET_MS). Ha a folyamat a
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
 * A szünet az újrapróbálás előtt (ms): legfeljebb két kérés. Egy másodperc,
 * mert a Resend a korlátot másodpercenként méri (alapból 10 kérés
 * másodpercenként csapatonként, a 429-es válasz `retry-after` fejléce
 * másodpercben adja a várakozást, https://resend.com/docs/api-reference/rate-limit).
 * Második szünetnek nincs értelme: a harmadik kísérlet a keretbe
 * (REFUND_NOTICE_TIME_BUDGET_MS) sosem férne bele.
 *
 * A ciklus helyi: a közös `sendWithRetry` segéd (src/lib/email/retry.ts) még
 * csak a team/w1-fogyasztoi-rev1 ágon él. A két ág összefésülése után ez a
 * ciklus arra cserélhető, ha az időkeret (REFUND_NOTICE_TIME_BUDGET_MS) és a
 * bizonytalan kézbesítés kezelése (deliveryUncertain) megmarad.
 */
export const REFUND_NOTICE_RETRY_DELAYS_MS: readonly number[] = [1_000]

/**
 * Egy küldési kísérlet leghosszabb ideje (ms): az éles szolgáltató
 * Resend-kérésének időkorlátja (email/resend.ts RESEND_TIMEOUT_MS,
 * AbortSignal.timeout). Ha az ottani korlát nő, ezt is emelni kell, különben az
 * időkeret nem tartható. (Az SMTP-tartalék lépésenként 15 s-ot vár, egy
 * kísérlete ennél tovább is tarthat; az éles szolgáltató a Resend.)
 */
export const REFUND_NOTICE_ATTEMPT_MAX_MS = 10_000

/**
 * Az értesítő TELJES időkerete (ms), minden kísérlettel és szünettel együtt.
 * Újabb kísérlet csak akkor indul, ha az eddig eltelt idő, a szünet és a
 * következő kísérlet leghosszabb ideje (REFUND_NOTICE_ATTEMPT_MAX_MS) együtt
 * is belefér. 12 s mellett ez azt jelenti: újrapróbálás csak akkor van, ha az
 * első kísérlet legfeljebb 1 másodperc alatt bukott el (429, gyors 5xx,
 * hálózati hiba), és az értesítő legfeljebb 12 másodpercig tart. Egy
 * időtúllépés (10 s) után nincs második kísérlet.
 *
 * Miért ilyen szűk (W1B-5 törő, major): a küldés ma a hívók zárja alatt fut,
 * és a zár tranzakciója közben tétlen; a Postgres 60 s tétlenség után leöli
 * (idle_in_transaction_session_timeout, payload.config.ts). A leölt
 * zár-tranzakció után a lezárt, kész visszatérítés is „elakadt” RIASZTÁS-t és
 * 503-at adna, a kapcsolat hibája pedig kezeletlen kivételként érné el a
 * folyamatot (CLAUDE.md 7. tanulság).
 * - A koordinátor-zár (`refund-recovery:order:<id>`) alatt előtte a helyesbítő
 *   akár 45 s-ig hívja a Számlázz.hu-t (lekérdezés, beküldés, 71/152 utáni
 *   lekérdezés, hívásonként 15 s). 45 + 12 = 57 s: a régi, egyetlen
 *   kísérletes értesítő 55 s-ához képest a keret 2 s-mal nő, és 60 s alatt
 *   marad. A korábbi 21 s-os keret itt 66 s-ot engedett.
 * - A pénztár zárja alatt (duplavásárlás-ág) a GetState (15 s) és a Barion
 *   Refund (35 s) után a régi értesítővel is 60 s volt a legrosszabb eset; a
 *   12 s-os keret ezt csak a legritkább esetben (gyors hiba, majd lógó
 *   második kérés) növeli 2 s-mal.
 * A tartós megoldás a küldés a zárakon kívül (a hívókban, refund-recovery.ts
 * és start-checkout.ts); utána a keret 22 s-ra, a szünetek [1 s, 3 s]-ra
 * emelhetők, és egy valódi időtúllépés is kap egy ugyanazzal a kulccsal futó
 * második kísérletet (22 s: 10 s-nál kicsit hosszabb időtúllépés + 1 s szünet +
 * 10 s még belefér).
 */
export const REFUND_NOTICE_TIME_BUDGET_MS = 12_000

export function refundNoticeIdempotencyKey(intentId: number | string): string {
  return `refund:${intentId}`
}

/**
 * A szolgáltató szerint bizonytalan-e a kézbesítés. A w1-fogyasztoi ág
 * SendResult-ja hozza a `deliveryUncertain` mezőt (SMTP: a levél lezárása
 * után megszakadt kapcsolat, a levél célba érhetett; ilyenkor a `retryable`
 * false). Ezen az ágon a típusban még nincs, ezért szerkezetileg olvassuk, így
 * a két ág összefésülése után is helyes marad. Igaz értéknél nincs
 * újrapróbálás, és nem a „NEM ment ki”, hanem a bizonytalan riasztás megy ki,
 * különben a stáb kézzel még egy levelet küldene a vevőnek.
 */
function deliveryUncertain(result: SendResult): boolean {
  return 'deliveryUncertain' in result && result.deliveryUncertain === true
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
  const orderLabel = order.orderNumber ?? `#${order.id}`
  const idempotencyKey = refundNoticeIdempotencyKey(intent.id)
  // A levél tárgya a Resend felületén a biztos keresési fogódzó: a Resend
  // leírása szerint a levél adatai között a címzett és a tárgy látszik
  // (https://resend.com/docs/dashboard/emails/manage-emails), az
  // Idempotency-Key fejlécről nem ír. A kivétel ágán, ha a sablon még nem
  // készült el, a rendelésszám a fogódzó. Az éles szolgáltató a Resend; más
  // szolgáltatónál (SMTP) annak a naplója a hely.
  let subject: string | null = null
  const lookupHint = (provider: SendResult['provider'] | null) => {
    const where =
      provider === null || provider === 'resend'
        ? 'keresd meg a Resend felületén (Emails)'
        : 'keresd meg a levélküldő szolgáltató naplójában'
    return subject === null
      ? `${where} a vevő címére küldött, a ${orderLabel} rendelésszámot a tárgyában viselő levelet`
      : `${where} a vevő címére küldött „${subject}” tárgyú levelet`
  }
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
      orderNumber: orderLabel,
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
    subject = template.subject
    const replyTo = isUsableReplyToAddress(supportEmail) ? supportEmail : undefined
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
        result.retryable !== true ||
        deliveryUncertain(result) ||
        delay === undefined ||
        Date.now() - startedAt + delay + REFUND_NOTICE_ATTEMPT_MAX_MS > REFUND_NOTICE_TIME_BUDGET_MS
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
    if (!result.ok) {
      const uncertain = result.retryable !== false || deliveryUncertain(result)
      const context = {
        cimzett: maskEmail(recipient),
        attempts,
        retryable: result.retryable ?? null,
        deliveryUncertain: deliveryUncertain(result),
        idempotencyKey,
        error: result.error === undefined ? undefined : maskEmailsInText(result.error),
      }
      if (!uncertain) {
        log.error(
          'RIASZTÁS: a vevői visszatérítési értesítő NEM ment ki. A visszatérítés megtörtént; küldd el kézzel a vevőnek a rendelésszámmal és az összeggel.',
          { alertCode: ALERT_CODES.visszateritesiErtesitoNemMentKi, ...context },
        )
      } else {
        log.error(
          `RIASZTÁS: a vevői visszatérítési értesítő kiküldése bizonytalan, lehet, hogy kiment. Mielőtt kézzel elküldöd, ${lookupHint(result.provider)}; ha megvan, ne küldd el újra.`,
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
    // Váratlan kivétel (a segédek a saját hibáikat maguk kezelik, a sendMail
    // nem dob). Hogy a levél elé vagy mögé esett, innen nem tudható: egy már
    // elküldött kérés után is jöhet, ezért a bizonytalan kód a helyes teendőt
    // adja (előbb a Resend felülete, csak utána kézi küldés).
    log.error(
      `RIASZTÁS: a vevői visszatérítési értesítő összeállítása vagy küldése kivétellel leállt, a levél kiküldése bizonytalan. Mielőtt kézzel elküldöd a vevőnek, ${lookupHint(null)}; ha megvan, ne küldd el újra.`,
      {
        alertCode: ALERT_CODES.visszateritesiErtesitoBizonytalan,
        idempotencyKey,
        error: error instanceof Error ? maskEmailsInText(error.message) : String(error),
      },
    )
  }
}
