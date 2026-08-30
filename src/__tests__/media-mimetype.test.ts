import { describe, expect, it } from 'vitest'

import { Media } from '../collections/Media'

/**
 * SEC-002 — a Media feltöltési allowlist NEM enged AVIF-et: a Next.js <16.3.3
 * image-optimizer AVIF-dekódolón át RCE-vel érintett, ezért a rosszindulatú
 * AVIF forrás fel se tölthető, amíg a verzióemelés emberi jóváhagyásra vár.
 * A bevett képformátumok (JPEG/PNG/WebP/GIF) továbbra is engedettek — a
 * szerkesztők így is tudnak képet tölteni, a kimenet pedig úgyis webp.
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
})
