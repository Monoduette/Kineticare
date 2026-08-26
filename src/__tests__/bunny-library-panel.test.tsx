import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * ŐR — A VIDEÓTÁR-VÁLTÁS NEM HAGYHAT A KÉPERNYŐN IDEGEN AZONOSÍTÓT.
 * A legördülő `onChange`-e korábban CSAK a kiválasztott tárat írta át, a
 * `videos`, a `truncated` és a `loaded` állapot érintetlen maradt. A táblázat
 * tehát az ELŐZŐ videótár listáját mutatta tovább, immár a másik tár neve
 * alatt, amíg a munkatárs újra rá nem nyomott a betöltésre. A panel egyetlen
 */

vi.mock('@payloadcms/ui', () => ({
  useAuth: () => ({ user: { id: 1, role: 'staff' } }),
}))

vi.stubGlobal('fetch', () => {
  throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const {
  BunnyLibraryPanel,
  BunnyLibraryPanelView,
  COPY_FAILED_MESSAGE,
  LIBRARY_SWITCH_HINT,
  bunnyLibraryPanelReducer,
  initialBunnyLibraryPanelState,
} = await import('../components/admin/BunnyLibraryPanel')

type PanelState = Parameters<typeof BunnyLibraryPanelView>[0]['state']

const VEDETT_GUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const NYILVANOS_GUID = '11111111-2222-3333-4444-555555555555'

const CSONKA_JELZES = 'A lista csonka'

function video(guid: string, title: string) {
  return { guid, title, lengthSec: 90, status: 4, statusLabel: 'Kész', dateUploaded: null }
}

/** A védett tár betöltött, CSONKA listája — ez a kiindulási képernyő. */
const BETOLTOTT_VEDETT: PanelState = bunnyLibraryPanelReducer(initialBunnyLibraryPanelState, {
  type: 'load-succeeded',
  kind: 'protected',
  videos: [video(VEDETT_GUID, 'Fizetős lecke 1')],
  truncated: true,
})

interface ViewCallbacks {
  onLibraryChange?: (kind: 'protected' | 'public') => void
  onLoad?: () => void
  onCopy?: (guid: string) => void
}

function viewElement(state: PanelState, callbacks: ViewCallbacks = {}) {
  return createElement(BunnyLibraryPanelView, {
    state,
    onLibraryChange: callbacks.onLibraryChange ?? (() => {}),
    onLoad: callbacks.onLoad ?? (() => {}),
    onCopy: callbacks.onCopy ?? (() => {}),
  })
}

function render(state: PanelState): string {
  return renderToStaticMarkup(viewElement(state))
}

/** Az elemfa bejárása — a DOM nélküli környezetben ez helyettesíti a querySelectort. */
function* walk(node: ReactNode): Generator<ReactElement> {
  if (Array.isArray(node)) {
    for (const child of node) {
      yield* walk(child as ReactNode)
    }
    return
  }
  if (!isValidElement(node)) {
    return
  }
  yield node
  const props: unknown = node.props
  if (typeof props === 'object' && props !== null && 'children' in props) {
    yield* walk((props as { children?: ReactNode }).children ?? null)
  }
}

/** A megjelenítőben lévő `<select>` valódi onChange-e. */
function selectOnChange(
  state: PanelState,
  callbacks: ViewCallbacks,
): (event: { target: { value: string } }) => void {
  const tree = BunnyLibraryPanelView(viewElement(state, callbacks).props)
  for (const element of walk(tree)) {
    if (element.type !== 'select') {
      continue
    }
    const props: unknown = element.props
    if (typeof props === 'object' && props !== null && 'onChange' in props) {
      const handler = (props as { onChange?: unknown }).onChange
      if (typeof handler === 'function') {
        return handler as (event: { target: { value: string } }) => void
      }
    }
  }
  throw new Error('A panelben nincs videótár-választó onChange kezelővel.')
}

describe('Bunny panel — a címsor szintje a környezethez igazodik', () => {
  it('alapból h3 (a termék-szerkesztő környezete)', () => {
    expect(render(BETOLTOTT_VEDETT)).toContain('<h3 style="margin-top:0">Videók a Bunny tárból</h3>')
  })

  it('kérésre h2 — az önálló Videótár nézet a lap h1-e alá teszi', () => {
    // A h1 → h3 ugrásból a képernyőolvasót használó munkatárs hiányzó
    // szakaszt olvasna ki (WCAG 2.2 SC 1.3.1, Info and Relationships).
    const html = renderToStaticMarkup(
      createElement(BunnyLibraryPanelView, {
        state: BETOLTOTT_VEDETT,
        onLibraryChange: () => {},
        onLoad: () => {},
        onCopy: () => {},
        headingLevel: 'h2' as const,
      }),
    )
    expect(html).toContain('<h2 style="margin-top:0">Videók a Bunny tárból</h2>')
    expect(html).not.toContain('<h3')
  })
})

describe('Bunny panel — a videótár-váltás kiüríti az előző tár listáját', () => {
  it('kiindulás: a védett tár azonosítója és a csonka-jelzés látszik', () => {
    const html = render(BETOLTOTT_VEDETT)
    expect(html).toContain(VEDETT_GUID)
    expect(html).toContain(CSONKA_JELZES)
    expect(html).toContain('Lista frissítése')
  })

  it('a legördülő váltása után a RÉGI azonosító nincs a képernyőn', () => {
    let state = BETOLTOTT_VEDETT
    const onChange = selectOnChange(state, {
      onLibraryChange: (kind) => {
        state = bunnyLibraryPanelReducer(state, { type: 'library-changed', kind })
      },
    })

    onChange({ target: { value: 'public' } })

    expect(state.kind).toBe('public')
    expect(state.videos).toHaveLength(0)
    expect(state.truncated).toBe(false)
    expect(state.loaded).toBe(false)

    const html = render(state)
    expect(html, 'az előző videótár azonosítója a képernyőn maradt').not.toContain(VEDETT_GUID)
    expect(html, 'az előző tár csonka-jelzése a képernyőn maradt').not.toContain(CSONKA_JELZES)
    expect(html).toContain(LIBRARY_SWITCH_HINT)
    expect(html).toContain('Lista betöltése')
  })

  it('a váltás után betöltött lista már az ÚJ tár azonosítóját mutatja', () => {
    const valtott = bunnyLibraryPanelReducer(BETOLTOTT_VEDETT, {
      type: 'library-changed',
      kind: 'public',
    })
    const betoltott = bunnyLibraryPanelReducer(valtott, {
      type: 'load-succeeded',
      kind: 'public',
      videos: [video(NYILVANOS_GUID, 'Előzetes')],
      truncated: false,
    })
    const html = render(betoltott)
    expect(html).toContain(NYILVANOS_GUID)
    expect(html).not.toContain(VEDETT_GUID)
    expect(html).not.toContain(LIBRARY_SWITCH_HINT)
  })

  it('ugyanarra a tárra váltás nem dobja el a listát', () => {
    const state = bunnyLibraryPanelReducer(BETOLTOTT_VEDETT, {
      type: 'library-changed',
      kind: 'protected',
    })
    expect(state).toBe(BETOLTOTT_VEDETT)
  })

  it('a váltás közben beérkező RÉGI válasz nem kerül ki az új tár neve alatt', () => {
    const valtott = bunnyLibraryPanelReducer(BETOLTOTT_VEDETT, {
      type: 'library-changed',
      kind: 'public',
    })
    const kesoiValasz = bunnyLibraryPanelReducer(valtott, {
      type: 'load-succeeded',
      kind: 'protected',
      videos: [video(VEDETT_GUID, 'Fizetős lecke 1')],
      truncated: true,
    })
    expect(kesoiValasz).toBe(valtott)
    expect(render(kesoiValasz)).not.toContain(VEDETT_GUID)
  })
})

describe('Bunny panel — a hibaág nem hagy ottfelejtett figyelmeztetést', () => {
  it('hiba után eltűnik a csonka-jelzés és a lista, a hibaüzenet role="alert"', () => {
    const uzenet = 'A videótár kulcsa érvénytelen.'
    const state = bunnyLibraryPanelReducer(BETOLTOTT_VEDETT, {
      type: 'load-failed',
      kind: 'protected',
      message: uzenet,
    })

    expect(state.truncated).toBe(false)
    expect(state.loaded).toBe(false)
    expect(state.videos).toHaveLength(0)

    const html = render(state)
    expect(html, 'a csonka-jelzés hibaüzenet mellett is kint maradt').not.toContain(CSONKA_JELZES)
    expect(html).not.toContain(VEDETT_GUID)
    expect(html).toContain('role="alert"')
    expect(html).toContain(uzenet)
    // A hiba nem „üres tár”: a félrevezető üres-állapot szöveg sem jelenhet meg.
    expect(html).not.toContain('Ebben a tárban most nincs videó.')
    expect(html).toContain('Lista betöltése')
  })

  it('a régi tárnak szóló hibaválasz sem írja felül az új tár képernyőjét', () => {
    const valtott = bunnyLibraryPanelReducer(BETOLTOTT_VEDETT, {
      type: 'library-changed',
      kind: 'public',
    })
    const kesoiHiba = bunnyLibraryPanelReducer(valtott, {
      type: 'load-failed',
      kind: 'protected',
      message: 'A védett tár hibája.',
    })
    expect(kesoiHiba).toBe(valtott)
    expect(render(kesoiHiba)).not.toContain('A védett tár hibája.')
  })

  it('sikeres betöltés eltünteti a korábbi hibaüzenetet', () => {
    const hibas = bunnyLibraryPanelReducer(initialBunnyLibraryPanelState, {
      type: 'load-failed',
      kind: 'protected',
      message: 'Nem sikerült elérni a szervert.',
    })
    const sikeres = bunnyLibraryPanelReducer(hibas, {
      type: 'load-succeeded',
      kind: 'protected',
      videos: [],
      truncated: false,
    })
    expect(sikeres.error).toBeNull()
    expect(render(sikeres)).toContain('Ebben a tárban most nincs videó.')
  })

  it('a másolás hibája magyar üzenetet ad, a listát nem bántja', () => {
    const state = bunnyLibraryPanelReducer(BETOLTOTT_VEDETT, { type: 'copy-failed' })
    expect(state.videos).toHaveLength(1)
    const html = render(state)
    expect(html).toContain(COPY_FAILED_MESSAGE)
    expect(html).toContain(VEDETT_GUID)
  })
})

describe('Bunny panel — a szerepkör-kapu és az induló képernyő', () => {
  it('staff szerepkörrel a panel üres listával, betöltő gombbal indul', () => {
    const html = renderToStaticMarkup(createElement(BunnyLibraryPanel))
    expect(html).toContain('Videók a Bunny tárból')
    expect(html).toContain('Lista betöltése')
    expect(html).toContain('Védett (fizetős leckék)')
    expect(html).not.toContain(CSONKA_JELZES)
    expect(html).not.toContain(LIBRARY_SWITCH_HINT)
  })
})
