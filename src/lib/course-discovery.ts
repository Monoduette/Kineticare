import type { Where } from 'payload'

/** Public discovery only. This is not an access or direct-link permission gate. */
export function isDiscoverableCourse(product: { status?: unknown; unlisted?: unknown }): boolean {
  return product.status === 'published' && product.unlisted !== true
}

/** Apply before pagination so unlisted products cannot consume public listing slots.
 * Legacy NULL/missing checkbox values retain their existing listed behavior.
 */
export const DISCOVERABLE_COURSES_WHERE: Where = {
  and: [
    { status: { equals: 'published' } },
    { or: [{ unlisted: { equals: false } }, { unlisted: { exists: false } }] },
  ],
}
