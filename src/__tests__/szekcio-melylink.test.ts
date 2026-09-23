import { baseIDField } from 'payload'
import { describe, expect, it } from 'vitest'

import {
  BLOKK_ID_MINTA,
  SZEKCIO_PARAM,
  ervenyesBlokkId,
  szekcioIndexe,
  szekcioMelylink,
  szekcioSorDomId,
  szerkesztoUtvonal,
} from '../components/editor/szekcio-melylink'

/**
 * A szekció-mélylink tiszta modulja (src/components/editor/szekcio-melylink.ts):
 * a paraméter neve, a blokk-azonosító ellenőrzése, a cím építése és
 * értelmezése. Ugyanezt használja az admin átirányító nézete, a mélylink-nyitó
 * és a 2. kör frontend-rétege, ezért a szerződést itt rögzítjük.
 */

/** Élő adatból vett, valódi alakú azonosító (a kezdőlap nyitó videója). */
const VALODI_ID = '6ab2d1c655cfcd3e03073521'

describe('a blokk-azonosító ellenőrzése', () => {
  it('a paraméter neve szekcio', () => {
    expect(SZEKCIO_PARAM).toBe('szekcio')
  })

  it('a Payload saját azonosító-generátorának kimenetét elfogadja (bson ObjectId, 24 hex)', () => {
    // A tömb- és blokksorok `id` mezőjének alapértéke (payload baseIDField).
    const general = baseIDField.defaultValue as () => string
    for (let i = 0; i < 20; i += 1) {
      expect(ervenyesBlokkId(general())).toBe(true)
    }
    expect(ervenyesBlokkId(VALODI_ID)).toBe(true)
    expect(BLOKK_ID_MINTA.source).toBe('^[a-f0-9]{24}$')
  })

  it.each([
    ['rövid', 'abc'],
    ['nagybetűs', '6AB2D1C655CFCD3E03073521'],
    ['25 jegyű', `${VALODI_ID}0`],
    ['szkript', '<script>alert(1)</script>'],
    ['külső cím', 'https://pelda.hu/'],
    ['útvonal-bejárás', '../../admin'],
    ['üres', ''],
  ])('elutasítja: %s', (_nev, ertek) => {
    expect(ervenyesBlokkId(ertek)).toBe(false)
  })

  it('nem szöveg értéket sem fogad el', () => {
    expect(ervenyesBlokkId(null)).toBe(false)
    expect(ervenyesBlokkId(undefined)).toBe(false)
    expect(ervenyesBlokkId(123)).toBe(false)
    expect(ervenyesBlokkId({ id: VALODI_ID })).toBe(false)
  })
})

describe('a szerkesztő címének építése', () => {
  it('érvényes blokk-azonosítóval a szekció paraméterrel', () => {
    expect(szekcioMelylink({ collection: 'pages', id: 1, blokkId: VALODI_ID })).toBe(
      `/admin/collections/pages/1?szekcio=${VALODI_ID}`,
    )
  })

  it('blokk-azonosító nélkül vagy hibás alakúval a szerkesztő tetejére', () => {
    expect(szekcioMelylink({ collection: 'pages', id: 1 })).toBe('/admin/collections/pages/1')
    expect(szekcioMelylink({ collection: 'pages', id: 1, blokkId: null })).toBe(
      '/admin/collections/pages/1',
    )
    expect(szekcioMelylink({ collection: 'pages', id: '7', blokkId: 'rossz' })).toBe(
      '/admin/collections/pages/7',
    )
  })

  it('a config admin-útvonalát használja (a gyökér és a záró perjel is)', () => {
    expect(szekcioMelylink({ adminRoute: '/kezelo/', collection: 'pages', id: 3 })).toBe(
      '/kezelo/collections/pages/3',
    )
    expect(szekcioMelylink({ adminRoute: '/', collection: 'pages', id: 3 })).toBe(
      '/collections/pages/3',
    )
  })

  it('hibás collection vagy dokumentum-azonosító programhiba: dob', () => {
    expect(() => szekcioMelylink({ collection: '../x', id: 1 })).toThrow(TypeError)
    expect(() => szekcioMelylink({ collection: 'pages', id: 'create' })).toThrow(TypeError)
    expect(() => szekcioMelylink({ collection: 'pages', id: '1?x=y' })).toThrow(TypeError)
    expect(() => szekcioMelylink({ collection: 'pages', id: -1 })).toThrow(TypeError)
    expect(() => szekcioMelylink({ collection: 'pages', id: 1.5 })).toThrow(TypeError)
  })
})

describe('a szerkesztő útvonalának értelmezése', () => {
  it('pontosan egy dokumentum szerkesztőjét ismeri fel', () => {
    expect(szerkesztoUtvonal('/admin/collections/pages/1')).toEqual({
      collection: 'pages',
      id: '1',
    })
    expect(szerkesztoUtvonal('/admin/collections/pages/1/')).toEqual({
      collection: 'pages',
      id: '1',
    })
  })

  it.each([
    '/admin',
    '/admin/collections/pages',
    '/admin/collections/pages/create',
    '/admin/collections/pages/1/versions',
    '/admin/collections/pages/1/api',
    '/admin/kezdolap',
    '/api/pages/1',
  ])('más útvonalon null: %s', (utvonal) => {
    expect(szerkesztoUtvonal(utvonal)).toBeNull()
  })

  it('más admin-útvonal alatt is működik', () => {
    expect(szerkesztoUtvonal('/kezelo/collections/posts/4', '/kezelo')).toEqual({
      collection: 'posts',
      id: '4',
    })
    expect(szerkesztoUtvonal('/admin/collections/posts/4', '/kezelo')).toBeNull()
  })
})

describe('a sorindex és a Payload sor-azonosítója', () => {
  const layout = [
    { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', blockType: 'credsStrip' },
    { id: VALODI_ID, blockType: 'filmHero' },
  ]

  it('a legújabb layout sorrendjéből adja az indexet', () => {
    expect(szekcioIndexe(layout, VALODI_ID)).toBe(1)
  })

  it('elavult azonosítónál és hibás adatnál null', () => {
    expect(szekcioIndexe(layout, 'bbbbbbbbbbbbbbbbbbbbbbbb')).toBeNull()
    expect(szekcioIndexe(undefined, VALODI_ID)).toBeNull()
    expect(szekcioIndexe([null, 'x', 3], VALODI_ID)).toBeNull()
  })

  it('a DOM-azonosító index-alapú, a Payload BlockRow képlete szerint', () => {
    expect(szekcioSorDomId('layout', 0)).toBe('layout-row-0')
    expect(szekcioSorDomId('tartalom.layout', 11)).toBe('tartalom-layout-row-11')
  })
})
