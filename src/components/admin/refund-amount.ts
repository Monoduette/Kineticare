import { formatPriceHuf } from '../../lib/format-price'

/**
 * A visszatérítés-panel TISZTA (mellékhatásmentes) segédfüggvényei.
 * Külön modulban élnek a kliens-komponenstől, hogy egységtesztelhetők
 * legyenek (a RefundPanel.tsx a @payloadcms/ui hookjait importálja, ami
 * node-környezetű tesztben nem tölthető be).
 * FONTOS: ez KIZÁRÓLAG kényelmi, kliensoldali előszűrés. A forrás-igazság a
 * szerver (src/lib/refund/refund-order.ts), amely ugyanezeket a szabályokat
 * újra ellenőrzi; a panel semmilyen pénzügyi döntést nem hoz.
 */

/** Az összeg-mező kiértékelésének eredménye. */
export type RefundAmountCheck =
  | {
      ok: true
      /** null = a teljes (maradék) összeg — a kérés törzse ilyenkor üres. */
      amountHuf: number | null
    }
  | { ok: false; message: string }

const NUMERIC_PATTERN = /^[+-]?\d+([.,]\d+)?$/

const NOT_A_NUMBER_MESSAGE = 'Az összeg csak szám lehet (forintban, tizedesjegy nélkül).'

/**
 * Az összeg-mező validálása.
 *
 * - üres mező → teljes visszatérítés (amountHuf: null),
 * - nem szám → magyar hibaüzenet,
 * - tizedes / 0 / negatív → magyar hibaüzenet,
 * - a rendelés végösszegénél nagyobb → magyar hibaüzenet.
 *
 * A magyar gyakorlat szerint gépelt ezres tagolást elfogadja: „19 990"
 * ugyanaz, mint „19990" (a JS `\s` osztálya a nem-törhető szóközt is lefedi).
 */
export function validateRefundAmount(raw: string, maxHuf: number | null): RefundAmountCheck {
  const normalized = raw.replace(/\s/g, '')
  if (normalized.length === 0) {
    return { ok: true, amountHuf: null }
  }
  if (!NUMERIC_PATTERN.test(normalized)) {
    return { ok: false, message: NOT_A_NUMBER_MESSAGE }
  }
  const parsed = Number(normalized.replace(',', '.'))
  if (!Number.isFinite(parsed)) {
    return { ok: false, message: NOT_A_NUMBER_MESSAGE }
  }
  if (!Number.isInteger(parsed)) {
    return { ok: false, message: 'Az összeg csak egész forintösszeg lehet, tizedesjegy nélkül.' }
  }
  if (parsed <= 0) {
    return { ok: false, message: 'Az összegnek nullánál nagyobbnak kell lennie.' }
  }
  if (maxHuf !== null && maxHuf > 0 && parsed > maxHuf) {
    return {
      ok: false,
      message: `Az összeg nem haladhatja meg a rendelés végösszegét (${formatPriceHuf(maxHuf)}).`,
    }
  }
  return { ok: true, amountHuf: parsed }
}

/**
 * Miért NEM téríthető vissza a rendelés? — rövid, magyar magyarázat.
 *
 * `null` = visszatéríthető (paid státusz). A státusz-lista az orders
 * állapotgépét tükrözi (src/plugins/ecommerce.ts).
 */
export function refundBlockedReason(status: string | null): string | null {
  switch (status) {
    case 'paid':
      return null
    case 'refunded':
      return 'A rendelésen már teljes visszatérítés van rögzítve. Itt új visszatérítés nem indítható.'
    case 'created':
    case 'payment_pending':
      return 'A rendelés még nincs kifizetve, ezért nincs mit visszatéríteni.'
    case 'payment_failed':
      return 'A fizetés nem sikerült, ezért nincs mit visszatéríteni.'
    case 'cancelled':
      return 'A rendelés le lett mondva, ezért nincs mit visszatéríteni.'
    default:
      // K12: a nyers „paid” kód helyett a státusz magyar neve (NN/g, Match
      // between the system and the real world).
      return 'Csak kifizetett rendelés téríthető vissza.'
  }
}

/** A megerősítő ablak szövege (a @payloadcms/ui ConfirmationModal tartalma). */
export interface RefundConfirmText {
  heading: string
  /** A következmény konkrétan: melyik rendelés, mennyi jár vissza, kinek. */
  detail: string
  /** A visszavonhatatlanság kimondása, külön mondatban. */
  warning: string
}

export const REFUND_IRREVERSIBLE_SENTENCE = 'A visszatérítés nem vonható vissza.'

/**
 * A megerősítő ablak szövege rendelésszámmal és összeggel.
 *
 * NN/g, Confirmation Dialogs: „Be specific and inform users about the
 * consequence of their action. Do not ask Are you sure you want to do this?”
 * (https://www.nngroup.com/articles/confirmation-dialog/). A rendelésszám
 * névelő nélkül, a mondat elején áll, így nem kell az azonosító kiejtése
 * szerint „a” vagy „az” névelőt választani. Teljes visszatérítésnél összeget nem írunk: egy korábbi
 * részleges visszatérítés után a szerver a még vissza nem térített részt
 * utalja, amit a kliens nem tud biztosan.
 */
export function refundConfirmText(
  orderNumber: string,
  amountHuf: number | null,
): RefundConfirmText {
  return {
    heading: 'Visszatéríted az összeget?',
    detail:
      amountHuf === null
        ? `${orderNumber} rendelés: a még vissza nem térített teljes összeg visszajár a vásárlónak a Barionon keresztül.`
        : `${orderNumber} rendelés: ${formatPriceHuf(amountHuf)} jár vissza a vásárlónak a Barionon keresztül.`,
    warning: REFUND_IRREVERSIBLE_SENTENCE,
  }
}
