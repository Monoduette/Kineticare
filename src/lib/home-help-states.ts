/**
 * Kezdőlapi „Így tudunk segíteni" — REV C sín + panel kanonikus szövege.
 *
 * A három kézállapot (Zárt / Nyíló / Nyitott) a logó ívét követi. A szöveget
 * Pocs + Szerkesztő hagyta jóvá, gondolatjel nélkül. A sín-CTA-k a §3.2
 * szótárból jönnek. A /szolgaltatasok tábla-elrendezése ehhez nem nyúl.
 */

import { ctaLabel } from './cta-vocabulary'
import { COURSE_SOS_KEZRELAX } from './legacy-redirects'

export const HOME_HELP_TITLE = 'Így tudunk segíteni'

export const HOME_HELP_LEAD =
  'A logónk három kézállapotot rajzol ki. Itt ezen az úton igazítunk: megfigyelés alapján, nem diagnózis.'

export const LEGACY_HOME_HELP_TITLES = [
  'Rendelői kezelések',
  'Otthoni program',
  'Szakmai képzések',
] as const

export const LEGACY_HOME_HELP_URLS = [
  '/szolgaltatasok',
  '/kurzusok',
  'https://probodystudio.hu/kez-workshop/',
] as const

export const HOME_HELP_STATE_TITLES = ['Zárt', 'Nyíló', 'Nyitott'] as const

export interface HomeHelpStateRow {
  readonly number: string
  readonly title: (typeof HOME_HELP_STATE_TITLES)[number]
  readonly osszefoglalo: string
  readonly body: string
  readonly felirat: string
  readonly url: string
  readonly ujAblakban: false
}

/**
 * Zárolt sín-fotók a Drive-anyagból (IMG_7541, SYL_9297, SYL_9260).
 * Szándékosan nem a `katak-labdaval` / `katak-team` / Katakfeherbenhattal képek:
 * azok más szekciók portréi, a sín állapotonként saját felvételt kap.
 */
export const HOME_HELP_PHOTO_FILES = [
  'help-zart-img-7541.jpg',
  'help-nyilo-syl-9297.jpg',
  'help-nyitott-syl-9260.jpg',
] as const

export const HOME_HELP_STATES: readonly HomeHelpStateRow[] = [
  {
    number: '1',
    title: 'Zárt',
    osszefoglalo: 'A kéz még inkább összezárva, a mindennapi mozdulat óvatos.',
    body: 'Ha a markolás, a nyitás vagy a terhelés még szűk tartományban van, először kis, biztonságos lépéssel érdemes kezdeni. Az Ingyenes SOS KézRelax ehhez ad azonnal elérhető gyakorlatokat: otthon, a saját tempódban.',
    felirat: ctaLabel('free-sos-named-open'),
    url: COURSE_SOS_KEZRELAX,
    ujAblakban: false,
  },
  {
    number: '2',
    title: 'Nyíló',
    osszefoglalo: 'Már van mozgás, de a tartomány még nem teljes.',
    body: 'Amikor a kéz már nyílik, de a hétköznapi feladatok még töredeznek, a következő lépés a rendszeres, lépésről lépésre épülő otthoni gyakorlás. A kurzusoldalon látod a teljes programot és az árat: ígéret és százalék nélkül.',
    felirat: ctaLabel('course-list-open'),
    url: '/kurzusok',
    ujAblakban: false,
  },
  {
    number: '3',
    title: 'Nyitott',
    osszefoglalo: 'A kéz újra szélesebb tartományban használható.',
    body: 'Ha a cél a tartós mindennapi használat, vagy személyes iránymutatást keresel, egy helyen nézheted át, milyen utak vannak nálunk: rendelő, otthoni program, szakmai út. Te választasz; mi nem sorolunk be diagnózisba.',
    felirat: ctaLabel('services-list-open'),
    url: '/szolgaltatasok',
    ujAblakban: false,
  },
]

const titlesOf = (rows: readonly { title?: unknown }[]): string[] =>
  rows.map((row) => (typeof row.title === 'string' ? row.title : ''))

const urlsOf = (rows: readonly { url?: unknown }[]): string[] =>
  rows.map((row) => (typeof row.url === 'string' ? row.url : ''))

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

/** Már a REV C három kézállapot-sora. */
export const isHomeHelpRailRows = (rows: unknown): boolean => {
  if (!Array.isArray(rows) || rows.length !== 3) return false
  const titles = titlesOf(rows)
  return (
    titles[0] === HOME_HELP_STATE_TITLES[0] &&
    titles[1] === HOME_HELP_STATE_TITLES[1] &&
    titles[2] === HOME_HELP_STATE_TITLES[2]
  )
}

export interface HomeHelpRailRow {
  readonly number: string
  readonly title: (typeof HOME_HELP_STATE_TITLES)[number]
  readonly osszefoglalo: string
  readonly body: string
  readonly felirat: string
  readonly url: string
  readonly ujAblakban: false
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
