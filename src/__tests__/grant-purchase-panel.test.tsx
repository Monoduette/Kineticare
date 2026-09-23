import { Window } from 'happy-dom'
import { act, createElement, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * „Kurzus ajándékozása” panel (src/components/admin/GrantPurchasePanel.tsx),
 * K12: a kurzuslista a kurzus címét mutatja, a natív mezők a
 * .kc-admin-input osztályt kapják, a kitöltési példa súgó (nem placeholder),
 * a hiba a mezőhöz kötött, és a megerősítés a Payload ConfirmationModal-ja.
 * A végpont és a kérés törzse változatlan. Hálózat nincs: a `fetch` injektált
 * mock, a nem várt kérés hangosan dob (CLAUDE.md, 15. tanulság).
 */

interface ModalProps {
  heading: ReactNode
  body: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  modalSlug: string
  onConfirm: () => Promise<void> | void
  onCancel?: () => void
}

const ui = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  user: { id: 1, role: 'staff' } as { id: number; role: string },
  refresh: vi.fn(),
  modal: undefined as ModalProps | undefined,
  opened: [] as string[],
  closeModal: vi.fn<(slug: string) => void>(),
}))

vi.mock('@payloadcms/ui', () => ({
  useDocumentInfo: () => ({ data: ui.data, isInitializing: false }),
  useAuth: () => ({ user: ui.user }),
  useRouteCache: () => ({ clearRouteCache: ui.refresh }),
  useModal: () => ({
    closeModal: ui.closeModal,
    isModalOpen: () => false,
    openModal: (slug: string) => {
      ui.opened.push(slug)
    },
  }),
  ConfirmationModal: (props: ModalProps) => {
    ui.modal = props
    return null
  },
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode
    disabled?: boolean
    onClick: () => void
  }) => createElement('button', { disabled, onClick, type: 'button' }, children),
}))

const {
  GRANT_CONFIRM_MODAL_SLUG,
  GRANT_IRREVERSIBLE_SENTENCE,
  GrantPurchasePanel,
  PRODUCT_REQUIRED_MESSAGE,
  REASON_REQUIRED_MESSAGE,
  grantConfirmDetail,
  readProductOptions,
} = await import('../components/admin/GrantPurchasePanel')

const EMAIL = 'szintetikus.vasarlo@example.invalid'
const PRODUCTS = {
  docs: [
    { id: 5, sku: 'SKU-AKCIOS', displayTitle: 'Otthoni KézRehab Program, akciós' },
    { id: 3, sku: 'SOS Kézrelax villámkurzus', displayTitle: null },
    { id: 2, sku: 'OTTHONI-001', displayTitle: '  Otthoni KézRehab Program  ' },
    { id: 9, sku: '', displayTitle: '' },
  ],
}

const fetchMock = vi.fn<typeof fetch>()
let window: Window
let container: HTMLDivElement
let root: Root

function buttonByText(text: string) {
  const element = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent === text,
  )
  if (!element) throw new Error(`Expected button: ${text}`)
  return element
}

async function click(text: string) {
  await act(async () => {
    buttonByText(text).click()
  })
}

async function openPanel() {
  await click('Kurzus ajándékozása')
}

async function choose(productValue: string, reason: string) {
  const select = container.querySelector('select') as unknown as HTMLSelectElement
  const textarea = container.querySelector('textarea') as unknown as HTMLTextAreaElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!.call(
      select,
      productValue,
    )
    select.dispatchEvent(new window.Event('change', { bubbles: true }) as unknown as Event)
  })
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(
      textarea,
      reason,
    )
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }) as unknown as Event)
  })
}

beforeEach(async () => {
  ui.data = { email: EMAIL }
  ui.user = { id: 1, role: 'staff' }
  ui.refresh.mockReset()
  ui.modal = undefined
  ui.opened = []
  ui.closeModal.mockReset()
  fetchMock.mockReset().mockImplementation(async (url) => {
    if (String(url).startsWith('/api/products?')) return Response.json(PRODUCTS)
    throw new Error(`Unexpected request in grant panel test: ${String(url)}`)
  })
  window = new Window({ url: 'http://localhost:3000' })
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  vi.stubGlobal('navigator', window.navigator)
  vi.stubGlobal('HTMLElement', window.HTMLElement)
  vi.stubGlobal('Event', window.Event)
  vi.stubGlobal('MouseEvent', window.MouseEvent)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(window, 'confirm', {
    value: () => {
      throw new Error('window.confirm must not be used by the grant panel')
    },
  })
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root.render(createElement(GrantPurchasePanel))
  })
})

afterEach(async () => {
  try {
    await act(async () => {
      root?.unmount()
    })
    container?.remove()
    await window.happyDOM.close()
  } finally {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})

describe('readProductOptions: a kurzus címe, nem a belső azonosító', () => {
  it('displayTitle az elsődleges felirat, üresen a sku, végül az azonosító; magyar ábécérendben', () => {
    expect(readProductOptions(PRODUCTS)).toEqual([
      { value: '9', label: '#9' },
      { value: '2', label: 'Otthoni KézRehab Program' },
      { value: '5', label: 'Otthoni KézRehab Program, akciós' },
      { value: '3', label: 'SOS Kézrelax villámkurzus' },
    ])
  })

  it('hibás válaszból üres listát ad', () => {
    for (const body of [null, 'x', {}, { docs: 'x' }, { docs: [null, { id: {} }] }]) {
      expect(readProductOptions(body)).toEqual([])
    }
  })
})

/** Egy opciólistában nincs két, trim és kisbetűsítés után azonos felirat. */
function expectDistinctLabels(options: { label: string }[]) {
  const keys = options.map((option) => option.label.trim().toLocaleLowerCase('hu'))
  expect(new Set(keys).size).toBe(keys.length)
}

describe('readProductOptions: azonos feliratok összetéveszthetetlenül (visszavonhatatlan művelet)', () => {
  it('két azonos displayTitle: mindkettő a belső azonosítóját kapja, kis- és nagybetűtől függetlenül', () => {
    const options = readProductOptions({
      docs: [
        { id: 11, sku: 'OTTHONI-2025', displayTitle: 'Otthoni KézRehab Program' },
        { id: 12, sku: 'OTTHONI-2026', displayTitle: '  otthoni kézrehab program ' },
        { id: 13, sku: 'SOS-1', displayTitle: 'SOS Kézrelax villámkurzus' },
      ],
    })
    expect(options).toEqual([
      { value: '11', label: 'Otthoni KézRehab Program (belső azonosító: OTTHONI-2025)' },
      { value: '12', label: 'otthoni kézrehab program (belső azonosító: OTTHONI-2026)' },
      // Ütközés nélkül a felirat változatlan.
      { value: '13', label: 'SOS Kézrelax villámkurzus' },
    ])
    expectDistinctLabels(options)
  })

  it('displayTitle nélküli sku-ütközés: a sku-felirat mellé nem ismétlődik a sku, az id dönt', () => {
    const options = readProductOptions({
      docs: [
        // A sku-tartalék felirat egy másik kurzus címével ütközik.
        { id: 21, sku: 'KÉZREHAB', displayTitle: null },
        { id: 22, sku: 'KR-2026', displayTitle: 'KézRehab' },
        // Két displayTitle nélküli, csak kis- és nagybetűben eltérő sku.
        { id: 23, sku: 'demo-001', displayTitle: '' },
        { id: 24, sku: 'DEMO-001', displayTitle: '   ' },
      ],
    })
    expect(options).toEqual([
      { value: '23', label: 'demo-001 (#23)' },
      { value: '24', label: 'DEMO-001 (#24)' },
      // A saját sku a felirat, ezért a belső azonosító nem ismétlődik mellette;
      // a másik opció a belső azonosítójával már különbözik tőle.
      { value: '21', label: 'KÉZREHAB' },
      { value: '22', label: 'KézRehab (belső azonosító: KR-2026)' },
    ])
    expectDistinctLabels(options)
  })

  it('sku nélküli ütközés: az adatbázis-azonosító különbözteti meg őket', () => {
    const options = readProductOptions({
      docs: [
        { id: 31, sku: null, displayTitle: 'Kézrelax' },
        { id: 32, displayTitle: 'Kézrelax' },
        // Azonos sku sem különböztet: ott is az id dönt.
        { id: 33, sku: 'KR', displayTitle: 'Kézrelax, haladó' },
        { id: 34, sku: 'KR', displayTitle: 'Kézrelax, haladó' },
      ],
    })
    expect(options).toEqual([
      { value: '31', label: 'Kézrelax (#31)' },
      { value: '32', label: 'Kézrelax (#32)' },
      { value: '33', label: 'Kézrelax, haladó (belső azonosító: KR) (#33)' },
      { value: '34', label: 'Kézrelax, haladó (belső azonosító: KR) (#34)' },
    ])
    expectDistinctLabels(options)
  })

  it('a megkülönböztetett felirat sem ütközhet egy már így nevezett kurzussal', () => {
    const options = readProductOptions({
      docs: [
        { id: 41, displayTitle: 'Kézrelax' },
        { id: 42, displayTitle: 'Kézrelax' },
        { id: 43, displayTitle: 'Kézrelax (#41)' },
      ],
    })
    expectDistinctLabels(options)
    expect(options.map((option) => option.value).sort()).toEqual(['41', '42', '43'])
  })
})

describe('GrantPurchasePanel: mezők, hibák, megerősítés (K12)', () => {
  it('betöltéskor nincs role="alert", és a natív mezők a .kc-admin-input osztályt kapják', async () => {
    expect(container.querySelector('[role="alert"]')).toBeNull()
    await openPanel()
    const select = container.querySelector('select')!
    const textarea = container.querySelector('textarea')!
    expect(select.className).toBe('kc-admin-input')
    expect(textarea.className).toBe('kc-admin-input')
    expect(container.querySelector(`label[for="${select.id}"]`)?.textContent).toBe('Kurzus')
    expect(container.querySelector(`label[for="${textarea.id}"]`)?.textContent).toBe(
      'Indok (kötelező)',
    )
    expect(textarea.hasAttribute('placeholder')).toBe(false)
    expect(document.getElementById(textarea.getAttribute('aria-describedby')!)?.textContent).toBe(
      'A Műveletnaplóba kerül. Például: elhibázott fizetés jóváírása.',
    )
    const labels = Array.from(select.querySelectorAll('option')).map((option) => option.textContent)
    expect(labels).toContain('Otthoni KézRehab Program')
    expect(labels).not.toContain('OTTHONI-001')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('kurzus nélkül a hiba a mezőhöz kötött, a fókusz oda kerül, és nincs megerősítés', async () => {
    await openPanel()
    await click('Ajándékozom a kurzust')
    const select = container.querySelector('select')!
    const error = document.getElementById(select.getAttribute('aria-describedby')!)!
    // GOV.UK: rejtett „Hiba:” előtag, a hiba a címke után, a mező előtt áll.
    expect(error.textContent).toBe(`Hiba: ${PRODUCT_REQUIRED_MESSAGE}`)
    expect(error.nextElementSibling).toBe(select)
    expect(select.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(select)
    // A fókusz a mezőn van, ezért élő régió nem kell (nincs kettős felolvasás).
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(ui.opened).toEqual([])
  })

  it('indok nélkül az indok mezője kapja a hibát', async () => {
    await openPanel()
    await choose('2', '   ')
    await click('Ajándékozom a kurzust')
    const textarea = container.querySelector('textarea')!
    const [hintId, errorId] = textarea.getAttribute('aria-describedby')!.split(' ')
    expect(document.getElementById(errorId!)?.textContent).toBe(`Hiba: ${REASON_REQUIRED_MESSAGE}`)
    expect(document.getElementById(hintId!)?.textContent).toContain('Műveletnaplóba')
    expect(textarea.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(textarea)
    expect(ui.opened).toEqual([])
  })

  it('a megerősítő ablak a kurzus címét „…” idézőjellel és a visszavonhatatlanságot mondja', async () => {
    await openPanel()
    await choose('2', 'Elhibázott fizetés')
    await click('Ajándékozom a kurzust')
    expect(ui.opened).toEqual([GRANT_CONFIRM_MODAL_SLUG])
    const modal = ui.modal!
    expect(modal.confirmLabel).toBe('Ajándékozom a kurzust')
    expect(modal.cancelLabel).toBe('Mégse')
    const text = renderToStaticMarkup(
      createElement('div', null, modal.heading, modal.body),
    ).replace(/<[^>]+>/g, ' ')
    expect(text).toContain('Ajándékozod a kurzust?')
    expect(text).toContain(grantConfirmDetail('Otthoni KézRehab Program', EMAIL))
    expect(text).toContain('„Otthoni KézRehab Program”')
    expect(text).toContain(GRANT_IRREVERSIBLE_SENTENCE)
    expect(text).not.toMatch(/[–—"]/)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('grant-purchase'))).toEqual(
      [],
    )
  })

  it('azonos című kurzusoknál a lista és a megerősítő ablak is a belső azonosítót mutatja, a végpont az id-t kapja', async () => {
    const TWINS = {
      docs: [
        { id: 51, sku: 'OTTHONI-2025', displayTitle: 'Otthoni KézRehab Program' },
        { id: 52, sku: 'OTTHONI-2026', displayTitle: 'Otthoni KézRehab Program' },
      ],
    }
    fetchMock.mockImplementation(async (url) => {
      if (String(url).startsWith('/api/products?')) return Response.json(TWINS)
      if (url === '/api/admin/grant-purchase')
        return Response.json({ status: 'granted', message: 'A kurzust ajándékoztam.' })
      throw new Error(`Unexpected request: ${String(url)}`)
    })
    await openPanel()
    const optionTexts = Array.from(container.querySelectorAll('option')).map((o) => o.textContent)
    expect(optionTexts).toEqual([
      'Válassz kurzust…',
      'Otthoni KézRehab Program (belső azonosító: OTTHONI-2025)',
      'Otthoni KézRehab Program (belső azonosító: OTTHONI-2026)',
    ])
    await choose('52', 'Ajándék')
    await click('Ajándékozom a kurzust')
    const text = renderToStaticMarkup(
      createElement('div', null, ui.modal!.heading, ui.modal!.body),
    ).replace(/<[^>]+>/g, ' ')
    expect(text).toContain('„Otthoni KézRehab Program (belső azonosító: OTTHONI-2026)” kurzus')
    expect(text).not.toContain('OTTHONI-2025')
    await act(async () => {
      await ui.modal!.onConfirm()
    })
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/admin/grant-purchase')!
    expect(JSON.parse(String(call[1]!.body))).toEqual({
      email: EMAIL,
      productIdOrSku: '52',
      reason: 'Ajándék',
    })
  })

  it('jóváhagyás után a változatlan végpontot hívja a változatlan törzzsel', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).startsWith('/api/products?')) return Response.json(PRODUCTS)
      if (url === '/api/admin/grant-purchase')
        return Response.json({ status: 'granted', message: 'A kurzust ajándékoztam.' })
      throw new Error(`Unexpected request: ${String(url)}`)
    })
    await openPanel()
    await choose('2', '  Elhibázott fizetés  ')
    await click('Ajándékozom a kurzust')
    await act(async () => {
      await ui.modal!.onConfirm()
    })
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/admin/grant-purchase')!
    expect(call[1]).toEqual(expect.objectContaining({ method: 'POST', credentials: 'include' }))
    expect(JSON.parse(String(call[1]!.body))).toEqual({
      email: EMAIL,
      productIdOrSku: '2',
      reason: 'Elhibázott fizetés',
    })
    expect(container.querySelector('[data-kc-uzenet="siker"]')?.getAttribute('role')).toBe('status')
    expect(ui.refresh).toHaveBeenCalledTimes(1)
  })

  it('a Mégse gomb után a jóváhagyás nem küld kérést', async () => {
    await openPanel()
    await choose('2', 'Ajándék')
    await click('Ajándékozom a kurzust')
    const modal = ui.modal!
    modal.onCancel?.()
    await act(async () => {
      await modal.onConfirm()
    })
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/admin/grant-purchase')).toBe(false)
  })

  it('másik felhasználóra váltáskor a nyitott megerősítés elvész', async () => {
    await openPanel()
    await choose('2', 'Ajándék')
    await click('Ajándékozom a kurzust')
    const staleConfirm = ui.modal!.onConfirm
    ui.data = { email: 'masik.vasarlo@example.invalid' }
    await act(async () => {
      root.render(createElement(GrantPurchasePanel))
    })
    expect(ui.closeModal).toHaveBeenCalledWith(GRANT_CONFIRM_MODAL_SLUG)
    await act(async () => {
      await staleConfirm()
    })
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/admin/grant-purchase')).toBe(false)
  })

  it('vásárlói szerepkörrel a panel csak tájékoztat', async () => {
    ui.user = { id: 3, role: 'customer' }
    await act(async () => {
      root.render(createElement(GrantPurchasePanel))
    })
    expect(container.textContent).toContain('Kurzust csak munkatárs vagy tulajdonos ajándékozhat.')
    expect(container.querySelector('select')).toBeNull()
  })

  it('a szerver hibája a panel alján, role="alert"-tel jelenik meg, mezőhöz kötés nélkül', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).startsWith('/api/products?')) return Response.json(PRODUCTS)
      if (url === '/api/admin/grant-purchase')
        return Response.json({ error: 'Nincs ilyen felhasználó.' }, { status: 404 })
      throw new Error(`Unexpected request: ${String(url)}`)
    })
    await openPanel()
    await choose('2', 'Ajándék')
    await click('Ajándékozom a kurzust')
    await act(async () => {
      await ui.modal!.onConfirm()
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Nincs ilyen felhasználó.')
    expect(container.querySelector('select')!.hasAttribute('aria-invalid')).toBe(false)
  })
})
