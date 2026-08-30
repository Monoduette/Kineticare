import { after } from 'next/server'
import type { Payload } from 'payload'

import { withAdvisoryLock } from '../advisory-lock'
import {
  isNonTerminalWebhookResult,
  isTerminallyProcessed,
  isUniqueViolation,
  MAX_WEBHOOK_ATTEMPTS,
  processWebhook,
  webhookEventStore,
  type WebhookEventStore,
} from '../idempotency'
import { logger } from '../logger'
import { generateRequestId, getRequestId } from '../request-id'
import { readBodyWithCap } from '../security/request-body'
import {
  checkIpRateLimit,
  resolveRateLimitIp,
  type CheckRequestRateLimitOptions,
} from '../security/rate-limit'
import { createBarionCallbackProcessor } from './process-callback'

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
 * A Barion PaymentId GUID (UUID) alakú — a Barion API-dokumentáció és a
 * gyakorlatban kapott értékek szerint is `8-4-4-4-12` hexadecimális csoport.
 * Kis- és nagybetűs hexet is elfogadunk (a Barion kisbetűset küld, de a
 * GUID-alak önmagában nem kis-nagybetű-érzékeny).
 */
const PAYMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Egy GUID pontosan ennyi karakter — a mintaillesztés előtti olcsó kapu. */
export const MAX_PAYMENT_ID_LENGTH = 36

/**
 * A JSON-törzs tartalék-csatorna felső bájtkorlátja. A valódi Barion-callback
 * ÜRES törzzsel jön (a PaymentId a query-ben), ez a fallback pedig legföljebb
 * egy pici `{ "PaymentId": "<guid>" }`-t hoz — 16 KiB bőven elég. A cap a
 * `request.json()` előtti korlátlan bufferelést zárja (SEC-008): egy több
 * megabájtos törzs sosem kerül teljes egészében a memóriába.
 */
export const MAX_CALLBACK_BODY_BYTES = 16 * 1024

/** A callback-feldolgozás (GetState) sorosító advisory-zárának kulcsa egy PaymentId-re. */
export function callbackLockKey(paymentId: string): string {
  return `barion-callback:${paymentId}`
}

/**
 * Egy nyers érték ALAK-ellenőrzése — hiányzó, üres, túl hosszú vagy nem
 * GUID-alakú érték esetén null.
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
  return PAYMENT_ID_PATTERN.test(trimmed) ? trimmed : null
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
async function isKnownBarionPaymentId(payload: Payload, paymentId: string): Promise<boolean> {
  const found = await payload.find({
    collection: 'orders',
    where: { barionPaymentId: { equals: paymentId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return found.docs.length > 0
}

export function createBarionCallbackHandler(deps: BarionCallbackHandlerDeps) {
  const schedule = deps.schedule ?? ((task: () => Promise<void>) => after(task))

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

    const runProcessing = async (): Promise<void> => {
      // SEC-006: a feldolgozás (GetState) PaymentId-re szabott advisory-zár
      // alatt fut — párhuzamos/egyszerre kézbesített ismétlések nem indítanak
      // egyidejű GetState-vihart. Az első futás után a rekord terminális lesz,
      // a záron várakozó ismétlés friss olvasáson már no-opot lát (processWebhook
      // isTerminallyProcessed), tehát nem hív újabb GetState-et.
      const outcome = await withAdvisoryLock(
        payload,
        callbackLockKey(paymentId),
        () =>
          processWebhook({
            store,
            provider: 'barion',
            externalId: paymentId,
            requestId,
            handler: createBarionCallbackProcessor({ payload, store }),
          }),
        eventLog,
      )
      if (outcome.kind === 'failed') {
        if (!outcome.retryable) {
          // Ez volt az utolsó megengedett kísérlet: a webhook-retry MÁR NEM
          // viszi tovább — az owner-riasztás itt, a kimerülés pillanatában megy.
          eventLog.error(
            'webhook-esemény újrapróbálásai kimerültek — owner beavatkozás szükséges',
            {
              attempts: outcome.attempts,
              error: outcome.error,
            },
          )
        } else {
          eventLog.warn('barion-callback: aszinkron feldolgozás sikertelen (retry-job folytatja)', {
            attempts: outcome.attempts,
            retryable: outcome.retryable,
            error: outcome.error,
          })
        }
      }
    }

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
        // Már VÉGLEGESEN feldolgozva → no-op (dupla kézbesítés).
        eventLog.info('barion-callback: duplikált kézbesítés — már feldolgozva, no-op 200')
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

        // 'received' + még nincs eredmény = a feldolgozás ütemezve/fut;
        // 'failed' = a Barion retry-lépcső újra kézbesítette → azonnali újrapróbálás;
        // nem terminális eredmény (pending_repoll) = a fizetés korábban még függő
        // volt, EZ a kézbesítés hozza a végleges státuszt → újra feldolgozzuk (B4).
        if (record.status === 'failed' || isNonTerminalWebhookResult(record.result)) {
          schedule(runProcessing)
        }
        return jsonResponse({ ok: true, status: 'received' })
      }

      // Új esemény: ismert rendelés korlátlan; ismeretlen GUID IP-keretes
      // (a ritka checkout-írás vs. callback verseny egy vödörhelyet fogyaszt,
      // de a keret alatt átmegy — mentőháló: order-poll).
      const known = await isKnownBarionPaymentId(payload, paymentId)
      if (!known) {
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
