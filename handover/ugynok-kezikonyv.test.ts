import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A következő ügynök belépési pontja a `docs/ugynok-kezikonyv.md`.
 * Ha a fájl eltűnik, vagy a három kanonikus mutató (AGENTS / CLAUDE /
 * README) lemarad róla, az átadás némán elromlik — ugyanaz a vakfolt,
 * amit a meta-őr a CI-őrökre fog.
 *
 * A repo-gyökeret felfelé keressük, ne rögzített `../..`-t: a
 * `handover/` másolat egy szinttel feljebb él, és onnan a régi
 * relatív út a repo szülőjét találná.
 */

function resolveRepoRoot(fromUrl: string): string {
  let current = dirname(fileURLToPath(fromUrl))
  for (let step = 0; step < 8; step += 1) {
    if (
      existsSync(join(current, 'AGENTS.md')) &&
      existsSync(join(current, 'docs', 'ugynok-kezikonyv.md'))
    ) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }
  throw new Error('Nem találom a Kineticare repo-gyökeret (AGENTS.md + docs/ugynok-kezikonyv.md).')
}

const REPO_ROOT = resolveRepoRoot(import.meta.url)
const HANDBOOK_REL = 'docs/ugynok-kezikonyv.md'
const HANDOVER_DIR = 'handover'
const HANDOVER_HANDBOOK_REL = 'handover/ugynok-kezikonyv.md'

const POINTER_FILES = ['AGENTS.md', 'CLAUDE.md', 'README.md'] as const

/** A kézikönyvben hivatkozott, „ha X, ide nyúlj" belépők — létezniük kell. */
const REQUIRED_SOURCE_PATHS = [
  'src/lib/payments/barion-adapter.ts',
  'src/lib/order-status/apply-barion-state.ts',
  'src/lib/checkout/start-checkout.ts',
  'src/lib/course-access.ts',
  'src/lib/access-grants.ts',
  'src/lib/cta-vocabulary.ts',
  'src/lib/courses.ts',
  'src/lib/hero-video.ts',
  'src/lib/curriculum/curriculum.ts',
  'src/lib/legacy-redirects.ts',
  'src/lib/tudastar/hub-oldalak.ts',
  'src/lib/cart.ts',
  'src/lib/logger.ts',
  'src/jobs/index.ts',
  'src/env.ts',
  'src/middleware.ts',
  'src/collections/Users.ts',
  'src/plugins/ecommerce.ts',
  'src/app/(frontend)/api/checkout/start/route.ts',
  'src/app/(frontend)/api/barion/callback/route.ts',
  'src/app/(frontend)/api/stream-token/route.ts',
  'src/app/robots.ts',
  'src/app/sitemap.ts',
  'docs/agent-feature-map.md',
  'docs/ertekesitesi-ux-skill.md',
  'docs/szerkesztoi-utmutato.md',
  'docs/claude-indito-prompt.md',
  '.claude/skills/termektervezes/SKILL.md',
  '.claude/skills/teszt-audit/SKILL.md',
]

function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8')
}

describe('ügynök-kézikönyv — a következő agent megtalálja és használni tudja', () => {
  it('a kézikönyv létezik, és a három kanonikus belépő mutat rá', () => {
    expect(existsSync(join(REPO_ROOT, HANDBOOK_REL)), HANDBOOK_REL).toBe(true)

    for (const guide of POINTER_FILES) {
      expect(readRepoFile(guide), guide).toContain(HANDBOOK_REL)
    }
  })

  it('a kézikönyv rögzíti a tilos zónákat és a három hozzáférés-igazságot', () => {
    const handbook = readRepoFile(HANDBOOK_REL)

    expect(handbook).toMatch(/confirmOrder/)
    expect(handbook).toMatch(/users\.purchases/)
    expect(handbook).toMatch(/accessGrants/)
    expect(handbook).toMatch(/GetPaymentState v4/)
    expect(handbook).toMatch(/\(frontend\)\/api/)
    expect(handbook).not.toMatch(/confirmOrder-t hívd/i)
  })

  it('a „hol kezdj, ha X" belépő fájlok léteznek a working tree-ben', () => {
    const missing = REQUIRED_SOURCE_PATHS.filter(
      (relativePath) => !existsSync(join(REPO_ROOT, relativePath)),
    )
    expect(missing).toEqual([])
  })

  it('a handover/ mappa a kézikönyv bitazonos másolatát és a csomag-README-t tartalmazza', () => {
    expect(existsSync(join(REPO_ROOT, HANDOVER_DIR, 'README.md'))).toBe(true)
    expect(existsSync(join(REPO_ROOT, HANDOVER_HANDBOOK_REL)), HANDOVER_HANDBOOK_REL).toBe(true)
    expect(readRepoFile(HANDOVER_HANDBOOK_REL)).toBe(readRepoFile(HANDBOOK_REL))
    expect(readRepoFile('AGENTS.md')).toContain(`${HANDOVER_DIR}/`)
    expect(readRepoFile('README.md')).toContain(`${HANDOVER_DIR}/`)
  })

  it('a Claude-indító prompt létezik, bemásolható, és a handover másolat egyezik', () => {
    const promptRel = 'docs/claude-indito-prompt.md'
    const handoverPromptRel = 'handover/claude-indito-prompt.md'
    expect(existsSync(join(REPO_ROOT, promptRel)), promptRel).toBe(true)
    expect(readRepoFile(handoverPromptRel)).toBe(readRepoFile(promptRel))
    expect(readRepoFile('handover/README.md')).toContain('claude-indito-prompt.md')
    expect(readRepoFile(promptRel)).toContain('MÁSOLD INNENTŐL')
    expect(readRepoFile(promptRel)).toContain('confirmOrder')
    expect(readRepoFile(promptRel)).toContain('szerkesztoi-utmutato.md')
    expect(readRepoFile(promptRel)).not.toMatch(/confirmOrder-t hívd/i)
  })

  it('az .env.example tartalmazza a kódban élő, korábban hiányzó kulcsneveket érték nélkül', () => {
    const example = readRepoFile('.env.example')
    const requiredKeys = [
      'FIRST_USER_BOOTSTRAP_TOKEN',
      'TRUST_CF_CONNECTING_IP',
      'TRUSTED_PROXY_HOP_COUNT',
      'NEXT_PUBLIC_ALLOW_INDEXING',
      'SEED_SCOPE',
      'SEED_CONFIRM_LIVE',
      'EMAIL_JOB_ARGS',
      'MIGRATION_NOTICE_CONFIRM',
      'DEMO_MODE',
      'LEGACY_RESTORE_CONFIRM',
      'E2E_EXPECT_ANALYTICS',
    ]

    for (const key of requiredKeys) {
      expect(example, key).toMatch(new RegExp(`^${key}=$`, 'm'))
    }

    expect(example).not.toMatch(/FIRST_USER_BOOTSTRAP_TOKEN=\S/)
    expect(example).not.toMatch(/SEED_OWNER_PASSWORD=\S/)
    expect(example).not.toMatch(/első fiók customer marad/)
  })

  it('az első user fail-closed, a seed nem dry-run, a hero-video fájlnév létezik', () => {
    const handbook = readRepoFile(HANDBOOK_REL)

    expect(handbook).toMatch(/503/)
    expect(handbook).toMatch(/403/)
    expect(handbook).toMatch(/fiók \*\*nem\*\*\s+jön létre/)
    expect(handbook).not.toMatch(/első fiók\s+customer lenne/)
    expect(handbook).toMatch(/Nem-éles URL-en hiányzó `SEED_\*` = \*\*teljes seed ír\*\*/)
    expect(handbook).not.toMatch(/`OWNER_\*` \/ `SEED_\*` kapuk/)
    expect(handbook).toContain('hero-video-feltoltes.md')
    expect(handbook).not.toContain('hero-video-feltoltese.md')
    expect(existsSync(join(REPO_ROOT, 'docs', 'hero-video-feltoltes.md'))).toBe(true)
  })
})
