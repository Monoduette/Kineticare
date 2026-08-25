/**
 * Önjavító kép-helyreállítás — a deploykor elveszett képfájlok visszatöltése.
 *
 * A PROBLÉMA (élesben mérve). A Payload local-storage a konténer lemezére ír
 * (src/lib/media-dir.ts), a Railway pedig minden deploynál ÜRES lemezt ad, ha a
 * feltöltési könyvtár nem csatolt köteten (Volume) él. Ilyenkor a média-rekord
 * megmarad a DB-ben, a fájl viszont eltűnik, és a `/api/media/file/<fájl>`
 * HTTP 500-at ad. Súlyosbító körülmény, hogy a seed és az onInit FÁJLNÉV alapján
 * dedupál (src/lib/home-seed.ts `ensureHomeImages`): mivel a rekord megvan, azt
 * hiszi, a kép is megvan — a hiba tehát magától SOSEM gyógyul.
 *
 * A MEGOLDÁS KÉT LÁBON ÁLL:
 *  1. a feltöltési könyvtár a csatolt Volume-ra mutat (`PAYLOAD_MEDIA_DIR`),
 *     így új fájl nem is veszik el;
 *  2. ez a modul FÁJL-SZINTEN ellenőriz induláskor: minden média-rekordnál
 *     megnézi, hogy a fájlja (és a méret-variánsai) ott vannak-e a lemezen, és
 *     a hiányzókat a repóban élő forrásokból ÚJRATÖLTI.
 *
 * A HELYREÁLLÍTÁS MEGŐRZI AZ ID-T. A rekordot `payload.update`-tel frissítjük
 * (nem törlés + újralétrehozás), mert a rá mutató relációk — kezdőlap-szekciók,
 * oldalak, termékek — az id-re hivatkoznak: új id esetén elszakadnának. Az
 * `overwriteExistingFiles: true` azért kell, hogy a Payload NE keressen „szabad"
 * fájlnevet (getSafeFileName), hanem pontosan a régi nevet írja vissza — így a
 * kép URL-je is változatlan marad. A méret-variánsokat (xs/sm/md/lg/og) a
 * Payload a feltöltéskor újragenerálja.
 *
 * PÁROSÍTÁS A FORRÁSSAL: a Media collection webp-re konvertál
 * (src/collections/Media.ts `formatOptions`), ezért a DB-beli `filename`
 * (pl. `sos-hands-board.webp`) kiterjesztés nélküli ALAPNEVE egyezik a
 * forrásfájl alapnevével (`sos-hands-board.jpg`). Ugyanez a kulcs él a
 * `ensureHomeImages` és a legacy-visszaépítő dedup-logikájában is.
 *
 * AMIT NEM TUD: a lányok saját, adminból feltöltött képeihez nincs repó-forrás —
 * azokat nem lehet pótolni. Ezeket a modul megszámolja és figyelmeztetésként
 * naplózza, de nem nyúl hozzájuk (a rekord és a hivatkozás sértetlen marad).
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import type { Payload } from 'payload'

import { HOME_IMAGES, LANDING_ASSETS_DIR } from './home-seed'
import { LEGACY_IMAGES, LEGACY_IMAGES_DIR } from './legacy-images'
import type { Media } from '../payload-types'

/** Egy futás mérlege — a hívó ezt naplózza/asszertálja. */
export interface MediaRestoreSummary {
  /** Az összes megvizsgált média-rekord. */
  ellenorzott: number
  /** Rekordok, amelyeknek minden fájlja megvolt a lemezen. */
  rendben: number
  /** Rekordok, amelyeknek hiányzó fájlját visszatöltöttük. */
  visszatoltott: number
  /** Hiányzó fájl, amihez NINCS repó-forrás (saját feltöltés) — nem pótolható. */
  potolhatatlan: number
  /** Hiányzó fájl, aminek a visszatöltése hibára futott. */
  sikertelen: number
}

/** Kiterjesztés nélküli alapnév — ez a forrás↔rekord párosítás kulcsa. */
export const mediaBaseName = (fileName: string): string => fileName.replace(/\.[^.]+$/, '')

/**
 * Alapnév → abszolút forrásútvonal a repóban.
 *
 * Két forráskészlet: a kezdőlapi seed képei (`content/home-images`,
 * LANDING_ASSETS_DIR) és a legacy archívum képei. Névütközésnél az ELSŐ
 * (kezdőlap) nyer — a kezdőlap-layout hivatkozásai, azok elvesztése látszik
 * a legjobban.
 */
export const buildMediaSourceIndex = (): ReadonlyMap<string, string> => {
  const index = new Map<string, string>()
  for (const image of HOME_IMAGES) {
    const key = mediaBaseName(image.file)
    if (!index.has(key)) {
      index.set(key, path.join(LANDING_ASSETS_DIR, image.dir, image.file))
    }
  }
  for (const image of LEGACY_IMAGES) {
    const key = mediaBaseName(image.file)
    if (!index.has(key)) {
      index.set(key, path.join(LEGACY_IMAGES_DIR, image.file))
    }
  }
  return index
}

/**
 * A tényleges feltöltési könyvtár a FUTÓ konfigból (nem újraszámolva).
 *
 * A Payload szanitálása a hiányzó `staticDir`-t a collection slugjára állítja,
 * ami relatív — ezért a `path.resolve` mindenképp kell. Így ez a modul akkor is
 * a helyes mappát nézi, ha a `staticDir` bárhonnan (env, jövőbeli adapter)
 * máshova mutat.
 */
export const resolveUploadDir = (payload: Payload): string =>
  path.resolve(payload.collections.media.config.upload.staticDir ?? 'media')

/**
 * A rekordhoz tartozó, a lemezről HIÁNYZÓ fájlnevek.
 *
 * A fő fájlon túl a méret-variánsokat is nézzük: a `withoutEnlargement: true`
 * miatt egy-egy variáns jogosan lehet üres (kis forrásképnél nem készül el),
 * ezért csak a kitöltött `filename` mezőket ellenőrizzük.
 */
export const missingMediaFiles = (uploadDir: string, doc: Media): string[] => {
  const names: string[] = []
  if (typeof doc.filename === 'string' && doc.filename.length > 0) {
    names.push(doc.filename)
  }
  for (const size of Object.values(doc.sizes ?? {})) {
    const sizeName = size?.filename
    if (typeof sizeName === 'string' && sizeName.length > 0) {
      names.push(sizeName)
    }
  }
  return names.filter((name) => !existsSync(path.join(uploadDir, name)))
}

/**
 * Fájl-szintű ellenőrzés és önjavítás minden média-rekordra.
 *
 * Idempotens: ha minden fájl a helyén van (beállt rendszer, ép Volume), a futás
 * néhány `stat`-hívás és egyetlen olvasás — semmit nem ír.
 */
export const ensureMediaFiles = async (payload: Payload): Promise<MediaRestoreSummary> => {
  const uploadDir = resolveUploadDir(payload)
  const sources = buildMediaSourceIndex()
  const summary: MediaRestoreSummary = {
    ellenorzott: 0,
    rendben: 0,
    visszatoltott: 0,
    potolhatatlan: 0,
    sikertelen: 0,
  }

  const result = await payload.find({
    collection: 'media',
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })

  for (const doc of result.docs) {
    summary.ellenorzott += 1

    const filename = doc.filename
    if (typeof filename !== 'string' || filename.length === 0) {
      // Fájl nélküli média-rekord (elvileg nem fordulhat elő) — nincs mit pótolni.
      summary.potolhatatlan += 1
      continue
    }

    const missing = missingMediaFiles(uploadDir, doc)
    if (missing.length === 0) {
      summary.rendben += 1
      continue
    }

    const source = sources.get(mediaBaseName(filename))
    if (source === undefined || !existsSync(source)) {
      summary.potolhatatlan += 1
      payload.logger.warn(
        `Média-helyreállítás: hiányzó fájl, de nincs hozzá forrás a repóban (${filename}) — a rekord érintetlen marad.`,
      )
      continue
    }

    try {
      await payload.update({
        collection: 'media',
        id: doc.id,
        // Az `alt` kötelező mező: a meglévő értéket visszaírjuk, hogy a
        // frissítés a szerkesztői szöveget se változtassa meg.
        data: { alt: doc.alt },
        filePath: source,
        overwriteExistingFiles: true,
        overrideAccess: true,
      })
      summary.visszatoltott += 1
      payload.logger.info(
        `Média-helyreállítás: fájl visszatöltve (${filename}, ${missing.length} hiányzó fájl, id=${doc.id}).`,
      )
    } catch (error) {
      summary.sikertelen += 1
      payload.logger.error(
        `Média-helyreállítás: a visszatöltés sikertelen (${filename}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  if (summary.visszatoltott > 0 || summary.potolhatatlan > 0 || summary.sikertelen > 0) {
    payload.logger.warn(
      `Média-helyreállítás mérlege: ${summary.ellenorzott} rekord, ${summary.rendben} rendben, ` +
        `${summary.visszatoltott} visszatöltve, ${summary.potolhatatlan} nem pótolható (nincs repó-forrás), ` +
        `${summary.sikertelen} sikertelen. Célkönyvtár: ${uploadDir}`,
    )
  } else {
    payload.logger.info(
      `Média-helyreállítás: minden képfájl a helyén (${summary.ellenorzott} rekord, célkönyvtár: ${uploadDir}).`,
    )
  }

  return summary
}
