/**
 * Menü-seed: `npm run seed:menu` (hiányzó pontok); `MENU_SEED_DRY_RUN=igen` próbafutás.
 * Csak hiányzó sort hoz létre — meglévőt nem módosít. Logika: `src/lib/menu-seed.ts`.
 */

import { getPayload } from 'payload'

import { ensureNavigationMenu } from '../lib/menu-seed'
import config from '../payload.config'

const DRY_RUN = process.env.MENU_SEED_DRY_RUN?.trim().toLowerCase() === 'igen'

async function seedMenu(): Promise<void> {
  const payload = await getPayload({ config })
  const summary = await ensureNavigationMenu(payload, { dryRun: DRY_RUN })

  payload.logger.info(
    DRY_RUN
      ? `Menü-seed PRÓBAFUTÁS — összesítés: ${summary.created.length} létrehozandó, ${summary.skipped.length} érintetlen. Az adatbázisba SEMMI nem íródott.`
      : `Menü-seed kész — összesítés: ${summary.created.length} létrehozva, ${summary.skipped.length} érintetlenül hagyva.`,
  )
  if (DRY_RUN) {
    payload.logger.info('Menü-seed: tényleges futtatás → npm run seed:menu')
  }
}

seedMenu()
  .then(() => {
    process.exit(0)
  })
  .catch((error) => {
    console.error('Menü-seed: hiba történt.', error)
    process.exit(1)
  })
