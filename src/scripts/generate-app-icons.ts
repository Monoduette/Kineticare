/**
 * Kineticare alkalmazás-ikonok (favicon.ico, icon.svg, apple-icon.png) egy forrásból.
 * Futtatás: npx tsx src/scripts/generate-app-icons.ts
 * Kimenet commitolt statikus fájl; fehér „K" monogram #2f6e9f mezőn (tokens.css).
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

/** A repó gyökere ehhez a fájlhoz képest (src/scripts/ → két szint fel). */
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** Márkaszínek — a tokens.css `--kc-color-accent-deep`, illetve a fehér. */
const FIELD_COLOR = '#2f6e9f'
const MARK_COLOR = '#ffffff'

/** A rajzrács oldalhossza. Minden koordináta ezen a 32-es rácson él. */
const GRID = 32

/** A lekerekített mező sugara a 32-es rácson (20% — tömör, „app-ikon" forma). */
const FIELD_RADIUS = 6.4

type Point = { x: number; y: number }

/**
 * A „K" geometriai paraméterei a 32-es rácson.
 *
 * A vízszintes és függőleges éleket SZÁNDÉKOSAN páros értékekre tettük
 * (szár 8→12, verzálmagasság 8→24): felezéskor — vagyis a 16×16-os
 * raszternél — ezek egész képpont-határra esnek, így a szár és a betű teteje/
 * alja a legkisebb méreten sem mosódik el. A 32×32-es raszteren a szár pontosan
 * 4, az átlók 3,6 képpont vastagok; 16×16-on 2, illetve 1,8. Ez mindkét méreten
 * a kutatás által kért „legalább 2 képpont 32×32-en" fölött marad.
 */
const K = {
  /** A függőleges szár középvonalának x-e. */
  stemX: 10.0,
  /** A szár vastagsága. */
  stemWidth: 4.0,
  /** Az átlós vonások (kar, láb) merőleges vastagsága — a száréhoz képest
   *  valamivel könnyebb, ahogy a betűtervezésben az átlók szoktak. */
  diagonalWidth: 3.6,
  /** Verzálmagasság: felső és alsó vágás. */
  capTop: 8.0,
  capBottom: 24.0,
  /** A kar középvonalának kezdőpontja a száron belül, és a felső végződése. */
  armStart: { x: 10.0, y: 16.2 } satisfies Point,
  armEnd: { x: 21.0, y: 8.0 } satisfies Point,
  /** A láb középvonalának kezdőpontja a száron belül, és az alsó végződése. */
  legStart: { x: 10.0, y: 16.6 } satisfies Point,
  legEnd: { x: 20.8, y: 24.0 } satisfies Point,
}

/** Kerekítés 3 tizedesre — a kimeneti SVG így rövid és determinisztikus marad. */
function r3(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * Egy sokszög előjeles területe. A `nonzero` kitöltés csak akkor egyesíti az
 * átfedő alakzatokat, ha AZONOS körüljárásúak — ezért minden sokszöget
 * ugyanarra az irányra fordítunk.
 */
function signedArea(points: readonly Point[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

/** Sokszög → SVG path-részlet, egységes (pozitív előjelű) körüljárással. */
function polygonToPath(points: readonly Point[]): string {
  const ordered = signedArea(points) < 0 ? [...points].reverse() : points
  const [first, ...rest] = ordered
  const head = `M${r3(first.x)} ${r3(first.y)}`
  const body = rest.map((p) => `L${r3(p.x)} ${r3(p.y)}`).join('')
  return `${head}${body}Z`
}

/**
 * Átlós vonás négyszöge VÍZSZINTES végvágással.
 *
 * A `start` a száron BELÜL van (a szár téglalapja eltakarja), a `end` a
 * végződés középvonali pontja, amely a verzálmagasság vonalán ül. Egy
 * `width` merőleges vastagságú vonás két éle vízszintesen `width / |uy|`
 * távolságra van egymástól (levezetés: az egyik élről a másikra a `width·n`
 * merőleges eltolás plusz egy `k·u` menti korrekció visz, ahol k a függőleges
 * komponenst nullázza) — ez adja a végvágás szélességét.
 */
function diagonalStroke(start: Point, end: Point, width: number): Point[] {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  const ux = dx / length
  const uy = dy / length
  // Merőleges egységvektor.
  const nx = uy
  const ny = -ux
  const half = width / 2
  const cutHalf = width / Math.abs(uy) / 2
  // A `+n` oldal a vízszintes végvágáson attól függően esik jobbra vagy balra,
  // hogy a vonás lefelé (uy > 0) vagy fölfelé (uy < 0) tart. E nélkül a
  // négyszög két sarka keresztbe kötődne, és csokornyakkendő-alakot kapnánk.
  const side = Math.sign(nx)

  return [
    { x: start.x + nx * half, y: start.y + ny * half },
    { x: end.x + side * cutHalf, y: end.y },
    { x: end.x - side * cutHalf, y: end.y },
    { x: start.x - nx * half, y: start.y - ny * half },
  ]
}

/** A „K" jel path-adata: szár + kar + láb, `nonzero` kitöltéssel egyesítve. */
function buildMarkPath(): string {
  const stem: Point[] = [
    { x: K.stemX - K.stemWidth / 2, y: K.capTop },
    { x: K.stemX + K.stemWidth / 2, y: K.capTop },
    { x: K.stemX + K.stemWidth / 2, y: K.capBottom },
    { x: K.stemX - K.stemWidth / 2, y: K.capBottom },
  ]
  const arm = diagonalStroke(K.armStart, K.armEnd, K.diagonalWidth)
  const leg = diagonalStroke(K.legStart, K.legEnd, K.diagonalWidth)

  return [stem, arm, leg].map(polygonToPath).join('')
}

/**
 * Az ikon SVG-forrása.
 *
 * @param rounded lekerekített mező (böngésző-ikon) vagy teljes négyzet (iOS,
 *   ahol a maszkot a rendszer teszi rá).
 */
function buildSvg(rounded: boolean): string {
  const radius = rounded ? FIELD_RADIUS : 0
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" width="${GRID}" height="${GRID}" role="img" aria-label="Kineticare">`,
    `<title>Kineticare</title>`,
    `<rect width="${GRID}" height="${GRID}" rx="${radius}" ry="${radius}" fill="${FIELD_COLOR}"/>`,
    `<path d="${buildMarkPath()}" fill="${MARK_COLOR}" fill-rule="nonzero"/>`,
    `</svg>`,
    '',
  ].join('\n')
}

/** Egy SVG-forrás raszterizálása négyzetes PNG-vé. */
async function rasterize(svg: string, size: number, flatten: boolean): Promise<Buffer> {
  const pipeline = sharp(Buffer.from(svg), { density: 512 }).resize(size, size, {
    fit: 'fill',
    kernel: 'lanczos3',
  })
  return (flatten ? pipeline.flatten({ background: FIELD_COLOR }) : pipeline).png().toBuffer()
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
  const roundedSvg = buildSvg(true)
  const squareSvg = buildSvg(false)

  // 1) SVG-ikon — a modern böngészők elsődleges, méretfüggetlen forrása.
  const svgPath = new URL('src/app/icon.svg', `file://${REPO_ROOT}`)
  writeFileSync(svgPath, roundedSvg, 'utf8')

  // 2) favicon.ico — 16 / 32 / 48, a klasszikus kérési útvonalra.
  const icoSizes = [16, 32, 48]
  const icoImages = await Promise.all(
    icoSizes.map(async (size) => {
      const rgba = await sharp(Buffer.from(roundedSvg), { density: 512 })
        .resize(size, size, { fit: 'fill', kernel: 'lanczos3' })
        .ensureAlpha()
        .raw()
        .toBuffer()
      return { size, rgba }
    }),
  )
  writeFileSync(new URL('src/app/favicon.ico', `file://${REPO_ROOT}`), buildIco(icoImages))

  // 3) apple-icon.png — 180×180, átlátszóság NÉLKÜL, lekerekítés nélkül.
  const applePng = await rasterize(squareSvg, 180, true)
  writeFileSync(new URL('src/app/apple-icon.png', `file://${REPO_ROOT}`), applePng)

  // Ellenőrző kimenet a fejlesztőnek (nem naplózás: egyszeri, kézi eszköz).
  process.stdout.write(
    [
      'Kineticare ikonok előállítva:',
      `  src/app/icon.svg        ${roundedSvg.length} bájt`,
      `  src/app/favicon.ico     ${buildIco(icoImages).length} bájt (${icoSizes.join(', ')} px)`,
      `  src/app/apple-icon.png  ${applePng.length} bájt (180×180)`,
      '',
    ].join('\n'),
  )
}

await main()
