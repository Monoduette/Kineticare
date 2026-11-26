import { describe, expect, it } from 'vitest'

import { canonicalHostRedirectUrl, type CanonicalHostInput } from '../lib/canonical-host'

/**
 * A Railway-host oldal-kéréseinek átirányítása a saját domainre
 * (src/lib/canonical-host.ts). Mérve 2026-11-26: a PostHog-munkamenetek 6%-a
 * az Instagram-bióból és a Linktree-ből a Railway-hostra érkezett, külön
 * hozzájárulással és külön azonosítóval. Az őr két irányba véd: a látogató
 * oldala átmegy a www-re, a gépi hívók (Barion-callback, healthcheck, proxy)
 * és minden más host érintetlen marad, és az átirányítás nem vihet idegen
 * hostra.
 */

const SERVER_URL = 'https://www.kineticare.hu'
const RAILWAY = 'kineticare-production.up.railway.app'

function input(overrides: Partial<CanonicalHostInput>): CanonicalHostInput {
  return {
    method: 'GET',
    host: RAILWAY,
    pathname: '/',
    search: '',
    serverUrl: SERVER_URL,
    ...overrides,
  }
}

describe('canonicalHostRedirectUrl', () => {
  it.each([
    ['főoldal', input({}), 'https://www.kineticare.hu/'],
    [
      'kurzusoldal a kampány-paraméterekkel',
      input({ pathname: '/kurzusok/sos-kezrelax-villamkurzus', search: '?utm_source=ig' }),
      'https://www.kineticare.hu/kurzusok/sos-kezrelax-villamkurzus?utm_source=ig',
    ],
    [
      'HEAD-kérés',
      input({ method: 'HEAD', pathname: '/kapcsolat' }),
      'https://www.kineticare.hu/kapcsolat',
    ],
    [
      'porttal és nagybetűvel jelzett host',
      input({ host: 'Kineticare-Production.UP.railway.app:443' }),
      'https://www.kineticare.hu/',
    ],
    [
      'dupla perjeles útvonal a saját hoston marad',
      input({ pathname: '//masik-oldal.hu/x' }),
      'https://www.kineticare.hu//masik-oldal.hu/x',
    ],
  ])('%s → átirányít', (_name, request, expected) => {
    expect(canonicalHostRedirectUrl(request)).toBe(expected)
  })

  it.each([
    ['a saját domain', input({ host: 'www.kineticare.hu' })],
    [
      'a Railway-healthcheck hostja',
      input({ host: 'healthcheck.railway.app', pathname: '/admin' }),
    ],
    ['hiányzó host', input({ host: null })],
    ['POST (Barion-callback)', input({ method: 'POST', pathname: '/api/barion/callback' })],
    ['POST oldal-útvonalra', input({ method: 'POST', pathname: '/penztar' })],
    ['/api GET', input({ pathname: '/api/media/file/kep.webp' })],
    ['/admin (healthcheck-útvonal)', input({ pathname: '/admin' })],
    ['/ingest (PostHog-proxy)', input({ pathname: '/ingest/e/' })],
    ['/_next', input({ pathname: '/_next/data/x.json' })],
    ['hiányzó cél', input({ serverUrl: undefined })],
    ['hibás cél', input({ serverUrl: 'nem-url' })],
    ['http cél', input({ serverUrl: 'http://www.kineticare.hu' })],
    [
      'a cél maga is Railway-host (önmagára irányítana)',
      input({ serverUrl: `https://${RAILWAY}` }),
    ],
  ])('%s → marad', (_name, request) => {
    expect(canonicalHostRedirectUrl(request)).toBeNull()
  })

  it('a /apix és /adminisztracio nem kivétel, csak a pontos előtag', () => {
    expect(canonicalHostRedirectUrl(input({ pathname: '/apix' }))).toBe(
      'https://www.kineticare.hu/apix',
    )
    expect(canonicalHostRedirectUrl(input({ pathname: '/adminisztracio' }))).toBe(
      'https://www.kineticare.hu/adminisztracio',
    )
  })
})
