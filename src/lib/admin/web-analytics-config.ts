/**
 * A Webanalitika admin-nézet konfigurációja — tiszta, React-mentes modul.
 *
 * ═══ MIT CSINÁL ═══
 * A PostHog MEGOSZTOTT dashboardjának beágyazási URL-jét állítja elő a
 * `POSTHOG_SHARED_DASHBOARD_URL` env-értékből, szigorú ellenőrzéssel. Az URL
 * egy iframe `src`-ébe kerül, tehát ugyanaz az elv érvényes, mint a GA4
 * mérési azonosítónál (src/lib/analytics/ga4.ts): formailag hibás vagy idegen
 * hostra mutató érték NEM szivároghat be — olyankor a modul úgy viselkedik,
 * mintha a beágyazás nem lenne beállítva, és a nézet a beüzemelési útmutatót
 * mutatja.
 *
 * ═══ MIÉRT CSAK AZ EU-CLOUD HOSTJA ═══
 * A projekt a PostHog EU-felhőjében él (eu.posthog.com, projekt: 253152).
 * A beágyazás engedélyezése a CSP `frame-src` bővítésével jár
 * (src/lib/security/csp.ts) — egy tetszőleges hostot elfogadó env-érték a
 * CSP-t is tetszőleges hostra nyitná. Ezért a host FIX, nem env-ből jön.
 *
 * ═══ SHARED ÉS EMBEDDED ═══
 * A PostHog a megosztásnál `/shared/<token>` linket ad; az iframe-barát alak
 * az `/embedded/<token>` (fejléc és navigáció nélkül). A modul mindkettőt
 * elfogadja, és a beágyazáshoz az embedded alakra normalizál — így a
 * tulajdonos azt másolhatja be, amit a Megosztás párbeszéd mutat.
 */

/** A PostHog EU-cloud origin — a CSP frame-src is ezt engedi, ha van URL. */
export const POSTHOG_EMBED_ORIGIN = 'https://eu.posthog.com'

/**
 * A megosztási token megengedett alakja. A PostHog rövid, URL-biztos
 * azonosítót ad; a szűk karakterkészlet a lényeg, nem a pontos hossz —
 * query-stringet, további útvonal-szegmenst és minden egyebet elutasítunk.
 */
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

/**
 * Nyers env-érték → iframe-be való beágyazási URL, vagy null.
 *
 * Csak a `https://eu.posthog.com/shared/<token>` és `/embedded/<token>`
 * alakot fogadja el (záró perjellel is), és mindig az embedded alakot adja
 * vissza. Minden más — más host, más útvonal, query, hibás token — null.
 */
export function normalizePosthogEmbedUrl(raw: string | undefined): string | null {
  const value = (typeof raw === 'string' ? raw : '').trim()
  if (value.length === 0) {
    return null
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.origin !== POSTHOG_EMBED_ORIGIN || url.search !== '' || url.hash !== '') {
    return null
  }
  const match = /^\/(shared|embedded)\/([^/]+)\/?$/.exec(url.pathname)
  if (!match || !SHARE_TOKEN_PATTERN.test(match[2])) {
    return null
  }
  return `${POSTHOG_EMBED_ORIGIN}/embedded/${match[2]}`
}

/** A beágyazandó dashboard URL-je az env-ből (hibás/hiányzó érték → null). */
export function posthogEmbedUrl(): string | null {
  return normalizePosthogEmbedUrl(process.env.POSTHOG_SHARED_DASHBOARD_URL)
}

/**
 * A külső elemző-felületek linkjei — egy helyen, hogy a nézet és a doksi ne
 * csússzon szét. Ezek NEM titkok: bejelentkezés nélkül csak a Google/PostHog
 * saját belépőjét adják. A PostHog-link a projekt űrlapja; a projekt-azonosító
 * nyilvános útvonal-elem, nem hitelesítő adat.
 */
export const EXTERNAL_ANALYTICS_LINKS: ReadonlyArray<{ label: string; href: string }> = [
  { label: 'Google Analytics', href: 'https://analytics.google.com/' },
  { label: 'Search Console', href: 'https://search.google.com/search-console' },
  { label: 'Google Ads', href: 'https://ads.google.com/' },
  { label: 'PostHog', href: 'https://eu.posthog.com/project/253152' },
]
