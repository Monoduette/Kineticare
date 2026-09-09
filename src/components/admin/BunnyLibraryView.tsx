import type { CSSProperties } from 'react'
import type { AdminViewServerProps } from 'payload'

import { hasStaffOrOwnerRole } from '../../access/roles'
import { AdminChrome, AdminViewFrame } from './AdminChrome'
import { BunnyVideoLibrary } from './BunnyLibraryPanel'

/**
 * Admin Videótár nézet (`/admin/videok`).
 *
 * Kereses, elonezet es vedett videofeltoltes. A Payload custom view nyilvános
 * admin-route, ezért a szerver-oldali szerepkör-kapu az egyetlen védelem.
 */

const pageStyle: CSSProperties = {
  padding: 'calc(var(--base) * 1.5)',
  maxWidth: '64rem',
}

const DENIED_MESSAGE = 'A Videótárat csak munkatárs vagy tulajdonos nézheti meg.'

export function BunnyLibraryView(props: AdminViewServerProps) {
  const { req } = props.initPageResult
  if (!hasStaffOrOwnerRole(req.user)) {
    return (
      <AdminViewFrame props={props}>
        <div style={pageStyle}>
          <h1 style={{ marginTop: 0 }}>Videótár</h1>
          <p>{DENIED_MESSAGE}</p>
        </div>
      </AdminViewFrame>
    )
  }

  return (
    <AdminChrome props={props}>
      <div style={pageStyle}>
        <h1 style={{ marginTop: 0 }}>Videótár</h1>
        <BunnyVideoLibrary />
      </div>
    </AdminChrome>
  )
}

export default BunnyLibraryView
