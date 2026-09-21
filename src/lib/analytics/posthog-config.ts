/**
 * PostHog — TISZTA konfiguráció és esemény-névregiszter, SDK NÉLKÜL.
 *
 * MIÉRT VAN KÜLÖN FÁJLBAN: a `./posthog.ts` a böngésző-SDK-t (`posthog-js`)
 * importálja, tehát aki onnan kér egy puszta konstanst, az a teljes kliens-
 * SDK-t is behúzza — a szerveroldali visszajelzés-végpont (`src/lib/feedback/*`)
 * éppen ezt kerüli el azzal, hogy INNEN importál. Ez a modul szándékosan nem
 * függ semmitől: se SDK, se DOM, se consent-állapot.
 *
 * A `./posthog.ts` ezeket VÁLTOZATLANUL re-exportálja, ezért minden meglévő
 * importáló és teszt érintetlen marad.
 *
 * Elvek:
 * - EU-cloud az alapértelmezett host (GDPR): https://eu.i.posthog.com.
 * - A kliens a /ingest elsőfél-proxyt használja (next.config.ts rewrites) —
 *   így a hívások első félként mennek ki (ad-blocker-ellenállóbb, és a
 *   PostHog-sütik first-partyként működnek).
 * - Kulcs nélkül a teljes analitika kikapcsolt (no-op) — ugyanaz a filozófia,
 *   mint az e-mail/Számlázz.hu opcionális integrációknál.
 */

export const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? ''
export const POSTHOG_HOST = (
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com'
).replace(/\/+$/, '')

/** Elsőfél-proxy útvonal (a next.config.ts rewrites ezt a PostHog EU-hostra forgatja). */
export const POSTHOG_API_HOST = '/ingest'

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
 * e-mail, név, IP SOHA. Az EGYETLEN, nevesített kivétel a `siteFeedback` —
 * lásd a saját blokkját lentebb.
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

  // ─── VISSZAJELZÉS-DOBOZ (WP65, tulajdonosi kérés 2026-09-21) ───────────
  // NEVESÍTETT KIVÉTEL a fenti „személyes adat nem mehet" szabály alól, és a
  // `docs/posthog.md` 7. pontja alól: ez az esemény SZÁNDÉKOSAN viszi a
  // látogató saját, begépelt szövegét, mert egy hibabejelentő eszköznél a
  // szöveg MAGA a termék. A különbség a követési metaadathoz képest az, hogy
  // itt a látogató maga írja és maga küldi el, azután, hogy a párbeszédablak
  // figyelmeztette: személyes és egészségügyi adatot ne írjon bele. Ezért
  // nincs az űrlapon név- és e-mail-mező, és ezért nem megy ki IP sem.
  // A capture SZERVERRŐL fut (src/lib/feedback/posthog-capture.ts), mert a
  // kliens-oldali út hozzájárulás nélkül néma no-op lenne, és pontosan a
  // kért bejelentések vesznének el.
  siteFeedback: 'site_feedback',
} as const

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS]
