import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  CI_DB_REQUIRED_PREFIX,
  isContinuousIntegration,
  isDatabaseAvailable,
} from './helpers/db-available'

/**
 * ŐR: a DB-kapus tesztek CI-ban NEM maradhatnak ki (2026-08-18-i incidens).
 * A `.github/workflows/ci.yml` `verify` jobja Postgres és DATABASE_URI nélkül
 * futtatta a `npm test`-et. Az `isDatabaseAvailable()` ezért minden futásnál
 * azonnal `false`-ot adott, a `describe.skipIf(!hasDb)` pedig 3 tesztfájlt
 * (order-snapshots, products-status, webhook-audit-db) és az order-number
 */

const TESTS_DIR = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const CI_WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'ci.yml')

/** A megosztott DB-kapcsolón átmenő tesztfájlok — a leltár a lefedettség mértéke. */
const DB_GATED_TEST_FILES = [
  'order-snapshots.test.ts',
  'order-number.test.ts',
  'products-status.test.ts',
  'webhook-audit-db.test.ts',
  // A heti visszatérítés-újraellenőrzés jelöltlekérdezése (a `refunds` JSON-oszlop
  // like-szűrése) csak valódi Postgresen bizonyítható (w1-barion-platform).
  'order-poll-refund-recheck-db.test.ts',
]

/** Egy biztosan zárt cím: a 1-es porton semmi sem figyel, a kapcsolat azonnal elutasított. */
const UNREACHABLE_URI = 'postgresql://teszt@127.0.0.1:1/teszt'

const ENV_KEYS = ['CI', 'DATABASE_URI', 'PAYLOAD_SECRET'] as const

describe('DB-kapus tesztek lefedettségi őre', () => {
  const original = new Map<string, string | undefined>()

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      original.set(key, process.env[key])
    }
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = original.get(key)
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    original.clear()
  })

  it('(1) a CI-felismerés a de facto szabványt követi (üres/false/0 = nem CI)', () => {
    for (const value of ['true', 'TRUE', '1', 'yes']) {
      process.env.CI = value
      expect(isContinuousIntegration(), `CI='${value}' CI-futásnak számít`).toBe(true)
    }
    for (const value of ['', '   ', 'false', 'FALSE', '0']) {
      process.env.CI = value
      expect(isContinuousIntegration(), `CI='${value}' NEM CI-futás`).toBe(false)
    }
    delete process.env.CI
    expect(isContinuousIntegration()).toBe(false)
  })

  it('(2) CI + elérhetetlen adatbázis → HANGOS hiba, nem csendes kihagyás', async () => {
    process.env.CI = 'true'
    process.env.DATABASE_URI = UNREACHABLE_URI
    process.env.PAYLOAD_SECRET = 'nem-titok-csak-a-probahoz'

    await expect(isDatabaseAvailable()).rejects.toThrow(CI_DB_REQUIRED_PREFIX)
  })

  it('(3) CI + hiányzó env → szintén hangos hiba (a néma kihagyás minden ága zárt)', async () => {
    process.env.CI = 'true'
    delete process.env.DATABASE_URI
    delete process.env.PAYLOAD_SECRET
    await expect(isDatabaseAvailable()).rejects.toThrow(CI_DB_REQUIRED_PREFIX)

    process.env.DATABASE_URI = UNREACHABLE_URI
    delete process.env.PAYLOAD_SECRET
    await expect(isDatabaseAvailable()).rejects.toThrow(CI_DB_REQUIRED_PREFIX)
  })

  it('(4) a hibaüzenet SOSEM tartalmazza a nyers kapcsolati sztringet (jelszó-szivárgás)', async () => {
    process.env.CI = 'true'
    // Jelszó-alakú, eldobható érték — kizárólag azt méri, hogy a szöveg kifelé
    // nem szivárog ki a hibaüzenetbe.
    const jelszo = `probaertek-${Date.now()}`
    process.env.DATABASE_URI = `postgresql://teszt:${jelszo}@127.0.0.1:1/teszt`
    process.env.PAYLOAD_SECRET = 'nem-titok-csak-a-probahoz'

    const hiba = await isDatabaseAvailable().then(
      () => null,
      (error: unknown) => error,
    )
    expect(hiba).toBeInstanceOf(Error)
    const uzenet = hiba instanceof Error ? `${hiba.message}\n${hiba.stack ?? ''}` : ''
    expect(uzenet).not.toContain(jelszo)
    // A diagnózishoz szükséges host:port viszont benne van — az nem titok.
    expect(uzenet).toContain('127.0.0.1:1')
  })

  it('(5) CI nélkül az elérhetetlen adatbázis továbbra is csendes kihagyás (helyi kényelem)', async () => {
    delete process.env.CI
    process.env.DATABASE_URI = UNREACHABLE_URI
    process.env.PAYLOAD_SECRET = 'nem-titok-csak-a-probahoz'

    await expect(isDatabaseAvailable()).resolves.toBe(false)
  })

  it('(6) a CI verify jobja Postgrest, DB-env-et és migrációt ad a tesztek alá', () => {
    expect(existsSync(CI_WORKFLOW), `hiányzó workflow-fájl: ${CI_WORKFLOW}`).toBe(true)
    const workflow = readFileSync(CI_WORKFLOW, 'utf8')

    // A `verify` job szelete: a jobkulcstól a következő, azonos behúzású jobkulcsig.
    const start = workflow.indexOf('\n  verify:')
    expect(start, 'a ci.yml-ben nincs `verify` job').toBeGreaterThan(-1)
    const rest = workflow.slice(start + 1)
    const nextJob = rest.slice(1).search(/\n {2}[a-z0-9_-]+:\n/)
    const verifyJobRaw = nextJob === -1 ? rest : rest.slice(0, nextJob + 1)

    // A KOMMENTSOROK KIESNEK. Enélkül az őr becsapható: a job fölötti,
    // bőbeszédű indoklás maga tartalmazza a keresett kulcsszavakat, tehát egy
    // kikapcsolt service-konténer mellett is „megtalálná" őket.
    const verifyJob = verifyJobRaw
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n')

    const kovetelmenyek: ReadonlyArray<readonly [string, string]> = [
      ['services:', 'a verify jobnak service-konténert kell indítania'],
      ['postgres', 'a service-konténernek Postgresnek kell lennie'],
      [
        'DATABASE_URI',
        'a DATABASE_URI nélkül a DB-kapus tesztek ismét némán kimaradnának (ezt méri a fail-closed ág)',
      ],
      ['PAYLOAD_SECRET', 'a PAYLOAD_SECRET a Payload-config betöltéséhez kell'],
      [
        'payload migrate',
        'séma CSAK migrációból keletkezik (a dev-módú séma-push ki van kapcsolva), ' +
          'enélkül a felébresztett tesztek hiányzó táblákra futnának',
      ],
      ['npm test', 'a verify jobnak futtatnia kell a tesztsort'],
    ]

    const hianyzo = kovetelmenyek
      .filter(([token]) => !verifyJob.includes(token))
      .map(([token, indok]) => `'${token}' — ${indok}`)

    expect(
      hianyzo,
      'a CI `verify` jobjából hiányzik a DB-kapus tesztek futtatásához szükséges beállítás. ' +
        'Enélkül 11 teszt (köztük a rendelés ár-snapshot őre) NÉMÁN kimaradna a sorból.',
    ).toEqual([])
  })

  it('(7) a DB-kapus tesztfájlok megvannak és a megosztott kapcsolón mennek át', () => {
    const hibak: string[] = []
    for (const name of DB_GATED_TEST_FILES) {
      const path = join(TESTS_DIR, name)
      if (!existsSync(path)) {
        hibak.push(
          `${name}: hiányzik — a vitest-include egy törölt/átnevezett tesztfájlt NÉMÁN elnéz, ` +
            'a lefedettség tehát csendben esne. Ha a törlés szándékos, ezt az őrleltárt is frissítsd.',
        )
        continue
      }
      const content = readFileSync(path, 'utf8')
      if (!content.includes('helpers/db-available')) {
        hibak.push(
          `${name}: már nem a megosztott DB-kapcsolót (helpers/db-available) használja, ` +
            'így a CI fail-closed őre nem terjed ki rá.',
        )
      }
    }
    expect(hibak).toEqual([])
  })

  it('(8) CI-ban az adatbázisnak TÉNYLEGESEN elérhetőnek kell lennie', async () => {
    if (!isContinuousIntegration()) {
      // Helyi futásban nincs mit állítani: az adatbázis szándékosan opcionális.
      // A fail-closed viselkedést a (2)–(5) teszt méri környezettől függetlenül.
      expect(isContinuousIntegration()).toBe(false)
      return
    }
    await expect(isDatabaseAvailable()).resolves.toBe(true)
  })
})
