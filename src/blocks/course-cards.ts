import type { Block } from 'payload'

import { COURSE_SHOWCASE_MARK } from '../lib/course-showcase'
import { KEP_CSERE_SUGO } from './kep-csere'
import { sectionSettings } from './section-settings'

/**
 * A „Háttérfelirat” (a „Kurzusaink” vízjel) mért karakter-korlátja (H22).
 *
 * MÉRÉS (2026-09-23, Chromium 141 headless, playwright-core; a repó valódi
 * tokens.css, fonts.css, base.css, ui.css és course-showcase.css fájljával,
 * Tenor Sans 400 betöltve, `document.fonts.check` igaz). A vízjel a
 * `.kc-course-showcase__word`: L token (`--kc-font-l`, 32–40 px) egy sorban,
 * `transform: scale(--kc-showcase-mark-scale)`, a színpad `overflow: clip`.
 * Túlfutás = a szó skálázott szélessége nagyobb a színpadnál (ekkor a széle
 * levágódik); csonkulás = a skálázatlan szó is szélesebb (ellipszis). Mért
 * színpad-szélesség és skála:
 *   320 px: 272 px, ×1,5 · 768 px: 720 px, ×2,8 · 1440 px: 1072 px, ×4,6;
 *   a skála-lépcsők eleje a legszorosabb: 390 px: 342 px, ×1,8 ·
 *   600 px: 552 px, ×2,8 · 900 px: 852 px, ×4 · 1100 px: 1052 px, ×4,6.
 * A skálázott szó a színpad hány százaléka (320 / 768 / 1440 px, a
 * legrosszabb lépcső zárójelben):
 *   „Kurzusaink” (10): 92 / 71 / 89 % (90 %) · „Képzéseink” (10): 96 / 75 / 94 %
 *   „Gyógytorna” (10): 98 / 76 / 95 % · „Kézterápia” (10): 90 / 70 / 88 %
 *   „Módszerünk” (10): 104 / 80 / 101 % (túlfut) · „Szakkönyv” (9): 87 / 68 / 85 %
 *   „Tanfolyamok” (11): 105 / 81 / 102 % (túlfut) · „Programjaink” (12): 110 %
 *   „KURZUSOK” (8, csupa nagybetű): 101 / 79 / 99 % (320-on túlfut).
 * Vegyes betűs magyar szónál a 10 karakter a legnagyobb hossz, amelyen a
 * beépített szó és a mért szavak többsége minden szélességen elfér; 11
 * karakternél a mért szavak nagyobb része már túlfut. A korlát ezért 10 (a
 * beépített „Kurzusaink” hossza), és a súgó kimondja, hogy csupa nagybetűvel
 * ennyi sem fér el. Vízszintes görgetés egyik esetben sincs (a dokumentum
 * szélessége mérve = a nézetablak, a színpad vág), tehát a WCAG 2.2 SC 1.4.10
 * Reflow teljesül (https://www.w3.org/WAI/WCAG22/Understanding/reflow.html);
 * a korlát azt védi, hogy a dekoratív szó ne veszítse el a szélét. A mérő
 * szkript: scratchpad A1-meres/szavak.mjs.
 *
 * A hibaüzenet utasít és számot mond: GOV.UK Design System, Character count:
 * „Only use the character count component when there is a good reason for
 * limiting the number of characters users can enter.” (itt a jó ok a mért
 * hely)
 * (https://design-system.service.gov.uk/components/character-count/); NN/g,
 * Error-Message Guidelines: „offer some potential remedies”
 * (https://www.nngroup.com/articles/error-message-guidelines/).
 */
export const HATTERFELIRAT_MAX_HOSSZ = 10

/** A Háttérfelirat ellenőrzése: üresen jó (a beépített szó marad), fölötte magyar hiba. */
export const validateHatterFelirat = (value: unknown): string | true => {
  if (typeof value !== 'string') {
    return true
  }
  if ([...value.trim()].length > HATTERFELIRAT_MAX_HOSSZ) {
    return `Legfeljebb ${HATTERFELIRAT_MAX_HOSSZ} karakter fér el a háttérben.`
  }
  return true
}

/**
 * A „Kurzusaink” jelenet három helye és az üres helyen álló beépített fotó
 * (src/lib/course-showcase.ts, COURSE_SHOWCASE_SCENE_PHOTOS, ugyanebben a
 * sorrendben; az egyezést a src/__tests__/kep-helyek.test.tsx őrzi).
 */
export const KURZUSAINK_KEPHELYEK: readonly { nev: string; mezo: string; beepitett: string }[] = [
  { nev: 'Bal oldali kép', mezo: 'left', beepitett: 'Kiss Kata kis labdán gyakorol a tenyerével.' },
  {
    nev: 'Középső kép',
    mezo: 'middle',
    beepitett: 'Otthoni gyakorlás labdával és törölközővel.',
  },
  {
    nev: 'Jobb oldali kép',
    mezo: 'right',
    beepitett: 'Kocsis Kata bögrével a fotelben.',
  },
]

/**
 * Kurzuskártyák — a fizetős kurzusok kiemelése (terv 2. blokk-katalógus, M3).
 * ADATVEZÉRELT blokk: a kártyák tartalmát NEM itt írod. A kurzusok igazságforrása
 * a Webshop → Kurzusok: amit ott létrehozol és közzéteszel, az automatikusan
 * megjelenik ebben a szekcióban (ár, borító, rövid leírás, kiemelt előnyök
 * onnan jönnek). Így a kezdőlap sosem tud „elszakadni" a valós kínálattól
 * (terv 2. pont zárása).
 */
export const courseCards: Block = {
  slug: 'courseCards',
  interfaceName: 'BlockCourseCards',
  labels: {
    singular: 'Kurzuskártyák (automatikus)',
    plural: 'Kurzuskártya-szekciók',
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
        description:
          'A cím fölötti rövid, nagybetűs felirat. Nem kötelező: üresen a beépített felirat marad („Kurzusok”).',
      },
    },
    {
      name: 'heading',
      type: 'text',
      label: 'Szekció címe',
      admin: {
        description: 'Nem kötelező. Ha üresen hagyod, a beépített cím marad („Kurzusaink”).',
      },
    },
    {
      name: 'lead',
      type: 'textarea',
      label: 'Bevezető szöveg',
      admin: {
        description: 'A cím alatti 1–2 mondat a kártyák előtt. Nem kötelező.',
      },
    },
    {
      // H22: a vízjel szava. A beépített szót a course-showcase.ts adja, nem
      // másolat: ha ott változik, a súgó vele változik.
      name: 'hatterFelirat',
      type: 'text',
      label: 'Háttérfelirat (a nagy és halvány szó)',
      admin: {
        description: `A kártyák alatti nagy, halvány szó. Egy szó, nagy kezdőbetűvel, legfeljebb ${HATTERFELIRAT_MAX_HOSSZ} karakter; csupa nagybetűvel ennyi sem fér el. Ha üresen hagyod, ez látszik: „${COURSE_SHOWCASE_MARK}”.`,
      },
      validate: (value: string | null | undefined) => validateHatterFelirat(value),
    },
    {
      name: 'ctaLabel',
      type: 'text',
      label: 'Gombfelirat a kártyákon',
      admin: {
        // A súgó a JÓVÁHAGYOTT alakot mutatja (§3.2 #28), nem a régi
        // „Megnézem a programot"-ot: a mezősúgó a szerkesztő mintája, tehát
        // amit itt írunk, azt fogja írni ő is.
        description:
          'A kurzuskártyák alján megjelenő gomb felirata. Nem kötelező: üresen a beépített, jóváhagyott felirat marad („Nyisd meg a kurzusoldalt”). A gomb csak jelzés, maga a kártya a link.',
      },
    },
    {
      // 2026-09-23: a jelenet fotói helyenként cserélhetők (src/lib/kep-helyek.ts).
      name: 'scenePhotos',
      type: 'group',
      label: 'Fotók a „Kurzusaink” felirat alatt (három kép)',
      admin: {
        description: `Díszítő fotók a kártyák alatt. Ha egy mezőt üresen hagysz, ott a beépített fotó marad. A kivágást a kép fókuszpontja adja: a Képek közt arra a pontra állítsd, aminek mindig látszania kell. ${KEP_CSERE_SUGO}`,
      },
      fields: KURZUSAINK_KEPHELYEK.map((hely) => ({
        name: hely.mezo,
        type: 'upload' as const,
        relationTo: 'media' as const,
        label: hely.nev,
        admin: {
          description: `Ha üresen hagyod, a beépített fotó látszik: ${hely.beepitett}`,
        },
      })),
    },
    sectionSettings(),
  ],
}
