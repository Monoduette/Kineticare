/**
 * Izolált böngészős ellenőrzés, Next/Payload szerver és hálózat nélkül.
 * Node 24: node <ez-a-fájl> <telepített-playwright/index.mjs> [képmappa]
 * A Playwright a meglévő eszköz-runtime-ból jön, nem új projektfüggőség.
 */
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

import { build } from 'esbuild'
import sharp from 'sharp'

const root = fileURLToPath(new URL('../../', import.meta.url))
assert.ok(process.argv[2], 'Add meg a meglévő Playwright modul útját.')
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href)
const output = process.argv[3]
if (output) await mkdir(output, { recursive: true })

async function media(file, alt) {
  const bytes = await readFile(path.join(root, file))
  const { width, height, format } = await sharp(bytes).metadata()
  return {
    id: 1,
    url: `data:image/${format};base64,${bytes.toString('base64')}`,
    alt,
    width,
    height,
  }
}

const photos = {
  about: await media('content/home-images/site/katak-team.jpg', 'Kiss Kata és Kocsis Kata'),
  kocsis: await media(
    'src/scripts/legacy-content/kepek/67b3c6e9e315f_KocsisKatakozeli.png',
    'Kocsis Kata',
  ),
  kiss: await media(
    'src/scripts/legacy-content/kepek/67c07def59ac2_KissKataelegans.png',
    'Kiss Kata',
  ),
}
const logos = []
for (const name of ['noklapja', 'kepmas', 'mgyft', 'ispor', 'karc', 'hazipatika']) {
  logos.push(await media(`content/home-images/site/press-${name}.png`, name))
}

let styles = ''
for (const file of [
  'tokens',
  'fonts',
  'base',
  'ui',
  'blocks/about',
  'blocks/team-members',
  'blocks/press-logos',
]) {
  styles += await readFile(path.join(root, `src/app/(frontend)/styles/${file}.css`), 'utf8')
}
for (const match of [...styles.matchAll(/url\('([^']+\.woff2)'\)/g)]) {
  const font = await readFile(path.join(root, 'public', match[1]))
  styles = styles.replace(match[0], `url('data:font/woff2;base64,${font.toString('base64')}')`)
}

const bundle = await build({
  stdin: {
    contents: `
      import React from 'react'
      import { createRoot } from 'react-dom/client'
      import { flushSync } from 'react-dom'
      import { About } from './src/components/blocks/About'
      import { TeamMembers } from './src/components/blocks/TeamMembers'
      import { PressLogos } from './src/components/blocks/PressLogos'
      const root = createRoot(document.getElementById('root'))
      const photos = ${JSON.stringify(photos)}
      const logos = ${JSON.stringify(logos)}
      window.renderOwner = (options = {}) => {
        const text = 'Gyógytornászok vagyunk. Megmutatjuk a gyakorlatokat, és segítünk eligazodni a lehetőségek között.'
        const paragraphs = [{ text: options.long ? text.repeat(12) : text }]
        flushSync(() => root.render(<main key={JSON.stringify(options)}>
          <About block={{ blockType: 'about', id: 'about-fixture', title: 'Kiss Kata és Kocsis Kata vagyunk',
            paragraphs, photo: options.noPhoto ? undefined : photos.about,
            stats: options.stats ? [{ value: '12', label: 'kreditpont' }, { value: '2', label: 'alapító' }] : [],
            sectionSettings: { hatter: options.dark ? 'sotet' : 'tint' } }} />
          <TeamMembers block={{ blockType: 'teamMembers', id: 'team-fixture', title: 'Szakmai hátterünk',
            sectionSettings: { hatter: options.dark ? 'sotet' : 'feher' },
            members: [
              { name: 'Kocsis Kata', photo: photos.kocsis, role: 'Gyógytornász', bio: text, phone: '+36 30 123 4567',
                cvSections: [{ heading: 'Tanulmányok', items: 'Gyógytornász képzés' }] },
              { name: 'Kiss Kata', photo: photos.kiss, role: 'Gyógytornász, manuálterapeuta', bio: text,
                cvSections: [{ heading: 'Tanulmányok', items: 'Gyógytornász képzés' }] },
            ].slice(0, options.single ? 1 : 2) }} />
          <PressLogos block={{ blockType: 'pressLogos', id: 'press-fixture',
            sectionSettings: { hatter: options.dark ? 'sotet' : 'feher' },
            logos: Array.from({ length: options.count ?? 12 }, (_, i) => ({
              image: logos[i % logos.length], alt: 'Partner ' + (i + 1), url: '/partner-' + i,
            })) }} />
        </main>))
      }
      window.renderOwner()
    `,
    resolveDir: root,
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  platform: 'browser',
  loader: { '.css': 'empty' },
  // A Next saját CJS-exportjait használjuk; csak a bundler-interop adapter.
  plugins: [
    {
      name: 'next-exports',
      setup(builder) {
        builder.onResolve({ filter: /^next\/(image|link)$/ }, (args) => ({
          path: args.path,
          namespace: 'next-exports',
        }))
        builder.onLoad({ filter: /.*/, namespace: 'next-exports' }, (args) => {
          const image = args.path === 'next/image'
          const entry = path.join(
            root,
            'node_modules/next/dist/client',
            image ? 'image-component.js' : 'link.js',
          )
          return {
            contents: `const next = require(${JSON.stringify(entry)}); export default next.${image ? 'Image' : 'default'}`,
            resolveDir: root,
          }
        })
      },
    },
  ],
  define: { 'process.env': JSON.stringify({ NODE_ENV: 'production' }) },
})

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ reducedMotion: 'no-preference' })
  const errors = []
  const requests = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  await page.route('**/*', (route) => {
    requests.push(route.request().url())
    return route.abort()
  })
  await page.setContent(
    `<html lang="hu"><head><style>${styles}</style></head><body><div id="root"></div></body></html>`,
  )
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.evaluate(() => document.fonts.ready)

  const render = async (options = {}) => {
    await page.evaluate((value) => window.renderOwner(value), options)
    await page.locator('.kc-about__title').waitFor()
    await page.evaluate(async () => {
      await Promise.all(
        [...document.images].map((img) => {
          img.loading = 'eager'
          return img.decode()
        }),
      )
    })
  }

  for (const width of [320, 390, 768, 900, 1024, 1440, 2560]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const options of [
      {},
      { stats: true, long: true },
      { noPhoto: true },
      { single: true, dark: true },
    ]) {
      await render(options)
      const geometry = await page.evaluate(() => {
        const section = document.querySelector('.kc-about')
        const grid = document.querySelector('.kc-about__grid')
        const figure = document.querySelector('.kc-about__figure')
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          gridWidth: grid.getBoundingClientRect().width,
          photoWidth: figure?.getBoundingClientRect().width ?? 0,
          minHeight: getComputedStyle(section).minHeight,
          portraits: [...document.querySelectorAll('.kc-team__figure img')].map((img) => ({
            width: img.getBoundingClientRect().width,
            fit: getComputedStyle(img).objectFit,
            loaded: img.naturalWidth > 0,
          })),
        }
      })
      assert.equal(geometry.overflow, false, `reflow ${width}: ${JSON.stringify(options)}`)
      assert.equal(geometry.columns, width >= 900 && !options.noPhoto ? 2 : 1)
      assert.equal(geometry.minHeight, '0px')
      if (width >= 900) assert.ok(geometry.photoWidth <= geometry.gridWidth / 2)
      for (const portrait of geometry.portraits) {
        assert.ok(portrait.width <= 288.1)
        assert.equal(portrait.fit, 'contain')
        assert.equal(portrait.loaded, true)
      }
    }
    console.log(
      `PASS layout ${width}px: paired/no-photo/stats/long/single/dark; portraits <=288px, contain`,
    )
    if (output && [390, 1440].includes(width)) {
      await render()
      await page.screenshot({ path: path.join(output, `owner-${width}.png`), fullPage: true })
    }
  }

  await page.setViewportSize({ width: 390, height: 900 })
  await render()
  const button = page.locator('.kc-press__control')
  const viewport = page.locator('.kc-press__viewport')
  const position = () => viewport.evaluate((element) => element.scrollLeft)
  assert.equal(await page.locator('.kc-press__item').count(), 12)
  assert.equal(await page.locator('.kc-press__link').count(), 12)
  assert.equal(await page.locator('.kc-press__rail').getAttribute('data-motion'), 'static')
  const target = await button.boundingBox()
  assert.ok(target.width >= 44 && target.height >= 44)
  await button.click()
  await page.waitForFunction(() => document.querySelector('.kc-press__viewport').scrollLeft > 5)
  await button.click()
  const paused = await position()
  await page.waitForTimeout(200)
  assert.ok(Math.abs((await position()) - paused) <= 1)
  console.log('PASS opt-in play / explicit pause; >=44px control; one original list')

  await button.click()
  await page.locator('.kc-press__link').last().focus()
  assert.equal(await button.getAttribute('aria-label'), 'Elindítom a logósort')
  const lastVisible = await page
    .locator('.kc-press__link')
    .last()
    .evaluate((link) => {
      const box = link.getBoundingClientRect()
      const frame = link.closest('.kc-press__viewport').getBoundingClientRect()
      return box.left >= frame.left && box.right <= frame.right
    })
  assert.equal(lastVisible, true)
  await button.focus()
  await page.waitForTimeout(100)
  assert.equal(await button.getAttribute('aria-label'), 'Elindítom a logósort')
  await button.press('Space')
  await page.waitForFunction(() => document.querySelector('.kc-press__viewport').scrollLeft > 5)
  await viewport.hover()
  assert.equal(await button.getAttribute('aria-label'), 'Elindítom a logósort')
  console.log('PASS keyboard activation, focus stops motion, last link visible, hover pause')

  await button.click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForFunction(
    () => document.querySelector('.kc-press__rail').dataset.motion === 'static',
  )
  assert.equal(await page.locator('.kc-press__control').count(), 0)
  assert.equal(await page.locator('.kc-press__link').count(), 12)
  const complete = await page.locator('.kc-press__row').evaluate((list) =>
    [...list.children].every((item) => {
      const rect = item.getBoundingClientRect()
      return rect.left >= 0 && rect.right <= innerWidth && rect.width > 0
    }),
  )
  assert.equal(complete, true)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await button.waitFor()
  assert.equal(await page.locator('.kc-press__rail').getAttribute('data-motion'), 'static')
  console.log('PASS live reduced-motion change: complete static list, no implicit restart')

  await render({ count: 1 })
  assert.equal(await page.locator('.kc-press__control').count(), 0)
  await render({ count: 0 })
  assert.equal(await page.locator('.kc-press').count(), 0)
  await render()
  await button.click()
  await button.click()
  await viewport.evaluate((element) => {
    element.scrollLeft = element.scrollWidth - element.clientWidth - 10
  })
  await button.click()
  await page.waitForFunction(
    () =>
      document.querySelector('.kc-press__control').getAttribute('aria-label') ===
      'Elindítom a logósort',
  )
  const end = await viewport.evaluate((element) => element.scrollWidth - element.clientWidth)
  assert.ok(Math.abs((await position()) - end) <= 1)
  console.log('PASS empty/single logo; finite traversal stops at end')

  await render()
  await page.clock.install()
  await button.click()
  await page.clock.runFor(61_000)
  assert.equal(await button.getAttribute('aria-label'), 'Elindítom a logósort')
  console.log('PASS 60-second bound')
  assert.deepEqual(errors, [])
  assert.deepEqual(requests, [])
  console.log('PASS no page errors, no network requests; offline component verification complete')
} finally {
  await browser.close()
}
