/**
 * Hiányzó médiafájlok visszatöltése repó-forrásból induláskor (Volume + dedup landmine).
 * Rekord-id megmarad; overwriteExistingFiles. Saját admin-feltöltés pótolhatatlan.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import type { Payload } from 'payload'

import teamManifest from '../../public/media/team/manifest.json'
import { HOME_IMAGES, LANDING_ASSETS_DIR } from './home-seed'
import { LEGACY_IMAGES, LEGACY_IMAGES_DIR } from './legacy-images'
import type { Media } from '../payload-types'
import {
  beginMediaRecovery,
  enrollMediaRecovery,
  assertFreshMediaRecovery,
  requireMediaRecoveryReceipt,
  verifyMediaRecoveryBytes,
  mediaRecoverySnapshot,
} from './media-recovery-provenance'

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
 * Három forráskészlet: a kezdőlapi seed képei (`content/home-images`,
 * LANDING_ASSETS_DIR), a legacy archívum és a kanonikus team manifest képei.
 * Névütközésnél az ELSŐ
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
  const teamDir = path.resolve('public/media/team')
  for (const image of teamManifest.assets) {
    // Ugyanaz a biztonságos WebP-alapnév, amelyet az owner CLI feltölt.
    // Csak a manifest fájlmezője számít, nem az eredeti forrásnév vagy a szerep.
    if (!/^[a-z0-9-]+\.webp$/.test(image.file)) {
      throw new Error(
        'A team média manifest fájlneve nem biztonságos; használj kisbetűs WebP alapnevet.',
      )
    }
    if (!/^[a-f0-9]{64}$/.test(image.sha256)) {
      throw new Error(
        'A team média manifest SHA-256 értéke hibás; adj meg 64 karakteres kisbetűs hex értéket.',
      )
    }
    const key = mediaBaseName(image.file)
    if (!index.has(key)) index.set(key, path.join(teamDir, image.file))
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
  if (
    names.some(
      (name) =>
        name === '.' ||
        name === '..' ||
        name.includes('\0') ||
        path.basename(name) !== name ||
        path.win32.basename(name) !== name,
    )
  ) {
    throw new Error(
      'A médiafájlnév kilépne a feltöltési könyvtárból; használj könyvtárnév nélküli fájlnevet.',
    )
  }
  return names.filter((name) => !existsSync(path.join(uploadDir, name)))
}

const mediaRestoreSnapshot = mediaRecoverySnapshot

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

    try {
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

      const teamAsset = teamManifest.assets.find(
        (asset) => source === path.resolve('public/media/team', asset.file),
      )
      if (teamAsset) {
        // Ezek már WebP-források: a CLI/Payload normál fájlneve pontosan a manifest neve.
        if (filename !== teamAsset.file) {
          summary.potolhatatlan += 1
          payload.logger.warn(
            `Média-helyreállítás: nem kanonikus team fájlnév (${filename}); érintetlen marad.`,
          )
          continue
        }
        const sourceBytes = readFileSync(source)
        const hash = createHash('sha256').update(sourceBytes).digest('hex')
        if (hash !== teamAsset.sha256) {
          throw new Error('A committed team média-forrás SHA-256 ellenőrzőösszege eltér.')
        }
        const receipt = await requireMediaRecoveryReceipt(payload, doc, teamAsset)
        if (!missing.includes(filename)) {
          if ((await verifyMediaRecoveryBytes(payload, doc)) !== receipt.storedPublicDigest) {
            throw new Error(
              'A megmaradt médiafájl eltér az igazolástól; kézi ellenőrzés szükséges.',
            )
          }
        }
      }

      // Ez szűkíti, de nem szünteti meg a findByID és update közötti versenyablakot.
      const latest = await payload.findByID({
        collection: 'media',
        id: doc.id,
        depth: 0,
        overrideAccess: true,
      })
      if (!isDeepStrictEqual(mediaRestoreSnapshot(latest), mediaRestoreSnapshot(doc))) {
        summary.sikertelen += 1
        payload.logger.warn(
          `Média-helyreállítás: a rekord közben változott (${filename}, id=${doc.id}); kihagytuk, kézi ellenőrzés szükséges.`,
        )
        continue
      }

      if (teamAsset) {
        await beginMediaRecovery(payload, doc)
        await assertFreshMediaRecovery(payload, doc)
      }
      const restored = await payload.update({
        collection: 'media',
        id: doc.id,
        // Az `alt` kötelező mező: a meglévő értéket visszaírjuk, hogy a
        // frissítés a szerkesztői szöveget se változtassa meg.
        data: { alt: doc.alt },
        // A data változatlan focalX/Y mezői nem indítják el a Payload cropját.
        ...(typeof doc.focalX === 'number' && typeof doc.focalY === 'number'
          ? { req: { query: { uploadEdits: { focalPoint: { x: doc.focalX, y: doc.focalY } } } } }
          : {}),
        filePath: source,
        overwriteExistingFiles: true,
        overrideAccess: true,
      })
      if (teamAsset) {
        if (
          restored.id !== doc.id ||
          restored.filename !== doc.filename ||
          restored.alt !== doc.alt ||
          restored.focalX !== doc.focalX ||
          restored.focalY !== doc.focalY
        ) {
          throw new Error('A helyreállított média adatai eltérnek; kézi ellenőrzés szükséges.')
        }
        await enrollMediaRecovery(payload, restored)
      }
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
