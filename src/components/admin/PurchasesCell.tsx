'use client'

import { useEffect, useState } from 'react'

import type { UserCourseProgressEntry } from '../../lib/admin/user-progress-contract'
import { loadCourseTitles } from './course-titles-client'
import { formatPurchaseRows, readRowUserId } from './purchases-cell'
import { loadUserProgress } from './user-progress-client'

/**
 * A Felhasználók admin-lista „Megvásárolt kurzusok" oszlopának cellája.
 * (`docs/statisztika-audit-2026-08-21.md` §2) szerint ehhez NEM jön új oszlop,
 */
export function PurchasesCell({ cellData, rowData }: { cellData?: unknown; rowData?: unknown }) {
  const [titles, setTitles] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [progress, setProgress] = useState<readonly UserCourseProgressEntry[] | null>(null)

  useEffect(() => {
    let active = true
    void loadCourseTitles().then((loaded) => {
      if (active) {
        setTitles(loaded)
      }
    })
    return () => {
      active = false
    }
  }, [])

  // A Payload a Cell-nek a sor TELJES dokumentumát is átadja `rowData`-ként
  // (mérve: @payloadcms/ui 3.88.0, buildColumnState/renderCell.js). A típusa
  // ott `Record<string, any>`, ezért itt `unknown`-ként vesszük át, és
  // típusszűkítéssel olvassuk ki — hiányzó azonosítónál nincs kérés, a cella
  // pedig a haladás nélküli alakjában marad.
  const userId = readRowUserId(rowData)

  useEffect(() => {
    if (userId === null) {
      return
    }
    let active = true
    void loadUserProgress(userId).then((loaded) => {
      if (active) {
        setProgress(loaded)
      }
    })
    return () => {
      active = false
    }
  }, [userId])

  const rows = formatPurchaseRows(cellData, titles, progress)
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {rows.map((row, index) => (
        // A kulcs a sorindex: két azonos című kurzus is előfordulhat.
        <li key={index} style={{ whiteSpace: 'nowrap' }}>
          {row.text}
        </li>
      ))}
    </ul>
  )
}

export default PurchasesCell
