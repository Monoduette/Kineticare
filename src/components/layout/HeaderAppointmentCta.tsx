'use client'

import { usePathname } from 'next/navigation'

import { HEADER_APPOINTMENT_NAV_ITEM } from '../../lib/header-appointment'
import { getNavRouteState } from '../../lib/nav-route'
import { NavAnchor } from './NavAnchor'

type HeaderAppointmentCtaProps = {
  variant: 'bar' | 'drawer'
  onNavigate?: () => void
}

/**
 * A fejléc Időpontkérés gombja — secondary, a Kurzusok primary pirula mellett.
 * A hash-cél miatt `aria-current` sosem jár (lásd `nav-route`).
 */
export function HeaderAppointmentCta({ variant, onNavigate }: HeaderAppointmentCtaProps) {
  const pathname = usePathname()
  const className =
    variant === 'bar'
      ? 'kc-button kc-button--secondary kc-button--sm kc-site-header__appointment-cta'
      : 'kc-button kc-button--secondary kc-site-header__drawer-appointment'

  return (
    <NavAnchor
      className={className}
      item={HEADER_APPOINTMENT_NAV_ITEM}
      onClick={onNavigate}
      routeState={getNavRouteState(HEADER_APPOINTMENT_NAV_ITEM, pathname)}
    />
  )
}
