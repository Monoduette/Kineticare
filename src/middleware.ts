import { type NextRequest, NextResponse } from 'next/server'

import { LEGACY_GONE_HTML, isLegacyGonePath } from './lib/legacy-redirects'
import { REQUEST_ID_HEADER, resolveRequestId } from './lib/request-id'

/**
 * Indexelés-kapu: amíg az oldal a Railway-hoston fut, minden válasz `noindex`.
 *
 * A staging-host (`kineticare-production.up.railway.app`) a jövőbeli
 * www.kineticare.hu szó szerinti másolata, a `robots.txt` pedig mindenkit beenged.
 * Ha a Google beindexeli, duplikált tartalom kerül az indexbe, a cutover után
 * pedig railway-URL-ek maradnak benne. A crawlolás szándékosan engedve marad:
 * egy `Disallow: /` megakadályozná, hogy a Google egyáltalán elolvassa ezt a
 * headert, és a már beindexelt oldalak bent ragadnának.
 *
 * Kapcsoló: `NEXT_PUBLIC_ALLOW_INDEXING` (Railway-változó). Hiányzó vagy
 * `'true'`-tól eltérő érték esetén a kapu zárva — ez a fail-safe alapértelmezés.
 * A cutovernél `'true'`, a `NEXT_PUBLIC_SERVER_URL` pedig `https://www.kineticare.hu`.
 */
const ALLOW_INDEXING = process.env.NEXT_PUBLIC_ALLOW_INDEXING === 'true'
const ROBOTS_TAG_HEADER = 'X-Robots-Tag'
const NOINDEX_DIRECTIVES = 'noindex, nofollow, noarchive, nosnippet'

/**
 * A PostHog elsőfél-proxy (`/ingest`, `next.config.ts` rewrites) útvonala.
 *
 * A Next külső rewrite-ja (httpxy) MINDEN bejövő fejlécet továbbít, a
 * `Cookie`-t is. A posthog-js azonos eredetű kérései a böngészőben magukkal
 * viszik a `payload-token` munkamenet-JWT-t, így e szűrés nélkül a
 * bejelentkezett vevők, a staff és a tulajdonos munkamenet-tokenje minden
 * analitikai kéréssel a PostHoghoz kerülne. A PostHognak egyik sem kell: az
 * azonosítás a kérés törzsében megy.
 */
const POSTHOG_PROXY_PREFIX = '/ingest'
const POSTHOG_PROXY_STRIPPED_HEADERS = ['cookie', 'authorization'] as const

function isPosthogProxyPath(pathname: string): boolean {
  return pathname === POSTHOG_PROXY_PREFIX || pathname.startsWith(`${POSTHOG_PROXY_PREFIX}/`)
}

/**
 * Request ID middleware: minden bejövő kéréshez egyedi azonosítót rendel.
 *
 * - A meglévő `x-request-id` headert tiszteletben tartja (ha formailag érvényes),
 *   így a CDN/edge (pl. Cloudflare) és a Barion-callback-hívások azonosítója
 *   végigkövethető a rendszeren.
 * - A request headerekbe is beírja, hogy a route handlerek és Payload-hookok a
 *   `getRequestId` segéddel kiolvashassák, és a logger contextébe köthessék.
 * - A response mindig visszaadja a headerben a kliens/naplózás felé.
 *
 * Emellett EGY örökölt-URL ág fut itt: a régi kineticare.hu spam-posztjai
 * **410 Gone** választ kapnak. Miért itt és nem a `next.config.ts`-ben: a
 * `redirects()` kizárólag átirányítás-státuszokat tud kiadni (a Next
 * `allowedStatusCodes` listája: 301, 302, 303, 307, 308 —
 * `next/dist/lib/redirect-status.js`), 410-et nem. Öt dedikált route-fájl
 * helyett egy középponti ág marad, így a térkép egyetlen forrásból
 * (`src/lib/legacy-redirects.ts`) él. A tartós átirányítások változatlanul a
 * `next.config.ts` `redirects()`-ében vannak — a middleware azokhoz nem nyúl.
 */
export function middleware(request: NextRequest): NextResponse {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER))

  if (isLegacyGonePath(request.nextUrl.pathname)) {
    const gone = new NextResponse(LEGACY_GONE_HTML, {
      status: 410,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // Az elavult tartalom ne ragadjon be közbenső gyorsítótárba.
        'Cache-Control': 'no-store',
      },
    })
    gone.headers.set(REQUEST_ID_HEADER, requestId)
    return gone
  }

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(REQUEST_ID_HEADER, requestId)
  if (isPosthogProxyPath(request.nextUrl.pathname)) {
    // A Next a middleware fejléc-felülírását a rewrite ELŐTT alkalmazza, és a
    // listából hiányzó fejlécet törli (router-utils/resolve-routes.js), így a
    // proxy már süti és Authorization nélkül hívja a PostHogot.
    for (const header of POSTHOG_PROXY_STRIPPED_HEADERS) {
      requestHeaders.delete(header)
    }
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set(REQUEST_ID_HEADER, requestId)

  if (!ALLOW_INDEXING) {
    response.headers.set(ROBOTS_TAG_HEADER, NOINDEX_DIRECTIVES)
  }

  return response
}

export const config = {
  matcher: [
    // Statikus assetekre és meta-fájlokra nem fut le.
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
}
