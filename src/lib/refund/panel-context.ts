import type { Payload } from 'payload'

import type { Order } from '../../payload-types'
import { budapestDateString } from '../date/budapest'
import { logger, type Logger } from '../logger'
// Közvetlenül a modulokból: a számlázás be/ki állapota és a fizetés napja
// tiszta olvasás, a számlázás többi részének tesztbeli helyettesítése nem érinti.
import { isSzamlazzEnabled } from '../szamlazz/client'
import { resolveOrderPaidMoment } from '../szamlazz/paid-date'
import { refundInvoiceGate } from './invoice-gate'
import { findRecoveryOrder } from './refund-recovery'

/**
 * A tulajdonosi visszatérítés-panel rendelés-összefüggése a mentett
 * feldolgozási állapot mellé (GET /api/admin/orders/[orderNumber]/refund).
 *
 * - `refundGate`: miért nem indítható most új visszatérítés a számla felől
 *   (invoice-gate.ts); null, ha a számla felől indítható.
 * - `paidDate` és `daysSincePayment`: a fizetés budapesti naptári napja és az
 *   azóta eltelt naptári napok (K3: a garancia-döntés bemenete; a panel csak
 *   a tényt mutatja, jogosultságot nem állít). A rendelésnek nincs paidAt
 *   mezője: a forrás a vásárló ehhez a rendeléshez kötött hozzáférés-sorának
 *   kezdete (src/lib/szamlazz/paid-date.ts, ugyanez adja a számla teljesítési
 *   dátumát), ennek hiányában a kiállított számla teljesítési dátuma.
 *
 * Csak olvas, és sosem dob: a panel a hiányzó összefüggést is megjeleníti,
 * a szerver a visszatérítés indításakor mindent újra ellenőriz (refund-order.ts).
 */
export interface RefundPanelContext {
  refundGate: string | null
  /** A fizetés napja YYYY-MM-DD alakban (Europe/Budapest), vagy null. */
  paidDate: string | null
  daysSincePayment: number | null
}

const EMPTY_CONTEXT: RefundPanelContext = {
  refundGate: null,
  paidDate: null,
  daysSincePayment: null,
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u

function dayNumber(isoDate: string): number | null {
  const match = ISO_DATE.exec(isoDate)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const value = Date.UTC(year, month - 1, day)
  const check = new Date(value)
  return check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
    ? value / 86_400_000
    : null
}

/**
 * A fizetés napja óta eltelt naptári napok Europe/Budapest zónában: a
 * fizetés napja 0, a következő nap 1. A nap a magyar naptár szerint fordul,
 * nem UTC szerint, és a nyári időszámítás váltása sem csúsztatja el (a két
 * naptári dátum különbségét számoljuk, nem az eltelt órákat).
 */
export function daysSinceBudapestDate(paidDate: string, now: Date): number | null {
  const from = dayNumber(paidDate)
  const to = dayNumber(budapestDateString(now))
  return from === null || to === null || to < from ? null : to - from
}

async function paymentDate(payload: Payload, order: Order, log: Logger): Promise<string | null> {
  try {
    const moment = await resolveOrderPaidMoment(payload, order)
    if (moment) return moment.paidDate
  } catch (error) {
    log.warn('refund panel: a fizetés időpontja a hozzáférésből nem olvasható', {
      orderId: order.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  const completion = order.invoiceCompletionDate?.trim() ?? ''
  return dayNumber(completion) === null ? null : completion
}

export async function readRefundPanelContext(
  payload: Payload,
  orderNumber: string,
  options: { now?: Date; logger?: Logger } = {},
): Promise<RefundPanelContext> {
  const log = options.logger ?? logger
  try {
    const order = await findRecoveryOrder(payload, orderNumber)
    if (!order) return EMPTY_CONTEXT
    const gate = order.status === 'paid' ? refundInvoiceGate(order, isSzamlazzEnabled()) : null
    const paidDate = await paymentDate(payload, order, log)
    return {
      refundGate: gate?.message ?? null,
      paidDate,
      daysSincePayment: paidDate
        ? daysSinceBudapestDate(paidDate, options.now ?? new Date())
        : null,
    }
  } catch (error) {
    log.warn('refund panel: a rendelés-összefüggés nem olvasható', {
      orderNumber,
      error: error instanceof Error ? error.message : String(error),
    })
    return EMPTY_CONTEXT
  }
}
