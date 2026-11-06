import type { CSSProperties } from 'react'
import type { AdminViewServerProps } from 'payload'
import Link from 'next/link'

import { hasOwnerRole, hasStaffOrOwnerRole } from '../../access/roles'
import {
  formatCountHu,
  formatDurationHu,
  formatPercentHu,
  loadPosthogWebStats,
  type PosthogWebStats,
  type WebOverview,
  type WebStatsRow,
} from '../../lib/admin/posthog-web-stats'
import { EXTERNAL_ANALYTICS_LINKS, posthogEmbedUrl } from '../../lib/admin/web-analytics-config'
import { logger } from '../../lib/logger'
import { queryCourseEngagement } from '../../lib/statistics/engagement-query'
import type { CourseEngagementReport } from '../../lib/statistics/engagement'
import { queryRevenueReport } from '../../lib/statistics/query'
import { formatHuf, type RevenueReport } from '../../lib/statistics/revenue'
import { AdminChrome, AdminViewFrame } from './AdminChrome'
import { StatCard } from './statistics/StatCard'
import { RESZLEGES_LEVONVA, RESZLEGES_NINCS_LEVONVA } from './statistics/TotalsCards'
import {
  captionStyle,
  cardRowStyle,
  headingStyle,
  leadInSectionStyle,
  leadStyle,
  noticeStyle,
  numericStyle,
  pageStyle,
  rowHeaderStyle,
  sectionStyle,
  sectionTopStyle,
  tableStyle,
  tableWrapStyle,
  thNumericStyle,
  thStyle,
} from './statistics/styles'

/**
 * Admin Webanalitika nézet (`/admin/webanalitika`).
 *
 * A tulajdonos kérése (2026-08-27): a munkatársaknak NE kelljen a PostHogba
 * belépniük és ott tájékozódniuk — a válogatott dashboard (Kineticare —
 * látogatók és érdeklődés) jelenjen meg az adminon belül, mellette pedig egy
 * helyen legyenek a külső elemző-felületek linkjei (GA4, Search Console,
 * Google Ads, PostHog). Második kérés (ugyanaznap): az eladás- és
 * kurzushaladás-számok is EZEN a képernyőn legyenek.
 *
 * ═══ HOVA KERÜLHET ELADÁS-ADAT ÉS HOVA NEM ═══
 * A számok az ADMIN-NÉZET tetejére kerülnek, adatbázisból, a szerepkör-kapu
 * mögé — pontosan ugyanazokból a lekérdező modulokból, mint a Statisztika
 * oldal (queryRevenueReport, queryCourseEngagement), tehát a forrás egy
 * marad. A PostHog MEGOSZTOTT dashboardjára viszont TILOS eladás- vagy
 * haladás-adatot tenni: a megosztott link jelszó nélkül, a link birtokában
 * megnyitható, ezért ott kizárólag összesített viselkedés-adat lehet
 * (docs/statisztika-audit-2026-08-21.md 4. szakasz).
 *
 * A Payload custom view NYILVÁNOS admin-route, ezért a szerver-oldali
 * szerepkör-kapu az egyetlen védelem (a BunnyLibraryView mintája). A két
 * statisztika-lekérdezés `overrideAccess: true`-val fut, tehát a kapu itt is
 * adatvédelmi teherviselő — a kapu-kötést őr-teszt méri
 * (admin-nezet-kapu-kotes.test.tsx).
 */

/**
 * A külső linkek sora. A célfelület legalább 44 px magas (a repó saját
 * célértéke, docs/ui-sztenderdek.md §3), a linkek új lapon nyílnak, így az
 * admin munkamenetét nem hagyjuk el.
 *
 * K13 (admin-audit, 2026-09-22): a korábbi, aláhúzás nélküli linket csak egy
 * 1,29:1-es (sötétben 1,42:1-es) keret jelezte. Most:
 * - a szín, az aláhúzás és a hover-vastagodás a .kc-adminstat link-nyelvéből
 *   jön (custom.scss), ezért inline szín nincs, különben a hover nem hatna;
 * - a keret a --kc-as-hairline-strong token (világoson 3,91:1, sötéten
 *   5,97:1 a mért jegyzőkönyv szerint, WCAG 2.2 SC 1.4.11);
 * - a „(új lapon nyílik)” a link szövegének része (GOV.UK Links: „include the
 *   words 'opens in new tab' as part of the link”,
 *   https://design-system.service.gov.uk/styles/links/; NN/g: „let users
 *   know about it before they click”,
 *   https://www.nngroup.com/articles/new-browser-windows-and-tabs/).
 */
const toolLinkStyle: CSSProperties = {
  alignItems: 'center',
  border: '1px solid var(--kc-as-hairline-strong)',
  borderRadius: 'var(--kc-as-radius-md)',
  display: 'inline-flex',
  minHeight: '44px',
  padding: '0 calc(var(--base) * 0.75)',
}

/** A beágyazott kimutatás és a helyét jelző doboz dekoratív kerete. */
const embedFrameStyle: CSSProperties = {
  border: '1px solid var(--kc-as-hairline)',
  borderRadius: 'var(--kc-as-radius-md)',
}

export const NEW_TAB_SUFFIX = '(új lapon nyílik)'

/** A kimutatás helyét jelző doboz címe; a munkatársi bekezdés ezt NEM ismételheti. */
export const EMBED_MISSING_TITLE = 'A beágyazott kimutatás még nincs bekötve'

export const EMBED_MISSING_STAFF_MESSAGE =
  'A bekötést a tulajdonos végzi. Szólj neki, ha szeretnéd itt látni a kimutatást.'

export const WEB_ANALYTICS_ACCESS_DENIED_MESSAGE =
  'A Webanalitikát csak munkatárs vagy tulajdonos nézheti meg.'

export const WEB_ANALYTICS_DB_UNAVAILABLE_MESSAGE =
  'Az eladás- és haladás-számok most nem érhetők el. A részletes bontást a Statisztika oldalon találod, vagy próbáld újra pár perc múlva.'

export const VISITOR_STATS_HEADING = 'Látogatók az elmúlt 7 napban'

export const VISITOR_STATS_NOTE =
  'A számok legfeljebb 5 percesek, a belső és a teszt-forgalom nélkül. Csak azokat a látogatókat látjuk, akik hozzájárultak a sütikhez.'

export const VISITOR_STATS_MISSING_STAFF_MESSAGE =
  'A látogatói számok még nincsenek bekötve. Szólj a tulajdonosnak.'

export const VISITOR_STATS_UNAVAILABLE_MESSAGE =
  'A látogatói számok most nem érhetők el. Próbáld újra pár perc múlva.'

/** Egy blokk hiánya a sikeres válaszon belül (a többi blokk megjelenik). */
export const VISITOR_STATS_BLOCK_MISSING_MESSAGE = 'Ez a rész most nem érhető el.'

export const VISITOR_TABLE_EMPTY_MESSAGE = 'Ebben az időszakban nincs adat.'

const NO_VALUE = 'nincs adat'

function visitorCards(overview: WebOverview): Array<{ label: string; value: string }> {
  const count = (value: number | null) => (value === null ? NO_VALUE : formatCountHu(value))
  return [
    { label: 'Látogatók', value: count(overview.visitors) },
    { label: 'Oldalmegtekintések', value: count(overview.views) },
    { label: 'Munkamenetek', value: count(overview.sessions) },
    {
      label: 'Átlagos munkamenet-hossz',
      value:
        overview.sessionDurationSeconds === null
          ? NO_VALUE
          : formatDurationHu(overview.sessionDurationSeconds),
    },
    {
      label: 'Visszafordulási arány',
      value:
        overview.bounceRatePercent === null
          ? NO_VALUE
          : formatPercentHu(overview.bounceRatePercent),
    },
  ]
}

/**
 * A három kis tábla rácsa. Egy tábla legalább 18 rem széles, keskeny lapon a
 * rács egy oszlopra áll (WCAG 2.2 SC 1.4.10 Reflow); a tábla saját
 * görgetőkonténere a statisztika-táblák mintája (tableWrapStyle).
 */
const visitorTablesGridStyle: CSSProperties = {
  display: 'grid',
  gap: 'var(--kc-as-space-4, calc(var(--base) * 1))',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 18rem), 1fr))',
  marginBottom: 'var(--kc-as-space-4, calc(var(--base) * 1))',
}

/** A kis táblának nem kell a statisztika-tábla 576 px-es padlója. */
const visitorTableStyle: CSSProperties = { ...tableStyle, minWidth: 0 }

function VisitorTable({
  caption,
  firstColumn,
  rows,
}: {
  caption: string
  firstColumn: string
  rows: WebStatsRow[] | null
}) {
  return (
    <div style={tableWrapStyle}>
      <table style={visitorTableStyle}>
        <caption style={captionStyle}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col" style={thStyle}>
              {firstColumn}
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

/**
 * A látogatói számok szekciója. A kártyák és a táblák a lap meglévő
 * nyelvét viszik (StatCard, statistics/styles), a számoszlop jobbra igazít.
 */
function VisitorStatsSection({ stats, owner }: { stats: PosthogWebStats; owner: boolean }) {
  return (
    <section aria-label={VISITOR_STATS_HEADING} style={sectionStyle}>
      <h2 style={headingStyle}>{VISITOR_STATS_HEADING}</h2>
      {stats.status === 'not_configured' ? (
        owner ? (
          <p style={leadInSectionStyle}>
            A látogatói számokhoz a Railway-en be kell állítani a{' '}
            <code>POSTHOG_PERSONAL_API_KEY</code> változót. A kulcsot a PostHogban a Settings,
            Personal API keys oldalon hozhatod létre, csak Query read jogosultsággal és csak a
            KinetiCare projektre. A következő indulás után a számok itt jelennek meg.
          </p>
        ) : (
          <p style={leadInSectionStyle}>{VISITOR_STATS_MISSING_STAFF_MESSAGE}</p>
        )
      ) : stats.status === 'unavailable' ? (
        <p style={leadInSectionStyle}>{VISITOR_STATS_UNAVAILABLE_MESSAGE}</p>
      ) : (
        <>
          <p style={leadInSectionStyle}>{VISITOR_STATS_NOTE}</p>
          {stats.overview === null ? (
            <p style={{ ...noticeStyle, marginBottom: 'var(--kc-as-space-4, 1rem)' }}>
              Az összesítő számok most nem érhetők el.
            </p>
          ) : (
            <div style={cardRowStyle}>
              {visitorCards(stats.overview).map((stat) => (
                <StatCard key={stat.label} label={stat.label} value={stat.value} />
              ))}
            </div>
          )}
          <div style={visitorTablesGridStyle}>
            <VisitorTable caption="Legnézettebb oldalak" firstColumn="Oldal" rows={stats.pages} />
            <VisitorTable caption="Honnan érkeznek" firstColumn="Forrás" rows={stats.channels} />
            <VisitorTable caption="Eszközök" firstColumn="Eszköz" rows={stats.devices} />
          </div>
        </>
      )}
    </section>
  )
}

/**
 * A hat kiemelt szám kiszámítása a Statisztika-lekérdezések jelentéseiből.
 *
 * A haladás-oszlopok kurzus-hozzáférést számolnak (egy vásárló két kurzussal
 * kétszer számít); ugyanígy összegez a Statisztika oldal kurzus-táblája is,
 * a két felület tehát nem tud széttartani.
 */
function dbSummaryStats(
  report: RevenueReport,
  engagement: CourseEngagementReport | null,
): Array<{ label: string; value: string }> {
  const currentMonth = report.months.at(-1)
  const stats: Array<{ label: string; value: string }> = [
    { label: 'Bevétel ebben a hónapban', value: formatHuf(currentMonth?.totalHuf ?? 0) },
    { label: 'Fizetett rendelés ebben a hónapban', value: String(currentMonth?.orderCount ?? 0) },
    { label: 'Fizetett rendelés összesen', value: String(report.totals.orderCount) },
  ]
  if (engagement !== null) {
    let enrolled = 0
    let started = 0
    let completed = 0
    for (const course of engagement.courses) {
      enrolled += course.enrolled
      started += course.started
      completed += course.completed
    }
    stats.push(
      { label: 'Kurzus-hozzáférések száma', value: String(enrolled) },
      { label: 'Elkezdte a kurzust', value: String(started) },
      { label: 'Be is fejezte', value: String(completed) },
    )
  }
  return stats
}

export async function WebAnalyticsView(props: AdminViewServerProps) {
  const { req } = props.initPageResult
  if (!hasStaffOrOwnerRole(req.user)) {
    return (
      <AdminViewFrame props={props} title="Webanalitika">
        <div className="kc-adminstat" style={pageStyle}>
          <h1 style={headingStyle}>Webanalitika</h1>
          <p>{WEB_ANALYTICS_ACCESS_DENIED_MESSAGE}</p>
        </div>
      </AdminViewFrame>
    )
  }

  // A részleges visszatérítés levonása ugyanúgy csak a tulajdonosnak jár, mint
  // a Statisztika oldalon (a `refunds` mező tulajdonosi olvasású), így a két
  // oldal ugyanarra a szerepkörre ugyanazt a számot adja.
  const owner = hasOwnerRole(req.user)
  // A számok hibája nem döntheti el az oldalt: a viselkedés-rész (linkek +
  // dashboard) ilyenkor is megjelenik, a szekció helyén magyar magyarázat áll
  // (a StatisticsView hibakezelési mintája).
  let report: RevenueReport | null = null
  let engagement: CourseEngagementReport | null = null
  try {
    report = await queryRevenueReport({ payload: req.payload, includePartialRefunds: owner })
  } catch (error) {
    logger.error('webanalitika-nézet: a bevétel-lekérdezés nem sikerült', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  if (report !== null) {
    try {
      engagement = await queryCourseEngagement({ payload: req.payload })
    } catch (error) {
      logger.error('webanalitika-nézet: a kurzus-hatás lekérdezés nem sikerült', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // A PostHog-lekérdezés is csak a kapu UTÁN fut; a betöltő soha nem dob.
  const visitorStats = await loadPosthogWebStats()
  const embedUrl = posthogEmbedUrl()

  return (
    <AdminChrome props={props} title="Webanalitika">
      <div className="kc-adminstat" style={pageStyle}>
        <h1 style={headingStyle}>Webanalitika</h1>
        <p style={leadStyle}>
          Egy képernyőn a legfontosabb számok és a látogatói viselkedés. A részletes bontás (havi
          bevétel-grafikon, kurzusonkénti haladás, név szerinti lista) a{' '}
          <Link href="/admin/statisztika" prefetch={false}>
            Statisztika
          </Link>{' '}
          oldalon él: ott is, itt is az adatbázis a forrás.
        </p>
        <section
          aria-label="Eladások és kurzushaladás"
          style={{ ...sectionStyle, ...sectionTopStyle }}
        >
          <h2 style={headingStyle}>Eladások és kurzushaladás</h2>
          {report === null ? (
            <p style={leadInSectionStyle}>{WEB_ANALYTICS_DB_UNAVAILABLE_MESSAGE}</p>
          ) : (
            <>
              <div style={cardRowStyle}>
                {dbSummaryStats(report, engagement).map((stat) => (
                  <StatCard key={stat.label} label={stat.label} value={stat.value} />
                ))}
              </div>
              {/* A havi bevétel tulajdonosnál a részleges visszatérítés után,
                  munkatársnál bruttó: ugyanaz a mondat mondja ki, mint a
                  Statisztika oldalon (WCAG 2.2 SC 3.2.4, azonos jelentés
                  azonos szóval). */}
              <p
                style={{
                  ...noticeStyle,
                  marginTop: 'var(--kc-as-space-3, calc(var(--base) * 0.75))',
                }}
              >
                {report.refundsDeducted === true ? RESZLEGES_LEVONVA : RESZLEGES_NINCS_LEVONVA}
              </p>
            </>
          )}
          {report !== null && engagement === null ? (
            <p style={noticeStyle}>
              A kurzushaladás-számok most nem érhetők el, a részleteket a Statisztika oldalon
              találod.
            </p>
          ) : null}
        </section>
        <VisitorStatsSection owner={owner} stats={visitorStats} />
        <h2 style={headingStyle}>Látogatói viselkedés</h2>
        <nav aria-label="Külső elemző-felületek">
          <ul
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'calc(var(--base) * 0.5)',
              listStyle: 'none',
              margin: 'calc(var(--base) * 0.75) 0',
              padding: 0,
            }}
          >
            {EXTERNAL_ANALYTICS_LINKS.map((tool) => (
              <li key={tool.href}>
                <a href={tool.href} rel="noopener noreferrer" style={toolLinkStyle} target="_blank">
                  {tool.label} {NEW_TAB_SUFFIX}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {embedUrl ? (
          <iframe
            src={embedUrl}
            style={{ ...embedFrameStyle, height: '90rem', width: '100%' }}
            title="Látogatói kimutatás (PostHog)"
          />
        ) : (
          <div style={{ ...embedFrameStyle, maxWidth: '42rem', padding: 'calc(var(--base) * 1)' }}>
            <h3 style={{ marginTop: 0 }}>{EMBED_MISSING_TITLE}</h3>
            {/* K13: a bekötés lépései (és a környezeti változó neve) csak a
                tulajdonosé; a munkatárs a teendőt kapja. Csak megjelenítés: a
                nézet kapuja (hasStaffOrOwnerRole) változatlan. */}
            {owner ? (
              <p>
                A PostHogban nyisd meg a Dashboards listát, és keresd meg azt a kimutatást, amelynek
                a nevében a „látogatók és érdeklődés” szerepel. Kapcsold be a megosztását (Share
                gomb), a kapott linket pedig állítsd be a Railway-en a{' '}
                <code>POSTHOG_SHARED_DASHBOARD_URL</code> változóba. A következő indulás után a
                kimutatás itt jelenik meg.
              </p>
            ) : (
              <p>{EMBED_MISSING_STAFF_MESSAGE}</p>
            )}
          </div>
        )}
      </div>
    </AdminChrome>
  )
}

export default WebAnalyticsView
