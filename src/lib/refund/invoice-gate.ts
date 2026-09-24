import type { Order } from '../../payload-types'

/**
 * Tulajdonosi visszatérítés csak kiállított számla után (K12, a-refund-3).
 *
 * A számlát a paid-átmenet után egy 5 percenkénti job állítja ki
 * (src/lib/order-paid.ts, jobs/tasks/invoice-issue.ts), és csak akkor, ha a
 * háttérfeladatok futnak (ENABLE_JOB_WORKERS). Ha a visszatérítés
 * ezt megelőzi, a teljes visszatérítés után a rendelés 'refunded' lesz, a
 * számlajob pedig a nem paid rendelést kihagyja: a teljesített eladás sosem
 * kap számlát, és stornó sem készülhet hozzá. Ezért bekapcsolt számlázásnál a
 * tulajdonosi visszatérítés addig nem indulhat, amíg a számla nincs kiállítva.
 *
 * Csak a tulajdonosi (paid rendelésre induló) visszatérítésre vonatkozik: a
 * soha ki nem fizetett rendelés automatikus visszatérítése (paid-reject,
 * dupla vásárlás) nem jár számlával, ott a kapu nem érvényes.
 *
 * Tiszta modul: a számlázás be/ki állapotát a hívó adja (isSzamlazzEnabled),
 * így a kliens-panel és a szerver ugyanabból a szabályból ugyanazt mondja
 * (WCAG 2.2 SC 3.2.4 Consistent Identification).
 */

export type RefundInvoiceGate = { reason: 'pending' | 'failed'; message: string }

/**
 * A tulajdonosnak szóló szövegek: mi történt, mi a teendő (GOV.UK Error
 * message: „say what has happened and how to fix it”,
 * https://design-system.service.gov.uk/components/error-message/; NN/g,
 * Error-Message Guidelines: „offer … remedies”,
 * https://www.nngroup.com/articles/error-message-guidelines/). A panel ezt a
 * beviteli mező helyén mutatja, a szerver a 409-es válaszban (ott a „Pénzmozgás
 * nem történt.” mondattal). A szöveg nem ígéri, hogy a számla elkészül, mert
 * az a háttérfeladatokon múlik: időkorlátot és teendőt ad helyette.
 */
export const INVOICE_PENDING_MESSAGE =
  'A számla még nem készült el, ezért a visszatérítés még nem indítható. Néhány perc múlva frissítsd az oldalt, és próbáld újra. Ha egy óra múlva is ezt látod, jelezd az üzemeltetőnek a rendelésszámmal együtt.'
export const INVOICE_FAILED_MESSAGE =
  'A számla kiállítása nem sikerült, ezért a visszatérítés nem indítható, amíg a számla el nem készül. Jelezd az üzemeltetőnek a rendelésszámmal együtt.'

/**
 * Null, ha a visszatérítés a számla felől indítható: a számlázás ki van
 * kapcsolva, vagy a rendelésen kiállított számla áll (invoiceStatus 'issued'
 * és nem üres invoiceNumber). A 'failed' végleges kézi eset; minden más
 * (none, pending, hiányzó szám) a job következő futására vár.
 */
export function refundInvoiceGate(
  order: Pick<Order, 'invoiceStatus' | 'invoiceNumber'>,
  invoicingEnabled: boolean,
): RefundInvoiceGate | null {
  if (!invoicingEnabled) return null
  const number = typeof order.invoiceNumber === 'string' ? order.invoiceNumber.trim() : ''
  if (order.invoiceStatus === 'issued' && number.length > 0) return null
  if (order.invoiceStatus === 'failed') return { reason: 'failed', message: INVOICE_FAILED_MESSAGE }
  return { reason: 'pending', message: INVOICE_PENDING_MESSAGE }
}
