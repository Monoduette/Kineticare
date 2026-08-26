import { describe, expect, it } from 'vitest'

import {
  LEGACY_MODULE_TITLE,
  buildCurriculum,
  findLessonByRef,
  playableLessons,
  type Curriculum,
} from '../lib/curriculum/curriculum'
import { NO_LESSONS_LABEL, summarizeCurriculum } from '../lib/curriculum/progress'
import type { Product } from '../payload-types'

/**
 * A tananyag-modell (modulok → leckék) és a haladás-számítás tesztjei.
 *
 * A fókusz azokon a szabályokon van, amelyek élesben számítanak:
 *  - a régi, lapos `videos` lista és az új `modules` szerkezet EGYIDEJŰ
 *    létezésekor melyik nyer (és hogy sosem keverednek),
 *  - a Bunny-GUID (`streamAssetId`) NEM szivároghat ki hozzáférés nélkül (S2/b),
 *  - a lejátszhatóság szabálya a videóknál VÁLTOZATLAN marad,
 *  - az orphan (törölt leckére mutató) haladás-sor nem torzíthatja a százalékot.
 */

type ProductLike = Pick<Product, 'modules' | 'videos'>

/** Minimális termék-váz — a teszt csak a tananyag-mezőket tölti. */
function product(input: Partial<ProductLike>): ProductLike {
  return { modules: input.modules ?? null, videos: input.videos ?? null }
}

function videoRow(input: {
  id?: string
  title?: string
  streamAssetId?: string
  durationSec?: number
  status?: 'processing' | 'ready' | 'error'
}): NonNullable<Product['videos']>[number] {
  return {
    id: input.id ?? null,
    title: input.title ?? null,
    streamAssetId: input.streamAssetId ?? null,
    durationSec: input.durationSec ?? null,
    status: input.status ?? null,
  }
}

type ModuleRow = NonNullable<Product['modules']>[number]
type LessonRow = NonNullable<ModuleRow['lessons']>[number]

function lessonRow(input: Partial<LessonRow> & { id: string; title: string }): LessonRow {
  return {
    kind: 'video',
    status: 'ready',
    streamAssetId: 'guid-' + input.id,
    ...input,
  } as LessonRow
}

/** Teljes alakú Lexical gyökér — a generált típus minden kulcsát kitölti. */
function lexicalRoot(children: { [k: string]: unknown; type: string; version: number }[]): NonNullable<LessonRow['content']> {
  return {
    root: {
      type: 'root',
      children: [{ type: 'paragraph', version: 1, children }],
      direction: 'ltr',
      format: '',
      indent: 0,
      version: 1,
    },
  }
}

function moduleRow(input: { id: string; title: string; lessons: LessonRow[]; summary?: string }): ModuleRow {
  return {
    id: input.id,
    title: input.title,
    summary: input.summary ?? null,
    lessons: input.lessons,
  } as ModuleRow
}

const KETMODULOS = product({
  modules: [
    moduleRow({
      id: 'm1',
      title: '1. ALAPOK',
      summary: 'Így kezdj neki',
      lessons: [
        lessonRow({ id: 'l1', title: 'Fontos tudnivalók', durationSec: 213 }),
        lessonRow({ id: 'l2', title: 'Ismerd meg a kezed' }),
      ],
    }),
    moduleRow({
      id: 'm2',
      title: '2. MIÉRT FÁJ?',
      lessons: [
        lessonRow({ id: 'l3', title: 'Mikor fordulj orvoshoz' }),
        lessonRow({ id: 'l4', title: 'Feldolgozás alatt', status: 'processing' }),
        lessonRow({ id: 'l5', title: 'Facebook csoport', kind: 'link', url: 'https://example.test/cs' }),
      ],
    }),
  ],
})

describe('buildCurriculum — szerkezet', () => {
  it('a modulokból építi a tananyagot, folytonos lapos sorszámozással', () => {
    const curriculum = buildCurriculum(KETMODULOS, true)

    expect(curriculum.legacy).toBe(false)
    expect(curriculum.modules.map((m) => m.title)).toEqual(['1. ALAPOK', '2. MIÉRT FÁJ?'])
    expect(curriculum.modules[0]?.summary).toBe('Így kezdj neki')
    expect(curriculum.lessons.map((l) => l.ref)).toEqual(['l1', 'l2', 'l3', 'l4', 'l5'])
    expect(curriculum.lessons.map((l) => l.flatIndex)).toEqual([0, 1, 2, 3, 4])
    expect(curriculum.lessons.map((l) => l.moduleIndex)).toEqual([0, 0, 1, 1, 1])
    expect(curriculum.lessons.map((l) => l.indexInModule)).toEqual([0, 1, 0, 1, 2])
  })

  it('modul hiányában a régi videólistából EGY implicit modult képez', () => {
    const curriculum = buildCurriculum(
      product({
        videos: [
          videoRow({ id: 'v1', title: 'Első rész', streamAssetId: 'g1', status: 'ready' }),
          videoRow({ id: 'v2', title: 'Második rész', streamAssetId: 'g2', status: 'ready' }),
        ],
      }),
      true,
    )

    expect(curriculum.legacy).toBe(true)
    expect(curriculum.modules).toHaveLength(1)
    expect(curriculum.modules[0]?.title).toBe(LEGACY_MODULE_TITLE)
    expect(curriculum.lessons.map((l) => l.title)).toEqual(['Első rész', 'Második rész'])
    expect(curriculum.lessons.every((l) => l.kind === 'video')).toBe(true)
  })

  it('ha VAN modul, a régi videólista teljesen figyelmen kívül marad (nincs duplázás)', () => {
    const curriculum = buildCurriculum(
      product({
        modules: [moduleRow({ id: 'm1', title: 'Modul', lessons: [lessonRow({ id: 'l1', title: 'Lecke' })] })],
        videos: [videoRow({ id: 'v1', title: 'Régi videó', streamAssetId: 'g1', status: 'ready' })],
      }),
      true,
    )

    expect(curriculum.lessons.map((l) => l.ref)).toEqual(['l1'])
    expect(curriculum.legacy).toBe(false)
  })

  /**
   * REGRESSZIÓ-ŐR. A modul-ág feltétele NEM „van modul-sor", hanem „lett
   * legalább egy lecke". Enélkül egy félkész (leckék nélkül mentett) modul
   * kiütötte volna a régi videólistát, és a kurzus MINDEN vevőnél üres
   * tananyaggal, hibaüzenet nélkül vált volna elérhetetlenné.
   */
  describe('félkész modul nem üti ki a régi videólistát', () => {
    const LECKE_NELKULI_MODUL = product({
      modules: [{ id: 'm1', title: '1. ALAPOK', summary: null, lessons: [] } as ModuleRow],
      videos: [
        videoRow({ id: 'v1', title: 'Régi 1', streamAssetId: 'g1', status: 'ready' }),
        videoRow({ id: 'v2', title: 'Régi 2', streamAssetId: 'g2', status: 'ready' }),
      ],
    })

    it('üres modul + régi videók → a RÉGI lista a tananyag', () => {
      const curriculum = buildCurriculum(LECKE_NELKULI_MODUL, true)

      expect(curriculum.legacy).toBe(true)
      expect(curriculum.lessons.map((l) => l.ref)).toEqual(['v1', 'v2'])
      expect(curriculum.modules[0]?.title).toBe(LEGACY_MODULE_TITLE)
    })

    it('a visszaesés után a lapos sorszámozás 0-ról indul', () => {
      const curriculum = buildCurriculum(LECKE_NELKULI_MODUL, true)
      expect(curriculum.lessons.map((l) => l.flatIndex)).toEqual([0, 1])
    })

    it('a haladás nevezője a régi videókból jön (nem 0)', () => {
      expect(summarizeCurriculum(buildCurriculum(LECKE_NELKULI_MODUL, true), []).total).toBe(2)
    })

    it('csak az EGYIK modul üres → a modulok maradnak (nincs visszaesés)', () => {
      const curriculum = buildCurriculum(
        product({
          modules: [
            { id: 'm1', title: 'Üres modul', summary: null, lessons: [] } as ModuleRow,
            moduleRow({ id: 'm2', title: 'Teli modul', lessons: [lessonRow({ id: 'l1', title: 'Lecke' })] }),
          ],
          videos: [videoRow({ id: 'v1', streamAssetId: 'g1', status: 'ready' })],
        }),
        true,
      )

      expect(curriculum.legacy).toBe(false)
      expect(curriculum.lessons.map((l) => l.ref)).toEqual(['l1'])
    })

    it('üres modul ÉS nincs régi videó → a modul-váz megmarad, tananyag nélkül', () => {
      const curriculum = buildCurriculum(
        product({ modules: [{ id: 'm1', title: 'Üres', summary: null, lessons: [] } as ModuleRow] }),
        true,
      )

      expect(curriculum.legacy).toBe(false)
      expect(curriculum.lessons).toEqual([])
      expect(curriculum.modules.map((m) => m.title)).toEqual(['Üres'])
    })
  })

  it('üres tananyag: nincs modul és nincs lecke', () => {
    const curriculum = buildCurriculum(product({}), true)
    expect(curriculum.modules).toEqual([])
    expect(curriculum.lessons).toEqual([])
  })

  it('azonosító nélküli sor kimarad (a haladása nem lenne rögzíthető)', () => {
    const curriculum = buildCurriculum(
      product({
        modules: [
          moduleRow({
            id: 'm1',
            title: 'Modul',
            lessons: [
              { kind: 'szoveg', title: 'Nincs azonosítója' } as LessonRow,
              lessonRow({ id: 'l2', title: 'Van azonosítója' }),
            ],
          }),
        ],
      }),
      true,
    )

    expect(curriculum.lessons.map((l) => l.ref)).toEqual(['l2'])
    // A lapos sorszám a MEGMARADT leckékre folytonos.
    expect(curriculum.lessons[0]?.flatIndex).toBe(0)
  })

  it('sor-id hiányában a streamAssetId lesz a ref (a régi konvenció)', () => {
    const curriculum = buildCurriculum(
      product({ videos: [videoRow({ streamAssetId: 'csak-guid', status: 'ready' })] }),
      true,
    )
    expect(curriculum.lessons[0]?.ref).toBe('csak-guid')
  })
})

describe('buildCurriculum — lejátszhatóság', () => {
  it('videó csak kész állapotban és GUID-dal indítható', () => {
    const curriculum = buildCurriculum(KETMODULOS, true)
    const byRef = Object.fromEntries(curriculum.lessons.map((l) => [l.ref, l.playable]))

    expect(byRef.l1).toBe(true)
    expect(byRef.l4).toBe(false) // processing
  })

  it('GUID nélküli videó nem indítható akkor sem, ha „kész”', () => {
    const curriculum = buildCurriculum(
      product({ videos: [videoRow({ id: 'v1', status: 'ready' })] }),
      true,
    )
    expect(curriculum.lessons[0]?.playable).toBe(false)
  })

  it('a szöveges lecke és a link MINDIG indítható (nincs feldolgozási állapotuk)', () => {
    const curriculum = buildCurriculum(
      product({
        modules: [
          moduleRow({
            id: 'm1',
            title: 'Modul',
            lessons: [
              lessonRow({ id: 'l1', title: 'Szöveges', kind: 'szoveg', streamAssetId: null, status: null }),
              lessonRow({ id: 'l2', title: 'Link', kind: 'link', url: 'https://example.test', streamAssetId: null, status: null }),
            ],
          }),
        ],
      }),
      true,
    )
    expect(curriculum.lessons.map((l) => l.playable)).toEqual([true, true])
  })

  it('ismeretlen lecketípus a SZIGORÚBB videó-ágba sorolódik', () => {
    const curriculum = buildCurriculum(
      product({
        modules: [
          moduleRow({
            id: 'm1',
            title: 'Modul',
            lessons: [
              { id: 'l1', title: 'Ismeretlen', kind: 'valami-mas', status: 'processing' } as unknown as LessonRow,
            ],
          }),
        ],
      }),
      true,
    )
    expect(curriculum.lessons[0]?.kind).toBe('video')
    expect(curriculum.lessons[0]?.playable).toBe(false)
  })

  it('playableLessons csak az indítható leckéket adja vissza', () => {
    expect(playableLessons(buildCurriculum(KETMODULOS, true)).map((l) => l.ref)).toEqual([
      'l1',
      'l2',
      'l3',
      'l5',
    ])
  })
})

describe('buildCurriculum — a Bunny-GUID védelme (S2/b)', () => {
  it('hozzáférés nélkül a streamAssetId EGYETLEN leckében sem szerepel', () => {
    const curriculum = buildCurriculum(KETMODULOS, false)
    expect(curriculum.lessons.every((l) => l.streamAssetId === null)).toBe(true)
  })

  it('hozzáférés nélkül is megmarad a szerkezet, a cím és a LEJÁTSZHATÓSÁG', () => {
    const zart = buildCurriculum(KETMODULOS, false)
    const nyitott = buildCurriculum(KETMODULOS, true)

    expect(zart.lessons.map((l) => l.title)).toEqual(nyitott.lessons.map((l) => l.title))
    expect(zart.lessons.map((l) => l.playable)).toEqual(nyitott.lessons.map((l) => l.playable))
  })

  it('a régi videólistán is érvényes a szabály', () => {
    const curriculum = buildCurriculum(
      product({ videos: [videoRow({ id: 'v1', streamAssetId: 'titok', status: 'ready' })] }),
      false,
    )
    expect(curriculum.lessons[0]?.streamAssetId).toBeNull()
    expect(curriculum.lessons[0]?.playable).toBe(true)
  })

  it('nem videó típusú lecke sosem kap streamAssetId-t, élő hozzáféréssel sem', () => {
    const curriculum = buildCurriculum(
      product({
        modules: [
          moduleRow({
            id: 'm1',
            title: 'Modul',
            lessons: [lessonRow({ id: 'l1', title: 'Szöveges', kind: 'szoveg', streamAssetId: 'elgepelt' })],
          }),
        ],
      }),
      true,
    )
    expect(curriculum.lessons[0]?.streamAssetId).toBeNull()
  })
})

describe('buildCurriculum — mellékletek és szöveg', () => {
  it('a populált média-relációból URL és felirat lesz; a felirat hiányában a fájlnév', () => {
    const curriculum = buildCurriculum(
      product({
        modules: [
          moduleRow({
            id: 'm1',
            title: 'Modul',
            lessons: [
              lessonRow({
                id: 'l1',
                title: 'Lecke',
                attachments: [
                  { id: 'a1', label: 'Gyakorlatlap', file: { id: 1, url: '/media/gyak.pdf', filename: 'gyak.pdf' } },
                  { id: 'a2', label: null, file: { id: 2, url: '/media/terv.pdf', filename: 'terv.pdf' } },
                ],
              } as Partial<LessonRow> & { id: string; title: string }),
            ],
          }),
        ],
      }),
      true,
    )

    expect(curriculum.lessons[0]?.attachments).toEqual([
      { label: 'Gyakorlatlap', url: '/media/gyak.pdf' },
      { label: 'terv.pdf', url: '/media/terv.pdf' },
    ])
  })

  /**
   * A lejátszó (LessonBody.tsx) kifejezetten kezeli a fájl nélküli mellékletet:
   * „a fájl feltöltése folyamatban" jelzést ír ki rá, azzal az indoklással, hogy
   * „a néma eltüntetés a szerkesztőnek is elrejtené a hibát". A modell viszont
   * korábban PONT ezt tette: a fájl nélküli sort eldobta, tehát a lejátszó ága
   * elérhetetlen volt, és a komment az ellenkezőjét írta le a valóságnak.
   *
   * Az állapot ÉLESBEN előállítható: a melléklet idegen kulcsa
   * `ON DELETE SET NULL`, tehát egy médiafájl törlése a Médiatárból pontosan
   * ilyen, fájl nélküli melléklet-sort hagy maga után.
   */
  it('a FÁJL NÉLKÜLI melléklet MEGMARAD (a törölt médiafájl ne tűnjön el némán)', () => {
    const curriculum = buildCurriculum(
      product({
        modules: [
          moduleRow({
            id: 'm1',
            title: 'Modul',
            lessons: [
              lessonRow({
                id: 'l1',
                title: 'Lecke',
                attachments: [
                  // Nyers azonosító (depth: 0), illetve TÖRÖLT médiafájl (null).
                  { id: 'a1', label: 'Segédlet', file: 7 },
                  { id: 'a2', label: 'Gyakorlatlap', file: null },
                ],
              } as Partial<LessonRow> & { id: string; title: string }),
            ],
          }),
        ],
      }),
      true,
    )
    expect(curriculum.lessons[0]?.attachments).toEqual([
      { label: 'Segédlet', url: null },
      { label: 'Gyakorlatlap', url: null },
    ])
  })

  it('a NÉV NÉLKÜLI, fájl nélküli melléklet kimarad — nincs mit mutatni', () => {
    const curriculum = buildCurriculum(
      product({
        modules: [
          moduleRow({
            id: 'm1',
            title: 'Modul',
            lessons: [
              lessonRow({
                id: 'l1',
                title: 'Lecke',
                attachments: [
                  { id: 'a1', label: null, file: null },
                  { id: 'a2', label: '   ', file: 7 },
                ],
              } as Partial<LessonRow> & { id: string; title: string }),
            ],
          }),
        ],
      }),
      true,
    )
    expect(curriculum.lessons[0]?.attachments).toEqual([])
  })

  it('az üres szerkesztő tartalma nem kerül a modellbe', () => {
    const ures = lexicalRoot([])
    const teli = lexicalRoot([{ text: 'Szia', type: 'text', version: 1 }])
    const curriculum = buildCurriculum(
      product({
        modules: [
          moduleRow({
            id: 'm1',
            title: 'Modul',
            lessons: [
              lessonRow({ id: 'l1', title: 'Üres', content: ures }),
              lessonRow({ id: 'l2', title: 'Teli', content: teli }),
            ],
          }),
        ],
      }),
      true,
    )

    expect(curriculum.lessons[0]?.content).toBeNull()
    expect(curriculum.lessons[1]?.content).toEqual(teli)
  })
})

describe('findLessonByRef', () => {
  const curriculum = buildCurriculum(KETMODULOS, true)

  it('megtalálja a leckét a stabil azonosítója alapján', () => {
    expect(findLessonByRef(curriculum, 'l3')?.title).toBe('Mikor fordulj orvoshoz')
  })

  it('ismeretlen és üres ref esetén null', () => {
    expect(findLessonByRef(curriculum, 'nincs-ilyen')).toBeNull()
    expect(findLessonByRef(curriculum, '   ')).toBeNull()
  })
})

describe('summarizeCurriculum', () => {
  const curriculum: Curriculum = buildCurriculum(KETMODULOS, true)

  it('a nevező az ELINDÍTHATÓ leckék száma (a feldolgozás alatti kimarad)', () => {
    const progress = summarizeCurriculum(curriculum, [])
    expect(progress.total).toBe(4)
    expect(progress.completed).toBe(0)
    expect(progress.percent).toBe(0)
    expect(progress.started).toBe(false)
    expect(progress.label).toBe('0/4 lecke kész')
    expect(progress.shortLabel).toBe('0/4 kész')
  })

  it('a kész leckéket számolja, és kerekített százalékot ad', () => {
    const progress = summarizeCurriculum(curriculum, ['l1', 'l3'])
    expect(progress.completed).toBe(2)
    expect(progress.percent).toBe(50)
    expect(progress.started).toBe(true)
    expect(progress.complete).toBe(false)
  })

  it('a törölt leckére mutató (orphan) ref nem torzít', () => {
    const progress = summarizeCurriculum(curriculum, ['l1', 'mar-torolt-lecke'])
    expect(progress.completed).toBe(1)
    expect(progress.total).toBe(4)
  })

  it('a NEM indítható leckére mutató ref sem számít bele', () => {
    const progress = summarizeCurriculum(curriculum, ['l4'])
    expect(progress.completed).toBe(0)
  })

  it('duplikált és üres ref nem torzít', () => {
    const progress = summarizeCurriculum(curriculum, ['l1', 'l1', '  ', null, undefined])
    expect(progress.completed).toBe(1)
  })

  it('minden indítható lecke kész → 100%, complete', () => {
    const progress = summarizeCurriculum(curriculum, ['l1', 'l2', 'l3', 'l5'])
    expect(progress.percent).toBe(100)
    expect(progress.complete).toBe(true)
  })

  it('üres tananyag: nincs osztás nullával', () => {
    const progress = summarizeCurriculum(buildCurriculum(product({}), true), [])
    expect(progress).toMatchObject({ total: 0, completed: 0, percent: 0, complete: false })
    expect(progress.label).toBe(NO_LESSONS_LABEL)
    expect(progress.resumeLesson).toBeNull()
  })

  it('modulonkénti bontást ad, a modulok sorrendjében', () => {
    const progress = summarizeCurriculum(curriculum, ['l1', 'l2'])
    expect(progress.byModule).toEqual([
      { total: 2, completed: 2, complete: true },
      { total: 2, completed: 0, complete: false },
    ])
  })

  it('a 0 indítható leckés modul nem számít késznek', () => {
    const csakProcessing = buildCurriculum(
      product({
        modules: [
          moduleRow({
            id: 'm1',
            title: 'Modul',
            lessons: [lessonRow({ id: 'l1', title: 'Készül', status: 'processing' })],
          }),
        ],
      }),
      true,
    )
    expect(summarizeCurriculum(csakProcessing, []).byModule).toEqual([
      { total: 0, completed: 0, complete: false },
    ])
  })
})

describe('summarizeCurriculum — folytatás', () => {
  const curriculum = buildCurriculum(KETMODULOS, true)

  it('az ELSŐ még nem kész, indítható leckére mutat', () => {
    expect(summarizeCurriculum(curriculum, []).resumeLesson?.ref).toBe('l1')
    expect(summarizeCurriculum(curriculum, ['l1']).resumeLesson?.ref).toBe('l2')
    expect(summarizeCurriculum(curriculum, ['l1', 'l2']).resumeLesson?.ref).toBe('l3')
  })

  it('átlépi a NEM indítható leckét (l4 feldolgozás alatt)', () => {
    expect(summarizeCurriculum(curriculum, ['l1', 'l2', 'l3']).resumeLesson?.ref).toBe('l5')
  })

  it('ha minden kész, az ELSŐ leckére mutat vissza (újranézés)', () => {
    expect(summarizeCurriculum(curriculum, ['l1', 'l2', 'l3', 'l5']).resumeLesson?.ref).toBe('l1')
  })
})

/**
 * A code review mérte: korábban csak a Bunny-GUID volt kapuzva, a szöveges
 * lecke teljes tartalma, a külső link célcíme és a mellékletek letöltési
 * URL-jei hozzáférés NÉLKÜL is bekerültek a modellbe — vagyis kiszivárogtak
 * mindenhová, ahová a modell eljut (RSC-payload, admin válasz). Ezek a tesztek
 * a bezárt rést őrzik.
 */
describe('buildCurriculum — hozzáférés nélkül a tartalom nem szivárog', () => {
  const fizetosTermek = () =>
    product({
      modules: [
        moduleRow({
          id: 'm1',
          title: 'Modul',
          lessons: [
            lessonRow({
              id: 'l1',
              title: 'Szöveges lecke',
              kind: 'szoveg',
              content: {
                root: {
                  children: [
                    {
                      children: [{ text: 'A fizetős tananyag teljes szövege', type: 'text', version: 1 }],
                      type: 'paragraph',
                      version: 1,
                    },
                  ],
                  direction: null,
                  format: '',
                  indent: 0,
                  type: 'root',
                  version: 1,
                },
              },
              attachments: [
                { id: 'a1', label: 'Segédlet', file: { id: 1, url: '/media/titkos.pdf', filename: 'titkos.pdf' } },
              ],
            } as unknown as Partial<LessonRow> & { id: string; title: string }),
            lessonRow({
              id: 'l2',
              title: 'Link lecke',
              kind: 'link',
              url: 'https://facebook.com/titkos-csoport',
            } as Partial<LessonRow> & { id: string; title: string }),
          ],
        }),
      ],
    })

  it('hasAccess: false → nincs content, url és attachment a modellben', () => {
    const curriculum = buildCurriculum(fizetosTermek(), false)
    for (const lesson of curriculum.lessons) {
      expect(lesson.content).toBeNull()
      expect(lesson.url).toBeNull()
      expect(lesson.attachments).toEqual([])
      expect(lesson.streamAssetId).toBeNull()
    }
    // A cím és az összefoglaló marad: az a marketing-nézethez kell.
    expect(curriculum.lessons[0]?.title).toBe('Szöveges lecke')
  })

  it('hasAccess: true → a tartalom hiánytalanul megvan', () => {
    const curriculum = buildCurriculum(fizetosTermek(), true)
    expect(curriculum.lessons[0]?.content).not.toBeNull()
    expect(curriculum.lessons[0]?.attachments).toEqual([
      { label: 'Segédlet', url: '/media/titkos.pdf' },
    ])
    expect(curriculum.lessons[1]?.url).toBe('https://facebook.com/titkos-csoport')
  })
})
