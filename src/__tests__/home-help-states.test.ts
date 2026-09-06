import { describe, expect, it } from 'vitest'

import { buildHomeLayout } from '../lib/home-seed'
import {
  HOME_HELP_LEAD,
  HOME_HELP_PHOTO_FILES,
  HOME_HELP_STATE_TITLES,
  HOME_HELP_STATES,
  HOME_HELP_TITLE,
  LEGACY_HOME_HELP_ROWS,
  LEGACY_HOME_HELP_URLS,
  homeHelpRailRows,
  isHomeHelpRailRows,
  isLegacyThreeWayHomeHelp,
} from '../lib/home-help-states'
import { COURSE_SOS_KEZRELAX } from '../lib/legacy-redirects'

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

  it('a Zárt / Nyíló / Nyitott sorokat a cím alapján ismeri fel', () => {
    expect(isHomeHelpRailRows(homeHelpRailRows())).toBe(true)
    expect(isHomeHelpRailRows(LEGACY_HOME_HELP_ROWS)).toBe(false)
  })

  it('a seed kezdőlap a sín kanonikus szövegét és a SOS / lista / szolgáltatások célokat viszi', () => {
    const help = buildHomeLayout().find(
      (block) => block.blockType === 'services' && block.title === HOME_HELP_TITLE,
    )
    if (help?.blockType !== 'services') {
      throw new Error('Hiányzik a kezdőlapi segítség-szekció.')
    }
    expect(help.elrendezes).toBe('sin')
    expect(help.lead).toBe(HOME_HELP_LEAD)
    expect(help.rows?.map((row) => row.title)).toEqual([...HOME_HELP_STATE_TITLES])
    expect(help.rows?.map((row) => row.url)).toEqual([
      COURSE_SOS_KEZRELAX,
      '/kurzusok',
      '/szolgaltatasok',
    ])
    expect(help.rows?.map((row) => row.url)).not.toContain(LEGACY_HOME_HELP_URLS[2])
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
      'A logónk három kézállapotot rajzol ki. Itt ezen az úton igazítunk: megfigyelés alapján, nem diagnózis.',
    )
    expect(HOME_HELP_STATES.map((state) => state.title)).toEqual(['Zárt', 'Nyíló', 'Nyitott'])
    expect(HOME_HELP_STATES.map((state) => state.osszefoglalo)).toEqual([
      'A kéz még inkább összezárva, a mindennapi mozdulat óvatos.',
      'Már van mozgás, de a tartomány még nem teljes.',
      'A kéz újra szélesebb tartományban használható.',
    ])
    expect(HOME_HELP_STATES.map((state) => state.body)).toEqual([
      'Ha a markolás, a nyitás vagy a terhelés még szűk tartományban van, először kis, biztonságos lépéssel érdemes kezdeni. Az Ingyenes SOS KézRelax ehhez ad azonnal elérhető gyakorlatokat: otthon, a saját tempódban.',
      'Amikor a kéz már nyílik, de a hétköznapi feladatok még töredeznek, a következő lépés a rendszeres, lépésről lépésre épülő otthoni gyakorlás. A kurzusoldalon látod a teljes programot és az árat: ígéret és százalék nélkül.',
      'Ha a cél a tartós mindennapi használat, vagy személyes iránymutatást keresel, egy helyen nézheted át, milyen utak vannak nálunk: rendelő, otthoni program, szakmai út. Te választasz; mi nem sorolunk be diagnózisba.',
    ])
    expect(HOME_HELP_STATES.map((state) => state.felirat)).toEqual([
      'Ingyenes SOS KézRelax',
      'Nézd meg a kurzusokat',
      'Nézd meg a szolgáltatásokat',
    ])
    expect(HOME_HELP_STATES.map((state) => state.url)).toEqual([
      '/kurzusok/sos-kezrelax-villamkurzus',
      '/kurzusok',
      '/szolgaltatasok',
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
  })
})
