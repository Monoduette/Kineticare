import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  attachMaterial,
  COURSE_MATERIAL_SEEDS,
  COURSE_MATERIALS_SOURCE_DIR,
} from '../lib/course-materials-import'

/**
 * A kurzus-segédanyagok egyszeri betöltése (src/lib/course-materials-import.ts).
 *
 * Mit véd: a betöltő ÉLES kurzust ír. (1) A lecke-azonosítók és a meglévő
 * mezők nem változhatnak, mert a vevők haladása a lecke `id`-jéhez kötött.
 * (2) Az ismételt futás nem duplikál (a kapu bennfelejthető). (3) Ha a lecke
 * nem egyértelmű, a fájl nem vész el, hanem a kurzushoz kerül.
 */
const kurzus = () => ({
  modules: [
    {
      id: 'm1',
      title: 'Gyakorlatok',
      lessons: [
        {
          id: 'l1',
          title: 'Gyakorlatok csuklófájdalomra',
          streamAssetId: 'guid-1',
          attachments: [],
        },
        { id: 'l2', title: 'Gyakorlatok könyökfájdalomra', streamAssetId: 'guid-2' },
      ],
    },
  ],
  materials: [{ id: 's1', label: 'Régi anyag', protectedFile: 5 }],
})
const seed = { label: 'Könyökfájdalom: gyakorlatok', lesson: 'gyakorlatok konyokfajdalomra' }

describe('attachMaterial', () => {
  it('a megfelelő leckéhez csatol, a többi mező és az azonosítók érintetlenek', () => {
    const result = attachMaterial(kurzus(), seed, 71)
    expect(result).toMatchObject({
      changed: true,
      fallback: false,
      target: 'Gyakorlatok könyökfájdalomra',
    })
    expect(result.modules).toEqual([
      {
        id: 'm1',
        title: 'Gyakorlatok',
        lessons: [
          {
            id: 'l1',
            title: 'Gyakorlatok csuklófájdalomra',
            streamAssetId: 'guid-1',
            attachments: [],
          },
          {
            id: 'l2',
            title: 'Gyakorlatok könyökfájdalomra',
            streamAssetId: 'guid-2',
            attachments: [{ label: 'Könyökfájdalom: gyakorlatok', protectedFile: 71 }],
          },
        ],
      },
    ])
    expect(result.materials).toEqual(kurzus().materials)
  })

  it('az ismételt futás nem duplikál, populált relációval sem', () => {
    const first = attachMaterial(kurzus(), seed, 71)
    expect(attachMaterial(first, seed, 71).changed).toBe(false)
    const populated = kurzus()
    populated.materials.push({ id: 's2', label: 'x', protectedFile: { id: 9 } as never })
    expect(attachMaterial(populated, { label: 'x', lesson: null }, 9).changed).toBe(false)
  })

  it.each([
    ['nincs ilyen lecke', 'gyakorlatok vallfajdalomra'],
    ['több lecke is illik', 'gyakorlatok'],
  ])('%s: a fájl a kurzushoz kerül, és ezt jelzi', (_nev, lesson) => {
    const result = attachMaterial(kurzus(), { label: 'Füzet', lesson }, 71)
    expect(result).toMatchObject({ changed: true, fallback: true, target: null })
    expect(result.modules).toEqual(kurzus().modules)
    expect(result.materials.at(-1)).toEqual({ label: 'Füzet', protectedFile: 71 })
  })
})

describe('a betöltendő fájlok', () => {
  it.each(COURSE_MATERIAL_SEEDS.map((entry) => [entry.file] as const))(
    '%s megvan a repóban, és belefér a 10 MB-os feltöltési korlátba',
    (file) => {
      const full = path.resolve(COURSE_MATERIALS_SOURCE_DIR, file)
      expect(existsSync(full)).toBe(true)
      expect(statSync(full).size).toBeLessThan(10_485_760)
    },
  )
})
