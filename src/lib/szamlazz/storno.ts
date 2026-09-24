import type { Payload } from 'payload'

import type { Order } from '../../payload-types'
import { withAdvisoryLock } from '../advisory-lock'
import { logger as rootLogger, type Logger } from '../logger'
import {
  getSzamlazzConfig,
  isAbortError,
  isDuplicateOrderError,
  readAgentResponse,
  type SzamlazzParsedSuccess,
} from './client'
import { escapeXml } from './invoice'
import { writeOrderInvoicingState, writeOrderInvoicingStateBestEffort } from './order-state'
import { claimManagedRefundDocument, managedRefundDocument } from './refund-guard'
import { SzamlazzApiError, type IssueStornoResult, type SzamlazzClientConfig } from './types'

/**
 * Stornó-számla (xmlszamlast). Automatikus retry tilos — bizonytalan állapotban
 * vak újraküldés dupla stornót okozhat. Idempotencia: stornoNumber / stornoStatus.
 */

/** Max stornó-kísérlet; felett `failed` + owner-jelzés (kézi ellenőrzés után újrafuttatás). */
export const MAX_STORNO_ATTEMPTS = 5

/** A stornó-kiállítás sorosító advisory-zárának kulcsa egy rendeléshez. */
export function stornoLockKey(orderId: number | string): string {
  return `storno:${orderId}`
}

export interface BuildStornoXmlInput {
  agentKey: string
  /** Az eredeti (stornózandó) számla száma — <fejlec><szamlaszam>. */
  originalInvoiceNumber: string
  /** A rendelésszám — az alap-megjegyzésben hivatkozzuk. */
  orderNumber: string
  /** A sztornózás oka (a <megjegyzes> mezőbe; üres is lehet). */
  reason?: string
  /** A vevő e-mail-címe (a stornó-értesítő kiküldéséhez; üres is lehet). */
  buyerEmail?: string
}

/**
 * A teljes stornó-XML (xmlszamlast) a hivatalos tag-sorrendben.
 * A váz-tagok üresen is jelen vannak (a mezősorrend kötött, a mintának
 * megfelelően), a dinamikus értékek XML-escape-elve.
 *
 * DÁTUMOK SZÁNDÉKOSAN KIHAGYVA: a stornó számlán a teljesítési dátumnak az
 * EREDETI számláéval azonosnak KELL lennie (tudastar/gyik/szamla-sztornozasa).
 * A keltDatum/teljesitesDatum az Agent-kérésben opcionális. Független,
 * teszt-fiókos mérés (sagikazarmark/szamlazz-rs,
 * docs/szamlazz-hu-behaviour.md, P48-P1/P5, 2026-09-06) szerint kihagyott
 * teljesitesDatum mellett a stornó az EREDETI számla teljesítési dátumát
 * kapja, a kelte pedig a mai nap. Explicit, eltérő teljesítési dátumot az
 * Agent szó nélkül elfogad (P48-P3), a nem mai keltDatumot pedig 352-es
 * hibával utasítja el — ezért egyiket sem küldjük. (Saját fiókos
 * megerősítés: docs/szamlazz-megfeleles.md, C6 / T11.)
 *
 * szamlaKulsoAzon SZÁNDÉKOSAN NINCS a kérésben — lásd a modul-docblockot (F3).
 */
export function buildStornoXml(input: BuildStornoXmlInput): string {
  const esc = escapeXml
  const megjegyzes = input.reason?.trim()
    ? esc(input.reason.trim())
    : esc(`Visszatérítés (refund) — rendelés: ${input.orderNumber}`)
  return `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamlast xmlns="http://www.szamlazz.hu/xmlszamlast" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.szamlazz.hu/xmlszamlast https://www.szamlazz.hu/szamla/docs/xsds/agentst/xmlszamlast.xsd">
  <beallitasok>
    <szamlaagentkulcs>${esc(input.agentKey)}</szamlaagentkulcs>
    <eszamla>true</eszamla>
    <szamlaLetoltes>false</szamlaLetoltes>
    <valaszVerzio>2</valaszVerzio>
  </beallitasok>
  <fejlec>
    <szamlaszam>${esc(input.originalInvoiceNumber)}</szamlaszam>
    <megjegyzes>${megjegyzes}</megjegyzes>
    <tipus>SS</tipus>
  </fejlec>
  <elado>
    <emailReplyto></emailReplyto>
    <emailTargy></emailTargy>
    <emailSzoveg></emailSzoveg>
  </elado>
  <vevo>
    <email>${esc(input.buyerEmail ?? '')}</email>
  </vevo>
</xmlszamlast>`
}

/**
 * A stornó-XML POST-olása az 'action-szamla_agent_st' multipart-mezőben.
 * A postInvoiceXml stornó-változata: az agent-kulcs az XML-ben (bodyban)
 * utazik, a napló titokmentes, a hibaágak megegyeznek (timeout/network/http/
 * agent/invalid_response — a parseAgentResponse-t újrahasznosítja).
 */
export async function postStornoXml(
  xml: string,
  config?: SzamlazzClientConfig,
): Promise<SzamlazzParsedSuccess> {
  const resolved = config ?? getSzamlazzConfig()
  if (!resolved.enabled || !resolved.agentKey) {
    throw new SzamlazzApiError({
      message: 'A Számlázz.hu-integráció nincs beállítva (SZAMLAZZ_AGENT_KEY hiányzik).',
      kind: 'invalid_data',
      retryable: false,
    })
  }

  const endpoint = 'POST /szamla (action-szamla_agent_st)'
  const form = new FormData()
  form.append('action-szamla_agent_st', new Blob([xml], { type: 'text/xml' }), 'szamlast.xml')

  const startedAt = Date.now()
  let response: Response
  try {
    response = await fetch(resolved.apiUrl, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(resolved.timeoutMs),
    })
  } catch (error) {
    if (isAbortError(error)) {
      throw new SzamlazzApiError({
        message: `A Számlázz.hu nem válaszolt ${resolved.timeoutMs} ms-en belül.`,
        kind: 'timeout',
        retryable: true,
      })
    }
    throw new SzamlazzApiError({
      message: `A Számlázz.hu elérhetetlen: ${error instanceof Error ? error.message : String(error)}`,
      kind: 'network',
      retryable: true,
    })
  }

  const durationMs = Date.now() - startedAt
  // F6: a törzs OLVASÁSA is megszakadhat (streamelés közbeni timeout,
  // TCP-vágás). A közös readAgentResponse ezt retryable hibává osztályozza —
  // nyers TypeError-ként a hívó nem tudná, hogy a POST már elindult, és a
  // bizonytalan állapot RIASZTÁS nélkül maradna. A nem-2xx válasz hibakódját
  // is kiolvassa; a parseAgentResponse már osztályozott hibái változatlanul
  // mennek tovább.
  const result = await readAgentResponse(response, resolved.timeoutMs, 'stornó')
  const log = rootLogger.child({ module: 'szamlazz-storno' })
  log.info('Számlázz.hu stornó-számla kiállítva', {
    endpoint,
    durationMs,
    szamlaszam: result.szamlaszam,
  })
  return result
}

// ---------------------------------------------------------------------------
// Stornó-kiállítás a rendeléshez
// ---------------------------------------------------------------------------

export interface IssueStornoForOrderDeps {
  /**
   * Payload-példány: megadva a stornó állapota a RENDELÉSRE is felkerül
   * (stornoStatus/stornoNumber/stornoAttempts/stornoLastError). Elhagyva a
   * szolgáltatás csak a hálózati műveletet végzi és naplóz — ilyenkor az
   * alkalmazás-szintű dupla-stornó-védelem (a rendelésen rögzített állapot)
   * sem működik, ezért éles úton MINDIG payloaddal kell hívni.
   */
  payload?: Payload
  config?: SzamlazzClientConfig
  logger?: Logger
  /** Injektálható HTTP-hívó (teszteléshez); alapból a valódi postStornoXml. */
  postXml?: (xml: string, config: SzamlazzClientConfig) => Promise<SzamlazzParsedSuccess>
  /** A stornó indoka (pl. a refund reason) — a <megjegyzes> mezőbe kerül. */
  reason?: string | null
}

/**
 * Újrapróbálandó-e a stornó a kapott hiba alapján. A hívó (refund-bekötés)
 * ez alapján dönt: retryable timeout/hálózat után RIASZTÁS megy ki, és
 * NEM kerül sorba a storno-issue job (egy inline POST után az állapot
 * bizonytalan — F3, dupla stornó kockázata).
 */
export function isRetryableStornoError(error: unknown): boolean {
  return error instanceof SzamlazzApiError && error.retryable
}

/** A vevő e-mail-címe a customerSnapshot-ból, fallback a customerEmail. */
function buyerEmailFromOrder(order: Order): string {
  const snapshot =
    typeof order.customerSnapshot === 'object' &&
    order.customerSnapshot !== null &&
    !Array.isArray(order.customerSnapshot)
      ? (order.customerSnapshot as Record<string, unknown>)
      : {}
  const snapshotEmail = typeof snapshot.email === 'string' ? snapshot.email.trim() : ''
  return snapshotEmail || (order.customerEmail ?? '').trim()
}

/**
 * Stornó-számla kiállítása egy rendeléshez — idempotens:
 * - a rendelésen már rögzítve van stornó (stornoNumber vagy
 *   stornoStatus='storned') → 'already-storned' (no-op);
 * - Számlázz.hu kikapcsolva (nincs agent-kulcs) → 'disabled' (no-op, NEM hiba);
 * - hiányzó eredeti számlaszám / rendelésszám → 'failed' + stornoStatus
 *   'failed' (NEM dob — emberi beavatkozás kell, az újrapróbálás nem segít);
 * - kimerült kísérletszám (MAX_STORNO_ATTEMPTS) → 'failed' hálózati hívás
 *   NÉLKÜL, error-szintű owner-jelzéssel;
 * - MÁR VOLT beküldés (stornoAttempts > 0), de nincs rögzített stornó →
 *   'failed' + RIASZTÁS, beküldés NÉLKÜL: a stornó állapota bizonytalan,
 *   és a vak újraküldés dupla stornót okozhatna (F3);
 * - duplikátum-jelzés (71/152) → 'failed' + RIASZTÁS, kézi egyeztetéssel;
 * - retryable provider/timeout-hiba → stornoStatus 'failed' + THROW. A
 *   hívó NEM állít sorba automatikus retry-t: a következő
 *   issueStornoForOrder a fenti „bizonytalan állapot" ágra futna, tehát
 *   soha nem POSTolna újra — a sorbaállítás csapda volna. Emberi
 *   ellenőrzés kell a Számlázz.hu-fiókban.
 *
 * A `deps.payload` megadásakor minden állapotátmenet a rendelésre is felkerül
 * (pending → storned | failed, attempts-számlálóval és utolsó hibaüzenettel).
 */
export async function issueStornoForOrder(
  order: Order,
  deps: IssueStornoForOrderDeps = {},
): Promise<IssueStornoResult> {
  const log = (deps.logger ?? rootLogger).child({
    module: 'szamlazz-storno',
    orderId: order.id,
    orderNumber: order.orderNumber ?? null,
  })
  const config = deps.config ?? getSzamlazzConfig()
  const payload = deps.payload
  const saveState = async (data: Record<string, unknown>): Promise<void> => {
    if (payload) {
      await writeOrderInvoicingState(payload, order.id, data)
    }
  }
  const saveStateBestEffort = async (data: Record<string, unknown>): Promise<void> => {
    if (payload) {
      await writeOrderInvoicingStateBestEffort(payload, order.id, data, log)
    }
  }

  if (!config.enabled) {
    log.debug('számlázás kikapcsolva (SZAMLAZZ_AGENT_KEY nincs beállítva) — stornó kihagyva')
    return { outcome: 'disabled' }
  }

  // A „friss olvasás → döntés → POST → persist" szakasz advisory-zár alatt fut
  // (SEC-011): a refund utáni inline stornó és a számla-kompenzáció ugyanazt az
  // elavult állapotot láthatná, és MINDKETTŐ POSTolna. A záron belül frissen
  // olvassuk újra a rendelést, így a párhuzamos futás által már rögzített stornó
  // az idempotencia-ágon no-op lesz — egyszerre csak egy provider-hívás mehet ki.
  const runIssue = async (currentOrder: Order): Promise<IssueStornoResult> => {
    const managed = payload ? await managedRefundDocument(payload, currentOrder, 'storno') : null
    if (managed?.number) return { outcome: 'already-storned', stornoNumber: managed.number }
    // Idempotencia (alkalmazás-oldal): a rendelésen rögzített stornó.
    const recordedStornoNumber = currentOrder.stornoNumber?.trim()
    if (recordedStornoNumber || currentOrder.stornoStatus === 'storned') {
      log.info('a rendeléshez már rögzítve van stornó-számla — idempotens no-op', {
        stornoNumber: recordedStornoNumber ?? null,
      })
      return {
        outcome: 'already-storned',
        ...(recordedStornoNumber ? { stornoNumber: recordedStornoNumber } : {}),
      }
    }

    if (!currentOrder.orderNumber) {
      log.error('RIASZTÁS: a rendelés rendelésszám nélkül fut — stornó nem állítható ki')
      await saveStateBestEffort({ stornoStatus: 'failed', stornoLastError: 'hiányzó rendelésszám' })
      return { outcome: 'failed', reason: 'hiányzó rendelésszám' }
    }

    const originalInvoiceNumber = currentOrder.invoiceNumber?.trim()
    if (!originalInvoiceNumber) {
      // Nem retryable: számla nélkül nincs mit stornózni — emberi pótlás kell.
      const reason = 'hiányzó eredeti számlaszám (invoiceNumber)'
      log.warn(
        'a rendeléshez nem tartozik kiállított számla (invoiceNumber) — stornó NEM állítható ki',
      )
      await saveStateBestEffort({ stornoStatus: 'failed', stornoLastError: reason })
      return { outcome: 'failed', reason }
    }

    const previousAttempts = currentOrder.stornoAttempts ?? 0
    if (previousAttempts >= MAX_STORNO_ATTEMPTS) {
      const reason = `a stornó-kísérletek száma kimerült (${previousAttempts}/${MAX_STORNO_ATTEMPTS})`
      log.error(
        'RIASZTÁS: a stornó-kiállítás újrapróbálásai kimerültek — emberi beavatkozás kell',
        {
          attempts: previousAttempts,
          lastError: currentOrder.stornoLastError ?? null,
        },
      )
      await saveStateBestEffort({ stornoStatus: 'failed', stornoLastError: reason })
      return { outcome: 'failed', reason }
    }

    // F3 — BIZONYTALAN ÁLLAPOT: volt már beküldés, de a rendelésen nincs stornó.
    // A stornó-kérés nem visszakereshető saját kulccsal (a szamlaKulsoAzon a
    // SZTORNÓZANDÓ számlát hivatkozná), ezért nem lehet eldönteni, átment-e az
    // előző beküldés. A vak újraküldés dupla stornót okozhat, ami már nem
    // javítható — inkább megállunk és emberi ellenőrzést kérünk.
    if (previousAttempts > 0) {
      const reason =
        'a stornó állapota bizonytalan: már történt beküldés, de a rendelésen nincs rögzített stornó — kézi ellenőrzés kell a Számlázz.hu-fiókban (a vak újraküldés dupla stornót okozhat)'
      log.error(`RIASZTÁS: ${reason}`, {
        attempts: previousAttempts,
        lastError: currentOrder.stornoLastError ?? null,
      })
      await saveStateBestEffort({ stornoStatus: 'failed', stornoLastError: reason })
      return { outcome: 'failed', reason }
    }
    const attempts = previousAttempts + 1

    const buyerEmail = buyerEmailFromOrder(currentOrder)
    const xml = buildStornoXml({
      agentKey: config.agentKey as string,
      originalInvoiceNumber,
      orderNumber: currentOrder.orderNumber,
      ...(deps.reason ? { reason: deps.reason } : {}),
      ...(buyerEmail ? { buyerEmail } : {}),
    })

    if (payload && managed) await claimManagedRefundDocument(payload, managed, previousAttempts)
    await saveState({ stornoStatus: 'pending', stornoAttempts: attempts })

    try {
      const postXml = deps.postXml ?? postStornoXml
      const result = await postXml(xml, config)
      await saveState({
        stornoStatus: 'storned',
        stornoNumber: result.szamlaszam,
        stornoAttempts: attempts,
        stornoLastError: null,
      })
      log.info('stornó-számla kiállítva', {
        stornoNumber: result.szamlaszam,
        originalInvoiceNumber,
        attempts,
        persisted: payload !== undefined,
      })
      if (result.notificationError) {
        // 56: a stornó kiállt, csak az értesítő levél nem ment ki. Az üzenet
        // szövegét nem naplózzuk (a vevő e-mail-címét tartalmazhatja).
        log.error(
          'RIASZTÁS: a stornó-számla kiállt, de a számlaértesítő e-mail NEM ment ki a vevőnek (56-os kód) — küldd ki kézzel a Számlázz.hu-fiókból',
          { stornoNumber: result.szamlaszam, agentErrorCode: result.notificationError.code },
        )
      }
      return { outcome: 'storned', stornoNumber: result.szamlaszam }
    } catch (error) {
      // 71/152 — duplikátum-jelzés. A stornó ágon NINCS visszakereső kulcsunk
      // (F3), ezért a jelzést nem lehet lekérdezéssel feloldani: a bizonylat a
      // Számlázz.hu szerint már létezik, de a számát csak a fiókból lehet
      // kiolvasni — kézi egyeztetés kell.
      if (isDuplicateOrderError(error)) {
        const reason =
          'a Számlázz.hu duplikátumot jelzett (71/152) a stornóra: a bizonylat vélhetően MÁR LÉTEZIK, de a száma automatikusan nem kereshető vissza — kézi egyeztetés szükséges a Számlázz.hu-fiókban'
        log.error(`RIASZTÁS: ${reason}`, {
          agentErrorCodes: error.agentErrors.map((entry) => entry.code),
        })
        await saveStateBestEffort({
          stornoStatus: 'failed',
          stornoAttempts: attempts,
          stornoLastError: reason,
        })
        return { outcome: 'failed', reason }
      }
      const message = error instanceof Error ? error.message : String(error)
      await saveStateBestEffort({
        stornoStatus: 'failed',
        stornoAttempts: attempts,
        stornoLastError: message,
      })
      if (error instanceof SzamlazzApiError) {
        log.warn('stornó-számla kiállítás sikertelen', {
          kind: error.kind,
          retryable: error.retryable,
          attempts,
          agentErrorCodes: error.agentErrors.map((entry) => entry.code),
          error: error.message,
        })
        if (error.retryable) {
          // A POST már elindult. A hívó (refund-bekötés) NEM állít sorba
          // automatikus retry-t: a storno-issue job a stornoAttempts>0 miatt
          // F3-on RIASZTÁS-sal megállna, és soha nem POSTolna újra — a
          // sorbaállítás tehát csapda. Dupla stornó semmiképp ne keletkezhessen.
          throw error
        }
        return { outcome: 'failed', reason: error.message }
      }
      log.error('stornó-számla kiállítás váratlan hibával állt le', { attempts, error: message })
      throw error
    }
  }

  // Zár nélkül (nem-production / mock payload findByID nélkül): a bejövő
  // pillanatképen dolgozunk, ahogy eddig. Éles Payloadnál a záron belül friss
  // olvasás védi a párhuzamos dupla-POST ellen.
  if (!payload || typeof payload.findByID !== 'function') {
    return runIssue(order)
  }
  return withAdvisoryLock(
    payload,
    stornoLockKey(order.id),
    async () => {
      const fresh = (await payload.findByID({
        collection: 'orders',
        id: order.id,
        depth: 0,
        overrideAccess: true,
      })) as Order | null
      return runIssue(fresh ?? order)
    },
    log,
  )
}
