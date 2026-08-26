import type { CollectionBeforeDeleteHook } from 'payload'

import { logger } from '../logger'

/** course-progress takarítás user/product törlés előtt (required mező vs ON DELETE SET NULL). */

/** A törlő hook egy adott kapcsoló-mezőre (`user` vagy `product`). */
export function deleteCourseProgressOnParentDelete(
  field: 'user' | 'product',
): CollectionBeforeDeleteHook {
  return async ({ id, req }) => {
    try {
      const eredmeny = await req.payload.delete({
        collection: 'course-progress',
        where: { [field]: { equals: id } },
        req,
      })
      const torolt = Array.isArray(eredmeny.docs) ? eredmeny.docs.length : 0
      if (torolt > 0) {
        logger.info('course-progress: a szülő törlésekor takarítottunk', {
          field,
          parentId: String(id),
          deleted: torolt,
        })
      }
    } catch (error) {
      // A takarítás hibája nem akaszthatja meg a törlést: a valódi hibát a
      // törlés maga fogja jelenteni, ez a napló csak a diagnózishoz kell.
      logger.error('course-progress: a szülő törlésekor a takarítás megbukott', {
        field,
        parentId: String(id),
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
