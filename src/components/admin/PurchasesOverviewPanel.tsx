'use client'

import { useFormFields } from '@payloadcms/ui'
import { useEffect, useState, type CSSProperties } from 'react'

import { loadCourseTitles } from './course-titles-client'
import { formatPurchaseLabels, readPurchaseIds } from './purchases-cell'

/**
 * „Megvásárolt kurzusok (áttekintés)" panel a felhasználó szerkesztőnézetében
 * (users `type: 'ui'` mező — NEM tárol adatot, séma-változást nem igényel).
 *
 * MIRE VALÓ: a fölötte lévő relationship-mező a szerkesztés helye, de a
 * választható elemeket a Payload a kurzusok `useAsTitle` mezőjével (`sku`)
 * címkézi. Ez a panel ugyanazt a listát a kurzus CÍMÉVEL mutatja meg, hogy a
 * tulajdonos ránézésre lássa, mit vett meg a vevő.
 *
 * ÉLŐ ÉRTÉK: az űrlap aktuális mezőértékéből dolgozik (`useFormFields`), tehát
 * a hozzáadott vagy elvett kurzus AZONNAL látszik — nem csak mentés után.
 */

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
          {'Ennek a felhasználónak még nincs kurzus-hozzáférése. Hozzáadni a fenti ' +
            '„Megvásárolt kurzusok” mezőben vagy a „Kurzus ajándékozása” panellel lehet.'}
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
            {`${ids.length} kurzus-hozzáférés. A régi (systeme.io-beli) vásárlás időpontja a ` +
              'Műveletnaplóban látszik, „customer-import.legacy-purchase” művelet alatt.'}
          </p>
        </>
      )}
    </div>
  )
}

export default PurchasesOverviewPanel
