import { buildOriginAllowlist } from '../../env'
import { classifyRateLimitedRoute } from './rate-limit'

/** Payload REST-alaku, felhasznalonak szant hiba; keresi adatot nem tartalmaz. */
export const LOGIN_CSRF_REJECTED_MESSAGE =
  'A bejelentkezesi keres eredete nem engedelyezett.'

const FETCH_SITE_HEADER = 'sec-fetch-site'
const ORIGIN_HEADER = 'origin'
const REFERER_HEADER = 'referer'

function isLoginPost(request: Request): boolean {
  let pathname: string
  try {
    pathname = new URL(request.url).pathname
  } catch {
    return false
  }
  return classifyRateLimitedRoute(request.method, pathname) === 'login'
}

function configuredOrigins(): Set<string> {
  return new Set(
    buildOriginAllowlist(
      process.env.NEXT_PUBLIC_SERVER_URL,
      process.env.EXTRA_ALLOWED_ORIGINS,
    ),
  )
}

function hasAllowedReferer(referer: string, allowedOrigins: ReadonlySet<string>): boolean {
  let parsed: URL
  try {
    parsed = new URL(referer)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false
  }
  return allowedOrigins.has(parsed.origin)
}

function isJsonRequest(request: Request): boolean {
  const contentType = request.headers.get('content-type') ?? ''
  const [essence = ''] = contentType.split(';', 1)
  return essence.trim().toLowerCase() === 'application/json'
}

function shouldRejectLoginRequest(request: Request): boolean {
  const fetchSite = request.headers.get(FETCH_SITE_HEADER)?.trim().toLowerCase()
  if (fetchSite === 'cross-site') {
    return true
  }

  const allowedOrigins = configuredOrigins()

  if (request.headers.has(ORIGIN_HEADER)) {
    const origin = request.headers.get(ORIGIN_HEADER)?.trim() ?? ''
    return !allowedOrigins.has(origin)
  }

  if (request.headers.has(REFERER_HEADER)) {
    const referer = request.headers.get(REFERER_HEADER)?.trim() ?? ''
    return !hasAllowedReferer(referer, allowedOrigins)
  }

  if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return true
  }

  // Dokumentalt nem-browser kompatibilitasi ut: eredetjel nelkuli JSON login.
  return !isJsonRequest(request)
}

function loginCsrfRejectionResponse(): Response {
  return Response.json(
    { errors: [{ message: LOGIN_CSRF_REJECTED_MESSAGE }] },
    {
      status: 403,
      headers: {
        'Cache-Control': 'no-store',
        Vary: 'Origin, Referer, Sec-Fetch-Site, Content-Type',
      },
    },
  )
}

/**
 * A Payload login keres eredetellenorzese. Csak fejleceket es URL-t olvas;
 * elutasitaskor nem klonozza es nem olvassa a keres torzset.
 */
export function withPayloadLoginCsrfProtection<Args extends unknown[]>(
  handler: (request: Request, ...args: Args) => Promise<Response>,
): (request: Request, ...args: Args) => Promise<Response> {
  return async function loginCsrfProtectedHandler(
    request: Request,
    ...args: Args
  ): Promise<Response> {
    if (isLoginPost(request) && shouldRejectLoginRequest(request)) {
      return loginCsrfRejectionResponse()
    }
    return handler(request, ...args)
  }
}
