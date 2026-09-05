import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import type { Payload, PayloadRequest } from 'payload'
import { generateFileData } from '../../node_modules/payload/dist/uploads/generateFileData.js'
import { Media as MediaCollection } from '../collections/Media'

import teamManifest from '../../public/media/team/manifest.json'
import pressManifest from '../../public/media/press/manifest.json'

import { HOME_IMAGES } from '../lib/home-seed'
import { LEGACY_IMAGES } from '../lib/legacy-images'
import { MEDIA_DIR_ENV, resolveMediaStaticDir } from '../lib/media-dir'
import {
  buildMediaSourceIndex,
  ensureMediaFiles,
  mediaBaseName,
  missingMediaFiles,
  resolveUploadDir,
} from '../lib/media-restore'
import type { Media } from '../payload-types'
import {
  MEDIA_RECOVERY_ACTION,
  mediaRecoverySnapshot,
  mediaRecoveryProcessingConfig,
} from '../lib/media-recovery-provenance'

/**
 * A deploykor elveszett képek önjavítása (src/lib/media-restore.ts) — a DB-t
 * nem igénylő, tiszta részek. A tényleges visszatöltést a funkcionális próba
 * fedi (üres feltöltési könyvtár + újrafuttatott seed).
 */

function mediaDoc(overrides: Partial<Media>): Media {
  return {
    id: 1,
    alt: 'Teszt kép',
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    ...overrides,
  }
}

describe('feltöltési könyvtár (PAYLOAD_MEDIA_DIR)', () => {
  /**
   * A legfontosabb elvárás: env nélkül SEMMI nem változik. Ilyenkor `undefined`
   * jön vissza, a `staticDir` kulcs be sem kerül az upload-blokkba, tehát a
   * Payload alapértelmezése (a collection slugja) marad érvényben.
   */
  it('üres vagy hiányzó env esetén undefined (marad a Payload alapértelmezése)', () => {
    expect(resolveMediaStaticDir(undefined)).toBeUndefined()
    expect(resolveMediaStaticDir('')).toBeUndefined()
    expect(resolveMediaStaticDir('   ')).toBeUndefined()
  })

  it('megadott értéket abszolút útvonalra normalizál', () => {
    expect(resolveMediaStaticDir('/app/media')).toBe('/app/media')
    expect(resolveMediaStaticDir('  /app/media  ')).toBe('/app/media')
    expect(path.isAbsolute(resolveMediaStaticDir('media') ?? '')).toBe(true)
  })

  it('a változó neve a dokumentált kulcs', () => {
    expect(MEDIA_DIR_ENV).toBe('PAYLOAD_MEDIA_DIR')
  })
})

describe('forrásindex (repóban élő képek)', () => {
  const index = buildMediaSourceIndex()

  /**
   * A helyreállítás CSAK akkor működik, ha minden listázott forrásfájl tényleg
   * ott van a repóban. Ha valaki átnevez vagy töröl egy assetet, ez a teszt
   * bukik — nem az éles deploy.
   */
  it('mindhárom forráskészlet minden fájlja létezik a lemezen', () => {
    expect(index.size).toBe(
      HOME_IMAGES.length +
        LEGACY_IMAGES.length +
        teamManifest.assets.length +
        pressManifest.assets.length,
    )
    for (const [baseName, filePath] of index) {
      expect(existsSync(filePath), `${baseName} → ${filePath}`).toBe(true)
    }
  })

  /**
   * A párosítás kulcsa a kiterjesztés nélküli alapnév, mert a Media collection
   * webp-re konvertál: a `sos-hands-board.jpg` forrásból `sos-hands-board.webp`
   * fájlnév lesz a DB-ben.
   */
  it('az alapnév alapján párosít (a webp-konverzió miatt)', () => {
    expect(mediaBaseName('sos-hands-board.webp')).toBe('sos-hands-board')
    expect(mediaBaseName('678fcfac079a8_Gyakorlat.webp')).toBe('678fcfac079a8_Gyakorlat')
    expect(index.get(mediaBaseName('sos-hands-board.webp'))).toMatch(/sos-hands-board\.jpg$/)
    expect(index.get(mediaBaseName('6884161138c15_puska.webp'))).toMatch(
      /6884161138c15_puska\.png$/,
    )
    // Saját, adminból feltöltött képhez nincs repó-forrás — ezt nem pótoljuk.
    expect(index.get('a-lanyok-sajat-kepe')).toBeUndefined()
  })
})

describe('owner-review team média helyreállítása, DB és élő szolgáltatás nélkül', () => {
  const folders: string[] = []
  const temporaryUploadDir = () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'kineticare-team-restore-'))
    folders.push(folder)
    return folder
  }
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  })

  function payloadFixture(docs: Media[], staticDir: string) {
    // These restore fixtures model previously enrolled surviving main files.
    // Real enrollment and audit failure paths live in media-recovery-provenance.test.ts.
    const receipts = docs.flatMap((doc) => {
      const asset = teamManifest.assets.find((item) => item.file === doc.filename)
      const file = path.join(staticDir, doc.filename ?? '')
      if (!asset || !existsSync(file)) return []
      return [
        {
          action: MEDIA_RECOVERY_ACTION,
          entityType: 'media',
          entityId: String(doc.id),
          after: {
            version: 1,
            status: 'verified',
            receiptKey: 'fixture-receipt',
            mediaId: doc.id,
            filename: doc.filename,
            sourcePublicDigest: asset.sha256,
            storedPublicDigest: createHash('sha256').update(readFileSync(file)).digest('hex'),
            mediaSnapshot: mediaRecoverySnapshot(doc),
            processingConfig: '',
          },
        },
      ]
    })
    const update = vi.fn<(args: unknown) => Promise<Media>>(async () => docs[0])
    const findByID = vi.fn(async ({ id }: { id: number | string }) => {
      const doc = docs.find((candidate) => candidate.id === id)
      if (!doc) throw new Error(`Missing media fixture: ${id}`)
      return doc
    })
    const payload = {
      config: { sharp },
      collections: {
        media: {
          config: {
            ...MediaCollection,
            upload: {
              ...(typeof MediaCollection.upload === 'object' ? MediaCollection.upload : {}),
              staticDir,
            },
          },
        },
      },
      find: vi.fn(async ({ collection, where }) => ({
        docs:
          collection === 'media'
            ? docs
            : receipts
                .filter((receipt) => receipt.entityId === where.and[2].entityId.equals)
                .slice(-1),
      })),
      create: vi.fn(async ({ data }) => {
        receipts.push(data)
        return { id: receipts.length }
      }),
      findByID,
      update,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as unknown as Payload
    for (const receipt of receipts)
      receipt.after.processingConfig = mediaRecoveryProcessingConfig(payload)
    return { payload, findByID, update }
  }

  it.each(teamManifest.assets)(
    '$file: a manifest forrása helyes, de a hiányzó team főfájl kézi ellenőrzést kér',
    async (asset) => {
      const source = path.resolve('public/media/team', asset.file)
      expect(buildMediaSourceIndex().get(mediaBaseName(asset.file))).toBe(source)
      expect(path.dirname(source)).toBe(path.resolve('public/media/team'))
      expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(asset.sha256)
      const doc = mediaDoc({ id: 412, filename: asset.file, alt: 'Szerkesztői képleírás' })
      const dir = temporaryUploadDir()
      const { payload, findByID, update } = payloadFixture([doc], dir)
      const summary = await ensureMediaFiles(payload)
      expect(summary).toEqual({
        ellenorzott: 1,
        rendben: 0,
        visszatoltott: 0,
        potolhatatlan: 0,
        sikertelen: 1,
      })
      expect(findByID).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
      expect(payload.logger.error).toHaveBeenCalledWith(expect.stringContaining('kézi'))
    },
  )

  it('a Payload q80 feltöltési normalizálását kapja vissza, majd nem írja felül a meglévő fájlt', async () => {
    const asset = teamManifest.assets[0]
    const source = path.resolve('public/media/team', asset.file)
    const variant = `${mediaBaseName(asset.file)}-320x213.webp`
    const doc = mediaDoc({ filename: asset.file, sizes: { xs: { filename: variant } } })
    const dir = temporaryUploadDir()
    writeFileSync(path.join(dir, asset.file), readFileSync(source))
    // A futó config az egyetlen cél: nem a cwd/media vagy a publikus forráskönyvtár.
    const { payload, update } = payloadFixture([doc], path.relative(process.cwd(), dir))
    expect(resolveUploadDir(payload)).toBe(dir)
    update.mockImplementation(async (args) => {
      const { filePath } = args as { filePath: string }
      const bytes = await sharp(readFileSync(filePath), { animated: true })
        .rotate()
        .webp({ quality: 80 })
        .toBuffer()
      writeFileSync(path.join(dir, asset.file), bytes)
      writeFileSync(path.join(dir, variant), 'regenerated variant')
      return doc
    })
    expect((await ensureMediaFiles(payload)).visszatoltott).toBe(1)
    const stored = readFileSync(path.join(dir, asset.file))
    const expected = await sharp(readFileSync(source), { animated: true })
      .rotate()
      .webp({ quality: 80 })
      .toBuffer()
    expect(stored).toEqual(expected)
    expect(createHash('sha256').update(stored).digest('hex')).not.toBe(asset.sha256)
    expect((await ensureMediaFiles(payload)).rendben).toBe(1)
    expect(update).toHaveBeenCalledTimes(1)
    expect(readFileSync(path.join(dir, asset.file))).toEqual(stored)
  })

  it('meglévő saját fájlt és minden méretváltozatát érintetlenül hagyja', async () => {
    const file = teamManifest.assets[0].file
    const dir = temporaryUploadDir()
    const variant = `${mediaBaseName(file)}-320x213.webp`
    const doc = mediaDoc({ filename: file, sizes: { xs: { filename: variant } } })
    writeFileSync(path.join(dir, file), 'saját szerkesztői kép')
    writeFileSync(path.join(dir, variant), 'saját méretváltozat')
    const { payload, update } = payloadFixture([doc], dir)
    expect((await ensureMediaFiles(payload)).rendben).toBe(1)
    expect(update).not.toHaveBeenCalled()
    expect(readFileSync(path.join(dir, file), 'utf8')).toBe('saját szerkesztői kép')
    expect(readFileSync(path.join(dir, variant), 'utf8')).toBe('saját méretváltozat')
  })

  it.each(['original', 'normalized'])(
    'hiányzó team méretváltozatot a Payload pótol (%s főfájl)',
    async (kind) => {
      const file = teamManifest.assets[0].file
      const dir = temporaryUploadDir()
      const source = readFileSync(path.resolve('public/media/team', file))
      const stored =
        kind === 'original'
          ? source
          : await sharp(source, { animated: true }).rotate().webp({ quality: 80 }).toBuffer()
      writeFileSync(path.join(dir, file), stored)
      const doc = mediaDoc({
        filename: file,
        sizes: { xs: { filename: `${mediaBaseName(file)}-320x213.webp` } },
      })
      const { payload, update } = payloadFixture([doc], dir)
      expect((await ensureMediaFiles(payload)).visszatoltott).toBe(1)
      expect(update).toHaveBeenCalledTimes(1)
    },
  )

  it.each([
    ['filename', { filename: 'editor-replacement.webp' }],
    ['sizes', { sizes: { xs: { filename: 'editor-variant.webp' } } }],
    ['alt', { alt: 'Közben szerkesztett képleírás' }],
    ['focalX', { focalX: 12 }],
    ['focalY', { focalY: 88 }],
    ['updatedAt', { updatedAt: '2026-09-05T00:01:00.000Z' }],
  ])('kihagyja a közben megváltozott médiarekordot: %s', async (_, change) => {
    const file = teamManifest.assets[0].file
    const dir = temporaryUploadDir()
    const source = readFileSync(path.resolve('public/media/team', file))
    writeFileSync(
      path.join(dir, file),
      await sharp(source, { animated: true }).rotate().webp({ quality: 80 }).toBuffer(),
    )
    const doc = mediaDoc({
      filename: file,
      sizes: { xs: { filename: `${mediaBaseName(file)}-320x213.webp` } },
      focalX: 50,
      focalY: 50,
    })
    const { payload, findByID, update } = payloadFixture([doc], dir)
    findByID.mockResolvedValue({ ...doc, ...change })

    const summary = await ensureMediaFiles(payload)

    expect(summary.sikertelen).toBe(1)
    expect(summary.visszatoltott).toBe(0)
    expect(findByID).toHaveBeenCalledExactlyOnceWith({
      collection: 'media',
      id: doc.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(update).not.toHaveBeenCalled()
    expect(payload.logger.warn).toHaveBeenCalledWith(expect.stringContaining('közben változott'))
  })

  it('szerkesztett team főképet nem ír felül hiányzó variáns miatt, és folytatja a többi rekordot', async () => {
    const file = teamManifest.assets[0].file
    const dir = temporaryUploadDir()
    const edited = await sharp({
      create: { width: 1280, height: 800, channels: 3, background: '#ee2211' },
    })
      .webp()
      .toBuffer()
    writeFileSync(path.join(dir, file), edited)
    const doc = mediaDoc({ filename: file, sizes: { og: { filename: 'missing-og.webp' } } })
    const { payload, update } = payloadFixture(
      [doc, mediaDoc({ id: 2, filename: 'sos-hands-board.webp' })],
      dir,
    )
    const summary = await ensureMediaFiles(payload)
    expect(summary.sikertelen).toBe(1)
    expect(summary.visszatoltott).toBe(1)
    expect(update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 2 }))
    expect(readFileSync(path.join(dir, file))).toEqual(edited)
    expect(payload.logger.error).toHaveBeenCalledWith(expect.stringContaining('kézi'))
  })

  it('eltérő futó normalizálási konfiggal nem találgatja a megmaradt főfájl eredetét', async () => {
    const file = teamManifest.assets[0].file
    const dir = temporaryUploadDir()
    const stored = await sharp(readFileSync(path.resolve('public/media/team', file)), {
      animated: true,
    })
      .rotate()
      .webp({ quality: 80 })
      .toBuffer()
    writeFileSync(path.join(dir, file), stored)
    const { payload, update } = payloadFixture(
      [mediaDoc({ filename: file, sizes: { og: { filename: 'missing-og.webp' } } })],
      dir,
    )
    payload.collections.media.config.upload.formatOptions = {
      format: 'webp',
      options: { quality: 90 },
    }
    expect((await ensureMediaFiles(payload)).sikertelen).toBe(1)
    expect(update).not.toHaveBeenCalled()
    expect(readFileSync(path.join(dir, file))).toEqual(stored)
    expect(payload.logger.error).toHaveBeenCalledWith(expect.stringContaining('kézi'))
  })

  it.each([
    { x: 0, y: 0 },
    { x: 85, y: 90 },
  ])('a tényleges Payload crop megőrzi a dokumentum fókuszpontját: %j', async (focalPoint) => {
    const file = teamManifest.assets[0].file
    const dir = temporaryUploadDir()
    const doc = mediaDoc({
      filename: file,
      sizes: { og: { filename: `${mediaBaseName(file)}-1200x630.webp` } },
      focalX: focalPoint.x,
      focalY: focalPoint.y,
    })
    writeFileSync(path.join(dir, file), readFileSync(path.resolve('public/media/team', file)))
    const { payload, update } = payloadFixture([doc], dir)
    const generate = async (
      query: PayloadRequest['query'],
      data: Partial<Media> = { alt: doc.alt, focalX: doc.focalX, focalY: doc.focalY },
    ) => {
      const bytes = readFileSync(path.resolve('public/media/team', file))
      return generateFileData({
        collection: payload.collections.media,
        config: payload.config,
        data,
        originalDoc: doc,
        operation: 'update',
        overwriteExistingFiles: true,
        req: {
          payload,
          query,
          file: { data: bytes, name: file, mimetype: 'image/webp', size: bytes.length },
        } as PayloadRequest,
      })
    }
    const expected = await generate({ uploadEdits: { focalPoint } })
    const centered = await generate({ uploadEdits: { focalPoint: { x: 50, y: 50 } } })
    const og = (result: typeof expected) =>
      result.files.find((entry) => entry.path.endsWith('-1200x630.webp'))!.buffer
    expect(og(expected)).not.toEqual(og(centered))
    update.mockImplementation(async (args) => {
      const options = args as { data: Partial<Media>; req?: { query: PayloadRequest['query'] } }
      const result = await generate(options.req?.query ?? {}, options.data)
      for (const entry of result.files) writeFileSync(entry.path, entry.buffer)
      expect(result.data.focalX).toBe(focalPoint.x)
      expect(result.data.focalY).toBe(focalPoint.y)
      return doc
    })
    expect((await ensureMediaFiles(payload)).visszatoltott).toBe(1)
    expect(update).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: doc.id,
        data: { alt: doc.alt },
        req: { query: { uploadEdits: { focalPoint } } },
      }),
    )
    expect(readFileSync(path.join(dir, `${mediaBaseName(file)}-1200x630.webp`))).toEqual(
      og(expected),
    )
    expect(readFileSync(path.join(dir, file))).toEqual(
      expected.files.find((entry) => entry.path === path.join(dir, file))!.buffer,
    )
  })

  it.each([
    'sajat-admin-kep.webp',
    'founders-intro-white-1600-1.webp',
    'founders-intro-white-1601.webp',
    'founders-intro-white-1600.png',
    'SYL_9147.webp',
  ])(
    'az ismeretlen vagy eltérő normalizált név nem kap találgatott forrást: %s',
    async (filename) => {
      const { payload, update } = payloadFixture([mediaDoc({ filename })], temporaryUploadDir())
      expect((await ensureMediaFiles(payload)).potolhatatlan).toBe(1)
      expect(update).not.toHaveBeenCalled()
    },
  )

  it.each(['main', 'variant'])(
    'eltérő committed SHA esetén nincs helyreállítás (%s hiányzik), és a következő rekord feldolgozható',
    async (missing) => {
      const asset = teamManifest.assets[0]
      const originalHash = asset.sha256
      const dir = temporaryUploadDir()
      if (missing === 'variant') writeFileSync(path.join(dir, asset.file), 'meglévő kép')
      const doc = mediaDoc({
        filename: asset.file,
        sizes: { xs: { filename: 'hianyzo-320.webp' } },
      })
      const { payload, update } = payloadFixture(
        [doc, mediaDoc({ id: 2, filename: 'sos-hands-board.webp' })],
        dir,
      )
      // Csak az importált fixture-adat változik a memóriában; a committed manifest/fotó nem.
      asset.sha256 = '0'.repeat(64)
      try {
        const summary = await ensureMediaFiles(payload)
        expect(summary.sikertelen).toBe(1)
        expect(summary.visszatoltott).toBe(1)
        expect(update).toHaveBeenCalledTimes(1)
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
        expect(payload.logger.error).toHaveBeenCalledWith(expect.stringContaining('SHA-256'))
        if (missing === 'variant')
          expect(readFileSync(path.join(dir, asset.file), 'utf8')).toBe('meglévő kép')
      } finally {
        asset.sha256 = originalHash
      }
    },
  )

  it.each([
    '../outside.webp',
    '/tmp/outside.webp',
    '..\\outside.webp',
    'nested/photo.webp',
    'photo.png',
  ])('nem indexelhet manifest-forrást a megengedett team fájlneveken kívül: %s', (file) => {
    const asset = teamManifest.assets[0]
    const originalFile = asset.file
    asset.file = file
    try {
      expect(() => buildMediaSourceIndex()).toThrow(
        'A team média manifest fájlneve nem biztonságos; használj kisbetűs WebP alapnevet.',
      )
    } finally {
      asset.file = originalFile
    }
  })

  it.each(['', 'not-a-hash', 'f'.repeat(63), 'F'.repeat(64)])(
    'érvénytelen manifest SHA-formátumot elutasít: %s',
    (sha256) => {
      const asset = teamManifest.assets[0]
      const originalHash = asset.sha256
      asset.sha256 = sha256
      try {
        expect(() => buildMediaSourceIndex()).toThrow(
          'A team média manifest SHA-256 értéke hibás; adj meg 64 karakteres kisbetűs hex értéket.',
        )
      } finally {
        asset.sha256 = originalHash
      }
    },
  )

  it.each(['../outside.webp', '/tmp/outside.webp', '..\\outside.webp', 'nested/photo.webp'])(
    'a rekord főfájlja és variánsa sem léphet a feltöltési könyvtáron kívülre: %s',
    async (unsafe) => {
      const dir = temporaryUploadDir()
      const file = teamManifest.assets[0].file
      for (const doc of [
        mediaDoc({ filename: unsafe }),
        mediaDoc({ filename: file, sizes: { xs: { filename: unsafe } } }),
      ]) {
        expect(() => missingMediaFiles(dir, doc)).toThrow(
          'A médiafájlnév kilépne a feltöltési könyvtárból; használj könyvtárnév nélküli fájlnevet.',
        )
        const { payload, update } = payloadFixture([doc], dir)
        expect((await ensureMediaFiles(payload)).sikertelen).toBe(1)
        expect(update).not.toHaveBeenCalled()
      }
    },
  )

  it.each(['sos-hands-board.webp', '6884161138c15_puska.webp'])(
    'az eredeti home/legacy helyreállítás változatlan: %s',
    async (filename) => {
      const { payload, update } = payloadFixture([mediaDoc({ filename })], temporaryUploadDir())
      expect((await ensureMediaFiles(payload)).visszatoltott).toBe(1)
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: buildMediaSourceIndex().get(mediaBaseName(filename)) }),
      )
    },
  )

  it('egy sikertelen visszatöltés után a következő rekord ellenőrzése folytatódik', async () => {
    const file = teamManifest.assets[0].file
    const dir = temporaryUploadDir()
    writeFileSync(path.join(dir, file), readFileSync(path.resolve('public/media/team', file)))
    const { payload, update } = payloadFixture(
      [
        mediaDoc({ filename: file, sizes: { xs: { filename: 'missing-variant.webp' } } }),
        mediaDoc({ id: 2, filename: 'sos-hands-board.webp' }),
      ],
      dir,
    )
    update.mockRejectedValueOnce(new Error('Tesztelt feltöltési hiba'))
    const summary = await ensureMediaFiles(payload)
    expect(summary.sikertelen).toBe(1)
    expect(summary.visszatoltott).toBe(1)
  })
})

describe('hiányzó fájlok felderítése', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kineticare-media-'))
  writeFileSync(path.join(dir, 'megvan.webp'), 'x')
  writeFileSync(path.join(dir, 'megvan-320.webp'), 'x')

  it('a meglévő fájlokra üres listát ad', () => {
    const doc = mediaDoc({
      filename: 'megvan.webp',
      sizes: { xs: { filename: 'megvan-320.webp' } },
    })
    expect(missingMediaFiles(dir, doc)).toEqual([])
  })

  it('a hiányzó fő fájlt és a hiányzó méret-variánst is jelzi', () => {
    const doc = mediaDoc({
      filename: 'nincs.webp',
      sizes: { xs: { filename: 'nincs-320.webp' } },
    })
    expect(missingMediaFiles(dir, doc)).toEqual(['nincs.webp', 'nincs-320.webp'])
  })

  /**
   * A `withoutEnlargement: true` miatt kis forrásképnél egy-egy méret-variáns
   * jogosan üres marad — üres `filename` nem számít hiányzó fájlnak.
   */
  it('a ki nem generált méret-variánst nem tekinti hiányzónak', () => {
    const doc = mediaDoc({
      filename: 'megvan.webp',
      sizes: {
        xs: { filename: 'megvan-320.webp' },
        lg: { filename: null },
        og: {},
      },
    })
    expect(missingMediaFiles(dir, doc)).toEqual([])
  })
})
