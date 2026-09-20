import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Menus } from '../collections/Menus'
import { buildMenuPublicUrl } from '../lib/menu-public-url'

/**
 * A „Rejtett link" doboz (src/components/admin/MenuUnlistedLink.tsx) és a
 * Menus collection mezőszerkezetének őre.
 *
 * DOM nélkül futunk: a nézetet `renderToStaticMarkup` adja (a bunny-library-
 * panel.test.tsx mintája), az állapot-levezetés tiszta függvény. A Payload
 * hookokat mockoljuk; a `fetch` hangosan dob, mert tesztből hálózati hívás
 * SOSEM mehet ki (CLAUDE.md, 15. üzemeltetési tanulság).
 */

const formFields: Record<string, { value: unknown }> = {}
let documentId: number | undefined

vi.mock('@payloadcms/ui', () => ({
  useDocumentInfo: () => ({ id: documentId }),
  useFormFields: (selector: (state: [Record<string, { value: unknown }>]) => unknown) =>
    selector([formFields]),
}))

vi.stubGlobal('fetch', () => {
  throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const {
  COPIED_LABEL,
  COPY_FAILED_MESSAGE,
  COPY_LABEL,
  DRAFT_TARGET_WARNING,
  LOAD_FAILED_MESSAGE,
  MenuUnlistedLink,
  MenuUnlistedLinkView,
  NO_TARGET_MESSAGE,
  SAVE_FIRST_MESSAGE,
  deriveMenuUnlistedLinkState,
  targetApiPath,
} = await import('../components/admin/MenuUnlistedLink')

const ORIGIN = 'https://kineticare.hu'

type ViewProps = Parameters<typeof MenuUnlistedLinkView>[0]

function renderView(props: Partial<ViewProps> & Pick<ViewProps, 'state'>): string {
  return renderToStaticMarkup(
    createElement(MenuUnlistedLinkView, {
      copied: false,
      copyError: null,
      onCopy: () => {},
      ...props,
    }),
  )
}

describe('deriveMenuUnlistedLinkState', () => {
  it('feloldhatatlan cél: mentetlen dokumentumnál „Mentés után…", mentettnél cél-kérés', () => {
    expect(deriveMenuUnlistedLinkState(null, false, null, ORIGIN)).toEqual({ kind: 'save-first' })
    expect(deriveMenuUnlistedLinkState(null, true, null, ORIGIN)).toEqual({ kind: 'no-target' })
  })

  it('kész feloldás átmegy változatlanul', () => {
    const resolved = buildMenuPublicUrl({ type: 'url', url: '/kapcsolat' }, ORIGIN)
    expect(deriveMenuUnlistedLinkState(resolved, true, null, ORIGIN)).toEqual({
      kind: 'ready',
      absoluteUrl: 'https://kineticare.hu/kapcsolat',
      targetPublished: null,
    })
  })

  it('csak azonosítós ref: betöltésig loading, más kulcsú betöltés nem számít', () => {
    const resolved = buildMenuPublicUrl(
      { type: 'page', ref: { relationTo: 'pages', value: 10 } },
      ORIGIN,
    )
    expect(deriveMenuUnlistedLinkState(resolved, true, null, ORIGIN)).toEqual({ kind: 'loading' })
    expect(
      deriveMenuUnlistedLinkState(resolved, true, { key: 'pages/99', doc: { id: 99 } }, ORIGIN),
    ).toEqual({ kind: 'loading' })
  })

  it('betöltött cél: a link a cél slugjából épül, a piszkozat jelződik', () => {
    const resolved = buildMenuPublicUrl(
      { type: 'product', ref: { relationTo: 'products', value: 7 } },
      ORIGIN,
    )
    const draft = { id: 7, slug: 'kez-torna', status: 'draft' }
    expect(
      deriveMenuUnlistedLinkState(resolved, true, { key: 'products/7', doc: draft }, ORIGIN),
    ).toEqual({
      kind: 'ready',
      absoluteUrl: 'https://kineticare.hu/kurzusok/kez-torna',
      targetPublished: false,
    })
  })

  it('sikertelen betöltés: load-failed', () => {
    const resolved = buildMenuPublicUrl(
      { type: 'post', ref: { relationTo: 'posts', value: 5 } },
      ORIGIN,
    )
    expect(
      deriveMenuUnlistedLinkState(resolved, true, { key: 'posts/5', doc: null }, ORIGIN),
    ).toEqual({ kind: 'load-failed' })
  })

  it('a cél REST-útvonala depth 0-val, kódolt azonosítóval', () => {
    expect(targetApiPath('pages/10')).toBe('/api/pages/10?depth=0')
    expect(targetApiPath('products/a/b')).toBe('/api/products/a%2Fb?depth=0')
  })
})

describe('MenuUnlistedLinkView', () => {
  it('kész link: csak-olvasható mező az abszolút címmel és „Másolás" gomb', () => {
    const html = renderView({
      state: { kind: 'ready', absoluteUrl: 'https://kineticare.hu/rolunk', targetPublished: true },
    })
    expect(html).toMatch(/readonly/i)
    expect(html).toContain('value="https://kineticare.hu/rolunk"')
    expect(html).toContain(`>${COPY_LABEL}<`)
    expect(html).not.toContain(DRAFT_TARGET_WARNING)
  })

  it('piszkozat cél: figyelmeztetés, hogy a link 404-et ad a közzétételig', () => {
    const html = renderView({
      state: { kind: 'ready', absoluteUrl: 'https://kineticare.hu/vazlat', targetPublished: false },
    })
    expect(html).toContain('role="alert"')
    expect(html).toContain(DRAFT_TARGET_WARNING)
  })

  it('másolás után „Kimásolva", hibánál a kézi másolásra irányító üzenet', () => {
    const state = {
      kind: 'ready',
      absoluteUrl: 'https://kineticare.hu/x',
      targetPublished: null,
    } as const
    expect(renderView({ state, copied: true })).toContain(`>${COPIED_LABEL}<`)
    expect(renderView({ state, copyError: COPY_FAILED_MESSAGE })).toContain(COPY_FAILED_MESSAGE)
  })

  it('a nem kész állapotok a magyar üzenetüket mutatják, gomb nélkül', () => {
    expect(renderView({ state: { kind: 'save-first' } })).toContain(SAVE_FIRST_MESSAGE)
    expect(renderView({ state: { kind: 'no-target' } })).toContain(NO_TARGET_MESSAGE)
    expect(renderView({ state: { kind: 'load-failed' } })).toContain(LOAD_FAILED_MESSAGE)
    expect(renderView({ state: { kind: 'save-first' } })).not.toContain('<button')
  })

  it('a felületi szövegekben nincs gondolatjel (tulajdonosi kikötés)', () => {
    for (const text of [
      SAVE_FIRST_MESSAGE,
      NO_TARGET_MESSAGE,
      LOAD_FAILED_MESSAGE,
      DRAFT_TARGET_WARNING,
      COPY_FAILED_MESSAGE,
    ]) {
      expect(text).not.toMatch(/[–—]/)
    }
  })
})

describe('MenuUnlistedLink (konténer, SSR)', () => {
  it('külső link típusnál hálózat nélkül, azonnal a kész linket adja', () => {
    formFields.type = { value: 'url' }
    formFields.url = { value: '/kapcsolat' }
    formFields.ref = { value: null }
    documentId = 3
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://kineticare.hu/')
    const html = renderToStaticMarkup(createElement(MenuUnlistedLink))
    expect(html).toContain('value="https://kineticare.hu/kapcsolat"')
  })

  it('mentetlen menüpont cél nélkül: „Mentés után itt jelenik meg a link."', () => {
    formFields.type = { value: 'page' }
    formFields.url = { value: null }
    formFields.ref = { value: null }
    documentId = undefined
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://kineticare.hu')
    const html = renderToStaticMarkup(createElement(MenuUnlistedLink))
    expect(html).toContain(SAVE_FIRST_MESSAGE)
  })
})

describe('Menus collection: a „Rejtett link" mezők', () => {
  const fieldByName = (name: string) =>
    Menus.fields.find((field) => 'name' in field && field.name === name)

  it('az unlisted checkbox létezik, alapból hamis, és listaoszlop', () => {
    const unlisted = fieldByName('unlisted')
    expect(unlisted?.type).toBe('checkbox')
    expect(unlisted && 'defaultValue' in unlisted ? unlisted.defaultValue : undefined).toBe(false)
    expect(Menus.admin?.defaultColumns).toContain('unlisted')
  })

  it('a link-doboz ui-mező, a saját komponensére mutat, és csak unlisted mellett látszik', () => {
    const panel = fieldByName('unlistedLinkPanel')
    expect(panel?.type).toBe('ui')
    expect(panel?.admin?.components?.Field).toBe(
      '/components/admin/MenuUnlistedLink#MenuUnlistedLink',
    )
    const condition = panel?.admin?.condition
    expect(typeof condition).toBe('function')
    const call = (siblingData: Record<string, unknown>) =>
      (condition as (data: unknown, sibling: unknown, ctx: unknown) => boolean)({}, siblingData, {})
    expect(call({ unlisted: true })).toBe(true)
    expect(call({ unlisted: false })).toBe(false)
    expect(call({})).toBe(false)
  })

  it('az unlisted a visible UTÁN és az openInNewTab ELŐTT áll', () => {
    const names = Menus.fields.map((field) => ('name' in field ? field.name : ''))
    expect(names.indexOf('unlisted')).toBe(names.indexOf('visible') + 1)
    expect(names.indexOf('openInNewTab')).toBe(names.indexOf('unlistedLinkPanel') + 1)
  })
})
