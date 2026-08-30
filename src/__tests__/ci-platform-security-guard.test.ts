import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const REPO = fileURLToPath(new URL('../../', import.meta.url))
const WORKFLOWS = join(REPO, '.github', 'workflows')

const CI_POSTGRES =
  'postgres:18@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280'
const BACKUP_POSTGRES =
  'postgres:18-alpine@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2'

const EXPECTED_ACTIONS = new Map<string, { sha: string; version: string }>([
  [
    'actions/checkout',
    { sha: '3d3c42e5aac5ba805825da76410c181273ba90b1', version: 'v7.0.1' },
  ],
  [
    'actions/setup-node',
    { sha: '820762786026740c76f36085b0efc47a31fe5020', version: 'v7.0.0' },
  ],
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

function workflow(name: string): string {
  return readFileSync(join(WORKFLOWS, name), 'utf8')
}

describe('CI/platform supply-chain és backup guard', () => {
  it('minden külső workflow action teljes, jóváhagyott commit SHA-ra van pinelve', () => {
    const violations: string[] = []
    const seen = new Set<string>()

    for (const file of readdirSync(WORKFLOWS).filter((name) => /\.ya?ml$/.test(name))) {
      for (const [index, line] of workflow(file).split('\n').entries()) {
        const match = line.match(
          /^\s*(?:-\s+)?uses:\s+([^@\s]+)@([^\s#]+)(?:\s+#\s*(\S.*))?$/,
        )
        if (!match || match[1].startsWith('./') || match[1].startsWith('docker://')) continue

        const [, action, ref, versionComment] = match
        seen.add(action)
        if (!/^[0-9a-f]{40}$/.test(ref)) {
          violations.push(`${file}:${index + 1}: ${action} nem teljes commit SHA: ${ref}`)
        }
        if (!/^v\d+(?:\.\d+){1,2}$/.test(versionComment ?? '')) {
          violations.push(`${file}:${index + 1}: ${action} mellett nincs olvasható verziókomment`)
        }

        const expected = EXPECTED_ACTIONS.get(action)
        if (expected && (ref !== expected.sha || versionComment !== expected.version)) {
          violations.push(
            `${file}:${index + 1}: ${action} eltér a jóváhagyott ${expected.sha} # ${expected.version} pintől`,
          )
        }
      }
    }

    expect(violations).toEqual([])
    expect(seen).toEqual(new Set(EXPECTED_ACTIONS.keys()))
  })

  it('mindkét PostgreSQL image tag és multi-arch digest együtt rögzített', () => {
    expect(workflow('ci.yml')).toContain(`image: ${CI_POSTGRES}`)
    expect(workflow('db-backup.yml')).toContain(`PG_IMAGE: ${BACKUP_POSTGRES}`)
  })

  it('a backup mindkét konfiguráció hiányára fail-closed', () => {
    const source = workflow('db-backup.yml')
    const preflight = source
      .split('- name: Kötelező mentési konfiguráció')[1]
      ?.split('- name: age telepítése')[0]

    expect(preflight).toBeDefined()
    expect(preflight).toContain('DATABASE_URI: ${{ secrets.DATABASE_URI }}')
    expect(preflight).toContain(
      'BACKUP_AGE_RECIPIENT: ${{ vars.BACKUP_AGE_RECIPIENT }}',
    )
    expect(preflight).toContain('if [ -z "${DATABASE_URI:-}" ]; then')
    expect(preflight).toContain('if [ -z "${BACKUP_AGE_RECIPIENT:-}" ]; then')
    expect(preflight).toContain('exit 1')
    expect(source).not.toContain('run=false')
    expect(source).not.toContain('steps.secret.outputs.run')
  })

  it('az age bináris hivatalos v1.3.2 release-ből, rögzített SHA-256-tal települ', () => {
    const source = workflow('db-backup.yml')

    expect(source).toContain('AGE_VERSION: "1.3.2"')
    expect(source).toContain(
      'AGE_ARCHIVE_SHA256: cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10',
    )
    expect(source).toContain(
      'https://github.com/FiloSottile/age/releases/download/v${AGE_VERSION}/age-v${AGE_VERSION}-linux-amd64.tar.gz',
    )
    expect(source).toContain('sha256sum --check --strict')
  })

  it('csak titkosított dump tölthető fel, a plaintext cleanup mindig lefut', () => {
    const source = workflow('db-backup.yml')
    const cleanup = source
      .split('- name: Plaintext ideiglenes fájlok törlése')[1]
      ?.split('- name: Mentés feltöltése artifactként')[0]
    const upload = source.split('- name: Mentés feltöltése artifactként')[1]

    expect(source).toContain('ENCRYPTED_FILE="${FILE}.age"')
    expect(source).toContain('echo "encrypted_file=${ENCRYPTED_FILE}" >> "$GITHUB_OUTPUT"')
    expect(cleanup).toContain('if: always()')
    expect(cleanup).toContain('rm -f backups/*.dump toc.txt')
    expect(upload).toContain('path: backups/${{ steps.encrypt.outputs.encrypted_file }}')
    expect(upload).toContain('if-no-files-found: error')
    expect(upload).not.toContain('steps.dump.outputs.file')
  })
})
