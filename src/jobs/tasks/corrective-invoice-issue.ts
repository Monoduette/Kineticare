import type { TaskConfig } from 'payload'

import type { Order } from '../../payload-types'
import { finishRefundAfterCorrective } from '../../lib/refund/refund-recovery'
import { readRefundEntries } from '../../lib/refund/refund-order'
import { issueCorrectiveInvoiceForOrder } from '../../lib/szamlazz'
import { correctiveKulsoAzon, legacyCorrectiveKulsoAzon } from '../../lib/szamlazz/kulso-azon'
import { RefundDocumentGuardError } from '../../lib/szamlazz/refund-guard'
import type { IssueCorrectiveInvoiceResult } from '../../lib/szamlazz/types'
import { resolveSzamlazzTaskGate } from '../szamlazz-task-gate'
import { logger } from '../../lib/logger'

/** corrective-invoice-issue: részleges refund helyesbítő számlája; `refundSeq` = idempotencia-kulcs. */

interface CorrectiveInvoiceJobIO {
  input: { orderId: number; refundSeq: number }
  output: {
    outcome: string
    correctiveInvoiceNumber?: string
    reason?: string
  }
}

/** Ennyiszer próbálja újra a Payload a hibára futott jobot (az első futás után). */
const RETRIES = 3

/**
 * A helyesbítő keresési mondata a riasztásba: a rendelésszáma (a
 * Számlázz.hu-fiókban erre lehet keresni) és a külső azonosítója (a
 * lekérdezés kulcsa, kulso-azon.ts). Rendelés nélkül csak a sorszám ismert.
 */
function correctiveSearchText(order: Order | null, refundSeq: number): string {
  if (!order?.orderNumber) {
    return `a rendelés ${refundSeq}. visszatérítéséhez tartozó helyesbítőt (a rendelés nem olvasható)`
  }
  return `a(z) ${legacyCorrectiveKulsoAzon(order.orderNumber, refundSeq)} rendelésszámú helyesbítőt (külső azonosítója: ${correctiveKulsoAzon(order.orderNumber, order, refundSeq)})`
}

export const correctiveInvoiceIssueTask: TaskConfig<CorrectiveInvoiceJobIO> = {
  slug: 'corrective-invoice-issue',
  retries: RETRIES,
  inputSchema: [
    { name: 'orderId', type: 'number', required: true },
    { name: 'refundSeq', type: 'number', required: true },
  ],
  outputSchema: [
    { name: 'outcome', type: 'text', required: true },
    { name: 'correctiveInvoiceNumber', type: 'text' },
    { name: 'reason', type: 'text' },
  ],
  handler: async ({ req, input }) => {
    const { orderId, refundSeq } = input as { orderId?: unknown; refundSeq?: unknown }
    if (typeof orderId !== 'number' || !Number.isInteger(orderId) || orderId <= 0) {
      throw new Error(`corrective-invoice-issue: érvénytelen orderId input (${String(orderId)})`)
    }
    if (typeof refundSeq !== 'number' || !Number.isInteger(refundSeq) || refundSeq <= 0) {
      throw new Error(
        `corrective-invoice-issue: érvénytelen refundSeq input (${String(refundSeq)})`,
      )
    }

    const gate = resolveSzamlazzTaskGate('corrective-invoice-issue')
    if (gate.kind === 'disabled') {
      return { output: { outcome: 'disabled' } }
    }
    if (gate.kind === 'failed') {
      return { output: { outcome: 'failed', reason: gate.reason } }
    }

    const order = (await req.payload.findByID({
      collection: 'orders',
      id: orderId,
      depth: 0,
      overrideAccess: true,
    })) as Order | null
    if (!order) {
      logger.warn('corrective-invoice-issue: a rendelés nem található — helyesbítő kihagyva', {
        orderId,
      })
      return { output: { outcome: 'failed', reason: 'a rendelés nem található' } }
    }

    const entry = readRefundEntries(order)[refundSeq - 1]
    if (!entry) {
      logger.warn('corrective-invoice-issue: a refund-nyomban nincs ilyen sorszámú bejegyzés', {
        orderId,
        refundSeq,
      })
      return { output: { outcome: 'failed', reason: 'ismeretlen visszatérítés-sorszám' } }
    }

    // A refund-bejegyzés `reason`-je a visszatérítési API szabad szöveges
    // indoka (belső adat). A helyesbítő megjegyzése a vevőhöz is eljut, ezért
    // az indok ide sem kerül át, ahogy a refund-recovery azonnali útján sem.
    let result: IssueCorrectiveInvoiceResult
    try {
      result = await issueCorrectiveInvoiceForOrder(order, {
        payload: req.payload,
        refundSeq,
        amountHuf: entry.amountHuf,
      })
    } catch (error) {
      if (!(error instanceof RefundDocumentGuardError)) throw error
      // A refund-őr végleges döntése (például a negatív lekérdezés után új
      // beküldés nem mehet ki): az újrapróbálás ugyanezt adná, ezért a job
      // nem dob, hanem hangosan, riasztáskóddal lezárul.
      logger.error(
        `RIASZTÁS: a helyesbítő újrapróbáló jobja leállt, mert a rendszer ehhez a visszatérítéshez automatikusan nem küldhet be helyesbítőt (a refund-őr megtagadta). A helyesbítő nem készült el biztosan: kézi kiállítás előtt keresd meg a Számlázz.hu-fiókban ${correctiveSearchText(order, refundSeq)}, és csak akkor állítsd ki kézzel, ha nincs meg (05-ös útmutató, 4. pont).`,
        {
          alertCode: 'helyesbito-nem-kuldheto-be-ujra',
          orderId,
          orderNumber: order.orderNumber ?? null,
          refundSeq,
        },
      )
      return { output: { outcome: 'failed', reason: error.message } }
    }
    // A helyesbítő megvan (most készült, átvettük, vagy már rögzítve volt): a
    // visszatérítés feldolgozását is lezárjuk (W1B-6).
    if (result.outcome === 'issued' || result.outcome === 'already-issued') {
      await finishRefundAfterCorrective(req.payload, order, refundSeq, logger)
    }
    return {
      output: {
        outcome: result.outcome,
        ...(result.correctiveInvoiceNumber
          ? { correctiveInvoiceNumber: result.correctiveInvoiceNumber }
          : {}),
        ...(result.reason ? { reason: result.reason } : {}),
      },
    }
  },
  /**
   * A job végleges hibája. A Payload 3.88 minden sikertelen próbálkozás után
   * hívja (queues/errors/handleTaskError.js), a saját újrapróbálási döntése
   * ELŐTT; a taskStatus a KORÁBBI próbálkozásokat számolja
   * (queues/utilities/getJobTaskStatus.js, az első futásnál null), és a
   * Payload akkor zár véglegesen, ha `totalTried >= retries`. Csak ekkor
   * riasztunk. Soha nem dob: a dobás a Payload hibakezelését szakítaná meg.
   */
  onFail: async ({ input, req, taskStatus }) => {
    if (taskStatus?.complete || (taskStatus?.totalTried ?? 0) < RETRIES) return
    const { orderId, refundSeq } = (input ?? {}) as { orderId?: unknown; refundSeq?: unknown }
    const seq = typeof refundSeq === 'number' ? refundSeq : 0
    let order: Order | null = null
    try {
      if (typeof orderId === 'number') {
        order = (await req.payload.findByID({
          collection: 'orders',
          id: orderId,
          depth: 0,
          overrideAccess: true,
        })) as Order | null
      }
    } catch {
      // A riasztás rendelésszám nélkül is kimegy, az orderId megvan.
    }
    try {
      logger.error(
        `RIASZTÁS: a helyesbítő újrapróbáló jobja minden próbálkozás után hibával állt le, a helyesbítő nem készült el biztosan. Nyisd meg a rendelés visszatérítési paneljét, és kövesd az ott leírtakat. Kézi kiállítás előtt keresd meg a Számlázz.hu-fiókban ${correctiveSearchText(order, seq)}.`,
        {
          alertCode: 'helyesbito-ujraprobalas-kimerult',
          orderId: typeof orderId === 'number' ? orderId : null,
          orderNumber: order?.orderNumber ?? null,
          refundSeq: seq,
        },
      )
    } catch {
      // A naplózás hibája sem akaszthatja meg a Payload hibakezelését.
    }
  },
}
