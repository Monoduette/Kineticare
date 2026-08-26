import type { Field } from 'payload'

import { validateCmsUrl } from '../lib/safe-url'

/**
 * Közös link-mezők a szekció-blokkokhoz (szekció-rendszer terv, 2. pont).
 * Minden gombnál/hivatkozásnál UGYANAZ a három mező jelenik meg, ugyanazokkal a
 * magyar feliratokkal — így a szerkesztőnek egyszer kell megtanulnia:
 * - `felirat`     — mi legyen a gombra/linkre írva,
 * - `url`         — hová vigyen,
 * - `ujAblakban`  — új lapon nyíljon-e.
 */

/** A `url` mező alapértelmezett magyarázata — laikusnak szól, példával. */
export const LINK_URL_DESCRIPTION =
  'Saját oldalra elég a perjellel kezdődő rész (pl. /kurzusok), másik weboldalra a teljes cím https://-sel kezdve.'

export interface LinkFieldsOptions {
  /**
   * Kell-e „felirat" mező. Logóknál/képeknél nem: ott maga a kép a felirat.
   * @default true
   */
  includeLabel?: boolean
  /** Kötelező-e a felirat. @default false */
  labelRequired?: boolean
  /** Kötelező-e a webcím. @default false */
  urlRequired?: boolean
  /** A felirat-mező egyedi magyarázata (ha az alapértelmezett nem elég pontos). */
  labelDescription?: string
  /** A webcím-mező egyedi magyarázata. */
  urlDescription?: string
}

/**
 * A három link-mező tömbje — `array`/`group` mezők `fields` listájába való.
 */
export const linkFields = ({
  includeLabel = true,
  labelRequired = false,
  urlRequired = false,
  labelDescription = 'Ez a szöveg jelenik meg a gombon (pl. „Kurzusok megtekintése").',
  urlDescription = LINK_URL_DESCRIPTION,
}: LinkFieldsOptions = {}): Field[] => {
  const fields: Field[] = []

  if (includeLabel) {
    fields.push({
      name: 'felirat',
      type: 'text',
      required: labelRequired,
      label: 'Felirat',
      admin: { description: labelDescription },
    })
  }

  fields.push(
    {
      name: 'url',
      type: 'text',
      required: urlRequired,
      label: 'Hová vigyen (webcím)',
      admin: { description: urlDescription },
      /*
       * Szerver-oldali ellenőrzés MENTÉSKOR (src/lib/safe-url.ts).
       *
       * A publikus oldalon a tiltott alakú cím csendben eltűnik (a
       * `sanitizeCmsUrl` `null`-t ad, a Button letiltott gombot rendereli) — a
       * szerkesztő ebből semmit nem látna. Ez a validate a mező mellett, magyar
       * üzenettel szól, ott ahol a hiba keletkezett. Ez a MEZŐ-definíció hajtja
       * az összes szekció-CTA-t: services.rows[].url, pressLogos.logos[].url,
       * filmHero.ctas[].url, ctaBanner.cta.url, credsStrip.link.url,
       * freeSos.cta.url.
       *
       * Az üres érték ott marad érvényes, ahol a mező nem kötelező; a
       * kötelezőséget a validate maga kezeli, mert saját `validate` mellett a
       * Payload nem teszi be az alapértelmezett (required-et is ellenőrző)
       * validációt (payload/dist/fields/config/sanitize.js:153-167).
       */
      validate: (value: string | null | undefined) => validateCmsUrl(value, { required: urlRequired }),
    },
    {
      name: 'ujAblakban',
      type: 'checkbox',
      defaultValue: false,
      label: 'Új lapon nyíljon',
      admin: {
        description:
          'Másik weboldalra mutató linknél szokás bekapcsolni, hogy a látogató ne hagyja el a Kineticare oldalát.',
      },
    },
  )

  return fields
}

export interface LinkGroupOptions extends LinkFieldsOptions {
  /** A csoport mezőneve (pl. `cta`). */
  name: string
  /** A csoport magyar felirata (pl. „Gomb"). */
  label: string
  /** A csoport magyarázata a szerkesztőnek. */
  description?: string
}

/**
 * Egyetlen link „csomagban" (group) — ott hasznos, ahol pontosan EGY gomb van
 * (pl. SOS-sáv, CTA-sáv, hitel-csík).
 */
export const linkGroup = ({ name, label, description, ...options }: LinkGroupOptions): Field => ({
  name,
  type: 'group',
  label,
  admin: description ? { description } : {},
  fields: linkFields(options),
})
