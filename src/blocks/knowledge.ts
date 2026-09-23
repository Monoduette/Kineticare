import type { Block } from 'payload'

import { sectionSettings } from './section-settings'

/**
 * Tudástár-ajánló — a legfrissebb blogbejegyzések (terv 2. blokk-katalógus, M7).
 *
 * ADATVEZÉRELT blokk: a blogbejegyzéseket a Tartalom → Blogbejegyzések alatt
 * írod, ide a legfrissebb KÖZZÉTETT blogbejegyzések kerülnek ki automatikusan.
 * Itt csak a szekció felirata és a megjelenő darabszám állítható.
 *
 * Tudástár-kapcsoló (src/lib/tudastar-kapcsolo.ts): ha a /blog menüpont
 * rejtett, a route üres posztlistát ad át, és a szekció nem jelenik meg. A
 * mezőleírás ezt kimondja, hogy a szerkesztő ne hibát keressen, UGYANAZOKKAL a
 * szavakkal, mint a Menüpontok szerkesztője (a „Webcím” típus, a „Látható” és a
 * „Rejtett link” mező, src/collections/Menus.ts; WCAG 2.2 SC 3.2.4). Csak
 * szöveg: a mezők és a séma változatlanok.
 */
export const knowledge: Block = {
  slug: 'knowledge',
  interfaceName: 'BlockKnowledge',
  labels: {
    singular: 'Tudástár-ajánló (automatikus)',
    plural: 'Tudástár-szekciók',
  },
  admin: {
    group: 'Kezdőlap (ajánlott sorrendben)',
  },
  fields: [
    {
      name: 'heading',
      type: 'text',
      label: 'Szekció címe',
      admin: {
        description:
          'Nem kötelező. Ha üresen hagyod, a beépített cím marad („Legfrissebb a tudástárból”). A kártyák maguktól jönnek a legfrissebb közzétett blogbejegyzésekből. Ha a Tudástár ki van kapcsolva (a Menüpontok között a /blog webcímű menüpontnál nincs pipa a „Látható” mezőben, vagy be van jelölve a „Rejtett link”), ez a szekció nem jelenik meg az oldalon. Visszakapcsolva újra látszik.',
      },
    },
    {
      name: 'limit',
      type: 'number',
      defaultValue: 3,
      min: 1,
      max: 6,
      label: 'Hány blogbejegyzés jelenjen meg',
      admin: {
        description: '1 és 6 közötti szám. A kezdőlapon 3 a szokásos.',
        step: 1,
      },
    },
    sectionSettings(),
  ],
}
