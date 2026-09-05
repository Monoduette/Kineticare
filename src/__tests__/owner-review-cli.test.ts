import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import sharp from 'sharp'

const runtime = vi.hoisted(() => ({
  find: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  destroy: vi.fn(),
  getPayload: vi.fn(),
  info: vi.fn(),
  findByID: vi.fn(),
  readdir: vi.fn(),
  config: {} as { sharp?: typeof sharp },
  collections: {
    media: {
      config: {
        upload: {
          staticDir: '/tmp/kineticare-cli-unit-media',
          disableLocalStorage: false,
          formatOptions: { format: 'webp', options: { quality: 80 } },
        },
      },
    },
  },
}))

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  readdir: runtime.readdir,
}))
vi.mock('payload', () => ({ getPayload: runtime.getPayload }))
vi.mock('../payload.config', () => ({ default: {} }))
vi.mock('../lib/logger', () => ({ logger: { info: runtime.info, error: vi.fn() } }))

import { buildHomeLayout } from '../lib/home-seed'
import * as ownerReviewPlanner from '../lib/owner-review-v1'
import * as mediaProvenance from '../lib/media-recovery-provenance'
import { ctaLabel } from '../lib/cta-vocabulary'
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

// Each CLI invocation verifies seven real raster assets; retry cases invoke it repeatedly.
describe('Owner review explicit application boundary', { timeout: 20_000 }, () => {
  const fixtureDirectories: string[] = []
  afterEach(async () => {
    vi.restoreAllMocks()
    for (const directory of fixtureDirectories.splice(0)) {
      await rm(directory, { recursive: true, force: true })
    }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    runtime.find.mockResolvedValue({ docs: [] })
    runtime.readdir.mockReset().mockResolvedValue([])
    runtime.create.mockReset()
    runtime.update.mockReset()
    runtime.findByID.mockReset()
    runtime.collections.media.config.upload.disableLocalStorage = false
    runtime.collections.media.config.upload.staticDir = '/tmp/kineticare-cli-unit-media'
    runtime.destroy.mockResolvedValue(undefined)
    runtime.getPayload.mockResolvedValue(runtime)
    runtime.config.sharp = sharp
    vi.spyOn(mediaProvenance, 'enrollMediaRecovery').mockResolvedValue(undefined)
    vi.spyOn(mediaProvenance, 'inspectMediaRecoveryReceipt').mockResolvedValue({
      receipt: null,
      valid: true,
    })
    vi.spyOn(mediaProvenance, 'planMediaRecoveryEnrollment').mockResolvedValue({
      action: 'media.recovery.provenance.v1',
      mediaSnapshot: 'fixture',
      processingConfig: 'fixture',
      sourcePublicDigest: 'a'.repeat(64),
      storedPublicDigest: 'b'.repeat(64),
      previousReceipt: null,
    })
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
      if (collection === 'products') {
        return {
          docs: [
            {
              id: 2,
              slug: 'sos-kezrelax-villamkurzus',
              status: 'published',
              _status: 'published',
              priceInHUFEnabled: false,
              updatedAt: '2026-09-05T00:00:00.000Z',
            },
          ],
        }
      }
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

  it.each(['missing', 'draft', 'paid'])(
    'holds new free-offer FAQ publication for a %s SOS product',
    async (state) => {
      const page = {
        id: 1,
        slug: 'kezdolap',
        _status: 'published',
        layout: buildHomeLayout({}),
        updatedAt: '2026-09-05',
      }
      const product = {
        id: 2,
        slug: 'sos-kezrelax-villamkurzus',
        status: 'published',
        _status: state === 'draft' ? 'draft' : 'published',
        priceInHUFEnabled: state === 'paid',
        priceInHUF: 1000,
      }
      runtime.find.mockImplementation(async ({ collection }: { collection: string }) => ({
        docs:
          collection === 'pages'
            ? [page]
            : collection === 'products' && state !== 'missing'
              ? [product]
              : [],
      }))
      await applyOwnerReviewV1([])
      const summary = runtime.info.mock.calls.find(
        ([message]) => message === 'KC V1 tartalmi terv',
      )?.[1]
      expect(summary.blockers).toHaveLength(1)
      await expect(applyOwnerReviewV1(['--apply', summary.hash])).rejects.toThrow(
        'Publikálási HOLD',
      )
      expect(runtime.create).not.toHaveBeenCalled()
      expect(runtime.update).not.toHaveBeenCalled()
      expect(runtime.destroy).toHaveBeenCalledTimes(2)
    },
  )

  it('binds free-product availability to the plan even when there is no menu to rename', async () => {
    let productReads = 0
    const page = {
      id: 1,
      slug: 'kezdolap',
      _status: 'published',
      layout: buildHomeLayout({}),
      updatedAt: '2026-09-05',
    }
    runtime.find.mockImplementation(async ({ collection }: { collection: string }) => {
      if (collection === 'pages') return { docs: [page] }
      if (collection === 'products') {
        productReads += 1
        return {
          docs: [
            {
              id: 2,
              slug: 'sos-kezrelax-villamkurzus',
              status: 'published',
              _status: 'published',
              priceInHUFEnabled: productReads >= 3,
              priceInHUF: 1000,
            },
          ],
        }
      }
      return { docs: [] }
    })
    await applyOwnerReviewV1([])
    const summary = runtime.info.mock.calls.find(
      ([message]) => message === 'KC V1 tartalmi terv',
    )?.[1]
    expect(summary.blockers).toEqual([])
    await expect(applyOwnerReviewV1(['--apply', summary.hash])).rejects.toThrow(
      'A tartalom az ellenőrzés közben változott',
    )
    expect(runtime.create).not.toHaveBeenCalled()
    expect(runtime.update).not.toHaveBeenCalled()
  })

  describe('P03 free-offer publication prerequisite', () => {
    const freeProduct = {
      id: 2,
      slug: 'sos-kezrelax-villamkurzus',
      status: 'published',
      _status: 'published',
      priceInHUFEnabled: false,
      updatedAt: '2026-09-05',
    }

    function setupPlan(products: () => unknown[], requestId: string | null = 'P03') {
      const layout = buildHomeLayout({}).filter((block) => block.blockType === 'filmHero')
      if (requestId === 'P03') {
        for (const hero of layout) {
          for (const cta of hero.ctas ?? []) {
            if (cta.url === '#ingyenes') cta.felirat = 'Nézd meg az SOS-kurzust'
          }
        }
      }
      const page = {
        id: 1,
        slug: 'kezdolap',
        _status: 'published',
        layout,
        updatedAt: '2026-09-05',
      }
      // P03 and no-op cases use the real planner; only the unrelated control is synthetic.
      if (requestId && requestId !== 'P03') {
        vi.spyOn(ownerReviewPlanner, 'planOwnerReviewV1').mockReturnValue({
          layout,
          changes: [
            {
              requestId,
              blockId: null,
              path: '/layout/0/ctas/1/felirat',
              reason: 'Jóváhagyott régi CTA-felirat frissítése.',
              before: 'Nézd meg az SOS-kurzust',
              after: ctaLabel('free-strip-jump'),
            },
          ],
          skips: [],
        })
      }
      runtime.find.mockImplementation(async ({ collection }: { collection: string }) => ({
        docs: collection === 'pages' ? [page] : collection === 'products' ? products() : [],
      }))
      return page
    }

    async function preview() {
      await applyOwnerReviewV1([])
      const summary = runtime.info.mock.calls.find(
        ([message]) => message === 'KC V1 tartalmi terv',
      )?.[1]
      expect(summary?.pages[0].changes).toBe(1)
      return summary
    }

    async function managedPhoto(withVariant: boolean) {
      const directory = await mkdtemp(path.join(tmpdir(), 'kineticare-cli-managed-photo-'))
      fixtureDirectories.push(directory)
      runtime.collections.media.config.upload.staticDir = directory
      const filename = 'founders-intro-white-1600.webp'
      const variant = 'founders-intro-white-1600-320x213.webp'
      const source = await readFile(path.resolve('public/media/team', filename))
      await writeFile(
        path.join(directory, filename),
        await sharp(source, { animated: true }).rotate().webp({ quality: 80 }).toBuffer(),
      )
      if (withVariant) await writeFile(path.join(directory, variant), 'existing variant fixture')
      const find = runtime.find.getMockImplementation()!
      runtime.find.mockImplementation(async (args: { collection: string }) =>
        args.collection === 'media'
          ? {
              docs: [
                {
                  id: 30,
                  filename,
                  updatedAt: '2026-09-05',
                  sizes: { small: { filename: variant } },
                },
              ],
            }
          : find(args),
      )
      return { directory, variant }
    }

    it('reports a missing managed responsive image without uploading or writing pages', async () => {
      setupPlan(() => [freeProduct])
      const { variant } = await managedPhoto(false)
      const summary = await preview()
      expect(summary.blockers.join(' ')).toContain(variant)
      await expect(applyOwnerReviewV1(['--apply', summary.hash])).rejects.toThrow(
        'Publikálási HOLD',
      )
      expect(runtime.create).not.toHaveBeenCalled()
      expect(runtime.update).not.toHaveBeenCalled()
    })

    it('rejects a reviewed plan if a managed responsive image disappears before apply', async () => {
      setupPlan(() => [freeProduct])
      const { directory, variant } = await managedPhoto(true)
      const summary = await preview()
      expect(summary.blockers).toEqual([])
      await rm(path.join(directory, variant))
      await expect(applyOwnerReviewV1(['--apply', summary.hash])).rejects.toThrow(
        'A terv változott',
      )
      expect(runtime.create).not.toHaveBeenCalled()
      expect(runtime.update).not.toHaveBeenCalled()
    })

    it('keeps a complete managed photo unblocked during read-only preview', async () => {
      setupPlan(() => [freeProduct])
      await managedPhoto(true)
      expect((await preview()).blockers).toEqual([])
      expect(runtime.create).not.toHaveBeenCalled()
      expect(runtime.update).not.toHaveBeenCalled()
    })

    it('accepts enrolled raw committed bytes at the publication gate', async () => {
      const page = setupPlan(() => [freeProduct])
      const { directory } = await managedPhoto(true)
      const filename = 'founders-intro-white-1600.webp'
      await writeFile(
        path.join(directory, filename),
        await readFile(path.resolve('public/media/team', filename)),
      )
      vi.mocked(mediaProvenance.inspectMediaRecoveryReceipt).mockResolvedValue({
        receipt: null,
        valid: false,
      })
      const blocked = await preview()
      await expect(applyOwnerReviewV1(['--apply', blocked.hash])).rejects.toThrow(
        'Publikálási HOLD',
      )
      expect(runtime.create).not.toHaveBeenCalled()
      expect(runtime.update).not.toHaveBeenCalled()
      vi.mocked(mediaProvenance.inspectMediaRecoveryReceipt).mockResolvedValue({
        receipt: null,
        valid: true,
      })
      runtime.info.mockClear()
      const approved = await preview()
      expect(approved.blockers).toEqual([])
      expect(approved.hash).not.toBe(blocked.hash)
      let id = 40
      runtime.create.mockImplementation(async ({ filePath }: { filePath: string }) => ({
        id: id++,
        filename: path.basename(filePath),
      }))
      runtime.findByID.mockResolvedValue(page)
      await expect(applyOwnerReviewV1(['--apply', approved.hash])).resolves.toBeUndefined()
      expect(runtime.create).toHaveBeenCalledTimes(6)
      expect(runtime.update).toHaveBeenCalledOnce()
    })

    it.each([
      ['missing', []],
      ['draft', [{ ...freeProduct, _status: 'draft' }]],
      ['unpublished', [{ ...freeProduct, status: 'draft' }]],
      ['paid', [{ ...freeProduct, priceInHUFEnabled: true, priceInHUF: 1000 }]],
      ['unrelated', [{ ...freeProduct, slug: 'masik-ingyenes-kurzus' }]],
      ['duplicated', [freeProduct, { ...freeProduct, id: 3 }]],
      ['unconfigured', [{ ...freeProduct, priceInHUFEnabled: undefined }]],
    ])('blocks a changed P03 claim for %s SOS before uploads or writes', async (_, products) => {
      setupPlan(() => products as unknown[])
      const summary = await preview()
      expect(
        runtime.info.mock.calls
          .filter(([message]) => message === 'KC V1 tételes változtatás')
          .map(([, change]) => change.requestId),
      ).toEqual(['P03'])
      expect(summary.blockers).toHaveLength(1)
      expect(summary.blockers[0]).toContain('P03')
      await expect(applyOwnerReviewV1(['--apply', summary.hash])).rejects.toThrow(
        'Publikálási HOLD',
      )
      expect(runtime.create).not.toHaveBeenCalled()
      expect(runtime.update).not.toHaveBeenCalled()
      expect(runtime.destroy).toHaveBeenCalledTimes(2)
    })

    it('allows a changed P03 plan only with the verified canonical published free product', async () => {
      setupPlan(() => [freeProduct])
      expect((await preview()).blockers).toEqual([])
      expect(runtime.create).not.toHaveBeenCalled()
      expect(runtime.update).not.toHaveBeenCalled()
    })

    it('leaves a no-op unblocked without a free product', async () => {
      setupPlan(() => [], null)
      await applyOwnerReviewV1([])
      const summary = runtime.info.mock.calls.find(
        ([message]) => message === 'KC V1 tartalmi terv',
      )?.[1]
      expect(summary.pages[0].changes).toBe(0)
      expect(summary.blockers).toEqual([])
      await expect(applyOwnerReviewV1(['--apply', summary.hash])).resolves.toBeUndefined()
      expect(runtime.create).not.toHaveBeenCalled()
      expect(runtime.update).not.toHaveBeenCalled()
    })

    it('holds a no-op apply when a managed responsive image is missing', async () => {
      setupPlan(() => [], null)
      const { variant } = await managedPhoto(false)
      await applyOwnerReviewV1([])
      const summary = runtime.info.mock.calls.find(
        ([message]) => message === 'KC V1 tartalmi terv',
      )?.[1]
      expect(summary.pages[0].changes).toBe(0)
      expect(summary.blockers.join(' ')).toContain(variant)
      await expect(applyOwnerReviewV1(['--apply', summary.hash])).rejects.toThrow(
        'Publikálási HOLD',
      )
      expect(runtime.create).not.toHaveBeenCalled()
      expect(runtime.update).not.toHaveBeenCalled()
    })

    it('does not block an unrelated change without a free product', async () => {
      setupPlan(() => [], 'H01')
      expect((await preview()).blockers).toEqual([])
    })

    it('rechecks product proof before a changed P03 plan can upload or write', async () => {
      let reads = 0
      setupPlan(() => [{ ...freeProduct, _status: ++reads >= 3 ? 'draft' : 'published' }])
      const summary = await preview()
      expect(summary.blockers).toEqual([])
      await expect(applyOwnerReviewV1(['--apply', summary.hash])).rejects.toThrow(
        'A tartalom az ellenőrzés közben változott',
      )
      expect(reads).toBe(3)
      expect(runtime.create).not.toHaveBeenCalled()
      expect(runtime.update).not.toHaveBeenCalled()
    })

    it.each(['founders-intro-white-1600.webp', 'founders-intro-white-1600-320x213.webp'])(
      'blocks an orphan main/variant file before any upload: %s',
      async (filename) => {
        setupPlan(() => [freeProduct])
        runtime.readdir.mockResolvedValue([filename])
        const summary = await preview()
        expect(summary.blockers.join(' ')).toContain('fájlnévütközés')
        await expect(applyOwnerReviewV1(['--apply', summary.hash])).rejects.toThrow(
          'Publikálási HOLD',
        )
        expect(runtime.create).not.toHaveBeenCalled()
        expect(runtime.update).not.toHaveBeenCalled()
      },
    )

    it('rechecks filesystem collisions with the reviewed hash before first upload', async () => {
      setupPlan(() => [freeProduct])
      runtime.readdir
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValue(['founders-intro-white-1600.webp'])
      const summary = await preview()
      await expect(applyOwnerReviewV1(['--apply', summary.hash])).rejects.toThrow(
        'A tartalom az ellenőrzés közben változott',
      )
      expect(runtime.create).not.toHaveBeenCalled()
      expect(runtime.update).not.toHaveBeenCalled()
    })

    it.each(['main', 'variant'])(
      'blocks a database-owned %s filename even when its file is missing',
      async (kind) => {
        setupPlan(() => [freeProduct])
        const filename = 'founders-intro-white-1600-320x213.webp'
        const find = runtime.find.getMockImplementation()!
        runtime.find.mockImplementation(async (args: { collection: string }) =>
          args.collection === 'media'
            ? {
                docs: [
                  {
                    id: 40,
                    filename: kind === 'main' ? filename : 'editor-photo.webp',
                    sizes: kind === 'variant' ? { small: { filename } } : {},
                  },
                ],
              }
            : find(args),
        )
        const summary = await preview()
        expect(summary.blockers.join(' ')).toContain('fájlnévütközés')
        await expect(applyOwnerReviewV1(['--apply', summary.hash])).rejects.toThrow(
          'Publikálási HOLD',
        )
        expect(runtime.create).not.toHaveBeenCalled()
        expect(runtime.update).not.toHaveBeenCalled()
      },
    )

    it('stops before page writes if Payload unexpectedly renames an uploaded file', async () => {
      setupPlan(() => [freeProduct])
      const summary = await preview()
      runtime.create.mockResolvedValue({ id: 9, filename: 'founders-intro-white-1601.webp' })
      await expect(applyOwnerReviewV1(['--apply', summary.hash])).rejects.toThrow(
        'eltérő fájlnevet',
      )
      expect(runtime.create).toHaveBeenCalledOnce()
      expect(runtime.update).not.toHaveBeenCalled()
      expect(runtime.findByID).not.toHaveBeenCalled()
    })

    it('keeps an unrelated existing file and permits exact-name uploads', async () => {
      const page = setupPlan(() => [freeProduct])
      runtime.readdir.mockResolvedValue([
        'editor-photo.webp',
        'founders-intro-white-1600-other.webp',
      ])
      const summary = await preview()
      expect(summary.blockers).toEqual([])
      let id = 10
      runtime.create.mockImplementation(async ({ filePath }: { filePath: string }) => ({
        id: id++,
        filename: path.basename(filePath),
      }))
      runtime.findByID.mockResolvedValue(page)
      await expect(applyOwnerReviewV1(['--apply', summary.hash])).resolves.toBeUndefined()
      expect(runtime.create).toHaveBeenCalledTimes(7)
      expect(runtime.update).toHaveBeenCalledOnce()
    })

    it('stops before publication if the created media receipt fails', async () => {
      const page = setupPlan(() => [freeProduct])
      const summary = await preview()
      runtime.create.mockImplementation(async ({ filePath }: { filePath: string }) => ({
        id: 10,
        filename: path.basename(filePath),
      }))
      vi.mocked(mediaProvenance.enrollMediaRecovery).mockRejectedValue(
        new Error('Receipt unavailable'),
      )
      await expect(applyOwnerReviewV1(['--apply', summary.hash])).rejects.toThrow(
        'Receipt unavailable',
      )
      expect(runtime.create).toHaveBeenCalledOnce()
      expect(runtime.update).not.toHaveBeenCalled()
      expect(runtime.findByID).not.toHaveBeenCalled()

      // The first upload survived the failed receipt. A new plan must still HOLD.
      await managedPhoto(true)
      vi.mocked(mediaProvenance.inspectMediaRecoveryReceipt).mockResolvedValue({
        receipt: null,
        valid: false,
      })
      runtime.info.mockClear()
      const retry = await preview()
      expect(retry.blockers.join(' ')).toContain('eredetigazolás')
      runtime.create.mockClear()
      await expect(applyOwnerReviewV1(['--apply', retry.hash])).rejects.toThrow('Publikálási HOLD')
      expect(runtime.create).not.toHaveBeenCalled()
      expect(runtime.update).not.toHaveBeenCalled()

      // After separate, explicit enrollment, a newly reviewed plan can publish.
      vi.mocked(mediaProvenance.inspectMediaRecoveryReceipt).mockResolvedValue({
        receipt: null,
        valid: true,
      })
      vi.mocked(mediaProvenance.enrollMediaRecovery).mockResolvedValue(undefined)
      runtime.findByID.mockResolvedValue(page)
      runtime.info.mockClear()
      const enrolled = await preview()
      expect(enrolled.hash).not.toBe(retry.hash)
      await expect(applyOwnerReviewV1(['--apply', enrolled.hash])).resolves.toBeUndefined()
      expect(runtime.update).toHaveBeenCalledOnce()
    })

    it('keeps a no-op with missing provenance on HOLD without implicit enrollment', async () => {
      setupPlan(() => [], null)
      await managedPhoto(true)
      vi.mocked(mediaProvenance.inspectMediaRecoveryReceipt).mockResolvedValue({
        receipt: null,
        valid: false,
      })
      await applyOwnerReviewV1([])
      const summary = runtime.info.mock.calls.find(
        ([message]) => message === 'KC V1 tartalmi terv',
      )?.[1]
      expect(summary.pages[0].changes).toBe(0)
      await expect(applyOwnerReviewV1(['--apply', summary.hash])).rejects.toThrow(
        'Publikálási HOLD',
      )
      expect(mediaProvenance.enrollMediaRecovery).not.toHaveBeenCalled()
      expect(runtime.update).not.toHaveBeenCalled()
    })

    it('does not inspect the upload directory for a no-op plan', async () => {
      setupPlan(() => [], null)
      runtime.readdir.mockRejectedValue(new Error('No directory read expected'))
      await applyOwnerReviewV1([])
      expect(runtime.readdir).not.toHaveBeenCalled()
      expect(runtime.create).not.toHaveBeenCalled()
    })
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

  it('explicitly enrolls only the requested media and closes the client', async () => {
    const doc = { id: 51, filename: 'founders-intro-white-1600.webp' }
    runtime.findByID.mockResolvedValue(doc)
    await applyOwnerReviewV1(['--enroll-media-recovery', '51'])
    expect(mediaProvenance.enrollMediaRecovery).not.toHaveBeenCalled()
    const summary = runtime.info.mock.calls.find(
      ([message]) => message === 'Média-helyreállítási igazolás terve',
    )?.[1]
    await applyOwnerReviewV1(['--enroll-media-recovery', '51', '--apply', summary.hash])
    expect(mediaProvenance.enrollMediaRecovery).toHaveBeenCalledWith(runtime, doc)
    expect(runtime.find).not.toHaveBeenCalled()
    expect(runtime.update).not.toHaveBeenCalled()
    expect(runtime.destroy).toHaveBeenCalledTimes(2)
  })

  it('propagates failed enrollment without page writes', async () => {
    runtime.findByID.mockResolvedValue({ id: 51 })
    vi.mocked(mediaProvenance.enrollMediaRecovery).mockRejectedValue(
      new Error('Receipt unavailable'),
    )
    await applyOwnerReviewV1(['--enroll-media-recovery', '51'])
    const summary = runtime.info.mock.calls.find(
      ([message]) => message === 'Média-helyreállítási igazolás terve',
    )?.[1]
    await expect(
      applyOwnerReviewV1(['--enroll-media-recovery', '51', '--apply', summary.hash]),
    ).rejects.toThrow('Receipt unavailable')
    expect(runtime.update).not.toHaveBeenCalled()
    expect(runtime.destroy).toHaveBeenCalledTimes(2)
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
    expect(() =>
      parseOwnerReviewAssets({
        assets: [assets[0], { ...assets[1], file: assets[0].file }, ...assets.slice(2)],
      }),
    ).toThrow(/ismétlődő fotófájlnév/i)
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
