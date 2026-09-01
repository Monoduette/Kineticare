import { describe, expect, it } from 'vitest'

import { OTTHONI_COURSE_SKU, planForSku } from '../lib/curriculum/bunny-keszlet'
import {
  confirmEnabled,
  dontesKurzusra,
  parseImportKapcsolok,
} from '../scripts/import-bunny-curriculum'
import type { Product } from '../payload-types'

function product(partial: Partial<Product> & Pick<Product, 'id' | 'sku'>): Product {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  } as Product
}

describe('parseImportKapcsolok / confirmEnabled', () => {
  it('alapból próbafutás', () => {
    expect(parseImportKapcsolok([])).toEqual({ alkalmaz: false, felulir: false })
    expect(confirmEnabled(undefined)).toBe(false)
    expect(confirmEnabled('igen')).toBe(true)
  })

  it('a kapu KIS/NAGYBETŰRE érzéketlen és trimmel (a másik nyolc owner-kapu konvenciója)', () => {
    for (const value of ['Igen', 'IGEN', ' igen ', '\tIgEn\n']) {
      expect(confirmEnabled(value)).toBe(true)
    }
    for (const value of ['', 'nem', 'igen!', 'yes', 'ige']) {
      expect(confirmEnabled(value)).toBe(false)
    }
  })

  it('az --alkalmaz és --felulir kapcsolót felismeri', () => {
    expect(parseImportKapcsolok(['--alkalmaz', '--felulir'])).toEqual({
      alkalmaz: true,
      felulir: true,
    })
  })
})

describe('dontesKurzusra', () => {
  const plan = planForSku(OTTHONI_COURSE_SKU)!

  it('hiányzó kurzus', () => {
    expect(
      dontesKurzusra({ sku: OTTHONI_COURSE_SKU, publikalt: null, piszkozat: null, felulir: false }),
    ).toEqual({ kind: 'hianyzik', sku: OTTHONI_COURSE_SKU })
  })

  it('üres tananyag → írható', () => {
    const dontes = dontesKurzusra({
      sku: OTTHONI_COURSE_SKU,
      publikalt: product({ id: 1, sku: OTTHONI_COURSE_SKU, modules: [] }),
      piszkozat: null,
      felulir: false,
    })
    expect(dontes.kind).toBe('irhato')
    if (dontes.kind === 'irhato') {
      expect(dontes.plan.sku).toBe(plan.sku)
    }
  })

  it('már a készletet tartalmazza → kész', () => {
    const dontes = dontesKurzusra({
      sku: OTTHONI_COURSE_SKU,
      publikalt: product({ id: 1, sku: OTTHONI_COURSE_SKU, modules: plan.modules }),
      piszkozat: null,
      felulir: false,
    })
    expect(dontes).toMatchObject({ kind: 'kesz', productId: 1, leckek: 23 })
  })

  it('idegen modul → szerkesztett, --felulir nélkül nem ír', () => {
    const dontes = dontesKurzusra({
      sku: OTTHONI_COURSE_SKU,
      publikalt: product({
        id: 1,
        sku: OTTHONI_COURSE_SKU,
        modules: [{ title: 'Saját', lessons: [{ title: 'X', kind: 'video', streamAssetId: 'abc' }] }],
      }),
      piszkozat: null,
      felulir: false,
    })
    expect(dontes.kind).toBe('szerkesztett')
  })

  it('--felulir idegen modulra is írható', () => {
    const dontes = dontesKurzusra({
      sku: OTTHONI_COURSE_SKU,
      publikalt: product({
        id: 1,
        sku: OTTHONI_COURSE_SKU,
        updatedAt: '2026-01-01T00:00:00.000Z',
        modules: [{ title: 'Saját', lessons: [{ title: 'X', kind: 'video', streamAssetId: 'abc' }] }],
      }),
      piszkozat: null,
      felulir: true,
    })
    expect(dontes.kind).toBe('irhato')
  })

  it('frissebb piszkozat tananyaggal → megáll', () => {
    const dontes = dontesKurzusra({
      sku: OTTHONI_COURSE_SKU,
      publikalt: product({
        id: 1,
        sku: OTTHONI_COURSE_SKU,
        updatedAt: '2026-01-01T00:00:00.000Z',
        modules: [],
      }),
      piszkozat: product({
        id: 1,
        sku: OTTHONI_COURSE_SKU,
        updatedAt: '2026-08-01T00:00:00.000Z',
        modules: [{ title: 'Piszkozat', lessons: [{ title: 'Y', kind: 'szoveg' }] }],
      }),
      felulir: false,
    })
    expect(dontes.kind).toBe('piszkozat')
  })
})
