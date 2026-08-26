import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { BUNNY_STREAM_IFRAME_SOURCE } from '../lib/security/csp'
import {
  createBunnyPlayerBridge,
  PLAYER_JS_CONTEXT,
  PLAYER_JS_VERSION,
  SUBSCRIBE_MAX_ATTEMPTS,
  SUBSCRIBE_RETRY_INTERVAL_MS,
  type PlayerJsFrame,
  type PlayerJsHostWindow,
  type PlayerJsMessageEvent,
  type PlayerTimeUpdate,
} from '../lib/stream/playerjs-client'

/**
 * A player.js híd egységtesztje.
 *
 * A `window` és a `postMessage` KIZÁRÓLAG mockolt: a teszt sem hálózatra, sem
 * valódi iframe-re nem támaszkodik (vö. CLAUDE.md „tesztből sosem mehet ki
 * valódi hálózati hívás"). A globális `window`-t `vi.stubGlobal` adja, és
 * minden teszt után `vi.unstubAllGlobals` takarít.
 *
 * A LEGFONTOSABB teszt az origin-szűrés: ha idegen keret üzenete átjutna,
 * bárki hamis haladást (és így ingyen „elvégzett kurzust") tudna injektálni a
 * felületre.
 */

interface FakeHostWindow {
  addEventListener(type: 'message', listener: (event: PlayerJsMessageEvent) => void): void
  removeEventListener(type: 'message', listener: (event: PlayerJsMessageEvent) => void): void
  listenerCount(): number
  dispatch(event: PlayerJsMessageEvent): void
}

function createFakeHostWindow(): FakeHostWindow {
  const listeners = new Set<(event: PlayerJsMessageEvent) => void>()
  return {
    addEventListener(_type, listener) {
      listeners.add(listener)
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener)
    },
    listenerCount() {
      return listeners.size
    },
    dispatch(event) {
      for (const listener of [...listeners]) {
        listener(event)
      }
    },
  }
}

interface PostedMessage {
  message: string
  targetOrigin: string
}

interface FakeFrame {
  frame: PlayerJsFrame
  contentWindow: object
  posted: PostedMessage[]
}

function createFakeFrame(): FakeFrame {
  const posted: PostedMessage[] = []
  const contentWindow = {
    postMessage(message: string, targetOrigin: string): void {
      posted.push({ message, targetOrigin })
    },
  }
  return { frame: { contentWindow }, contentWindow, posted }
}

interface FakeFrameWithLoad extends FakeFrame {
  /** Az iframe `load` eseményének kiváltása. */
  fireLoad(): void
  loadListenerCount(): number
}

/** Iframe, amely a `load` eseményt is támogatja (mint a valódi DOM-elem). */
function createFakeFrameWithLoad(): FakeFrameWithLoad {
  const base = createFakeFrame()
  const listeners = new Set<() => void>()
  const frame: PlayerJsFrame = {
    contentWindow: base.contentWindow as { postMessage(m: string, o: string): void },
    addEventListener(_type, listener) {
      listeners.add(listener)
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener)
    },
  }
  return {
    ...base,
    frame,
    fireLoad() {
      for (const listener of [...listeners]) {
        listener()
      }
    },
    loadListenerCount() {
      return listeners.size
    },
  }
}

/** Egy player.js esemény-üzenet a spec alakjában. */
function playerEvent(
  event: string,
  value?: unknown,
  overrides?: { context?: unknown; listener?: unknown },
): Record<string, unknown> {
  return {
    context: overrides?.context === undefined ? PLAYER_JS_CONTEXT : overrides.context,
    version: PLAYER_JS_VERSION,
    event,
    listener: overrides?.listener,
    value,
  }
}

/** A híd által használt listener-azonosító a kimenő üzenetekből. */
function listenerIdOf(posted: PostedMessage[]): string {
  const first = posted[0]
  expect(first).toBeDefined()
  const parsed: unknown = JSON.parse(first.message)
  expect(parsed).toMatchObject({ context: PLAYER_JS_CONTEXT })
  return (parsed as { listener: string }).listener
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createBunnyPlayerBridge — típus-szerződés', () => {
  /**
   * FORDÍTÁSI IDEJŰ ellenőrzés. A híd szándékosan a saját, minimális
   * felületeivel dolgozik (hogy környezet-független és könnyen mockolható
   * legyen), de a valódi hívási helyen `HTMLIFrameElement` és `Window` érkezik.
   * Ha ez a két értékadás nem fordulna, a hiba csak a komponensben derülne ki —
   * ez a teszt viszont a `npm run typecheck`-en azonnal megbukna.
   */
  it('a valódi DOM-típusok megfelelnek a híd minimális felületeinek', () => {
    const frameCompatible: PlayerJsFrame | null = null as HTMLIFrameElement | null
    const hostCompatible: PlayerJsHostWindow | null = null as Window | null
    expect(frameCompatible).toBeNull()
    expect(hostCompatible).toBeNull()
  })
})

describe('createBunnyPlayerBridge — origin-szűrés (biztonsági alap)', () => {
  it('IDEGEN originből érkező, egyébként szabályos üzenetet ELDOB', () => {
    const host = createFakeHostWindow()
    vi.stubGlobal('window', host)
    const { frame, contentWindow } = createFakeFrame()
    const onTimeUpdate = vi.fn()
    const onEnded = vi.fn()
    const onReady = vi.fn()

    createBunnyPlayerBridge({ iframe: frame, onTimeUpdate, onEnded, onReady })

    host.dispatch({
      origin: 'https://tamado.example',
      source: contentWindow,
      data: playerEvent('timeupdate', { seconds: 100, duration: 100 }),
    })
    host.dispatch({
      origin: 'https://tamado.example',
      source: contentWindow,
      data: playerEvent('ended'),
    })
    host.dispatch({
      origin: 'https://tamado.example',
      source: contentWindow,
      data: playerEvent('ready'),
    })

    expect(onTimeUpdate).not.toHaveBeenCalled()
    expect(onEnded).not.toHaveBeenCalled()
    expect(onReady).not.toHaveBeenCalled()
  })

  it('a Bunny-originre HASONLÍTÓ hostot is eldobja (nem prefix-egyezés)', () => {
    const host = createFakeHostWindow()
    vi.stubGlobal('window', host)
    const { frame } = createFakeFrame()
    const onEnded = vi.fn()

    createBunnyPlayerBridge({ iframe: frame, onEnded })

    for (const origin of [
      `${BUNNY_STREAM_IFRAME_SOURCE}.tamado.example`,
      'http://iframe.mediadelivery.net',
      'https://iframe.mediadelivery.net.tamado.example',
      'null',
      '',
    ]) {
      host.dispatch({ origin, data: playerEvent('ended') })
    }

    expect(onEnded).not.toHaveBeenCalled()
  })

  it('IDEGEN forrás-ablakból (más iframe, azonos origin) érkezőt eldob', () => {
    const host = createFakeHostWindow()
    vi.stubGlobal('window', host)
    const { frame } = createFakeFrame()
    const onEnded = vi.fn()

    createBunnyPlayerBridge({ iframe: frame, onEnded })

    host.dispatch({
      origin: BUNNY_STREAM_IFRAME_SOURCE,
      source: { masikIframe: true },
      data: playerEvent('ended'),
    })

    expect(onEnded).not.toHaveBeenCalled()
  })

  it('forrás-ablak nélküli üzenetet elfogad (a mező nem mindenhol van kitöltve)', () => {
    const host = createFakeHostWindow()
    vi.stubGlobal('window', host)
    const { frame } = createFakeFrame()
    const onEnded = vi.fn()

    createBunnyPlayerBridge({ iframe: frame, onEnded })
    host.dispatch({ origin: BUNNY_STREAM_IFRAME_SOURCE, data: playerEvent('ended') })

    expect(onEnded).toHaveBeenCalledTimes(1)
  })
})

describe('createBunnyPlayerBridge — kimenő üzenetek', () => {
  it('létrehozáskor feliratkozik a ready, timeupdate és ended eseményre, a PONTOS originre', () => {
    const host = createFakeHostWindow()
    vi.stubGlobal('window', host)
    const { frame, posted } = createFakeFrame()

    const bridge = createBunnyPlayerBridge({ iframe: frame })

    expect(posted).toHaveLength(3)
    for (const entry of posted) {
      expect(entry.targetOrigin).toBe(BUNNY_STREAM_IFRAME_SOURCE)
    }
    const values = posted.map((entry) => JSON.parse(entry.message) as Record<string, unknown>)
    // A `ready` NEM hagyható el: nem építhetünk arra, hogy a Bunny éles
    // lejátszója valóban kéretlenül broadcastol — ha csak a feliratkozóknak
    // küldi, nélküle SOHA nem tudnánk meg, mikor élesíthetjük a többit.
    expect(values.map((value) => value.value)).toEqual(['ready', 'timeupdate', 'ended'])
    for (const value of values) {
      expect(value.context).toBe(PLAYER_JS_CONTEXT)
      expect(value.version).toBe(PLAYER_JS_VERSION)
      expect(value.method).toBe('addEventListener')
      expect(typeof value.listener).toBe('string')
    }
    bridge.dispose()
  })

  it('a ready esemény után ÚJRA feliratkozik (az iframe addigra biztosan él)', () => {
    const host = createFakeHostWindow()
    vi.stubGlobal('window', host)
    const { frame, posted } = createFakeFrame()
    const onReady = vi.fn()

    const bridge = createBunnyPlayerBridge({ iframe: frame, onReady })
    expect(posted).toHaveLength(3)

    host.dispatch({
      origin: BUNNY_STREAM_IFRAME_SOURCE,
      data: playerEvent('ready', { src: 'https://iframe.mediadelivery.net/embed/1/abc' }),
    })

    expect(posted).toHaveLength(6)
    expect(onReady).toHaveBeenCalledTimes(1)
    bridge.dispose()
  })

  it('contentWindow nélküli iframe esetén nem dob és nem küld', () => {
    const host = createFakeHostWindow()
    vi.stubGlobal('window', host)
    const onEnded = vi.fn()

    expect(() =>
      createBunnyPlayerBridge({ iframe: { contentWindow: null }, onEnded }),
    ).not.toThrow()

    host.dispatch({ origin: BUNNY_STREAM_IFRAME_SOURCE, data: playerEvent('ended') })
    expect(onEnded).toHaveBeenCalledTimes(1)
  })
})

describe('createBunnyPlayerBridge — érvényes üzenetek feldolgozása', () => {
  it('timeupdate → { seconds, duration }', () => {
    const host = createFakeHostWindow()
    vi.stubGlobal('window', host)
    const { frame, contentWindow, posted } = createFakeFrame()
    const updates: PlayerTimeUpdate[] = []

    createBunnyPlayerBridge({
      iframe: frame,
      onTimeUpdate: (update) => {
        updates.push(update)
      },
    })

    host.dispatch({
      origin: BUNNY_STREAM_IFRAME_SOURCE,
      source: contentWindow,
      data: playerEvent(
        'timeupdate',
        { seconds: 10, duration: 40 },
        { listener: listenerIdOf(posted) },
      ),
    })

    expect(updates).toEqual([{ seconds: 10, duration: 40 }])
  })

  it('JSON-SZÖVEGKÉNT érkező üzenetet is feldolgoz', () => {
    const host = createFakeHostWindow()
    vi.stubGlobal('window', host)
    const { frame } = createFakeFrame()
    const onTimeUpdate = vi.fn()

    createBunnyPlayerBridge({ iframe: frame, onTimeUpdate })

    host.dispatch({
      origin: BUNNY_STREAM_IFRAME_SOURCE,
      data: JSON.stringify(playerEvent('timeupdate', { seconds: 3.5, duration: 7 })),
    })

    expect(onTimeUpdate).toHaveBeenCalledWith({ seconds: 3.5, duration: 7 })
  })

  it('hiányzó vagy értelmetlen duration → null (nem hamis nevező)', () => {
    const host = createFakeHostWindow()
    vi.stubGlobal('window', host)
    const { frame } = createFakeFrame()
    const onTimeUpdate = vi.fn()

    createBunnyPlayerBridge({ iframe: frame, onTimeUpdate })

    for (const duration of [undefined, 0, -1, 'NaN', null]) {
      host.dispatch({
        origin: BUNNY_STREAM_IFRAME_SOURCE,
        data: playerEvent('timeupdate', { seconds: 1, duration }),
      })
    }

    expect(onTimeUpdate).toHaveBeenCalledTimes(5)
    for (const call of onTimeUpdate.mock.calls) {
      expect(call[0]).toEqual({ seconds: 1, duration: null })
    }
  })

  it('ended → onEnded', () => {
    const host = createFakeHostWindow()
    vi.stubGlobal('window', host)
    const { frame, posted } = createFakeFrame()
    const onEnded = vi.fn()

    createBunnyPlayerBridge({ iframe: frame, onEnded })
    host.dispatch({
      origin: BUNNY_STREAM_IFRAME_SOURCE,
      data: playerEvent('ended', {}, { listener: listenerIdOf(posted) }),
    })

    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it('a minket nem érdeklő eseményeket (play, pause, seeked) figyelmen kívül hagyja', () => {
    const host = createFakeHostWindow()
    vi.stubGlobal('window', host)
    const { frame } = createFakeFrame()
    const onTimeUpdate = vi.fn()
    const onEnded = vi.fn()
    const onReady = vi.fn()

    createBunnyPlayerBridge({ iframe: frame, onTimeUpdate, onEnded, onReady })

    for (const eventName of ['play', 'pause', 'seeked', 'progress', 'error']) {
      host.dispatch({ origin: BUNNY_STREAM_IFRAME_SOURCE, data: playerEvent(eventName, {}) })
    }

    expect(onTimeUpdate).not.toHaveBeenCalled()
    expect(onEnded).not.toHaveBeenCalled()
    expect(onReady).not.toHaveBeenCalled()
  })
})

describe('createBunnyPlayerBridge — hibás alakú üzenetek', () => {
  it('semmilyen szemetet nem dolgoz fel, és SOHA nem dob', () => {
    const host = createFakeHostWindow()
    vi.stubGlobal('window', host)
    const { frame } = createFakeFrame()
    const onTimeUpdate = vi.fn()
    const onEnded = vi.fn()
    const onReady = vi.fn()
    const onError = vi.fn()

    createBunnyPlayerBridge({ iframe: frame, onTimeUpdate, onEnded, onReady, onError })

    const garbage: unknown[] = [
      undefined,
      null,
      0,
      'nem json',
      '{"csonka":',
      '[]',
      [],
      { context: 'masik.js', event: 'ended' },
      { context: PLAYER_JS_CONTEXT },
      { context: PLAYER_JS_CONTEXT, event: '' },
      { context: PLAYER_JS_CONTEXT, event: 42 },
      playerEvent('timeupdate', 'nem objektum'),
      playerEvent('timeupdate', { duration: 40 }),
      playerEvent('timeupdate', { seconds: 'tíz', duration: 40 }),
      playerEvent('timeupdate', { seconds: Number.NaN, duration: 40 }),
      playerEvent('timeupdate', { seconds: -1, duration: 40 }),
    ]

    for (const data of garbage) {
      expect(() => host.dispatch({ origin: BUNNY_STREAM_IFRAME_SOURCE, data })).not.toThrow()
    }

    expect(onTimeUpdate).not.toHaveBeenCalled()
    expect(onEnded).not.toHaveBeenCalled()
    expect(onReady).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('IDEGEN listener-azonosítójú eseményt eldob (más feliratkozó üzenete)', () => {
    const host = createFakeHostWindow()
    vi.stubGlobal('window', host)
    const { frame } = createFakeFrame()
    const onTimeUpdate = vi.fn()
    const onEnded = vi.fn()

    createBunnyPlayerBridge({ iframe: frame, onTimeUpdate, onEnded })

    host.dispatch({
      origin: BUNNY_STREAM_IFRAME_SOURCE,
      data: playerEvent(
        'timeupdate',
        { seconds: 10, duration: 40 },
        { listener: 'masik-feliratkozo' },
      ),
    })
    host.dispatch({
      origin: BUNNY_STREAM_IFRAME_SOURCE,
      data: playerEvent('ended', {}, { listener: 'masik-feliratkozo' }),
    })

    expect(onTimeUpdate).not.toHaveBeenCalled()
    expect(onEnded).not.toHaveBeenCalled()
  })

  it('a ready listener-azonosító nélkül is átmegy (a lejátszó magától küldi)', () => {
    const host = createFakeHostWindow()
    vi.stubGlobal('window', host)
    const { frame } = createFakeFrame()
    const onReady = vi.fn()

    createBunnyPlayerBridge({ iframe: frame, onReady })
    host.dispatch({
      origin: BUNNY_STREAM_IFRAME_SOURCE,
      data: playerEvent('ready', {}, { listener: 'a-lejatszo-sajat-azonositoja' }),
    })

    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('a dobó callback hibája nem jut ki, hanem az onError-ra megy', () => {
    const host = createFakeHostWindow()
    vi.stubGlobal('window', host)
    const { frame } = createFakeFrame()
    const onError = vi.fn()
    const hiba = new Error('a fogyasztó elhasalt')

    createBunnyPlayerBridge({
      iframe: frame,
      onEnded: () => {
        throw hiba
      },
      onError,
    })

    expect(() =>
      host.dispatch({ origin: BUNNY_STREAM_IFRAME_SOURCE, data: playerEvent('ended') }),
    ).not.toThrow()
    expect(onError).toHaveBeenCalledWith(hiba)
  })

  it('onError nélkül is elnyeli a callback hibáját', () => {
    const host = createFakeHostWindow()
    vi.stubGlobal('window', host)
    const { frame } = createFakeFrame()

    createBunnyPlayerBridge({
      iframe: frame,
      onEnded: () => {
        throw new Error('a fogyasztó elhasalt')
      },
    })

    expect(() =>
      host.dispatch({ origin: BUNNY_STREAM_IFRAME_SOURCE, data: playerEvent('ended') }),
    ).not.toThrow()
  })
})

describe('createBunnyPlayerBridge — takarítás', () => {
  it('dispose() leiratkozik, és utána egyetlen callback sem fut', () => {
    const host = createFakeHostWindow()
    vi.stubGlobal('window', host)
    const { frame } = createFakeFrame()
    const onTimeUpdate = vi.fn()
    const onEnded = vi.fn()
    const onReady = vi.fn()

    const bridge = createBunnyPlayerBridge({ iframe: frame, onTimeUpdate, onEnded, onReady })
    expect(host.listenerCount()).toBe(1)

    bridge.dispose()
    expect(host.listenerCount()).toBe(0)

    host.dispatch({
      origin: BUNNY_STREAM_IFRAME_SOURCE,
      data: playerEvent('timeupdate', { seconds: 10, duration: 40 }),
    })
    host.dispatch({ origin: BUNNY_STREAM_IFRAME_SOURCE, data: playerEvent('ended') })
    host.dispatch({ origin: BUNNY_STREAM_IFRAME_SOURCE, data: playerEvent('ready') })

    expect(onTimeUpdate).not.toHaveBeenCalled()
    expect(onEnded).not.toHaveBeenCalled()
    expect(onReady).not.toHaveBeenCalled()
  })

  it('a dispose() többszöri hívása biztonságos', () => {
    const host = createFakeHostWindow()
    vi.stubGlobal('window', host)
    const { frame } = createFakeFrame()

    const bridge = createBunnyPlayerBridge({ iframe: frame })
    bridge.dispose()
    expect(() => bridge.dispose()).not.toThrow()
    expect(host.listenerCount()).toBe(0)
  })

  it('két híd egy oldalon: az egyik dispose-a nem némítja el a másikat', () => {
    const host = createFakeHostWindow()
    vi.stubGlobal('window', host)
    const first = createFakeFrame()
    const second = createFakeFrame()
    const onEndedFirst = vi.fn()
    const onEndedSecond = vi.fn()

    const bridgeFirst = createBunnyPlayerBridge({
      iframe: first.frame,
      onEnded: onEndedFirst,
    })
    createBunnyPlayerBridge({ iframe: second.frame, onEnded: onEndedSecond })

    bridgeFirst.dispose()
    host.dispatch({
      origin: BUNNY_STREAM_IFRAME_SOURCE,
      source: second.contentWindow,
      data: playerEvent('ended'),
    })

    expect(onEndedFirst).not.toHaveBeenCalled()
    expect(onEndedSecond).toHaveBeenCalledTimes(1)
  })
})

describe('createBunnyPlayerBridge — window nélküli környezet', () => {
  it('globális window hiányában NO-OP híd jön létre, hiba nélkül', () => {
    vi.stubGlobal('window', undefined)
    const { frame, posted } = createFakeFrame()

    const bridge = createBunnyPlayerBridge({ iframe: frame, onEnded: vi.fn() })
    expect(posted).toHaveLength(0)
    expect(() => bridge.dispose()).not.toThrow()
  })

  it('hiányos window-objektum (nincs addEventListener) esetén sem dob', () => {
    vi.stubGlobal('window', { valami: true })
    const { frame } = createFakeFrame()

    expect(() => createBunnyPlayerBridge({ iframe: frame }).dispose()).not.toThrow()
  })

  it('kifejezetten átadott hostWindow felülírja a globálisat', () => {
    vi.stubGlobal('window', undefined)
    const host = createFakeHostWindow()
    const { frame } = createFakeFrame()
    const onEnded = vi.fn()

    createBunnyPlayerBridge({ iframe: frame, hostWindow: host, onEnded })
    host.dispatch({ origin: BUNNY_STREAM_IFRAME_SOURCE, data: playerEvent('ended') })

    expect(onEnded).toHaveBeenCalledTimes(1)
  })
})

/**
 * Az audit végpontól-végpontig, VALÓDI cross-origin `postMessage`-dzsel
 * bizonyította, hogy a híd LÉTREHOZÁSAKOR küldött feliratkozás SOHA nem ér
 * célba: a lecke betöltésekor az iframe még `about:blank`-en áll, és a pontos
 * célorigint megkövetelő üzenet némán elvész. A javítás előtt ezért az EGÉSZ
 * automatikus haladás-jelölés egyetlen, dokumentálatlan külső viselkedésen
 */
describe('createBunnyPlayerBridge — a feliratkozás garantáltan célba ér', () => {
  it('az iframe `load` eseményére ÚJRA feliratkozik (a vaklövés elveszhet)', () => {
    const host = createFakeHostWindow()
    const teszt = createFakeFrameWithLoad()

    const bridge = createBunnyPlayerBridge({ iframe: teszt.frame, hostWindow: host })
    expect(teszt.posted).toHaveLength(3)

    // A keret betöltődött: MOST már a Bunny dokumentuma fut benne.
    teszt.fireLoad()

    expect(teszt.posted).toHaveLength(6)
    const values = teszt.posted
      .slice(3)
      .map((entry) => (JSON.parse(entry.message) as { value?: unknown }).value)
    expect(values).toEqual(['ready', 'timeupdate', 'ended'])
    bridge.dispose()
  })

  it('a `load` feliratkozás dispose-nál megszűnik (nem szivárog listener)', () => {
    const host = createFakeHostWindow()
    const teszt = createFakeFrameWithLoad()

    const bridge = createBunnyPlayerBridge({ iframe: teszt.frame, hostWindow: host })
    expect(teszt.loadListenerCount()).toBe(1)

    bridge.dispose()
    expect(teszt.loadListenerCount()).toBe(0)

    // A dispose UTÁNI load már semmit nem küldhet.
    const eddig = teszt.posted.length
    teszt.fireLoad()
    expect(teszt.posted).toHaveLength(eddig)
  })

  it('amíg a keret NÉMA, korlátos ismétléssel újrapróbálja a feliratkozást', () => {
    vi.useFakeTimers()
    try {
      const host = createFakeHostWindow()
      const { frame, posted } = createFakeFrame()

      const bridge = createBunnyPlayerBridge({ iframe: frame, hostWindow: host })
      expect(posted).toHaveLength(3)

      vi.advanceTimersByTime(SUBSCRIBE_RETRY_INTERVAL_MS)
      expect(posted).toHaveLength(6)

      vi.advanceTimersByTime(SUBSCRIBE_RETRY_INTERVAL_MS * 3)
      expect(posted).toHaveLength(15)

      bridge.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('az ELSŐ érvényes üzenet leállítja az ismétlést (nem zajongunk feleslegesen)', () => {
    vi.useFakeTimers()
    try {
      const host = createFakeHostWindow()
      const { frame, posted } = createFakeFrame()

      const bridge = createBunnyPlayerBridge({ iframe: frame, hostWindow: host })
      vi.advanceTimersByTime(SUBSCRIBE_RETRY_INTERVAL_MS)
      expect(posted).toHaveLength(6)

      // A keret megszólal — mindegy, milyen eseménnyel.
      host.dispatch({
        origin: BUNNY_STREAM_IFRAME_SOURCE,
        data: playerEvent('play'),
      })
      const megszolalasUtan = posted.length

      vi.advanceTimersByTime(SUBSCRIBE_RETRY_INTERVAL_MS * 10)
      expect(posted).toHaveLength(megszolalasUtan)

      bridge.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('IDEGEN originű üzenet NEM állítja le az ismétlést (nem hamisítható ki)', () => {
    vi.useFakeTimers()
    try {
      const host = createFakeHostWindow()
      const { frame, posted } = createFakeFrame()

      const bridge = createBunnyPlayerBridge({ iframe: frame, hostWindow: host })

      host.dispatch({ origin: 'https://tamado.example', data: playerEvent('ready') })

      vi.advanceTimersByTime(SUBSCRIBE_RETRY_INTERVAL_MS)
      expect(posted).toHaveLength(6)

      bridge.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('legfeljebb SUBSCRIBE_MAX_ATTEMPTS ismétlés után feladja (nem pörög örökké)', () => {
    vi.useFakeTimers()
    try {
      const host = createFakeHostWindow()
      const { frame, posted } = createFakeFrame()

      const bridge = createBunnyPlayerBridge({ iframe: frame, hostWindow: host })

      // Jóval túl a korláton.
      vi.advanceTimersByTime(SUBSCRIBE_RETRY_INTERVAL_MS * (SUBSCRIBE_MAX_ATTEMPTS + 50))

      // 1 induló + SUBSCRIBE_MAX_ATTEMPTS ismétlés, egyenként 3 üzenettel.
      expect(posted).toHaveLength(3 * (SUBSCRIBE_MAX_ATTEMPTS + 1))

      bridge.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('dispose után SEMMILYEN további üzenet nem megy ki', () => {
    vi.useFakeTimers()
    try {
      const host = createFakeHostWindow()
      const { frame, posted } = createFakeFrame()

      const bridge = createBunnyPlayerBridge({ iframe: frame, hostWindow: host })
      bridge.dispose()
      const eddig = posted.length

      vi.advanceTimersByTime(SUBSCRIBE_RETRY_INTERVAL_MS * 10)
      expect(posted).toHaveLength(eddig)
    } finally {
      vi.useRealTimers()
    }
  })
})

/**
 * A Bunny-oldali fogadó a szülő origint a `document.referrer`-ből számolja, és
 * minden más originű üzenetet ELDOB. Ez egy KIMONDATLAN függés a saját
 * biztonsági fejlécünkön: ha valaki a `Referrer-Policy`-t `no-referrer`-re
 * szigorítja (ami első ránézésre javításnak látszik), a lejátszó üres origint
 * lát, és MINDEN feliratkozásunkat visszautasítja — némán, hibaüzenet nélkül.
 *
 * Ez a teszt azért van, hogy a szigorítás ITT bukjon el, ne élesben.
 */
describe('a Bunny-fogadó referrer-függése', () => {
  const config = readFileSync(new URL('../../next.config.ts', import.meta.url), 'utf8')

  it('a Referrer-Policy átadja az originünket a lejátszónak', () => {
    const match = /'Referrer-Policy',\s*value:\s*'([^']+)'/.exec(config)
    expect(match).not.toBeNull()
    const policy = match?.[1] ?? ''
    // Ezek a házirendek MEGTARTJÁK az origint kereszt-originű kérésnél is.
    expect(['strict-origin-when-cross-origin', 'strict-origin', 'origin', 'no-referrer-when-downgrade', 'unsafe-url']).toContain(policy)
  })

  it('a lejátszó iframe-je nem szigorít tovább saját referrerPolicy-val', () => {
    const player = readFileSync(
      new URL('../components/account/CoursePlayer.tsx', import.meta.url),
      'utf8',
    )
    expect(player).not.toMatch(/referrerPolicy/i)
  })
})
