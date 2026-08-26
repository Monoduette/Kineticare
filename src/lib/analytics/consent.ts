/**
 * Analytics consent állapotgép — DOM-független; posthog/ga4 innen importál.
 *
 * Állapotok: unknown (banner látszik), granted, denied. Időbélyeg külön kulcsban;
 * lejárat csak a bannert hozza vissza. Injektálható tároló → unit-tesztelhető.
 * Tárolási hiba → konzervatív (unknown / írás sikertelen).
 */
export const CONSENT_STORAGE_KEY = 'kc_analytics_consent'

/**
 * A döntés IDŐBÉLYEGÉNEK külön kulcsa (epoch ezredmásodperc, decimális
 * sztringként). Külön kulcs, nem összetett érték: a `kc_analytics_consent`
 * tartalma így betű szerint ugyanaz marad, mint eddig ('granted'/'denied'),
 * tehát a régi böngészőkben tárolt döntés érvényes marad, és a modul többi
 * fogyasztója (posthog.ts, ga4.ts) egyetlen sor változtatás nélkül működik.
 */
export const CONSENT_TIMESTAMP_KEY = 'kc_analytics_consent_at'

/** Újrakérdezés 365 nap után (Barion max 13 hó; lejárat csak a sávot hozza vissza). */
export const CONSENT_MAX_AGE_DAYS = 365
export const CONSENT_MAX_AGE_MS = CONSENT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000

/** A consent-változást jelző window-esemény neve (a provider hallgat rá). */
export const CONSENT_EVENT = 'kc:analytics-consent'

/**
 * A consent-banner ÚJRANYITÁSÁT kérő window-esemény (GDPR visszavonási út):
 * a footer „Süti-beállítások" gombja szórja, a ConsentBanner erre nyílik újra
 * döntés UTÁN is. Tartalma nincs — a banner a tárolt állapotot olvassa.
 */
export const CONSENT_OPEN_EVENT = 'kc:analytics-consent-open'

/** A consent állapotgép lehetséges értékei. */
export type ConsentState = 'unknown' | 'granted' | 'denied'

export const CONSENT_GRANTED: ConsentState = 'granted'
export const CONSENT_DENIED: ConsentState = 'denied'
export const CONSENT_UNKNOWN: ConsentState = 'unknown'

/** A ConsentBanner által szórt esemény payloadja. */
export interface ConsentEventDetail {
  state: ConsentState
}

/** Olvasáshoz elég egy getItem-képes tároló (localStorage vagy mock). */
export type ConsentReader = Pick<Storage, 'getItem'>
/** Íráshoz setItem (+ 'unknown' állapotnál removeItem) kell. */
export type ConsentWriter = Pick<Storage, 'setItem' | 'removeItem'>
/** Eseményszóráshoz elég egy dispatchEvent-képes cél (window vagy mock). */
export type ConsentEventTarget = Pick<EventTarget, 'dispatchEvent'>

/** Tároló feloldása: injektált érték, kliens-oldali localStorage, vagy undefined (SSR/teszt). */
function resolveReader(storage?: ConsentReader): ConsentReader | undefined {
  if (storage) {
    return storage
  }
  return typeof window !== 'undefined' ? window.localStorage : undefined
}

function resolveWriter(storage?: ConsentWriter): ConsentWriter | undefined {
  if (storage) {
    return storage
  }
  return typeof window !== 'undefined' ? window.localStorage : undefined
}

/** Nyers string → ConsentState; bármi ismeretlen/sérült érték 'unknown'. */
export function parseConsentState(raw: string | null): ConsentState {
  if (raw === CONSENT_GRANTED) {
    return CONSENT_GRANTED
  }
  if (raw === CONSENT_DENIED) {
    return CONSENT_DENIED
  }
  return CONSENT_UNKNOWN
}

/**
 * A tárolt consent állapot beolvasása. Injektált tárolóval tesztelhető;
 * alapból a window.localStorage-ból olvas (szerveren/tárolóhiba esetén
 * 'unknown' — ilyenkor az analitika tiltva marad).
 */
export function readConsent(storage?: ConsentReader): ConsentState {
  const store = resolveReader(storage)
  if (!store) {
    return CONSENT_UNKNOWN
  }
  try {
    return parseConsentState(store.getItem(CONSENT_STORAGE_KEY))
  } catch {
    return CONSENT_UNKNOWN
  }
}

/**
 * Nyers időbélyeg-string → epoch ms, vagy null, ha hiányzik/sérült.
 * A null jelentése MINDIG „ismeretlen kor" (nem pedig „most") — így egy
 * elrontott érték nem hosszabbítja meg némán a hozzájárulás élettartamát.
 */
export function parseConsentTimestamp(raw: string | null): number | null {
  if (raw === null) {
    return null
  }
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return null
  }
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value <= 0) {
    return null
  }
  return value
}

/** A tárolt döntés + a döntés ideje (null = nincs döntés VAGY ismeretlen korú). */
export interface ConsentRecord {
  readonly state: ConsentState
  readonly decidedAt: number | null
}

/**
 * A teljes tárolt rekord beolvasása. A régi, IDŐBÉLYEG NÉLKÜL tárolt döntés
 * itt `decidedAt: null`-ként jön viss — a döntés megmarad, csak a kora
 * ismeretlen (a migrációt az isConsentExpired kezeli: egyszer újrakérdez).
 */
export function readConsentRecord(storage?: ConsentReader): ConsentRecord {
  const store = resolveReader(storage)
  if (!store) {
    return { state: CONSENT_UNKNOWN, decidedAt: null }
  }
  try {
    const state = parseConsentState(store.getItem(CONSENT_STORAGE_KEY))
    if (state === CONSENT_UNKNOWN) {
      return { state, decidedAt: null }
    }
    return { state, decidedAt: parseConsentTimestamp(store.getItem(CONSENT_TIMESTAMP_KEY)) }
  } catch {
    return { state: CONSENT_UNKNOWN, decidedAt: null }
  }
}

/**
 * Lejárt-e a tárolt döntés (kell-e újrakérdezni)?
 *
 * - 'unknown': nincs mit lejáratni (a sáv úgyis látszik) → false.
 * - időbélyeg nélküli, örökölt döntés → true: EGYSZER újrakérdezünk, és a
 *   válasszal már időbélyeg is íródik. A döntés nem törlődik és nem dob hibát.
 * - jövőbe mutató időbélyeg (elállított óra, kézzel írt érték) → true: nem
 *   fogadunk el olyan kort, ami a végtelenségig érvényben tartaná a döntést.
 */
export function isConsentExpired(
  record: ConsentRecord,
  now: number,
  maxAgeMs: number = CONSENT_MAX_AGE_MS,
): boolean {
  if (record.state === CONSENT_UNKNOWN) {
    return false
  }
  if (record.decidedAt === null) {
    return true
  }
  if (record.decidedAt > now) {
    return true
  }
  return now - record.decidedAt >= maxAgeMs
}

/**
 * A consent állapot tárolása. 'granted'/'denied' esetén a kulcs ÉS a döntés
 * időbélyege íródik, 'unknown' esetén mindkettő törlődik (visszaáll „még nem
 * döntött" állapotba). Visszatérés: sikerült-e az írás (tárolóhiba → false,
 * de nem dob).
 */
export function writeConsent(
  state: ConsentState,
  storage?: ConsentWriter,
  now: number = Date.now(),
): boolean {
  const store = resolveWriter(storage)
  if (!store) {
    return false
  }
  try {
    if (state === CONSENT_UNKNOWN) {
      store.removeItem(CONSENT_STORAGE_KEY)
      store.removeItem(CONSENT_TIMESTAMP_KEY)
    } else {
      store.setItem(CONSENT_STORAGE_KEY, state)
      store.setItem(CONSENT_TIMESTAMP_KEY, String(now))
    }
    return true
  } catch {
    return false
  }
}

/**
 * 'kc:analytics-consent' CustomEvent szórása — a PostHogProvider (és bármi
 * más érdekelt) erre reagál oldalfrissítés nélkül. Injektált céllal
 * node-ban is tesztelhető; cél nélkül (SSR) no-op, false-szal tér viss.
 */
export function dispatchConsentEvent(state: ConsentState, target?: ConsentEventTarget): boolean {
  const resolved =
    target ?? (typeof window !== 'undefined' ? (window as ConsentEventTarget) : undefined)
  if (!resolved || typeof CustomEvent === 'undefined') {
    return false
  }
  const event = new CustomEvent<ConsentEventDetail>(CONSENT_EVENT, {
    detail: { state },
  })
  return resolved.dispatchEvent(event)
}

/** Eseményből kiolvasott állapot (a provider használja; hiányzó detail → újraolvasás helyett 'unknown'). */
export function consentStateFromEvent(event: Event): ConsentState {
  const detail = (event as CustomEvent<ConsentEventDetail>).detail
  if (detail && (detail.state === CONSENT_GRANTED || detail.state === CONSENT_DENIED)) {
    return detail.state
  }
  return CONSENT_UNKNOWN
}

/** Kényelmi egybefűzés: tárolás + eseményszórás egy lépésben. */
export function updateConsent(
  state: ConsentState,
  storage?: ConsentWriter,
  target?: ConsentEventTarget,
  now?: number,
): boolean {
  const written = writeConsent(state, storage, now)
  dispatchConsentEvent(state, target)
  return written
}

/** A tárolt döntés kora a küszöbhöz mérve. */
export type ConsentFreshness = 'fresh' | 'stale'
export const CONSENT_FRESH: ConsentFreshness = 'fresh'
export const CONSENT_STALE: ConsentFreshness = 'stale'

/**
 * A sáv PILLANATKÉPE egyetlen primitívben: `"<állapot>:<frissesség>"`.
 *
 * Miért string és nem objektum: a ConsentBanner `useSyncExternalStore`-ral
 * olvassa, annak pedig HIVATKOZÁS-STABIL pillanatkép kell — egy minden
 * híváskor újra létrehozott objektum végtelen újrarenderelést okozna. A
 * string értékre egyenlő, tehát stabil.
 */
export type ConsentSnapshot = `${ConsentState}:${ConsentFreshness}`

export function buildConsentSnapshot(
  record: ConsentRecord,
  now: number,
  maxAgeMs?: number,
): ConsentSnapshot {
  const freshness: ConsentFreshness = isConsentExpired(record, now, maxAgeMs)
    ? CONSENT_STALE
    : CONSENT_FRESH
  return `${record.state}:${freshness}`
}

/** Tároló → pillanatkép (állapot + „lejárt-e"), egy olvasásból. */
export function readConsentSnapshot(
  storage?: ConsentReader,
  now: number = Date.now(),
  maxAgeMs?: number,
): ConsentSnapshot {
  return buildConsentSnapshot(readConsentRecord(storage), now, maxAgeMs)
}

/** A pillanatkép állapot-fele. */
export function consentSnapshotState(snapshot: ConsentSnapshot): ConsentState {
  const [state] = snapshot.split(':')
  return parseConsentState(state ?? null)
}

/** Lejárt-e a pillanatképben lévő döntés (kell-e újrakérdezni). */
export function consentSnapshotStale(snapshot: ConsentSnapshot): boolean {
  return snapshot.endsWith(`:${CONSENT_STALE}`)
}

/**
 * 'kc:analytics-consent-open' esemény szórása — a ConsentBanner újranyitását
 * kéri (a visszavonási/módosítási felület). Egyszerű Event (detail nélkül);
 * cél nélkül (SSR) no-op, false-szal tér vissza.
 */
export function dispatchConsentOpenEvent(target?: ConsentEventTarget): boolean {
  const resolved =
    target ?? (typeof window !== 'undefined' ? (window as ConsentEventTarget) : undefined)
  if (!resolved || typeof Event === 'undefined') {
    return false
  }
  return resolved.dispatchEvent(new Event(CONSENT_OPEN_EVENT))
}

/**
 * A consent-banner láthatósági szabálya: 'unknown' állapotban, explicit
 * újranyitásra (a footer „Süti-beállítások" gombja), VAGY ha a tárolt döntés
 * LEJÁRT (kötelező időszakos újrakérdezés, lásd CONSENT_MAX_AGE_DAYS) látszik.
 * `null` = a tárolót még nem olvastuk (SSR/hidrálás) — ilyenkor csak az
 * újranyitás jelenítheti meg (az meg szintén csak kliens-oldali kattintásra
 * igaz).
 *
 * A harmadik paraméter alapértelmezése `false`, hogy a korábbi kétparaméteres
 * hívások (és az őket őrző tesztek) változatlanul érvényesek maradjanak.
 */
export function consentBannerVisible(
  consent: ConsentState | null,
  reopened: boolean,
  expired: boolean = false,
): boolean {
  return reopened || expired || consent === CONSENT_UNKNOWN
}
