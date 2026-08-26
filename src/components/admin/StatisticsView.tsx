import type { AdminViewServerProps } from 'payload'

import { logger } from '../../lib/logger'
import { queryCourseEngagement } from '../../lib/statistics/engagement-query'
import type { CourseEngagementReport } from '../../lib/statistics/engagement'
import { queryRevenueReport } from '../../lib/statistics/query'
import { canAccessStatistics, type RevenueReport } from '../../lib/statistics/revenue'
import { AdminChrome, AdminViewFrame } from './AdminChrome'
import { StatisticsAccessDenied, StatisticsReport, StatisticsUnavailable } from './StatisticsReport'

/**
 * Admin Statisztika nézet (`/admin/statisztika`) — T-013.
 * A Payload 3.86 a custom view-path-okat nyilvános admin-route-ként kezeli
 * (`isCustomAdminView`), ezért a Root view auth-átirányítása KIMARAD. A kapu
 * NEM opcionális: be nem jelentkezett látogató is eléri az URL-t. A
 * `canAccessStatistics` (staff/owner, `null` → false) az egyetlen védelem.
 * A havi bevétel a fizetett rendelések tétel-szintű ág-bontása. A demó-seed
 */
export async function StatisticsView(props: AdminViewServerProps) {
  const { req } = props.initPageResult
  if (!canAccessStatistics(req.user)) {
    return (
      <AdminViewFrame props={props}>
        <StatisticsAccessDenied />
      </AdminViewFrame>
    )
  }

  let report: RevenueReport
  try {
    report = await queryRevenueReport({ payload: req.payload })
  } catch (error) {
    logger.error('statisztika-nézet: a lekérdezés nem sikerült', {
      error: error instanceof Error ? error.message : String(error),
    })
    return (
      <AdminChrome props={props}>
        <StatisticsUnavailable />
      </AdminChrome>
    )
  }

  // A kurzus-hatás lekérdezés hibája NEM dönti el az oldalt: a bevételi rész
  // ilyenkor is megjelenik, a szekció helyén magyar magyarázat áll (a
  // StatisticsReport `engagement: null` ágán). A hiba naplózva marad.
  let engagement: CourseEngagementReport | null = null
  try {
    engagement = await queryCourseEngagement({ payload: req.payload })
  } catch (error) {
    logger.error('statisztika-nézet: a kurzus-hatás lekérdezés nem sikerült', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return (
    <AdminChrome props={props}>
      <StatisticsReport report={report} engagement={engagement} />
    </AdminChrome>
  )
}

export default StatisticsView
