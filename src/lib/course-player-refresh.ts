/**
 * A CoursePlayer lejátszóállapotának token-érkezési szabálya — tiszta,
 * DOM-független függvény, hogy egységtesztelhető legyen (a komponens
 * node-környezetű tesztjei nem futtathatnak időzítőket).
 *
 * ═══ A HIBA, AMIT BEZÁR ═══
 * A token-frissítés a lejárat előtt 5 perccel ÚJ jegyet kér — de a friss jegy
 * az iframe `src`-be került, ami újramountolta a lejátszót, és a vevő elvesztette
 * a pozícióját (a „lejátszás nem szakad meg" frissítés maga szakította meg a
 * lejátszást). A szabály: frissítéskor a tárolt jegy megújul, az iframe src-je
 * MEGMARAD, AMÍG a betöltött jegynek van még ideje. Ha a betöltött jegy a
 * küszöb alá esik, az új src kerül az iframe-be: rövid újramount jobb, mint
 * fekete lejátszó a Bunny TTL után.
 *
 * Forrás: WCAG 2.2 · 2.2.1 Timing Adjustable
 * (https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html);
 * NN/g, Error Message Guidelines: a rendszerállapot legyen igaz
 * (https://www.nngroup.com/articles/error-message-guidelines/).
 */

/** Ha a betöltött embed-jegy ennyi másodpercen belül lejár, az iframe src cserélődik. */
export const TOKEN_IFRAME_RELOAD_REMAINING_SEC = 90

/** A token-frissítés a lejárat előtt ennyivel korábban fut (másodperc). */
export const TOKEN_REFRESH_BEFORE_EXPIRY_SEC = 300

/** A „playing" állapot — a token a legfrissebb, a loadedSrc az iframe-ben lévő. */
export interface PlayingSession {
  videoIndex: number
  token: string
  expiresAtEpochSec: number
  /** Az iframe által TÉNYLEGESEN betöltött embed-URL. */
  loadedSrc: string | null
  /** A `loadedSrc`-be égetett jegy lejárata (epoch mp); ettől függ a csere. */
  loadedExpiresAtEpochSec: number | null
}

/** A frissen kiállított jegy és a belőle épített embed-URL. */
export interface FreshPlayingToken {
  videoIndex: number
  token: string
  expiresAtEpochSec: number
  /** Az ÚJ jegyből épített embed-URL (explicit betöltésnél kerül az iframe-be). */
  src: string | null
}

/**
 * A lejátszóállapot összefésülése a token-válasszal.
 *
 * - token-FRISSÍTÉS (isRefresh) ugyanarra az epizódra: a `loadedSrc` MEGMARAD,
 *   ha a betöltött jegynek még van ideje (nincs újramount);
 * - ha a betöltött jegy a küszöbön belül lejár: az új src kerül az iframe-be;
 * - minden más eset (explicit epizód-váltás, „Újrapróbálom", első betöltés):
 *   az új src kerül az iframe-be.
 *
 * @param previous az aktuális lejátszási állapot, vagy null, ha nem „playing"
 * @param next a frissen kiállított jegy + src
 * @param isRefresh token-frissítés (true) vagy felhasználói/epizód-betöltés (false)
 * @param nowSec a „most" epoch másodpercben (teszthez injektálható)
 */
export function mergePlayingSession(
  previous: PlayingSession | null,
  next: FreshPlayingToken,
  isRefresh: boolean,
  nowSec: number,
): PlayingSession {
  if (isRefresh && previous !== null && previous.videoIndex === next.videoIndex) {
    const loadedExpires = previous.loadedExpiresAtEpochSec
    const remaining =
      typeof loadedExpires === 'number' && Number.isFinite(loadedExpires)
        ? loadedExpires - nowSec
        : Number.NEGATIVE_INFINITY
    if (remaining > TOKEN_IFRAME_RELOAD_REMAINING_SEC && previous.loadedSrc) {
      return {
        videoIndex: next.videoIndex,
        token: next.token,
        expiresAtEpochSec: next.expiresAtEpochSec,
        loadedSrc: previous.loadedSrc,
        loadedExpiresAtEpochSec: previous.loadedExpiresAtEpochSec,
      }
    }
  }
  return {
    videoIndex: next.videoIndex,
    token: next.token,
    expiresAtEpochSec: next.expiresAtEpochSec,
    loadedSrc: next.src,
    loadedExpiresAtEpochSec: next.src === null ? null : next.expiresAtEpochSec,
  }
}

/**
 * A KÖVETKEZŐ token-frissítés késleltetése (másodperc) az összefésült állapotból.
 *
 * ═══ A HIBA, AMIT BEZÁR ═══
 * A régi időzítő CSAK az új token lejáratából számolt (lejárat − 300 mp), a
 * src-csere küszöbe viszont a BETÖLTÖTT jegyé (maradék ≤ 90 mp). Két órás
 * Bunny TTL-lel: t=0 betöltés (jegy-A, lejárat 7200), t=6900 frissítés — a
 * merge megtartja a src-t (300 mp > 90 mp), az időzítő viszont a jegy-B
 * lejáratára állt (t=13800); a betöltött jegy-A t=7200-kor meghalt, és a vevő
 * ~1,8 órán át fekete lejátszót nézett. A szabály: a következő kör a
 * token-határidő (lejárat − 300) ÉS a betöltött jegy csere-határideje
 * (loadedExpires − 90) közül a KORÁBBI — így a csere-kör még azelőtt fut le,
 * hogy a betöltött jegy lejárna.
 *
 * @param session az összefésült „playing" állapot (mergePlayingSession kimenete)
 * @param nowSec a „most" epoch másodpercben (teszthez injektálható)
 */
export function nextRefreshDelaySec(
  session: Pick<PlayingSession, 'expiresAtEpochSec' | 'loadedExpiresAtEpochSec'>,
  nowSec: number,
): number {
  const tokenDeadlineSec = session.expiresAtEpochSec - nowSec - TOKEN_REFRESH_BEFORE_EXPIRY_SEC
  const loadedExpires = session.loadedExpiresAtEpochSec
  const loadedDeadlineSec =
    typeof loadedExpires === 'number' && Number.isFinite(loadedExpires)
      ? loadedExpires - nowSec - TOKEN_IFRAME_RELOAD_REMAINING_SEC
      : Number.POSITIVE_INFINITY
  return Math.max(30, Math.min(tokenDeadlineSec, loadedDeadlineSec))
}
