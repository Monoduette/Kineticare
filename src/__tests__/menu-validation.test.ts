import type { Access } from 'payload'
import { describe, expect, it } from 'vitest'

import { visibleMenusOrAdmin } from '../access/menus-visibility'
import {
  MAX_MENU_DEPTH,
  clearMismatchedMenuRef,
  extractRelationshipId,
  filterMenuRefOptions,
  validateMenuParentChain,
  validateMenuTypeConsistency,
} from '../lib/menu-validation'

describe('extractRelationshipId', () => {
  it('nyers id-t és populate-olt dokumentumot is kezel', () => {
    expect(extractRelationshipId(5)).toBe(5)
    expect(extractRelationshipId('abc')).toBe('abc')
    expect(extractRelationshipId({ id: 7, label: 'Főoldal' })).toBe(7)
    expect(extractRelationshipId(null)).toBeNull()
    expect(extractRelationshipId(undefined)).toBeNull()
    expect(extractRelationshipId('')).toBeNull()
  })
})

describe('validateMenuTypeConsistency', () => {
  it('url típushoz kötelező az url mező', () => {
    const issues = validateMenuTypeConsistency({ type: 'url', url: '  ' })
    expect(issues).toHaveLength(1)
    expect(issues[0]?.path).toBe('url')
  })

  it('url típus érvényes url-lel rendben van', () => {
    expect(validateMenuTypeConsistency({ type: 'url', url: 'https://kineticare.hu' })).toEqual([])
  })

  it('page/post/product típushoz kötelező a ref', () => {
    for (const type of ['page', 'post', 'product']) {
      const issues = validateMenuTypeConsistency({ type, ref: null })
      expect(issues).toHaveLength(1)
      expect(issues[0]?.path).toBe('ref')
    }
  })

  it('a ref relationTo-jának a type-hoz tartozó collectionre kell mutatnia', () => {
    const issues = validateMenuTypeConsistency({
      type: 'post',
      ref: { relationTo: 'pages', value: 1 },
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]?.path).toBe('ref')
    expect(issues[0]?.message).toContain('posts')
  })

  it('type-konzisztens ref rendben van', () => {
    expect(
      validateMenuTypeConsistency({ type: 'post', ref: { relationTo: 'posts', value: 1 } }),
    ).toEqual([])
    expect(
      validateMenuTypeConsistency({ type: 'product', ref: { relationTo: 'products', value: 2 } }),
    ).toEqual([])
  })

  it('hiányzó vagy ismeretlen type hibás', () => {
    expect(validateMenuTypeConsistency({ ref: { relationTo: 'pages', value: 1 } })[0]?.path).toBe(
      'type',
    )
    expect(validateMenuTypeConsistency({ type: 'category' })[0]?.path).toBe('type')
  })
})

describe('filterMenuRefOptions', () => {
  it.each([
    ['page', 'pages', true],
    ['page', 'posts', false],
    ['page', 'products', false],
    ['post', 'posts', true],
    ['post', 'pages', false],
    ['post', 'products', false],
    ['product', 'products', true],
    ['product', 'pages', false],
    ['product', 'posts', false],
  ] as const)('type=%s, relationTo=%s → %s', (type, relationTo, expected) => {
    expect(filterMenuRefOptions({ relationTo, siblingData: { type } })).toBe(expected)
  })

  it('url típusnál és hiányzó típusnál semelyik kollekció sem jelenik meg', () => {
    expect(filterMenuRefOptions({ relationTo: 'pages', siblingData: { type: 'url' } })).toBe(false)
    expect(filterMenuRefOptions({ relationTo: 'posts', siblingData: {} })).toBe(false)
    expect(filterMenuRefOptions({ relationTo: 'products' })).toBe(false)
  })
})

describe('clearMismatchedMenuRef', () => {
  it('más kollekcióból maradt célt kiüríti típusváltásnál', () => {
    expect(
      clearMismatchedMenuRef({
        type: 'product',
        ref: { relationTo: 'posts', value: 7 },
      }),
    ).toEqual({ type: 'product', ref: null })
  })

  it('illeszkedő célt és az url típust békén hagyja', () => {
    const matching = { type: 'post' as const, ref: { relationTo: 'posts', value: 3 } }
    expect(clearMismatchedMenuRef(matching)).toBe(matching)
    const external = { type: 'url' as const, ref: { relationTo: 'pages', value: 1 } }
    expect(clearMismatchedMenuRef(external)).toBe(external)
  })
})

describe('validateMenuParentChain', () => {
  /** Map-alapú mock fetcher: id → { id, parent } */
  const fetcherFrom = (rows: Record<number, number | null>) => async (id: number | string) => {
    const key = Number(id)
    return key in rows ? { id: key, parent: rows[key] } : null
  }

  it('gyökér (parent nélkül) érvényes', async () => {
    const issues = await validateMenuParentChain({
      docId: 1,
      parent: null,
      fetchById: fetcherFrom({}),
    })
    expect(issues).toEqual([])
  })

  it('gyökér → gyermek (2 szint) érvényes', async () => {
    // 1-es gyökér, 2-es gyermek: a 2-es parentje az 1-es.
    const issues = await validateMenuParentChain({
      docId: 2,
      parent: 1,
      fetchById: fetcherFrom({ 1: null }),
    })
    expect(issues).toEqual([])
  })

  it('3. szintű lánc elutasítva (gyökér → gyermek → unoka tilos)', async () => {
    // 3-as parentje a 2-es, a 2-es parentje az 1-es → 3 szint.
    const issues = await validateMenuParentChain({
      docId: 3,
      parent: 2,
      fetchById: fetcherFrom({ 1: null, 2: 1 }),
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]?.path).toBe('parent')
    expect(issues[0]?.message).toContain(`${MAX_MENU_DEPTH}`)
  })

  it('önmagára mutatás elutasítva', async () => {
    const issues = await validateMenuParentChain({
      docId: 1,
      parent: 1,
      fetchById: fetcherFrom({ 1: 1 }),
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain('önmaga')
  })

  it('ciklus a parent-láncban elutasítva', async () => {
    // 1 → 2 → 3 → 2 kör (nagy maxDepth, hogy a mélység ne előzze meg a ciklus-ellenőrzést).
    const issues = await validateMenuParentChain({
      docId: 1,
      parent: 2,
      fetchById: fetcherFrom({ 2: 3, 3: 2 }),
      maxDepth: 10,
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain('ciklust')
  })

  it('a vizsgált dokumentumra visszamutató lánc is ciklus', async () => {
    // 1-es parentje a 2-es, de a 2-es parentje már az 1-es (update közben).
    const issues = await validateMenuParentChain({
      docId: 1,
      parent: 2,
      fetchById: fetcherFrom({ 2: 1 }),
      maxDepth: 10,
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain('ciklust')
  })

  it('nem létező szülő elutasítva', async () => {
    const issues = await validateMenuParentChain({
      docId: 1,
      parent: 99,
      fetchById: fetcherFrom({}),
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain('nem található')
  })
})

describe('visibleMenusOrAdmin (T-013 menus read-access)', () => {
  const accessArgs = (user: { id: number; role: string } | null): Parameters<Access>[0] =>
    ({ req: { user } }) as unknown as Parameters<Access>[0]

  it('staff/owner minden menüsort lát (true)', () => {
    expect(visibleMenusOrAdmin(accessArgs({ id: 1, role: 'owner' }))).toBe(true)
    expect(visibleMenusOrAdmin(accessArgs({ id: 2, role: 'staff' }))).toBe(true)
  })

  it('látogató és customer csak a visible=true sorokat kapja', () => {
    expect(visibleMenusOrAdmin(accessArgs(null))).toEqual({ visible: { equals: true } })
    expect(visibleMenusOrAdmin(accessArgs({ id: 3, role: 'customer' }))).toEqual({
      visible: { equals: true },
    })
  })
})
