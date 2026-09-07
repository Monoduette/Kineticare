/**
 * Kezdőlapi „Így tudunk segíteni" — REV C sín + panel kanonikus szövege.
 *
 * A három síncímke szolgáltatás-ajtó (Rendelői kezelések / Otthoni program /
 * Szakmai képzések), nem kézállapot. A szöveget a Szerkesztő 2026-09-06-án
 * karakterre zárta, gondolatjel nélkül. A sín-CTA-k a §3.2 szótárból jönnek,
 * kivéve a rendelői ajtó CMS-feliratát: a tulajdonos az élő
 * `Tovább a kezelésekre` alakot hagyta jóvá; a szótár #40 M-7 szerint
 * `Nézd meg a kezeléseket` marad. A /szolgaltatasok ajtó-blokkja a SAJÁT
 * soraival kapja ugyanezt a sín-megjelenítést (`presentSzolgaltatasokLayout`).
 */

import type { BlockServices, Media, Page } from '../payload-types'
import { ctaLabel } from './cta-vocabulary'
import { PROFESSIONAL_TRAINING_URL } from './menu-seed'

export const HOME_HELP_TITLE = 'Így tudunk segíteni'

export const HOME_HELP_LEAD =
  'Három út, ahogy a kezeddel foglalkozunk: személyesen a stúdióban, otthon a saját tempódban, vagy szakmai képzésen.'

export const LEGACY_HOME_HELP_TITLES = [
  'Rendelői kezelések',
  'Otthoni program',
  'Szakmai képzések',
] as const

export const LEGACY_HOME_HELP_URLS = [
  '/szolgaltatasok',
  '/kurzusok',
  PROFESSIONAL_TRAINING_URL,
] as const

export const HOME_HELP_STATE_TITLES = [
  'Rendelői kezelések',
  'Otthoni program',
  'Szakmai képzések',
] as const

/** A REV C első, kézállapot-címkés sín — H08 ebből viszi át a szolgáltatás-ajtókra. */
export const CLOSED_HAND_HOME_HELP_TITLES = ['Zárt', 'Nyíló', 'Nyitott'] as const

export interface HomeHelpStateRow {
  readonly number: string
  readonly title: (typeof HOME_HELP_STATE_TITLES)[number]
  readonly osszefoglalo: string
  readonly body: string
  readonly felirat: string
  readonly url: string
  readonly ujAblakban: boolean
}

/**
 * Zárolt sín-fotók a Drive-anyagból (IMG_7541, SYL_9297, SYL_9260).
 * Szándékosan nem a `katak-labdaval` / `katak-team` / Katakfeherbenhattal képek:
 * azok más szekciók portréi, a sín ajtónként saját felvételt kap.
 * A fájlnevek történeti (`help-zart-…`); a látogatói címke nem ezekből jön.
 */
export const HOME_HELP_PHOTO_FILES = [
  'help-zart-img-7541.jpg',
  'help-nyilo-syl-9297.jpg',
  'help-nyitott-syl-9260.jpg',
] as const

export const HOME_HELP_STATES: readonly HomeHelpStateRow[] = [
  {
    number: '1',
    title: 'Rendelői kezelések',
    osszefoglalo: 'Személyes kezelés a stúdióban.',
    body: 'Akut panasz, műtét utáni időszak vagy hosszú ideje tartó fájdalom esetén a stúdióban várunk: gyógytorna, manuálterápia és a hozzád igazított kiegészítő terápiák. A pontos tervet vizsgálat után állítjuk össze; ez nem diagnózis a webről.',
    felirat: 'Tovább a kezelésekre',
    url: '/szolgaltatasok',
    ujAblakban: false,
  },
  {
    number: '2',
    title: 'Otthoni program',
    osszefoglalo: 'Videókurzus, a saját ritmusodban.',
    body: 'Ha otthon szeretnél gyakorolni, az Otthoni KézRehab Program lépésről lépésre visz. A teljes tartalom és az ár a kurzusoldalon van: ígéret és százalék nélkül.',
    felirat: ctaLabel('course-list-open'),
    url: '/kurzusok',
    ujAblakban: false,
  },
  {
    number: '3',
    title: 'Szakmai képzések',
    osszefoglalo: 'Akkreditált kézkurzus szakembereknek.',
    body: 'A ProBody Stúdióval együtt tartott tantermi kézkurzus a kéz, a csukló és a könyök rehabilitációs lehetőségeiről szól: gyógytornászoknak, orvosoknak, erőnléti és szakági edzőknek.',
    felirat: ctaLabel('workshop-open'),
    url: PROFESSIONAL_TRAINING_URL,
    ujAblakban: true,
  },
]

const titlesOf = (rows: readonly { title?: unknown }[]): string[] =>
  rows.map((row) => (typeof row.title === 'string' ? row.title : ''))

const urlsOf = (rows: readonly { url?: unknown }[]): string[] =>
  rows.map((row) => (typeof row.url === 'string' ? row.url : ''))

const osszefoglalokOf = (rows: readonly { osszefoglalo?: unknown }[]): string[] =>
  rows.map((row) => (typeof row.osszefoglalo === 'string' ? row.osszefoglalo : ''))

/** Élő, háromsoros Rendelői / Otthoni / Szakmai felosztás a kanonikus célokkal. */
export const isLegacyThreeWayHomeHelp = (rows: unknown): boolean => {
  if (!Array.isArray(rows) || rows.length !== 3) return false
  const titles = titlesOf(rows)
  const urls = urlsOf(rows)
  return (
    titles[0] === LEGACY_HOME_HELP_TITLES[0] &&
    titles[1] === LEGACY_HOME_HELP_TITLES[1] &&
    titles[2] === LEGACY_HOME_HELP_TITLES[2] &&
    urls[0] === LEGACY_HOME_HELP_URLS[0] &&
    urls[1] === LEGACY_HOME_HELP_URLS[1] &&
    urls[2] === LEGACY_HOME_HELP_URLS[2]
  )
}

/**
 * Már a REV C három szolgáltatás-ajtaja a kanonikus összegzéssel.
 * A cím önmagában nem elég: az élő háromoszlopos tábla ugyanezeket a címeket viseli.
 */
export const isHomeHelpRailRows = (rows: unknown): boolean => {
  if (!Array.isArray(rows) || rows.length !== 3) return false
  const titles = titlesOf(rows)
  const osszefoglalok = osszefoglalokOf(rows)
  return (
    titles[0] === HOME_HELP_STATE_TITLES[0] &&
    titles[1] === HOME_HELP_STATE_TITLES[1] &&
    titles[2] === HOME_HELP_STATE_TITLES[2] &&
    osszefoglalok[0] === HOME_HELP_STATES[0].osszefoglalo &&
    osszefoglalok[1] === HOME_HELP_STATES[1].osszefoglalo &&
    osszefoglalok[2] === HOME_HELP_STATES[2].osszefoglalo
  )
}

/** REV C sín, még a kézállapot-címkékkel (Zárt / Nyíló / Nyitott). */
export const isClosedHandHomeHelpRail = (rows: unknown): boolean => {
  if (!Array.isArray(rows) || rows.length !== 3) return false
  const titles = titlesOf(rows)
  return (
    titles[0] === CLOSED_HAND_HOME_HELP_TITLES[0] &&
    titles[1] === CLOSED_HAND_HOME_HELP_TITLES[1] &&
    titles[2] === CLOSED_HAND_HOME_HELP_TITLES[2]
  )
}

export interface HomeHelpRailRow {
  readonly number: string
  readonly title: (typeof HOME_HELP_STATE_TITLES)[number]
  readonly osszefoglalo: string
  readonly body: string
  readonly felirat: string
  readonly url: string
  readonly ujAblakban: boolean
  readonly photo?: number
}

/** Seed- és H08-sorok: kanonikus C-szöveg, opcionális média-id a sín-fotóra. */
export const homeHelpRailRows = (photos: readonly (number | undefined)[] = []): HomeHelpRailRow[] =>
  HOME_HELP_STATES.map((state, index) => {
    const photo = photos[index]
    return photo !== undefined
      ? { ...state, number: String(index + 1), photo }
      : { ...state, number: String(index + 1) }
  })

/**
 * Az élő kezdőlap 2026-09 előtti háromsora. A H08 konverzió és a published
 * fixture ebből ismeri fel a Rendelői / Otthoni / Szakmai felosztást.
 * A törzsszöveg szándékosan a régi seed, mert a felismerés címen+URL-en megy.
 */
export const LEGACY_HOME_HELP_ROWS = [
  {
    number: '01',
    title: LEGACY_HOME_HELP_TITLES[0],
    body: 'Akut sérülések, műtét utáni állapotok és krónikus fájdalmak esetén a mozgásterápia a gyógyulás alappillére. Gyógytornával, manuálterápiával és egy sor kiegészítő terápiával várunk a stúdiónkban.',
    felirat: 'Nézd meg a kezeléseket',
    url: LEGACY_HOME_HELP_URLS[0],
    ujAblakban: false,
  },
  {
    number: '02',
    title: LEGACY_HOME_HELP_TITLES[1],
    body: 'Ha nem tudsz eljutni kezelésre, vagy egyszerűen csak megpróbálnád előbb magadnak megoldani a kézproblémádat, akkor ezeket neked készítettük. Az átfogó kézrehabilitációs programban bárhol, bármikor végezhető megoldásokat találsz.',
    felirat: 'Nézd meg a kurzusokat',
    url: LEGACY_HOME_HELP_URLS[1],
    ujAblakban: false,
  },
  {
    number: '03',
    title: LEGACY_HOME_HELP_TITLES[2],
    body: 'Akkreditált tantermi kézkurzusunkat a ProBody Stúdióval együttműködve hoztuk létre a kéz, a csukló- és könyökízület rehabilitációs lehetőségeiről gyógytornászoknak, orvosoknak, erőnléti és szakági edzőknek.',
    felirat: 'Nézd meg a kézworkshopot',
    url: LEGACY_HOME_HELP_URLS[2],
    ujAblakban: true,
  },
] as const

/**
 * A C-sín panel-fotók publikus tartaléka. Az élő CMS `elrendezes` mezője a
 * 20260906-os migráció után is üres marad a kitöltött kezdőlapon
 * (`ensureHomeLayout` soha nem ír felül szerkesztői sort), ezért a sín
 * megjelenítés nem várhat Payload-média id-re. A fájlok a seed
 * `content/home-images/brand` másolatai.
 */
export const HOME_HELP_PUBLIC_DIR = '/media/help-rail'

export const HOME_HELP_PHOTO_ALTS = [
  'Mosolygó gyógytornász fehér garbóban, tornalabdának támaszkodva, mellettük fehér orchidea',
  'Mosolygó gyógytornász világoskék ingben a padlón ül, mellettük kézcsont-modell és könyvek',
  'Mosolygó gyógytornász fehér ruhában kanapén ül, táblagéppel a kezében, mellettük kézcsont-modell',
] as const

export const HOME_HELP_PHOTO_SIZE = [
  { width: 876, height: 1400 },
  { width: 933, height: 1400 },
  { width: 933, height: 1400 },
] as const

export const homeHelpFallbackMedia = (index: number): Media => {
  const file = HOME_HELP_PHOTO_FILES[index]
  const alt = HOME_HELP_PHOTO_ALTS[index]
  const size = HOME_HELP_PHOTO_SIZE[index]
  if (file === undefined || alt === undefined || size === undefined) {
    throw new Error('A sín-tartalékfotó indexe a három zárolt képén kívül esik.')
  }
  return {
    id: 87001 + index,
    alt,
    url: `${HOME_HELP_PUBLIC_DIR}/${file}`,
    filename: file,
    mimeType: 'image/jpeg',
    width: size.width,
    height: size.height,
    createdAt: '',
    updatedAt: '',
  }
}

const populatedHelpPhoto = (value: unknown): Media | undefined => {
  if (typeof value !== 'object' || value === null || !('url' in value)) return undefined
  const url = (value as { url?: unknown }).url
  return typeof url === 'string' && url.length > 0 ? (value as Media) : undefined
}

/** A kezdőlap háromajtós segítség-szekciója: régi tábla, zárt-kéz sín vagy kanonikus sín. */
export const isConvertibleHomeHelpServices = (block: {
  blockType?: unknown
  title?: unknown
  rows?: unknown
}): boolean => {
  if (block.blockType !== 'services') return false
  if (
    isLegacyThreeWayHomeHelp(block.rows) ||
    isHomeHelpRailRows(block.rows) ||
    isClosedHandHomeHelpRail(block.rows)
  ) {
    return true
  }
  // Élő CMS: a cím és a három ajtócímke megvan, az URL-t a szerkesztő
  // módosíthatta (H08 a törzset is írta). A sín UI ettől még jár.
  return (
    block.title === HOME_HELP_TITLE &&
    Array.isArray(block.rows) &&
    block.rows.length === 3 &&
    titlesOf(block.rows as readonly { title?: unknown }[]).every(
      (title, index) => title === HOME_HELP_STATE_TITLES[index],
    )
  )
}

const withFallbackHelpPhotos = (
  rows: NonNullable<BlockServices['rows']>,
): NonNullable<BlockServices['rows']> =>
  rows.map((row, index) => ({
    ...row,
    photo: populatedHelpPhoto(row.photo) ?? homeHelpFallbackMedia(index),
  }))

/**
 * Kezdőlapi megjelenítés: a régi háromoszlopos tábla a C-sín UI-t kapja,
 * a szekció indexe változatlan. A `/szolgaltatasok` tábla nem ezen a
 * függvényen megy át — azt a `presentSzolgaltatasokLayout` zárja.
 * A kezdőlap: `HomeView` és a `/kezdolap` slug a `[slug]` oldalon.
 *
 * Sorrend: WCAG 2.2 SC 1.3.2 (Meaningful Sequence) — a DOM-sorrend marad a
 * CMS sorrendje, a sín csak a régi 3-oszlopos helyén jelenik meg.
 * https://www.w3.org/WAI/WCAG22/Understanding/meaningful-sequence.html
 * NN/g: a látogató a lap tetején keresi a fő tartalmat (F-alakú minta).
 * https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content-discovered/
 * GOV.UK: a fontos tartalom elöl.
 * https://www.gov.uk/guidance/content-design/writing-for-gov-uk
 */
export const presentHomeHelpServicesBlock = (block: BlockServices): BlockServices => {
  if (!isConvertibleHomeHelpServices(block)) return block
  const liveRows = block.rows ?? []
  const settings = block.sectionSettings ?? {}
  const presentedSettings = {
    ...settings,
    hatter: settings.hatter === 'sotet' ? ('sotet' as const) : ('tint' as const),
  }

  if (isHomeHelpRailRows(liveRows)) {
    return {
      ...block,
      elrendezes: 'sin',
      lead: block.lead?.trim() || HOME_HELP_LEAD,
      sectionSettings: presentedSettings,
      rows: withFallbackHelpPhotos(liveRows),
    }
  }

  return {
    ...block,
    elrendezes: 'sin',
    title: HOME_HELP_TITLE,
    lead: HOME_HELP_LEAD,
    eyebrow: '',
    sectionSettings: presentedSettings,
    rows: HOME_HELP_STATES.map((state, index) => {
      const live = liveRows[index]
      return {
        id: live?.id,
        number: state.number,
        title: state.title,
        osszefoglalo: state.osszefoglalo,
        body: state.body,
        felirat: state.felirat,
        url: state.url,
        ujAblakban: state.ujAblakban,
        photo: populatedHelpPhoto(live?.photo) ?? homeHelpFallbackMedia(index),
      }
    }),
  }
}

/**
 * A /szolgaltatasok „Szolgáltatásaink" ajtó-blokkja: három sor, mindegyik
 * saját CTA-val (felirat + URL). Ez a lap döntés-szekciója („melyik út való
 * nekem?"); a lap többi services-blokkja (pl. a kétsoros „Ezért fogod
 * imádni", CTA nélkül) NEM ajtó-blokk, az tábla marad.
 */
export const isSzolgaltatasokAjtoBlock = (block: {
  blockType?: unknown
  rows?: unknown
}): boolean => {
  if (block.blockType !== 'services') return false
  if (!Array.isArray(block.rows) || block.rows.length !== 3) return false
  return (block.rows as readonly { felirat?: unknown; url?: unknown }[]).every(
    (row) =>
      typeof row.felirat === 'string' &&
      row.felirat.trim().length > 0 &&
      typeof row.url === 'string' &&
      row.url.trim().length > 0,
  )
}

/**
 * A /szolgaltatasok szekciósora (WP25, tulajdonosi kör 2026-09-07: „az »Így
 * segítünk / Szolgáltatásaink« doboz nagyon csúnya, abszolút nem illik a
 * stílusunkba"; és a 3. kör: „a miben segíthetünk és az így tudunk segíteni
 * lényegében ugyanaz, szóval eszerint legyen a kinézete").
 *
 * DÖNTÉS: az ajtó-blokk itt is a SÍN + PANEL elrendezést kapja, a lap SAJÁT
 * soraival (sorcímek, törzs, CTA-feliratok és URL-ek, horgony változatlan;
 * a tartalom nem módosul, csak a megjelenítés). A régi tábla a lapon mérve
 * (1440 px): egy 468 px magas, jobbra zárt fotó fölött három 52ch-s
 * szöveghasáb aláhúzott szöveglinkkel — a kezdőlap és a /rolunk ugyanezt a
 * három ajtót már a sínnel mutatja, így ugyanaz a három út két különböző
 * felületi nyelven állt a lapokon. Ugyanaz a funkció = ugyanaz a felület:
 * WCAG 2.2 SC 3.2.4 Consistent Identification
 * (https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html),
 * NN/g Consistency and Standards (10 heurisztika, #4;
 * https://www.nngroup.com/articles/consistency-and-standards/), Jakob törvénye
 * (a látogató a kezdőlapon tanult mintát viszi tovább).
 * A (b) út (a táblát a panel kártya-nyelvére festeni) egy HARMADIK változatot
 * hozott volna létre ugyanarra a három ajtóra, ezért nem az.
 *
 * Fotó: a sorok CMS-fotója, ha van; különben a kezdőlapi sín zárolt
 * tartalék-fotói ajtónként (ugyanaz a három út, ugyanaz a három kép), a
 * három ajtón túl a panel fotó-helykitöltője. A blokk egyetlen tábla-fotója
 * (`image`) a sínen nem jelenik meg (a Services sín-ága nem használja).
 * Háttér: a sín-sáv help-paper a tint osztály mögött, mint a kezdőlapon; a
 * szerkesztő sötét választása marad.
 */
export const presentSzolgaltatasokLayout = (
  layout: NonNullable<Page['layout']>,
): NonNullable<Page['layout']> =>
  layout.map((block) => {
    if (block.blockType !== 'services') return block
    if (!isSzolgaltatasokAjtoBlock(block)) return { ...block, elrendezes: 'tabla' as const }
    const settings = block.sectionSettings ?? {}
    return {
      ...block,
      elrendezes: 'sin' as const,
      sectionSettings: {
        ...settings,
        hatter: settings.hatter === 'sotet' ? ('sotet' as const) : ('tint' as const),
      },
      rows: (block.rows ?? []).map((row, index) => {
        const photo = populatedHelpPhoto(row.photo)
        if (photo) return { ...row, photo }
        return index < HOME_HELP_PHOTO_FILES.length
          ? { ...row, photo: homeHelpFallbackMedia(index) }
          : row
      }),
    }
  })

/**
 * A sín ELŐTTI szekció kis felső felirata (tulajdonosi kör, 2026-09-07).
 * Az „Erre számíthatsz velünk" tábla és az „Így tudunk segíteni" sín címe
 * azonos L méretű, azonos bal margón állt; az eyebrow a tábla címének ad
 * saját szintet, hogy a két H2 ne egy tömbként olvasódjon.
 * NN/g Visual Hierarchy: a szint méret + súly + elhelyezés + csoportosítás.
 * https://www.nngroup.com/articles/visual-hierarchy-ux-definition/
 * A szerkesztő saját eyebrow-ja ezt felülírja; a `usps` blokknak nincs ilyen mezője.
 */
export const HOME_USPS_EYEBROW = 'Miért mi'

type HomeBlock = NonNullable<Page['layout']>[number]

/** A már megjelenítésre kész (presentált) sín-blokk. */
const isHomeHelpRailBlock = (block: HomeBlock | undefined): boolean =>
  block?.blockType === 'services' && block.elrendezes === 'sin'

/** A CMS „Fehér" (vagy kitöltetlen) hattere a lap paper földje. */
const isPaperBackground = (hatter: unknown): boolean =>
  hatter === undefined || hatter === null || hatter === 'feher'

/**
 * A sín KÖZVETLENÜL ELŐTTI szekció sávváltása (tulajdonosi kör, 2026-09-07:
 * „valahogyan legyen jobban elkülönítve").
 *
 * Mérve 1440 px-en: az „Erre számíthatsz velünk" tábla a paper földön
 * (#f6f9fc), a sín a help-paperen (#f4f8fd) állt; a két háttér különbsége
 * szemmel nem látszik, a tábla fotója pedig 0 px-re ért a sín tetejéhez.
 * A szomszédos szekciók így egyetlen régióként olvasódtak.
 *
 * A megoldás a szekció-rendszer terv váltakozó paper/tint ritmusa
 * (docs/szekcio-rendszer-terv.md), a `hatter` mező saját admin-leírása
 * szerint („váltogasd a fehéret és a világoskéket, hogy az egymás alatti
 * szekciók jól elkülönüljenek"): a sín előtti tábla vagy usps blokk a tint
 * sávra kerül, ha a szerkesztő paperen hagyta. A tint (#e6f0f8) és a
 * help-paper (#f4f8fd) már mérhető tónuslépés; a sín saját palettája
 * (services-sin.css) érintetlen.
 *
 * Gestalt közös régió + közelség: az eltérő háttér külön csoportot jelöl,
 * a határ pedig ott van, ahol a szín vált.
 * https://www.nngroup.com/articles/common-region/
 * https://www.nngroup.com/articles/gestalt-proximity/
 * Material 3 tónusos felületek: a szomszédos felület egy tónuslépés.
 * https://m3.material.io/styles/color/roles
 * GOV.UK spacing: a szekciók közti térköz a rendszer skálájából jön.
 * https://design-system.service.gov.uk/styles/spacing/
 *
 * Kontraszt a tinten (tokens.css jegyzőkönyv): ink 13,53:1, ink-soft 8,05:1,
 * accent-deep (eyebrow, sorszám) 4,72:1 — SC 1.4.3 teljesül.
 *
 * A szerkesztő tint vagy sötét választását nem írjuk felül; a sötét sáv
 * eyebrow-ja az on-dark-muted tokent viszi (services.css).
 */
const presentBlockBeforeHomeHelp = (block: HomeBlock): HomeBlock => {
  if (block.blockType === 'usps') {
    const settings = block.sectionSettings ?? {}
    return isPaperBackground(settings.hatter)
      ? { ...block, sectionSettings: { ...settings, hatter: 'tint' as const } }
      : block
  }
  if (block.blockType !== 'services' || block.elrendezes === 'sin') return block
  const settings = block.sectionSettings ?? {}
  const eyebrow = block.eyebrow?.trim() ?? ''
  const hatter = isPaperBackground(settings.hatter) ? ('tint' as const) : settings.hatter
  if (eyebrow.length > 0 && hatter === settings.hatter) return block
  return {
    ...block,
    eyebrow: eyebrow.length > 0 ? block.eyebrow : HOME_USPS_EYEBROW,
    sectionSettings: { ...settings, hatter },
  }
}

/**
 * A kezdőlap szekciósora: a segítség-blokk sínné válik, a többi indexen marad;
 * a sín előtti szomszéd sávot vált, hogy a két szekció határa látsszon.
 */
export const presentHomeLayout = (
  layout: NonNullable<Page['layout']>,
): NonNullable<Page['layout']> => {
  const presented = layout.map((block) =>
    block.blockType === 'services' ? presentHomeHelpServicesBlock(block) : block,
  )
  return presented.map((block, index) =>
    isHomeHelpRailBlock(presented[index + 1]) ? presentBlockBeforeHomeHelp(block) : block,
  )
}
