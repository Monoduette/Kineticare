import { describe, expect, expectTypeOf, it } from 'vitest'

import { szamlaloModell } from '@/components/admin/KarakterSzamlaloLogika'
import {
  FILM_CAPTION_BODY_MAX,
  FILM_CAPTION_DEFAULTS,
  FILM_CAPTION_FIELDS,
  FILM_CAPTION_TITLE_MAX,
  filmCaptionLength,
  filmCaptionMax,
  filmCaptionText,
  resolveFilmCaptions,
  validateFilmCaptionBody,
  validateFilmCaptionTitle,
  type FilmCaptionField,
} from '@/lib/film-captions'
import type { BlockFilmHero } from '@/payload-types'

/**
 * A nyitó videó beúszó feliratainak egyetlen forrása (src/lib/film-captions.ts):
 * korlátok, hosszszámítás, magyar hibaüzenetek és a tartalékos feloldó.
 */

const hosszu = (n: number, betu = 'a') => betu.repeat(n)

describe('a beépített szövegek (betűre a 2026-09-22 előtti konstansok)', () => {
  it('az öt szöveg pontosan a korábbi kódbeli érték', () => {
    expect(FILM_CAPTION_DEFAULTS).toEqual({
      midTitle: 'Minden alkalommal egy mozdulattal több',
      midBody:
        'Napi néhány perc otthon, a saját tempódban. A gyakorlatok lépésről lépésre épülnek egymásra, ahogy a kéz bírja.',
      endTitle: 'A következő mozdulat a tiéd',
      endBody:
        'Lentebb megtalálod a kurzusokat és a rendelői kezeléseket. Ha előbb kipróbálnád, ott vannak az ingyenes SOS gyakorlatok.',
      endBodyWithoutFreeSos:
        'Ismerd meg a kurzusainkat és a rendelői kezeléseinket. Válaszd ki a neked megfelelő segítséget.',
    })
  })

  it('a beépített szövegek maguk is beleférnek a korlátba, és validak', () => {
    for (const mezo of FILM_CAPTION_FIELDS) {
      const szoveg = FILM_CAPTION_DEFAULTS[mezo]
      expect(filmCaptionLength(szoveg)).toBeLessThanOrEqual(filmCaptionMax(mezo))
      const valid =
        filmCaptionMax(mezo) === FILM_CAPTION_TITLE_MAX
          ? validateFilmCaptionTitle(szoveg)
          : validateFilmCaptionBody(szoveg)
      expect(valid).toBe(true)
    }
  })

  it('a mezőnevek egyeznek a generált típus captions-csoportjával', () => {
    expectTypeOf<keyof NonNullable<BlockFilmHero['captions']>>().toEqualTypeOf<FilmCaptionField>()
    expect([...FILM_CAPTION_FIELDS].sort()).toEqual(Object.keys(FILM_CAPTION_DEFAULTS).sort())
  })
})

describe('korlátok és hosszszámítás', () => {
  it('a cím korlátja 60, a leírásé 120', () => {
    expect(FILM_CAPTION_TITLE_MAX).toBe(60)
    expect(FILM_CAPTION_BODY_MAX).toBe(120)
    expect(filmCaptionMax('midTitle')).toBe(60)
    expect(filmCaptionMax('endTitle')).toBe(60)
    expect(filmCaptionMax('midBody')).toBe(120)
    expect(filmCaptionMax('endBody')).toBe(120)
    expect(filmCaptionMax('endBodyWithoutFreeSos')).toBe(120)
  })

  it('a két végéről levágott szóközt nem számolja', () => {
    expect(filmCaptionLength('  alma \n\t')).toBe(4)
    expect(filmCaptionLength('   ')).toBe(0)
  })

  it('az ő és az ű egy karakter, akkor is, ha felbontott alakban érkezik', () => {
    expect(filmCaptionLength('őű')).toBe(2)
    const felbontott = 'o\u030Bu\u030B'
    expect(felbontott.length).toBe(4)
    expect(filmCaptionLength(felbontott)).toBe(2)
  })

  it('egy emoji egy karakter (a JavaScript .length kettőnek számolná)', () => {
    expect('😀'.length).toBe(2)
    expect(filmCaptionLength('😀')).toBe(1)
    expect(filmCaptionLength('Kéz 👋')).toBe(5)
  })

  it('nem szöveg értékre 0', () => {
    expect(filmCaptionLength(null)).toBe(0)
    expect(filmCaptionLength(undefined)).toBe(0)
    expect(filmCaptionLength(42)).toBe(0)
  })
})

describe('validátorok: határok és magyar üzenet', () => {
  it('cím: 60 rendben, 61 hiba a tényleges hosszal', () => {
    expect(validateFilmCaptionTitle(hosszu(60))).toBe(true)
    expect(validateFilmCaptionTitle(hosszu(61))).toBe(
      'Rövidítsd legalább 1 karakterrel: most 61, legfeljebb 60 lehet.',
    )
    expect(validateFilmCaptionTitle(hosszu(72))).toBe(
      'Rövidítsd legalább 12 karakterrel: most 72, legfeljebb 60 lehet.',
    )
  })

  it('leírás: 120 rendben, 121 hiba a tényleges hosszal', () => {
    expect(validateFilmCaptionBody(hosszu(120))).toBe(true)
    expect(validateFilmCaptionBody(hosszu(121))).toBe(
      'Rövidítsd legalább 1 karakterrel: most 121, legfeljebb 120 lehet.',
    )
  })

  it('a rövidítés száma az élő számláló túllépésével azonos (ugyanaz a hosszfüggvény)', () => {
    for (const [ertek, max, validate] of [
      [`  ${hosszu(73, 'ő')}  `, FILM_CAPTION_TITLE_MAX, validateFilmCaptionTitle],
      [hosszu(64, '😀'), FILM_CAPTION_TITLE_MAX, validateFilmCaptionTitle],
      [hosszu(150, 'o\u030B'), FILM_CAPTION_BODY_MAX, validateFilmCaptionBody],
    ] as const) {
      const modell = szamlaloModell(ertek, max)
      expect(modell?.tullepve).toBe(true)
      expect(validate(ertek)).toContain(`Rövidítsd legalább ${modell?.tullepes} karakterrel:`)
    }
  })

  it('az üzenet a teendővel kezdődik, indoklás és a sorok számára tett ígéret nélkül, legfeljebb 75 karakter', () => {
    // A korábbi „…hogy telefonon is két/három sorban elférjen” a mérés ellen
    // állított (a korlát fölötti szöveg 390×844-en szinte mindig elfér). Az
    // üzenet a Payload egysoros, levágható mezőhiba-buborékjában áll, ezért a
    // teendő elöl van, és az egész legfeljebb 75 karakter (lásd
    // src/lib/film-captions.ts).
    for (const uzenet of [
      validateFilmCaptionTitle(hosszu(61)),
      validateFilmCaptionTitle(hosszu(160)),
      validateFilmCaptionBody(hosszu(121)),
      validateFilmCaptionBody(hosszu(9999)),
    ]) {
      expect(String(uzenet)).toMatch(/^Rövidítsd legalább \d+ karakterrel: /)
      expect(String(uzenet)).not.toMatch(/sorban|telefonon|hogy/)
      expect(Array.from(String(uzenet)).length).toBeLessThanOrEqual(75)
    }
  })

  it('a szélső szóköz nem viszi át a határt', () => {
    expect(validateFilmCaptionTitle(`  ${hosszu(60)}  `)).toBe(true)
    expect(validateFilmCaptionBody(`\n${hosszu(120)}\n`)).toBe(true)
  })

  it('ékezetes és emojis szöveg kódpontonként számít', () => {
    expect(validateFilmCaptionTitle(hosszu(60, 'ő'))).toBe(true)
    expect(validateFilmCaptionTitle(hosszu(61, 'ű'))).not.toBe(true)
    expect(validateFilmCaptionTitle(hosszu(60, '😀'))).toBe(true)
    expect(validateFilmCaptionTitle(hosszu(60, 'o\u030B'))).toBe(true)
    expect(validateFilmCaptionBody(hosszu(120, '👋'))).toBe(true)
    expect(validateFilmCaptionBody(hosszu(121, '👋'))).toContain('most 121,')
  })

  it('üres, NULL és hiányzó érték rendben van (ott a beépített szöveg látszik)', () => {
    for (const ertek of ['', '   ', null, undefined]) {
      expect(validateFilmCaptionTitle(ertek)).toBe(true)
      expect(validateFilmCaptionBody(ertek)).toBe(true)
    }
  })

  it('az üzenetek a mikroszöveg-szabályokat követik (nincs gondolatjel és felkiáltójel)', () => {
    for (const uzenet of [
      validateFilmCaptionTitle(hosszu(99)),
      validateFilmCaptionBody(hosszu(199)),
    ]) {
      expect(typeof uzenet).toBe('string')
      expect(String(uzenet)).not.toMatch(/[–—!]/)
    }
  })
})

describe('feloldó: CMS-érték vagy beépített szöveg', () => {
  const cms = {
    midTitle: 'Saját közép cím',
    midBody: 'Saját közép leírás.',
    endTitle: 'Saját vég cím',
    endBody: 'Saját vég leírás, SOS-szal.',
    endBodyWithoutFreeSos: 'Saját vég leírás SOS nélkül.',
  }

  it('üres, NULL, hiányzó és csak szóköz mezőnél a beépített szöveg', () => {
    for (const captions of [
      undefined,
      null,
      {},
      {
        midTitle: null,
        midBody: '',
        endTitle: '   ',
        endBody: '\n\t',
        endBodyWithoutFreeSos: null,
      },
    ]) {
      expect(resolveFilmCaptions({ captions }, true)).toEqual({
        mid: { title: FILM_CAPTION_DEFAULTS.midTitle, body: FILM_CAPTION_DEFAULTS.midBody },
        end: { title: FILM_CAPTION_DEFAULTS.endTitle, body: FILM_CAPTION_DEFAULTS.endBody },
      })
    }
  })

  it('a vég-leírás változatát az ingyenes SOS cél választja: mind a 4 kombináció', () => {
    expect(resolveFilmCaptions({ captions: {} }, true).end.body).toBe(FILM_CAPTION_DEFAULTS.endBody)
    expect(resolveFilmCaptions({ captions: {} }, false).end.body).toBe(
      FILM_CAPTION_DEFAULTS.endBodyWithoutFreeSos,
    )
    expect(resolveFilmCaptions({ captions: cms }, true).end.body).toBe(cms.endBody)
    expect(resolveFilmCaptions({ captions: cms }, false).end.body).toBe(cms.endBodyWithoutFreeSos)
  })

  it('a CMS-szöveget levágva, egyébként betűre adja vissza', () => {
    const eredmeny = resolveFilmCaptions(
      { captions: { ...cms, midTitle: '  Saját közép cím  ', endBody: 'Ékezet: őű, és 👋.' } },
      true,
    )
    expect(eredmeny.mid).toEqual({ title: 'Saját közép cím', body: cms.midBody })
    expect(eredmeny.end).toEqual({ title: cms.endTitle, body: 'Ékezet: őű, és 👋.' })
  })

  it('mezőnként külön dönt: a kitöltött mező a CMS-é, az üres a beépítetté', () => {
    const eredmeny = resolveFilmCaptions({ captions: { midTitle: 'Csak ez saját' } }, false)
    expect(eredmeny).toEqual({
      mid: { title: 'Csak ez saját', body: FILM_CAPTION_DEFAULTS.midBody },
      end: {
        title: FILM_CAPTION_DEFAULTS.endTitle,
        body: FILM_CAPTION_DEFAULTS.endBodyWithoutFreeSos,
      },
    })
  })

  it('hibás alakú bemenetre sem dob, a beépített szöveget adja', () => {
    for (const blokk of [null, undefined, 'x', 42, [], { captions: 'x' }, { captions: [1, 2] }]) {
      expect(resolveFilmCaptions(blokk, true).mid.title).toBe(FILM_CAPTION_DEFAULTS.midTitle)
    }
    expect(filmCaptionText({ midTitle: 7 }, 'midTitle')).toBe(FILM_CAPTION_DEFAULTS.midTitle)
  })
})
