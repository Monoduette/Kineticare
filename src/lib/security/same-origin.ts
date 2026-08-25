/**
 * Same-origin / CSRF-őr a sütis, saját POST API-kra.
 *
 * A Payload `csrf` listája az admin REST-et védi (`extractJWT`); a storefront
 * saját route-handlerei (pénztár, haladás, refund, ajándékozás, jelszócsere)
 * eddig csak a munkamenetre támaszkodtak. Böngészős POST-on az `Origin`
 * fejlécet a UA mindig kitölti — idegen oldalról indított, süti-csatolt
 * kérés így 403-at kap, még akkor is, ha a hívó be van jelentkezve.
 *
 * A lista UGYANAZ, mint a Payload `cors`/`csrf` engedélylistája
 * (`buildOriginAllowlist`): a publikus gyökér eredete + a kineticare.hu
 * apex/www társ + az `EXTRA_ALLOWED_ORIGINS`. Így a DNS-cutover alatt a
 * Railway-URL és a végleges tartomány ugyanazon a szabályon osztozik.
 *
 * Hiányzó Origin ÉS Referer: ÁTENGEDÉS. A unit-tesztek és a curl így nem
 * kötelező fejléccel dolgoznak; a modern böngésző POST-on küld Origint,
 * tehát a CSRF-út ettől még zárva van.
 */

import { buildOriginAllowlist } from '../../env'

export const SAME_ORIGIN_REJECTED_MESSAGE = 'A kérés elutasítva: idegen oldalról jött.'

export type SameOriginOk = { ok: true }
export type SameOriginRejected = { ok: false; status: 403; message: string }
export type SameOriginResult = SameOriginOk | SameOriginRejected

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function rejected(): SameOriginRejected {
  return { ok: false, status: 403, message: SAME_ORIGIN_REJECTED_MESSAGE }
}

function currentAllowlist(): string[] {
  // A tiszta építő NEM olvassa a process.env-et — a hívó adja át, ugyanúgy,
  // mint a payload.config `cors`/`csrf` bekötése.
  return buildOriginAllowlist(process.env.NEXT_PUBLIC_SERVER_URL, process.env.EXTRA_ALLOWED_ORIGINS)
}

function originFromReferer(referer: string): string | null {
  try {
    return new URL(referer).origin
  } catch {
    return null
  }
}

/**
 * Origin/Referer egyeztetés az engedélylistával. A metódust NEM nézi —
 * a POST-only handlerek ezt hívják.
 */
export function assertSameOrigin(request: Request): SameOriginResult {
  const allowed = currentAllowlist()

  const originHeader = request.headers.get('origin')?.trim() ?? ''
  if (originHeader.length > 0) {
    return allowed.includes(originHeader) ? { ok: true } : rejected()
  }

  const refererHeader = request.headers.get('referer')?.trim() ?? ''
  if (refererHeader.length > 0) {
    const refererOrigin = originFromReferer(refererHeader)
    if (refererOrigin !== null && allowed.includes(refererOrigin)) {
      return { ok: true }
    }
    return rejected()
  }

  return { ok: true }
}

/**
 * GET/HEAD/OPTIONS mindig átmegy (nincs CSRF-állapotváltoztatás);
 * minden más metóduson az `assertSameOrigin` szabályai élnek.
 */
export function assertSameOriginUnlessSafeMethod(request: Request): SameOriginResult {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return { ok: true }
  }
  return assertSameOrigin(request)
}
