import { describe, expect, it } from 'vitest'

import { buildHomeLayout } from '../lib/home-seed'
import {
  CLOSED_HAND_HOME_HELP_TITLES,
  HOME_HELP_LEAD,
  HOME_HELP_PHOTO_FILES,
  HOME_HELP_PUBLIC_DIR,
  HOME_HELP_STATE_TITLES,
  HOME_HELP_STATES,
  HOME_HELP_TITLE,
  LEGACY_HOME_HELP_ROWS,
  LEGACY_HOME_HELP_URLS,
  homeHelpFallbackMedia,
  homeHelpRailRows,
  isClosedHandHomeHelpRail,
  isConvertibleHomeHelpServices,
  isHomeHelpRailRows,
  isLegacyThreeWayHomeHelp,
  presentHomeHelpServicesBlock,
  presentHomeLayout,
  presentSzolgaltatasokLayout,
} from '../lib/home-help-states'
import type { BlockServices, Page } from '../payload-types'
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

const liveTablaRows = LEGACY_HOME_HELP_ROWS.map((row, index) =>
  index === 1
    ? {
        ...row,
        body: 'Otthoni videókurzusunkkal a saját tempódban gyakorolhatsz. A teljes program tartalmát és árát a kurzus oldalán találod.',
      }
    : { ...row },
)

const tablaHelp = (rows: unknown = liveTablaRows): BlockServices =>
  ({
    id: 'help-tabla',
    blockType: 'services',
    title: HOME_HELP_TITLE,
    rows,
    sectionSettings: { visible: true, hatter: 'feher' },
  }) as unknown as BlockServices

describe('presentHomeLayout — élő tábla → C-sín, index nélkül', () => {
  it('a régi háromoszlopos (H08-törzsű) táblát sínné alakítja, a sorszámot nem cseréli', () => {
    expect(isConvertibleHomeHelpServices(tablaHelp())).toBe(true)
    const presented = presentHomeHelpServicesBlock(tablaHelp())
    expect(presented.elrendezes).toBe('sin')
    expect(presented.title).toBe(HOME_HELP_TITLE)
    expect(presented.lead).toBe(HOME_HELP_LEAD)
    expect(presented.eyebrow).toBe('')
    expect(presented.sectionSettings?.hatter).toBe('tint')
    expect(presented.rows?.map((row) => row.title)).toEqual([...HOME_HELP_STATE_TITLES])
    expect(presented.rows?.map((row) => row.osszefoglalo)).toEqual(
      HOME_HELP_STATES.map((state) => state.osszefoglalo),
    )
    expect(presented.rows?.[0]?.photo).toEqual(homeHelpFallbackMedia(0))
    expect(
      typeof presented.rows?.[0]?.photo === 'object' && presented.rows?.[0]?.photo !== null,
    ).toBe(true)
    const photo = presented.rows?.[0]?.photo
    if (typeof photo === 'object' && photo !== null) {
      expect(photo.url).toBe(`${HOME_HELP_PUBLIC_DIR}/${HOME_HELP_PHOTO_FILES[0]}`)
    }
  })

  it('a kétoszlopos „Erre számíthatsz” services blokkot békén hagyja', () => {
    const usps = {
      id: 'usps',
      blockType: 'services' as const,
      title: 'Erre számíthatsz velünk',
      rows: [
        { title: 'Tudomány', body: 'Első.' },
        { title: 'Személyre szabott', body: 'Második.' },
      ],
    }
    expect(isConvertibleHomeHelpServices(usps)).toBe(false)
    expect(presentHomeHelpServicesBlock(usps as unknown as BlockServices)).toEqual(usps)
  })

  it('a kanonikus sín-sorokat megtartja, hiányzó leadet és fotót pótol', () => {
    const rail = {
      blockType: 'services' as const,
      title: HOME_HELP_TITLE,
      elrendezes: 'tabla' as const,
      rows: homeHelpRailRows(),
    }
    const presented = presentHomeHelpServicesBlock(rail as unknown as BlockServices)
    expect(presented.elrendezes).toBe('sin')
    expect(presented.lead).toBe(HOME_HELP_LEAD)
    expect(presented.rows?.map((row) => row.body)).toEqual(
      HOME_HELP_STATES.map((state) => state.body),
    )
    expect(
      presented.rows?.map((row) => (typeof row.photo === 'object' ? row.photo?.url : row.photo)),
    ).toEqual(HOME_HELP_PHOTO_FILES.map((file) => `${HOME_HELP_PUBLIC_DIR}/${file}`))
  })

  it('üres layoutot üresen ad vissza, a többi blokk indexe változatlan', () => {
    expect(presentHomeLayout([])).toEqual([])
    const girls = { blockType: 'about' as const, title: 'A Kineticare alapítói' }
    const help = tablaHelp()
    const later = { blockType: 'about' as const, title: 'Kiss Kata és Kocsis Kata vagyunk' }
    const layout = [girls, help, later] as unknown as NonNullable<Page['layout']>
    const presented = presentHomeLayout(layout)
    expect(presented).toHaveLength(3)
    expect(presented[0]).toBe(layout[0])
    expect(presented[2]).toBe(layout[2])
    expect(presented[1]).not.toBe(layout[1])
    if (presented[1]?.blockType === 'services') {
      expect(presented[1].elrendezes).toBe('sin')
    }
  })

  it('a /szolgaltatasok services-blokkját sínről is táblára zárja', () => {
    const layout = [
      { blockType: 'welcome' as const, title: 'Bevezető' },
      {
        blockType: 'services' as const,
        title: 'Válaszd ki, hogyan segíthetünk neked a legjobban',
        elrendezes: 'sin' as const,
        rows: [{ title: 'Rendelői kezelések', body: 'Szöveg.' }],
      },
    ] as unknown as NonNullable<Page['layout']>
    const presented = presentSzolgaltatasokLayout(layout)
    expect(presented[0]).toEqual(layout[0])
    if (presented[1]?.blockType === 'services') {
      expect(presented[1].elrendezes).toBe('tabla')
      expect(presented[1].title).toBe('Válaszd ki, hogyan segíthetünk neked a legjobban')
    }
  })
})
