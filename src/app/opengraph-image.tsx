import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { ImageResponse } from 'next/og'
import sharp from 'sharp'

import { DEFAULT_OG_IMAGE, SITE_TAGLINE, SITE_URL } from '@/lib/seo'

/**
 * Az alap megosztási kép (`/opengraph-image`, 1200×630, PNG).
 *
 * Minden lap ezt örökli, amelyiknek nincs saját CMS-képe (`src/lib/seo.ts`
 * `DEFAULT_OG_IMAGE`). A Next fájl-konvenció generálja build-időben
 * (https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image),
 * ezért a betűk és a fotó futásidőben nem terhelnek.
 *
 * Miért ez a tartalom: a márka wordmarkja a saját betűjével (Tenor Sans, a
 * fejléc és a lábléc is ezzel írja a nevet), alatta a jelmondat (Nunito Sans,
 * a törzsszöveg betűje), a háttér a meglévő csapatfotó
 * (`public/media/team/founders-intro-white-1600.webp`): a megosztás-előnézet
 * így ugyanazt az arcot mutatja, amit a lap (E-E-A-T: a két gyógytornász a
 * márka, `docs/seo-geo-llm.md` 2.3). Új képet nem találunk ki.
 *
 * Méret és arány: ogp.me nem ír elő méretet, a Facebook/LinkedIn
 * megosztás-előnézet 1200×630 (1,91:1) képet kér, az X `summary_large_image`
 * kártyája 2:1 közelit, legalább 300×157-et (https://ogp.me/#structured,
 * https://developer.x.com/en/docs/x-for-websites/cards/overview/summary-card-with-large-image).
 *
 * Kontraszt: a szöveg fehér (#ffffff) a `--kc-color-ink` (#10243e) tónusú
 * átmeneten; a mért arány 16,9:1, jóval a WCAG 2.2 1.4.3 (4,5:1) fölött —
 * a színek a design-tokenekből (`styles/tokens.css`), idegen szín nincs.
 *
 * Betűk: a satori (a `next/og` motorja) TTF/OTF/WOFF-ot olvas, WOFF2-t nem;
 * a `public/fonts/*.ttf` a repóban lévő WOFF2 vágatok azonos tartalmú,
 * fontTools-szal konvertált párja (OFL licenc: `public/assets/fonts/OFL-*.txt`).
 */
export const alt = DEFAULT_OG_IMAGE.alt
export const size = { width: DEFAULT_OG_IMAGE.width, height: DEFAULT_OG_IMAGE.height }
export const contentType = 'image/png'

const PUBLIC_DIR = path.join(process.cwd(), 'public')
const PHOTO_FILE = path.join(PUBLIC_DIR, 'media', 'team', 'founders-intro-white-1600.webp')
const TENOR_FILE = path.join(PUBLIC_DIR, 'fonts', 'tenor-sans-400-latin.ttf')
const NUNITO_FILE = path.join(PUBLIC_DIR, 'fonts', 'nunito-sans-var-latin.ttf')

/** Design-tokenek (styles/tokens.css) — CSS-változó a képben nem elérhető. */
const COLOR_INK = '#10243e'
const COLOR_ACCENT_QUIET = '#9ec4df'
const COLOR_WHITE = '#ffffff'

/**
 * A fotó 1200×630-ra vágva, JPEG-ként, data-URL-ben: a satori a WebP-t nem
 * rajzolja ki, a JPEG-et igen. A `top` pozíció a felső 630 px-et tartja meg a
 * 1200×800-ra skálázott képből, ahol a két arc áll.
 */
async function photoDataUrl(): Promise<string> {
  const jpeg = await sharp(PHOTO_FILE)
    .resize(size.width, size.height, { fit: 'cover', position: 'top' })
    .jpeg({ quality: 82 })
    .toBuffer()
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`
}

export default async function OpenGraphImage() {
  const [tenor, nunito, photo] = await Promise.all([
    readFile(TENOR_FILE),
    readFile(NUNITO_FILE),
    photoDataUrl(),
  ])
  const host = new URL(SITE_URL).host

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        backgroundColor: COLOR_INK,
        fontFamily: 'Nunito Sans',
      }}
    >
      {/* satori-vászon, nem DOM: a next/image itt nem értelmezhető */}
      <img
        alt=""
        src={photo}
        width={size.width}
        height={size.height}
        style={{ position: 'absolute', top: 0, left: 0, objectFit: 'cover' }}
      />
      {/* Függőleges átmenet: a két arc (a kép felső kétharmada) látszik, a
          szöveg az alsó, sötét sávon áll (kontraszt 16,9:1, WCAG 2.2 1.4.3). */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: 'flex',
          backgroundImage: `linear-gradient(180deg, rgba(16,36,62,0.05) 0%, rgba(16,36,62,0.2) 35%, rgba(16,36,62,0.86) 62%, rgba(16,36,62,0.96) 100%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 64,
          bottom: 52,
          width: 1072,
          display: 'flex',
          flexDirection: 'column',
          color: COLOR_WHITE,
        }}
      >
        <div style={{ display: 'flex', fontFamily: 'Tenor Sans', fontSize: 92, letterSpacing: 2 }}>
          <span>Kineti</span>
          <span style={{ color: COLOR_ACCENT_QUIET }}>care</span>
        </div>
        <div style={{ display: 'flex', fontSize: 34, marginTop: 8, lineHeight: 1.25 }}>
          {SITE_TAGLINE}
        </div>
        <div style={{ display: 'flex', fontSize: 26, marginTop: 14, color: COLOR_ACCENT_QUIET }}>
          {`Kézrehabilitáció gyógytornászoktól · ${host}`}
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: 'Tenor Sans', data: tenor, weight: 400, style: 'normal' },
        { name: 'Nunito Sans', data: nunito, weight: 400, style: 'normal' },
      ],
    },
  )
}
