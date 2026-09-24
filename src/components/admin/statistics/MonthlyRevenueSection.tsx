import {
  formatHuf,
  formatMonthLabel,
  type MonthlyRevenueRow,
} from '../../../lib/statistics/revenue'
import { RevenueChart } from '../RevenueChart'
import {
  captionStyle,
  chartFrameStyle,
  numericStyle,
  rowHeaderStyle,
  sectionStyle,
  tableStyle,
  tableWrapStyle,
  thNumericStyle,
  thStyle,
} from './styles'

/**
 * „Havi befizetések" szekció: oszlopdiagram + havi táblázat. A diagram a két
 * ág bruttó befizetését mutatja a trendhez, a táblázat a pontos értékeket és
 * a képernyőolvasónak (a diagram `role="img"`, a számok itt olvashatók fel).
 * A címke tájékoztató, bruttó számot mond (a-egyeztetes-8), nem könyvelési
 * bevételt. Ha a hónapban részleges visszatérítést vontunk le, a táblázat
 * külön oszlopban mutatja, és az Összesen már a levonás utáni szám.
 */
export const HAVI_BEFIZETES_CIM = 'Havi befizetések (tájékoztató)'

export function MonthlyRevenueSection({ rows }: { rows: readonly MonthlyRevenueRow[] }) {
  const vanLevonas = rows.some((row) => (row.refundHuf ?? 0) > 0)
  return (
    <section style={sectionStyle}>
      <h2>{HAVI_BEFIZETES_CIM}</h2>
      {/* A diagram a saját természetes szélességén áll meg, a TÁBLÁZAT viszont
          teljes szélességű: az idősoros oszlopdiagramot a nyújtás nem teszi
          olvashatóbbá, a sok oszlopos adattáblát viszont igen (indoklás és
          források: styles.ts chartFrameStyle). */}
      <div style={chartFrameStyle}>
        <RevenueChart rows={rows} />
      </div>
      {/* role="region" + aria-labelledby + tabIndex: a keskeny viewporton
          görgethető tábla billentyűzetről is görgethető legyen (WCAG 2.1.1;
          axe: scrollable-region-focusable; minta: Adrian Roselli,
          Under-Engineered Responsive Tables —
          https://adrianroselli.com/2020/11/under-engineered-responsive-tables.html). */}
      <div
        style={tableWrapStyle}
        role="region"
        aria-labelledby="kc-stat-havi-bevetel-cim"
        tabIndex={0}
      >
        <table style={tableStyle}>
          <caption style={captionStyle} id="kc-stat-havi-bevetel-cim">
            Havi bruttó befizetések otthoni és szakmai bontásban, forintban
          </caption>
          <thead>
            <tr>
              <th style={thStyle} scope="col">
                Hónap
              </th>
              <th style={thNumericStyle} scope="col">
                Otthoni
              </th>
              <th style={thNumericStyle} scope="col">
                Szakmai
              </th>
              {vanLevonas ? (
                <th style={thNumericStyle} scope="col">
                  Részleges visszatérítés
                </th>
              ) : null}
              <th style={thNumericStyle} scope="col">
                Összesen
              </th>
              <th style={thNumericStyle} scope="col">
                Rendelések
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.month}>
                <th style={rowHeaderStyle} scope="row">
                  {formatMonthLabel(row.month)}
                </th>
                <td style={numericStyle}>{formatHuf(row.laikusHuf)}</td>
                <td style={numericStyle}>{formatHuf(row.szakemberHuf)}</td>
                {vanLevonas ? (
                  <td style={numericStyle}>
                    {(row.refundHuf ?? 0) > 0 ? `−${formatHuf(row.refundHuf ?? 0)}` : formatHuf(0)}
                  </td>
                ) : null}
                <td style={numericStyle}>{formatHuf(row.totalHuf)}</td>
                <td style={numericStyle}>{row.orderCount.toLocaleString('hu-HU')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
