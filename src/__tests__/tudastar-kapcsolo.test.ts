import { describe, expect, it } from 'vitest'

import {
  HUB_UTVONALAK,
  isHubSlug,
  isMenupontLathato,
  isTudastarHref,
  isTudastarKapcsolo,
  isTudastarMenuUrl,
  sajatUtvonal,
  tudastarLathatoMenukbol,
  type TudastarKapcsoloMenu,
} from '../lib/tudastar-kapcsolo'
import { HUB_OLDALAK } from '../lib/tudastar/hub-oldalak'

/**
 * A Tudástár-kapcsoló tiszta szabálya (vezetői döntés, 2026-09-22). A szabály
 * szó szerinti leírása a src/lib/tudastar-kapcsolo.ts fejkommentjében áll.
 */

const SERVER = { serverUrl: 'https://kineticare-production.up.railway.app' }

function url(target: string, extra: Partial<TudastarKapcsoloMenu> = {}): TudastarKapcsoloMenu {
  return { type: 'url', url: target, visible: true, unlisted: false, ...extra }
}

describe('isTudastarMenuUrl: mi számít /blog célúnak', () => {
  it.each([
    ['/blog'],
    ['/blog/'],
    ['/blog?x=1'],
    ['/blog#y'],
    ['/blog/?utm=menu#lista'],
    ['  /blog  '],
    ['https://kineticare.hu/blog'],
    ['https://www.kineticare.hu/blog/'],
    ['http://www.kineticare.hu/blog'],
    ['https://KINETICARE.HU/blog'],
    ['//www.kineticare.hu/blog'],
    ['https://kineticare-production.up.railway.app/blog'],
  ])('%s → kapcsoló-cél', (target) => {
    expect(isTudastarMenuUrl(target, SERVER)).toBe(true)
  })

  it.each([
    ['/blogger', 'más útvonal, csak az eleje egyezik'],
    ['/blog/keztoalagut-szindroma', 'cikk, nem a lista'],
    ['/blog/kategoria/kez-es-csuklo', 'kategória, nem a lista'],
    ['/Blog', 'a Next útvonalai kisbetű-érzékenyek'],
    ['blog', 'lapon belüli relatív cím'],
    ['#blog', 'horgony'],
    ['https://pelda.hu/blog', 'idegen webhely'],
    ['//pelda.hu/blog', 'idegen webhely, protokoll nélkül'],
    ['https://kineticare.hu.pelda.hu/blog', 'hasonló nevű idegen hoszt'],
    ['javascript:alert(1)//blog', 'tiltott séma'],
    ['', 'üres'],
  ])('%s → NEM kapcsoló-cél (%s)', (target) => {
    expect(isTudastarMenuUrl(target, SERVER)).toBe(false)
  })

  it('nem szöveg bemenetre hamis', () => {
    expect(isTudastarMenuUrl(null)).toBe(false)
    expect(isTudastarMenuUrl(undefined)).toBe(false)
    expect(isTudastarMenuUrl(42)).toBe(false)
  })

  it('a szerver-URL alapértelmezése a NEXT_PUBLIC_SERVER_URL', () => {
    const elozo = process.env.NEXT_PUBLIC_SERVER_URL
    process.env.NEXT_PUBLIC_SERVER_URL = 'http://localhost:3100'
    try {
      expect(isTudastarMenuUrl('http://localhost:3100/blog/')).toBe(true)
      expect(isTudastarMenuUrl('http://localhost:3999/blog')).toBe(false)
    } finally {
      process.env.NEXT_PUBLIC_SERVER_URL = elozo
    }
  })
})

describe('isTudastarHref: Tudástár-felületre mutató hivatkozás', () => {
  it('a lista, a cikkek és a kategóriák Tudástár-hivatkozások', () => {
    expect(isTudastarHref('/blog', SERVER)).toBe(true)
    expect(isTudastarHref('/blog/pattano-ujj?ref=kezdolap', SERVER)).toBe(true)
    expect(isTudastarHref('/blog/kategoria/kez-es-csuklo/', SERVER)).toBe(true)
    expect(isTudastarHref('https://www.kineticare.hu/blog/teniszkonyok#gyik', SERVER)).toBe(true)
  })

  it('mind a 8 tünet-hub Tudástár-cikknek számít', () => {
    expect(HUB_UTVONALAK.size).toBe(8)
    for (const hub of HUB_OLDALAK) {
      expect(isTudastarHref(`/${hub.slug}`, SERVER), hub.slug).toBe(true)
      expect(isTudastarHref(`/${hub.slug}/#forrasok`, SERVER), hub.slug).toBe(true)
      expect(isHubSlug(hub.slug)).toBe(true)
    }
  })

  it('a nem Tudástár célok nem hivatkozások rá', () => {
    for (const target of [
      '/',
      '/rolunk',
      '/kurzusok',
      '/kapcsolat#idopontkeres',
      '/blogger',
      '/keztoalagut',
    ]) {
      expect(isTudastarHref(target, SERVER), target).toBe(false)
    }
    expect(isHubSlug('rolunk')).toBe(false)
    expect(isHubSlug(null)).toBe(false)
  })

  it('a sajatUtvonal normalizál: query, hash és záró perjel nélkül', () => {
    expect(sajatUtvonal('/blog/?a=1#b', SERVER)).toBe('/blog')
    expect(sajatUtvonal('/', SERVER)).toBe('/')
    expect(sajatUtvonal('https://kineticare.hu', SERVER)).toBe('/')
    expect(sajatUtvonal('https://pelda.hu/blog', SERVER)).toBeNull()
  })
})

describe('tudastarLathatoMenukbol: a kapcsoló állapota', () => {
  it('nincs kapcsoló-menüpont → BEKAPCSOLT', () => {
    expect(tudastarLathatoMenukbol([])).toBe(true)
    expect(
      tudastarLathatoMenukbol([
        url('/kurzusok'),
        { type: 'post', url: null, visible: false, unlisted: false },
        url('/blog/pattano-ujj', { visible: false }),
        url('/blogger', { visible: false }),
      ]),
    ).toBe(true)
  })

  it('egyetlen látható kapcsoló → BEKAPCSOLT', () => {
    expect(tudastarLathatoMenukbol([url('/blog')])).toBe(true)
  })

  it('visible=false → KIKAPCSOLT', () => {
    expect(tudastarLathatoMenukbol([url('/blog', { visible: false })])).toBe(false)
  })

  it('unlisted=true (rejtett link) → KIKAPCSOLT', () => {
    expect(tudastarLathatoMenukbol([url('/blog/', { unlisted: true })])).toBe(false)
  })

  it('vegyes: ha egy kapcsoló is látszik, BEKAPCSOLT marad', () => {
    expect(
      tudastarLathatoMenukbol([
        url('/blog', { visible: false }),
        url('/blog?x', { unlisted: true }),
        url('https://www.kineticare.hu/blog#y'),
      ]),
    ).toBe(true)
  })

  it('vegyes: minden kapcsoló rejtett (visible=false VAGY unlisted=true) → KIKAPCSOLT', () => {
    expect(
      tudastarLathatoMenukbol([
        url('/blog', { visible: false }),
        url('/blog#y', { unlisted: true }),
        url('/kurzusok'),
        url('/blog/pattano-ujj'),
      ]),
    ).toBe(false)
  })

  it('a hiányzó visible/unlisted az adatbázis alapértéke (látható)', () => {
    expect(tudastarLathatoMenukbol([{ type: 'url', url: '/blog' }])).toBe(true)
    expect(
      tudastarLathatoMenukbol([{ type: 'url', url: '/blog', visible: null, unlisted: null }]),
    ).toBe(true)
  })

  it('csak a type=url menüpont kapcsoló (a /blog-ra mutató post-menüpont nem)', () => {
    expect(isTudastarKapcsolo({ type: 'post', url: '/blog' })).toBe(false)
    expect(isTudastarKapcsolo({ type: 'page', url: '/blog' })).toBe(false)
    expect(tudastarLathatoMenukbol([{ type: 'page', url: '/blog', visible: false }])).toBe(true)
  })

  it('isMenupontLathato ugyanazt a feltételt adja, mint a navigáció szűrője', () => {
    expect(isMenupontLathato({ visible: true, unlisted: false })).toBe(true)
    expect(isMenupontLathato({ visible: false })).toBe(false)
    expect(isMenupontLathato({ unlisted: true })).toBe(false)
  })
})
