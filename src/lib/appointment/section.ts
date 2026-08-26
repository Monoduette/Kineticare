import { getPayload } from 'payload'

import { logger } from '../logger'

import {
  EMPTY_APPOINTMENT_CONTEXT,
  layoutHasAppointmentBlock,
  type AppointmentSectionContext,
} from './context'
import { findAppointmentFormId } from './form'

/**
 * Időpontkérő szekció kontextus betöltése. Nincs blokk → nincs DB-kör; hiányzó
 * űrlap → warn, lap marad. Payload config dinamikus import.
 */
export async function getAppointmentSectionContext(
  layout: ReadonlyArray<{ blockType?: string | null }> | null | undefined,
): Promise<AppointmentSectionContext> {
  if (!layoutHasAppointmentBlock(layout)) {
    return EMPTY_APPOINTMENT_CONTEXT
  }
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY ?? null
  try {
    const { default: config } = await import('../../payload.config')
    const payload = await getPayload({ config })
    return { formId: await findAppointmentFormId(payload), turnstileSiteKey }
  } catch (error) {
    logger.warn('az időpontkérő szekció környezete nem tölthető be — az űrlap letiltva renderel', {
      error: error instanceof Error ? error.message : String(error),
    })
    return { formId: null, turnstileSiteKey }
  }
}
