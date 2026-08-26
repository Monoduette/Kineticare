'use client'

import { formatOrderItemsLines } from './order-items-cell'

/**
 * A Rendelések admin-lista „Tételek" oszlopának cella-komponense.
 * A megrendelő első admin-igénye („ki mit vett és mikor") a listaoldalon
 * lássa a rendelés tételeit. A komponens KIZÁRÓLAG a cella `cellData`-jából
 * dolgozik (az orders `items` array-mezőjének sorai: titleSnapshot,
 * priceHufSnapshot, quantity, product) — fetch TILOS a cellában, a lista
 * lekérdezése már tartalmazza a sorokat.
 */
export function OrderItemsCell({ cellData }: { cellData?: unknown }) {
  const lines = formatOrderItemsLines(cellData)
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {lines.map((line, index) => (
        // A kulcs a sorindex: két azonos szövegű tétel is előfordulhat.
        <li key={index} style={{ whiteSpace: 'nowrap' }}>
          {line}
        </li>
      ))}
    </ul>
  )
}

export default OrderItemsCell
