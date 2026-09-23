import { describe, expect, it } from 'vitest'

import { FILM_CAPTION_DEFAULTS, FILM_CAPTION_FIELDS } from '@/lib/film-captions'
import { filmFeliratokKitoltese, uresFeliratMezo } from '@/scripts/film-feliratok-kitoltes'

/**
 * Az előtöltő szabály (src/scripts/film-feliratok-kitoltes.ts): a nyitó videó
 * üres feliratmezőibe a ma látható beépített szöveget írja, a szerkesztő
 * szövegéhez nem nyúl, és a bemenetet nem módosítja.
 */

const film = (captions?: unknown, id = 'film-1') => ({
  blockType: 'filmHero',
  id,
  title: 'Hatékony és biztonságos módszerek',
  ...(captions === undefined ? {} : { captions }),
})
const rolunk = { blockType: 'about', id: 'about-1', title: 'Rólunk' }

/** Mély másolat a módosítatlanság ellenőrzéséhez. */
const klon = <T>(ertek: T): T => JSON.parse(JSON.stringify(ertek)) as T

describe('filmFeliratokKitoltese', () => {
  it('1. a migráció utáni állapotban (minden NULL) mind az öt mezőt kitölti', () => {
    const layout = [
      film({
        midTitle: null,
        midBody: null,
        endTitle: null,
        endBody: null,
        endBodyWithoutFreeSos: null,
      }),
      rolunk,
    ]
    const eredmeny = filmFeliratokKitoltese(layout)
    expect(eredmeny.allapot).toBe('KITOLTVE')
    expect(eredmeny.kitoltottMezok.map((sor) => sor.mezo)).toEqual([...FILM_CAPTION_FIELDS])
    expect(eredmeny.kitoltottMezok[0]).toEqual({
      index: 0,
      blokkId: 'film-1',
      mezo: 'midTitle',
      utvonal: 'layout.0.captions.midTitle',
      ertek: FILM_CAPTION_DEFAULTS.midTitle,
    })
    const uj = eredmeny.layout?.[0] as { captions: Record<string, unknown> }
    expect(uj.captions).toEqual(FILM_CAPTION_DEFAULTS)
    expect(eredmeny.layout?.[1]).toBe(rolunk)
  })

  it('2. hiányzó captions-csoportnál is kitölt (régi dokumentum)', () => {
    const eredmeny = filmFeliratokKitoltese([film()])
    expect(eredmeny.allapot).toBe('KITOLTVE')
    expect((eredmeny.layout?.[0] as { captions: unknown }).captions).toEqual(FILM_CAPTION_DEFAULTS)
  })

  it('3. a csak szóközből álló mező üresnek számít, a szerkesztői szöveg érintetlen', () => {
    const eredmeny = filmFeliratokKitoltese([
      film({
        midTitle: '  Saját cím  ',
        midBody: '   ',
        endTitle: 'Saját vég',
        endBody: '\n\t',
        endBodyWithoutFreeSos: 'Saját SOS nélküli szöveg',
      }),
    ])
    expect(eredmeny.allapot).toBe('KITOLTVE')
    expect(eredmeny.kitoltottMezok.map((sor) => sor.mezo)).toEqual(['midBody', 'endBody'])
    expect((eredmeny.layout?.[0] as { captions: unknown }).captions).toEqual({
      midTitle: '  Saját cím  ',
      midBody: FILM_CAPTION_DEFAULTS.midBody,
      endTitle: 'Saját vég',
      endBody: FILM_CAPTION_DEFAULTS.endBody,
      endBodyWithoutFreeSos: 'Saját SOS nélküli szöveg',
    })
  })

  it('4. a második futás MAR, és nem ad új layoutot', () => {
    const elso = filmFeliratokKitoltese([film({}), rolunk])
    expect(elso.allapot).toBe('KITOLTVE')
    const masodik = filmFeliratokKitoltese(elso.layout)
    expect(masodik).toEqual({ allapot: 'MAR', layout: null, kitoltottMezok: [] })
  })

  it('5. a bemenetet nem módosítja', () => {
    const layout = [film({ midTitle: null, endTitle: 'Saját' }), rolunk]
    const elotte = klon(layout)
    const eredmeny = filmFeliratokKitoltese(layout)
    expect(layout).toEqual(elotte)
    expect(eredmeny.layout).not.toBe(layout)
    expect(eredmeny.layout?.[0]).not.toBe(layout[0])
  })

  it('6. nyitó videó nélkül NINCS_FILMHERO', () => {
    expect(filmFeliratokKitoltese([rolunk])).toEqual({
      allapot: 'NINCS_FILMHERO',
      layout: null,
      kitoltottMezok: [],
    })
    expect(filmFeliratokKitoltese([]).allapot).toBe('NINCS_FILMHERO')
  })

  it('7. több nyitó videó blokkot is kezel, mindegyiket a saját helyén', () => {
    const eredmeny = filmFeliratokKitoltese([
      film({ midTitle: 'Első saját' }, 'a'),
      rolunk,
      film(null, 'b'),
    ])
    expect(eredmeny.allapot).toBe('KITOLTVE')
    const helyek = eredmeny.kitoltottMezok.map((sor) => `${sor.index}:${sor.blokkId}:${sor.mezo}`)
    expect(helyek).toEqual([
      '0:a:midBody',
      '0:a:endTitle',
      '0:a:endBody',
      '0:a:endBodyWithoutFreeSos',
      '2:b:midTitle',
      '2:b:midBody',
      '2:b:endTitle',
      '2:b:endBody',
      '2:b:endBodyWithoutFreeSos',
    ])
    expect((eredmeny.layout?.[0] as { captions: { midTitle: string } }).captions.midTitle).toBe(
      'Első saját',
    )
  })

  it('8. hibás alakú bemenetre sem dob', () => {
    for (const layout of [null, undefined, 'szöveg', 42, { blockType: 'filmHero' }]) {
      expect(filmFeliratokKitoltese(layout)).toEqual({
        allapot: 'NINCS_FILMHERO',
        layout: null,
        kitoltottMezok: [],
      })
    }
    const vegyes = filmFeliratokKitoltese([
      null,
      7,
      'x',
      [],
      { blockType: 'filmHero', captions: 'x' },
    ])
    expect(vegyes.allapot).toBe('KITOLTVE')
    expect(vegyes.kitoltottMezok).toHaveLength(5)
    expect(vegyes.kitoltottMezok.every((sor) => sor.blokkId === null && sor.index === 4)).toBe(true)
    expect(vegyes.layout?.slice(0, 4)).toEqual([null, 7, 'x', []])
  })

  it('9. nem szöveg típusú értéket nem ír felül (nem üres, nem a szabály dönt róla)', () => {
    const eredmeny = filmFeliratokKitoltese([film({ midTitle: 42 })])
    expect((eredmeny.layout?.[0] as { captions: { midTitle: unknown } }).captions.midTitle).toBe(42)
    expect(eredmeny.kitoltottMezok.map((sor) => sor.mezo)).not.toContain('midTitle')
  })

  it('10. az üresség szabálya', () => {
    expect(uresFeliratMezo(undefined)).toBe(true)
    expect(uresFeliratMezo(null)).toBe(true)
    expect(uresFeliratMezo('')).toBe(true)
    expect(uresFeliratMezo(' \n\t ')).toBe(true)
    expect(uresFeliratMezo('a')).toBe(false)
    expect(uresFeliratMezo(0)).toBe(false)
  })
})
