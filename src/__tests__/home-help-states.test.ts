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

  it('a jóváhagyott panel-szövegben nincs gondolatjel', () => {
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
    expect(HOME_HELP_STATES[0]?.body).toContain('gyakorlatokat: otthon')
    expect(HOME_HELP_STATES[1]?.body).toContain('az árat: ígéret')
  })
})
