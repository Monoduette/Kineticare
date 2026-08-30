import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import YAML, { isMap, isPair, isSeq } from 'yaml'

const REPO = fileURLToPath(new URL('../../', import.meta.url))
const WORKFLOWS = join(REPO, '.github', 'workflows')

const CI_POSTGRES =
  'postgres:18@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280'
const BACKUP_POSTGRES =
  'postgres:18-alpine@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2'

const EXPECTED_ACTIONS = new Map<string, { sha: string; version: string }>([
  ['actions/checkout', { sha: '3d3c42e5aac5ba805825da76410c181273ba90b1', version: 'v7.0.1' }],
  ['actions/setup-node', { sha: '820762786026740c76f36085b0efc47a31fe5020', version: 'v7.0.0' }],
  [
    'actions/upload-artifact',
    { sha: '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a', version: 'v7.0.1' },
  ],
  [
    'anthropics/claude-code-action',
    { sha: 'a874e9ecd7bb36efdad65429c6b35815f5a08f10', version: 'v1.0.210' },
  ],
  [
    'gitleaks/gitleaks-action',
    { sha: 'e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e', version: 'v3.0.0' },
  ],
])

const ACTION_SHA_PATTERN = /^[0-9a-f]{40}$/
const VERSION_COMMENT_PATTERN = /^v\d+(?:\.\d+){1,2}$/
const IMAGE_DIGEST_PATTERN = /^[^@\s]+:[^@/\s]+@sha256:[0-9a-f]{64}$/
const DOCKER_ACTION_DIGEST_PATTERN = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/
const SUPPORTED_SCALAR_TYPES = new Set(['PLAIN', 'QUOTE_DOUBLE', 'QUOTE_SINGLE'])

const REQUIRED_CLEANUP_RUN = [
  'set -euo pipefail',
  'rm -f backups/*.dump toc.txt',
  "if [ -d backups ] && find backups -maxdepth 1 -type f -name '*.dump' -print -quit | grep -q .; then",
  '  echo "::error title=Plaintext mentés maradt::A titkosítatlan dump törlése sikertelen."',
  '  exit 1',
  'fi',
].join('\n')

const REQUIRED_DUMP_DOCKER_COMMANDS = [
  'docker pull --quiet "${PG_IMAGE}"',
  'docker run --rm --env DATABASE_URI --env "DUMP_TARGET=/backups/${FILE}" --volume "${PWD}/backups:/backups" "${PG_IMAGE}" sh -ceu \'',
]

const REQUIRED_INTEGRITY_DOCKER_COMMANDS = [
  'docker run --rm --volume "${PWD}/backups:/backups" "${PG_IMAGE}" pg_restore --list "/backups/${FILE}" > toc.txt || STATUS=$?',
]

interface WorkflowInspection {
  readonly violations: string[]
  readonly seenActions: Set<string>
}

function workflow(name: string): string {
  return readFileSync(join(WORKFLOWS, name), 'utf8')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNodeProperty(node: unknown, key: string): unknown {
  return isRecord(node) ? node[key] : undefined
}

function nodeType(node: unknown): string | undefined {
  const type = readNodeProperty(node, 'type')
  return typeof type === 'string' ? type : undefined
}

function scalarText(node: unknown): string | undefined {
  const value = readNodeProperty(node, 'value')
  return typeof value === 'string' ? value : undefined
}

function nodeItems(node: unknown): readonly unknown[] {
  const items = readNodeProperty(node, 'items')
  return Array.isArray(items) ? items : []
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function lineOf(source: string, node: unknown): number {
  const range = readNodeProperty(node, 'range')
  const offset = Array.isArray(range) && typeof range[0] === 'number' ? range[0] : 0
  return source.slice(0, offset).split('\n').length
}

function location(file: string, source: string, node: unknown): string {
  return `${file}:${lineOf(source, node)}`
}

function inspectUses(
  file: string,
  source: string,
  valueNode: unknown,
  violations: string[],
  seenActions: Set<string>,
): void {
  const at = location(file, source, valueNode)
  const type = nodeType(valueNode)
  const uses = scalarText(valueNode)

  if (!SUPPORTED_SCALAR_TYPES.has(type ?? '') || uses === undefined) {
    violations.push(`${at}: a uses értéke csak plain vagy idézett egysoros scalar lehet`)
    return
  }

  if (uses.startsWith('./')) {
    if (uses.split('/').includes('..')) {
      violations.push(`${at}: a lokális action nem léphet ki a repóból: ${uses}`)
    }
    return
  }

  if (uses.startsWith('docker://')) {
    if (!DOCKER_ACTION_DIGEST_PATTERN.test(uses)) {
      violations.push(`${at}: a docker action csak teljes sha256 digesttel használható: ${uses}`)
    }
    return
  }

  const separator = uses.lastIndexOf('@')
  if (separator <= 0 || separator === uses.length - 1) {
    violations.push(`${at}: nem értelmezhető külső action hivatkozás: ${uses}`)
    return
  }

  const action = uses.slice(0, separator)
  const ref = uses.slice(separator + 1)
  seenActions.add(action)

  const expected = EXPECTED_ACTIONS.get(action)
  if (expected === undefined) {
    violations.push(`${at}: ismeretlen, nem engedélyezett külső action: ${action}`)
    return
  }
  if (!ACTION_SHA_PATTERN.test(ref)) {
    violations.push(`${at}: ${action} nem teljes commit SHA: ${ref}`)
  }

  const rawComment = readNodeProperty(valueNode, 'comment')
  const versionComment = typeof rawComment === 'string' ? rawComment.trim() : ''
  if (!VERSION_COMMENT_PATTERN.test(versionComment)) {
    violations.push(`${at}: ${action} mellett nincs olvasható verziókomment`)
  }
  if (ref !== expected.sha || versionComment !== expected.version) {
    violations.push(
      `${at}: ${action} eltér a jóváhagyott ${expected.sha} # ${expected.version} pintől`,
    )
  }
}

function inspectImage(
  file: string,
  source: string,
  valueNode: unknown,
  violations: string[],
): void {
  const at = location(file, source, valueNode)
  const image = scalarText(valueNode)
  if (!SUPPORTED_SCALAR_TYPES.has(nodeType(valueNode) ?? '') || image === undefined) {
    violations.push(`${at}: az image értéke csak plain vagy idézett egysoros scalar lehet`)
    return
  }
  if (!IMAGE_DIGEST_PATTERN.test(image)) {
    violations.push(`${at}: a container image csak teljes sha256 digesttel használható: ${image}`)
  }
}

function inspectAst(
  file: string,
  source: string,
  node: unknown,
  violations: string[],
  seenActions: Set<string>,
): void {
  if (isPair(node)) {
    const keyNode = readNodeProperty(node, 'key')
    const valueNode = readNodeProperty(node, 'value')
    const key = scalarText(keyNode)

    if (key === 'uses') {
      inspectUses(file, source, valueNode, violations, seenActions)
    } else if (key === 'image') {
      inspectImage(file, source, valueNode, violations)
    } else if (key === 'continue-on-error') {
      violations.push(
        `${location(file, source, keyNode)}: continue-on-error biztonsági workflow-ban tiltott`,
      )
    } else if (key === 'steps') {
      if (!isSeq(valueNode)) {
        violations.push(`${location(file, source, valueNode)}: a steps értéke csak lista lehet`)
      } else {
        for (const stepNode of valueNode.items) {
          if (!isMap(stepNode)) {
            violations.push(
              `${location(file, source, stepNode)}: minden workflow step mapping kell legyen`,
            )
          }
        }
      }
    }

    inspectAst(file, source, valueNode, violations, seenActions)
    return
  }

  for (const item of nodeItems(node)) {
    inspectAst(file, source, item, violations, seenActions)
  }
}

function backupSteps(parsed: unknown): readonly Record<string, unknown>[] | undefined {
  if (!isRecord(parsed) || !isRecord(parsed.jobs) || !isRecord(parsed.jobs.backup)) {
    return undefined
  }
  const steps = parsed.jobs.backup.steps
  return Array.isArray(steps) && steps.every(isRecord) ? steps : undefined
}

function inspectJobPermissions(file: string, parsed: unknown, violations: string[]): void {
  if (!isRecord(parsed) || !isRecord(parsed.jobs)) return

  for (const [jobName, job] of Object.entries(parsed.jobs)) {
    if (!isRecord(job)) continue
    if (hasOwn(job, 'permissions')) {
      violations.push(`${file}: a jobs.${jobName}.permissions felülírás tiltott`)
    }
    if (isRecord(job.env) && hasOwn(job.env, 'PG_IMAGE')) {
      violations.push(`${file}: a jobs.${jobName}.env.PG_IMAGE felülírás tiltott`)
    }
    if (!Array.isArray(job.steps)) continue
    for (const [stepIndex, step] of job.steps.entries()) {
      if (isRecord(step) && isRecord(step.env) && hasOwn(step.env, 'PG_IMAGE')) {
        violations.push(
          `${file}: a jobs.${jobName}.steps[${stepIndex}].env.PG_IMAGE felülírás tiltott`,
        )
      }
    }
  }
}

function dockerCommands(run: string): string[] {
  const lines = run.split('\n')
  const commands: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index].trim()
    if (!/^docker (?:pull|run)\b/.test(line)) continue

    const parts: string[] = []
    while (true) {
      const continued = line.endsWith('\\')
      parts.push(continued ? line.slice(0, -1).trimEnd() : line)
      if (!continued || index + 1 >= lines.length) break
      index += 1
      line = lines[index].trim()
    }
    commands.push(parts.join(' '))
  }

  return commands
}

function stepWithId(
  steps: readonly Record<string, unknown>[],
  id: string,
  violations: string[],
): Record<string, unknown> | undefined {
  const matches = steps.filter((step) => step.id === id)
  if (matches.length !== 1) {
    violations.push(`db-backup.yml: pontosan egy ${id} id-jű step kell`)
    return undefined
  }
  return matches[0]
}

function countExactLine(run: string, expected: string): number {
  return run.split('\n').filter((line) => line.trim() === expected).length
}

function inspectBackupShape(parsed: unknown, violations: string[]): void {
  if (!isRecord(parsed)) {
    violations.push('db-backup.yml: a workflow gyökere nem mapping')
    return
  }
  if (!isRecord(parsed.permissions) || Object.keys(parsed.permissions).length !== 0) {
    violations.push(
      'db-backup.yml: a backup workflow minimális jogosultsága permissions: {} kell legyen',
    )
  }
  if (!isRecord(parsed.env) || parsed.env.PG_IMAGE !== BACKUP_POSTGRES) {
    violations.push(`db-backup.yml: a PG_IMAGE pontosan ${BACKUP_POSTGRES} kell legyen`)
  }

  const steps = backupSteps(parsed)
  if (steps === undefined) {
    violations.push('db-backup.yml: a jobs.backup.steps nem érvényes step-lista')
    return
  }

  const dump = stepWithId(steps, 'dump', violations)
  const integrity = stepWithId(steps, 'integrity', violations)
  const dumpRun = typeof dump?.run === 'string' ? dump.run : ''
  const integrityRun = typeof integrity?.run === 'string' ? integrity.run : ''
  if (dumpRun === '') {
    violations.push('db-backup.yml: a dump step run scriptje hiányzik')
  } else {
    if (dockerCommands(dumpRun).join('\n') !== REQUIRED_DUMP_DOCKER_COMMANDS.join('\n')) {
      violations.push(
        'db-backup.yml: a dump docker pull/run sinkeknek közvetlenül a rögzített PG_IMAGE-et kell használniuk',
      )
    }
    const dumpImageLines = dumpRun
      .split('\n')
      .filter((line) => line.includes('PG_IMAGE'))
      .map((line) => line.trim())
    if (
      dumpImageLines.join('\n') !==
      ['docker pull --quiet "${PG_IMAGE}"', '"${PG_IMAGE}" \\'].join('\n')
    ) {
      violations.push('db-backup.yml: a dump run csak a jóváhagyott PG_IMAGE sinkeket említheti')
    }
    if (/^\s*(?:export\s+)?PG_IMAGE=/m.test(dumpRun)) {
      violations.push('db-backup.yml: a dump run nem írhatja felül a rögzített PG_IMAGE-et')
    }
    if (dumpRun.includes('--dbname')) {
      violations.push('db-backup.yml: a pg_dump nem kaphat credentiales --dbname argumentumot')
    }

    const writeIndex = dumpRun.indexOf('printf "%s\\n" "${DATABASE_URI}" > "${SERVICE_FILE}"')
    const unsetMatch = /^\s*unset DATABASE_URI\s*$/m.exec(dumpRun)
    const unsetIndex = unsetMatch?.index ?? -1
    const exportServiceIndex = dumpRun.indexOf('export PGSERVICE="kineticare_backup"')
    const dumpIndex = dumpRun.indexOf('pg_dump --format=custom --file="${DUMP_TARGET}"')
    if (
      writeIndex < 0 ||
      unsetIndex < 0 ||
      exportServiceIndex < 0 ||
      dumpIndex < 0 ||
      writeIndex >= unsetIndex ||
      unsetIndex >= exportServiceIndex ||
      exportServiceIndex >= dumpIndex
    ) {
      violations.push(
        'db-backup.yml: a DATABASE_URI → service file → unset → PGSERVICE → pg_dump sorrend kötelező',
      )
    }
    if (countExactLine(dumpRun, 'unset DATABASE_URI') !== 1) {
      violations.push(
        'db-backup.yml: a DATABASE_URI-t pontosan egyszer, a feldolgozás elején kell unsetelni',
      )
    }
    if (
      !dumpRun.includes('trap cleanup_service EXIT') ||
      !dumpRun.includes('rm -f -- "${SERVICE_FILE}"') ||
      countExactLine(dumpRun, 'chmod 0600 "${SERVICE_FILE}"') !== 2 ||
      countExactLine(dumpRun, '[ "$(stat -c "%a" "${SERVICE_FILE}")" = "600" ] || fail_config') !==
        2 ||
      !dumpRun.includes('export PGSERVICEFILE="${SERVICE_FILE}"')
    ) {
      violations.push(
        'db-backup.yml: a service file 0600-as permissionje, PGSERVICEFILE exportja és trap cleanupja kötelező',
      )
    }
  }

  if (integrityRun === '') {
    violations.push('db-backup.yml: az integrity step run scriptje hiányzik')
  } else {
    if (dockerCommands(integrityRun).join('\n') !== REQUIRED_INTEGRITY_DOCKER_COMMANDS.join('\n')) {
      violations.push(
        'db-backup.yml: az integrity docker run sinknek közvetlenül a rögzített PG_IMAGE-et kell használnia',
      )
    }
    const integrityImageLines = integrityRun
      .split('\n')
      .filter((line) => line.includes('PG_IMAGE'))
      .map((line) => line.trim())
    if (integrityImageLines.join('\n') !== '"${PG_IMAGE}" \\') {
      violations.push(
        'db-backup.yml: az integrity run csak a jóváhagyott PG_IMAGE sinket említheti',
      )
    }
    if (/DATABASE_URI|PGSERVICE|PGPASS|password=/i.test(integrityRun)) {
      violations.push('db-backup.yml: az integritáslépés nem kaphat adatbázis-credentialt')
    }
    if (/^\s*(?:export\s+)?PG_IMAGE=/m.test(integrityRun)) {
      violations.push('db-backup.yml: az integrity run nem írhatja felül a rögzített PG_IMAGE-et')
    }
  }

  const encryptIndexes = steps
    .map((step, index) => (step.id === 'encrypt' ? index : -1))
    .filter((index) => index >= 0)
  const cleanupIndexes = steps
    .map((step, index) => (step.name === 'Plaintext ideiglenes fájlok törlése' ? index : -1))
    .filter((index) => index >= 0)
  const uploadIndexes = steps
    .map((step, index) =>
      typeof step.uses === 'string' && step.uses.startsWith('actions/upload-artifact@')
        ? index
        : -1,
    )
    .filter((index) => index >= 0)

  if (encryptIndexes.length !== 1 || cleanupIndexes.length !== 1 || uploadIndexes.length !== 1) {
    violations.push(
      'db-backup.yml: pontosan egy encrypt, plaintext-cleanup és artifact-upload step kell',
    )
    return
  }

  const encryptIndex = encryptIndexes[0]
  const cleanupIndex = cleanupIndexes[0]
  const uploadIndex = uploadIndexes[0]
  if (encryptIndex + 1 !== cleanupIndex || cleanupIndex + 1 !== uploadIndex) {
    violations.push('db-backup.yml: a kötelező sorrend közvetlenül encrypt → cleanup → upload')
  }

  const cleanup = steps[cleanupIndex]
  if (cleanup.if !== 'always()') {
    violations.push('db-backup.yml: a plaintext cleanup feltétele pontosan always() kell legyen')
  }
  if (typeof cleanup.run !== 'string' || cleanup.run.trimEnd() !== REQUIRED_CLEANUP_RUN) {
    violations.push('db-backup.yml: a plaintext cleanup parancsa hiányos, módosult vagy no-op')
  }

  const upload = steps[uploadIndex]
  const expectedUpload = EXPECTED_ACTIONS.get('actions/upload-artifact')
  if (upload.uses !== `actions/upload-artifact@${expectedUpload?.sha}`) {
    violations.push(
      'db-backup.yml: az upload step nem a jóváhagyott upload-artifact commitot használja',
    )
  }
  if (!isRecord(upload.with)) {
    violations.push('db-backup.yml: az upload step with mappingje hiányzik')
    return
  }

  const expectedPath = 'backups/${{ steps.encrypt.outputs.encrypted_file }}'
  if (upload.with.path !== expectedPath) {
    violations.push(
      `db-backup.yml: kizárólag az egyetlen titkosított fájl tölthető fel: ${expectedPath}`,
    )
  }
  if (upload.with['if-no-files-found'] !== 'error') {
    violations.push('db-backup.yml: az upload if-no-files-found értéke error kell legyen')
  }
}

function inspectWorkflowSecurity(
  file: string,
  source: string,
  options: { inspectBackup?: boolean } = {},
): WorkflowInspection {
  const violations: string[] = []
  const seenActions = new Set<string>()

  let document: ReturnType<typeof YAML.parseDocument>
  try {
    document = YAML.parseDocument(source)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return { violations: [`${file}: YAML parser exception: ${message}`], seenActions }
  }

  for (const error of document.errors) {
    violations.push(`${file}: YAML parse error: ${error.message}`)
  }
  for (const warning of document.warnings) {
    violations.push(`${file}: YAML parse warning: ${warning.message}`)
  }
  if (violations.length > 0) return { violations, seenActions }

  inspectAst(file, source, document.contents, violations, seenActions)
  const parsed = document.toJSON()
  inspectJobPermissions(file, parsed, violations)
  if (options.inspectBackup) {
    inspectBackupShape(parsed, violations)
  }

  return { violations, seenActions }
}

function replaceRequired(source: string, before: string, after: string): string {
  expect(source).toContain(before)
  return source.replace(before, after)
}

describe('CI/platform supply-chain és backup guard', () => {
  it('minden workflow strukturálisan parse-olható, és minden külső action/image immutable', () => {
    const violations: string[] = []
    const seenActions = new Set<string>()

    for (const file of readdirSync(WORKFLOWS).filter((name) => /\.ya?ml$/.test(name))) {
      const inspection = inspectWorkflowSecurity(file, workflow(file), {
        inspectBackup: file === 'db-backup.yml',
      })
      violations.push(...inspection.violations)
      for (const action of inspection.seenActions) seenActions.add(action)
    }

    expect(violations).toEqual([])
    expect(seenActions).toEqual(new Set(EXPECTED_ACTIONS.keys()))
  })

  it('mindkét PostgreSQL image tag és multi-arch digest együtt rögzített', () => {
    expect(workflow('ci.yml')).toContain(`image: ${CI_POSTGRES}`)
    expect(workflow('db-backup.yml')).toContain(`PG_IMAGE: ${BACKUP_POSTGRES}`)
  })

  it('a strukturált YAML parser exact direct devDependency', () => {
    const manifest = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as unknown
    const lockfile = JSON.parse(readFileSync(join(REPO, 'package-lock.json'), 'utf8')) as unknown

    expect(isRecord(manifest) && isRecord(manifest.devDependencies)).toBe(true)
    expect(isRecord(manifest) ? manifest.devDependencies : undefined).toMatchObject({
      yaml: '2.9.0',
    })
    expect(isRecord(lockfile) && isRecord(lockfile.packages)).toBe(true)
    const lockPackages = isRecord(lockfile) && isRecord(lockfile.packages) ? lockfile.packages : {}
    expect(lockPackages['node_modules/yaml']).toMatchObject({ version: '2.9.0', dev: true })
  })

  it('a backup mindkét konfiguráció hiányára fail-closed', () => {
    const source = workflow('db-backup.yml')
    const preflight = source
      .split('- name: Kötelező mentési konfiguráció')[1]
      ?.split('- name: age telepítése')[0]

    expect(preflight).toBeDefined()
    expect(preflight).toContain('DATABASE_URI: ${{ secrets.DATABASE_URI }}')
    expect(preflight).toContain('BACKUP_AGE_RECIPIENT: ${{ vars.BACKUP_AGE_RECIPIENT }}')
    expect(preflight).toContain('if [ -z "${DATABASE_URI:-}" ]; then')
    expect(preflight).toContain('if [ -z "${BACKUP_AGE_RECIPIENT:-}" ]; then')
    expect(preflight).toContain('exit 1')
    expect(source).not.toContain('run=false')
    expect(source).not.toContain('steps.secret.outputs.run')
  })

  it('az age bináris hivatalos v1.3.2 release-ből, rögzített SHA-256-tal települ', () => {
    const source = workflow('db-backup.yml')

    expect(source).toMatch(/AGE_VERSION: ['"]1\.3\.2['"]/)
    expect(source).toContain(
      'AGE_ARCHIVE_SHA256: cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10',
    )
    expect(source).toContain(
      'https://github.com/FiloSottile/age/releases/download/v${AGE_VERSION}/age-v${AGE_VERSION}-linux-amd64.tar.gz',
    )
    expect(source).toContain('sha256sum --check --strict')
  })

  it.each([
    ['flow mapping', "steps: [{ uses: 'actions/checkout@main' }]\n"],
    ['folded scalar', 'steps:\n  - uses: >-\n      actions/checkout@main\n'],
    ['single quoted scalar', "steps:\n  - uses: 'actions/checkout@main' # v7.0.1\n"],
    ['double quoted scalar', 'steps:\n  - uses: "actions/checkout@main" # v7.0.1\n'],
  ])('a mutable actiont %s alakban sem hagyja ki', (_label, source) => {
    expect(inspectWorkflowSecurity('fixture.yml', source).violations).not.toEqual([])
  })

  it.each([
    ['tag-ref', 'steps:\n  - uses: actions/checkout@v7 # v7.0.1\n', /nem teljes commit SHA/],
    [
      'unknown action',
      'steps:\n  - uses: owner/unknown@0123456789abcdef0123456789abcdef01234567 # v1.0.0\n',
      /ismeretlen/,
    ],
    ['docker tag', 'steps:\n  - uses: docker://alpine:3.23\n', /docker action/],
    ['mutable image', 'services:\n  db:\n    image: postgres:18\n', /container image/],
    [
      'digest-only image',
      `services:\n  db:\n    image: postgres@sha256:${'a'.repeat(64)}\n`,
      /container image/,
    ],
    [
      'continue-on-error',
      'steps:\n  - run: exit 1\n    continue-on-error: true\n',
      /continue-on-error/,
    ],
  ])('%s mutációra fail-closed violationt ad', (_label, source, expected) => {
    expect(inspectWorkflowSecurity('fixture.yml', source).violations.join('\n')).toMatch(expected)
  })

  it('a kommentben szereplő uses nem számít workflow actionnek', () => {
    const result = inspectWorkflowSecurity(
      'fixture.yml',
      '# uses: actions/checkout@main\nsteps:\n  - run: echo safe\n',
    )
    expect(result.violations).toEqual([])
    expect(result.seenActions).toEqual(new Set())
  })

  it.each([
    [
      'wildcard artifact',
      'path: backups/${{ steps.encrypt.outputs.encrypted_file }}',
      'path: backups/*.dump*',
    ],
    ['no-op cleanup', 'rm -f backups/*.dump toc.txt', ': # cleanup disabled'],
    ['comment-only cleanup', 'rm -f backups/*.dump toc.txt', '# rm -f backups/*.dump toc.txt'],
    ['cleanup condition', 'if: always()', 'if: success()'],
    [
      'continue-on-error cleanup',
      'if: always()\n        run:',
      'if: always()\n        continue-on-error: true\n        run:',
    ],
    [
      'mutable pull és run image',
      'docker pull --quiet "${PG_IMAGE}"',
      'docker pull --quiet postgres:18-alpine',
    ],
    [
      'mutable dump run image',
      '            "${PG_IMAGE}" \\\n            sh -ceu',
      '            postgres:18-alpine \\\n            sh -ceu',
    ],
    [
      'mutable integrity run image',
      '            "${PG_IMAGE}" \\\n            pg_restore --list',
      '            postgres:18-alpine \\\n            pg_restore --list',
    ],
    [
      'DATABASE_URI argv visszacsempészése',
      'pg_dump --format=custom --file="${DUMP_TARGET}"',
      'pg_dump --dbname="$DATABASE_URI" --format=custom --file="${DUMP_TARGET}"',
    ],
    [
      'service env unset kikapcsolása',
      '              unset DATABASE_URI\n              chmod 0600',
      '              : # DATABASE_URI unset kikapcsolva\n              chmod 0600',
    ],
    [
      'service file permission gyengítése',
      'chmod 0600 "${SERVICE_FILE}"',
      'chmod 0644 "${SERVICE_FILE}"',
    ],
    [
      'service file cleanup kikapcsolása',
      'rm -f -- "${SERVICE_FILE}"',
      ': # service cleanup kikapcsolva',
    ],
  ])('a backup %s mutációját elutasítja', (_label, before, after) => {
    const source = replaceRequired(workflow('db-backup.yml'), before, after)
    expect(
      inspectWorkflowSecurity('db-backup.yml', source, { inspectBackup: true }).violations,
    ).not.toEqual([])
  })

  it('a job-szintű permissions felülírást elutasítja', () => {
    const source = replaceRequired(
      workflow('db-backup.yml'),
      '  backup:\n    name:',
      '  backup:\n    permissions: { contents: write }\n    name:',
    )
    expect(
      inspectWorkflowSecurity('db-backup.yml', source, { inspectBackup: true }).violations.join(
        '\n',
      ),
    ).toMatch(/jobs\.backup\.permissions/)
  })

  it.each([
    [
      'job env',
      '  backup:\n    name:',
      '  backup:\n    env: { PG_IMAGE: postgres:18-alpine }\n    name:',
    ],
    [
      'dump step env',
      '        env:\n          DATABASE_URI: ${{ secrets.DATABASE_URI }}',
      '        env:\n          PG_IMAGE: postgres:18-alpine\n          DATABASE_URI: ${{ secrets.DATABASE_URI }}',
    ],
    [
      'integrity step env',
      '        env:\n          FILE: ${{ steps.dump.outputs.file }}',
      '        env:\n          PG_IMAGE: postgres:18-alpine\n          FILE: ${{ steps.dump.outputs.file }}',
    ],
  ])('a %s PG_IMAGE felülírást elutasítja', (_label, before, after) => {
    const source = replaceRequired(workflow('db-backup.yml'), before, after)
    expect(
      inspectWorkflowSecurity('db-backup.yml', source, { inspectBackup: true }).violations.join(
        '\n',
      ),
    ).toMatch(/env\.PG_IMAGE/)
  })

  it('a pusztán deklarált PG_IMAGE nem fedez mutable docker sinkeket', () => {
    const source = workflow('db-backup.yml')
      .replace('docker pull --quiet "${PG_IMAGE}"', 'docker pull --quiet postgres:18-alpine')
      .replaceAll('            "${PG_IMAGE}" \\', '            postgres:18-alpine \\')

    expect(source).toContain(`PG_IMAGE: ${BACKUP_POSTGRES}`)
    expect(
      inspectWorkflowSecurity('db-backup.yml', source, { inspectBackup: true }).violations,
    ).not.toEqual([])
  })

  it('a backup encrypt-cleanup-upload sorrend felcserélését elutasítja', () => {
    const source = workflow('db-backup.yml')
    const cleanupStart = source.indexOf('      - name: Plaintext ideiglenes fájlok törlése')
    const uploadStart = source.indexOf('      - name: Mentés feltöltése artifactként')
    expect(cleanupStart).toBeGreaterThan(0)
    expect(uploadStart).toBeGreaterThan(cleanupStart)

    const cleanupBlock = source.slice(cleanupStart, uploadStart)
    const uploadBlock = source.slice(uploadStart)
    const mutated = source.slice(0, cleanupStart) + uploadBlock + cleanupBlock

    expect(
      inspectWorkflowSecurity('db-backup.yml', mutated, { inspectBackup: true }).violations,
    ).not.toEqual([])
  })
})
