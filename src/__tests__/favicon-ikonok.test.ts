import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * AZ ALKALMAZÁS-IKONOK ŐRE (favicon.ico, icon.svg, apple-icon.png).
 * 2026-08-17-ig a `/favicon.ico`, `/icon.png`, `/apple-icon.png` és
 * `/favicon.svg` MIND 404-et adott — helyben és élesben is —, miközben a `/`
 * 200-at. A böngészőfülön és a könyvjelzőben üres lap-ikon látszott, és ez volt
 * az egyetlen konzol-hiba a lapokon.
 *
 * WP49 (2026-09-19): az ikonok a tulajdonosok új logócsomagjának kéz-ikonjából
 * készültek (`public/assets/brand/kineticare-icon.svg`): fehér mezőn a két
 * rögzített márkaszín, a sötétkék (#11233d) és a világoskék (#8cb0d9) kéz.
 * A fehér mező a csomag saját bemutató-hátterét követi; a sötétkék kéz hordozza
 * az azonosítást (a fehéren 15,77:1), a világoskék kéz dekoratív rajz (2,25:1;
 * a logotípia az SC 1.4.11 alól kivétel:
 * https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).
 */

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url))

/** A fehér mező és a logó két rögzített színe (src/lib/brand-logo.ts). */
const FIELD_RGB = { r: 0xff, g: 0xff, b: 0xff } as const
const MARK_DARK_RGB = { r: 0x11, g: 0x23, b: 0x3d } as const
const MARK_LIGHT_RGB = { r: 0x8c, g: 0xb0, b: 0xd9 } as const

/** WCAG 2.2 relatív fényesség (Relative luminance definíció). */
function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const channel = (value: number): number => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 2.2 kontrasztarány két színre. */
function contrastRatio(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [light, dark] = la >= lb ? [la, lb] : [lb, la]
  return (light + 0.05) / (dark + 0.05)
}

type IcoEntry = { width: number; height: number; bitCount: number; offset: number; length: number }

/** Az ICO-könyvtár kiolvasása (ICONDIR + ICONDIRENTRY-k). */
function readIcoDirectory(buffer: Buffer): IcoEntry[] {
  expect(buffer.length, 'A favicon.ico túl rövid az ICONDIR-hez.').toBeGreaterThan(6)
  expect(buffer.readUInt16LE(0), 'ICO fenntartott mező').toBe(0)
  expect(buffer.readUInt16LE(2), 'ICO típus (1 = ikon)').toBe(1)
  const count = buffer.readUInt16LE(4)

  const entries: IcoEntry[] = []
  for (let index = 0; index < count; index += 1) {
    const at = 6 + index * 16
    const rawWidth = buffer.readUInt8(at)
    const rawHeight = buffer.readUInt8(at + 1)
    entries.push({
      // A 0 érték az ICO-ban 256 képpontot jelent.
      width: rawWidth === 0 ? 256 : rawWidth,
      height: rawHeight === 0 ? 256 : rawHeight,
      bitCount: buffer.readUInt16LE(at + 6),
      length: buffer.readUInt32LE(at + 8),
      offset: buffer.readUInt32LE(at + 12),
    })
  }
  return entries
}

/**
 * Egy 32 bites BMP (DIB) ICO-kép képpontjainak megszámlálása szín szerint.
 * A DIB sorai alulról felfelé állnak, a képpontok BGRA sorrendben.
 */
function countIcoPixels(
  buffer: Buffer,
  entry: IcoEntry,
): { total: number; markDark: number; markLight: number; field: number } {
  const headerSize = buffer.readUInt32LE(entry.offset)
  expect(headerSize, 'BITMAPINFOHEADER mérete').toBe(40)
  const pixelStart = entry.offset + headerSize
  const total = entry.width * entry.height

  const near = (value: number, target: number): boolean => Math.abs(value - target) <= 12
  const is = (r: number, g: number, b: number, rgb: { r: number; g: number; b: number }) =>
    near(r, rgb.r) && near(g, rgb.g) && near(b, rgb.b)

  let markDark = 0
  let markLight = 0
  let field = 0
  for (let i = 0; i < total; i += 1) {
    const at = pixelStart + i * 4
    const b = buffer.readUInt8(at)
    const g = buffer.readUInt8(at + 1)
    const r = buffer.readUInt8(at + 2)
    const a = buffer.readUInt8(at + 3)
    if (a < 200) continue
    if (is(r, g, b, MARK_DARK_RGB)) markDark += 1
    else if (is(r, g, b, MARK_LIGHT_RGB)) markLight += 1
    else if (is(r, g, b, FIELD_RGB)) field += 1
  }
  return { total, markDark, markLight, field }
}

/** PNG IHDR: szélesség, magasság, szín-típus. */
function readPngHeader(buffer: Buffer): { width: number; height: number; colorType: number } {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  expect(
    buffer.subarray(0, 8).equals(signature),
    'Az apple-icon.png nem PNG-aláírással kezdődik.',
  ).toBe(true)
  expect(buffer.subarray(12, 16).toString('ascii'), 'Az első chunk IHDR kell legyen.').toBe('IHDR')
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer.readUInt8(25),
  }
}

describe('alkalmazás-ikonok (favicon, icon, apple-icon)', () => {
  it('mindhárom ikonfájl a GYÖKÉR src/app/-ban van, és nem nulla méretű', () => {
    // A favicon.ico kizárólag itt lehet (Next-dokumentáció), az icon.svg és az
    // apple-icon.png pedig azért van itt, hogy utótag nélküli útvonalat kapjon.
    for (const name of ['favicon.ico', 'icon.svg', 'apple-icon.png']) {
      const path = `${APP_DIR}${name}`
      expect(existsSync(path), `Hiányzik a src/app/${name} — a /${name} újra 404 lenne.`).toBe(true)
      const bytes = readFileSync(path)
      expect(bytes.length, `A src/app/${name} üres vagy csonka.`).toBeGreaterThan(200)
      // WP49 kikötés: 100 KB-nál nagyobb ikonfájl nem kerülhet a repóba.
      expect(bytes.length, `A src/app/${name} 100 KB-nál nagyobb.`).toBeLessThanOrEqual(100_000)
    }
  })

  it('az útvonal-csoportokban NINCS ikonfájl (ott hash-utótagos útvonalat kapna)', () => {
    // A (frontend)/(payload) csoportba tett metadata-fájl neve djb2-hash
    // utótagot kap, tehát a /favicon.ico, /icon.svg, /apple-icon.png továbbra
    // is 404 maradna. A favicon.ico-t a Next ott egyáltalán nem is gyűjti be.
    for (const group of ['(frontend)', '(payload)']) {
      for (const name of ['favicon.ico', 'icon.svg', 'icon.png', 'apple-icon.png']) {
        expect(
          existsSync(`${APP_DIR}${group}/${name}`),
          `A ${group}/${name} rossz helyen van: az útvonala hash-utótagot kapna.`,
        ).toBe(false)
      }
    }
  })

  it('a favicon.ico szabályos ICO, tartalmaz legalább 32×32-es képet, és annak vannak KÉPPONTJAI', () => {
    const buffer = readFileSync(`${APP_DIR}favicon.ico`)
    const entries = readIcoDirectory(buffer)
    expect(entries.length, 'Az ICO nem tartalmaz egyetlen képet sem.').toBeGreaterThan(0)

    for (const entry of entries) {
      expect(entry.length, 'Nulla méretű ICO-kép.').toBeGreaterThan(0)
      expect(
        entry.offset + entry.length,
        'Az ICO-kép a fájl végén túlra mutat (csonka fájl).',
      ).toBeLessThanOrEqual(buffer.length)
    }

    // A hivatkozási kézikönyv (Evil Martians, „How to Favicon in 2021") szerint
    // a favicon.ico alapmérete 32×32 — ez a minimum, amit tartanunk kell.
    const large = entries.find((entry) => entry.width >= 32 && entry.height >= 32)
    expect(large, 'Az ICO-ból hiányzik a legalább 32×32-es kép.').toBeDefined()
    if (!large) return

    expect(large.bitCount, 'Az ICO-kép nem 32 bites (alfa-csatorna nélkül).').toBe(32)

    // Az „üres kép" halálmód ellen: a két kéznek és a mezőnek is valódi
    // felületet kell kitöltenie. Egy átlátszó vagy egyszínű placeholder itt
    // megbukik.
    const pixels = countIcoPixels(buffer, large)
    expect(pixels.markDark / pixels.total, 'A sötétkék kéz eltűnt az ikonról.').toBeGreaterThan(
      0.05,
    )
    expect(pixels.markLight / pixels.total, 'A világoskék kéz eltűnt az ikonról.').toBeGreaterThan(
      0.05,
    )
    expect(pixels.field / pixels.total, 'A fehér mező eltűnt az ikonról.').toBeGreaterThan(0.3)
  })

  it('az apple-icon.png 180×180, és — az Apple HIG szerint — átlátszóság nélküli', () => {
    const header = readPngHeader(readFileSync(`${APP_DIR}apple-icon.png`))
    // 180×180: „Since iOS 8+, iPads have required an image with a 180×180
    // resolution. Other devices will downscale it." (Evil Martians)
    expect(header.width, 'apple-icon szélesség').toBe(180)
    expect(header.height, 'apple-icon magasság').toBe(180)
    // colorType 2 = truecolour alfa NÉLKÜL. Az iOS maga rak árnyékot és
    // lekerekítést az ikonra, ezért az átlátszó ikon hibásan jelenne meg.
    expect(header.colorType, 'Az apple-icon.png nem lehet átlátszó (alfa-csatornás).').toBe(2)
  })

  it('az icon.svg az új kéz-ikon a fehér mezőn, és a sötétkék kéz↔mező kontrasztja mérve ≥ 4,5:1', () => {
    const svg = readFileSync(`${APP_DIR}icon.svg`, 'utf8')
    expect(svg, 'Az icon.svg nem SVG-gyökérelemmel kezdődik.').toContain('<svg')
    expect(svg, 'Hiányzik a viewBox — az SVG nem skálázódna helyesen.').toContain(
      'viewBox="0 0 32 32"',
    )
    // A mező fehér, a két kéz a logócsomag rögzített színei — idegen szín nem
    // kerülhet be (a csomag SVG-je: public/assets/brand/kineticare-icon.svg).
    expect(svg, 'A mező nem fehér.').toContain('fill="#ffffff"')
    expect(svg, 'Hiányzik a sötétkék kéz (#11233d).').toContain('fill="#11233d"')
    expect(svg, 'Hiányzik a világoskék kéz (#8cb0d9).').toContain('fill="#8cb0d9"')
    // A rajz nem lehet üres: a két kéz path-adata a csomag SVG-jével egyezik.
    const brand = readFileSync(
      fileURLToPath(new URL('../../public/assets/brand/kineticare-icon.svg', import.meta.url)),
      'utf8',
    )
    const brandPaths = [...brand.matchAll(/ d="([^"]+)"/g)].map((match) => match[1])
    expect(brandPaths, 'A csomag kéz-ikonjában két path kell legyen.').toHaveLength(2)
    for (const d of brandPaths) {
      expect(d.length).toBeGreaterThan(50)
      expect(svg, 'Az icon.svg kéz-rajza eltér a csomag SVG-jétől.').toContain(d)
    }

    // Az azonosítást hordozó kontraszt: sötétkék kéz a fehér mezőn.
    // A WCAG 2.2 1.4.3 szövegküszöbe 4,5:1, az 1.4.11 nem-szöveges küszöbe 3:1.
    const ratio = contrastRatio(MARK_DARK_RGB, FIELD_RGB)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
    // Rögzítjük a mért értéket is, hogy egy színcsere ne csúszhasson át némán.
    expect(Number(ratio.toFixed(2))).toBe(15.77)
    // A világoskék kéz dekoratív: a mért érték a jegyzőkönyvé (nem küszöb).
    expect(Number(contrastRatio(MARK_LIGHT_RGB, FIELD_RGB).toFixed(2))).toBe(2.25)
  })

  it('a (frontend) layout NEM ír kézi icons metadata-mezőt (az felülírná a fájl-konvenciót)', () => {
    const layout = readFileSync(`${APP_DIR}(frontend)/layout.tsx`, 'utf8')
    expect(
      /\bicons\s*:/.test(layout),
      'A layout `icons` mezője felülírná a fájl-alapú ikonokat — a fájl-konvenció önmagában elég.',
    ).toBe(false)
  })
})
