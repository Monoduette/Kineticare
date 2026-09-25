import type { AdminViewServerProps } from 'payload'

import { hasOwnerRole } from '../../access/roles'
import { logger } from '../../lib/logger'
import { queryCourseEngagement } from '../../lib/statistics/engagement-query'
import type { CourseEngagementReport } from '../../lib/statistics/engagement'
import { queryRevenueReport } from '../../lib/statistics/query'
import { canAccessStatistics, type RevenueReport } from '../../lib/statistics/revenue'
import { AdminChrome, AdminViewFrame } from './AdminChrome'
import { StatisticsAccessDenied, StatisticsReport, StatisticsUnavailable } from './StatisticsReport'

/**
 * Admin Statisztika nézet (`/admin/statisztika`) — T-013.
 * A Payload 3.88.0 a custom view-path-okat nyilvános admin-route-ként kezeli
 * (`isCustomAdminView`), ezért a Root view auth-átirányítása KIMARAD. A kapu
 * NEM opcionális: be nem jelentkezett látogató is eléri az URL-t. A
 * `canAccessStatistics` (staff/owner, `null` → false) az egyetlen védelem.
 * A havi bevétel a fizetett rendelések tétel-szintű ág-bontása. A demó-seed
 */
export async function StatisticsView(props: AdminViewServerProps) {
  const { req } = props.initPageResult
  if (!canAccessStatistics(req.user)) {
    return (
      <AdminViewFrame props={props} title="Statisztika">
        <StatisticsAccessDenied />
      </AdminViewFrame>
    )
  }

  // A részleges visszatérítés levonása CSAK a tulajdonosnak: a `refunds` mező
  // tulajdonosi olvasású (CLAUDE.md 4.), a lekérdezés viszont overrideAccess-szel
  // fut, ezért itt dől el, hogy a mező egyáltalán bekerül-e a selectbe. A
  // munkatárs a bruttó összeget látja, és a lap ezt ki is mondja (TotalsCards).
  const includePartialRefunds = hasOwnerRole(req.user)
  const [revenueSettled, engagementSettled] = await Promise.allSettled([
    (async () => queryRevenueReport({ payload: req.payload, includePartialRefunds }))(),
    (async () => queryCourseEngagement({ payload: req.payload }))(),
  ])

  if (revenueSettled.status === 'rejected') {
    const error: unknown = revenueSettled.reason
    logger.error('statisztika-nézet: a lekérdezés nem sikerült', {
      error: error instanceof Error ? error.message : String(error),
    })
    return (
      <AdminChrome props={props} title="Statisztika">
        <StatisticsUnavailable />
      </AdminChrome>
    )
  }
  const report: RevenueReport = revenueSettled.value

  // A kurzus-hatás lekérdezés hibája NEM dönti el az oldalt: a bevételi rész
  // ilyenkor is megjelenik, a szekció helyén magyar magyarázat áll (a
  // StatisticsReport `engagement: null` ágán). A hiba naplózva marad.
  let engagement: CourseEngagementReport | null = null
  if (engagementSettled.status === 'rejected') {
    const error: unknown = engagementSettled.reason
    logger.error('statisztika-nézet: a kurzus-hatás lekérdezés nem sikerült', {
      error: error instanceof Error ? error.message : String(error),
    })
  } else {
    engagement = engagementSettled.value
  }

  return (
    <AdminChrome props={props} title="Statisztika">
      <StatisticsReport report={report} engagement={engagement} />
    </AdminChrome>
  )
}

export default StatisticsView
