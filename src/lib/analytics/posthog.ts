import posthog from 'posthog-js'
import type { PostHogConfig } from 'posthog-js'

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

export const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? ''
export const POSTHOG_HOST = (process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com').replace(/\/+$/, '')

/** Elsőfél-proxy útvonal (a next.config.ts rewrites ezt a PostHog EU-hostra forgatja). */
export const POSTHOG_API_HOST = '/ingest'

/**
 * A consent-tárolókulcs és az eseménynév EGYETLEN igazságforrása a ./consent
 * modul (körmenti import elkerülésével) — innen re-exportáljuk a visszafelé
 * kompatibilitásért.
 */
export { CONSENT_EVENT, CONSENT_STORAGE_KEY }

/**
 * Üzleti esemény-nevek EGY helyen — a funnel-riportok ezekre épülnek.
 *
 * KÉT funnel él egymás után:
 *  1. ÉRTÉKESÍTÉSI: $pageview(/) → course_viewed → checkout_started →
 *     purchase_confirmed  (docs/ertekesitesi-ux-skill.md 5. pont)
 *  2. TANULÁSI (a vásárlás UTÁN): course_started → lesson_completed* →
 *     module_completed* → course_completed
 * A második azért kell, mert a megrendelői kérdés („hányan kezdték el, hányan
 * fejezték be") két, egymástól független forrásból is megválaszolható: az
 * adatbázisból (admin haladás-nézet, pontos, de csak pillanatkép) és a
 * PostHogból (időbeli lefutás, lemorzsolódás, kohorszok). A kettő ugyanazokat
 * a fogalmakat használja, hogy a számok összevethetők legyenek.
 *
 * SZEMÉLYES ADAT NEM MEHET az esemény-tulajdonságokba (a logger redact-listája
 * a naplóra véd, a PostHog-hívásra nem): kurzus- és lecke-azonosító igen,
 * e-mail, név, IP SOHA.
 */
export const ANALYTICS_EVENTS = {
  courseViewed: 'course_viewed',
  checkoutStarted: 'checkout_started',
  purchaseConfirmed: 'purchase_confirmed',
  courseStarted: 'course_started',
  lessonCompleted: 'lesson_completed',
  moduleCompleted: 'module_completed',
  courseCompleted: 'course_completed',

  // ─── LEAD-FUNNEL (2026-08-21, tulajdonosi kör) ──────────────────────────
  // A nem-vásárlói konverziók. Minden űrlaphoz KÉT esemény tartozik: a
  // beküldés SZÁNDÉKA és a SIKERES beküldés. A kettő különbsége maga a
  // mérőszám — ha sok a `lead_submitted` és kevés a `lead_succeeded`, akkor
  // az űrlap vagy a szerver hibázik. Ez a néma beküldési hibák egyetlen
  // külső jelzője: a szerveroldali napló csak azt látja, ami ODAÉRT.
  leadSubmitted: 'lead_submitted',
  leadSucceeded: 'lead_succeeded',

  // ─── VIDEÓ-MÉLYSÉG ─────────────────────────────────────────────────────
  // A `lesson_completed` csak a VÉGÉT jelzi; a lemorzsolódás viszont attól
  // függetlenül érdekes, hogy hol állnak meg. A mérföldkövek leckénként
  // EGYSZER mennek ki (a küldő oldalán retesszel), különben a visszatekerés
  // többszörözné őket, és a tölcsér hamis képet adna.
  videoStarted: 'video_started',
  videoMilestone: 'video_milestone',

  // ─── HIBAKÖVETÉS ───────────────────────────────────────────────────────
  // ÜZLETI (nem JS-kivétel) hiba: a pénztár elutasító ágai. A tényleges
  // JS-kivételeket a PostHog saját `$exception` eseménye viszi, a
  // `captureAnalyticsException` segédleten át.
  checkoutFailed: 'checkout_failed',

  // ─── TARTALMI FUNNEL (2026-08-29, tulajdonosi kör) ─────────────────────
  // A cikk/hub a fizetett és organikus forgalom belépője; az optimalizálás
  // kérdése nem az, HÁNYAN jöttek (azt a $pageview tudja), hanem hogy MIT
  // csináltak: elolvasták-e, és melyik hídon léptek tovább. Négy esemény,
  // mind technikai azonosítókkal (cikk-slug, CTA-fajta), személyes adat
  // nélkül:
  //  - article_viewed: a cikkoldal (blog vagy gyökér-hub) megnyílt.
  //  - article_read: az olvasó a törzs VÉGÉIG jutott (cikkenként egyszer,
  //    a küldő oldalán retesszel) — a $pageview és e között a különbség a
  //    tényleges elolvasási arány.
  //  - article_cta_clicked: a cikk alatti híd-rendszer kattintásai
  //    (kurzus, ingyenes sor, időpont, kapcsolódó cikk, jegyzék).
  //  - faq_opened: melyik GYIK-kérdést nyitják — közvetlen input a
  //    tartalom- és Ads-optimalizáláshoz (mért kérdések visszamérése).
  articleViewed: 'article_viewed',
  articleRead: 'article_read',
  articleCtaClicked: 'article_cta_clicked',
  faqOpened: 'faq_opened',
} as const
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS]

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
    // AUTOCAPTURE KIKAPCSOLVA — tulajdonosi döntés (2026-08-21):
    // „kikapcsoljuk, ne bonyolítsuk". A posthog-js alapból BEkapcsolva
    // hagyja, tehát ezt ki KELL írni; a hallgatás itt nem semleges.
    //
    // MIÉRT: az oldal 12 üzleti eseményt küld, mindet EGYETLEN, szándékosan
    // megírt burkolón keresztül (captureAnalyticsEvent) — vagyis pontosan
    // tudjuk, mi megy ki és milyen mezőkkel. Az autocapture ehhez képest
    // minden kattintást és mezőváltást felküld, és az elem SZÖVEGÉT is
    // magával viszi. Egy kézrehabilitációs oldalon ez olyan panasz-
    // és állapot-szövegeket sodorhatna be az elemzésbe, amelyekre nincs
    // jogalapunk (a mezők ÉRTÉKÉT a posthog-js maszkolja, a köréjük írt
    // címkéket és gombfeliratokat viszont nem). A haszon ezzel szemben
    // nulla lenne: nem az ismeretlen kattintásokat keressük, hanem a már
    // megnevezett tölcsér-lépéseket mérjük.
    autocapture: false,
  }
}

let initialized = false

/** PostHog inicializálása (idempotens; csak konfigurált + hozzájárulás esetén). */
export function initPostHog(): boolean {
  if (initialized) {
    return true
  }
  if (!isPostHogConfigured() || !hasAnalyticsConsent()) {
    return false
  }
  posthog.init(POSTHOG_KEY, buildPostHogOptions())
  initialized = true
  return true
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
  if (initialized) {
    posthog.opt_in_capturing()
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
  if (initialized) {
    posthog.opt_out_capturing()
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
  if (!initialized || typeof window === 'undefined') {
    return
  }
  posthog.capture(event, properties)
}

/**
 * identify: Payload users.id stringként; e-mail/név/IP nem mehet. person_profiles identified_only.
 */
export function identifyUser(userId: number | string): boolean {
  if (!initialized || typeof window === 'undefined') {
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
  if (!initialized || typeof window === 'undefined') {
    return
  }
  posthog.reset()
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
  if (!initialized || typeof window === 'undefined') {
    return
  }
  posthog.captureException(error, { kc_context: context })
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
  if (!initialized || typeof window === 'undefined') {
    return
  }
  posthog.capture('$pageview', buildPageViewProperties(url))
}

/** Tesztelési segéd: az init-zárolt állapot visszaállítása. */
export function resetPostHogForTests(): void {
  initialized = false
}
