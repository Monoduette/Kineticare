import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import manifest from '../../public/media/press/manifest.json'

const PRESS_DIR = path.resolve(process.cwd(), 'public/media/press')
const EXPECTED_FILES = [
  'kossuth-radio.png',
  'tv2.webp',
  'mase.png',
  'magyar-kezsebesz-tarsasag.png',
] as const
const EXPECTED_EXISTING = [
  'press-noklapja.png',
  'press-karc.png',
  'press-hazipatika.png',
  'press-kepmas.png',
  'press-ispor.png',
  'press-mgyft.png',
] as const

describe('KC V1 press-logo assetcsomag', () => {
  it('a négy jóváhagyott fájl tényleges bájthashe és dekódolt képmérete egyezik', async () => {
    expect(manifest.assets.map((asset) => asset.file)).toEqual(EXPECTED_FILES)

    for (const asset of manifest.assets) {
      const bytes = readFileSync(path.join(PRESS_DIR, asset.file))
      const metadata = await sharp(bytes).metadata()

      expect(createHash('sha256').update(bytes).digest('hex'), asset.file).toBe(asset.sha256)
      expect(metadata.width, asset.file).toBe(asset.localWidth)
      expect(metadata.height, asset.file).toBe(asset.localHeight)
      expect(metadata.format?.toLowerCase(), asset.file).toBe(asset.sourceFormat.toLowerCase())
    }
  })

  it('biztonságos fájlneveket és ellenőrizhető forrásmetaadatot tartalmaz', () => {
    for (const asset of manifest.assets) {
      expect(asset.file, asset.file).toMatch(/^[a-z0-9][a-z0-9.-]*$/)
      expect(path.basename(asset.file), asset.file).toBe(asset.file)
      expect(asset.alt.trim().length, asset.file).toBeGreaterThan(0)
      expect(asset.brandUseCaveat.trim().length, asset.file).toBeGreaterThan(0)

      for (const rawUrl of [asset.officialPage, asset.sourceUrl]) {
        const url = new URL(rawUrl)
        expect(['http:', 'https:'], rawUrl).toContain(url.protocol)
        expect(url.username, rawUrl).toBe('')
        expect(url.password, rawUrl).toBe('')
        expect(url.hash, rawUrl).toBe('')
      }
    }

    const httpAssets = manifest.assets.filter((asset) => asset.sourceUrl.startsWith('http:'))
    expect(httpAssets.map((asset) => asset.file)).toEqual(['magyar-kezsebesz-tarsasag.png'])
    expect(httpAssets[0]?.sourceUrl).toMatch(/^http:\/\/www\.kezsebesz\.hu\//)
    expect(httpAssets[0]?.brandUseCaveat).toContain('HTTP')
  })

  it('additívan őrzi a régi hat logót, és a blokk a 12-es korlát alatt marad', () => {
    expect(manifest.integration.mode).toBe('additive')
    expect(manifest.preserveExisting).toEqual(EXPECTED_EXISTING)
    expect(new Set(manifest.preserveExisting).size).toBe(EXPECTED_EXISTING.length)
    expect(manifest.integration.existingCount).toBe(EXPECTED_EXISTING.length)
    expect(manifest.integration.verifiedAdditionCount).toBe(EXPECTED_FILES.length)
    expect(manifest.integration.resultingCount).toBe(
      manifest.preserveExisting.length + manifest.assets.length,
    )
    expect(manifest.integration.resultingCount).toBeLessThanOrEqual(manifest.integration.maxRows)
    expect(manifest.integration.maxRows).toBe(12)
    expect(manifest.integration.requiresCmsWrite).toBe(true)
    expect(manifest.integration.acquisitionPerformedCmsWrite).toBe(false)
  })

  it('D3 feloldatlan marad, és nem kerül fabrikált assetként a csomagba', () => {
    expect(manifest.unresolved.some((item) => item.request === 'D3')).toBe(true)
    expect(
      manifest.assets.some((asset) =>
        `${asset.name} ${asset.file} ${asset.alt}`.toLowerCase().includes('d3'),
      ),
    ).toBe(false)
  })
})
