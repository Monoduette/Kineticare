import type { Payload } from 'payload'

import type { Order } from '../../payload-types'
import { grantRowsFromUnknown, productIdFromGrant } from '../access-grants'
import { budapestDateString } from './xml'

/**
 * A rendelés FIZETÉSÉNEK (hozzáférés-nyitásának) időpontja — a számla
 * teljesítési dátumának forrása.
 *
 * MIÉRT NEM A JOB FUTÁSI NAPJA: a számlajob az 5 perces order-maintenance
 * tickeken fut, újrapróbálással és resweeppel. A job napja szerinti
 * teljesítésnél a 23:58-kor fizetett rendelés a KÖVETKEZŐ napra (hónap végén
 * a következő áfa-időszakba, december 31-én a következő év AAM-keretébe)
 * kerülne, egy kiesés utáni újrafuttatásnál pedig napokkal később. Az Áfa tv.
 * 55. § (1) szerint a teljesítés az a tény, amellyel az ügylet megvalósul —
 * nálunk a sikeres kártyás fizetés utáni azonnali hozzáférés.
 *
 * FORRÁS: a paid-átmenet (src/lib/order-status/apply-barion-state.ts,
 * startAccessClock) a vevő `accessGrants` tömbjébe a rendelés minden
 * termékére `grantedAt = <a paid-átmenet pillanata>` sort ír,
 * `sourceKind: 'order'` + `sourceOrder: <rendelés>` eredettel, és egy
 * újrafutás az első órát MEGTARTJA. Ez az egyetlen tárolt, a fizetéshez kötött
 * időpont (a rendelésnek nincs paidAt mezője; új mező migrációt kívánna).
 * Több sor esetén a legkorábbi számít.
 *
 * null: nincs vevő, a vevő nem olvasható, vagy nincs e rendeléshez kötött
 * sor (pl. a hozzáférés-óra írása a paid-átmenetkor elbukott). A hívó ilyenkor
 * a kiállítás napjára esik vissza, figyelmeztetéssel.
 */
export interface OrderPaidMoment {
  /** A fizetés (hozzáférés-nyitás) pillanata. */
  paidAt: Date
  /** A pillanat budapesti naptári napja (YYYY-MM-DD) — a teljesítési dátum. */
  paidDate: string
}

/** A vevő azonosítója a rendelésről (depth 0: szám; feloldva: objektum). */
function customerIdFromOrder(order: Order): number | null {
  const customer = order.customer
  const id = typeof customer === 'object' && customer !== null ? customer.id : customer
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * A rendeléshez tartozó legkorábbi `grantedAt` a vevő `accessGrants`
 * soraiból. Tiszta függvény (tesztelhető DB nélkül).
 */
export function earliestOrderGrantMoment(rows: unknown, orderId: number): Date | null {
  let earliest: Date | null = null
  for (const row of grantRowsFromUnknown(rows)) {
    if (typeof row !== 'object' || row === null) {
      continue
    }
    if (row.sourceKind !== 'order' || productIdFromGrant(row.sourceOrder) !== orderId) {
      continue
    }
    const ms = typeof row.grantedAt === 'string' ? Date.parse(row.grantedAt) : Number.NaN
    if (Number.isNaN(ms)) {
      continue
    }
    if (earliest === null || ms < earliest.getTime()) {
      earliest = new Date(ms)
    }
  }
  return earliest
}

/**
 * A rendelés fizetési pillanatának feloldása a vevő `accessGrants` sorából.
 * Olvasási hiba (DB) esetén DOB — a hívó ilyenkor semmilyen állapotot nem ír,
 * a job újrapróbálja; egy átmeneti adatbázis-hiba így nem vezet rossz
 * teljesítési dátumhoz.
 */
export async function resolveOrderPaidMoment(
  payload: Payload,
  order: Order,
): Promise<OrderPaidMoment | null> {
  const customerId = customerIdFromOrder(order)
  if (customerId === null) {
    return null
  }
  const user = (await payload.findByID({
    collection: 'users',
    id: customerId,
    depth: 0,
    overrideAccess: true,
    disableErrors: true,
  })) as { accessGrants?: unknown } | null
  if (!user) {
    return null
  }
  const paidAt = earliestOrderGrantMoment(user.accessGrants, order.id)
  return paidAt ? { paidAt, paidDate: budapestDateString(paidAt) } : null
}
