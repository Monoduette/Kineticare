import type { CourseStudentStatus } from '../admin/course-progress-stats'

/**
 * Kurzus-haladás mély link — `?haladas=<állapot>#kurzus-haladas`. Egyetlen szerződés író/olvasó UI-nak.
 */

/** A haladás-szűrő URL-paraméterének NEVE. */
export const COURSE_PROGRESS_FILTER_PARAM = 'haladas'

/** A panelre mutató horgony azonosítója (a `#` nélkül). */
export const COURSE_PROGRESS_ANCHOR = 'kurzus-haladas'

/** A kurzus szerkesztőlapja, a haladás-panel horgonyával és szűrőjével. */
export function courseProgressHref(productId: number, status?: CourseStudentStatus): string {
  const base = `/admin/collections/products/${String(productId)}`
  const query =
    status === undefined ? '' : `?${COURSE_PROGRESS_FILTER_PARAM}=${encodeURIComponent(status)}`
  return `${base}${query}#${COURSE_PROGRESS_ANCHOR}`
}
