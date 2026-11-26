/**
 * CLI: a „Csuklófájdalom témakurzus” minta létrehozása piszkozatként.
 *
 *   npm run temakurzus:minta
 *     → próbafutás; kiírja, mit hozna létre, és ha nem, miért nem.
 *   OWNER_TEMAKURZUS_CONFIRM=igen npm run temakurzus:minta
 *     → tényleges írás; a minta piszkozat és rejtett, a látogató nem látja.
 *
 * Útmutató: docs/szerkesztoi-utmutato.md, „Témakurzus készítése”.
 * A szabály: src/lib/temakurzus-minta.ts, a vezérlés: src/lib/temakurzus-minta-futtatas.ts
 */

import { pathToFileURL } from 'node:url'

import { getPayload } from 'payload'

import { createLogger } from '../lib/logger'
import { futtatCsukloMinta } from '../lib/temakurzus-minta-futtatas'
import config from '../payload.config'

const kapuNyitva = (nev: string): boolean => process.env[nev]?.trim().toLowerCase() === 'igen'

const log = createLogger({ script: 'temakurzus-minta' })

async function futtat(): Promise<void> {
  const dryRun = !kapuNyitva('OWNER_TEMAKURZUS_CONFIRM')
  log.info(
    dryRun
      ? 'temakurzus-minta: PRÓBAFUTÁS (OWNER_TEMAKURZUS_CONFIRM=igen nélkül semmi nem íródik).'
      : 'temakurzus-minta: ÉLES futás (OWNER_TEMAKURZUS_CONFIRM=igen).',
  )
  const payload = await getPayload({ config })
  const { terv, letrehozottId } = await futtatCsukloMinta({ payload, dryRun, log })
  if (terv.allapot === 'NINCS_PROGRAM' || terv.allapot === 'HIANYZO_LECKE') {
    process.exitCode = 1
    return
  }
  if (!dryRun && letrehozottId !== null) {
    log.info('OWNER_TEMAKURZUS_OK')
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  futtat()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error: unknown) => {
      log.error('temakurzus-minta: hiba történt.', {
        error: error instanceof Error ? error.message : String(error),
      })
      process.exit(1)
    })
}
