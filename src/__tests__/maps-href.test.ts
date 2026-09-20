import { describe, expect, it } from 'vitest'

import { MAPS_LINK_HINT, mapsHref } from '@/lib/maps-href'

/**
 * A rendelői cím → Google Térkép-link (src/lib/maps-href.ts) őre.
 *
 * A link a Google Maps URLs `search` végpontját használja, `api=1` ELSŐ
 * paraméterrel és `query`-vel (Google, Maps URLs — Get started:
 * https://developers.google.com/maps/documentation/urls/get-started). A cím
 * `encodeURIComponent`-en át kerül a query-be, tehát ékezet, vessző, per
 * és szóköz sem törheti el, és injektálható rész sem marad benne.
 */
describe('mapsHref', () => {
  it('a Google Maps `search` végpontját adja, `api=1` majd `query` sorrendben', () => {
    expect(mapsHref('1117 Budapest, Nádorliget u. 7/b')).toBe(
      'https://www.google.com/maps/search/?api=1&query=1117%20Budapest%2C%20N%C3%A1dorliget%20u.%207%2Fb',
    )
  })

  it('a címet URL-komponensként kódolja: ékezet, vessző, per, szóköz és & sem marad nyersen', () => {
    const href = mapsHref('1114 Budapest, Fadrusz utca 15. & Kossuth tér')
    expect(href).toBe(
      'https://www.google.com/maps/search/?api=1&query=1114%20Budapest%2C%20Fadrusz%20utca%2015.%20%26%20Kossuth%20t%C3%A9r',
    )
    // A query-érték egyetlen paraméter marad: a nyers `&` nem bont új paramétert.
    const query = new URL(href!).searchParams
    expect(query.get('api')).toBe('1')
    expect(query.get('query')).toBe('1114 Budapest, Fadrusz utca 15. & Kossuth tér')
    expect([...query.keys()]).toEqual(['api', 'query'])
  })

  it('a szélső szóközöket levágja, a belsőket megtartja', () => {
    expect(mapsHref('  1117 Budapest  ')).toBe(
      'https://www.google.com/maps/search/?api=1&query=1117%20Budapest',
    )
  })

  it('üres vagy csak szóközből álló címre null (nincs értelmetlen link)', () => {
    expect(mapsHref('')).toBeNull()
    expect(mapsHref('   ')).toBeNull()
  })

  it('a képernyőolvasó-toldat a pénztári minta alakját követi: szóközzel indul, zárójeles, gondolatjel nélkül', () => {
    expect(MAPS_LINK_HINT).toBe(' (Google Térkép, új lapon nyílik)')
    expect(MAPS_LINK_HINT.startsWith(' (')).toBe(true)
    expect(MAPS_LINK_HINT.endsWith(')')).toBe(true)
    expect(MAPS_LINK_HINT).not.toMatch(/[–—]/u)
  })
})
