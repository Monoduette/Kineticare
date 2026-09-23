import type { Block, TextareaFieldValidation, TextFieldSingleValidation } from 'payload'
import { text as alapSzovegValidalas, textarea as alapTobbsorosValidalas } from 'payload/shared'

import { sectionSettings } from './section-settings'

/**
 * Az üresen hagyott GYIK-sor teendője (K20, 2026-09-22).
 *
 * Mért kiinduló hiba (admin-audit, seta/t7err.json): a „Kérdés hozzáadása”
 * után kitöltés nélkül elhagyott sor piszkozatba kerül, és a következő
 * közzétételt a Payload alapüzenete („Ez a mező kötelező.”) és egy hétsoros
 * belső útvonal-lista tiltja, teendő nélkül. A mező melletti üzenet ezért
 * megmondja, mit tegyen a szerkesztő, és a törlés útját a felület TÉNYLEGES
 * magyar neveivel adja: a sor fejlécének jobb szélén álló, három pontot
 * mutató menügomb (⋯, @payloadcms/ui ArrayAction, MoreIcon), benne a
 * `general:remove` kulcs magyar szövege, „Törlés”
 * (@payloadcms/translations/dist/languages/hu.js; a src/lib/admin/hu-forditas.ts
 * nem írja felül).
 *
 * Források: GOV.UK Design System, Error message: „use an instruction for empty
 * fields like 'Enter your name'” és „Describe what has happened and tell them
 * how to fix it” (https://design-system.service.gov.uk/components/error-message/);
 * NN/g, Error-Message Guidelines: „Display the error message close to the
 * error's source” és „offer some potential remedies”
 * (https://www.nngroup.com/articles/error-message-guidelines/).
 */
const SOR_TORLESE = 'a sor jobb szélén a ⋯ gomb, majd Törlés'

/** A kérdés üresen hagyott sorának üzenete. */
export const FAQ_KERDES_HIANYZIK = `Írd be a kérdést, vagy töröld ezt a sort: ${SOR_TORLESE}.`

/** A válasz üresen hagyott sorának üzenete. */
export const FAQ_VALASZ_HIANYZIK = `Írd be a választ, vagy töröld ezt a sort: ${SOR_TORLESE}.`

/** Üres-e a mező: hiányzó érték, üres szöveg vagy csak szóköz. */
function uresSzoveg(value: unknown): boolean {
  return typeof value !== 'string' || value.trim().length === 0
}

/**
 * A kérdés ellenőrzése. A saját `validate` a Payload beépítettjét lecseréli
 * (payload/dist/fields/config/sanitize.js), ezért üres sor után a Payload
 * alap szöveg-validátorát hívjuk tovább: a hossz-korlát (maxLength,
 * defaultMaxTextLength) és a többi alapszabály így megmarad. A szóköz-only
 * érték a beépített kötelező-ellenőrzésen átmenne, itt nem megy át.
 */
export const validateFaqQuestion: TextFieldSingleValidation = (value, options) =>
  uresSzoveg(value) ? FAQ_KERDES_HIANYZIK : alapSzovegValidalas(value, options)

/** A válasz ellenőrzése, ugyanazzal a mintával (Payload alap textarea-validátor). */
export const validateFaqAnswer: TextareaFieldValidation = (value, options) =>
  uresSzoveg(value) ? FAQ_VALASZ_HIANYZIK : alapTobbsorosValidalas(value, options)

/**
 * GYIK — gyakori kérdések (terv 2. blokk-katalógus, M8).
 *
 * A vásárlás előtti ellenérvek kezelése a lap alján. A Google felé menő
 * strukturált adat (FAQPage JSON-LD) UGYANEBBŐL a listából készül (terv 5.
 * pont), ezért:
 *  - a kérdés és a válasz SIMA SZÖVEG (nincs formázás, nincs link-beszúrás),
 *  - a látható szöveg és a strukturált adat így sosem tud szétcsúszni.
 *
 * Tartalmi óvatosság: műtét utáni helyzetben mindig a kezelőorvos/gyógytornász
 * jóváhagyása az irányadó — gyógyulási ígéretet a válaszok ne tegyenek.
 */
export const faq: Block = {
  slug: 'faq',
  interfaceName: 'BlockFaq',
  labels: {
    singular: 'GYIK (gyakori kérdések)',
    plural: 'GYIK szekciók',
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
        description: 'A kérdések fölötti cím (pl. „Gyakori kérdések”).',
      },
    },
    {
      name: 'items',
      type: 'array',
      label: 'Kérdés–válasz párok',
      minRows: 1,
      maxRows: 20,
      labels: { singular: 'Kérdés', plural: 'Kérdések' },
      admin: {
        description:
          'A látogatók tényleges kérdései, a válasszal együtt. Ezekből készül a Google-nek szóló strukturált adat is, ezért ide csak sima szöveg kerüljön, formázás és link nélkül.',
        initCollapsed: true,
      },
      fields: [
        {
          name: 'question',
          type: 'text',
          required: true,
          label: 'Kérdés',
          admin: {
            description:
              'Úgy fogalmazd, ahogy a látogató kérdezné (pl. „Műtét után is végezhetem a gyakorlatokat?”).',
          },
          validate: validateFaqQuestion,
        },
        {
          name: 'answer',
          type: 'textarea',
          required: true,
          label: 'Válasz',
          admin: {
            description:
              'Rövid, egyértelmű válasz 2–4 mondatban. Gyógyulást ne ígérj; műtét utáni kérdésnél utalj a kezelőorvos jóváhagyására.',
          },
          validate: validateFaqAnswer,
        },
      ],
    },
    sectionSettings(),
  ],
}
