import { describe, expect, it } from 'vitest'

import { SOS_COURSE_SKU } from '../lib/menu-seed'
import {
  BUNNY_CURRICULUM_PLANS,
  BUNNY_KINETICARE_VIDEOS,
  BUNNY_VIDEO_STATUS_READY,
  OTTHONI_COURSE_SKU,
  existingStreamAssetIds,
  keszletGuids,
  lessonTitleFromBunnyFilename,
  modulesMatchPlan,
  planForSku,
  plannedStreamAssetIds,
} from '../lib/curriculum/bunny-keszlet'
import {
  BUNNY_PROTECTED_LIBRARY_ID,
  BUNNY_PUBLIC_LIBRARY_ID,
  bunnyProtectedLibraryId,
  bunnyPublicLibraryId,
} from '../lib/stream/bunny-site-config'

describe('lessonTitleFromBunnyFilename', () => {
  it('levágja a .movot és a SOS_ előtagot', () => {
    expect(lessonTitleFromBunnyFilename('SOS_Rögzítők.mov')).toBe('Rögzítők')
    expect(lessonTitleFromBunnyFilename('Ismerd meg a kezed.mov')).toBe('Ismerd meg a kezed')
  })

  it('összehúzza a kiterjesztés előtti fölös szóközt', () => {
    expect(lessonTitleFromBunnyFilename('10+1 tévhit - Így ne kezeld a kézfájdalmadat .mov')).toBe(
      '10+1 tévhit - Így ne kezeld a kézfájdalmadat',
    )
  })
})

describe('Bunny-készlet → tananyag', () => {
  it('28 kész videó, mind egyedi GUID', () => {
    expect(BUNNY_KINETICARE_VIDEOS).toHaveLength(28)
    const guids = keszletGuids()
    expect(new Set(guids).size).toBe(28)
    expect(BUNNY_KINETICARE_VIDEOS.every((video) => video.status === BUNNY_VIDEO_STATUS_READY)).toBe(
      true,
    )
  })

  it('minden GUID pontosan egyszer kerül tananyagba', () => {
    const planned = BUNNY_CURRICULUM_PLANS.flatMap(plannedStreamAssetIds)
    expect(planned.sort()).toEqual([...keszletGuids()].sort())
    expect(new Set(planned).size).toBe(planned.length)
  })

  it('az Otthoni program 4 modul, 23 lecke; az SOS 1 modul, 5 lecke', () => {
    const otthoni = planForSku(OTTHONI_COURSE_SKU)
    const sos = planForSku(SOS_COURSE_SKU)
    expect(otthoni?.modules).toHaveLength(4)
    expect(plannedStreamAssetIds(otthoni!)).toHaveLength(23)
    expect(sos?.modules).toHaveLength(1)
    expect(plannedStreamAssetIds(sos!)).toHaveLength(5)
    expect(sos?.sku).toBe(SOS_COURSE_SKU)
  })

  it('minden lecke videó, Kész, pozitív hossz, GUID', () => {
    for (const plan of BUNNY_CURRICULUM_PLANS) {
      for (const lesson of plan.modules.flatMap((modul) => modul.lessons)) {
        expect(lesson.kind).toBe('video')
        expect(lesson.status).toBe('ready')
        expect(lesson.durationSec).toBeGreaterThan(0)
        expect(lesson.streamAssetId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        )
        expect(lesson.title.includes('.mov')).toBe(false)
        expect(lesson.title.startsWith('SOS_')).toBe(false)
      }
    }
  })

  it('modulesMatchPlan: üres ≠ terv, azonos GUID-sor = egyezés', () => {
    const plan = planForSku(OTTHONI_COURSE_SKU)!
    expect(modulesMatchPlan([], plan)).toBe(false)
    expect(modulesMatchPlan(undefined, plan)).toBe(false)
    const tükör = plan.modules.map((modul) => ({
      title: modul.title,
      lessons: modul.lessons.map((lesson) => ({ streamAssetId: lesson.streamAssetId })),
    }))
    expect(modulesMatchPlan(tükör, plan)).toBe(true)
    expect(existingStreamAssetIds(tükör)).toEqual(plannedStreamAssetIds(plan))
  })
})

describe('bunny-site-config', () => {
  it('a nyilvános azonosítók számok, nem titkok', () => {
    expect(BUNNY_PROTECTED_LIBRARY_ID).toBe('469119')
    expect(BUNNY_PUBLIC_LIBRARY_ID).toBe('738433')
    expect(bunnyProtectedLibraryId()).toMatch(/^\d+$/)
    expect(bunnyPublicLibraryId()).toMatch(/^\d+$/)
  })

  it('az env felülírja a beégetett tárat', () => {
    const original = process.env.NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID
    process.env.NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID = '99'
    expect(bunnyProtectedLibraryId()).toBe('99')
    if (original === undefined) {
      delete process.env.NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID
    } else {
      process.env.NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID = original
    }
  })
})
