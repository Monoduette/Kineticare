import type { CSSProperties } from 'react'
import type { AdminViewServerProps } from 'payload'

import { hasStaffOrOwnerRole } from '../../access/roles'
import { AdminChrome, AdminViewFrame } from './AdminChrome'
import { BunnyLibraryPanel } from './BunnyLibraryPanel'

/**
 * Admin Videótár nézet (`/admin/videok`).
 *
 * A feltöltés a Bunny felületén marad. Itt a library videói listázhatók, a
 * GUID a kurzus leckéjébe másolható. A Payload custom view nyilvános
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
        <p style={{ color: 'var(--theme-elevation-650)', maxWidth: '42rem' }}>
          A felvételek a Bunny Stream tárban élnek. Töltsd fel őket ott, majd ide behívva másold a
          videó azonosítóját a kurzus leckéjébe. A vevő és az ingyenes kurzus nézője a meglévő
          lejátszón látja a videót, feltöltés innen nem indul.
        </p>
        {/* A panel itt közvetlenül a lap h1-e alá kerül, ezért h2-t kap: az
            alapértelmezett h3 egy szintet átugorna (h1 → h3), és a
            képernyőolvasót használó munkatárs hiányzó szakaszt olvasna ki
            belőle (WCAG 2.2 SC 1.3.1). A termék-szerkesztőben a panel
            változatlanul h3 marad. */}
        <BunnyLibraryPanel headingLevel="h2" />
      </div>
    </AdminChrome>
  )
}

export default BunnyLibraryView
