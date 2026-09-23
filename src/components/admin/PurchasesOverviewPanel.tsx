'use client'

import { useAuth, useDocumentInfo, useFormFields } from '@payloadcms/ui'
import { useEffect, useState, type CSSProperties } from 'react'

import { hasOwnerRole } from '../../access/roles'
import { loadCourseTitles } from './course-titles-client'
import { formatPurchaseLabels, readPurchaseIds } from './purchases-cell'

/**
 * „Megvásárolt kurzusok (áttekintés)" panel a felhasználó szerkesztőnézetében
 * (users `type: 'ui'` mező — NEM tárol adatot, séma-változást nem igényel).
 *
 * MIRE VALÓ: a fölötte lévő relationship-mező a szerkesztés helye, de a
 * választható elemeket a Payload a kurzusok `useAsTitle` mezőjével (`sku`)
 * címkézi. Ez a panel ugyanazt a listát a kurzus CÍMÉVEL mutatja meg, hogy a
 * tulajdonos ránézésre lássa, mit vett meg a vásárló.
 *
 * ÉLŐ ÉRTÉK: az űrlap aktuális mezőértékéből dolgozik (`useFormFields`), tehát
 * a hozzáadott vagy elvett kurzus AZONNAL látszik, nem csak mentés után.
 *
 * K39 (admin-audit, 2026-09-22): a régi vásárlások időpontja a Műveletnaplóban
 * áll, amelyet csak a tulajdonos olvashat (AuditLogs access.read: isOwner).
 * Munkatársat ezért nem küldünk oda, hanem megmondjuk, ki látja; a
 * tulajdonos közvetlen, erre a felhasználóra szűrt linket kap (NN/g,
 * Visibility of System Status, https://www.nngroup.com/articles/visibility-system-status/;
 * GOV.UK Links: a link szövege mondja meg, hová visz,
 * https://design-system.service.gov.uk/styles/links/). A megjelenítés csak
 * szöveg: a napló hozzáférési szabálya nem változik.
 */

/**
 * A régi (importált) vásárlás naplóbejegyzésének művelete. A forrás a
 * src/lib/customer-import/execute.ts LEGACY_PURCHASE_AUDIT_ACTION konstansa.
 * Szerveroldali modul, ezt a kliensoldali panel nem importálhatja, ezért itt
 * másolat áll, amelyet a purchases-overview-panel.test.tsx a forráshoz köt.
 */
const LEGACY_PURCHASE_ACTION = 'customer-import.legacy-purchase'

export const LEGACY_PURCHASES_STAFF_NOTE =
  'A régi vásárlások időpontját a tulajdonos a Műveletnaplóban látja.'

/** A tulajdonosnak: a Műveletnapló erre a felhasználóra és a régi vásárlásokra szűrve. */
export function legacyPurchasesAuditHref(userId: number | string): string {
  const params = new URLSearchParams({
    'where[and][0][action][equals]': LEGACY_PURCHASE_ACTION,
    'where[and][1][entityType][equals]': 'users',
    'where[and][2][entityId][equals]': String(userId),
  })
  return `/admin/collections/audit-logs?${params.toString()}`
}

const panelStyle: CSSProperties = {
  border: '1px solid var(--theme-elevation-150)',
  borderRadius: '4px',
  marginBottom: 'var(--base)',
  padding: 'calc(var(--base) * 0.75)',
}

const noteStyle: CSSProperties = {
  color: 'var(--theme-elevation-650)',
  margin: 0,
}

export function PurchasesOverviewPanel() {
  const purchases = useFormFields(([fields]) => fields?.purchases?.value)
  const { user } = useAuth<{ id: number | string; role?: string | null }>()
  const { id: userId } = useDocumentInfo()
  const owner = hasOwnerRole(user)
  const [titles, setTitles] = useState<ReadonlyMap<string, string>>(() => new Map())

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

  const ids = readPurchaseIds(purchases)
  const labels = formatPurchaseLabels(purchases, titles)

  return (
    <div className="field-type" style={panelStyle}>
      <h3 style={{ marginTop: 0 }}>Megvásárolt kurzusok (áttekintés)</h3>
      {ids.length === 0 ? (
        <p style={noteStyle}>
          Ennek a felhasználónak még nincs kurzus-hozzáférése. Kurzust a lenti „Kurzus ajándékozása”
          panellel adhatsz neki.
        </p>
      ) : (
        <>
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {labels.map((label, index) => (
              // A kulcs a sorindex: két azonos című kurzus is előfordulhat.
              <li key={index}>{label}</li>
            ))}
          </ul>
          <p style={{ ...noteStyle, marginTop: 'calc(var(--base) * 0.5)' }}>
            {`${ids.length} kurzus-hozzáférés.`}{' '}
            {owner && userId !== undefined && userId !== null ? (
              <>
                A régi vásárlások időpontja:{' '}
                <a
                  href={legacyPurchasesAuditHref(userId)}
                  style={{ color: 'inherit', textDecoration: 'underline' }}
                >
                  a Műveletnaplóban, erre a felhasználóra szűrve
                </a>
                .
              </>
            ) : (
              LEGACY_PURCHASES_STAFF_NOTE
            )}
          </p>
        </>
      )}
    </div>
  )
}

export default PurchasesOverviewPanel
