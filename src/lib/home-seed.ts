/**
 * Kezdőlap seed: képek + `kezdolap` layout + a három induló vélemény.
 * Idempotens: kitöltött layoutot és meglévő képet nem ír felül.
 *
 * KÉT HÍVÓ, KÉT SZEMANTIKA (modul-térkép H40, H48 A17):
 *  - `npm run seed` (src/scripts/seed.ts): a webcím- és név-alapú
 *    `ensureHomeLayout` / `ensureHomeTestimonials`. Kézzel indított, célzott
 *    feltöltés: hiányzó `kezdolap` oldalt létrehoz, üres szekciósort kitölt,
 *    hiányzó nevű véleményt pótol.
 *  - Payload onInit (src/payload.config.ts `ensureHomeBaseline`, MINDEN
 *    deploynál fut): a `…FrissTelepitesen` változatok. Ezek CSAK friss
 *    telepítésen írnak: kezdőlapot csak teljesen üres Oldalak-gyűjteménynél,
 *    véleményt csak üres Vélemények-gyűjteménynél. Beállt rendszeren a
 *    szerkesztő döntése (webcímcsere, üres szekciósor, törölt vagy átnevezett
 *    vélemény) így nem fordul vissza csendben a következő induláskor.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Payload } from 'payload'

import { ctaLabel } from './cta-vocabulary'
import { HOW_IT_WORKS_STEP1_FIXED } from './gondolatjel-leftover'
import {
  HOME_HELP_LEAD,
  HOME_HELP_PHOTO_FILES,
  HOME_HELP_PHOTOS,
  HOME_HELP_TITLE,
  homeHelpRailRows,
} from './home-help-states'
import { logger } from './logger'
import { kezdolapBemutatkozasSzoveg } from './rolunk-bemutatkozas'
import { enrollMediaRecovery } from './media-recovery-provenance'

import { HOME_PAGE_SLUG } from './content-slugs'
import type { Page } from '../payload-types'
import pressManifest from '../../public/media/press/manifest.json'

export const minimalRichText = (text: string): Page['content'] => ({
  root: {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [
          {
            type: 'text',
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
            text,
            version: 1,
          },
        ],
        direction: null,
        format: '',
        indent: 0,
        version: 1,
      },
    ],
    direction: null,
    format: '',
    indent: 0,
    version: 1,
  },
})

// ---------------------------------------------------------------------------
// Kezdőlapi képek — a landing tartalmi képei a Média collectionbe
// (docs/szekcio-rendszer-terv.md 3.4).
//
// A fájlok a `content/home-images/{brand,site}` könyvtárban élnek. A Média
// collectionbe azért kerülnek (nem statikus assetként), hogy a lányok az
// adminban cserélhessék őket. A Higgsfield-landing egyszeri koncepció-tükör
// volt; a seed/restore képeit ide költöztettük, a tükör kikerült a repóból.
// A `.scratch/` nyersanyag és a két árva fájl (`katak.jpg`, `sos-art.png`
// duplikátum) szándékosan NEM jött át.
// ---------------------------------------------------------------------------

interface SeedImage {
  /** A fájl neve a `content/home-images` almappában — egyben az idempotencia-kulcs alapja. */
  file: string
  /** A `content/home-images` almappája. */
  dir: 'brand' | 'site'
  /** Kötelező magyar képleírás (Media.alt) — képernyőolvasónak és a Google-nek. */
  alt: string
  /**
   * A kivágás fókuszpontja (Media `focalX`/`focalY`, százalék), ha a kép
   * helye nem a közepén van. Csak a LÉTREHOZÁSKOR íródik be (meglévő képet a
   * seed nem módosít); a Payload ebből vágja az `og` méretet, a megjelenítés
   * pedig `object-position`-ként használja (Services.tsx, sín-panel).
   */
  focalX?: number
  focalY?: number
}

/**
 * A kezdőlap-layout által hivatkozott képek.
 *
 * Az `alt` szövegek a régi koncepció-landing `imgAlt`/`alt` attribútumaiból
 * származnak (egyszeri tükör, már nincs a repóban). Két kivétel, ahol a
 * landingen nem volt használható érték, ezért a képet megnézve írtuk le:
 *  - `sos-hands-board.jpg` — a landingen dekoratív (`alt=""`, `aria-hidden`),
 *  - `logo-kineticare.png` — a landing lábléce csak „KinetiCare logó"-t ír.
 */
export const HOME_IMAGES = [
  {
    file: 'state-zart.png',
    dir: 'brand',
    alt: 'Ökölbe szorított kéz, zárt helyzetben',
  },
  {
    file: 'state-nyilo.png',
    dir: 'brand',
    alt: 'Félig nyitott kéz, már oldódik a görcs',
  },
  {
    file: 'state-nyitott.png',
    dir: 'brand',
    alt: 'Teljesen nyitott, szabadon tartott tenyér',
  },
  // A háromajtós sín 2026-09-22 ELŐTTI fotói (LEGACY_HOME_HELP_PHOTO_FILES).
  // A kód már nem hivatkozik rájuk, de az élő /rolunk sín Médiatár-rekordjai
  // ezekből készültek: a Volume-helyreállításnak (media-restore.ts) forrás kell.
  {
    file: 'help-zart-img-7541.jpg',
    dir: 'brand',
    alt: 'Mosolygó gyógytornász fehér garbóban, tornalabdának támaszkodva, mellettük fehér orchidea',
  },
  {
    file: 'help-nyilo-syl-9297.jpg',
    dir: 'brand',
    alt: 'Mosolygó gyógytornász világoskék ingben a padlón ül, mellettük kézcsont-modell és könyvek',
  },
  {
    file: 'help-nyitott-syl-9260.jpg',
    dir: 'brand',
    alt: 'Mosolygó gyógytornász fehér ruhában kanapén ül, táblagéppel a kezében, mellettük kézcsont-modell',
  },
  // A sín mai, ajtónkénti fotói (2026-09-22): fájl, alt és fókuszpont EGY
  // helyen él, a `HOME_HELP_PHOTOS`-ban (src/lib/home-help-states.ts); a seed
  // innen tölti fel őket, a /rolunk tartalomjob (`harom-ajto-fotok`) ugyanezt
  // a rekordot keresi.
  ...HOME_HELP_PHOTOS.map((photo) => ({
    file: photo.file,
    dir: 'brand' as const,
    alt: photo.alt,
    focalX: photo.focalX,
    focalY: photo.focalY,
  })),
  {
    file: 'services-hands.png',
    dir: 'brand',
    alt: 'Terapeuta kezei mobilizálják a páciens kezét',
  },
  {
    file: 'sos-hands-board.jpg',
    dir: 'brand',
    alt: 'Terapeuta két keze tartja a páciens tenyerét és csuklóját, kék tónusú felvétel',
  },
  {
    file: 'katak-team.jpg',
    dir: 'site',
    alt: 'Kiss Kata és Kocsis Kata, a KinetiCare gyógytornászai',
  },
  // A tulajdonos által kiválogatott fotóanyagból (2026-08-17). A kezdőlap nem
  // hivatkozik rájuk, de a listában a helyük: innen dolgozik az induláskori
  // média-feltöltés ÉS a fájl-szintű önjavítás is (src/lib/media-restore.ts) —
  // vagyis a repó a forrásuk, tehát egy kötetvesztés után is visszaállnak.
  // Ugyanez az elv, ami miatt a /rolunk fejlécképe (`katak-team.jpg`) is itt él.
  {
    file: 'kezeles-kezen.jpg',
    dir: 'brand',
    alt: 'Gyógytornász a páciens kezét kezeli a rendelőben, kék terápiás alátéten',
  },
  {
    file: 'katak-labdaval.jpg',
    dir: 'brand',
    alt: 'Kiss Kata és Kocsis Kata gyakorlat közben, tornalabdával és habhengerrel',
  },
  { file: 'press-noklapja.png', dir: 'site', alt: 'A Nők Lapja logója' },
  { file: 'press-karc.png', dir: 'site', alt: 'A Karc FM logója' },
  { file: 'press-hazipatika.png', dir: 'site', alt: 'A Házipatika logója' },
  { file: 'press-kepmas.png', dir: 'site', alt: 'A Képmás magazin logója' },
  { file: 'press-ispor.png', dir: 'site', alt: 'Az iSport logója' },
  {
    file: 'press-mgyft.png',
    dir: 'site',
    alt: 'A Magyar Gyógytornász-Fizioterapeuták Társaságának logója',
  },
  {
    file: 'logo-kineticare.png',
    dir: 'site',
    alt: 'A Kineticare logója: KINETICARE felirat világoskék hullámmotívummal',
  },
  // Partnerlogók a /rolunk „Partnereink" logósávjához (tulajdonosi kérés A04,
  // docs/kc-v1-owner-review.md). A kezdőlap NEM hivatkozik rájuk; azért élnek
  // itt, mert a sajtó-logókkal azonos úton kell feltöltődniük és az induláskori
  // önjavításnak (src/lib/media-restore.ts) is innen kell visszatöltenie őket.
  // Forrás: a régi kineticare.hu/rolunk saját assetjei, méret- és
  // eredetnyilvántartás: content/home-images/site/partner-manifest.json,
  // docs/kc-v1-logo-sources.md „Partnerek". Az alt = a szervezet neve
  // (WCAG 2.2 SC 1.1.1: a logó szöveges megfelelője a szervezet neve).
  { file: 'partner-probody-studio.webp', dir: 'site', alt: 'A ProBody Stúdió logója' },
  { file: 'partner-dynamic-tape.webp', dir: 'site', alt: 'A Dynamic Tape logója' },
  { file: 'partner-wibbi.webp', dir: 'site', alt: 'A WIBBI logója' },
  { file: 'partner-halm-optika.webp', dir: 'site', alt: 'A Halm Optika logója' },
  { file: 'partner-nishi-studio.webp', dir: 'site', alt: 'A NISHI STUDIO pilates logója' },
  { file: 'partner-bodygps.webp', dir: 'site', alt: 'A BodyGPS logója' },
  { file: 'partner-magic-smile.webp', dir: 'site', alt: 'A Magic Smile by Juci logója' },
  { file: 'partner-be-fit-with-ben.webp', dir: 'site', alt: 'A Be Fit With Ben logója' },
  { file: 'partner-ortocare.webp', dir: 'site', alt: 'Az OrtoCare logója' },
  { file: 'partner-pille-fizioterapia.webp', dir: 'site', alt: 'A Pille Fizioterápia logója' },
] as const satisfies readonly SeedImage[]

/**
 * A /rolunk partner-logósávjának fájljai a HOME_IMAGES-ből (a `partner-`
 * előtag a kulcs), a HOME_IMAGES sorrendjében. A sáv élén az egyesületi
 * MASE-logó áll (`mase.png`, public/media/press) — lásd a restore scriptet.
 */
export const PARTNER_LOGO_FILES = HOME_IMAGES.filter((image) =>
  image.file.startsWith('partner-'),
).map((image) => image.file)

/**
 * A négy ellenőrzött sajtó-/szakmai logó (H05) fájlnevei — a
 * `public/media/press/manifest.json` gépi átadásának típusbiztos tükre. A
 * partner-logo-assets őr-teszt bizonyítja, hogy a kettő egyezik.
 */
export const PRESS_MANIFEST_FILES = [
  'kossuth-radio.png',
  'tv2.webp',
  'mase.png',
  'magyar-kezsebesz-tarsasag.png',
] as const

/** A H05 logók forrásmappája (a manifest és az eredetigazolás közös helye). */
export const PRESS_MANIFEST_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'public',
  'media',
  'press',
)

/**
 * A sajtó-logósor teljes sora: a manifest `preserveExisting` hat logója
 * (változatlan sorrendben, elöl), utána a négy új. A manifest additív
 * szerződése (docs/kc-v1-logo-sources.md „Integration contract"): meglévő
 * bejegyzés nem tűnik el, az eredmény 10 ≤ 12 (a blokk `maxRows`-a).
 */
export const PRESS_RAIL_FILES = [
  'press-noklapja.png',
  'press-karc.png',
  'press-hazipatika.png',
  'press-kepmas.png',
  'press-ispor.png',
  'press-mgyft.png',
  ...PRESS_MANIFEST_FILES,
] as const

/** A seed által feltöltött képfájlok neve (típusbiztos hivatkozás a layoutban). */
export type SeedImageFile =
  (typeof HOME_IMAGES)[number]['file'] | (typeof PRESS_MANIFEST_FILES)[number]

/**
 * Fájlnév → Media id leképezés. Szándékosan `Partial`: ha egy képfájl hiányzik
 * a munkamásolatból, a hozzá tartozó id kimarad, és a layout egyszerűen kép
 * nélkül épül fel — a seed nem áll meg.
 */
export type HomeMediaIds = Partial<Record<SeedImageFile, number>>

/**
 * A kezdőlapi seed/restore képek gyökere (`content/home-images`).
 *
 * Exportált, mert az induláskori önjavítás (src/lib/media-restore.ts) is
 * innen tölti vissza a deploykor elveszett képfájlokat.
 */
export const LANDING_ASSETS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'content',
  'home-images',
)

/**
 * Egy repó-fájlból létrehozott média-rekord mezői: az alt, és ha a forrás
 * megadja, a fókuszpont. A Payload a `focalX`/`focalY` párból állítja be a
 * feltöltés fókuszpontját (a vágott méretváltozat is ebből indul); pont
 * nélkül a séma 50/50-e marad. A seed és a tartalomjob
 * (src/scripts/apply-owner-content.ts) közös alakja.
 */
export const mediaCreateData = (source: {
  alt: string
  focalX?: number
  focalY?: number
}): { alt: string; focalX?: number; focalY?: number } =>
  typeof source.focalX === 'number' && typeof source.focalY === 'number'
    ? { alt: source.alt, focalX: source.focalX, focalY: source.focalY }
    : { alt: source.alt }

/**
 * Képek idempotens feltöltése.
 *
 * A dedup a kiterjesztés NÉLKÜLI alapnévre megy: a Média collection webp-re
 * konvertál feltöltéskor (src/collections/Media.ts `formatOptions`), így a
 * `state-zart.png` fájlból `state-zart.webp` filename lesz — az eredeti névre
 * szűrve sosem találnánk meg a saját korábbi feltöltésünket, és minden futás
 * duplikálna. Ugyanez a minta él a legacy-visszaépítő scriptben is.
 *
 * Meglévő képet a seed SOHA nem ír felül: ha a lányok kicserélték a képet, az
 * marad — csak az id-jét vesszük át a layouthoz.
 */
export const ensureHomeImages = async (payload: Payload): Promise<HomeMediaIds> => {
  const ids: HomeMediaIds = {}

  for (const image of HOME_IMAGES) {
    const baseName = image.file.replace(/\.[^.]+$/, '')
    const existing = await payload.find({
      collection: 'media',
      where: { filename: { like: `${baseName}%` } },
      limit: 1,
      overrideAccess: true,
    })
    if (existing.docs.length > 0) {
      ids[image.file] = existing.docs[0].id
      payload.logger.info(`Seed: kép már fel van töltve (${image.file}), kihagyva.`)
      continue
    }

    const filePath = path.join(LANDING_ASSETS_DIR, image.dir, image.file)
    if (!existsSync(filePath)) {
      payload.logger.warn(
        `Seed: a képfájl nem található, a szekció kép nélkül készül el (${filePath}).`,
      )
      continue
    }

    const created = await payload.create({
      collection: 'media',
      data: mediaCreateData(image),
      filePath,
      overrideAccess: true,
    })
    ids[image.file] = created.id
    payload.logger.info(`Seed: kép feltöltve (${image.file}).`)
  }

  // A H05 logók KEZELT (eredetigazolt) médiák: itt csak megkeressük őket, a
  // feltöltés és az igazolás az `ensurePressManifestImages` explicit operátori
  // lépése (npm run seed:legacy) — induláskor nem jön létre igazolás nélküli
  // kezelt rekord (docs/kc-v1-delivery-plan.md: „korábbi igazolás nélkül nincs
  // automatikus enrollment").
  for (const file of PRESS_MANIFEST_FILES) {
    const id = await findMediaIdByBaseName(payload, file)
    if (id !== undefined) ids[file] = id
  }

  return ids
}

/**
 * Egy média-rekord id-je a kiterjesztés nélküli alapnév alapján (webp-konverzió).
 * A Payload `like` TARTALMAZÁSRA illeszt (ILIKE %…%), ezért egy rövid alapnév
 * (pl. `tv2`, `mase`) idegen fájlra is találna; a jelölteket ezért a pontos
 * alapnév + kiterjesztés alakra szűrjük, és csak egyértelmű találatot adunk.
 */
const findMediaIdByBaseName = async (
  payload: Payload,
  file: string,
): Promise<number | undefined> => {
  const baseName = file.replace(/\.[^.]+$/, '')
  const existing = await payload.find({
    collection: 'media',
    where: { filename: { like: `${baseName}.` } },
    limit: 20,
    overrideAccess: true,
  })
  const exact = new RegExp(
    `^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(webp|png|jpe?g)$`,
    'i',
  )
  const hit = existing.docs.find(
    (doc) => typeof doc.filename === 'string' && exact.test(doc.filename),
  )
  return hit?.id
}

/**
 * A négy H05 logó (public/media/press) idempotens feltöltése ÉS
 * eredetigazolása (media-recovery receipt) — az owner-review CLI team-fotó
 * mintája (src/scripts/apply-owner-review-v1.ts). Meglévő rekordot sosem ír
 * felül. Csak explicit operátori futásból hívandó, induláskor nem.
 *
 * Ha az igazolás elbukik, a rekord megmarad, a hiba naplózódik, és a
 * `--enroll-media-recovery <média-ID>` CLI-lépéssel pótolható.
 */
export const ensurePressManifestImages = async (
  payload: Payload,
): Promise<Partial<Record<(typeof PRESS_MANIFEST_FILES)[number], number>>> => {
  const ids: Partial<Record<(typeof PRESS_MANIFEST_FILES)[number], number>> = {}
  for (const file of PRESS_MANIFEST_FILES) {
    const asset = pressManifest.assets.find((entry) => entry.file === file)
    if (asset === undefined) {
      throw new Error(`A sajtó-logó manifest nem tartalmazza: ${file}`)
    }
    const existingId = await findMediaIdByBaseName(payload, file)
    if (existingId !== undefined) {
      ids[file] = existingId
      payload.logger.info(`Seed: sajtó-logó már fel van töltve (${file}), kihagyva.`)
      continue
    }
    const filePath = path.join(PRESS_MANIFEST_DIR, file)
    if (!existsSync(filePath)) {
      payload.logger.warn(`Seed: a sajtó-logó fájlja nem található (${filePath}), kihagyva.`)
      continue
    }
    const created = await payload.create({
      collection: 'media',
      data: { alt: asset.alt },
      filePath,
      overrideAccess: true,
    })
    ids[file] = created.id
    payload.logger.info(`Seed: sajtó-logó feltöltve (${file}, id=${created.id}).`)
    try {
      await enrollMediaRecovery(payload, created)
      payload.logger.info(`Seed: sajtó-logó eredetigazolása rögzítve (${file}).`)
    } catch (error) {
      payload.logger.warn(
        `Seed: a sajtó-logó eredetigazolása nem sikerült (${file}, id=${created.id}): ${
          error instanceof Error ? error.message : String(error)
        } — pótlás: npx tsx src/scripts/apply-owner-review-v1.ts --enroll-media-recovery ${created.id}`,
      )
    }
  }
  return ids
}

// ---------------------------------------------------------------------------
// A kezdőlap alap-szekciósora (docs/szekcio-rendszer-terv.md 4. pont).
//
// SORREND: az értékesítési audit M1–M8 hierarchiája, a landing kinézetével —
//   filmHero (M1) → credsStrip (M2) → courseCards (M3) → freeSos (M4) →
//   pressLogos → welcome → usps → states → services → about →
//   howItWorks (M5) → testimonials (M6) → knowledge (M7) → faq (M8) →
//   ctaBanner (záró CTA-sáv).
// A lányok ettől szabadon eltérhetnek az adminban — ez a rendszer értelme.
//
// SZÖVEGEK: betűhíven a forrásokból. A landing-szekciók szövege a régi
// koncepció-landingből jött (egyszeri tükör, már nincs a repóban; a
// film-heróé a `scroll-scrub-scenes.ts` másolata); ahol a landingen nem volt
// megfelelő tartalom (hitel-csík, ingyenes SOS-sáv, „Így működik", GYIK), ott
// a mai fő-site komponensek szövege a forrás (CredentialsStrip.tsx, FreeSos.tsx,
// HowItWorks.tsx, Faq.tsx `FAQ_ITEMS`). A szövegeket szándékosan MÁSOLJUK, nem
// importáljuk: a seed adat, a komponensek pedig a fallback-megjelenítés — a
// kettő a bevezetés után külön életet él (a szöveget innentől a CMS-ben írják).
//
// CTA-CÉLOK: a kezdőlapi sín belső útvonalakra visz (SOS-kurzus, /kurzusok,
// /szolgaltatasok). A ProBody-workshop külső címe a menüben és a
// /szolgaltatasok táblán marad, ide nem kerül.
//
// HÁTTÉRSÁVOK (`sectionSettings.hatter`): a landing sávritmusát követik. A
// landing minden szekciója a papírfehér `--kc-bg` alapon áll (kineticare.css) —
// egyetlen inverz sávja a záró SOS-tábla (`--kc-accent-deep`). Ezért itt minden
// landing-eredetű szekció `feher`; a két olyan szekció, amelyet a mai kezdőlap
// már ma is elválasztott sávban hoz (ingyenes SOS és vélemények), `tint` marad —
// lásd a `freeSos` blokknál a K2-megjegyzést.
// ---------------------------------------------------------------------------

/** A film-hero H1-e — a `kezdolap` oldal címe is ez (a hero fallbackjével egyezően). */
const HOME_HERO_TITLE = 'Hatékony és biztonságos módszerek a kéz és a kar fájdalmai ellen'

/** A film-hero bevezetője — a `kezdolap` oldal rövid bevezetője is ez. */
const HOME_HERO_LEAD =
  'Professzionális, mégis emberközeli terápiás megoldásokkal kezeljük a különböző mozgásszervi problémákat, hogy te ismét önfeledten dolgozhass, sportolhass vagy gondoskodhass szeretteidről.'

/**
 * A kezdőlap alap-szekciósora, tisztán adatként.
 *
 * Gyárfüggvény, mert a kép-hivatkozások futásidejű Media id-k. Kép nélkül
 * (`buildHomeLayout()`) is teljes értékű layoutot ad — így a sorrendet és a
 * szövegeket teszt közvetlenül asszertálhatja, adatbázis nélkül.
 */
export const buildHomeLayout = (media: HomeMediaIds = {}): NonNullable<Page['layout']> => [
  // M1 — Film-hero. Pontosan 1 elsődleges (fizetős irány) + 1 másodlagos
  // (ingyenes SOS) gomb; a másodlagos lapon belüli horgonyra megy, ahogy a mai
  // hero is (#ingyenes → a freeSos szekció horgonya lentebb).
  {
    blockType: 'filmHero',
    title: HOME_HERO_TITLE,
    lead: HOME_HERO_LEAD,
    tags: [{ label: 'Kéz' }, { label: 'Csukló' }, { label: 'Könyök' }, { label: 'Váll' }],
    // MINDKÉT felirat a jóváhagyott szótárból jön (docs/ui-sztenderdek.md
    // §3.2 #10 `course-list-open` és #38 `free-strip-jump`; kódbeli szótár:
    // src/lib/cta-vocabulary.ts). Egy cselekvésre EGY felirat az egész lapon —
    // WCAG 2.2 3.2.4 Consistent Identification. A hero másodlagos gombja a
    // `HeroCta` komponens párja: a kettő ugyanoda (`#ingyenes`) visz, ezért
    // ugyanazt is mondja.
    ctas: [
      { felirat: ctaLabel('course-list-open'), url: '/kurzusok', ujAblakban: false },
      { felirat: ctaLabel('free-strip-jump'), url: '#ingyenes', ujAblakban: false },
    ],
    sectionSettings: { visible: true },
  },

  // M2 — Szakmai hitel-csík közvetlenül a hero alatt (a sajtólogó-sor NEM
  // helyettesíti: az lentebb, külön szekcióként jön).
  {
    blockType: 'credsStrip',
    items: [
      { text: 'Gyógytornász és manuálterapeuta szakmai háttér' },
      { text: 'Sportolók és olimpikonok is hozzánk fordulnak' },
      { text: 'Szakmai egyesületi tagság' },
    ],
    // A felirat a jóváhagyott szótárból (docs/ui-sztenderdek.md §3.2 #34,
    // `about-open`). A korábbi „Bővebben a szakmai hátterünkről" öt szó volt
    // (M-3 korlátja négy), és a „Bővebben" a GOV.UK által kerülendő általános
    // linkszöveg magyar párja.
    link: { felirat: ctaLabel('about-open'), url: '/rolunk', ujAblakban: false },
    sectionSettings: { visible: true, hatter: 'feher' },
  },

  // M3 — Kurzuskártyák. Adatvezérelt: a kártyák a Webshop → Kurzusok közül
  // jönnek (cím, előnyök, ár, borító), itt csak a felvezető szöveg él.
  // A cím SZÁNDÉKOSAN nem „Így tudunk neked segíteni": az ütközött a lentebbi
  // Szolgáltatások szekció „Így tudunk segíteni" címével (kezdőlap-audit,
  // 2026-08-15) — a szekció a megvásárolható kínálatot nevezi meg.
  {
    blockType: 'courseCards',
    heading: 'Kurzusaink',
    lead: 'Online kézrehabilitációs kurzusaink lépésről lépésre vezetnek végig az otthoni felépülésen.',
    sectionSettings: { visible: true, anchorId: 'kurzusok', hatter: 'feher' },
  },

  // M4 — Ingyenes SOS-sáv. A landing ezt sötétkék záró táblaként hozza, itt
  // viszont közvetlenül a fizetős kártyák UTÁN áll: sötét sávval az ingyenes
  // ajánlat elnyomná a fizetőset (értékesítési UX-skill M4/K2), ezért marad a
  // világoskék sáv — ahogy a mai kezdőlap FreeSos szekciója is. A landing
  // háttérképe (sos-hands-board.jpg) viszont átjön.
  //
  // A GOMBNAK SZÁNDÉKOSAN NINCS `url`-je (2026-08-16, IA-audit T1 /
  // gomb-inventár B7). A korábbi `url: '/kurzusok'` felülírta a komponens
  // termékből számolt célját, ezért a gomb az ingyenes kurzus INDÍTÁSÁT ígérte,
  // de a kurzuslistára vitt. Cél nélkül a `FreeSos` maga oldja fel: van
  // ingyenes termék → annak a kurzusoldala, nincs → a lista, és ilyenkor a
  // felirat is a lista feliratára vált (resolveFreeSosCta). A felirat a
  // jóváhagyott szótárból jön: docs/ui-sztenderdek.md §3.2 #4.
  {
    blockType: 'freeSos',
    // A tulajdonos 2026-09-07-i szó szerinti címe; a sáv 2026-09-22-től ezt a
    // mezőt mutatja (src/lib/free-sos-title.ts).
    title: 'Ingyenes villámkurzus',
    body: 'Ha előbb kipróbálnád a módszert: rövid, azonnal használható gyakorlatok hirtelen jelentkező kézfájdalomra.',
    cta: { felirat: 'Elindítom ingyen', ujAblakban: false },
    backgroundImage: media['sos-hands-board.jpg'],
    sectionSettings: { visible: true, anchorId: 'ingyenes', hatter: 'tint' },
  },

  // Sajtó-logósor — bizalmi elem, de nem hitel-csík: a lap későbbi szakaszába
  // való. A logók sorrendje a landingé.
  {
    blockType: 'pressLogos',
    // Tulajdonosi szöveg-javítás (2026-08-16): a korábbi „Ismerhetsz minket
    // innen" helyett — a sorban szakmai szervezet logója is áll, és ez a
    // megfogalmazás a látogató szemszögéből pontosabb. A komponens beépített
    // felirata (PressLogos DEFAULT_HEADING) ugyanez.
    heading: 'Itt találkozhattál velünk',
    // A logónkénti alt-felülírást szándékosan üresen hagyjuk: így a Médiatárban
    // megadott képleírás jelenik meg, azaz egy helyen szerkeszthető.
    // A sor: a hat régi logó + a négy ellenőrzött új (H05, PRESS_RAIL_FILES);
    // amelyik még nincs a Médiatárban, egyszerűen kimarad.
    logos: PRESS_RAIL_FILES.flatMap((file) => {
      const image = media[file]
      return image === undefined ? [] : [{ image }]
    }),
    sectionSettings: { visible: true, hatter: 'feher' },
  },

  // Üdvözlő / probléma-blokk — a látogató helyzetének visszatükrözése.
  {
    blockType: 'welcome',
    title: 'Szeretnél megszabadulni a fájdalomtól, de hiába próbáltál ki (szinte) mindent?',
    lead: 'Tudjuk, milyen, amikor:',
    checklist: [
      {
        text: 'Az ujjad vagy a csuklód már a nap közepén görcsöl, és esélyed sincs pihentetni',
      },
      { text: 'Minden mozdulatnál attól tartasz, csak ne legyen rosszabb' },
      {
        text: 'Egyre több kenőcsöt, borogatást és „csodaszert” halmozol fel, de a fájdalom újra és újra jelentkezik.',
      },
    ],
    sideParagraphs: [
      {
        text: 'Ha eleged van abból, hogy már csak félgőzzel bírsz dolgozni vagy sportolni, mert félsz a fájdalomtól, vagy netán a fájdalomcsillapítókig fajult a helyzet, akkor a legjobb helyen jársz.',
        emphasized: false,
      },
      {
        text: 'Mozgásterápiás módszerekkel tudunk abban segíteni, hogy végre megszűnjön a kézfájdalmad, és újra teljes erőbedobással élhesd a mindennapjaid.',
        emphasized: true,
      },
    ],
    sectionSettings: { visible: true, hatter: 'feher' },
  },

  // „Erre számíthatsz" kártyák.
  {
    blockType: 'usps',
    title: 'Erre számíthatsz velünk',
    cards: [
      {
        title: 'A legújabb, tudományosan megalapozott módszereket alkalmazzuk',
        body: 'Folyamatosan figyeljük a külföldi és hazai szakmai protokollokat, kutatásokat, és a pácienseinken látott valós tapasztalatokat is ötvözzük.',
        extra:
          'Így garantáltan naprakész, biztonságos és hatékony módszerekkel dolgozunk, hogy a kezed a lehető leggyorsabban regenerálódhasson.',
      },
      {
        title: 'Személyre szabott megoldást kapsz, akár otthon, akár rendelőben',
        body: 'Minden programunkban (legyen az online kurzus vagy személyes kezelés) figyelembe vesszük a te szokásaidat, terhelésedet és korlátaidat.',
        extra:
          'Ha nincs időd a rendelőbe járni, otthoni gyakorlóvideók várnak; ha pedig eljössz hozzánk, az igényeidhez és az életviteledhez igazítjuk a kezelési tervet. A lényeg: mindig van olyan megoldásunk, ami neked megfelel, és valódi javulást hoz.',
      },
      {
        title: 'Nem rövidtávú tünetkezeléssel, hanem tartós eredménnyel foglalkozunk',
        body: 'Nálunk nem áll meg a folyamat a „gyorsan csökkentsük a fájdalmat” résznél. Arra törekszünk, hogy ne is térjen vissza a kínzó fájdalom.',
        extra:
          'Megmutatjuk, hogyan változtass a mozgásmintáidon, és milyen gyakorlatokat érdemes beépítened a hétköznapokba. A cél: egy olyan stabil, teherbíró kéz, ami hosszú távon bírja a strapát, akár munkáról, sportról vagy a hétköznapok terheléséről van szó.',
      },
    ],
    sectionSettings: { visible: true, hatter: 'feher' },
  },

  // Három állapot. A `number` szándékosan üres: a landingen is a megjelenítés
  // számoz (01, 02, 03), nem a tartalom — a blokk ugyanezt ígéri.
  //
  // BEVEZETŐ (tulajdonosi visszajelzés, 2026-08-16): a szekció címe alatt
  // MAGYARÁZAT kell, különben a három kép önmagában áll, és a látogatónak kell
  // kitalálnia, mit lát. A szöveg a terápia ívét mondja el (ez a szekció
  // valódi állítása), és a logó-utalást is megtartja — így akkor is helyes,
  // ha a szerkesztő a címet „A terápia működik"-re cseréli.
  {
    blockType: 'states',
    title: 'Három állapot, egy folyamat',
    lead: 'A terápia íve három képben: a fájdalomtól zárt kézből előbb oldódik a görcs, aztán visszatér a szabad mozgás. Ugyanezt a három állapotot rajzolja ki a logónk is.',
    cards: [
      {
        image: media['state-zart.png'],
        title: 'Zárt',
        text: 'Fájdalom, bizonytalanság, a kéz védekezése. Ismerős, ha hónapok óta szenvedsz.',
      },
      {
        image: media['state-nyilo.png'],
        title: 'Nyíló',
        text: 'A közös munka meghozza az első enyhülést. Minden alkalommal egy mozdulattal több lesz.',
      },
      {
        image: media['state-nyitott.png'],
        title: 'Nyitott',
        text: 'Újra a saját kezed. Újra dolgozhatsz, sportolhatsz, önfeledten élhetsz.',
      },
    ],
    sectionSettings: { visible: true, hatter: 'feher' },
  },

  // REV C sín + panel a drót idővonal-krómjával, tint sávon. A ProBody-sor a
  // /szolgaltatasok táblán és a menüben is él; itt a három szolgáltatás-ajtó
  // áll. A panel-fotók ajtónként a saját tevékenységet mutatják (2026-09-22:
  // gumiszalagos kezelés, a videókurzus stúdiója, kéz-anatómia táblagépen;
  // HOME_HELP_PHOTOS).
  {
    blockType: 'services',
    title: HOME_HELP_TITLE,
    lead: HOME_HELP_LEAD,
    elrendezes: 'sin',
    image: media['services-hands.png'],
    rows: homeHelpRailRows(HOME_HELP_PHOTO_FILES.map((file) => media[file])),
    sectionSettings: { visible: true, hatter: 'tint' },
  },

  // Rólunk + statisztikák. A számok a landing VALÓS adatai — kitalált
  // statisztika ide nem kerülhet.
  {
    blockType: 'about',
    eyebrow: 'Rólunk',
    // WP37: a KEZDŐLAPI bemutatkozás (kik ők, miért bízz bennük 20 másodperc
    // alatt) a /rolunk-tól külön szövegforrásból (src/lib/rolunk-bemutatkozas.ts,
    // KEZDOLAP_*), nem külön másolatból. A statisztikasor a kezdőlapé marad
    // (három szám), a fotó a páros alak tartaléka.
    ...kezdolapBemutatkozasSzoveg(),
    photo: media['katak-team.jpg'],
    stats: [
      { value: '10+', label: 'év szakmai tapasztalat' },
      // A régi oldal minden előfordulásban „1000+"-t állít (mélyfeltárás,
      // docs/regi-oldal-valaszok.md) — az „5000+" sehonnan nem volt igazolható,
      // a tulajdonos 2026-08-15-én hagyta jóvá a javítást.
      { value: '1000+', label: 'elégedett páciens' },
      { value: '1', label: 'közös cél: az Ön mozgásszabadsága' },
    ],
    sectionSettings: { visible: true, hatter: 'feher' },
  },

  // M5 — „Így működik az online kurzus": a videókurzus legfontosabb
  // ellenérv-csökkentője (megveszem → azonnal nézem → otthon gyakorlok).
  {
    blockType: 'howItWorks',
    title: 'Így működik az online kurzus',
    steps: [
      {
        title: 'Kiválasztod a kurzust',
        text: HOW_IT_WORKS_STEP1_FIXED,
      },
      {
        title: 'Azonnal hozzáférsz',
        text: 'A videós anyagokat a fiókodban éred el, saját tempódban, amikor neked megfelel.',
      },
      {
        title: 'Otthon gyakorolsz',
        text: 'A gyakorlatok lépésről lépésre vezetnek, naponta néhány perc is elég a haladáshoz.',
      },
    ],
    sectionSettings: { visible: true, hatter: 'feher' },
  },

  // M6 — Vélemények. Adatvezérelt: a Tartalom → Vélemények alatt kiemelt
  // (featured) és látható visszajelzések jönnek ki, legfeljebb 3.
  {
    blockType: 'testimonials',
    eyebrow: 'Vélemények',
    heading: 'Pácienseink mondták',
    maxItems: 3,
    sectionSettings: { visible: true, anchorId: 'velemenyek', hatter: 'tint' },
  },

  // M7 — Tudástár-ajánló. Adatvezérelt: a legfrissebb közzétett bejegyzések.
  // Fehér sáv, hogy a fenti (tint) vélemény-szekcióval ne olvadjon egybe.
  {
    blockType: 'knowledge',
    heading: 'Legfrissebb a tudástárból',
    limit: 3,
    sectionSettings: { visible: true, hatter: 'feher' },
  },

  // M8 — GYIK. Ebből készül a Google-nek szóló FAQPage strukturált adat is,
  // ezért a válaszok sima szövegek, és gyógyulást nem ígérnek.
  {
    blockType: 'faq',
    heading: 'Gyakori kérdések',
    items: [
      {
        question: 'Műtét után is végezhetem a gyakorlatokat?',
        answer:
          'A kurzusok általános rehabilitációs programok. Műtét után mindig a kezelőorvosod vagy gyógytornászod jóváhagyásával kezdj bele. Ha bizonytalan vagy, írj nekünk a kapcsolat oldalon, és segítünk eligazodni.',
      },
      {
        question: 'Fájdalmasak a gyakorlatok?',
        answer:
          'Nem kell, hogy fájjanak. A gyakorlatokat a saját tűrőképességedhez igazítod; éles fájdalom esetén hagyd abba, és kérj szakmai segítséget.',
      },
      {
        question: 'Mennyi időt vesz igénybe naponta?',
        answer:
          'Napi 10–15 perc is elég: a rövid, rendszeres gyakorlás hozza a tartós eredményt, nem az egyszeri nagy erőfeszítés.',
      },
      {
        question: 'Szükségem van eszközökre a gyakorlatokhoz?',
        answer:
          'Nem. A gyakorlatok többsége saját testsúllyal, otthon található eszközökkel végezhető. Ahol bármi kell, azt a videóban jelezzük.',
      },
    ],
    sectionSettings: { visible: true, hatter: 'feher' },
  },

  // ZÁRÓ CTA-SÁV. A GYIK a lap utolsó ellenérv-kezelő szekciója; utána a lap
  // CSELEKVÉSSEL zárul, a fizetős irányba (UX-skill 1. pont: ami pénzt hoz, az
  // hangsúlyos helyre kerül). Ugyanez a minta zárja a /rolunk és a
  // /szolgaltatasok oldalt is (src/scripts/restore-legacy-content.ts).
  //
  // A SZÖVEG (tulajdonosi visszajelzés, 2026-08-16) nem lehet üres: a cím
  // önmagában felszólítás indoklás nélkül. A két mondat azt mondja el, mi
  // történik a kattintás után, és ki állította össze az anyagot — ígéret,
  // sürgetés és visszaszámláló nélkül (UX-skill 6. pont: dark pattern tilos).
  // A tint sáv a fölötte álló fehér GYIK-tól választja el a lezárást.
  {
    blockType: 'ctaBanner',
    title: 'Kezdd el még ma',
    text: 'Az otthoni kézrehabilitációs programmal a saját tempódban indulhatsz: a videós gyakorlatokat a vásárlás után azonnal eléred, és naponta néhány perc gyakorlás is visz előre. A programot kézrehabilitációval foglalkozó gyógytornászok állították össze.',
    // A záró CTA ugyanoda visz, mint a hero és a szolgáltatás-sor második
    // gombja (/kurzusok), ezért UGYANAZT a feliratot viseli — a §3.2 #10
    // jóváhagyott alakját. A korábbi „Megnézem a kurzusokat" egy hatodik,
    // eltérő feliratot vitt ugyanarra a célra a kezdőlapon (WCAG 2.2 · 3.2.4).
    cta: { felirat: 'Nézd meg a kurzusokat', url: '/kurzusok', ujAblakban: false },
    sectionSettings: { visible: true, hatter: 'tint' },
  },
]

/**
 * A kezdőlap `layout` mezőjének idempotens feltöltése, WEBCÍM szerint.
 *
 * Három eset:
 *  - nincs `kezdolap` oldal → létrejön, rögtön az alap-szekciósorral,
 *  - van, de üres a szekciósora → megkapja az alap-szekciósort,
 *  - van szekciósora → ÉRINTETLEN marad (az már szerkesztői munka).
 *
 * Hívója a kézzel indított `npm run seed`. Az onInit NEM ezt hívja, hanem a
 * `ensureHomeLayoutFrissTelepitesen`-t (lásd ott, miért).
 */
export const ensureHomeLayout = async (payload: Payload, media: HomeMediaIds): Promise<void> => {
  const existing = await payload.find({
    collection: 'pages',
    where: { slug: { equals: HOME_PAGE_SLUG } },
    limit: 1,
    overrideAccess: true,
  })

  const layout = buildHomeLayout(media)

  if (existing.docs.length === 0) {
    await payload.create({
      collection: 'pages',
      data: {
        title: HOME_HERO_TITLE,
        slug: HOME_PAGE_SLUG,
        excerpt: HOME_HERO_LEAD,
        content: minimalRichText(
          'A Kineticare kézrehabilitációs kurzusplatform: otthon végezhető videós programok és szakmai képzések gyógytornászoktól.',
        ),
        seoTitle: 'Kineticare | kézrehabilitáció gyógytornászoktól',
        seoDescription:
          'Kocsis Kata és Kiss Kata gyógytornászok: kézrehabilitáció, kéztőalagút-szindróma, kézfájdalom, csuklófájdalom, teniszkönyök kezelése rendelőben és online programmal.',
        layout,
        // Lásd a demó oldalnál: a `status` a `_status`-ból szinkronizálódik.
        status: 'published',
        _status: 'published',
        publishedAt: new Date().toISOString(),
      },
      overrideAccess: true,
    })
    payload.logger.info(
      `Seed: kezdőlap létrehozva az alap-szekciósorral (${HOME_PAGE_SLUG}, ${layout.length} szekció).`,
    )
    return
  }

  const home = existing.docs[0]
  if (Array.isArray(home.layout) && home.layout.length > 0) {
    payload.logger.info(
      'Seed: a kezdőlapnak már van szekciósora, érintetlenül hagyva (a seed sosem ír felül szerkesztői layoutot).',
    )
    return
  }

  await payload.update({
    collection: 'pages',
    id: home.id,
    data: { layout },
    overrideAccess: true,
  })
  payload.logger.info(`Seed: kezdőlap alap-szekciósora felvéve (${layout.length} szekció).`)
}

/**
 * Az Oldalak-gyűjtemény ÖSSZES dokumentuma, bármilyen állapotban.
 *
 * A Payload 3.88 `count` művelete (payload/dist/collections/operations/count.js
 * → @payloadcms/drizzle/dist/count.js) a gyűjtemény FŐ táblájában számol, és
 * állapotra nem szűr: a `create` piszkozatnál is a fő táblába ír
 * (operations/create.js `payload.db.create`), tehát a piszkozat-állapotú
 * oldal is beleszámít. A lomtárat csak az `appendNonTrashedFilter` zárja ki,
 * és csak akkor, ha a gyűjteményen be van kapcsolva a `trash` ÉS a hívás
 * `trash: false`; a `trash: true` így a lomtárban lévő oldalt is számolja
 * (ma a Pages-en nincs lomtár, ott a kapcsoló hatástalan, de egy későbbi
 * bekapcsolásnál sem fordul át a szabály).
 */
async function osszesOldal(payload: Payload): Promise<number> {
  const eredmeny = await payload.count({ collection: 'pages', overrideAccess: true, trash: true })
  return eredmeny.totalDocs
}

/**
 * Az onInit kezdőlap-lépése: CSAK friss telepítésen ír (H40, H48 A17).
 *
 * Ha az Oldalak gyűjteményben BÁRMILYEN oldal van (közzétett, piszkozat, más
 * webcímű, átnevezett kezdőlap), a lépés naplóz és kilép, írás nélkül. Így
 * nem jön létre második, közzétett kezdőlap, ha a szerkesztő átírta a
 * `kezdolap` webcímet vagy törölte a kezdőlapot, és a szándékosan kiürített
 * szekciósort sem tölti vissza. Üres gyűjteménynél a mai viselkedés fut
 * (`ensureHomeLayout`: új, közzétett kezdőlap az alap-szekciósorral).
 *
 * BEST-EFFORT: bármely hiba (pl. migráció előtti adatbázis) csak
 * figyelmeztetés, kivétel nem szökik ki az onInitből.
 */
export async function ensureHomeLayoutFrissTelepitesen(
  payload: Payload,
  media: HomeMediaIds,
): Promise<void> {
  try {
    const oldalak = await osszesOldal(payload)
    if (oldalak > 0) {
      logger.info(
        'Induláskor: az Oldalak gyűjteményben már van oldal, a kezdőlap-seed kimarad (csak friss telepítésen ír).',
        { oldalak },
      )
      return
    }
    await ensureHomeLayout(payload, media)
  } catch (error) {
    logger.warn('Induláskor: a kezdőlap friss telepítési seedje sikertelen (best-effort)', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// ---------------------------------------------------------------------------
// A kezdőlap három kiemelt véleménye (B3).
//
// A „Pácienseink mondták" szekció (M6) adatvezérelt: kiemelt (`featured`) és
// látható vélemény nélkül NEM renderelődik — élesben pontosan ez történt, a
// collection üres volt. Az itteni alapállapot ezt pótolja, idempotensen.
//
// TARTALMI SZABÁLY (fogyasztóvédelem — lásd a TestimonialsSection fejkommentjét):
// ide KIZÁRÓLAG a lányok meglévő oldalán publikált, VALÓS visszajelzés kerülhet,
// betűhíven. A `quote` karakterre azonos a legacy-visszaépítő script
// (src/scripts/restore-legacy-content.ts) LEGACY_TESTIMONIALS tételeivel; a
// `shortQuote` a teljes idézet ÖSSZEFÜGGŐ, betűhív részlete (invariáns:
// quote.includes(shortQuote)). A kezdőlap-terv rövidítései szándékosan nincsenek
// átvéve: átfogalmazott / összeollózott idézet tilos.
// ---------------------------------------------------------------------------

interface HomeTestimonialSeed {
  /** A vélemény teljes szövege — betűhíven, ahogy a lányok oldalán megjelent. */
  quote: string
  /** Kezdőlapi rövid változat: mindig a `quote` betűhív, összefüggő részlete. */
  shortQuote: string
  /** Az idempotencia-kulcs is: ilyen nevű vélemény esetén a seed nem nyúl semmihez. */
  authorName: string
  authorTitle: string
  /** Kezdőlapi sorrend — az 1-es a nagy, nyitó idézet. */
  order: number
}

export const HOME_TESTIMONIALS: readonly HomeTestimonialSeed[] = [
  {
    quote:
      'Kocsis Katát kézproblémával kerestem fel, és már az első alkalommal éreztem, hogy jó kezekben vagyok – szó szerint is. Nagy odafigyeléssel, alázattal és valódi szakértelemmel kezelt minden alkalommal. Nemcsak a tüneteket enyhítette, hanem segített megérteni a kiváltó okokat is. Őszintén ajánlom mindenkinek, aki nemcsak gyors enyhülést, hanem tartós megoldást keres.',
    shortQuote:
      'Nemcsak a tüneteket enyhítette, hanem segített megérteni a kiváltó okokat is. Őszintén ajánlom mindenkinek, aki nemcsak gyors enyhülést, hanem tartós megoldást keres.',
    authorName: 'Garami Gábor',
    authorTitle: 'zenész, műsorvezető',
    order: 1,
  },
  {
    quote:
      'Egy 10 éve tartó ganglion problémával, több operáció után jutottam el Katához, mert szikementes segítséget szerettem volna igénybe venni, és nem is dönthettem volna jobban! Nagyon hálás vagyok, hogy szakértelme által jelentős javulást és tünetmentességet értünk el a kezelések során, és rengeteg tudást is kaptam, pl. hogy tornáztathatom én magam is a fájó testrészeket, vagy hogyan tape-elhetem be magam akut fájdalom esetén.',
    shortQuote:
      'Egy 10 éve tartó ganglion problémával, több operáció után jutottam el Katához, mert szikementes segítséget szerettem volna igénybe venni, és nem is dönthettem volna jobban!',
    authorName: 'Kállai Dóra',
    authorTitle: 'biológus',
    order: 2,
  },
  {
    quote:
      'A KINETICARE lányokat ajánlás alapján kerestem meg, ugyanis akkor már pár hónapja erős fájdalommal járt a hüvelykujjam és a csuklóm mozgatása. Ez a munkámat is nehezítette, hiszen jógaoktatóként folyamatosan használnom kellett, nem pihentethettem. A közös munkának, a világos magyarázatoknak, hogy mi történik velem, illetve a szuper feladatoknak és életvezetési tanácsoknak hála sikerült a gyógyulás! Nagyon hálás vagyok a KINETICARE-nek, hiszen azóta fájdalommentesen élek, és újra visszatérhettem kedvenc gyakorlatomhoz, a kézenálláshoz is.',
    shortQuote:
      'A közös munkának, a világos magyarázatoknak, hogy mi történik velem, illetve a szuper feladatoknak és életvezetési tanácsoknak hála sikerült a gyógyulás!',
    authorName: 'Bagdal Szilvia',
    authorTitle: 'jógaoktató',
    order: 3,
  },
]

/**
 * A három kiemelt vélemény idempotens létrehozása, NÉV szerint.
 *
 * Hívója a kézzel indított `npm run seed`; az onInit a
 * `ensureHomeTestimonialsFrissTelepitesen`-t hívja.
 *
 * IDEMPOTENCIA: a kulcs a NÉV (`authorName`). Ha ilyen nevű vélemény már van a
 * collectionben, a függvény kihagyja, és SEMMIT nem ír felül — a szerkesztői
 * munka (javított titulus, más sorrend, levett kiemelés, akár teljesen más
 * szöveg) sérthetetlen, ugyanúgy, ahogy a kezdőlap szekciósorát sem írja felül
 * a seed.
 *
 * BEST-EFFORT: hiányzó tábla vagy adatbázis (pl. első migráció előtti indulás)
 * és minden írási hiba csak figyelmeztetés — sem az app indulását, sem a seedet
 * nem állítja meg. Ugyanez a minta védi a „Kapcsolat" űrlapot az onInitben,
 * ezért a hibakezelés itt, egy helyen ül: mindkét hívási hely örökli.
 */
export async function ensureHomeTestimonials(payload: Payload): Promise<void> {
  try {
    for (const testimonial of HOME_TESTIMONIALS) {
      const existing = await payload.find({
        collection: 'testimonials',
        where: { authorName: { equals: testimonial.authorName } },
        limit: 1,
        overrideAccess: true,
      })
      if (existing.docs.length > 0) {
        logger.info('Kezdőlap: a vélemény már létezik, érintetlenül hagyva', {
          authorName: testimonial.authorName,
        })
        continue
      }
      await payload.create({
        collection: 'testimonials',
        data: {
          quote: testimonial.quote,
          shortQuote: testimonial.shortQuote,
          authorName: testimonial.authorName,
          authorTitle: testimonial.authorTitle,
          featured: true,
          visible: true,
          order: testimonial.order,
        },
        overrideAccess: true,
      })
      logger.info('Kezdőlap: kiemelt vélemény létrehozva', {
        authorName: testimonial.authorName,
        order: testimonial.order,
      })
    }
  } catch (error) {
    logger.warn('Kezdőlap: a kiemelt vélemények betöltése sikertelen (best-effort)', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Az onInit vélemény-lépése: CSAK friss telepítésen ír (H40).
 *
 * A név szerinti `ensureHomeTestimonials` minden induláskor visszahozta a
 * törölt vagy átnevezett induló véleményt (új példányként). Ez a változat
 * a Vélemények gyűjtemény DARABSZÁMÁT nézi: ha legalább egy vélemény van
 * (bármilyen névvel, láthatósággal), naplóz és kilép, írás nélkül; üres
 * gyűjteménynél a mai viselkedés fut (a három induló vélemény).
 *
 * A számlálás a gyűjtemény fő táblájában, lomtárral együtt történik (lásd
 * `osszesOldal`); a Vélemények gyűjteményen ma nincs se piszkozat, se lomtár.
 *
 * BEST-EFFORT: bármely hiba csak figyelmeztetés, kivétel nem szökik ki.
 */
export async function ensureHomeTestimonialsFrissTelepitesen(payload: Payload): Promise<void> {
  try {
    const eredmeny = await payload.count({
      collection: 'testimonials',
      overrideAccess: true,
      trash: true,
    })
    if (eredmeny.totalDocs > 0) {
      logger.info(
        'Induláskor: a Vélemények gyűjteményben már van vélemény, az induló vélemények seedje kimarad (csak friss telepítésen ír).',
        { velemenyek: eredmeny.totalDocs },
      )
      return
    }
    await ensureHomeTestimonials(payload)
  } catch (error) {
    logger.warn(
      'Induláskor: az induló vélemények friss telepítési seedje sikertelen (best-effort)',
      {
        error: error instanceof Error ? error.message : String(error),
      },
    )
  }
}
