import type { FieldAccess, PayloadRequest } from 'payload'

import { resolveCourseAccessForUser, type CourseAccessProduct } from '../lib/course-access-lookup'
import { hasUserPurchased } from '../lib/courses'
import { logger } from '../lib/logger'
import { markResponsePrivate } from './privateResponse'
import { hasStaffOrOwnerRole } from './roles'

const REQUEST_ACCESS_CACHE = Symbol('kineticare-course-content-access')
const MAX_PRODUCT_BATCH = 100

interface PendingAccess {
  resolve: (allowed: boolean) => void
}

interface RequestAccessCache {
  user: PayloadRequest['user']
  userId: number
  now: Date
  results: Map<number, Promise<boolean>>
  pending: Map<number, PendingAccess>
  running: boolean
}

type AccessContext = PayloadRequest['context'] & {
  [REQUEST_ACCESS_CACHE]?: RequestAccessCache
}

export function readCourseId(value: unknown): number | null {
  const candidate =
    typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value
  return typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate > 0
    ? candidate
    : null
}

function readParentId(id: unknown, doc: unknown): number | null {
  const direct = readCourseId(id)
  if (direct !== null) return direct
  return typeof doc === 'object' && doc !== null && 'id' in doc ? readCourseId(doc.id) : null
}

function metadataForRead(value: unknown): CourseAccessProduct | null {
  if (typeof value !== 'object' || value === null) return null
  const doc = value as Record<string, unknown>
  const id = readCourseId(doc.id)
  if (id === null || doc._status !== 'published') return null
  if (doc.status !== 'published' && doc.status !== 'archived') return null
  const days = doc.accessDurationDays
  if (days != null && (typeof days !== 'number' || !Number.isFinite(days))) return null
  return { id, accessDurationDays: days ?? null }
}

async function resolveBatch(
  req: PayloadRequest,
  cache: RequestAccessCache,
  batch: Array<[number, PendingAccess]>,
): Promise<void> {
  const allowedIds = new Set<number>()
  try {
    const requested = new Set(batch.map(([id]) => id))
    // A mezőhöz kapott doc egy select miatt hiányos lehet. Saját, minimális
    // lekérdezésből döntünk, nem a hiányzó durationt tekintjük korlátlannak.
    const result = await req.payload.find({
      collection: 'products',
      where: { id: { in: [...requested] } },
      select: { id: true, accessDurationDays: true, status: true, _status: true },
      depth: 0,
      limit: requested.size,
      pagination: false,
      draft: false,
      overrideAccess: true,
      req,
    })
    const products: CourseAccessProduct[] = []
    for (const doc of result.docs) {
      const product = metadataForRead(doc)
      if (product !== null && requested.has(product.id)) products.push(product)
    }
    if (products.length > 0) {
      // A közös resolver őrzi a paid/gift/provenance és legacy szabályokat;
      // ez a réteg csak a membershipet, snapshotot és request-batch-et adja.
      const input = {
        payload: req.payload,
        userId: cache.userId,
        products,
        now: cache.now,
        denyOnLookupFailure: true,
        req,
      }
      const states = await resolveCourseAccessForUser(input)
      for (const product of products) {
        if (states.get(product.id)?.hasAccess === true) allowedIds.add(product.id)
      }
    }
  } catch (error) {
    logger.warn('tananyag-hozzáférés: a jogosultság ellenőrzése sikertelen', {
      userId: cache.userId,
      productCount: batch.length,
      error: error instanceof Error ? error.message : 'Ismeretlen ellenőrzési hiba',
    })
  } finally {
    for (const [id, pending] of batch) pending.resolve(allowedIds.has(id))
  }
}

function scheduleBatches(req: PayloadRequest, cache: RequestAccessCache): void {
  if (cache.running) return
  cache.running = true
  queueMicrotask(async () => {
    try {
      while (cache.pending.size > 0) {
        const batch = [...cache.pending.entries()].slice(0, MAX_PRODUCT_BATCH)
        for (const [id] of batch) cache.pending.delete(id)
        await resolveBatch(req, cache, batch)
      }
    } finally {
      cache.running = false
    }
  })
}

/**
 * Közös, kéréshez kötött tananyagkapu. Minden Promise az első await ELŐTT
 * bekerül a contextbe: a Payload párhuzamos mezőolvasásai egy munkát osztanak.
 * A context szimbólumkulcsa nem kliensbemenet és nem sorosítható API-adat.
 */
export function canReadCourseContent(req: PayloadRequest, productId: number): Promise<boolean> {
  if (hasStaffOrOwnerRole(req.user)) {
    markResponsePrivate(req)
    return Promise.resolve(true)
  }
  const userId = readCourseId(req.user?.id)
  if (userId === null || !hasUserPurchased(req.user?.purchases, productId)) {
    return Promise.resolve(false)
  }
  markResponsePrivate(req)
  const context = (req.context ??= {}) as AccessContext
  let cache = context[REQUEST_ACCESS_CACHE]
  if (!cache || cache.user !== req.user || cache.userId !== userId) {
    cache = {
      user: req.user,
      userId,
      now: new Date(),
      results: new Map(),
      pending: new Map(),
      running: false,
    }
    context[REQUEST_ACCESS_CACHE] = cache
  }
  const existing = cache.results.get(productId)
  if (existing) return existing
  const pending = cache.pending
  const promise = new Promise<boolean>((resolve) => pending.set(productId, { resolve }))
  cache.results.set(productId, promise)
  scheduleBatches(req, cache)
  return promise
}

export const courseContentReadAccess: FieldAccess = ({ id, doc, req }) => {
  if (hasStaffOrOwnerRole(req.user)) {
    markResponsePrivate(req)
    return true
  }
  const productId = readParentId(id, doc)
  if (productId === null) return false
  return canReadCourseContent(req, productId)
}
