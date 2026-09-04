'use client'

import { usePathname } from 'next/navigation'

import type { NavItem } from '../../lib/menu-tree'
import { getNavRouteState } from '../../lib/nav-route'
import { NavAnchor } from './NavAnchor'

const COURSES_NAV_ITEM: NavItem = {
  id: 0,
  label: 'Kurzusok',
  href: '/kurzusok',
  openInNewTab: false,
  isExternal: false,
  children: [],
}

/** A CMS-menütől független, állandó kurzus-link aktuális oldal állapota. */
export function HeaderCoursesNav() {
  const pathname = usePathname()

  return (
    <NavAnchor
      className="kc-button kc-button--primary kc-button--sm kc-site-header__cta"
      item={COURSES_NAV_ITEM}
      routeState={getNavRouteState(COURSES_NAV_ITEM, pathname)}
    />
  )
}
