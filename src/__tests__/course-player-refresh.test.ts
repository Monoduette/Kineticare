import { describe, expect, it } from 'vitest'

import {
  TOKEN_IFRAME_RELOAD_REMAINING_SEC,
  mergePlayingSession,
  type FreshPlayingToken,
  type PlayingSession,
} from '../lib/course-player-refresh'

/**
 * CoursePlayer token-frissítés — az iframe-src életciklusa (a lejátszó
 * időzítői DOM nélkül nem tesztelhetők, ezért a DÖNTÉSI MAG itt, tisztán).
 * Frissítéskor a loadedSrc MEGMARAD, amíg a betöltött jegynek van ideje;
 * a küszöbön belül az új src kerül az iframe-be (különben a Bunny TTL után
 * fekete lejátszó maradna).
 */

const SRC_A = 'https://iframe.mediadelivery.net/embed/1/guid-a?token=token-a1&expires=1000'
const SRC_A2 = 'https://iframe.mediadelivery.net/embed/1/guid-a?token=token-a2&expires=2000'
const SRC_B = 'https://iframe.mediadelivery.net/embed/1/guid-b?token=token-b1&expires=1500'

function playing(
  videoIndex: number,
  token: string,
  expires: number,
  loadedSrc: string | null,
  loadedExpires: number | null = loadedSrc === null ? null : expires,
): PlayingSession {
  return {
    videoIndex,
    token,
    expiresAtEpochSec: expires,
    loadedSrc,
    loadedExpiresAtEpochSec: loadedExpires,
  }
}

function fresh(
  videoIndex: number,
  token: string,
  expires: number,
  src: string | null,
): FreshPlayingToken {
  return { videoIndex, token, expiresAtEpochSec: expires, src }
}

describe('mergePlayingSession — iframe-src a betöltött jegy ideje szerint', () => {
  it('első/epizód-betöltés: az új src kerül az iframe-be (szándékos mount)', () => {
    const merged = mergePlayingSession(null, fresh(0, 'token-a1', 1000, SRC_A), false, 0)
    expect(merged).toEqual(playing(0, 'token-a1', 1000, SRC_A, 1000))
  })

  it('explicit epizód-VÁLTÁS: az új epizód src-je töltődik be', () => {
    const previous = playing(0, 'token-a1', 1000, SRC_A)
    const merged = mergePlayingSession(previous, fresh(1, 'token-b1', 1500, SRC_B), false, 0)
    expect(merged.loadedSrc).toBe(SRC_B)
    expect(merged.loadedExpiresAtEpochSec).toBe(1500)
    expect(merged.videoIndex).toBe(1)
  })

  it('TOKEN-FRISSÍTÉS, ha a betöltött jegynek van ideje: a loadedSrc MEGMARAD', () => {
    const previous = playing(0, 'token-a1', 1000, SRC_A, 1000)
    const nowSec = 1000 - TOKEN_IFRAME_RELOAD_REMAINING_SEC - 1

    const merged = mergePlayingSession(previous, fresh(0, 'token-a2', 2000, SRC_A2), true, nowSec)

    expect(merged.loadedSrc).toBe(SRC_A)
    expect(merged.loadedExpiresAtEpochSec).toBe(1000)
    expect(merged.token).toBe('token-a2')
    expect(merged.expiresAtEpochSec).toBe(2000)
    expect(merged.videoIndex).toBe(0)
  })

  it('TOKEN-FRISSÍTÉS a küszöbön belül: az új src kerül az iframe-be', () => {
    const previous = playing(0, 'token-a1', 1000, SRC_A, 1000)
    const nowSec = 1000 - TOKEN_IFRAME_RELOAD_REMAINING_SEC

    const merged = mergePlayingSession(previous, fresh(0, 'token-a2', 2000, SRC_A2), true, nowSec)

    expect(merged.loadedSrc).toBe(SRC_A2)
    expect(merged.loadedExpiresAtEpochSec).toBe(2000)
    expect(merged.token).toBe('token-a2')
  })

  it('frissítés MÁS indexre: új betöltésként viselkedik', () => {
    const previous = playing(0, 'token-a1', 1000, SRC_A)
    const merged = mergePlayingSession(previous, fresh(1, 'token-b1', 1500, SRC_B), true, 0)
    expect(merged.loadedSrc).toBe(SRC_B)
  })

  it('hiányzó embed-src (nincs library-id): a null src is megmarad betöltéskor', () => {
    const merged = mergePlayingSession(null, fresh(0, 'token-a1', 1000, null), false, 0)
    expect(merged.loadedSrc).toBeNull()
    expect(merged.loadedExpiresAtEpochSec).toBeNull()
  })
})
