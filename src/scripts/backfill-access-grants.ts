/**
 * CLI: accessGrants backfill időkorlátos purchasesre.
 *
 *   npm run backfill:access-grants
 *     → próbafutás; kiírja, mit tenne, és MIÉRT hagy ki bármit.
 *   OWNER_BACKFILL_CONFIRM=igen npm run backfill:access-grants
 *     → tényleges írás; a végén OWNER_BACKFILL_OK.
 *
 * Útmutató: docs/access-grants-backfill.md
 * A tiszta szabály és a vezérlés: src/lib/access-grants-backfill.ts
 */

import { pathToFileURL } from 'node:url'

import { getPayload } from 'payload'

import {
  ACCESS_GRANT_BACKFILL_USER_MAX,
  formazdAccessGrantJelentest,
  futtatAccessGrantBackfill,
  parseMaxKapcsolo,
} from '../lib/access-grants-backfill'
import { createLogger } from '../lib/logger'
import config from '../payload.config'

const kapuNyitva = (nev: string): boolean => process.env[nev]?.trim().toLowerCase() === 'igen'

const log = createLogger({ script: 'backfill-access-grants' })

async function futtat(): Promise<void> {
  const dryRun = !kapuNyitva('OWNER_BACKFILL_CONFIRM')
  const maxUser = parseMaxKapcsolo(process.argv.slice(2), ACCESS_GRANT_BACKFILL_USER_MAX)

  log.info(
    dryRun
      ? 'accessGrants backfill: PRÓBAFUTÁS indul (OWNER_BACKFILL_CONFIRM=igen nélkül semmi nem íródik).'
      : 'accessGrants backfill: ÉLES futás indul (OWNER_BACKFILL_CONFIRM=igen). Remélem, futott előtte `npm run backup:db`.',
  )

  const payload = await getPayload({ config })
  const jelentes = await futtatAccessGrantBackfill({ payload, dryRun, maxUser, log })

  for (const sor of formazdAccessGrantJelentest(jelentes)) {
    log.info(sor)
  }

  if (
    jelentes.irasHibak.length > 0 ||
    jelentes.csonkoltUser ||
    jelentes.csonkoltOrder ||
    jelentes.csonkoltProduct
  ) {
    process.exitCode = 1
    return
  }
  if (!dryRun) {
    log.info('OWNER_BACKFILL_OK')
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  futtat()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error: unknown) => {
      log.error('accessGrants backfill: hiba történt.', {
        error: error instanceof Error ? error.message : String(error),
      })
      process.exit(1)
    })
}
