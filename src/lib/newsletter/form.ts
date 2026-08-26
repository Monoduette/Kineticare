import type { Payload } from 'payload'

import { logger } from '../logger'

import { NEWSLETTER_CONSENT_LABEL } from './consent-text'
import { NEWSLETTER_CONSENT_FIELD, NEWSLETTER_EMAIL_FIELD } from './validation'

/**
 * A „Hírlevél" form-builder űrlap — adat, nem séma (C9). Mezőnevek: email, consentNewsletter.
 * Idempotens: meglévő „Hírlevél" című űrlapot nem ír felül.
 */

export const NEWSLETTER_FORM_TITLE = 'Hírlevél'

const NEWSLETTER_CONFIRMATION =
  'Köszönjük a feliratkozást! Hamarosan jelentkezünk az első hírlevéllel.'

/**
 * Egybekezdéses Lexical-törzs a visszaigazoló üzenethez. Szándékosan HELYI
 * (nem a home-seed `minimalRichText`-je): ezt a modult a lábléc szerver-
 * komponense is importálja, oda pedig a home-seed `node:fs`-es függősége
 * feleslegesen kerülne be.
 */
function confirmationRichText(text: string): Record<string, unknown> {
  return {
    root: {
      type: 'root',
      version: 1,
      direction: 'ltr',
      format: '',
      indent: 0,
      children: [
        {
          type: 'paragraph',
          version: 1,
          direction: 'ltr',
          format: '',
          indent: 0,
          children: [
            {
              type: 'text',
              version: 1,
              detail: 0,
              format: 0,
              mode: 'normal',
              style: '',
              text,
            },
          ],
        },
      ],
    },
  }
}

export function newsletterFormData(): Record<string, unknown> {
  return {
    title: NEWSLETTER_FORM_TITLE,
    submitButtonLabel: 'Feliratkozom',
    confirmationType: 'message',
    confirmationMessage: confirmationRichText(NEWSLETTER_CONFIRMATION),
    fields: [
      {
        blockType: 'email',
        name: NEWSLETTER_EMAIL_FIELD,
        label: 'E-mail cím',
        required: true,
      },
      {
        blockType: 'checkbox',
        name: NEWSLETTER_CONSENT_FIELD,
        label: NEWSLETTER_CONSENT_LABEL,
        required: true,
      },
    ],
    // Beküldéskor NEM küldünk automatikus e-mailt (sem a feliratkozónak, sem a
    // staffnak): dupla opt-in nincs bekötve, a feliratkozásokat a szerkesztő az
    // Űrlapbeküldések listán látja. Lásd docs/hirlevel.md.
    emails: [],
  }
}

/**
 * Idempotens létrehozás: ha már van „Hírlevél" című űrlap, NEM nyúlunk hozzá
 * (a szerkesztő átszabhatta a mezőket/szövegeket — a seed sosem ír felül).
 */
export async function ensureNewsletterForm(payload: Payload): Promise<void> {
  const existing = await payload.find({
    collection: 'forms' as 'pages',
    where: { title: { equals: NEWSLETTER_FORM_TITLE } },
    limit: 1,
    overrideAccess: true,
  })
  if (existing.totalDocs > 0) {
    payload.logger.info('Seed: a „Hírlevél" űrlap már létezik, kihagyva.')
    return
  }
  await payload.create({
    collection: 'forms' as 'pages',
    data: newsletterFormData() as never,
    overrideAccess: true,
  })
  payload.logger.info('Seed: „Hírlevél" űrlap létrehozva.')
}

/**
 * A „Hírlevél" űrlap azonosítója a lábléc-űrlaphoz (a beküldés a plugin
 * végpontjára megy, ahhoz kell a form id).
 *
 * Hibatűrő: ha az űrlap hiányzik (nem futott seed) vagy a lekérdezés elhasal,
 * `null`-t ad — a lábléc ilyenkor NEM renderel feliratkozó-blokkot, de az
 * oldal kiszolgálható marad. A hiba nem néma: warn-log készül róla.
 */
export async function findNewsletterFormId(payload: Payload): Promise<string | null> {
  try {
    const { docs } = await payload.find({
      collection: 'forms' as 'pages',
      where: { title: { equals: NEWSLETTER_FORM_TITLE } },
      limit: 1,
      overrideAccess: true,
    })
    const doc = docs[0]
    if (!doc) {
      logger.warn('a „Hírlevél" űrlap nem található — a lábléc feliratkozó-blokkja kimarad')
      return null
    }
    return String(doc.id)
  } catch (error) {
    logger.warn('hírlevél-űrlap lekérdezése sikertelen — a lábléc feliratkozó-blokkja kimarad', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
