/**
 * Induláskori környezeti-változó-ellenőrzés (ENV assert).
 *
 * A kötelező kulcsok listája itt, egy helyen kezelve — új kötelező ENV
 * esetén csak a megfelelő tömbhöz kell hozzáadni a kulcsot: `requiredEnvVars`
 * (minden környezetben kötelező), illetve a párban érvényes kulcsokhoz a
 * `turnstileEnvPair` mintája (élesben konzisztencia-ellenőrzés).
 * A tényleges ellenőrzés az `src/instrumentation.ts` `register()` függvényéből
 * fut le a szerver indulásakor, így hiányzó ENV esetén az app nem indul el.
 *
 * A fájlban SOSEM szerepel érték — csak kulcsnév; a titkok a
 * futtatókörnyezetben élnek. (Kivétel: a `szamlazzVatModes` értékkészlete —
 * az áfakulcs nem titok, hanem közzétett adóügyi kód.)
 */

import { barionPosKeyEnvName, getBarionConfig, logBarionConfigSummary } from './lib/barion/client'
import type { SzamlazzVatMode } from './lib/szamlazz/types'

// Barion-kliens: a BARION_API_URL és BARION_PAYEE_EMAIL minden környezetben
// kötelező (a kliens részletes, környezetfüggő assertja az src/lib/barion/client.ts-ben él,
// élesben az assertRequiredEnv induláskor le is futtatja).
export const requiredEnvVars = [
  'DATABASE_URI',
  'PAYLOAD_SECRET',
  'NEXT_PUBLIC_SERVER_URL',
  'BARION_API_URL',
  'BARION_PAYEE_EMAIL',
] as const

export type RequiredEnvVar = (typeof requiredEnvVars)[number]

/**
 * A publikus szerver-URL fejlesztői tartaléka.
 *
 * Élesben SOSEM ez érvényesül: a `NEXT_PUBLIC_SERVER_URL` a `requiredEnvVars`
 * tagja, tehát hiányában az induláskori assert megállítja az appot. A tartalék
 * a helyi fejlesztésé, a teszteké és azoké a szkripteké, amelyek a
 * payload.configot env-teljes környezet nélkül töltik be.
 */
export const DEFAULT_SERVER_URL = 'http://localhost:3000'

/**
 * A `NEXT_PUBLIC_SERVER_URL` nyers értékének normalizálása; `null`, ha nem
 * használható publikus gyökérként.
 *
 * Elvárás: abszolút `http:`/`https:` URL. A záró perjelet levágjuk, mert a
 * gyökér mindenhol előtagként toldódik hozzá az útvonalhoz (`absoluteUrl`,
 * `metadataBase`), a CORS/CSRF-összehasonlítás pedig karakter-pontos: az
 * `Origin` fejlécben sosincs záró perjel, tehát egy `https://kineticare.hu/`
 * alakú érték NEM illeszkedne a böngésző által küldött eredetre.
 */
export function normalizeServerUrl(rawValue: string | undefined | null): string | null {
  if (typeof rawValue !== 'string') {
    return null
  }
  const trimmed = rawValue.trim()
  if (trimmed.length === 0) {
    return null
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null
  }
  return trimmed.replace(/\/+$/, '')
}

/**
 * A publikus szerver-URL — EGY forrásból.
 *
 * Két fogyasztója van: a storefront `metadataBase`-e
 * (src/app/(frontend)/layout.tsx) és az SEO-segédek `SITE_URL`-je
 * (src/lib/seo.ts). Korábban mindkét helyen külön állt ugyanaz a
 * `process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:3000'` kifejezés —
 * a párhuzamos forrás azzal a kockázattal jár, hogy a kanonikus URL és a
 * CORS/CSRF-engedélylista szétcsúszik.
 *
 * A CORS/CSRF-lista NEM ezt hívja, hanem a `buildOriginAllowlist`-et — de
 * UGYANABBÓL az env-értékből, ugyanazzal a normalizálással.
 *
 * A Payload `serverURL`-je SZÁNDÉKOSAN ÜRES marad; az indoklás (media-URL
 * abszolutizálás → next/image 400) a src/payload.config.ts-ben.
 *
 * A függvény SOSEM dob: a payload.config modul-betöltéskor hívja, és egy hibás
 * env miatt a config betöltése (tehát a teszt- és szkript-futás is) nem
 * hasalhat el. A hibás alak nem marad némán rossz: az induláskori
 * `assertRequiredEnv` külön, magyar hibaüzenettel megállítja az appot.
 */
export function resolveServerUrl(): string {
  return normalizeServerUrl(process.env.NEXT_PUBLIC_SERVER_URL) ?? DEFAULT_SERVER_URL
}

/**
 * CORS/CSRF-engedélylista a nyers env-ből. Origin (séma+hoszt+port), nem
 * teljes URL. Minden hívás új tömb — a Payload a csrf listába beleírhat.
 * Railway-primer mellett a kineticare.hu párt EXTRA_ALLOWED_ORIGINS kell.
 */
const LIVE_SITE_HOSTS = new Set(['kineticare.hu', 'www.kineticare.hu'])

function companionLiveOrigin(primary: URL): string | null {
  const host = primary.hostname
  if (!LIVE_SITE_HOSTS.has(host)) {
    return null
  }
  const companionHost = host === 'www.kineticare.hu' ? 'kineticare.hu' : 'www.kineticare.hu'
  const companion = new URL(`https://${companionHost}`)
  // A `URL.port` csak nem-alapértelmezett portnál nem üres — az éles :443
  // így port nélkül marad, a staging-szerű :8443 átmegy a társra is.
  if (primary.port !== '') {
    companion.port = primary.port
  }
  return companion.origin
}

function parseExtraOrigins(extraRaw: string | undefined | null): string[] {
  if (typeof extraRaw !== 'string') {
    return []
  }
  const origins: string[] = []
  for (const token of extraRaw.split(',')) {
    const normalized = normalizeServerUrl(token)
    if (normalized === null) {
      continue
    }
    origins.push(new URL(normalized).origin)
  }
  return origins
}

export function buildOriginAllowlist(
  rawValue: string | undefined | null,
  extraRaw?: string | undefined | null,
): string[] {
  const serverUrl = normalizeServerUrl(rawValue) ?? DEFAULT_SERVER_URL
  const primaryUrl = new URL(serverUrl)
  const list: string[] = [primaryUrl.origin]

  const companion = companionLiveOrigin(primaryUrl)
  if (companion !== null && !list.includes(companion)) {
    list.push(companion)
  }

  for (const extra of parseExtraOrigins(extraRaw)) {
    if (!list.includes(extra)) {
      list.push(extra)
    }
  }

  return list
}

/**
 * Cloudflare Turnstile (kapcsolat-űrlap spam-védelem) — PÁRBAN érvényes kulcsok.
 *
 * - `TURNSTILE_SITE_KEY` — a kliensoldali widget kulcsa (a /kapcsolat oldal
 *   szerver-oldalon olvassa kérés-időben; hiányában a widget nem kerül a DOM-ba).
 * - `TURNSTILE_SECRET_KEY` — TITOK, a szerveri ellenőrzés kulcsa; hiányában a
 *   `verifyTurnstile` (src/payload.config.ts) korán visszatér.
 *
 * Élesben (NODE_ENV=production) az induláskori assert a pár KONZISZTENCIÁJÁT
 * követeli meg, mert a fél-lábas állapot mindkét iránya hibás:
 * - site key secret nélkül → a widget látszik, de a szerver némán mindent
 *   átenged (csendben kikapcsolt védelem);
 * - secret site key nélkül → a szerver tokent vár, amit a kliens sosem küld,
 *   tehát minden beküldés elakad.
 * Ha EGYIK sincs beállítva, az app elindul (a Turnstile még nincs élesítve),
 * de induláskori warn-riasztás jelzi, hogy a nyilvános, e-mailt küldő
 * form-submissions végpont egyetlen féke az IP-keret. Az élesítéshez MINDKÉT
 * kulcsot be kell állítani — egyik sem NEXT_PUBLIC_, tehát újrabuild nem kell.
 *
 * Az értéket ide SOSEM írjuk: a kulcsnevek az `.env.example`-ben szerepelnek,
 * a tényleges titok kizárólag a futtatókörnyezetben él.
 */
export const turnstileEnvPair = ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'] as const

/**
 * Számlázz.hu tétel-áfakulcs (`SZAMLAZZ_AFAKULCS`) — OPCIONÁLIS kulcs, de ha
 * meg van adva, csak ezek az értékek érvényesek.
 *
 * Ez a tömb a `SzamlazzVatMode` (src/lib/szamlazz/types.ts) union futásidejű
 * párja — a `satisfies` fordításkor őrzi, hogy a kettő ne csúszhasson szét. Az
 * értékkészlet EGY helyen él: a Számlázz-kliens (src/lib/szamlazz/client.ts)
 * innen olvassa, nem másolja.
 *
 * - `'27'` — általános 27%-os áfa (ez az alapértelmezés a kulcs HIÁNYÁBAN is);
 * - `'AAM'` — alanyi adómentes eladó (belföldön kizárólag ez a kulcs jogszerű).
 *
 * Miért induláskori assert: a `getSzamlazzConfig` csak LUSTÁN, az első
 * számlázási művelet közben futna le, ott pedig a hiba a jobban vagy a
 * rendelés-visszaigazoló e-mail try/catch-ében nyelődne el — egy elgépelt
 * áfakulcs így akár hetekig észrevétlen maradhatna, miközben egyetlen számla
 * sem készül el. Ezért a hibás érték MÁR INDULÁSKOR megállítja az appot,
 * minden környezetben. A kulcs hiánya változatlanul rendben van.
 */
export const szamlazzVatModes = ['27', 'AAM'] as const satisfies readonly SzamlazzVatMode[]

/** A `SZAMLAZZ_AFAKULCS` nyers értékének beszűkítése a támogatott áfakulcsokra. */
export function isSzamlazzVatMode(value: string): value is SzamlazzVatMode {
  return (szamlazzVatModes as readonly string[]).includes(value)
}

/**
 * Bunny Stream (videó-kiszolgálás) — mind OPCIONÁLIS, szándékosan NEM
 * induláskori kötelező kulcs: a hiányuk nem dönti el az appot, hanem
 * kérés-időben, lazy módon derül ki (503 + magyar üzenet a token-végponton,
 * `null` embed-URL → magyar „nem érhető el" a lejátszóban). Így a rendszer a
 * kulcsok megérkezése ELŐTT is elindul és használható; a videó élesítése
 * kizárólag Railway-env-beállítás + újrabuild (a NEXT_PUBLIC_ kulcsok a build
 * pillanatában égnek bele az oldalba).
 *
 * - `BUNNY_STREAM_TOKEN_AUTH_KEY` — TITOK, a védett library token-kulcsa
 *   (src/lib/stream/issue-stream-token.ts).
 * - `BUNNY_STREAM_LIBRARY_API_KEY` — TITOK, a védett library Stream API
 *   kulcsa (videólista; NEM a lejátszási token-kulcs).
 * - `BUNNY_STREAM_PUBLIC_LIBRARY_API_KEY` — TITOK, a publikus library
 *   Stream API kulcsa (előzetesek listája).
 * - `NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID` — a védett library id-ja (embed-URL).
 * - `NEXT_PUBLIC_BUNNY_STREAM_PUBLIC_LIBRARY_ID` — a publikus library id-ja
 *   (hero-videó, kurzus-előzetes — token nélkül).
 * - `NEXT_PUBLIC_BUNNY_STREAM_PULL_ZONE_HOST` — `vz-….b-cdn.net`, a CSP
 *   img-src/media-src forrása és a poszterképek hosztja.
 */
export const optionalBunnyStreamEnvVars = [
  'BUNNY_STREAM_TOKEN_AUTH_KEY',
  'BUNNY_STREAM_LIBRARY_API_KEY',
  'BUNNY_STREAM_PUBLIC_LIBRARY_API_KEY',
  'NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID',
  'NEXT_PUBLIC_BUNNY_STREAM_PUBLIC_LIBRARY_ID',
  'NEXT_PUBLIC_BUNNY_STREAM_PULL_ZONE_HOST',
] as const

/**
 * Analitika (PostHog + Google Analytics 4) — mind OPCIONÁLIS, szándékosan NEM
 * induláskori kötelező kulcs: hiányukban a mérés teljes egészében no-op, az
 * app és a felület változatlanul működik.
 *
 * Ezek `NEXT_PUBLIC_` kulcsok, tehát a BUILD pillanatában égnek bele az
 * oldalba — beállításuk után ÚJRA KELL BUILDELNI (a CSP-fejléc is build-időben
 * dől el, lásd src/lib/security/csp.ts).
 *
 * - `NEXT_PUBLIC_POSTHOG_KEY` — a PostHog nyilvános projekt-kulcsa (docs/posthog.md).
 * - `NEXT_PUBLIC_POSTHOG_HOST` — felülírható PostHog-host (alap: EU-cloud).
 * - `NEXT_PUBLIC_GA_MEASUREMENT_ID` — GA4 mérési azonosító (`G-…`, docs/ga4.md).
 * - `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` — Search Console domain-ellenőrző
 *   meta (nyilvános, nem titok). Üres = nincs `verification.google` a layoutban.
 * - `NEXT_PUBLIC_GOOGLE_ADS_ID` — Google Ads konverzió-azonosító (`AW-…`).
 *   Csak a kulcsnév van regisztrálva; a kód NEM nyit `ad_storage` sütit, amíg
 *   a docs/ga4.md tiltása él. Üresen kell hagyni.
 *   Egyik sem titok: nyilvános, kliensoldali azonosítók.
 *
 * Ide tartozik még a `POSTHOG_SHARED_DASHBOARD_URL` is (nem NEXT_PUBLIC,
 * szerveroldali): az admin Webanalitika-fül beágyazott PostHog-dashboardjának
 * megosztási linkje (src/lib/admin/web-analytics-config.ts). Nem titok — a
 * megosztott dashboard a link birtokában amúgy is megnyitható, ezért csak
 * összesített viselkedés-adat lehet rajta. A CSP-fejléc miatt a beállítása
 * után szintén újrabuild kell.
 */
export const optionalAnalyticsEnvVars = [
  'NEXT_PUBLIC_POSTHOG_KEY',
  'NEXT_PUBLIC_POSTHOG_HOST',
  'NEXT_PUBLIC_GA_MEASUREMENT_ID',
  'NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION',
  'NEXT_PUBLIC_GOOGLE_ADS_ID',
] as const

/**
 * Extra CORS/CSRF eredetek — OPCIONÁLIS, nem induláskori kötelező.
 * A tiszta `buildOriginAllowlist` második argumentuma; érték nélkül a lista
 * csak a primer gyökér (+ kineticare apex/www társ, ha a primer már az).
 * DNS-cutover: docs/kineticare-hu-atallas.md.
 */
export const optionalOriginEnvVars = ['EXTRA_ALLOWED_ORIGINS'] as const

/**
 * A Barion POSKey környezetfüggő: BARION_ENVIRONMENT=prod esetén az éles
 * kulcs (BARION_POSKEY_PROD), egyébként (alapértelmezett test) a tesztkulcs
 * (BARION_POSKEY_TEST) kötelező — így stagingen nem kell éles kulcs, élesben
 * pedig nem indul az app tesztkulccsal. A hiányzó kulcs néven nevezve kerül a
 * hiánylistába, tehát a `prod` környezet + hiányzó BARION_POSKEY_PROD páros
 * beszédes indulási hibát ad (és élesben a BARION_ENVIRONMENT megléte is
 * kötelező — lásd assertRequiredEnv).
 *
 * Az értéket ugyanúgy levágva (trim) hasonlítjuk, mint a Barion-kliens
 * (src/lib/barion/client.ts). Enélkül egy ' prod ' érték mellett itt a
 * TESZT-kulcsot követelnénk meg, a kliens viszont az ÉLES kulcsot használná.
 */
function requiredBarionPosKeyEnv(): string {
  return barionPosKeyEnvName(process.env.BARION_ENVIRONMENT?.trim() === 'prod' ? 'prod' : 'test')
}

/** A publikus szerver-URL az éles oldal (kineticare.hu vagy www.kineticare.hu) címe-e. */
function isLiveSiteUrl(rawValue: string | undefined): boolean {
  const normalized = normalizeServerUrl(rawValue)
  return normalized !== null && LIVE_SITE_HOSTS.has(new URL(normalized).hostname)
}

/** Ki van-e töltve (nem üres) a környezeti változó? */
function isEnvSet(key: string): boolean {
  const value = process.env[key]
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Éles futás-e. A `NODE_ENV` a Next.js production buildjében/indításában
 * ('next build' + 'next start') automatikusan 'production' — a tesztek és a
 * fejlesztői szerver nem ezen az ágon futnak.
 */
function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production'
}

export function assertRequiredEnv(
  warn?: (message: string, context?: Record<string, unknown>) => void,
): void {
  const missing: string[] = requiredEnvVars.filter((key) => !isEnvSet(key))

  const posKeyEnv = requiredBarionPosKeyEnv()
  if (!isEnvSet(posKeyEnv)) {
    missing.push(posKeyEnv)
  }

  if (missing.length > 0) {
    throw new Error(
      `Az alkalmazás nem indulhat el. Hiányzó kötelező környezeti változó(k): ${missing.join(', ')}. ` +
        'Állítsd be őket a környezetben (pl. helyben .env fájlban), majd indítsd újra a szervert.',
    )
  }

  // NEXT_PUBLIC_SERVER_URL: a megléte fent már ellenőrzött, itt az ALAKJA a
  // tét. Hibás alak (séma nélküli hoszt, elgépelt cím) esetén a Payload
  // CORS/CSRF-allowlistje olyan értékre állna, amire a böngésző `Origin`
  // fejléce sosem illeszkedik: az admin-bejelentkezés CSENDBEN, magyarázat
  // nélkül hasalna el, a `metadataBase` pedig kérés-időben dobna. Ezért itt,
  // induláskor bukik el hangosan — minden környezetben.
  const rawServerUrl = process.env.NEXT_PUBLIC_SERVER_URL
  if (normalizeServerUrl(rawServerUrl) === null) {
    throw new Error(
      `Az alkalmazás nem indulhat el. Érvénytelen NEXT_PUBLIC_SERVER_URL ('${rawServerUrl?.trim() ?? ''}'): ` +
        'teljes, abszolút webcím kell, http:// vagy https:// előtaggal ' +
        `(pl. '${DEFAULT_SERVER_URL}'). Erre az értékre épül a CORS/CSRF-engedélylista, ` +
        'a kanonikus oldal-URL és a megosztási képek címe.',
    )
  }

  // SZAMLAZZ_AFAKULCS: opcionális, de ha meg van adva, MOST kell hangosan
  // buknia — nem az első számlázási művelet mélyén, a job/e-mail try/catch-ében.
  const vatMode = process.env.SZAMLAZZ_AFAKULCS?.trim()
  if (vatMode !== undefined && vatMode !== '' && !isSzamlazzVatMode(vatMode)) {
    throw new Error(
      `Az alkalmazás nem indulhat el. Érvénytelen SZAMLAZZ_AFAKULCS ('${vatMode}'): csak ` +
        `${szamlazzVatModes.map((mode) => `'${mode}'`).join(' vagy ')} lehet. Alanyi adómentes ` +
        `eladóként az 'AAM' a jogszerű; általános esetben hagyd üresen (alapértelmezés: 27).`,
    )
  }

  // EMAIL_FROM kötelező, ha van levélküldő — különben `noreply@localhost` és csendes küldési hiba.
  const emailFrom = process.env.EMAIL_FROM?.trim()
  const vanLevelkuldo = isEnvSet('RESEND_API_KEY') || isEnvSet('SMTP_HOST')
  if (vanLevelkuldo && (emailFrom === undefined || !emailFrom.includes('@'))) {
    throw new Error(
      'Az alkalmazás nem indulhat el. Be van állítva levélküldő ' +
        '(RESEND_API_KEY vagy SMTP_HOST), de az EMAIL_FROM hiányzik vagy nem ' +
        `e-mail-cím ('${emailFrom ?? ''}'). Enélkül a levelek a 'noreply@localhost' ` +
        'tartalék címről indulnának, amit a szolgáltató elutasít — és mivel a ' +
        'küldés sosem dob hibát, a levelek CSENDBEN nem érkeznének meg. ' +
        'Add meg a küldő címet, pl. EMAIL_FROM="Kineticare <noreply@kineticare.hu>", ' +
        'olyan tartománnyal, amit a levélküldőben igazoltál.',
    )
  }

  if (isProductionRuntime()) {
    // BARION_ENVIRONMENT élesben kötelező — hiányában a kliens némán test-re esik vissza.
    if (!isEnvSet('BARION_ENVIRONMENT')) {
      throw new Error(
        'Az alkalmazás nem indulhat el. Éles futásban (NODE_ENV=production) a BARION_ENVIRONMENT ' +
          "változó kötelező ('test' vagy 'prod'). Hiánya NEM ártalmatlan: a rendszer ilyenkor " +
          'némán a Barion TESZT-környezetét használná, tehát a vásárlók fizetése sosem érkezne ' +
          'meg. Állítsd be a változót (éles boltnál: prod) a BARION_API_URL-lel összhangban ' +
          '(prod → https://api.barion.com), majd indítsd újra a szervert.',
      )
    }

    // A Barion-konfiguráció teljes feloldása már induláskor: a környezet és az
    // API-hoszt összeillése és a POSKey alakja itt bukik el hangosan, nem az
    // első vásárlónál (ott a pénztár csak általános hibát mutatna). A hibaüzenet
    // a kulcs értékét soha nem tartalmazza (src/lib/barion/client.ts).
    const barionConfig = getBarionConfig(process.env)
    logBarionConfigSummary(barionConfig)
    if (barionConfig.environment === 'test' && isLiveSiteUrl(rawServerUrl)) {
      warn?.('barion_teszt_kornyezet_az_eles_oldalon', {
        reszletek:
          'Az oldal az éles címen fut (NEXT_PUBLIC_SERVER_URL), de a BARION_ENVIRONMENT értéke ' +
          'test: a vásárlók a Barion teszt-környezetében fizetnek, valódi pénz nem érkezik. ' +
          'Élesítés: BARION_ENVIRONMENT=prod, BARION_API_URL=https://api.barion.com és a bolt ' +
          'titkos kulcsa a BARION_POSKEY_PROD változóban.',
      })
    }

    // ENABLE_JOB_WORKERS nélkül nincs webhook-retry / order-poll — figyelmeztetés, nem boot-hiba.
    if (process.env.ENABLE_JOB_WORKERS !== 'true') {
      warn?.('job_workerek_kikapcsolva', {
        reszletek:
          'Az ENABLE_JOB_WORKERS nincs "true" értéken: élesben nem fut a webhook-retry, az ' +
          'order-poll és a számla-resweep. Elveszett Barion-callback esetén a rendelés ' +
          'payment_pending-ben ragadna, és a számlák sem állítódnának újra sorba. ' +
          'Nézd meg a Railway env-t (staging + prod). Élesítés: ENABLE_JOB_WORKERS=true. ' +
          'Fail-closed boot szándékosan nincs: a hiányzó flag ne vigye el a boltot.',
      })
    }

    const [siteKeyEnv, secretKeyEnv] = turnstileEnvPair
    const siteSet = isEnvSet(siteKeyEnv)
    const secretSet = isEnvSet(secretKeyEnv)
    if (siteSet !== secretSet) {
      throw new Error(
        `Az alkalmazás nem indulhat el. Fél-lábas Turnstile-konfiguráció: csak a(z) ${siteSet ? siteKeyEnv : secretKeyEnv} van beállítva. ` +
          `A spam-védelem csak PÁRBAN működik (${turnstileEnvPair.join(' + ')}) — állítsd be mindkettőt, vagy kapcsold ki mindkettő törlésével.`,
      )
    }
    if (!siteSet) {
      warn?.('turnstile_kikapcsolva', {
        reszletek:
          'Egyik Turnstile-kulcs sincs beállítva — a kapcsolat-űrlapot élesben csak az IP-keret védi. Élesítés: TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY beállítása (újrabuild nem kell).',
      })
    }
  }
}
