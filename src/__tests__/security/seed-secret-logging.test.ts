import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  MISSING_OWNER_PASSWORD_MESSAGE,
  isSeedSafeEmail,
  seedGuardErrors,
} from '../../scripts/seed'
import { MISSING_DEMO_PASSWORD_MESSAGE, demoGuardErrors } from '../../scripts/demo-seed'

/**
 * TITOK NEM KERÜLHET A NAPLÓBA (belső biztonsági átvizsgálás, 2026-08-16).
 * A `seed.ts` és a `demo-seed.ts` a GENERÁLT induló jelszót a naplóüzenet
 * SZÖVEGÉBE illesztve írta ki (`… induló jelszava: ${password}`). A logger
 * redakciója KULCSNÉV-alapú (src/lib/logger.ts `REDACTED_KEYS`), tehát az
 * üzenetszövegbe ágyazott titkot nem szűri. A demó-szolgáltatás minden
 */

/** A vizsgált scriptek — mindkettő hozott létre fiókot induló jelszóval. */
const SCRIPT_FILES = [
  'seed.ts',
  'demo-seed.ts',
  'restore-legacy-content.ts',
  'import-customers.ts',
  'grant-purchase.ts',
] as const

const SCRIPTS_DIR = fileURLToPath(new URL('../../scripts/', import.meta.url))

/** A repó naplózó hívásai — a logger, a Payload beépített loggere és a console. */
const LOG_CALL = /(?:\w+\.)*(?:logger|log|console)\.(?:debug|info|warn|error|log)\s*\(/g

/**
 * Jelszót hordozó változónevek `${…}` interpolációban. A minta szándékosan tág
 * (kis-nagybetű érzéketlen `password`/`jelszo` részlet), hogy a
 * `demoAccountPassword`, `ownerPassword`-szerű átnevezés se csússzon át.
 */
const PASSWORD_INTERPOLATION = /\$\{[^}]*(?:password|jelszo|jelszó)[^}]*\}/i

/**
 * Egy naplóhívás argumentumlistája — ZÁRÓJEL-PÁROSÍTÁSSAL, nem karakter-ablakkal.
 *
 * Miért nem elég egy `[\s\S]{0,600}?` ablak: az átnyúlna a hívás végén, és egy
 * későbbi, ÁRTALMATLAN sorra is ráilleszkedne (vaklárma) — vagy fordítva, egy
 * hosszabb hívásnál lecsúszna a valódi sértésről. A zárójel-számláló a
 * string- és template-literálokat, valamint a kommenteket átugorja, hogy a
 * bennük álló zárójel ne borítsa a mélységet.
 */
function logCallArguments(source: string): string[] {
  const results: string[] = []
  LOG_CALL.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = LOG_CALL.exec(source)) !== null) {
    const start = match.index + match[0].length
    let depth = 1
    let index = start
    while (index < source.length && depth > 0) {
      const char = source[index]
      if (char === "'" || char === '"' || char === '`') {
        index = skipQuoted(source, index, char)
        continue
      }
      if (char === '/' && source[index + 1] === '/') {
        index = source.indexOf('\n', index)
        if (index === -1) {
          index = source.length
        }
        continue
      }
      if (char === '/' && source[index + 1] === '*') {
        const end = source.indexOf('*/', index + 2)
        index = end === -1 ? source.length : end + 2
        continue
      }
      if (char === '(') {
        depth += 1
      } else if (char === ')') {
        depth -= 1
      }
      index += 1
    }
    results.push(source.slice(start, index))
  }
  return results
}

/**
 * A `start` pozíción kezdődő idézett szakasz UTÁNI index. A template-literál
 * `${…}` részeit szándékosan NEM bontja ki: az egész literál egyben marad, és
 * a jelszó-mintát épp ezen keressük.
 */
function skipQuoted(source: string, start: number, quote: string): number {
  let index = start + 1
  while (index < source.length) {
    const char = source[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === quote) {
      return index + 1
    }
    index += 1
  }
  return source.length
}

/** Naplóhívások, amelyek argumentumában jelszó-interpoláció áll. */
function logCallsWithPasswordInterpolation(source: string): string[] {
  return logCallArguments(source).filter((args) => PASSWORD_INTERPOLATION.test(args))
}

describe('őr: jelszó-változó SOSEM interpolálható naplóhívásba', () => {
  it.each(SCRIPT_FILES)('%s — nincs jelszó-interpoláció naplóhívásban', (file) => {
    const source = readFileSync(`${SCRIPTS_DIR}${file}`, 'utf8')
    const violations = logCallsWithPasswordInterpolation(source)

    expect(
      violations,
      `${file}: naplóhívásba interpolált jelszó-változó. A logger redakciója ` +
        'KULCSNÉV-alapú, az üzenetszövegbe ágyazott titkot NEM szűri — a jelszó így ' +
        'a deploy-naplóba kerülne. Jelszó sosem naplózható.',
    ).toEqual([])
  })

  /**
   * A mintaillesztő ÖNELLENŐRZÉSE: ha a regex elromlana (pl. egy átírás
   * elrontja a csoportokat), a fenti tesztek némán zöldek maradnának.
   */
  it('a minta felismeri a KORÁBBI, hibás alakokat (az őr nem vak)', () => {
    const regressions = [
      'payload.logger.info(`Seed: az owner induló jelszava: ${password}`)',
      'log.info(`demó: belépés: ${DEMO_ACCOUNT_EMAIL} / ${demoAccountPassword.password}`)',
      'logger.warn(`ideiglenes: ${ownerPassword}`)',
      'console.log(`jelszo: ${jelszo}`)',
    ]
    for (const line of regressions) {
      expect(logCallsWithPasswordInterpolation(line), line).not.toEqual([])
    }
  })

  it('a minta NEM jelöl meg ártalmatlan naplósorokat (nincs vaklárma)', () => {
    const harmless = [
      'log.info(`demó: a bemutató fiókja létrejött — belépés: ${DEMO_ACCOUNT_EMAIL}`)',
      'logger.info(`Seed: owner létrehozva (${OWNER_EMAIL}); a jelszó a SEED_OWNER_PASSWORD értéke.`)',
      'const password = resolveOwnerPassword()',
      // A hívás UTÁN álló, nem naplózott interpoláció sem lehet találat: a
      // zárójel-párosítás miatt az argumentumlista a `)`-nél véget ér.
      'logger.info(`kész (${OWNER_EMAIL})`)\nconst hash = `${password}`',
    ]
    for (const line of harmless) {
      expect(logCallsWithPasswordInterpolation(line), line).toEqual([])
    }
  })
})

describe('a jelszó-környezetváltozó KÖTELEZŐ, magyar hibaüzenettel', () => {
  it('a seed hibaüzenete magyar, megnevezi a változót, és nem tartalmaz értéket', () => {
    expect(MISSING_OWNER_PASSWORD_MESSAGE).toContain('SEED_OWNER_PASSWORD')
    expect(MISSING_OWNER_PASSWORD_MESSAGE).toMatch(/KÖTELEZŐ/)
    expect(MISSING_OWNER_PASSWORD_MESSAGE).toMatch(/nem generál és nem naplóz jelszót/)
    // Nincs benne „=" utáni érték, azaz nem szivárogtat mintajelszót.
    expect(MISSING_OWNER_PASSWORD_MESSAGE).not.toMatch(/SEED_OWNER_PASSWORD\s*=\s*\S/)
  })

  it('a demó hibaüzenete magyar, megnevezi a változót, és nem tartalmaz értéket', () => {
    expect(MISSING_DEMO_PASSWORD_MESSAGE).toContain('DEMO_CUSTOMER_PASSWORD')
    expect(MISSING_DEMO_PASSWORD_MESSAGE).toMatch(/KÖTELEZŐ/)
    expect(MISSING_DEMO_PASSWORD_MESSAGE).not.toMatch(/DEMO_CUSTOMER_PASSWORD\s*=\s*\S/)
  })

  it('a seed forrásában nincs többé jelszó-generátor (a generált titok útja megszűnt)', () => {
    const source = readFileSync(`${SCRIPTS_DIR}seed.ts`, 'utf8')
    expect(source).not.toContain('generateOwnerPassword')
    expect(source).not.toContain('randomBytes')
  })
})

/**
 * ÉLES-VÉDELEM a teljes seedhez (a demoGuardErrors mintájára). A
 * `SEED_SCOPE=kezdolap` ág élesben is használható marad — a landing képei és a
 * kezdőlap alap-szekciósora telepítési előfeltétel.
 */
describe('seedGuardErrors — éles környezetben a TELJES seed nem futhat', () => {
  const live = 'https://kineticare.hu'

  it('az éles domain megtagadja a teljes seedet', () => {
    const errors = seedGuardErrors({ seedScope: undefined, serverUrl: live, confirmLive: undefined })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('ÉLES')
    expect(errors[0]).toContain('SEED_SCOPE=kezdolap')
  })

  it('a www. változat is éles', () => {
    expect(
      seedGuardErrors({
        seedScope: undefined,
        serverUrl: 'https://www.kineticare.hu/',
        confirmLive: undefined,
      }),
    ).toHaveLength(1)
  })

  it('a SEED_SCOPE=kezdolap ág élesben is futhat (telepítési előfeltétel)', () => {
    expect(
      seedGuardErrors({ seedScope: 'kezdolap', serverUrl: live, confirmLive: undefined }),
    ).toEqual([])
    expect(
      seedGuardErrors({ seedScope: ' kezdolap ', serverUrl: live, confirmLive: undefined }),
    ).toEqual([])
  })

  it('kifejezett megerősítéssel (SEED_CONFIRM_LIVE=igen) élesben is indítható', () => {
    expect(seedGuardErrors({ seedScope: undefined, serverUrl: live, confirmLive: 'igen' })).toEqual(
      [],
    )
    // Bármely MÁS érték nem megerősítés (nem „truthy" vizsgálat).
    for (const value of ['1', 'true', 'yes', '', ' nem ']) {
      expect(
        seedGuardErrors({ seedScope: undefined, serverUrl: live, confirmLive: value }),
        value,
      ).toHaveLength(1)
    }
  })

  it('nem éles címen (demó, staging, localhost) nincs kifogás', () => {
    for (const serverUrl of [
      'https://kineticare-demo.up.railway.app',
      'https://demo.kineticare.hu',
      'http://localhost:3000',
      undefined,
    ]) {
      expect(
        seedGuardErrors({ seedScope: undefined, serverUrl, confirmLive: undefined }),
        String(serverUrl),
      ).toEqual([])
    }
  })

  it('a demó-kapu változatlanul él (közös élesség-modul, nem másolat)', () => {
    // A serverUrlHost/PRODUCTION_HOSTS a src/lib/security/live-environment.ts-ben
    // él; mindkét script onnan dolgozik, tehát a két kapu nem csúszhat szét.
    expect(demoGuardErrors({ demoMode: '1', serverUrl: 'https://kineticare.hu' })).toHaveLength(1)
    expect(demoGuardErrors({ demoMode: '1', serverUrl: 'http://localhost:3000' })).toEqual([])
  })
})

describe('isSeedSafeEmail — a tartalmi kapu címfelismerése', () => {
  it('csak az @example.com cím ártalmatlan', () => {
    expect(isSeedSafeEmail('teszt@example.com')).toBe(true)
    expect(isSeedSafeEmail('  Teszt@EXAMPLE.com ')).toBe(true)
    expect(isSeedSafeEmail('vevo@gmail.com')).toBe(false)
    expect(isSeedSafeEmail('vevo@kineticare.hu')).toBe(false)
    expect(isSeedSafeEmail(null)).toBe(false)
    expect(isSeedSafeEmail(undefined)).toBe(false)
  })
})
