import { Window } from 'happy-dom'
import { act, createElement, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import type { TextFieldClientProps } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * K35: a videómező a config címkéjét és leírását mutatja (Payload FieldLabel
 * és FieldDescription), és újratöltés után is kimondja, melyik videó van
 * rajta („cím · 7:17 · Kész”). A videó adatait a meglévő videoDetail kliens
 * adja; itt mock, valódi hálózati hívás nincs (CLAUDE.md, 15. tanulság).
 */

const GUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

const ui = vi.hoisted(() => ({
  value: '' as string,
  role: 'staff',
}))

const detailMock = vi.hoisted(() => vi.fn())

vi.mock('@payloadcms/ui', () => ({
  FieldLabel: ({ label, required }: { label?: unknown; required?: boolean }) =>
    createElement(
      'span',
      { className: 'field-label' },
      typeof label === 'string' ? label : '',
      required ? ' *' : '',
    ),
  FieldDescription: ({ description }: { description?: unknown }) =>
    createElement(
      'div',
      { className: 'field-description' },
      typeof description === 'string' ? description : '',
    ),
  useAuth: () => ({ user: { id: 1, role: ui.role } }),
  useField: ({ potentiallyStalePath }: { potentiallyStalePath: string }) => ({
    value: ui.value,
    path: potentiallyStalePath,
    disabled: false,
    showError: false,
    errorMessage: '',
  }),
  useForm: () => ({
    disabled: false,
    getFields: () => ({}),
    dispatchFields: () => {
      throw new Error('A mező megjelenítése nem írhat az űrlapba')
    },
    setModified: () => {
      throw new Error('A mező megjelenítése nem jelölheti módosítottnak az űrlapot')
    },
  }),
  XIcon: () => null,
  SearchIcon: () => null,
  ChevronIcon: () => null,
}))

vi.mock('../components/admin/bunny-video-client', () => ({
  videoDetail: detailMock,
  videoRequest: () => {
    throw new Error('Unexpected list request')
  },
  expiryTime: () => Number.NaN,
}))

vi.mock('../components/admin/BunnyVideoUpload', () => ({ BunnyVideoUpload: () => null }))

const { PublicBunnyVideoField, ProtectedBunnyVideoField } =
  await import('../components/admin/BunnyVideoField')

let window: Window
let container: HTMLDivElement
let root: Root

function props(path: string, field: Record<string, unknown>) {
  return { path, field } as unknown as TextFieldClientProps
}

async function render(node: ReactNode) {
  await act(async () => {
    root.render(node)
  })
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(async () => {
  ui.value = ''
  ui.role = 'staff'
  detailMock.mockReset()
  window = new Window({ url: 'http://localhost:3000' })
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  vi.stubGlobal('HTMLElement', window.HTMLElement)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', () => {
    throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
  })
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  try {
    await act(async () => {
      root?.unmount()
    })
    container?.remove()
    await window.happyDOM.close()
  } finally {
    vi.unstubAllGlobals()
  }
})

describe('BunnyVideoField: a config címkéje, leírása és a csatolt videó (K35)', () => {
  it('a config címkéje és leírása látszik, és a csoport nevét adja', async () => {
    await render(
      createElement(
        PublicBunnyVideoField,
        props('previewVideoStreamId', {
          label: 'Nyilvános előzetes videó',
          admin: { description: 'A kurzusoldalon bárki megnézheti.' },
        }),
      ),
    )
    const group = container.querySelector('[role="group"]')!
    const label = document.getElementById(group.getAttribute('aria-labelledby')!)
    const description = document.getElementById(group.getAttribute('aria-describedby')!)
    expect(label?.textContent).toBe('Nyilvános előzetes videó')
    expect(description?.textContent).toBe('A kurzusoldalon bárki megnézheti.')
    expect(container.textContent).toContain('Nincs videó kiválasztva.')
    expect(detailMock).not.toHaveBeenCalled()
  })

  it('címke nélküli confignál az egységes tartalék felirat áll', async () => {
    await render(createElement(PublicBunnyVideoField, props('previewVideoStreamId', {})))
    expect(container.querySelector('.field-label')?.textContent).toBe('Nyilvános előzetes videó')
    expect(container.querySelector('[role="group"]')?.hasAttribute('aria-describedby')).toBe(false)
  })

  it('újratöltés után a csatolt videó címe, hossza és állapota látszik', async () => {
    ui.value = GUID
    detailMock.mockResolvedValue({
      guid: GUID,
      title: 'Bemelegítés',
      durationSec: 437,
      status: 'ready',
      thumbnailUrl: null,
    })
    await render(
      createElement(
        ProtectedBunnyVideoField,
        props('modules.0.lessons.0.streamAssetId', { label: 'Lecke videója' }),
      ),
    )
    expect(detailMock).toHaveBeenCalledWith(GUID, 'protected')
    expect(container.textContent).toContain('Bemelegítés · 7:17 · Kész')
    expect(container.textContent).not.toContain('...')
  })

  it('ha a videó adatai nem tölthetők be, ezt mondja, és nem dob', async () => {
    ui.value = '11111111-2222-3333-4444-555555555555'
    detailMock.mockRejectedValue(new Error('Synthetic provider failure'))
    await render(
      createElement(PublicBunnyVideoField, props('previewVideoStreamId', { label: 'Előzetes' })),
    )
    expect(container.textContent).toContain('Videó csatolva. Az adatai most nem tölthetők be.')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('nem GUID alakú értéknél nincs adatlekérés, és a sor nem állít betöltést (SC 4.1.3)', async () => {
    ui.value = 'nem-guid-ertek'
    await render(
      createElement(
        ProtectedBunnyVideoField,
        props('modules.0.lessons.0.streamAssetId', { label: 'Lecke videója' }),
      ),
    )
    // Még egy mikrotaszk-kör: ha a mező mégis kérne, itt már látszana.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(detailMock).not.toHaveBeenCalled()
    const text = container.textContent ?? ''
    expect(text).toContain(
      'Videó csatolva, de az azonosítója nem ismerhető fel. Válaszd ki újra a „Videó cseréje” gombbal.',
    )
    expect(text).not.toContain('betöltése')
    // A mondat a mező valódi gombnevére hivatkozik.
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent)
    expect(buttons).toContain('Videó cseréje')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('a leválasztó gomb az egységes „Nyilvános előzetes” szót használja', async () => {
    ui.value = GUID
    detailMock.mockResolvedValue({
      guid: GUID,
      title: 'Bemutató',
      durationSec: 60,
      status: 'ready',
      thumbnailUrl: null,
    })
    await render(createElement(PublicBunnyVideoField, props('previewVideoStreamId', {})))
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent)
    expect(buttons).toContain('Nyilvános előzetes leválasztása')
    expect(buttons).not.toContain('Előzetes leválasztása')
  })

  it('vásárlónak a mező nem jelenik meg, és nem kér adatot', async () => {
    ui.role = 'customer'
    ui.value = GUID
    await render(createElement(PublicBunnyVideoField, props('previewVideoStreamId', {})))
    expect(container.innerHTML).toBe('')
    expect(detailMock).not.toHaveBeenCalled()
  })
})
