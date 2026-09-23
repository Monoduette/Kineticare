import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * „Megvásárolt kurzusok (áttekintés)” panel, K39: a régi vásárlások időpontja a
 * csak tulajdonosnak olvasható Műveletnaplóban áll. Munkatársat nem küldünk
 * oda, hanem megmondjuk, ki látja; a tulajdonos szűrt linket kap. A napló
 * hozzáférése nem változik (csak megjelenítés). DOM és hálózat nélkül, a
 * Payload-hookok mockolva.
 */

const ui = vi.hoisted(() => ({
  role: 'staff',
  purchases: [] as unknown[],
}))

vi.mock('@payloadcms/ui', () => ({
  useAuth: () => ({ user: { id: 1, role: ui.role } }),
  useDocumentInfo: () => ({ id: 3 }),
  useFormFields: (selector: (state: [Record<string, { value: unknown }>]) => unknown) =>
    selector([{ purchases: { value: ui.purchases } }]),
}))

vi.mock('../components/admin/course-titles-client', () => ({
  loadCourseTitles: () => new Promise(() => {}),
}))

const { LEGACY_PURCHASES_STAFF_NOTE, PurchasesOverviewPanel, legacyPurchasesAuditHref } =
  await import('../components/admin/PurchasesOverviewPanel')
// Kötésteszt: a Műveletnapló-link műveletkódja a forrásmodul konstansa, nem
// kézzel másolt szöveg, különben a két hely csendben elsodródhatna.
const { LEGACY_PURCHASE_AUDIT_ACTION } = await import('../lib/customer-import/execute')

beforeEach(() => {
  ui.role = 'staff'
  ui.purchases = []
})

describe('PurchasesOverviewPanel (K39)', () => {
  it('munkatársnak megmondja, hogy a régi vásárlásokat a tulajdonos látja, link nélkül', () => {
    ui.purchases = [2]
    const html = renderToStaticMarkup(createElement(PurchasesOverviewPanel))
    expect(LEGACY_PURCHASES_STAFF_NOTE).toBe(
      'A régi vásárlások időpontját a tulajdonos a Műveletnaplóban látja.',
    )
    expect(html).toContain(LEGACY_PURCHASES_STAFF_NOTE)
    expect(html).not.toContain('audit-logs')
    expect(html).not.toContain(LEGACY_PURCHASE_AUDIT_ACTION)
  })

  it('a tulajdonos a felhasználóra szűrt Műveletnapló-linket kapja', () => {
    ui.role = 'owner'
    ui.purchases = [2]
    const html = renderToStaticMarkup(createElement(PurchasesOverviewPanel))
    expect(html).toContain('a Műveletnaplóban, erre a felhasználóra szűrve')
    expect(html).toContain(legacyPurchasesAuditHref(3).replaceAll('&', '&amp;'))
    const params = new URL(legacyPurchasesAuditHref(3), 'http://localhost').searchParams
    expect(params.get('where[and][0][action][equals]')).toBe(LEGACY_PURCHASE_AUDIT_ACTION)
    expect(params.get('where[and][2][entityId][equals]')).toBe('3')
  })

  it('a link műveletkódja az import forrásmodul konstansa (elsodródás elleni kötés)', () => {
    const params = new URL(legacyPurchasesAuditHref(42), 'http://localhost').searchParams
    expect(LEGACY_PURCHASE_AUDIT_ACTION).toBe('customer-import.legacy-purchase')
    expect(params.get('where[and][0][action][equals]')).toBe(LEGACY_PURCHASE_AUDIT_ACTION)
    expect(params.get('where[and][2][entityId][equals]')).toBe('42')
  })

  it('üres listánál a valódi utat mondja: a lenti ajándékozó panelt', () => {
    const html = renderToStaticMarkup(createElement(PurchasesOverviewPanel))
    expect(html).toContain('„Kurzus ajándékozása” panellel adhatsz neki')
    expect(html).not.toContain('„Megvásárolt kurzusok” mezőben')
  })

  it('a szövegekben nincs gondolatjel és nyers műveletkód', () => {
    for (const role of ['staff', 'owner']) {
      ui.role = role
      ui.purchases = [2]
      const text = renderToStaticMarkup(createElement(PurchasesOverviewPanel)).replace(
        /<[^>]+>/g,
        ' ',
      )
      expect(text).not.toMatch(/[–—]/)
      expect(text).not.toContain('systeme.io')
    }
  })
})
