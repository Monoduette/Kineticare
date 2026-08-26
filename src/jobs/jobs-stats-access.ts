import type { SanitizedConfig } from 'payload'

import { isStaffOrOwner } from '../access/isStaffOrOwner'

/**
 * A Payload által generált `payload-jobs-stats` global lezárása.
 *
 * A scheduling defaultja bármely bejelentkezett usernek írható; a
 * `lastScheduledRun` jövőbe állításával az összes cron némán leállna.
 * A globalt a szanitizálás hozza létre, ezért a `buildConfig` eredményét
 * patcheljük. Hiányzó global + bekapcsolt scheduling: induláskor dobunk.
 * A `handleSchedules` `payload.db.*`-on megy, az access-t megkerüli.
 */
export const JOB_STATS_GLOBAL_SLUG = 'payload-jobs-stats'

export function restrictJobStatsGlobalAccess(config: SanitizedConfig): SanitizedConfig {
  const statsGlobal = config.globals.find((global) => global.slug === JOB_STATS_GLOBAL_SLUG)

  if (!statsGlobal) {
    if (config.jobs.scheduling === true) {
      throw new Error(
        `A job-ütemezés be van kapcsolva (jobs.scheduling), de a(z) „${JOB_STATS_GLOBAL_SLUG}" ` +
          'global nincs a szanitált configban — a Payload feltehetően átnevezte. A statisztika-global ' +
          'jogosultsági zárja így NEM alkalmazható, és a globalt bármely bejelentkezett felhasználó ' +
          'írhatná. Emberi felülvizsgálat szükséges (src/jobs/jobs-stats-access.ts).',
      )
    }
    return config
  }

  statsGlobal.access.read = isStaffOrOwner
  statsGlobal.access.update = isStaffOrOwner
  // A globalnak ma nincs `versions` konfigja, tehát a `/versions*` végpontok
  // úgysem szolgálnak ki semmit — a szabály mégis be van állítva, hogy egy
  // későbbi Payload-verzió verziózása se nyisson kiskaput.
  statsGlobal.access.readVersions = isStaffOrOwner

  return config
}
