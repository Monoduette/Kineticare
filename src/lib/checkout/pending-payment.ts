import type { OrderPaymentState } from '../barion'
import { KAPCSOLATI_EMAIL_TARTALEK } from '../contact-email'

/**
 * Függő Barion-fizetés: élő fizetés → resume; Succeeded → paid helyben; GetState hiba → fail-closed.
 */

/**
 * Átmeneti hiba (timeout, hálózat, 5xx) a függő fizetés ellenőrzésekor: egy
 * perc múlva az újrapróbálás valóban segíthet.
 */
export const CHECKOUT_PAYMENT_STATE_UNAVAILABLE =
  'A fizetés állapotát most nem tudtuk ellenőrizni. Új fizetést nem indítunk, hogy ne vonjunk le kétszer. Próbáld újra egy perc múlva.'

/**
 * A Barion a korábbi függő fizetésre „nincs ilyen fizetés" jelzés nélküli
 * HTTP 404-et ad. Itt az azonnali újrapróbálás NEM segít: ugyanez a válasz
 * jön, amíg az order-poll le nem zárja a sort (24 óránál régebbi sor, ha a
 * futásban egy másik fizetés lekérdezése vagy az útvonal-próba sikeres, lásd
 * UNVERIFIED_NOT_FOUND_CANCEL_AFTER_MS). Ezért a szöveg nem ígér „egy perc
 * múlva" megoldást, hanem megmondja, meddig tart jellemzően, és hová írhat a
 * vevő, ha sürgős (GOV.UK, There is a problem with the service: a vevő kapjon
 * elérhetőséget, és ne ígérjünk időpontot, ha nem tudjuk, mi történt,
 * https://design-system.service.gov.uk/patterns/problem-with-the-service-pages/ ;
 * NN/g, Error-Message Guidelines: pontos leírás, konstruktív tanács, ne
 * hibáztasd a felhasználót, https://www.nngroup.com/articles/error-message-guidelines/).
 * Az „általában" ezért szándékos: globális Barion-hibánál a lezárás nem indul
 * el. A cím a K14 döntés szerinti egyetlen hivatalos ügyfélszolgálati cím; a
 * literál egyetlen forrása a contact-email.ts (őr: kapcsolati-email-feloldo.test.ts).
 */
export const CHECKOUT_PAYMENT_STATE_UNVERIFIED =
  'Ehhez a kurzushoz korábban már indult egy fizetés, de az állapotát most nem tudjuk ellenőrizni. ' +
  'Hogy ne vonjunk le kétszer, új fizetést csak akkor indíthatsz, ha ezt tisztáztuk. ' +
  'Ez általában legfeljebb egy napig tart. ' +
  `Ha sürgős, írj nekünk az ${KAPCSOLATI_EMAIL_TARTALEK} címre.`

/**
 * A várakoztató 409 szövege: ugyanahhoz a kurzushoz nemrég indult egy fizetés,
 * amelynek a sorsát még nem látjuk (a PaymentId nem került a rendelésre, vagy
 * a Barion túl korán jelzi, hogy nem ismeri). Két, egymástól nem
 * megkülönböztethető eset: a Start elindult, de a válasza elveszett (a vevő
 * ilyenkor a Barion-oldalon fizethet), vagy a Start meg sem történt. Ezért a
 * szöveg csak azt állítja, ami mindkettőre igaz, és megmondja, mennyit kell
 * várni (NN/g, Error Message Guidelines: „offer some potential remedies",
 * https://www.nngroup.com/articles/error-message-guidelines/ ; GOV.UK, There is
 * a problem with the service: mondd meg, mikor próbálkozhat újra,
 * https://design-system.service.gov.uk/patterns/problem-with-the-service-pages/).
 * A tárgy („új fizetést") ki van írva: a hiányos „újat" a mondat elejére
 * visszautal, és csak második olvasásra érthető.
 */
export function checkoutPaymentInProgressMessage(minutesLeft: number): string {
  return (
    'Ehhez a kurzushoz nemrég már indult egy fizetés, és az eredményét még nem látjuk. ' +
    `Hogy ne vonjunk le kétszer, új fizetést ${minutesLeft} perc múlva indíthatsz. ` +
    'Ha addig visszaigazoló e-mailt kapsz, nincs több teendőd.'
  )
}

/**
 * Bizonytalan kimenetű Start (timeout, hálózati hiba, 5xx, értelmezhetetlen
 * válasz): a Barion létrehozhatta a fizetést, csak a válasza nem ért el
 * hozzánk. A vevő a fizetési oldalra nem jutott el, tehát pénzt nem vontunk le;
 * ezt és a várakozás okát, hosszát is megmondjuk (GOV.UK: mondd meg, mi lett a
 * megkezdett ügyével; NN/g: pontos leírás és megoldás). A szöveg nem hibáztat
 * senkit (a bizonytalanság oka a vevőnek nem teendő), és a tárgyat kiírja.
 */
export function checkoutStartUncertainMessage(minutesLeft: number): string {
  return (
    'A fizetési oldal nem nyílt meg, és pénzt nem vontunk le. ' +
    'Mivel nem tudjuk biztosan, hogy a fizetés elindult-e, ' +
    `erre a kurzusra ${minutesLeft} perc múlva indíthatsz új fizetést.`
  )
}

/**
 * A Barion elutasította a Startot, de a rendelést nem tudtuk payment_failed-re
 * írni (adatbázis-hiba): a sor payment_pending marad, tehát a vevő új
 * próbálkozását a várakoztató ág fogja meg. Ilyenkor az azonnali újrapróbálás
 * ígérete hamis volna, ezért a várakozás hosszát mondjuk meg.
 */
export function checkoutStartRejectedWaitMessage(minutesLeft: number): string {
  return (
    'A fizetési oldal nem nyílt meg, mert a Barion nem fogadta el a fizetés indítását. ' +
    `Pénzt nem vontunk le. Erre a kurzusra ${minutesLeft} perc múlva indíthatsz új fizetést. ` +
    'Ha a hiba ismétlődik, írj nekünk a Kapcsolat oldalon.'
  )
}

/**
 * Hány perc van hátra a fizetési ablakból (felfelé kerekítve, 1 és az ablak
 * hossza között). Ismeretlen létrehozási időnél a teljes ablak: a várakozás
 * így sosem rövidebb a ténylegesnél.
 */
export function minutesLeftInWindow(
  createdAt: string | null | undefined,
  nowMs: number,
  windowMs: number,
): number {
  const windowMinutes = Math.max(1, Math.ceil(windowMs / 60_000))
  const createdMs = createdAt ? Date.parse(createdAt) : Number.NaN
  if (Number.isNaN(createdMs)) {
    return windowMinutes
  }
  const remainingMinutes = Math.ceil((createdMs + windowMs - nowMs) / 60_000)
  return Math.min(windowMinutes, Math.max(1, remainingMinutes))
}

export function barionPayUrl(paymentId: string, environment: 'test' | 'prod'): string {
  const host =
    environment === 'prod' ? 'https://secure.barion.com' : 'https://secure.test.barion.com'
  return `${host}/Pay?id=${encodeURIComponent(paymentId)}`
}

export type PendingCheckoutDecision =
  | { kind: 'barion-unavailable' }
  /**
   * Puszta (vagy ismeretlen kódú) HTTP 404 a függő fizetésre: fail-closed, de
   * nem átmeneti hiba. A sort az order-poll zárja le (24 óra + útvonal-bizonyíték),
   * addig 503 a saját, őszinte szövegével.
   */
  | { kind: 'unverified-not-found' }
  | { kind: 'already-paid' }
  | { kind: 'resume'; paymentId: string }
  | { kind: 'cancel-and-restart' }
  /** PaymentId nélküli függő sor a fizetési ablakon belül: a Start sorsa ismeretlen. */
  | { kind: 'wait-no-payment-id'; minutesLeft: number }
  /**
   * A Barion kifejezetten nem ismeri a PaymentId-t, de a sor még a fizetési
   * ablakon belül van: egy frissen indított fizetés átmeneti „nem ismerem"
   * válasza miatt nem zárjuk le, és nem indítunk mellé másodikat.
   */
  | { kind: 'wait-not-found'; minutesLeft: number }

export function decidePendingCheckout(input: {
  barionPaymentId: string | null | undefined
  createdAt: string | null | undefined
  /**
   * `'not-found'`: a Barion KIFEJEZETT hibajelzéssel mondja, hogy nem ismeri a
   * PaymentId-t (isPaymentDefinitelyNotFound, pl. 404 + NotExistingPaymentId).
   * Tipikus ok: más Barion-környezetben indított fizetés. A sor csak a
   * fizetési ablak lejárta után zárul le, és csak utána mehet új Start; egy
   * késői Succeeded a late-success ágon (R-03) ettől függetlenül paid-dé válik.
   *
   * `'unverified-not-found'`: HTTP 404 ismert not-found kód nélkül
   * (isUnverifiedNotFound). Útvonalhiba is lehet, ezért a pénztár nem zár le
   * és nem indít második fizetést; a lezárás az order-poll dolga.
   */
  mappedState: OrderPaymentState | 'unavailable' | 'not-found' | 'unverified-not-found' | null
  nowMs: number
  windowMs: number
}): PendingCheckoutDecision {
  const paymentId =
    typeof input.barionPaymentId === 'string' && input.barionPaymentId.trim().length > 0
      ? input.barionPaymentId.trim()
      : null

  const createdMs = input.createdAt ? Date.parse(input.createdAt) : Number.NaN
  const insideWindow = Number.isNaN(createdMs) || input.nowMs - createdMs <= input.windowMs
  const minutesLeft = minutesLeftInWindow(input.createdAt, input.nowMs, input.windowMs)

  if (paymentId === null) {
    return insideWindow
      ? { kind: 'wait-no-payment-id', minutesLeft }
      : { kind: 'cancel-and-restart' }
  }

  if (input.mappedState === 'unavailable' || input.mappedState === null) {
    return { kind: 'barion-unavailable' }
  }
  if (input.mappedState === 'unverified-not-found') {
    return { kind: 'unverified-not-found' }
  }
  if (input.mappedState === 'not-found') {
    return insideWindow ? { kind: 'wait-not-found', minutesLeft } : { kind: 'cancel-and-restart' }
  }
  if (input.mappedState === 'paid') {
    return { kind: 'already-paid' }
  }
  if (input.mappedState === 'payment_pending') {
    return { kind: 'resume', paymentId }
  }
  return { kind: 'cancel-and-restart' }
}

/**
 * Az új checkout-kérés adatai, amelyekkel egy függő fizetés folytatható.
 */
export interface PendingResumeExpectation {
  /** A MOST fizetendő ár (Ft), a szerver számolja; ismeretlen ár esetén null. */
  priceHuf: number | null
  buyerName: string | null
  billing: {
    name: string
    zip: string
    city: string
    street: string
    taxNumber: string | null
  }
}

function snapshotString(snapshot: Record<string, unknown>, key: string): string | null {
  const value = snapshot[key]
  return typeof value === 'string' ? value : null
}

/**
 * Folytatható-e a függő fizetés a MOSTANI kéréssel.
 *
 * A folytatás a régi Barion-fizetésre küldi a vevőt, a régi rendelés
 * ár- és számlázási snapshotjával. Ez csak akkor helyes, ha a kettő egyezik a
 * mostani kéréssel:
 * - az ár: az akció a két kérés között indulhatott vagy járhatott le, és a
 *   vevő nem fizethet mást, mint amit most a pénztárban lát;
 * - a vevő neve és a számlázási adatok: a számla a rendelés snapshotjából
 *   készül. E nélkül bárki indíthatna vendégként rendelést más e-mail-címével
 *   és a saját számlázási adataival, és a cím valódi gazdája ebbe a rendelésbe
 *   futna bele, a számla pedig idegen névre szólna.
 *
 * Eltérésnél a hívó a régi függő rendelést lezárja, és új fizetést indít
 * (ugyanaz az ág, mint a lejárt vagy megszakadt fizetésnél).
 */
export function pendingOrderMatchesRequest(
  order: { totalHufSnapshot?: number | null; customerSnapshot?: unknown },
  expected: PendingResumeExpectation,
): boolean {
  if (expected.priceHuf === null || order.totalHufSnapshot !== expected.priceHuf) {
    return false
  }
  const snapshot = order.customerSnapshot
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return false
  }
  const record = snapshot as Record<string, unknown>
  const taxNumber = record.taxNumber
  return (
    snapshotString(record, 'name') === expected.buyerName &&
    snapshotString(record, 'billingName') === expected.billing.name &&
    snapshotString(record, 'billingZip') === expected.billing.zip &&
    snapshotString(record, 'billingCity') === expected.billing.city &&
    snapshotString(record, 'billingStreet') === expected.billing.street &&
    (taxNumber === undefined ? null : taxNumber) === expected.billing.taxNumber
  )
}
