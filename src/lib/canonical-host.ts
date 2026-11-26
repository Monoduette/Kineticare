/**
 * A Railway-hostról (`*.up.railway.app`) érkező oldal-kérés átirányítása a
 * saját domainre.
 *
 * MIÉRT. A `kineticare-production.up.railway.app` a www.kineticare.hu
 * szó szerinti másolata, és élő forgalmat kap: mérve 2026-11-26, 60 nap alatt
 * a PostHogban 39 munkamenet (az összes 6%-a) ezen a hoston futott, a
 * belépők az Instagram-bióból és a Linktree-ből jöttek. Ezek a látogatók egy
 * másik eredeten járnak, ezért ott újra megkapják a süti-sávot, a
 * hozzájárulásuk, a bejelentkezésük és a PostHog-azonosítójuk nem azonos a
 * www-n levővel, a webanalitika pedig két hostra bontja a forgalmukat. Az
 * oldal ott `noindex` fejlécet kap (src/middleware.ts), tehát keresőből sem
 * érdemes oda menni.
 *
 * MIT NEM BÁNT.
 * - Csak GET és HEAD: a Barion-callback és minden más POST változatlanul
 *   lefut, akármelyik hostra érkezik.
 * - Az `/api`, `/admin`, `/ingest` és `/_next` útvonalak maradnak: a
 *   gépi hívók (fizetés, számlázás, Railway-healthcheck a `GET /admin`-on,
 *   a PostHog-proxy) nem kapnak átirányítást.
 * - Csak akkor irányít, ha a cél (`NEXT_PUBLIC_SERVER_URL`) https, és nem
 *   maga is Railway-host. Hiányzó vagy hibás célnál semmi nem történik.
 *
 * BIZTONSÁG. A cél origója kizárólag a beállításból jön, a kérés hostjából
 * soha. Az útvonalat szöveg-összefűzéssel tesszük az origó mögé, nem
 * `new URL(path, origin)`-nel: az utóbbi a `//masik-oldal.hu` alakú
 * útvonalat idegen hostként oldaná fel (nyitott átirányítás).
 */

const RAILWAY_HOST_SUFFIX = '.up.railway.app'

const EXEMPT_PREFIXES = ['/api', '/admin', '/ingest', '/_next'] as const

export interface CanonicalHostInput {
  method: string
  /** A kérés `Host` fejléce, port nélkül vagy porttal. */
  host: string | null
  pathname: string
  /** A query a kezdő `?`-lel, vagy üres szöveg. */
  search: string
  /** A kanonikus webcím (`NEXT_PUBLIC_SERVER_URL`). */
  serverUrl: string | undefined
}

function hasPathPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

function hostnameOf(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, '')
}

function canonicalOrigin(serverUrl: string | undefined): string | null {
  if (!serverUrl) {
    return null
  }
  try {
    const url = new URL(serverUrl)
    if (url.protocol !== 'https:' || url.hostname.endsWith(RAILWAY_HOST_SUFFIX)) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

/** Az átirányítás célja, vagy null, ha a kérés maradhat. */
export function canonicalHostRedirectUrl(input: CanonicalHostInput): string | null {
  const method = input.method.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    return null
  }
  if (input.host === null || !hostnameOf(input.host).endsWith(RAILWAY_HOST_SUFFIX)) {
    return null
  }
  if (EXEMPT_PREFIXES.some((prefix) => hasPathPrefix(input.pathname, prefix))) {
    return null
  }
  const origin = canonicalOrigin(input.serverUrl)
  if (origin === null) {
    return null
  }
  const path = input.pathname.startsWith('/') ? input.pathname : `/${input.pathname}`
  return `${origin}${path}${input.search}`
}
