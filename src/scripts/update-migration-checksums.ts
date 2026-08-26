/**
 * Migrációs checksum-manifest (G3). Futtatás minden új migráció után, ugyanabban a commitban:
 *   npx tsx src/scripts/update-migration-checksums.ts
 * LF-sha256 → `src/migrations/.checksums.json` (pont-prefix!). Csak teljes .ts↔.json pár;
 * árva fájl → hiba, nem ír felül. index.ts és önmagára nem számol.
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** A datált migrációs fájl nevének alakja — a G3/G4-őr ugyanezt a mintát használja. */
const DATED_FILE = /^\d{8}_\d{6}_[a-z0-9_]+\.(ts|json)$/

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url))
const MANIFEST_PATH = join(MIGRATIONS_DIR, '.checksums.json')

/** LF-normalizált sha256 — a G3-őr pontosan így számolja újra a working-tree-t. */
function migrationSha256(absolutePath: string): string {
  const content = readFileSync(absolutePath, 'utf8').replace(/\r\n/g, '\n')
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function main(): void {
  const datedFiles = readdirSync(MIGRATIONS_DIR)
    .filter((name) => DATED_FILE.test(name))
    .sort()

  // Pár-teljesség: minden .ts-hez tartozik .json és fordítva. Árva fájl
  // esetén NEM írunk — a manifest csak konzisztens állapotot tükrözhet.
  const stems = new Map<string, { ts: boolean; json: boolean }>()
  for (const name of datedFiles) {
    const stem = name.replace(/\.(ts|json)$/, '')
    const isTs = name.endsWith('.ts')
    const entry = stems.get(stem) ?? { ts: false, json: false }
    if (isTs) {
      entry.ts = true
    } else {
      entry.json = true
    }
    stems.set(stem, entry)
  }
  const orphans = [...stems.entries()]
    .filter(([, pair]) => !(pair.ts && pair.json))
    .map(([stem, pair]) => `${stem}: ${pair.ts ? 'hiányzik a .json pár' : 'hiányzik a .ts pár'}`)
  if (orphans.length > 0) {
    console.error('HIBA: árva migrációs fájl(ok) — a manifest NEM frissült:')
    for (const orphan of orphans) {
      console.error(`  ${orphan}`)
    }
    process.exit(1)
  }

  const entries: Record<string, string> = {}
  for (const name of datedFiles) {
    entries[name] = migrationSha256(join(MIGRATIONS_DIR, name))
  }

  const manifest = { version: 1, entries }
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(
    `OK: ${MANIFEST_PATH} frissítve — ${datedFiles.length} fájl (${stems.size} migrációs pár) checksumja.`,
  )
}

/**
 * Indítás-kapu: a generátor CSAK közvetlen futtatáskor írja újra a manifestet
 * (`npx tsx src/scripts/update-migration-checksums.ts`) — a src/scripts/seed.ts
 * mintájára. Importálva a modul mellékhatás nélkül töltődik be: egy esetleges
 * jövőbeli import (pl. tesztből) sosem okozhat csendes manifest-írást.
 */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
