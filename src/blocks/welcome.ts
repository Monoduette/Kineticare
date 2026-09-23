import type { Block } from 'payload'

import { sectionSettings } from './section-settings'

/**
 * Üdvözlő / probléma-blokk (terv 2. blokk-katalógus).
 *
 * A látogató problémájának visszatükrözése: cím + felvezető, alatta bal
 * oldalon a „Tudjuk, milyen, amikor…" felsorolás, jobb oldalon 1–2 összefoglaló
 * bekezdés. Ez a szekció adja a hero utáni első érzelmi kapaszkodót.
 */
export const welcome: Block = {
  slug: 'welcome',
  interfaceName: 'BlockWelcome',
  labels: {
    singular: 'Üdvözlés és gondok',
    plural: 'Üdvözlő szekciók',
  },
  admin: {
    group: 'Kezdőlap (ajánlott sorrendben)',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      label: 'Cím',
      admin: {
        description:
          'A szekció címe, jellemzően kérdés, ami a látogató helyzetét mondja ki (pl. „Szeretnél megszabadulni a fájdalomtól…?”).',
      },
    },
    {
      name: 'lead',
      type: 'text',
      label: 'Bevezető mondat',
      admin: {
        description: 'Rövid átvezetés a felsorolás elé (pl. „Tudjuk, milyen, amikor:”).',
      },
    },
    {
      name: 'checklist',
      type: 'array',
      label: 'Felsorolás',
      maxRows: 8,
      labels: { singular: 'Felsorolás-tétel', plural: 'Felsorolás-tételek' },
      admin: {
        description:
          'A látogató ismerős helyzetei, egy-egy mondatban. 3–5 tétel a legjobb, ennél több már hosszú lista.',
        initCollapsed: true,
      },
      fields: [
        {
          name: 'text',
          type: 'textarea',
          required: true,
          label: 'Szöveg',
        },
      ],
    },
    {
      name: 'sideParagraphs',
      type: 'array',
      label: 'Oldalsó bekezdések',
      maxRows: 4,
      labels: { singular: 'Bekezdés', plural: 'Bekezdések' },
      admin: {
        description:
          'A felsorolás mellé kerülő szöveg: mit tudunk kezdeni ezzel a helyzettel. A lezáró, ígéretet megfogalmazó bekezdésnél kapcsold be a „Kiemelt” pipát.',
        initCollapsed: true,
      },
      fields: [
        {
          name: 'text',
          type: 'textarea',
          required: true,
          label: 'Szöveg',
        },
        {
          name: 'emphasized',
          type: 'checkbox',
          defaultValue: false,
          label: 'Kiemelt (félkövér)',
          admin: {
            description:
              'Vastag betűvel jelenik meg. Egy szekcióban legfeljebb egy bekezdésnél használd.',
          },
        },
      ],
    },
    sectionSettings(),
  ],
}
