import type { CollectionConfig } from 'payload'

import { resolveMediaStaticDir } from '../lib/media-dir'

/** A feltöltési célkönyvtár a `PAYLOAD_MEDIA_DIR`-ből (env nélkül `undefined`). */
const mediaStaticDir = resolveMediaStaticDir()

/**
 * Médiafeltöltés: webméretek (320–1920), og 1200×630, webp q80, raszter only (SVG
 * kizárva), max 10 MB. Tárolás: `PAYLOAD_MEDIA_DIR` (élesben Railway volume);
 * hiányzó fájlok: `ensureMediaFiles`. Később: R2/S3 adapter.
 */
export const Media: CollectionConfig = {
  slug: 'media',
  labels: {
    singular: 'Kép',
    plural: 'Képek',
  },
  admin: {
    useAsTitle: 'alt',
    group: 'Tartalom',
    defaultColumns: ['alt', 'filename', 'mimeType', 'updatedAt'],
    description: 'Az oldalon használt képek. Feltöltés után bármelyik oldalról kiválaszthatók.',
  },
  access: {
    read: () => true,
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
      label: 'Képleírás (alt)',
      admin: {
        description:
          'A kép szöveges leírása — kötelező, a képernyőolvasók és a Google miatt. Írd le egy mondatban, mi látszik a képen.',
      },
    },
  ],
  upload: {
    // A kulcs CSAK akkor kerül be, ha van env-érték: enélkül a Payload
    // szanitálása állítja be az alapértelmezést (a collection slugja), tehát a
    // mai fejlesztői viselkedés bitre azonos marad.
    ...(mediaStaticDir === undefined ? {} : { staticDir: mediaStaticDir }),
    formatOptions: {
      format: 'webp',
      options: { quality: 80 },
    },
    imageSizes: [
      { name: 'xs', width: 320, withoutEnlargement: true },
      { name: 'sm', width: 640, withoutEnlargement: true },
      { name: 'md', width: 1280, withoutEnlargement: true },
      { name: 'lg', width: 1920, withoutEnlargement: true },
      {
        name: 'og',
        width: 1200,
        height: 630,
        fit: 'cover',
        position: 'centre',
        withoutEnlargement: true,
      },
    ],
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'],
  },
}
