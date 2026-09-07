/**
 * Kifejezetten engedélyezett localhost:3000 előnézethez, nem CI/app-indító.
 * Node 24: node <ez-a-fájl> <telepített-playwright/index.mjs> [képmappa]
 * Csak helyi GET kérések; a fotó összehasonlítása nem retusál képfájlt.
 * Chrome híján: PLAYWRIGHT_CHROMIUM_EXECUTABLE=<chromium bináris>.
 *
 * A01 (2026-09-07): a fotó alsó széle a régi oldal wave path-jából készült
 * SVG-maszk (8%-os alsó réteg, ~7,3% amplitúdó), a páros táblában a figure
 * a rács jobb felét tölti (≤ 50%), 900 px alatt egy hasáb, 28 rem-es sapka.
 */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import sharp from 'sharp'

assert.ok(process.argv[2], 'Add meg a meglévő Playwright modul útját.')
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href)
const output = process.argv[3]
if (output) await mkdir(output, { recursive: true })

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
const browser = await chromium.launch(
  executablePath
    ? { executablePath, headless: true, args: ['--no-sandbox'] }
    : { channel: 'chrome', headless: true },
)
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === 'http://localhost:3000' &&
    route.request().method() === 'GET'
      ? route.continue()
      : route.abort(),
  )

  async function open(slug) {
    await page.goto(`http://localhost:3000${slug}`, { waitUntil: 'networkidle' })
    const necessary = page.getByRole('button', { name: 'Csak a szükségeseket', exact: true })
    if (await necessary.count()) {
      // A Next dev jelzője mobilon a gomb fölé lóghat; valódi billentyűzetes út.
      await necessary.focus()
      await necessary.press('Enter')
      await necessary.waitFor({ state: 'hidden' })
    }
    await page.evaluate(() => document.fonts.ready)
    const figure = page.locator('.kc-about__figure')
    await figure.scrollIntoViewIfNeeded()
    // A kép lusta (loading="lazy"): a decode() csak betöltött forráson
    // értelmes, a görgetés után előbb a betöltést várjuk meg.
    await figure
      .locator('img')
      .evaluate((img) => img.complete && img.naturalWidth > 0)
      .then(async (loaded) => {
        if (loaded) return
        await page.waitForFunction(() => {
          const img = document.querySelector('.kc-about__figure img')
          return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0
        })
      })
    await figure.locator('img').evaluate((img) => img.decode())
    return figure
  }

  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const home = await open('/')
    assert.equal(await home.evaluate((el) => getComputedStyle(el).maskImage), 'none')
    console.log(`PASS ${width}px: home photo unchanged, no mask`)

    for (const reducedMotion of ['no-preference', 'reduce']) {
      await page.emulateMedia({ reducedMotion })
      const figure = await open('/rolunk')
      const geometry = await figure.evaluate((el) => {
        const img = el.querySelector('img')
        const box = el.getBoundingClientRect()
        const imageBox = img.getBoundingClientRect()
        const imageStyle = getComputedStyle(img)
        const style = getComputedStyle(el)
        const grid = el.closest('.kc-about__grid').getBoundingClientRect()
        return {
          width: box.width,
          height: box.height,
          gridWidth: grid.width,
          mask: style.maskImage,
          filter: style.filter,
          opacity: style.opacity,
          animation: style.animationName,
          fit: imageStyle.objectFit,
          imageFilter: imageStyle.filter,
          imageOpacity: imageStyle.opacity,
          fullImageBox:
            imageBox.left >= box.left - 1 &&
            imageBox.right <= box.right + 1 &&
            imageBox.top >= box.top - 1 &&
            imageBox.bottom <= box.bottom + 1,
          overflow: document.documentElement.scrollWidth > innerWidth,
        }
      })
      assert.match(geometry.mask, /^linear-gradient\(.*\), url\("data:image\/svg\+xml,/)
      assert.doesNotMatch(geometry.mask, /radial-gradient/)
      assert.equal(geometry.filter, 'none')
      assert.equal(geometry.imageFilter, 'none')
      assert.equal(geometry.opacity, '1')
      assert.equal(geometry.imageOpacity, '1')
      assert.equal(geometry.animation, 'none')
      assert.equal(geometry.fit, 'contain')
      assert.equal(geometry.fullImageBox, true)
      assert.equal(geometry.overflow, false)
      if (width >= 900) {
        // Fele-fele tábla: a fotó a jobb hasáb, legfeljebb a rács fele.
        assert.ok(geometry.width <= geometry.gridWidth / 2 + 1, `fotó ${geometry.width} > fél rács`)
        assert.ok(geometry.width >= geometry.gridWidth * 0.44, `fotó ${geometry.width} keskeny`)
      } else {
        assert.ok(geometry.width <= 448)
        assert.ok(
          Math.abs(geometry.width - geometry.gridWidth) <= 1,
          'egy hasáb: a fotó a hasáb szélessége',
        )
      }

      const masked = await figure.screenshot({
        animations: 'disabled',
        ...(output ? { path: path.join(output, `wave-${width}-${reducedMotion}.png`) } : {}),
      })
      // Azonos kompozitálási út: a teljesen fedő maszk csak a hullámot kapcsolja ki.
      await figure.evaluate((el) => el.style.setProperty('mask', 'linear-gradient(#000 0 0)'))
      const plain = await figure.screenshot({ animations: 'disabled' })
      await figure.evaluate((el) => el.style.removeProperty('mask'))
      const a = await sharp(masked).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const b = await sharp(plain).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      assert.deepEqual(a.info, b.info)

      // A hullám-réteg a magasság 8%-a (+0,5% átfedés, +1 px kerekítés).
      let changed = 0
      let firstChangedRow = a.info.height
      for (let y = 0; y < a.info.height; y += 1) {
        for (let x = 0; x < a.info.width; x += 1) {
          const offset = (y * a.info.width + x) * 4
          if (a.data.subarray(offset, offset + 4).equals(b.data.subarray(offset, offset + 4))) {
            continue
          }
          changed += 1
          firstChangedRow = Math.min(firstChangedRow, y)
        }
      }
      assert.ok(changed > 0, 'A hullámos szél ténylegesen látszik a képen.')
      const waveRows = Math.ceil(a.info.height * 0.085) + 1
      assert.ok(
        firstChangedRow >= a.info.height - waveRows,
        `Csak az alsó hullám-sáv változhat (első változott sor ${firstChangedRow}/${a.info.height}).`,
      )
      // A hullám tényleges amplitúdója: az első és az utolsó változott sor közti
      // sáv legalább a magasság 6%-a (a tulajdonosi 6–8%-os cél alsó széle).
      assert.ok(
        a.info.height - firstChangedRow >= Math.floor(a.info.height * 0.06),
        `A hullám amplitúdója ${a.info.height - firstChangedRow} px < 6%.`,
      )
      const still = await figure.screenshot({ animations: 'disabled' })
      assert.deepEqual(still, masked, 'A hullámos szél statikus marad.')
      console.log(
        `PASS ${width}px ${reducedMotion}: photo ${geometry.width}x${geometry.height} of grid ${geometry.gridWidth}, ${changed} changed pixels, bottom ${a.info.height - firstChangedRow} rows only (${((100 * (a.info.height - firstChangedRow)) / a.info.height).toFixed(1)}%); face/hands unchanged`,
      )
    }
  }
} finally {
  await browser.close()
}
