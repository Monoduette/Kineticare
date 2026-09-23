import type { Block } from 'payload'

import { KEP_CSERE_SUGO } from './kep-csere'
import { linkFields } from './link-fields'
import { sectionSettings } from './section-settings'

/**
 * Képes lista vagy kártyák (slug: services, korábbi neve
 * „Szolgáltatás-sorok”): tábla (kép + számozott sorok) vagy sín + panel.
 *
 * A név a blokk FORMÁJÁT mondja, nem egy konkrét szekció címét: élőben ez a
 * típus adja a kezdőlap „Így tudunk segíteni” és „Erre számíthatsz velünk”,
 * a /rolunk „Amiben mások vagyunk” és a /szolgaltatasok „Ezért fogod imádni”
 * szekcióját is (modul-térkép, live-pages.json). A régi „Szolgáltatás-sorok”
 * és az usps blokk „„Erre számíthatsz” kártyák” neve ezért rossz típusra
 * vitte azt, aki a látott címet kereste. A sorcímke (B2) a név mellé a
 * szekció saját címét is kiírja.
 *
 * A mező-feltételek, az elrendezés opciói és a hatásosságot állító leírások
 * (sín/tábla) a K29-hez tartoznak, és a zárolt Services.tsx fotós munkájára
 * várnak (FŐ VEZETŐ); itt csak a név, a feliratok, a tipográfia és a képmezők
 * közös súgója (K36) változott.
 *
 * A `/szolgaltatasok` tábla marad. A kezdőlap „Így tudunk segíteni" szekciója
 * sín-elrendezés: Rendelői kezelések / Otthoni program / Szakmai képzések,
 * jobb oldalon szöveg + fotó.
 */
export const services: Block = {
  slug: 'services',
  interfaceName: 'BlockServices',
  labels: {
    singular: 'Képes lista vagy kártyák',
    plural: 'Képes listák és kártyák',
  },
  admin: {
    group: 'Kezdőlap (ajánlott sorrendben)',
  },
  fields: [
    {
      name: 'eyebrow',
      type: 'text',
      label: 'Felső kis felirat',
      admin: {
        description: 'A cím fölötti apró szöveg (pl. „Szolgáltatásaink”). Nem kötelező.',
      },
    },
    {
      name: 'title',
      type: 'text',
      label: 'Szekció címe',
      admin: {
        description: 'A szekció nagybetűs címe (pl. „Így tudunk segíteni”).',
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
        description: `A tábla sorai mellé kerülő kép (pl. terapeuta keze munka közben). Sín-elrendezésnél nem jelenik meg. Nem kötelező. ${KEP_CSERE_SUGO}`,
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
              'Nem kötelező. Pl. „01” vagy „1”. Ha üresen hagyod, a rendszer maga számoz.',
          },
        },
        {
          name: 'title',
          type: 'text',
          required: true,
          label: 'Cím',
          admin: {
            description: 'A szolgáltatás-ajtó neve (pl. „Rendelői kezelések”, „Otthoni program”).',
          },
        },
        {
          name: 'osszefoglalo',
          type: 'text',
          label: 'Rövid összegzés',
          admin: {
            description:
              'Sín-elrendezésnél a sín rövid másodlagos sora és a panel félkövér bevezetője (pl. „Személyes kezelés a stúdióban.”). Táblánál nem jelenik meg. Nem kötelező.',
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
            description: `Sín-elrendezésnél a jobb oldali kép. Arckép csak a tulajdonos által kijelölt fotóból; üresen a felület helyőrzőt mutat, nem talál ki arcot. Táblánál nem jelenik meg. ${KEP_CSERE_SUGO}`,
          },
        },
        // A felirat-súgó története (K27). 2026-08-18-ig a súgó példája a
        // „Tovább a kezelésekre” volt; akkor igés, célt megnevező példára
        // cserélték, és a súgó minden „Tovább…” kezdést tiltottnak mondott.
        // Ez túllőtt: a docs/ui-sztenderdek.md §3.1.4 M-7 csak a PUSZTA, célt
        // nem nevező „Tovább” szót tiltja, a rendelői ajtó élő „Tovább a
        // kezelésekre” feliratát pedig a tulajdonos jóváhagyta
        // (src/lib/home-help-states.ts fejkommentje, §3.2 #40). A súgó ezért
        // mindkét elfogadott alakot mutatja, és csak az önmagában álló
        // „Tovább” szót zárja ki. Források: GOV.UK, Add links: „make it
        // descriptive and avoid generic text like 'click here' or 'more'”
        // (https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/add-links/);
        // NN/g, Better Link Labels: „A link's primary purpose is to communicate
        // to users what they'll find on the other side of a click.”
        // (https://www.nngroup.com/articles/better-link-labels/).
        ...linkFields({
          labelDescription:
            'A sor végi hivatkozás szövege. Nevezd meg, hova visz (pl. „Tovább a kezelésekre” vagy „Nézd meg a kezeléseket”). Az önmagában álló „Tovább” nem mondja meg, mi történik.',
        }),
      ],
    },
    sectionSettings(),
  ],
}
