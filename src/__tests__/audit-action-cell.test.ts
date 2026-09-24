import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

/**
 * A Műveletnapló magyar feliratai (src/components/admin/AuditActionCell.tsx,
 * K39). A lista és a szerkesztőnézet ugyanazt a térképet használja; ismeretlen
 * kódnál a nyers érték marad. A Payload `useFormFields` hookját stub adja.
 */

const formFields = vi.hoisted(() => ({ state: {} as Record<string, { value: unknown }> }))
vi.mock('@payloadcms/ui', () => ({
  useFormFields: (selector: (state: [Record<string, { value: unknown }>]) => unknown) =>
    selector([formFields.state]),
}))

const {
  AUDIT_ACTION_LABELS,
  AUDIT_EMPTY_LABEL,
  AUDIT_ENTITY_LABELS,
  AuditActionCell,
  AuditActionDescription,
  AuditEntityTypeCell,
  AuditEntityTypeDescription,
  auditActionLabel,
  auditEntityLabel,
  auditMeaningText,
} = await import('../components/admin/AuditActionCell')

describe('auditActionLabel', () => {
  it('a repó minden ismert műveletkódját magyarul mutatja', () => {
    expect(auditActionLabel('publish')).toBe('Közzététel')
    expect(auditActionLabel('create')).toBe('Létrehozás')
    expect(auditActionLabel('delete')).toBe('Törlés')
    expect(auditActionLabel('grant-purchase')).toBe('Hozzáférés kézi megadása')
    expect(auditActionLabel('customer-import.legacy-purchase')).toBe('Régi vásárlás átvétele')
    expect(auditActionLabel('order-partial-refund')).toBe('Részleges visszatérítés')
    expect(auditActionLabel('refund-invoice-done')).toBe('Stornó vagy helyesbítő számla kiállítása')
    expect(auditActionLabel('order-confirmation-email')).toBe('Visszaigazoló e-mail elküldése')
  })

  it('a vesszővel összefűzött kódot tagonként fordítja, a második tagtól kisbetűvel', () => {
    expect(auditActionLabel('publish,purchase-change')).toBe(
      'Közzététel, megvásárolt kurzusok módosítása',
    )
    expect(auditActionLabel(' create , role-change ')).toBe('Létrehozás, szerepkör módosítása')
  })

  it('ismeretlen kódnál a nyers érték marad, üresnél kimondott szöveg áll', () => {
    expect(auditActionLabel('uj-muvelet.v2')).toBe('uj-muvelet.v2')
    expect(auditActionLabel('publish,uj-muvelet')).toBe('Közzététel, uj-muvelet')
    expect(auditActionLabel(null)).toBe(AUDIT_EMPTY_LABEL)
    expect(auditActionLabel('  ')).toBe(AUDIT_EMPTY_LABEL)
    expect(auditActionLabel(',')).toBe(AUDIT_EMPTY_LABEL)
    expect(auditActionLabel(42)).toBe(AUDIT_EMPTY_LABEL)
  })

  it('a kódlista lefedi a forráskódban írt összes műveletet', async () => {
    const { RECEIPTS } = await import('../lib/refund/recovery-receipts')
    const { MEDIA_RECOVERY_ACTION } = await import('../lib/media-recovery-provenance')
    const { LEGACY_PURCHASE_AUDIT_ACTION } = await import('../lib/customer-import/execute')
    const { ORDER_CONFIRMATION_AUDIT_ACTION } = await import('../lib/order-paid')
    const codes = [
      ...Object.values(RECEIPTS),
      MEDIA_RECOVERY_ACTION,
      LEGACY_PURCHASE_AUDIT_ACTION,
      ORDER_CONFIRMATION_AUDIT_ACTION,
      'order-refund',
      'order-partial-refund',
      'grant-purchase',
      'create',
      'publish',
      'delete',
      'refund-update',
      'role-change',
      'purchase-change',
    ]
    for (const code of codes) expect(AUDIT_ACTION_LABELS[code], code).toBeDefined()
  })
})

describe('auditEntityLabel', () => {
  it('a collection-slugot a magyar egyes számú címkével mutatja', () => {
    expect(auditEntityLabel('pages')).toBe('Oldal')
    expect(auditEntityLabel('products')).toBe('Kurzus')
    expect(auditEntityLabel('orders')).toBe('Rendelés')
    expect(auditEntityLabel('refund-intents')).toBe('Visszatérítési szándék')
    expect(auditEntityLabel('ismeretlen')).toBe('ismeretlen')
    expect(auditEntityLabel(undefined)).toBe(AUDIT_EMPTY_LABEL)
  })
})

describe('cellák és szerkesztőnézet', () => {
  it('a cellák a magyar feliratot rajzolják', () => {
    expect(renderToStaticMarkup(createElement(AuditActionCell, { cellData: 'publish' }))).toBe(
      '<span>Közzététel</span>',
    )
    expect(renderToStaticMarkup(createElement(AuditEntityTypeCell, { cellData: 'pages' }))).toBe(
      '<span>Oldal</span>',
    )
  })

  it('a megnyitott bejegyzés mezője alatt ugyanaz a jelentés áll, ismeretlen kódnál semmi', () => {
    formFields.state = { action: { value: 'publish' }, entityType: { value: 'ismeretlen' } }
    expect(renderToStaticMarkup(createElement(AuditActionDescription, { path: 'action' }))).toBe(
      '<div class="field-description">Jelentése: Közzététel</div>',
    )
    expect(
      renderToStaticMarkup(createElement(AuditEntityTypeDescription, { path: 'entityType' })),
    ).toBe('')
    expect(auditMeaningText('pages', 'entity')).toBe('Jelentése: Oldal')
    expect(auditMeaningText('', 'action')).toBeNull()
  })

  it('a feliratokban nincs gondolatjel, verzál szó vagy hibás idézőjel', () => {
    const texts = [
      ...Object.values(AUDIT_ACTION_LABELS),
      ...Object.values(AUDIT_ENTITY_LABELS),
      AUDIT_EMPTY_LABEL,
    ]
    for (const text of texts) {
      expect(text).not.toMatch(/[–—"]/)
      expect(text).not.toMatch(/(?<![\p{L}])[A-ZÁÉÍÓÖŐÚÜŰ]{3,}(?![\p{L}])/u)
    }
  })
})
