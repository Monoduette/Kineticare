import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { Field } from 'payload'

import { filmHero } from '@/blocks/film-hero'
import { SECTION_SETTINGS_LABEL } from '@/blocks/section-settings'
import { FilmHero } from '@/components/blocks/FilmHero'
import { scrollScrubUsesMobileMedia } from '@/components/scroll-scrub/scroll-scrub'
import {
  FILM_CAPTION_DEFAULTS,
  FILM_CAPTION_FIELDS,
  validateFilmCaptionTitle,
} from '@/lib/film-captions'
import type { BlockFilmHero } from '@/payload-types'

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const FILM_HERO_SOURCE = readFileSync(join(REPO, 'src/components/blocks/FilmHero.tsx'), 'utf8')
const FILM_HERO_CSS = readFileSync(
  join(REPO, 'src/app/(frontend)/styles/blocks/film-hero.css'),
  'utf8',
)
const SCROLL_SCRUB_SOURCE = readFileSync(
  join(REPO, 'src/components/scroll-scrub/scroll-scrub.tsx'),
  'utf8',
)
const SCROLL_SCRUB_CSS = readFileSync(
  join(REPO, 'src/components/scroll-scrub/scroll-scrub.css'),
  'utf8',
)
const CONTRAST_AUDIT = readFileSync(join(REPO, 'docs/gomb-kontraszt-audit.md'), 'utf8')

/**
 * ŐR: a filmsáv 2. és 3. „állása" CÍM + LEÍRÁS párban áll.
 *
 * A tulajdonos 2026-08-17-i kifogása szó szerint: a két görgetés-álláson „nem
 * csak valami titulus és alatta semmi, mert az üres", kell alá leírás, mint
 * az 1. állás szekciójában.
 *
 * CMS + TARTALÉK MODELL (2026-09-22, a tulajdonos kérése: „kell CMS-ben belül
 * a videón lévő szövegek cseréjére is menüpont és lehetőség"): a két felirat
 * címe és leírása a filmHero blokk `captions` csoportjának öt mezője. Üres,
 * NULL vagy csak szóközből álló mezőnél a beépített szöveg látszik
 * (src/lib/film-captions.ts), így a cím alatt a leírás akkor sem ürülhet ki
 * némán, ha a szerkesztő kitörli: a lapon ilyenkor a beépített leírás áll.
 * Üres CMS-nél a kimenet BÁJTRA azonos a CMS-mezők bevezetése előttivel.
 *
 * Amit még véd:
 *  - a leírás UGYANABBAN a `[data-scroll-scrub-caption]` burkolóban van, mint
 *    a cím. A görgetés-vezérelt áttűnés és az `aria-hidden` a burkolóra megy
 *    (scroll-scrub.tsx), tehát külön dobozban a leírás a címtől függetlenül
 *    jelenne meg, vagy képernyőolvasóval kiszakadva maradna a fában;
 *  - a felirat címe NEM címsor-elem. A vászon a DOM-ban megelőzi a jelenet
 *    H1-ét, így egy h2 a lap első címsora lenne — fordított dokumentum-vázlat;
 *  - a mikroszöveg-szabályok (docs/ui-sztenderdek.md §3.1): nincs töltelék
 *    gondolatjel és nincs felkiáltójel a vevői szövegben.
 */

const BLOKK: BlockFilmHero = {
  blockType: 'filmHero',
  ctas: [{ felirat: 'Nézd meg a kurzusokat', id: 'c1', ujAblakban: false, url: '/kurzusok' }],
  lead: 'Teszt-bevezető.',
  tags: [{ id: 't1', label: 'Kéz' }],
  title: 'Teszt-cím',
}

/** A `[data-scroll-scrub-caption]` burkolók nyers HTML-je, sorrendben. */
function feliratBlokkok(markup: string): string[] {
  return [...markup.matchAll(/<div class="scroll-scrub__caption[^"]*"[^>]*>(.*?)<\/div>/gs)].map(
    (talalat) => talalat[1],
  )
}

/** Egy adott osztályú bekezdés szövege a burkolón belül. */
function bekezdes(blokk: string, osztaly: string): string | null {
  const talalat = blokk.match(new RegExp(`<p class="${osztaly}">(.*?)</p>`, 's'))
  return talalat === null ? null : talalat[1]
}

function cssSzabaly(selector: string, forras = FILM_HERO_CSS): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const talalat = forras.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'))
  expect(talalat, `hiányzó CSS-szabály: ${selector}`).not.toBeNull()
  return talalat?.[1] ?? ''
}

function sha256(ut: string): string {
  return createHash('sha256')
    .update(readFileSync(join(REPO, ut)))
    .digest('hex')
}

const markup = renderToStaticMarkup(<FilmHero block={BLOKK} />)
const blokkok = feliratBlokkok(markup)

describe('filmsáv-feliratok', () => {
  it('mindkét állás megjelenik', () => {
    expect(blokkok).toHaveLength(2)
    expect(markup).toContain('scroll-scrub__caption--right')
    expect(markup).toContain('scroll-scrub__caption--center')
  })

  it('minden álláson van cím ÉS alatta leírás, ugyanabban a burkolóban', () => {
    for (const blokk of blokkok) {
      const cim = bekezdes(blokk, 'scroll-scrub__caption-title')
      const leiras = bekezdes(blokk, 'scroll-scrub__caption-body')
      expect(cim, 'a felirat címe hiányzik').toBeTruthy()
      expect(leiras, 'a felirat leírása hiányzik — a tulajdonos ezt kérte').toBeTruthy()
      expect((cim ?? '').trim().length).toBeGreaterThan(0)
      // Két rövid mondatnál hosszabb leírást a néző görgetés közben nem olvas el.
      expect((leiras ?? '').trim().length).toBeGreaterThan(20)
      expect((leiras ?? '').trim().length).toBeLessThanOrEqual(160)
      // A leírás a cím UTÁN áll a burkolón belül.
      expect(blokk.indexOf('scroll-scrub__caption-body')).toBeGreaterThan(
        blokk.indexOf('scroll-scrub__caption-title'),
      )
    }
  })

  it('a felirat címe nem címsor-elem (a H1 a DOM-ban KÉSŐBB jön)', () => {
    for (const blokk of blokkok) {
      expect(blokk).not.toMatch(/<h[1-6][\s>]/)
    }
  })

  it('a feliratok szövege betartja a magyar mikroszöveg-szabályokat', () => {
    for (const blokk of blokkok) {
      const szoveg = blokk.replace(/<[^>]*>/g, ' ')
      expect(szoveg, 'töltelék gondolatjel nem lehet vevői szövegben').not.toMatch(/[–—]/)
      expect(szoveg, 'felkiáltójel nem lehet vevői szövegben').not.toContain('!')
    }
  })
})

/**
 * A CMS-mezők bevezetése ELŐTTI kimenet, betűre (a 2026-09-22-i élő
 * kezdőlapról és a korábbi kódbeli konstansokból). Üres CMS-nél ennek kell
 * változatlanul kijönnie.
 */
const REGI_KOZEP =
  '<div class="scroll-scrub__caption scroll-scrub__caption--right" data-scroll-scrub-caption=""><p class="scroll-scrub__caption-title">Minden alkalommal egy mozdulattal több</p><p class="scroll-scrub__caption-body">Napi néhány perc otthon, a saját tempódban. A gyakorlatok lépésről lépésre épülnek egymásra, ahogy a kéz bírja.</p></div>'
const REGI_VEG_SOS =
  '<div class="scroll-scrub__caption scroll-scrub__caption--center" data-scroll-scrub-caption=""><p class="scroll-scrub__caption-title">A következő mozdulat a tiéd</p><p class="scroll-scrub__caption-body">Lentebb megtalálod a kurzusokat és a rendelői kezeléseket. Ha előbb kipróbálnád, ott vannak az ingyenes SOS gyakorlatok.</p></div>'
const REGI_VEG_SOS_NELKUL =
  '<div class="scroll-scrub__caption scroll-scrub__caption--center" data-scroll-scrub-caption=""><p class="scroll-scrub__caption-title">A következő mozdulat a tiéd</p><p class="scroll-scrub__caption-body">Ismerd meg a kurzusainkat és a rendelői kezeléseinket. Válaszd ki a neked megfelelő segítséget.</p></div>'

/** A lebegő feliratok konténere a markupban. */
function feliratKonterer(html: string): string {
  const start = html.indexOf('<div class="scroll-scrub__captions">')
  const end = html.indexOf('<div aria-hidden="true" class="scroll-scrub__progress">')
  return start >= 0 && end > start ? html.slice(start, end) : ''
}

const SOS_HREF = '/#ingyenes'

describe('filmsáv-feliratok: CMS-mezők beépített tartalékkal', () => {
  it('üres CMS-nél a kimenet bájtra azonos a korábbival, SOS-sal és SOS nélkül', () => {
    for (const captions of [
      undefined,
      {},
      {
        midTitle: null,
        midBody: null,
        endTitle: null,
        endBody: null,
        endBodyWithoutFreeSos: null,
      },
      { midTitle: '  ', midBody: '', endTitle: '\n', endBody: ' \t ', endBodyWithoutFreeSos: '' },
    ]) {
      const blokk: BlockFilmHero = { ...BLOKK, captions }
      expect(feliratKonterer(renderToStaticMarkup(<FilmHero block={blokk} />))).toBe(
        `<div class="scroll-scrub__captions">${REGI_KOZEP}${REGI_VEG_SOS_NELKUL}</div>`,
      )
      expect(
        feliratKonterer(renderToStaticMarkup(<FilmHero block={blokk} freeSosHref={SOS_HREF} />)),
      ).toBe(`<div class="scroll-scrub__captions">${REGI_KOZEP}${REGI_VEG_SOS}</div>`)
    }
  })

  it('a CMS-be írt szöveg jelenik meg, levágva, a lebegő és a csökkentett mozgású listában is', () => {
    const html = renderToStaticMarkup(
      <FilmHero
        block={{
          ...BLOKK,
          captions: {
            midTitle: '  Saját közép cím  ',
            midBody: 'Saját közép leírás, ékezettel: őű.',
            endTitle: 'Saját vég cím',
            endBody: 'Saját vég leírás az ingyenes gyakorlatokkal.',
            endBodyWithoutFreeSos: 'Saját vég leírás SOS nélkül.',
          },
        }}
        freeSosHref={SOS_HREF}
      />,
    )
    const [kozep, veg] = feliratBlokkok(html)
    expect(bekezdes(kozep, 'scroll-scrub__caption-title')).toBe('Saját közép cím')
    expect(bekezdes(kozep, 'scroll-scrub__caption-body')).toBe('Saját közép leírás, ékezettel: őű.')
    expect(bekezdes(veg, 'scroll-scrub__caption-title')).toBe('Saját vég cím')
    expect(bekezdes(veg, 'scroll-scrub__caption-body')).toBe(
      'Saját vég leírás az ingyenes gyakorlatokkal.',
    )
    const lista = html.slice(html.indexOf('<ul class="scroll-scrub__reading-captions">'))
    expect(lista).toContain('<p class="scroll-scrub__caption-title">Saját közép cím</p>')
    expect(lista).toContain('Saját vég leírás az ingyenes gyakorlatokkal.')
  })

  it('a vég-leírás változatát a freeSosHref választja: mind a 4 kombináció', () => {
    const cms = { endBody: 'CMS SOS-szal.', endBodyWithoutFreeSos: 'CMS SOS nélkül.' }
    const vegLeiras = (captions: BlockFilmHero['captions'], freeSosHref: string | null) =>
      bekezdes(
        feliratBlokkok(
          renderToStaticMarkup(
            <FilmHero block={{ ...BLOKK, captions }} freeSosHref={freeSosHref} />,
          ),
        )[1],
        'scroll-scrub__caption-body',
      )
    expect(vegLeiras({}, SOS_HREF)).toBe(FILM_CAPTION_DEFAULTS.endBody)
    expect(vegLeiras({}, null)).toBe(FILM_CAPTION_DEFAULTS.endBodyWithoutFreeSos)
    expect(vegLeiras(cms, SOS_HREF)).toBe('CMS SOS-szal.')
    expect(vegLeiras(cms, null)).toBe('CMS SOS nélkül.')
  })

  it('a kitörölt leírás helyén a beépített áll: a cím alatt mindig van leírás', () => {
    const html = renderToStaticMarkup(
      <FilmHero block={{ ...BLOKK, captions: { midTitle: 'Csak cím', midBody: '   ' } }} />,
    )
    const [kozep] = feliratBlokkok(html)
    expect(bekezdes(kozep, 'scroll-scrub__caption-title')).toBe('Csak cím')
    expect(bekezdes(kozep, 'scroll-scrub__caption-body')).toBe(FILM_CAPTION_DEFAULTS.midBody)
  })
})

/** Egy mező a blokk (esetleg név nélküli collapsible-be ágyazott) mezői közül. */
function mezo(fields: readonly Field[], name: string): Field | undefined {
  for (const field of fields) {
    if ('name' in field && field.name === name) {
      return field
    }
    if (field.type === 'collapsible' || field.type === 'row') {
      const belso = mezo(field.fields, name)
      if (belso) {
        return belso
      }
    }
  }
  return undefined
}

describe('a filmHero blokk admin-sémája (R1 §2)', () => {
  const captions = mezo(filmHero.fields, 'captions')
  const csoportMezoi = captions && captions.type === 'group' ? captions.fields : []

  it('a blokk neve egyszerű magyar, a slug és az interfész változatlan', () => {
    expect(filmHero.slug).toBe('filmHero')
    expect(filmHero.interfaceName).toBe('BlockFilmHero')
    expect(filmHero.labels).toEqual({
      singular: 'Nyitó videó (kéznyitás)',
      plural: 'Nyitó videó szekciók',
    })
  })

  it('a captions csoport a gombok után, a „Megjelenés és elrejtés” rész (sectionSettings) előtt áll', () => {
    const nevek = filmHero.fields.map((field) => ('name' in field ? field.name : field.type))
    const gombok = nevek.indexOf('ctas')
    const hely = nevek.indexOf('captions')
    expect(gombok).toBeGreaterThanOrEqual(0)
    expect(hely).toBe(gombok + 1)

    // A K28 óta a sectionSettings() egy név nélküli collapsible, benne a
    // `sectionSettings` csoporttal. Az adatmezőt rekurzívan keressük, így a
    // közös segéd belső szerkezete változhat, a sorrend-elvárás nem gyengül.
    const beallitasok = filmHero.fields.findIndex(
      (field) => mezo([field], 'sectionSettings') !== undefined,
    )
    expect(beallitasok).toBe(hely + 1)
    const utana = filmHero.fields[hely + 1]
    expect(utana?.type).toBe('collapsible')
    expect(utana !== undefined && 'name' in utana).toBe(false)
    if (utana?.type === 'collapsible') {
      expect(utana.label).toBe(SECTION_SETTINGS_LABEL)
      expect(mezo(utana.fields, 'sectionSettings')?.type).toBe('group')
    }

    expect(captions?.type).toBe('group')
    expect(captions && 'label' in captions ? captions.label : null).toBe('Beúszó szövegek a videón')
  })

  it('az első mező séma nélküli tájékoztató a videó szövegeiről', () => {
    const [elso] = filmHero.fields
    expect(elso.type).toBe('ui')
    const komponens =
      elso.admin?.components && 'Field' in elso.admin.components
        ? elso.admin.components.Field
        : undefined
    const leiras =
      typeof komponens === 'object' && komponens !== null && 'clientProps' in komponens
        ? String((komponens.clientProps as { description?: unknown }).description)
        : ''
    expect(leiras).toContain('videón látható összes szöveget')
    expect(leiras).toContain('videót')
  })

  it('öt feliratmező: címkék, validátor, számláló, és nincs beépített maxLength/required/defaultValue', () => {
    const vart = [
      ['midTitle', 'text', 'A videó közepén: cím', 60],
      ['midBody', 'textarea', 'A videó közepén: leírás', 120],
      ['endTitle', 'text', 'A videó végén: cím', 60],
      ['endBody', 'textarea', 'A videó végén: leírás', 120],
      ['endBodyWithoutFreeSos', 'textarea', 'A videó végén: leírás ingyenes kurzus nélkül', 120],
    ] as const
    for (const [nev, tipus, felirat, max] of vart) {
      const field = mezo(csoportMezoi, nev)
      expect(field, nev).toBeDefined()
      if (!field || (field.type !== 'text' && field.type !== 'textarea')) {
        continue
      }
      expect(field.type).toBe(tipus)
      expect(field.label).toBe(felirat)
      expect(typeof field.validate).toBe('function')
      expect('maxLength' in field ? field.maxLength : undefined).toBeUndefined()
      expect(field.required).toBeUndefined()
      expect(field.defaultValue).toBeUndefined()
      expect(String(field.admin?.description)).toContain(`Legfeljebb ${max} karakter`)
      expect(field.admin?.components?.afterInput).toEqual([
        { path: '/components/admin/KarakterSzamlalo#KarakterSzamlalo', clientProps: { max } },
      ])
    }
  })

  it('a leírások a sorok számáról célt vagy jellemző esetet mondanak, nem mérés elleni tényt', () => {
    // Mérve (src/lib/film-captions.ts fejkommentje): a 120 karakteres leírás
    // 320×568-on a minták 6,74%-ában négysoros, ezért „ez telefonon három sor”
    // hamis tény lenne; a cím céltagmondata („hogy … elférjen két sorban”) a
    // korlát célját mondja.
    const leiras = (nev: string) => {
      const field = mezo(csoportMezoi, nev)
      return String(field?.admin && 'description' in field.admin ? field.admin.description : '')
    }
    expect(leiras('midBody')).toContain('általában elfér három sorban')
    expect(leiras('midTitle')).toContain('hogy telefonon is elférjen két sorban')
    for (const nev of FILM_CAPTION_FIELDS) {
      expect(leiras(nev), nev).not.toMatch(/ez telefonon (két|három|négy) sor\b/)
    }
  })

  it('az SOS nélküli leírás egy név nélküli, csukott collapsible-ben van', () => {
    const collapsible = csoportMezoi.find((field) => field.type === 'collapsible')
    expect(collapsible && 'name' in collapsible).toBe(false)
    expect(collapsible?.label).toBe('Ha nincs ingyenes kurzus (ritkán kell)')
    expect(collapsible?.admin?.initCollapsed).toBe(true)
    expect(
      collapsible?.type === 'collapsible' && mezo(collapsible.fields, 'endBodyWithoutFreeSos'),
    ).toBeTruthy()
  })

  it('a szerkesztői szövegek tegezők, gondolatjel és felkiáltójel nélkül, „…” idézőjellel', () => {
    const szovegek: string[] = []
    const gyujt = (fields: readonly Field[]) => {
      for (const field of fields) {
        if ('label' in field && typeof field.label === 'string') szovegek.push(field.label)
        const leiras = field.admin && 'description' in field.admin ? field.admin.description : null
        if (typeof leiras === 'string') szovegek.push(leiras)
        if ('fields' in field) gyujt(field.fields)
      }
    }
    // A gombok (link-fields.ts) és a „Megjelenés és elrejtés” rész
    // (section-settings.ts) közös mezőit a saját fájljuk gazdája igazítja; itt
    // a blokk saját szövegei. A közös rész a név nélküli collapsible, amelynek
    // a részfájában a `sectionSettings` mező áll.
    const kozos = (field: Field): boolean =>
      ('name' in field && field.name === 'ctas') ||
      (field.type === 'collapsible' &&
        !('name' in field) &&
        mezo(field.fields, 'sectionSettings') !== undefined)
    gyujt(filmHero.fields.filter((field) => !kozos(field)))
    expect(szovegek.length).toBeGreaterThan(10)
    for (const szoveg of szovegek) {
      expect(szoveg, szoveg).not.toMatch(/[—!]|\s–\s/)
      expect(szoveg, szoveg).not.toContain('"')
    }
  })

  it('a validátor a mezőn is a film-captions.ts szabályát futtatja', () => {
    const field = mezo(csoportMezoi, 'midTitle')
    const validate = field && 'validate' in field ? field.validate : undefined
    expect(typeof validate).toBe('function')
    if (typeof validate === 'function') {
      const valaszt = (validate as (value: unknown, options: unknown) => unknown)(
        'a'.repeat(61),
        {},
      )
      expect(valaszt).toBe(validateFilmCaptionTitle('a'.repeat(61)))
    }
  })
})

describe('filmsáv egykezes média-szerződése', () => {
  const ujAssetek = [
    'public/media/film/one-hand-header-v1.mp4',
    'public/media/film/one-hand-header-v1-mobile.mp4',
    'public/media/film/one-hand-header-v1-poster.webp',
    'public/media/film/one-hand-header-v1-mobile-poster.webp',
  ] as const

  it('a verziózott egykezes klipeket és a hozzájuk tartozó posztereket köti be', () => {
    for (const ut of ujAssetek) {
      expect(FILM_HERO_SOURCE).toContain(ut.replace('public', ''))
    }
    expect(FILM_HERO_SOURCE).not.toContain('/media/film/scene-02')
  })

  it('az auditált média byte-ra változatlan, a klipek a deploy-kereten belül maradnak', () => {
    expect(sha256(ujAssetek[0])).toBe(
      '6802e75d25bc7c296b3307202ea6c601a037ed04055f2d5a4ac12ffbfb30907e',
    )
    expect(sha256(ujAssetek[1])).toBe(
      'd9b076541937f941585d8d16a2611eb59ebd2d407d4dd07ce52de1c0677fc417',
    )
    expect(sha256(ujAssetek[2])).toBe(
      '8d6c0a8afecdbc1c184dacb509ce86fea653b5dbdc5ead71e0a81bac8752fe13',
    )
    expect(sha256(ujAssetek[3])).toBe(
      '8252b884c2252ff19cdb9b05455c67934af91869c742a489c988a159c240ef0d',
    )
    expect(statSync(join(REPO, ujAssetek[0])).size).toBeLessThanOrEqual(5 * 1024 * 1024)
    expect(statSync(join(REPO, ujAssetek[1])).size).toBeLessThanOrEqual(2.5 * 1024 * 1024)
  })

  it('a kontrasztaudit mind a négy élő médiafájlt és annak byte-hashét figyeli', () => {
    for (const [ut, hash] of [
      [ujAssetek[0], '6802e75d25bc7c296b3307202ea6c601a037ed04055f2d5a4ac12ffbfb30907e'],
      [ujAssetek[1], 'd9b076541937f941585d8d16a2611eb59ebd2d407d4dd07ce52de1c0677fc417'],
      [ujAssetek[2], '8d6c0a8afecdbc1c184dacb509ce86fea653b5dbdc5ead71e0a81bac8752fe13'],
      [ujAssetek[3], '8252b884c2252ff19cdb9b05455c67934af91869c742a489c988a159c240ef0d'],
    ] as const) {
      expect(CONTRAST_AUDIT).toContain(`\`${ut}\``)
      expect(CONTRAST_AUDIT).toContain(`\`${hash}\``)
    }
  })

  it('a korábbi filmassetek megmaradnak az azonnali rollbackhez', () => {
    for (const nev of [
      'scene-02.mp4',
      'scene-02-mobile.mp4',
      'scene-02-poster.png',
      'scene-02-mobile-poster.png',
    ]) {
      expect(statSync(join(REPO, 'public/media/film', nev)).size).toBeGreaterThan(0)
    }
  })

  it('a portré art direction csak keskeny álló nézetben töltődik', () => {
    expect(markup).toContain('media="(max-width: 860px) and (orientation: portrait)"')
    expect(SCROLL_SCRUB_SOURCE).toContain(
      'const usesMobileVideoTuning = () => coarsePointer || smallViewport.matches',
    )
    expect(scrollScrubUsesMobileMedia(390, 844)).toBe(true)
    expect(scrollScrubUsesMobileMedia(430, 932)).toBe(true)
    expect(scrollScrubUsesMobileMedia(768, 1024)).toBe(true)
    expect(scrollScrubUsesMobileMedia(860, 900)).toBe(true)
    expect(scrollScrubUsesMobileMedia(568, 320)).toBe(false)
    expect(scrollScrubUsesMobileMedia(1024, 768)).toBe(false)
    expect(FILM_HERO_CSS).not.toContain('object-fit: contain')
    expect(FILM_HERO_CSS).not.toContain('orientation: landscape')
  })

  it('az 52%-os papírfátyol scrolltól függetlenül a média és minden szöveg között marad', () => {
    const fatyol = cssSzabaly('.kc-film-hero .scroll-scrub__stage::before')
    expect(fatyol).toContain('z-index: 2')
    expect(fatyol).toContain('var(--kc-color-bg) 52%')
    expect(fatyol).not.toMatch(/--ss-(?:progress|copy-scrim)|opacity|animation|transition/)
    expect(cssSzabaly('.kc-film-hero .scroll-scrub__stage::after')).toContain('z-index: 4')
    expect(cssSzabaly('.scroll-scrub__media', SCROLL_SCRUB_CSS)).toContain('z-index: 0')
    expect(cssSzabaly('.scroll-scrub__captions', SCROLL_SCRUB_CSS)).toContain('z-index: 5')
    expect(cssSzabaly('.scroll-scrub__story', SCROLL_SCRUB_CSS)).toContain('z-index: 3')
  })

  it('nem tesz kártyát vagy teljes vásznas blur-effektet a szöveg mögé', () => {
    expect(cssSzabaly('.scroll-scrub__copy', SCROLL_SCRUB_CSS)).not.toMatch(/background/)
    expect(cssSzabaly('.scroll-scrub__caption', SCROLL_SCRUB_CSS)).not.toMatch(/background/)
    expect(FILM_HERO_CSS).not.toMatch(/(?:backdrop-filter|filter)\s*:/)
  })

  it('a csökkentett mozgás továbbra is álló poszterre vált', () => {
    expect(SCROLL_SCRUB_SOURCE).toContain(
      "window.matchMedia('(prefers-reduced-motion: reduce)').matches",
    )
    const reduced = SCROLL_SCRUB_CSS.slice(
      SCROLL_SCRUB_CSS.indexOf('@media (prefers-reduced-motion: reduce)'),
    )
    expect(reduced).toContain('min-height: 100dvh !important')
    expect(reduced).toContain('display: none')
  })

  it('az M1 továbbra is legfeljebb egy elsődleges és egy halk CTA-t renderel', () => {
    const html = renderToStaticMarkup(
      <FilmHero
        block={{
          ...BLOKK,
          ctas: [
            ...(BLOKK.ctas ?? []),
            { felirat: 'Második CTA', id: 'c2', ujAblakban: false, url: '/masodik' },
            { felirat: 'Harmadik CTA', id: 'c3', ujAblakban: false, url: '/harmadik' },
          ],
        }}
      />,
    )
    expect(html.match(/class="[^"]*kc-film-hero__cta[^"]*"/g)).toHaveLength(2)
    expect(html).not.toContain('/harmadik')
  })
})
