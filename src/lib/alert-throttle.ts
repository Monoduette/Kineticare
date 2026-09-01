/**
 * In-process riasztás-fojtás (cooldown) az ISMÉTLŐDŐ RIASZTÁS-naplósorokhoz.
 *
 * Miért kell: a percenkénti webhook-retry és az 5 percenkénti order-poll
 * ugyanarra a — már felszínre hozott, kézi beavatkozásra váró — rekordra
 * futásonként ÚJRA kiírta az error-szintű riasztást. A riasztás értéke a
 * FELSZÍNRE HOZÁS; az ismétlés csak zaj, ami a valódi új riasztásokat is
 * elfedi. A fojtás kulcsonként (pl. rendelés- vagy webhook-esemény-azonosító)
 * cooldown-on belül elnyomja az ismétlést, a cooldown lejárta után újra enged
 * — a nyitva maradt ügy tehát nem tűnik el, csak nem percenként ismétlődik.
 *
 * Miért in-process (nem DB-mező): a production `railway.json` `numReplicas: 1`
 * — egyetlen folyamat fut, ugyanazzal az indoklással, amivel az in-memory
 * rate-limit is elégséges. DB-mező sémabővítést (migrációt) igényelne, amit ez
 * a javítási kör szándékosan nem nyit. Újraindulás után az első előfordulás
 * újra riaszt — ez kívánatos: a friss folyamat nem örökli a régi elnyomásokat.
 */

export const DEFAULT_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000 // 6 óra

/**
 * Felső korlát a követett kulcsokra — memória-plafon. Túlcsordulásnál a
 * legrégebben rögzített kulcsok esnek ki (a Map beszúrási sorrendet tart),
 * ami legfeljebb egy KORAI újra-riasztást okoz, elnyelést soha.
 */
export const MAX_TRACKED_KEYS = 5000

const lastAlertAtByKey = new Map<string, number>()

/**
 * true → a riasztás MOST kiírandó (első előfordulás vagy lejárt cooldown);
 * false → cooldown-on belüli ismétlés, a hívó nyelje el.
 */
export function shouldEmitThrottledAlert(
  key: string,
  cooldownMs: number = DEFAULT_ALERT_COOLDOWN_MS,
  nowMs: number = Date.now(),
): boolean {
  const lastAt = lastAlertAtByKey.get(key)
  if (lastAt !== undefined && nowMs - lastAt < cooldownMs) {
    return false
  }
  if (lastAlertAtByKey.size >= MAX_TRACKED_KEYS && !lastAlertAtByKey.has(key)) {
    const oldestKey = lastAlertAtByKey.keys().next().value
    if (oldestKey !== undefined) {
      lastAlertAtByKey.delete(oldestKey)
    }
  }
  // Törlés + beszúrás: a frissen riasztott kulcs a beszúrási sorrend végére
  // kerül, így a túlcsordulási kiseprés mindig a legrégebbit találja el.
  lastAlertAtByKey.delete(key)
  lastAlertAtByKey.set(key, nowMs)
  return true
}

/** Tesztek közötti izolációhoz — élesben nincs hívója. */
export function resetAlertThrottle(): void {
  lastAlertAtByKey.clear()
}
