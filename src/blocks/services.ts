import type { Block } from 'payload'

import { linkFields } from './link-fields'
import { sectionSettings } from './section-settings'

/**
 * Szolgáltatás-sorok — tábla (kép + számozott sorok) vagy sín + panel.
 *
 * A `/szolgaltatasok` tábla marad. A kezdőlap „Így tudunk segíteni" szekciója
 * sín-elrendezés: Rendelői kezelések / Otthoni program / Szakmai képzések,
 * jobb oldalon szöveg + fotó.
 */
export const services: Block = {
  slug: 'services',
  interfaceName: 'BlockServices',
  labels: {
    singular: 'Szolgáltatás-sorok',
    plural: 'Szolgáltatás-szekciók',
  },
  admin: {
    group: 'Kezdőlap (ajánlott sorrendben)',
  },
  fields: [
    {
      name: 'eyebrow',
      type: 'text',
      label: 'Kis felső felirat',
      admin: {
        description: 'A cím fölötti apró szöveg (pl. „Szolgáltatásaink"). Nem kötelező.',
      },
    },
    {
      name: 'title',
      type: 'text',
      label: 'Szekció címe',
      admin: {
        description: 'A szekció nagybetűs címe (pl. „Így tudunk segíteni").',
      },
    },
    {
      name: 'lead',
      type: 'textarea',
      label: 'Bevezető',
      admin: {
        description:
          'A cím alatti, mindig látható bekezdés. Sín-elrendezésnél ide kerül a három út rövid magyarázata. Nem kötelező.',
      },
    },
    {
      name: 'elrendezes',
      type: 'select',
      defaultValue: 'tabla',
      label: 'Elrendezés',
      options: [
        { label: 'Tábla (kép + számozott sorok)', value: 'tabla' },
        { label: 'Sín és panel (három szolgáltatás-ajtó)', value: 'sin' },
      ],
      admin: {
        description:
          'A tábla a szolgáltatások oldalé. A sín a kezdőlapé: bal oldalon ajtóválasztó, jobb oldalon a kiválasztott szöveg és fotó. Új blokknál a tábla az alap.',
      },
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
      label: 'Kép',
      admin: {
        description:
          'A tábla sorai mellé kerülő kép (pl. terapeuta keze munka közben). Sín-elrendezésnél nem jelenik meg. Nem kötelező.',
      },
    },
    {
      name: 'rows',
      type: 'array',
      label: 'Sorok',
      minRows: 1,
      maxRows: 5,
      labels: { singular: 'Sor', plural: 'Sorok' },
      admin: {
        description:
          'Táblánál egy sor = egy szolgáltatás. Sínnél egy sor = egy ajtó (Rendelői kezelések, Otthoni program, Szakmai képzések). Legfeljebb 5.',
        initCollapsed: true,
      },
      fields: [
        {
          name: 'number',
          type: 'text',
          label: 'Sorszám',
          admin: {
            description:
              'Nem kötelező. Pl. „01" vagy „1". Ha üresen hagyod, a rendszer maga számoz.',
          },
        },
        {
          name: 'title',
          type: 'text',
          required: true,
          label: 'Cím',
          admin: {
            description:
              'A szolgáltatás-ajtó neve (pl. „Rendelői kezelések", „Otthoni program").',
          },
        },
        {
          name: 'osszefoglalo',
          type: 'text',
          label: 'Rövid összegzés',
          admin: {
            description:
              'Sín-elrendezésnél a sín rövid másodlagos sora és a panel félkövér bevezetője (pl. „Személyes kezelés a stúdióban."). Táblánál nem jelenik meg. Nem kötelező.',
          },
        },
        {
          name: 'body',
          type: 'textarea',
          required: true,
          label: 'Szöveg',
          admin: { description: '2–4 mondat arról, kinek és miben segít.' },
        },
        {
          name: 'photo',
          type: 'upload',
          relationTo: 'media',
          label: 'Panel fotója',
          admin: {
            description:
              'Sín-elrendezésnél a jobb oldali kép. Arckép csak a tulajdonos által kijelölt fotóból; üresen a felület helyőrzőt mutat, nem talál ki arcot. Táblánál nem jelenik meg.',
          },
        },
        // A MEZŐSÚGÓ MAGA TANÍTOTTA A TILTOTT ALAKOT (2026-08-18-i javítás).
        // A korábbi példa szó szerint „Tovább a kezelésekre" volt — vagyis a
        // szerkesztő pontosan azt a puszta „Tovább…" kezdést kapta mintául,
        // amit a `docs/ui-sztenderdek.md` §3.1.4 M-7 tilt. A súgó ezért most
        // az igével kezdődő, célt megnevező alakot mutatja:
        // GOV.UK, Add links — „If your link takes the user to a page where they
        // can start a task, start your link with a verb", és „make it
        // descriptive and avoid generic text like 'click here' or 'more'".
        // https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/add-links/
        ...linkFields({
          labelDescription:
            'A sor végi hivatkozás szövege. Igével kezdd, és nevezd meg a célt (pl. „Nézd meg a kezeléseket"). A puszta „Tovább…" nem mondja meg, mi történik, ezért nem használható.',
        }),
      ],
    },
    sectionSettings(),
  ],
}
