'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { getNavLinkRouteState } from '../../lib/nav-route'

interface FooterPageLinkProps {
  children: ReactNode
  className?: string
  href: string
}

export function FooterPageLink({ children, className, href }: FooterPageLinkProps) {
  const pathname = usePathname()
  const routeState = getNavLinkRouteState(href, pathname)
  const resolvedClassName = className
    ? `kc-site-footer__page-link ${className}`
    : 'kc-site-footer__page-link'

  return (
    <Link
      aria-current={routeState === 'current' ? 'page' : undefined}
      className={resolvedClassName}
      data-ancestor-active={routeState === 'ancestor' ? 'true' : undefined}
      href={href}
    >
      {children}
    </Link>
  )
}
