import type { CSSProperties } from 'react'

import { formatCountHu, type WebStatsDailyPoint } from '../../../lib/admin/posthog-web-stats'
import {
  captionStyle,
  numericStyle,
  rowHeaderStyle,
  tableStyle,
  tableWrapStyle,
  thNumericStyle,
  thStyle,
} from '../statistics/styles'

/**
 * Napi látogatók és oldalmegtekintések vonaldiagramja. Kézzel rajzolt,
 * szerveren renderelt SVG, chart-könyvtár nélkül (a RevenueChart mintája).
 *
 * Döntések és forrásuk:
 * - EGY tengely: a két sor ugyanaz a mértékegység (darab), ezért közös
 *   y-skálán áll; két y-skála félrevezetne (NN/g, Dual-axis charts:
 *   https://www.nngroup.com/articles/dual-axis-graphs/).
 * - A sorokat nem csak a szín különbözteti meg: a látogató folytonos vonal
 *   kör jelölővel, a megtekintés szaggatott vonal négyzet jelölővel, és van
 *   jelmagyarázat (WCAG 2.2 SC 1.4.1 Use of Color). A két szín a Statisztika
 *   diagram meglévő tokenje (--kc-as-diagram-otthoni / -szakmai), világos
 *   és sötét témában is ≥ 3:1 az emelt felületen (WCAG 2.2 SC 1.4.11).
 * - A tengelyfelirat 13 viewBox-egység, az SVG legalább a viewBox
 *   szélességében rajzolódik, tehát a felirat sosem kisebb 13 CSS px-nél.
 *   Keskeny lapon a diagram SAJÁT, billentyűvel is elérhető görgetősávja
 *   mozog, a lap nem (WCAG 2.2 SC 1.4.10: a kétdimenziós ábra kivétel), és a
 *   számok a lenyitható táblázatban görgetés nélkül is olvashatók.
 * - A naponkénti egérmutatós címke (SVG <title>) a jelölőnél szélesebb,
 *   teljes magasságú sávon él (Carbon, Tooltips:
 *   https://carbondesignsystem.com/data-visualization/tooltips/).
 */

const WIDTH = 640
const HEIGHT = 280
const PAD_LEFT = 56
const PAD_RIGHT = 112
const PAD_TOP = 16
const PAD_BOTTOM = 40
const PLOT_WIDTH = WIDTH - PAD_LEFT - PAD_RIGHT
const PLOT_HEIGHT = HEIGHT - PAD_TOP - PAD_BOTTOM
const BASELINE_Y = PAD_TOP + PLOT_HEIGHT
/** A két végfelirat ennyi egységnél közelebb nem kerülhet; ilyenkor a jelmagyarázat elég. */
const END_LABEL_MIN_GAP = 18

const VISITOR_COLOR = 'var(--kc-as-diagram-otthoni, var(--theme-success-500))'
const VIEW_COLOR = 'var(--kc-as-diagram-szakmai, var(--theme-elevation-800))'
const SURFACE = 'var(--kc-as-surface-raised, var(--theme-bg))'
const MUTED_TEXT = 'var(--kc-as-text-muted, var(--theme-elevation-650))'
const AXIS = 'var(--kc-as-hairline-strong, var(--theme-elevation-400))'

const chartCardStyle: CSSProperties = {
  background: 'var(--kc-as-surface-raised, transparent)',
  border: '1px solid var(--kc-as-hairline-strong, transparent)',
  borderRadius: 'var(--kc-as-radius-md, 0)',
  marginBottom: 'var(--kc-as-space-4, calc(var(--base) * 0.5))',
  maxWidth: 'calc(866 * var(--kc-as-px, 1px))',
  padding: 'var(--kc-as-space-4, 0)',
}

/* row-reverse: keskeny lapon a görgetés a jobb szélről indul, így a legfrissebb
   nap látszik elsőre (a görgetési origó a flex-sor végén van). */
const chartScrollStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'row-reverse',
  overflowX: 'auto',
  width: '100%',
}

const svgStyle: CSSProperties = {
  display: 'block',
  height: 'auto',
  maxWidth: 'calc(832 * var(--kc-as-px, 1px))',
  minWidth: `max(${WIDTH}px, calc(${WIDTH} * var(--kc-as-px, 1px)))`,
  width: '100%',
}

const legendStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--kc-as-space-3, calc(var(--base) * 0.75))',
  margin: 'var(--kc-as-space-2, calc(var(--base) * 0.25)) 0 0',
}

const legendItemStyle: CSSProperties = {
  alignItems: 'center',
  display: 'inline-flex',
  gap: 'var(--kc-as-space-2, 0.4rem)',
}

const detailsStyle: CSSProperties = { marginTop: 'var(--kc-as-space-3, calc(var(--base) * 0.75))' }

/* A display marad list-item: flexre váltva eltűnne a böngésző nyíl-jelölője,
   a nyitott/csukott állapot látható jele (a CourseEngagementSection mintája). */
const summaryStyle: CSSProperties = {
  cursor: 'pointer',
  fontWeight: 600,
  minHeight: 'max(44px, calc(44 * var(--kc-as-px, 1px)))',
  paddingBlock: 'calc(10 * var(--kc-as-px, 1px))',
}

const dayFormatter = new Intl.DateTimeFormat('hu-HU', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

/** „2026-11-03” → „nov. 3.”; a dátum naptári nap, ezért UTC-ben olvassuk. */
export function formatDayHu(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? date : dayFormatter.format(parsed)
}

/** Kerek skála-plafon (1 / 1,2 / 1,5 / 2 / 2,5 / 3 / 4 / 5 / 6 / 8 × 10^n), felfelé. */
function niceCeil(value: number): number {
  if (value <= 0) {
    return 1
  }
  const base = Math.pow(10, Math.floor(Math.log10(value)))
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => value / base <= s) ?? 10
  return Math.max(1, Math.round(step * base))
}

function peak(
  points: readonly WebStatsDailyPoint[],
  pick: (point: WebStatsDailyPoint) => number,
): WebStatsDailyPoint {
  return points.reduce((best, point) => (pick(point) > pick(best) ? point : best), points[0])
}

/** A diagram akadálymentes neve: időszak és a két csúcsnap. */
export function dailyChartLabel(points: readonly WebStatsDailyPoint[]): string {
  const first = formatDayHu(points[0].date)
  const last = formatDayHu(points[points.length - 1].date)
  const topVisitors = peak(points, (point) => point.visitors)
  const topViews = peak(points, (point) => point.views)
  return [
    `Napi látogatók és oldalmegtekintések vonaldiagramja, ${first} és ${last} között.`,
    `A legtöbb látogató egy napon: ${formatCountHu(topVisitors.visitors)} (${formatDayHu(topVisitors.date)}).`,
    `A legtöbb megtekintés egy napon: ${formatCountHu(topViews.views)} (${formatDayHu(topViews.date)}).`,
  ].join(' ')
}

function LegendKey({ color, dashed, square }: { color: string; dashed: boolean; square: boolean }) {
  return (
    <svg aria-hidden="true" focusable="false" width="28" height="14" viewBox="0 0 28 14">
      <line
        x1="1"
        y1="7"
        x2="27"
        y2="7"
        stroke={color}
        strokeDasharray={dashed ? '5 3' : undefined}
        strokeWidth="2"
      />
      {square ? (
        <rect x="10" y="3" width="8" height="8" rx="1" fill={color} />
      ) : (
        <circle cx="14" cy="7" r="4" fill={color} />
      )}
    </svg>
  )
}

export function DailyVisitorsChart({ points }: { points: readonly WebStatsDailyPoint[] }) {
  const maxValue = points.reduce((max, point) => Math.max(max, point.visitors, point.views), 0)
  const scaleMax = niceCeil(maxValue)
  const tickValues =
    maxValue === 0 ? [0] : scaleMax % 2 === 0 ? [0, scaleMax / 2, scaleMax] : [0, scaleMax]
  const step = points.length > 1 ? PLOT_WIDTH / (points.length - 1) : 0
  const xAt = (index: number) =>
    points.length > 1 ? PAD_LEFT + index * step : PAD_LEFT + PLOT_WIDTH / 2
  const yAt = (value: number) => BASELINE_Y - (value / scaleMax) * PLOT_HEIGHT
  const linePath = (pick: (point: WebStatsDailyPoint) => number) =>
    points.map((point, index) => `${xAt(index)},${yAt(pick(point))}`).join(' ')
  // 7 napnál minden nap felirata elfér; 30 napnál hetente, az utolsó naptól
  // visszafelé számolva, hogy a legfrissebb nap mindig meg legyen nevezve.
  const showTick = (index: number) => points.length <= 7 || (points.length - 1 - index) % 7 === 0
  const lastIndex = points.length - 1
  const lastVisitorsY = yAt(points[lastIndex].visitors)
  const lastViewsY = yAt(points[lastIndex].views)
  const endLabels = Math.abs(lastVisitorsY - lastViewsY) >= END_LABEL_MIN_GAP
  const label = dailyChartLabel(points)
  const bandWidth = points.length > 1 ? step : PLOT_WIDTH

  return (
    <div style={chartCardStyle}>
      <div
        aria-label="Napi látogatók diagramja"
        role="region"
        style={chartScrollStyle}
        tabIndex={0}
      >
        <svg
          aria-label={label}
          data-napok={points.length}
          role="img"
          style={svgStyle}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          <title>{label}</title>
          {tickValues.map((value) => (
            <g key={value}>
              {value > 0 ? (
                <line
                  x1={PAD_LEFT}
                  y1={yAt(value)}
                  x2={PAD_LEFT + PLOT_WIDTH}
                  y2={yAt(value)}
                  stroke={AXIS}
                  strokeDasharray="2 4"
                  strokeWidth="1"
                />
              ) : null}
              <text
                x={PAD_LEFT - 8}
                y={yAt(value)}
                dominantBaseline="middle"
                fill={MUTED_TEXT}
                fontSize="13"
                textAnchor="end"
              >
                {formatCountHu(value)}
              </text>
            </g>
          ))}
          <line
            x1={PAD_LEFT}
            y1={BASELINE_Y}
            x2={PAD_LEFT + PLOT_WIDTH}
            y2={BASELINE_Y}
            stroke={AXIS}
            strokeWidth="1"
          />
          {points.map((point, index) =>
            showTick(index) ? (
              <text
                key={point.date}
                x={xAt(index)}
                y={BASELINE_Y + 22}
                fill={MUTED_TEXT}
                fontSize="13"
                textAnchor="middle"
              >
                {formatDayHu(point.date)}
              </text>
            ) : null,
          )}
          <polyline
            fill="none"
            points={linePath((point) => point.views)}
            stroke={VIEW_COLOR}
            strokeDasharray="6 4"
            strokeLinejoin="round"
            strokeWidth="2"
          />
          <polyline
            fill="none"
            points={linePath((point) => point.visitors)}
            stroke={VISITOR_COLOR}
            strokeLinejoin="round"
            strokeWidth="2"
          />
          {points.map((point, index) => (
            <rect
              key={`m-${point.date}`}
              data-sor="megtekintes"
              x={xAt(index) - 4}
              y={yAt(point.views) - 4}
              width="8"
              height="8"
              rx="1"
              fill={VIEW_COLOR}
              stroke={SURFACE}
              strokeWidth="2"
            />
          ))}
          {points.map((point, index) => (
            <circle
              key={`l-${point.date}`}
              data-sor="latogato"
              cx={xAt(index)}
              cy={yAt(point.visitors)}
              r="4"
              fill={VISITOR_COLOR}
              stroke={SURFACE}
              strokeWidth="2"
            />
          ))}
          {endLabels ? (
            <>
              <text
                x={xAt(lastIndex) + 10}
                y={lastViewsY}
                dominantBaseline="middle"
                fill="var(--kc-as-text, var(--theme-elevation-800))"
                fontSize="13"
              >
                Megtekintések
              </text>
              <text
                x={xAt(lastIndex) + 10}
                y={lastVisitorsY}
                dominantBaseline="middle"
                fill="var(--kc-as-text, var(--theme-elevation-800))"
                fontSize="13"
              >
                Látogatók
              </text>
            </>
          ) : null}
          {points.map((point, index) => (
            <rect
              key={`h-${point.date}`}
              x={xAt(index) - bandWidth / 2}
              y={PAD_TOP}
              width={bandWidth}
              height={PLOT_HEIGHT}
              fill="transparent"
            >
              <title>
                {`${formatDayHu(point.date)}: ${formatCountHu(point.visitors)} látogató, ${formatCountHu(point.views)} megtekintés`}
              </title>
            </rect>
          ))}
        </svg>
      </div>
      <p style={legendStyle}>
        <span style={legendItemStyle}>
          <LegendKey color={VISITOR_COLOR} dashed={false} square={false} />
          Látogatók
        </span>
        <span style={legendItemStyle}>
          <LegendKey color={VIEW_COLOR} dashed square />
          Megtekintések
        </span>
      </p>
      <details style={detailsStyle}>
        <summary style={summaryStyle}>A napi számok táblázatban</summary>
        <div style={tableWrapStyle}>
          <table style={{ ...tableStyle, minWidth: 0 }}>
            <caption style={captionStyle}>Napi látogatók és megtekintések</caption>
            <thead>
              <tr>
                <th scope="col" style={thStyle}>
                  Nap
                </th>
                <th scope="col" style={thNumericStyle}>
                  Látogatók
                </th>
                <th scope="col" style={thNumericStyle}>
                  Megtekintések
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.date}>
                  <th scope="row" style={rowHeaderStyle}>
                    {formatDayHu(point.date)}
                  </th>
                  <td style={numericStyle}>{formatCountHu(point.visitors)}</td>
                  <td style={numericStyle}>{formatCountHu(point.views)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
