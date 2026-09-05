/**
 * P2: a hero két CTA-ja a rövid mobil sticky nézetben is elérhető marad.
 * Node 24: node <ez-a-fájl> <telepített-playwright/index.mjs> [képmappa]
 * Kizárólag az engedélyezett localhost:3000 előnézet; nem indít appot.
 * Későbbi projektfuttatáshoz. A jelen feladatban nem futtatható standalone;
 * az aktuális böngészős bizonyíték browser-client/node_repl útján készül.
 */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

assert.ok(process.argv[2], 'Add meg a meglévő Playwright modul útját.')
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href)
const output = process.argv[3]
if (output) await mkdir(output, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  // Külön böngésző: nem változtatjuk a független validátor nyitott lapját.
  const page = await browser.newPage()
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === 'http://localhost:3000' &&
    route.request().method() === 'GET'
      ? route.continue()
      : route.abort(),
  )
  for (const reducedMotion of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion })
    for (const [width, height] of [
      [320, 568],
      [320, 667],
      [360, 640],
      [390, 844],
      [1280, 720],
      [1440, 900],
    ]) {
      await page.setViewportSize({ width, height })
      await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' })
      const necessary = page.getByRole('button', { name: 'Csak a szükségeseket', exact: true })
      if (await necessary.count()) {
        await necessary.focus()
        await necessary.press('Enter')
        await necessary.waitFor({ state: 'hidden' })
      }
      await page.evaluate(async () => {
        await document.fonts.ready
        scrollTo(0, 0)
      })
      await page.waitForTimeout(300)
      const layout = await page.locator('.kc-film-hero').evaluate((hero) => {
        const rect = (selector) => hero.querySelector(selector).getBoundingClientRect().toJSON()
        const stage = hero.querySelector('.scroll-scrub__stage')
        const media = hero.querySelector('.scroll-scrub__media')
        return {
          stage: rect('.scroll-scrub__stage'),
          pin: rect('.scroll-scrub__chapter-pin'),
          title: rect('.scroll-scrub__title'),
          titleSize: getComputedStyle(hero.querySelector('.scroll-scrub__title')).fontSize,
          bodySize: getComputedStyle(hero.querySelector('.scroll-scrub__body')).fontSize,
          media: media.getBoundingClientRect().toJSON(),
          mediaTransform: getComputedStyle(media).transform,
          veil: getComputedStyle(stage, '::before').backgroundImage,
          veilColor: getComputedStyle(stage, '::before').backgroundColor,
          scrim: getComputedStyle(stage, '::after').backgroundImage,
          headerBottom: document.querySelector('header').getBoundingClientRect().bottom,
          overflow: document.documentElement.scrollWidth > innerWidth,
          ctas: [...hero.querySelectorAll('.kc-film-hero__cta')].map((cta) => ({
            text: cta.textContent,
            href: cta.getAttribute('href'),
            ...cta.getBoundingClientRect().toJSON(),
          })),
        }
      })
      console.log(JSON.stringify({ width, height, reducedMotion, ...layout }))
      assert.equal(layout.overflow, false)
      assert.equal(layout.stage.height, height)
      assert.equal(layout.ctas.length, 2, 'Az ellenőrzött CMS-állapot két hero CTA-t tartalmaz.')
      assert.ok(layout.title.top >= layout.headerBottom, 'A cím nem kerülhet a fejléc mögé.')
      for (const cta of layout.ctas) {
        assert.ok(cta.width >= 44 && cta.height >= 44)
        assert.ok(cta.left >= 0 && cta.right <= width)
        assert.ok(cta.top >= layout.headerBottom)
        assert.ok(cta.bottom <= height - 6, `${cta.text}: alj=${cta.bottom}, viewport=${height}`)
      }
      const ctas = page.locator('.kc-film-hero__cta')
      await ctas.first().focus()
      await page.keyboard.press('Tab')
      assert.equal(await ctas.last().evaluate((cta) => document.activeElement === cta), true)
      assert.equal(
        await page.evaluate(() => scrollY),
        0,
        'A CTA fókusza nem görgetheti el a filmet.',
      )
      if (output) {
        await page.screenshot({
          path: path.join(output, `hero-${width}x${height}-${reducedMotion}.png`),
        })
      }
      console.log(
        `PASS ${width}x${height} ${reducedMotion}: both CTA targets and focus in viewport`,
      )
    }
  }
} finally {
  await browser.close()
}
