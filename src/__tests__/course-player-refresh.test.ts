import { describe, expect, it } from 'vitest'

import {
  TOKEN_IFRAME_RELOAD_REMAINING_SEC,
  TOKEN_REFRESH_BEFORE_EXPIRY_SEC,
  mergePlayingSession,
  nextRefreshDelaySec,
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

/**
 * A HIBAJEGY IDŐVONALA (2 órás Bunny TTL-lel), amit a nextRefreshDelaySec zár be:
 * t=0 betöltés (jegy-A, lejárat 7200); t=6900 frissítés (jegy-B) — a merge
 * HELYESEN megtartja az iframe src-jét, de a régi időzítő CSAK a jegy-B
 * lejáratából számolt (14100−6900−300 = 6900 mp), így a következő kör t=13800;
 * közben a betöltött jegy-A t=7200-kor lejár → ~1,8 óra fekete lejátszó.
 * A szabály: a következő frissítés a token-határidő ÉS a betöltött jegy
 * csere-határideje (loadedExpires − 90) közül a KORÁBBI.
 */
const SRC_A3 = 'https://iframe.mediadelivery.net/embed/1/guid-a?token=token-a3&expires=14310'

describe('nextRefreshDelaySec — a frissítés a betöltött jegy halála ELŐTT fut', () => {
  it('bő idővel a token-lejárat vezérel: lejárat − 300 mp', () => {
    const session = playing(0, 'token-a1', 7200, SRC_A, 7200)
    expect(nextRefreshDelaySec(session, 0)).toBe(7200 - TOKEN_REFRESH_BEFORE_EXPIRY_SEC)
  })

  it('a hibajegy idővonala: a betöltött jegy határideje rövidíti a kört, a következő kör cserél', () => {
    // t=0: első betöltés jegy-A-val (lejárat 7200).
    const session0 = mergePlayingSession(null, fresh(0, 'token-a1', 7200, SRC_A), false, 0)
    const delay0 = nextRefreshDelaySec(session0, 0)
    expect(delay0).toBe(6900)

    // t=6900: frissítés jegy-B-vel (lejárat 14100) — a src marad (300 mp > 90 mp).
    const t1 = delay0
    const merged1 = mergePlayingSession(session0, fresh(0, 'token-a2', 14100, SRC_A2), true, t1)
    expect(merged1.loadedSrc).toBe(SRC_A)

    // A következő kör NEM várhat a jegy-B határidejéig: a betöltött jegy-A
    // csere-határideje (7200 − 90) előtt kell futnia.
    const delay1 = nextRefreshDelaySec(merged1, t1)
    expect(t1 + delay1).toBeLessThanOrEqual(7200 - TOKEN_IFRAME_RELOAD_REMAINING_SEC)
    expect(delay1).toBe(210)

    // t=7110: a soron következő frissítés már CSERÉLI a src-t (maradék = 90, nem > 90).
    const t2 = t1 + delay1
    const merged2 = mergePlayingSession(merged1, fresh(0, 'token-a3', 14310, SRC_A3), true, t2)
    expect(merged2.loadedSrc).toBe(SRC_A3)
    expect(merged2.loadedExpiresAtEpochSec).toBe(14310)
  })

  it('a 30 mp-es alsó korlát megmarad', () => {
    const session = playing(0, 'token-a1', 1200, SRC_A, 1200)
    expect(nextRefreshDelaySec(session, 1000)).toBe(30)
  })

  it('hiányzó betöltött jegy (null src): csak a token-lejárat számít', () => {
    const session = playing(0, 'token-a1', 7200, null)
    expect(nextRefreshDelaySec(session, 0)).toBe(6900)
  })
})
