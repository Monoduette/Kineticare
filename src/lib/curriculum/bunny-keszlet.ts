/**
 * A Bunny Stream KINETICARE tár (469119) 28 kész videója → tananyag-modulok.
 *
 * A GUID-ok a tárból jöttek (2026-08-27, mind status=4 / Kész). A felosztás:
 * SOS_ előtagú fájlok a villámkurzusra, a többi az Otthoni KézRehabra.
 * A vevő a lecke címét látja, nem a fájlnevet (.mov / SOS_ levágva).
 *
 * Ez a fájl NEM ír adatbázist: a script (`src/scripts/import-bunny-curriculum.ts`)
 * rakja a products.modules mezőbe. Újramodulozás meglévő haladásnál a lecke-id-t
 * újragenerálja — ezért a script üres tananyagra ír, kész szerkesztést nem ír felül.
 */

import { SOS_COURSE_SKU } from '../menu-seed'

export const OTTHONI_COURSE_SKU = 'Otthoni KézRehab Program'

export const BUNNY_VIDEO_STATUS_READY = 4

export interface BunnyKeszletVideo {
  guid: string
  /** A Bunny-n tárolt fájlnév (kiterjesztéssel). */
  bunnyTitle: string
  lengthSec: number
  status: number
}

export interface BunnyCurriculumLessonSeed {
  title: string
  kind: 'video'
  streamAssetId: string
  durationSec: number
  status: 'ready'
}

export interface BunnyCurriculumModuleSeed {
  title: string
  summary: string
  lessons: BunnyCurriculumLessonSeed[]
}

export interface BunnyCurriculumPlan {
  sku: string
  modules: BunnyCurriculumModuleSeed[]
  /** Előzetes a PUBLIKUS tárból. Üres, amíg a másolat GUID-ja nincs meg. */
  previewVideoStreamId: string | null
}

/** A védett tár teljes, mért készlete. */
export const BUNNY_KINETICARE_VIDEOS: readonly BunnyKeszletVideo[] = [
  {
    guid: '4bdf9c82-35a5-4d68-8f40-21acb56824f7',
    bunnyTitle: '10+1 tévhit - Így ne kezeld a kézfájdalmadat .mov',
    lengthSec: 1126,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: 'd23b792c-2d2f-4609-bb66-c59769820aa6',
    bunnyTitle: '10+1 tipp kisbabás anyukáknak kézfájás ellen.mov',
    lengthSec: 807,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: 'bec0fad1-93a9-4991-98b9-9051555d14fd',
    bunnyTitle: 'Egyszerű mobilizáló gyakorlatok.mov',
    lengthSec: 659,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: '25f6f5f0-418c-42ef-a9f1-b9f9adabcae5',
    bunnyTitle: 'Fontos tudnivalók a programról.mov',
    lengthSec: 219,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: '64bef377-ef24-4060-951e-bb2e4dac3bc1',
    bunnyTitle: 'Gyakorlatok csuklófájdalomra.mov',
    lengthSec: 368,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: '4da9e58c-a584-4776-976d-7ea9196075fd',
    bunnyTitle: 'Gyakorlatok hüvelykujjfájdalomra.mov',
    lengthSec: 318,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: 'a2da207d-c216-4315-9993-90cd84837fc5',
    bunnyTitle: 'Gyakorlatok könyökfájdalomra.mov',
    lengthSec: 382,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: '5ca5d80f-d1b6-4de7-bdda-dc3be983db21',
    bunnyTitle: 'Gyakorlatok pattanó ujjakra.mov',
    lengthSec: 420,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: 'a861f2fa-2b41-46a8-aa82-0e8fe356262d',
    bunnyTitle: 'Gyakorlatok zsibbadó ujjakra.mov',
    lengthSec: 322,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: 'b52fd6fe-7b9d-4ab0-b9ab-e0331b3d49a1',
    bunnyTitle: 'Hogyan alakul ki a kéztőalagút szindróma?.mov',
    lengthSec: 495,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: 'c33b2925-168c-460f-8c7a-21ef5709fca9',
    bunnyTitle: 'Hogyan alakul ki a pattanó ujj?.mov',
    lengthSec: 387,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: '447d9256-7a7f-4792-8f1b-a92a98d58298',
    bunnyTitle: 'Hogyan alakul ki a tenisz- és a golfkönyök?.mov',
    lengthSec: 678,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: 'c54c2057-5fa7-4723-b200-cee4d0f53fd8',
    bunnyTitle: 'Hogyan alakul ki az ínhüvelygyulladás?.mov',
    lengthSec: 353,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: '92eaf0f6-e926-4af0-a581-6d0132153b37',
    bunnyTitle: 'Hogyan alakul ki az ujjak zsibbadása?.mov',
    lengthSec: 653,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: 'ce882fed-1dd4-4638-8632-c9238ef4c875',
    bunnyTitle: 'Így csináld a gyakorlatokat.mov',
    lengthSec: 475,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: '6484ba64-149c-4ad3-b803-890881aaab49',
    bunnyTitle: 'Így sportolj kézfájdalommal.mov',
    lengthSec: 513,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: 'b1ff827f-bb5c-4b56-85e2-d4e12dae400f',
    bunnyTitle: 'Így tudod elkerülni, hogy kiújuljon a probléma.mov',
    lengthSec: 225,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: '3be4f7dd-e2c2-4089-8a3d-6cda9fdd9f6b',
    bunnyTitle: 'Ismerd meg a kezed.mov',
    lengthSec: 899,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: '5ed4ee2d-d25d-4ac0-a814-ccb7d0bcf17e',
    bunnyTitle: 'Kinesiotape.mov',
    lengthSec: 1687,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: 'a17e0a4e-2333-4daa-8dd4-0632ba327825',
    bunnyTitle: 'Mi az a hipermobilitás és hogyan kezeld.mov',
    lengthSec: 430,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: '9bf411f5-93d5-4c3b-a8d1-7d3a86e2ba0e',
    bunnyTitle: 'Mikor fordulj orvoshoz/gyógytornászhoz/fizikoterápiára/masszőrhöz?.mov',
    lengthSec: 433,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: 'f33a3a1e-39b7-4fac-a8ae-5cfdd0264c39',
    bunnyTitle: 'Milyen eszközöket használj.mov',
    lengthSec: 673,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: 'af73719f-ef52-41e1-9832-c8eb765de9bf',
    bunnyTitle: 'Rögzítők.mov',
    lengthSec: 924,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: '2d17864c-bcd4-4d74-b77c-2ffa2e9e4928',
    bunnyTitle: 'SOS_Fontos tudnivalók a programról.mov',
    lengthSec: 121,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: '9bbe93ce-ce51-4a7c-9bd2-699a3e459c0c',
    bunnyTitle: 'SOS_Hogyan alakul ki a kéztőalagút-szindróma?.mov',
    lengthSec: 340,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: 'afefc20a-f100-446c-8693-8cf34989e2bd',
    bunnyTitle: 'SOS_Hogyan alakul ki a teniszkönyök?.mov',
    lengthSec: 359,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: '4798af08-e3fa-40cf-b74f-febddb97a6f3',
    bunnyTitle: 'SOS_Hogyan alakul ki az ínhüvely gyulladás?.mov',
    lengthSec: 245,
    status: BUNNY_VIDEO_STATUS_READY,
  },
  {
    guid: '05960519-d43b-481d-a441-262fb7afcace',
    bunnyTitle: 'SOS_Rögzítők.mov',
    lengthSec: 904,
    status: BUNNY_VIDEO_STATUS_READY,
  },
]

const byGuid = new Map(BUNNY_KINETICARE_VIDEOS.map((video) => [video.guid, video]))

/** Fájlnév → lecke cím: kiterjesztés és SOS_ előtag nélkül, összehúzott szóközzel. */
export function lessonTitleFromBunnyFilename(title: string): string {
  return title
    .replace(/\.(mov|mp4|m4v|avi)$/i, '')
    .replace(/^SOS_/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function lessonFromGuid(guid: string): BunnyCurriculumLessonSeed {
  const video = byGuid.get(guid)
  if (video === undefined) {
    throw new Error(`bunny-keszlet: ismeretlen GUID: ${guid}`)
  }
  if (video.status !== BUNNY_VIDEO_STATUS_READY) {
    throw new Error(`bunny-keszlet: a videó nem kész: ${guid}`)
  }
  return {
    title: lessonTitleFromBunnyFilename(video.bunnyTitle),
    kind: 'video',
    streamAssetId: video.guid,
    durationSec: video.lengthSec,
    status: 'ready',
  }
}

function moduleOf(
  title: string,
  summary: string,
  guids: readonly string[],
): BunnyCurriculumModuleSeed {
  return {
    title,
    summary,
    lessons: guids.map(lessonFromGuid),
  }
}

const OTTHONI_PLAN: BunnyCurriculumPlan = {
  sku: OTTHONI_COURSE_SKU,
  previewVideoStreamId: null,
  modules: [
    moduleOf('1. Így kezdj neki', 'A program felépítése, a kéz anatómiája, a gyakorlás módja.', [
      '25f6f5f0-418c-42ef-a9f1-b9f9adabcae5',
      '3be4f7dd-e2c2-4089-8a3d-6cda9fdd9f6b',
      'ce882fed-1dd4-4638-8632-c9238ef4c875',
      '9bf411f5-93d5-4c3b-a8d1-7d3a86e2ba0e',
    ]),
    moduleOf(
      '2. Mi okozza a fájdalmat',
      'Az ínhüvely, a pattanó ujj, a kéztőalagút, a könyök és a zsibbadás.',
      [
      'c54c2057-5fa7-4723-b200-cee4d0f53fd8',
      'c33b2925-168c-460f-8c7a-21ef5709fca9',
      'b52fd6fe-7b9d-4ab0-b9ab-e0331b3d49a1',
      '447d9256-7a7f-4792-8f1b-a92a98d58298',
      '92eaf0f6-e926-4af0-a581-6d0132153b37',
    ]),
    moduleOf(
      '3. Gyakorlatok',
      'Mobilizálás és célzott gyakorlatok csuklóra, ujjakra, könyökre.',
      [
      'bec0fad1-93a9-4991-98b9-9051555d14fd',
      '64bef377-ef24-4060-951e-bb2e4dac3bc1',
      '4da9e58c-a584-4776-976d-7ea9196075fd',
      '5ca5d80f-d1b6-4de7-bdda-dc3be983db21',
      'a861f2fa-2b41-46a8-aa82-0e8fe356262d',
      'a2da207d-c216-4315-9993-90cd84837fc5',
    ]),
    moduleOf(
      '4. Eszközök és mindennapok',
      'Rögzítők, tape, sport, anyaság, tévhitek, kiújulás.',
      [
      'f33a3a1e-39b7-4fac-a8ae-5cfdd0264c39',
      'af73719f-ef52-41e1-9832-c8eb765de9bf',
      '5ed4ee2d-d25d-4ac0-a814-ccb7d0bcf17e',
      '6484ba64-149c-4ad3-b803-890881aaab49',
      'd23b792c-2d2f-4609-bb66-c59769820aa6',
      '4bdf9c82-35a5-4d68-8f40-21acb56824f7',
      'a17e0a4e-2333-4daa-8dd4-0632ba327825',
      'b1ff827f-bb5c-4b56-85e2-d4e12dae400f',
    ]),
  ],
}

const SOS_PLAN: BunnyCurriculumPlan = {
  sku: SOS_COURSE_SKU,
  previewVideoStreamId: null,
  modules: [
    moduleOf(
      '1. A villámkurzus',
      'Rövid bevezető és a három leggyakoribb panasz, plusz a rögzítők.',
      [
      '2d17864c-bcd4-4d74-b77c-2ffa2e9e4928',
      '4798af08-e3fa-40cf-b74f-febddb97a6f3',
      '9bbe93ce-ce51-4a7c-9bd2-699a3e459c0c',
      'afefc20a-f100-446c-8693-8cf34989e2bd',
      '05960519-d43b-481d-a441-262fb7afcace',
    ]),
  ],
}

export const BUNNY_CURRICULUM_PLANS: readonly BunnyCurriculumPlan[] = [OTTHONI_PLAN, SOS_PLAN]

export function planForSku(sku: string): BunnyCurriculumPlan | null {
  const trimmed = sku.trim()
  return BUNNY_CURRICULUM_PLANS.find((plan) => plan.sku === trimmed) ?? null
}

/** A terv lapos GUID-listája a megjelenítési sorrendben. */
export function plannedStreamAssetIds(plan: BunnyCurriculumPlan): string[] {
  return plan.modules.flatMap((modul) => modul.lessons.map((lesson) => lesson.streamAssetId))
}

/** A tár minden GUID-ja, egyszer. */
export function keszletGuids(): string[] {
  return BUNNY_KINETICARE_VIDEOS.map((video) => video.guid)
}

/** A CMS-modulokból a videó-azonosítók sorrendben (üres / hiányzó kihagyva). */
export function existingStreamAssetIds(modules: unknown): string[] {
  if (!Array.isArray(modules)) {
    return []
  }
  const ids: string[] = []
  for (const modul of modules) {
    if (typeof modul !== 'object' || modul === null) {
      continue
    }
    const lessons = (modul as { lessons?: unknown }).lessons
    if (!Array.isArray(lessons)) {
      continue
    }
    for (const lesson of lessons) {
      if (typeof lesson !== 'object' || lesson === null) {
        continue
      }
      const id = (lesson as { streamAssetId?: unknown }).streamAssetId
      if (typeof id === 'string' && id.trim().length > 0) {
        ids.push(id.trim())
      }
    }
  }
  return ids
}

/** Pontosan ugyanazok a GUID-ok, ugyanabban a sorrendben: nincs mit írni. */
export function modulesMatchPlan(modules: unknown, plan: BunnyCurriculumPlan): boolean {
  const existing = existingStreamAssetIds(modules)
  const planned = plannedStreamAssetIds(plan)
  if (existing.length !== planned.length) {
    return false
  }
  return existing.every((id, index) => id === planned[index])
}
