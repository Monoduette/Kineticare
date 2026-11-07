/**
 * A Webanalitika admin-nézet PostHog-állandói — tiszta, React-mentes modul.
 *
 * A KinetiCare projekt a PostHog EU-felhőjében él (eu.posthog.com, projekt:
 * 253152). A nézet látogatói számait a szerver a PostHog Query API-jából
 * kérdezi le (src/lib/admin/posthog-web-stats.ts), ez a modul csak az ehhez
 * kellő FIX origint és projekt-azonosítót adja. A host szándékosan nem
 * env-ből jön: a személyes API-kulcs így rossz beállítás mellett sem mehet
 * idegen hostra.
 *
 * 2026-11-07: a megosztott PostHog-dashboard beágyazása (iframe, a
 * `POSTHOG_SHARED_DASHBOARD_URL` env és a CSP `frame-src` eu.posthog.com
 * forrása) és a külső elemző-felületek linkjei tulajdonosi döntésre
 * kikerültek; az adatot a nézet natívan mutatja.
 */

/** A PostHog EU-cloud app-originje (a Query API hostja). */
export const POSTHOG_EMBED_ORIGIN = 'https://eu.posthog.com'

/** A KinetiCare PostHog-projekt azonosítója (nyilvános útvonal-elem, nem titok). */
export const POSTHOG_PROJECT_ID = '253152'
