import type { CSSProperties } from 'react'

import {
  formatCountHu,
  type WebStatsBreakdownKey,
  type WebStatsRow,
} from '../../../lib/admin/posthog-web-stats'
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
 * A PostHog Web analytics felületének bontásai, ugyanabban a csoportosításban,
 * ahogy ott láthatók (oldalak, források, eszközök, földrajz). Minden bontás
 * önálló, felirattal (`<caption>`) ellátott tábla, így a képernyőolvasó a
 * táblák listájából is megtalálja (WCAG 2.2 SC 1.3.1; W3C WAI, Caption &
 * Summary: https://www.w3.org/WAI/tutorials/tables/caption-summary/).
 */

export const VISITOR_STATS_BLOCK_MISSING_MESSAGE = 'Ez a rész most nem érhető el.'

export const VISITOR_TABLE_EMPTY_MESSAGE = 'Ebben az időszakban nincs adat.'

interface BreakdownMeta {
  caption: string
  firstColumn: string
}

/** A `Record` típus fordításkor kikényszeríti, hogy minden bontásnak legyen felirata. */
export const BREAKDOWN_META: Record<WebStatsBreakdownKey, BreakdownMeta> = {
  pages: { caption: 'Legnézettebb oldalak', firstColumn: 'Oldal' },
  entryPages: { caption: 'Belépő oldalak', firstColumn: 'Oldal' },
  exitPages: { caption: 'Kilépő oldalak', firstColumn: 'Oldal' },
  channels: { caption: 'Érkezési csatorna', firstColumn: 'Csatorna' },
  referrers: { caption: 'Hivatkozó oldalak', firstColumn: 'Hivatkozó oldal' },
  utmSources: { caption: 'UTM forrás', firstColumn: 'Forrás' },
  utmMediums: { caption: 'UTM közeg', firstColumn: 'Közeg' },
  utmCampaigns: { caption: 'UTM kampány', firstColumn: 'Kampány' },
  devices: { caption: 'Eszköztípus', firstColumn: 'Eszköz' },
  browsers: { caption: 'Böngésző', firstColumn: 'Böngésző' },
  os: { caption: 'Operációs rendszer', firstColumn: 'Rendszer' },
  countries: { caption: 'Ország', firstColumn: 'Ország' },
  cities: { caption: 'Város', firstColumn: 'Város' },
  languages: { caption: 'Nyelv', firstColumn: 'Nyelv' },
}

export const BREAKDOWN_GROUPS: ReadonlyArray<{
  title: string
  keys: readonly WebStatsBreakdownKey[]
}> = [
  { title: 'Oldalak', keys: ['pages', 'entryPages', 'exitPages'] },
  {
    title: 'Források',
    keys: ['channels', 'referrers', 'utmSources', 'utmMediums', 'utmCampaigns'],
  },
  { title: 'Eszközök', keys: ['devices', 'browsers', 'os'] },
  { title: 'Földrajz', keys: ['countries', 'cities', 'languages'] },
]

/**
 * A táblák rácsa: egy tábla legalább 26 rem széles (a 18 rem-es oszlopban a
 * három oszlop nem fért el, a név betűnként tört; mérve 1280 px-en), keskeny lapon a rács egy
 * oszlopra áll (WCAG 2.2 SC 1.4.10 Reflow).
 */
const gridStyle: CSSProperties = {
  display: 'grid',
  gap: 'var(--kc-as-space-4, calc(var(--base) * 1))',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 26rem), 1fr))',
  marginBottom: 'var(--kc-as-space-5, calc(var(--base) * 1.25))',
}

const groupHeadingStyle: CSSProperties = {
  marginBottom: 'var(--kc-as-space-3, calc(var(--base) * 0.75))',
  marginTop: 'var(--kc-as-space-5, calc(var(--base) * 1.25))',
}

/** A kis táblának nem kell a statisztika-tábla 576 px-es padlója. */
const smallTableStyle: CSSProperties = { ...tableStyle, minWidth: 0 }

function BreakdownTable({ meta, rows }: { meta: BreakdownMeta; rows: WebStatsRow[] | null }) {
  return (
    <div style={tableWrapStyle}>
      <table style={smallTableStyle}>
        <caption style={captionStyle}>{meta.caption}</caption>
        <thead>
          <tr>
            <th scope="col" style={thStyle}>
              {meta.firstColumn}
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
          {rows === null || rows.length === 0 ? (
            <tr>
              <td colSpan={3} style={rowHeaderStyle}>
                {rows === null ? VISITOR_STATS_BLOCK_MISSING_MESSAGE : VISITOR_TABLE_EMPTY_MESSAGE}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={`${row.name}-${index}`}>
                <th scope="row" style={{ ...rowHeaderStyle, overflowWrap: 'anywhere' }}>
                  {row.name}
                </th>
                <td style={numericStyle}>{formatCountHu(row.visitors)}</td>
                <td style={numericStyle}>{formatCountHu(row.views)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

export function BreakdownTables({
  breakdowns,
}: {
  breakdowns: Record<WebStatsBreakdownKey, WebStatsRow[] | null>
}) {
  return (
    <>
      {BREAKDOWN_GROUPS.map((group) => (
        <div key={group.title}>
          <h3 style={groupHeadingStyle}>{group.title}</h3>
          <div style={gridStyle}>
            {group.keys.map((key) => (
              <BreakdownTable key={key} meta={BREAKDOWN_META[key]} rows={breakdowns[key] ?? null} />
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
