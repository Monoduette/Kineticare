'use client'

import type { JSX } from 'react'

import { formatPriceHuf } from '../../lib/format-price'

/**
 * A Rendelések lista „Végösszeg a megrendeléskor (Ft)” oszlopának cellája
 * (K34). A Payload a number-mezőt nyers számként írta ki („79500”), miközben
 * mellette a Tételek oszlop már „79 500 Ft” alakot mutatott: ugyanaz az
 * összeg két alakban állt egy sorban. A cella ugyanazt a formázót használja,
 * mint a vásárlói felület és a Tételek oszlop (src/lib/format-price.ts:
 * ezres tagolás nem törhető szóközzel, „Ft” végződés), így az összeg
 * mindenhol egyformán olvasható. WCAG 2.2 SC 3.2.4 Consistent Identification
 * (https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html);
 * NN/g, Match Between the System and the Real World: a felület a felhasználó
 * megszokott alakját használja
 * (https://www.nngroup.com/articles/match-system-real-world/).
 *
 * A komponens KIZÁRÓLAG a cella `cellData`-jából dolgozik, lekérdezés nincs.
 */

/** Hiányzó vagy értelmezhetetlen végösszeg (pl. a snapshot bevezetése előtti sor). */
export const ORDER_TOTAL_MISSING = 'Nincs rögzítve'

/** A cella szövege: „79 500 Ft”, vagy a kimondott hiány. Soha nem dob. */
export function formatOrderTotalCell(cellData: unknown): string {
  const amount =
    typeof cellData === 'string' && cellData.trim() !== '' ? Number(cellData) : cellData
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
    return ORDER_TOTAL_MISSING
  }
  return formatPriceHuf(amount)
}

export function OrderTotalCell({ cellData }: { cellData?: unknown }): JSX.Element {
  return <span style={{ whiteSpace: 'nowrap' }}>{formatOrderTotalCell(cellData)}</span>
}

export default OrderTotalCell
