import type { JSX } from 'react'

/**
 * A Menüpontok lista jelölőnégyzet-oszlopainak cellája (K41): „Látható”,
 * „Rejtett link (nem jelenik meg a menüben)” és az „Oszlopok” választóból
 * felvehető „Új lapon nyíljon” (ez az általános BooleanCell).
 *
 * MIÉRT: a Payload gyári jelölőnégyzet-cellája a nyers logikai értéket írta ki
 * kódbetűvel („igaz” / „hamis”), ez fejlesztői szó, nem a szerkesztőé. A cella
 * a fejléc kérdésére felel: „Igen” vagy „Nem”.
 * - GOV.UK Design System, Summary list: a kártya példája egy igen/nem kérdés
 *   válaszát mutatja így („Details known: Yes”),
 *   https://design-system.service.gov.uk/components/summary-list/
 * - GOV.UK Design System, Tag: „Do not use colour alone to convey information,
 *   because it's not accessible.” A cella ezért csak szöveg, szín nélkül
 *   (WCAG 2.2 SC 1.4.1 Use of Color),
 *   https://design-system.service.gov.uk/components/tag/
 *
 * Miért nem a hatást írja ki („Látszik”, „Menüben”): a két kapcsoló együtt
 * dönt. Egy „Menüben” felirat a Rejtett link oszlopban hamis volna ott, ahol a
 * „Látható” pipa hiányzik, a „Látszik” pedig ott, ahol a Rejtett link be van
 * jelölve. Az „Igen” / „Nem” mindig igaz, mert pontosan a pipát mondja ki.
 *
 * Az ALAPÉRTÉK számít: a hiányzó `visible` a navigációban látható
 * (src/lib/menu-tree.ts, `menu.visible !== false`), a hiányzó `unlisted` nem
 * rejtett (`menu.unlisted !== true`). A két cella ugyanezt a szabályt követi,
 * így a lista sosem mond mást, mint a weboldal.
 *
 * Szerverkomponens: hook és böngésző-API nélkül, a Payload a listanézetben a
 * `cellData` értékkel rendereli.
 */

export const IGEN_FELIRAT = 'Igen'

export const NEM_FELIRAT = 'Nem'

/** A cella szövege; a nem logikai (hiányzó) érték a mező alapértékét kapja. */
export function booleanCellFelirat(value: unknown, alapertek: boolean): string {
  const bekapcsolva = typeof value === 'boolean' ? value : alapertek
  return bekapcsolva ? IGEN_FELIRAT : NEM_FELIRAT
}

export interface BooleanCellProps {
  cellData?: unknown
}

/**
 * Általános igen/nem cella, alapértéke hamis (pl. „Új lapon nyíljon”, amelynek
 * az adatbázis-alapértéke is hamis); a hiányzó érték „Nem”.
 */
export function BooleanCell({ cellData }: BooleanCellProps): JSX.Element {
  return <span>{booleanCellFelirat(cellData, false)}</span>
}

/** A „Látható” oszlop: a hiányzó érték látható (az adatbázis alapértéke igaz). */
export function MenuLathatoCell({ cellData }: BooleanCellProps): JSX.Element {
  return <span>{booleanCellFelirat(cellData, true)}</span>
}

/** A „Rejtett link” oszlop: a hiányzó érték nem rejtett. */
export function MenuRejtettLinkCell({ cellData }: BooleanCellProps): JSX.Element {
  return <span>{booleanCellFelirat(cellData, false)}</span>
}
