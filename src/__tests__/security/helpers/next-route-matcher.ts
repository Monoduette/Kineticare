import { getRouteMatcher } from 'next/dist/shared/lib/router/utils/route-matcher'
import { getRouteRegex } from 'next/dist/shared/lib/router/utils/route-regex'

/**
 * A Next 16.4-ben megszűnt `next/dist/server/route-matchers/route-matcher`
 * `RouteMatcher.test()` viselkedésének pótlása a Next saját, megmaradt
 * útvonal-regex segédjeiből (ugyanaz a dinamikus szegmens-feloldás).
 */
export class RouteMatcher {
  private readonly matchFn: ReturnType<typeof getRouteMatcher>

  constructor(definition: { pathname: string; [key: string]: unknown }) {
    this.matchFn = getRouteMatcher(getRouteRegex(definition.pathname))
  }

  test(pathname: string): { params: Record<string, string | string[] | undefined> } | null {
    const params = this.matchFn(pathname)
    return params === false ? null : { params: params as Record<string, string | string[] | undefined> }
  }
}
