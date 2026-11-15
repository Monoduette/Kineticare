import { existsSync } from 'node:fs'
import path from 'node:path'

import type { Payload } from 'payload'

import { OTTHONI_COURSE_SKU } from './curriculum/bunny-keszlet'
import { logger } from './logger'
import { SOS_COURSE_SKU } from './menu-seed'

/**
 * A két kurzus segédanyagainak (PDF) egyszeri betöltése a védett kurzusfájlok
 * közé, a megfelelő leckéhez vagy a kurzushoz csatolva.
 *
 * Tulajdonosi kérés (2026-11-15): „mindet rakd a megfelelő helyre”, úgy, mint
 * a régi oldalon, ahol a füzet az adott videó alatt nyílt meg.
 *
 * MIÉRT AZ APP INDULÁSAKOR FUT, nem job-szolgáltatásként: a védett fájl a
 * `PAYLOAD_MEDIA_DIR` kötetre íródik, és azt csak a `Kineticare` appservice
 * látja (docs/deploy-railway.md 7. pont). A lépés a kapu nélkül SEMMIT nem
 * csinál, így a jobok és a helyi futások nem érintettek.
 *
 * Kapu: `OWNER_COURSE_MATERIALS_CONFIRM`
 *  - nincs beállítva: a lépés kimarad;
 *  - `proba`: csak naplózza, mit tenne („TENNÉ” sorok);
 *  - `igen`: ír. Idempotens: a már betöltött fájlt (`transferKey`) és a már
 *    meglévő csatolást kihagyja, tehát a kapu bennfelejtése sem duplikál.
 *
 * Amihez NEM nyúl: közzé nem tett piszkozattal rendelkező kurzus (a piszkozat
 * elveszne vagy idő előtt élesedne). Ha egy leckét nem talál, a fájlt a
 * kurzushoz csatolja, és ezt hangosan naplózza: a vevő így is eléri.
 */

export const COURSE_MATERIALS_GATE_ENV = 'OWNER_COURSE_MATERIALS_CONFIRM'
export const COURSE_MATERIALS_SOURCE_DIR = 'content/kurzus-segedanyagok'

export interface CourseMaterialSeed {
  /** A forrásfájl neve a repóban; egyben a letöltött fájl neve. */
  file: string
  /** A vevőnek látszó megnevezés. */
  label: string
  sku: string
  /**
   * A lecke címének ékezet nélküli, kisbetűs részlete. `null`: a fájl az
   * egész kurzushoz tartozik (products.materials).
   */
  lesson: string | null
}

export const COURSE_MATERIAL_SEEDS: readonly CourseMaterialSeed[] = [
  {
    file: 'csuklofajdalom-gyakorlatok.pdf',
    label: 'Csuklófájdalom: gyakorlatok',
    sku: OTTHONI_COURSE_SKU,
    lesson: 'gyakorlatok csuklofajdalomra',
  },
  {
    file: 'huvelykujj-gyakorlatok.pdf',
    label: 'Hüvelykujjfájdalom: gyakorlatok',
    sku: OTTHONI_COURSE_SKU,
    lesson: 'gyakorlatok huvelykujjfajdalomra',
  },
  {
    file: 'konyokfajdalom-gyakorlatok.pdf',
    label: 'Könyökfájdalom: gyakorlatok',
    sku: OTTHONI_COURSE_SKU,
    lesson: 'gyakorlatok konyokfajdalomra',
  },
  {
    file: 'pattano-ujj-gyakorlatok.pdf',
    label: 'Pattanó ujj: gyakorlatok',
    sku: OTTHONI_COURSE_SKU,
    lesson: 'gyakorlatok pattano ujjakra',
  },
  {
    file: 'ujjak-zsibbadasa-gyakorlatok.pdf',
    label: 'Ujjak zsibbadása: gyakorlatok',
    sku: OTTHONI_COURSE_SKU,
    lesson: 'gyakorlatok zsibbado ujjakra',
  },
  {
    file: 'egyszeru-mobilizacio-gyakorlatok.pdf',
    label: 'Egyszerű mobilizáció: gyakorlatok',
    sku: OTTHONI_COURSE_SKU,
    lesson: 'egyszeru mobilizalo gyakorlatok',
  },
  {
    file: 'kinesiotape.pdf',
    label: 'Kinesiotape: kiegészítő anyag',
    sku: OTTHONI_COURSE_SKU,
    lesson: 'kinesiotape',
  },
  {
    file: 'eszkozlista.pdf',
    label: 'Eszközlista a gyakorlatokhoz',
    sku: OTTHONI_COURSE_SKU,
    lesson: 'milyen eszkozoket hasznalj',
  },
  {
    file: 'szakemberajanlo.pdf',
    label: 'Szakemberajánló',
    sku: OTTHONI_COURSE_SKU,
    lesson: 'mikor fordulj orvoshoz',
  },
  {
    file: 'kezapolas-mesterfokon.pdf',
    label: 'Kézápolás mesterfokon',
    sku: OTTHONI_COURSE_SKU,
    lesson: null,
  },
  {
    file: 'tanyeron-a-regeneracio-tippek.pdf',
    label: 'Tányéron a regeneráció: tippek a gyógyszerésztől',
    sku: OTTHONI_COURSE_SKU,
    lesson: null,
  },
  {
    file: 'felhasznalt-szakirodalom.pdf',
    label: 'Felhasznált szakirodalom',
    sku: OTTHONI_COURSE_SKU,
    lesson: null,
  },
  {
    file: 'sos-kezrelax-gyakorlatok.pdf',
    label: 'SOS Kézrelax: gyakorlatok',
    sku: SOS_COURSE_SKU,
    lesson: null,
  },
]

/** Ékezet nélküli, kisbetűs, egy szóközre tömörített alak a cím-egyeztetéshez. */
export function normalizeLessonTitle(value: unknown): string {
  return typeof value === 'string'
    ? value
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
    : ''
}

type Row = Record<string, unknown>

const rows = (value: unknown): Row[] =>
  Array.isArray(value)
    ? value.filter((row): row is Row => typeof row === 'object' && row !== null)
    : []

function relationId(value: unknown): number | null {
  const id = typeof value === 'object' && value !== null && 'id' in value ? value.id : value
  return typeof id === 'number' ? id : null
}

export interface AttachResult {
  modules: Row[]
  materials: Row[]
  /** Hová került: a lecke címe, vagy `null`, ha a kurzushoz. */
  target: string | null
  /** A keresett lecke nem volt egyértelmű, ezért a fájl a kurzushoz került. */
  fallback: boolean
  changed: boolean
}

/**
 * Egy fájl csatolása a kurzus adataihoz. TISZTA függvény: új tömböket ad
 * vissza, a lecke-azonosítókat és minden más mezőt érintetlenül hagy (a vevők
 * haladása a lecke `id`-jéhez kötött).
 */
export function attachMaterial(
  product: { modules?: unknown; materials?: unknown },
  seed: Pick<CourseMaterialSeed, 'label' | 'lesson'>,
  fileId: number,
): AttachResult {
  const modules = rows(product.modules)
  const materials = rows(product.materials)
  const hasFile = (list: unknown) =>
    rows(list).some((row) => relationId(row.protectedFile) === fileId)

  if (seed.lesson !== null) {
    const hits: Array<[number, number]> = []
    modules.forEach((modul, m) =>
      rows(modul.lessons).forEach((lesson, l) => {
        if (normalizeLessonTitle(lesson.title).includes(seed.lesson as string)) hits.push([m, l])
      }),
    )
    if (hits.length === 1) {
      const [m, l] = hits[0] as [number, number]
      const lesson = rows(modules[m]?.lessons)[l] as Row
      const title = typeof lesson.title === 'string' ? lesson.title : ''
      if (hasFile(lesson.attachments)) {
        return { modules, materials, target: title, fallback: false, changed: false }
      }
      const next = modules.map((modul, mi) =>
        mi !== m
          ? modul
          : {
              ...modul,
              lessons: rows(modul.lessons).map((row, li) =>
                li !== l
                  ? row
                  : {
                      ...row,
                      attachments: [
                        ...rows(row.attachments),
                        { label: seed.label, protectedFile: fileId },
                      ],
                    },
              ),
            },
      )
      return { modules: next, materials, target: title, fallback: false, changed: true }
    }
  }

  const fallback = seed.lesson !== null
  if (hasFile(materials)) {
    return { modules, materials, target: null, fallback, changed: false }
  }
  return {
    modules,
    materials: [...materials, { label: seed.label, protectedFile: fileId }],
    target: null,
    fallback,
    changed: true,
  }
}

async function findOrCreateFile(
  payload: Payload,
  seed: CourseMaterialSeed,
  courseId: number,
  filePath: string,
): Promise<number> {
  const transferKey = `kurzus-segedanyag:${seed.file}`
  const lookup = async () =>
    (
      await payload.find({
        collection: 'course-files',
        where: { transferKey: { equals: transferKey } },
        depth: 0,
        limit: 1,
        overrideAccess: true,
      })
    ).docs[0]
  const existing = await lookup()
  if (existing) return existing.id
  try {
    const created = await payload.create({
      collection: 'course-files',
      data: { alt: seed.label, course: courseId, transferKey },
      filePath,
      overrideAccess: true,
    })
    return created.id
  } catch (error) {
    // Párhuzamos indulás: a `transferKey` egyedi, a másik példány nyert.
    const raced = await lookup()
    if (raced) return raced.id
    throw error
  }
}

export async function importCourseMaterials(
  payload: Payload,
  options: { gate?: string; sourceDir?: string } = {},
): Promise<void> {
  const gate = options.gate ?? process.env[COURSE_MATERIALS_GATE_ENV]
  if (gate !== 'igen' && gate !== 'proba') return
  const write = gate === 'igen'
  const sourceDir = options.sourceDir ?? path.resolve(COURSE_MATERIALS_SOURCE_DIR)
  const log = (msg: string, context: Record<string, unknown>) =>
    logger.info(`kurzus-segédanyag: ${msg}`, { mod: write ? 'iras' : 'proba', ...context })

  const bySku = new Map<string, CourseMaterialSeed[]>()
  for (const seed of COURSE_MATERIAL_SEEDS) {
    bySku.set(seed.sku, [...(bySku.get(seed.sku) ?? []), seed])
  }

  for (const [sku, seeds] of bySku) {
    try {
      const found = await payload.find({
        collection: 'products',
        where: { sku: { equals: sku } },
        depth: 0,
        limit: 2,
        draft: true,
        overrideAccess: true,
      })
      const product = found.docs[0]
      if (found.docs.length !== 1 || !product) {
        logger.warn('kurzus-segédanyag: a kurzus nem azonosítható, kimarad', {
          sku,
          talalat: found.docs.length,
        })
        continue
      }
      if (product._status !== 'published') {
        logger.warn(
          'kurzus-segédanyag: a kurzusnak közzé nem tett piszkozata van, kimarad. Tedd közzé vagy vesd el a piszkozatot, és indítsd újra.',
          { sku },
        )
        continue
      }

      let state: { modules?: unknown; materials?: unknown } = {
        modules: product.modules,
        materials: product.materials,
      }
      let changed = false
      for (const seed of seeds) {
        const filePath = path.join(sourceDir, seed.file)
        if (!existsSync(filePath)) {
          logger.warn('kurzus-segédanyag: a forrásfájl hiányzik, kimarad', { fajl: seed.file })
          continue
        }
        if (!write) {
          const plan = attachMaterial(state, seed, -1)
          log('TENNÉ: feltöltés és csatolás', {
            fajl: seed.file,
            hova: plan.target ?? 'a kurzushoz',
            leckeNemTalalhato: plan.fallback,
          })
          continue
        }
        const fileId = await findOrCreateFile(payload, seed, product.id, filePath)
        const result = attachMaterial(state, seed, fileId)
        state = { modules: result.modules, materials: result.materials }
        changed ||= result.changed
        log(result.changed ? 'csatolva' : 'MÁR csatolva, kihagyva', {
          fajl: seed.file,
          hova: result.target ?? 'a kurzushoz',
          leckeNemTalalhato: result.fallback,
        })
      }
      if (write && changed) {
        await payload.update({
          collection: 'products',
          id: product.id,
          data: {
            modules: state.modules,
            materials: state.materials,
            _status: 'published',
          } as never,
          depth: 0,
          overrideAccess: true,
        })
        log('a kurzus mentve és közzétéve', { sku })
      }
    } catch (error) {
      // Best-effort, mint minden induláskori lépés: a hiba nem állíthatja meg az appot.
      logger.error('kurzus-segédanyag: a betöltés hibába futott, a kurzus kimarad', {
        sku,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
