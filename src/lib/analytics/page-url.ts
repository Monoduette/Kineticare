/**
 * Analytics URL tisztítás: token query kivágása; utm_* marad. Relatív URL-re is működik.
 */

/** A kimenő URL-ből MINDIG eltávolítandó query-paraméterek (kis-nagybetűtől függetlenül). */
const SENSITIVE_QUERY_PARAMS: readonly string[] = ['token']

/**
 * Az URL megtisztítva: érzékeny query-paraméterek kivágva, hash lemarad,
 * minden más (útvonal, utm_*, stb.) érintetlen.
 */
export function sanitizeAnalyticsUrl(url: string): string {
  if (typeof url !== 'string' || url.length === 0) {
    return ''
  }
  const hashIndex = url.indexOf('#')
  const withoutHash = hashIndex === -1 ? url : url.slice(0, hashIndex)
  const queryIndex = withoutHash.indexOf('?')
  if (queryIndex === -1) {
    return withoutHash
  }
  const path = withoutHash.slice(0, queryIndex)
  const rawQuery = withoutHash.slice(queryIndex + 1)
  const kept = rawQuery.split('&').filter((pair) => {
    if (pair.length === 0) {
      return false
    }
    const rawKey = pair.split('=')[0]
    let key = rawKey
    try {
      key = decodeURIComponent(rawKey)
    } catch {
      // Sérült kódolású kulcs: nyersen marad — a lista akkor is kiszűri, ha kell.
    }
    return !SENSITIVE_QUERY_PARAMS.includes(key.toLowerCase())
  })
  return kept.length > 0 ? `${path}?${kept.join('&')}` : path
}
