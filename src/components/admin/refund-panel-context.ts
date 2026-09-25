/**
 * A visszatérítés-panel rendelés-összefüggésének TISZTA segédfüggvényei
 * (a GET /api/admin/orders/[orderNumber]/refund `panel` kulcsa,
 * src/lib/refund/panel-context.ts). Külön modulban, hogy node-környezetben
 * tesztelhetők legyenek (a RefundPanel.tsx a @payloadcms/ui hookjait
 * importálja). A panel ebből semmilyen pénzügyi döntést nem hoz: a szerver a
 * visszatérítés indításakor mindent újra ellenőriz.
 */

export interface RefundPanelInfo {
  /** Miért nem indítható most visszatérítés a számla felől; null, ha indítható. */
  refundGate: string | null
  /** A fizetés napja YYYY-MM-DD alakban (Europe/Budapest), vagy null. */
  paidDate: string | null
  daysSincePayment: number | null
}

export const EMPTY_REFUND_PANEL_INFO: RefundPanelInfo = {
  refundGate: null,
  paidDate: null,
  daysSincePayment: null,
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A válasz `panel` kulcsának szűkítése. Minden hibás vagy hiányzó mező null:
 * a panel ilyenkor egyszerűen nem mutatja az adott tényt.
 */
export function parseRefundPanelInfo(body: unknown): RefundPanelInfo {
  const panel = isRecord(body) && isRecord(body.panel) ? body.panel : null
  if (!panel) return EMPTY_REFUND_PANEL_INFO
  const gate =
    typeof panel.refundGate === 'string' && panel.refundGate.trim() ? panel.refundGate : null
  const paidDate =
    typeof panel.paidDate === 'string' && ISO_DATE.test(panel.paidDate) ? panel.paidDate : null
  const days =
    paidDate !== null &&
    typeof panel.daysSincePayment === 'number' &&
    Number.isSafeInteger(panel.daysSincePayment) &&
    panel.daysSincePayment >= 0
      ? panel.daysSincePayment
      : null
  return { refundGate: gate, paidDate, daysSincePayment: days }
}

/**
 * A fizetés napja és az azóta eltelt napok egy mondatban, például
 * „A fizetés napja: 2026. 09. 05. (19 napja).” A panel csak a tényt mondja
 * ki; hogy a visszatérítés garanciális-e, azt a tulajdonos dönti el (K3).
 * A dátum alakja ugyanaz, mint a vevői visszatérítési értesítőé
 * (src/lib/email/templates/refund.ts).
 */
export function refundPaymentAgeText(info: RefundPanelInfo): string | null {
  const match = info.paidDate ? ISO_DATE.exec(info.paidDate) : null
  if (!match) return null
  const date = `${match[1]}. ${match[2]}. ${match[3]}.`
  if (info.daysSincePayment === null) return `A fizetés napja: ${date}`
  const age = info.daysSincePayment === 0 ? 'ma' : `${info.daysSincePayment} napja`
  return `A fizetés napja: ${date} (${age}).`
}
