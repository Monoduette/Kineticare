import type { MetadataRoute } from 'next'

import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from '@/lib/seo'

/**
 * `/manifest.webmanifest` — a Next metadata-API generálja, és a keret
 * `<link rel="manifest">`-jét is ő teszi ki.
 *
 * Mezők a W3C Web Application Manifest szerint (https://www.w3.org/TR/appmanifest/):
 * `name`/`short_name`, `description`, `lang`, `start_url`, `display`,
 * `theme_color`/`background_color`, `icons`. A színek a design-tokenek
 * (`styles/tokens.css`): `--kc-color-paper` #f6f9fc a lap-háttér (ugyanaz,
 * mint a `viewport.themeColor`); a `background_color` az indítóképernyő
 * háttere, ezért a lap-háttérrel egyezik.
 *
 * Ikonok (WP49, 2026-09-19): a tulajdonosok új logócsomagjának kéz-ikonja
 * (`public/assets/brand/kineticare-icon.svg`) fehér mezőn, a csomag két
 * rögzített színével (#11233d, #8cb0d9); a fájlokat az őr-teszt méri
 * (`favicon-ikonok.test.ts`). KIZÁRÓLAG a meglévő fájlok (`src/app/icon.svg`,
 * `src/app/apple-icon.png` 180×180), amiket a Next fájl-konvenció a gyökéren
 * szolgál ki. 192/512 px-es
 * PNG nincs a repóban; kitalálni tilos — nyitott tétel a tulajdonosnak (a
 * telepíthető PWA-hoz a Chrome legalább egy 192 és egy 512 px-es PNG-t kér:
 * https://developer.chrome.com/docs/lighthouse/pwa/installable-manifest).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME}: ${SITE_TAGLINE}`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    lang: 'hu',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: '#f6f9fc',
    background_color: '#f6f9fc',
    categories: ['health', 'education', 'medical'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
    ],
  }
}
