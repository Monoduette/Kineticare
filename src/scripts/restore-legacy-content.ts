/**
 * Legacy kineticare.hu tartalom visszaépítése Payload CMS-be (idempotens UPSERT).
 * Média: legacy-content/kepek/; oldalak slug alapján; termékek sku alapján.
 *
 * FIGYELEM: sku = vevőnek megjelenő terméknév (nem gépi cikkszám), lásd courses.ts.
 *
 *   npm run seed:legacy                                    # dry-run (alapértelmezés)
 *   LEGACY_RESTORE_CONFIRM=igen npm run seed:legacy        # hiányzók létrehozása
 *   LEGACY_RESTORE_CONFIRM=igen LEGACY_OVERWRITE=igen …    # meglévő felülírás
 *   LEGACY_RESTORE_CONFIRM=igen LEGACY_ARCHIVE_DEMO=igen … # seed demó depublikálás
 *   LEGACY_RESTORE_CONFIRM=igen LEGACY_LOGOSAV=igen …      # MEGLÉVŐ szekciósor
 *       logósávjainak frissítése: a sajtó-logósor bővítése a négy ellenőrzött
 *       H05-logóval (additív, a régi hat marad), és a /rolunk „Partnereink"
 *       szövegbekezdésének cseréje partner-logósávra (A04). Csak a két
 *       logósáv-blokkhoz nyúl, minden más szekció érintetlen.
 */

import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { getPayload, type Payload } from 'payload'

import {
  ensurePressManifestImages,
  HOME_IMAGES,
  LANDING_ASSETS_DIR,
  PARTNER_LOGO_FILES,
  PRESS_RAIL_FILES,
} from '../lib/home-seed'
import { LEGACY_IMAGES, LEGACY_IMAGES_DIR, type LegacyImage } from '../lib/legacy-images'
import { CLINIC_TREATMENTS_ANCHOR } from '../lib/menu-seed'
import config from '../payload.config'
import type { Page, Product } from '../payload-types'

// ---------------------------------------------------------------------------
// Futtatási kapuk — dry-run alapértelmezés, megerősítés az íráshoz
// ---------------------------------------------------------------------------

/** Egy kapu akkor nyitott, ha a környezeti változó pontosan „igen" (kis/nagybetű mindegy). */
const kapuNyitva = (nev: string): boolean => process.env[nev]?.trim().toLowerCase() === 'igen'

/** Tényleges írás az adatbázisba (enélkül a script csak próbafutást végez). */
const CONFIRM = kapuNyitva('LEGACY_RESTORE_CONFIRM')
/** LÉTEZŐ dokumentum felülírása (a CONFIRM-on felül külön kapu). */
const OVERWRITE = kapuNyitva('LEGACY_OVERWRITE')
/** A seed.ts demó-tartalmának depublikálása (archiválás/draft/rejtés, törlés nélkül). */
const ARCHIVE_DEMO = kapuNyitva('LEGACY_ARCHIVE_DEMO')
/**
 * A MEGLÉVŐ szekciósorok két logósávjának célzott frissítése (H05 + A04). Külön
 * kapu, mert a LEGACY_OVERWRITE az oldalak teljes szövegét írná felül — az
 * operátornak a logósáv-frissítéshez nem szabad ezt kinyitnia.
 */
const LOGOSAV = kapuNyitva('LEGACY_LOGOSAV')
/** Próbafutás: minden döntés lefut és naplózódik, de egyetlen írás sem történik. */
const DRY_RUN = !CONFIRM

/** Futás végi összesítés — a dry-run és az éles futás ugyanezeket számolja. */
const osszesites = {
  letrehozas: 0,
  feluliras: 0,
  depublikalas: 0,
  kihagyas: 0,
}

const naploLetrehozas = (payload: Payload, cimke: string): void => {
  osszesites.letrehozas += 1
  payload.logger.info(`Legacy: ${DRY_RUN ? 'LÉTREHOZNÁ' : 'LÉTREHOZVA'} — ${cimke}`)
}

const naploFeluliras = (payload: Payload, cimke: string): void => {
  osszesites.feluliras += 1
  payload.logger.warn(`Legacy: ${DRY_RUN ? 'FELÜLÍRNÁ' : 'FELÜLÍRVA'} — ${cimke}`)
}

const naploDepublikalas = (payload: Payload, cimke: string): void => {
  osszesites.depublikalas += 1
  payload.logger.info(`Legacy: ${DRY_RUN ? 'DEPUBLIKÁLNÁ' : 'DEPUBLIKÁLVA'} — ${cimke}`)
}

const naploKihagyas = (payload: Payload, cimke: string, indok: string): void => {
  osszesites.kihagyas += 1
  payload.logger.warn(`Legacy: ${DRY_RUN ? 'KIHAGYNÁ' : 'KIHAGYVA'} — ${cimke} (${indok})`)
}

/**
 * Meglévő dokumentum felülírásának kapuja: LEGACY_OVERWRITE nélkül kihagyás +
 * magyar figyelmeztetés. A dry-run csak a szövegen változtat, a döntésen nem —
 * így a próbafutás pontosan azt mutatja, amit az éles futás ugyanezekkel a
 * flagekkel tenne.
 */
const felulirhato = (payload: Payload, cimke: string): boolean => {
  if (OVERWRITE) {
    return true
  }
  naploKihagyas(
    payload,
    cimke,
    'MÁR LÉTEZIK; a script FELÜLÍRNÁ a tartalmát, de LEGACY_OVERWRITE=igen nélkül érintetlen marad — az éles adatbázisról nincs mentés, a felülírás visszavonhatatlan',
  )
  return false
}

// ---------------------------------------------------------------------------
// Lexical richText-építő segédfüggvények (típusosak — a payload-types
// Page['content'] szerkezetét követik; `any` nélkül).
//
// A `textNode`/`paragraph`/`para`/`heading`/`bulletList`/`richText` ötös
// EXPORTÁLT: a jogi oldalak tartalom-modulja (src/lib/legal-content.ts) a
// jogász szó szerinti szövegét ugyanezekkel a csomópont-építőkkel fordítja
// Lexicalra. Külön, párhuzamos építőkészlet azért nem készült, mert a Lexical
// csomópont-alak (mezőnevek, `version`) egyetlen helyen tartható karban — két
// másolat közül az egyik előbb-utóbb elcsúszna.
// ---------------------------------------------------------------------------

export type RichTextContent = Page['content']
export type BlockNode = RichTextContent['root']['children'][number]

export const textNode = (text: string, format = 0): BlockNode => ({
  type: 'text',
  detail: 0,
  format,
  mode: 'normal',
  style: '',
  text,
  version: 1,
})

export const paragraph = (children: BlockNode[]): BlockNode => ({
  type: 'paragraph',
  children,
  direction: null,
  format: '',
  indent: 0,
  version: 1,
})

export const para = (text: string): BlockNode => paragraph([textNode(text)])

export const heading = (tag: 'h2' | 'h3', text: string): BlockNode => ({
  type: 'heading',
  tag,
  children: [textNode(text)],
  direction: null,
  format: '',
  indent: 0,
  version: 1,
})

const link = (url: string, label: string, newTab = false): BlockNode => ({
  type: 'link',
  fields: { linkType: 'custom', url, newTab },
  children: [textNode(label)],
  direction: null,
  format: '',
  indent: 0,
  version: 1,
})

/** Önálló CTA-bekezdés (a serializer ezt gombként rendereli). */
const cta = (url: string, label: string, newTab = false): BlockNode =>
  paragraph([link(url, label, newTab)])

export const bulletList = (items: string[]): BlockNode => ({
  type: 'list',
  listType: 'bullet',
  tag: 'ul',
  start: 1,
  children: items.map((item, index) => ({
    type: 'listitem',
    value: index + 1,
    children: [textNode(item)],
    direction: null,
    format: '',
    indent: 0,
    version: 1,
  })),
  direction: null,
  format: '',
  indent: 0,
  version: 1,
})

const quote = (text: string): BlockNode => ({
  type: 'quote',
  children: [para(text)],
  direction: null,
  format: '',
  indent: 0,
  version: 1,
})

export const richText = (children: BlockNode[]): RichTextContent => ({
  root: {
    type: 'root',
    children,
    direction: null,
    format: '',
    indent: 0,
    version: 1,
  },
})

// ---------------------------------------------------------------------------
// Média — az archívumból kiválasztott, tartalomhoz kötődő képek.
// A fájlok a script melletti legacy-content/kepek/ mappában élnek; a lista
// maga a src/lib/legacy-images.ts-ben, mert az induláskori önjavítás
// (src/lib/media-restore.ts) ugyanezekből a forrásokból tölti vissza a
// deploykor elveszett képfájlokat.
// ---------------------------------------------------------------------------

/**
 * Média idempotens biztosítása: fájlnév-alapú dedup (webp-konverzió miatt
 * alapnév-prefix). A média csak létrejön, meglévőt sosem ír felül. Próbafutásban
 * a hiányzó média `undefined` id-vel tér vissza — a rá hivatkozó oldal/termék
 * ilyenkor egyszerűen kép nélkül kerül a naplóba (írás úgysem történik).
 */
const ensureMedia = async (payload: Payload, image: LegacyImage): Promise<number | undefined> => {
  const baseName = image.file.replace(/\.[^.]+$/, '')
  const existing = await payload.find({
    collection: 'media',
    where: { filename: { like: `${baseName}%` } },
    limit: 1,
    overrideAccess: true,
  })
  if (existing.docs.length > 0) {
    naploKihagyas(payload, `média: ${image.file}`, 'már fel van töltve')
    return existing.docs[0].id
  }
  if (DRY_RUN) {
    naploLetrehozas(payload, `média: ${image.file}`)
    return undefined
  }
  const created = await payload.create({
    collection: 'media',
    data: { alt: image.alt },
    filePath: path.join(LEGACY_IMAGES_DIR, image.file),
    overrideAccess: true,
  })
  naploLetrehozas(payload, `média: ${image.file}`)
  return created.id
}

/**
 * A sajtó-logósor képfájljai (src/lib/home-seed.ts, PRESS_RAIL_FILES): a régi
 * hat logót a KEZDŐLAPI seed tölti fel a `content/home-images` forrásból, a
 * négy ellenőrzött H05-logót (public/media/press) ez a script tölti fel és
 * igazolja (`ensurePressManifestImages`). A sor itt csak megkeresi a
 * meglévőket: így a /rolunk logósora akkor is helyes marad, ha a lányok
 * időközben lecserélték valamelyik logót.
 */
const SAJTO_LOGO_FAJLOK: readonly string[] = PRESS_RAIL_FILES

/**
 * A /rolunk partner-logósávjának fájljai, a régi kineticare.hu/rolunk
 * sorrendjében: elöl az egyesületi MASE (a H05-ben ellenőrzött hivatalos
 * szóvédjegy, public/media/press/mase.png — a régi oldal teal, négyzetes
 * közösségi avatárja helyett), utána a HOME_IMAGES `partner-` bejegyzései.
 * Nyilvántartás: content/home-images/site/partner-manifest.json.
 */
const ROLUNK_PARTNER_LOGO_FAJLOK: readonly string[] = ['mase.png', ...PARTNER_LOGO_FILES]

/**
 * Partnerlogók idempotens feltöltése a `content/home-images/site` forrásból
 * (a HOME_IMAGES `partner-` bejegyzései, alt = a szervezet neve). A kezdőlapi
 * seed ugyanezt megteszi indításkor; itt azért is fut, hogy a /rolunk
 * visszaépítése egyetlen operátori lépés legyen. Meglévőt sosem ír felül.
 */
const ensurePartnerLogok = async (payload: Payload): Promise<void> => {
  for (const image of HOME_IMAGES) {
    if (!image.file.startsWith('partner-')) continue
    const baseName = image.file.replace(/\.[^.]+$/, '')
    const existing = await payload.find({
      collection: 'media',
      where: { filename: { like: `${baseName}%` } },
      limit: 1,
      overrideAccess: true,
    })
    if (existing.docs.length > 0) {
      naploKihagyas(payload, `partnerlogó: ${image.file}`, 'már fel van töltve')
      continue
    }
    if (DRY_RUN) {
      naploLetrehozas(payload, `partnerlogó: ${image.file}`)
      continue
    }
    await payload.create({
      collection: 'media',
      data: { alt: image.alt },
      filePath: path.join(LANDING_ASSETS_DIR, image.dir, image.file),
      overrideAccess: true,
    })
    naploLetrehozas(payload, `partnerlogó: ${image.file}`)
  }
}

/**
 * Meglévő média-elemek id-je fájlnév alapján — FELTÖLTÉS NÉLKÜL.
 *
 * A dedup ugyanaz, mint az `ensureMedia`-ban: a Média collection webp-re
 * konvertál, ezért a kiterjesztés nélküli alapnévre szűrünk. A nem található
 * fájl egyszerűen kimarad a listából (a hivatkozó szekció ilyenkor elmarad) —
 * a script emiatt sosem áll meg.
 */
/**
 * A /rolunk fejlécképe — a PÁROS csapatfotó (tulajdonosi kérés, 2026-08-16).
 *
 * Korábban a szóló portré (`682a121babe80_IMG_7573.jpeg`) állt a lap tetején,
 * ami csak Kocsis Katát mutatja — a lap viszont MINDKÉT alapítóról szól.
 *
 * FIGYELEM: ez a fájl NEM a legacy archívum része, hanem a KEZDŐLAPI seed
 * képei közt él (`src/lib/home-seed.ts`, HOME_IMAGES). Ezért a `mediaId()`
 * (ami csak a LEGACY_IMAGES-ből feltöltötteket ismeri) NEM oldja fel — a
 * sajtó-logók mintáját követve a Médiatárban KERESSÜK meg, feltöltés nélkül.
 */
const ROLUNK_HERO_FAJL = 'katak-team.jpg'

/**
 * EGY meglévő média-elem id-je fájlnév alapján — FELTÖLTÉS NÉLKÜL.
 *
 * A `findMediaIds` egyelemű alakja: ugyanaz a kiterjesztés nélküli alapnév-
 * dedup, és nem található fájlnál `undefined` (a hivatkozó mező ilyenkor
 * egyszerűen kimarad).
 */
const findMediaId = async (payload: Payload, file: string): Promise<number | undefined> =>
  (await findMediaIds(payload, [file]))[0]

const findMediaIds = async (payload: Payload, files: readonly string[]): Promise<number[]> => {
  const ids: number[] = []
  for (const file of files) {
    const baseName = file.replace(/\.[^.]+$/, '')
    const existing = await payload.find({
      collection: 'media',
      where: { filename: { like: `${baseName}%` } },
      limit: 1,
      overrideAccess: true,
    })
    if (existing.docs.length > 0) {
      ids.push(existing.docs[0].id)
    }
  }
  return ids
}

// ---------------------------------------------------------------------------
// Kategória — a seed által is ismert termékkategória független biztosítása.
// ---------------------------------------------------------------------------

const ensureProductCategory = async (payload: Payload): Promise<number | undefined> => {
  const slug = 'kezrehabilitacios-kurzusok'
  const existing = await payload.find({
    collection: 'categories',
    where: { slug: { equals: slug } },
    limit: 1,
    overrideAccess: true,
  })
  if (existing.docs.length > 0) {
    naploKihagyas(payload, `kategória: ${slug}`, 'már létezik')
    return existing.docs[0].id
  }
  if (DRY_RUN) {
    naploLetrehozas(payload, `kategória: ${slug}`)
    return undefined
  }
  const created = await payload.create({
    collection: 'categories',
    data: { title: 'Kézrehabilitációs kurzusok', slug, type: 'product' },
    overrideAccess: true,
  })
  naploLetrehozas(payload, `kategória: ${slug}`)
  return created.id
}

// ---------------------------------------------------------------------------
// Oldaltartalmak — a régi kineticare.hu archívumából, hűen átemelve.
// (A menü/fejléc/footer és a systeme.io-s technikai elemek nem tartoznak ide;
//  az új storefront ezeket saját komponensekből rendereli.)
// ---------------------------------------------------------------------------

const kezdolapContent = (): RichTextContent =>
  richText([
    heading('h2', 'Szeretnél megszabadulni a fájdalomtól, de hiába próbáltál ki (szinte) mindent?'),
    para('Tudjuk, milyen, amikor:'),
    bulletList([
      'Az ujjad vagy a csuklód már a nap közepén görcsöl, és esélyed sincs pihentetni',
      'Minden mozdulatnál attól tartasz, csak ne legyen rosszabb',
      'Egyre több kenőcsöt, borogatást és „csodaszert” halmozol fel, de a fájdalom újra és újra jelentkezik.',
    ]),
    para(
      'Ha eleged van abból, hogy már csak félgőzzel bírsz dolgozni vagy sportolni, mert félsz a fájdalomtól, vagy netán a fájdalomcsillapítókig fajult a helyzet, akkor a legjobb helyen jársz.',
    ),
    para(
      'Mozgásterápiás módszerekkel tudunk abban segíteni, hogy végre megszűnjön a kézfájdalmad, és újra teljes erőbedobással élhesd a mindennapjaid.',
    ),
    heading('h2', 'Üdvözlünk!'),
    para(
      'Kiss Kata és Kocsis Kata vagyunk, gyógytornászok, manuálterapeuták és sportrehabilitációs trénerek, és évek óta elsősorban a kéz rehabilitációjával foglalkozunk.',
    ),
    para(
      'A pácienseink nagy része kéz-, csukló-, könyök- vagy vállfájdalommal érkezik hozzánk, így pontosan tudjuk, milyen makacs probléma tud ez lenni, és hogy mennyire megkeseríti az ember mindennapjait.',
    ),
    para(
      'A legújabb kutatásokat, külföldi guideline-okat és a saját gyakorlati tapasztalatainkat ötvözzük – mindezt a lehető legbiztonságosabb, mégis leggyorsabb felépülés érdekében.',
    ),
    para(
      'Hiszünk abban, hogy a kezed nemcsak egy testrész – mindenhez szükséged van rá. Ezért igyekszünk minden módon segíteni rendbehozni a kezed, megszüntetni a fájdalmat, és elérni, hogy úgy használhasd a kezed, mintha sosem lett volna vele semmi baj.',
    ),
    heading('h2', 'Erre számíthatsz velünk'),
    heading('h3', '1. A legújabb, tudományosan megalapozott módszereket alkalmazzuk'),
    para(
      'Folyamatosan figyeljük a külföldi és hazai szakmai protokollokat, kutatásokat, és a pácienseinken látott valós tapasztalatokat is ötvözzük.',
    ),
    para(
      'Így garantáltan naprakész, biztonságos és hatékony módszerekkel dolgozunk, hogy a kezed a lehető leggyorsabban regenerálódhasson.',
    ),
    heading('h3', '2. Személyre szabott megoldást kapsz – akár otthon, akár rendelőben'),
    para(
      'Minden programunkban (legyen az online kurzus vagy személyes kezelés) figyelembe vesszük a te szokásaidat, terhelésedet és korlátaidat.',
    ),
    para(
      'Ha nincs időd a rendelőbe járni, otthoni gyakorlóvideók várnak; ha pedig eljössz hozzánk, az igényeidhez és az életviteledhez igazítjuk a kezelési tervet. A lényeg: mindig van olyan megoldásunk, ami neked megfelel, és valódi javulást hoz.',
    ),
    heading('h3', '3. Nem rövidtávú tünetkezeléssel, hanem tartós eredménnyel foglalkozunk'),
    para(
      'Nálunk nem áll meg a folyamat a „gyorsan csökkentsük a fájdalmat” résznél. Arra törekszünk, hogy ne is térjen vissza a kínzó fájdalom.',
    ),
    para(
      'Megmutatjuk, hogyan változtass a mozgásmintáidon, és milyen gyakorlatokat érdemes beépítened a hétköznapokba.',
    ),
    para(
      'A cél: egy olyan stabil, teherbíró kéz, ami hosszú távon bírja a strapát – akár munkáról, sportról vagy a hétköznapok terheléséről van szó.',
    ),
    heading('h2', 'Vélemények'),
    heading('h3', '„Kötelezővé tenném mindenkinek, akinek kézpanasza van”'),
    quote(
      'Kocsis Katát kézproblémával kerestem fel, és már az első alkalommal éreztem, hogy jó kezekben vagyok – szó szerint is. Nagy odafigyeléssel, alázattal és valódi szakértelemmel kezelt minden alkalommal. Nemcsak a tüneteket enyhítette, hanem segített megérteni a kiváltó okokat is. Őszintén ajánlom mindenkinek, aki nemcsak gyors enyhülést, hanem tartós megoldást keres.',
    ),
    para('– Garami Gábor, zenész / műsorvezető'),
    quote(
      'Egy 10 éve tartó ganglion problémával, több operáció után jutottam el Katához, mert szikementes segítséget szerettem volna igénybe venni, és nem is dönthettem volna jobban! Nagyon hálás vagyok, hogy szakértelme által jelentős javulást és tünetmentességet értünk el a kezelések során, és rengeteg tudást is kaptam, pl. hogy tornáztathatom én magam is a fájó testrészeket, vagy hogyan tape-elhetem be magam akut fájdalom esetén.',
    ),
    para('– Kállai Dóra, biológus'),
    quote(
      'Katával 2022-ben kezdtünk el együtt dolgozni. Sok éve tartó derékfájással és nyaki problémával fordultam hozzá. A sok fájdalom miatt azt gondoltam, hogy már csak a gyógytorna marad egész életemre. De Kata segített megtanulni helyesen mozogni, és visszatérni a sportokhoz. Hálás vagyok neki a valós szakértelméért, türelméért és támogatásáért, amely által nemcsak fájdalommentesen élhetek, hanem újra élvezhetem a mozgás örömét.',
    ),
    para('– Kunfalvi Lili, piackutató'),
    quote(
      'A KINETICARE lányokat ajánlás alapján kerestem meg, ugyanis akkor már pár hónapja erős fájdalommal járt a hüvelykujjam és a csuklóm mozgatása. Ez a munkámat is nehezítette, hiszen jógaoktatóként folyamatosan használnom kellett, nem pihentethettem. A közös munkának, a világos magyarázatoknak, hogy mi történik velem, illetve a szuper feladatoknak és életvezetési tanácsoknak hála sikerült a gyógyulás! Nagyon hálás vagyok a KINETICARE-nek, hiszen azóta fájdalommentesen élek, és újra visszatérhettem kedvenc gyakorlatomhoz, a kézenálláshoz is.',
    ),
    para('– Bagdal Szilvia, Sziszi Yoga: haladó jógaoktató / mobility- és meditációs tréner'),
    quote(
      'Kézzsibbadással kerestem fel Katát, és hihetetlen módon ráérzett, milyen gyakorlatok segítenének nekem, ugyanis a második találkozóra már úgy érkeztem, hogy teljesen elmúltak a panaszaim. Ezeket a gyakorlatokat mind a mai napig elvégzem felsőtest edzés után, és nem is jöttek vissza a panaszok.',
    ),
    para('– Dr. Sitku Lili, fogorvos'),
    quote(
      'Minden felmerülő fájdalmamra, problémámra azonnal tudott megoldást nyújtani, és az általa adott gyakorlatok végrehajtásával szinten tudom tartani az általános jó közérzetemet, nincsenek hosszan fennálló fájdalmaim, neki köszönhetően nagyon sokat fejlődött a testem, a teherbírásom.',
    ),
    para('– Hámori Lili, édesanya'),
    quote(
      'Már a két évvel ezelőtti első személyes találkozásunk során is érzékeltem ezt a magas színvonalú szakmaiságot, és a pácienssel empatikus, emberséges, támogató hozzáállást. A folyamatos gyógytorna, manuálterápiás kezelés következtében sikerült mindennapi aktív életemet visszakapnom.',
    ),
    para('– Dr. Kárpáti Katalin, ügyvéd'),
  ])

// ---------------------------------------------------------------------------
// A /szolgaltatasok és a /rolunk tartalma — EGY forrásból, két alakban.
//
// Ugyanaz a szöveg két helyen kell: a rich-text változatban (az oldal eredeti,
// folyószöveges alakja, ami akkor jelenik meg, ha az oldalnak NINCS szekciósora)
// ÉS a szekciósor (Pages.layout) blokkjaiban, ahol a mezők sima szövegek.
// Ezért a szekciókra bontható tartalom ADATKÉNT él itt, és mindkét irány ebből
// épül fel — a kettő így nem tud szétcsúszni.
//
// FONTOS: a szekciósor feltöltése EGYSZERI. Utána minden szöveg, sorrend,
// háttér és láthatóság az adminban szerkeszthető (Pages → Szekciók), a script
// pedig meglévő szekciósort SOHA nem ír felül (lásd ensurePageLayout).
// ---------------------------------------------------------------------------

/** Cím + szöveg pár (USP-kártya, szolgáltatás-sor). */
interface CimSzoveg {
  title: string
  body: string
}

/** Szolgáltatás-sor: cím, szöveg és a sor végi hivatkozás. */
interface SzolgaltatasSor extends CimSzoveg {
  label: string
  url: string
  newTab?: boolean
}

// --- /szolgaltatasok --------------------------------------------------------

/** A lap bevezetője: a probléma és a kivezető út (2 szekció). */
const szolgaltatasokBevezetoNodes = (): BlockNode[] => [
  heading('h2', 'Fáj a kezed, csuklód, könyököd vagy vállad?'),
  para(
    'Tudjuk, hogy ez a probléma mennyire tud hátráltatni a munkában vagy a sportban, de még a hétköznapokban is.',
  ),
  para(
    'Ezért professzionális kezeléseinkkel és online programjainkkal abban segítünk, hogy minél gyorsabban visszanyerd a kezed erejét és mozgását, hosszú távú eredményekkel.',
  ),
  heading('h2', 'Van megoldás, ha tudod, merre indulj'),
  para(
    'A legtöbb kéz-, csukló- vagy könyökprobléma megfelelő terápiával hatékonyan kezelhető, és akár a műtét is elkerülhető.',
  ),
  para(
    'Ehhez persze türelemre és kitartásra van szükség, de a test egy csodálatos „szerkezet”: ha segítünk neki, képes rendbehozni magát.',
  ),
  para(
    'A kézfájdalmak kezelésében nem hiszünk a gyors, felületes megoldásokban. A kezeléseink és programjaink a legmodernebb mozgásterápiás és manuálterápiás módszerekre épülnek, hogy segítsenek a gyökérok megszüntetésében, és a hosszú távú regenerációban.',
  ),
]

/**
 * Az időpontkérés célcíme: a /kapcsolat lap időpontkérő SZEKCIÓJA, horgonnyal.
 *
 * A horgony nélkül a látogató a kapcsolat-lap tetejére érkezne, és neki kellene
 * megtalálnia, hol kérhet időpontot. A horgonyt az időpontkérő blokk
 * `sectionSettings.anchorId` mezője adja (lásd KAPCSOLAT_IDOPONTKERES) — a
 * kettőt együtt kell módosítani.
 */
const IDOPONTKERES_HORGONY = 'idopontkeres'
const IDOPONTKERES_URL = `/kapcsolat#${IDOPONTKERES_HORGONY}`

/**
 * A RÉSZLETES szakmai önéletrajz célcíme, ha az nincs ugyanazon a lapon.
 *
 * A /rolunk lap alján álló harmonika horgonya (`szakmai-hatter`); a
 * /szolgaltatasok és a /kapcsolat szakember-szekciója EGYARÁNT ide mutat,
 * mert azokon a lapokon nincs önéletrajz — a tartalom egy helyen él (az
 * IA-leltár 6.4 D3 „két felület, egy funkció" hibája ellen). A horgony nevét
 * az élő javítás (`src/scripts/apply-owner-content.ts` `SZAKMAI_HATTER_HORGONY`)
 * is ismeri; a kettő egyezését teszt őrzi.
 */
const SZAKMAI_HATTER_URL = '/rolunk#szakmai-hatter'

/** Rendelői kezelések — a részletes leírás és a technikák felsorolása. */
const rendeloiKezelesekNodes = (): BlockNode[] => [
  heading('h3', 'Rendelői kezelések: személyes terápiás megoldások'),
  para(
    'Ha gyors és hatékony eredményt szeretnél, gyógytornával, manuálterápiával és kiegészítő technikákkal segítünk a kezed, és ha szükséges, a gerinced panaszainak csökkentésében.',
  ),
  para(
    'Akut sérülések, műtét utáni rehabilitáció és krónikus fájdalmak kezelésére egyénre szabott mozgásterápiát, manuálterápiát és különböző kiegészítő terápiákat és eszközöket alkalmazunk, hogy gyors és tartós eredményt érj el.',
  ),
  para('Amiben segíteni tudunk:'),
  bulletList([
    'Gyógytorna: akut sérülések, műtét utáni állapotok és krónikus fájdalmak esetén a mozgásterápia a gyógyulás alappillére',
    'Manuálterápia: a lágyrészek és ízületek célzott, kézzel végzett kezelése',
    'Kiegészítő terápiák: Kinesio Tape és Dynamic Tape® felhelyezés, flossing, köpölyterápia, fasciakés (eszközös lágyrész-mobilizáció), hegkezelés, NRX® bandázs',
  ]),
]

/**
 * Árlista + helyszínek. Az időpontkérés CTA-ja PARAMÉTERES:
 *  - `gomb`      — a rich-text ág mai viselkedése (önálló bekezdésben álló link
 *                  → a serializer elsődleges gombot renderel belőle),
 *  - `szoveglink`— a szekciósoré: a lapon a fizetős kurzus CTA-ja az EGYETLEN
 *                  elsődleges gomb (docs/ux-belso-oldalak-kutatas.md B6.5), a
 *                  lead-jellegű időpontkérés ezért mondatba ágyazott szöveglink.
 */
const arlistaNodes = (idopontCta: 'gomb' | 'szoveglink'): BlockNode[] => [
  heading('h3', 'Árlista: gyógytorna / manuálterápia'),
  bulletList([
    '50 perces alkalom: 18 000 Ft (tartalmazza a szükség szerinti Kinesio Tape vagy Dynamic Tape® felhelyezését, flossing-, köpöly- és/vagy eszközös lágyrész-manuálterápiás kezeléseket)',
    '20 perces alkalom: 10 000 Ft (tartalmazza a szükség szerinti Kinesio Tape vagy Dynamic Tape® felhelyezését, flossing-, köpöly- és/vagy eszközös lágyrész-manuálterápiás kezeléseket)',
  ]),
  para(
    'Az első alkalom minden esetben 50 perces vizsgálatot foglal magába. Rendelőinkben készpénzes és átutalásos fizetésre van lehetőség.',
  ),
  para('Helyszíneink: 1117 Budapest, Nádorliget u. 7/b • 1114 Budapest, Fadrusz utca 15.'),
  idopontCta === 'gomb'
    ? cta(IDOPONTKERES_URL, 'Időpontot kérek')
    : paragraph([
        textNode('Személyes kezelésre a kapcsolat oldalon tudsz jelentkezni: '),
        link(IDOPONTKERES_URL, 'időpontot kérek'),
        textNode('.'),
      ]),
]

/** Online kurzus — az otthoni program bemutatása a rich-text ágban. */
const onlineKurzusNodes = (): BlockNode[] => [
  heading('h3', 'Online kurzus: otthoni fájdalomcsökkentő program'),
  para('Nem tudsz eljutni személyes kezelésre?'),
  para(
    'Ha nincs lehetőséged rendelőbe járni, az otthoni gyakorlóvideóink segítenek enyhíteni a fájdalmad és visszaállítani a kezed működését.',
  ),
  para(
    'Az otthoni programunk biztonságos, szakértői alapokra épülő mozgásprogramokat tartalmaz, amik segítenek neked otthon is hatékonyan kezelni a kézfájdalmadat. A saját tempódban haladhatsz, és bárhol, bármikor végezheted.',
  ),
  cta('/kurzusok', 'Megnézem a kurzusokat'),
]

/** Szakmai képzés — az akkreditált tantermi kurzus a rich-text ágban. */
const szakmaiKepzesNodes = (): BlockNode[] => [
  heading('h3', 'Szakmai képzések: akkreditált kézrehabilitációs képzés szakembereknek'),
  para('Szeretnéd mélyíteni a kézsérülések és rehabilitáció terén szerzett ismereteidet?'),
  para(
    'Bevezetés a kéz, a csukló- és könyökízület rehabilitációs lehetőségeibe címmel akkreditált tantermi képzést biztosítunk gyógytornászok, orvosok, mozgásterapeuták és edzők számára, a ProBody Stúdióval együttműködve. (12 kreditpont: SZTK-A-33553/2024)',
  ),
  cta('https://probodystudio.hu/kez-workshop/', 'Tovább a szakmai képzésre', true),
]

/**
 * A három szolgáltatási ág a SZEKCIÓSOR `services` blokkjához.
 *
 * Mindhárom sor UGYANABBAN a sorrendben hozza ugyanazokat az információkat
 * (kinek való → hol/hogyan → mi az ár, illetve hol látod az árat) — a kutatás
 * B4.1 szabálya szerint a párhuzamos ajánlatok csak így hasonlíthatók össze.
 * Az árat a kurzusnál szándékosan NEM írjuk ide: az a termék adata (Webshop →
 * Kurzusok), és a CMS-be másolva elavulna.
 */
const SZOLGALTATASI_AGAK: readonly SzolgaltatasSor[] = [
  {
    title: 'Rendelői kezelések',
    body: 'Akut sérülés, műtét utáni állapot vagy krónikus fájdalom esetén: egyénre szabott gyógytorna, manuálterápia és kiegészítő terápiák. Két budapesti rendelőben (Nádorliget u. 7/b, Fadrusz utca 15.), 50 vagy 20 perces alkalmakban. Ár: 18 000 Ft (50 perc), illetve 10 000 Ft (20 perc).',
    label: 'Időpontot kérek',
    url: IDOPONTKERES_URL,
  },
  {
    title: 'Otthoni online program',
    body: 'Ha nincs lehetőséged rendelőbe járni: videós gyakorlatsorok, amelyek a saját tempódban vezetnek végig a felépülésen. Bárhol, bármikor végezhető, azonnali hozzáféréssel. Az árat és a program tartalmát a kurzusoldalon látod.',
    label: 'Megnézem a kurzusokat',
    url: '/kurzusok',
  },
  {
    title: 'Szakmai képzések',
    body: 'Gyógytornászoknak, orvosoknak, mozgásterapeutáknak és edzőknek: akkreditált tantermi képzés a kéz, a csukló- és könyökízület rehabilitációjáról, a ProBody Stúdióval együttműködve. 12 kreditpont (SZTK-A-33553/2024). A képzés időpontját és díját a ProBody Stúdió oldalán találod.',
    label: 'Tovább a szakmai képzésre',
    url: 'https://probodystudio.hu/kez-workshop/',
    newTab: true,
  },
]

/** „Ezért fogod imádni" — 3 érv. A sorszámot a rich-text ág a címbe írja, a
 *  szekció-blokkban (usps) a megjelenítés adja. */
const SZOLGALTATASOK_ERVEK: readonly CimSzoveg[] = [
  {
    title: 'A kéz a specialitásunk',
    body: 'Nem csupán egy terület a sok közül, hanem a fő szakterületünk. Évek óta foglalkozunk kézrehabilitációval, és sokféle esettel találkoztunk már.',
  },
  {
    title: 'Tartós eredmények',
    body: 'Nemcsak csillapítjuk a tüneteket, hanem a kiváltó okokat is kezeljük. Megtanítunk arra is, mit tegyél, hogy többet ne okozzon problémát neked a kézfájdalom.',
  },
  {
    title: 'Naprakész tudás',
    body: 'Folyamatosan követjük a legújabb kutatásokat és módszereket, hogy a lehető leghatékonyabb kezelést kaphasd tőlünk.',
  },
]

/** A lap két, élsportolóktól származó véleménye (rich-text ág). */
const szolgaltatasokVelemenyNodes = (): BlockNode[] => [
  heading('h2', 'Vélemények'),
  heading('h3', '„Életem végéig hálás leszek neked”'),
  quote(
    '10 év élsport után jelentkező könyökízületi problémáim miatt kezdtem el dolgozni Kocsis Katával. Műtétre került a sor, amiben maximálisan támogatott: ott volt velem a műtőben, és a műtét után is mellettem maradt, amíg magamhoz nem tértem. A rehabilitáció teljes folyamatában számíthattam rá. Bár nem volt könnyű időszak, a közös munka mindig vidáman telt, tele biztatással és támogatással, amiért a mai napig hálás vagyok. Azóta is bármilyen egészségügyi problémám adódik, nyugodt szívvel fordulok hozzá.',
  ),
  para('– Konda Boglárka, vízilabdázó'),
  quote(
    'Pár évvel ezelőtt reménytelenül álltam a karrierem előtt. De hálát adok a sorsnak, hogy megismertelek, mert te vagy az a személy, akinek azt köszönhetem, hogy visszatérhettem oda, ahova tartozom, a Manézsba. A páratlan szakértelmed segítségével rengeteget javult az állapotom. A gyógyulás és a regeneráció mellett nagyon sokat tanulhattam tőled, és a mai napig hasznosítom ezt a tudást. A segítséged mellé egy igaz barátságot is kaptam! Életem végéig hálás leszek neked!',
  ),
  para('– Tarba Patrícia, artista'),
]

const szolgaltatasokContent = (): RichTextContent =>
  richText([
    ...szolgaltatasokBevezetoNodes(),
    heading('h2', 'Válaszd ki, hogyan segíthetünk neked a legjobban'),
    ...rendeloiKezelesekNodes(),
    ...arlistaNodes('gomb'),
    ...onlineKurzusNodes(),
    ...szakmaiKepzesNodes(),
    heading('h2', 'Ezért fogod imádni'),
    ...SZOLGALTATASOK_ERVEK.flatMap((item, index) => [
      heading('h3', `${index + 1}. ${item.title}`),
      para(item.body),
    ]),
    ...szolgaltatasokVelemenyNodes(),
  ])

// --- /rolunk ----------------------------------------------------------------

/** A lap bevezetője: miért fontos a kéz, és mikor kell segítség. */
const rolunkBevezetoNodes = (): BlockNode[] => [
  para(
    '– és igazából neked is. Akinek nem fáj a keze, talán bele sem gondol, hogy szinte minden ébren töltött percben használjuk a kezünket valamire.',
  ),
  para(
    'Ha pedig azért vagy itt, mert megoldást keresel valamilyen húzódásra, sérülésre vagy idegi-, ízületi fájdalomra, akkor pontosan tudod:',
  ),
  heading('h2', '…ez nem „csak egy kéz”'),
  para(
    'Ez a te összekötő kapcsod a világgal: ezzel dolgozol, alkotsz, simogatsz, bátorítasz, gyógyítasz, táplálsz, és mindent ezzel mozgatsz.',
  ),
  para(
    'Így egy sérülés vagy fájdalom kihat az önállóságodra, a munkádra, a hobbidra, de még a legapróbb hétköznapi mozdulataidra is. Ezért olyan fontos, hogy a kezed megkapja azt a törődést és szakértői segítséget, amire szüksége van.',
  ),
  heading('h2', 'Amikor már napi szinten problémát okoz a fájdalom'),
  para(
    'Tudjuk, milyen kiszolgáltatott érzés az, amikor megsérül az ember keze, vagy a túlerőltetés miatt gyullad be egy ízület vagy ideg. Főleg, amikor nem hogy nem múlik a fájdalom, de egyre erősebb lesz…',
  ),
  para(
    'Minden nehezebb ilyenkor: aggódsz, hogy meddig fogod tudni így végezni a munkádat, vagy sportolóként azon stresszelsz, hogy ki kell-e hagynod versenyeket.',
  ),
  para('Ha te is szeretnéd, hogy végre…'),
  bulletList([
    'megszabadulj a fájdalomtól,',
    'szabadon használhasd újra a kezed anélkül, hogy vigyáznod kellene vele,',
    'visszatérjen bele az erő, és ugyanúgy használhasd, mint régen,',
    'ne kelljen attól tartanod, hogy mi lesz, ha romlik a helyzet,',
  ]),
  para('…akkor a legjobb helyen vagy, és szívesen segítünk.'),
]

/** „Megérdemled a profi törődést" — az alapítói történet bekezdései. */
const ROLUNK_BEMUTATKOZAS: readonly string[] = [
  'Kocsis Kata és Kiss Kata vagyunk, a KINETICARE alapítói. Gyógytornász, manuálterapeuta, sportrehabilitációs tréner végzettséggel, de az évek során egyre inkább a kézrehabilitáció került nálunk a fókuszba.',
  'A klinikán és utána a saját rendelőnkben is egyre szembetűnőbb volt, hogy milyen sokan jönnek hozzánk a kéz valamelyik részének a problémájával.',
  'Úgyhogy egyre jobban beleástuk magunkat a témába: a külföldi továbbképzésektől a boncolásokon és műtéteken át a legújabb kezelési technikákig mindent igyekszünk felkutatni, amit a kéz anatómiájáról és rehabilitációjáról tudni érdemes, hogy a pácienseinknek átfogó, profi segítséget nyújthassunk.',
  'Büszkék vagyunk rá, hogy válogatott sportolók, olimpikonok, kismamák és irodai dolgozók, de még a társszakmákban dolgozók is (és persze sokan mások) hozzánk fordulnak, ha megoldást szeretnének.',
  'Szakmai képzéseket és workshopokat is tartunk a témában, és emellett a Magyar Sportrehabilitációs Egyesület és a Magyar Gyógytornász-Fizioterapeuták Társaságának munkájában is részt veszünk.',
  'Hiszünk abban, hogy a megfelelő technikákkal helyrehozhatók a sérülések, sokszor akár a műtétek is elkerülhetőek, és hogy a te kezed is megérdemli a profi törődést.',
  'Akár kezelésre jössz hozzánk, akár az otthon végezhető gyakorlatainkkal „kezeled” magad, a cél ugyanaz: segítünk megszabadulni a kézfájdalmaiktól, hogy újra élvezhesd a munkát, a sportot és a hétköznapi teendőket.',
]

/**
 * A két alapító neve, titulusa és telefonszáma.
 *
 * Ez a rész a szekciósorban is kell: a szakmai háttér RÖVID, mindig látható
 * blokkja EZT a csoportot használja (a partnerek sorával együtt), így a két
 * telefonszám nem vész el a blokkosítással — és nem kerül lenyitó mögé sem.
 */
const rolunkSzakemberNodes = (): BlockNode[] => [
  heading('h2', 'Kocsis Kata'),
  para('Gyógytornász, sportrehabilitációs tréner, gyógymasszőr – telefon: +36 30 169 2263'),
  heading('h2', 'Kiss Kata'),
  para('Gyógytornász, manuálterapeuta, sportrehabilitációs tréner – telefon: +36 20 357 3493'),
]

/** A lap két véleménye (rich-text ág; a szekciósorban a `testimonials` blokk
 *  adja ugyanezt a Vélemények collectionből). */
const rolunkVelemenyNodes = (): BlockNode[] => [
  heading('h2', 'Vélemények'),
  heading('h3', '„Már az első alkalom után lecsökkent a fájdalom.”'),
  quote(
    '2024. szeptemberében kerültem Kocsis Katához, amiért örökre hálás leszek. Mérhetetlen könyökfájdalmam volt a bal kezemben, és társult hozzá egy hüvelykujj-panasz is. Alapos vizsgálat után elmagyarázta, mi a probléma, és megkezdte a kezelést. A kedves mosolya és zseniális szakmai tudása felbecsülhetetlen! Már az első kezelés mérföldkő volt, hiszen tudtam használni a kezem, és elmúlt a fájdalom. Ajánlani? IGEN, de inkább kötelezővé tenném mindenkinek, akinek kézpanasza van az élete bármely szakaszában.',
  ),
  para('– Varró Barbara, Nagy Sportágválasztó ügyvezető'),
  quote(
    'Kata minden újonnan jövő kihívást egy megoldandó feladatként kezel, és látszik rajta az elhivatottság a szakmája iránt. Így volt ez legutóbb a síelésre való felkészítéssel is, a mozgásformához szükséges erősítő feladatokat végeztük. A gyakorlatsorok végrehajtását mindig kellő szigorral és odafigyeléssel ellenőrzi – ez az a precízitás és hozzáállás, amit a páciensek később meghálálnak. Az erőfeszítéseidet mindig dicsérő szavak követik, neki pedig az a legnagyobb dicséret, ha az óra végén mosolyogva, jóleső fáradtsággal, de panaszmentesen lépsz ki az ajtón.',
  ),
  para('– Takács Mátyás, építészmérnök'),
]

/** „Amiben mások vagyunk" — 3 megkülönböztető állítás. */
const ROLUNK_MEGKULONBOZTETOK: readonly CimSzoveg[] = [
  {
    title: 'A kéz a specialitásunk',
    body: 'Úgy fogyasztjuk a kézrehabilitációval kapcsolatos legújabb szakmai anyagokat és technikákat, mint a legizgalmasabb sorozatot: mindig jön az újabb „epizód”, amiért teljes lelkesedéssel rajongunk, és azonnal ki is próbáljuk.',
  },
  {
    title: 'Megosztjuk a tudásunkat',
    body: 'Szakmai előadóként, társszerzőként, és akkreditált workshopokkal is igyekszünk átadni a tudásunkat az érdeklődő szakmabelieknek. (A Semmelweis Egyetemen a jövő gyógytornászai az egyetemi képzésükön többek között a mi anyagunkból is tanulnak.)',
  },
  {
    title: 'Tartós eredményeket adunk',
    body: 'Nem csak a tüneteket kezeljük. Megtaláljuk a probléma gyökerét, együtt dolgozunk a kezelésén, és utána pontosan tudni fogod, mit tegyél, hogy épen és egészségesen tartsd a kezed (vagy amidet kezeltük).',
  },
]

/** „Miben segíthetünk?" — a három szolgáltatási ág rövid alakja. */
const ROLUNK_SZOLGALTATASOK: readonly SzolgaltatasSor[] = [
  {
    title: 'Rendelői kezelések – személyesen',
    body: 'Akut sérülések, műtét utáni állapotok és krónikus fájdalmak esetén a mozgásterápia a gyógyulás alappillére. Gyógytornával, manuálterápiával és egy sor kiegészítő terápiával várunk.',
    label: 'Tovább a kezelésekre',
    url: '/szolgaltatasok',
  },
  {
    title: 'Otthoni program – online',
    body: 'Ha a kézfájdalom enyhítésére szeretnél egy bárhol, bármikor végezhető megoldást, akkor egy átfogó programmal is tudunk segíteni.',
    label: 'Tovább a kurzusokra',
    url: '/kurzusok',
  },
  {
    title: 'Szakmai képzések – kollégáknak',
    body: 'Akkreditált tantermi kézkurzus a kéz, a csukló- és könyökízület rehabilitációs lehetőségeiről gyógytornászoknak, erőnléti- és szakági edzőknek és orvosoknak.',
    label: 'Tovább a képzésre',
    url: 'https://probodystudio.hu/kez-workshop/',
    newTab: true,
  },
]

/**
 * Partnerek — a lap külső, ellenőrizhető referencia-sora.
 *
 * Rövid, ezért MINDIG látható marad (nem kerül lenyitó mögé): a szekciósorban a
 * szabad szöveges blokkban él, az elérhetőségekkel együtt.
 */
const ROLUNK_PARTNEREK =
  'Magyar Sportrehabilitációs Egyesület, ProBody Stúdió, Aurora Medical, Dynamic Tape®, TUDATEST, PhysioWatch, WIBBI, Halm Optika, dr. pharm. Kocsis Kristóf, Csillik Árpád, NISHI STUDIO pilates, BodyGPS, Magic Smile, Be Fit With Ben, OrtoCare, Pille Fizioterápia.'

/** A /rolunk partner-logósávjának felirata (a `pressLogos` blokk `heading`-je). */
const ROLUNK_PARTNER_FELIRAT = 'Partnereink'

/**
 * A logósáv ALATTI mondat azokról a partnerekről, akiknek a régi oldalon nem
 * logófájl, hanem fotó vagy aláírás állt (docs/grafikai-leltar-regi-oldal.md
 * 2.3; a leltár és a képek megnézése alapján: Aurora Medical, TUDATEST és
 * PhysioWatch jelvénye fotóról/képernyőmentésről származik, Csillik Árpádé
 * portréfotó, dr. pharm. Kocsis Kristófé kézírásos aláírás). Ők név szerint
 * maradnak látszanak — a logósáv nem hagy ki senkit a régi névsorból.
 * A mondat „Partnereink" szóval kezdődik, mert a szekciósor rich-text ága
 * ezzel a kulcsszóval bizonyítja, hogy a partnersor nem került lenyitó mögé.
 */
const ROLUNK_TOVABBI_PARTNEREK =
  'Partnereink közé tartozik még az Aurora Medical, a TUDATEST, a PhysioWatch, dr. pharm. Kocsis Kristóf és Csillik Árpád.'

/** Egy szakmai lista az önéletrajzon belül (tanulmányok, tanfolyamok, …). */
interface SzakmaiLista {
  /** A lista címe az önéletrajzban (h3). */
  heading: string
  /**
   * A tétel EGYES SZÁMÚ, rövid megnevezése a harmonika-fejléc kivonatához
   * (pl. „tanfolyam" → „39 tanfolyam"). Ahol hiányzik, a lista kimarad a
   * kivonatból — a kivonat egysoros marad, nem sorolja fel az összes listát.
   */
  rovidCimke?: string
  items: readonly string[]
}

/** Egy szakember teljes szakmai önéletrajza. */
interface SzakmaiOneletrajz {
  nev: string
  titulus: string
  listak: readonly SzakmaiLista[]
}

/**
 * A két teljes szakmai önéletrajz — STRUKTURÁLTAN, egyetlen forrásból.
 *
 * MIÉRT NEM KÉSZ NODE-LISTA (ez volt korábban): a tartalom KÉT alakban kell.
 *  - a rich-text oldaltartalomban (`rolunkContent`) folyó szövegként, h2/h3
 *    címsorokkal — ezt a `rolunkReferenciaNodes()` építi belőle vissza,
 *  - a szekciósorban a `accordion` blokk tételeiként, nyitható-csukható
 *    formában, a fejlécben DARABSZÁMMAL.
 * A darabszámot így nem kell külön mezőbe írni: a `cvOsszefoglalo` a TÉNYLEGES
 * sorokból számolja (a teamMembers CV-harmonikájának mintája), tehát sosem tud
 * elcsúszni a listától. A rejtés önmagában eltüntetné a bizonyíték
 * MENNYISÉGÉT, ami maga a bizalmi jelzés (ux-belso-oldalak-kutatas.md 5.2).
 */
const ROLUNK_ONELETRAJZOK: readonly SzakmaiOneletrajz[] = [
  {
    nev: 'Kocsis Kata',
    titulus: 'Gyógytornász, sportrehabilitációs tréner, gyógy- és sportmasszőr',
    listak: [
      {
        heading: 'Tanulmányok',
        items: [
          'Pécsi Tudományegyetem Egészségtudományi Kar, Ápolás és Betegellátás alapképzési szak, Gyógytornász szakirány',
          'Minerva Érettségizettek Szakközépiskolája – Gyógy- és sportmasszőr (54-726-01)',
        ],
      },
      {
        heading: 'Tanfolyamok, továbbképzések, konferenciák',
        rovidCimke: 'tanfolyam',
        items: [
          'Ezerarcú hypermobilitás a gyógytornász praxisban (2026) – BodyGPS',
          'Orfit alapanyagokból készült kéz- és felsővégtag rögzítők (2025) – Tóth Jordán Zsolt, OrtoCare',
          'Aspetar World Conference 2025 – Doha, Katar',
          'ATP Challenger Physio Education Program (2024) – International Tennis Performance Association',
          'Hegkezelés és hegtudatos életmód (2024) – La Matriarcha',
          'II. Fizioterápiás Tematikus Nap – A krónikus non-specifikus derékfájdalom (2024) – PTE ETK',
          'Az izomsérülések diagnosztikája és rehabilitációja – Varró Tina, Probody Academy',
          'Management of Distal Radius Fractures following ORIF surgery from 6 weeks (2024) – Kate Thorn, CHT (USA), AHTA',
          'Early Management of Distal Radius Fractures following ORIF surgery (2024) – Kate Thorn, CHT (USA), AHTA',
          'Extensor Tendon Injury Management (2024) – Kate Thorn, CHT (USA), AHTA',
          'Flexor Tendon Injury Management (2024) – Kate Thorn, CHT (USA), AHTA',
          "De Quervain's Tenosynovitis (2024) – Kate Thorn, CHT (USA), AHTA",
          'Carpal Tunnel Syndrome (2024) – Loren Szmiga, Manual Therapist, CHT',
          'Trigger Finger (2024) – Loren Szmiga, Manual Therapist, CHT',
          'Functional Anatomy of the Hand (2024) – Daphne Xuan, MPT',
          'A nagy térd kurzus (2024) – Varró Tina, Probody Academy',
          'Az elülső keresztszalag-pótlást követő rehabilitációs program (2023) – Varró Tina, Probody Academy',
          'Gyorsaságfejlesztés a XXI. században (2022) – Magyar Edzők Társasága',
          'Innovating in Health Care (2022) – Harvard Medical School',
          'Human Anatomy: Musculoskeletal Cases (2022) – Harvard Medical School',
          'PK1 FPH – Integrált manuálterápia a modernkori testtartási zavarok kezelésében (2022) – MGYFT',
          'Bevezetés a Biomechanikai-Dinamikus Taping Módszertanába (2022) – Dynamic Tape® Magyarország',
          'Neuroplaszticitás és mozgásterápia (2022) – Feövenyessy Medical Fitness Akadémia',
          'Practical Improvement Science in Health Care (2021–2022) – Harvard Medical School',
          'Regeneráció a versenyidőszakban (2022) – Magyar Edzők Társasága',
          'Sportfizioterápia (Sportrehabilitáció) (2022) – Varró Tina, Maximum Performance',
          'A porckárosodás kezelésének új lehetőségei (2022) – Magyar Edzők Társasága',
          'Mulligan-koncepció I. modul (2021) – Mulligan Koncepció Magyarország',
          'Barvincsenko-féle lágyrész-manuálterápia I. – A gerinc és a medence (2021) – Holisztikus Medicina Alapítvány',
          'Az önsorsrontás pszichológiája (2021) – Jog és Pszichológia',
          'Kismama kinesiotape (2021) – Perfect Movement Mozgásközpont',
          'McKenzie „B” kurzus (2021) – Magyarországi McKenzie Intézet',
          'SMR (self myofascial release) a sport- és mozgásszervi rehabilitációban (2020) – Balance Medical Fitness Akadémia',
          'McKenzie „A” kurzus (2020) – Magyarországi McKenzie Intézet',
          'NRX® – Dinamikus ízületstabilizálás és korrekció (2020) – Balance Medical Fitness Akadémia',
          'Flossing terápia a mozgásszervi problémák és sportsérülések rehabilitációjában (2018) – Balance Medical Fitness Akadémia',
          'Kinesiology taping / Sport taping képzés (2018) – Balance Medical Fitness Akadémia',
          'Svédmasszázs (2015) – OKTÁV Továbbképző Központ',
        ],
      },
      {
        heading: 'Publikációk',
        rovidCimke: 'publikáció',
        items: [
          'Kocsis, K., Szalay, B., Békési, Á., Király, B. (2022). Thoracalis gerincszakasz elváltozásai és az impingement szindróma összevetése a különböző korosztályokban játszó röplabdások körében. Fizioterápia, 31(2), 3–10.',
          'Kocsis, K., Ács, P., Boncz, I., Molics, B., Király, B. (2022). Comparison between thoracic spine deformities and impingement syndrome among volleyball players in different age groups. Value in Health Journal, POSB337.',
        ],
      },
      {
        heading: 'Konferenciák, előadások',
        rovidCimke: 'konferencia',
        items: [
          'Magyar Sportrehabilitációs Konferencia (2025, Budapest): Műtőasztaltól a kezdőötösig – egy NBI-es kosárlabdázó esettanulmánya',
          'Sportrehabilitációs tréner képzés: Bevezetés a kéz, a csukló- és könyökízület rehabilitációs lehetőségeibe – akkreditált kurzus, 12 kreditpont (SZTK-A-33553/2024) – instruktor (2024, 2025, 2026, Budapest)',
          'ProBody Stúdió sportrehabilitációs tréner képzés: Gerinc anatómia és vizsgálat – instruktor (2024, 2025, 2026, Budapest)',
          'ProBody Stúdió sportrehabilitációs tréner képzés: Könyök-, csukló- és kézízületek érintettségei sportolói szemszögből – instruktor (2023, 2024, Budapest)',
          'A Magyar Kézsebész Társaság 29. kongresszusa: Kézsebészeti skill tréning – instruktor (2023, Székesfehérvár)',
          'Akkreditált Oftex kurzus: Ínvarratok és határterületek a kézsebészeti ellátásban – instruktor (2023, Budapest)',
          'ISPOR konferencia: Comparison between Thoracic Spine Deformities and Impingement Syndrome Among Volleyball Players (2020, Milánó; 2021, Koppenhága)',
        ],
      },
      {
        heading: 'Média-megjelenések',
        rovidCimke: 'médiamegjelenés',
        items: [
          'Kézsérülés, műtét, fájdalom után: őrizd meg kezed egészségét! (2025) – Secret Medical Podcast',
          'Űzzük el a stresszt! (2025) – Nők Lapja Évszakok',
          'Mi fán terem az ínhüvelygyulladás? (2025/37) – Nők Lapja',
          'Az irodai munka az új extrém sport? A kéz is dolgozik (2024/47) – Nők Lapja',
          'Mitől lesz a banyapúp? (2024/8) – Nők Lapja',
          'Mozgás korra szabva (2023/45) – Nők Lapja',
          'Hogy ami egészséges, öröm is legyen (2023/9) – Képmás magazin',
          'A henger az új csodaszer? (2023/35) – Nők Lapja',
          'Sport korra szabva (2023/4) – Nők Lapja Egészség Különszám',
          'Ne vegyük félvállról! (2023/14) – Nők Lapja',
          'Fájdalom az ujjakban – A nyeregízületi porckopás (2022) – Szimpatika magazin',
          'A derékfájdalom ront a legtöbbet az életminőségen (2021) – Házipatika.com',
          'Derékfájdalom: akár fertőzés is okozhatja a panaszokat! (2021) – Egészség Kalauz',
          'Karc FM – Kortalan műsor (2021): gyógytornász-szerepvállalás',
        ],
      },
    ],
  },
  {
    nev: 'Kiss Kata',
    titulus: 'Gyógytornász, manuálterapeuta, sportrehabilitációs tréner',
    listak: [
      {
        heading: 'Tanulmányok',
        items: [
          'Semmelweis Egyetem Egészségtudományi Kar, Ápolás és Betegellátás alapképzési szak – Gyógytornász szakirány',
          'Holisztikus Medicina Alapítvány – Barvicsenko-féle manuálterapeuta képzés (manuális medicina elméleti és gyakorlati képzése)',
        ],
      },
      {
        heading: 'Tanfolyamok, továbbképzések, konferenciák',
        rovidCimke: 'tanfolyam',
        items: [
          'Tendon Transfer Training (2026) – Hand Therapy Academy',
          'Wrist Pain in the Combative Athlete 1–2. (2026) – Ian Gatt, Inspire Institute of Sport',
          'Ezerarcú hypermobilitás a gyógytornász praxisban (2026) – BodyGPS',
          'Orfit alapanyagokból készült kéz- és felsővégtag rögzítők (2025) – Tóth Jordán Zsolt, OrtoCare',
          'Say It Better: Essential Skills for Designing Effective Presentations for Healthcare Professionals (2025) – Aspetar, Doha',
          'Artificial Intelligence (AI) in Sports Medicine Workshop (2025) – Aspetar, Doha',
          'Aspetar World Conference 2025 – Doha, Katar',
          'Ulnar Sided Wrist Pain (2025) – Hand Therapy Academy',
          'The Painful Shoulder (2025) – Adam Meakins',
          'ATP Challenger Physio Education Program (2024) – International Tennis Performance Association',
          'II. Fizioterápiás Tematikus Nap – A krónikus non-specifikus derékfájdalom (2024) – PTE ETK',
          'Management of Distal Radius Fractures following ORIF surgery from 6 weeks (2024) – Kate Thorn, CHT (USA), AHTA',
          'Early Management of Distal Radius Fractures following ORIF surgery (2024) – Kate Thorn, CHT (USA), AHTA',
          'Extensor Tendon Injury Management (2024) – Kate Thorn, CHT (USA), AHTA',
          'Flexor Tendon Injury Management (2024) – Kate Thorn, CHT (USA), AHTA',
          "De Quervain's Tenosynovitis (2024) – Kate Thorn, CHT (USA), AHTA",
          'Carpal Tunnel Syndrome (2024) – Loren Szmiga, Manual Therapist, CHT',
          'Trigger Finger (2024) – Loren Szmiga, Manual Therapist, CHT',
          'Functional Anatomy of the Hand (2024) – Daphne Xuan, MPT',
          'Állkapocsízületi diszfunkciók fizioterápiája (2023) – MGYFT',
          'Ergon IASTM eszközös lágyrészmobilizáció (2022) – Ergon IASTM Technique Hungary',
          'Tumorpáciensek ellátása fasciaterápiákkal (2022) – Oriolus-med',
          'Human Anatomy: Musculoskeletal Cases (2022) – Harvard Medical School',
          'Sportrehabilitációs tréner képzés 1–2. szint (2022) – Maximum Performance',
          'Neuroplaszticitás és mozgásterápia (2022) – Feövenyessy Medical Fitness Akadémia',
          'Dinamikus manuálterápia I–II. (2021–2022) – Holisztikus Medicina Alapítvány',
          'Fascia: elmélet és kezelési technikák (2021) – Balande Med Academy',
          'Kinezio- és sporttaping (2021) – Balance Med Academy',
          'Flossing a sportrehabilitációban (2021) – Balance Med Academy',
          'Köpölyözés a sportprevencióban és a rehabilitációban (2021) – Balance Med Academy',
          'Dynamic Tape: Bevezetés a Biomechanika-Dinamikus Taping Módszertanába (2019) – Dynamic Tape® Magyarország',
        ],
      },
      {
        heading: 'Konferenciák, előadások',
        rovidCimke: 'konferencia',
        items: [
          'ProBody Stúdió: Rigid tape és funkcionális kötözések a sportrehabilitációban – instruktor (2026, Budapest)',
          'Magyar Sportrehabilitációs Konferencia (2025, Budapest): Ulnáris oldali csuklófájdalmak – a csukló „derékfájása”',
          'Sportrehabilitációs tréner képzés: Bevezetés a kéz, a csukló- és könyökízület rehabilitációs lehetőségeibe – akkreditált kurzus, 12 kreditpont (SZTK-A-33553/2024) – instruktor (2024, 2025, 2026, Budapest)',
          'ProBody Stúdió sportrehabilitációs tréner képzés: Gerinc anatómia és vizsgálat – instruktor (2024, 2025, 2026, Budapest)',
          'A lumbális és thoracalis gerinc manuális kezelési technikái Filippo Mechellivel – tolmács (2024, Budapest)',
          'A Magyar Kézsebész Társaság 29. kongresszusa: Kézsebészeti skill tréning – instruktor (2023, Székesfehérvár)',
          'Akkreditált Oftex kurzus: Ínvarratok és határterületek a kézsebészeti ellátásban – instruktor (2023, Budapest)',
          'Gyógyító mezítlábazás – Nők Lapja (2023/34)',
        ],
      },
    ],
  },
]

/** Egy önéletrajz TÖRZSE rich-text csomópontokként (a név-címsor nélkül). */
const oneletrajzNodes = (cv: SzakmaiOneletrajz): BlockNode[] => [
  para(cv.titulus),
  ...cv.listak.flatMap((lista) => [heading('h3', lista.heading), bulletList([...lista.items])]),
]

/**
 * A harmonika-fejléc kivonata a TÉNYLEGES sorokból (pl. „39 tanfolyam ·
 * 7 konferencia · 14 médiamegjelenés").
 *
 * Csak a `rovidCimke`-vel ellátott listák kerülnek bele, hogy a kivonat egy
 * sorban maradjon; a darabszám mindig a tömb hossza, tehát a lista bővítésekor
 * magától nő — a szerkesztőnek nincs mit külön karbantartania.
 */
const cvOsszefoglalo = (cv: SzakmaiOneletrajz): string =>
  cv.listak
    .filter((lista) => lista.rovidCimke !== undefined && lista.items.length > 0)
    .map((lista) => `${lista.items.length} ${lista.rovidCimke}`)
    .join(' · ')

/**
 * Partnerek és a két teljes szakmai önéletrajz — a rich-text oldaltartalom ága.
 *
 * A szekciósorban ugyanez a tartalom KÉT blokkra bomlik (rövid, mindig látható
 * rész + `accordion` harmonika) — lásd `buildRolunkLayout`. Itt, a folyó
 * szöveges változatban minden nyitva marad, mert a rich-text ág nem tud
 * nyitható szekciót.
 */
const rolunkReferenciaNodes = (): BlockNode[] => [
  heading('h2', 'Partnereink'),
  para(ROLUNK_PARTNEREK),
  ...ROLUNK_ONELETRAJZOK.flatMap((cv) => [
    heading('h2', `${cv.nev} szakmai önéletrajz`),
    ...oneletrajzNodes(cv),
  ]),
]

const rolunkContent = (): RichTextContent =>
  richText([
    ...rolunkBevezetoNodes(),
    heading('h2', 'Megérdemled a profi törődést'),
    ...ROLUNK_BEMUTATKOZAS.map((text) => para(text)),
    ...rolunkSzakemberNodes(),
    ...rolunkVelemenyNodes(),
    heading('h2', 'Amiben mások vagyunk'),
    ...ROLUNK_MEGKULONBOZTETOK.flatMap((item, index) => [
      heading('h3', `${index + 1}. ${item.title}`),
      para(item.body),
    ]),
    heading('h2', 'Miben segíthetünk?'),
    ...ROLUNK_SZOLGALTATASOK.flatMap((item) => [
      heading('h3', item.title),
      para(item.body),
      cta(item.url, item.label, item.newTab),
    ]),
    ...rolunkReferenciaNodes(),
  ])

// ---------------------------------------------------------------------------
// SZEKCIÓSOROK (Pages.layout) — a /rolunk és a /szolgaltatasok blokkosítása.
//
// MIÉRT: a `Pages.layout` blokk-mező eddig csak a kezdőlapon élt, a két belső
// oldal egyetlen 720px-es hasábban, 92 karakteres sorokkal, „minden egymás
// alatt" adta a teljes tartalmát (docs/ux-belso-oldalak-kutatas.md P3, P5 és a
// 4. fejezet oldal-auditja: mindkét oldal P0). A route-javítás után a
// szekciósor renderelődik — ez a függvénypár tölti fel EGYSZER a szerkeszthető
// alap-szekciósort. Utána minden az adminé: szöveg, sorrend, háttér, elrejtés.
//
// A SZABÁLYOK, AMIK A SORRENDET ÉS A FORMÁT ADJÁK:
//  - B3.1 — rácsba/kártyába csak PÁRHUZAMOS tartalom kerül (a három
//    szolgáltatási ág, a három megkülönböztető állítás); folyó szöveg marad
//    egy hasábban (richText blokk, mértékkel — lásd styles/content.css).
//  - 5.2 (NN/g „About Us" 4 szintje) — a /rolunk sorrendje: szkennelhető
//    összefoglaló → hitel számokkal → miben mások vagyunk → miben segítünk →
//    külső bizonyíték (sajtó) → részletes szakmai háttér → vélemények.
//  - 5.3 — a /szolgaltatasok a három ágat EGY szekcióban, azonos mezőrenddel
//    hasonlítja össze, alatta a rendelői részletek és az árlista.
//  - B6.5 — egy oldalon EGY elsődleges CTA: mindkét lapon a fizetős kurzusra
//    vivő záró CTA-sáv gombja az egyetlen `primary` (az időpontkérés és a
//    partneroldal szöveglink/sor-hivatkozás súllyal szerepel).
//  - B2.2 — a sávok (fehér ↔ világoskék) váltogatása jelöli a közös régiókat.
//
// AMI NEM FÉR BELE ebbe a körbe (a blokk-katalógus hiánya miatt, lásd
// docs/tartalom-leltar-regi-oldal.md 4. szakasz): táblázatos árlista
// (`priceList`), kattintható helyszínek (`locations`). Amíg ezek nincsenek, az
// érintett tartalom a szabad szöveges (richText) blokkban él — így egyetlen
// betű sem vész el a blokkosítással. A korábban itt hiányolt összecsukható CV
// (`accordion`) 2026-08-16 óta LÉTEZIK: a /rolunk részletes szakmai háttere
// ezért már harmonikában áll (lásd `buildRolunkLayout`).
// ---------------------------------------------------------------------------

/** A szekciósorok futásidejű kép-hivatkozásai (Media id-k). */
interface OldalLayoutMedia {
  /** A /rolunk `about` szekciójának fotója. */
  rolunkFoto?: number
  /** A /szolgaltatasok `services` táblájának fotója. */
  szolgaltatasokKep?: number
  /** A sajtó-logósor logói — ezeket a KEZDŐLAPI seed tölti fel (HOME_IMAGES). */
  sajtoLogok?: readonly number[]
  /** A /rolunk partner-logósávjának logói (ROLUNK_PARTNER_LOGO_FAJLOK sorrendjében). */
  partnerLogok?: readonly number[]
  /** Kocsis Kata portréja a bejelentkezés-szekcióhoz. */
  kocsisPortre?: number
  /** Kiss Kata portréja a bejelentkezés-szekcióhoz. */
  kissPortre?: number
}

// ---------------------------------------------------------------------------
// BEJELENTKEZÉS A SZAKEMBEREKHEZ — egy adatforrás, két oldal
//
// MIÉRT VAN EZ A SZEKCIÓ (tulajdonosi kérés, 2026-08-16): a régi kineticare.hu
// sötétkék sávján két fehér kártya állt, mindegyikben a gyógytornász portréja,
// neve, telefonszáma és egy „TOVÁBB" hivatkozás a végzettségekhez. Nálunk ez a
// tartalom eddig KÉT hibás alakban élt:
//   - a /rolunk szekciósorában folyó szövegként („… – telefon: +36 30 169
//     2263"), tehát a szám NEM volt kattintható és NEM volt mellette arc,
//   - a /szolgaltatasok oldalon SEHOGY: az `docs/informacios-architektura.md`
//     5. fejezetének élő mérése szerint a lap `<main>`-jében nulla név, nulla
//     arc és nulla telefonszám van, csak egy általános „Kapcsolat" szöveglink.
//
// A KÉT ADAT EGY FORRÁSBÓL jön (név, titulus, telefon), és a titulus magából a
// szakmai önéletrajz-konstansból (`ROLUNK_ONELETRAJZOK`) olvasódik ki. Enélkül
// pontosan az a hiba állna elő, amit az IA-leltár 6.4 D4 pontja mér a SOS
// kurzuson: „három név, egy termék" — ugyanaz a személy oldalanként más
// titulussal.
// ---------------------------------------------------------------------------

/** Egy szakember bejelentkezés-kártyája (a `teamMembers` blokk egy tagja). */
interface SzakemberKartya {
  nev: string
  /** Rövid, 2 mondatos bemutatkozás — a teljes életút a harmonikában marad. */
  bemutatkozas: string
  /** A hívás-hivatkozás felirata (ige + tárgy, egyes szám második személy). */
  hivasFelirat: string
  telefon: string
  /** A portré fájlneve a Médiatárban (LEGACY_IMAGES). */
  portreFajl: string
}

const SZAKEMBER_KARTYAK: readonly SzakemberKartya[] = [
  {
    nev: 'Kocsis Kata',
    bemutatkozas:
      'Kézsérülésekkel, műtét utáni állapotokkal és sportolói panaszokkal foglalkozik. A kéz, a csukló és a könyök rehabilitációjáról szóló akkreditált kurzus oktatója.',
    hivasFelirat: 'Hívd Kocsis Katát',
    telefon: '+36 30 169 2263',
    portreFajl: '67b3c6e9e315f_KocsisKatakozeli.png',
  },
  {
    nev: 'Kiss Kata',
    bemutatkozas:
      'Manuálterapeutaként a csukló- és kézpanaszok hátterét keresi, a sportolói eseteket is beleértve. A Magyar Sportrehabilitációs Konferencián az ulnáris oldali csuklófájdalmakról tartott előadást.',
    hivasFelirat: 'Hívd Kiss Katát',
    telefon: '+36 20 357 3493',
    portreFajl: '67c07def59ac2_KissKataelegans.png',
  },
]

/** A szakember titulusa a szakmai önéletrajzból — hogy a kettő ne csúszhasson el. */
const szakemberTitulus = (nev: string): string =>
  ROLUNK_ONELETRAJZOK.find((cv) => cv.nev === nev)?.titulus ?? ''

interface SzakemberSzekcioOpciok {
  eyebrow: string
  title: string
  lead: string
  anchorId: string
  hatter: 'feher' | 'tint' | 'sotet'
  /** A „szakmai háttér" hivatkozás célja (lapon belüli horgony vagy /rolunk-ra mutató). */
  hatterUrl: string
  /**
   * Az ÍRÁSOS időpontkérés célcíme (a szekció alján, a kártyák alatt).
   *
   * Alapból a /kapcsolat lap; MAGÁN a /kapcsolat lapon viszont lapon belüli
   * horgony, mert az önmagára mutató link a látogatót sehova nem viszi, csak
   * újratölti a lapot („the current document should never link to itself" —
   * https://www.w3.org/wiki/Creating_multiple_pages_with_navigation_menus).
   *
   * `null` = a szekció NEM kap ilyen hivatkozást. Ez a /kapcsolat lap esete
   * (tulajdonosi döntés, 2026-08-17): ott az időpontkérő szekció közvetlenül a
   * kártyák FÖLÖTT áll, kiírja a rendelők címét és mindkét telefonszámot, a
   * kártyák pedig maguk is hívás-linket viselnek. Egy odaugró link tehát olyan
   * adathoz vinne, ami már a látogató szeme előtt van.
   */
  idopontkeresUrl?: string | null
  /** Portré-azonosítók fájlnév szerint; hiányzó kép esetén a kártya kép nélkül áll. */
  portrek?: Partial<Record<string, number | undefined>>
}

/**
 * A bejelentkezés-szekció (teamMembers blokk) egy oldalra.
 *
 * A kártya-hivatkozás felirata MINDKÉT oldalon ugyanaz („Nézd meg a szakmai
 * hátterét"), csak a célja tér el (lapon belüli horgony vs. /rolunk-ra mutató)
 * — ez a `docs/ui-sztenderdek.md` C-1 szabálya: ugyanaz a cselekvés, ugyanaz a
 * szó.
 *
 * A SZEKCIÓ ALJI HIVATKOZÁS az írásos időpontkérésre visz: az NN/g
 * egészségügyi út-kutatása szerint a válaszadók többsége kifejezetten kerüli a
 * telefonálást, mert az gyakran válasz nélkül marad
 * (https://www.nngroup.com/articles/healthcare-customer-journeys/). A felirat a
 * `docs/ui-sztenderdek.md` §3.2 #24 sora.
 */
const szakemberSzekcio = (opciok: SzakemberSzekcioOpciok): NonNullable<Page['layout']>[number] => ({
  blockType: 'teamMembers',
  eyebrow: opciok.eyebrow,
  title: opciok.title,
  lead: opciok.lead,
  ...(opciok.idopontkeresUrl === null
    ? {}
    : {
        bookingLink: {
          // CTA-felirat: docs/ui-sztenderdek.md §3.2 #24
          felirat: 'Kérj időpontot üzenetben',
          url: opciok.idopontkeresUrl ?? '/kapcsolat',
          ujAblakban: false,
        },
      }),
  members: SZAKEMBER_KARTYAK.map((kartya) => ({
    photo: opciok.portrek?.[kartya.portreFajl],
    name: kartya.nev,
    role: szakemberTitulus(kartya.nev),
    bio: kartya.bemutatkozas,
    phone: kartya.telefon,
    callLabel: kartya.hivasFelirat,
    email: '',
    // A tulajdonos 2026-08-17-i válasza a korábban nyitva hagyott kérdésre:
    // NINCS közzétehető rendelési idő és fix helyszín, mert a helyszínt a
    // szakember a pácienssel TELEFONON egyezteti. Ezért nem nyitvatartást
    // írunk (az kitalált adat lenne), hanem azt, ami IGAZ: a hívás után derül
    // ki, hova kell menni. Így a mező a valódi folyamatot írja le, és a
    // látogató sem vár hiába egy címet a lapon.
    availability: 'A hívás során megbeszélitek, melyik rendelőbe érdemes jönnöd.',
    link: {
      felirat: 'Nézd meg a szakmai hátterét',
      url: opciok.hatterUrl,
      ujAblakban: false,
    },
  })),
  sectionSettings: { visible: true, anchorId: opciok.anchorId, hatter: opciok.hatter },
})

/**
 * A /rolunk „Partnereink" szekciója: mozgó logósáv + egy mondat a logó nélküli
 * partnerekről (tulajdonosi kérés A04: „a Partnerek logóit úgy, ahogy az előző
 * oldalunkon volt, egy sávban csússzanak").
 *
 * MIÉRT a meglévő `pressLogos` blokk: ugyanaz a komponens, mint a lap
 * „Itt találkozhattál velünk" sora — a LogoRail folyamatos, egérrel és a
 * szünet-gombbal megállítható, `prefers-reduced-motion` alatt statikus
 * (WCAG 2.2 SC 2.2.2 Pause, Stop, Hide; SC 1.1.1: a logó alt-ja a szervezet
 * neve). Egy mintát a látogató egyszer tanul meg (NN/g, Consistency and
 * Standards). A bizalmi hatás forrásai: NN/g „Trustworthiness in Web Design"
 * (https://www.nngroup.com/articles/trustworthy-design/) — a külső, ismerős
 * nevek a hitelesség jelzői; Baymard „site seal trust"
 * (https://baymard.com/blog/site-seal-trust) — a felismerhető jelvények
 * növelik a bizalmat, az ismeretlenek nem. Ezért a sávba csak tényleges
 * logófájl kerül, fotó vagy aláírás nem; a többi partner mondatban marad.
 *
 * Darabszám: 11 logó (≤ 12, a blokk `maxRows`-a). A folyamatos sáv miatt egy
 * nézetben így is csak 5–8 logó látszik egyszerre — a Baymard/NN/g 8–12-es
 * olvashatósági küszöb a statikus sorra vonatkozik, a sáv a többit görgeti.
 *
 * Logó nélkül (`partnerLogok` üres) csak a mondat marad, mint eddig — a rich-
 * text ág és a tesztek így adatbázis nélkül is teljes értékűek.
 */
const rolunkPartnerSzekciok = (
  partnerLogok: readonly number[],
  hatter: 'feher' | 'tint' | 'sotet' = 'feher',
): NonNullable<Page['layout']> => [
  ...(partnerLogok.length > 0
    ? [
        {
          blockType: 'pressLogos' as const,
          heading: ROLUNK_PARTNER_FELIRAT,
          logos: partnerLogok.map((image) => ({ image })),
          sectionSettings: { visible: true, anchorId: 'partnereink', hatter },
        },
      ]
    : []),
  {
    blockType: 'richText' as const,
    content: richText([para(ROLUNK_TOVABBI_PARTNEREK)]),
    sectionSettings: { visible: true, hatter },
  },
]

/** A sajtó-logósor felirata (a home-seed és a PressLogos alapfelirata is ez). */
const SAJTO_FELIRAT = 'Itt találkozhattál velünk'

type SzekciosorBlokk = NonNullable<Page['layout']>[number]

/** Egy blokk logóinak média-id-jei (depth 0-s olvasásnál számok, különben objektumok). */
const logoMediaIds = (block: Extract<SzekciosorBlokk, { blockType: 'pressLogos' }>) =>
  (block.logos ?? []).map((logo) => (typeof logo.image === 'number' ? logo.image : logo.image.id))

/** Egy rich-text blokk ELSŐ csomópontjának szövege (címsor vagy bekezdés). */
const elsoSzoveg = (block: SzekciosorBlokk): string => {
  if (block.blockType !== 'richText') return ''
  const first = block.content?.root?.children?.[0] as
    { children?: { text?: unknown }[] } | undefined
  const text = first?.children?.[0]?.text
  return typeof text === 'string' ? text : ''
}

/** Egy szekciósor-frissítés terve: az új sor, vagy `null`, ha nincs teendő. */
interface LogosavTerv {
  layout: NonNullable<Page['layout']> | null
  /** Naplózható indoklás: mit tenne, vagy miért nem nyúl hozzá. */
  uzenet: string
}

/**
 * MEGLÉVŐ szekciósor sajtó-logósorának ADDITÍV bővítése (H05): a felirat
 * szerint azonosított blokk végére fűzi azokat a logókat, amelyek a teljes
 * sorból (`sajtoLogok`) még hiányoznak. Meglévő bejegyzést nem töröl és nem
 * rendez át (a manifest `preserveExisting` szabálya); ha a bővítés túllépné a
 * blokk 12-es korlátját, nem nyúl hozzá. Tiszta függvény, adatbázis nélkül.
 */
const tervezdSajtoLogosorBovitest = (
  layout: Page['layout'],
  sajtoLogok: readonly number[],
  felirat: string,
): LogosavTerv => {
  if (!Array.isArray(layout) || layout.length === 0) {
    return { layout: null, uzenet: 'az oldalnak nincs szekciósora' }
  }
  const index = layout.findIndex(
    (block) => block.blockType === 'pressLogos' && (block.heading?.trim() || '') === felirat,
  )
  if (index === -1) {
    return { layout: null, uzenet: `nincs „${felirat}" feliratú sajtó-logósor a szekciósorban` }
  }
  const block = layout[index]
  if (block.blockType !== 'pressLogos') return { layout: null, uzenet: 'belső hiba' }
  const meglevo = new Set(logoMediaIds(block))
  const hianyzo = sajtoLogok.filter((id) => !meglevo.has(id))
  if (hianyzo.length === 0) {
    return { layout: null, uzenet: 'a sajtó-logósor már minden ellenőrzött logót tartalmaz' }
  }
  if (meglevo.size + hianyzo.length > 12) {
    return {
      layout: null,
      uzenet: `a bővítés túllépné a blokk 12-es korlátját (${meglevo.size} meglévő + ${hianyzo.length} új) — kézi átnézés kell`,
    }
  }
  const ujLayout = [...layout]
  ujLayout[index] = {
    ...block,
    logos: [...(block.logos ?? []), ...hianyzo.map((image) => ({ image }))],
  }
  return {
    layout: ujLayout,
    uzenet: `${hianyzo.length} új logó a sajtó-logósor végére (${meglevo.size} meglévő marad)`,
  }
}

/**
 * MEGLÉVŐ /rolunk szekciósor „Partnereink" szövegbekezdésének cseréje a
 * partner-logósávra + a logó nélküli partnerek mondatára (A04). Csak akkor
 * nyúl hozzá, ha (a) még nincs „Partnereink" feliratú logósáv, és (b) pontosan
 * egy olyan rich-text blokk van, amelynek ELSŐ csomópontja a „Partnereink"
 * címsor — ez a seed által letett bekezdés; bármi más a szerkesztőé.
 */
const tervezdPartnerSavot = (
  layout: Page['layout'],
  partnerLogok: readonly number[],
): LogosavTerv => {
  if (!Array.isArray(layout) || layout.length === 0) {
    return { layout: null, uzenet: 'az oldalnak nincs szekciósora' }
  }
  if (partnerLogok.length === 0) {
    return { layout: null, uzenet: 'egyetlen partnerlogó sincs a Médiatárban' }
  }
  if (
    layout.some(
      (block) =>
        block.blockType === 'pressLogos' &&
        (block.heading?.trim() || '') === ROLUNK_PARTNER_FELIRAT,
    )
  ) {
    return { layout: null, uzenet: 'a partner-logósáv már a szekciósorban van' }
  }
  const jeloltek = layout.flatMap((block, index) =>
    block.blockType === 'richText' && elsoSzoveg(block) === ROLUNK_PARTNER_FELIRAT ? [index] : [],
  )
  if (jeloltek.length !== 1) {
    return {
      layout: null,
      uzenet: `nem pontosan egy „${ROLUNK_PARTNER_FELIRAT}" című rich-text blokk van (${jeloltek.length}) — kézi átnézés kell`,
    }
  }
  const regi = layout[jeloltek[0]]
  const hatter: 'feher' | 'tint' | 'sotet' =
    regi.blockType === 'richText' ? (regi.sectionSettings?.hatter ?? 'feher') : 'feher'
  // A régi blokk háttérsávját örökli, hogy a szerkesztő sávritmusa ne boruljon.
  const ujSzekciok = rolunkPartnerSzekciok(partnerLogok, hatter)
  const ujLayout = [...layout]
  ujLayout.splice(jeloltek[0], 1, ...ujSzekciok)
  return {
    layout: ujLayout,
    uzenet: `a „${ROLUNK_PARTNER_FELIRAT}" szövegbekezdés helyére ${partnerLogok.length} logós sáv + a logó nélküli partnerek mondata`,
  }
}

/**
 * A két logósáv frissítése a MEGLÉVŐ szekciósorokon (LEGACY_LOGOSAV=igen).
 * Oldalanként egy `payload.update`, kizárólag a `layout` mezőre; a tervezés a
 * fenti tiszta függvényeké, a döntés minden ágon naplózódik.
 */
const frissitsdLogosavokat = async (
  payload: Payload,
  input: { sajtoLogok: readonly number[]; partnerLogok: readonly number[] },
): Promise<void> => {
  const oldalak: { slug: string; tervek: ((layout: Page['layout']) => LogosavTerv)[] }[] = [
    {
      slug: 'kezdolap',
      tervek: [(layout) => tervezdSajtoLogosorBovitest(layout, input.sajtoLogok, SAJTO_FELIRAT)],
    },
    {
      slug: 'rolunk',
      tervek: [
        (layout) => tervezdSajtoLogosorBovitest(layout, input.sajtoLogok, SAJTO_FELIRAT),
        (layout) => tervezdPartnerSavot(layout, input.partnerLogok),
      ],
    },
  ]
  for (const oldal of oldalak) {
    const page = (
      await payload.find({
        collection: 'pages',
        where: { slug: { equals: oldal.slug } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })
    ).docs[0]
    const cimke = `logósávok: ${oldal.slug}`
    if (page === undefined) {
      naploKihagyas(payload, cimke, 'az oldal nem található')
      continue
    }
    let layout: Page['layout'] = page.layout
    const valtozasok: string[] = []
    for (const terv of oldal.tervek) {
      const eredmeny = terv(layout)
      if (eredmeny.layout === null) {
        payload.logger.info(`Legacy: ${cimke} — nincs teendő: ${eredmeny.uzenet}.`)
        continue
      }
      layout = eredmeny.layout
      valtozasok.push(eredmeny.uzenet)
    }
    if (valtozasok.length === 0) {
      naploKihagyas(payload, cimke, 'a logósávok már naprakészek')
      continue
    }
    if (!DRY_RUN) {
      await payload.update({
        collection: 'pages',
        id: page.id,
        data: { layout },
        overrideAccess: true,
      })
    }
    naploFeluliras(payload, `${cimke} — ${valtozasok.join('; ')}`)
  }
}

/**
 * A /rolunk alap-szekciósora.
 *
 * Kép nélkül (`buildRolunkLayout()`) is teljes értékű: a fotó és a logósor
 * futásidejű Media id-kre hivatkozik, ezek hiányában az adott szekció kép
 * nélkül épül fel, a logósor pedig egyszerűen kimarad.
 */
const buildRolunkLayout = (media: OldalLayoutMedia = {}): NonNullable<Page['layout']> => {
  const sajtoLogok = media.sajtoLogok ?? []
  const partnerLogok = media.partnerLogok ?? []
  return [
    // 1. réteg — a lap bevezetője folyó szövegként (a mértéket a .kc-richtext
    // adja: 34rem ≈ 75 karakter, B1.1).
    {
      blockType: 'richText',
      content: richText(rolunkBevezetoNodes()),
      sectionSettings: { visible: true, hatter: 'feher' },
    },

    // 2. réteg — bemutatkozás + hitel SZÁMOKKAL. A számok VALÓS, dokumentált
    // adatok: a „10+ év" és az „1000+ páciens" a kezdőlapon is ez (a régi oldal
    // minden előfordulásban 1000+-t állít), a 12 kreditpont és az akkreditációs
    // szám a képzés adata, a két egyesületi tagság a lap saját szövegéből jön.
    {
      blockType: 'about',
      eyebrow: 'Rólunk',
      title: 'Megérdemled a profi törődést',
      paragraphs: ROLUNK_BEMUTATKOZAS.map((text, index) => ({
        text,
        emphasized: index === 0,
      })),
      feature: {
        label: 'Szakmai egyesületi tagság',
        note: 'A Magyar Sportrehabilitációs Egyesület és a Magyar Gyógytornász-Fizioterapeuták Társaságának munkájában is részt veszünk.',
      },
      photo: media.rolunkFoto,
      stats: [
        { value: '10+', label: 'év szakmai tapasztalat' },
        { value: '1000+', label: 'elégedett páciens' },
        { value: '12', label: 'kreditpont — akkreditált képzés (SZTK-A-33553/2024)' },
        { value: '2', label: 'szakmai egyesületi tagság' },
      ],
      sectionSettings: { visible: true, anchorId: 'rolunk', hatter: 'tint' },
    },

    // Külső, ellenőrizhető bizonyíték (B6.6): a médiamegjelenések logói,
    // közvetlenül a hitel-számok után. A logókat a KEZDŐLAPI seed tölti fel; ha
    // még egy sincs a Médiatárban, a szekció kimarad (üres logósort nem teszünk
    // ki). A háttere ezért szándékosan ugyanaz, mint az utána következő
    // szekcióé: így a sáv hiánya nem borítja fel a fehér ↔ világoskék ritmust.
    ...(sajtoLogok.length > 0
      ? [
          {
            blockType: 'pressLogos' as const,
            // A felirat a kezdőlappal közös (tulajdonosi átnevezés, 2026-08-16):
            // az igazságforrás a home-seed pressLogos blokkja — ha ott változik,
            // az apply-owner-content 9. javítása az élő oldalakat is követi.
            heading: 'Itt találkozhattál velünk',
            logos: sajtoLogok.map((image) => ({ image })),
            sectionSettings: { visible: true, hatter: 'feher' as const },
          },
        ]
      : []),

    // Három párhuzamos állítás → kártyarács (B3.1). A sorszámot a megjelenítés
    // adja, ezért a címekben nincs benne.
    {
      blockType: 'usps',
      title: 'Amiben mások vagyunk',
      cards: ROLUNK_MEGKULONBOZTETOK.map((item) => ({ title: item.title, body: item.body })),
      sectionSettings: { visible: true, hatter: 'feher' },
    },

    // A három szolgáltatási ág — sor-hivatkozásokkal (nem gombbal): a lap
    // egyetlen elsődleges CTA-ja a záró sáv (B6.5).
    {
      blockType: 'services',
      eyebrow: 'Szolgáltatásaink',
      title: 'Miben segíthetünk?',
      rows: ROLUNK_SZOLGALTATASOK.map((item, index) => ({
        number: String(index + 1).padStart(2, '0'),
        title: item.title,
        body: item.body,
        felirat: item.label,
        url: item.url,
        ujAblakban: item.newTab === true,
      })),
      sectionSettings: { visible: true, anchorId: 'szolgaltatasaink', hatter: 'tint' },
    },

    // Szakmai háttér, 1. rész — a RÖVID, MINDIG LÁTHATÓ tartalom: a két
    // szakember elérhetősége. Ezek elolvasása másodpercek, és a telefonszám a
    // lap egyik kapcsolatfelvételi útja (üzleti cél-sorrend 3. pontja) —
    // lenyitó mögé rejteni hiba lenne.
    //
    // 2026-08-16 ÓTA BLOKKBAN, NEM FOLYÓ SZÖVEGBEN. Korábban itt egy richText
    // bekezdés állt („… – telefon: +36 30 169 2263"): a szám nem volt
    // kattintható, és nem volt mellette arc. A `teamMembers` blokk mindkettőt
    // megadja, és a lap ALJÁN álló részletes önéletrajz-harmonikára mutat
    // (#szakmai-hatter) ahelyett, hogy megismételné.
    szakemberSzekcio({
      eyebrow: 'Elérhetőség',
      title: 'Így érsz el minket közvetlenül',
      lead: 'Hívj minket, ha időpontot kérnél, vagy ha kérdésed van a kezelésekről.',
      anchorId: 'elerhetoseg',
      hatter: 'feher',
      hatterUrl: '#szakmai-hatter',
      portrek: {
        '67b3c6e9e315f_KocsisKatakozeli.png': media.kocsisPortre,
        '67c07def59ac2_KissKataelegans.png': media.kissPortre,
      },
    }),

    // Partnerek — a lap külső, ellenőrizhető referencia-sora, logósávként
    // (tulajdonosi kérés A04) + a logó nélküli partnerek mondata. Ugyanabban
    // a fehér régióban marad, a szakemberek alatt.
    ...rolunkPartnerSzekciok(partnerLogok),

    // Szakmai háttér, 2. rész — a HOSSZÚ listás olvasnivaló harmonikában.
    //
    // MIÉRT: a két teljes önéletrajz (tanulmányok, ~70 tanfolyam, publikációk,
    // konferenciák, médiamegjelenések) folyó szövegként több képernyőnyi
    // görgetés volt a lap alsó felében — a tulajdonos kérése, hogy legyen
    // nyitható-csukható. A bizonyíték MENNYISÉGE viszont maga a bizalmi jelzés,
    // ezért nem rövidítjük: a darabszám a fejlécben, csukott állapotban is
    // látszik (`cvOsszefoglalo`, a TÉNYLEGES sorokból számolva).
    //
    // GOV.UK-szabály (értékesítési UX-skill): árat, garanciát és elsődleges
    // CTA-t sosem rejtünk lenyitó mögé — itt MÁSODLAGOS, referencia-jellegű
    // szakmai életútról van szó, ez mehet.
    //
    // A háttere szándékosan ugyanaz („feher"), mint az előző blokké: a két
    // szekció EGY régiót alkot (B2.2 — a sávváltás a közös régiókat jelöli),
    // a horgony (`szakmai-hatter`) pedig a részletes részre mutat.
    {
      blockType: 'accordion',
      eyebrow: 'Szakmai háttér',
      title: 'Részletes szakmai háttér',
      lead: 'A teljes szakmai életutunk — tanulmányok, továbbképzések, publikációk, előadások és médiamegjelenések. Nyisd ki, amelyik érdekel.',
      items: ROLUNK_ONELETRAJZOK.map((cv) => ({
        cim: `${cv.nev} — szakmai önéletrajz`,
        osszefoglalo: cvOsszefoglalo(cv),
        tartalom: richText(oneletrajzNodes(cv)),
      })),
      sectionSettings: { visible: true, anchorId: 'szakmai-hatter', hatter: 'feher' },
    },

    // Vélemények — adatvezérelt (Tartalom → Vélemények, kiemelt tételek).
    {
      blockType: 'testimonials',
      eyebrow: 'Vélemények',
      heading: 'Pácienseink mondták',
      maxItems: 3,
      sectionSettings: { visible: true, anchorId: 'velemenyek', hatter: 'tint' },
    },

    // A lap EGYETLEN elsődleges CTA-ja: a fizetős kurzus (üzleti cél-sorrend,
    // értékesítési UX-skill 1. pont).
    {
      blockType: 'ctaBanner',
      title: 'Kezdd el otthon, a saját tempódban',
      text: 'Ha nem tudsz eljutni hozzánk a rendelőbe, az otthoni kézrehabilitációs programunkkal bárhol, bármikor gyakorolhatsz.',
      cta: { felirat: 'Megnézem a kurzusokat', url: '/kurzusok', ujAblakban: false },
      sectionSettings: { visible: true, hatter: 'feher' },
    },
  ]
}

/**
 * A /szolgaltatasok alap-szekciósora.
 *
 * A lap feladata a DÖNTÉS támogatása („melyik út való nekem?"), ezért a három
 * ág egyetlen szekcióban, azonos mezőrenddel áll egymás mellett (5.3, B4.1), a
 * részletek és az árlista pedig alatta.
 *
 * A modul aljáról EXPORTÁLT (lásd a záró `export { … }` blokkot), hogy az élő
 * layout horgony-javítása (src/scripts/apply-owner-content.ts) ellen
 * tesztelhető legyen: a kód-szintű alapállapotnak MÁR a helyes horgonyt kell
 * adnia, így a seed és a javítás nem csúszhat szét.
 */
const buildSzolgaltatasokLayout = (media: OldalLayoutMedia = {}): NonNullable<Page['layout']> => [
  // Bevezető — a probléma és a kivezető út, ÜDVÖZLŐ (welcome) blokként.
  //
  // MIÉRT NEM richText: a lap teteje korábban EGYETLEN, folyó szöveges blokk
  // volt (két h2-címsor és öt bekezdés egymás alatt) — a látogató a lap
  // legfontosabb helyén szövegfalat kapott, tagolás és vizuális kapaszkodó
  // nélkül. Ugyanez a tartalom a kezdőlapon már bevált szerkezetben áll
  // (cím + felvezető, alatta pipás felsorolás és oldalsó összefoglaló), ezért
  // a /szolgaltatasok teteje is ezt a blokkot kapja (redesign, 2026-08-16).
  //
  // A SZÖVEG BETŰHÍVEN a régi kineticare.hu bevezetője marad — ugyanaz, amit a
  // `szolgaltatasokBevezetoNodes()` rich-text változata visz (az a lap
  // `content` mezőjében tovább él): a szerkezet változik, tartalom nem vész el.
  // A hosszú, kétállítású zárómondat kettéválik: az elvi rész a felsorolás
  // utolsó tétele, a módszertani rész az oldalsó bekezdések záró tagja.
  {
    blockType: 'welcome',
    title: 'Fáj a kezed, csuklód, könyököd vagy vállad?',
    lead: 'Van megoldás, ha tudod, merre indulj',
    checklist: [
      {
        text: 'A legtöbb kéz-, csukló- vagy könyökprobléma megfelelő terápiával hatékonyan kezelhető, és akár a műtét is elkerülhető.',
      },
      {
        text: 'Ehhez persze türelemre és kitartásra van szükség, de a test egy csodálatos „szerkezet”: ha segítünk neki, képes rendbehozni magát.',
      },
      {
        text: 'A kézfájdalmak kezelésében nem hiszünk a gyors, felületes megoldásokban.',
      },
    ],
    sideParagraphs: [
      {
        text: 'Tudjuk, hogy ez a probléma mennyire tud hátráltatni a munkában vagy a sportban, de még a hétköznapokban is.',
        emphasized: false,
      },
      {
        text: 'Ezért professzionális kezeléseinkkel és online programjainkkal abban segítünk, hogy minél gyorsabban visszanyerd a kezed erejét és mozgását, hosszú távú eredményekkel.',
        emphasized: true,
      },
      {
        text: 'A kezeléseink és programjaink a legmodernebb mozgásterápiás és manuálterápiás módszerekre épülnek, hogy segítsenek a gyökérok megszüntetésében, és a hosszú távú regenerációban.',
        emphasized: false,
      },
    ],
    sectionSettings: { visible: true, hatter: 'feher' },
  },

  // A három ág egymás mellett, azonos sorrendű mezőkkel (kinek való → hol →
  // ár), sor-hivatkozásokkal. A külső partneroldal ugyanolyan súlyú
  // sor-hivatkozást kap, mint a másik kettő — gombot nem (B6.5).
  {
    blockType: 'services',
    eyebrow: 'Szolgáltatásaink',
    title: 'Válaszd ki, hogyan segíthetünk neked a legjobban',
    image: media.szolgaltatasokKep,
    rows: SZOLGALTATASI_AGAK.map((item, index) => ({
      number: String(index + 1).padStart(2, '0'),
      title: item.title,
      body: item.body,
      felirat: item.label,
      url: item.url,
      ujAblakban: item.newTab === true,
    })),
    sectionSettings: { visible: true, anchorId: 'szolgaltatasaink', hatter: 'tint' },
  },

  // Rendelői részletek + árlista egy közös régióban (B2.2). Az időpontkérés
  // itt szöveglink, nem gomb — a lap elsődleges CTA-ja a záró sáv (B6.5).
  //
  // A horgony `rendeloi`, NEM `arlista`: a fejléc-menü „Rendelői kezelések"
  // pontja a `/szolgaltatasok#rendeloi` címre visz (src/lib/menu-seed.ts
  // CLINIC_TREATMENTS_PATH), a szekció viszont korábban `arlista` horgonyt
  // kapott — így a menüpontra kattintva SEMMI nem történt (a böngésző nem
  // talált ilyen id-t). A szekció a rendelői kezelésekkel KEZDŐDIK (az árlista
  // ugyanennek a régiónak a második fele), tehát a menüpont célja pontosan ez
  // a blokk. `arlista` horgonyra a repóban semmi nem hivatkozik.
  {
    blockType: 'richText',
    content: richText([...rendeloiKezelesekNodes(), ...arlistaNodes('szoveglink')]),
    sectionSettings: { visible: true, anchorId: CLINIC_TREATMENTS_ANCHOR, hatter: 'feher' },
  },

  // „Kihez jössz, ha időpontot kérsz?" — a rendelői régió ZÁRÓ lépése.
  //
  // MIÉRT ITT (docs/informacios-architektura.md alapján): a 2.1 leltár szerint
  // ez a lap a rendelői kezelések oldala, tehát ITT dől el a személyes
  // bejelentkezés; az 5. fejezet élő mérése szerint viszont a `<main>`-ben ma
  // egyetlen név, arc és telefonszám sincs, csak általános „Kapcsolat"
  // szöveglink. Az NN/g hitelesség-kutatásának 2. tényezője (Upfront
  // Disclosure) épp azt kéri, hogy a kapcsolati adat ott legyen kiírva, ahol a
  // döntés születik, ne űrlap mögött
  // (https://www.nngroup.com/articles/trustworthy-design/).
  //
  // A háttere SZÁNDÉKOSAN ugyanaz („feher"), mint az árlistáé: a kettő EGY
  // régió (mit kapsz, mennyiért, kitől, hogyan jelentkezel be) — a sávváltás
  // a régióhatárt jelöli, nem a szekcióhatárt (B2.2).
  szakemberSzekcio({
    eyebrow: 'Bejelentkezés',
    title: 'Kihez jössz, ha időpontot kérsz?',
    lead: 'A rendelői kezeléseket mi ketten tartjuk. Nézd meg, kihez jönnél szívesen, és hívd őt közvetlenül.',
    anchorId: 'szakembereink',
    hatter: 'feher',
    hatterUrl: SZAKMAI_HATTER_URL,
    portrek: {
      '67b3c6e9e315f_KocsisKatakozeli.png': media.kocsisPortre,
      '67c07def59ac2_KissKataelegans.png': media.kissPortre,
    },
  }),

  // Három párhuzamos érv → kártyarács (B3.1).
  {
    blockType: 'usps',
    title: 'Ezért fogod imádni',
    cards: SZOLGALTATASOK_ERVEK.map((item) => ({ title: item.title, body: item.body })),
    sectionSettings: { visible: true, hatter: 'tint' },
  },

  // Vélemények — adatvezérelt.
  {
    blockType: 'testimonials',
    eyebrow: 'Vélemények',
    heading: 'Pácienseink mondták',
    maxItems: 3,
    sectionSettings: { visible: true, anchorId: 'velemenyek', hatter: 'feher' },
  },

  // A lap EGYETLEN elsődleges CTA-ja: a fizetős kurzus.
  {
    blockType: 'ctaBanner',
    title: 'Kezdd el otthon, a saját tempódban',
    text: 'Az otthoni programunkkal a saját tempódban haladhatsz, bárhol, bármikor, a gyakorlatokat kézrehabilitációs gyógytornászok állították össze.',
    cta: { felirat: 'Megnézem a kurzusokat', url: '/kurzusok', ujAblakban: false },
    sectionSettings: { visible: true, hatter: 'tint' },
  },
]

// ---------------------------------------------------------------------------
// /kapcsolat — az időpontkérő szekció alapállapota
// ---------------------------------------------------------------------------

/**
 * /kapcsolat CMS layout: időpontkérő szekció (route a `layout`-ot rendereli, nem
 * a `content`-et). Valós címek/árak a repóból; hétvégi sáv szándékosan nincs.
 * Időpontkérő űrlap marad; az általános üzenetűrlapot a route adja külön.
 */
const KAPCSOLAT_IDOPONTKERES = {
  blockType: 'appointment' as const,
  eyebrow: 'Rendelői kezelés',
  title: 'Kérj időpontot a rendelőbe',
  lead: 'Gyógytorna, manuálterápia és kiegészítő terápiák akut sérülésre, műtét utáni állapotra és krónikus fájdalomra. Hagyd itt az elérhetőséged, és megkeressük a neked megfelelő időpontot.',
  magyarazat:
    'Ez az űrlap nem foglalás. Miután elküldted, két munkanapon belül telefonon keresünk, és közösen egyeztetjük a pontos időpontot. Az első alkalom minden esetben 50 perces vizsgálattal kezdődik.',
  urlapCim: 'Időpontkérés',
  gombFelirat: 'Időpontot kérek',
  idopontSavok: [
    { felirat: 'Hétköznap délelőtt' },
    { felirat: 'Hétköznap délután' },
    { felirat: 'Rugalmas vagyok' },
  ],
  helyszinekFelirat: 'Rendelőink',
  helyszinek: [
    { cim: '1117 Budapest, Nádorliget u. 7/b' },
    { cim: '1114 Budapest, Fadrusz utca 15.' },
  ],
  telefonFelirat: 'Telefon',
  telefonszamok: [
    { nev: 'Kocsis Kata', szam: '+36 30 169 2263' },
    { nev: 'Kiss Kata', szam: '+36 20 357 3493' },
  ],
  emailFelirat: 'E-mail',
  email: 'info@kineticare.hu',
  sikerCim: 'Megkaptuk az időpontkérésed',
  sikerSzoveg:
    'Két munkanapon belül telefonon keresünk, és egyeztetjük a pontos időpontot. Ha addig megváltozna valami, hívj minket nyugodtan.',
  sectionSettings: {
    visible: true,
    anchorId: IDOPONTKERES_HORGONY,
    hatter: 'tint' as const,
  },
}

/**
 * /kapcsolat szakember-szekció: időpontkérő után, közvetlen elérhetőség fókusz.
 */
const kapcsolatSzakemberSzekcio = (
  media: OldalLayoutMedia = {},
): NonNullable<Page['layout']>[number] =>
  szakemberSzekcio({
    eyebrow: 'Közvetlen elérhetőség',
    title: 'Kit hívj, ha nem várnál a visszahívásra?',
    lead: 'Az időpontkérésre két munkanapon belül telefonálunk. Ha ennél gyorsabb választ szeretnél, hívj minket közvetlenül: alább látod, ki mivel foglalkozik, és melyik szám kié.',
    anchorId: 'elerhetoseg',
    hatter: 'feher',
    hatterUrl: SZAKMAI_HATTER_URL,
    idopontkeresUrl: `#${IDOPONTKERES_HORGONY}`,
    portrek: {
      '67b3c6e9e315f_KocsisKatakozeli.png': media.kocsisPortre,
      '67c07def59ac2_KissKataelegans.png': media.kissPortre,
    },
  })

/** /kapcsolat layout: időpontkérő (tint) + szakember (fehér). */
const buildKapcsolatLayout = (media: OldalLayoutMedia = {}): NonNullable<Page['layout']> => [
  KAPCSOLAT_IDOPONTKERES,
  kapcsolatSzakemberSzekcio(media),
]

/**
 * A /kapcsolat CMS-oldal rich-text törzse. A route NEM jeleníti meg (a lap
 * fejlécét és az üzenetküldő szekciót maga adja), de a `content` mező a Pages
 * collectionben kötelező — ezért itt a lap két útjának rövid, igaz leírása áll.
 */
const kapcsolatContent = (): RichTextContent =>
  richText([
    para(
      'Rendelői kezelésre az időpontkérő szekcióban tudsz jelentkezni: hagyd meg a neved és a telefonszámod, és két munkanapon belül visszahívunk.',
    ),
  ])

// ---------------------------------------------------------------------------
// Termékleírások — a régi sales-oldalak (kezrehab.md, kezrelax.md) szövegéből.
// ---------------------------------------------------------------------------

const kezrehabLongDescription = (): Product['longDescription'] =>
  richText([
    para(
      'Az Otthoni KézRehab egy könnyen követhető, otthon is biztonságosan alkalmazható kézrehabilitációs program, amivel megszüntetheted vagy jelentősen enyhítheted a csukló-, ujj-, alkar- és könyökfájdalmakat, akár hetek alatt. Mindezt drága eszközök és macerás gyakorlatok nélkül, akár napi néhány percben – kézrehabilitációs gyógytornászok állították össze.',
    ),
    para('Ezzel a módszerrel képes leszel:'),
    bulletList([
      'a hetek, hónapok óta tartó fájdalmat is rendbehozni az ujjaidban, csuklódban, karodban vagy a könyöködben,',
      'megtanulni a megelőzés „fortélyait”, hogy innentől tudatosan védhesd a kezeidet a túlterheléstől,',
      'felkészíteni a kezeidet a napi terhelésre, hogy a nap végén se sajogjanak vagy zsibbadjanak.',
    ]),
    heading('h2', 'Mi vár a programban?'),
    heading('h3', 'I. modul: Az alapok'),
    bulletList([
      '„Belenézünk a kezedbe” – rövid és nagyon egyszerű anatómiai áttekintés',
      'Megnézzük, hol vannak a csontok, ízületek, szalagok és inak, mi a szerepük és hogyan működnek',
      'Megszüntetjük azokat a tévhiteket, amik sokakat gátolnak abban, hogy megelőzzék vagy megszüntessék a fájdalmat a kezükben',
    ]),
    heading('h3', 'II. modul: A probléma'),
    bulletList([
      '„Miért alakul ki a probléma?”',
      'Gyakori példákon keresztül megmutatjuk, mik a tipikus hibák munka, sport vagy hétköznapi tevékenységek közben, amik miatt kialakul a fájdalom',
      'Elmondjuk, milyen esetben mi a megoldás, és milyen tünetek esetén fordulj szakemberhez (és melyikhez) az öngyógyító technikák mellett',
    ]),
    heading('h3', 'III. modul: A megoldás'),
    para('Technikák és gyakorlatok a különböző problémákra:'),
    bulletList([
      'Könyökfájdalmak',
      'Csuklófájdalom',
      'Hüvelyk- és többi ujj panaszai',
      'Zsibbadó ujjak',
    ]),
    heading('h3', 'IV. modul: A hosszú távú megelőzés'),
    bulletList([
      'Így tudod elkerülni, hogy kiújuljon a probléma',
      'Szórakoztató mobilizáló gyakorlatok a mindennapokra (avagy hogyan segíthet a reggeli kávézás a vállad és a könyököd átmozgatásában?)',
      'Milyen eszközöket érdemes használni és miért',
      'Mindent a rögzítőkről: erre figyelj a vásárlásnál',
    ]),
    heading('h2', 'Ezt kapod az Otthoni KézRehab Programban'),
    bulletList([
      '4 modulnyi részletes online videóanyag',
      '50+ videós gyakorlat – rövid, lépésről lépésre bemutatott mozdulatsorok a kezed, csuklód, alkarod és a kapcsolódó területek (háti gerinc, nyaki gerinc, váll) rehabilitálására',
      '5 perces miniblokkok – egyszerű feladatsorok, amiket fáradság nélkül beilleszthetsz a reggeledbe, egy rövid szünetbe munka közben, vagy az esti kikapcsolódásba',
      'Prevenciós útmutató – hogyan dolgozz, sportolj, vagy végezd a mindennapi tevékenységeidet anélkül, hogy újra terhelnéd a kezed',
      'Kinesio szalag minikurzus – így használd ezt a csodás eszközt a fájdalom enyhítésére',
      'Így sportolj kézrehab alatt minikurzus – hogy ne hátráltasd a gyógyulást, ugyanakkor ne ess ki a formádból',
      'Ergonómiai minikurzus friss anyukáknak – kerüld el a klasszikus „babás fájdalmakat”',
      'Tematikus e-bookok, amik támogatják a kézrehabilitációdat: eszközök, táplálékkiegészítők és kézápolás rehabhoz',
      'A gyakorlatok letölthető és nyomtatható formában',
      'A Dream Team: válogatott szakemberajánló a kiegészítő kezelésekhez (közel 100 000 Ft értékű kedvezménykuponokkal)',
    ]),
    heading('h2', 'Bónusz minikurzusok'),
    heading('h3', '01 – Kinesio szalag minikurzus (értéke 29 900 Ft – most ajándék)'),
    para(
      'Megtanulod, hogyan kell hüvelykujjat, csuklóízületet és könyökízületet hatékonyan tape-elni, hogyan készítsd elő a bőrfelületet a maximális eredmény érdekében, és mik a tipikus hibák, amiket érdemes elkerülni.',
    ),
    heading(
      'h3',
      '02 – Ergonómiai minikurzus kisbabás anyukáknak (értéke 19 900 Ft – most ajándék)',
    ),
    para(
      'Tanácsok friss édesanyáknak: milyen testhelyzeteket érdemes kerülni, és hogyan tartsd a kezed, karod és törzsed a tipikusan megterhelő tevékenységeknél (etetés, fürdetés), hogy elkerüld a „friss szülők kézbetegségét”.',
    ),
    heading('h3', '03 – Hogyan sportolj kézrehab mellett (értéke 19 900 Ft – most ajándék)'),
    para(
      'Mit tegyél, és mit ne, ha fáj a kezed, de nem szeretnéd abbahagyni a sportolást: alternatívák, speciális bemelegítés és trükkök, amikkel csökkentheted a kézfájdalom miatt kihagyott edzések számát.',
    ),
    heading('h2', 'Ez a program tökéletes számodra, ha…'),
    bulletList([
      'hónapok óta szenvedsz valamilyen fájdalommal a kezed egy vagy több részén, de eddig semmi nem hozott tartós enyhülést,',
      'sokat dolgozol a kezeddel, és erős terhelést kapnak az ujjaid, csuklód, alkarod, könyököd,',
      'messze laksz, esetleg nem tudod megoldani hetente egyszer-kétszer az utazást a gyógytornászhoz,',
      'eleged van abból, hogy az interneten talált ellentmondásos tanácsok vagy a „csodakenőcsök” nem hoznak eredményt,',
      'szeretnél aktívan tenni a gyógyulásodért, és nem csak a fájdalomcsillapításra hagyatkozni,',
      'olyan megoldást akarsz, ami biztonságos, szakmailag megalapozott, mégis otthon is végezhető,',
      'rendelkezel diagnózissal, de megakadtál, hogy merre is indulj el a rehabilitáció útján,',
      'meg szeretnéd tanulni, milyen tevékenységeket hogyan kell végezni kézkímélő módon,',
      'szeretnéd tudni, hogyan kell szakszerűen tape-elni a kezed.',
    ]),
    heading('h2', 'Nem javasoljuk a programot, ha…'),
    bulletList([
      'a kezed érintő traumás (pl. törés) sérülésed volt, és az orvos még nem enged mindent csinálni,',
      'már jelentkezett érzéskiesés, vagy régebb óta tart, észlelhető, jelentős gyengülés a szorítóerőben, esetleg látható izomtömeg-vesztés a tenyéren,',
      'már műtétre vársz, esetleg onkológiai kezelés alatt állsz, vagy folyamatban lévő orvosi kezelésben részesülsz – ilyenkor mindenképp kérdezd meg előbb a kezelőorvosod,',
      'nem szeretnéd megérteni a kézproblémáid miértjét,',
      'csak az olyan passzív kezelésektől (masszázs, manuálterápia) várod a megoldást, amiket „rajtad végeznek”, de otthon nem akarod végezni a gyakorlatokat,',
      'nincs napi 5 perced magadra.',
    ]),
    heading('h2', '30 napos kipróbálási garancia'),
    para(
      'Próbáld ki a programot 30 napig, és tapasztald meg, milyen változást hoz a kezed állapotában! Ha úgy érzed, hogy nem segített, csak írj egy e-mailt, és kérdés nélkül visszafizetjük a program árát. Semmit sem kockáztatsz, de rengeteget nyerhetsz!',
    ),
    para(
      'A program eredeti ára 119 000 Ft – bevezető áron most 79 500 Ft-ért érhető el. (A kurzus nem helyettesíti a szakorvosi kontrollt.)',
    ),
  ])

const kezrelaxLongDescription = (): Product['longDescription'] =>
  richText([
    para(
      'Ínhüvelygyulladás, kéztőalagút-szindróma, teniszkönyök? Vagy fogalmad sincs, mi az, de egyre jobban fáj, és nem tudod, mit kezdj vele? Itt egy egyszerű, de hatásos otthoni megoldás, amivel gyorsan enyhítheted a kézfájdalmad – drága eszközök és hosszú, macerás gyakorlatok nélkül.',
    ),
    para(
      'Kiss Kata és Kocsis Kata vagyunk, gyógytornászok és sportrehabilitációs trénerek – a praxisunkban kifejezetten a kéz és a kar rehabilitációjára specializálódtunk. Ebben a villámkurzusban ott van minden, amit azoknak szoktunk elmagyarázni és megmutatni, akiknek azonnal segítségre van szükségük.',
    ),
    heading('h2', 'SOS Kézrelax villámkurzus – a 3 legjobb gyakorlatunk a fájdalom enyhítésére'),
    para('A villámkurzus témái:'),
    bulletList([
      'Mit tegyél, és mit ne, ha fáj a kezed? – a legfontosabb tanácsok és tippek, amivel azonnal elindulhatsz a fájdalomcsökkentés útján',
      'Honnan tudhatod, pontosan mivel van a baj? – megmutatjuk, mi hogyan teszteljük a különböző kórképeket; ezeket azonnal kipróbálhatod magadon',
      'Elmagyarázzuk, hogyan alakulhatott ki a probléma – ha érted a miértjét, könnyebb elkerülni a további fájdalmakat',
      'Hogyan és milyen rögzítőt használj – a rögzítőkkel tehermentesítheted a fájó területet, de nem mindegy, mit és hogyan használsz',
      'Csuklófájdalom oldása – megtanulod mobilizálni az érintett területet, és enyhíteni a kínzó fájdalmat',
      'Zsibbadó ujjak – egyszerű, egyperces gyakorlat, amivel csökkentheted a zsibbadás érzését',
      'Könyök-tehermentesítés – így csökkentsd a könyök körüli feszültséget és gyulladást célzott mozdulatokkal',
      'Így enyhítsd a hüvelykujj-táji nyilalló fájdalmat',
    ]),
    heading('h2', 'A videók mellé ezt is megkapod'),
    heading('h3', 'Letölthető „puska” a gyakorlatokhoz'),
    para(
      'Készítettünk neked a gyakorlatokhoz egy pdf-et, amiben szerepel mindegyik gyakorlat fotókkal, és hogy mennyit és hogyan végezd őket. Lementheted a telefonodra vagy kinyomtathatod – ha épp 2 perced van a kézrelax gyakorlatokra, erre csak ránézel, és már emlékszel is, mit kell tenni.',
    ),
    heading('h2', '100% boldogság garancia'),
    para(
      'Olimpikonoktól a műkörmösökön át a zongoristákig több mint ezer embernek segítettünk már speciális gyakorlatokkal rendbehozni a kézproblémáját. Ha te valamiért úgy érzed, neked nem segítettek, csak írj nekünk, és kérdés nélkül visszatérítjük a vételárat.',
    ),
    heading('h2', 'Vélemények'),
    quote(
      'Teniszkönyökömmel évek óta küzdök, hol jobban, hol kevésbé. Sok mindennek már utánaolvastam, de még így is sok meglepetést okozott a kurzus. A gyakorlatok és a plusz kiegészítő tippek pedig egyszerűen zseniálisak!',
    ),
    para('– P. Benjámin, informatikus'),
    quote('A kurzusban gyors és egyszerű gyakorlatok voltak, amik tényleg SOS megoldások!'),
    para('– D. Anna, logisztikus'),
    quote(
      'Olyan információkat kaptam a kéztőalagút-szindrómámról, amik új nézőpontot adtak. Már most hálás vagyok!',
    ),
    para('– H. Gabi, coach'),
    heading('h2', 'Kérdések, amik talán felmerültek benned'),
    heading('h3', 'Mennyire bonyolultak ezek a gyakorlatok?'),
    para(
      'Nagyon egyszerűek, de részletesen megmutatjuk a videókban is, hogyan kell őket végezni. Mindent elmagyarázunk, hogy értsd, melyik mozdulatot miért csináljuk.',
    ),
    heading('h3', 'Ettől megszűnik a fájdalmam?'),
    para(
      'Ez egy amolyan gyorssegély-csomag. A három legkritikusabb területre fókuszálunk (kéz, csukló, könyök), hogy azonnal enyhítsünk a problémán. Ha nagyobb a baj, vagy komplex megoldásra vágysz, javasoljuk az „Otthoni KézRehab” programot, ami sokkal mélyebben megy bele a kezelésbe, és egy átfogóbb megoldást ad.',
    ),
    heading('h3', 'Nem lehet, hogy még jobban begyullad a kezem?'),
    para(
      'A kézrehabilitáció a szakmánk, és teljesen biztonságosak a gyakorlatok. Ezzel együtt természetesen fontos, hogy figyeld a tested jelzéseit. Ha nagyon intenzív a fájdalom, először konzultálj orvossal.',
    ),
    heading('h3', 'Meddig érhetők el a videók?'),
    para(
      'Hivatalosan minimum egy évig, de nem tervezzük megvonni a nagyvilágtól még nagyon, nagyon sokáig.',
    ),
  ])

// ---------------------------------------------------------------------------
// Vélemények — a régi kineticare.hu oldalain megjelent, VALÓS páciens-
// visszajelzések. Ugyanezek a szövegek a fenti oldal-tartalmakban idézetként is
// ott vannak (ott a szöveg részei); itt külön, szerkeszthető adatként kerülnek a
// testimonials collectionbe, hogy a kezdőlap M6-blokkja CMS-ből legyen kezelhető.
//
// A `quote` mindenhol BETŰHÍVEN azonos a fenti oldal-tartalmakban szereplő
// idézettel — kitalált vagy „szépített" visszajelzés ide nem kerülhet.
//
// A `shortQuote` a kezdőlapra szánt rövid változat (mezőkorlát: 260 karakter),
// és mind a három kiemeltnél a teljes idézet ÖSSZEFÜGGŐ, BETŰHÍV RÉSZLETE — nem
// átfogalmazás és nem több mondatból összeollózott kivonat. A megújult
// kezdőlap-terv (régi koncepció-landing, egyszeri tükör) rövidített szövegei
// ezt a próbát nem állták ki: a Kállai-változat 283 karakteres volt, a
// Garami-/Bagdal-változat pedig nem szomszédos mondatokat fűzött össze és
// szavakat is módosított (pl. gondolatjel helyett vessző, kihagyott „akkor
// már"). Idézőjelbe tett, de valójában el nem hangzott mondat fogyasztóvédelmi
// szempontból is kockázat, ezért mindhárom rövid változat a teljes idézet
// szó szerinti részlete — ellenőrizhetően: `quote.includes(shortQuote) === true`.
// ---------------------------------------------------------------------------

interface LegacyTestimonial {
  /** A vélemény teljes szövege — betűhíven a régi oldalak idézeteiből. */
  quote: string
  /**
   * Rövid, kezdőlapra szánt változat (M6: legfeljebb 3 vélemény, 1–2 mondat).
   * Csak a kiemelt véleményeknél van kitöltve, és mindig a `quote` betűhív,
   * összefüggő részlete — a rövidítés nem írhatja át az elhangzott szöveget.
   */
  shortQuote?: string
  authorName: string
  authorTitle: string
  /** Kiemelt = megjelenik a kezdőlapon (legfeljebb 3 ilyen lehet). */
  featured: boolean
  /** Sorrend: a 3 kiemelt kapja az 1–3-at, a többi az eredeti sorrendben 4-től. */
  order: number
}

/** Mind a 14 vélemény látható (`visible: true`) — csak a kiemelés különbözik. */
const LEGACY_TESTIMONIALS: readonly LegacyTestimonial[] = [
  {
    quote:
      'Kocsis Katát kézproblémával kerestem fel, és már az első alkalommal éreztem, hogy jó kezekben vagyok – szó szerint is. Nagy odafigyeléssel, alázattal és valódi szakértelemmel kezelt minden alkalommal. Nemcsak a tüneteket enyhítette, hanem segített megérteni a kiváltó okokat is. Őszintén ajánlom mindenkinek, aki nemcsak gyors enyhülést, hanem tartós megoldást keres.',
    shortQuote:
      'Nemcsak a tüneteket enyhítette, hanem segített megérteni a kiváltó okokat is. Őszintén ajánlom mindenkinek, aki nemcsak gyors enyhülést, hanem tartós megoldást keres.',
    authorName: 'Garami Gábor',
    authorTitle: 'zenész / műsorvezető',
    featured: true,
    order: 1,
  },
  {
    quote:
      'Egy 10 éve tartó ganglion problémával, több operáció után jutottam el Katához, mert szikementes segítséget szerettem volna igénybe venni, és nem is dönthettem volna jobban! Nagyon hálás vagyok, hogy szakértelme által jelentős javulást és tünetmentességet értünk el a kezelések során, és rengeteg tudást is kaptam, pl. hogy tornáztathatom én magam is a fájó testrészeket, vagy hogyan tape-elhetem be magam akut fájdalom esetén.',
    shortQuote:
      'Egy 10 éve tartó ganglion problémával, több operáció után jutottam el Katához, mert szikementes segítséget szerettem volna igénybe venni, és nem is dönthettem volna jobban!',
    authorName: 'Kállai Dóra',
    authorTitle: 'biológus',
    featured: true,
    order: 2,
  },
  {
    quote:
      'Katával 2022-ben kezdtünk el együtt dolgozni. Sok éve tartó derékfájással és nyaki problémával fordultam hozzá. A sok fájdalom miatt azt gondoltam, hogy már csak a gyógytorna marad egész életemre. De Kata segített megtanulni helyesen mozogni, és visszatérni a sportokhoz. Hálás vagyok neki a valós szakértelméért, türelméért és támogatásáért, amely által nemcsak fájdalommentesen élhetek, hanem újra élvezhetem a mozgás örömét.',
    authorName: 'Kunfalvi Lili',
    authorTitle: 'piackutató',
    featured: false,
    order: 4,
  },
  {
    quote:
      'A KINETICARE lányokat ajánlás alapján kerestem meg, ugyanis akkor már pár hónapja erős fájdalommal járt a hüvelykujjam és a csuklóm mozgatása. Ez a munkámat is nehezítette, hiszen jógaoktatóként folyamatosan használnom kellett, nem pihentethettem. A közös munkának, a világos magyarázatoknak, hogy mi történik velem, illetve a szuper feladatoknak és életvezetési tanácsoknak hála sikerült a gyógyulás! Nagyon hálás vagyok a KINETICARE-nek, hiszen azóta fájdalommentesen élek, és újra visszatérhettem kedvenc gyakorlatomhoz, a kézenálláshoz is.',
    shortQuote:
      'A közös munkának, a világos magyarázatoknak, hogy mi történik velem, illetve a szuper feladatoknak és életvezetési tanácsoknak hála sikerült a gyógyulás!',
    authorName: 'Bagdal Szilvia',
    authorTitle: 'Sziszi Yoga: haladó jógaoktató / mobility- és meditációs tréner',
    featured: true,
    order: 3,
  },
  {
    quote:
      'Kézzsibbadással kerestem fel Katát, és hihetetlen módon ráérzett, milyen gyakorlatok segítenének nekem, ugyanis a második találkozóra már úgy érkeztem, hogy teljesen elmúltak a panaszaim. Ezeket a gyakorlatokat mind a mai napig elvégzem felsőtest edzés után, és nem is jöttek vissza a panaszok.',
    authorName: 'Dr. Sitku Lili',
    authorTitle: 'fogorvos',
    featured: false,
    order: 5,
  },
  {
    quote:
      'Minden felmerülő fájdalmamra, problémámra azonnal tudott megoldást nyújtani, és az általa adott gyakorlatok végrehajtásával szinten tudom tartani az általános jó közérzetemet, nincsenek hosszan fennálló fájdalmaim, neki köszönhetően nagyon sokat fejlődött a testem, a teherbírásom.',
    authorName: 'Hámori Lili',
    authorTitle: 'édesanya',
    featured: false,
    order: 6,
  },
  {
    quote:
      'Már a két évvel ezelőtti első személyes találkozásunk során is érzékeltem ezt a magas színvonalú szakmaiságot, és a pácienssel empatikus, emberséges, támogató hozzáállást. A folyamatos gyógytorna, manuálterápiás kezelés következtében sikerült mindennapi aktív életemet visszakapnom.',
    authorName: 'Dr. Kárpáti Katalin',
    authorTitle: 'ügyvéd',
    featured: false,
    order: 7,
  },
  {
    quote:
      '10 év élsport után jelentkező könyökízületi problémáim miatt kezdtem el dolgozni Kocsis Katával. Műtétre került a sor, amiben maximálisan támogatott: ott volt velem a műtőben, és a műtét után is mellettem maradt, amíg magamhoz nem tértem. A rehabilitáció teljes folyamatában számíthattam rá. Bár nem volt könnyű időszak, a közös munka mindig vidáman telt, tele biztatással és támogatással, amiért a mai napig hálás vagyok. Azóta is bármilyen egészségügyi problémám adódik, nyugodt szívvel fordulok hozzá.',
    authorName: 'Konda Boglárka',
    authorTitle: 'vízilabdázó',
    featured: false,
    order: 8,
  },
  {
    quote:
      'Pár évvel ezelőtt reménytelenül álltam a karrierem előtt. De hálát adok a sorsnak, hogy megismertelek, mert te vagy az a személy, akinek azt köszönhetem, hogy visszatérhettem oda, ahova tartozom, a Manézsba. A páratlan szakértelmed segítségével rengeteget javult az állapotom. A gyógyulás és a regeneráció mellett nagyon sokat tanulhattam tőled, és a mai napig hasznosítom ezt a tudást. A segítséged mellé egy igaz barátságot is kaptam! Életem végéig hálás leszek neked!',
    authorName: 'Tarba Patrícia',
    authorTitle: 'artista',
    featured: false,
    order: 9,
  },
  {
    quote:
      '2024. szeptemberében kerültem Kocsis Katához, amiért örökre hálás leszek. Mérhetetlen könyökfájdalmam volt a bal kezemben, és társult hozzá egy hüvelykujj-panasz is. Alapos vizsgálat után elmagyarázta, mi a probléma, és megkezdte a kezelést. A kedves mosolya és zseniális szakmai tudása felbecsülhetetlen! Már az első kezelés mérföldkő volt, hiszen tudtam használni a kezem, és elmúlt a fájdalom. Ajánlani? IGEN, de inkább kötelezővé tenném mindenkinek, akinek kézpanasza van az élete bármely szakaszában.',
    authorName: 'Varró Barbara',
    authorTitle: 'Nagy Sportágválasztó ügyvezető',
    featured: false,
    order: 10,
  },
  {
    quote:
      'Kata minden újonnan jövő kihívást egy megoldandó feladatként kezel, és látszik rajta az elhivatottság a szakmája iránt. Így volt ez legutóbb a síelésre való felkészítéssel is, a mozgásformához szükséges erősítő feladatokat végeztük. A gyakorlatsorok végrehajtását mindig kellő szigorral és odafigyeléssel ellenőrzi – ez az a precízitás és hozzáállás, amit a páciensek később meghálálnak. Az erőfeszítéseidet mindig dicsérő szavak követik, neki pedig az a legnagyobb dicséret, ha az óra végén mosolyogva, jóleső fáradtsággal, de panaszmentesen lépsz ki az ajtón.',
    authorName: 'Takács Mátyás',
    authorTitle: 'építészmérnök',
    featured: false,
    order: 11,
  },
  {
    quote:
      'Teniszkönyökömmel évek óta küzdök, hol jobban, hol kevésbé. Sok mindennek már utánaolvastam, de még így is sok meglepetést okozott a kurzus. A gyakorlatok és a plusz kiegészítő tippek pedig egyszerűen zseniálisak!',
    authorName: 'P. Benjámin',
    authorTitle: 'informatikus',
    featured: false,
    order: 12,
  },
  {
    quote: 'A kurzusban gyors és egyszerű gyakorlatok voltak, amik tényleg SOS megoldások!',
    authorName: 'D. Anna',
    authorTitle: 'logisztikus',
    featured: false,
    order: 13,
  },
  {
    quote:
      'Olyan információkat kaptam a kéztőalagút-szindrómámról, amik új nézőpontot adtak. Már most hálás vagyok!',
    authorName: 'H. Gabi',
    authorTitle: 'coach',
    featured: false,
    order: 14,
  },
]

// ---------------------------------------------------------------------------
// UPSERT-segédek
// ---------------------------------------------------------------------------

interface PageInput {
  slug: string
  title: string
  excerpt: string
  content: RichTextContent
  heroImage?: number
  seoTitle: string
  seoDescription: string
}

/**
 * Oldal idempotens visszaállítása: slug alapján UPSERT (a mezőket frissíti).
 * A létező oldal felülírása a LEGACY_OVERWRITE kapun múlik, az írás pedig a
 * LEGACY_RESTORE_CONFIRM kapun — enélkül csak a döntés naplózódik.
 */
const upsertPage = async (payload: Payload, input: PageInput): Promise<number | undefined> => {
  const cimke = `oldal: ${input.slug}`
  const existing = await payload.find({
    collection: 'pages',
    where: { slug: { equals: input.slug } },
    limit: 1,
    overrideAccess: true,
  })
  const data = {
    title: input.title,
    slug: input.slug,
    excerpt: input.excerpt,
    content: input.content,
    ...(input.heroImage !== undefined ? { heroImage: input.heroImage } : {}),
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
    status: 'published' as const,
    _status: 'published' as const,
  }
  if (existing.docs.length > 0) {
    if (!felulirhato(payload, cimke)) {
      return existing.docs[0].id
    }
    if (!DRY_RUN) {
      await payload.update({
        collection: 'pages',
        id: existing.docs[0].id,
        data,
        overrideAccess: true,
      })
    }
    naploFeluliras(payload, `${cimke} (tartalom, cím, kivonat, SEO, státusz)`)
    return existing.docs[0].id
  }
  if (DRY_RUN) {
    naploLetrehozas(payload, cimke)
    return undefined
  }
  const created = await payload.create({
    collection: 'pages',
    data: { ...data, publishedAt: new Date().toISOString() },
    overrideAccess: true,
  })
  naploLetrehozas(payload, cimke)
  return created.id
}

/**
 * Oldal layout idempotens feltöltése — meglévő szekciósort SOHA nem ír felül
 * (csak üres layoutot tölt ki).
 */
const ensurePageLayout = async (
  payload: Payload,
  slug: string,
  layout: NonNullable<Page['layout']>,
): Promise<void> => {
  const cimke = `oldal-szekciósor: ${slug} (${layout.length} szekció)`
  const existing = await payload.find({
    collection: 'pages',
    where: { slug: { equals: slug } },
    limit: 1,
    overrideAccess: true,
  })
  const page = existing.docs[0]
  if (page === undefined) {
    naploKihagyas(
      payload,
      cimke,
      DRY_RUN
        ? 'az oldal a próbafutásban még nem létezik — éles futáskor előbb létrejön, és megkapja a szekciósort'
        : 'az oldal nem található',
    )
    return
  }
  if (Array.isArray(page.layout) && page.layout.length > 0) {
    naploKihagyas(
      payload,
      cimke,
      'az oldalnak MÁR VAN szekciósora — az szerkesztői munka, a script sosem írja felül (a szekciókat az adminban lehet átrendezni, átírni vagy elrejteni)',
    )
    return
  }
  if (!DRY_RUN) {
    await payload.update({
      collection: 'pages',
      id: page.id,
      data: { layout },
      overrideAccess: true,
    })
  }
  naploLetrehozas(payload, cimke)
}

interface ProductInput {
  /** Az sku a VEVŐNEK MEGJELENŐ név (useAsTitle) ÉS az idempotencia-kulcs egyben. */
  sku: string
  shortDescription: string
  longDescription: Product['longDescription']
  priceInHUFEnabled: boolean
  priceInHUF?: number
  coverImage?: number
  gallery?: { image: number }[]
  category?: number
}

/**
 * Termék idempotens visszaállítása: sku alapján UPSERT — a keresés és a beírt
 * érték szándékosan UGYANAZ az sku (ez a dedup-kulcs, egyben a display-név).
 */
const upsertProduct = async (
  payload: Payload,
  input: ProductInput,
): Promise<number | undefined> => {
  const cimke = `termék: ${input.sku}`
  const existing = await payload.find({
    collection: 'products',
    where: { sku: { equals: input.sku } },
    limit: 1,
    overrideAccess: true,
  })
  const data = {
    sku: input.sku,
    shortDescription: input.shortDescription,
    longDescription: input.longDescription,
    priceInHUFEnabled: input.priceInHUFEnabled,
    ...(input.priceInHUF !== undefined ? { priceInHUF: input.priceInHUF } : {}),
    ...(input.coverImage !== undefined ? { coverImage: input.coverImage } : {}),
    ...(input.gallery !== undefined ? { gallery: input.gallery } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    status: 'published' as const,
    _status: 'published' as const,
  }
  if (existing.docs.length > 0) {
    if (!felulirhato(payload, cimke)) {
      return existing.docs[0].id
    }
    if (!DRY_RUN) {
      await payload.update({
        collection: 'products',
        id: existing.docs[0].id,
        data,
        overrideAccess: true,
      })
    }
    naploFeluliras(payload, `${cimke} (leírás, ár, borító, kategória, státusz)`)
    return existing.docs[0].id
  }
  if (DRY_RUN) {
    naploLetrehozas(payload, cimke)
    return undefined
  }
  // A kategória a products collectionben kötelező; éles futásban mindig van
  // (a próbafutás az az eset, amikor még nem jött létre — ott nem írunk).
  if (input.category === undefined) {
    throw new Error(`Legacy: hiányzó termékkategória a(z) „${input.sku}" termékhez.`)
  }
  const created = await payload.create({
    collection: 'products',
    data: { ...data, category: input.category },
    overrideAccess: true,
  })
  naploLetrehozas(payload, cimke)
  return created.id
}

/** Menüpont biztosítása a seed.ts mintájára: label (+parent) alapú dedup. */
const ensureMenuItem = async (
  payload: Payload,
  input: {
    label: string
    type: 'page' | 'post' | 'url' | 'product'
    order: number
    ref?: { relationTo: 'pages' | 'posts' | 'products'; value: number }
    url?: string
  },
): Promise<void> => {
  const cimke = `menüpont: ${input.label}`
  const existing = await payload.find({
    collection: 'menus',
    where: {
      and: [{ label: { equals: input.label } }, { parent: { exists: false } }],
    },
    limit: 1,
    overrideAccess: true,
  })
  if (existing.docs.length > 0) {
    naploKihagyas(payload, cimke, 'már létezik')
    return
  }
  if (!DRY_RUN) {
    await payload.create({
      collection: 'menus',
      data: {
        label: input.label,
        type: input.type,
        order: input.order,
        ...(input.ref ? { ref: input.ref } : {}),
        ...(input.url ? { url: input.url } : {}),
      },
      overrideAccess: true,
    })
  }
  naploLetrehozas(payload, cimke)
}

/**
 * A vélemény dedup-kulcsának második fele: a szöveg eleje. Csak a név nem elég
 * (egy pácienstől több visszajelzés is származhat), a teljes szöveg viszont túl
 * merev kulcs lenne — egy adminban javított elgépelés már duplikálást okozna.
 */
const QUOTE_KEY_LENGTH = 60

/**
 * Vélemény idempotens visszaállítása: név + a szöveg eleje alapján UPSERT.
 * A lekérdezés a névre szűkít (pontos egyezés), a szöveg-eleji egyezést pedig
 * itt, memóriában ellenőrizzük: a Payload `like` operátora szavakra bontva,
 * részszövegre keres, ezért szöveg-ELEJI egyezésre nem alkalmas.
 */
const upsertTestimonial = async (payload: Payload, input: LegacyTestimonial): Promise<void> => {
  const cimke = `vélemény: ${input.authorName}`
  const kulcs = input.quote.slice(0, QUOTE_KEY_LENGTH)
  const talalatok = await payload.find({
    collection: 'testimonials',
    where: { authorName: { equals: input.authorName } },
    limit: 100,
    overrideAccess: true,
  })
  const existing = talalatok.docs.find((doc) => doc.quote.startsWith(kulcs))
  const data = {
    quote: input.quote,
    ...(input.shortQuote !== undefined ? { shortQuote: input.shortQuote } : {}),
    authorName: input.authorName,
    authorTitle: input.authorTitle,
    featured: input.featured,
    order: input.order,
    visible: true,
  }
  if (existing) {
    if (!felulirhato(payload, cimke)) {
      return
    }
    if (!DRY_RUN) {
      await payload.update({
        collection: 'testimonials',
        id: existing.id,
        data,
        overrideAccess: true,
      })
    }
    naploFeluliras(payload, `${cimke} (szöveg, rövid szöveg, titulus, kiemelés, sorrend)`)
    return
  }
  if (DRY_RUN) {
    naploLetrehozas(payload, cimke)
    return
  }
  await payload.create({ collection: 'testimonials', data, overrideAccess: true })
  naploLetrehozas(payload, cimke)
}

/**
 * A 14 valós vélemény betöltése — idempotens, ugyanazok a kapuk vonatkoznak rá,
 * mint az oldalakra/termékekre (LEGACY_RESTORE_CONFIRM az íráshoz,
 * LEGACY_OVERWRITE a meglévő rekord felülírásához).
 */
const restoreTestimonials = async (payload: Payload): Promise<void> => {
  for (const testimonial of LEGACY_TESTIMONIALS) {
    await upsertTestimonial(payload, testimonial)
  }
}

// ---------------------------------------------------------------------------
// Demó-tartalom depublikálása (LEGACY_ARCHIVE_DEMO)
//
// A seed.ts demó-tartalma ütközik az élessel: a `DEMO-KEZREHAB-001` termék
// fizetős kurzuskártyaként jelenne meg a valódi kurzus mellett, a „bemutatkozas"
// oldal és a menüpontja pedig a fejlécben. A lépés ezért DEPUBLIKÁL, de SOHA nem
// töröl — minden változás egy admin-kattintással visszafordítható. (A frontend a
// saját `status` selectre, illetve a menus `visible` mezőjére szűr.)
// ---------------------------------------------------------------------------

const DEMO_TERMEK_SKU = 'DEMO-KEZREHAB-001'
const DEMO_OLDAL_SLUG = 'bemutatkozas'
const DEMO_MENU_LABEL = 'Bemutatkozás'
const DEMO_ALMENU_LABEL = 'Demó kézrehabilitációs kurzus'
const KURZUSOK_MENU_LABEL = 'Kurzusok'

/** Egy menüpont elrejtése (visible: false) — a sor megmarad, csak nem látszik. */
const rejtsdElMenupontot = async (
  payload: Payload,
  menu: { id: number; visible?: boolean | null },
  cimke: string,
): Promise<void> => {
  if (menu.visible === false) {
    naploKihagyas(payload, cimke, 'már rejtett')
    return
  }
  if (!DRY_RUN) {
    await payload.update({
      collection: 'menus',
      id: menu.id,
      data: { visible: false },
      overrideAccess: true,
    })
  }
  naploDepublikalas(payload, `${cimke} → visible: false`)
}

const depublikaldDemoTartalmat = async (payload: Payload): Promise<void> => {
  payload.logger.info(
    'Legacy: demó-tartalom depublikálása (LEGACY_ARCHIVE_DEMO=igen) — a script archivál/draftra állít/elrejt, törölni SOHA nem töröl.',
  )

  // --- Demó termék → archived ------------------------------------------------
  const demoTermek = (
    await payload.find({
      collection: 'products',
      where: { sku: { equals: DEMO_TERMEK_SKU } },
      limit: 1,
      overrideAccess: true,
    })
  ).docs[0]
  const termekCimke = `demó termék: ${DEMO_TERMEK_SKU}`
  if (!demoTermek) {
    payload.logger.info(`Legacy: ${termekCimke} nincs az adatbázisban — nincs teendő.`)
  } else if (demoTermek.status === 'archived') {
    naploKihagyas(payload, termekCimke, 'már archivált')
  } else {
    if (!DRY_RUN) {
      await payload.update({
        collection: 'products',
        id: demoTermek.id,
        data: { status: 'archived' },
        overrideAccess: true,
      })
    }
    naploDepublikalas(payload, `${termekCimke} → status: archived`)
  }

  // --- Demó oldal → draft ----------------------------------------------------
  const demoOldal = (
    await payload.find({
      collection: 'pages',
      where: { slug: { equals: DEMO_OLDAL_SLUG } },
      limit: 1,
      overrideAccess: true,
    })
  ).docs[0]
  const oldalCimke = `demó oldal: ${DEMO_OLDAL_SLUG}`
  if (!demoOldal) {
    payload.logger.info(`Legacy: ${oldalCimke} nincs az adatbázisban — nincs teendő.`)
  } else if (demoOldal.status === 'draft') {
    naploKihagyas(payload, oldalCimke, 'már draft')
  } else {
    if (!DRY_RUN) {
      await payload.update({
        collection: 'pages',
        id: demoOldal.id,
        // A `status` a `_status`-ból szinkronizálódik (src/lib/publish-status.ts),
        // ezért a depublikálásnál a `_status`-t is állítani kell — enélkül a hook
        // visszaírná a published értéket.
        data: { status: 'draft', _status: 'draft' },
        overrideAccess: true,
      })
    }
    naploDepublikalas(payload, `${oldalCimke} → status: draft`)
  }

  // --- Demó menüpont (gyökérszintű „Bemutatkozás") → visible: false ----------
  const demoMenu = (
    await payload.find({
      collection: 'menus',
      where: {
        and: [{ label: { equals: DEMO_MENU_LABEL } }, { parent: { exists: false } }],
      },
      limit: 1,
      overrideAccess: true,
    })
  ).docs[0]
  const menuCimke = `demó menüpont: ${DEMO_MENU_LABEL}`
  if (!demoMenu) {
    payload.logger.info(`Legacy: ${menuCimke} nincs az adatbázisban — nincs teendő.`)
  } else {
    await rejtsdElMenupontot(payload, demoMenu, menuCimke)
  }

  // --- Demó almenüpont (a „Kurzusok" alatt) → visible: false -----------------
  const kurzusokMenu = (
    await payload.find({
      collection: 'menus',
      where: {
        and: [{ label: { equals: KURZUSOK_MENU_LABEL } }, { parent: { exists: false } }],
      },
      limit: 1,
      overrideAccess: true,
    })
  ).docs[0]
  const almenuCimke = `demó almenüpont: ${DEMO_ALMENU_LABEL}`
  if (!kurzusokMenu) {
    payload.logger.info(
      `Legacy: nincs gyökérszintű „${KURZUSOK_MENU_LABEL}" menüpont — a(z) ${almenuCimke} keresése kihagyva.`,
    )
    return
  }
  const demoAlmenu = (
    await payload.find({
      collection: 'menus',
      where: {
        and: [{ label: { equals: DEMO_ALMENU_LABEL } }, { parent: { equals: kurzusokMenu.id } }],
      },
      limit: 1,
      overrideAccess: true,
    })
  ).docs[0]
  if (!demoAlmenu) {
    payload.logger.info(`Legacy: ${almenuCimke} nincs az adatbázisban — nincs teendő.`)
    return
  }
  await rejtsdElMenupontot(payload, demoAlmenu, almenuCimke)
}

// ---------------------------------------------------------------------------
// Főprogram
// ---------------------------------------------------------------------------

async function restoreLegacyContent(): Promise<void> {
  const payload = await getPayload({ config })

  // --- Futtatási mód kiírása (a napló elején egyértelmű legyen) --------------
  payload.logger.info(
    DRY_RUN
      ? 'Legacy: PRÓBAFUTÁS (dry-run) — a script SEMMIT nem ír az adatbázisba, csak kiírja, mit tenne. Tényleges íráshoz: LEGACY_RESTORE_CONFIRM=igen'
      : 'Legacy: ÉLES FUTÁS — a script ÍRNI FOG az adatbázisba (LEGACY_RESTORE_CONFIRM=igen).',
  )
  payload.logger.info(
    OVERWRITE
      ? 'Legacy: meglévő oldal/termék felülírása ENGEDÉLYEZVE (LEGACY_OVERWRITE=igen) — a régi tartalom véglegesen elveszik, mentés nincs.'
      : 'Legacy: meglévő oldal/termék felülírása TILTVA — a létező dokumentumok érintetlenek maradnak (LEGACY_OVERWRITE=igen oldja fel).',
  )
  payload.logger.info(
    ARCHIVE_DEMO
      ? 'Legacy: a seed demó-tartalmának depublikálása KÉRVE (LEGACY_ARCHIVE_DEMO=igen).'
      : 'Legacy: a seed demó-tartalma érintetlen marad (LEGACY_ARCHIVE_DEMO=igen kapcsolja be a depublikálást).',
  )

  // --- Média (az összes többi entitás hivatkozik rá) -------------------------
  const mediaIds = new Map<string, number>()
  for (const image of LEGACY_IMAGES) {
    const id = await ensureMedia(payload, image)
    if (id !== undefined) {
      mediaIds.set(image.file, id)
    }
  }
  /**
   * Kép-id feloldása. Éles futásban a hiányzó id programhiba (megszakítunk);
   * próbafutásban viszont természetes, hogy a még fel nem töltött kép nem
   * kapott id-t — ilyenkor `undefined`, és a hivatkozás egyszerűen kimarad.
   */
  const mediaId = (file: string): number | undefined => {
    const id = mediaIds.get(file)
    if (id === undefined && !DRY_RUN) {
      throw new Error(`Legacy: ismeretlen képfájl-hivatkozás: ${file}`)
    }
    return id
  }
  /** Galéria-elemek a feloldható kép-id-kből (próbafutásban lehet üres). */
  const gallery = (...files: string[]): { image: number }[] =>
    files
      .map((file) => mediaId(file))
      .filter((id): id is number => id !== undefined)
      .map((image) => ({ image }))

  // --- Oldal: kezdolap -------------------------------------------------------
  await upsertPage(payload, {
    slug: 'kezdolap',
    title: 'Hatékony és biztonságos módszerek a kéz és a kar fájdalmai ellen',
    excerpt:
      'Professzionális, mégis emberközeli terápiás megoldásokkal kezeljük a különböző mozgásszervi problémákat, hogy te ismét önfeledten dolgozhass, sportolhass vagy gondoskodhass szeretteidről.',
    content: kezdolapContent(),
    heroImage: mediaId('67b4bc17e0c78_katak-paravan.jpg'),
    // A `|` a töltelék gondolatjel helyett (§3.1.1). A keret-sablon ne
    // duplázza a márkanevet: `buildHomeMetadata` `title.absolute`-t ad.
    seoTitle: 'Kineticare | kézrehabilitáció gyógytornászoktól',
    seoDescription:
      'Kocsis Kata és Kiss Kata gyógytornászok: kézrehabilitáció, kéztőalagút-szindróma, kézfájdalom, csuklófájdalom, teniszkönyök kezelése rendelőben és online programmal.',
  })

  // --- Oldal: rolunk ---------------------------------------------------------
  // A fejléckép a PÁROS csapatfotó (lásd ROLUNK_HERO_FAJL). A fájlt a KEZDŐLAPI
  // seed tölti fel, ez a script csak megkeresi; ha még nincs a Médiatárban, a
  // `heroImage` kimarad az adatokból — ilyenkor a meglévő fejléckép marad, és a
  // napló megmondja, mit kell futtatni.
  const rolunkHeroKep = await findMediaId(payload, ROLUNK_HERO_FAJL)
  if (rolunkHeroKep === undefined) {
    payload.logger.warn(
      `Legacy: a /rolunk fejlécképe (${ROLUNK_HERO_FAJL}) nincs a Médiatárban — ezt a kezdőlapi seed tölti fel (npm run seed). A fejléckép most ÉRINTETLEN marad.`,
    )
  }
  await upsertPage(payload, {
    slug: 'rolunk',
    title: 'A kéz a mindenünk',
    excerpt:
      'Kocsis Kata és Kiss Kata vagyunk, a KINETICARE alapítói – gyógytornászok, manuálterapeuták és sportrehabilitációs trénerek, évek óta elsősorban a kéz rehabilitációjával foglalkozunk.',
    content: rolunkContent(),
    heroImage: rolunkHeroKep,
    seoTitle: 'Rólunk – Kineticare',
    seoDescription:
      'Kocsis Kata kézrehabilitációs gyógytornász-fizioterapeuta, Kiss Kata kézrehabilitációs gyógytornász-fizioterapeuta és manuálterapeuta – szakmai háttér, vélemények, média-megjelenések.',
  })

  // --- Oldal: szolgaltatasok ---------------------------------------------------
  await upsertPage(payload, {
    slug: 'szolgaltatasok',
    title: 'A kezed folyton dolgozik, segítünk, hogy közben ne fájjon',
    excerpt:
      'Hatékony kezeléseket, otthon végezhető programokat és szakmai továbbképzéseket nyújtunk azoknak, akik biztos eredményeket szeretnének.',
    content: szolgaltatasokContent(),
    // heroImage szándékosan NINCS (tulajdonosi redesign, 2026-08-16): a lap
    // teteje kompakt hero + welcome-tábla, a nagy Rendelo-fotó kikerült. Az
    // ÉLŐ oldalak mezőjét az apply-owner-content 12a. javítása üríti.
    // A keret-layout `%s | Kineticare` sablonja. A cím NEM viseli a márkanevet,
    // különben „Szolgáltatások – Kineticare | Kineticare" lenne a <title>
    // (`docs/ui-sztenderdek.md` §3.1.1; NN/g page titles).
    seoTitle: 'Szolgáltatások',
    seoDescription:
      'Rendelői gyógytorna és manuálterápia Budapesten (50 perc 18 000 Ft, 20 perc 10 000 Ft), otthoni kézrehabilitációs program és akkreditált szakmai képzések.',
  })

  // --- Szekciósorok: /rolunk és /szolgaltatasok --------------------------------
  // A két belső oldal blokkosítása (docs/ux-belso-oldalak-kutatas.md P3/P5 és
  // 5.2/5.3). EGYSZERI feltöltés: meglévő szekciósort a script sosem ír felül,
  // a feltöltés után minden szöveg és sorrend az adminban szerkeszthető.
  // A négy ellenőrzött H05-logó feltöltése + eredetigazolása (public/media/press,
  // manifest). Próbafutásban csak a szándék naplózódik; a meglévőt sosem írja felül.
  if (DRY_RUN) {
    payload.logger.info(
      'Legacy: PRÓBAFUTÁS — a négy ellenőrzött sajtó-logó (public/media/press/manifest.json) feltöltése és eredetigazolása éles futáskor történne.',
    )
  } else {
    await ensurePressManifestImages(payload)
  }
  // A /rolunk partnerlogói (content/home-images/site/partner-*.webp).
  await ensurePartnerLogok(payload)

  const sajtoLogok = await findMediaIds(payload, SAJTO_LOGO_FAJLOK)
  if (sajtoLogok.length === 0) {
    payload.logger.info(
      'Legacy: sajtó-logó egyet sem találtam a Médiatárban (a régi hatot a `npm run seed` tölti fel, a négy újat ez a script éles futásban) — a /rolunk logósora kimarad a szekciósorból.',
    )
  }
  const partnerLogok = await findMediaIds(payload, ROLUNK_PARTNER_LOGO_FAJLOK)
  if (partnerLogok.length === 0) {
    payload.logger.info(
      'Legacy: partnerlogó egyet sem találtam a Médiatárban — a /rolunk partner-logósávja kimarad, a partnerek mondatban maradnak.',
    )
  }
  // A két portré a bejelentkezés-szekcióhoz (mindkét oldalra ugyanaz a kép).
  const kocsisPortre = mediaId('67b3c6e9e315f_KocsisKatakozeli.png')
  const kissPortre = mediaId('67c07def59ac2_KissKataelegans.png')
  await ensurePageLayout(
    payload,
    'rolunk',
    buildRolunkLayout({
      rolunkFoto: mediaId('680a69d078306_Katakfeherbenhattal.png'),
      sajtoLogok,
      partnerLogok,
      kocsisPortre,
      kissPortre,
    }),
  )
  // MEGLÉVŐ szekciósorok logósávjai (H05 + A04) — csak külön kapuval.
  if (LOGOSAV) {
    await frissitsdLogosavokat(payload, { sajtoLogok, partnerLogok })
  } else {
    payload.logger.info(
      'Legacy: a meglévő szekciósorok logósávjai érintetlenek maradnak (LEGACY_LOGOSAV=igen kapcsolja be a sajtó-logósor bővítését és a /rolunk partner-logósávját).',
    )
  }
  await ensurePageLayout(
    payload,
    'szolgaltatasok',
    buildSzolgaltatasokLayout({
      szolgaltatasokKep: mediaId('67b2668feae66_Kezeleskek.png'),
      kocsisPortre,
      kissPortre,
    }),
  )

  // --- Oldal: kapcsolat (a /kapcsolat route SZEKCIÓSORÁNAK hordozója) ---------
  // A lapot dedikált route szolgálja ki, de a szekciósora innen jön (lásd a
  // KAPCSOLAT_IDOPONTKERES fejlécét). A `content`/`title` nem jelenik meg a
  // storefronton; az oldal a sitemapból is ki van hagyva.
  await upsertPage(payload, {
    slug: 'kapcsolat',
    title: 'Kapcsolat',
    excerpt: 'Kérj időpontot rendelői kezelésre, vagy írj üzenetet a Kineticare csapatának.',
    content: kapcsolatContent(),
    seoTitle: 'Kapcsolat – Kineticare',
    seoDescription:
      'Időpontkérés rendelői gyógytornára és manuálterápiára Budapesten (Nádorliget u. 7/b, Fadrusz utca 15.), telefonos egyeztetéssel.',
  })
  // A két portré ugyanaz, mint a /rolunk és a /szolgaltatasok szakember-
  // szekciójában (egy kép, egy hely) — a fenti feloldást használjuk újra.
  await ensurePageLayout(payload, 'kapcsolat', buildKapcsolatLayout({ kocsisPortre, kissPortre }))

  // --- Termékkategória ---------------------------------------------------------
  const productCategoryId = await ensureProductCategory(payload)

  // --- Termék: Otthoni KézRehab Program (fizetős) ------------------------------
  // Az sku a VEVŐNEK MEGJELENŐ név (useAsTitle: 'sku'), ezért nem cikkszám:
  // ugyanez kerül a kurzuskártyára, a kurzusoldalra és a számlára is.
  await upsertProduct(payload, {
    sku: 'Otthoni KézRehab Program',
    shortDescription:
      'Könnyen követhető, otthon is biztonságosan alkalmazható kézrehabilitációs program gyógytornászoktól: csukló-, ujj-, alkar- és könyökfájdalmakra, a saját tempódban, 50+ videós gyakorlattal.',
    longDescription: kezrehabLongDescription(),
    priceInHUFEnabled: true,
    priceInHUF: 79500,
    coverImage: mediaId('688b93e6ab76f_Programpackshot.png'),
    gallery: gallery('678fcfac079a8_Gyakorlat.JPG', '680a69d078306_Katakfeherbenhattal.png'),
    category: productCategoryId,
  })

  // --- Termék: SOS Kézrelax villámkurzus (ingyenes lead-magnet) ----------------
  // Itt is a display-név az sku (lásd a fájl fejkommentjét).
  await upsertProduct(payload, {
    sku: 'SOS Kézrelax villámkurzus',
    shortDescription:
      'Ingyenes villámkurzus: a 3 legjobb gyakorlatunk a kézfájdalom gyors enyhítésére, drága eszközök és hosszú, macerás gyakorlatok nélkül.',
    longDescription: kezrelaxLongDescription(),
    // Ingyenes: a HomeView isPaidProduct logikája (priceInHUFEnabled === true &&
    // szám) így NEM kapja el — a termék a FreeSos-blokkba kerül (audit K2).
    priceInHUFEnabled: false,
    coverImage: mediaId('688b873ad2a80_belepotermekpackshot1.png'),
    gallery: gallery('6884161138c15_puska.png'),
    category: productCategoryId,
  })

  // --- Menük (a régi fejléc-navigáció a seed menüpontjai mellé) ----------------
  const szolgaltatasokPageId = (
    await payload.find({
      collection: 'pages',
      where: { slug: { equals: 'szolgaltatasok' } },
      limit: 1,
      overrideAccess: true,
    })
  ).docs[0]?.id
  const rolunkPageId = (
    await payload.find({
      collection: 'pages',
      where: { slug: { equals: 'rolunk' } },
      limit: 1,
      overrideAccess: true,
    })
  ).docs[0]?.id

  /** A hiányzó céloldal nem hiba: próbafutásban az oldal még nem jött létre. */
  const menucelHianyzik = (label: string, slug: string): void => {
    payload.logger.info(
      DRY_RUN
        ? `Legacy: a(z) „${label}" menüpont a próbafutásban nem értékelhető — a hivatkozott oldal (${slug}) csak éles futáskor jön létre.`
        : `Legacy: a(z) „${label}" menüpont kihagyva — a hivatkozott oldal (${slug}) nem található.`,
    )
  }

  if (szolgaltatasokPageId !== undefined) {
    await ensureMenuItem(payload, {
      label: 'Szolgáltatások',
      type: 'page',
      ref: { relationTo: 'pages', value: szolgaltatasokPageId },
      order: 4,
    })
  } else {
    menucelHianyzik('Szolgáltatások', 'szolgaltatasok')
  }
  if (rolunkPageId !== undefined) {
    await ensureMenuItem(payload, {
      label: 'Rólunk',
      type: 'page',
      ref: { relationTo: 'pages', value: rolunkPageId },
      order: 5,
    })
  } else {
    menucelHianyzik('Rólunk', 'rolunk')
  }
  // A /kapcsolat az új oldalon dedikált route (űrlappal), nem CMS-oldal — url típus.
  await ensureMenuItem(payload, {
    label: 'Kapcsolat',
    type: 'url',
    url: '/kapcsolat',
    order: 6,
  })

  // --- Vélemények (a régi oldalak valós páciens-visszajelzései) ---------------
  await restoreTestimonials(payload)

  // --- Demó-tartalom depublikálása (opcionális, a confirm-kapu mögött) --------
  if (ARCHIVE_DEMO) {
    await depublikaldDemoTartalmat(payload)
  }

  // --- Összesítés ------------------------------------------------------------
  if (DRY_RUN) {
    payload.logger.info(
      `Legacy PRÓBAFUTÁS — összesítés: ${osszesites.letrehozas} létrehozandó, ${osszesites.feluliras} felülírandó, ${osszesites.depublikalas} depublikálandó, ${osszesites.kihagyas} kihagyva. Az adatbázisba SEMMI nem íródott.`,
    )
    payload.logger.info(
      'Legacy: tényleges futtatás → LEGACY_RESTORE_CONFIRM=igen npm run seed:legacy (meglévő tartalom felülírásához ezen felül LEGACY_OVERWRITE=igen, a demó depublikálásához LEGACY_ARCHIVE_DEMO=igen).',
    )
    return
  }
  payload.logger.info(
    `Legacy ÉLES FUTÁS — összesítés: ${osszesites.letrehozas} létrehozva, ${osszesites.feluliras} felülírva, ${osszesites.depublikalas} depublikálva, ${osszesites.kihagyas} kihagyva.`,
  )
  payload.logger.info('Legacy: kész — a régi kineticare.hu tartalma visszaépítve.')
}

/**
 * A szekciósor-építők és a hozzájuk tartozó oldaltartalom — TESZTELHETŐSÉG
 * miatt exportálva. Adatbázis nélkül asszertálható, hogy a szekciósor csak
 * katalógusbeli blokkot használ, és hogy a blokkosítás semmit nem veszít el a
 * rich-text változathoz képest.
 */
/**
 * A /rolunk szakmai hátterének ÖRÖKÖLT (harmonika előtti) rich-text alakja —
 * pontosan az a tartalom, amit a 2026-08-16 előtti seed egyetlen richText
 * blokként tett a szekciósorba. Az apply-owner-content.ts ezzel veti össze az
 * ÉLŐ adatbázis blokkját: csak akkor cseréli harmonikára, ha a szerkesztő
 * időközben nem nyúlt hozzá.
 */
const rolunkSzakmaiOrokoltTartalom = (): RichTextContent =>
  richText([...rolunkSzakemberNodes(), ...rolunkReferenciaNodes()])

/**
 * A /szolgaltatasok lap-tetejének ÖRÖKÖLT (welcome-blokk előtti) rich-text
 * alakja — pontosan az a tartalom, amit a 2026-08-16 előtti seed a szekciósor
 * ELSŐ blokkjaként tett a lapra. Az apply-owner-content.ts ezzel veti össze az
 * ÉLŐ adatbázis első blokkját: csak akkor cseréli üdvözlő (welcome) blokkra, ha
 * a szerkesztő időközben nem nyúlt hozzá.
 */
const szolgaltatasokRegiBevezetoTartalom = (): RichTextContent =>
  richText(szolgaltatasokBevezetoNodes())

export {
  buildKapcsolatLayout,
  buildRolunkLayout,
  buildSzolgaltatasokLayout,
  IDOPONTKERES_HORGONY,
  IDOPONTKERES_URL,
  kezdolapContent,
  ROLUNK_PARTNER_FELIRAT,
  ROLUNK_PARTNER_LOGO_FAJLOK,
  ROLUNK_TOVABBI_PARTNEREK,
  rolunkContent,
  rolunkPartnerSzekciok,
  rolunkSzakmaiOrokoltTartalom,
  SZAKMAI_HATTER_URL,
  szolgaltatasokContent,
  szolgaltatasokRegiBevezetoTartalom,
  tervezdPartnerSavot,
  tervezdSajtoLogosorBovitest,
}

/**
 * Indítás-kapu (a seed.ts mintája): a visszaépítés CSAK közvetlen futtatáskor
 * indul el (npm run seed:legacy). Importálva — például a szekciósort ellenőrző
 * tesztből — a modul mellékhatás nélkül töltődik be, adatbázis-kapcsolat nélkül.
 */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  restoreLegacyContent()
    .then(() => {
      process.exit(0)
    })
    .catch((error) => {
      console.error('Legacy: hiba történt.', error)
      process.exit(1)
    })
}
