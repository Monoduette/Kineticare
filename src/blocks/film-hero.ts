import type { Block, Field } from 'payload'

import {
  FILM_CAPTION_BODY_MAX,
  FILM_CAPTION_TITLE_MAX,
  validateFilmCaptionBody,
  validateFilmCaptionTitle,
} from '../lib/film-captions'
import { linkFields } from './link-fields'
import { sectionSettings } from './section-settings'

/**
 * Nyitó videó (kéznyitás): a kezdőlap nyitó szekciója (terv 2. blokk-katalógus, M1).
 *
 * A görgetéssel vezérelt kéznyitás-film (ScrollScrub) fölé kerülő szöveg. A
 * filmet MAGÁT nem itt lehet cserélni: a videó- és poszter-fájlok statikus
 * assetek (terv 3.3), cseréjük fejlesztői feladat. Itt a cím, a bevezető, a
 * címkék, a gombok és a görgetés közben beúszó két felirat szerkeszthető.
 *
 * Háttér-választó szándékosan NINCS rajta: a szekció teljes szélességű filmsáv,
 * saját vizuális kezeléssel.
 *
 * A BEÚSZÓ FELIRATOK (backlog K23, R1 §2): a tulajdonos kérésére
 * (2026-09-22) a videón beúszó két felirat is CMS-mező. A beépített szöveg, a
 * 60/120 karakteres korlát és a validátor egyetlen forrása a
 * src/lib/film-captions.ts; üres mezőnél a beépített szöveg látszik.
 * Szándékosan nincs rajtuk beépített maxLength, required és defaultValue.
 * A required és a defaultValue sémát változtatna (NOT NULL, DB-alapérték).
 * A maxLength a Payload core „validation:shorterThanMax” üzenetét adná
 * (@payloadcms/translations, hu.js). Ez magyar, de személytelen, nem tegező,
 * és a tényleges hosszt nem mondja meg. Azt írja, hogy az értéknek
 * „rövidebbnek kell lennie, mint a maximálisan megengedett” hossz, pedig a
 * korlátnyi hossz is elfogadott (a feltétel `length > maxLength`). Ráadásul
 * UTF-16 egységben számol (payload/dist/fields/validations.js,
 * `stringValue?.length`), így egy emoji 2 karakternek számítana, és az
 * eredmény eltérne az élő számlálótól és a saját validátortól, amelyek a
 * levágott, NFC-normalizált szöveg kódpontjait számolják. A felirat
 * szerkeszthetőségét a GOV.UK Character count mintájú élő számláló segíti
 * (src/components/admin/KarakterSzamlalo.tsx).
 *
 * A MEZŐLEÍRÁSOK ÁLLÍTÁSA A SOROK SZÁMÁRÓL a mérés szerint (4200 természetes
 * magyar minta, a korlátig szóhatáron vágva, lásd src/lib/film-captions.ts):
 * - a cím leírása céltagmondat („hogy telefonon is elférjen két sorban”): a
 *   korlát célját mondja, és ezt a mérés alátámasztja, 390×844-en a minták
 *   0%-a, 320×568-on 2,17%-a háromsoros;
 * - a leírásé a jellemző esetet mondja („általában elfér három sorban”), nem
 *   tényt: 320×568-on a minták 6,74%-a négysoros, ez nem elhanyagolható
 *   (390×844-en 0,05%). A korábbi „ez telefonon három sor” ennek ellentmondott.
 *
 * A „Beúszó szövegek a videón” csoport a gombok UTÁN és a blokk alján álló
 * „Megjelenés és elrejtés” rész (sectionSettings, section-settings.ts) ELŐTT
 * áll: a szerkesztő a lapon látott sorrendben halad (cím, bevezető, címkék,
 * gombok, majd a görgetés közbeni feliratok).
 */

const KARAKTER_SZAMLALO = '/components/admin/KarakterSzamlalo#KarakterSzamlalo'

/** Élő karakterszámláló a mező alatt, a mező korlátjával. */
function karakterSzamlalo(max: number) {
  return { afterInput: [{ path: KARAKTER_SZAMLALO, clientProps: { max } }] }
}

function feliratCim(name: string, label: string): Field {
  return {
    name,
    type: 'text',
    label,
    validate: (value: unknown) => validateFilmCaptionTitle(value),
    admin: {
      description: `Egy rövid, erős mondat. Legfeljebb ${FILM_CAPTION_TITLE_MAX} karakter, hogy telefonon is elférjen két sorban.`,
      components: karakterSzamlalo(FILM_CAPTION_TITLE_MAX),
    },
  }
}

function feliratLeiras(name: string, label: string, description: string): Field {
  return {
    name,
    type: 'textarea',
    label,
    validate: (value: unknown) => validateFilmCaptionBody(value),
    admin: {
      description,
      rows: 3,
      components: karakterSzamlalo(FILM_CAPTION_BODY_MAX),
    },
  }
}

/**
 * A blokk elején álló rövid tájékoztató (UI-mező, adatbázis-oszlop nélkül).
 * Megmondja, mi szerkeszthető itt, és mi NEM: a videó és az állóképe
 * fejlesztői feladat. Források (megnyitva, 2026-09-22):
 * - ATAG 2.0 A.4.2.2 Document All Features, (b) „Described in the
 *   Interface: Use of the feature is explained in the authoring tool user
 *   interface” (https://www.w3.org/TR/ATAG20/#sc_a422);
 * - NN/g, 10 Usability Heuristics, #1: „The design should always keep users
 *   informed about what is going on”, és #10 Help and Documentation
 *   (https://www.nngroup.com/articles/ten-usability-heuristics/). A Payload
 * saját FieldDescription-komponense rajzolja, így a többi mezőleírással
 * azonos betűt és (a B1 témarétege szerint) AA-kontrasztot kap.
 */
const videoSzovegTajekoztato: Field = {
  name: 'videoSzovegekTajekoztato',
  type: 'ui',
  admin: {
    components: {
      Field: {
        path: '@payloadcms/ui#FieldDescription',
        clientProps: {
          description:
            'Itt írod a videón látható összes szöveget: a fő címet, a bevezetőt, a címkéket, a gombokat és a görgetés közben beúszó két feliratot. Magát a videót és az állóképét itt nem tudod cserélni, ahhoz szólj a fejlesztőnek.',
          marginPlacement: 'bottom',
        },
      },
    },
  },
}

export const filmHero: Block = {
  slug: 'filmHero',
  interfaceName: 'BlockFilmHero',
  labels: {
    singular: 'Nyitó videó (kéznyitás)',
    plural: 'Nyitó videó szekciók',
  },
  admin: {
    group: 'Kezdőlap (ajánlott sorrendben)',
  },
  fields: [
    videoSzovegTajekoztato,
    {
      name: 'title',
      type: 'text',
      required: true,
      label: 'Fő cím',
      admin: {
        description:
          'A lap legfontosabb mondata, ez a legnagyobb betűs szöveg az oldal tetején. Egy tömör állítás működik a legjobban.',
      },
    },
    {
      name: 'lead',
      type: 'textarea',
      label: 'Bevezető szöveg',
      admin: {
        description: 'A cím alatti 1–3 mondat: kinek és miben segít a Kineticare.',
      },
    },
    {
      name: 'tags',
      type: 'array',
      label: 'Címkék',
      maxRows: 6,
      labels: { singular: 'Címke', plural: 'Címkék' },
      admin: {
        description:
          'Rövid szavak a fő cím alatt, amik megmutatják, mivel foglalkozunk (pl. Kéz, Csukló, Könyök, Váll). Nem kötelező.',
        initCollapsed: true,
      },
      fields: [
        {
          name: 'label',
          type: 'text',
          required: true,
          label: 'Címke szövege',
          admin: { description: 'Egy-két szó, pl. „Csukló”.' },
        },
      ],
    },
    {
      name: 'ctas',
      type: 'array',
      label: 'Gombok',
      maxRows: 2,
      labels: { singular: 'Gomb', plural: 'Gombok' },
      admin: {
        description:
          'Legfeljebb 2 gomb. Az első a hangsúlyos (ez vigyen a kurzusokhoz), a második visszafogottabb. Ha üresen hagyod, nem jelenik meg gomb.',
        initCollapsed: true,
      },
      fields: linkFields({ labelRequired: true, urlRequired: true }),
    },
    {
      name: 'captions',
      type: 'group',
      label: 'Beúszó szövegek a videón',
      admin: {
        description:
          'Görgetés közben két rövid szöveg úszik be a videó fölé: az egyik a videó közepén jobb oldalt, a másik a végén középen. Ha egy mezőt üresen hagysz, ott a beépített alapszöveg jelenik meg, így a kezdőlap sosem marad szöveg nélkül.',
      },
      fields: [
        feliratCim('midTitle', 'A videó közepén: cím'),
        feliratLeiras(
          'midBody',
          'A videó közepén: leírás',
          `Egy-két rövid mondat a cím alatt. Legfeljebb ${FILM_CAPTION_BODY_MAX} karakter, ennyi telefonon általában elfér három sorban.`,
        ),
        feliratCim('endTitle', 'A videó végén: cím'),
        feliratLeiras(
          'endBody',
          'A videó végén: leírás',
          `Ez marad kint a videó végéig. Akkor látszik, amikor az ingyenes SOS-kurzus kint van az oldalon, ezért hivatkozhatsz rá. Legfeljebb ${FILM_CAPTION_BODY_MAX} karakter.`,
        ),
        {
          type: 'collapsible',
          label: 'Ha nincs ingyenes kurzus (ritkán kell)',
          admin: { initCollapsed: true },
          fields: [
            feliratLeiras(
              'endBodyWithoutFreeSos',
              'A videó végén: leírás ingyenes kurzus nélkül',
              `Ez áll a fenti helyett, amíg az ingyenes SOS-kurzus nincs kint az oldalon. Ne ígérj benne ingyenes gyakorlatot. Legfeljebb ${FILM_CAPTION_BODY_MAX} karakter.`,
            ),
          ],
        },
      ],
    },
    sectionSettings({ background: false }),
  ],
}
