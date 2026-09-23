import { readBodyBytesWithCap } from './request-body'

/**
 * A Payload REST nem-multipart törzseinek felső korlátja (2 MiB).
 *
 * A Payload `addDataAndFileToRequest` a POST/PATCH/PUT JSON-törzsét
 * `req.text()`-tel, korlát nélkül olvassa be, és ez a jogosultság-ellenőrzés
 * ELŐTT történik. Egy névtelen, több száz MB-os `POST /api/<collection>` így
 * teljes egészében a memóriába kerülne, mielőtt a 403 megszületik. Az admin
 * felület dokumentum-mentései multipart (`_payload` mező) alakban mennek, a
 * JSON-hívások (preferenciák, zárolás, űrlap-beküldés) kicsik, tehát a 2 MiB
 * bőven fedi a valódi forgalmat.
 *
 * A multipart törzset NEM itt korlátozzuk: azt a Payload busboy-parsere
 * streamelve olvassa, a fájlokra az `upload.limits.fileSize` (10 MB,
 * `abortOnLimit`) és a mezőkre a busboy saját mezőméret-korlátja vigyáz.
 */
export const PAYLOAD_REST_BODY_MAX_BYTES = 2 * 1024 * 1024

export const PAYLOAD_REST_BODY_TOO_LARGE_MESSAGE =
  'A kérés törzse túl nagy. Rövidítsd a beküldött adatot, és próbáld újra.'

const BODY_METHODS = new Set(['POST', 'PATCH', 'PUT'])

function isMultipart(request: Request): boolean {
  const contentType = request.headers.get('content-type') ?? ''
  return contentType.trim().toLowerCase().startsWith('multipart/')
}

function bodyTooLargeResponse(): Response {
  return Response.json(
    { errors: [{ message: PAYLOAD_REST_BODY_TOO_LARGE_MESSAGE }] },
    { status: 413, headers: { 'Cache-Control': 'no-store' } },
  )
}

/**
 * Új kérés a korlátozottan beolvasott bájtokból, az eredeti URL-lel,
 * metódussal, fejlécekkel és megszakítás-jelzővel.
 *
 * Az eredeti kérést szándékosan NEM adjuk a `Request` konstruktor
 * `input`-jaként. A Next 16 a route handlernek Proxyba csomagolt NextRequest-et
 * ad (next/dist/server/route-modules/app-route/module.js, `proxyNextRequest`),
 * a Node 24 undici-ja pedig az `input` privát `#state` mezőjét olvassa, ami
 * Proxyn TypeError („Cannot read private member #state”). Ugyanez a minta a
 * `reset-password-route.ts`-ben és a Payload method-override ágában
 * (`payload/dist/utilities/handleEndpoints.js`).
 */
function requestFromBoundedBytes(request: Request, bytes: Uint8Array<ArrayBuffer>): Request {
  return new Request(request.url, {
    method: request.method,
    headers: new Headers(request.headers),
    body: bytes,
    signal: request.signal,
  })
}

/**
 * A nem-multipart törzset legfeljebb `maxBytes` bájtig olvassa be; afölött
 * 413-at ad, és a kérés el sem jut a Payloadig. A beolvasott bájtokból új
 * `Request` készül, így a továbbiakban minden réteg (CSRF, rate limit, reset,
 * Payload) a már korlátozott törzset olvassa.
 */
export function withPayloadRestBodyLimit<Args extends unknown[]>(
  handler: (request: Request, ...args: Args) => Promise<Response>,
  maxBytes: number = PAYLOAD_REST_BODY_MAX_BYTES,
): (request: Request, ...args: Args) => Promise<Response> {
  return async function bodyLimitedHandler(request: Request, ...args: Args): Promise<Response> {
    if (!BODY_METHODS.has(request.method.toUpperCase()) || request.body === null) {
      return handler(request, ...args)
    }
    if (isMultipart(request)) {
      return handler(request, ...args)
    }
    const bytes = await readBodyBytesWithCap(request, maxBytes)
    if (bytes === null) {
      return bodyTooLargeResponse()
    }
    return handler(requestFromBoundedBytes(request, bytes), ...args)
  }
}
