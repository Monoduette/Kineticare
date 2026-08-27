'use client'

import Link from 'next/link'
import { useAuth } from '@payloadcms/ui'

import { hasStaffOrOwnerRole } from '../../access/roles'

/**
 * Webanalitika-link a Payload oldalsávjába (a StatisticsNavLink mintája).
 *
 * A link elrejtése csak kozmetika: a védelem a szerver-oldali kapu a
 * WebAnalyticsView-ban. Be nem jelentkezett vagy customer felhasználó a
 * közvetlen URL-t is megkaphatja — ott a nézet magyarul elutasít, adatot
 * nem ad.
 */
export function WebAnalyticsNavLink() {
  const { user } = useAuth<{ id: number | string; role?: string | null }>()
  if (!hasStaffOrOwnerRole(user)) {
    return null
  }

  return (
    <div style={{ marginTop: 'calc(var(--base) * 0.75)' }}>
      <Link className="nav__link" href="/admin/webanalitika" prefetch={false}>
        Webanalitika
      </Link>
    </div>
  )
}

export default WebAnalyticsNavLink
