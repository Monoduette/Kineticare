import { sql } from '@payloadcms/db-postgres/drizzle'
import { ValidationError, type CollectionBeforeChangeHook, type PayloadRequest } from 'payload'

import {
  COURSE_FAMILY_MESSAGES,
  courseFamilyViolation,
  lessonRowCount,
  parentCourseIdsOf,
  topicCoversProgram,
  topicCoversProgramMessage,
  type CourseFamilyViolation,
} from './course-family'

/**
 * A témakurzus-szerkezet mentés-őre (products beforeChange).
 *
 * Egy szint van: témakurzusnak nem lehet témakurzusa, és kurzus nem lehet a
 * saját teljes programja. A `filterOptions` ezt csak a választólistában
 * szűri; a szerver itt dönt, mert a REST-hívó a listát megkerülheti.
 *
 * Verseny: két egyszerre mentett kurzus (A programja B, B programja A)
 * külön-külön mindkét ellenőrzésen átmenne, mert egyik sem látja a másik még
 * nem commitolt írását, és a `productUpdateLocksRow` csak a saját sort zárja.
 * Ezért minden olyan mentés, amely teljes programot állít be, ugyanazt a
 * tranzakció-szintű advisory-zárat veszi fel a kérés saját tranzakciójában;
 * a második mentés így az első commitja után olvas (READ COMMITTED).
 *
 * Közzétételkor a témakurzus leckeszáma kisebb kell legyen a teljes
 * programénál (`topicCoversProgram`): egy duplikált, ki nem húzott program így
 * nem kerülhet élesbe a témakurzus áráért.
 */

const HIERARCHY_LOCK_KEY = 'kineticare:products:course-family'

interface RequestTransactionAdapter {
  execute: (args: { db: unknown; sql: ReturnType<typeof sql> }) => Promise<unknown>
  sessions?: Record<string, { db?: unknown } | undefined>
}

function isRequestTransactionAdapter(value: unknown): value is RequestTransactionAdapter {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { execute?: unknown }).execute === 'function'
  )
}

/** Igaz, ha a zárat a kérés tranzakciójában sikerült felvenni. */
async function lockCourseFamily(req: PayloadRequest): Promise<boolean> {
  const transactionID = await req.transactionID
  const rawAdapter: unknown = req.payload?.db
  if (!isRequestTransactionAdapter(rawAdapter)) return false
  if (transactionID === undefined || transactionID === null) return false
  const transaction = rawAdapter.sessions?.[String(transactionID)]?.db
  if (transaction === undefined || transaction === null) return false
  await rawAdapter.execute({
    db: transaction,
    sql: sql`SELECT pg_advisory_xact_lock(hashtext(${HIERARCHY_LOCK_KEY}))`,
  })
  return true
}

function numericId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function violationError(violation: CourseFamilyViolation): ValidationError {
  return new ValidationError({
    collection: 'products',
    errors: [{ path: 'parentCourses', message: COURSE_FAMILY_MESSAGES[violation] }],
  })
}

export const courseFamilyGuard: CollectionBeforeChangeHook = async ({ data, originalDoc, req }) => {
  if (typeof data !== 'object' || data === null) return data
  const incoming = data as {
    parentCourses?: unknown
    status?: unknown
    modules?: unknown
    videos?: unknown
  }
  const original = originalDoc as
    | {
        id?: unknown
        parentCourses?: unknown
        status?: unknown
        modules?: unknown
        videos?: unknown
      }
    | undefined
  const parentIds = parentCourseIdsOf(Array.isArray(incoming.parentCourses) ? incoming : original)
  if (parentIds.length === 0) return data

  const selfId = numericId(original?.id)
  if (selfId !== null && parentIds.includes(selfId)) throw violationError('self')

  if (!(await lockCourseFamily(req))) {
    req.payload.logger.warn(
      'Témakurzus-őr: a szerkezeti zár nem vehető fel (nincs kérés-tranzakció), az ellenőrzés zár nélkül fut',
    )
  }

  const parents = await req.payload.find({
    collection: 'products',
    where: { id: { in: parentIds } },
    depth: 0,
    limit: parentIds.length,
    pagination: false,
    select: { parentCourses: true, modules: true, videos: true },
    overrideAccess: true,
    req,
  })
  const parentIdsThatAreTopics = new Set<number>()
  for (const parent of parents.docs) {
    if (parentCourseIdsOf(parent).length > 0) parentIdsThatAreTopics.add(parent.id)
  }

  let selfHasChildren = false
  if (selfId !== null) {
    const children = await req.payload.find({
      collection: 'products',
      where: { parentCourses: { in: [selfId] } },
      depth: 0,
      limit: 1,
      pagination: false,
      select: { sku: true },
      overrideAccess: true,
      req,
    })
    selfHasChildren = children.docs.length > 0
  }

  const violation = courseFamilyViolation({
    selfId,
    parentIds,
    parentIdsThatAreTopics,
    selfHasChildren,
  })
  if (violation !== null) throw violationError(violation)

  const status = 'status' in incoming ? incoming.status : original?.status
  if (status === 'published') {
    const topicLessons = lessonRowCount({
      modules: 'modules' in incoming ? incoming.modules : original?.modules,
      videos: 'videos' in incoming ? incoming.videos : original?.videos,
    })
    const parentLessons = topicCoversProgram({
      topicLessons,
      parentLessons: parents.docs.map((parent) => lessonRowCount(parent)),
    })
    if (parentLessons !== null) {
      throw new ValidationError({
        collection: 'products',
        errors: [
          { path: 'modules', message: topicCoversProgramMessage(topicLessons, parentLessons) },
        ],
      })
    }
  }
  return data
}
