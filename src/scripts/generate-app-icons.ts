/**
 * Kineticare alkalmazás-ikonok (favicon.ico, icon.svg, apple-icon.png) egy
 * forrásból: a tulajdonosok logócsomagjának kéz-ikonjából
 * (`public/assets/brand/kineticare-icon.svg`, két path: világoskék #8cb0d9 és
 * sötétkék #11233d kéz).
 * Futtatás: npx tsx src/scripts/generate-app-icons.ts
 * Kimenet: commitolt statikus fájlok a src/app/ gyökérben.
 *
 * KÉT RAJZ, KÉT MÉRETOSZTÁLY (design-átvétel, 2026-09-19):
 *  - A böngésző-ikon (icon.svg, favicon.ico 16/32/48) CSAK a sötétkék kezet
 *    viszi a fehér mezőn. A két egymásba érő kéz 16 px-en két elmosódott
 *    folt volt (QA: icons.png), mert a kettő együtt 1960 egység széles, tehát
 *    egy kéz ~7 px-re zsugorodott, a világoskék pedig 2,25:1-gyel alig vált
 *    el a fehértől. Egy kéz a 32-es rács ~85 %-át tölti ki, 16 px-en is ~13 px
 *    széles, sötét (15,77:1) sziluett.
 *  - Az apple-icon (180×180) a csomag teljes ikonját (két kéz) kapja fehér
 *    mezőn, 8 %-os belső margóval: itt van hely a két kéznek, és a
 *    kezdőképernyőn a márkajel egésze ismerhető fel.
 * Források: Evil Martians, „How to Favicon in 2024": SVG + 32 px ICO + 180 px
 * apple-touch-icon, az ICO-ban egyszerű, kis méreten olvasható rajz
 * (https://evilmartians.com/chronicles/how-to-favicon-in-2021-six-files-that-fit-most-needs);
 * Apple HIG, App icons: egyszerű, egyetlen fókuszpontú rajz, a lekerekítést a
 * rendszer teszi rá, ezért az ikon átlátszóság és saját lekerekítés nélkül
 * készül (https://developer.apple.com/design/human-interface-guidelines/app-icons);
 * Material Design, Product icons: a kis méretű ikon egyetlen tömör
 * sziluett, ne részletgazdag illusztráció
 * (https://m2.material.io/design/iconography/product-icons.html);
 * WCAG 2.2 SC 1.4.11: a sötétkék kéz a fehér mezőn 15,77:1
 * (https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

/** A repó gyökere ehhez a fájlhoz képest (src/scripts/ → két szint fel). */
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** A fehér mező és a csomag két rögzített márkaszíne (src/lib/brand-logo.ts). */
const FIELD_COLOR = '#ffffff'
const MARK_DARK = '#11233d'
const MARK_LIGHT = '#8cb0d9'

/** A rajzrács oldalhossza (a böngésző-ikon viewBoxa). */
const GRID = 32

/** A lekerekített mező sugara a 32-es rácson (20 % — tömör, „app-ikon" forma). */
const FIELD_RADIUS = 6.4

/** A csomag SVG-jének viewBoxa. */
const BRAND_VIEWBOX = { width: 1960, height: 1042.00585 }

type Box = { x: number; y: number; width: number; height: number }

/** Kerekítés 4 tizedesre — a kimeneti SVG rövid és determinisztikus marad. */
function r4(value: number): number {
  return Math.round(value * 10000) / 10000
}

/** A csomag két path-adata: [világoskék, sötétkék], a fájl sorrendjében. */
function readBrandPaths(): { light: string; dark: string } {
  const svg = readFileSync(
    new URL('public/assets/brand/kineticare-icon.svg', `file://${REPO_ROOT}`),
    'utf8',
  )
  const paths = [...svg.matchAll(/<path class="(cls-[12])" d="([^"]+)"/g)].map((m) => ({
    cls: m[1],
    d: m[2],
  }))
  const light = paths.find((p) => p.cls === 'cls-1')?.d
  const dark = paths.find((p) => p.cls === 'cls-2')?.d
  if (!light || !dark) {
    throw new Error('A csomag kéz-ikonjában nem található a két path (cls-1, cls-2).')
  }
  return { light, dark }
}

/**
 * Egy path (vagy több) befoglaló doboza a csomag koordinátáiban: a rajzot
 * átlátszó háttéren raszterizáljuk, és az alfa-csatorna szélső képpontjait
 * mérjük (a path-adat ívei miatt a kézi bbox-számítás nem megbízható).
 */
async function measureBox(paths: readonly string[]): Promise<Box> {
  const scale = 0.5
  const width = Math.round(BRAND_VIEWBOX.width * scale)
  const height = Math.round(BRAND_VIEWBOX.height * scale)
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BRAND_VIEWBOX.width} ${BRAND_VIEWBOX.height}" width="${width}" height="${height}">`,
    ...paths.map((d) => `<path fill="#000" d="${d}"/>`),
    `</svg>`,
  ].join('')
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  })
  let minX = info.width
  let minY = info.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) throw new Error('A rajz üres.')
  return {
    x: minX / scale,
    y: minY / scale,
    width: (maxX - minX + 1) / scale,
    height: (maxY - minY + 1) / scale,
  }
}

/** Transzformáció, amely a `box`-ot a `size` oldalú négyzet közepére illeszti `margin` belső margóval. */
function fitTransform(box: Box, size: number, margin: number): string {
  const inner = size - 2 * margin
  const scale = Math.min(inner / box.width, inner / box.height)
  const tx = (size - box.width * scale) / 2 - box.x * scale
  const ty = (size - box.height * scale) / 2 - box.y * scale
  return `translate(${r4(tx)} ${r4(ty)}) scale(${r4(scale)})`
}

/** A böngésző-ikon SVG-forrása: fehér, lekerekített mező + a sötétkék kéz. */
function buildBrowserSvg(darkPath: string, darkBox: Box): string {
  // 2,4 px-es margó a 32-es rácson (7,5 %): a kéz a rács 85 %-át tölti ki.
  const transform = fitTransform(darkBox, GRID, 2.4)
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" width="${GRID}" height="${GRID}" role="img" aria-label="Kineticare">`,
    `<title>Kineticare</title>`,
    `<rect width="${GRID}" height="${GRID}" rx="${FIELD_RADIUS}" ry="${FIELD_RADIUS}" fill="${FIELD_COLOR}"/>`,
    `<g transform="${transform}">`,
    `<path fill="${MARK_DARK}" d="${darkPath}"/>`,
    `</g>`,
    `</svg>`,
    '',
  ].join('\n')
}

/** Az apple-icon SVG-forrása: fehér négyzet + a két kéz, 8 %-os belső margóval. */
function buildAppleSvg(paths: { light: string; dark: string }, bothBox: Box, size: number): string {
  const transform = fitTransform(bothBox, size, size * 0.08)
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`,
    `<rect width="${size}" height="${size}" fill="${FIELD_COLOR}"/>`,
    `<g transform="${transform}">`,
    `<path fill="${MARK_LIGHT}" d="${paths.light}"/>`,
    `<path fill="${MARK_DARK}" d="${paths.dark}"/>`,
    `</g>`,
    `</svg>`,
  ].join('')
}

/** Egy SVG-forrás raszterizálása négyzetes PNG-vé (átlátszóság nélkül). */
async function rasterize(svg: string, size: number): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density: 512 })
    .resize(size, size, { fit: 'fill', kernel: 'lanczos3' })
    .flatten({ background: FIELD_COLOR })
    .removeAlpha()
    .png({ compressionLevel: 9, palette: false })
    .toBuffer()
}

/**
 * ICO-konténer BMP (DIB) képekből.
 *
 * A PNG-alapú ICO-t a modern böngészők értik, de a klasszikus, 32 bites BMP
 * változatot MINDEN kliens érti (a Windows-parancsikon is), és 48×48-ig a
 * méretkülönbség elhanyagolható — ezért DIB-et írunk.
 *
 * Szerkezet: ICONDIR (6 bájt) + n × ICONDIRENTRY (16 bájt) + a képadatok.
 * Egy DIB-kép: BITMAPINFOHEADER (40 bájt, a magasság DUPLA, mert tartalmazza
 * az AND-maszkot is) + alulról felfelé sorrendű BGRA képpontok + 1 bites
 * AND-maszk (nálunk csupa 0: az átlátszóságot az alfa-csatorna viszi).
 */
function buildIco(images: readonly { size: number; rgba: Buffer }[]): Buffer {
  const dibs = images.map(({ size, rgba }) => {
    const header = Buffer.alloc(40)
    header.writeUInt32LE(40, 0) // biSize
    header.writeInt32LE(size, 4) // biWidth
    header.writeInt32LE(size * 2, 8) // biHeight (XOR + AND)
    header.writeUInt16LE(1, 12) // biPlanes
    header.writeUInt16LE(32, 14) // biBitCount
    header.writeUInt32LE(0, 16) // biCompression = BI_RGB

    const xor = Buffer.alloc(size * size * 4)
    for (let y = 0; y < size; y += 1) {
      // A DIB sorai alulról felfelé állnak.
      const sourceRow = size - 1 - y
      for (let x = 0; x < size; x += 1) {
        const s = (sourceRow * size + x) * 4
        const d = (y * size + x) * 4
        xor[d] = rgba[s + 2] // B
        xor[d + 1] = rgba[s + 1] // G
        xor[d + 2] = rgba[s] // R
        xor[d + 3] = rgba[s + 3] // A
      }
    }

    // AND-maszk: soronként 4 bájtra igazítva, csupa nulla (mindent „látható"-ra hagy).
    const maskRowBytes = Math.ceil(size / 8 / 4) * 4
    const mask = Buffer.alloc(maskRowBytes * size)

    header.writeUInt32LE(xor.length + mask.length, 20) // biSizeImage
    return { size, data: Buffer.concat([header, xor, mask]) }
  })

  const directory = Buffer.alloc(6 + dibs.length * 16)
  directory.writeUInt16LE(0, 0) // reserved
  directory.writeUInt16LE(1, 2) // type = icon
  directory.writeUInt16LE(dibs.length, 4)

  let offset = directory.length
  dibs.forEach((dib, index) => {
    const at = 6 + index * 16
    directory.writeUInt8(dib.size >= 256 ? 0 : dib.size, at)
    directory.writeUInt8(dib.size >= 256 ? 0 : dib.size, at + 1)
    directory.writeUInt8(0, at + 2) // színpaletta mérete: 0 = nincs
    directory.writeUInt8(0, at + 3) // fenntartott
    directory.writeUInt16LE(1, at + 4) // színsíkok
    directory.writeUInt16LE(32, at + 6) // bit/képpont
    directory.writeUInt32LE(dib.data.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += dib.data.length
  })

  return Buffer.concat([directory, ...dibs.map((d) => d.data)])
}

async function main(): Promise<void> {
  const paths = readBrandPaths()
  const darkBox = await measureBox([paths.dark])
  const bothBox = await measureBox([paths.light, paths.dark])

  // 1) SVG-ikon — a modern böngészők elsődleges, méretfüggetlen forrása.
  const browserSvg = buildBrowserSvg(paths.dark, darkBox)
  writeFileSync(new URL('src/app/icon.svg', `file://${REPO_ROOT}`), browserSvg, 'utf8')

  // 2) favicon.ico — 16 / 32 / 48, a klasszikus kérési útvonalra, ugyanabból a rajzból.
  const icoSizes = [16, 32, 48]
  const icoImages = await Promise.all(
    icoSizes.map(async (size) => {
      const rgba = await sharp(Buffer.from(browserSvg), { density: 512 })
        .resize(size, size, { fit: 'fill', kernel: 'lanczos3' })
        .ensureAlpha()
        .raw()
        .toBuffer()
      return { size, rgba }
    }),
  )
  const ico = buildIco(icoImages)
  writeFileSync(new URL('src/app/favicon.ico', `file://${REPO_ROOT}`), ico)

  // 3) apple-icon.png — 180×180, a két kéz, átlátszóság és lekerekítés NÉLKÜL.
  const applePng = await rasterize(buildAppleSvg(paths, bothBox, 180), 180)
  writeFileSync(new URL('src/app/apple-icon.png', `file://${REPO_ROOT}`), applePng)

  // Ellenőrző kimenet a fejlesztőnek (nem naplózás: egyszeri, kézi eszköz).
  process.stdout.write(
    [
      'Kineticare ikonok előállítva:',
      `  src/app/icon.svg        ${browserSvg.length} bájt`,
      `  src/app/favicon.ico     ${ico.length} bájt (${icoSizes.join(', ')} px)`,
      `  src/app/apple-icon.png  ${applePng.length} bájt (180×180)`,
      '',
    ].join('\n'),
  )
}

await main()
