import { generateFieldID } from '@payloadcms/ui/utilities/generateFieldID'
import { describe, expect, it } from 'vitest'

import {
  MEZO_PARAM,
  MEZO_UTVONAL_MINTA,
  SZEKCIO_PARAM,
  ervenyesMezoUtvonal,
  mezoDomId,
  mezoParameter,
  szekcioMelylink,
} from '../components/editor/szekcio-melylink'

/**
 * A mező-mélylink szerződése (H06, H50/B26): a `?mezo=` paraméter építése és
 * értelmezése a src/components/editor/szekcio-melylink.ts-ben. Az A6
 * (kurzusoldal forrás-szalagjai) és a B csapat (VideoSzovegeiNezet) ezt az
 * API-t hívja, ezért a kimenetet itt betűre rögzítjük.
 */

const BLOKK = '6ab2d1c655cfcd3e03073521'

describe('a mezőútvonal ellenőrzése', () => {
  it('a paraméter neve mezo, a szekcióé változatlanul szekcio', () => {
    expect(MEZO_PARAM).toBe('mezo')
    expect(SZEKCIO_PARAM).toBe('szekcio')
  })

  it.each(['captions', 'howItWorks', 'seo.title', 'a', 'endBodyWithoutFreeSos', 'x_1.y2'])(
    'elfogadja: %s',
    (ertek) => {
      expect(ervenyesMezoUtvonal(ertek)).toBe(true)
    },
  )

  it('legfeljebb 128 karakter', () => {
    expect(ervenyesMezoUtvonal('a'.repeat(128))).toBe(true)
    expect(ervenyesMezoUtvonal('a'.repeat(129))).toBe(false)
    expect(ervenyesMezoUtvonal(`${'a'.repeat(63)}.${'b'.repeat(64)}`)).toBe(true)
    expect(ervenyesMezoUtvonal(`${'a'.repeat(64)}.${'b'.repeat(64)}`)).toBe(false)
  })

  it.each([
    ['üres', ''],
    ['számmal kezdődő', '1captions'],
    ['sorindexes útvonal', 'layout.0.captions'],
    ['záró pont', 'seo.'],
    ['kezdő pont', '.seo'],
    ['dupla pont', 'seo..title'],
    ['kötőjel', 'how-it-works'],
    ['szóköz', 'how it'],
    ['ékezet', 'mező'],
    ['szkript', '<script>alert(1)</script>'],
    ['CSS-szelektor', 'a],[b'],
    ['idézőjel', 'a"b'],
    ['külső cím', 'https://pelda.hu'],
    ['útvonal-bejárás', '../admin'],
    ['sortörés', 'captions\n'],
  ])('elutasítja: %s', (_nev, ertek) => {
    expect(ervenyesMezoUtvonal(ertek)).toBe(false)
  })

  it('nem szöveg értéket sem fogad el', () => {
    expect(ervenyesMezoUtvonal(null)).toBe(false)
    expect(ervenyesMezoUtvonal(undefined)).toBe(false)
    expect(ervenyesMezoUtvonal(12)).toBe(false)
    expect(ervenyesMezoUtvonal(['captions'])).toBe(false)
  })

  it('a minta horgonyzott (részleges egyezés nincs)', () => {
    expect(MEZO_UTVONAL_MINTA.source.startsWith('^')).toBe(true)
    expect(MEZO_UTVONAL_MINTA.source.endsWith('$')).toBe(true)
  })
})

describe('szekcioMelylink: a mező-paraméter építése', () => {
  it('szekció + mező: …?szekcio=<blokkId>&mezo=<mezo>', () => {
    expect(szekcioMelylink({ collection: 'pages', id: 1, blokkId: BLOKK, mezo: 'captions' })).toBe(
      `/admin/collections/pages/1?szekcio=${BLOKK}&mezo=captions`,
    )
  })

  it('csak mező: …?mezo=<mezo>', () => {
    expect(szekcioMelylink({ collection: 'products', id: 12, mezo: 'howItWorks' })).toBe(
      '/admin/collections/products/12?mezo=howItWorks',
    )
    expect(szekcioMelylink({ collection: 'products', id: 12, mezo: 'seo.title' })).toBe(
      '/admin/collections/products/12?mezo=seo.title',
    )
  })

  it('csak szekció: a mai kimenet BETŰRE', () => {
    expect(szekcioMelylink({ collection: 'pages', id: 1, blokkId: BLOKK })).toBe(
      `/admin/collections/pages/1?szekcio=${BLOKK}`,
    )
    expect(szekcioMelylink({ collection: 'pages', id: 1, blokkId: BLOKK, mezo: null })).toBe(
      `/admin/collections/pages/1?szekcio=${BLOKK}`,
    )
    expect(szekcioMelylink({ collection: 'pages', id: 1 })).toBe('/admin/collections/pages/1')
    expect(szekcioMelylink({ adminRoute: '/', collection: 'pages', id: 1, blokkId: BLOKK })).toBe(
      `/collections/pages/1?szekcio=${BLOKK}`,
    )
  })

  it('hibás alakú mező: TypeError (programhiba, a hívó kódkonstanst ad)', () => {
    for (const mezo of ['', 'layout.0.captions', 'a&b=c', '<x>', 'mező']) {
      expect(() => szekcioMelylink({ collection: 'products', id: 12, mezo })).toThrow(TypeError)
      expect(() => szekcioMelylink({ collection: 'pages', id: 1, blokkId: BLOKK, mezo })).toThrow(
        TypeError,
      )
    }
  })

  it('hibás vagy hiányzó (null) szekció: a szekció a mai módon némán elmarad, és a hozzá relatív mező is', () => {
    expect(
      szekcioMelylink({ collection: 'pages', id: 1, blokkId: 'rossz', mezo: 'captions' }),
    ).toBe('/admin/collections/pages/1')
    expect(szekcioMelylink({ collection: 'pages', id: 1, blokkId: null, mezo: 'captions' })).toBe(
      '/admin/collections/pages/1',
    )
    expect(szekcioMelylink({ collection: 'pages', id: 1, blokkId: 'rossz' })).toBe(
      '/admin/collections/pages/1',
    )
  })

  it('a kódolás URLSearchParams-szal történik: a kimenet visszaolvasva ugyanazt adja', () => {
    const cim = szekcioMelylink({
      collection: 'pages',
      id: 7,
      blokkId: BLOKK,
      mezo: 'seo.title',
    })
    const url = new URL(cim, 'https://kineticare.hu')
    expect(url.pathname).toBe('/admin/collections/pages/7')
    expect([...url.searchParams.keys()]).toEqual(['szekcio', 'mezo'])
    expect(url.searchParams.get('szekcio')).toBe(BLOKK)
    expect(url.searchParams.get('mezo')).toBe('seo.title')
    expect(url.search).toBe(
      `?${new URLSearchParams({ szekcio: BLOKK, mezo: 'seo.title' }).toString()}`,
    )
  })

  it('a meglévő collection- és azonosító-ellenőrzés mezővel is dob', () => {
    expect(() => szekcioMelylink({ collection: 'Pages', id: 1, mezo: 'captions' })).toThrow(
      TypeError,
    )
    expect(() => szekcioMelylink({ collection: 'pages', id: 'create', mezo: 'captions' })).toThrow(
      TypeError,
    )
  })
})

describe('mezoParameter: a ?mezo= értelmezése', () => {
  it('URLSearchParams-ból és keresőszövegből is', () => {
    expect(mezoParameter(new URLSearchParams('mezo=captions'))).toBe('captions')
    expect(mezoParameter(`?szekcio=${BLOKK}&mezo=captions`)).toBe('captions')
    expect(mezoParameter('mezo=seo.title')).toBe('seo.title')
  })

  it('hiányzó vagy hibás alakú értéknél null', () => {
    expect(mezoParameter('')).toBeNull()
    expect(mezoParameter(`?szekcio=${BLOKK}`)).toBeNull()
    expect(mezoParameter('?mezo=')).toBeNull()
    expect(mezoParameter('?mezo=%3Cscript%3E')).toBeNull()
    expect(mezoParameter('?mezo=layout.0.captions')).toBeNull()
  })

  it('az építő kimenetét visszaolvassa', () => {
    const cim = szekcioMelylink({ collection: 'products', id: 3, mezo: 'howItWorks' })
    expect(mezoParameter(new URL(cim, 'https://kineticare.hu').searchParams)).toBe('howItWorks')
  })
})

describe('mezoDomId: a Payload mezőazonosítója', () => {
  it('field- előtag, a pontok helyén __ (generateFieldID.js)', () => {
    expect(mezoDomId('howItWorks')).toBe('field-howItWorks')
    expect(mezoDomId('layout.0.captions')).toBe('field-layout__0__captions')
    expect(mezoDomId('seo.title')).toBe('field-seo__title')
  })

  it('betűre egyezik a Payload saját generátorával (a fő szerkesztőben editDepth = 1)', () => {
    for (const utvonal of ['howItWorks', 'layout.0.captions', 'layout.12.captions.midTitle']) {
      expect(mezoDomId(utvonal)).toBe(generateFieldID(utvonal, 1, ''))
    }
  })
})
