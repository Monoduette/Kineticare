import { Suspense, type CSSProperties } from 'react'
import type { AdminViewServerProps } from 'payload'
import Link from 'next/link'

import { hasOwnerRole, hasStaffOrOwnerRole } from '../../access/roles'
import {
  formatCountHu,
  formatDurationHu,
  formatFetchedAtHu,
  formatPercentHu,
  isWebStatsStale,
  loadPosthogWebStats,
  parseWebStatsPeriod,
  type PosthogWebStats,
  type WebOverview,
  type WebStatsPeriodDays,
} from '../../lib/admin/posthog-web-stats'
import { logger } from '../../lib/logger'
import { queryCourseEngagement } from '../../lib/statistics/engagement-query'
import type { CourseEngagementReport } from '../../lib/statistics/engagement'
import { queryRevenueReport } from '../../lib/statistics/query'
import { formatHuf, type RevenueReport } from '../../lib/statistics/revenue'
import { AdminChrome, AdminViewFrame } from './AdminChrome'
import { StatCard } from './statistics/StatCard'
import { RESZLEGES_LEVONVA, RESZLEGES_NINCS_LEVONVA } from './statistics/TotalsCards'
import {
  BreakdownTables,
  VISITOR_STATS_BLOCK_MISSING_MESSAGE,
  VISITOR_TABLE_EMPTY_MESSAGE,
} from './webanalitika/BreakdownTables'
import { POSTHOG_EMBED_ORIGIN, posthogEmbedUrl } from '../../lib/admin/web-analytics-config'
import { DailyVisitorsChart } from './webanalitika/DailyVisitorsChart'
import { PosthogDashboardEmbed } from './webanalitika/PosthogDashboardEmbed'
import { PeriodSwitch } from './webanalitika/PeriodSwitch'
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
 * belépniük és ott tájékozódniuk, a látogatói adatok az adminon belül
 * látszódjanak. Második kérés (ugyanaznap): az eladás- és kurzushaladás-számok
 * is EZEN a képernyőn legyenek. Harmadik kérés (2026-11-07): 7 és 30 nap
 * között lehessen választani (`?idoszak=7|30`), és a PostHog Web analytics
 * felületének minden adata itt is látszódjon (napi diagram, oldalak, források,
 * eszközök, földrajz). A PostHog-adat azóta natív: a szerver kérdezi le, a
 * nézet saját kártyákkal, diagrammal és táblákkal mutatja.
 *
 * Negyedik kérés (2026-11-07): a korábbi „Látogatói viselkedés” rész (a GA4,
 * Search Console, Google Ads és PostHog külső linkjei, valamint a beágyazott
 * PostHog-kimutatás) kikerült, mert a natív adat kiváltotta. Ugyanekkor a
 * PostHogból behúzott látogatói szekció a márka hűvös tintjét kapta háttérnek
 * (`--kc-as-surface-tint`, custom.scss), hogy a friss adat egy pillantással
 * elváljon az adatbázis-számoktól.
 *
 * ═══ HOVA KERÜLHET ELADÁS-ADAT ÉS HOVA NEM ═══
 * A számok az ADMIN-NÉZET tetejére kerülnek, adatbázisból, a szerepkör-kapu
 * mögé — pontosan ugyanazokból a lekérdező modulokból, mint a Statisztika
 * oldal (queryRevenueReport, queryCourseEngagement), tehát a forrás egy
 * marad. A PostHog MEGOSZTOTT dashboardja jelszó nélkül, a link birtokában
 * megnyitható, ezért ott KIZÁRÓLAG ÖSSZESÍTETT adat lehet: látogatói
 * viselkedés, valamint (tulajdonosi döntés, 2026-11-07) összesített létszámok
 * a vásárlási és a tanulási tölcsérben. Név, e-mail, összeg, bevétel vagy
 * bármilyen egyénre visszavezethető adat továbbra is TILOS a megosztott linken
 * (docs/statisztika-audit-2026-08-21.md 4. szakasz).
 *
 * A Payload custom view NYILVÁNOS admin-route, ezért a szerver-oldali
 * szerepkör-kapu az egyetlen védelem (a BunnyLibraryView mintája). A két
 * statisztika-lekérdezés `overrideAccess: true`-val fut, tehát a kapu itt is
 * adatvédelmi teherviselő — a kapu-kötést őr-teszt méri
 * (admin-nezet-kapu-kotes.test.tsx).
 */

export const WEB_ANALYTICS_ACCESS_DENIED_MESSAGE =
  'A Webanalitikát csak munkatárs vagy tulajdonos nézheti meg.'

export const WEB_ANALYTICS_DB_UNAVAILABLE_MESSAGE =
  'Az eladás- és haladás-számok most nem érhetők el. A részletes bontást a Statisztika oldalon találod, vagy próbáld újra pár perc múlva.'

/** A látogatói szekció címe a választott időszakkal. */
export function visitorStatsHeading(days: WebStatsPeriodDays): string {
  return `Látogatók az elmúlt ${days} napban`
}

/** Az alapértelmezett (7 napos) cím; a meglévő hivatkozások ezt használják. */
export const VISITOR_STATS_HEADING = visitorStatsHeading(7)

export const VISITOR_STATS_NOTE =
  'A számok 5 percenként frissülnek, a belső és a teszt-forgalom nélkül. Csak azokat a látogatókat látjuk, akik hozzájárultak a sütikhez.'

export const VISITOR_STATS_STALE_MESSAGE =
  'A PostHog most nem ad friss adatot, ezért a legutóbbi elérhető számokat látod.'

export const VISITOR_STATS_MISSING_STAFF_MESSAGE =
  'A látogatói számok még nincsenek bekötve. Szólj a tulajdonosnak.'

export const VISITOR_STATS_UNAVAILABLE_MESSAGE =
  'A látogatói számok most nem érhetők el. Próbáld újra pár perc múlva.'

export const VISITOR_STATS_LOADING_MESSAGE = 'A látogatói számok betöltése…'

export const DAILY_CHART_HEADING = 'Napi látogatók és megtekintések'

const NO_VALUE = 'nincs adat'

const blockNoticeStyle: CSSProperties = {
  ...noticeStyle,
  marginBottom: 'var(--kc-as-space-4, 1rem)',
}

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
 * A látogatói számok törzse. Külön async szerver-komponens, hogy a lap többi
 * része (az eladás-számok) NE várjon a PostHogra: a
 * `<Suspense>` határ a törzs helyén rövid betöltés-szöveget mutat, a Next.js
 * pedig a kész törzset utólag streameli be (React Server Components,
 * https://nextjs.org/docs/app/getting-started/fetching-data#streaming). A
 * lekérdezés ígéretét a hívó indítja, a kapu UTÁN, a DB-lekérdezésekkel
 * párhuzamosan; a betöltő soha nem dob.
 */
export async function VisitorStatsBody({
  owner,
  stats: statsPromise,
}: {
  owner: boolean
  stats: Promise<PosthogWebStats>
}) {
  const stats = await statsPromise
  if (stats.status === 'not_configured') {
    return owner ? (
      <p style={leadInSectionStyle}>
        A látogatói számokhoz a Railway-en be kell állítani a <code>POSTHOG_PERSONAL_API_KEY</code>{' '}
        változót. A kulcsot a PostHogban a Settings, Personal API keys oldalon hozhatod létre, csak
        Query read jogosultsággal és csak a KinetiCare projektre. A következő indulás után a számok
        itt jelennek meg.
      </p>
    ) : (
      <p style={leadInSectionStyle}>{VISITOR_STATS_MISSING_STAFF_MESSAGE}</p>
    )
  }
  if (stats.status === 'unavailable') {
    return <p style={leadInSectionStyle}>{VISITOR_STATS_UNAVAILABLE_MESSAGE}</p>
  }
  return (
    <>
      <p style={leadInSectionStyle}>
        {VISITOR_STATS_NOTE} Utolsó frissítés: {formatFetchedAtHu(stats.fetchedAt)}.
      </p>
      {isWebStatsStale(stats.fetchedAt) ? (
        <p style={blockNoticeStyle}>{VISITOR_STATS_STALE_MESSAGE}</p>
      ) : null}
      {stats.overview === null ? (
        <p style={blockNoticeStyle}>Az összesítő számok most nem érhetők el.</p>
      ) : (
        <div style={cardRowStyle}>
          {visitorCards(stats.overview).map((stat) => (
            <StatCard key={stat.label} label={stat.label} value={stat.value} />
          ))}
        </div>
      )}
      <h3 style={headingStyle}>{DAILY_CHART_HEADING}</h3>
      {stats.daily === null ? (
        <p style={blockNoticeStyle}>{VISITOR_STATS_BLOCK_MISSING_MESSAGE}</p>
      ) : stats.daily.length === 0 ? (
        <p style={blockNoticeStyle}>{VISITOR_TABLE_EMPTY_MESSAGE}</p>
      ) : (
        <DailyVisitorsChart points={stats.daily} />
      )}
      <BreakdownTables breakdowns={stats.breakdowns} />
    </>
  )
}

/**
 * A PostHogból behúzott látogatói szekció felülete: a hűvös tint-sáv
 * (`--kc-as-surface-tint`, a kontrasztok custom.scss-ben számolva). A kártyák,
 * a diagram és a táblák a saját emelt (fehér) felületükön maradnak, így a
 * táblasor hover-színe (ugyanaz a tint) fehéren jelenik meg, nem olvad bele a
 * sávba. A sáv önmagában választja el a szekciót, ezért a felső hairline
 * elmarad. A belső térköz 320 px-en 16 px, széles lapon 24 px (a 4 px-es rács
 * két lépcsője); 600 px alatt a sáv a lap oldalmargójába nyúlik
 * (`.kc-as-tint-section`, custom.scss), így a táblák nem keskenyednek
 * (WCAG 2.2 SC 1.4.10).
 */
const visitorSectionStyle: CSSProperties = {
  background: 'var(--kc-as-surface-tint, transparent)',
  borderRadius: 'var(--kc-as-radius-md, 0)',
  marginBottom: 0,
  marginTop: 'var(--kc-as-space-6, calc(var(--base) * 1.5))',
  padding: 'clamp(var(--kc-as-space-4, 1rem), 3vw, var(--kc-as-space-5, calc(var(--base) * 0.75)))',
}

/**
 * A látogatói számok szekciója. A cím és az időszak-választó azonnal
 * megjelenik, a számok a Suspense-határ mögött érkeznek. A kártyák és a táblák
 * a lap meglévő nyelvét viszik (StatCard, statistics/styles).
 */
function VisitorStatsSection({
  owner,
  periodDays,
  stats,
}: {
  owner: boolean
  periodDays: WebStatsPeriodDays
  stats: Promise<PosthogWebStats>
}) {
  const heading = visitorStatsHeading(periodDays)
  return (
    <section aria-label={heading} className="kc-as-tint-section" style={visitorSectionStyle}>
      <h2 style={headingStyle}>{heading}</h2>
      <PeriodSwitch current={periodDays} />
      <Suspense
        fallback={
          <p role="status" style={leadInSectionStyle}>
            {VISITOR_STATS_LOADING_MESSAGE}
          </p>
        }
      >
        <VisitorStatsBody owner={owner} stats={stats} />
      </Suspense>
    </section>
  )
}

export const POSTHOG_EMBED_HEADING = 'Folyamatok és grafikonok az elmúlt 30 napból'

export const POSTHOG_EMBED_LEAD =
  'Hol tartanak a vevők a kurzusban, meddig jutnak el a vásárlásban, mire kattintanak, és hogyan nézik a videókat. A grafikonokat a PostHog rajzolja. A PostHog csak a sütikhez hozzájáruló látogatókat látja, ezért a számai kisebbek lehetnek, mint a fenti, adatbázisból jövő számok.'

export const POSTHOG_EMBED_MISSING_STAFF_MESSAGE =
  'A grafikonok még nincsenek bekötve. Szólj a tulajdonosnak.'

/**
 * A megosztott PostHog-dashboard szekciója (tulajdonosi kérés, 2026-11-07:
 * a nem technikai munkatársaknak a PostHog saját grafikonjai kellenek: kurzus-
 * haladás, tölcsérek, kattintások, videók). A saját látogatói rész alatt áll,
 * ugyanazon a tint-sávon. A dashboard tartalmát a PostHogban kell szerkeszteni
 * („Kineticare — látogatók és érdeklődés”); a megosztott linken csak
 * összesített adat lehet (lásd fent: viselkedés és tölcsér-létszámok), név-,
 * összeg- és bevételadat nem. Ha a link nincs
 * beállítva, a tulajdonos a teendőt látja, a munkatárs egy rövid üzenetet.
 */
function PosthogEmbedSection({ owner }: { owner: boolean }) {
  const embedUrl = posthogEmbedUrl()
  return (
    <section
      aria-label={POSTHOG_EMBED_HEADING}
      className="kc-as-tint-section"
      style={visitorSectionStyle}
    >
      <h2 style={headingStyle}>{POSTHOG_EMBED_HEADING}</h2>
      <p style={leadInSectionStyle}>{POSTHOG_EMBED_LEAD}</p>
      {embedUrl ? (
        <PosthogDashboardEmbed origin={POSTHOG_EMBED_ORIGIN} src={embedUrl} />
      ) : owner ? (
        <p style={leadInSectionStyle}>
          A PostHogban keresd meg azt a kimutatást, amelynek a nevében a „látogatók és érdeklődés”
          szerepel, kapcsold be a megosztását (Share gomb), a kapott linket pedig állítsd be a
          Railway-en a <code>POSTHOG_SHARED_DASHBOARD_URL</code> változóba. A következő indulás után
          a grafikonok itt jelennek meg.
        </p>
      ) : (
        <p style={leadInSectionStyle}>{POSTHOG_EMBED_MISSING_STAFF_MESSAGE}</p>
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
  // A PostHog-lekérdezés is csak a kapu UTÁN indul, de nem várunk rá: az
  // ígéret a DB-lekérdezésekkel párhuzamosan fut, és a Suspense-határ mögötti
  // törzs várja meg. A betöltő soha nem dob; a .catch csak védőháló, hogy egy
  // váratlan hiba se legyen kezeletlen elutasítás.
  const periodDays = parseWebStatsPeriod(props.searchParams?.idoszak)
  const visitorStats = loadPosthogWebStats(periodDays).catch((): PosthogWebStats => ({
    status: 'unavailable',
  }))
  // A számok hibája nem döntheti el az oldalt: a látogatói szekció ilyenkor is
  // megjelenik, az eladás-szekció helyén magyar magyarázat áll (a
  // StatisticsView hibakezelési mintája).
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

  return (
    <AdminChrome props={props} title="Webanalitika">
      <div className="kc-adminstat" style={pageStyle}>
        <h1 style={headingStyle}>Webanalitika</h1>
        <p style={leadStyle}>
          Egy képernyőn az eladások, a kurzushaladás és a látogatók legfontosabb számai. A részletes
          bontás (havi bevétel-grafikon, kurzusonkénti haladás, név szerinti lista) a{' '}
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
        <VisitorStatsSection owner={owner} periodDays={periodDays} stats={visitorStats} />
        <PosthogEmbedSection owner={owner} />
      </div>
    </AdminChrome>
  )
}

export default WebAnalyticsView
