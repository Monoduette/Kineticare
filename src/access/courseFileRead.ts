import type { Access, PayloadRequest, Where } from 'payload'

import { canReadCourseContent, readCourseId } from './courseContentRead'
import { isUploadBasename } from './mediaFilename'
import { markResponsePrivate } from './privateResponse'
import { hasStaffOrOwnerRole } from './roles'

const FILE_ACCESS_CACHE = Symbol('kineticare-course-files')
export const COURSE_FILE_BATCH = 100
export const MAX_FILE_ACCESS_QUERIES = 20
export const MAX_FILE_ACCESS_COURSES = 1000

interface CourseReferences {
  id: number
  files: number[]
}
interface FileOwner {
  id: number
  course: number
}
interface FileAccessCache {
  actor: PayloadRequest['user']
  queryCount: number
  snapshots: Map<number, Promise<CourseReferences | null>>
  candidates: Map<string, Promise<FileOwner | null>>
  listing?: Promise<Where | false>
}
type FileContext = PayloadRequest['context'] & { [FILE_ACCESS_CACHE]?: FileAccessCache }

function relationId(value: unknown): number | null {
  return readCourseId(
    typeof value === 'object' && value !== null && 'id' in value ? value.id : value,
  )
}

function fileCache(req: PayloadRequest): FileAccessCache {
  const context = (req.context ??= {}) as FileContext
  let cache = context[FILE_ACCESS_CACHE]
  if (!cache || cache.actor !== req.user) {
    cache = { actor: req.user, queryCount: 0, snapshots: new Map(), candidates: new Map() }
    context[FILE_ACCESS_CACHE] = cache
  }
  return cache
}

function consumeQuery(cache: FileAccessCache): boolean {
  if (cache.queryCount >= MAX_FILE_ACCESS_QUERIES) return false
  cache.queryCount += 1
  return true
}

/** Csak a committed snapshot explicit private attachment-id-i számítanak. */
export function privateReferences(doc: unknown): CourseReferences | null {
  if (typeof doc !== 'object' || doc === null) return null
  const value = doc as Record<string, unknown>
  const id = readCourseId(value.id)
  if (
    id === null ||
    value._status !== 'published' ||
    !['published', 'archived'].includes(String(value.status))
  )
    return null
  const files = new Set<number>()
  for (const chapter of Array.isArray(value.modules) ? value.modules : []) {
    if (typeof chapter !== 'object' || chapter === null) continue
    for (const lesson of Array.isArray(chapter.lessons) ? chapter.lessons : []) {
      if (typeof lesson !== 'object' || lesson === null) continue
      for (const attachment of Array.isArray(lesson.attachments) ? lesson.attachments : []) {
        if (typeof attachment !== 'object' || attachment === null) continue
        const fileId = relationId(attachment.protectedFile)
        if (fileId !== null) files.add(fileId)
      }
    }
  }
  return { id, files: [...files] }
}

async function snapshots(
  req: PayloadRequest,
  cache: FileAccessCache,
  ids: number[],
): Promise<Array<CourseReferences | null>> {
  const missing = [...new Set(ids)].filter((id) => !cache.snapshots.has(id))
  for (let start = 0; start < missing.length; start += COURSE_FILE_BATCH) {
    const batch = missing.slice(start, start + COURSE_FILE_BATCH)
    // A közös Promise az await előtt a cache-be kerül, így relationship
    // population és későbbi lista ugyanazt a committed snapshotot látja.
    const lookup = (async () => {
      if (!consumeQuery(cache)) return new Map<number, CourseReferences>()
      try {
        const result = await req.payload.find({
          collection: 'products',
          where: { id: { in: batch } },
          select: {
            id: true,
            status: true,
            _status: true,
            modules: { lessons: { attachments: { protectedFile: true } } },
          },
          depth: 0,
          limit: batch.length,
          pagination: false,
          draft: false,
          overrideAccess: true,
          req,
        })
        const found = new Map<number, CourseReferences>()
        for (const doc of result.docs) {
          const refs = privateReferences(doc)
          if (refs && batch.includes(refs.id)) found.set(refs.id, refs)
        }
        return found
      } catch {
        return new Map<number, CourseReferences>()
      }
    })()
    for (const id of batch)
      cache.snapshots.set(
        id,
        lookup.then((found) => found.get(id) ?? null),
      )
  }
  return Promise.all(ids.map((id) => cache.snapshots.get(id) ?? Promise.resolve(null)))
}

function filenameWhere(filename: string): Where {
  return {
    or: [
      { filename: { equals: filename } },
      ...['xs', 'sm', 'md', 'lg', 'og'].map((size) => ({
        [`sizes.${size}.filename`]: { equals: filename },
      })),
    ],
  }
}

function candidate(
  req: PayloadRequest,
  cache: FileAccessCache,
  id: number | null,
  filename?: string,
): Promise<FileOwner | null> {
  const key = id === null ? `filename:${filename}` : `id:${id}`
  const existing = cache.candidates.get(key)
  if (existing) return existing
  const lookup = (async () => {
    if (!consumeQuery(cache)) return null
    try {
      const result = await req.payload.find({
        collection: 'course-files',
        where: id === null ? filenameWhere(filename!) : { id: { equals: id } },
        select: { id: true, course: true },
        depth: 0,
        limit: 2,
        pagination: false,
        overrideAccess: true,
        req,
      })
      if (result.docs.length !== 1) return null
      const doc = result.docs[0]
      const fileId = readCourseId(doc?.id)
      const course = relationId(doc?.course)
      return fileId === null || course === null ? null : { id: fileId, course }
    } catch {
      return null
    }
  })()
  cache.candidates.set(key, lookup)
  return lookup
}

async function listing(req: PayloadRequest, cache: FileAccessCache): Promise<Where | false> {
  const purchases = req.user?.purchases
  const ids = [
    ...new Set(
      (Array.isArray(purchases) ? purchases : []).flatMap((purchase) => {
        const id = relationId(purchase)
        return id === null ? [] : [id]
      }),
    ),
  ]
  if (ids.length === 0 || ids.length > MAX_FILE_ACCESS_COURSES) return false
  const docs = await snapshots(req, cache, ids)
  const readable = await Promise.all(
    docs.map(async (doc) =>
      doc && doc.files.length > 0 && (await canReadCourseContent(req, doc.id)) ? doc : null,
    ),
  )
  const filters: Where[] = readable.flatMap((doc): Where[] =>
    doc ? [{ and: [{ course: { equals: doc.id } }, { id: { in: doc.files } }] }] : [],
  )
  return filters.length > 0 ? { or: filters } : false
}

export const courseFileReadAccess: Access = async ({
  id: rawId,
  data,
  isReadingStaticFile,
  req,
}) => {
  markResponsePrivate(req)
  const filename = isReadingStaticFile ? data?.filename : undefined
  if (isReadingStaticFile && !isUploadBasename(filename)) return false
  if (hasStaffOrOwnerRole(req.user)) return true
  if (readCourseId(req.user?.id) === null) return false
  const cache = fileCache(req)
  const id = readCourseId(rawId)
  if (isReadingStaticFile || rawId !== undefined) {
    if (!isReadingStaticFile && id === null) return false
    const asset = await candidate(req, cache, id, filename)
    if (!asset || !(await canReadCourseContent(req, asset.course))) return false
    const [doc] = await snapshots(req, cache, [asset.course])
    return doc?.files.includes(asset.id)
      ? { and: [{ id: { equals: asset.id } }, { course: { equals: asset.course } }] }
      : false
  }
  cache.listing ??= listing(req, cache)
  return cache.listing
}
