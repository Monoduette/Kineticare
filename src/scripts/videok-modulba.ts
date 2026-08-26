/**
 * Régi products.videos lista átemelése modulba — megtartott lecke-id, haladás megmarad.
 * A videos tömböt nem üríti (visszafordíthatóság). Alapból dry-run; --alkalmaz kell íráshoz.
 *
 *   npm run kurzus:videok-modulba -- --sku=… [--cim=…] [--alkalmaz]
 */

import { pathToFileURL } from 'node:url'

import { getPayload, type Payload } from 'payload'

import { LEGACY_MODULE_TITLE } from '../lib/curriculum/curriculum'
import { logger } from '../lib/logger'
import config from '../payload.config'
import type { Product } from '../payload-types'

interface Kapcsolok {
  id: number | null
  sku: string | null
  cim: string
  alkalmaz: boolean
}

/** A `--kulcs=érték` alakú kapcsolók feldolgozása. */
export function parseKapcsolok(argv: readonly string[]): Kapcsolok {
  const ertek = (kulcs: string): string | null => {
    const talalat = argv.find((arg) => arg.startsWith(`--${kulcs}=`))
    if (talalat === undefined) {
      return null
    }
    const nyers = talalat.slice(kulcs.length + 3).trim()
    return nyers.length > 0 ? nyers : null
  }
  const nyersId = ertek('id')
  const id = nyersId !== null && /^\d+$/.test(nyersId) ? Number(nyersId) : null
  return {
    id,
    sku: ertek('sku'),
    cim: ertek('cim') ?? LEGACY_MODULE_TITLE,
    alkalmaz: argv.includes('--alkalmaz'),
  }
}

/**
 * A videó-sorokból lecke-sorok — AZONOS azonosítóval, hogy a `course-progress`
 * hivatkozások érvényben maradjanak. A `kind` mindig `video`: a régi lista
 * kizárólag videókat tartalmazhatott.
 */
export function videokLeckekke(
  videos: NonNullable<Product['videos']>,
): NonNullable<NonNullable<Product['modules']>[number]['lessons']> {
  return videos.map((video, index) => ({
    // A megtartott azonosító a script LÉNYEGE — enélkül a haladás elvész.
    id: video.id ?? undefined,
    title: video.title ?? `${index + 1}. rész`,
    kind: 'video' as const,
    streamAssetId: video.streamAssetId ?? null,
    durationSec: video.durationSec ?? null,
    status: video.status ?? 'processing',
  }))
}

async function keresdKurzust(payload: Payload, kapcsolok: Kapcsolok): Promise<Product | null> {
  if (kapcsolok.id !== null) {
    try {
      return await payload.findByID({
        collection: 'products',
        id: kapcsolok.id,
        depth: 0,
        overrideAccess: true,
      })
    } catch {
      return null
    }
  }
  if (kapcsolok.sku !== null) {
    const talalat = await payload.find({
      collection: 'products',
      where: { sku: { equals: kapcsolok.sku } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    return talalat.docs[0] ?? null
  }
  return null
}

async function futtat(): Promise<void> {
  const kapcsolok = parseKapcsolok(process.argv.slice(2))
  if (kapcsolok.id === null && kapcsolok.sku === null) {
    logger.error('Add meg a kurzust: --id=<szám> vagy --sku=<azonosító>')
    process.exitCode = 1
    return
  }

  const payload = await getPayload({ config })
  const kurzus = await keresdKurzust(payload, kapcsolok)
  if (kurzus === null) {
    logger.error('Nincs ilyen kurzus', { id: kapcsolok.id, sku: kapcsolok.sku })
    process.exitCode = 1
    return
  }

  const meglevoModulok = Array.isArray(kurzus.modules) ? kurzus.modules : []
  if (meglevoModulok.length > 0) {
    logger.error(
      'A kurzusnak MÁR VAN tananyag-modulja — a script nem ír felül szerkesztői munkát. Ha újra akarod kezdeni, előbb töröld a modulokat az adminban.',
      { productId: kurzus.id, modulokSzama: meglevoModulok.length },
    )
    process.exitCode = 1
    return
  }

  // A fenti őr a PUBLIKÁLT változatot nézi — a products-on viszont autosave-es
  // piszkozatok élnek, és a code review valós Payload+Postgres ellen
  // reprodukálta: a szerkesztő NEM PUBLIKÁLT moduljai a publikált változatból
  // nem látszanak, a script írása pedig kiütné őket. Ezért a PISZKOZATOT is
  // ellenőrizzük, és bármilyen nem publikált szerkesztésnél megállunk.
  const piszkozat = await payload
    .findByID({
      collection: 'products',
      id: kurzus.id,
      depth: 0,
      overrideAccess: true,
      draft: true,
    })
    .catch(() => null)
  const piszkozatModulok = Array.isArray(piszkozat?.modules) ? piszkozat.modules : []
  if (piszkozatModulok.length > 0) {
    logger.error(
      'A kurzus PISZKOZATÁBAN már vannak tananyag-modulok (nem publikált szerkesztés). A script nem írhatja felül: előbb publikáld vagy dobd el a piszkozatot az adminban, és futtasd újra.',
      { productId: kurzus.id, piszkozatModulokSzama: piszkozatModulok.length },
    )
    process.exitCode = 1
    return
  }
  const publikaltFrissitve = typeof kurzus.updatedAt === 'string' ? kurzus.updatedAt : null
  const piszkozatFrissitve =
    typeof piszkozat?.updatedAt === 'string' ? piszkozat.updatedAt : null
  if (
    publikaltFrissitve !== null &&
    piszkozatFrissitve !== null &&
    piszkozatFrissitve > publikaltFrissitve
  ) {
    logger.error(
      'A kurzusnak a publikáltnál FRISSEBB, nem publikált piszkozata van — a script írása elveszítené a szerkesztő mentetlen munkáját. Publikáld vagy dobd el a piszkozatot, és futtasd újra.',
      { productId: kurzus.id, publikalt: publikaltFrissitve, piszkozat: piszkozatFrissitve },
    )
    process.exitCode = 1
    return
  }

  const videos = Array.isArray(kurzus.videos) ? kurzus.videos : []
  if (videos.length === 0) {
    logger.info('A kurzusnak nincs átemelendő videója — nincs teendő.', { productId: kurzus.id })
    return
  }

  const lessons = videokLeckekke(videos)
  const azonositoNelkul = lessons.filter((lesson) => lesson.id === undefined).length

  logger.info('Terv: videók átemelése modulba', {
    productId: kurzus.id,
    sku: kurzus.sku ?? null,
    modulCime: kapcsolok.cim,
    leckekSzama: lessons.length,
    // Az azonosító nélküli sor haladása amúgy sem volt rögzíthető, de jelezzük.
    azonositoNelkuliSorok: azonositoNelkul,
  })
  for (const lesson of lessons) {
    logger.info(`  • ${lesson.title}`, { id: lesson.id ?? '(nincs azonosító)' })
  }

  if (!kapcsolok.alkalmaz) {
    logger.info(
      'SZÁRAZ FUTÁS — semmi nem íródott. Az alkalmazáshoz add hozzá a --alkalmaz kapcsolót.',
    )
    return
  }

  await payload.update({
    collection: 'products',
    id: kurzus.id,
    overrideAccess: true,
    data: {
      modules: [{ title: kapcsolok.cim, lessons }],
    },
  })
  logger.info(
    'Kész: a videók átkerültek a modulba, MEGTARTOTT azonosítóval — a meglévő haladás érvényben maradt. A régi „Videók" lista biztonsági másolatként érintetlen.',
    { productId: kurzus.id },
  )
}

// A modul mellékhatás nélkül importálható (a tiszta segédfüggvények így
// tesztelhetők); a futtatás csak közvetlen indításkor indul el.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  futtat()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error: unknown) => {
      logger.error('A videók átemelése sikertelen', {
        error: error instanceof Error ? error.message : String(error),
      })
      process.exit(1)
    })
}
