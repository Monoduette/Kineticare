import type { PostHog, PostHogConfig } from 'posthog-js'

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
    // általánosan: a `css_selector_allowlist` miatt csak a lenti négy
    // vezérlőcsalád kattintása megy ki (a posthog-js a kattintott elemet és
    // az őseit veti össze a listával). Mind a négy rögzített felületi szöveg:
    // menüpont, a menü kapcsolója és a `.kc-button` gombok, amelyek felirata
    // a CTA-szótárból vagy a CMS-ből jön, sosem a látogató beviteléből
    // (ellenőrizve: egyik `.kc-button` sem jelenít meg nevet vagy e-mailt).
    //
    // MIÉRT KELL: a halott kattintás arányához viszonyítási alap kell. A
    // PostHog a `$dead_click` eseményt külön küldi; az engedélyezett
    // `$autocapture` kattintások adják a nevezőt (hány koppintás érte a menüt
    // összesen), így mérhető, hogy a javítás után csökken-e az arány.
    // https://posthog.com/docs/product-analytics/autocapture
    autocapture: {
      css_selector_allowlist: [...AUTOCAPTURE_SELECTOR_ALLOWLIST],
    },
  }
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
 * Az init előtt beérkezett capture-kérések (oldalmegtekintés, TrackEvent).
 *
 * MIÉRT KELL. A React a gyerek-komponensek effectjeit a szülőé ELŐTT futtatja,
 * ezért a PostHogPageView és a TrackEvent az első betöltéskor még az init
 * előtt hívna capture-t, és az no-op lenne. Ugyanez történik, ha a látogató
 * az oldalon belül, a bannerben adja meg a hozzájárulást, és amíg a lustán
 * betöltött SDK úton van. A várakozó kérések az init (vagy egy opt-out utáni
 * újbóli bekapcsolás) után egyszer lefutnak; a kérő komponens a visszaadott
 * függvénnyel visszavonja a sajátját (route-váltás, unmount), így csak az
 * aktuális oldal eseménye megy ki. Hozzájárulás nélkül az init nem fut le,
 * tehát ilyenkor semmi nem megy ki.
 */
const readyCallbacks = new Set<() => void>()

/**
 * A hozzájárulás UTÁN, de az SDK megérkezése ELŐTT hívott közvetlen
 * capture-ök (például egy koppintásra küldött `checkout_started`). Az SDK
 * megérkezésekor egyszer lefutnak; ha közben visszavonták a hozzájárulást,
 * eldobjuk őket (sosem mennek ki).
 */
let pendingCalls: Array<(client: PostHog) => void> = []

/**
 * A callback azonnal lefut, ha a rögzítés aktív, különben amikor azzá válik.
 * A visszaadott függvény visszavonja a még várakozó callbacket.
 */
export function whenPostHogReady(callback: () => void): () => void {
  if (capturing) {
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
    return true
  }
  if (!isPostHogConfigured() || !hasAnalyticsConsent()) {
    return false
  }
  initStarted = true
  void loadSdk().then(
    (client) => {
      // A betöltés alatt visszavont hozzájárulás: az SDK nem indul el, a
      // várakozó hívások eldobódnak, egy későbbi elfogadás újraindít.
      if (!hasAnalyticsConsent()) {
        initStarted = false
        pendingCalls = []
        return
      }
      client.init(POSTHOG_KEY, buildPostHogOptions())
      // Ide csak tárolt 'granted' hozzájárulással jutunk. Ha a látogató
      // korábban elutasított, az SDK a saját opt-outját tartósan tárolja, és
      // újratöltés után is azzal indul. Ilyenkor a várakozó eseményeket (lent)
      // elnyelné, a banner későbbi opt_in_capturing hívása pedig már későn
      // jönne. Ezért az SDK állapotát itt a tárolt döntéshez igazítjuk;
      // $opt_in eseményt csak ekkor küld, nem minden betöltéskor.
      if (client.has_opted_out_capturing()) {
        client.opt_in_capturing()
      }
      initialized = true
      startCapturing()
    },
    () => {
      // A csomag nem töltődött be (hálózat, blokkoló): a mérés marad ki, a
      // felület nem. Egy későbbi hozzájárulás-esemény újrapróbálja.
      initStarted = false
      sdkLoad = null
      pendingCalls = []
    },
  )
  return true
}

/**
 * Közvetlen SDK-hívás: kész kliensen azonnal, a betöltés alatt sorba állítva,
 * hozzájárulás nélkül (init nélkül) sehogy.
 */
function withClient(call: (client: PostHog) => void): void {
  if (typeof window === 'undefined') {
    return
  }
  if (initialized && posthog) {
    call(posthog)
    return
  }
  if (initStarted) {
    pendingCalls.push(call)
  }
}

/** A rögzítés aktív; a várakozó kérések egyszer lefutnak. */
function startCapturing(): void {
  capturing = true
  const pending = [...readyCallbacks]
  readyCallbacks.clear()
  for (const callback of pending) {
    callback()
  }
  const calls = pendingCalls
  pendingCalls = []
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
    posthog.opt_in_capturing()
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
  pendingCalls = []
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
  withClient((client) => client.capture(event, properties))
}

/**
 * identify: Payload users.id stringként; e-mail/név/IP nem mehet. person_profiles identified_only.
 */
export function identifyUser(userId: number | string): boolean {
  if (!initialized || !posthog || typeof window === 'undefined') {
    return false
  }
  posthog.identify(String(userId))
  return true
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
  withClient((client) => client.reset())
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
  withClient((client) => client.capture('$pageview', buildPageViewProperties(url)))
}

/** Tesztelési segéd: az init-zárolt állapot visszaállítása. */
export function resetPostHogForTests(): void {
  initialized = false
  initStarted = false
  capturing = false
  readyCallbacks.clear()
  pendingCalls = []
}
