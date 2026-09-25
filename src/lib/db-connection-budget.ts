import type { Logger } from './logger'

/**
 * A `pg` pool mérete és a Postgres kapcsolat-keretének induláskori mérése.
 *
 * MIÉRT 20 (a-callback-7, a-szamlazz-11): a `pg` alapértelmezett 10-e kevés
 * volt. Egy callback-átmenet csúcsán egy kérés akár 4 kapcsolatot fog
 * (session-zár, rendelés-zár, ügyfél-zár, lekérdezés), egy számla-job 2–3-at;
 * négy ilyen egyszerre elfogyasztotta a 10-et, és a teljes oldal a 10 s-os
 * connectionTimeoutMillis-ig állt.
 *
 * MIÉRT MÉRÜNK (AGENTS.md, Codex, PR #307): a pool mérete csak a Railway
 * Postgres `max_connections`-éhez mérve állítható. A Postgres-c8Rg
 * szolgáltatás nem ír felül `max_connections`-t (a postgres-ssl:18 image
 * alapértéke él, amelyet az initdb a konténer osztott memóriájához választ),
 * ezért a tényleges értéket minden induláskor lekérdezzük, és a deploy-napló
 * mérési sora mutatja. Ha két konténer (a deploy alatt a régi és az új egyszerre
 * fut, railway.json numReplicas: 1) poolja és a tartalék nem fér bele,
 * RIASZTÁS szól. Replika- vagy pool-emelés előtt ezt a sort kell megnézni.
 */

/** A `pg` pool felső korlátja (payload.config.ts `pool.max`). */
export const PG_POOL_MAX = 20

/** Egyszerre ennyi konténer tarthat poolt: deploy alatt a régi és az új. */
export const PG_POOL_CONTAINERS = 2

/**
 * Tartalék a poolokon felül: a Postgres `superuser_reserved_connections`-e
 * (alapból 3), a start-parancs `payload migrate`-je, a mentés (db-backup.yml)
 * és egy kézi psql-kapcsolat.
 */
export const PG_CONNECTION_RESERVE = 10

/** Ennyi kapcsolatot kell a Postgresnek engednie a megadott poolmérethez. */
export function requiredConnections(poolMax: number = PG_POOL_MAX): number {
  return PG_POOL_CONTAINERS * poolMax + PG_CONNECTION_RESERVE
}

interface QueryablePool {
  query(text: string): Promise<unknown>
}

function isQueryablePool(pool: unknown): pool is QueryablePool {
  return (
    typeof pool === 'object' &&
    pool !== null &&
    typeof (pool as { query?: unknown }).query === 'function'
  )
}

function readMaxConnections(result: unknown): number | null {
  const rows =
    typeof result === 'object' && result !== null ? (result as { rows?: unknown }).rows : undefined
  const row: unknown = Array.isArray(rows) ? rows[0] : undefined
  const value =
    typeof row === 'object' && row !== null
      ? (row as Record<string, unknown>).max_connections
      : undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/**
 * A `max_connections` mérése és összevetése a pool igényével. Nem dob: a
 * mérés hibája csak figyelmeztetés, az indulást nem akaszthatja meg.
 */
export async function checkConnectionBudget(
  pool: unknown,
  log: Logger,
  poolMax: number = PG_POOL_MAX,
): Promise<void> {
  if (!isQueryablePool(pool)) {
    return
  }
  let maxConnections: number | null
  try {
    maxConnections = readMaxConnections(
      await pool.query("select current_setting('max_connections')::int as max_connections"),
    )
  } catch (error) {
    log.warn('a Postgres max_connections induláskor nem mérhető', {
      error: error instanceof Error ? error.message : String(error),
    })
    return
  }
  if (maxConnections === null) {
    log.warn('a Postgres max_connections induláskor nem mérhető: a válasz nem értelmezhető')
    return
  }
  const needed = requiredConnections(poolMax)
  const context = { maxConnections, poolMax, containers: PG_POOL_CONTAINERS, needed }
  if (needed > maxConnections) {
    log.error(
      'RIASZTÁS: a Postgres max_connections kevesebb, mint amennyi két konténer (deploy-átfedés) ' +
        'poolja és a tartalék együtt igényel: deploy alatt vagy terhelésnél a kapcsolatfelvétel ' +
        'elbukhat, és az oldal, a callbackek és a jobok egyszerre állhatnak meg. Csökkentsd a ' +
        'pool.max-ot (src/lib/db-connection-budget.ts), vagy emeld a max_connections-t a ' +
        'Postgres-szolgáltatáson.',
      context,
    )
    return
  }
  log.info('Postgres kapcsolat-keret mérve', context)
}
