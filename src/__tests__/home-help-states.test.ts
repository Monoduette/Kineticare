import { describe, expect, it } from 'vitest'

import { buildHomeLayout } from '../lib/home-seed'
import { buildSzolgaltatasokLayout } from '../scripts/restore-legacy-content'
import {
  CLOSED_HAND_HOME_HELP_TITLES,
  HOME_HELP_LEAD,
  HOME_HELP_PHOTO_FILES,
  HOME_HELP_PUBLIC_DIR,
  HOME_HELP_STATE_TITLES,
  HOME_HELP_STATES,
  HOME_HELP_TITLE,
  HOME_USPS_EYEBROW,
  LEGACY_HOME_HELP_ROWS,
  LEGACY_HOME_HELP_URLS,
  homeHelpFallbackMedia,
  homeHelpRailRows,
  isClosedHandHomeHelpRail,
  isConvertibleHomeHelpServices,
  homeHelpDoorIndex,
  isHomeHelpRailRows,
  isLegacyThreeWayHomeHelp,
  isSzolgaltatasokAjtoBlock,
  presentHomeHelpServicesBlock,
  presentHomeLayout,
  presentSzolgaltatasokLayout,
  SZOLGALTATASOK_KEZELES_FOTO,
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
      'Akut panasz, műtét utáni időszak vagy hosszú ideje tartó fájdalom esetén a stúdióban várunk: gyógytorna, manuálterápia és a hozzád igazított kiegészítő terápiák. A pontos tervet vizsgálat után állítjuk össze.',
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

  // Tulajdonosi kérés (2026-09-22): a rendelői ajtó törzséből kikerül a
  // „; ez nem diagnózis a webről” tagmondat, a mondat ponttal zárul.
  it('a rendelői ajtó tartalék-törzse ponttal zárul, a „diagnózis a webről” tagmondat nélkül', () => {
    expect(
      HOME_HELP_STATES[0]?.body.endsWith('A pontos tervet vizsgálat után állítjuk össze.'),
    ).toBe(true)
    for (const state of HOME_HELP_STATES) {
      expect(state.body).not.toContain('diagnózis a webről')
    }
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
  /**
   * A 2026-09-22-i javításig ez a teszt azt rögzítette, hogy a régi tábla
   * MINDEN szövegét a kódbeli kanonikus szöveg váltja; emiatt az admin
   * szerkesztései nem jelentek meg a kezdőlapon (tulajdonosi hibajelentés:
   * az adminban „Akut sérülések…”, a lapon „Akut panasz…”). Most a sín csak
   * a FORMÁT adja: a CMS törzse, felirata és URL-je marad, a kanonikus szöveg
   * csak az üres mezőt pótolja (itt: bevezető, összegzés, kis felirat).
   */
  it('a régi háromoszlopos táblát sínné alakítja, a CMS szövegét megtartja, csak az üres mezőt pótolja', () => {
    expect(isConvertibleHomeHelpServices(tablaHelp())).toBe(true)
    const presented = presentHomeHelpServicesBlock(tablaHelp())
    expect(presented.elrendezes).toBe('sin')
    expect(presented.title).toBe(HOME_HELP_TITLE)
    expect(presented.lead).toBe(HOME_HELP_LEAD)
    expect(presented.eyebrow).toBe('')
    expect(presented.sectionSettings?.hatter).toBe('tint')
    expect(presented.rows?.map((row) => row.title)).toEqual([...HOME_HELP_STATE_TITLES])
    expect(presented.rows?.map((row) => row.body)).toEqual(liveTablaRows.map((row) => row.body))
    expect(presented.rows?.map((row) => row.felirat)).toEqual(
      liveTablaRows.map((row) => row.felirat),
    )
    expect(presented.rows?.map((row) => row.url)).toEqual(liveTablaRows.map((row) => row.url))
    expect(presented.rows?.map((row) => row.number)).toEqual(['01', '02', '03'])
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

  /**
   * WP25 (tulajdonos, 2026-09-07: „az »Így segítünk / Szolgáltatásaink« doboz
   * nagyon csúnya, abszolút nem illik a stílusunkba"; 3. kör: „a miben
   * segíthetünk és az így tudunk segíteni lényegében ugyanaz, szóval eszerint
   * legyen a kinézete"): a lap ajtó-blokkja (3 sor, mindegyik CTA-val) a sín
   * megjelenítést kapja a SAJÁT soraival; a többi services-blokk tábla marad.
   * WCAG 2.2 SC 3.2.4 Consistent Identification; NN/g Consistency and Standards.
   */
  it('a /szolgaltatasok ajtó-blokkját (3 sor, mind CTA-val) sínre teszi, a tartalom változatlan', () => {
    const rows = [
      {
        title: 'Rendelői kezelések',
        body: 'Szöveg.',
        felirat: 'Időpontot kérek',
        url: '/kapcsolat#idopontkeres',
      },
      {
        title: 'Otthoni online program',
        body: 'Szöveg.',
        felirat: 'Megnézem a kurzusokat',
        url: '/kurzusok',
      },
      {
        title: 'Szakmai képzések',
        body: 'Szöveg.',
        felirat: 'Tovább a szakmai képzésre',
        url: 'https://probodystudio.hu/kez-workshop/',
        ujAblakban: true,
      },
    ]
    const layout = [
      { blockType: 'welcome' as const, title: 'Bevezető' },
      {
        blockType: 'services' as const,
        eyebrow: 'Szolgáltatásaink',
        title: 'Így segítünk',
        image: 39,
        rows,
        sectionSettings: { visible: true, anchorId: 'szolgaltatasaink', hatter: 'tint' },
      },
    ] as unknown as NonNullable<Page['layout']>
    const presented = presentSzolgaltatasokLayout(layout)
    expect(presented).toHaveLength(2)
    expect(presented[0]).toEqual(layout[0])
    const sin = presented[1]
    if (sin?.blockType !== 'services') throw new Error('nincs services blokk')
    expect(sin.elrendezes).toBe('sin')
    expect(sin.title).toBe('Így segítünk')
    expect(sin.eyebrow).toBe('Szolgáltatásaink')
    expect(sin.sectionSettings?.anchorId).toBe('szolgaltatasaink')
    expect(sin.sectionSettings?.hatter).toBe('tint')
    expect(sin.rows?.map((r) => [r.title, r.body, r.felirat, r.url, r.ujAblakban])).toEqual(
      rows.map((r) => [r.title, r.body, r.felirat, r.url, r.ujAblakban]),
    )
    // Fotó: CMS-fotó híján az 1. ajtó a kezelés közbeni felvételt kapja (WP51,
    // manifest `services` szerep), a 2–3. ajtó a kezdőlapi sín tartalék-képeit.
    expect(
      sin.rows?.map((r) => (typeof r.photo === 'object' && r.photo ? r.photo.url : null)),
    ).toEqual([
      SZOLGALTATASOK_KEZELES_FOTO.url,
      `${HOME_HELP_PUBLIC_DIR}/${HOME_HELP_PHOTO_FILES[1]}`,
      `${HOME_HELP_PUBLIC_DIR}/${HOME_HELP_PHOTO_FILES[2]}`,
    ])
    expect(SZOLGALTATASOK_KEZELES_FOTO.url).toBe('/media/team/treatment-wrist-smile-1600.webp')
  })

  it('a /szolgaltatasok ajtó-blokkja a CMS-fotót tartja, a paper hátteret tintre, a sötétet békén hagyja', () => {
    const cmsFoto = {
      id: 77,
      url: '/api/media/file/sajat.jpg',
      alt: 'Saját',
      width: 800,
      height: 1000,
    }
    const ajto = (hatter: string) =>
      ({
        blockType: 'services' as const,
        title: 'Így segítünk',
        rows: [
          { title: 'A', felirat: 'Gomb', url: '/a', photo: cmsFoto },
          { title: 'B', felirat: 'Gomb', url: '/b' },
          { title: 'C', felirat: 'Gomb', url: '/c' },
        ],
        sectionSettings: { visible: true, hatter },
      }) as unknown as NonNullable<Page['layout']>[number]
    const [paper] = presentSzolgaltatasokLayout([ajto('feher')])
    if (paper?.blockType !== 'services') throw new Error('nincs services blokk')
    expect(paper.sectionSettings?.hatter).toBe('tint')
    expect(paper.rows?.[0]?.photo).toEqual(cmsFoto)
    expect(
      typeof paper.rows?.[1]?.photo === 'object' && paper.rows[1].photo
        ? paper.rows[1].photo.url
        : null,
    ).toBe(`${HOME_HELP_PUBLIC_DIR}/${HOME_HELP_PHOTO_FILES[1]}`)
    const [sotet] = presentSzolgaltatasokLayout([ajto('sotet')])
    if (sotet?.blockType !== 'services') throw new Error('nincs services blokk')
    expect(sotet.sectionSettings?.hatter).toBe('sotet')
  })

  it('a /szolgaltatasok NEM ajtó services-blokkja (CTA nélküli sorok, vagy nem három sor) tábla marad, sínről is', () => {
    const layout = [
      {
        blockType: 'services' as const,
        title: 'Ezért fogod imádni',
        elrendezes: 'sin' as const,
        rows: [
          { title: 'A kéz a szakterületünk', body: 'Szöveg.' },
          { title: 'A hétköznapokra készülünk', body: 'Szöveg.' },
        ],
      },
      {
        blockType: 'services' as const,
        title: 'Válaszd ki, hogyan segíthetünk neked a legjobban',
        elrendezes: 'sin' as const,
        rows: [
          { title: 'Rendelői kezelések', body: 'Szöveg.', felirat: 'Gomb', url: '/a' },
          { title: 'Otthoni program', body: 'Szöveg.', felirat: 'Gomb', url: '/b' },
          { title: 'Szakmai képzések', body: 'Szöveg.' },
        ],
      },
    ] as unknown as NonNullable<Page['layout']>
    const presented = presentSzolgaltatasokLayout(layout)
    expect(presented).toHaveLength(2)
    expect(presented[0]).toMatchObject({
      blockType: 'services',
      elrendezes: 'tabla',
      title: 'Ezért fogod imádni',
    })
    expect(presented[1]).toMatchObject({ blockType: 'services', elrendezes: 'tabla' })
    expect(isSzolgaltatasokAjtoBlock(layout[0] as { blockType?: unknown; rows?: unknown })).toBe(
      false,
    )
    expect(isSzolgaltatasokAjtoBlock(layout[1] as { blockType?: unknown; rows?: unknown })).toBe(
      false,
    )
  })

  it('a seed /szolgaltatasok ajtó-blokkja sínre kerül, az „Ezért fogod imádni" usps marad', () => {
    const presented = presentSzolgaltatasokLayout(buildSzolgaltatasokLayout())
    const services = presented.filter((block) => block.blockType === 'services')
    expect(services).toHaveLength(1)
    expect(services[0]).toMatchObject({ elrendezes: 'sin' })
    expect(presented.some((block) => block.blockType === 'usps')).toBe(true)
  })
})

/**
 * ŐR — a kezdőlapi „Így tudunk segíteni” a CMS-ben mentett szöveget mutatja
 * (tulajdonosi hibajelentés, 2026-09-22: az adminban a rendelői ajtó törzse
 * „Akut sérülések…” kezdetű volt, a lapon mégis a kódbeli „Akut panasz…”
 * jelent meg). A kanonikus `HOME_HELP_STATES` szöveg csak az üres mezőt
 * pótolja, hogy üres CMS mellett se essen szét a szekció.
 */
describe('presentHomeHelpServicesBlock — a CMS szövege nyer, a pótlás csak üres mezőre jár', () => {
  const AKUT_SERULESEK =
    'Akut sérülések, műtét utáni állapotok és krónikus fájdalmak esetén a mozgásterápia a gyógyulás alappillére. Az adminban mentett szöveg.'

  const cmsRows = [
    {
      id: 'r0',
      number: '01',
      title: 'Rendelői kezelések',
      osszefoglalo: 'Kezelés a budapesti stúdióban.',
      body: AKUT_SERULESEK,
      felirat: 'Megnézem a kezeléseket',
      url: '/szolgaltatasok#rendeloi-kezelesek',
      ujAblakban: false,
    },
    {
      id: 'r1',
      number: '02',
      title: 'Otthoni program',
      osszefoglalo: 'Online, a saját tempódban.',
      body: 'Otthoni szerkesztett törzs.',
      felirat: 'Megnézem a kurzusokat',
      url: '/kurzusok',
      ujAblakban: false,
    },
    {
      id: 'r2',
      number: '03',
      title: 'Szakmai képzések',
      osszefoglalo: 'Szakembereknek.',
      body: 'Szakmai szerkesztett törzs.',
      felirat: 'Megnézem a workshopot',
      url: 'https://example.test/workshop',
      ujAblakban: true,
    },
  ]

  const cmsBlock = (overrides: Record<string, unknown> = {}): BlockServices =>
    ({
      id: 'help-cms',
      blockType: 'services',
      eyebrow: 'Szolgáltatásaink',
      title: HOME_HELP_TITLE,
      lead: 'A szerkesztő saját bevezetője.',
      rows: cmsRows,
      sectionSettings: { visible: true, hatter: 'feher' },
      ...overrides,
    }) as unknown as BlockServices

  it('a kitöltött CMS-mezőket változatlanul adja tovább (cím, bevezető, kis felirat, minden sor-mező)', () => {
    const presented = presentHomeHelpServicesBlock(cmsBlock())
    expect(presented.elrendezes).toBe('sin')
    expect(presented.eyebrow).toBe('Szolgáltatásaink')
    expect(presented.title).toBe(HOME_HELP_TITLE)
    expect(presented.lead).toBe('A szerkesztő saját bevezetője.')
    expect(
      presented.rows?.map((row) => [
        row.id,
        row.number,
        row.title,
        row.osszefoglalo,
        row.body,
        row.felirat,
        row.url,
        row.ujAblakban,
      ]),
    ).toEqual(
      cmsRows.map((row) => [
        row.id,
        row.number,
        row.title,
        row.osszefoglalo,
        row.body,
        row.felirat,
        row.url,
        row.ujAblakban,
      ]),
    )
    expect(presented.rows?.[0]?.body.startsWith('Akut sérülések')).toBe(true)
    expect(presented.rows?.[0]?.body).not.toContain('Akut panasz')
  })

  it('az átnevezett szekciócímet is megtartja, ha a sorok a régi háromajtós felosztást viszik', () => {
    const rows = LEGACY_HOME_HELP_ROWS.map((row) => ({ ...row }))
    const presented = presentHomeHelpServicesBlock(cmsBlock({ title: 'Miben segíthetünk?', rows }))
    expect(presented.elrendezes).toBe('sin')
    expect(presented.title).toBe('Miben segíthetünk?')
    expect(presented.rows?.[0]?.body).toBe(LEGACY_HOME_HELP_ROWS[0].body)
  })

  it('üres szekció-szintű mezőnél (kis felirat, cím, bevezető) a kanonikus pótlás jön', () => {
    const rows = LEGACY_HOME_HELP_ROWS.map((row) => ({ ...row }))
    const presented = presentHomeHelpServicesBlock(
      cmsBlock({ eyebrow: null, title: '', lead: '   ', rows }),
    )
    expect(presented.elrendezes).toBe('sin')
    expect(presented.eyebrow).toBe('')
    expect(presented.title).toBe(HOME_HELP_TITLE)
    expect(presented.lead).toBe(HOME_HELP_LEAD)
    expect(presented.rows?.map((row) => row.body)).toEqual(
      LEGACY_HOME_HELP_ROWS.map((row) => row.body),
    )
  })

  it('csak az üres (hiányzó, null, üres vagy csak szóközös) sor-mezőt pótolja, az ajtó szerint', () => {
    const rows = [
      { number: '', title: 'Rendelői kezelések', body: '   ', osszefoglalo: null, url: '' },
      { title: 'Otthoni program', body: 'Saját otthoni törzs.', felirat: '' },
      {
        title: 'Szakmai képzések',
        body: '',
        osszefoglalo: 'Saját szakmai összegzés.',
        felirat: 'Saját workshop-felirat',
      },
    ]
    const presented = presentHomeHelpServicesBlock(cmsBlock({ rows }))
    const [rendelo, otthon, szakmai] = presented.rows ?? []
    expect(rendelo?.body).toBe(HOME_HELP_STATES[0]?.body)
    expect(rendelo?.osszefoglalo).toBe(HOME_HELP_STATES[0]?.osszefoglalo)
    expect(rendelo?.felirat).toBe(HOME_HELP_STATES[0]?.felirat)
    expect(rendelo?.url).toBe(HOME_HELP_STATES[0]?.url)
    expect(rendelo?.ujAblakban).toBe(false)
    expect(otthon?.body).toBe('Saját otthoni törzs.')
    expect(otthon?.osszefoglalo).toBe(HOME_HELP_STATES[1]?.osszefoglalo)
    expect(otthon?.felirat).toBe(HOME_HELP_STATES[1]?.felirat)
    expect(otthon?.url).toBe(HOME_HELP_STATES[1]?.url)
    expect(szakmai?.body).toBe(HOME_HELP_STATES[2]?.body)
    expect(szakmai?.osszefoglalo).toBe('Saját szakmai összegzés.')
    expect(szakmai?.felirat).toBe('Saját workshop-felirat')
    // Üres URL-nél a cél ÉS az új-ablak jelző együtt jön a pótlásból.
    expect(szakmai?.url).toBe(PROFESSIONAL_TRAINING_URL)
    expect(szakmai?.ujAblakban).toBe(true)
    expect(presented.rows?.map((row) => row.number)).toEqual(['1', '2', '3'])
  })

  it('kitöltött CMS-URL mellett az új-ablak jelzőt is a CMS adja', () => {
    const rows = cmsRows.map((row, index) =>
      index === 2 ? { ...row, url: 'https://example.test/sajat', ujAblakban: null } : row,
    )
    const presented = presentHomeHelpServicesBlock(cmsBlock({ rows }))
    expect(presented.rows?.[2]?.url).toBe('https://example.test/sajat')
    expect(presented.rows?.[2]?.ujAblakban).toBe(false)
  })
})

/**
 * ŐR — a sín ELŐTTI szekció sávváltása (tulajdonosi kör, 2026-09-07:
 * „valahogyan legyen jobban elkülönítve"). Mérve 1440 px-en: az élő
 * „Erre számíthatsz velünk" fotós tábla paperen (#f6f9fc), a sín a
 * help-paperen (#f4f8fd) állt, a fotó alja 0 px-re a sín tetejétől.
 * A prezentációs réteg a sín közvetlen szomszédját a tint sávra teszi
 * (szekció-rendszer terv: váltakozó paper/tint ritmus), és a táblának
 * kis felső feliratot ad. A seedhez (home-seed.ts) nem nyúlunk.
 * NN/g Common Region: https://www.nngroup.com/articles/common-region/
 * NN/g Proximity: https://www.nngroup.com/articles/gestalt-proximity/
 */
describe('presentHomeLayout — a sín előtti szekció sávot vált', () => {
  const uspsTabla = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'usps',
      blockType: 'services' as const,
      title: 'Erre számíthatsz velünk',
      rows: [
        { number: '01', title: 'Szakmai figyelem', body: 'Első.' },
        { number: '02', title: 'Segítség a mindennapokhoz', body: 'Második.' },
      ],
      sectionSettings: { visible: true, hatter: 'feher' },
      ...overrides,
    }) as unknown as NonNullable<Page['layout']>[number]

  const asServices = (block: NonNullable<Page['layout']>[number] | undefined) =>
    block?.blockType === 'services' ? block : undefined

  it('a paper hátterű fotós tábla a sín előtt tintre vált, és eyebrow-t kap', () => {
    const presented = presentHomeLayout([uspsTabla(), tablaHelp()] as NonNullable<Page['layout']>)
    const usps = asServices(presented[0])
    expect(usps?.sectionSettings?.hatter).toBe('tint')
    expect(usps?.eyebrow).toBe(HOME_USPS_EYEBROW)
    expect(HOME_USPS_EYEBROW).not.toMatch(/[\u2013\u2014]/)
    // A sín maga változatlan: help-paper a tint osztály mögött, elrendezes sin.
    expect(asServices(presented[1])?.elrendezes).toBe('sin')
    expect(asServices(presented[1])?.sectionSettings?.hatter).toBe('tint')
  })

  it('kitöltetlen hatter is papernek számít', () => {
    const presented = presentHomeLayout([
      uspsTabla({ sectionSettings: { visible: true } }),
      tablaHelp(),
    ] as NonNullable<Page['layout']>)
    expect(asServices(presented[0])?.sectionSettings?.hatter).toBe('tint')
  })

  it('a szerkesztő sötét sávját és saját eyebrow-ját nem írja felül', () => {
    const presented = presentHomeLayout([
      uspsTabla({ eyebrow: 'Saját felirat', sectionSettings: { visible: true, hatter: 'sotet' } }),
      tablaHelp(),
    ] as NonNullable<Page['layout']>)
    expect(asServices(presented[0])?.sectionSettings?.hatter).toBe('sotet')
    expect(asServices(presented[0])?.eyebrow).toBe('Saját felirat')
  })

  it('a usps blokk is tintre vált a sín előtt (eyebrow-mezője nincs)', () => {
    const usps = {
      id: 'usps-blokk',
      blockType: 'usps' as const,
      title: 'Erre számíthatsz velünk',
      cards: [{ title: 'Első', body: 'Szöveg.' }],
      sectionSettings: { visible: true, hatter: 'feher' as const },
    }
    const presented = presentHomeLayout([usps, tablaHelp()] as NonNullable<Page['layout']>)
    const first = presented[0]
    expect(first?.blockType).toBe('usps')
    expect(first?.blockType === 'usps' ? first.sectionSettings?.hatter : undefined).toBe('tint')
    expect('eyebrow' in (first ?? {})).toBe(false)
  })

  it('csak a KÖZVETLEN szomszéd vált: távolabbi és sín utáni blokk marad', () => {
    const later = uspsTabla({ id: 'later' })
    const presented = presentHomeLayout([
      uspsTabla({ id: 'far' }),
      { blockType: 'about' as const, title: 'Közbeeső' },
      tablaHelp(),
      later,
    ] as NonNullable<Page['layout']>)
    expect(asServices(presented[0])?.sectionSettings?.hatter).toBe('feher')
    expect(asServices(presented[0])?.eyebrow).toBeUndefined()
    expect(presented[1]?.blockType).toBe('about')
    expect(presented[3]).toBe(later)
  })

  it('a seed kezdőlapon a sín szomszédja nem services/usps: a seed sorrend érintetlen', () => {
    const layout = buildHomeLayout({}) as NonNullable<Page['layout']>
    const presented = presentHomeLayout(layout)
    const railIndex = presented.findIndex(
      (block) => block.blockType === 'services' && block.elrendezes === 'sin',
    )
    expect(railIndex).toBeGreaterThan(0)
    expect(presented[railIndex - 1]?.blockType).toBe('states')
    expect(presented[railIndex - 1]).toBe(layout[railIndex - 1])
  })
})

describe('homeHelpDoorIndex — az ajtó a sor jelentéséből (Codex, 2026-09-19)', () => {
  it('cím szerint, kis/nagybetű és térköz nélkül is', () => {
    expect(homeHelpDoorIndex({ title: 'Rendelői kezelések' }, 2)).toBe(0)
    expect(homeHelpDoorIndex({ title: '  otthoni PROGRAM ' }, 0)).toBe(1)
    expect(homeHelpDoorIndex({ title: 'Szakmai képzések' }, 0)).toBe(2)
  })

  it('URL szerint, ha a cím egyedi', () => {
    expect(
      homeHelpDoorIndex({ title: 'Stúdió', url: '/szolgaltatasok#rendeloi-kezelesek' }, 1),
    ).toBe(0)
    expect(homeHelpDoorIndex({ title: 'Videók', url: '/kurzusok/otthoni?x=1' }, 0)).toBe(1)
    expect(homeHelpDoorIndex({ title: 'Kollégáknak', url: '/szakembereknek' }, 0)).toBe(2)
    expect(homeHelpDoorIndex({ title: 'Kollégáknak', url: PROFESSIONAL_TRAINING_URL }, 0)).toBe(2)
  })

  it('felismerhetetlen sor: a pozíció a tartalék, a három ajtó körbejár', () => {
    expect(homeHelpDoorIndex({ title: 'Egyéb' }, 0)).toBe(0)
    expect(homeHelpDoorIndex({ title: 'Egyéb' }, 4)).toBe(1)
    expect(homeHelpDoorIndex({}, 5)).toBe(2)
  })

  it('a /szolgaltatasok átrendezett ajtó-blokkján a kezelés-fotó a rendelői sorral megy', () => {
    const rows = HOME_HELP_STATES.map((state, index) => ({
      id: `r${index}`,
      title: state.title,
      body: state.body,
      felirat: state.felirat,
      url: state.url,
    }))
    const layout = [
      { blockType: 'services', rows: [rows[1], rows[0], rows[2]] },
    ] as unknown as NonNullable<Page['layout']>
    const [presented] = presentSzolgaltatasokLayout(layout)
    const fotok = (presented as BlockServices).rows?.map((row) =>
      typeof row.photo === 'object' && row.photo ? row.photo.url : null,
    )
    expect(fotok?.[1]).toBe(SZOLGALTATASOK_KEZELES_FOTO.url)
    expect(fotok?.[0]).toBe(homeHelpFallbackMedia(1).url)
    expect(fotok?.[2]).toBe(homeHelpFallbackMedia(2).url)
  })
})
