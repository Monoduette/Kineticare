/**
 * A valódi Header hálózatmentes tesztje, Next/Payload szerver és hitelesítő adatok nélkül.
 * Node 24: node <ez-a-fájl> <meglévő-playwright/index.mjs> [képernyőkép-könyvtár]
 */
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
assert.ok(process.argv[2], 'Pass the existing Playwright module path.')
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href)
const output = process.argv[3]
if (output) await mkdir(output, { recursive: true })

let styles = ''
for (const file of ['tokens', 'fonts', 'base', 'ui', 'layout']) {
  styles += await readFile(path.join(root, `src/app/(frontend)/styles/${file}.css`), 'utf8')
}
for (const match of [...styles.matchAll(/url\('([^']+\.woff2)'\)/g)]) {
  const bytes = await readFile(path.join(root, 'public', match[1]))
  styles = styles.replace(match[0], `url('data:font/woff2;base64,${bytes.toString('base64')}')`)
}

const bundle = await build({
  stdin: {
    contents: `
      import React from 'react'
      import { createRoot } from 'react-dom/client'
      import { Header } from './src/components/layout/Header'
      const root = createRoot(document.getElementById('root'))
      window.renderHeader = async (signedIn, emptyMenu = false) => {
        window.fixtureSignedIn = signedIn
        window.fixtureEmptyMenu = emptyMenu
        root.render(<React.Fragment key={String(signedIn) + String(emptyMenu)}>{await Header()}</React.Fragment>)
      }
    `,
    loader: 'tsx',
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  platform: 'browser',
  plugins: [
    {
      name: 'isolated-header-inputs',
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /^(next\/navigation|next\/link)$|\/(menus|header-user|HeaderScrollFx|BarionSessionSignUp)$/,
          },
          (args) => ({
            path: args.path,
            namespace: 'fixture',
          }),
        )
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => {
          let contents
          if (args.path === 'next/navigation') {
            contents = `export const usePathname = () => '/akcios-kurzus'`
          } else if (args.path === 'next/link') {
            contents = `const next = require(${JSON.stringify(path.join(root, 'node_modules/next/dist/client/link.js'))}); export default next.default`
          } else if (args.path.endsWith('/header-user')) {
            contents = `export const getHeaderAuthState = async () => ({signedIn: window.fixtureSignedIn})`
          } else if (args.path.endsWith('/menus')) {
            contents = `
            const item = (id, label, href, children = []) => ({id, label, href, children, isExternal: false, openInNewTab: false})
            export const getNavTree = async () => window.fixtureEmptyMenu ? [] : [
              item(1, 'Szolgáltatások', '/szolgaltatasok', [
                item(4, 'Rendelői kezelések', '/kezelesek'), item(5, 'Szakmai képzés', '/szakmai-kepzesek'),
                item(6, 'SOS KézRelax', '/kurzusok/sos'), item(8, 'olcsó dolgok itt', '/akcios-kurzus')
              ]),
              item(2, 'Rólunk', '/rolunk'), item(7, 'Tudástár', '/blog'), item(3, 'Kapcsolat', '/kapcsolat')
            ]`
          } else {
            contents = `export const ${args.path.split('/').at(-1)} = () => null`
          }
          return { contents, resolveDir: root }
        })
      },
    },
  ],
  define: { 'process.env': JSON.stringify({ NODE_ENV: 'production' }) },
})

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' })
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*', (route) => route.abort())
  await page.setContent(
    `<html lang="hu"><head><style>${styles}</style></head><body><div id="root"></div></body></html>`,
  )
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  // A tesztlinkek nem hagyhatják el az izolált dokumentumot; a React-kezelők lefutnak.
  await page.evaluate(() =>
    document.addEventListener('click', (event) => {
      if (event.target.closest('a')) event.preventDefault()
    }),
  )

  const failures = []
  const settle = () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
  for (const signedIn of [true, false]) {
    await page.evaluate((value) => window.renderHeader(value), signedIn)
    await page.locator('.kc-site-header').waitFor()
    await page.evaluate(() => document.fonts.ready)
    for (const width of [320, 390, 640, 768, 899, 900, 1024, 1100, 1199, 1200, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await settle()
      await page.evaluate(() => document.fonts.ready)
      const geometry = await page.evaluate(() => {
        const bar = document.querySelector('.kc-site-header__bar')
        const selectors = ['.kc-site-header__brand', '.kc-nav-desktop', '.kc-site-header__actions']
        const boxes = selectors
          .map((selector) => document.querySelector(selector))
          .filter((el) => el && getComputedStyle(el).display !== 'none')
          .map((el) => {
            const b = el.getBoundingClientRect()
            return { left: b.left, right: b.right }
          })
        return {
          scroll: document.documentElement.scrollWidth,
          width: document.documentElement.clientWidth,
          height: bar.getBoundingClientRect().height,
          boxes,
          desktop: getComputedStyle(document.querySelector('.kc-nav-desktop')).display !== 'none',
          account:
            getComputedStyle(document.querySelector('.kc-site-header__actions > .kc-account-nav'))
              .display !== 'none',
          mobile: getComputedStyle(document.querySelector('.kc-nav-mobile')).display !== 'none',
        }
      })
      console.log(JSON.stringify({ signedIn, width, ...geometry }))
      if (output && [320, 900, 1024, 1200, 1440].includes(width)) {
        await page.screenshot({
          path: path.join(output, `header-${signedIn ? 'in' : 'out'}-${width}.png`),
        })
      }
      try {
        assert.equal(geometry.scroll, geometry.width, `overflow at ${width}, signedIn=${signedIn}`)
        assert.equal(geometry.desktop, width >= 1200)
        assert.equal(geometry.account, geometry.desktop)
        assert.equal(geometry.mobile, !geometry.desktop)
        for (const [index, box] of geometry.boxes.entries()) {
          assert.ok(box.left >= 0 && box.right <= width, 'header child outside viewport')
          if (index)
            assert.ok(box.left >= geometry.boxes[index - 1].right, 'overlapping header children')
        }
      } catch (error) {
        failures.push(error.message)
      }
      const nav = page.locator(geometry.mobile ? '.kc-nav-mobile__drawer' : '.kc-nav-desktop')
      if (geometry.mobile) {
        await page.locator('.kc-nav-mobile > button').click()
        await page.waitForFunction(
          () => document.querySelector('.kc-nav-mobile__drawer').dataset.open === 'true',
        )
      } else {
        await page.locator('.kc-site-header__brand').focus()
        await page.locator('.kc-nav-desktop__link').first().focus()
      }
      const campaign = nav.getByRole('link', { name: 'olcsó dolgok itt', exact: true })
      await campaign.waitFor({ state: 'visible' })
      assert.equal(await campaign.getAttribute('href'), '/akcios-kurzus')
      assert.equal(await campaign.getAttribute('aria-current'), 'page')
      const appointmentNav = nav.getByRole('link', { name: 'Időpontkérés', exact: true }).first()
      await appointmentNav.waitFor({ state: 'visible' })
      assert.equal(await appointmentNav.getAttribute('href'), '/kapcsolat#idopontkeres')
      assert.equal(await appointmentNav.getAttribute('aria-current'), null)
      if (geometry.mobile) {
        const drawerCta = page.locator('.kc-site-header__drawer-appointment')
        await drawerCta.waitFor({ state: 'visible' })
        assert.equal(await drawerCta.textContent(), 'Időpontkérés')
        assert.equal(await drawerCta.getAttribute('href'), '/kapcsolat#idopontkeres')
        assert.equal(
          await page.locator('.kc-site-header__appointment-cta').evaluate((el) => {
            return getComputedStyle(el).display === 'none'
          }),
          true,
        )
        assert.ok(
          await nav
            .getByRole('link', { name: signedIn ? 'Kurzusaim' : 'Belépés', exact: true })
            .isVisible(),
        )
        if (signedIn)
          assert.ok(
            await nav.getByRole('button', { name: 'Kijelentkezés', exact: true }).isVisible(),
          )
      } else {
        const barCta = page.locator('.kc-site-header__appointment-cta')
        await barCta.waitFor({ state: 'visible' })
        assert.equal(await barCta.textContent(), 'Időpontkérés')
        assert.equal(await barCta.getAttribute('href'), '/kapcsolat#idopontkeres')
        assert.equal(await barCta.getAttribute('aria-current'), null)
      }
      await campaign.focus()
      await campaign.scrollIntoViewIfNeeded()
      const linkBox = await campaign.boundingBox()
      assert.ok(linkBox && linkBox.x >= 0 && linkBox.x + linkBox.width <= width)
      assert.ok(linkBox.height >= 44 && linkBox.y >= 0 && linkBox.y + linkBox.height <= 900)
      if (output && [320, 900, 1024, 1200, 1440].includes(width)) {
        await page.screenshot({
          path: path.join(output, `menu-${signedIn ? 'in' : 'out'}-${width}.png`),
        })
      }
      await page.keyboard.press('Escape')
      await settle()
      if (geometry.mobile) {
        assert.equal(
          await page.locator('.kc-nav-mobile > button').getAttribute('aria-expanded'),
          'false',
        )
        assert.ok(
          await page
            .locator('.kc-nav-mobile > button')
            .evaluate((el) => el === document.activeElement),
        )
      }
    }
    await page.setViewportSize({ width: 900, height: 390 })
    await settle()
    await page.evaluate(() =>
      document.documentElement.style.setProperty('--kc-consent-offset', '144px'),
    )
    await page.locator('.kc-nav-mobile > button').click()
    const campaign = page
      .locator('.kc-nav-mobile__drawer')
      .getByRole('link', { name: 'olcsó dolgok itt', exact: true })
    await campaign.focus()
    await campaign.scrollIntoViewIfNeeded()
    const box = await campaign.boundingBox()
    assert.ok(
      box && box.y >= 0 && box.y + box.height <= 390 - 144,
      'campaign reachable above consent offset',
    )
    await campaign.press('Enter')
    await page.waitForFunction(
      () =>
        document.querySelector('.kc-nav-mobile > button').getAttribute('aria-expanded') === 'false',
    )
    assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden')
    await page.evaluate(() => document.documentElement.style.removeProperty('--kc-consent-offset'))
  }
  assert.deepEqual(failures, [])
  // A CSS a matchMedia előtt törölheti az activeElementet. A fókusz célját is
  // ellenőrizzük a lezárás mellett; a más vezérlőre vitt fókuszt nem vesszük el.
  await page.evaluate(() => {
    const button = document.createElement('button')
    button.id = 'outside-focus'
    button.textContent = 'Outside fixture control'
    document.body.append(button)
  })
  for (const signedIn of [true, false]) {
    await page.evaluate((value) => window.renderHeader(value), signedIn)
    await settle()
    for (const target of [
      '.kc-nav-mobile > button',
      '.kc-nav-mobile__drawer-header button',
      '.kc-nav-mobile__sublink',
      '.kc-account-nav--drawer a',
      '#outside-focus',
    ]) {
      await page.setViewportSize({ width: 1199, height: 900 })
      await settle()
      await page.evaluate(() => {
        document.body.style.overflow = 'auto'
      })
      await page.locator('.kc-nav-mobile > button').click()
      await page.waitForFunction(() => document.body.style.overflow === 'hidden')
      await page.locator(target).first().waitFor({ state: 'visible' })
      if (target === '.kc-nav-mobile > button') {
        const closeButton = page.locator('.kc-nav-mobile__drawer-header button')
        await closeButton.waitFor({ state: 'visible' })
        await closeButton.focus()
        assert.ok(await closeButton.evaluate((el) => el === document.activeElement))
        await page.keyboard.press('Shift+Tab')
      } else {
        await page.locator(target).first().focus()
      }
      assert.ok(
        await page
          .locator(target)
          .first()
          .evaluate((el) => el === document.activeElement),
        'pre-resize focus established',
      )
      await page.setViewportSize({ width: 1200, height: 900 })
      await settle()
      await page.waitForFunction(() => document.body.style.overflow === 'auto')
      const expected = target === '#outside-focus' ? target : '.kc-site-header__brand'
      assert.ok(
        await page.locator(expected).evaluate((el) => el === document.activeElement),
        `resize focus: signedIn=${signedIn}, target=${target}`,
      )
      await page.setViewportSize({ width: 1199, height: 900 })
      await settle()
      assert.equal(
        await page.locator('.kc-nav-mobile > button').getAttribute('aria-expanded'),
        'false',
      )
      assert.ok(await page.locator(expected).evaluate((el) => el === document.activeElement))
      console.log(`PASS resize focus ${signedIn}: ${target} -> ${expected}; reverse stays closed`)
    }
  }
  // Az ellenkező irányban a rejtett desktop navigáció fókusza és nyitott
  // almenüje sem maradhat hátra; a kívülre vitt fókuszt meg kell őrizni.
  for (const signedIn of [true, false]) {
    await page.evaluate((value) => window.renderHeader(value), signedIn)
    await settle()
    for (const target of [
      '.kc-nav-desktop__sublink',
      '.kc-nav-desktop__toggle',
      '.kc-nav-desktop__link',
      '#outside-focus',
      '.kc-site-header__actions > .kc-account-nav a',
      ...(signedIn ? ['.kc-site-header__actions > .kc-account-nav button'] : []),
    ]) {
      await page.setViewportSize({ width: 1200, height: 900 })
      await page.mouse.move(0, 899)
      await settle()
      const firstLink = page.locator('.kc-nav-desktop__link').first()
      await firstLink.focus()
      await page.locator(target).first().waitFor({ state: 'visible' })
      const accountTarget = target.includes('.kc-account-nav')
      if (accountTarget) {
        // A fiókvezérlőket csak Tab-bal érjük el, aktiválás és fiókművelet nélkül.
        for (let step = 0; step < 20; step++) {
          if (
            await page
              .locator(target)
              .first()
              .evaluate((el) => el === document.activeElement)
          )
            break
          await page.keyboard.press('Tab')
        }
      } else {
        await page.locator(target).first().focus()
      }
      if (target === '#outside-focus') {
        await firstLink.hover()
      }
      assert.ok(
        await page
          .locator(target)
          .first()
          .evaluate((el) => el === document.activeElement),
        `desktop pre-resize focus: ${target}`,
      )
      assert.equal(
        await page.locator('.kc-nav-desktop__toggle').first().getAttribute('aria-expanded'),
        accountTarget ? 'false' : 'true',
      )
      await page.setViewportSize({ width: 1199, height: 900 })
      await settle()
      const expected = target === '#outside-focus' ? target : '.kc-site-header__brand'
      assert.ok(
        await page.locator(expected).evaluate((el) => el === document.activeElement),
        `desktop resize focus: signedIn=${signedIn}, target=${target}`,
      )
      assert.equal(
        await page.locator('.kc-nav-desktop__toggle').first().getAttribute('aria-expanded'),
        'false',
      )
      assert.equal(
        await page.locator('.kc-nav-mobile > button').getAttribute('aria-expanded'),
        'false',
      )
      assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden')
      await page.locator('#outside-focus').focus()
      await page.mouse.move(0, 899)
      await page.setViewportSize({ width: 1200, height: 900 })
      await settle()
      assert.equal(
        await page.locator('.kc-nav-desktop__toggle').first().getAttribute('aria-expanded'),
        'false',
        'desktop submenu must not reopen on widening',
      )
      assert.ok(
        await page.locator('#outside-focus').evaluate((el) => el === document.activeElement),
      )
      console.log(`PASS desktop resize ${signedIn}: ${target} -> ${expected}; submenu stays closed`)
    }
  }
  // A hibás lekérdezés és a látható menüpontok hiánya egyaránt üres fát ad.
  // A fióksáv ettől még megmarad; mindkét váltási irányt külön ellenőrizzük.
  for (const signedIn of [true, false]) {
    await page.evaluate((value) => window.renderHeader(value, true), signedIn)
    await settle()
    assert.equal(await page.locator('.kc-nav-desktop').count(), 0)
    for (const control of ['a', ...(signedIn ? ['button'] : []), 'outside']) {
      await page.setViewportSize({ width: 1200, height: 900 })
      await page.mouse.move(0, 899)
      await settle()
      const target =
        control === 'outside'
          ? '#outside-focus'
          : `.kc-site-header__actions > .kc-account-nav ${control}`
      await page.locator('.kc-site-header__brand').focus()
      for (let step = 0; step < 20; step++) {
        if (await page.locator(target).evaluate((el) => el === document.activeElement)) break
        await page.keyboard.press('Tab')
      }
      assert.ok(await page.locator(target).evaluate((el) => el === document.activeElement))
      await page.setViewportSize({ width: 1199, height: 900 })
      await settle()
      const expected = control === 'outside' ? target : '.kc-site-header__brand'
      assert.ok(
        await page.locator(expected).evaluate((el) => el === document.activeElement),
        `empty-menu desktop focus: signedIn=${signedIn}, control=${control}`,
      )
      await page.locator('.kc-nav-mobile > button').click()
      const drawerTarget = control === 'outside' ? target : `.kc-account-nav--drawer ${control}`
      await page.locator(drawerTarget).waitFor({ state: 'visible' })
      await page.locator(drawerTarget).focus()
      assert.ok(await page.locator(drawerTarget).evaluate((el) => el === document.activeElement))
      await page.setViewportSize({ width: 1200, height: 900 })
      await settle()
      assert.ok(
        await page.locator(expected).evaluate((el) => el === document.activeElement),
        `empty-menu drawer focus: signedIn=${signedIn}, control=${control}`,
      )
      assert.equal(
        await page.locator('.kc-nav-mobile > button').getAttribute('aria-expanded'),
        'false',
      )
      assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden')
      assert.equal(await page.locator('.kc-nav-desktop').count(), 0)
      console.log(`PASS empty-menu both directions ${signedIn}: ${control}`)
    }
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(failures, [])
  console.log(
    'PASS: responsive geometry, account access, exact campaign label/current state, Escape and resize cleanup',
  )
} finally {
  await browser.close()
}
