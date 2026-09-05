import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  find: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  destroy: vi.fn(),
  getPayload: vi.fn(),
  info: vi.fn(),
}))

vi.mock('payload', () => ({ getPayload: runtime.getPayload }))
vi.mock('../payload.config', () => ({ default: {} }))
vi.mock('../lib/logger', () => ({ logger: { info: runtime.info, error: vi.fn() } }))

import { buildHomeLayout } from '../lib/home-seed'
import { buildSzolgaltatasokLayout } from '../scripts/restore-legacy-content'
import type { Menu, Product } from '../payload-types'

import {
  ownerReviewHash,
  applyOwnerReviewV1,
  planPage,
  planOwnerReviewMenus,
  planOwnerReviewPageFields,
  parseOwnerReviewAssets,
  readOwnerReviewArguments,
} from '../scripts/apply-owner-review-v1'

describe('Owner review explicit application boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runtime.find.mockResolvedValue({ docs: [] })
    runtime.destroy.mockResolvedValue(undefined)
    runtime.getPayload.mockResolvedValue(runtime)
  })

  it('accepts the verified old service photo variant but preserves unrelated editor photos', () => {
    const filenames = new Map([
      [1, '67b2668feae66_Kezeleskek.webp'],
      [2, 'kezeles-kezen.webp'],
      [3, 'editor-photo.webp'],
    ])
    const layout = buildSzolgaltatasokLayout({ szolgaltatasokKep: 1 })
    const withImage = (image: number) =>
      layout.map((block) => (block.blockType === 'services' ? { ...block, image } : block))
    const known = planPage(
      { slug: 'szolgaltatasok', layout: withImage(2) },
      { about: 10 },
      filenames,
    )
    expect(known.layout.find((block) => block.blockType === 'services')?.image).toBe(10)
    const custom = planPage(
      { slug: 'szolgaltatasok', layout: withImage(3) },
      { about: 10 },
      filenames,
    )
    expect(custom.layout.find((block) => block.blockType === 'services')?.image).toBe(3)
  })

  it('previews without boot jobs or writes and closes the local API instance', async () => {
    await applyOwnerReviewV1([])
    expect(runtime.getPayload).toHaveBeenCalledWith({
      config: {
        telemetry: false,
        typescript: { autoGenerate: false },
        admin: { importMap: { autoGenerate: false } },
      },
      disableOnInit: true,
      cron: false,
    })
    expect(runtime.find).toHaveBeenCalledTimes(4)
    expect(runtime.create).not.toHaveBeenCalled()
    expect(runtime.update).not.toHaveBeenCalled()
    expect(runtime.destroy).toHaveBeenCalledOnce()
  })

  it('labels only the old menu entry targeting a verified published free product', () => {
    const product = {
      id: 2,
      status: 'published',
      _status: 'published',
      priceInHUFEnabled: false,
    } as Product
    const menu = {
      id: 6,
      label: 'SOS KézRelax',
      type: 'product',
      ref: { relationTo: 'products', value: 2 },
      updatedAt: '2026-09-05',
    } as Menu
    const plans = planOwnerReviewMenus([menu], product)
    expect(plans).toHaveLength(1)
    expect(plans[0].label).toBe('Ingyenes SOS KézRelax')
    expect(planOwnerReviewMenus([{ ...menu, label: plans[0].label }], product)).toEqual([])
    expect(planOwnerReviewMenus([{ ...menu, label: 'Szerkesztett név' }], product)).toEqual([])
    expect(
      planOwnerReviewMenus([{ ...menu, ref: { relationTo: 'products', value: 1 } }], product),
    ).toEqual([])
    expect(planOwnerReviewMenus([menu], { ...product, _status: 'draft' })).toEqual([])
    expect(planOwnerReviewMenus([menu], { ...product, priceInHUFEnabled: true })).toEqual([])
    expect(planOwnerReviewMenus([menu], undefined)).toEqual([])
  })

  it('rejects an unreviewed hash before any media or page write', async () => {
    await expect(applyOwnerReviewV1(['--apply', '0'.repeat(64)])).rejects.toThrow(
      'A terv változott',
    )
    expect(runtime.create).not.toHaveBeenCalled()
    expect(runtime.update).not.toHaveBeenCalled()
    expect(runtime.destroy).toHaveBeenCalledOnce()
  })

  it('closes the local API instance when reading the plan fails', async () => {
    runtime.find.mockRejectedValueOnce(new Error('Read failed'))
    await expect(applyOwnerReviewV1([])).rejects.toThrow('Read failed')
    expect(runtime.create).not.toHaveBeenCalled()
    expect(runtime.update).not.toHaveBeenCalled()
    expect(runtime.destroy).toHaveBeenCalledOnce()
  })

  it('rejects changed content on the second read even with a correct reviewed hash', async () => {
    let pageReads = 0
    const page = {
      id: 1,
      slug: 'kezdolap',
      title: 'Kezdőlap',
      _status: 'published',
      layout: buildHomeLayout({}),
      updatedAt: '2026-09-05T00:00:00.000Z',
    }
    runtime.find.mockImplementation(async ({ collection }: { collection: string }) => {
      if (collection !== 'pages') return { docs: [] }
      pageReads += 1
      return {
        docs: [
          { ...page, updatedAt: pageReads >= 3 ? '2026-09-05T00:01:00.000Z' : page.updatedAt },
        ],
      }
    })
    await applyOwnerReviewV1([])
    const summary = runtime.info.mock.calls.find(
      ([message]) => message === 'KC V1 tartalmi terv',
    )?.[1]
    const hash: unknown = summary?.hash
    if (typeof hash !== 'string') throw new Error('Expected preview hash')
    expect(summary.pages.some((plan: { changes: number }) => plan.changes > 0)).toBe(true)
    await expect(applyOwnerReviewV1(['--apply', hash])).rejects.toThrow(
      'A tartalom az ellenőrzés közben változott',
    )
    expect(runtime.create).not.toHaveBeenCalled()
    expect(runtime.update).not.toHaveBeenCalled()
    expect(runtime.destroy).toHaveBeenCalledTimes(2)
  })

  it('only removes the recognized old about hero after the replacement photo is in the layout', () => {
    const page = { slug: 'rolunk', title: 'Rólunk', heroImage: 1 }
    const names = new Map([
      [1, 'katak-team.webp'],
      [2, 'editor-photo.webp'],
    ])
    expect(planOwnerReviewPageFields(page, [], 3, names).data).toEqual({})
    const layout = [{ blockType: 'about' as const, photo: 3 }]
    expect(planOwnerReviewPageFields(page, layout, 3, names).data).toEqual({ heroImage: null })
    expect(
      planOwnerReviewPageFields(
        page,
        [{ ...layout[0], sectionSettings: { visible: false } }],
        3,
        names,
      ).data,
    ).toEqual({})
    expect(planOwnerReviewPageFields({ ...page, heroImage: 2 }, layout, 3, names).data).toEqual({})
    expect(
      planOwnerReviewPageFields({ ...page, heroImage: null }, layout, 3, names).changes,
    ).toHaveLength(0)
  })
  it('defaults to preview and requires an exact reviewed plan hash to apply', () => {
    expect(readOwnerReviewArguments([])).toEqual({ apply: false })
    const hash = ownerReviewHash({ version: 1 })
    expect(readOwnerReviewArguments(['--apply', hash])).toEqual({ apply: true, hash })
    for (const args of [
      ['--apply'],
      ['--apply', 'yes'],
      ['--force'],
      ['--apply', hash, '--force'],
    ]) {
      expect(() => readOwnerReviewArguments(args)).toThrow()
    }
  })

  it('binds a plan to the source content and new content', () => {
    expect(ownerReviewHash({ before: 'A', after: 'B' })).not.toBe(
      ownerReviewHash({ before: 'A2', after: 'B' }),
    )
    expect(ownerReviewHash({ before: 'A', after: 'B' })).not.toBe(
      ownerReviewHash({ before: 'A', after: 'B2' }),
    )
  })

  it('requires every used photo role exactly once, a safe file basename and an alt', () => {
    const roles = ['founders', 'sos', 'expectations', 'services', 'about', 'difference', 'benefits']
    const assets = roles.map((role) => ({
      role,
      file: `${role}.webp`,
      alt: 'Saját fotó',
      sha256: 'a'.repeat(64),
    }))
    expect(parseOwnerReviewAssets({ assets })).toHaveLength(7)
    expect(() => parseOwnerReviewAssets({ assets: assets.slice(1) })).toThrow()
    expect(() => parseOwnerReviewAssets({ assets: [...assets, assets[0]] })).toThrow()
    for (const file of ['../photo.webp', '/photo.webp', 'https://example.test/a.webp', '.env']) {
      expect(() =>
        parseOwnerReviewAssets({ assets: [{ ...assets[0], file }, ...assets.slice(1)] }),
      ).toThrow()
    }
    expect(() =>
      parseOwnerReviewAssets({ assets: [{ ...assets[0], alt: ' ' }, ...assets.slice(1)] }),
    ).toThrow()
  })
})
