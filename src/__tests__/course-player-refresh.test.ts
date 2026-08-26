import { describe, expect, it } from 'vitest'

import {
  mergePlayingSession,
  type FreshPlayingToken,
  type PlayingSession,
} from '../lib/course-player-refresh'

/**
 * CoursePlayer token-frissítés — az iframe-src életciklusa (a lejátszó
 * időzítői DOM nélkül nem tesztelhetők, ezért a DÖNTÉSI MAG itt, tisztán).
 * (a) A token-frissítés eddig az ÚJ jegyet az iframe `src`-be írta → az iframe
 * újramountolt → a vevő elvesztette a lejátszási pozíciót (a „lejátszás
 * nem szakad meg" frissítés maga szakította meg a lejátszást).
 */

const SRC_A = 'https://iframe.mediadelivery.net/embed/1/guid-a?token=token-a1&expires=1000'
const SRC_A2 = 'https://iframe.mediadelivery.net/embed/1/guid-a?token=token-a2&expires=2000'
const SRC_B = 'https://iframe.mediadelivery.net/embed/1/guid-b?token=token-b1&expires=1500'

function playing(videoIndex: number, token: string, expires: number, loadedSrc: string | null): PlayingSession {
  return { videoIndex, token, expiresAtEpochSec: expires, loadedSrc }
}

function fresh(videoIndex: number, token: string, expires: number, src: string | null): FreshPlayingToken {
  return { videoIndex, token, expiresAtEpochSec: expires, src }
}

describe('mergePlayingSession — az iframe-src csak explicit betöltéskor változik', () => {
  it('első/epizód-betöltés: az új src kerül az iframe-be (szándékos mount)', () => {
    const merged = mergePlayingSession(null, fresh(0, 'token-a1', 1000, SRC_A), false)
    expect(merged).toEqual(playing(0, 'token-a1', 1000, SRC_A))
  })

  it('explicit epizód-VÁLTÁS: az új epizód src-je töltődik be', () => {
    const previous = playing(0, 'token-a1', 1000, SRC_A)
    const merged = mergePlayingSession(previous, fresh(1, 'token-b1', 1500, SRC_B), false)
    expect(merged.loadedSrc).toBe(SRC_B)
    expect(merged.videoIndex).toBe(1)
  })

  it('(a) TOKEN-FRISSÍTÉS ugyanarra az epizódra: a loadedSrc MEGMARAD (nincs újramount), a jegy megújul', () => {
    const previous = playing(0, 'token-a1', 1000, SRC_A)

    const merged = mergePlayingSession(previous, fresh(0, 'token-a2', 2000, SRC_A2), true)

    // A döntő állítás: az iframe továbbra is a RÉGI URL-t játssza (a key/src
    // nem változik → React nem mountol újra → a pozíció megmarad)…
    expect(merged.loadedSrc).toBe(SRC_A)
    // …miközben a tárolt jegy és lejárat a FRISS (egy későbbi explicit betöltés
    // — pl. „Újrapróbálom" vagy epizód-újakattintás — már ezzel építkezik).
    expect(merged.token).toBe('token-a2')
    expect(merged.expiresAtEpochSec).toBe(2000)
    expect(merged.videoIndex).toBe(0)
  })

  it('frissítés MÁS indexre (védőág — a komponens generáció-őre előbb eldobja): új betöltésként viselkedik', () => {
    const previous = playing(0, 'token-a1', 1000, SRC_A)
    const merged = mergePlayingSession(previous, fresh(1, 'token-b1', 1500, SRC_B), true)
    expect(merged.loadedSrc).toBe(SRC_B)
  })

  it('hiányzó embed-src (nincs library-id): a null src is megmarad betöltéskor', () => {
    const merged = mergePlayingSession(null, fresh(0, 'token-a1', 1000, null), false)
    expect(merged.loadedSrc).toBeNull()
  })
})
