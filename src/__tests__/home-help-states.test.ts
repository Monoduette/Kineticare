import { describe, expect, it } from 'vitest'

import { buildHomeLayout } from '../lib/home-seed'
import {
  HOME_HELP_LEAD,
  HOME_HELP_STATE_TITLES,
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
})
