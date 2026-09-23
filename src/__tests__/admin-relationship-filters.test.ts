import type { Field, RelationshipField } from 'payload'
import { describe, expect, it } from 'vitest'

import { Menus } from '../collections/Menus'
import { Pages } from '../collections/Pages'
import { Posts } from '../collections/Posts'
import {
  STAFF_OR_OWNER_USER_WHERE,
  excludeSelfWhere,
  relatedPostsFilter,
  rootMenuParentFilter,
  rootMenuParentWhere,
  staffOrOwnerUserFilter,
} from '../lib/admin/relationship-filters'
import { filterMenuRefOptions } from '../lib/menu-validation'

function rootFields(fields: Field[], acc = new Map<string, Field>()): Map<string, Field> {
  for (const field of fields) {
    if ('name' in field && typeof field.name === 'string') {
      acc.set(field.name, field)
      continue
    }
    if (field.type === 'row' || field.type === 'collapsible' || field.type === 'group') {
      rootFields(field.fields, acc)
      continue
    }
    // A név nélküli fül csak megjelenítés: a mezői a gyökérszinten tárolódnak.
    if (field.type === 'tabs') {
      for (const tab of field.tabs) {
        if (!('name' in tab) || !tab.name) rootFields(tab.fields, acc)
      }
    }
  }
  return acc
}

function relationshipOf(fields: Field[], name: string): RelationshipField {
  const field = rootFields(fields).get(name)
  if (!field || field.type !== 'relationship') {
    throw new Error(`a ${name} mező nem relationship`)
  }
  return field
}

function filterArgs(overrides: {
  id?: number | string
  relationTo: string
  siblingData?: unknown
}) {
  return {
    blockData: {},
    data: {},
    id: overrides.id as number,
    relationTo: overrides.relationTo as never,
    req: {} as never,
    siblingData: overrides.siblingData ?? {},
    user: {},
  }
}

describe('staffOrOwnerUserFilter', () => {
  it('csak staff és owner szerepel, vásárló nem', () => {
    expect(STAFF_OR_OWNER_USER_WHERE).toEqual({ role: { in: ['staff', 'owner'] } })
    expect(staffOrOwnerUserFilter()).toEqual(STAFF_OR_OWNER_USER_WHERE)
  })
})

describe('excludeSelfWhere / relatedPostsFilter', () => {
  it('meglévő dokumentumnál kizárja az aktuális id-t', () => {
    expect(excludeSelfWhere(12)).toEqual({ id: { not_equals: 12 } })
    expect(relatedPostsFilter(filterArgs({ id: 12, relationTo: 'posts' }))).toEqual({
      id: { not_equals: 12 },
    })
  })

  it('create-űrlapon (nincs id) mindent megenged', () => {
    expect(excludeSelfWhere(undefined)).toBe(true)
    expect(excludeSelfWhere('')).toBe(true)
    expect(relatedPostsFilter(filterArgs({ relationTo: 'posts' }))).toBe(true)
  })
})

describe('rootMenuParentWhere', () => {
  it('csak gyökér menüpontot enged, és nem önmagát', () => {
    expect(rootMenuParentWhere(4)).toEqual({
      and: [{ parent: { exists: false } }, { id: { not_equals: 4 } }],
    })
  })

  it('új menüpontnál csak a gyökér-szűrő marad', () => {
    expect(rootMenuParentWhere(undefined)).toEqual({ parent: { exists: false } })
  })
})

describe('collection bekötés', () => {
  it('a menü Cél mezője típustól függően egy kollekciót mutat', () => {
    const ref = relationshipOf(Menus.fields, 'ref')
    expect(ref.relationTo).toEqual(['pages', 'posts', 'products'])
    expect(typeof ref.filterOptions).toBe('function')
    if (typeof ref.filterOptions !== 'function') return
    expect(
      ref.filterOptions(filterArgs({ relationTo: 'posts', siblingData: { type: 'post' } })),
    ).toBe(true)
    expect(
      ref.filterOptions(filterArgs({ relationTo: 'products', siblingData: { type: 'post' } })),
    ).toBe(false)
    expect(ref.admin?.allowCreate).toBe(false)
  })

  it('a menü fölérendelt listája csak gyökér menüpontot kínál', () => {
    const parent = relationshipOf(Menus.fields, 'parent')
    expect(parent.filterOptions).toBe(rootMenuParentFilter)
    expect(parent.admin?.allowCreate).toBe(false)
  })

  it('a cikk és oldal szerző/lektor mezője staff+owner szűrős', () => {
    for (const field of [
      relationshipOf(Posts.fields, 'author'),
      relationshipOf(Posts.fields, 'reviewedBy'),
      relationshipOf(Pages.fields, 'author'),
      relationshipOf(Pages.fields, 'reviewedBy'),
    ]) {
      expect(field.relationTo).toBe('users')
      expect(field.filterOptions).toBe(staffOrOwnerUserFilter)
      expect(field.admin?.allowCreate).toBe(false)
    }
  })

  it('a kapcsolódó bejegyzések listája a saját cikket kihagyja', () => {
    const related = relationshipOf(Posts.fields, 'relatedPosts')
    expect(related.relationTo).toBe('posts')
    expect(related.filterOptions).toBe(relatedPostsFilter)
    expect(related.admin?.allowCreate).toBe(false)
  })

  it('a filterMenuRefOptions a collection-szűrővel azonos szabályt ad', () => {
    expect(filterMenuRefOptions({ relationTo: 'pages', siblingData: { type: 'page' } })).toBe(true)
    expect(filterMenuRefOptions({ relationTo: 'posts', siblingData: { type: 'page' } })).toBe(false)
  })
})
