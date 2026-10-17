import type { CaptureResult, PostHog, PostHogConfig, Properties } from 'posthog-js'

import {
  CONSENT_EVENT,
  CONSENT_GRANTED,
  CONSENT_STORAGE_KEY,
  dispatchConsentEvent,
  readConsent,
  writeConsent,
  type ConsentReader,
  type ConsentState,
} from './consent'
import { sanitizeAnalyticsUrl } from './page-url'
import {
  ANALYTICS_EVENTS,
  POSTHOG_API_HOST,
  POSTHOG_HOST,
  POSTHOG_KEY,
  type AnalyticsEventName,
} from './posthog-config'

/**
 * PostHog-integráció — központi konfig és esemény-névregiszter.
 *
 * Elvek:
 * - EU-cloud az alapértelmezett host (GDPR): https://eu.i.posthog.com.
 * - A kliens a /ingest elsőfél-proxyt használja (next.config.ts rewrites) —
 *   így a hívások első félként mennek ki (ad-blocker-ellenállóbb, és a
 *   PostHog-sütik first-partyként működnek).
 * - CONSENT-FIRST: a PostHog CSAK a látogató analytics-hozzájárulása után
 *   inicializálódik (kc_analytics_consent=granted). A jövőbeli consent-
 *   banner ezt a kulcsot írja, és 'kc:analytics-consent' eseményt szór —
 *   a provider erre (is) figyel.
 * - Kulcs nélkül a teljes analitika kikapcsolt (no-op) — ugyanaz a filozófia,
 *   mint az e-mail/Számlázz.hu opcionális integrációknál.
 */

/**
 * A TISZTA konstansok és az esemény-névregiszter a `./posthog-config.ts`-ben
 * élnek, mert az a modul nem importálja a böngésző-SDK-t — így a szerveroldali
 * hívó (src/lib/feedback/*) sem húzza be a `posthog-js`-t a Node-csomagba.
 * Innen VÁLTOZATLANUL re-exportáljuk, tehát minden meglévő importáló marad.
 */
export { ANALYTICS_EVENTS, POSTHOG_API_HOST, POSTHOG_HOST, POSTHOG_KEY }
export type { AnalyticsEventName }

/**
 * A consent-tárolókulcs és az eseménynév EGYETLEN igazságforrása a ./consent
 * modul (körmenti import elkerülésével) — innen re-exportáljuk a visszafelé
 * kompatibilitásért.
 */
export { CONSENT_EVENT, CONSENT_STORAGE_KEY }

/** Van-e beállítva PostHog-kulcs (kulcs nélkül minden no-op). */
export function isPostHogConfigured(): boolean {
  return POSTHOG_KEY.trim().length > 0
}

/**
 * A látogató hozzájárult-e az analyticshez. Csak kliens-oldalon értelmes
 * (szerveren mindig false → SSR-ben sosem indul a tracking).
 */
export function hasAnalyticsConsent(storage?: ConsentReader): boolean {
  // Egyetlen igazságforrás: a consent.ts állapotgépe (nincs párhuzamos logika).
  return readConsent(storage) === CONSENT_GRANTED
}

/** A posthog.init opciói (tiszta függvény — egységtesztelhető). */
export function buildPostHogOptions(): Partial<PostHogConfig> {
  return {
    api_host: POSTHOG_API_HOST,
    ui_host: POSTHOG_HOST,
    // Csak azonosított felhasználókról készül person-profil (anonim forgalom
    // nem generál profilt — költség- és adatminimalizálás).
    person_profiles: 'identified_only',
    // A $pageview-t manuálisan küldi a PostHogPageView (App Router route-figyeléssel).
    capture_pageview: false,
    capture_pageleave: true,
    persistence: 'localStorage+cookie',
    // MUNKAMENET-FELVÉTEL KIKAPCSOLVA — tulajdonosi döntés (2026-08-21):
    // „Csak események és funnelek." A felvétel a legnagyobb adatvédelmi
    // súlyú funkció (a látogató képernyőjét rögzíti), és külön jogi szöveget
    // kíván az adatkezelési tájékoztatóban — az pedig ma még a Barionról sem
    // rendelkezik, tehát a szöveg előbb ügyvédi kézre vár.
    //
    // MIÉRT ITT, ÉS NEM A POSTHOG FELÜLETÉN: a projekt-oldali kapcsolót
    // bárki átbillentheti anélkül, hogy a kódban nyoma maradna. A kliens
    // oldali `disable_session_recording` viszont a felvételt már az
    // INDULÁSKOR letiltja, tehát a projekt-beállítástól függetlenül érvényes.
    // Ez a kettő közül a szigorúbb — szándékosan.
    disable_session_recording: true,
    // AUTOCAPTURE CSAK ENGEDÉLYEZŐLISTÁVAL — tulajdonosi kérés (2026-10-16,
    // a mobil halott kattintások javítása). A 2026-08-21-i „kikapcsoljuk”
    // döntés oka az volt, hogy az autocapture MINDEN kattintást felküld az
    // elem szövegével együtt, így panasz- és állapot-szövegek is bekerülhettek
    // volna az elemzésbe. Ez az ok ma is áll, ezért nem kapcsoljuk vissza
    // általánosan: a `css_selector_allowlist` miatt a `$autocapture` csak a
    // lenti négy vezérlőcsalád kattintását küldi (a posthog-js a kattintott
    // elemet és az őseit veti össze a listával).
    //
    // MIÉRT KELL: a halott kattintás arányához viszonyítási alap kell. Az
    // engedélyezett `$autocapture` kattintások adják a nevezőt (hány koppintás
    // érte a menüt összesen), így mérhető, hogy a javítás után csökken-e az
    // arány. https://posthog.com/docs/product-analytics/autocapture
    autocapture: {
      css_selector_allowlist: [...AUTOCAPTURE_SELECTOR_ALLOWLIST],
    },
    // ELEMSZÖVEG SOSEM MEGY KI. A `$dead_click` eseményt a PostHog projekt-
    // beállítása kapcsolja, és az engedélyezőlistát NEM nézi: bármely elemre
    // jön, amelyre a koppintás hatástalan volt, és az elem szövegét is
    // felküldené (`$el_text`). A tipikus halott kattintás egy bekezdésre esik:
    // egy cikk szövegére, amely betegséget nevez meg, vagy a pénztárban
    // visszaírt e-mail-címre. Mérve a telepített posthog-js 1.430.3-ban:
    // dead-clicks-autocapture.js (csak a `ph-no-deadclick`/`ph-no-capture`
    // tiltólistát nézi), autocapture.js (`$el_text` csak `mask_all_text`
    // mellett marad ki). A mask az engedélyezett gombokról is a feliratot
    // hagyja el; az elem osztálya, helye és a link címe megmarad, a méréshez
    // ez elég (posthog-js dead-clicks-autocapture.js: `maskAllText:
    // config.mask_all_text`).
    mask_all_text: true,
    // M9 MINDEN ESEMÉNYRE. A posthog-js a `$current_url`-t (és a
    // `$referrer`-t, a `$initial_*` személy-tulajdonságokat, a heatmap- és a
    // web-vitals-adatok beágyazott URL-jeit) maga olvassa a címsorból: az
    // `$autocapture`, a `$dead_click`, a `$pageleave` és az `$opt_in` így a
    // jelszó-visszaállító jegyet is felküldte volna. Ez a horog minden
    // eseményt, a beágyazott értékeivel együtt, a meglévő tisztítón visz át. A nem
    // esemény útvonalakat (`/flags`, tartós tárolás) a címsor init előtti
    // tisztítása fedi (scrubSensitiveQueryFromAddressBar).
    // https://posthog.com/docs/libraries/js/config (before_send)
    before_send: sanitizeOutgoingEvent,
  }
}

/** URL-nek látszó szöveg (abszolút vagy gyökér-relatív, query-vel). */
const URL_WITH_QUERY = /^(https?:\/\/|\/)[^\s]*\?/

/**
 * A beágyazás mélységének felső korlátja. A posthog-js 1.430.3 legmélyebb
 * ismert eseménye az `$exception` (öt szint:
 * `$exception_list[].stacktrace.frames[]`); a korlát ennél három szinttel több.
 * Öt vagy kisebb korlát (a veremkeret-objektum mélysége) a hibakövetés
 * veremkereteit csendben `null`-ra cserélné.
 */
const SANITIZE_MAX_DEPTH = 8

/**
 * Egy tulajdonság-érték tisztítása, a mélységi korlátig: az URL-jellegű
 * szöveg és az URL-jellegű objektum-KULCS is (a `$$heatmap` adatát a
 * posthog-js a nyers `location.href` kulcs alatt küldi, a `$web_vitals`
 * mérőszámai beágyazott `$current_url`-t visznek). A korlátnál mélyebb
 * objektum kimarad (`null`), nem tisztítatlanul megy ki.
 */
function sanitizeValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') {
    return URL_WITH_QUERY.test(value) ? sanitizeAnalyticsUrl(value) : value
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (depth >= SANITIZE_MAX_DEPTH) {
    return null
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1))
  }
  const clean: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value)) {
    const cleanKey = URL_WITH_QUERY.test(key) ? sanitizeAnalyticsUrl(key) : key
    clean[cleanKey] = sanitizeValue(inner, depth + 1)
  }
  return clean
}

function sanitizeProperties(properties: Properties | undefined): Properties | undefined {
  if (!properties) {
    return properties
  }
  return sanitizeValue(properties, 0) as Properties
}

/**
 * Az érzékeny query-paraméter (a jelszó-visszaállító jegy) kivétele a
 * CÍMSORBÓL, mielőtt az SDK bármit olvasna. A posthog-js az URL-t nem csak az
 * eseményekbe írja (azokat a `before_send` tisztítja), hanem a tartós
 * személy-tulajdonságokba (`$initial_current_url`, a saját sütijébe és
 * localStorage-ába) és a `/flags` kérés törzsébe is; ezek nem események,
 * a `before_send` nem látja őket. Ha a jegy már az init előtt eltűnik a
 * címből, egyik útvonalon sem mehet ki. Csak hozzájárulással, az SDK
 * betöltése előtt fut. A visszaállító űrlap a jegyet a szervertől kapja
 * (prop), tehát működik tovább, és a lapfül munkamenet-tárolójában
 * megjegyzi, így a lap újratöltése után is visszaáll (ResetPasswordRestore).
 * A Next.js útválasztója a `history` példányán
 * figyeli a `replaceState`-et; az eredeti (prototípus) hívás csak a címsort
 * írja át, így a lap nem renderel újra, és nem megy ki második `$pageview`.
 */
function scrubSensitiveQueryFromAddressBar(): void {
  try {
    const url = new URL(window.location.href)
    const withoutHash = `${url.origin}${url.pathname}${url.search}`
    const clean = sanitizeAnalyticsUrl(withoutHash)
    if (clean !== withoutHash) {
      History.prototype.replaceState.call(
        window.history,
        window.history.state,
        '',
        `${clean}${url.hash}`,
      )
    }
  } catch {
    // A címsor nem írható (például sandboxolt keret): a `before_send` marad.
  }
}

/**
 * A `before_send` horog: minden kimenő esemény URL-jellegű tulajdonságából
 * kivágja az érzékeny query-paramétereket (./page-url.ts), a többit
 * (kampány-paraméterek) meghagyja. Eseményt nem dob el.
 */
export function sanitizeOutgoingEvent(result: CaptureResult | null): CaptureResult | null {
  if (!result) {
    return result
  }
  const clean: CaptureResult = {
    ...result,
    properties: sanitizeProperties(result.properties) ?? result.properties,
  }
  if (result.$set) {
    clean.$set = sanitizeProperties(result.$set)
  }
  if (result.$set_once) {
    clean.$set_once = sanitizeProperties(result.$set_once)
  }
  return clean
}

/**
 * Az autocapture engedélyezőlistája (a sorrend és a tartalom a tulajdonosi
 * kérésé, 2026-10-16). Új elem csak akkor kerülhet ide, ha a felirata rögzített
 * felületi szöveg, nem a látogató bevitele vagy személyes adata.
 */
const AUTOCAPTURE_SELECTOR_ALLOWLIST = [
  '.kc-nav-mobile__toggle',
  '.kc-button',
  '.kc-nav-mobile__link',
  '.kc-nav-mobile__sublink',
] as const

let initialized = false

/**
 * A böngésző-SDK, LUSTÁN betöltve (2026-10-16, a mobil halott kattintások
 * javítása). A `posthog-js` a főoldal első betöltésének legnagyobb JS-csomagja
 * volt (mérve: ~95 KB tömörítve, ~294 KB kibontva, a teljes ~290 KB-ból), és
 * minden látogatónál letöltődött és lefutott a React-hidratálás előtt, akkor
 * is, ha a látogató nem járult hozzá a méréshez (ilyenkor az SDK semmit nem
 * csinál). Most csak tárolt vagy frissen adott hozzájárulás után töltődik,
 * külön csomagként, a hidratálás után. A dinamikus `import()` a Next.js
 * hivatalos lusta-betöltési útja nem React-kódra:
 * https://nextjs.org/docs/app/guides/lazy-loading#loading-external-libraries
 */
let posthog: PostHog | null = null
let sdkLoad: Promise<PostHog> | null = null

function loadSdk(): Promise<PostHog> {
  sdkLoad ??= import('posthog-js').then((module) => {
    posthog = module.default
    return module.default
  })
  return sdkLoad
}

/** Elindult-e az init (a betöltés folyamatban vagy kész). */
let initStarted = false

/**
 * Aktív-e a rögzítés: inicializált kliens, amelyen nincs érvényben opt-out.
 * Opt-out után az init megmarad, de a posthog-js a capture-t eldobja, ezért
 * a várakozó kérések ilyenkor is várnak az újbóli bekapcsolásig.
 */
let capturing = false

/**
 * A hozzájárulás ELŐTT beérkezett capture-kérések (oldalmegtekintés,
 * TrackEvent).
 *
 * MIÉRT KELL. A React a gyerek-komponensek effectjeit a szülőé ELŐTT futtatja,
 * ezért a PostHogPageView és a TrackEvent az első betöltéskor még az init
 * előtt hívna capture-t, és az no-op lenne. Ugyanez történik, ha a látogató
 * az oldalon belül, a bannerben adja meg a hozzájárulást. A kérő komponens a
 * visszaadott függvénnyel visszavonja a sajátját (route-váltás, unmount),
 * amíg nincs hozzájárulás. Amint az init elindul (hozzájárulással), a
 * várakozók azonnal lefutnak, és a kérésük az SDK-sorba kerül (lent), a
 * keletkezési oldalukkal: egy közben történt route-váltás így nem nyeli el
 * a belépő oldal megtekintését. Hozzájárulás nélkül semmi nem megy ki.
 */
const readyCallbacks = new Set<() => void>()

/**
 * A hozzájárulás UTÁN, de az SDK megérkezése ELŐTT hívott közvetlen hívások
 * (például egy koppintásra küldött `checkout_started`). Az SDK megérkezésekor
 * egyszer, sorrendben lefutnak; ha közben visszavonták a hozzájárulást,
 * eldobjuk őket (sosem mennek ki), és a visszavonás alatt sem kerül ide új.
 */
let pendingCalls: Array<(client: PostHog) => void> = []

/**
 * Az azonosság-művelet (belépés: `identify`, kijelentkezés: `reset`) jele,
 * amíg az SDK nem állt fel. Belépés és kijelentkezés után is teljes
 * oldalbetöltés jön (LoginForm/RegisterForm, AccountNav), a memóriabeli sor
 * tehát elveszne. A következő init a jelet látva pótolja a műveletet. A jel
 * nem személyes adat: `reset`, `id:` és a Payload users.id (ugyanaz, amit az
 * identify a PostHognak küld; e-mail és név soha), vagy a kettő együtt
 * (`reset+id:`).
 */
const IDENTITY_PENDING_KEY = 'kc_analytics_identity_pending'

type IdentityOp = 'reset' | `id:${string}`

/**
 * A függő azonosság: egy még le nem futott kijelentkezés és egy még le nem
 * futott belépés. A kettő együtt is függhet: a betöltés alatti belépés nem
 * írhatja felül a korábbi lapról maradt kijelentkezést, mert a belépés után a
 * lap azonnal továbblép (LoginForm), és a következő lapon a `reset` nélkül az
 * `$opt_in` a kijelentkezett felhasználó profiljára menne.
 */
interface PendingIdentity {
  readonly reset: boolean
  readonly id: string | null
}

const RESET_AND_ID = 'reset+id:'

function parsePendingIdentity(value: string | null): PendingIdentity | null {
  if (value === 'reset') {
    return { reset: true, id: null }
  }
  if (value?.startsWith(RESET_AND_ID) && value.length > RESET_AND_ID.length) {
    return { reset: true, id: value.slice(RESET_AND_ID.length) }
  }
  if (value?.startsWith('id:') && value.length > 'id:'.length) {
    return { reset: false, id: value.slice('id:'.length) }
  }
  return null
}

function writePendingIdentity(pending: PendingIdentity): void {
  try {
    if (pending.id === null && !pending.reset) {
      window.localStorage.removeItem(IDENTITY_PENDING_KEY)
    } else {
      window.localStorage.setItem(
        IDENTITY_PENDING_KEY,
        pending.id === null ? 'reset' : `${pending.reset ? 'reset+' : ''}id:${pending.id}`,
      )
    }
  } catch {
    // Tiltott tároló: a sor ugyanazon a lapon így is lefut.
  }
}

/**
 * Ezen a lapon sorba állított azonosság-művelet: ilyenkor a jelet a sor viszi,
 * a korábbi események után. Az init csak egy KORÁBBI lapról maradt jelre
 * reagál.
 */
let identityQueued = false

/**
 * A művelet jele. A kijelentkezés a függő belépést elveti (az már nem
 * érvényes), a belépés a függő kijelentkezést megtartja.
 */
function markIdentityPending(op: IdentityOp): void {
  if (op === 'reset') {
    writePendingIdentity({ reset: true, id: null })
    return
  }
  writePendingIdentity({
    reset: peekIdentityPending()?.reset ?? false,
    id: op.slice('id:'.length),
  })
}

/** A függő azonosság, törlés nélkül. */
function peekIdentityPending(): PendingIdentity | null {
  try {
    return parsePendingIdentity(window.localStorage.getItem(IDENTITY_PENDING_KEY))
  } catch {
    return null
  }
}

/** Visszaadja és törli a függő azonosságot. */
function takeIdentityPending(): PendingIdentity | null {
  const pending = peekIdentityPending()
  try {
    window.localStorage.removeItem(IDENTITY_PENDING_KEY)
  } catch {
    // Tiltott tároló: nincs mit törölni.
  }
  return pending
}

/** Egy azonosság-művelet végrehajtása a kész kliensen. */
function applyIdentityOp(client: PostHog, op: IdentityOp): void {
  if (op === 'reset') {
    client.reset()
  } else {
    client.identify(op.slice('id:'.length))
  }
}

/**
 * Az SDK rögzítési állapotának igazítása a 'granted' döntéshez, a függő
 * azonosság-jellel együtt. A `reset` az `opt_in_capturing` ELŐTT fut: az
 * `$opt_in` eseményt a posthog-js azonnal, a tárolt azonossággal küldi, és
 * így a következő látogató hozzájárulása nem a kijelentkezett felhasználó
 * profiljára megy. Az `identify` UTÁNA fut, mert opt-out alatt a posthog-js
 * a `$identify` eseményt eldobná.
 *
 * Az opt-out állapotát a reset ELŐTT kell megnézni: a `reset()` a tárolt
 * opt-outot is törli (posthog-js 1.430.3 `_reset`: `this.consent.reset()`),
 * a tárolt opt-outtal induló SDK kérés-sora viszont szünetel, amíg az
 * `opt_in_capturing` el nem indítja. Nélküle az események csak a lap
 * elhagyásakor mennének ki, vagy el is vesznének.
 */
function syncGrantedCapture(client: PostHog, pending: PendingIdentity | null): void {
  const optedOut = client.has_opted_out_capturing()
  if (pending?.reset) {
    client.reset()
  }
  if (optedOut) {
    client.opt_in_capturing()
  }
  if (pending?.id) {
    client.identify(pending.id)
  }
}

/**
 * Azonosság-művelet: kész kliensen azonnal; az SDK betöltése alatt (vagy
 * hozzájárulással, de még el sem indult betöltésnél) tartós jellel és a
 * sorban. Igazat ad, ha lefutott vagy sorba került.
 */
function runIdentityOp(op: IdentityOp): boolean {
  if (typeof window === 'undefined' || !isPostHogConfigured()) {
    return false
  }
  if (!hasAnalyticsConsent()) {
    // Hozzájárulás nélkül az SDK-hoz nem nyúlunk: az `identify` és a
    // `reset()` is hálózati kérést indít (a `reset()` a feature flageket
    // újratölti, a `/flags` kérést pedig az opt-out nem állítja meg;
    // posthog-js 1.430.3 posthog-core.js `_reset`). A kijelentkezés ezért
    // csak a `reset` jelet írja. Ez elveti egy korábbi belépés jelét, és a
    // következő hozzájáruláskor (initPostHog, enableAnalyticsCapture) az
    // `$opt_in` előtt lefut, hogy a gépet a következő ember ne a régi
    // felhasználóként folytassa.
    if (op === 'reset') {
      markIdentityPending('reset')
    }
    return false
  }
  if (initialized && posthog) {
    applyIdentityOp(posthog, op)
    return true
  }
  markIdentityPending(op)
  identityQueued = withClient((client) => {
    applyIdentityOp(client, op)
    takeIdentityPending()
  })
  return true
}

/**
 * A kampány-paraméterek, amelyeket a posthog-js az URL-ből a forrás-
 * hozzárendeléshez olvas (`@posthog/browser-common` CAMPAIGN_PARAMS, a mi
 * hirdetési csatornáinkra szűkítve).
 */
const CAMPAIGN_PARAM = /^(utm_[a-z]+|gad_source|gclid|gbraid|wbraid|fbclid|msclkid)$/

/**
 * A sorba állított esemény keletkezési oldala. A posthog-js az URL-t és a
 * kampány-paramétereket a `capture()` FUTÁSAKOR olvassa a `location`-ből,
 * tehát a betöltés alatt történt navigáció után a sor a céloldal URL-jével
 * menne ki. A kifejezetten átadott tulajdonság az SDK-ban felülírja a
 * számoltat, ezért a keletkezéskori értékeket rögzítjük (M9-tisztítással).
 */
function originProperties(): Record<string, string> {
  const url = new URL(window.location.href)
  const properties: Record<string, string> = {
    $current_url: sanitizeAnalyticsUrl(url.href),
    $pathname: url.pathname,
  }
  for (const [key, value] of url.searchParams) {
    if (CAMPAIGN_PARAM.test(key)) {
      properties[key] = value
    }
  }
  return properties
}

/**
 * A callback azonnal lefut, ha a rögzítés aktív, különben amikor azzá válik.
 * A visszaadott függvény visszavonja a még várakozó callbacket.
 */
export function whenPostHogReady(callback: () => void): () => void {
  if (capturing || isLoadingWithConsent()) {
    callback()
    return () => {}
  }
  readyCallbacks.add(callback)
  return () => {
    readyCallbacks.delete(callback)
  }
}

/**
 * PostHog inicializálása (idempotens; csak konfigurált + hozzájárulás esetén).
 * Igazat ad, ha az init elindult vagy már kész; a tényleges `posthog.init` az
 * SDK megérkezése után fut.
 */
export function initPostHog(): boolean {
  if (initialized || initStarted) {
    // Újbóli hozzájárulás a betöltés alatt: a közben várakozók is sorba állnak.
    if (isLoadingWithConsent()) {
      runReadyCallbacks()
    }
    return true
  }
  if (!isPostHogConfigured() || !hasAnalyticsConsent()) {
    return false
  }
  scrubSensitiveQueryFromAddressBar()
  initStarted = true
  // A hozzájárulásra várók most az SDK-sorba kerülnek, a keletkezési
  // oldalukkal (lásd readyCallbacks): a betöltés alatti route-váltás már nem
  // vonhatja vissza őket.
  runReadyCallbacks()
  void loadSdk().then(
    (client) => {
      // A betöltés alatt visszavont hozzájárulás: az SDK nem indul el, a
      // várakozó hívások eldobódnak, egy későbbi elfogadás újraindít.
      if (!hasAnalyticsConsent()) {
        initStarted = false
        dropPendingCalls()
        return
      }
      client.init(POSTHOG_KEY, buildPostHogOptions())
      // Ide csak tárolt 'granted' hozzájárulással jutunk. Ha a látogató
      // korábban elutasított, az SDK a saját opt-outját tartósan tárolja, és
      // újratöltés után is azzal indul. Ilyenkor a várakozó eseményeket (lent)
      // elnyelné, a banner későbbi opt_in_capturing hívása pedig már későn
      // jönne. Ezért az SDK állapotát itt a tárolt döntéshez igazítjuk;
      // $opt_in eseményt csak ekkor küld, nem minden betöltéskor. A korábbi
      // lapon (az SDK megérkezése előtt vagy hozzájárulás nélkül) történt
      // belépés vagy kijelentkezés jele ugyanitt fut le, a sora elveszett.
      // Ha ezen a lapon is van sorba állított azonosság-művelet, a belépést a
      // sor viszi (a korábbi események után); a függő kijelentkezés viszont az
      // `$opt_in` előtt fut.
      const pending = identityQueued ? peekIdentityPending() : takeIdentityPending()
      syncGrantedCapture(
        client,
        identityQueued ? { reset: pending?.reset ?? false, id: null } : pending,
      )
      initialized = true
      startCapturing()
    },
    () => {
      // A csomag nem töltődött be (hálózat, blokkoló): a mérés marad ki, a
      // felület nem. Egy későbbi hozzájárulás-esemény újrapróbálja.
      initStarted = false
      sdkLoad = null
      dropPendingCalls()
    },
  )
  return true
}

/**
 * Az SDK úton van, és a hozzájárulás most is áll. A hozzájárulást minden
 * hívásnál újra kell nézni: a betöltés alatti visszavonás nem állítja le a
 * letöltést, csak a kiküldést, és az alatt keletkezett esemény egy újbóli
 * elfogadás után sem mehet ki.
 */
function isLoadingWithConsent(): boolean {
  return initStarted && !initialized && hasAnalyticsConsent()
}

/**
 * Közvetlen SDK-hívás: kész kliensen azonnal, a betöltés alatt (hozzájárulás
 * mellett) sorba állítva, egyébként sehogy. Igazat ad, ha a hívás lefutott
 * vagy sorba került.
 */
function withClient(call: (client: PostHog) => void): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  if (initialized && posthog) {
    call(posthog)
    return true
  }
  if (isLoadingWithConsent()) {
    pendingCalls.push(call)
    return true
  }
  return false
}

/**
 * Esemény küldése. A sorba kerülő esemény a keletkezési oldalát viszi (lásd
 * originProperties); a hívó saját tulajdonságai elsőbbséget kapnak.
 */
function captureEvent(event: string, properties?: Record<string, unknown>): void {
  if (initialized && posthog) {
    posthog.capture(event, properties)
    return
  }
  if (isLoadingWithConsent()) {
    const origin = originProperties()
    pendingCalls.push((client) => client.capture(event, { ...origin, ...properties }))
  }
}

/** A sor eldobása (visszavont hozzájárulás, sikertelen betöltés). */
function dropPendingCalls(): void {
  pendingCalls = []
  identityQueued = false
}

/** A hozzájárulásra várók egyszeri futtatása (a lista ürül). */
function runReadyCallbacks(): void {
  const pending = [...readyCallbacks]
  readyCallbacks.clear()
  for (const callback of pending) {
    callback()
  }
}

/** A rögzítés aktív; a várakozó kérések egyszer lefutnak. */
function startCapturing(): void {
  capturing = true
  runReadyCallbacks()
  const calls = pendingCalls
  dropPendingCalls()
  if (posthog) {
    for (const call of calls) {
      call(posthog)
    }
  }
}

/** Inicializálva van-e a PostHog-kliens (a provider és a tesztek használják). */
export function isPostHogInitialized(): boolean {
  return initialized
}

/**
 * A capture tényleges BEkapcsolása 'granted' consent mellett: ha még nem
 * futott init, most lefut; ha már igen (korábbi opt-out után), csak a
 * posthog opt_in_capturing kapcsol vissza. NEM ír consentet és NEM szór
 * eseményt — ezt a provider consent-figyelője hívja.
 */
export function enableAnalyticsCapture(): boolean {
  if (initialized && posthog) {
    // Ugyanezen a lapon, a visszavonás alatt történt kijelentkezés jele.
    syncGrantedCapture(posthog, takeIdentityPending())
    startCapturing()
    return true
  }
  return initPostHog()
}

/**
 * A capture KIkapcsolása 'denied' consent mellett (opt_out_capturing — a
 * már inicializált kliens is abbahagyja a rögzítést). Az újra-initet az
 * initPostHog consent-kapuja tiltja, amíg a tárolt állapot 'denied'.
 */
export function disableAnalyticsCapture(): void {
  // Betöltés közben: a várakozó hívások eldobódnak, és az SDK megérkezésekor
  // a hozzájárulás-ellenőrzés (initPostHog) meg sem indítja a klienst.
  dropPendingCalls()
  // Egy függő belépés-jel visszavonás után nem élhet tovább: egy későbbi
  // hozzájárulás különben a régi felhasználóként azonosítaná a gépet. A
  // függő `reset` marad (az csak elenged), akkor is, ha egy belépés-jellel
  // együtt állt.
  const pending = peekIdentityPending()
  if (pending?.id) {
    writePendingIdentity({ reset: pending.reset, id: null })
  }
  if (initialized && posthog) {
    posthog.opt_out_capturing()
    capturing = false
  }
}

/**
 * Látogatói hozzájárulás (banner „Elfogadom"): consent tárolása +
 * 'kc:analytics-consent' esemény + capture bekapcsolása. A consent akkor is
 * tárolódik, ha a PostHog nincs konfigurálva (a döntés megmarad).
 */
export function optInToAnalytics(): void {
  writeConsent('granted')
  dispatchConsentEvent('granted')
  if (isPostHogConfigured()) {
    enableAnalyticsCapture()
  }
}

/**
 * Látogatói elutasítás (banner „Elutasítom"): consent tárolása + esemény +
 * capture kikapcsolása. 'denied' állapotban a PostHog SOHA nem init újra.
 */
export function optOutOfAnalytics(): void {
  writeConsent('denied')
  dispatchConsentEvent('denied')
  disableAnalyticsCapture()
}

/** A tárolt consent állapot lekérdezése (a banner láthatóságához). */
export function getAnalyticsConsentState(): ConsentState {
  return readConsent()
}

/** Üzleti esemény rögzítése — no-op, ha az analitika ki van kapcsolva. */
export function captureAnalyticsEvent(
  event: AnalyticsEventName,
  properties?: Record<string, unknown>,
): void {
  captureEvent(event, properties)
}

/**
 * identify: Payload users.id stringként; e-mail/név/IP nem mehet. person_profiles identified_only.
 * Az SDK betöltése alatt sorba kerül (a belépés gyakran hamarabb történik,
 * mint ahogy a lustán töltött SDK megérkezik).
 */
export function identifyUser(userId: number | string): boolean {
  return runIdentityOp(`id:${String(userId)}`)
}

/**
 * Kijelentkezéskor: az azonosság elengedése.
 *
 * MIÉRT KÖTELEZŐ. `reset()` nélkül a kijelentkezés utáni események továbbra
 * is az ELŐZŐ felhasználó profiljára mennének. Közös gépen (rendelői tablet,
 * családi laptop) ez két különböző ember viselkedését olvasztaná egy
 * profilba — ez egyszerre mérési hiba és adatvédelmi hiba.
 */
export function resetAnalyticsIdentity(): void {
  runIdentityOp('reset')
}

/**
 * JS-kivétel rögzítése (PostHog `$exception`).
 *
 * A `captureException` a posthog-js 1.422.5 publikus API-ja
 * (`captureException(error: unknown, additionalProperties?: Properties)`) —
 * a szignatúrát a telepített típusdefinícióból ellenőriztük, nem emlékezetből.
 *
 * A `context` SZABAD szöveg, de ugyanaz a tilalom áll rá, mint az
 * eseménytulajdonságokra: személyes adat nem kerülhet bele. Ezért vesz át
 * rövid, gépi címkét (pl. 'checkout-submit'), nem a felhasználó bevitelét.
 */
export function captureAnalyticsException(error: unknown, context: string): void {
  withClient((client) => client.captureException(error, { kc_context: context }))
}

/**
 * A $pageview esemény payloadja (tiszta — egységtesztelhető). A kimenő URL a
 * capture-határon MINDIG megtisztított: a jelszó-visszaállító jegy (és bármely
 * jövőbeli érzékeny query-paraméter) sosem mehet harmadik félhez (M9 —
 * ./page-url.ts); a kampány-paraméterek (utm_*) megmaradnak.
 */
export function buildPageViewProperties(url: string): { $current_url: string } {
  return { $current_url: sanitizeAnalyticsUrl(url) }
}

/** $pageview rögzítése a route-váltás figyelőből. */
export function capturePageView(url: string): void {
  captureEvent('$pageview', buildPageViewProperties(url))
}

/** Tesztelési segéd: az init-zárolt állapot visszaállítása. */
export function resetPostHogForTests(): void {
  initialized = false
  initStarted = false
  capturing = false
  readyCallbacks.clear()
  dropPendingCalls()
}
