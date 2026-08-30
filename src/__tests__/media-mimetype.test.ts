import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { Media } from '../collections/Media'

/**
 * SEC-002 — a Media feltöltési allowlist NEM enged AVIF-et. A Next.js 16.3.3
 * javítja az image-optimizer AVIF-dekódolóját érintő RCE-t; az AVIF-forrást
 * ettől függetlenül, defense-in-depth rétegként tiltjuk. A bevett
 * képformátumok (JPEG/PNG/WebP/GIF) továbbra is engedettek, a kimenet pedig
 * úgyis webp.
 */
describe('Media upload mimeTypes allowlist (SEC-002)', () => {
  const mimeTypes = Media.upload && typeof Media.upload === 'object' ? Media.upload.mimeTypes : undefined

  it('AVIF NINCS az engedélyezett feltöltési formátumok között', () => {
    expect(mimeTypes).toBeDefined()
    expect(mimeTypes).not.toContain('image/avif')
  })

  it('a bevett képformátumok engedettek maradnak (feltöltés nem törik)', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) {
      expect(mimeTypes).toContain(type)
    }
  })

  it('a szerkesztői útmutató sem sorolja az AVIF-et az engedélyezett formátumok közé', () => {
    const guide = readFileSync(
      new URL('../../docs/szerkesztoi-utmutato.md', import.meta.url),
      'utf8',
    )
    const formatsLine = guide
      .split(/\r?\n/)
      .find((line) => line.startsWith('- **Formátumok:**'))
    const allowedFormats = formatsLine?.split('.')[0]

    expect(formatsLine).toBeDefined()
    expect(allowedFormats).toContain('jpg, png, webp, gif')
    expect(allowedFormats).not.toMatch(/\bavif\b/i)
    expect(formatsLine).toContain('AVIF és SVG nem tölthető fel')
  })
})
