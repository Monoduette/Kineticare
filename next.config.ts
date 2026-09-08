import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

import { buildLegacyRedirects } from './src/lib/legacy-redirects'
import { bunnyPullZoneHost } from './src/lib/stream/bunny-site-config'
import { buildContentSecurityPolicy } from './src/lib/security/csp'

const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com'

const nextConfig: NextConfig = {
  // Az optimizer cache közös, és a belső fetch nem továbbítja a vevő sütijét.
  // Csak a tényleges nyilvános képterek optimalizálhatók; a course-files
  // külön jogosultságellenőrzött URL-je közvetlenül tölthető le.
  images: {
    localPatterns: [
      { pathname: '/api/media/file/*' },
      { pathname: '/media/**' },
      { pathname: '/assets/**' },
      { pathname: '/_next/static/media/**' },
    ],
  },
  experimental: {
    // A `src/app/global-not-found.tsx` KIZÁRÓLAG ezzel a kapcsolóval él —
    // enélkül a Next figyelmen kívül hagyja a fájlt, és a nem illeszkedő
    // URL-ekre a beépített, ANGOL nyelvű 404-lapját küldi (mérve 2026-08-16:
    // `GET /egy/ket/harom` → „404 · This page could not be found.", keret,
    // magyar szöveg és link nélkül).
    //
    // Miért nem elég a `not-found.tsx`: a Next a gyökérszintű, nem illeszkedő
    // URL-eket csak EGYETLEN gyökér-layout mellett tudja a `not-found`-dal
    // összerakni. Ennek a projektnek kettő van — `(frontend)` és `(payload)` —,
    // és a hivatalos dokumentáció erre az esetre írja elő a `global-not-found`-ot:
    // https://nextjs.org/docs/app/api-reference/file-conventions/not-found
    //
    // A kapcsoló kísérleti (Next 15.4 óta létezik). Következmény, ha egy jövőbeli
    // Next-verzióban átnevezik vagy stabilizálják: a global-not-found lap némán
    // kiesik, és visszatér az angol beépített lap. Ezt őr-teszt fogja meg
    // (`src/__tests__/hibaoldal.test.tsx`): a teszt megköveteli, hogy a kapcsoló
    // és a fájl EGYÜTT létezzen.
    globalNotFound: true,
  },
  // PostHog elsőfél-proxy: a kliens a saját domainünk /ingest útvonalát hívja,
  // a Next pedig továbbítja a PostHog EU-cloud felé (ad-blocker-ellenállás +
  // first-party süti-működés). A /ingest/static az assets-kiszolgálás (toolbar,
  // recorder, surveys); a /ingest/decide az egyszerű /ingest mintába tartozik.
  async rewrites() {
    const host = POSTHOG_HOST.replace(/\/+$/, '')
    return [
      {
        source: '/ingest/static/:path*',
        destination: 'https://eu-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: `${host}/:path*`,
      },
    ]
  },
  // A PostHog proxy átirányításai (pl. /decide → /flags) az origin-hostra
  // mutatnának — skip, hogy a kliens a saját domainen maradjon.
  skipTrailingSlashRedirect: true,

  // Örökölt kineticare.hu URL-ek megőrzése a domain-átállításhoz: mind a 25
  // régi sitemap-URL kap sorsot (változatlan slug · tartós 308 · 410 Gone).
  // A térkép, az indoklás és a mérés a src/lib/legacy-redirects.ts fejlécében
  // él, a szabályokat a src/__tests__/orokolt-url-atiranyitasok.test.ts őrzi;
  // a végleges táblázat: docs/orokolt-url-atiranyitasok.md.
  //
  // FIGYELEM: a redirects() — a headers()-höz hasonlóan — a BUILD idején sül
  // bele a .next/routes-manifest.json-be, tehát a térkép módosítása után
  // VALÓDI újrabuildelés kell (CLAUDE.md 1. üzemeltetési tanulság).
  async redirects() {
    return buildLegacyRedirects()
  },

  // OWASP A05: biztonsági HTTP-fejlécek minden válaszon. Maga a CSP a
  // src/lib/security/csp.ts tiszta függvényében él (direktívánkénti magyar
  // indoklással és egységteszttel) — itt csak a válaszfejlécbe kerül.
  //
  // FIGYELEM: a headers() a BUILD idején értékelődik ki, és a
  // .next/routes-manifest.json-be sül bele — env-változtatás (pl. a Bunny
  // pull-zone hoszt) után ÚJRA KELL BUILDELNI, különben a régi fejléc megy ki
  // (vö. CLAUDE.md „a SUCCESS deploy nem jelenti, hogy az új kód fut").
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          // HSTS: az első, síma HTTP-s találkozás is védett legyen (a Railway
          // edge NEM pótolja). A preload csak saját, bejegyzett doménnel lenne
          // értelmes — az up.railway.app public-suffix, oda nem kell.
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: buildContentSecurityPolicy(
              bunnyPullZoneHost(),
              process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
              process.env.NEXT_PUBLIC_BARION_PIXEL_ID,
              process.env.POSTHOG_SHARED_DASHBOARD_URL,
            ),
          },
        ],
      },
    ]
  },
}

export default withPayload(nextConfig)
