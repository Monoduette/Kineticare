import { describe, expect, it } from 'vitest'

import {
  EXTERNAL_ANALYTICS_LINKS,
  normalizePosthogEmbedUrl,
  POSTHOG_EMBED_ORIGIN,
} from '../lib/admin/web-analytics-config'

/**
 * A PostHog beágyazási URL normalizálója (admin Webanalitika-fül).
 *
 * A tétje kettős: (1) az érték egy iframe `src`-ébe kerül az adminban,
 * (2) a megléte nyitja meg a CSP `frame-src`-ben az eu.posthog.com-ot
 * (src/lib/security/csp.ts). Ezért itt ugyanaz az elv, mint a GA4 mérési
 * azonosítónál: ami nem pontosan a várt alak, az NEM „majdnem jó", hanem
 * kikapcsolt beágyazás.
 */
describe('normalizePosthogEmbedUrl', () => {
  it('a shared alakot az embedded alakra normalizálja (a Share-dialógusból másolt link jó)', () => {
    expect(normalizePosthogEmbedUrl('https://eu.posthog.com/shared/AbCd1234xyz')).toBe(
      'https://eu.posthog.com/embedded/AbCd1234xyz',
    )
    // Záró perjellel és körülvevő szóközzel is.
    expect(normalizePosthogEmbedUrl('  https://eu.posthog.com/shared/AbCd1234xyz/  ')).toBe(
      'https://eu.posthog.com/embedded/AbCd1234xyz',
    )
  })

  it('az embedded alakot változatlan tokennel fogadja el', () => {
    expect(normalizePosthogEmbedUrl('https://eu.posthog.com/embedded/token_-12345')).toBe(
      'https://eu.posthog.com/embedded/token_-12345',
    )
  })

  it('üres vagy hiányzó érték → null (a beágyazás kikapcsolva, nem hiba)', () => {
    expect(normalizePosthogEmbedUrl(undefined)).toBeNull()
    expect(normalizePosthogEmbedUrl('')).toBeNull()
    expect(normalizePosthogEmbedUrl('   ')).toBeNull()
    expect(normalizePosthogEmbedUrl('nem-url')).toBeNull()
  })

  it('idegen host vagy nem-https séma → null (a CSP-t is ez védi)', () => {
    for (const evil of [
      'https://evil.example/shared/AbCd1234xyz',
      'https://eu.posthog.com.evil.example/shared/AbCd1234xyz',
      'https://us.posthog.com/shared/AbCd1234xyz',
      'http://eu.posthog.com/shared/AbCd1234xyz',
      'https://eu.posthog.com:8443/shared/AbCd1234xyz',
    ]) {
      expect(normalizePosthogEmbedUrl(evil), evil).toBeNull()
    }
  })

  it('más útvonal, query, hash vagy extra szegmens → null', () => {
    for (const rossz of [
      'https://eu.posthog.com/project/253152/dashboard/918387',
      'https://eu.posthog.com/shared/AbCd1234xyz?whitelabel=1',
      'https://eu.posthog.com/shared/AbCd1234xyz#top',
      'https://eu.posthog.com/shared/AbCd1234xyz/extra',
      'https://eu.posthog.com/shared/',
      'https://eu.posthog.com/',
    ]) {
      expect(normalizePosthogEmbedUrl(rossz), rossz).toBeNull()
    }
  })

  it('a token karakterkészlete szűk: rövid, hosszú vagy gyanús token → null', () => {
    expect(normalizePosthogEmbedUrl('https://eu.posthog.com/shared/rovid')).toBeNull()
    expect(
      normalizePosthogEmbedUrl(`https://eu.posthog.com/shared/${'a'.repeat(65)}`),
    ).toBeNull()
    // A %2F kódolt perjel dekódolatlanul a pathname része maradna — tiltott.
    expect(
      normalizePosthogEmbedUrl('https://eu.posthog.com/shared/AbCd%2F1234xyz'),
    ).toBeNull()
  })

  it('a visszaadott URL mindig a FIX EU-cloud originre mutat', () => {
    const url = normalizePosthogEmbedUrl('https://eu.posthog.com/shared/AbCd1234xyz')
    expect(url?.startsWith(`${POSTHOG_EMBED_ORIGIN}/embedded/`)).toBe(true)
  })
})

describe('EXTERNAL_ANALYTICS_LINKS', () => {
  it('minden link https és a várt négy felület szerepel', () => {
    expect(EXTERNAL_ANALYTICS_LINKS.map((tool) => tool.label)).toEqual([
      'Google Analytics',
      'Search Console',
      'Google Ads',
      'PostHog',
    ])
    for (const tool of EXTERNAL_ANALYTICS_LINKS) {
      expect(tool.href.startsWith('https://'), tool.href).toBe(true)
    }
  })
})
