import type { Payload } from 'payload'

import type { Product } from '../../payload-types'
import type { CourseEnrollment, CourseProgressStatRow } from '../admin/course-progress-stats'
import {
  ENROLLMENT_MAX,
  ENROLLMENT_PAGE_SIZE,
  PROGRESS_MAX,
  PROGRESS_PAGE_SIZE,
} from '../admin/course-progress-handler'
import { buildCurriculum } from '../curriculum/curriculum'
import { logger } from '../logger'
import {
  buildCourseEngagementReport,
  type CourseEngagementInput,
  type CourseEngagementReport,
} from './engagement'
import { trimTruncatedProgress } from './progress-truncation'
import { readStatisticsPages } from './query'

/**
 * Kurzus-hatás lekérdezés — Payload local API → engagement aggregátor.
 * overrideAccess: true; a hívó biztosítsa a canAccessStatistics kaput.
 * Kurzusonkénti ciklus + enrollment/progress plafon fele a handlerének.
 * Csonkolásnál trimTruncatedProgress; egy kurzus hibája nem viszi el a szekciót.
 */

/** Egy lapon */

/** Egy lapon beolvasott kurzusok száma. */
export const ENGAGEMENT_PRODUCT_PAGE_SIZE = 50
/** Legfeljebb ennyi kurzust aggregálunk egy nézet-betöltéskor. */
export const ENGAGEMENT_PRODUCT_MAX = 200
/** Kurzusonként legfeljebb ennyi hozzáférőt olvasunk be (handler-plafon fele). */
export const ENGAGEMENT_ENROLLMENT_MAX = ENROLLMENT_MAX / 2
/** Kurzusonként legfeljebb ennyi haladás-sort olvasunk be (handler-plafon fele). */
export const ENGAGEMENT_PROGRESS_MAX = PROGRESS_MAX / 2

interface FindResultLike<T> {
  docs?: T[] | null
  totalDocs?: number | null
  hasNextPage?: boolean | null
}

/** A termék-dokumentum azon szelete, amit a lekérdezés KIKÉR. */
interface EngagementProductDoc {
  id?: unknown
  displayTitle?: unknown
  sku?: unknown
  audience?: unknown
  modules?: Product['modules']
  videos?: Product['videos']
}

interface EngagementEnrollmentDoc {
  id?: unknown
  name?: unknown
}

interface EngagementProgressDoc {
  user?: unknown
  videoRef?: unknown
}

/* A `videos`/`modules` kell a buildCurriculum-nak; érzékeny mező (pl.
   vevő-email, purchases lista) egyik lekérdezésben sincs kiválasztva. */
const PRODUCT_SELECT = {
  displayTitle: true,
  sku: true,
  audience: true,
  modules: true,
  videos: true,
} as const

/* A hozzáférő-lekérdezés csak a nevet kéri (e-mail nem kerül a stat oldalra). */
const ENROLLMENT_SELECT = { name: true } as const

const PROGRESS_SELECT = { user: true, videoRef: true } as const

function finiteId(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** A relationship-érték numerikus azonosítója (nyers id vagy populate-olt doc). */
function relationshipId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'object' && value !== null) {
    return finiteId((value as { id?: unknown }).id)
  }
  return null
}

function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * A kurzus emberi neve: marketingcím, ennek hiányában sku, végül az
 * azonosító — ugyanaz a sorrend, mint a course-progress handlerben.
 */
function productLabel(doc: EngagementProductDoc, productId: number): string {
  return trimmedOrNull(doc.displayTitle) ?? trimmedOrNull(doc.sku) ?? `#${String(productId)}`
}

export interface QueryCourseEngagementDeps {
  payload: Pick<Payload, 'find'>
}

/**
 * Minden kurzus hatás-sora (eladás × haladás) egyetlen jelentésben.
 *
 * `overrideAccess: true` — lásd a fejkommentet: kizárólag a szerepkör-kapu
 * után hívható.
 */
export async function queryCourseEngagement(
  deps: QueryCourseEngagementDeps,
): Promise<CourseEngagementReport> {
  const productsPage = await readStatisticsPages<EngagementProductDoc>(
    (page, limit) =>
      deps.payload.find({
        collection: 'products',
        depth: 0,
        page,
        limit,
        sort: 'id',
        select: PRODUCT_SELECT,
        overrideAccess: true,
      }) as Promise<FindResultLike<EngagementProductDoc>>,
    ENGAGEMENT_PRODUCT_PAGE_SIZE,
    ENGAGEMENT_PRODUCT_MAX,
  )

  let truncated = productsPage.truncated
  let skipped = 0
  const inputs: CourseEngagementInput[] = []

  for (const doc of productsPage.docs) {
    const productId = finiteId(doc.id)
    if (productId === null) {
      continue
    }

    try {
      // „Hozzáfér" = akinek a purchases listája tartalmazza a terméket — a
      // course-progress handler definíciója. Az azonosító mellett a NÉV jön
      // át (a „nem kezdte el" névsorhoz), e-mail nem: lásd ENROLLMENT_SELECT.
      const enrollmentPage = await readStatisticsPages<EngagementEnrollmentDoc>(
        (page, limit) =>
          deps.payload.find({
            collection: 'users',
            where: { purchases: { equals: productId } },
            depth: 0,
            page,
            limit,
            sort: 'id',
            select: ENROLLMENT_SELECT,
            overrideAccess: true,
          }) as Promise<FindResultLike<EngagementEnrollmentDoc>>,
        ENROLLMENT_PAGE_SIZE,
        ENGAGEMENT_ENROLLMENT_MAX,
      )

      // A `watchedAt` itt nem kell: az összesítő totals-blokkja (elkezdte,
      // befejezte, átlag) nem használja, csak a hallgatónkénti utolsó
      // aktivitás — az pedig a kurzuslap dolga.
      const progressPage = await readStatisticsPages<EngagementProgressDoc>(
        (page, limit) =>
          deps.payload.find({
            collection: 'course-progress',
            where: { product: { equals: productId } },
            depth: 0,
            page,
            limit,
            sort: ['user', 'id'],
            select: PROGRESS_SELECT,
            overrideAccess: true,
          }) as Promise<FindResultLike<EngagementProgressDoc>>,
        PROGRESS_PAGE_SIZE,
        ENGAGEMENT_PROGRESS_MAX,
      )

      truncated = truncated || enrollmentPage.truncated || progressPage.truncated

      const enrollments: CourseEnrollment[] = []
      for (const enrollmentDoc of enrollmentPage.docs) {
        const userId = finiteId(enrollmentDoc.id)
        if (userId === null) {
          continue
        }
        // Az `email` szándékosan üres sztring: a közös összesítő szerződése
        // kéri a mezőt, de ez a nézet nem olvassa be és nem is mutatja.
        enrollments.push({ userId, email: '', name: trimmedOrNull(enrollmentDoc.name) })
      }

      const progressRows: CourseProgressStatRow[] = []
      for (const row of progressPage.docs) {
        const userId = relationshipId(row.user)
        const videoRef = trimmedOrNull(row.videoRef)
        if (userId === null || videoRef === null) {
          continue
        }
        progressRows.push({ userId, videoRef })
      }

      // A haladás-lista plafonjánál az utolsó felhasználó sorai félbevághatók.
      // A közös szabály eldobja őt és a nála nagyobb azonosítójú diákokat —
      // így a sor kevesebb diákot összesít, de amit mutat, az igaz.
      const teljes = trimTruncatedProgress({
        progressRows,
        enrollments,
        truncated: progressPage.truncated,
      })

      inputs.push({
        productId,
        title: productLabel(doc, productId),
        audience: doc.audience,
        // A csonkolás vesztesége kurzusonként megy tovább: darabszámnál alsó
        // becslés, NÉVSORNÁL viszont hamis állítás lenne elhallgatni, hogy
        // valaki hiányzik a listáról (döntési dokumentum 1. pont).
        omitted: teljes.omitted,
        truncated: enrollmentPage.truncated || progressPage.truncated,
        // hasAccess: true — az admin a teljes szerkezetet látja; a modellből
        // ebben a nézetben csak a leckeszám (nevező) hasznosul, GUID nem megy ki.
        curriculum: buildCurriculum(
          { modules: doc.modules ?? null, videos: doc.videos ?? null },
          true,
        ),
        enrollments: teljes.enrollments,
        progressRows: teljes.progressRows,
      })
    } catch (error) {
      // Egyetlen rossz kurzus (hibás tananyag-szerkezet, megbicsakló
      // adatbázis-hívás) ne vigye el a többi kurzus jelentését. Az azonosító
      // és a hiba a naplóba megy; a felület a `skipped` számot mondja ki.
      skipped += 1
      logger.warn('statisztika: a kurzus hatás-sora kimaradt (hiba)', {
        productId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return buildCourseEngagementReport(inputs, { truncated, skipped })
}
