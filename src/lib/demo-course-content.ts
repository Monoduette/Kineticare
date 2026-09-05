import type { Page } from '@/payload-types'

import { ctaLabel } from './cta-vocabulary'
import { logger } from './logger'

export const DEMO_COURSE_TITLE = 'Képzeletbeli akciós kurzus'

export const DEMO_COURSE_EXCERPT =
  'Rendszerezd a kezed mindennapi használatáról szerzett tapasztalataidat.'

export const DEMO_COURSE_HERO_IMAGE = {
  src: '/media/team/hand-treatment-detail-1600.webp',
  alt: 'Kézterápiás helyzet közelről, egy kéz megtámasztásával.',
} as const

type LexicalContent = NonNullable<
  Extract<NonNullable<Page['layout']>[number], { blockType: 'accordion' }>['items']
>[number]['tartalom']

function lexicalParagraphs(...paragraphs: string[]): LexicalContent {
  return {
    root: {
      type: 'root',
      direction: null,
      format: '',
      indent: 0,
      version: 1,
      children: paragraphs.map((text) => ({
        type: 'paragraph',
        direction: null,
        format: '',
        indent: 0,
        version: 1,
        children: [
          {
            type: 'text',
            text,
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
            version: 1,
          },
        ],
      })),
    },
  }
}

/**
 * Szerkeszthető kezdőtartalom a dedikált route seedjéhez. Csak a kampányoldalon
 * engedélyezett, már létező blokkokat használja; nincs termék-, ár- vagy fizetési adat.
 */
export const DEFAULT_DEMO_COURSE_LAYOUT = [
  {
    id: 'demo-minta-lecke',
    blockType: 'accordion',
    eyebrow: 'Mintalecke',
    title: 'Készíts használható megfigyelési jegyzetet',
    lead: 'Egy pontos jegyzet segít elkülöníteni a megfigyelt tényeket a feltételezésektől. Haladj végig a lépéseken, majd foglald össze egy mondatban, amit észrevettél.',
    items: [
      {
        id: 'demo-preview-1',
        cim: '1. Írd le a helyzetet',
        osszefoglalo: 'Mikor és milyen tevékenység közben figyelted meg?',
        tartalom: lexicalParagraphs(
          'Jegyezd fel röviden a napszakot és a tevékenységet. Például: délelőtt, gépelés után; vagy este, egy bevásárlótáska elpakolását követően. Maradj a megfigyelhető tényeknél.',
        ),
      },
      {
        id: 'demo-preview-2',
        cim: '2. Nevezd meg, mit vettél észre',
        osszefoglalo: 'Egy-két pontos mondat többet ér egy általános jelzőnél.',
        tartalom: lexicalParagraphs(
          'Írd le, hol és milyen érzetet tapasztaltál, anélkül hogy következtetést vagy diagnózist állítanál fel. Az is hasznos információ, ha az adott helyzetben nem vettél észre változást.',
        ),
      },
      {
        id: 'demo-preview-3',
        cim: '3. Fogalmazz meg egy kérdést',
        osszefoglalo: 'Mit szeretnél tisztázni egy szakemberrel?',
        tartalom: lexicalParagraphs(
          'A feljegyzés végére írj egy konkrét kérdést. Például: érdemes-e módosítanom ezen a hétköznapi mozdulaton? A döntést és a személyre szabott tanácsot hagyd a megfelelő szakemberre.',
        ),
      },
    ],
    sectionSettings: { visible: true, anchorId: 'minta-lecke', hatter: 'tint' },
  },
  {
    id: 'demo-bevezeto',
    blockType: 'welcome',
    title: 'Neked szól, ha pontosabban szeretnéd követni a hétköznapi helyzeteket',
    lead: 'A tananyag abban segít, hogy rendezett megfigyelésekkel készülj, ha:',
    checklist: [
      {
        id: 'demo-check-1',
        text: 'nehezen idézed fel, mikor és milyen tevékenység közben vettél észre változást',
      },
      { id: 'demo-check-2', text: 'tényszerűbb jegyzeteket szeretnél készíteni' },
      {
        id: 'demo-check-3',
        text: 'konkrét kérdésekkel készülnél egy szakmai konzultációra',
      },
      { id: 'demo-check-4', text: 'rövid, egymásra épülő leckékben tanulnál' },
      { id: 'demo-check-5', text: 'a saját időbeosztásodban szeretnél haladni' },
    ],
    sideParagraphs: [
      {
        id: 'demo-side-1',
        text: 'A rövid leckék végigvezetnek a megfigyelés, a rendszerezés és az összegzés lépésein. Nem kell hozzá egészségügyi előképzettség.',
      },
      {
        id: 'demo-side-2',
        text: 'A tananyag nem diagnosztizál, nem ad gyakorlatprogramot, és nem helyettesíti az orvosi vizsgálatot vagy az egyéni gyógytornászati ellátást.',
        emphasized: true,
      },
    ],
    sectionSettings: { visible: true, anchorId: 'bemutato', hatter: 'feher' },
  },
  {
    id: 'demo-modulok',
    blockType: 'accordion',
    eyebrow: 'Tananyag',
    title: 'Az első jegyzettől a rendezett kérdéslistáig',
    lead: 'A modulok egymásra épülnek, de később külön is visszanéhetők. Mindegyik rövid leckékből áll, majd egy konkrét jegyzetelési lépéssel zárul.',
    items: [
      {
        id: 'demo-module-1',
        cim: '1. modul: Pontos megfigyelés',
        osszefoglalo: 'Helyzet, időpont és megfigyelhető tények',
        tartalom: lexicalParagraphs(
          'Leckék: Mit nevezünk megfigyelésnek? · A helyzet rövid leírása · Tény és feltételezés szétválasztása',
          'Megtanulod röviden rögzíteni, mi történt, mikor történt és mit vettél észre. A modul nem értékeli az egészségi állapotodat.',
        ),
      },
      {
        id: 'demo-module-2',
        cim: '2. modul: Követhető jegyzet',
        osszefoglalo: 'Azonos kérdések minden bejegyzéshez',
        tartalom: lexicalParagraphs(
          'Leckék: Egyszerű jegyzetsablon · Érthető szavak és rövid mondatok · Mi maradjon ki?',
          'Kialakítasz egy könnyen ismételhető szerkezetet, amelyben a bejegyzések később is gyorsan áttekinthetők.',
        ),
      },
      {
        id: 'demo-module-3',
        cim: '3. modul: Hétköznapi kézhasználat',
        osszefoglalo: 'Munka, háztartás, telefon és alkotás',
        tartalom: lexicalParagraphs(
          'Leckék: Gyakori tevékenységek összegyűjtése · Könnyebb és nehezebb helyzetek · Pihenők és váltások feljegyzése',
          'Sorra veszed azokat a hétköznapi helyzeteket, amelyekben sokat használod a kezed. A cél a pontos leírás, nem az okok önálló megállapítása.',
        ),
      },
      {
        id: 'demo-module-4',
        cim: '4. modul: Visszatérő minták',
        osszefoglalo: 'Mi ismétlődik, és mi változik napról napra?',
        tartalom: lexicalParagraphs(
          'Leckék: Bejegyzések időrendben · Visszatérő helyzetek jelölése · Kivételek és változások',
          'Egymás mellé rendezed a jegyzeteidet, és kiemeled a visszatérő helyzeteket. Nem vonsz le klinikai következtetést, hanem előkészíted a tisztázandó kérdéseket.',
        ),
      },
      {
        id: 'demo-module-5',
        cim: '5. modul: Felkészülés a konzultációra',
        osszefoglalo: 'Rövid összegzés és konkrét kérdések',
        tartalom: lexicalParagraphs(
          'Leckék: Mi kerüljön az összefoglalóba? · Kérdések fontossági sorrendben · A napló áttekintése konzultáció előtt',
          'Elkészíted a rövid összegzést és a kérdéslistát, amelyet magaddal vihetsz egy szakmai konzultációra. A végső értékelést és az egyéni tanácsot a megfelelő szakember adja.',
        ),
      },
    ],
    sectionSettings: { visible: true, anchorId: 'modulok', hatter: 'feher' },
  },
  {
    id: 'demo-folyamat',
    blockType: 'howItWorks',
    title: 'Így épül egymásra a tanulás',
    steps: [
      {
        id: 'demo-step-1',
        title: 'Megfigyelsz egy helyzetet',
        text: 'Rögzíted a tevékenységet, az időpontot és azt, amit ténylegesen észrevettél.',
      },
      {
        id: 'demo-step-2',
        title: 'Rendszerezed a jegyzeteidet',
        text: 'Azonos szerkezetben írod le a helyzeteket, így később könnyebben áttekinthetők.',
      },
      {
        id: 'demo-step-3',
        title: 'Kérdéseket fogalmazol meg',
        text: 'Kiválasztod, mit szeretnél egy megfelelő szakemberrel pontosítani.',
      },
    ],
    sectionSettings: { visible: true, anchorId: 'haladas', hatter: 'tint' },
  },
  {
    id: 'demo-gyik',
    blockType: 'faq',
    heading: 'Gyakori kérdések',
    items: [
      {
        id: 'demo-faq-1',
        question: 'Kell hozzá egészségügyi előképzettség?',
        answer:
          'Nem. A fogalmakat közérthetően, hétköznapi példákkal vezetjük be. A cél a pontosabb megfigyelés és jegyzetelés, nem az önálló állapotértékelés.',
      },
      {
        id: 'demo-faq-2',
        question: 'Hogyan haladhatok az anyaggal?',
        answer:
          'Haladhatsz modulonként, a saját időbeosztásod szerint, és közben időt hagyhatsz a jegyzeteid elkészítésére.',
      },
      {
        id: 'demo-faq-3',
        question: 'Tartalmaz elvégezhető kéztorna-gyakorlatokat?',
        answer:
          'Nem. A tananyag a hétköznapi helyzetek megfigyelésére, a jegyzetelésre és a kérdések rendszerezésére összpontosít. Nem ad mozdulatsort vagy terhelési javaslatot.',
      },
      {
        id: 'demo-faq-4',
        question: 'Helyettesíti az orvosi vizsgálatot vagy a gyógytornát?',
        answer:
          'Nem. A napló segíthet felkészülni egy beszélgetésre, de nem ad diagnózist vagy egyéni kezelési tervet. Akut sérülés, romló panasz vagy bizonytalan terhelhetőség esetén kérj személyre szabott szakmai segítséget.',
      },
      {
        id: 'demo-faq-5',
        question: 'Milyen eszköz kell hozzá?',
        answer:
          'A leckék megtekintéséhez internetkapcsolattal rendelkező telefon, táblagép vagy számítógép, a feladatokhoz pedig papír vagy digitális jegyzet szükséges. Egészségügyi vagy kéztornaeszközt a kurzus nem kér.',
      },
      {
        id: 'demo-faq-6',
        question: 'Kapok egyéni visszajelzést vagy tanúsítványt?',
        answer:
          'Nem. Ez önállóan követhető ismeretterjesztő tananyag, nem állapotfelmérés, továbbképzés vagy szakmai minősítés. Egyéni kérdéssel megfelelő szakemberhez fordulj.',
      },
      {
        id: 'demo-faq-7',
        question: 'Hol tehetek fel kérdést?',
        answer:
          'A Kineticare kapcsolati oldalán írhatsz üzenetet. Egészségügyi sürgősség esetén ne az űrlapot használd, hanem kérj azonnali segítséget az illetékes ellátótól.',
      },
    ],
    sectionSettings: { visible: true, anchorId: 'gyik', hatter: 'tint' },
  },
  {
    id: 'demo-zaras',
    blockType: 'ctaBanner',
    title: 'Nézd át a modulok tananyagát',
    text: 'Az első jegyzettől a rendezett kérdéslistáig minden lépést megtalálsz egy helyen.',
    cta: {
      felirat: ctaLabel('course-modules-jump'),
      url: '#modulok',
      ujAblakban: false,
    },
    sectionSettings: { visible: true, anchorId: 'demo-vege', hatter: 'sotet' },
  },
] satisfies NonNullable<Page['layout']>

export const DEMO_COURSE_ALLOWED_BLOCK_TYPES = [
  'welcome',
  'howItWorks',
  'accordion',
  'faq',
  'ctaBanner',
] as const

type DemoCourseBlockType = (typeof DEMO_COURSE_ALLOWED_BLOCK_TYPES)[number]
export type DemoCourseBlock = Extract<
  NonNullable<Page['layout']>[number],
  { blockType: DemoCourseBlockType }
>

export function demoCourseLayout(page?: Page | null): DemoCourseBlock[] {
  const source = page ? (page.layout ?? []) : DEFAULT_DEMO_COURSE_LAYOUT
  const unsupported = source.filter(
    (block) => !DEMO_COURSE_ALLOWED_BLOCK_TYPES.includes(block.blockType as DemoCourseBlockType),
  )

  if (unsupported.length > 0) {
    logger.warn('demo-course: nem támogatott CMS-blokk, teljes alapelrendezést használunk', {
      blockTypes: unsupported.map((block) => block.blockType),
      pageId: page?.id,
    })
    return [...DEFAULT_DEMO_COURSE_LAYOUT]
  }

  return [...source] as DemoCourseBlock[]
}
