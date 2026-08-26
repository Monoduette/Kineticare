import { BUNNY_PLAYERJS_SOURCE } from '../security/csp'

/**
 * Bunny hivatalos player.js betöltése — rögzített verzió, SRI. Tartalék: playerjs-client.ts.
 * Hash elavulásakor a script nem fut; frissítés emberi döntéssel. Megosztott promise:
 * a DOM-ba legfeljebb egyszer kerül be.
 */

/** A rögzített verziójú fájl teljes címe. */
export const PLAYERJS_URL = `${BUNNY_PLAYERJS_SOURCE}/playerjs/player-0.1.0.min.js`

/**
 * A fájl SHA-384 integritás-hash-e (2026-08-15, 13 693 bájt).
 * A fájl saját konstansai: `VERSION: "0.0.11"`, `CONTEXT: "player.js"`.
 */
export const PLAYERJS_INTEGRITY =
  'sha384-FzNVGZdy6ImmE/3LFewUFSxAVlmjM0wP4aKlUJYalPvzGkIEva94s2WZgmeQPVvC'

/** Ennyi idő után feladjuk a betöltést, és a tartalék útra váltunk. */
export const PLAYERJS_LOAD_TIMEOUT_MS = 8000

/** A `data-` jelölő, amivel a már beszúrt scriptet felismerjük. */
const SCRIPT_MARKER = 'data-kc-playerjs'

/**
 * A könyvtár által kirakott globális objektum MINIMÁLIS felülete — csak az,
 * amit használunk. A `playerjs.Player` egy iframe-elemet kap, és eseményekre
 * lehet feliratkozni rajta.
 */
export interface PlayerJsLibraryPlayer {
  on(event: 'ready', handler: () => void): void
  on(event: 'timeupdate', handler: (data: { seconds?: unknown; duration?: unknown }) => void): void
  on(event: 'ended', handler: () => void): void
  off?(event: string): void
}

export interface PlayerJsLibrary {
  Player: new (iframe: HTMLIFrameElement) => PlayerJsLibraryPlayer
}

/** A `window` MINIMÁLIS felülete — a modul így teszt alatt is használható. */
export interface PlayerJsLoaderWindow {
  playerjs?: unknown
  document: {
    querySelector(selectors: string): unknown
    createElement(tag: 'script'): PlayerJsScriptElement
    head: { appendChild(node: unknown): void }
  }
}

export interface PlayerJsScriptElement {
  src: string
  async: boolean
  integrity: string
  crossOrigin: string
  referrerPolicy: string
  setAttribute(name: string, value: string): void
  addEventListener(type: 'load' | 'error', handler: () => void): void
}

/** A globális objektum akkor használható, ha van rajta konstruálható `Player`. */
function asLibrary(value: unknown): PlayerJsLibrary | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const candidate = (value as { Player?: unknown }).Player
  return typeof candidate === 'function' ? (value as PlayerJsLibrary) : null
}

/**
 * Megosztott, EGYSZERI betöltés. A modul-szintű gyorsítótár szándékos: a
 * lejátszó minden lecke-váltásnál új hidat épít, de a könyvtárat csak egyszer
 * szabad letölteni.
 */
let betoltes: Promise<PlayerJsLibrary | null> | null = null

/**
 * A hivatalos könyvtár betöltése. SOSEM dob és SOSEM utasít el: sikertelen
 * betöltésnél `null`-lal tér vissza, hogy a hívó a tartalék útra válthasson.
 *
 * @param hostWindow injektálható ablak (teszt); alapértelmezésben a globális
 */
export function loadBunnyPlayerJs(
  hostWindow?: PlayerJsLoaderWindow | null,
): Promise<PlayerJsLibrary | null> {
  const win =
    hostWindow ??
    (typeof window === 'undefined' ? null : (window as unknown as PlayerJsLoaderWindow))
  if (win === null) {
    // Szerveroldali render: nincs mit betölteni.
    return Promise.resolve(null)
  }

  // Injektált ablakkal (teszt) SOSEM gyorsítótárazunk: az esetek nem
  // szennyezhetik egymást.
  if (hostWindow === undefined && betoltes !== null) {
    return betoltes
  }

  const futas = new Promise<PlayerJsLibrary | null>((resolve) => {
    const mar = asLibrary(win.playerjs)
    if (mar !== null) {
      resolve(mar)
      return
    }

    let lezart = false
    const befejez = (): void => {
      if (lezart) {
        return
      }
      lezart = true
      resolve(asLibrary(win.playerjs))
    }

    let script: PlayerJsScriptElement
    try {
      const meglevo = win.document.querySelector(`script[${SCRIPT_MARKER}]`)
      if (meglevo !== null && meglevo !== undefined) {
        // Egy másik példány már beszúrta: megvárjuk az időkorláttal.
        script = meglevo as PlayerJsScriptElement
      } else {
        script = win.document.createElement('script')
        script.src = PLAYERJS_URL
        script.async = true
        // A kettő EGYÜTT véd: a hash rögzíti a tartalmat, a crossOrigin pedig
        // ahhoz kell, hogy a böngésző egyáltalán ellenőrizhesse.
        script.integrity = PLAYERJS_INTEGRITY
        script.crossOrigin = 'anonymous'
        // A CDN-nek nem kell tudnia, melyik aloldalunkról tölt a vevő.
        script.referrerPolicy = 'no-referrer'
        script.setAttribute(SCRIPT_MARKER, 'true')
        win.document.head.appendChild(script)
      }
      script.addEventListener('load', befejez)
      // Integritás-hiba, hálózati hiba, blokkoló bővítmény — mind ide fut.
      script.addEventListener('error', befejez)
    } catch {
      // A DOM-műveletek hibája sem akaszthatja meg a lejátszást.
      befejez()
      return
    }

    if (typeof setTimeout === 'function') {
      setTimeout(befejez, PLAYERJS_LOAD_TIMEOUT_MS)
    }
  })

  if (hostWindow === undefined) {
    betoltes = futas
  }
  return futas
}

/** Teszt-segéd: a megosztott gyorsítótár ürítése. */
export function resetPlayerJsLoaderForTests(): void {
  betoltes = null
}
