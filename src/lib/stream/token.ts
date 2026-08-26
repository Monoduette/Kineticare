import { createHash } from 'node:crypto'

/**
 * Bunny Stream embed token: SHA256_HEX(key + video_guid + expires). Az `expires`
 * külön query-param is; max TTL 24 óra, videóhossz + 10 perc türelem.
 */

/** A videó végéhez adott türelemidő (másodperc): 10 perc. */
export const STREAM_TOKEN_GRACE_SECONDS = 600

/** A token maximális élettartama (másodperc): 24 óra. */
export const STREAM_TOKEN_MAX_TTL_SECONDS = 24 * 60 * 60

export interface StreamPlaybackTokenInput {
  /** A Bunny Stream videó GUID-ja (a hashelendő szöveg 2. tagja). */
  videoId: string
  /** A videó hossza másodpercben (a products.videos[].durationSec mezőből). */
  durationSec: number
  /**
   * A library token-hitelesítési kulcsa — csak szerver-oldalon, ENV-ből
   * (BUNNY_STREAM_TOKEN_AUTH_KEY).
   */
  signingKey: string
  /** Injektálható "most" a tesztelhetőségért; alapértelmezés: Date.now(). */
  now?: Date
}

export interface StreamPlaybackTokenResult {
  /** A jegy: SHA256 hex (kisbetűs) — az embed-URL `token` paramétere. */
  token: string
  /** A kiállítás pillanata (Unix epoch másodperc) — az élettartam alapja. */
  issuedAt: number
  /**
   * A lejárat Unix epoch MÁSODPERCBEN. Ez megy az embed-URL `expires`
   * paraméterébe, és PONTOSAN ez az érték szerepel a hashelt szövegben is.
   */
  expires: number
}

/**
 * Lejátszási jegy kiállítása. Szándékosan szinkron és tiszta: az üzleti
 * szabályok (ki nézheti, melyik videót) a hívó felelőssége.
 *
 * @throws Error ha a bemenet formailag hibás (programozási hiba — a
 *   felhasználói hibaágakat a service-réteg kezeli).
 */
export function createStreamPlaybackToken(
  input: StreamPlaybackTokenInput,
): StreamPlaybackTokenResult {
  const videoId = typeof input.videoId === 'string' ? input.videoId.trim() : ''
  if (videoId.length === 0) {
    throw new Error('createStreamPlaybackToken: a videoId nem lehet üres.')
  }
  if (
    typeof input.durationSec !== 'number' ||
    !Number.isFinite(input.durationSec) ||
    input.durationSec < 0
  ) {
    throw new Error('createStreamPlaybackToken: a durationSec nem negatív szám kell legyen.')
  }
  // A kulcs körüli whitespace levágása szándékos: a Railway Variables felületén
  // beillesztett érték végén könnyen marad újsor/szóköz, amitől MINDEN hash
  // elromlana — némán, a Bunny „invalid token" válaszával, ami a felületen
  // csak fekete lejátszóként látszana.
  const signingKey = typeof input.signingKey === 'string' ? input.signingKey.trim() : ''
  if (signingKey.length === 0) {
    throw new Error('createStreamPlaybackToken: a signingKey nem lehet üres.')
  }

  const nowMs = input.now instanceof Date ? input.now.getTime() : Date.now()
  const issuedAt = Math.floor(nowMs / 1000)
  const ttl = Math.min(
    Math.floor(input.durationSec) + STREAM_TOKEN_GRACE_SECONDS,
    STREAM_TOKEN_MAX_TTL_SECONDS,
  )
  const expires = issuedAt + ttl

  const token = createHash('sha256')
    .update(`${signingKey}${videoId}${expires}`, 'utf8')
    .digest('hex')

  return { token, issuedAt, expires }
}
