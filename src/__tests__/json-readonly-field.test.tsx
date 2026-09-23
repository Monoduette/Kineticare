import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

/**
 * A csak olvasható JSON-nézet (src/components/admin/JsonReadOnlyField.tsx, K01)
 * őre. DOM nélkül, `renderToStaticMarkup`-pal; a Payload hookjait és címke-,
 * leíráskomponensét egyszerű stubok helyettesítik (course-promo-status.test.tsx
 * mintája). Hálózat nincs.
 */

const formState = vi.hoisted(() => ({ value: undefined as unknown, path: 'customerSnapshot' }))

vi.mock('@payloadcms/ui', () => ({
  FieldLabel: ({ label, as }: { label?: unknown; as?: string }) =>
    createElement(as ?? 'label', { className: 'field-label' }, String(label ?? '')),
  FieldDescription: ({ description }: { description?: unknown }) =>
    createElement('div', { className: 'field-description' }, String(description ?? '')),
  useField: () => ({ path: formState.path, value: formState.value }),
  useTranslation: () => ({ i18n: { language: 'hu', fallbackLanguage: 'hu', t: (k: string) => k } }),
}))

const {
  JSON_EMPTY_TEXT,
  JsonReadOnlyField,
  formatJsonForDisplay,
  jsonFieldDomId,
  jsonFieldLabelText,
} = await import('../components/admin/JsonReadOnlyField')

type FieldProps = Parameters<typeof JsonReadOnlyField>[0]

function render(value: unknown, field: Record<string, unknown> = {}): string {
  formState.value = value
  const props = {
    field: {
      name: 'customerSnapshot',
      type: 'json',
      label: 'Vásárlói adatok a megrendeléskor',
      admin: { description: 'A számlázási adatok mentett másolata.' },
      ...field,
    },
    path: 'customerSnapshot',
  } as unknown as FieldProps
  return renderToStaticMarkup(createElement(JsonReadOnlyField, props))
}

describe('formatJsonForDisplay', () => {
  it('két szóközzel behúzott JSON-t ad, a szerkezet megmarad', () => {
    expect(formatJsonForDisplay({ name: 'Demó Vásárló', items: [1, 2] })).toBe(
      '{\n  "name": "Demó Vásárló",\n  "items": [\n    1,\n    2\n  ]\n}',
    )
  })

  it('üres érték: null, üres szöveg, üres lista és üres objektum egyaránt üres', () => {
    for (const value of [null, undefined, '', '   ', [], {}]) {
      expect(formatJsonForDisplay(value)).toBeNull()
    }
  })

  it('szöveges és primitív értéket is megjelenít, és sosem dob', () => {
    expect(formatJsonForDisplay('nyers szöveg')).toBe('nyers szöveg')
    expect(formatJsonForDisplay(0)).toBe('0')
    expect(formatJsonForDisplay(false)).toBe('false')
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => formatJsonForDisplay(circular)).not.toThrow()
  })
})

describe('JsonReadOnlyField', () => {
  it('billentyűvel elérhető, megnevezett, görgethető régió (axe scrollable-region-focusable)', () => {
    const html = render({ name: 'Demó Vásárló', email: 'demo@example.com' })
    const id = jsonFieldDomId('customerSnapshot')
    expect(html).toContain(`<pre aria-describedby="${id}-leiras" aria-labelledby="${id}-cimke"`)
    expect(html).toContain('role="region"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain(
      `<span id="${id}-cimke"><span class="field-label">Vásárlói adatok a megrendeléskor</span></span>`,
    )
    expect(html).toContain(`<div id="${id}-leiras"><div class="field-description">`)
    expect(html).toContain('&quot;name&quot;: &quot;Demó Vásárló&quot;')
  })

  it('a doboz sortör (320 px-en sincs vízszintes görgetés), 14 px, a téma szövegszínével', () => {
    const html = render({ a: 'x'.repeat(400) })
    expect(html).toContain('white-space:pre-wrap')
    expect(html).toContain('overflow-wrap:anywhere')
    expect(html).toContain('max-height:24rem')
    expect(html).toContain('overflow:auto')
    expect(html).toContain('font-size:14px')
    expect(html).toContain('color:var(--theme-elevation-800)')
  })

  it('üres értéknél kimondott magyar mondat áll, és nincs fölösleges tabulálási pont', () => {
    const html = render(null)
    expect(html).toContain(JSON_EMPTY_TEXT)
    expect(JSON_EMPTY_TEXT).toBe('Nincs mentett adat.')
    expect(html).not.toContain('tabindex')
    expect(html).not.toContain('role="region"')
  })

  it('leírás nélkül nincs aria-describedby, címke nélkül a mező neve a név', () => {
    const html = render({ a: 1 }, { label: undefined, admin: {} })
    expect(html).not.toContain('aria-describedby')
    expect(html).toContain('>customerSnapshot</span>')
    expect(jsonFieldLabelText(undefined, 'payload', (l) => String(l))).toBe('payload')
    expect(jsonFieldLabelText('  ', 'payload', (l) => String(l))).toBe('payload')
    expect(jsonFieldLabelText('Előtte', 'before', (l) => String(l))).toBe('Előtte')
  })

  it('a DOM-azonosító beágyazott útvonalból is érvényes', () => {
    expect(jsonFieldDomId('modules.0.payload')).toBe('kc-json-modules-0-payload')
  })

  it('a felhasználói szövegben nincs gondolatjel (docs/ui-sztenderdek.md §3.1)', () => {
    expect(JSON_EMPTY_TEXT).not.toMatch(/[–—]/)
  })
})
