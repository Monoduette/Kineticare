import { getPayload } from 'payload'

import { createCourseProgressHandler } from '../../../../../lib/admin/course-progress-handler'
import config from '../../../../../payload.config'

/**
 * GET /api/admin/course-progress?productId=<szám> — kurzus-haladás összesítő
 * a munkatársaknak (staff/owner): ki indította el a kurzust, ki nem, és hány
 * százalékon áll.
 * A handler az src/lib/admin/course-progress-handler.ts-ben él
 * (függőség-injekcióval, egységtesztelhetően); itt csak a valódi config
 * bekötése történik — a kézi hozzáférés-adás végpontjának
 */
export const GET = createCourseProgressHandler({
  getPayload: () => getPayload({ config }),
})
