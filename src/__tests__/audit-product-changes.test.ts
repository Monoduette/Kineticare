import type { CollectionConfig, Config } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import {
  PRODUCT_AUDIT_FIELD_GROUPS,
  audit,
  auditAfterChange,
  auditProductBeforeChange,
  productPublishedChangeActions,
} from '../plugins/audit'

/**
 * r2-termekor (a-cms-12): a kurzus KÖZZÉTETT állapotának naplója
 * (src/plugins/audit.ts). A régi „publish” bejegyzés `before` mezője az
 * autosave-es piszkozat volt, amely közzétételkor már az új árat hordozta, és a
 * lomtár, a visszaállítás és a közzététel visszavonása nem került a naplóba.
 *
 * DB nélkül: a `findByID` stub adja a fő táblás sort a mentés előtt és után, a
 * `create` stub rögzíti az audit-bejegyzést. Hálózat nincs.
 */

type CreateCall = { collection: string; data: Record<string, unknown>; overrideAccess?: boolean }

const PUBLISHED = {
  id: 1,
  _status: 'published',
  deletedAt: null,
  sku: 'Otthoni KézRehab Program',
  priceInHUF: 79_500,
  priceInHUFEnabled: true,
  promoEnabled: false,
  promoStart: null,
  promoEnd: null,
  promoPriceHuf: null,
  accessDurationDays: null,
  status: 'published',
  unlisted: false,
}

function fakeReq(
  rows: Array<Record<string, unknown> | Error>,
  query: Record<string, unknown> = {},
) {
  const queue = [...rows]
  const findByID = vi.fn(async () => {
    const next = queue.shift()
    if (next === undefined) throw new Error('Ebben az esetben nem kellene olvasni.')
    if (next instanceof Error) throw next
    return next
  })
  const create = vi.fn<(args: CreateCall) => Promise<{ id: number }>>(async () => ({ id: 1 }))
  return {
    req: {
      payload: { findByID, create },
      headers: new Headers({ 'x-request-id': 'req-termek-1' }),
      user: { id: 5, role: 'owner' },
      context: {} as Record<string, unknown>,
      query,
    },
    findByID,
    create,
  }
}

type Req = ReturnType<typeof fakeReq>['req']

async function runSave(
  req: Req,
  options: {
    data: Record<string, unknown>
    doc: Record<string, unknown>
    previousDoc: Record<string, unknown>
  },
) {
  await auditProductBeforeChange({
    data: options.data,
    operation: 'update',
    originalDoc: options.previousDoc,
    req,
    collection: { slug: 'products' },
    context: req.context,
  } as never)
  return auditAfterChange({
    doc: options.doc,
    previousDoc: options.previousDoc,
    req,
    operation: 'update',
    collection: { slug: 'products' },
  } as never)
}

describe('productPublishedChangeActions: a két közzétett sor különbsége', () => {
  it('mezőcsoportonként egy művelet', () => {
    const cases: Array<[Record<string, unknown>, string[]]> = [
      [{ priceInHUF: 39_500 }, ['price-change']],
      [{ priceInHUFEnabled: false }, ['price-change']],
      [{ promoEnd: '2026-10-31T12:00:00.000Z' }, ['promo-change']],
      [{ promoPriceHuf: 19_900, promoEnabled: true }, ['promo-change']],
      [{ accessDurationDays: 365 }, ['duration-change']],
      [{ status: 'archived' }, ['status-change']],
      [{ unlisted: true }, ['unlisted-change']],
      [{ priceInHUF: 39_500, status: 'archived' }, ['price-change', 'status-change']],
    ]
    for (const [change, expected] of cases) {
      expect(productPublishedChangeActions(PUBLISHED, { ...PUBLISHED, ...change })).toEqual(
        expected,
      )
    }
    expect(Object.keys(PRODUCT_AUDIT_FIELD_GROUPS)).toEqual([
      'price-change',
      'promo-change',
      'duration-change',
      'status-change',
      'unlisted-change',
    ])
  })

  it('közzététel visszavonása, lomtár és visszaállítás', () => {
    expect(productPublishedChangeActions(PUBLISHED, { ...PUBLISHED, _status: 'draft' })).toEqual([
      'unpublish',
    ])
    const trashed = { ...PUBLISHED, deletedAt: '2026-09-24T10:00:00.000Z' }
    expect(productPublishedChangeActions(PUBLISHED, trashed)).toEqual(['trash'])
    expect(productPublishedChangeActions(trashed, PUBLISHED)).toEqual(['restore'])
  })

  it('változatlan sor, null és hiányzó érték, azonos dátum: nincs művelet', () => {
    expect(productPublishedChangeActions(PUBLISHED, { ...PUBLISHED })).toEqual([])
    const withoutPromoEnd: Record<string, unknown> = { ...PUBLISHED }
    delete withoutPromoEnd.promoEnd
    expect(productPublishedChangeActions(PUBLISHED, withoutPromoEnd)).toEqual([])
    expect(
      productPublishedChangeActions(
        { ...PUBLISHED, promoEnd: new Date('2026-10-31T12:00:00.000Z') },
        { ...PUBLISHED, promoEnd: '2026-10-31T12:00:00.000Z' },
      ),
    ).toEqual([])
    expect(productPublishedChangeActions(null, PUBLISHED)).toEqual([])
  })
})

describe('kurzus mentése: a napló a KÖZZÉTETT régi és új értéket rögzíti, a mentővel', () => {
  it('a-cms-12 esete: az autosave-es piszkozat már az új árat hordozza, a napló mégis a régit mutatja', async () => {
    const after = { ...PUBLISHED, priceInHUF: 39_500 }
    const { req, create, findByID } = fakeReq([PUBLISHED, after])
    // A previousDoc a legutóbbi piszkozat: már 39 500 Ft áll benne.
    const draft = { ...PUBLISHED, _status: 'draft', priceInHUF: 39_500 }
    await runSave(req, {
      data: { _status: 'published', priceInHUF: 39_500 },
      doc: { ...after },
      previousDoc: draft,
    })
    expect(findByID).toHaveBeenCalledTimes(2)
    expect(findByID).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'products',
        id: 1,
        draft: false,
        overrideAccess: true,
        trash: true,
        depth: 0,
      }),
    )
    expect(create).toHaveBeenCalledTimes(1)
    const entry = create.mock.calls[0][0].data
    expect(entry).toMatchObject({
      action: 'publish,price-change',
      actor: 5,
      entityType: 'products',
      entityId: '1',
      requestId: 'req-termek-1',
    })
    expect(entry.before).toMatchObject({ priceInHUF: 79_500 })
    expect(entry.after).toMatchObject({ priceInHUF: 39_500 })
  })

  it('akció, hozzáférés-hossz, megjelenés és rejtettség változása egy bejegyzésben', async () => {
    const after = {
      ...PUBLISHED,
      promoEnabled: true,
      promoEnd: '2026-10-31T12:00:00.000Z',
      promoPriceHuf: 59_900,
      accessDurationDays: 365,
      status: 'archived',
      unlisted: true,
    }
    const { req, create } = fakeReq([PUBLISHED, after])
    await runSave(req, {
      data: { _status: 'published' },
      doc: after,
      previousDoc: { ...after, _status: 'draft' },
    })
    expect(create.mock.calls[0][0].data.action).toBe(
      'publish,promo-change,duration-change,status-change,unlisted-change',
    )
  })

  it('közzététel visszavonása (draft paraméter nélkül fut): unpublish', async () => {
    const after = { ...PUBLISHED, _status: 'draft' }
    const { req, create } = fakeReq([PUBLISHED, after])
    await runSave(req, { data: { _status: 'draft' }, doc: after, previousDoc: PUBLISHED })
    expect(create.mock.calls[0][0].data.action).toBe('unpublish')
    expect(create.mock.calls[0][0].data.before).toMatchObject({ _status: 'published' })
  })

  it('lomtárba helyezés és visszaállítás', async () => {
    const trashed = { ...PUBLISHED, deletedAt: '2026-09-24T10:00:00.000Z' }
    const toTrash = fakeReq([PUBLISHED, trashed])
    await runSave(toTrash.req, {
      data: { deletedAt: trashed.deletedAt },
      doc: trashed,
      previousDoc: PUBLISHED,
    })
    expect(toTrash.create.mock.calls[0][0].data.action).toBe('trash')

    const restore = fakeReq([trashed, PUBLISHED])
    await runSave(restore.req, {
      data: { deletedAt: null, _status: 'published' },
      doc: PUBLISHED,
      previousDoc: trashed,
    })
    expect(restore.create.mock.calls[0][0].data.action).toBe('restore')
  })

  it('piszkozat-mentés (autosave, ?draft=true): nem olvas, nem ír naplót', async () => {
    const { req, create, findByID } = fakeReq([], { draft: 'true', autosave: 'true' })
    const draft = { ...PUBLISHED, _status: 'draft', priceInHUF: 39_500 }
    await runSave(req, {
      data: { _status: 'draft', priceInHUF: 39_500 },
      doc: draft,
      previousDoc: draft,
    })
    expect(findByID).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('olvasási hiba: a mentés nem bukik el, a napló a régi módon ír', async () => {
    const { req, create } = fakeReq([new Error('DB-hiba')])
    const previousDoc = { ...PUBLISHED, _status: 'draft' }
    await expect(
      runSave(req, { data: { _status: 'published' }, doc: PUBLISHED, previousDoc }),
    ).resolves.toEqual(PUBLISHED)
    expect(create.mock.calls[0][0].data.action).toBe('publish')
    expect(create.mock.calls[0][0].data.before).toMatchObject({ _status: 'draft' })
  })

  it('új kurzus (create): csak create, közzétett sort nem olvas', async () => {
    const { req, create, findByID } = fakeReq([])
    await auditProductBeforeChange({
      data: { sku: 'Új' },
      operation: 'create',
      originalDoc: undefined,
      req,
      collection: { slug: 'products' },
      context: req.context,
    } as never)
    await auditAfterChange({
      doc: { id: 9, sku: 'Új' },
      previousDoc: undefined,
      req,
      operation: 'create',
      collection: { slug: 'products' },
    } as never)
    expect(findByID).not.toHaveBeenCalled()
    expect(create.mock.calls[0][0].data.action).toBe('create')
  })
})

describe('audit plugin: a kurzus kap beforeChange hookot, a többi collection nem', () => {
  it('a meglévő hookok sorrendje megmarad', () => {
    const existingBefore = vi.fn()
    const collections: CollectionConfig[] = [
      { slug: 'products', fields: [], hooks: { beforeChange: [existingBefore] } },
      { slug: 'pages', fields: [] },
      { slug: 'media', fields: [] },
    ]
    const result = audit({ collections } as unknown as Config) as Config
    const bySlug = new Map((result.collections ?? []).map((c) => [c.slug, c]))
    expect(bySlug.get('products')?.hooks?.beforeChange).toEqual([
      existingBefore,
      auditProductBeforeChange,
    ])
    expect(bySlug.get('products')?.hooks?.afterChange).toEqual([auditAfterChange])
    expect(bySlug.get('pages')?.hooks?.beforeChange).toBeUndefined()
    expect(bySlug.get('pages')?.hooks?.afterChange).toEqual([auditAfterChange])
    expect(bySlug.get('media')).toBe(collections[2])
  })
})
