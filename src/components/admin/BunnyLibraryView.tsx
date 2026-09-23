import type { CSSProperties } from 'react'
import type { AdminViewServerProps } from 'payload'

import { hasStaffOrOwnerRole } from '../../access/roles'
import { AdminChrome, AdminViewFrame } from './AdminChrome'
import { BunnyVideoLibrary } from './BunnyLibraryPanel'

/**
 * Admin Videótár nézet (`/admin/videok`).
 *
 * Keresés, előnézet és védett videófeltöltés. A Payload custom view nyilvános
 * admin-route, ezért a szerver-oldali szerepkör-kapu az egyetlen védelem.
 *
 * K50 (admin-audit, 2026-09-22): az oldalmargó a Payload saját gutter-tokenje
 * (--gutter-h, a core `.gutter--left/right` értéke), így a tartalom bal éle
 * lapról lapra ugyanott áll, ahol az Irányítópulté és a Statisztikáé
 * (--kc-as-gutter: var(--gutter-h)). A korábbi 30 px-es saját margó a 60 px-es
 * gutter felére ugrott (WCAG 2.2 SC 3.2.3, Consistent Navigation szellemében;
 * NN/g, Consistency and standards: https://www.nngroup.com/articles/ten-usability-heuristics/).
 */

const pageStyle: CSSProperties = {
  paddingBlock: 'calc(var(--base) * 1.5)',
  paddingInline: 'var(--gutter-h)',
  maxWidth: '64rem',
}

const DENIED_MESSAGE = 'A Videótárat csak munkatárs vagy tulajdonos nézheti meg.'

export function BunnyLibraryView(props: AdminViewServerProps) {
  const { req } = props.initPageResult
  if (!hasStaffOrOwnerRole(req.user)) {
    return (
      <AdminViewFrame props={props} title="Videótár">
        <div style={pageStyle}>
          <h1 style={{ marginTop: 0 }}>Videótár</h1>
          <p>{DENIED_MESSAGE}</p>
        </div>
      </AdminViewFrame>
    )
  }

  return (
    <AdminChrome props={props} title="Videótár">
      <div style={pageStyle}>
        <h1 style={{ marginTop: 0 }}>Videótár</h1>
        <BunnyVideoLibrary />
      </div>
    </AdminChrome>
  )
}

export default BunnyLibraryView
