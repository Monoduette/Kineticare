import { CONSENT_DENIED, CONSENT_GRANTED, type ConsentState } from './consent'
import { sanitizeAnalyticsUrl } from './page-url'

/**
 * GA4 (gtag.js) — consent-first, PostHog-minta. Betöltés csak `granted` után;
 * revoke: `ga-disable-<ID>`. Consent Mode: default denied, majd update. Kulcs
 * nélkül no-op. SPA pageview: Enhanced measurement (nincs kézi küldés).
 */

/** A gtag.js kiszolgálójának hostja (a CSP script-src forrása is ez). */
export const GA_TAG_MANAGER_ORIGIN = 'https://www.googletagmanager.com'

/**
 * A GA4 mérési azonosító megengedett alakja: `G-` + 4–24 alfanumerikus jel.
 *
 * A szigorú minta nem kozmetika: az azonosító a betöltött script URL-jébe és
 * egy globális kapcsoló nevébe kerül, ezért egy elgépelt vagy rosszindulatú
 * env-érték nem szivároghat be ellenőrzés nélkül. Formailag hibás érték esetén
 * a modul úgy viselkedik, mintha nem lenne beállítva (néma no-op).
 */
const MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,24}$/

/**
 * Nyers env-érték → szabályos mérési azonosító, vagy üres string, ha az érték
 * hiányzik vagy formailag hibás. (A GA4-azonosítók nagybetűsek, ezért a
 * kisbetűsen bemásolt értéket normalizáljuk, nem eldobjuk.)
 */
export function normalizeGaMeasurementId(raw: string | undefined): string {
  const candidate = (typeof raw === 'string' ? raw : '').trim().toUpperCase()
  return MEASUREMENT_ID_PATTERN.test(candidate) ? candidate : ''
}

/** A build-időben beégetett mérési azonosító (érvénytelen/hiányzó → üres). */
export const GA_MEASUREMENT_ID = normalizeGaMeasurementId(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID)

/** Van-e beállítva érvényes GA4-azonosító (enélkül minden hívás no-op). */
export function isGoogleAnalyticsConfigured(): boolean {
  return GA_MEASUREMENT_ID.length > 0
}

/** A gtag.js betöltési URL-je a megadott mérési azonosítóhoz. */
export function gaScriptUrl(measurementId: string): string {
  return `${GA_TAG_MANAGER_ORIGIN}/gtag/js?id=${encodeURIComponent(measurementId)}`
}

/**
 * A GA4 leállító globális kapcsolójának neve (`ga-disable-<ID>`). Ha ez az
 * ablakon `true`, a gtag.js semmit nem küld — ez a Google által dokumentált
 * kikapcsolási út.
 */
export function gaDisableFlag(measurementId: string): string {
  return `ga-disable-${measurementId}`
}

/** A gtag.js-hez szükséges minimális globális névtér (böngészőben a window). */
export interface GaGlobalScope {
  [key: string]: unknown
}

/**
 * A GA-futtatókörnyezet: mérési azonosító + globális névtér + script-betöltő.
 * Injektálható, ezért a modul node-környezetben, böngésző-API nélkül is
 * egységtesztelhető (ugyanaz a minta, mint a consent.ts tároló-injektálása).
 */
export interface GaRuntime {
  /** A használandó GA4 mérési azonosító. */
  readonly measurementId: string
  /** A globális névtér: ide kerül a `dataLayer` és a `ga-disable-<ID>` kapcsoló. */
  readonly globals: GaGlobalScope
  /** A gtag.js betöltése (böngészőben async `<script>` a `<head>`-be). */
  loadScript(src: string): void
}

/**
 * Böngésző-oldali futtatókörnyezet. Szerveren (SSR) `undefined` — így a modul
 * minden belépési pontja némán kilép, mielőtt bármihez hozzányúlna.
 */
export function browserGaRuntime(): GaRuntime | undefined {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return undefined
  }
  return {
    measurementId: GA_MEASUREMENT_ID,
    globals: window as unknown as GaGlobalScope,
    loadScript(src: string): void {
      const script = document.createElement('script')
      script.async = true
      script.src = src
      document.head.appendChild(script)
    },
  }
}

/**
 * A parancs `arguments`-alakúra csomagolása.
 *
 * A gtag.js hivatalos snippetje SZÓ SZERINT a nyers `arguments` objektumot
 * sorolja a dataLayerbe (`function gtag(){dataLayer.push(arguments)}`), és a
 * Google feldolgozója erre az alakra épül: egy sima tömböt NEM ismer fel
 * gtag-parancsként. Ezért nincs itt rest-paraméter — az tömbbé alakítaná.
 */
const toGtagArguments: (...args: unknown[]) => IArguments = function (): IArguments {
  /* A prefer-rest-params kikapcsolása szándékos — lásd a fenti magyarázatot. */
  // eslint-disable-next-line prefer-rest-params
  return arguments
}

/** A `dataLayer` sor feloldása (létrehozás, ha még nincs). */
function ensureDataLayer(globals: GaGlobalScope): unknown[] {
  const existing = globals.dataLayer
  if (Array.isArray(existing)) {
    return existing
  }
  const created: unknown[] = []
  globals.dataLayer = created
  return created
}

/** Egy gtag-parancs besorolása a dataLayerbe. */
function pushGtagCommand(globals: GaGlobalScope, ...command: unknown[]): void {
  ensureDataLayer(globals).push(toGtagArguments(...command))
}

/**
 * A globális `gtag(...)` függvény közzététele — a hivatalos snippet része,
 * és a böngésző-konzolos ellenőrzést (`gtag('event', …)`) is ez teszi
 * lehetővé. Meglévő `gtag`-ot (pl. más beágyazásból) nem ír felül.
 */
function ensureGtagGlobal(globals: GaGlobalScope): void {
  if (typeof globals.gtag === 'function') {
    return
  }
  globals.gtag = (...command: unknown[]): void => {
    pushGtagCommand(globals, ...command)
  }
}

/**
 * Consent Mode alapjelzés: induláskor MINDEN tároló tiltott. Ez akkor is
 * kimegy, amikor a látogató épp most adott hozzájárulást — a Google elvárása,
 * hogy a `default` legyen az első parancs, és csak utána jöjjön az `update`.
 */
const CONSENT_MODE_DEFAULT = {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
} as const

/** Hozzájárulás megadása: csak az analitikai tároló nyílik meg (hirdetési nem). */
const CONSENT_MODE_GRANTED = { analytics_storage: 'granted' } as const

/** Hozzájárulás visszavonása. */
const CONSENT_MODE_REVOKED = { analytics_storage: 'denied' } as const

/** Elindult-e már a gtag.js betöltése (idempotencia — modulszintű, mint a PostHognál). */
let scriptRequested = false

/**
 * A jelenlegi oldal címe a globális névtérből (böngészőben window.location.href).
 * Teszt-futtatókörnyezetben hiányozhat — ilyenkor null (a config-paraméter
 * elmarad, a gtag alapértelmezése lép).
 */
function currentLocationHref(globals: GaGlobalScope): string | null {
  const location = globals.location
  if (typeof location !== 'object' || location === null) {
    return null
  }
  const href = (location as { href?: unknown }).href
  return typeof href === 'string' && href.length > 0 ? href : null
}

/** Kérte-e már valaki a gtag.js betöltését (a provider és a tesztek használják). */
export function isGoogleAnalyticsLoaded(): boolean {
  return scriptRequested
}

/**
 * A mérés BEkapcsolása 'granted' consent mellett.
 *
 * Első hívásra betölti a gtag.js-t (a parancsok a betöltés ELŐTT sorba
 * állhatnak: a script indulásakor dolgozza fel a dataLayert). Későbbi
 * hívásra — tipikusan visszavonás utáni újra-engedélyezéskor — csak a
 * leállító kapcsolót oldja fel és frissíti a Consent Mode-ot; a script nem
 * töltődik be újra.
 *
 * @returns sikerült-e engedélyezni (kulcs nélkül vagy SSR-ben false).
 */
export function enableGoogleAnalytics(runtime?: GaRuntime): boolean {
  const resolved = runtime ?? browserGaRuntime()
  if (!resolved) {
    return false
  }
  const measurementId = normalizeGaMeasurementId(resolved.measurementId)
  if (measurementId.length === 0) {
    return false
  }

  // Korábbi visszavonás feloldása (a kapcsoló hiánya és a false ugyanaz).
  resolved.globals[gaDisableFlag(measurementId)] = false

  if (scriptRequested) {
    pushGtagCommand(resolved.globals, 'consent', 'update', CONSENT_MODE_GRANTED)
    return true
  }

  ensureGtagGlobal(resolved.globals)
  pushGtagCommand(resolved.globals, 'consent', 'default', CONSENT_MODE_DEFAULT)
  pushGtagCommand(resolved.globals, 'js', new Date())
  pushGtagCommand(resolved.globals, 'consent', 'update', CONSENT_MODE_GRANTED)

  // M9: a config-idejű (automatikus) page_view a TELJES document.location-t
  // küldené — a jelszó-visszaállító oldal jegyével együtt. A page_location
  // ezért MEGTISZTÍTVA megy (./page-url.ts: a jegy-paraméterek kivágva, a
  // kampány-attribúcióhoz kellő utm_* paraméterek megmaradnak). Ez CSAK a
  // config-idejű találatot alakítja: a history-alapú (SPA) page_view-oknál a
  // gtag enhanced measurement eseményszinten, az aktuális címmel tölti a
  // page_locationt — azok az URL-ek pedig szerkezetileg jegymentesek (a
  // tokenes oldal kizárólag levélből, teljes oldalletöltéssel érhető el).
  const href = currentLocationHref(resolved.globals)
  if (href !== null) {
    pushGtagCommand(resolved.globals, 'config', measurementId, {
      page_location: sanitizeAnalyticsUrl(href),
    })
  } else {
    pushGtagCommand(resolved.globals, 'config', measurementId)
  }

  // A jelző a betöltés ELŐTT áll át: így egy dobó betöltő sem indíthat
  // végtelen újrapróbálkozást, és nem kerülhet két <script> az oldalra.
  scriptRequested = true
  resolved.loadScript(gaScriptUrl(measurementId))
  return true
}

/**
 * A mérés KIkapcsolása 'denied' consent mellett.
 *
 * A `window['ga-disable-<ID>'] = true` kapcsoló a Google által dokumentált
 * leállítás: a már betöltött gtag.js ettől kezdve semmit nem küld, és ha a
 * script később mégis betöltődne, néma marad. Consent Mode-frissítést csak
 * akkor sorolunk be, ha a gtag már elindult — elutasító látogatónál NEM
 * hozunk létre `dataLayer`-t a semmiért.
 */
export function disableGoogleAnalytics(runtime?: GaRuntime): void {
  const resolved = runtime ?? browserGaRuntime()
  if (!resolved) {
    return
  }
  const measurementId = normalizeGaMeasurementId(resolved.measurementId)
  if (measurementId.length === 0) {
    return
  }

  resolved.globals[gaDisableFlag(measurementId)] = true

  if (scriptRequested) {
    pushGtagCommand(resolved.globals, 'consent', 'update', CONSENT_MODE_REVOKED)
  }
}

/**
 * A consent-állapotgép egyetlen becsatlakozási pontja: 'granted' → be,
 * 'denied' → ki, 'unknown' → semmi (a látogató még nem döntött).
 * A GoogleAnalytics komponens ezt hívja betöltéskor és a
 * 'kc:analytics-consent' eseményre is.
 */
export function applyConsentToGoogleAnalytics(state: ConsentState, runtime?: GaRuntime): void {
  if (state === CONSENT_GRANTED) {
    enableGoogleAnalytics(runtime)
    return
  }
  if (state === CONSENT_DENIED) {
    disableGoogleAnalytics(runtime)
  }
}

/** Tesztelési segéd: a betöltés-zárolt állapot visszaállítása. */
export function resetGoogleAnalyticsForTests(): void {
  scriptRequested = false
}
