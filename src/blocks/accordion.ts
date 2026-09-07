import type { Block } from 'payload'

import { sectionSettings } from './section-settings'

/**
 * Nyitható-csukható szekció (harmonika) — hosszú, MÁSODLAGOS tartalomhoz.
 * MIÉRT NEM A `faq` BLOKK: abból FAQPage strukturált adat készül. Egy
 * MIÉRT NEM A `teamMembers` CV-listája: az a SZEMÉLYHEZ kötött, soronként egy
 */
export const accordion: Block = {
  slug: 'accordion',
  interfaceName: 'BlockAccordion',
  labels: {
    singular: 'Nyitható szekció',
    plural: 'Nyitható szekciók',
  },
  admin: {
    // A blokk nem kötődik kezdőlapi pozícióhoz (elsősorban belső oldalak hosszú
    // referencia-tartalmához való), ezért a meglévő „bárhol" csoportba kerül —
    // új admin-csoportot szándékosan nem vezetünk be.
    group: 'Bárhol használható',
  },
  fields: [
    {
      name: 'eyebrow',
      type: 'text',
      label: 'Kis felső felirat',
      admin: {
        description: 'A cím fölötti apró szöveg (pl. „Szakmai háttér"). Nem kötelező.',
      },
    },
    {
      name: 'title',
      type: 'text',
      label: 'Szekció címe',
      admin: {
        description: 'A nyitható sorok fölötti cím (pl. „Részletes szakmai háttér").',
      },
    },
    {
      name: 'lead',
      type: 'textarea',
      label: 'Bevezető szöveg',
      admin: {
        description:
          'Egy-két mondat a nyitható sorok fölé — ez MINDIG látszik. Ide írd azt, amit senki nem hagyhat ki; a lenyitott részbe csak olyasmi kerüljön, ami elolvasás nélkül is érthetővé teszi az oldalt.',
      },
    },
    {
      name: 'items',
      type: 'array',
      label: 'Nyitható sorok',
      minRows: 1,
      maxRows: 20,
      labels: { singular: 'Nyitható sor', plural: 'Nyitható sorok' },
      admin: {
        description:
          'Minden sor alapból ZÁRVA jelenik meg, a látogató kattintásra nyitja ki. Ezért ide csak MÁSODLAGOS, hosszú olvasnivaló való (pl. szakmai önéletrajz, médiamegjelenések). Árat, kedvezményt, garanciát és a fő gombot SOHA ne rejtsd lenyitó mögé — amit elrejtesz, azt sokan sosem olvassák el.',
        initCollapsed: true,
      },
      fields: [
        {
          // Tulajdonosi kérés (A05, 2026-09-07): „ahol a nevünk szerepel, ott
          // mindenhol legyen mellette kép is". A portré CSUKOTT állapotban is
          // látszik a sor elején, kicsi, kör alakú; lenyitva a tartalom nem
          // ismétli. Az arc a bizalmi jelzés része (NN/g, „Photos as Web
          // Content": a valódi emberekről készült fotót az olvasó megnézi, a
          // díszítő stockot átugorja —
          // https://www.nngroup.com/articles/photos-as-web-content/).
          // Az alt a Médiatárból jön (WCAG 2.2 SC 1.1.1, egy kép — egy leírás).
          name: 'kep',
          type: 'upload',
          relationTo: 'media',
          label: 'Kis portré a sor elején',
          admin: {
            description:
              'Nem kötelező. Akkor érdemes, ha a sor EGY személyről szól (pl. szakmai önéletrajz): a kép csukott állapotban is a név mellett áll, kicsi körben. Témához, listához (pl. „Médiamegjelenések") ne tegyél képet — üresen hagyva a sor kép nélkül jelenik meg. A képleírást (alt) a Képek közt add meg egyszer, ide nem kell újra.',
          },
        },
        {
          name: 'cim',
          type: 'text',
          required: true,
          label: 'A sor címe',
          admin: {
            description:
              'Ez látszik csukott állapotban, erre kattint a látogató (pl. „Kocsis Kata szakmai önéletrajza").',
          },
        },
        {
          name: 'osszefoglalo',
          type: 'text',
          label: 'Rövid kivonat a cím mellé',
          admin: {
            description:
              'Nem kötelező, de érdemes: csukott állapotban is megmutatja, mennyi és milyen tartalom van a sor mögött (pl. „31 tanfolyam · 8 konferencia"). Egy sornyi legyen.',
          },
        },
        {
          name: 'tartalom',
          type: 'richText',
          required: true,
          label: 'A sor tartalma',
          admin: {
            description:
              'A lenyitáskor megjelenő szöveg. A felső eszköztárral formázhatsz, alcímet, felsorolást és linket is beszúrhatsz.',
          },
        },
      ],
    },
    sectionSettings(),
  ],
}
