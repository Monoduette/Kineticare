/**
 * A rendelésen MENTETT visszatérítési adatok felolvasása a Visszatérítés
 * panelnek (src/components/admin/RefundPanel.tsx). Csak megjelenítés: pénzügyi
 * vagy helyreállítási döntést nem hoz, és ismeretlen, hiányos adatnál sem
 * állít többet, mint amit a mentett adat igazol.
 *
 * K12 (admin-audit): a címkék köznyelviek („Barion visszaigazolása” a
 * „Mentett szolgáltatói eredmény” helyett), mert az admin a munkatárs
 * nyelvén beszéljen (NN/g, Match between the system and the real world:
 * https://www.nngroup.com/articles/match-system-real-world/; Atlassian,
 * Warning messages: „Avoid jargon and use simple language”,
 * https://atlassian.design/foundations/content/designing-messages/warning-messages).
 */

const UNKNOWN_LOCAL =
  'Nincs mentett visszatérítési bejegyzés; a pénzmozgás ebből nem állapítható meg.'
const UNKNOWN_PROVIDER = 'Nincs mentett Barion-válasz; ellenőrizd a Barion felületén.'

const STORNO_LABELS: Readonly<Record<string, string>> = {
  none: 'Nincs mentett stornóeredmény; a szükségesség ebből nem állapítható meg.',
  pending: 'Függőben lévő stornó van rögzítve.',
  storned: 'Kiállított stornó van rögzítve.',
  failed: 'Sikertelen stornókísérlet van rögzítve.',
}

const CORRECTIVE_LABELS: Readonly<Record<string, string>> = {
  none: 'Nincs mentett helyesbítőeredmény.',
  pending: 'A legutóbbi helyesbítő függőben van a mentett állapot szerint.',
  issued:
    'A legutóbbi helyesbítő kiállítása van rögzítve; a korábbiak állapota ebből nem állapítható meg.',
  failed: 'A legutóbbi helyesbítő sikertelen kísérlete van rögzítve.',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

// Validate the persisted entry shape without calculating any refund or recovery decision.
function isSavedEntry(value: unknown): value is Record<string, unknown> & { status: string } {
  return (
    isRecord(value) &&
    nonEmptyString(value.transactionId) &&
    typeof value.amountHuf === 'number' &&
    Number.isSafeInteger(value.amountHuf) &&
    value.amountHuf > 0 &&
    nonEmptyString(value.status) &&
    nonEmptyString(value.refundedAt) &&
    Number.isFinite(Date.parse(value.refundedAt)) &&
    (value.type === 'full' || value.type === 'partial')
  )
}

function invoiceLabel(
  value: unknown,
  labels: Readonly<Record<string, string>>,
  fallback: string,
): string {
  return typeof value === 'string' && Object.hasOwn(labels, value) ? labels[value] : fallback
}

function providerLabel(entries: Array<{ status: string }>): string {
  // Same saved status vocabulary as refund-order.ts, without importing its server integrations.
  const outcomes = new Set(
    entries.map(({ status }) => {
      if (status === 'Succeeded' || status === 'Refunded' || status === 'PartiallyRefunded')
        return 'succeeded'
      return status === 'RefundFailed' ? 'failed' : 'unknown'
    }),
  )
  if (outcomes.size > 1)
    return 'A mentett Barion-válaszok eltérnek egymástól; ellenőrizd a Barion felületén.'
  if (outcomes.has('succeeded'))
    return 'A Barion a mentett bejegyzésekben sikeres visszatérítést jelzett.'
  if (outcomes.has('failed')) return 'A Barion elutasítást jelzett; ellenőrizd a Barion felületén.'
  return 'A mentett Barion-válasz nem igazolja a visszatérítés sikerét; ellenőrizd a Barion felületén.'
}

/** A számlaállapot „nincs” alapértéke vagy hiánya: ezen a rendelésen nem volt ilyen számla. */
function noInvoice(value: unknown): boolean {
  return value === undefined || value === null || value === 'none'
}

/**
 * Van-e a rendelésen BÁRMILYEN mentett visszatérítési vagy számla-utóélet?
 *
 * K12: ha nincs, a panel az öt soros állapotlista helyett egyetlen mondatot
 * mutat („Ezen a rendelésen még nem volt visszatérítés.”). Hibabiztos:
 * minden ismeretlen, hiányos vagy nem szabványos érték „van adat”-nak
 * számít, és a részletes lista jelenik meg, így a panel sosem rejt el egy
 * értelmezhetetlen mentett állapotot.
 */
export function hasRefundHistory(data: unknown): boolean {
  if (!isRecord(data)) return false
  const history = data.refunds
  const noHistory =
    history === undefined || history === null || (Array.isArray(history) && history.length === 0)
  return (
    !noHistory ||
    data.status === 'refunded' ||
    !noInvoice(data.stornoStatus) ||
    !noInvoice(data.correctiveInvoiceStatus)
  )
}

export function readRefundOperationalStatus(data: unknown) {
  const record = isRecord(data) ? data : {}
  const history = record.refunds
  const entries = Array.isArray(history) ? Array.from(history) : []
  const missing = history == null || (Array.isArray(history) && entries.length === 0)
  const validHistory = entries.every(isSavedEntry)
  const malformed = !missing && (!Array.isArray(history) || !validHistory)
  const local = malformed
    ? 'A mentett visszatérítési adat hiányos vagy nem értelmezhető.'
    : record.status === 'refunded'
      ? 'Teljes visszatérítés van rögzítve a rendelésen.'
      : !missing
        ? 'Visszatérítési bejegyzés van rögzítve a rendelésen.'
        : UNKNOWN_LOCAL
  const provider =
    !missing && !malformed && validHistory ? providerLabel(entries) : UNKNOWN_PROVIDER
  return [
    { key: 'local', label: 'Visszatérítés a rendelésen', value: local },
    { key: 'provider', label: 'Barion visszaigazolása', value: provider },
    {
      key: 'storno',
      label: 'Stornószámla',
      value: invoiceLabel(
        record.stornoStatus,
        STORNO_LABELS,
        'Nincs értékelhető mentett stornószámla-állapot.',
      ),
    },
    {
      key: 'corrective',
      label: 'Legutóbbi helyesbítő számla',
      value: invoiceLabel(
        record.correctiveInvoiceStatus,
        CORRECTIVE_LABELS,
        'Nincs értékelhető mentett helyesbítőszámla-állapot.',
      ),
    },
    {
      key: 'cleanup',
      label: 'Hozzáférések rendezése',
      value: 'A mentett rendelésadatokból nem igazolható.',
    },
  ]
}
