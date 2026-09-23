import { describe, expect, it } from 'vitest'
import {
  courseEditorialChecklist,
  lessonsDetail,
  PRICE_TAB_LABEL,
} from '../components/admin/course-editorial-checklist'
import { formatPriceHuf } from '../lib/format-price'

describe('editorial readiness, never a publication gate', () => {
  it('reports missing content without treating absent price as free', () => {
    const summary = courseEditorialChecklist({ priceInHUFEnabled: true })
    expect(summary.items.find((item) => item.key === 'price')?.ready).toBe(false)
    expect(summary.items.find((item) => item.key === 'title')?.ready).toBe(false)
    expect(summary.lessonCount).toBe(0)
  })
  it('uses the original curriculum precedence, including empty-module fallback', () => {
    const videos = [
      { id: 'old', title: 'Korabbi', status: 'ready' as const, streamAssetId: 'hidden' },
    ]
    expect(
      courseEditorialChecklist({ modules: [{ title: 'Empty', lessons: [] }], videos }).source,
    ).toBe('legacy')
    const source = {
      modules: [{ title: 'New', lessons: [{ id: 'new', title: 'New', kind: 'video' as const }] }],
      videos,
    }
    const before = JSON.stringify(source)
    const summary = courseEditorialChecklist(source)
    expect(summary.source).toBe('modules')
    expect(summary.hiddenLegacyCount).toBe(1)
    expect(summary.lessonCount).toBe(1)
    expect(summary.pendingVideoCount).toBe(1)
    expect(JSON.stringify(source)).toBe(before)
    expect(JSON.stringify(summary)).not.toContain('hidden"')
  })
  it('does not equate editorial completeness with publication', () => {
    const summary = courseEditorialChecklist({
      sku: 'Existing title',
      priceInHUFEnabled: false,
      category: 2,
      status: 'draft',
    })
    expect(summary.items.find((item) => item.key === 'title')?.ready).toBe(true)
    expect(summary.items.find((item) => item.key === 'price')?.detail).toContain('Ingyenes')
    expect(summary).not.toHaveProperty('canPublish')
  })
})

describe('K42: köznyelvi sorok, az Árazás az akció állapotát mutatja', () => {
  const NOW = new Date('2026-09-22T10:00:00Z')
  const paid = {
    sku: 'Kurzus',
    category: 2,
    priceInHUFEnabled: true,
    priceInHUF: 79_500,
  }

  it('a Tananyag sora: „N lecke, ebből M videó még nem kész.”', () => {
    expect(lessonsDetail(0, 0, 0)).toBe('Még nincs lecke.')
    expect(lessonsDetail(12, 5, 2)).toBe('12 lecke, ebből 2 videó még nem kész.')
    expect(lessonsDetail(12, 5, 0)).toBe('12 lecke, minden videó kész.')
    expect(lessonsDetail(10, 0, 0)).toBe('10 lecke, videó nélkül.')
    const summary = courseEditorialChecklist({})
    expect(summary.items.find((item) => item.key === 'lessons')?.detail).toBe('Még nincs lecke.')
  })

  it('akció nélkül és élő akcióban is kimondja az akció állapotát', () => {
    const price = (product: Record<string, unknown>) =>
      courseEditorialChecklist({ ...paid, ...product }, NOW).items.find(
        (item) => item.key === 'price',
      )!
    expect(price({}).detail).toBe('Ár megadva. Akció: nincs.')
    expect(price({ promoEnabled: true, promoPriceHuf: 49_900 }).detail).toBe(
      `Ár megadva. Akció: most él, a vásárló ${formatPriceHuf(49_900)}-ot fizet.`,
    )
    expect(price({ promoEnabled: true, promoStart: '2026-10-01T12:00:00.000Z' }).detail).toBe(
      'Ár megadva. Akció: még nem kezdődött el.',
    )
    expect(price({ promoEnabled: true, promoEnd: '2026-09-01T12:00:00.000Z' }).detail).toBe(
      'Ár megadva. Akció: lejárt.',
    )
    const invalid = price({ promoEnabled: true, promoPriceHuf: 99_000 })
    expect(invalid.ready).toBe(false)
    expect(invalid.detail).toBe('Ár megadva. Akció: az akciós ár nem kisebb a rendes árnál.')
    expect(price({}).tab).toBe(PRICE_TAB_LABEL)
    expect(PRICE_TAB_LABEL).toBe('Ár és hozzáférés')
  })

  it('a sorokban nincs gondolatjel és verzál szó', () => {
    const texts = courseEditorialChecklist(
      { ...paid, promoEnabled: true, promoPriceHuf: 49_900 },
      NOW,
    ).items.flatMap((item) => [item.label, item.detail])
    for (const text of texts) {
      expect(text).not.toMatch(/[–—"]/)
      expect(text).not.toMatch(/\b[A-ZÁÉÍÓÖŐÚÜŰ]{2,}\b/u)
    }
  })
})
