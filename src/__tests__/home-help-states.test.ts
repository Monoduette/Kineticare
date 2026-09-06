import { describe, expect, it } from 'vitest'

import { buildHomeLayout } from '../lib/home-seed'
import {
  CLOSED_HAND_HOME_HELP_TITLES,
  HOME_HELP_LEAD,
  HOME_HELP_PHOTO_FILES,
  HOME_HELP_STATE_TITLES,
  HOME_HELP_STATES,
  HOME_HELP_TITLE,
  LEGACY_HOME_HELP_ROWS,
  LEGACY_HOME_HELP_URLS,
  homeHelpRailRows,
  isClosedHandHomeHelpRail,
  isHomeHelpRailRows,
  isLegacyThreeWayHomeHelp,
} from '../lib/home-help-states'
import { PROFESSIONAL_TRAINING_URL } from '../lib/menu-seed'

describe('home-help-states — REV C felismerés', () => {
  it('a háromsoros Rendelői / Otthoni / Szakmai felosztást címen és URL-en ismeri fel', () => {
    expect(isLegacyThreeWayHomeHelp(LEGACY_HOME_HELP_ROWS)).toBe(true)
    expect(
      isLegacyThreeWayHomeHelp(
        LEGACY_HOME_HELP_ROWS.map((row, index) =>
          index === 1 ? { ...row, body: 'Szerkesztett otthoni törzs.' } : row,
        ),
      ),
    ).toBe(true)
    expect(
      isLegacyThreeWayHomeHelp(
        LEGACY_HOME_HELP_ROWS.map((row, index) =>
          index === 2 ? { ...row, url: 'https://example.test/custom' } : row,
        ),
      ),
    ).toBe(false)
  })

  it('a kanonikus sín-sorokat az összegzésről ismeri fel, a tábla-hármastól megkülönbözteti', () => {
    expect(isHomeHelpRailRows(homeHelpRailRows())).toBe(true)
    expect(isHomeHelpRailRows(LEGACY_HOME_HELP_ROWS)).toBe(false)
    expect(isClosedHandHomeHelpRail(homeHelpRailRows())).toBe(false)
    expect(
      isClosedHandHomeHelpRail(
        CLOSED_HAND_HOME_HELP_TITLES.map((title, index) => ({
          title,
          url: LEGACY_HOME_HELP_URLS[index],
          felirat: 'Gomb',
        })),
      ),
    ).toBe(true)
  })

  it('a seed kezdőlap a sín kanonikus szövegét és a kezelés / lista / workshop célokat viszi', () => {
    const help = buildHomeLayout().find(
      (block) => block.blockType === 'services' && block.title === HOME_HELP_TITLE,
    )
    if (help?.blockType !== 'services') {
      throw new Error('Hiányzik a kezdőlapi segítség-szekció.')
    }
    expect(help.elrendezes).toBe('sin')
    expect(help.sectionSettings?.hatter).toBe('tint')
    expect(help.lead).toBe(HOME_HELP_LEAD)
    expect(help.rows?.map((row) => row.title)).toEqual([...HOME_HELP_STATE_TITLES])
    expect(help.rows?.map((row) => row.url)).toEqual([
      '/szolgaltatasok',
      '/kurzusok',
      PROFESSIONAL_TRAINING_URL,
    ])
    expect(help.rows?.map((row) => row.ujAblakban)).toEqual([false, false, true])
  })

  it('a sín fotói a zárolt Drive-képek, nem a Kata-csoportképek', () => {
    expect([...HOME_HELP_PHOTO_FILES]).toEqual([
      'help-zart-img-7541.jpg',
      'help-nyilo-syl-9297.jpg',
      'help-nyitott-syl-9260.jpg',
    ])
    for (const tiltott of [
      'katak-labdaval.jpg',
      'katak-team.jpg',
      '680a69d078306_Katakfeherbenhattal.png',
      'state-zart.png',
      'state-nyilo.png',
      'state-nyitott.png',
    ]) {
      expect(HOME_HELP_PHOTO_FILES).not.toContain(tiltott)
    }
    const help = buildHomeLayout({
      'help-zart-img-7541.jpg': 41,
      'help-nyilo-syl-9297.jpg': 42,
      'help-nyitott-syl-9260.jpg': 43,
      'katak-labdaval.jpg': 99,
      'katak-team.jpg': 98,
      'state-zart.png': 4,
    }).find((block) => block.blockType === 'services' && block.title === HOME_HELP_TITLE)
    if (help?.blockType !== 'services') {
      throw new Error('Hiányzik a kezdőlapi segítség-szekció.')
    }
    expect(help.rows?.map((row) => row.photo)).toEqual([41, 42, 43])
  })

  it('a Szerkesztő C panel-szövege karakterre egyezik, gondolatjel nélkül', () => {
    expect(HOME_HELP_TITLE).toBe('Így tudunk segíteni')
    expect(HOME_HELP_LEAD).toBe(
      'Három út, ahogy a kezeddel foglalkozunk: személyesen a stúdióban, otthon a saját tempódban, vagy szakmai képzésen.',
    )
    expect(HOME_HELP_STATES.map((state) => state.title)).toEqual([
      'Rendelői kezelések',
      'Otthoni program',
      'Szakmai képzések',
    ])
    expect(HOME_HELP_STATES.map((state) => state.osszefoglalo)).toEqual([
      'Személyes kezelés a stúdióban.',
      'Videókurzus, a saját ritmusodban.',
      'Akkreditált kézkurzus szakembereknek.',
    ])
    expect(HOME_HELP_STATES.map((state) => state.body)).toEqual([
      'Akut panasz, műtét utáni időszak vagy hosszú ideje tartó fájdalom esetén a stúdióban várunk: gyógytorna, manuálterápia és a hozzád igazított kiegészítő terápiák. A pontos tervet vizsgálat után állítjuk össze; ez nem diagnózis a webről.',
      'Ha otthon szeretnél gyakorolni, az Otthoni KézRehab Program lépésről lépésre visz. A teljes tartalom és az ár a kurzusoldalon van: ígéret és százalék nélkül.',
      'A ProBody Stúdióval együtt tartott tantermi kézkurzus a kéz, a csukló és a könyök rehabilitációs lehetőségeiről szól: gyógytornászoknak, orvosoknak, erőnléti és szakági edzőknek.',
    ])
    expect(HOME_HELP_STATES.map((state) => state.felirat)).toEqual([
      'Tovább a kezelésekre',
      'Nézd meg a kurzusokat',
      'Nézd meg a kézworkshopot',
    ])
    expect(HOME_HELP_STATES.map((state) => state.url)).toEqual([
      '/szolgaltatasok',
      '/kurzusok',
      PROFESSIONAL_TRAINING_URL,
    ])
    const copy = [
      HOME_HELP_TITLE,
      HOME_HELP_LEAD,
      ...HOME_HELP_STATES.flatMap((state) => [
        state.title,
        state.osszefoglalo,
        state.body,
        state.felirat,
      ]),
    ].join('\n')
    expect(copy).not.toMatch(/[\u2013\u2014]/)
    expect(copy).not.toMatch(/\b(Zárt|Nyíló|Nyitott)\b/)
  })
})
