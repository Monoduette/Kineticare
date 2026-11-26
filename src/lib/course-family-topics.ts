import type { Payload } from 'payload'

import type { Product } from '../payload-types'
import { isDiscoverableCourse } from './course-discovery'
import type { Logger } from './logger'

/** Ennyi témakurzus fér a program oldalának szakaszába (a rács egy-két sora). */
export const TOPIC_COURSES_LIMIT = 12

/**
 * A teljes program közzétett, listázható témakurzusai a program oldalához
 * („Csak egy területen fáj?” szakasz). Nyilvános olvasással fut
 * (`overrideAccess: false`), így a fizetős tananyag mezői a mező-szintű
 * hozzáférés miatt ki sem töltődnek. A rejtett (`unlisted`) témakurzus nem
 * kerül ide, ugyanúgy, mint a többi listába; linkkel továbbra is megnyitható.
 *
 * Hibánál üres lista: a szakasz kiegészítő ajánlat, a program oldala
 * nélküle is teljes.
 */
export async function findTopicCoursesOf(input: {
  payload: Payload
  programId: number
  logger: Logger
}): Promise<Product[]> {
  try {
    const result = await input.payload.find({
      collection: 'products',
      where: {
        and: [{ parentCourses: { in: [input.programId] } }, { status: { equals: 'published' } }],
      },
      depth: 1,
      limit: TOPIC_COURSES_LIMIT,
      sort: 'displayTitle',
      overrideAccess: false,
    })
    return result.docs.filter((doc) => doc.id !== input.programId && isDiscoverableCourse(doc))
  } catch (error) {
    input.logger.warn('témakurzusok: a program témakurzusainak lekérdezése sikertelen', {
      programId: input.programId,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}
