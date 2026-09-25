import { after } from 'next/server'
import type { Payload } from 'payload'

import type { Order } from '../../payload-types'
import { shouldEmitThrottledAlert } from '../alert-throttle'
import { getBarionConfig, type BarionEnvironment } from '../barion/client'
import { BARION_GUID_MAX_LENGTH, canonicalBarionGuid } from '../barion/guid'
import {
  isTerminallyProcessed,
  isUniqueViolation,
  MAX_WEBHOOK_ATTEMPTS,
  webhookEventStore,
  type WebhookEventStore,
} from '../idempotency'
import { logger, type Logger } from '../logger'
import { generateRequestId, getRequestId } from '../request-id'
import { readBodyWithCap } from '../security/request-body'
import {
  checkIpRateLimit,
  resolveRateLimitIp,
  type CheckRequestRateLimitOptions,
} from '../security/rate-limit'
import { callbackLockKey, runBarionCallbackEvent } from './process-callback'
import { runRefundReconciliation } from './refund-reconciliation'

/**
 * POST /api/barion/callback. PaymentId a query-ben (a törzs üres). Dedup +
 * azonnali 200; GetState aszinkron (`after` + webhook-retry). A payload nem
 * bizonyíték. Útvonal-rate-limit nincs. Ismeretlen GUID: IP-keret a create
 * előtt. confirmOrder tilos.
 */

export interface BarionCallbackHandlerDeps {
  getPayload: () => Promise<Payload>
  /**
   * Az aszinkron ütemező injektálható (teszteléshez). Alapból next/server
   * `after()` — a válasz elküldése után fut, a kérés életciklusát meghosszabbítva.
   */
  schedule?: (task: () => Promise<void>) => void
  store?: WebhookEventStore
  /**
   * Az ismeretlen-PaymentId IP-keret injektálható (teszt: saját limiter, ne a
   * folyamat-alapértelmezett Map). Lásd `CheckRequestRateLimitOptions`.
   */
  rateLimit?: CheckRequestRateLimitOptions
}

/**
 * A Barion PaymentId GUID, de két alakban érkezhet: kötőjel nélkül (32 hex,
 * a callback `paymentId` paraméterének dokumentált alakja) vagy kötőjelesen
 * (8-4-4-4-12). Mindkettőt elfogadjuk, kis- és nagybetűvel is; az alakot a
 * közös `canonicalBarionGuid` ellenőrzi (lib/barion/guid.ts).
 */

/** A kötőjeles GUID a leghosszabb elfogadott alak — a mintaillesztés előtti olcsó kapu. */
export const MAX_PAYMENT_ID_LENGTH = BARION_GUID_MAX_LENGTH

/**
 * A JSON-törzs tartalék-csatorna felső bájtkorlátja. A valódi Barion-callback
 * ÜRES törzzsel jön (a PaymentId a query-ben), ez a fallback pedig legföljebb
 * egy pici `{ "PaymentId": "<guid>" }`-t hoz — 16 KiB bőven elég. A cap a
 * `request.json()` előtti korlátlan bufferelést zárja (SEC-008): egy több
 * megabájtos törzs sosem kerül teljes egészében a memóriába.
 */
export const MAX_CALLBACK_BODY_BYTES = 16 * 1024

export { callbackLockKey }

/**
 * A Barion dokumentált callback-forrás IP-címei környezetenként
 * (docs.barion.com/Callback_mechanism: „it's strongly recommended to allowlist
 * the Barion API IP addresses, and blocklist all other IPs”; éles 40.113.73.229,
 * teszt 20.223.214.216). Ismeretlen PaymentId-t CSAK innen dolgozunk fel
 * (a-callback-7): a GetState úgyis bizonyít, de egy idegen IP-kről jövő
 * ismeretlen-GUID-áradat sort írna és kimenő hívást kényszerítene. Az ISMERT
 * PaymentId bármely IP-ről feldolgozható (a rendelés a miénk, a GetState dönt).
 */
export const BARION_CALLBACK_SOURCE_IPS: Readonly<Record<BarionEnvironment, readonly string[]>> = {
  prod: ['40.113.73.229'],
  test: ['20.223.214.216'],
}

/**
 * A kérés valódi forrás-IP-je a forrás-ellenőrzéshez. A Railway éle az
 * `X-Real-IP` fejlécbe írja a kliens címét („X-Real-IP for identifying
 * client's remote IP”, docs.railway.com/networking/public-networking/specs-and-limits),
 * az `X-Forwarded-For` lánc elejét viszont a kliens maga írhatja: azt itt
 * SOSEM olvassuk. Cloudflare-proxy mögött (TRUST_CF_CONNECTING_IP=true, mint
 * az audit-naplónál) a `cf-connecting-ip` a forrás.
 */
export function barionCallbackSourceIp(headers: Headers): string | null {
  const raw =
    process.env.TRUST_CF_CONNECTING_IP?.trim().toLowerCase() === 'true'
      ? headers.get('cf-connecting-ip')
      : headers.get('x-real-ip')
  if (typeof raw !== 'string') {
    return null
  }
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.length === 0 || trimmed.includes(',')) {
    return null
  }
  return trimmed.startsWith('::ffff:') ? trimmed.slice('::ffff:'.length) : trimmed
}

/** Az aktív Barion-környezet callback-IP-i; hibás konfignál mindkét környezeté (a feldolgozás úgyis elbukna). */
function allowedCallbackSourceIps(): readonly string[] {
  try {
    return BARION_CALLBACK_SOURCE_IPS[getBarionConfig().environment]
  } catch {
    return [...BARION_CALLBACK_SOURCE_IPS.prod, ...BARION_CALLBACK_SOURCE_IPS.test]
  }
}

/**
 * Egy már paid-re zárt fizetésre érkező újabb callback visszatérítés-egyeztetést
 * indít. Időablakos fojtás NINCS: egy korábbi kézbesítés nem nyelheti el a
 * pár perccel később, a Barion felületén indított visszatérítés callbackjét
 * (annak jelzése különben elveszne, mert később semmi nem venné fel). A
 * PaymentState-terhelést a fetchPaymentState PaymentId-nkénti kapuja korlátozza
 * (legfeljebb egy hívás 5,5 s-onként); itt csak az egyidejű kézbesítések
 * vonódnak össze: amíg egy egyeztetés függőben van vagy fut, az újabb
 * kézbesítés csak megjelöli, és a futó egyeztetés a végén (a kapun át) még
 * egyszer lefut. Így PaymentId-nként egyszerre legfeljebb egy egyeztetés él, és
 * jelzés nem vész el. A nyilvántartás a handler-példányé (az útvonal modulja
 * egyetlen példányt hoz létre, tehát folyamatszintű).
 */
interface PaidReconciliationSlot {
  /** Mióta áll fenn (egy beragadt bejegyzés ne tiltsa örökre az egyeztetést). */
  since: number
  /** Futás közben érkezett újabb kézbesítés: a futás végén még egy kör kell. */
  dirty: boolean
}
/**
 * Ennél régebbi bejegyzés beragadtnak számít (egy egyeztetés a kapuval, a 429
 * utáni várakozással és két 15 s-os timeouttal is jóval rövidebb).
 */
const PAID_RECONCILIATION_STALE_MS = 5 * 60 * 1000
/** Lezárt (cancelled) fizetés újraellenőrzése: csak ennél fiatalabb rendelésre (r-barion-7). */
export const CANCELLED_RECHECK_MAX_ORDER_AGE_MS = 24 * 60 * 60 * 1000
/** A lezárt fizetés újraellenőrzésének fojtása PaymentId-nként. */
export const CANCELLED_RECHECK_COOLDOWN_MS = 60 * 1000

/**
 * Egy nyers érték ALAK-ellenőrzése — hiányzó, üres, túl hosszú vagy nem
 * GUID-alakú érték esetén null. A visszaadott érték KANONIKUS (kisbetűs,
 * kötőjeles).
 *
 * Miért kanonikus: a Barion GUID kis-nagybetű- és kötőjel-független, a
 * Postgres `equals` és a (provider, externalId) unique kulcs viszont
 * pontos egyezést néz. Kanonizálás nélkül ugyanaz a fizetés KÉT alias alatt
 * élhetne: a dedup nem találná a másik alak rekordját, az advisory-zár
 * kulcsa szétválna (párhuzamos GetState), az orders-lookup nem találná a
 * rendelést, a processzor orderNumber-fallbackje pedig hamis
 * `payment-id-conflict`-tal terminálisan elutasítaná az ÉRVÉNYES fizetést.
 * A checkout ugyanezt a kanonikus alakot tárolja (lib/barion/start.ts).
 */
function normalizePaymentId(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null
  }
  // Hosszkapu ELŐSZÖR: egy több megabájtos mezőre nem futtatunk mintaillesztést.
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_PAYMENT_ID_LENGTH) {
    return null
  }
  return canonicalBarionGuid(trimmed)
}

/**
 * A PaymentId kinyerése a QUERY STRINGBŐL — ez az ÉLES csatorna.
 *
 * ═══ A HIBA, AMIT BEZÁR (B1) ═══
 * A Barion a callbacket `CallbackUrl?paymentId=<guid>` alakban, ÜRES POST-
 * törzzsel küldi. A korábbi kód `await request.json()`-nel indult, ami üres
 * törzsön DOB — így MINDEN valódi callback 400-at kapott, és a fizetés sosem
 * zárult le a callback-úton.
 */
function paymentIdFromQuery(request: Request): string | null {
  let params: URLSearchParams
  try {
    params = new URL(request.url).searchParams
  } catch {
    return null
  }
  // A Barion kisbetűs 'paymentId'-t küld; a nagybetűs alakot is elfogadjuk.
  return normalizePaymentId(params.get('paymentId') ?? params.get('PaymentId'))
}

/**
 * A PaymentId kinyerése a JSON-TÖRZSBŐL — TARTALÉK csatorna (a Barion mai
 * viselkedése szerint nem ez az élő út, de egy JSON-törzses kézbesítés is
 * feldolgozható marad).
 */
function extractPaymentId(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return null
  }
  const raw =
    (body as Record<string, unknown>).PaymentId ?? (body as Record<string, unknown>).paymentId
  return normalizePaymentId(raw)
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status })
}

/**
 * ISMERT-e a PaymentId? Van-e `orders` sor, amelynek `barionPaymentId`-je
 * EGYEZIK (depth 0, overrideAccess, limit 1).
 *
 * A checkout a Barion-redirect ELŐTT kiírja ezt az azonosítót, tehát a valódi
 * callback ismert. Ami nem talál rendelést: véletlen GUID, VAGY ritka verseny
 * — a callback megérkezik, mielőtt a checkout beírná a `barionPaymentId`-t.
 * Utóbbi egy unknown-vödörhelyet fogyaszt, de a keret alatt átmegy; a
 * mentőháló az order-poll (és a processzor orderNumber-fallbackje).
 */
async function findOrderByPaymentId(payload: Payload, paymentId: string): Promise<Order | null> {
  const found = await payload.find({
    collection: 'orders',
    where: { barionPaymentId: { equals: paymentId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return (found.docs[0] as Order | undefined) ?? null
}

async function isKnownBarionPaymentId(payload: Payload, paymentId: string): Promise<boolean> {
  return (await findOrderByPaymentId(payload, paymentId)) !== null
}

/** Egy háttérfeladat, amely a saját hibáját strukturált naplósorba fogja (a-callback-13). */
function guarded(log: Logger, what: string, task: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await task()
    } catch (error) {
      log.error(`barion-callback: ${what} váratlan hibával állt le`, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

export function createBarionCallbackHandler(deps: BarionCallbackHandlerDeps) {
  const schedule = deps.schedule ?? ((task: () => Promise<void>) => after(task))
  const paidReconciliationSlots = new Map<string, PaidReconciliationSlot>()

  return async function POST(request: Request): Promise<Response> {
    const requestId = getRequestId(request.headers) ?? generateRequestId()
    const log = logger.child({ requestId, route: 'barion-callback' })

    // 0. A PaymentId FELOLDÁSA: elsődlegesen a query string (ez az éles Barion-
    //    csatorna), tartalékként a JSON-törzs. Az ÜRES vagy nem JSON törzs
    //    önmagában NEM hiba — a Barion pont ilyet küld.
    let paymentIdSource: 'query' | 'body' = 'query'
    let paymentId = paymentIdFromQuery(request)
    if (!paymentId) {
      paymentIdSource = 'body'
      // SEC-008: a törzset FELSŐ KORLÁTTAL olvassuk, a JSON-parse ELŐTT — egy
      // túlméretes vagy hibás törzs nem bufferelődik korlátlanul (memória-DoS).
      const rawBody = await readBodyWithCap(request, MAX_CALLBACK_BODY_BYTES).catch(() => null)
      let body: unknown = null
      if (rawBody !== null && rawBody.trim().length > 0) {
        try {
          body = JSON.parse(rawBody)
        } catch {
          body = null
        }
      }
      paymentId = extractPaymentId(body)
    }
    if (!paymentId) {
      // A nyers értéket NEM naplózzuk (tetszőleges, kívülről jött szöveg).
      log.warn('barion-callback: hiányzó vagy nem GUID-alakú PaymentId — 400')
      return jsonResponse({ ok: false, error: 'Hiányzó vagy érvénytelen PaymentId.' }, 400)
    }
    const eventLog = log.child({ paymentId })
    // Az éles próbavásárlásnál EZ a sor bizonyítja, hogy a callback megérkezett
    // és melyik csatornán hozta az azonosítót.
    eventLog.info('barion-callback: PaymentId feloldva', { source: paymentIdSource })

    const payload = await deps.getPayload()
    const store = deps.store ?? webhookEventStore(payload)

    const runProcessing = guarded(
      eventLog,
      'a háttér-feldolgozás (a webhook-retry újrapróbálja)',
      async (): Promise<void> => {
        // SEC-006 + a-callback-7: a GetState a zár ELŐTT megy ki, a feldolgozás
        // PaymentId-re szabott session-zár alatt fut (runBarionCallbackEvent),
        // a paid-mellékhatás a zár után. Párhuzamos ismétlés a záron vár, majd
        // friss olvasáson no-opot lát.
        const outcome = await runBarionCallbackEvent({
          payload,
          store,
          paymentId,
          requestId,
          logger: eventLog,
        })
        if (outcome.kind === 'failed') {
          if (!outcome.retryable) {
            // Ez volt az utolsó megengedett kísérlet: a webhook-retry MÁR NEM
            // viszi tovább — az owner-riasztás itt, a kimerülés pillanatában megy.
            // W13 után egy ISMERT+kimerült rekordot a Barion minden ismételt
            // kézbesítése újra feldolgoztat: a már felszínre hozott ügy riasztása
            // fojtva ismétlődik (alert-throttle), nem kézbesítésenként.
            // Külön kulcs-előtag, mint a pending_repoll-kimerülésé (idempotency.ts):
            // a két ág KÜLÖN incidens — közös kulccsal az egyik elnyelné a másik
            // első riasztását a cooldownon belül.
            if (shouldEmitThrottledAlert(`webhook-exhausted-failed:barion:${paymentId}`)) {
              eventLog.error(
                'RIASZTÁS: webhook-esemény újrapróbálásai kimerültek — owner beavatkozás szükséges',
                {
                  attempts: outcome.attempts,
                  error: outcome.error,
                },
              )
            }
          } else {
            eventLog.warn(
              'barion-callback: aszinkron feldolgozás sikertelen (retry-job folytatja)',
              {
                attempts: outcome.attempts,
                retryable: outcome.retryable,
                error: outcome.error,
              },
            )
          }
        }
      },
    )

    // 1. AZONNALI DEDUP — a feldolgozást NEM várjuk meg.
    try {
      const existing = await store.find({
        collection: 'webhook-events',
        where: {
          and: [{ provider: { equals: 'barion' } }, { externalId: { equals: paymentId } }],
        },
        limit: 1,
        overrideAccess: true,
      })
      const record = existing.docs[0]

      if (record && isTerminallyProcessed(record)) {
        // Már VÉGLEGESEN feldolgozva → no-op (dupla kézbesítés). Az ELUTASÍTOTT
        // (rejected) lezárás viszont NEM néma info: azok mögött alias-/párosítási
        // konfliktus vagy kézi ellenőrzésre váró állapot állhat (total-mismatch,
        // payment-id-conflict, payment-not-found) — a limit:1 gyorsút korábban
        // ezt info-szintű "duplikátum" sorral fedte el, és a Barion ismételt
        // kézbesítése nyomtalanul tűnt el. A warn felszínre hozza, hogy egy
        // lezárt-elutasított fizetésre még mindig érkezik callback.
        if (record.result === 'paid') {
          // a-callback-6, a-refund-7: a paid lezárás után érkező callback a
          // Barion szerint egy újabb tranzakció (tipikusan visszatérítés, akár a
          // Barion felületén indított). Könnyű egyeztetés a háttérben, állapot-
          // és pénzmozgás nélkül; az egyidejű kézbesítések összevonva (lásd
          // paidReconciliationSlots).
          const nowMs = Date.now()
          const slot = paidReconciliationSlots.get(paymentId)
          const pending = slot !== undefined && nowMs - slot.since < PAID_RECONCILIATION_STALE_MS
          eventLog.info('barion-callback: kézbesítés egy már paid eseményre — no-op 200', {
            refundReconciliation: pending ? 'osszevonva' : 'utemezve',
          })
          if (pending) {
            slot.dirty = true
          } else {
            const ownSlot: PaidReconciliationSlot = { since: nowMs, dirty: false }
            paidReconciliationSlots.set(paymentId, ownSlot)
            schedule(
              guarded(eventLog, 'a visszatérítés-egyeztetés', async () => {
                try {
                  // A futás ELŐTT érkezett kézbesítéseket ez a futás már látja
                  // (a GetState utánuk megy ki); csak a futás KÖZBEN érkezők
                  // kérnek még egy kört.
                  do {
                    ownSlot.dirty = false
                    const order = await findOrderByPaymentId(payload, paymentId)
                    if (order) {
                      await runRefundReconciliation({
                        payload,
                        order,
                        trigger: 'callback',
                        logger: eventLog,
                      })
                    }
                  } while (ownSlot.dirty)
                } finally {
                  if (paidReconciliationSlots.get(paymentId) === ownSlot) {
                    paidReconciliationSlots.delete(paymentId)
                  }
                }
              }),
            )
          }
          return jsonResponse({ ok: true, status: 'duplicate' })
        }
        if (record.result === 'cancelled') {
          // r-barion-7: egy lezárt (cancelled) fizetésre érkező újabb callback a
          // késői sikert hozhatja („the payment process may still be completed
          // by the customer, even if the window has officially closed”,
          // Callback_mechanism). 24 óránál fiatalabb, még le nem zárt-fizetett
          // rendelésnél a GetState újra fut, PaymentId-nként fojtva.
          const order = await findOrderByPaymentId(payload, paymentId)
          const createdAtMs = Date.parse(order?.createdAt ?? '')
          const young =
            order !== null &&
            (order.status === 'cancelled' || order.status === 'payment_failed') &&
            Number.isFinite(createdAtMs) &&
            Date.now() - createdAtMs < CANCELLED_RECHECK_MAX_ORDER_AGE_MS
          if (
            young &&
            shouldEmitThrottledAlert(
              `callback-cancelled-recheck:${paymentId}`,
              CANCELLED_RECHECK_COOLDOWN_MS,
            )
          ) {
            eventLog.info('barion-callback: lezárt fizetésre érkező callback — a GetState újra fut')
            schedule(
              guarded(eventLog, 'a lezárt fizetés újraellenőrzése', async () => {
                await runBarionCallbackEvent({
                  payload,
                  store,
                  paymentId,
                  requestId,
                  logger: eventLog,
                  mode: 'recheck-cancelled',
                })
              }),
            )
            return jsonResponse({ ok: true, status: 'received' })
          }
          eventLog.info('barion-callback: duplikált kézbesítés — már feldolgozva, no-op 200')
          return jsonResponse({ ok: true, status: 'duplicate' })
        }
        if (record.result === 'rejected') {
          // Fojtva: a dedup-gyorsút a rate-limit ELŐTT fut (örökölt sorrend),
          // egy ismert-elutasított PaymentId ismételgetésével tehát HTTP-ütemű
          // warn-árasztást lehetne kelteni — a felszínre hozáshoz kulcsonként
          // egy warn / cooldown elég.
          if (shouldEmitThrottledAlert(`rejected-redelivery:barion:${paymentId}`)) {
            eventLog.warn(
              'barion-callback: duplikált kézbesítés egy korábban ELUTASÍTOTT eseményre — a rendelés kézi ellenőrzést igényelhet (lásd a korábbi RIASZTÁS-sorokat)',
              { result: record.result, attempts: record.attempts ?? 0 },
            )
          }
        } else {
          eventLog.info('barion-callback: duplikált kézbesítés — már feldolgozva, no-op 200')
        }
        return jsonResponse({ ok: true, status: 'duplicate' })
      }

      if (record) {
        const attempts = record.attempts ?? 0
        if (attempts >= MAX_WEBHOOK_ATTEMPTS) {
          const knownExhausted = await isKnownBarionPaymentId(payload, paymentId)
          if (!knownExhausted) {
            // Ismeretlen + kimerült: nincs mit GetState-tel kezdeni, a retry
            // csak táblát és kimenő hívást gyártana. 200, hogy a Barion ne
            // pörögjön; NINCS ütemezés.
            eventLog.info(
              'barion-callback: ismeretlen PaymentId kísérletei kimerültek — 200 no-op, nincs GetState',
              { attempts },
            )
            return jsonResponse({ ok: true, status: 'received' })
          }
          // ISMERT + kimerült: W13 — a route-handler NEM a retry-job
          // scan-szűrőjét használja. Egy későbbi Succeeded callbacknak le
          // kell futnia; processed-re itt nem zárjuk.
        }

        // Minden nem terminális rekord újra ütemeződik (a-callback-8):
        // 'failed' = a Barion retry-lépcső újra kézbesítette → azonnali újrapróbálás;
        // nem terminális eredmény (pending_repoll) = a fizetés korábban még függő
        // volt, EZ a kézbesítés hozza a végleges státuszt (B4);
        // 'received' eredmény nélkül = egy feldolgozás épp fut. Korábban ezt nem
        // ütemeztük, így ha a futó feldolgozás még a KORÁBBI (függő) állapotot
        // látta, a most jelzett végleges állapot csak a percenkénti retryvel
        // érkezett meg. A callback-zár sorba állítja a kettőt, a második friss
        // olvasással no-op, ha az első már lezárta.
        schedule(runProcessing)
        return jsonResponse({ ok: true, status: 'received' })
      }

      // Új esemény: ismert rendelés korlátlan; ismeretlen GUID IP-keretes
      // (a ritka checkout-írás vs. callback verseny egy vödörhelyet fogyaszt,
      // de a keret alatt átmegy — mentőháló: order-poll).
      const known = await isKnownBarionPaymentId(payload, paymentId)
      if (!known) {
        const sourceIp = barionCallbackSourceIp(request.headers)
        if (sourceIp === null || !allowedCallbackSourceIps().includes(sourceIp)) {
          // Nem a Barion dokumentált callback-címéről jött ismeretlen GUID:
          // 200 (ne legyen visszajelzés a próbálkozónak), rekord és GetState
          // nélkül. A naplósor IP-nként fojtott.
          if (shouldEmitThrottledAlert(`callback-foreign-source:${sourceIp ?? 'ismeretlen'}`)) {
            eventLog.warn(
              'barion-callback: ismeretlen PaymentId nem a Barion callback-címéről — 200 no-op, nincs GetState',
              { sourceIp },
            )
          }
          return jsonResponse({ ok: true, status: 'ignored' })
        }
        const rejection = checkIpRateLimit({
          request,
          routeClass: 'barion-callback-unknown',
          options: deps.rateLimit,
        })
        if (rejection) {
          const ip = resolveRateLimitIp(request.headers)
          eventLog.warn(
            'barion-callback: ismeretlen PaymentId IP-kerete kimerült — 200 no-op, nincs GetState',
            { paymentId, ip },
          )
          return jsonResponse({ ok: true, status: 'ignored' })
        }
      }

      try {
        await store.create({
          collection: 'webhook-events',
          data: {
            provider: 'barion',
            externalId: paymentId,
            status: 'received',
            attempts: 0,
            // Csak a kinyert, strukturált mező — a nyers bodyt nem tároljuk.
            payload: { paymentId },
            requestId,
          },
          overrideAccess: true,
        })
      } catch (createError) {
        if (isUniqueViolation(createError)) {
          // Verseny: párhuzamos kézbesítés már rögzítette → no-op 200.
          eventLog.info('barion-callback: versenyhelyzet a dedup-írásnál — no-op 200')
          return jsonResponse({ ok: true, status: 'duplicate' })
        }
        throw createError
      }

      // 2. AZONNALI 200 — a feldolgozás aszinkron (a GetState-re NEM várunk).
      schedule(runProcessing)
      return jsonResponse({ ok: true, status: 'accepted' })
    } catch (error) {
      // Infrastrukturális hiba (DB elérhetetlen): 500, hogy a Barion retry-lépcsője
      // újra kézbesítse — az esemény ilyenkor még NEM rögzült.
      eventLog.error('barion-callback: technikai hiba a dedup során', {
        error: error instanceof Error ? error.message : String(error),
      })
      return jsonResponse(
        { ok: false, error: 'A webhook feldolgozása ideiglenesen nem érhető el.' },
        500,
      )
    }
  }
}

export { registerBarionWebhookProcessor } from './process-callback'
