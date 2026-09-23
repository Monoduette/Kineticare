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
 *
 * A kanonikus szöveg a seed és az üres CMS-mező pótléka. A kezdőlapon a
 * megjelenítés (`presentHomeHelpServicesBlock`) a CMS-ben mentett szöveget
 * mutatja, a konstansokkal csak az üresen hagyott mezőt tölti ki.
 *
 * ELRENDEZÉS (H15, A4, 2026-09-23): a sín vagy tábla döntése a blokk
 * `elrendezes` mezőjéé (`mentettElrendezes`). A cím- és URL-alapú felismerés
 * (`isConvertibleHomeHelpServices`, `isSzolgaltatasokAjtoBlock`) csak a mező
 * nélküli, régi adatra tartalék. Korábban a kód a mezőtől függetlenül váltott,
 * így az admin „Tábla” és „Fehér” értéket mutatott, a lapon pedig sín és
 * világoskék állt. Ugyanaz a vezérlő ugyanazt jelentse (WCAG 2.2 SC 3.2.4
 * Consistent Identification:
 * https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html),
 * és a rendszer állapota a vezérlőn látsszon (NN/g, 10 Usability Heuristics,
 * #1 Visibility of System Status és #2 Match Between System and the Real
 * World: https://www.nngroup.com/articles/ten-usability-heuristics/).
 * ÉLESÍTÉS: ez a kódváltás CSAK ugyanabban a deployban mehet ki, mint a
 * src/scripts/sin-elrendezes-kitoltes.ts szabály éles futtatása (az élő
 * kezdőlap és /szolgaltatasok ajtó-blokkja ma „tabla” értéket visel).
 */

import type { BlockServices, Media, Page } from '../payload-types'
import { ctaLabel } from './cta-vocabulary'
import { PROFESSIONALS_MENU_PATH, PROFESSIONAL_TRAINING_URL } from './menu-seed'

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
 * A sín 2026-09-22 ELŐTTI fotói a Drive-anyagból (IMG_7541, SYL_9297,
 * SYL_9260; a fájlnevek a REV C kézállapot-címkéit őrzik). Kódból már nem
 * hivatkozunk rájuk, de a seed-mappában maradnak (`HOME_IMAGES`): a /rolunk
 * sínjének élő Médiatár-rekordjai (help-zart-img-7541.webp és társai) ezekből
 * készültek, és a Volume-helyreállításnak (src/lib/media-restore.ts) forrás
 * kell hozzájuk. A tartalomjob `harom-ajto-fotok` szabálya KIZÁRÓLAG az ezekre
 * mutató sor-fotókat cseréli az új képekre.
 */
export const LEGACY_HOME_HELP_PHOTO_FILES = [
  'help-zart-img-7541.jpg',
  'help-nyilo-syl-9297.jpg',
  'help-nyitott-syl-9260.jpg',
] as const

/** Egy sín-ajtó fotója: fájl, alt, valós méret és a kivágás fókuszpontja. */
export interface HomeHelpPhoto {
  /** A fájl neve a `public/media/help-rail` és a `content/home-images/brand` mappában. */
  readonly file: string
  readonly alt: string
  /** A fájl valós pixelmérete (sharp-pal mérve, őr-teszt védi). */
  readonly width: number
  readonly height: number
  /**
   * A kivágás fókuszpontja a Payload Media `focalX`/`focalY` mezőjének
   * értelmében, százalékban. A panel a fotót `object-fit: cover`-rel vágja,
   * és ezt a pontot `object-position`-ként kapja (Services.tsx).
   */
  readonly focalX: number
  readonly focalY: number
}

/**
 * A sín ajtónkénti fotói, AJTÓ szerinti sorrendben (0 rendelő, 1 otthoni
 * program, 2 szakmai képzés; `homeHelpDoorIndex`).
 *
 * 2026-09-22, tulajdonosi kérés: a három ajtó a saját tevékenységét mutassa,
 * „mindenhol" (kezdőlap, /rolunk, /szolgaltatasok). Mindhárom kép 933×1400-as,
 * metaadat nélküli sRGB JPEG, felskálázás nélkül:
 *  0. rendelő: gumiszalagos csuklókezelés, a fotózás `_MG_0362` felvétele;
 *  1. otthoni program: Kocsis Kata és Kiss Kata a videókurzus stúdiójában
 *     (a kurzusvideó képkockája, ugyanaz a stúdió és ugyanaz a két oktató,
 *     mint a /kurzusok termékkártyáján);
 *  2. szakmai képzés: a kéz anatómiája táblagépen, `_MG_0450`.
 * Szándékosan nem a `katak-labdaval` / `katak-team` / Katakfeherbenhattal
 * képek: azok más szekciók képei, a sín ajtónként saját felvételt kap.
 * A tevékenységet mutató, valódi fotót a látogató megnézi, a díszítő képet
 * átugorja (NN/g, Photos as Web Content:
 * https://www.nngroup.com/articles/photos-as-web-content/), a link képe pedig
 * a céloldal tartalmát ígérje (NN/g, Information Scent:
 * https://www.nngroup.com/articles/information-scent/).
 *
 * FÓKUSZPONT (a kivágás helye). A panel-keret asztalon 4:5 (1440: 327×408,
 * 1024: 204×255 CSS px), mobilon 1:1 (390: 276×276, 320: 206×206). A 2:3-as
 * képből a 4:5 keret a magasság 83%-át, az 1:1 keret 67%-át mutatja; a
 * függőleges fókusz dönti el, melyik sáv marad. Forráspixelben (1400 magas):
 *  0. 50% 40%: 1:1-ben y 187–1120, benne a hüvelykujj hegye (y 258) és a
 *     húzó ököl (y ≤ 1100); 4:5-ben y 93–1260;
 *  1. 50% 20%: 1:1-ben y 93–1026, a fejek y ≈ 155-től indulnak, mindkét arc
 *     egész; 50%-on (y 233-tól) a bal fej teteje levágódna;
 *  2. 50% 15%: 1:1-ben y 70–1003, benne a tok felső sarka (y 108) és alja
 *     (y 958); 50%-on a felső sarok levágódna.
 * A pont a KÉPHEZ tartozik, nem az ajtóhoz: ezért a Media `focalX`/`focalY`
 * mezője viszi (ugyanaz a mező, amit a szerkesztő az adminban a
 * fókuszpont-választóval állít; Payload, Crop and Focal Point Selector:
 * https://payloadcms.com/docs/upload/overview#crop-and-focal-point-selector),
 * így egy szerkesztő által feltöltött másik képnél a saját pontja érvényes.
 * Az `object-position` a képet a keretben igazítja, a százalék a
 * `background-position` szerint oldódik fel (W3C CSS Images 3:
 * https://www.w3.org/TR/css-images-3/#the-object-position; MDN:
 * https://developer.mozilla.org/en-US/docs/Web/CSS/object-position).
 */
export const HOME_HELP_PHOTOS = [
  {
    file: 'help-rendelo-szalag.jpg',
    alt: 'Gyógytornász kék gumiszalagot feszít a páciens csuklóján.',
    width: 933,
    height: 1400,
    focalX: 50,
    focalY: 40,
  },
  {
    file: 'help-otthoni-video.jpg',
    alt: 'Kocsis Kata és Kiss Kata a videókurzus stúdiójában.',
    width: 933,
    height: 1400,
    focalX: 50,
    focalY: 20,
  },
  {
    file: 'help-szakmai-tablet.jpg',
    alt: 'Táblagépen a kéz izmai, inai és idegei, a toll a csuklóra mutat.',
    width: 933,
    height: 1400,
    focalX: 50,
    focalY: 15,
  },
] as const satisfies readonly HomeHelpPhoto[]

/** A sín fotóinak fájlnevei ajtó szerint (seed, /rolunk-visszaépítés, tartalék). */
export const HOME_HELP_PHOTO_FILES: readonly (typeof HOME_HELP_PHOTOS)[number]['file'][] =
  HOME_HELP_PHOTOS.map((photo) => photo.file)

export const HOME_HELP_STATES: readonly HomeHelpStateRow[] = [
  {
    number: '1',
    title: 'Rendelői kezelések',
    osszefoglalo: 'Személyes kezelés a stúdióban.',
    body: 'Akut panasz, műtét utáni időszak vagy hosszú ideje tartó fájdalom esetén a stúdióban várunk: gyógytorna, manuálterápia és a hozzád igazított kiegészítő terápiák. A pontos tervet vizsgálat után állítjuk össze.',
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
 * A C-sín panel-fotók publikus tartaléka. Az élő sín-sorok fotó-mezője
 * üres lehet (a kitöltött kezdőlapot az `ensureHomeLayout` soha nem írja
 * felül), ezért a sín megjelenítés nem várhat Payload-média id-re. A fájlok
 * a seed `content/home-images/brand` másolatai.
 */
export const HOME_HELP_PUBLIC_DIR = '/media/help-rail'

/**
 * Az ajtó (0–2) kódbeli tartalék-fotója Media alakban, a fókuszponttal együtt:
 * ezt kapja a sor, ha a CMS-ben a fotó mezője üres.
 */
export const homeHelpFallbackMedia = (index: number): Media => {
  const photo: HomeHelpPhoto | undefined = HOME_HELP_PHOTOS[index]
  if (photo === undefined) {
    throw new Error('A sín-tartalékfotó indexe a három ajtó képén kívül esik.')
  }
  return {
    id: 87001 + index,
    alt: photo.alt,
    url: `${HOME_HELP_PUBLIC_DIR}/${photo.file}`,
    filename: photo.file,
    mimeType: 'image/jpeg',
    width: photo.width,
    height: photo.height,
    focalX: photo.focalX,
    focalY: photo.focalY,
    createdAt: '',
    updatedAt: '',
  }
}

/**
 * A /szolgaltatasok 1. ajtajának (Rendelői kezelések) tartalék-fotója (WP51,
 * tulajdonosi kör 2026-09-19: „ide is szeretnénk egy képet magunkról kezelés
 * közben"). WP54 (tulajdonosi 2. kör, 2026-09-19): a fotózás `_MG_0430`
 * felvétele (Kiss Kata mosolyogva kezel egy csuklót; manifest
 * `services-treatment`, 1067×1600, álló, mint a panel fotó-hasábja) váltja
 * a korábbi, arc nélküli kéz-részletet: az arc a kérés lényege („képet
 * magunkról"). A személy a régi oldal névvel jelölt portréjával
 * (`KissKataelegans`) azonosítva, ezért az alt nevesít. A CMS „Panel fotója"
 * mező ezt felülírja; a kezdőlap sínje érintetlen (ott a három portré marad).
 * NN/g Photos as Web Content: a tevékenységet mutató, valódi fotó
 * informatív, a portré ismétlése ugyanazon a lapon nem
 * (https://www.nngroup.com/articles/photos-as-web-content/): ugyanez a
 * tanulmány méri, hogy a látogató a valódi embert mutató fotót megnézi, a
 * stock-arcot átugorja; Apple HIG, Images: a kép a tartalom értelmét vigye,
 * ne díszítsen
 * (https://developer.apple.com/design/human-interface-guidelines/images);
 * WCAG 2.2 SC 1.1.1: az alt azt írja le, ami a képen van, névvel, ha a név a
 * tartalom része
 * (https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html).
 *
 * 2026-09-22 (tulajdonosi kérés, „mindenhol"): a WP54-es döntést a
 * tulajdonos felülírta. A rendelői ajtó MINDEN lapon ugyanazt a képet
 * mutatja, a kezdőlapi sín gumiszalagos kezelés-fotóját
 * (`HOME_HELP_PHOTOS[0]`), ezért ez a konstans ma a sín 0. tartaléka. A
 * kezelés közbeni `treatment-wrist-smile-1600.webp` a Médiatárban és a
 * manifestben marad (más szekció választhatja), csak ez az ajtó nem
 * hivatkozik rá. Ugyanaz az ajtó két lapon ugyanazzal a képpel: WCAG 2.2
 * SC 3.2.4 Consistent Identification
 * (https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html).
 */
export const SZOLGALTATASOK_KEZELES_FOTO: Media = homeHelpFallbackMedia(0)

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

/** A services blokk két elrendezése (src/blocks/services.ts `elrendezes`). */
export type ServicesElrendezes = 'sin' | 'tabla'

/**
 * A blokkon MENTETT elrendezés. Hiányzó, null vagy ismeretlen értéknél null:
 * ez a mező előtti, régi adat, ott a felismerés (heurisztika) a tartalék.
 */
export const mentettElrendezes = (value: unknown): ServicesElrendezes | null =>
  value === 'sin' || value === 'tabla' ? value : null

/**
 * Kezdőlap: sínként jelenik-e meg a services blokk. A mentett `elrendezes`
 * dönt; mező nélkül a háromajtós felismerés (`isConvertibleHomeHelpServices`).
 */
export const kezdolapiSinE = (block: {
  blockType?: unknown
  title?: unknown
  rows?: unknown
  elrendezes?: unknown
}): boolean => {
  if (block.blockType !== 'services') return false
  const mentett = mentettElrendezes(block.elrendezes)
  return mentett !== null ? mentett === 'sin' : isConvertibleHomeHelpServices(block)
}

/**
 * Melyik AJTÓ egy sín-sor: 0 = rendelő, 1 = otthoni program, 2 = szakmai
 * képzés. A sor JELENTÉSÉBŐL dől el (a címe vagy a CTA-célja alapján), NEM a
 * pozíciójából: ha a szerkesztő átrendezi a `rows` tömböt, az ikon és a
 * tartalék-fotó a sorral megy (Codex, 2026-09-19). Ha sem a cím, sem az URL
 * nem ismerhető fel, a pozíció marad a tartalék (a három ajtó körbejár).
 */
export const homeHelpDoorIndex = (
  row: { title?: unknown; url?: unknown },
  index: number,
): 0 | 1 | 2 => {
  const title = typeof row.title === 'string' ? row.title.trim().toLocaleLowerCase('hu') : ''
  const url = typeof row.url === 'string' ? row.url.trim() : ''
  const path = url.split(/[?#]/, 1)[0]?.replace(/\/+$/, '') ?? ''
  const cimek = HOME_HELP_STATE_TITLES.map((cim) => cim.toLocaleLowerCase('hu'))
  const cimIndex = cimek.indexOf(title)
  if (cimIndex === 0 || cimIndex === 1 || cimIndex === 2) return cimIndex
  if (path === '/szolgaltatasok' || path.startsWith('/szolgaltatasok#')) return 0
  if (path === '/kurzusok' || path.startsWith('/kurzusok/')) return 1
  if (path === PROFESSIONALS_MENU_PATH || url === PROFESSIONAL_TRAINING_URL) return 2
  const marad = ((index % 3) + 3) % 3
  return marad === 0 ? 0 : marad === 1 ? 1 : 2
}

/** A CMS szöveges mezője, ha valóban ki van töltve (nem üres, nem csak szóköz). */
const cmsSzoveg = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

type HomeHelpRow = NonNullable<BlockServices['rows']>[number]

/**
 * Egy sín-sor megjelenítése: MINDEN szöveges mező a CMS-é, a kanonikus
 * `HOME_HELP_STATES` csak az üresen hagyott mezőt pótolja (tulajdonosi
 * hibajelentés, 2026-09-22: az adminban mentett „Akut sérülések…” törzs
 * helyett a kódbeli „Akut panasz…” jelent meg). A pótlás az ajtó jelentése
 * (`homeHelpDoorIndex`) szerint megy, nem a pozíció szerint, ugyanúgy, mint a fotónál.
 * A CTA célja és az „új ablakban” jelző együtt jár: ha a CMS-ben van URL,
 * a jelzőt is a CMS adja; üres URL-nél mindkettő a pótlásból jön.
 */
const presentHomeHelpRow = (live: HomeHelpRow, index: number): HomeHelpRow => {
  const door = homeHelpDoorIndex(live, index)
  const fallback = HOME_HELP_STATES[door]
  const cmsUrl = cmsSzoveg(live.url)
  return {
    ...live,
    number: cmsSzoveg(live.number) ?? String(index + 1),
    title: cmsSzoveg(live.title) ?? fallback.title,
    osszefoglalo: cmsSzoveg(live.osszefoglalo) ?? fallback.osszefoglalo,
    body: cmsSzoveg(live.body) ?? fallback.body,
    felirat: cmsSzoveg(live.felirat) ?? fallback.felirat,
    url: cmsUrl ?? fallback.url,
    ujAblakban: cmsUrl !== undefined ? live.ujAblakban === true : fallback.ujAblakban,
    photo: populatedHelpPhoto(live.photo) ?? homeHelpFallbackMedia(door),
  }
}

/**
 * A zárt-kéz sín (REV C, `Zárt` / `Nyíló` / `Nyitott` címkékkel) sora. Ez az
 * alak MAGA az elavult tartalom: a 2026-09-06-i terv kézállapot-szövege,
 * amelyet az ajtó-sín váltott. Ezért itt a szöveg egészében a kanonikus
 * ajtó-szöveg (`HOME_HELP_STATES`), ahogy a konverzió eredetileg is tette;
 * csak a szerkesztő által feltöltött fotó marad. A mai ajtó-sorok és a régi,
 * szerkesztett tábla szövege a CMS-é (`presentHomeHelpRow`).
 *
 * Az ajtót itt a POZÍCIÓ adja, nem a `homeHelpDoorIndex`: a sorok
 * kézállapotot jelölnek, a régi URL-jük nem az új ajtó jelentése (egy
 * `/szolgaltatasok` célú harmadik sorból így két rendelői ajtó lenne). A
 * felismerő (`isClosedHandHomeHelpRail`) a pontos Zárt / Nyíló / Nyitott
 * sorrendet követeli, tehát a pozíció egyértelmű.
 */
const presentClosedHandHomeHelpRow = (live: HomeHelpRow, index: number): HomeHelpRow => {
  const door = index === 0 ? 0 : index === 1 ? 1 : 2
  const state = HOME_HELP_STATES[door]
  return {
    ...live,
    number: state.number,
    title: state.title,
    osszefoglalo: state.osszefoglalo,
    body: state.body,
    felirat: state.felirat,
    url: state.url,
    ujAblakban: state.ujAblakban,
    photo: populatedHelpPhoto(live.photo) ?? homeHelpFallbackMedia(door),
  }
}

/**
 * Kezdőlapi megjelenítés: a sín-elrendezésű services blokk (`kezdolapiSinE`:
 * mentett `sin`, vagy mező nélkül a háromajtós felismerés) a C-sín UI-t
 * kapja, a szekció indexe változatlan. A mentett `tabla` blokk érintetlen
 * marad, akkor is, ha a sorai a három ajtót viszik (H15: a mező nyer). A
 * `/szolgaltatasok` blokkjai nem ezen a függvényen mennek át, azokat a
 * `presentSzolgaltatasokLayout` zárja. A kezdőlap: `HomeView` és a
 * `/kezdolap` slug a `[slug]` oldalon.
 *
 * Tartalom: a megjelenítés CSAK a formát állítja (sín elrendezés, tint
 * sáv); a szöveg a CMS-é. Kis felirat, cím, bevezető és a sorok minden
 * mezője (cím, összegzés, törzs, CTA-felirat, URL, új ablak, fotó) a
 * szerkesztő mentett értéke; a kódbeli kanonikus szöveg csak üres mezőt
 * pótol, hogy üres CMS mellett se essen szét a szekció. Korábban a régi
 * táblát és a zárt-kéz sínt a kód teljes egészében a kanonikus szövegre
 * cserélte, így az admin szerkesztései nem jelentek meg (tulajdonosi
 * hibajelentés, 2026-09-22). Kivétel a zárt-kéz sín: az elavult alak, ezért
 * annak a teljes szövege (szekciócím, bevezető, kis felirat és a sorok) a
 * kanonikus marad (`presentClosedHandHomeHelpRow`).
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
  if (!kezdolapiSinE(block)) return block
  const settings = block.sectionSettings ?? {}
  const zartKezSin = isClosedHandHomeHelpRail(block.rows)
  return {
    ...block,
    elrendezes: 'sin',
    eyebrow: zartKezSin ? '' : (cmsSzoveg(block.eyebrow) ?? ''),
    title: zartKezSin ? HOME_HELP_TITLE : (cmsSzoveg(block.title) ?? HOME_HELP_TITLE),
    lead: zartKezSin ? HOME_HELP_LEAD : (cmsSzoveg(block.lead) ?? HOME_HELP_LEAD),
    sectionSettings: {
      ...settings,
      hatter: settings.hatter === 'sotet' ? ('sotet' as const) : ('tint' as const),
    },
    rows: (block.rows ?? []).map(zartKezSin ? presentClosedHandHomeHelpRow : presentHomeHelpRow),
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
 * /szolgaltatasok: sínként jelenik-e meg a services blokk. A mentett
 * `elrendezes` dönt; mező nélkül az ajtó-felismerés (`isSzolgaltatasokAjtoBlock`).
 */
export const szolgaltatasokSinE = (block: {
  blockType?: unknown
  rows?: unknown
  elrendezes?: unknown
}): boolean => {
  if (block.blockType !== 'services') return false
  const mentett = mentettElrendezes(block.elrendezes)
  return mentett !== null ? mentett === 'sin' : isSzolgaltatasokAjtoBlock(block)
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
 * Fotó: a sorok CMS-fotója, ha van; különben az 1. ajtó a
 * `SZOLGALTATASOK_KEZELES_FOTO` (2026-09-22 óta azonos a kezdőlapi sín
 * rendelői képével), a 2–3. ajtó a kezdőlapi sín tartalék-fotója. A blokk egyetlen tábla-fotója
 * (`image`) a sínen nem jelenik meg (a Services sín-ága nem használja).
 * Háttér: a sín-sáv help-paper a tint osztály mögött, mint a kezdőlapon; a
 * szerkesztő sötét választása marad. Szöveget itt a kód NEM pótol (a kezdőlap
 * sínjével ellentétben): az üres összegzés és bevezető üresen marad.
 *
 * ELRENDEZÉS (H15): a mentett `elrendezes` dönt (`szolgaltatasokSinE`); a
 * mentett `tabla` érintetlen marad, a függvény a mezőt többé nem írja át.
 * Mező nélkül (régi adat) az ajtó-felismerés a tartalék.
 */
export const presentSzolgaltatasokLayout = (
  layout: NonNullable<Page['layout']>,
): NonNullable<Page['layout']> =>
  layout.map((block) => {
    if (block.blockType !== 'services') return block
    if (!szolgaltatasokSinE(block)) return block
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
        // A rendelői ajtó a saját tartalékát kapja (WP51, 2026-09-22 óta a
        // sín képe): a sor jelentése (cím/URL) szerint, nem a pozíciója szerint.
        const ajto = homeHelpDoorIndex(row, index)
        if (ajto === 0) return { ...row, photo: SZOLGALTATASOK_KEZELES_FOTO }
        return { ...row, photo: homeHelpFallbackMedia(ajto) }
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
