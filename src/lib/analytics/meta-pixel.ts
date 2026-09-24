import { CONSENT_DENIED, CONSENT_GRANTED, readConsent, type ConsentState } from './consent'
import { sanitizeAnalyticsUrl } from './page-url'

/**
 * Meta (Facebook) Pixel — consent-first, a GA4 (ga4.ts) mintájára.
 *
 * - Pixel-azonosító nélkül (NEXT_PUBLIC_META_PIXEL_ID) minden hívás no-op, a
 *   CSP sem nyílik meg (csp.ts). A modul tehát az azonosító beállításáig inert.
 * - Az fbevents.js KIZÁRÓLAG 'granted' hozzájárulás után töltődik be. Elutasító
 *   vagy még nem döntött látogatónál a Meta felé semmi nem megy ki.
 * - Visszavonás: `fbq('consent', 'revoke')` — a Meta által dokumentált leállítás;
 *   újra-engedélyezéskor `fbq('consent', 'grant')`.
 * - `autoConfig: false`: a Pixel NEM gyűjt automatikusan gombfeliratot és
 *   űrlap-metaadatot. Csak a kifejezetten küldött események mennek ki.
 * - Jegyes (token) URL-en a Pixel nem indul el: az fbevents.js a teljes
 *   document.location-t küldené (ugyanaz a védelem, mint a GA4 page_location
 *   tisztítása, ./page-url.ts).
 * - Az események csak nem személyes adatot visznek (termék-id, ár, pénznem,
 *   lead-forrás címke). Név, e-mail, telefonszám SOHA nem kerül a Pixelbe.
 */

/** Az fbevents.js kiszolgálója (CSP script-src). */
export const META_PIXEL_SCRIPT_ORIGIN = 'https://connect.facebook.net'

/** Az fbevents.js betöltési URL-je (a hivatalos snippet `src`-je). */
export const META_PIXEL_SCRIPT_SRC = `${META_PIXEL_SCRIPT_ORIGIN}/en_US/fbevents.js`

/** A Pixel gyűjtővégpontja (`/tr`): CSP img-src és connect-src. */
export const META_PIXEL_COLLECT_ORIGIN = 'https://www.facebook.com'

/**
 * A Pixel-azonosító megengedett alakja: 10–20 számjegy (a Meta a Pixel- /
 * adathalmaz-azonosítót tisztán számként adja ki, jellemzően 15–16 jegyű).
 * Az azonosító a scriptbe és a hívásokba kerül, ezért szigorú minta őrzi.
 */
const META_PIXEL_ID_PATTERN = /^\d{10,20}$/

/** Nyers env-érték → szabályos azonosító, vagy üres string. */
export function normalizeMetaPixelId(raw: string | undefined): string {
  const candidate = (typeof raw === 'string' ? raw : '').trim()
  return META_PIXEL_ID_PATTERN.test(candidate) ? candidate : ''
}

/**
 * A build-időben beégetett azonosító. A `process.env.NEXT_PUBLIC_META_PIXEL_ID`
 * SZÓ SZERINTI hivatkozás kell, a Next.js csak így égeti be a kliens-csomagba.
 */
export const META_PIXEL_ID = normalizeMetaPixelId(process.env.NEXT_PUBLIC_META_PIXEL_ID)

/** Van-e érvényes azonosító (enélkül minden hívás no-op). */
export function isMetaPixelConfigured(): boolean {
  return META_PIXEL_ID.length > 0
}

/** A Meta szabványos eseményei, amelyeket küldünk. */
export type MetaStandardEvent = 'PageView' | 'ViewContent' | 'InitiateCheckout' | 'Lead'

/** Az események paraméterei (csak nem személyes adat). */
export interface MetaEventParams {
  readonly value?: number
  readonly currency?: string
  readonly content_ids?: readonly string[]
  readonly content_type?: 'product'
  readonly content_name?: string
  readonly num_items?: number
}

/** A globális névtér (böngészőben a window). */
export interface MetaGlobalScope {
  [key: string]: unknown
}

/** Injektálható futtatókörnyezet — a modul így böngésző nélkül is tesztelhető. */
export interface MetaRuntime {
  readonly pixelId: string
  readonly globals: MetaGlobalScope
  /** Az aktuális oldal címe (böngészőben window.location.href). */
  readonly href: string | null
  loadScript(src: string): void
}

/** Böngésző-oldali futtatókörnyezet; szerveren `undefined`. */
export function browserMetaRuntime(): MetaRuntime | undefined {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return undefined
  }
  return {
    pixelId: META_PIXEL_ID,
    globals: window as unknown as MetaGlobalScope,
    href: typeof window.location?.href === 'string' ? window.location.href : null,
    loadScript(src: string): void {
      const script = document.createElement('script')
      script.async = true
      script.src = src
      document.head.appendChild(script)
    },
  }
}

type FbqFunction = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void
  queue: unknown[]
  push?: unknown
  loaded?: boolean
  version?: string
  disablePushState?: boolean
}

/**
 * Útvonalak, ahol a Meta Pixel SEMMIT nem küld. Az fbevents.js minden
 * eseményhez a teljes document.location-t csatolja, ezek a lapok pedig
 * - tranzakció- vagy fiókazonosítót hordoznak a címükben: a Barion-visszatérés
 *   (`/fizetes/koszonom?order=…&paymentId=…`), a sikertelen fizetés, a
 *   jelszó-visszaállítás, a belépés és a regisztráció (a `returnUrl` a védett
 *   célt hordozza);
 * - vagy a BELÉPETT vevő saját területei: a `/kurzusaim` (a megvásárolt
 *   rehabilitációs kurzus lejátszója) és a `/fiok`. Ezek címe azt árulná el,
 *   hogy az adott ember melyik kezelési programot vette meg.
 * A nyilvános kurzusoldalak (`/kurzusok/…`) mérhetők: ugyanazt a tartalmat
 * bárki megnézheti, a hirdetések is oda visznek, a megtekintés nem jelent
 * vásárlást vagy állapotot.
 */
export const META_BLOCKED_PATH_PREFIXES: readonly string[] = [
  '/fizetes/',
  '/sikertelen',
  '/jelszo-visszaallitas',
  '/elfelejtett-jelszo',
  // A /belepes a /belepes-atallas-t is lefedi. A belépő- és regisztrációs lap
  // `returnUrl`-je a védett célt (pl. /kurzusaim/7) hordozza.
  '/belepes',
  '/regisztracio',
  '/kurzusaim',
  '/fiok',
]

/** Query-paraméterek, amelyek jelenléte esetén a cím nem mehet a Metának. */
const META_BLOCKED_QUERY_PARAMS: readonly string[] = ['order', 'paymentid', 'returnurl', 'vissza']

/**
 * Biztonságos-e a cím a Meta felé: ismert, nem tiltott útvonal, és nem hordoz
 * jegyet (token), rendelés- vagy fizetésazonosítót. Ismeretlen vagy nem
 * értelmezhető cím NEM biztonságos: jobb nem mérni, mint azonosítót küldeni.
 */
export function isMetaSafeUrl(href: string | null): boolean {
  if (href === null || href.length === 0) {
    return false
  }
  if (sanitizeAnalyticsUrl(href) !== stripHash(href)) {
    return false
  }
  let url: URL
  try {
    url = new URL(href, 'https://www.kineticare.hu')
  } catch {
    return false
  }
  const path = url.pathname.toLowerCase()
  if (META_BLOCKED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return false
  }
  for (const key of url.searchParams.keys()) {
    if (META_BLOCKED_QUERY_PARAMS.includes(key.toLowerCase())) {
      return false
    }
  }
  return true
}

/**
 * A parancs `arguments`-alakúra csomagolása. A hivatalos snippet a nyers
 * `arguments` objektumot sorolja a `fbq.queue`-ba, az fbevents.js erre az
 * alakra épül (ugyanaz a helyzet, mint a gtag dataLayerével, ga4.ts).
 */
const toFbqArguments: (...args: unknown[]) => IArguments = function (): IArguments {
  // eslint-disable-next-line prefer-rest-params
  return arguments
}

/**
 * A hivatalos snippet `fbq` sorbaállítója. Meglévő `fbq`-t (más beágyazásból)
 * nem ír felül.
 */
function ensureFbq(globals: MetaGlobalScope): FbqFunction {
  const existing = globals.fbq
  if (typeof existing === 'function') {
    return existing as FbqFunction
  }
  const fbq = function (...args: unknown[]): void {
    if (typeof fbq.callMethod === 'function') {
      fbq.callMethod(...args)
      return
    }
    fbq.queue.push(toFbqArguments(...args))
  } as FbqFunction
  fbq.queue = []
  fbq.push = fbq
  fbq.loaded = true
  fbq.version = '2.0'
  // Az fbevents.js magától PageView-t küldene minden history-váltásnál (a
  // cím ellenőrzése nélkül). Ezt kikapcsoljuk: az SPA-navigáció PageView-ját
  // a MetaPixel.tsx küldi, címellenőrzéssel.
  fbq.disablePushState = true
  globals.fbq = fbq
  if (globals._fbq === undefined) {
    globals._fbq = fbq
  }
  return fbq
}

/** Elindult-e már a Pixel (init + script-betöltés). Modulszintű, mint a GA4-nél. */
let pixelStarted = false
/** Él-e most a mérés (granted és nem visszavont). */
let pixelActive = false
/**
 * Az ebben a munkamenetben kapott döntés (a ConsentBanner eseményéből). Akkor
 * is számít, ha a tároló nem írható, és akkor is, ha a Pixel a döntés
 * pillanatában tiltott oldalon volt, ezért nem indulhatott el.
 */
let sessionConsent: ConsentState | null = null

/** Tesztelési és diagnosztikai segéd. */
export function isMetaPixelActive(): boolean {
  return pixelActive
}

/**
 * A Pixel BEkapcsolása 'granted' hozzájárulás mellett.
 *
 * Első hívásra: `autoConfig` ki, `init`, `PageView`, majd az fbevents.js
 * betöltése (a parancsok a betöltés előtt sorba állnak). Későbbi hívásra
 * (visszavonás utáni újra-engedélyezés) csak `consent: grant`.
 *
 * @returns él-e a mérés a hívás után.
 */
export function enableMetaPixel(runtime?: MetaRuntime): boolean {
  const resolved = runtime ?? browserMetaRuntime()
  if (!resolved) {
    return false
  }
  const pixelId = normalizeMetaPixelId(resolved.pixelId)
  if (pixelId.length === 0) {
    return false
  }

  if (pixelStarted) {
    if (!pixelActive) {
      ensureFbq(resolved.globals)('consent', 'grant')
      pixelActive = true
    }
    return true
  }

  // Jegyes (vagy ismeretlen) címen nem indulunk: az fbevents.js a teljes címet küldené.
  if (!isMetaSafeUrl(resolved.href)) {
    return false
  }

  const fbq = ensureFbq(resolved.globals)
  fbq('set', 'autoConfig', false, pixelId)
  fbq('init', pixelId)
  fbq('track', 'PageView')

  // A jelzők a betöltés ELŐTT állnak át: egy dobó betöltő sem okozhat
  // végtelen újrapróbálkozást vagy dupla <script>-et.
  pixelStarted = true
  pixelActive = true
  resolved.loadScript(META_PIXEL_SCRIPT_SRC)
  return true
}

function stripHash(url: string): string {
  const hashIndex = url.indexOf('#')
  return hashIndex === -1 ? url : url.slice(0, hashIndex)
}

/** A Pixel KIkapcsolása 'denied' mellett. Be nem töltött Pixelnél nincs teendő. */
export function disableMetaPixel(runtime?: MetaRuntime): void {
  pixelActive = false
  if (!pixelStarted) {
    return
  }
  const resolved = runtime ?? browserMetaRuntime()
  if (!resolved) {
    return
  }
  ensureFbq(resolved.globals)('consent', 'revoke')
}

/** A consent-állapotgép becsatlakozási pontja: granted → be, denied → ki. */
export function applyConsentToMetaPixel(state: ConsentState, runtime?: MetaRuntime): void {
  if (state === CONSENT_GRANTED || state === CONSENT_DENIED) {
    sessionConsent = state
  }
  if (state === CONSENT_GRANTED) {
    enableMetaPixel(runtime)
    return
  }
  if (state === CONSENT_DENIED) {
    disableMetaPixel(runtime)
  }
}

export interface MetaTrackOptions {
  /** Deduplikációs azonosító (pl. rendelésszám) — a Meta `eventID`-je. */
  readonly eventId?: string
  readonly runtime?: MetaRuntime
  /** Injektált consent-olvasó (teszt). Alapból a tárolt döntés. */
  readonly consent?: () => ConsentState
}

/**
 * Egy szabványos esemény küldése.
 *
 * Csak beállított azonosító ÉS tárolt 'granted' döntés mellett megy ki. Ha a
 * Pixel még nem indult el (pl. a gyermek-komponens effektje a layout
 * MetaPixel-effektje előtt fut), itt indul el — a hozzájárulás ekkor is
 * feltétel. SOSEM dob: a mérés nem törheti meg a vásárlói folyamatot.
 */
export function trackMetaEvent(
  event: MetaStandardEvent,
  params: MetaEventParams = {},
  options: MetaTrackOptions = {},
): boolean {
  try {
    const runtime = options.runtime ?? browserMetaRuntime()
    if (!runtime || normalizeMetaPixelId(runtime.pixelId).length === 0) {
      return false
    }
    // A tárolt döntés mellett az ebben a munkamenetben adott hozzájárulás is
    // számít: ha a tároló nem írható, a ConsentBanner a döntést csak eseményben
    // szórja, és a MetaPixel-figyelő ebből indította el a Pixelt.
    const consent = options.consent ?? ((): ConsentState => sessionConsent ?? readConsent())
    if (consent() !== CONSENT_GRANTED) {
      return false
    }
    // MINDEN küldés előtt: az fbevents.js az AKTUÁLIS címet csatolja, ezért
    // jegyes oldalon (akár kliens-oldali navigáció után is) semmi nem megy ki.
    if (!isMetaSafeUrl(runtime.href)) {
      return false
    }
    const wasStarted = pixelStarted
    if (!enableMetaPixel(runtime)) {
      return false
    }
    // Az induló `enableMetaPixel` már küldött PageView-t: ne menjen ki kettő.
    if (event === 'PageView' && !wasStarted) {
      return true
    }
    const fbq = ensureFbq(runtime.globals)
    if (options.eventId !== undefined && options.eventId.length > 0) {
      fbq('track', event, { ...params }, { eventID: options.eventId })
    } else {
      fbq('track', event, { ...params })
    }
    return true
  } catch {
    return false
  }
}

/**
 * SPA-navigáció oldalmegtekintése. Az első oldal `PageView`-ját az
 * `enableMetaPixel` küldi, ezért a hívó (MetaPixel.tsx) az első útvonalat
 * kihagyja.
 */
export function trackMetaPageView(options: MetaTrackOptions = {}): boolean {
  return trackMetaEvent('PageView', {}, options)
}

/** Tesztelési segéd: a modulszintű állapot visszaállítása. */
export function resetMetaPixelForTests(): void {
  pixelStarted = false
  pixelActive = false
  sessionConsent = null
}
