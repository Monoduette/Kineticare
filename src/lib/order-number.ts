import type { Payload, PayloadRequest } from 'payload'

import { budapestDateString } from './date/budapest'

/**
 * Rendelésszám-generátor (T-017).
 *
 * Formátum: KH-<év>-<6 jegyű, éven belül futó sorszám>, pl. KH-2026-000123.
 * A generálás mindig szerver-oldalon történik (az orders create-hookja hívja),
 * a kliens sosem adhatja meg; update-kor újraszámolás nincs.
 *
 * Egyediség: az orders.orderNumber mező unique indexe a végső garancia;
 * a sorszám az adott év legnagyobb meglévő értékéből +1-gyel képződik.
 *
 * Az ÉV a magyar (Europe/Budapest) naptár szerinti: az éles szerver UTC-ben
 * fut, és a `getFullYear()` szilveszter éjjel, 00:00 és 01:00 (télen) között
 * még az előző évet adta volna (a-checkout-16). A rendelésszám a számlára és a
 * Barion-kivonatra is kerül, ahol a magyar dátum számít.
 */

export const ORDER_NUMBER_PATTERN = /^KH-(\d{4})-(\d{6})$/

export const formatOrderNumber = (year: number, sequence: number): string =>
  `KH-${year}-${String(sequence).padStart(6, '0')}`

/** A rendelésszámból a sorszám visszafejtése; érvénytelen formátumnál null. */
export const parseOrderNumberSequence = (orderNumber: string): number | null => {
  const match = ORDER_NUMBER_PATTERN.exec(orderNumber)
  return match ? Number.parseInt(match[2], 10) : null
}

/** A rendelésszám évszáma a megadott pillanatra, Europe/Budapest szerint. */
export const orderNumberYear = (now: Date): number =>
  Number.parseInt(budapestDateString(now).slice(0, 4), 10)

/**
 * A következő rendelésszám lekérése az adott évre.
 * A `where`/`sort` lazán típusozott: az orderNumber mező a payload-types
 * koordinátor-féle újragenerálásáig nincs benne a generált típusokban.
 *
 * A `req` a hívó hook kérése: vele a lekérdezés a create TRANZAKCIÓJÁBAN, a
 * már lefoglalt kapcsolaton fut, nem foglal második pool-kapcsolatot a
 * checkout-zár alatt (a-checkout-4). Nélküle (szkript, DB-teszt) önálló
 * lekérdezés.
 */
export const generateOrderNumber = async (
  payload: Payload,
  now = new Date(),
  req?: PayloadRequest,
): Promise<string> => {
  const year = orderNumberYear(now)

  const latest = await payload.find({
    collection: 'orders',
    where: {
      orderNumber: { like: `KH-${year}-` },
    },
    sort: '-orderNumber',
    limit: 1,
    depth: 0,
    overrideAccess: true,
    ...(req !== undefined ? { req } : {}),
  } as unknown as Parameters<Payload['find']>[0])

  const lastOrderNumber = (latest.docs[0] as unknown as { orderNumber?: string } | undefined)
    ?.orderNumber
  const lastSequence = lastOrderNumber ? (parseOrderNumberSequence(lastOrderNumber) ?? 0) : 0

  return formatOrderNumber(year, lastSequence + 1)
}
