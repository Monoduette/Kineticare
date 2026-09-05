/**
 * Kifejezetten engedélyezett localhost:3000 előnézethez, nem CI/app-indító.
 * Node 24: node <ez-a-fájl> <telepített-playwright/index.mjs> [képmappa]
 * Csak helyi GET kérések; a fotó összehasonlítása nem retusál képfájlt.
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

const browser = await chromium.launch({ channel: 'chrome', headless: true })
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
        return {
          width: box.width,
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
      assert.match(geometry.mask, /radial-gradient/)
      assert.equal(geometry.filter, 'none')
      assert.equal(geometry.imageFilter, 'none')
      assert.equal(geometry.opacity, '1')
      assert.equal(geometry.imageOpacity, '1')
      assert.equal(geometry.animation, 'none')
      assert.equal(geometry.fit, 'contain')
      assert.equal(geometry.fullImageBox, true)
      assert.equal(geometry.overflow, false)
      assert.ok(geometry.width <= 448)

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

      // A lekerekített képernyő-pixel miatt a 3 CSS px határa legfeljebb 4 sor.
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
      assert.ok(firstChangedRow >= a.info.height - 4, 'Csak az alsó szegély változhat.')
      const still = await figure.screenshot({ animations: 'disabled' })
      assert.deepEqual(still, masked, 'A hullámos szél statikus marad.')
      console.log(
        `PASS ${width}px ${reducedMotion}: ${changed} changed pixels, bottom ${a.info.height - firstChangedRow} rows only; face/hands unchanged`,
      )
    }
  }
} finally {
  await browser.close()
}
