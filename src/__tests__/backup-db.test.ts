import { randomUUID } from 'node:crypto'
import { access, readFile, stat } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_KEEP,
  DEFAULT_TARGET_DIR,
  buildDumpFileName,
  buildPgDumpArgs,
  buildPgRestoreListArgs,
  decideRetention,
  escapePgPassField,
  formatBytes,
  interpretRestoreList,
  isDumpFileName,
  parseBackupArgs,
  parseDatabaseUriForLibpq,
  redactConnectionInfo,
} from '@/lib/backup-db'
import { buildCredentialSafeEnvironment, withPgPassFile } from '@/lib/backup-db-credentials'

/**
 * Az adatbázis-mentés TISZTA logikájának tesztjei.
 *
 * Ez a fájl SEMMILYEN folyamatot nem indít (nincs pg_dump/pg_restore) és nem
 * nyúl a hálózathoz — a src/lib/backup-db.ts szándékosan mellékhatás-mentes,
 * a folyamatindítás a CLI-burkolatban (src/scripts/backup-db.ts) él.
 */

// Fiktív, kizárólag a redakció tesztelésére szolgáló minta — nem valódi adat.
const FAKE_URI = 'postgresql://teszt:jelszo123@db.example.test:5432/kineticare'

describe('buildDumpFileName — időbélyeges fájlnév (UTC)', () => {
  it('a névséma kineticare-YYYYMMDD-HHmmss.dump, UTC szerint', () => {
    const name = buildDumpFileName(new Date(Date.UTC(2026, 7, 15, 2, 17, 9)))
    expect(name).toBe('kineticare-20260815-021709.dump')
  })

  it('egyszámjegyű mezőket nullával tölti fel', () => {
    const name = buildDumpFileName(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))
    expect(name).toBe('kineticare-20260102-030405.dump')
  })

  it('helyi időzónától függetlenül UTC-t használ (nem csúszik át napot)', () => {
    // 2026-08-15 23:30 UTC — bármely nyugati zónában még 15-e, keletiben már 16-a.
    const name = buildDumpFileName(new Date('2026-08-15T23:30:00.000Z'))
    expect(name).toBe('kineticare-20260815-233000.dump')
  })

  it('érvénytelen időpontra hibát dob', () => {
    expect(() => buildDumpFileName(new Date('nem-datum'))).toThrow(/nem valódi dátum/)
  })

  it('a generált név megfelel a saját felismerő mintának', () => {
    expect(isDumpFileName(buildDumpFileName(new Date()))).toBe(true)
  })
})

describe('isDumpFileName — csak a saját mentéseinket ismeri fel', () => {
  it('elfogadja a helyes nevet', () => {
    expect(isDumpFileName('kineticare-20260815-021709.dump')).toBe(true)
  })

  it.each([
    'kineticare-20260815-021709.dump.bak',
    'kineticare-2026081-021709.dump',
    'kineticare-20260815-0217.dump',
    'valami-mas-20260815-021709.dump',
    'kineticare.dump',
    'README.md',
    '',
  ])('elutasítja: %s', (name) => {
    expect(isDumpFileName(name)).toBe(false)
  })
})

describe('redactConnectionInfo — a DATABASE_URI sosem szivároghat ki', () => {
  it('az ismert URI minden előfordulását kicseréli', () => {
    const text = `pg_dump: error: connection to ${FAKE_URI} failed; retry ${FAKE_URI}`
    const output = redactConnectionInfo(text, FAKE_URI)
    expect(output).not.toContain('jelszo123')
    expect(output).not.toContain(FAKE_URI)
    expect(output).toContain('[REDACTED-DATABASE_URI]')
  })

  it('URI ismerete nélkül is levágja a postgres:// és postgresql:// szeleteket', () => {
    const text = 'hiba: postgres://user:titok@host:5432/db nem elérhető'
    const output = redactConnectionInfo(text)
    expect(output).not.toContain('titok')
    expect(output).toContain('[REDACTED-DATABASE_URI]')
  })

  it('a séma nélküli user:jelszo@host alakot is maszkolja', () => {
    const output = redactConnectionInfo('auth failed for admin:SzuperTitok@db.internal')
    expect(output).not.toContain('SzuperTitok')
    expect(output).toContain('[REDACTED-CREDENTIALS]')
  })

  it('a hétköznapi hibaszöveget változatlanul hagyja', () => {
    const text = 'pg_dump: error: could not open output file: Permission denied'
    expect(redactConnectionInfo(text, FAKE_URI)).toBe(text)
  })

  it('üres URI-ra nem omlik össze és nem redaktál mindent', () => {
    expect(redactConnectionInfo('rendben van', '')).toBe('rendben van')
  })
})

describe('decideRetention — a határon túli, legrégebbi mentések törlendők', () => {
  const dumps = [
    'kineticare-20260810-010000.dump',
    'kineticare-20260811-010000.dump',
    'kineticare-20260812-010000.dump',
    'kineticare-20260813-010000.dump',
  ]

  it('a legfrissebb N marad meg, a többi törlendő', () => {
    const decision = decideRetention(dumps, 2)
    expect(decision.keep).toEqual([
      'kineticare-20260813-010000.dump',
      'kineticare-20260812-010000.dump',
    ])
    expect(decision.remove).toEqual([
      'kineticare-20260810-010000.dump',
      'kineticare-20260811-010000.dump',
    ])
  })

  it('a bemenet sorrendjétől függetlenül időrend szerint dönt', () => {
    const kevert = [dumps[2], dumps[0], dumps[3], dumps[1]]
    expect(decideRetention(kevert, 1).keep).toEqual(['kineticare-20260813-010000.dump'])
    expect(decideRetention(kevert, 1).remove).toHaveLength(3)
  })

  it('a határnál kevesebb mentésnél nincs törlés', () => {
    const decision = decideRetention(dumps, 14)
    expect(decision.remove).toEqual([])
    expect(decision.keep).toHaveLength(4)
  })

  it('idegen fájlokhoz SOSEM nyúl — azok az ignored listára kerülnek', () => {
    const decision = decideRetention([...dumps, 'fontos-adat.sql', '.gitkeep'], 1)
    expect(decision.ignored).toEqual(['fontos-adat.sql', '.gitkeep'])
    expect(decision.remove).not.toContain('fontos-adat.sql')
    expect(decision.remove).not.toContain('.gitkeep')
  })

  it('a napon belüli több mentést is helyesen rendezi (óra-perc-másodperc)', () => {
    const napiak = [
      'kineticare-20260815-020000.dump',
      'kineticare-20260815-140000.dump',
      'kineticare-20260815-093000.dump',
    ]
    expect(decideRetention(napiak, 1).keep).toEqual(['kineticare-20260815-140000.dump'])
  })

  it.each([0, -1, 1.5, Number.NaN])('érvénytelen megtartási számra hibát dob: %s', (keep) => {
    expect(() => decideRetention(dumps, keep)).toThrow(/1 vagy annál nagyobb egész/)
  })
})

describe('interpretRestoreList — a pg_restore --list kimenetének értelmezése', () => {
  const okListing = [
    ';',
    '; Archive created at 2026-08-15 02:17:09 UTC',
    ';     dbname: kineticare',
    ';',
    '; Selected TOC Entries:',
    ';',
    '215; 1259 16389 TABLE public users postgres',
    '216; 1259 16400 TABLE public products postgres',
    '217; 1259 16411 TABLE public course_progress postgres',
    '',
  ].join('\n')

  it('sikeres futásnál megszámolja a visszaállítható bejegyzéseket', () => {
    const outcome = interpretRestoreList({ exitCode: 0, stdout: okListing, stderr: '' })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.entryCount).toBe(3)
    }
  })

  it('nem nulla kilépési kódnál bukik, és a stderr első sorát idézi', () => {
    const outcome = interpretRestoreList({
      exitCode: 1,
      stdout: '',
      stderr: '\npg_restore: error: did not find magic string in file header\n',
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.message).toContain('kilépési kód: 1')
      expect(outcome.message).toContain('magic string')
    }
  })

  it('bejegyzés nélküli (csak fejléc) kimenetnél is bukik, nulla kilépési kód mellett', () => {
    const outcome = interpretRestoreList({
      exitCode: 0,
      stdout: ';\n; Archive created at 2026-08-15\n;\n',
      stderr: '',
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.message).toContain('üres vagy sérült')
    }
  })

  it('teljesen üres kimenetnél bukik', () => {
    expect(interpretRestoreList({ exitCode: 0, stdout: '', stderr: '' }).ok).toBe(false)
  })
})

describe('parseBackupArgs — CLI-kapcsolók', () => {
  it('argumentum nélkül az alapértelmezéseket adja', () => {
    const result = parseBackupArgs([])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.options).toEqual({ targetDir: DEFAULT_TARGET_DIR, keep: DEFAULT_KEEP })
      expect(result.options.keep).toBe(14)
    }
  })

  it('feldolgozza a --cel és --megtart kapcsolót', () => {
    const result = parseBackupArgs(['--cel=/mnt/mentes', '--megtart=30'])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.options).toEqual({ targetDir: '/mnt/mentes', keep: 30 })
    }
  })

  it('elgépelt kapcsolóra hibát ad, nem esik csendben alapértelmezésre', () => {
    const result = parseBackupArgs(['--cell=/mnt/mentes'])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('Ismeretlen argumentum')
    }
  })

  it('kapcsoló nélküli argumentumot elutasít', () => {
    const result = parseBackupArgs(['/mnt/mentes'])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('Nem értelmezhető argumentum')
    }
  })

  it.each(['--megtart=0', '--megtart=-3', '--megtart=abc', '--megtart=2.5'])(
    'elutasítja az érvénytelen retenciót: %s',
    (arg) => {
      const result = parseBackupArgs([arg])
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('--megtart')
      }
    },
  )

  it('üres --cel értéket elutasít', () => {
    const result = parseBackupArgs(['--cel='])
    expect(result.ok).toBe(false)
  })
})

describe('buildPgDumpArgs / buildPgRestoreListArgs — argumentumlisták', () => {
  it('a custom (tömörített) formátumot és a célfájlt állítja be', () => {
    const args = buildPgDumpArgs('/mentes/kineticare-20260815-021709.dump')
    expect(args).toContain('--format=custom')
    expect(args).toContain('--file')
    expect(args).toContain('/mentes/kineticare-20260815-021709.dump')
  })

  it('a kapcsolati URI és credential egyáltalán nem kerül argv-ba', () => {
    const args = buildPgDumpArgs('/mentes/x.dump')
    expect(args).not.toContain(FAKE_URI)
    expect(args.join(' ')).not.toContain('jelszo123')
    expect(args).not.toContain('--dbname')
  })

  it('nem tartalmaz shell-metakaraktert (nincs pipe/átirányítás)', () => {
    const args = buildPgDumpArgs('/mentes/x.dump')
    expect(args.some((arg) => arg.includes('|') || arg.includes('>') || arg.includes(';'))).toBe(
      false,
    )
  })

  it('az integritás-ellenőrzés a --list kapcsolót használja a kész fájlon', () => {
    expect(buildPgRestoreListArgs('/mentes/x.dump')).toEqual(['--list', '/mentes/x.dump'])
  })
})

describe('parseDatabaseUriForLibpq — credential-mentes argv és fail-closed libpq', () => {
  it('a URI mezőit libpq env-re és escaped pgpass sorra bontja', () => {
    const password = `pw-${randomUUID()}:back\\slash`
    const uri =
      `postgresql://backup-user:${encodeURIComponent(password)}` +
      '@db.example.test:6432/kineticare?sslmode=require&connect_timeout=10'

    const connection = parseDatabaseUriForLibpq(uri)

    expect(connection.environment).toEqual({
      PGHOST: 'db.example.test',
      PGPORT: '6432',
      PGUSER: 'backup-user',
      PGDATABASE: 'kineticare',
      PGSSLMODE: 'require',
      PGCONNECT_TIMEOUT: '10',
    })
    expect(connection.pgpassContents).toBe(
      `db.example.test:6432:kineticare:backup-user:${escapePgPassField(password)}\n`,
    )
  })

  it('alapértelmezett 5432 portot használ és dekódolja az adatbázis nevét', () => {
    const connection = parseDatabaseUriForLibpq(
      'postgres://backup:runtime-value@localhost/kineticare%20restore',
    )
    expect(connection.environment.PGPORT).toBe('5432')
    expect(connection.environment.PGDATABASE).toBe('kineticare restore')
  })

  it.each([
    'postgresql://backup:runtime-value@db.test/database?unknown=value',
    'postgresql://backup:runtime-value@db.test/database?sslmode=require&sslmode=verify-full',
    'postgresql://backup:runtime-value@db.test/database#fragment',
    'mysql://backup:runtime-value@db.test/database',
    'postgresql://backup@db.test/database',
  ])('ismeretlen, kétértelmű vagy hiányos URI-ra fail-closed hibát ad', (uri) => {
    expect(() => parseDatabaseUriForLibpq(uri)).toThrow(/DATABASE_URI/)
  })

  it('a parse hiba nem idézi vissza a URI-t vagy a jelszót', () => {
    const password = `secret-${randomUUID()}`
    const uri = `postgresql://backup:${password}@db.test/database?${password}=value`

    try {
      parseDatabaseUriForLibpq(uri)
      throw new Error('A tesztnek hibát kellett volna kapnia.')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).not.toContain(uri)
      expect(message).not.toContain(password)
    }
  })
})

describe('withPgPassFile — védett, rövid életű credential-fájl', () => {
  it('0600-as fájlt ad a tisztított child env-hez, majd eltávolítja', async () => {
    const connection = parseDatabaseUriForLibpq(
      'postgresql://backup:runtime-value@db.test:5432/kineticare',
    )
    let pgpassPath = ''

    await withPgPassFile(connection, async (environment) => {
      pgpassPath = environment.PGPASSFILE ?? ''
      expect(environment.DATABASE_URI).toBeUndefined()
      expect(environment.PGPASSWORD).toBeUndefined()
      expect(environment.PGHOST).toBe('db.test')
      expect((await stat(pgpassPath)).mode & 0o777).toBe(0o600)
      expect(await readFile(pgpassPath, 'utf8')).toBe(connection.pgpassContents)
    })

    await expect(access(pgpassPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('az ambient DATABASE_URI és PG* felülírásokat nem örökíti tovább', () => {
    const environment = buildCredentialSafeEnvironment(
      {
        PATH: '/usr/bin',
        NODE_ENV: 'test',
        DATABASE_URI: 'ambient-uri',
        PGPASSWORD: 'ambient-password',
        PGSERVICE: 'ambient-service',
      },
      { PGHOST: 'approved-host', PGUSER: 'approved-user' },
      '/protected/pgpass',
    )

    expect(environment).toEqual({
      PATH: '/usr/bin',
      NODE_ENV: 'test',
      PGHOST: 'approved-host',
      PGUSER: 'approved-user',
      PGPASSFILE: '/protected/pgpass',
    })
  })

  it('kivétel után is eltávolítja a credential-fájlt', async () => {
    const connection = parseDatabaseUriForLibpq(
      'postgresql://backup:runtime-value@db.test:5432/kineticare',
    )
    let pgpassPath = ''

    await expect(
      withPgPassFile(connection, async (environment) => {
        pgpassPath = environment.PGPASSFILE ?? ''
        throw new Error('szándékos teszthiba')
      }),
    ).rejects.toThrow('szándékos teszthiba')
    await expect(access(pgpassPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('formatBytes — emberi méret', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1.0 KiB'],
    [1536, '1.5 KiB'],
    [1048576, '1.0 MiB'],
    [3221225472, '3.0 GiB'],
  ])('%s bájt → %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })

  it('értelmetlen értékre nem dob, hanem szöveges jelzést ad', () => {
    expect(formatBytes(Number.NaN)).toBe('ismeretlen méret')
    expect(formatBytes(-1)).toBe('ismeretlen méret')
  })
})
