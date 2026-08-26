import { describe, expect, it } from 'vitest'

import { toPlayerVideos } from '../lib/course-player-videos'
import type { Product } from '../payload-types'

/**
 * A /kurzusaim/[id] RSC-SZIGORÍTÁS regresszió-őre (S2/b).
 * A lejátszóoldal a terméket `overrideAccess: true`-val olvassa, tehát a
 * mezőszintű access (streamAssetReadAccess) NEM fut le rajta — a Bunny-GUID-ot
 * a leképezésnek KELL elhagynia. Amíg ez a szerver-komponens törzsében élt,
 * nem volt rá teszt: a szigorítást visszaállítva a main szerinti alakra a
 */

const GUID_1 = 'bunny-guid-elso'
const GUID_2 = 'bunny-guid-masodik'

function productWithVideos(): Pick<Product, 'videos'> {
  return {
    videos: [
      {
        id: 'sor-1',
        title: '1. lecke',
        streamAssetId: GUID_1,
        durationSec: 1800,
        status: 'ready',
      },
      {
        id: 'sor-2',
        title: '2. lecke',
        streamAssetId: GUID_2,
        durationSec: 900,
        status: 'processing',
      },
    ],
  }
}

describe('toPlayerVideos — a Bunny-GUID csak élő hozzáféréssel megy ki', () => {
  it('hasAccess = true: a GUID benne van, minden sorra', () => {
    const videos = toPlayerVideos(productWithVideos(), true)

    expect(videos).toHaveLength(2)
    expect(videos[0].streamAssetId).toBe(GUID_1)
    expect(videos[1].streamAssetId).toBe(GUID_2)
  })

  it('hasAccess = false: a GUID HIÁNYZIK, a többi mező megmarad', () => {
    const videos = toPlayerVideos(productWithVideos(), false)

    expect(videos).toHaveLength(2)
    for (const video of videos) {
      expect(video.streamAssetId).toBeUndefined()
    }
    // Az epizódlista és a paywall-kártya adatai VÁLTOZATLANUL kimennek.
    expect(videos[0]).toMatchObject({
      id: 'sor-1',
      title: '1. lecke',
      durationSec: 1800,
      status: 'ready',
    })
    expect(videos[1]).toMatchObject({
      id: 'sor-2',
      title: '2. lecke',
      durationSec: 900,
      status: 'processing',
    })
  })

  /**
   * A GUID a SOROSÍTOTT payloadban sem maradhat: az RSC-propok a HTML-be
   * kerülnek, tehát egy `undefined`-ra állított mező is árulkodó lenne, ha
   * valahol mégis az eredeti értéket vinné tovább. Ez a JSON-szintű ellenőrzés
   * a teljes kimenetre néz rá, nem mezőnként.
   */
  it('hasAccess = false: a GUID a sorosított payloadban SEHOL nem szerepel', () => {
    const serialized = JSON.stringify(toPlayerVideos(productWithVideos(), false))

    expect(serialized).not.toContain(GUID_1)
    expect(serialized).not.toContain(GUID_2)
    expect(serialized).toContain('1. lecke')
  })

  it('hiányzó vagy nem-tömb videos esetén üres lista (a lejátszó nem robban)', () => {
    expect(toPlayerVideos({ videos: null }, true)).toEqual([])
    expect(toPlayerVideos({ videos: undefined }, true)).toEqual([])
  })

  it('a null-értékű almezők undefined-dá válnak (a kliens-prop alakja)', () => {
    const videos = toPlayerVideos(
      {
        videos: [
          { id: null, title: null, streamAssetId: null, durationSec: null, status: null },
        ],
      },
      true,
    )

    expect(videos).toHaveLength(1)
    expect(videos[0]).toEqual({
      id: undefined,
      title: undefined,
      streamAssetId: undefined,
      durationSec: undefined,
      status: undefined,
    })
  })
})
