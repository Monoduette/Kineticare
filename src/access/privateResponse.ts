import type { PayloadRequest } from 'payload'

/** Jogosultságtól függő REST-válasz soha ne kerüljön megosztott cache-be. */
export function privateResponseHeaders(headers = new Headers()): Headers {
  headers.set('Cache-Control', 'private, no-store')
  headers.set('X-Content-Type-Options', 'nosniff')
  const vary = new Set(
    (headers.get('Vary') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )
  vary.add('Cookie')
  vary.add('Authorization')
  headers.set('Vary', [...vary].join(', '))
  return headers
}

export function markResponsePrivate(req: PayloadRequest): void {
  const headers = privateResponseHeaders(req.responseHeaders ?? new Headers())
  req.responseHeaders = headers
}

type RestHandler = (
  request: Request,
  args: { params: Promise<{ slug?: string[] }> },
) => Promise<Response>

/**
 * A HEAD-kérés GET-párja az URL-ből és explicit mezőkből épül, nem a kérésből
 * mint bemenetből. A Next 16 a route handlernek Proxyba csomagolt NextRequest-et
 * ad, a Node 24 (undici 7) Request-konstruktora pedig a bemenet privát `#state`
 * mezőjét olvassa, ami Proxyn TypeError, vagyis 500-as válasz lenne. A fejlécek
 * (Range, Cookie, Authorization) és a megszakítási jel változatlanul mennek át.
 */
function getRequestForHead(request: Request): Request {
  return new Request(request.url, {
    method: 'GET',
    headers: new Headers(request.headers),
    signal: request.signal,
  })
}

/** A framework előtti hibák és HEAD/range válaszok is ugyanazt a cache-kaput kapják. */
export function withPrivateCourseFileResponse(handler: RestHandler): RestHandler {
  return async (request, args) => {
    const params = await args.params
    if (params.slug?.[0] !== 'course-files') return handler(request, args)
    const isHead = request.method === 'HEAD'
    const response = await handler(isHead ? getRequestForHead(request) : request, args)
    if (isHead) await response.body?.cancel()
    return new Response(isHead ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: privateResponseHeaders(new Headers(response.headers)),
    })
  }
}
