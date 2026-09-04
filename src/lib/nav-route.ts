import type { NavItem } from './menu-tree'

export type NavRouteState = 'inactive' | 'current' | 'ancestor'

function normalizeRootRelativePath(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return null
  }

  return trimmed.replace(/\/+$/, '') || '/'
}

/** Az aktuális pathname összehasonlító alakja; query/hash és záró perjel nélkül. */
function normalizeCurrentPath(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  const suffixIndex = trimmed.search(/[?#]/)
  const pathname = suffixIndex === -1 ? trimmed : trimmed.slice(0, suffixIndex)
  return normalizeRootRelativePath(pathname)
}

/**
 * Belső link összehasonlító alakja. A query nem változtat oldalt, de a hash
 * olyan dokumentumon belüli cél, amelyet a usePathname nem tud azonosítani.
 */
function normalizeNavTarget(href: string): string | null {
  const trimmed = href.trim()
  if (trimmed.includes('#')) {
    return null
  }

  const queryIndex = trimmed.indexOf('?')
  return normalizeRootRelativePath(queryIndex === -1 ? trimmed : trimmed.slice(0, queryIndex))
}

function getNavRouteStateForPath(item: NavItem, currentPath: string): NavRouteState {
  const itemPath = item.isExternal ? null : normalizeNavTarget(item.href)
  if (itemPath === null) return 'inactive'

  if (currentPath === itemPath) return 'current'

  // A perjeles határ akadályozza meg, hogy pl. /blog egyezzen /blogger-rel.
  if (itemPath !== '/' && currentPath.startsWith(`${itemPath}/`)) return 'ancestor'

  return item.children.some((child) => getNavRouteStateForPath(child, currentPath) !== 'inactive')
    ? 'ancestor'
    : 'inactive'
}

/**
 * Aktuális navigációs állapot. Csak a pontos belső link lesz `current`
 * (`aria-current="page"`); egy útvonal- vagy menüfa-ős külön adatállapotot kap.
 */
export function getNavRouteState(item: NavItem, pathname: string | null): NavRouteState {
  const currentPath = normalizeCurrentPath(pathname)
  return currentPath === null ? 'inactive' : getNavRouteStateForPath(item, currentPath)
}
