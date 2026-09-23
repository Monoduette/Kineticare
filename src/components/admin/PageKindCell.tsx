'use client'

import type { JSX } from 'react'

import { oldalFajtaFelirat } from '../../lib/admin/kotott-cimek'

/**
 * Az Oldalak lista „Mi ez” oszlopa (modul-térkép H05): a webcímből
 * megmondja, milyen oldal a sor („Kezdőlap (/)”, „Kapcsolat oldal”, „Jogi
 * oldal”, „Tudástár-cikk tükre”, „Aloldal”). A 8 Tudástár-hub Oldala a
 * blogbejegyzésével azonos címet visel, a listában ez az oszlop különbözteti
 * meg őket (WCAG 2.2 SC 2.4.6 Headings and Labels; NN/g, Recognition Rather
 * Than Recall, https://www.nngroup.com/articles/recognition-and-recall/).
 *
 * `type: 'ui'` mező cellája: adatbázis-oszlopa nincs, a Payload a sor teljes
 * dokumentumát adja (`rowData`, @payloadcms/ui dist/providers/TableColumns/
 * buildColumnState/renderCell.js). A felirat tiszta függvényből jön
 * (src/lib/admin/kotott-cimek.ts oldalFajta), a teszt az összes esetet köti.
 */

export interface PageKindCellProps {
  rowData?: unknown
}

export function oldalWebcime(rowData: unknown): unknown {
  return typeof rowData === 'object' && rowData !== null
    ? (rowData as { slug?: unknown }).slug
    : undefined
}

export function PageKindCell({ rowData }: PageKindCellProps): JSX.Element {
  return <span className="kc-oldal-fajta">{oldalFajtaFelirat(oldalWebcime(rowData))}</span>
}
