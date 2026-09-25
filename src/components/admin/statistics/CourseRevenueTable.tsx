import type { CSSProperties } from 'react'

import { AUDIENCE_LABELS } from '../../../lib/course-audience'
import { formatHuf, type CourseRevenueRow } from '../../../lib/statistics/revenue'
import {
  captionStyle,
  noticeStyle,
  numericStyle,
  rowHeaderStyle,
  tableStyle,
  tableWrapStyle,
  tdStyle,
  thNumericStyle,
  thStyle,
} from './styles'

/**
 * Bevétel kurzusonként — a 12 hónapos ablakon belüli fizetett tételekből.
 * Korábban a sorfejléc a sku volt (`kez-rehab-otthon-alap`), miközben UGYANAZ
 * a kurzus a haladás-táblában a címével szerepelt: egy lapon két néven futott
 * ugyanaz a termék. Ez a WCAG 2.2 SC 3.2.4 Consistent Identification sérülése
 * (https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html),
 * és a két tábla összevetését is ellehetetlenítette. A sku másodlagos,
 */

/* A hatodik oszlop (Azonosító) miatt szélesebb minimum: a sku hosszú,
   kötőjeles sztring, és a számoszlopok nowrapok. Keskeny viewporton a wrap
   görget, nem a lap (WCAG 1.4.10 / G225). */
const revenueTableStyle: CSSProperties = {
  ...tableStyle,
  minWidth: 'calc(704 * var(--kc-as-px, 1px))',
}

/* A sku technikai azonosító: kisebb hangsúly, de OLVASHATÓ marad (a méretet
   nem visszük a három token alá, csak a színt halkítjuk — a méret-tokenek
   szabálya: docs/ui-sztenderdek.md). */
const skuCellStyle: CSSProperties = {
  ...tdStyle,
  color: 'var(--kc-as-text-muted, var(--theme-elevation-650))',
}

/**
 * A tábla alatti jegyzet (PR #305, Codex P2): a tulajdonosi nézet összesen-
 * és havi száma a részleges visszatérítést már levonja, a kurzusonkénti
 * bevétel viszont nem, mert a visszatérítés-bejegyzés nem mondja meg, melyik
 * kurzusra szólt (csak összeg és időpont). Találgatott szétosztás helyett a
 * lap kimondja, hogy ez a tábla teljes összeggel számol.
 *
 * A jegyzet szándékosan INDOKLÁS NÉLKÜLI tény, mert mindkét nézetben igaz,
 * az oka viszont nézetenként más: a tulajdonosnál a tétel hiánya
 * (RESZLEGES_AGAK_NEM_LEVONVA), a munkatársnál az, hogy a visszatérítés
 * nem olvasható (RESZLEGES_NINCS_LEVONVA). Az okot a kártyák alatti mondat
 * adja; ha a jegyzet is indokolna, a munkatársi lap két különböző okot
 * mondana ugyanarra a számra (WCAG 2.2 SC 3.2.4 Consistent Identification,
 * https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html).
 *
 * MIÉRT A TÁBLÁHOZ KÖTVE (források, megnyitva 2026-09-25):
 * - GOV.UK Design System, Table: „A caption helps users find, navigate and
 *   understand tables." A felirat azonosít, a magyarázat a tábla alá kerül,
 *   és a régió `aria-describedby`-jal hozzá is kötődik.
 *   https://design-system.service.gov.uk/components/table/
 * - WCAG 2.2 SC 1.3.1 Info and Relationships: a megjelenítéssel közölt
 *   kapcsolat programból is kiolvasható legyen („programmatically determined
 *   or … available in text"); a H39 technika szerint a caption „acts like a
 *   title or heading for the table", a hosszabb magyarázat tehát nem oda való.
 *   https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html
 */
export const KURZUS_TELJES_OSSZEG =
  'A részlegesen visszatérített rendelés ebben a táblában a teljes összegével szerepel.'

export function CourseRevenueTable({ rows }: { rows: readonly CourseRevenueRow[] }) {
  if (rows.length === 0) {
    return <p style={noticeStyle}>Ebben a 12 hónapban még senki nem vásárolt kurzust.</p>
  }
  return (
    <>
      {/* role="region" + aria-labelledby + tabIndex: a keskeny viewporton
          görgethető tábla billentyűzetről is görgethető legyen (WCAG 2.1.1;
          axe: scrollable-region-focusable; minta: Adrian Roselli,
          Under-Engineered Responsive Tables —
          https://adrianroselli.com/2020/11/under-engineered-responsive-tables.html). */}
      <div
        style={tableWrapStyle}
        role="region"
        aria-labelledby="kc-stat-kurzus-bevetel-cim"
        aria-describedby="kc-stat-kurzus-bevetel-jegyzet"
        tabIndex={0}
      >
        <table style={revenueTableStyle}>
          <caption style={captionStyle} id="kc-stat-kurzus-bevetel-cim">
            Bevétel kurzusonként, ugyanabban a 12 hónapban
          </caption>
          <thead>
            <tr>
              <th style={thStyle} scope="col">
                Kurzus
              </th>
              <th style={thStyle} scope="col">
                Azonosító
              </th>
              <th style={thStyle} scope="col">
                Kinek szól
              </th>
              <th style={thNumericStyle} scope="col">
                Bevétel
              </th>
              <th style={thNumericStyle} scope="col">
                Rendelések
              </th>
              {/* „Ingyenes tétel" helyett: a „tétel" a rendelés-adatmodell szava,
                a munkatárs viszont hozzáférést ad ingyen. A mértékegység a
                fejlécben áll, hogy a számoszlop tiszta maradjon (GOV.UK,
                Table: https://design-system.service.gov.uk/components/table/). */}
              <th style={thNumericStyle} scope="col">
                Ingyenes hozzáférés (db)
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.sku}>
                <th style={rowHeaderStyle} scope="row">
                  {row.title}
                </th>
                <td style={skuCellStyle}>{row.sku}</td>
                <td style={tdStyle}>{AUDIENCE_LABELS[row.audience]}</td>
                <td style={numericStyle}>{formatHuf(row.revenueHuf)}</td>
                <td style={numericStyle}>{row.orderCount.toLocaleString('hu-HU')}</td>
                <td style={numericStyle}>{row.freeItemCount.toLocaleString('hu-HU')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p
        id="kc-stat-kurzus-bevetel-jegyzet"
        style={{ ...noticeStyle, marginTop: 'var(--kc-as-space-3, calc(var(--base) * 0.75))' }}
      >
        {KURZUS_TELJES_OSSZEG}
      </p>
    </>
  )
}
