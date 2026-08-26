import { BUNNY_STREAM_IFRAME_SOURCE } from '../security/csp'

/**
 * Minimális player.js kliens — tartalék, ha a hivatalos script nem töltődik be.
 * Origin-szűrés; `dispose()` kötelező. Referrer-policy: `no-referrer` kikapcsolja a haladás-jelölést.
 */

/** A protokoll névtere — minden üzenet ezzel azonosítja magát. */
export const PLAYER_JS_CONTEXT = 'player.js'

/** A specifikáció verziója, ahogy a hivatalos kliens is küldi. */
export const PLAYER_JS_VERSION = '0.0.11'

/** A saját listener-azonosítóink előtagja (a hibakeresést könnyíti). */
export const PLAYER_JS_LISTENER_PREFIX = 'kc-playerjs'

/**
 * A `timeupdate` esemény hasznos tartalma.
 *
 * A `duration` `null`, ha a lejátszó nem adott értelmes hosszt (0, hiányzó vagy
 * nem szám). Így a fogyasztó (a megnézett-arány követő) nem kap hamis nevezőt.
 */
export interface PlayerTimeUpdate {
  readonly seconds: number
  readonly duration: number | null
}

/**
 * A `message` esemény MINIMÁLIS alakja. Szándékosan nem a DOM `MessageEvent`
 * típusa: így a modul környezet-független marad, és a teszt egyszerű objektummal
 * tud eseményt küldeni. A valódi `MessageEvent` szerkezetileg megfelel ennek.
 */
export interface PlayerJsMessageEvent {
  readonly origin: string
  readonly data: unknown
  readonly source?: unknown
}

/** A `message` eseményre feliratkozó ablak minimális felülete. */
export interface PlayerJsHostWindow {
  addEventListener(type: 'message', listener: (event: PlayerJsMessageEvent) => void): void
  removeEventListener(type: 'message', listener: (event: PlayerJsMessageEvent) => void): void
}

/** A beágyazott lejátszó ablakának minimális felülete. */
export interface PlayerJsFrameWindow {
  postMessage(message: string, targetOrigin: string): void
}

/**
 * Az iframe minimális felülete. A valódi `HTMLIFrameElement` megfelel neki,
 * de a teszt is tud könnyű helyettesítőt adni.
 *
 * A `load` eseményre azért iratkozunk fel, mert a feliratkozásunk CSAK akkor ér
 * célba, ha a keretben már a Bunny dokumentuma fut (lásd a `subscribe`
 * ismétlését lentebb). Az `addEventListener` opcionális: a régi tesztek és a
 * DOM nélküli környezetek így változatlanul működnek.
 */
export interface PlayerJsFrame {
  readonly contentWindow: PlayerJsFrameWindow | null
  addEventListener?(type: 'load', listener: () => void): void
  removeEventListener?(type: 'load', listener: () => void): void
}

export interface BunnyPlayerBridgeOptions {
  /** A Bunny-lejátszót tartalmazó iframe. */
  iframe: PlayerJsFrame
  /** A lejátszó készen áll — innentől érkeznek az események. */
  onReady?: () => void
  /** Lejátszási pozíció változott. */
  onTimeUpdate?: (update: PlayerTimeUpdate) => void
  /** A videó végigfutott. */
  onEnded?: () => void
  /** Nem várt hiba (hibás üzenet, dobó callback). Naplózás a hívó dolga. */
  onError?: (error: unknown) => void
  /**
   * Az az ablak, amelyen a `message` események érkeznek. Alapértelmezésben a
   * globális `window`; ha nincs (szerveroldali render, teszt), a híd NO-OP.
   */
  hostWindow?: PlayerJsHostWindow
}

export interface BunnyPlayerBridge {
  /** Leiratkozás. Többszöri hívás biztonságos. */
  dispose(): void
}

/**
 * Az általunk figyelt események.
 *
 * A `ready` SZÁNDÉKOSAN benne van, pedig a spec szerint a lejátszó kéretlenül is
 * elküldi: nem építhetünk arra, hogy a Bunny éles lejátszója valóban broadcastol
 * — ha csak a rá FELIRATKOZÓKNAK küldi, a feliratkozás nélkül soha nem tudnánk
 * meg, mikor lehet a többi eseményre feliratkozni. A dupla `ready` ártalmatlan:
 * a kezelője idempotens (újrafeliratkozás + `onReady`).
 */
const SUBSCRIBED_EVENTS = ['ready', 'timeupdate', 'ended'] as const

/**
 * Két feliratkozási kísérlet között ennyi idő telik el.
 *
 * MIÉRT KELL EGYÁLTALÁN ISMÉTELNI: a híd a lecke betöltésével EGYSZERRE épül fel,
 * ilyenkor az iframe még `about:blank`-en áll, tehát a pontos célorigint megkövetelő
 * `postMessage` NÉMÁN elvész — mérve: a keret ilyenkor NULLA üzenetet kap. Enélkül az
 * egész automatikus haladás-jelölés a lejátszó kéretlen `ready` broadcastjára lenne
 * felfüggesztve, ami egy KÜLSŐ szolgáltató nem dokumentált viselkedése.
 */
export const SUBSCRIBE_RETRY_INTERVAL_MS = 750

/**
 * Legfeljebb ennyi ismétlés (≈15 másodperc). Efölött a lejátszó vagy nem is
 * player.js-képes, vagy a keret sosem töltődött be — a további üzenetküldés
 * csak zaj lenne. A vevő ilyenkor a kézi gombbal jelöl, ami végig ott van.
 */
export const SUBSCRIBE_MAX_ATTEMPTS = 20

interface PlayerJsEventMessage {
  readonly event: string
  readonly listener: string | null
  readonly value: unknown
}

/**
 * Folyamatosan növekvő számláló a listener-azonosítókhoz. Szándékosan NEM
 * véletlenszám: így a viselkedés determinisztikus és tesztelhető, az egyediséget
 * pedig a monoton növekedés garantálja egy dokumentumon belül.
 */
let listenerCounter = 0

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * A nyers `event.data` értelmezése. A gyermek-keret küldhet JSON-SZÖVEGET (így
 * teszi a hivatalos kliens is) vagy kész objektumot — mindkettőt elfogadjuk,
 * de csak akkor, ha a `context` a miénk és van esemény-név.
 */
function parsePlayerJsMessage(raw: unknown): PlayerJsEventMessage | null {
  let payload: unknown = raw
  if (typeof raw === 'string') {
    try {
      payload = JSON.parse(raw)
    } catch {
      // Nem a mi üzenetünk (vagy sérült) — csendben eldobjuk.
      return null
    }
  }
  if (!isRecord(payload)) {
    return null
  }
  if (payload.context !== PLAYER_JS_CONTEXT) {
    return null
  }
  const eventName = payload.event
  if (typeof eventName !== 'string' || eventName.length === 0) {
    return null
  }
  const listener = payload.listener
  return {
    event: eventName,
    listener: typeof listener === 'string' && listener.length > 0 ? listener : null,
    value: payload.value,
  }
}

/** Pozitív, véges hossz; minden más → null (lásd `PlayerTimeUpdate.duration`). */
function parseDuration(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function parseTimeUpdate(value: unknown): PlayerTimeUpdate | null {
  if (!isRecord(value)) {
    return null
  }
  const seconds = value.seconds
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return null
  }
  return { seconds, duration: parseDuration(value.duration) }
}

/** A globális `window`, ha van és használható — egyébként null (SSR/teszt). */
function resolveHostWindow(explicit?: PlayerJsHostWindow): PlayerJsHostWindow | null {
  if (explicit !== undefined) {
    return explicit
  }
  const candidate = (globalThis as { window?: unknown }).window
  if (!isRecord(candidate)) {
    return null
  }
  const { addEventListener, removeEventListener } = candidate
  if (typeof addEventListener !== 'function' || typeof removeEventListener !== 'function') {
    return null
  }
  return candidate as unknown as PlayerJsHostWindow
}

/**
 * player.js híd: message + iframe load + ready + retry — bármelyik elég a feliratkozáshoz.
 * @returns dispose() unmountnál kötelező.
 */
export function createBunnyPlayerBridge(options: BunnyPlayerBridgeOptions): BunnyPlayerBridge {
  const { iframe, onReady, onTimeUpdate, onEnded, onError } = options
  const hostWindow = resolveHostWindow(options.hostWindow)

  listenerCounter += 1
  const listenerId = `${PLAYER_JS_LISTENER_PREFIX}-${listenerCounter}`

  let disposed = false

  const reportError = (error: unknown): void => {
    if (onError === undefined) {
      return
    }
    try {
      onError(error)
    } catch {
      // A hibakezelő hibája már tényleg nem vihet el semmit.
    }
  }

  /** Callback-hívás úgy, hogy a dobott hiba SOHA ne jusson ki a listenerből. */
  const safeInvoke = (callback: (() => void) | undefined): void => {
    if (callback === undefined) {
      return
    }
    try {
      callback()
    } catch (error) {
      reportError(error)
    }
  }

  const send = (method: string, value?: string): void => {
    const frameWindow = iframe.contentWindow
    if (frameWindow === null) {
      return
    }
    try {
      frameWindow.postMessage(
        JSON.stringify({
          context: PLAYER_JS_CONTEXT,
          version: PLAYER_JS_VERSION,
          method,
          value,
          listener: listenerId,
        }),
        // SOHA nem '*': az üzenet csak a Bunny-originnek szólhat.
        BUNNY_STREAM_IFRAME_SOURCE,
      )
    } catch (error) {
      reportError(error)
    }
  }

  const subscribe = (): void => {
    for (const eventName of SUBSCRIBED_EVENTS) {
      send('addEventListener', eventName)
    }
  }

  /**
   * Igaz, amint a kerettől ÉRVÉNYES player.js üzenetet kaptunk. Ez az egyetlen
   * megbízható jel arra, hogy a feliratkozás célba ért — a `postMessage` maga
   * nem nyugtázott.
   */
  let hallottukAKeretet = false
  let ujraprobaTimer: ReturnType<typeof setTimeout> | null = null
  let probalkozasok = 0

  const ismetlestLeallit = (): void => {
    if (ujraprobaTimer !== null) {
      clearTimeout(ujraprobaTimer)
      ujraprobaTimer = null
    }
  }

  /** Korlátos ismétlés — csak addig, amíg a keret meg nem szólal. */
  const ismetlestUtemez = (): void => {
    if (
      disposed ||
      hallottukAKeretet ||
      ujraprobaTimer !== null ||
      probalkozasok >= SUBSCRIBE_MAX_ATTEMPTS ||
      typeof setTimeout !== 'function'
    ) {
      return
    }
    probalkozasok += 1
    ujraprobaTimer = setTimeout(() => {
      ujraprobaTimer = null
      if (disposed || hallottukAKeretet) {
        return
      }
      subscribe()
      ismetlestUtemez()
    }, SUBSCRIBE_RETRY_INTERVAL_MS)
  }

  /** Az iframe betöltődött: a keretben MÁR a lejátszó fut, most ér célba a kérés. */
  const handleFrameLoad = (): void => {
    if (disposed) {
      return
    }
    subscribe()
  }

  const handleMessage = (event: PlayerJsMessageEvent): void => {
    try {
      if (disposed) {
        return
      }
      // 1. ORIGIN — ez a legfontosabb szűrő: idegen keret nem hamisíthat haladást.
      if (event.origin !== BUNNY_STREAM_IFRAME_SOURCE) {
        return
      }
      // Kiegészítő szűrés: ha ismerjük az iframe ablakát és az üzenet mást
      // nevez meg forrásként, nem a mi lejátszónkról jött (több lejátszó egy
      // oldalon, vagy azonos originű, de idegen keret).
      const frameWindow = iframe.contentWindow
      if (
        frameWindow !== null &&
        event.source !== undefined &&
        event.source !== null &&
        event.source !== frameWindow
      ) {
        return
      }

      const message = parsePlayerJsMessage(event.data)
      if (message === null) {
        return
      }

      // A keret megszólalt: a feliratkozás célba ért, az ismétlés fölösleges.
      // BÁRMELYIK érvényes player.js üzenet elég jelnek — akkor is, ha az adott
      // eseménnyel nem foglalkozunk (play, pause, seeked…).
      hallottukAKeretet = true
      ismetlestLeallit()

      // 2. A `listener` visszhang: ha meg van adva és NEM a miénk, az üzenet egy
      // másik feliratkozónak szól. A `ready` kivétel — azt a lejátszó magától,
      // a mi feliratkozásunk előtt küldi.
      if (
        message.event !== 'ready' &&
        message.listener !== null &&
        message.listener !== listenerId
      ) {
        return
      }

      switch (message.event) {
        case 'ready': {
          subscribe()
          safeInvoke(onReady)
          return
        }
        case 'timeupdate': {
          const update = parseTimeUpdate(message.value)
          if (update === null) {
            return
          }
          if (onTimeUpdate !== undefined) {
            try {
              onTimeUpdate(update)
            } catch (error) {
              reportError(error)
            }
          }
          return
        }
        case 'ended': {
          safeInvoke(onEnded)
          return
        }
        default:
          // Minden más player.js esemény (play, pause, seeked, error…) minket
          // nem érdekel — a haladás-jelöléshez nem kell.
          return
      }
    } catch (error) {
      // 3. A híd SOSE dobjon: egy hibás üzenet nem akaszthatja meg a lejátszást.
      reportError(error)
    }
  }

  if (hostWindow === null) {
    // Szerveroldali render vagy `window` nélküli környezet: a híd nem csinál
    // semmit, de a szerződése (dispose) érvényes marad.
    return {
      dispose(): void {
        disposed = true
      },
    }
  }

  hostWindow.addEventListener('message', handleMessage)
  // A keret `load`-ja a legmegbízhatóbb jel; ha az elem nem támogatja (teszt,
  // DOM nélküli környezet), az ismétlés akkor is elviszi a feliratkozást.
  try {
    iframe.addEventListener?.('load', handleFrameLoad)
  } catch (error) {
    reportError(error)
  }
  subscribe()
  ismetlestUtemez()

  return {
    dispose(): void {
      if (disposed) {
        return
      }
      disposed = true
      ismetlestLeallit()
      try {
        hostWindow.removeEventListener('message', handleMessage)
      } catch (error) {
        reportError(error)
      }
      try {
        iframe.removeEventListener?.('load', handleFrameLoad)
      } catch (error) {
        reportError(error)
      }
    },
  }
}
