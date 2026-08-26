import { getPayload } from 'payload'

import { logger } from '@/lib/logger'
import { findNewsletterFormId } from '@/lib/newsletter/form'
import config from '@/payload.config'

import { NewsletterForm } from './NewsletterForm'

/**
 * NewsletterSignup — a lábléc feliratkozó-blokkjának SZERVER-oldali burka (C9).
 * Feladata mindössze kettő, ugyanaz, amit a /kapcsolat oldal is elvégez a
 * kapcsolat-űrlapnak:
 * plugin `POST /api/form-submissions` végpontjára megy, ahhoz kell);
 * csak beállított kulcs mellett kerül a DOM-ba).
 * Ha az űrlap nem oldható fel (nem futott a seed, vagy adatbázis-hiba), a blokk
 */
/** A Payload-példány megszerzése sem dobhat ki a láblécben — ott is warn + null. */
async function resolveNewsletterFormId(): Promise<string | null> {
  try {
    const payload = await getPayload({ config })
    return await findNewsletterFormId(payload)
  } catch (error) {
    logger.warn('a Payload-példány nem elérhető — a lábléc feliratkozó-blokkja kimarad', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export async function NewsletterSignup() {
  const formId = await resolveNewsletterFormId()
  if (!formId) {
    return null
  }
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY ?? null

  return <NewsletterForm formId={formId} turnstileSiteKey={turnstileSiteKey} />
}
