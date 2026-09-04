import { describe, expect, it } from 'vitest'

import { readRefundOperationalStatus } from '../components/admin/refund-operational-status'

function entry(overrides: Record<string, unknown> = {}) {
  return {
    transactionId: 'SYNTHETIC-REFUND',
    amountHuf: 5000,
    status: 'Refunded',
    refundedAt: '2026-09-04T00:00:00.000Z',
    type: 'partial',
    ...overrides,
  }
}

function values(data: unknown) {
  return Object.fromEntries(readRefundOperationalStatus(data).map(({ key, value }) => [key, value]))
}

describe('saved refund operational status, presentation only', () => {
  it.each([undefined, null, false, 3, 'refunded', [], {}].map((data) => ({ data })))(
    'uses honest unknown labels for absent/malformed data: $data',
    ({ data }) => {
      const result = values(data)
      expect(result.local).toContain('a pénzmozgás ebből nem állapítható meg')
      expect(result.provider).toContain('szolgáltatói ellenőrzés szükséges')
      expect(result.storno).toContain('Nincs értékelhető')
      expect(result.corrective).toContain('Nincs értékelhető')
    },
  )

  it.each([undefined, null, []].map((refunds) => ({ refunds })))(
    'does not turn refunded plus missing history into provider confirmation: $refunds',
    ({ refunds }) => {
      const result = values({ status: 'refunded', refunds })
      expect(result.local).toBe('Teljes visszatérítés van helyben rögzítve.')
      expect(result.provider).toContain('Nincs értékelhető mentett eredmény')
      expect(JSON.stringify(result)).not.toContain('hozzáférések rendezve')
    },
  )

  it.each(['Succeeded', 'Refunded', 'PartiallyRefunded'])(
    'labels a saved supported result without claiming recovery: %s',
    (status) => {
      const result = values({ status: 'paid', refunds: [entry({ status })] })
      expect(result.local).toBe('Visszatérítési bejegyzés van helyben rögzítve.')
      expect(result.provider).toBe('A megjeleníthető bejegyzésekben sikeres eredmény van mentve.')
    },
  )

  it.each(['Unknown', 'Created', 'unrecognised', '', null, 7])(
    'does not confirm unknown or malformed saved provider values: %j',
    (status) => {
      expect(values({ refunds: [entry({ status })] }).provider).toContain('ellenőrzés szükséges')
    },
  )

  it('labels a saved rejection without inferring that no money moved', () => {
    expect(values({ refunds: [entry({ status: 'RefundFailed' })] }).provider).toBe(
      'Elutasítás van mentve; szolgáltatói ellenőrzés szükséges.',
    )
  })

  it.each(
    [
      [entry({ status: 'Unknown' }), entry()],
      [entry(), entry({ status: 'Unknown' })],
      [entry({ status: 'RefundFailed' }), entry()],
    ].map((refunds) => ({ refunds })),
  )('does not hide a mixed history behind its latest entry', ({ refunds }) => {
    expect(values({ refunds }).provider).toBe('Vegyes mentett eredmények; ellenőrzés szükséges.')
  })

  it.each(
    [
      {},
      'not-an-array',
      [null],
      [entry(), {}],
      [entry({ transactionId: undefined })],
      [entry({ amountHuf: NaN })],
      [entry({ amountHuf: -1 })],
      [entry({ refundedAt: 'not-a-date' })],
      [entry({ type: 'other' })],
    ].map((refunds) => ({ refunds })),
  )('keeps malformed history uncertain: $refunds', ({ refunds }) => {
    const result = values({ status: 'refunded', refunds })
    expect(result.local).toBe('A helyi visszatérítési nyom hiányos vagy nem értelmezhető.')
    expect(result.provider).toContain('ellenőrzés szükséges')
  })

  it.each([
    ['none', 'Nincs mentett stornóeredmény; a szükségesség ebből nem állapítható meg.'],
    ['pending', 'Függőben lévő stornó van rögzítve.'],
    ['storned', 'Kiállított stornó van rögzítve.'],
    ['failed', 'Sikertelen stornókísérlet van rögzítve.'],
  ])('shows only the saved storno state: %s', (stornoStatus, expected) => {
    expect(values({ stornoStatus }).storno).toBe(expected)
  })

  it.each([
    ['none', 'Nincs mentett helyesbítőeredmény.'],
    ['pending', 'A legutóbbi helyesbítő függőben van a mentett állapot szerint.'],
    [
      'issued',
      'A legutóbbi helyesbítő kiállítása van rögzítve; a korábbiak állapota ebből nem állapítható meg.',
    ],
    ['failed', 'A legutóbbi helyesbítő sikertelen kísérlete van rögzítve.'],
  ])(
    'limits corrective invoice wording to the latest result: %s',
    (correctiveInvoiceStatus, expected) => {
      expect(values({ correctiveInvoiceStatus }).corrective).toBe(expected)
    },
  )

  it.each([null, 8, {}, 'toString', '__proto__', 'issued-but-unrecognised'])(
    'fails closed for unknown invoice states: %j',
    (status) => {
      const result = values({ stornoStatus: status, correctiveInvoiceStatus: status })
      expect(result.storno).toContain('Nincs értékelhető')
      expect(result.corrective).toContain('Nincs értékelhető')
    },
  )

  it('does not require storno after a partial and closing full refund', () => {
    const result = values({
      status: 'refunded',
      refunds: [entry(), entry({ type: 'full' })],
      stornoStatus: 'none',
      correctiveInvoiceStatus: 'issued',
      correctiveInvoiceSeq: 2,
    })
    expect(result.local).toContain('Teljes visszatérítés van helyben rögzítve')
    expect(result.storno).toContain('a szükségesség ebből nem állapítható meg')
    expect(result.corrective).toContain('a korábbiak állapota ebből nem állapítható meg')
  })

  it('keeps multiple invoice outcomes independent', () => {
    const result = values({ stornoStatus: 'failed', correctiveInvoiceStatus: 'issued' })
    expect(result.storno).toContain('Sikertelen')
    expect(result.corrective).toContain('legutóbbi')
    expect(result.corrective).toContain('a korábbiak állapota ebből nem állapítható meg')
  })

  it.each(
    [
      undefined,
      {},
      { refunds: [null] },
      {
        status: 'refunded',
        refunds: [entry({ type: 'full' })],
        stornoStatus: 'storned',
        correctiveInvoiceStatus: 'issued',
      },
      {
        refunds: [entry({ status: 'RefundFailed' })],
        stornoStatus: 'failed',
        correctiveInvoiceStatus: 'failed',
      },
    ].map((data) => ({ data })),
  )(
    'never derives access cleanup success or failure from saved order outcomes: $data',
    ({ data }) => {
      expect(readRefundOperationalStatus(data).find(({ key }) => key === 'cleanup')).toEqual({
        key: 'cleanup',
        label: 'Hozzáférések rendezése',
        value: 'A mentett rendelésadatokból nem igazolható.',
      })
    },
  )

  it('returns only fixed labels, without echoing private or untrusted fields', () => {
    const canary = 'SYNTHETIC-PRIVATE-CANARY'
    const data = {
      status: 'refunded',
      id: canary,
      orderNumber: canary,
      refundReason: canary,
      customerSnapshot: { name: canary, email: canary },
      refunds: [
        entry({ transactionId: canary, reason: canary, status: canary, amountHuf: 987654321 }),
      ],
      stornoStatus: canary,
      stornoNumber: canary,
      stornoLastError: canary,
      correctiveInvoiceStatus: canary,
      correctiveInvoiceNumber: canary,
      correctiveInvoiceLastError: canary,
    }
    const before = JSON.stringify(data)
    const result = readRefundOperationalStatus(data)
    expect(result.map(({ label }) => label)).toEqual([
      'Helyi visszatérítési nyom',
      'Mentett szolgáltatói eredmény',
      'Stornó mentett állapota',
      'Legutóbbi helyesbítő mentett állapota',
      'Hozzáférések rendezése',
    ])
    expect(JSON.stringify(result)).not.toContain(canary)
    expect(JSON.stringify(result)).not.toContain('987654321')
    expect(JSON.stringify(data)).toBe(before)
  })
})
