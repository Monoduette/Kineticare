import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import type { Payload, PayloadRequest } from 'payload'
import { generateFileData } from '../../node_modules/payload/dist/uploads/generateFileData.js'
import type { Media } from '../payload-types'
import manifest from '../../public/media/team/manifest.json'
import pressManifest from '../../public/media/press/manifest.json'
import { Media as MediaCollection } from '../collections/Media'
import { stripSensitiveFields } from '../lib/audit'
import { ensureMediaFiles } from '../lib/media-restore'
import {
  enrollMediaRecovery,
  requireMediaRecoveryReceipt,
  mediaRecoverySnapshot,
  mediaRecoveryProcessingConfig,
  planMediaRecoveryEnrollment,
  managedMediaAssets,
} from '../lib/media-recovery-provenance'

const folders: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function fixture(asset = manifest.assets[0], directory = 'team') {
  const dir = mkdtempSync(path.join(tmpdir(), 'kc-provenance-'))
  folders.push(dir)
  const bytes = readFileSync(path.resolve('public/media', directory, asset.file))
  writeFileSync(path.join(dir, asset.file), bytes)
  let doc = {
    id: 51,
    filename: asset.file,
    alt: 'Owner description',
    focalX: 20,
    focalY: 70,
    createdAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z',
  } as Media
  const receipts: Record<string, unknown>[] = []
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const receipt = { id: receipts.length + 1, ...(stripSensitiveFields(data) as object) }
    receipts.push(receipt)
    return receipt
  })
  const update = vi.fn(async () => {
    writeFileSync(
      path.join(dir, asset.file),
      await sharp(bytes).rotate().webp({ quality: 80 }).toBuffer(),
    )
    doc = { ...doc, updatedAt: '2026-09-05T00:01:00.000Z' }
    return doc
  })
  const find = vi.fn(async ({ collection }: { collection: string }) => ({
    docs: collection === 'media' ? [doc] : receipts.slice(-1),
  }))
  const payload = {
    config: { sharp },
    collections: {
      media: {
        config: {
          ...MediaCollection,
          upload: { ...(MediaCollection.upload as object), staticDir: dir },
        },
      },
    },
    find,
    findByID: vi.fn(async () => doc),
    create,
    update,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as Payload
  return {
    payload,
    asset,
    dir,
    receipts,
    create,
    update,
    find,
    get doc() {
      return doc
    },
    edit: (change: Partial<Media>) => {
      doc = { ...doc, ...change }
    },
    lose: () => rmSync(path.join(dir, asset.file)),
  }
}

describe('durable team media recovery provenance', () => {
  it.each(['width', 'height', 'fit', 'position', 'withoutEnlargement', 'name', 'added', 'removed'])(
    'binds image size %s before receipt or media writes',
    async (field) => {
      const f = fixture()
      await enrollMediaRecovery(f.payload, f.doc)
      const before = await planMediaRecoveryEnrollment(f.payload, f.doc)
      const sizes = structuredClone(f.payload.collections.media.config.upload.imageSizes!)
      if (field === 'added') sizes.push({ name: 'extra', width: 12 })
      else if (field === 'removed') sizes.pop()
      else
        Object.assign(sizes[0]!, {
          [field]: {
            width: 319,
            height: 99,
            fit: 'contain',
            position: 'north',
            withoutEnlargement: false,
            name: 'renamed',
          }[field],
        })
      f.payload.collections.media.config.upload.imageSizes = sizes
      expect((await planMediaRecoveryEnrollment(f.payload, f.doc)).processingConfig).not.toBe(
        before.processingConfig,
      )
      f.lose()
      f.create.mockClear()
      expect((await ensureMediaFiles(f.payload)).sikertelen).toBe(1)
      expect(f.create).not.toHaveBeenCalled()
      expect(f.update).not.toHaveBeenCalled()
    },
  )

  it('holds old receipts without a configuration binding until explicit enrollment', async () => {
    const f = fixture()
    await enrollMediaRecovery(f.payload, f.doc)
    delete (f.receipts[0]!.after as Record<string, unknown>).processingConfig
    f.lose()
    f.create.mockClear()
    expect((await ensureMediaFiles(f.payload)).sikertelen).toBe(1)
    expect(f.create).not.toHaveBeenCalled()
    expect(f.update).not.toHaveBeenCalled()
  })

  it('normalizes object order and absent configuration members but refuses functions', () => {
    const f = fixture()
    const before = mediaRecoveryProcessingConfig(f.payload)
    f.payload.collections.media.config.upload.imageSizes =
      f.payload.collections.media.config.upload.imageSizes!.map((size) => ({
        ...Object.fromEntries(Object.entries(size).reverse()),
        name: size.name,
        unused: undefined,
      }))
    expect(mediaRecoveryProcessingConfig(f.payload)).toBe(before)
    Object.assign(f.payload.collections.media.config.upload.imageSizes![0]!, {
      generateImageName: () => 'foreign.webp',
    })
    expect(() => mediaRecoveryProcessingConfig(f.payload)).toThrow()
  })

  it('rejects cross-manifest canonical filename collisions', () => {
    const original = pressManifest.assets[0]!.file
    try {
      pressManifest.assets[0]!.file = manifest.assets[0]!.file.replace('.webp', '.png')
      expect(() => managedMediaAssets()).toThrow()
    } finally {
      pressManifest.assets[0]!.file = original
    }
  })

  it.each(['main', 'variant', 'orphan'])(
    'holds a foreign %s destination before pending and update',
    async (kind) => {
      const f = fixture()
      await enrollMediaRecovery(f.payload, f.doc)
      f.lose()
      const name = f.asset.file.replace('.webp', '-320x213.webp')
      if (kind === 'orphan') writeFileSync(path.join(f.dir, name), 'unowned')
      else {
        const other = {
          ...f.doc,
          id: 52,
          filename: kind === 'main' ? name : 'unrelated.webp',
          sizes: kind === 'variant' ? { xs: { filename: name } } : {},
        }
        f.find.mockImplementation(async ({ collection }) => ({
          docs: collection === 'media' ? [f.doc, other] : f.receipts.slice(-1),
        }))
      }
      f.create.mockClear()
      await ensureMediaFiles(f.payload)
      expect(f.create).not.toHaveBeenCalled()
      expect(f.update).not.toHaveBeenCalled()
      if (kind === 'orphan') expect(readFileSync(path.join(f.dir, name), 'utf8')).toBe('unowned')
    },
  )
  it.each(['raw', 'normalized'])(
    'holds %s receipt before any write after config drift',
    async (kind) => {
      for (const drift of [
        { disableLocalStorage: true },
        { staticDir: '' },
        { formatOptions: { format: 'webp', options: { quality: 90 } } },
        { resizeOptions: { width: 100 } },
        { trimOptions: 1 },
        { constructorOptions: { limitInputPixels: 100 } },
        { withMetadata: true },
        { imageSizes: [] },
        { imageSizes: [{ name: 'xs', width: 319, fit: 'contain' }] },
        { imageSizes: [{ name: 'xs', width: 320, generateImageName: () => 'other.webp' }] },
      ]) {
        const f = fixture()
        if (kind === 'normalized') {
          writeFileSync(
            path.join(f.dir, f.asset.file),
            await sharp(readFileSync(path.resolve('public/media/team', f.asset.file)))
              .rotate()
              .webp({ quality: 80 })
              .toBuffer(),
          )
        }
        await enrollMediaRecovery(f.payload, f.doc)
        f.lose()
        Object.assign(f.payload.collections.media.config.upload, drift)
        f.create.mockClear()
        expect((await ensureMediaFiles(f.payload)).sikertelen, JSON.stringify(drift)).toBe(1)
        expect(f.create, JSON.stringify(drift)).not.toHaveBeenCalled()
        expect(f.update, JSON.stringify(drift)).not.toHaveBeenCalled()
      }
    },
  )

  it('does not query receipts for healthy records', async () => {
    const f = fixture()
    expect((await ensureMediaFiles(f.payload)).rendben).toBe(1)
    expect(f.find).toHaveBeenCalledOnce()
    expect(f.create).not.toHaveBeenCalled()
  })

  it('holds team recovery on missing audit storage while continuing legacy recovery', async () => {
    const f = fixture()
    f.lose()
    const legacy = { ...f.doc, id: 52, filename: 'sos-hands-board.webp' }
    f.find.mockImplementation(async ({ collection }) => {
      if (collection === 'audit-logs') throw new Error('audit table unavailable')
      return { docs: [f.doc, legacy] }
    })
    vi.mocked(f.payload.findByID).mockResolvedValue(legacy)
    f.update.mockResolvedValue(legacy)
    const summary = await ensureMediaFiles(f.payload)
    expect(summary.sikertelen).toBe(1)
    expect(summary.visszatoltott).toBe(1)
    expect(f.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 52 }))
  })

  it.each([
    'sourcePublicDigest',
    'storedPublicDigest',
    'mediaSnapshot',
    'mediaId',
    'filename',
  ] as const)('rejects conflicting latest proof field %s', async (field) => {
    const f = fixture()
    await enrollMediaRecovery(f.payload, f.doc)
    const prior = f.receipts[0]!
    f.receipts.push({
      ...prior,
      id: 2,
      after: { ...(prior.after as object), [field]: field === 'mediaId' ? 999 : '0'.repeat(64) },
    })
    f.lose()
    expect((await ensureMediaFiles(f.payload)).sikertelen).toBe(1)
    expect(f.update).not.toHaveBeenCalled()
  })

  it('preserves public digest proof through real audit serialization', async () => {
    const f = fixture()
    await enrollMediaRecovery(f.payload, f.doc)
    expect(f.receipts[0]?.after).toMatchObject({
      sourcePublicDigest: f.asset.sha256,
      storedPublicDigest: f.asset.sha256,
    })
    expect(f.find).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'audit-logs', sort: '-id', limit: 1 }),
    )
  })

  it.each([
    ...[undefined, { x: 0, y: 0 }, { x: 85, y: 90 }].map((focus) => ({
      focus,
      asset: manifest.assets[0],
      directory: 'team',
    })),
    ...pressManifest.assets.map((asset) => ({
      focus: { x: 0, y: 0 },
      asset: { ...manifest.assets[0], ...asset },
      directory: 'press',
    })),
  ])(
    'uses pinned Payload create and full-loss recovery with focus %j',
    async ({ focus, asset, directory }) => {
      const f = fixture(asset, directory)
      f.lose()
      const bytes = readFileSync(path.resolve('public/media', directory, f.asset.file))
      const generate = (
        operation: 'create' | 'update',
        query: PayloadRequest['query'],
        data: Partial<Media>,
      ) =>
        generateFileData({
          collection: f.payload.collections.media,
          config: f.payload.config,
          data,
          originalDoc: operation === 'update' ? f.doc : undefined,
          operation,
          overwriteExistingFiles: true,
          req: {
            payload: f.payload,
            query,
            file: {
              data: bytes,
              name: f.asset.file,
              mimetype: f.asset.file.endsWith('.png') ? 'image/png' : 'image/webp',
              size: bytes.length,
            },
          } as PayloadRequest,
        })
      const created = await generate(
        'create',
        focus ? { uploadEdits: { focalPoint: focus } } : {},
        { alt: f.doc.alt },
      )
      for (const file of created.files) writeFileSync(file.path, file.buffer)
      f.edit(created.data)
      expect(f.doc.focalX).toBe(focus?.x ?? 50)
      expect(f.doc.focalY).toBe(focus?.y ?? 50)
      await enrollMediaRecovery(f.payload, f.doc)
      for (const file of readdirSync(f.dir)) rmSync(path.join(f.dir, file))
      f.update.mockImplementation(async (args?: unknown) => {
        const options = args as { data: Partial<Media>; req?: { query: PayloadRequest['query'] } }
        const result = await generate('update', options.req?.query ?? {}, options.data)
        for (const file of result.files) writeFileSync(file.path, file.buffer)
        f.edit({ ...result.data, updatedAt: '2026-09-05T00:02:00.000Z' })
        return f.doc
      })
      expect((await ensureMediaFiles(f.payload)).visszatoltott).toBe(1)
      expect(f.doc.focalX).toBe(focus?.x ?? 50)
      expect(f.doc.focalY).toBe(focus?.y ?? 50)
      await expect(requireMediaRecoveryReceipt(f.payload, f.doc, f.asset)).resolves.toBeDefined()
      expect((await ensureMediaFiles(f.payload)).rendben).toBe(1)
      expect(f.update).toHaveBeenCalledTimes(1)
    },
  )

  it('normalizes absent metadata and excludes only derived URLs', () => {
    const f = fixture()
    expect(
      mediaRecoverySnapshot({
        ...f.doc,
        url: '/first',
        width: null,
        sizes: { xs: { url: '/derived' } },
      }),
    ).toBe(mediaRecoverySnapshot({ ...f.doc, url: '/other', width: undefined }))
    expect(
      mediaRecoverySnapshot({ ...f.doc, sizes: { xs: { filename: 'x.webp', url: '/first' } } }),
    ).toBe(
      mediaRecoverySnapshot({ ...f.doc, sizes: { xs: { filename: 'x.webp', url: '/other' } } }),
    )
  })

  it('rejects enrollment if the fresh record differs from verified bytes identity', async () => {
    const f = fixture()
    vi.mocked(f.payload.findByID).mockResolvedValue({ ...f.doc, alt: 'Concurrent editor' })
    await expect(enrollMediaRecovery(f.payload, f.doc)).rejects.toThrow()
    expect(f.create).not.toHaveBeenCalled()
  })

  it('does not adopt a later record instead of the actual update return', async () => {
    const f = fixture()
    await enrollMediaRecovery(f.payload, f.doc)
    const update = f.update.getMockImplementation()!
    f.update.mockImplementation(async () => {
      const returned = await update()
      f.edit({ alt: 'Concurrent edit after update' })
      return returned
    })
    f.lose()
    expect((await ensureMediaFiles(f.payload)).sikertelen).toBe(1)
    expect(f.receipts).toHaveLength(2)
    await expect(requireMediaRecoveryReceipt(f.payload, f.doc, f.asset)).rejects.toThrow()
  })

  it('refuses media update when the pending receipt cannot be persisted', async () => {
    const f = fixture()
    await enrollMediaRecovery(f.payload, f.doc)
    f.create.mockRejectedValue(new Error('audit offline'))
    f.lose()
    expect((await ensureMediaFiles(f.payload)).sikertelen).toBe(1)
    expect(f.update).not.toHaveBeenCalled()
  })

  it('does not renew after output bytes fail verification', async () => {
    const f = fixture()
    await enrollMediaRecovery(f.payload, f.doc)
    f.update.mockImplementation(async () => {
      writeFileSync(path.join(f.dir, f.asset.file), 'unexpected output')
      return f.doc
    })
    f.lose()
    expect((await ensureMediaFiles(f.payload)).sikertelen).toBe(1)
    expect(f.receipts).toHaveLength(2)
  })

  it('restores total main loss after verified enrollment and renews from returned identity', async () => {
    const f = fixture()
    await enrollMediaRecovery(f.payload, f.doc)
    f.lose()
    expect((await ensureMediaFiles(f.payload)).visszatoltott).toBe(1)
    expect(f.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 51, data: { alt: 'Owner description' } }),
    )
    await expect(requireMediaRecoveryReceipt(f.payload, f.doc, f.asset)).resolves.toBeDefined()
    expect(f.receipts).toHaveLength(3)
    expect((await ensureMediaFiles(f.payload)).rendben).toBe(1)
    expect(f.update).toHaveBeenCalledTimes(1)
  })

  it('holds total loss without a receipt', async () => {
    const f = fixture()
    f.lose()
    expect((await ensureMediaFiles(f.payload)).sikertelen).toBe(1)
    expect(f.update).not.toHaveBeenCalled()
  })

  it.each(['alt', 'filename', 'updatedAt', 'focalX'] as const)(
    'holds stale editor identity: %s',
    async (field) => {
      const f = fixture()
      await enrollMediaRecovery(f.payload, f.doc)
      f.edit({ [field]: field === 'focalX' ? 90 : 'editor-change' })
      await expect(requireMediaRecoveryReceipt(f.payload, f.doc, f.asset)).rejects.toThrow()
      expect(f.update).not.toHaveBeenCalled()
    },
  )

  it.each([null, {}, { status: 'restoring' }])(
    'never falls back past a malformed latest receipt: %j',
    async (after) => {
      const f = fixture()
      await enrollMediaRecovery(f.payload, f.doc)
      f.receipts.push({ ...f.receipts[0], id: 2, after })
      f.lose()
      expect((await ensureMediaFiles(f.payload)).sikertelen).toBe(1)
      expect(f.update).not.toHaveBeenCalled()
    },
  )

  it('rejects filename-only enrollment and failed audit writes', async () => {
    const f = fixture()
    writeFileSync(path.join(f.dir, f.asset.file), 'editor bytes')
    await expect(enrollMediaRecovery(f.payload, f.doc)).rejects.toThrow()
    expect(f.create).not.toHaveBeenCalled()
    writeFileSync(
      path.join(f.dir, f.asset.file),
      readFileSync(path.resolve('public/media/team', f.asset.file)),
    )
    f.create.mockRejectedValue(new Error('audit unavailable'))
    await expect(enrollMediaRecovery(f.payload, f.doc)).rejects.toThrow()
  })

  it('holds after failed renewal, leaving the latest receipt pending', async () => {
    const f = fixture()
    await enrollMediaRecovery(f.payload, f.doc)
    const create = f.create.getMockImplementation()!
    f.create.mockImplementation(async (args) => {
      if (f.receipts.length === 2) throw new Error('renewal unavailable')
      return create(args)
    })
    f.lose()
    expect((await ensureMediaFiles(f.payload)).sikertelen).toBe(1)
    expect(f.update).toHaveBeenCalledOnce()
    f.lose()
    expect((await ensureMediaFiles(f.payload)).sikertelen).toBe(1)
    expect(f.update).toHaveBeenCalledOnce()
  })

  it('requires audit readback to preserve public digests', async () => {
    const f = fixture()
    f.find.mockImplementation(async () => ({ docs: [] }))
    await expect(enrollMediaRecovery(f.payload, f.doc)).rejects.toThrow()
  })
})
