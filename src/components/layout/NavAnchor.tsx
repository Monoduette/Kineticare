import Link from 'next/link'
import type { ReactNode } from 'react'

import type { NavItem } from '../../lib/menu-tree'
import type { NavRouteState } from '../../lib/nav-route'

/**
 * Közös link-render a navigációhoz: belső útvonal → next/link, külső → <a>;
 * az openInNewTab (menus.openInNewTab) target="_blank" + rel="noopener noreferrer".
 * Külső hivatkozás mellett jelölő-ikon és képernyőolvasó-megjegyzés jelenik meg.
 */

export function ExternalLinkIcon() {
  return (
    <svg
      aria-hidden="true"
      className="kc-nav__external-icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" x2="21" y1="14" y2="3" />
    </svg>
  )
}

export interface NavAnchorProps {
  item: NavItem
  className?: string
  children?: ReactNode
  onClick?: () => void
  routeState?: NavRouteState
}

export function NavAnchor({
  item,
  className,
  children,
  onClick,
  routeState = 'inactive',
}: NavAnchorProps) {
  const content = (
    <>
      {children ?? item.label}
      {item.isExternal ? (
        <>
          {' '}
          <ExternalLinkIcon />
          <span className="kc-visually-hidden">(külső hivatkozás)</span>
        </>
      ) : null}
    </>
  )
  const newTabProps = item.openInNewTab ? { target: '_blank', rel: 'noopener noreferrer' } : {}
  const ariaCurrent = !item.isExternal && routeState === 'current' ? 'page' : undefined
  const ancestorActive = !item.isExternal && routeState === 'ancestor' ? 'true' : undefined

  if (item.isExternal) {
    return (
      <a
        className={className}
        data-ancestor-active={ancestorActive}
        href={item.href}
        onClick={onClick}
        {...newTabProps}
      >
        {content}
      </a>
    )
  }
  return (
    <Link
      aria-current={ariaCurrent}
      className={className}
      data-ancestor-active={ancestorActive}
      href={item.href}
      onClick={onClick}
      {...newTabProps}
    >
      {content}
    </Link>
  )
}
