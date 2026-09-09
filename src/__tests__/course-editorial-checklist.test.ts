import { describe, expect, it } from 'vitest'
import { courseEditorialChecklist } from '../components/admin/course-editorial-checklist'

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
