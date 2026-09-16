import { expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import type { AdminViewServerProps } from 'payload'

const template = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }))
vi.mock('@payloadcms/next/templates', () => ({
  DefaultTemplate: (props: Record<string, unknown> & { children: ReactNode }) => {
    template.props = props
    if (!props.req) throw new Error('Payload DefaultNav getNavPrefs requires req')
    return props.children
  },
}))
import { AdminChrome } from '../components/admin/AdminChrome'

it('forwards the initialized request to DefaultTemplate and its navigation preferences', () => {
  const req = { user: { id: 1, role: 'staff' }, payload: {} }
  const props = {
    initPageResult: { req, permissions: {}, visibleEntities: { collections: [], globals: [] } },
    params: {},
    searchParams: {},
  } as unknown as AdminViewServerProps
  expect(renderToStaticMarkup(<AdminChrome props={props}>Videótár</AdminChrome>)).toContain(
    'Videótár',
  )
  expect(template.props?.req).toBe(req)
})
