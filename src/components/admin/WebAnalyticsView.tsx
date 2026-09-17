import type { CSSProperties } from 'react'
import type { AdminViewServerProps } from 'payload'
import Link from 'next/link'

import { hasStaffOrOwnerRole } from '../../access/roles'
import {
  EXTERNAL_ANALYTICS_LINKS,
  posthogEmbedUrl,
} from '../../lib/admin/web-analytics-config'
import { logger } from '../../lib/logger'
import { queryCourseEngagement } from '../../lib/statistics/engagement-query'
import type { CourseEngagementReport } from '../../lib/statistics/engagement'
import { queryRevenueReport } from '../../lib/statistics/query'
import { formatHuf, type RevenueReport } from '../../lib/statistics/revenue'
import { AdminChrome, AdminViewFrame } from './AdminChrome'
import { StatCard } from './statistics/StatCard'
import {
  cardRowStyle,
  headingStyle,
  leadInSectionStyle,
  leadStyle,
  noticeStyle,
  pageStyle,
  sectionStyle,
  sectionTopStyle,
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
 * célértéke, docs/ui-sztenderdek.md §3), a linkek új lapon nyílnak — az admin
 * munkamenetét nem hagyjuk el.
 */
const toolLinkStyle: CSSProperties = {
  alignItems: 'center',
  border: '1px solid var(--theme-elevation-150)',
  borderRadius: '4px',
  color: 'var(--theme-text)',
  display: 'inline-flex',
  minHeight: '44px',
  padding: '0 calc(var(--base) * 0.75)',
  textDecoration: 'none',
}

export const WEB_ANALYTICS_ACCESS_DENIED_MESSAGE =
  'A Webanalitikát csak munkatárs vagy tulajdonos nézheti meg.'

export const WEB_ANALYTICS_DB_UNAVAILABLE_MESSAGE =
  'Az eladás- és haladás-számok most nem érhetők el. A részletes bontást a Statisztika oldalon találod, vagy próbáld újra pár perc múlva.'

/**
 * A hat kiemelt szám kiszámítása a Statisztika-lekérdezések jelentéseiből.
 *
 * A haladás-oszlopok kurzus-hozzáférést számolnak (egy vevő két kurzussal
 * kétszer számít) — ugyanígy összegez a Statisztika oldal kurzus-táblája is,
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
      { label: 'Kurzus-hozzáférés (vevő × kurzus)', value: String(enrolled) },
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

  // A számok hibája nem döntheti el az oldalt: a viselkedés-rész (linkek +
  // dashboard) ilyenkor is megjelenik, a szekció helyén magyar magyarázat áll
  // (a StatisticsView hibakezelési mintája).
  let report: RevenueReport | null = null
  let engagement: CourseEngagementReport | null = null
  try {
    report = await queryRevenueReport({ payload: req.payload })
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
        <section aria-label="Eladások és kurzushaladás" style={{ ...sectionStyle, ...sectionTopStyle }}>
          <h2 style={headingStyle}>Eladások és kurzushaladás</h2>
          {report === null ? (
            <p style={leadInSectionStyle}>{WEB_ANALYTICS_DB_UNAVAILABLE_MESSAGE}</p>
          ) : (
            <div style={cardRowStyle}>
              {dbSummaryStats(report, engagement).map((stat) => (
                <StatCard key={stat.label} label={stat.label} value={stat.value} />
              ))}
            </div>
          )}
          {report !== null && engagement === null ? (
            <p style={noticeStyle}>
              A kurzushaladás-számok most nem érhetők el, a részleteket a Statisztika oldalon
              találod.
            </p>
          ) : null}
        </section>
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
                  {tool.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {embedUrl ? (
          <iframe
            src={embedUrl}
            style={{
              border: '1px solid var(--theme-elevation-150)',
              borderRadius: '4px',
              height: '90rem',
              width: '100%',
            }}
            title="Kineticare — látogatók és érdeklődés (PostHog dashboard)"
          />
        ) : (
          <div
            style={{
              border: '1px solid var(--theme-elevation-150)',
              borderRadius: '4px',
              maxWidth: '42rem',
              padding: 'calc(var(--base) * 1)',
            }}
          >
            <h3 style={{ marginTop: 0 }}>A beágyazott dashboard még nincs bekötve</h3>
            <p>
              A PostHogban a „Kineticare — látogatók és érdeklődés” dashboardon kapcsold be a
              megosztást (Share gomb), majd a kapott linket állítsd be a Railway-en a{' '}
              <code>POSTHOG_SHARED_DASHBOARD_URL</code> változóba. A következő indulás után a
              dashboard itt jelenik meg.
            </p>
          </div>
        )}
      </div>
    </AdminChrome>
  )
}

export default WebAnalyticsView
