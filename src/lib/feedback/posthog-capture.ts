/**
 * Visszajelzés-doboz (WP65) — SZERVER-SZERVER PostHog-capture.
 *
 * MIÉRT NEM A KLIENSBŐL MEGY. A `src/lib/analytics/posthog.ts` CONSENT-FIRST:
 * a PostHog-kliens KIZÁRÓLAG analytics-hozzájárulás után inicializálódik
 * (`initPostHog` kapuja), a `captureAnalyticsEvent` pedig init nélkül NÉMA
 * no-op. Vagyis minden látogatónál, aki a süti-sávot elutasította vagy még nem
 * válaszolt rá, a kliens-oldali capture nyom nélkül elveszne — és pontosan
 * azok a bejelentések vesznének el, amiket a tulajdonos kért. A második ok a
 * reklámblokkolók: a `/ingest` elsőfél-proxy sokat segít, de nem mindent old
 * meg, egy hibabejelentő eszköznél viszont a néma veszteség elfogadhatatlan.
 *
 * Ezért a végpont SZERVERRŐL, `fetch`-csel küldi az eseményt. A tartalmi
 * biztonsági szabály (CSP) ezt nem érinti: a `src/lib/security/csp.ts`
 * `connect-src 'self'` a BÖNGÉSZŐ kimenő kéréseit köti, a szerver-szerver
 * hívásra semmilyen hatása nincs.
 *
 * ADATVÉDELMI KERET. A hozzájárulás hiánya itt NEM követés: a látogató maga
 * gépeli be és maga küldi el a bejelentést (ez a doboz teljes célja), az
 * azonosító pedig hozzájárulás nélkül véletlen, egyszer használatos anonim
 * érték — visszakötni senkire nem lehet. Person-profil így nem keletkezik.
 *
 * VÉGPONT ÉS TÖRZS (hivatalos dokumentáció, https://posthog.com/docs/api/capture,
 * ellenőrizve 2026-09-21). A curl-példa szó szerint:
 *
 *   curl -v -L --header "Content-Type: application/json" -d '{
 *     "api_key": "<ph_project_token>",
 *     "event": "event name",
 *     "distinct_id": "user distinct id",
 *     "properties": { "account_type": "pro" },
 *     "timestamp": "[optional timestamp in ISO 8601 format]"
 *   }' https://us.i.posthog.com/i/v0/e/
 *
 * A doksi szövege: „Every event request must contain an `api_key`,
 * `distinct_id`, and `event` field with the name." Az EGYETLEN esemény útja
 * tehát `/i/v0/e/`, a `/batch/` a kötegelt alak — nem találgatunk közöttük.
 * A mi hostunk az EU-cloud (`POSTHOG_HOST`, alapértelmezés
 * https://eu.i.posthog.com), a kulcs a már meglévő, publikus
 * `NEXT_PUBLIC_POSTHOG_KEY` — ÚJ TITOK NEM KELL hozzá.
 */

// A TISZTA konfig-modulból importálunk (nem a `../analytics/posthog`-ból),
// mert az a böngésző-SDK-t (`posthog-js`) is behúzná ebbe a szerveroldali útba.
import { POSTHOG_HOST, POSTHOG_KEY } from '../analytics/posthog-config'

/** Az egy-eseményes capture útvonala a host után (lásd a fejléc doksi-idézetét). */
export const POSTHOG_CAPTURE_PATH = '/i/v0/e/'

/**
 * Kimenő időkorlát. A látogató kérése SOHA nem várhat egy lassú PostHogra:
 * a bejelentést már begépelte, a válasznak azonnal jönnie kell.
 */
export const POSTHOG_CAPTURE_TIMEOUT_MS = 5_000

/** A `fetch` injektálható alakja — teszt SOSEM indíthat valódi hálózati hívást. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/**
 * A capture kimenete. Szándékosan NEM dob: a hívó eldöntheti, hogy naplóz,
 * de a látogató beküldése akkor sem bukhat el, ha az analitika nem érhető el.
 */
export type PostHogCaptureEredmeny =
  | { readonly allapot: 'rogzitve' }
  | { readonly allapot: 'kihagyva'; readonly ok: string }
  | { readonly allapot: 'hiba'; readonly ok: string }

export type PostHogCapture = (
  event: string,
  distinctId: string,
  properties: Readonly<Record<string, unknown>>,
) => Promise<PostHogCaptureEredmeny>

export interface PostHogCaptureOptions {
  /** A kimenő hívó; alapból a futtatókörnyezet `fetch`-e. */
  readonly fetchFn?: FetchLike
  /** Projekt-kulcs; üresen a capture no-op marad. */
  readonly apiKey?: string
  /** PostHog-host; alapból a `POSTHOG_HOST` (EU-cloud). */
  readonly host?: string
  /** Injektálható óra a `timestamp` mezőhöz (teszthez). */
  readonly now?: () => Date
  /** Kimenő időkorlát ezredmásodpercben. */
  readonly timeoutMs?: number
}

/** Üzemeltetési magyarázat a naplóba, ha nincs beállítva kulcs. */
export const POSTHOG_NINCS_BEALLITVA = 'PostHog nincs beállítva'

function hibaSzoveg(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Kicsi, injektálható PostHog-kliens. A `fetchFn`, a kulcs, a host és az óra
 * mind kívülről adható, ezért a teljes viselkedés mérhető hálózat nélkül.
 *
 * Kulcs nélkül NEM hív semmit: `kihagyva` eredménnyel tér vissza, amit a hívó
 * naplóz. Ugyanaz a filozófia, mint a többi opcionális integrációnál (e-mail,
 * Számlázz.hu): a hiányzó konfiguráció nem hiba, csak kikapcsolt funkció.
 */
export function createPostHogCapture(options: PostHogCaptureOptions = {}): PostHogCapture {
  const apiKey = (options.apiKey ?? POSTHOG_KEY).trim()
  const host = (options.host ?? POSTHOG_HOST).replace(/\/+$/, '')
  const now = options.now ?? (() => new Date())
  const timeoutMs = options.timeoutMs ?? POSTHOG_CAPTURE_TIMEOUT_MS

  return async function capture(event, distinctId, properties) {
    if (apiKey.length === 0) {
      return { allapot: 'kihagyva', ok: POSTHOG_NINCS_BEALLITVA }
    }

    const fetchFn = options.fetchFn ?? fetch
    try {
      const response = await fetchFn(`${host}${POSTHOG_CAPTURE_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          event,
          distinct_id: distinctId,
          properties,
          timestamp: now().toISOString(),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) {
        return { allapot: 'hiba', ok: `HTTP ${response.status}` }
      }
      return { allapot: 'rogzitve' }
    } catch (error) {
      return { allapot: 'hiba', ok: hibaSzoveg(error) }
    }
  }
}
