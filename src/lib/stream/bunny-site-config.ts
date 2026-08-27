/**
 * A Kineticare éles Bunny Stream tárainak NYILVÁNOS azonosítói.
 *
 * Ezek minden embed-URL-ben látszanak, nem titkok. A Railway
 * `NEXT_PUBLIC_*` értéke felülírja őket (staging / másik tár).
 * Hiányzó env mellett is legyen mit beégetni a buildbe: enélkül a
 * lejátszó akkor is sötét marad, ha a token-kulcs már a szerveren van.
 *
 * Titkok (API-kulcs, token-auth kulcs) IDE NEM KERÜLHETNEK.
 */

/** Védett tár: kurzus-epizódok, jegy kell. Stream library id 469119. */
export const BUNNY_PROTECTED_LIBRARY_ID = '469119'

/** Publikus tár: előzetes / hero, jegy nélkül. 2026-08-27-én létrehozva. */
export const BUNNY_PUBLIC_LIBRARY_ID = '738433'

/** A védett tár pull-zone hosztja (CSP + poszter). */
export const BUNNY_PROTECTED_PULL_ZONE_HOST = 'vz-66c8b310-71c.b-cdn.net'

/** A publikus tár pull-zone hosztja (előzetes-poszter, ha kell). */
export const BUNNY_PUBLIC_PULL_ZONE_HOST = 'vz-c34b0b8b-c9e.b-cdn.net'

function trimmedEnv(name: string): string {
  const raw = typeof process.env[name] === 'string' ? process.env[name].trim() : ''
  return raw
}

/** A védett library id: env, különben az éles Kineticare-tár. */
export function bunnyProtectedLibraryId(): string {
  return trimmedEnv('NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID') || BUNNY_PROTECTED_LIBRARY_ID
}

/** A publikus library id: env, különben az éles KINETICARE-PUBLIC tár. */
export function bunnyPublicLibraryId(): string {
  return trimmedEnv('NEXT_PUBLIC_BUNNY_STREAM_PUBLIC_LIBRARY_ID') || BUNNY_PUBLIC_LIBRARY_ID
}

/**
 * A CSP / poszter pull-zone hosztja.
 * Env nélkül a védett tár hosztja: a kurzuslejátszó poszterképei onnan jönnek.
 */
export function bunnyPullZoneHost(): string {
  return trimmedEnv('NEXT_PUBLIC_BUNNY_STREAM_PULL_ZONE_HOST') || BUNNY_PROTECTED_PULL_ZONE_HOST
}
