const UNKNOWN_LOCAL = 'Nincs értékelhető helyi nyom; a pénzmozgás ebből nem állapítható meg.'
const UNKNOWN_PROVIDER = 'Nincs értékelhető mentett eredmény; szolgáltatói ellenőrzés szükséges.'

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
  if (outcomes.size > 1) return 'Vegyes mentett eredmények; ellenőrzés szükséges.'
  if (outcomes.has('succeeded'))
    return 'A megjeleníthető bejegyzésekben sikeres eredmény van mentve.'
  if (outcomes.has('failed')) return 'Elutasítás van mentve; szolgáltatói ellenőrzés szükséges.'
  return 'A mentett eredmény nem igazolja a visszatérítés sikerét; ellenőrzés szükséges.'
}

export function readRefundOperationalStatus(data: unknown) {
  const record = isRecord(data) ? data : {}
  const history = record.refunds
  const entries = Array.isArray(history) ? Array.from(history) : []
  const missing = history == null || (Array.isArray(history) && entries.length === 0)
  const validHistory = entries.every(isSavedEntry)
  const malformed = !missing && (!Array.isArray(history) || !validHistory)
  const local = malformed
    ? 'A helyi visszatérítési nyom hiányos vagy nem értelmezhető.'
    : record.status === 'refunded'
      ? 'Teljes visszatérítés van helyben rögzítve.'
      : !missing
        ? 'Visszatérítési bejegyzés van helyben rögzítve.'
        : UNKNOWN_LOCAL
  const provider =
    !missing && !malformed && validHistory ? providerLabel(entries) : UNKNOWN_PROVIDER
  return [
    { key: 'local', label: 'Helyi visszatérítési nyom', value: local },
    { key: 'provider', label: 'Mentett szolgáltatói eredmény', value: provider },
    {
      key: 'storno',
      label: 'Stornó mentett állapota',
      value: invoiceLabel(
        record.stornoStatus,
        STORNO_LABELS,
        'Nincs értékelhető mentett stornóállapot.',
      ),
    },
    {
      key: 'corrective',
      label: 'Legutóbbi helyesbítő mentett állapota',
      value: invoiceLabel(
        record.correctiveInvoiceStatus,
        CORRECTIVE_LABELS,
        'Nincs értékelhető mentett helyesbítőállapot.',
      ),
    },
    {
      key: 'cleanup',
      label: 'Hozzáférések rendezése',
      value: 'A mentett rendelésadatokból nem igazolható.',
    },
  ]
}
