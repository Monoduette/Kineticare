import { bp as barionPixelCall, getBarionPixelId } from './barion-pixel'
import { CONSENT_DENIED, CONSENT_GRANTED, type ConsentState } from './consent'

/**
 * Barion marketing consent jelzés (grant/reject) — az alap pixel külön modulban, mindig betölt.
 * sendBarionConsent újrapróbál, ha a bp még nincs az ablakon.
 */

/** A Barion Pixel consent-parancsának témája (a hívás első argumentuma). */
export const BARION_CONSENT_TOPIC = 'consent'

/** Elfogadás — a marketing célú felhasználás engedélyezése. */
export const BARION_GRANT_CONSENT = 'grantConsent'
/** Elutasítás — a marketing célú felhasználás megtiltása (a jelzés KIMEGY). */
export const BARION_REJECT_CONSENT = 'rejectConsent'

export type BarionConsentCommand = typeof BARION_GRANT_CONSENT | typeof BARION_REJECT_CONSENT

/** A pixel hívó-függvényének alakja (tesztben injektálható). */
export type BarionPixelCaller = (...args: readonly unknown[]) => void

/** A globális névtér, amibe a pixel a `bp` függvényt telepíti (böngészőben a window). */
export interface BarionGlobalScope {
  bp?: unknown
}

/**
 * Consent állapot → Barion-parancs. 'unknown' esetén NINCS parancs: amíg a
 * látogató nem döntött, nem állíthatunk sem elfogadást, sem elutasítást.
 */
export function barionConsentCommand(state: ConsentState): BarionConsentCommand | null {
  if (state === CONSENT_GRANTED) {
    return BARION_GRANT_CONSENT
  }
  if (state === CONSENT_DENIED) {
    return BARION_REJECT_CONSENT
  }
  return null
}

/** Használható-e már a pixel `bp` függvénye (SSR-ben és betöltés előtt nem). */
export function isBarionPixelReady(scope?: BarionGlobalScope): boolean {
  const resolved =
    scope ?? (typeof window !== 'undefined' ? (window as unknown as BarionGlobalScope) : undefined)
  return typeof resolved?.bp === 'function'
}

/** Be van-e állítva pixel-azonosító (enélkül egyetlen jelzés sem megy ki). */
export function isBarionPixelConfigured(pixelId: string | null): boolean {
  return typeof pixelId === 'string' && pixelId.trim().length > 0
}

export interface BarionConsentOptions {
  /** Injektált hívó (teszt). Ha megadott, a `bp` készenlétét nem vizsgáljuk. */
  readonly bp?: BarionPixelCaller
  /** Injektált pixel-azonosító; ha nincs megadva, a modul a beállítottat olvassa. */
  readonly pixelId?: string | null
  /** Injektált globális névtér a készenlét-vizsgálathoz (teszt). */
  readonly scope?: BarionGlobalScope
}

/**
 * A tényleges hívó feloldása, sorrendben: injektált hívó → injektált globális
 * névtér `bp`-je → a valódi (ablakra kötött) pixel-hívó. `null`, ha a pixel
 * még nem áll készen. Az injektált névteret azért hívjuk közvetlenül, mert a
 * valódi hívó mindig a `window`-ból dolgozik — az teszt-környezetben nincs.
 */
function resolveBarionCaller(options: BarionConsentOptions): BarionPixelCaller | null {
  if (options.bp !== undefined) {
    return options.bp
  }
  if (options.scope !== undefined) {
    const candidate = options.scope.bp
    return typeof candidate === 'function' ? (candidate as BarionPixelCaller) : null
  }
  return isBarionPixelReady() ? barionPixelCall : null
}

/**
 * A hozzájárulás EGYSZERI jelzése a pixelnek.
 *
 * Visszatérés: kiment-e a hívás. `false`, ha (a) nincs döntés ('unknown'),
 * (b) nincs beállítva pixel-azonosító, vagy (c) a `bp` még nem áll készen.
 * Sosem dob: a mérés/marketing nem ronthatja el a vevői felületet.
 */
export function applyConsentToBarionPixel(
  state: ConsentState,
  options: BarionConsentOptions = {},
): boolean {
  const command = barionConsentCommand(state)
  if (command === null) {
    return false
  }
  const pixelId = options.pixelId === undefined ? getBarionPixelId() : options.pixelId
  if (!isBarionPixelConfigured(pixelId)) {
    return false
  }
  const call = resolveBarionCaller(options)
  if (call === null) {
    return false
  }
  try {
    call(BARION_CONSENT_TOPIC, command)
    return true
  } catch {
    return false
  }
}

/** Két újrapróbálkozás közti szünet (ms). */
export const BARION_CONSENT_RETRY_MS = 300
/** Legfeljebb ennyi próbálkozás (az elsővel együtt) — kb. 6 másodperc. */
export const BARION_CONSENT_MAX_ATTEMPTS = 20

/**
 * Időzítő-absztrakció: kap egy visszahívást és egy késleltetést, ad egy
 * LEMONDÓ függvényt. Azért így, mert a setTimeout azonosítójának típusa
 * böngészőben és Node-ban különbözik — a lemondó függvény mindkettőt elrejti.
 */
export type BarionConsentScheduler = (callback: () => void, delayMs: number) => () => void

export const defaultBarionConsentScheduler: BarionConsentScheduler = (callback, delayMs) => {
  if (typeof setTimeout !== 'function') {
    return () => undefined
  }
  const handle = setTimeout(callback, delayMs)
  return () => {
    clearTimeout(handle)
  }
}

export interface BarionConsentSendOptions extends BarionConsentOptions {
  readonly schedule?: BarionConsentScheduler
  readonly retryMs?: number
  readonly maxAttempts?: number
}

/**
 * A hozzájárulás jelzése, korlátozott újrapróbálkozással (a pixel `bp`
 * függvénye a mi effektünk után is megjelenhet). Visszatérés: LEMONDÓ
 * függvény — a komponens takarításában hívandó, hogy a lecserélt döntéshez
 * tartozó függő próbálkozás ne éledjen újra.
 */
export function sendBarionConsent(
  state: ConsentState,
  options: BarionConsentSendOptions = {},
): () => void {
  const noop = (): void => undefined
  if (barionConsentCommand(state) === null) {
    return noop
  }
  const pixelId = options.pixelId === undefined ? getBarionPixelId() : options.pixelId
  if (!isBarionPixelConfigured(pixelId)) {
    // Beállított azonosító nélkül nincs mit jelezni — újrapróbálni is fölösleges.
    return noop
  }
  const schedule = options.schedule ?? defaultBarionConsentScheduler
  const retryMs = options.retryMs ?? BARION_CONSENT_RETRY_MS
  const maxAttempts = options.maxAttempts ?? BARION_CONSENT_MAX_ATTEMPTS
  const attemptOptions: BarionConsentOptions = { ...options, pixelId }

  let cancelPending: (() => void) | null = null
  let cancelled = false
  let attempts = 0

  const attempt = (): void => {
    if (cancelled) {
      return
    }
    attempts += 1
    if (applyConsentToBarionPixel(state, attemptOptions)) {
      return
    }
    if (attempts >= maxAttempts) {
      return
    }
    cancelPending = schedule(attempt, retryMs)
  }

  attempt()

  return () => {
    cancelled = true
    if (cancelPending !== null) {
      cancelPending()
      cancelPending = null
    }
  }
}
