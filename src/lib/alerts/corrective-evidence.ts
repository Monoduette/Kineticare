/**
 * Visszatérítésenkénti helyesbítő-bizonyíték: EGY szabály a „Figyelmet
 * igényel” hiányzó-helyesbítő számolásának (`src/lib/alerts/attention.ts`) és
 * az alanyi adómentes keret becslésének (`src/lib/alerts/aam.ts`).
 *
 * MI KELL HELYESBÍTŐT: a részleges bejegyzés, és a rendelést lezáró, nem első
 * teljes bejegyzés (refund-order.ts: „részrefund és záró rész: helyesbítő”);
 * az első, teljes visszatérítés stornót kap, azt a `stornoStatus` kezeli.
 *
 * BIZONYÍTÉK sorszámonként (1-alapú, a `refunds` indexe + 1), a pillanatnyi
 * `correctiveInvoiceStatus` NÉLKÜL (az a legutóbbi kísérletet mutatja: egy
 * későbbi sorszám sikeres helyesbítője `issued`-ra írja, egy későbbi
 * sikertelen pedig `failed`-re, a korábbi, már kiállt bizonylatot viszont
 * egyik sem vonja vissza):
 *  - a tárolt (`correctiveInvoiceSeq`, `correctiveInvoiceNumber`) pár, amely
 *    KIZÁRÓLAG a `refunds[seq - 1]` bejegyzést igazolja.
 *    src/lib/szamlazz/corrective.ts a számot és a sorszámot csak a sikeres
 *    kiállítás ágain írja, egy mentésben, csak `refundSeq >= recordedSeq`
 *    mellett, és sosem törli; a mezők rendszer-írásúak. A pár tehát a
 *    legnagyobb kiállt sorszámot mutatja: egy korábbi sorszám későbbi
 *    újrapróbálása nem írja át, és a pár mindig csak EGY bejegyzést igazol;
 *  - az adott sorszámú, `committed` visszatérítési szándék. A kézi lezárás
 *    (src/lib/refund/refund-recovery.ts) csak akkor ír `committed`-et, ha a
 *    változtathatatlan `refund-invoice-done` nyugta száma egyezik a
 *    rendelésen akkor tárolt, a SAJÁT sorszámára szóló, `issued` állapotú
 *    párral (`invoiceRecorded`). Az automatikus lezárás
 *    (auto-refund-recovery.ts) soha ki nem fizetett, számla nélküli
 *    rendelésen fut, ott helyesbítő nem is lehet.
 */

/** A lezárt szándékok lekérdezéséhez kért mezők. */
export const COMMITTED_INTENT_SELECT = { order: true, refundSequence: true } as const

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Relációs mező azonosítója (depth: 0 → szám vagy szöveg; populálva → `{ id }`). */
export function relationKey(value: unknown): string | null {
  const id = asRecord(value)?.id ?? value
  return typeof id === 'number' || (typeof id === 'string' && id !== '') ? String(id) : null
}

/** Helyesbítő kell-e a `sequence` sorszámú visszatérítéshez. */
export function refundNeedsCorrective(
  entry: Readonly<Record<string, unknown>>,
  sequence: number,
): boolean {
  return entry.type === 'partial' || (entry.type === 'full' && sequence > 1)
}

/** A bizonyítékhoz olvasott rendelésmezők (a Payload `select`-jéből, nyersen). */
export interface CorrectiveEvidenceOrder {
  readonly refunds?: unknown
  readonly correctiveInvoiceSeq?: unknown
  readonly correctiveInvoiceNumber?: unknown
}

/** A tárolt pár sorszáma, ha a pár teljes (szám és érvényes sorszám), különben `null`. */
export function correctivePairSequence(order: CorrectiveEvidenceOrder): number | null {
  const number = order.correctiveInvoiceNumber
  const seq = order.correctiveInvoiceSeq
  return typeof number === 'string' &&
    number.trim() !== '' &&
    typeof seq === 'number' &&
    Number.isSafeInteger(seq) &&
    seq >= 1
    ? seq
    : null
}

/** Egy helyesbítőt igénylő visszatérítés sorszáma a hozzá tartozó bejegyzéssel. */
export interface CorrectiveRefund {
  readonly sequence: number
  readonly entry: Readonly<Record<string, unknown>>
  /** Igaz, ha a helyesbítő kiállítását a pár vagy egy lezárt szándék igazolja. */
  readonly evidenced: boolean
}

/**
 * A rendelés helyesbítőt igénylő visszatérítései, mindegyikhez a bizonyíték
 * megléte. A `committedSequences` a rendelés `committed` szándékainak
 * sorszámai (`committedSequencesByOrder`).
 */
export function correctiveRefunds(
  order: CorrectiveEvidenceOrder,
  committedSequences: ReadonlySet<number>,
): CorrectiveRefund[] {
  if (!Array.isArray(order.refunds)) {
    return []
  }
  const pairSeq = correctivePairSequence(order)
  const result: CorrectiveRefund[] = []
  order.refunds.forEach((value: unknown, index: number) => {
    const entry = asRecord(value)
    const sequence = index + 1
    if (entry === null || !refundNeedsCorrective(entry, sequence)) {
      return
    }
    result.push({
      sequence,
      entry,
      evidenced: sequence === pairSeq || committedSequences.has(sequence),
    })
  })
  return result
}

/**
 * A `committed` szándékok sorszámai rendelésenként (a kulcs a rendelés
 * azonosítója szövegként, lásd `relationKey`). A nem értelmezhető sor
 * kimarad: bizonyíték hiányában a hívók a biztonságos irányba tévednek.
 */
export function committedSequencesByOrder(intents: readonly unknown[]): Map<string, Set<number>> {
  const byOrder = new Map<string, Set<number>>()
  for (const doc of intents) {
    const intent = asRecord(doc)
    const orderKey = relationKey(intent?.order)
    const sequence = intent?.refundSequence
    if (orderKey === null || typeof sequence !== 'number') {
      continue
    }
    const sequences = byOrder.get(orderKey) ?? new Set<number>()
    sequences.add(sequence)
    byOrder.set(orderKey, sequences)
  }
  return byOrder
}
