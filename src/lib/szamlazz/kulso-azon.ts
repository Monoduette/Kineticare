import type { Order } from '../../payload-types'

/**
 * A bizonylatok külső azonosítója (szamlaKulsoAzon) — a VISSZAKERESÉS kulcsa
 * (pdf.ts), egy helyen képezve a számla, a stornó és a helyesbítő számára.
 *
 * MIÉRT GLOBÁLISAN EGYEDI (a-szamlazz-5, r-szamlazz-11). A rendelésszám
 * (`KH-<év>-<sorszám>`) az év legnagyobb meglévő sorszámából képződik, ezért
 * egy törölt utolsó rendelés vagy egy mentésből visszaállított adatbázis után
 * ugyanaz a rendelésszám egy MÁSIK vevő rendelésére kerülhet. Ha a külső
 * azonosító csak a rendelésszám volna, a beküldés előtti lekérdezés az idegen
 * (vagy már stornózott) bizonylatot találná meg, és a rendelés azzal a számmal
 * lenne „kiállítva". Az egyedi alak:
 *
 *   `<orderNumber>-<rendelés id>-<createdAt unix másodperc>`
 *
 * A rendelésszám marad az olvasható előtag (a Számlázz.hu-fiókban erre
 * keres az ember), az id és a létrehozás pillanata együtt zárja ki az
 * ütközést egy DB-visszaállítás után is. A `<rendelesSzam>` mező ettől
 * FÜGGETLENÜL a puszta rendelésszám marad (a fiókbeli rendelésszám-ismétlés
 * tiltása arra épül). Hossz: ~32 karakter; a Számlázz.hu az XSD-ben nem ad
 * hosszkorlátot, és 110 karakteres azonosítót is elfogadott a független
 * teszt-fiókos mérésben (r-szamlazz, szamlazz-hu-behaviour.md, A2).
 *
 * VISSZAFELÉ KOMPATIBILITÁS. A PR #304 (p-szamlazz-xml) a rendelésszámot
 * küldte külső azonosítóként, tehát élesben létezhet olyan bizonylat, amely
 * a RÉGI alakon kereshető vissza. A lekérdezők ezért a `*LookupKeys`
 * segédekkel dolgoznak: az új alak mindig, a régi alak CSAK akkor, ha a
 * rendelésen már volt beküldés (`invoiceAttempts > 0`, illetve a helyesbítő
 * seq-kulcsolt számlálója) — egy még sosem beküldött rendelésnél a régi
 * kulcson talált bizonylat biztosan idegen volna. Az átvétel a kulcstól
 * függetlenül a bruttó végösszeg egyezéséhez kötött (invoice.ts,
 * corrective.ts).
 */

export const STORNO_KULSO_AZON_SUFFIX = '-STORNO'
export const CORRECTIVE_KULSO_AZON_INFIX = '-HELYESBITO-'

/** A rendelésnek az az része, amelyből a globálisan egyedi kulcs képződik. */
export type KulsoAzonOrder = Pick<Order, 'id' | 'createdAt'>

/**
 * A `createdAt` unix másodpercben, vagy null, ha a mező hiányzik vagy
 * értelmezhetetlen (Payload mindig ISO-alakban írja; a null ág a mockolt
 * rendeléseké és a hibás adaté — ilyenkor a kulcs az id-vel zárul).
 */
function createdAtEpochSeconds(order: KulsoAzonOrder): number | null {
  const parsed = typeof order.createdAt === 'string' ? Date.parse(order.createdAt) : Number.NaN
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null
}

/** A számla globálisan egyedi külső azonosítója (az ÚJ alak). */
export function invoiceKulsoAzon(orderNumber: string, order: KulsoAzonOrder): string {
  const epoch = createdAtEpochSeconds(order)
  return `${orderNumber}-${order.id}${epoch === null ? '' : `-${epoch}`}`
}

/** A számla RÉGI (PR #304-es) külső azonosítója: maga a rendelésszám. */
export function legacyInvoiceKulsoAzon(orderNumber: string): string {
  return orderNumber
}

/**
 * A stornó SAJÁT külső azonosítója. Az `xmlszamlast` kérésben küldött
 * szamlaKulsoAzon a LÉTREJÖVŐ stornóhoz (SS) tapad, és ha az eredeti számla
 * kulcsát küldenénk, a stornó válna a kulcs legújabb birtokosává — az
 * eredeti számla ezen a kulcson már nem lenne elérhető (r-szamlazz,
 * szamlazz-hu-behaviour.md, B6/XPRB-P4). Ezért mindig toldalékos.
 */
export function stornoKulsoAzon(orderNumber: string, order: KulsoAzonOrder): string {
  return `${invoiceKulsoAzon(orderNumber, order)}${STORNO_KULSO_AZON_SUFFIX}`
}

/** A helyesbítő globálisan egyedi külső azonosítója egy refund-sorszámhoz (az ÚJ alak). */
export function correctiveKulsoAzon(
  orderNumber: string,
  order: KulsoAzonOrder,
  refundSeq: number,
): string {
  return `${invoiceKulsoAzon(orderNumber, order)}${CORRECTIVE_KULSO_AZON_INFIX}${refundSeq}`
}

/** A helyesbítő RÉGI (PR #304-es) külső azonosítója: `<orderNumber>-HELYESBITO-<seq>`. */
export function legacyCorrectiveKulsoAzon(orderNumber: string, refundSeq: number): string {
  return `${orderNumber}${CORRECTIVE_KULSO_AZON_INFIX}${refundSeq}`
}

/**
 * A számla visszakeresési kulcsai a lekérdezés sorrendjében: előbb az új
 * alak, és csak korábbi beküldés után a régi is.
 */
export function invoiceLookupKeys(
  orderNumber: string,
  order: KulsoAzonOrder,
  includeLegacy: boolean,
): string[] {
  const keys = [invoiceKulsoAzon(orderNumber, order)]
  if (includeLegacy) {
    keys.push(legacyInvoiceKulsoAzon(orderNumber))
  }
  return keys
}

/** A helyesbítő visszakeresési kulcsai (új alak, majd korábbi beküldés után a régi). */
export function correctiveLookupKeys(
  orderNumber: string,
  order: KulsoAzonOrder,
  refundSeq: number,
  includeLegacy: boolean,
): string[] {
  const keys = [correctiveKulsoAzon(orderNumber, order, refundSeq)]
  if (includeLegacy) {
    keys.push(legacyCorrectiveKulsoAzon(orderNumber, refundSeq))
  }
  return keys
}
