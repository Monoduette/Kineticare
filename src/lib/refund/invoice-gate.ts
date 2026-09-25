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
 *
 * A 'failed' szöveg (W1B-3, W1B-7) nem biztat várakozásra: a leállt
 * automatikus kiállítás magától nem indul újra. A teendők sorrendje a
 * kettős NAV-számla ellen véd: a 'failed' állapotban a számla sokszor MÁR
 * LÉTEZIK (71/152-es duplikátumjelzés, elveszett válasz, kimerült kísérletek
 * után az invoice.ts maga is azt írja, hogy kézi kiállítás előtt meg kell
 * keresni; a korábbi 05-ös útmutató szerint kézzel kiállított számla mellett
 * is 'failed' maradt a rendelés). Ezért az első lépés a keresés a
 * Számlázz.hu-ban, és csak ha nincs meg, jön a kézi kiállítás (05-ös útmutató,
 * 1. és 2. pont), végül az üzemeltető rögzíti a számot
 * (`npm run record:manual-invoice`, src/lib/szamlazz/manual-invoice-record.ts),
 * amitől a kapu kinyílik. GOV.UK Error message: „tell them what to do”; NN/g
 * Error-Message Guidelines: „Offer constructive advice”, ne csak a hibát
 * mondja. A felirat legyen igaz (termektervezes skill): feltétel nélküli
 * „állítsd ki” utasítás a már létező számla mellé második számlát íratna. A
 * 14 napos mondat a 45/2014. (II. 26.) Korm. rendelet 23. § (1) bekezdésének
 * visszafizetési határidejére figyelmeztet.
 */
export const INVOICE_PENDING_MESSAGE =
  'A számla még nem készült el, ezért a visszatérítés még nem indítható. Néhány perc múlva frissítsd az oldalt, és próbáld újra. Ha egy óra múlva is ezt látod, jelezd az üzemeltetőnek a rendelésszámmal együtt.'
export const INVOICE_FAILED_MESSAGE =
  'A számla automatikus kiállítása nem sikerült, ezért a visszatérítés most nem indítható. Előbb keress rá a rendelésszámra a Számlázz.hu-ban: ha a számla ott megvan, ne állíts ki újat. Ha nincs meg, állítsd ki kézzel a 05-ös útmutató szerint. Ezután kérd meg az üzemeltetőt, hogy rögzítse a számla számát a rendelésen, és a visszatérítés innen indítható. Ha a vevő elállt a vásárlástól, még aznap szólj az üzemeltetőnek, mert a visszafizetésre 14 nap van.'

/**
 * Null, ha a visszatérítés a számla felől indítható: a számlázás ki van
 * kapcsolva, vagy a rendelésen kiállított számla áll (invoiceStatus 'issued'
 * és nem üres invoiceNumber). A 'failed' kézi rendezést kér: a Számlázz.hu-ban
 * megtalált, vagy ha nincs meg, kézzel kiállított számla számát az
 * üzemeltető rögzíti (manual-invoice-record.ts), az 'issued' lesz, és a kapu
 * magától kinyílik, így a visszatérítés a valódi számlához készít stornót
 * vagy helyesbítőt.
 * A 'failed' visszaállítása 'pending'-re szándékosan nincs: a leállt vagy
 * kézzel pótolt számla mellé egy újabb automatikus beküldés dupla NAV-számla
 * lenne (invoice.ts, INVOICE_AUTOMATION_STOPPED). Minden más (none, pending,
 * hiányzó szám) a job következő futására vár.
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
