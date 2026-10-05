/**
 * Az npm audit kapu (`scripts/audit-gate.mjs`) szerződése: high és critical
 * szinttől bukás, kivéve a név szerint felsorolt, le nem járt advisory +
 * csomag párokat. Ez a CI egyetlen függőség-biztonsági kapuja, a kivétel nem
 * nyithatja ki szélesebbre, mint amire szól.
 *
 * A fixtúrák az `npm audit --json` (auditReportVersion 2) valódi alakját
 * követik: a tranzitív bejegyzés `via`-ja csomagnév, a gyökéré advisory-objektum.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { auditKapu } from '../../scripts/audit-gate.mjs'

const BRACES = {
  source: 1118035,
  name: 'braces',
  dependency: 'braces',
  title: 'braces vulnerable to stack-exhaustion denial of service through deeply nested patterns',
  url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
  severity: 'high',
  range: '<=3.0.3',
}

const MASIK_HIGH = {
  source: 1100001,
  name: 'micromatch',
  dependency: 'micromatch',
  title: 'másik, kivétel nélküli high',
  url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
  severity: 'high',
  range: '<4.0.9',
}

function riport(extra: Record<string, unknown> = {}) {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      braces: { name: 'braces', severity: 'high', isDirect: false, via: [BRACES] },
      chokidar: { name: 'chokidar', severity: 'high', isDirect: false, via: ['braces'] },
      '@payloadcms/next': {
        name: '@payloadcms/next',
        severity: 'high',
        isDirect: true,
        via: ['sass'],
      },
      sass: { name: 'sass', severity: 'high', isDirect: false, via: ['chokidar'] },
      payload: {
        name: 'payload',
        severity: 'moderate',
        isDirect: true,
        via: [
          {
            ...BRACES,
            name: 'payload',
            severity: 'moderate',
            url: 'https://github.com/advisories/GHSA-jg8r-5jh2-v2xj',
          },
        ],
      },
      ...extra,
    },
  }
}

const KIVETEL = {
  id: 'GHSA-vfj7-8cjw-p6xm',
  csomag: 'braces',
  lejar: '2026-11-05',
  indok: 'nincs javított kiadás',
}

describe('npm audit kapu', () => {
  it('kivétel nélkül a high tétel bukást okoz, a tranzitív láncon át is', () => {
    const eredmeny = auditKapu(riport(), [], '2026-10-05')

    expect(eredmeny.rendben).toBe(false)
    expect(eredmeny.blokkolo).toEqual([
      expect.objectContaining({ csomag: 'braces', id: 'GHSA-vfj7-8cjw-p6xm' }),
    ])
  })

  it('a le nem járt, név szerinti kivétel átengedi, a moderate tétel nem számít', () => {
    const eredmeny = auditKapu(riport(), [KIVETEL], '2026-10-05')

    expect(eredmeny.rendben).toBe(true)
    expect(eredmeny.engedett).toEqual([
      expect.objectContaining({ csomag: 'braces', id: 'GHSA-vfj7-8cjw-p6xm' }),
    ])
  })

  it('a kivétel csak a saját advisoryjára szól: egy új high mellette is bukás', () => {
    const eredmeny = auditKapu(
      riport({
        micromatch: { name: 'micromatch', severity: 'high', isDirect: false, via: [MASIK_HIGH] },
      }),
      [KIVETEL],
      '2026-10-05',
    )

    expect(eredmeny.rendben).toBe(false)
    expect(eredmeny.blokkolo).toEqual([
      expect.objectContaining({ csomag: 'micromatch', id: 'GHSA-aaaa-bbbb-cccc' }),
    ])
  })

  it('ugyanaz az advisory-azonosító más csomagon nem fogadja el a kivételt', () => {
    const eredmeny = auditKapu(riport(), [{ ...KIVETEL, csomag: 'micromatch' }], '2026-10-05')

    expect(eredmeny.rendben).toBe(false)
  })

  it('a lejárt kivétel újra bukást okoz', () => {
    const eredmeny = auditKapu(riport(), [KIVETEL], '2026-11-06')

    expect(eredmeny.rendben).toBe(false)
    expect(eredmeny.lejart).toEqual([expect.objectContaining({ id: 'GHSA-vfj7-8cjw-p6xm' })])
  })

  it.each([
    ['registry-hiba', { error: { code: 'ENOTFOUND', summary: 'registry nem elérhető' } }],
    ['részleges kimenet hibával', { error: { code: 'E500' }, vulnerabilities: {} }],
    ['üres kimenet', null],
    ['vulnerabilities nélkül', { auditReportVersion: 2 }],
  ])('hibás audit-kimenetnél (%s) a kapu bukik', (_nev, kimenet) => {
    expect(auditKapu(kimenet, [KIVETEL], '2026-10-05').rendben).toBe(false)
  })

  it('a feloldatlan tranzitív high tétel bukás, nem néma átengedés', () => {
    const eredmeny = auditKapu(
      { vulnerabilities: { sass: { name: 'sass', severity: 'high', via: ['nincs-ilyen'] } } },
      [KIVETEL],
      '2026-10-05',
    )

    expect(eredmeny.rendben).toBe(false)
  })

  it('a repó kivétellistája minden tételhez indokot és lejáratot ad, 60 napon belül', () => {
    const lista = JSON.parse(
      readFileSync(join(process.cwd(), '.github', 'audit-kivetelek.json'), 'utf8'),
    ) as Array<Record<string, unknown>>

    for (const kivetel of lista) {
      expect(kivetel.id).toMatch(/^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/)
      expect(typeof kivetel.csomag).toBe('string')
      expect(String(kivetel.indok).length).toBeGreaterThan(20)
      expect(String(kivetel.lejar)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      const hatralevoNap = (Date.parse(String(kivetel.lejar)) - Date.now()) / 86_400_000
      expect(hatralevoNap).toBeLessThanOrEqual(60)
    }
  })
})
