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
/** Az első ALMENÜS főmenüpont és a linkje (WP36 óta az első menüpont a „Kurzusok", almenü nélkül). */
const SUBMENU_ITEM = '.kc-nav-desktop__item:has(.kc-nav-desktop__toggle)'
const SUBMENU_ITEM_LINK = `${SUBMENU_ITEM} > .kc-nav-desktop__link`
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
            // Az „olcsó dolgok itt" az ÉLŐ Payload-menü extra gyereke
            // (/akcios-kurzus), nem a seed terve. A fixture szándékosan
            // megtartja, hogy a túlcsordulás/fiók extra CMS-ponttal is mérhető.
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

// Alapból a telepített Chrome-csatorna; ahol csak Playwright-Chromium van
// (pl. konténer), a KC_BROWSER_EXECUTABLE útvonala indul.
const executablePath = process.env.KC_BROWSER_EXECUTABLE
const browser = await chromium.launch(
  executablePath
    ? { executablePath, headless: true, args: ['--no-sandbox'] }
    : { channel: 'chrome', headless: true },
)
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
          // A sáv (konténer) jobb széle: a gyerekeknek EZEN belül kell
          // maradniuk, nem csak a nézetablakon — 1024 px-en az akciósáv a
          // konténert 27, a nézetablakot 3 px-szel lépte túl (WP8, mérve).
          barRight: bar.getBoundingClientRect().right,
          // A sáv hamburgerének dokumentált optikai túlnyúlása a jobb margóba
          // (layout.css `--kc-hamburger-overhang`, WP9): a 44 px-es
          // célfelület ennyivel lóghat a konténeren túl, az ikon nem.
          hamburgerOverhang: (() => {
            const toggle = document.querySelector('.kc-site-header__actions .kc-nav-mobile__toggle')
            if (!toggle || getComputedStyle(toggle).display === 'none') return 0
            // A negatív végmargó px-ben feloldva (a tokenérték rem).
            return Math.max(0, -parseFloat(getComputedStyle(toggle).marginInlineEnd)) || 0
          })(),
          hamburgerIconRight: (() => {
            const icon = document.querySelector(
              '.kc-site-header__actions .kc-nav-mobile__toggle svg',
            )
            if (!icon || icon.getClientRects().length === 0) return 0
            return icon.getBoundingClientRect().right
          })(),
          // A menülinkek a saját nav-dobozukon belül: egy zsugorodó nav
          // (min-width: 0) a linkeket az akciósáv ALÁ csúsztatná — a dobozok
          // rendben látszanának, a felirat mégis átfedne.
          navOverflow: (() => {
            const nav = document.querySelector('.kc-nav-desktop')
            if (!nav || getComputedStyle(nav).display === 'none') return 0
            const navRight = nav.getBoundingClientRect().right
            return Math.max(
              0,
              ...[...nav.querySelectorAll('.kc-nav-desktop__link, .kc-nav-desktop__toggle')].map(
                (el) => el.getBoundingClientRect().right - navRight,
              ),
            )
          })(),
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
        assert.ok(geometry.navOverflow <= 0.5, `menu links overflow the nav at ${width}`)
        assert.equal(geometry.desktop, width >= 900)
        assert.equal(geometry.account, geometry.desktop)
        assert.equal(geometry.mobile, !geometry.desktop)
        for (const [index, box] of geometry.boxes.entries()) {
          assert.ok(box.left >= 0 && box.right <= width, 'header child outside viewport')
          // Minden szélességen a konténeren belül; a kompakt sávon a
          // hamburger célfelülete a dokumentált 8 px-es optikai túlnyúlással
          // lóghat a margóba (WP9: 320 px-en korábban 21 px volt a túllépés).
          const allowance = geometry.desktop ? 0 : geometry.hamburgerOverhang
          assert.ok(
            box.right <= geometry.barRight + allowance + 0.5,
            `header child outside the bar at ${width}: right=${box.right}, bar=${geometry.barRight}, allowance=${allowance}`,
          )
          if (index)
            assert.ok(box.left >= geometry.boxes[index - 1].right, 'overlapping header children')
        }
        if (geometry.mobile) {
          assert.ok(
            geometry.hamburgerOverhang >= 8 && geometry.hamburgerOverhang <= 8.5,
            `hamburger overhang at ${width}: ${geometry.hamburgerOverhang}`,
          )
          // Az IKON a konténeren belül marad, csak az üres gyűrű nyúlik ki.
          assert.ok(
            geometry.hamburgerIconRight <= geometry.barRight + 0.5,
            `hamburger icon outside the bar at ${width}: ${geometry.hamburgerIconRight} > ${geometry.barRight}`,
          )
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
        // WP36: az első főmenüpont a „Kurzusok" (almenü nélkül); az almenüt az
        // első ALMENÜS menüpont fókusza nyitja.
        await page.locator(SUBMENU_ITEM_LINK).first().focus()
      }
      const campaign = nav.getByRole('link', { name: 'olcsó dolgok itt', exact: true })
      await campaign.waitFor({ state: 'visible' })
      assert.equal(await campaign.getAttribute('href'), '/akcios-kurzus')
      assert.equal(await campaign.getAttribute('aria-current'), 'page')
      assert.equal(await page.getByRole('link', { name: 'Időpontkérés', exact: true }).count(), 0)
      // WP10 (2026-09-07, tulajdonosi döntés): a fejlécben és a fiókban NINCS
      // külön „Időpontfoglalás” belépő; a /kapcsolat#idopontkeres célra a
      // keretből egyetlen út sem vezet, a „Kapcsolat” menüpont fedi.
      // NN/g Menu-Design Checklist: https://www.nngroup.com/articles/menu-design/
      assert.equal(
        await page.locator('.kc-site-header a', { hasText: 'Időpontfoglalás' }).count(),
        0,
        `Időpontfoglalás link in the header at ${width}`,
      )
      assert.equal(
        await page.locator('.kc-site-header a[href*="idopontkeres"]').count(),
        0,
        `idopontkeres link in the header at ${width}`,
      )
      if (geometry.mobile) {
        assert.ok(
          await nav
            .getByRole('link', { name: signedIn ? 'Kurzusaim' : 'Belépés', exact: true })
            .isVisible(),
        )
        if (signedIn)
          assert.ok(
            await nav.getByRole('button', { name: 'Kijelentkezés', exact: true }).isVisible(),
          )
      }
      if (geometry.mobile) {
        // FÓKUSZCSAPDA (WP9): az utolsó fiókelemről a Tab az elsőre (bezáró
        // gomb), az elsőről a Shift+Tab az utolsóra lép; a fókusz nem kerül
        // az overlay alá (WCAG 2.2 SC 2.4.11; APG modális párbeszéd).
        // Kijelentkezve az utolsó fiókelem a CMS-lista utolsó látható linkje;
        // bejelentkezve (WP31) a fiók alján álló Kijelentkezés gomb.
        const drawerLast = signedIn
          ? page.locator('.kc-nav-mobile__drawer .kc-account-nav__signout:visible').last()
          : page.locator('.kc-nav-mobile__drawer a[href]:visible').last()
        assert.ok(
          await drawerLast.evaluate(
            (el) => !!el.closest('.kc-nav-mobile__list') || !!el.closest('.kc-account-nav--exit'),
          ),
          `last drawer tabbable is a menu link or the sign-out at ${width}`,
        )
        await drawerLast.focus()
        await page.keyboard.press('Tab')
        assert.ok(
          await page
            .locator('.kc-nav-mobile__drawer-header button')
            .evaluate((el) => el === document.activeElement),
          `drawer focus trap forward at ${width}`,
        )
        await page.keyboard.press('Shift+Tab')
        assert.ok(
          await drawerLast.evaluate((el) => el === document.activeElement),
          `drawer focus trap backward at ${width}`,
        )
        for (let step = 0; step < 20; step++) {
          await page.keyboard.press('Tab')
          assert.ok(
            await page.evaluate(() => !!document.activeElement.closest('.kc-nav-mobile__drawer')),
            `focus left the open drawer at ${width} (step ${step})`,
          )
        }
      } else {
        // NYILAK a lenyílóban (WP9, APG disclosure navigation opcionális
        // billentyűi): Le nyíl a gombról az első almenüpontra, tovább a
        // következőre, az utolsón marad; Fel nyíl vissza, az elsőről a
        // gombra; End / Home az utolsó / első almenüpontra; Escape után a
        // Le nyíl újranyit és az első pontra lép.
        const toggle = page.locator('.kc-nav-desktop__toggle').first()
        const sublinks = page.locator(SUBMENU_ITEM).first().locator('.kc-nav-desktop__sublink')
        const count = await sublinks.count()
        const focusedIndex = () =>
          sublinks.evaluateAll((els) => els.findIndex((el) => el === document.activeElement))
        await toggle.focus()
        await page.keyboard.press('ArrowDown')
        assert.equal(await focusedIndex(), 0, `ArrowDown from toggle at ${width}`)
        await page.keyboard.press('ArrowDown')
        assert.equal(await focusedIndex(), 1, `ArrowDown to second at ${width}`)
        await page.keyboard.press('End')
        assert.equal(await focusedIndex(), count - 1, `End at ${width}`)
        await page.keyboard.press('ArrowDown')
        assert.equal(await focusedIndex(), count - 1, `ArrowDown stays on last at ${width}`)
        await page.keyboard.press('Home')
        assert.equal(await focusedIndex(), 0, `Home at ${width}`)
        await page.keyboard.press('ArrowUp')
        assert.ok(
          await toggle.evaluate((el) => el === document.activeElement),
          `ArrowUp to toggle at ${width}`,
        )
        await page.keyboard.press('Escape')
        await settle()
        assert.equal(
          await toggle.getAttribute('aria-expanded'),
          'false',
          `Escape closes at ${width}`,
        )
        await page.keyboard.press('ArrowDown')
        await settle()
        assert.equal(
          await toggle.getAttribute('aria-expanded'),
          'true',
          `ArrowDown reopens at ${width}`,
        )
        assert.equal(await focusedIndex(), 0, `ArrowDown after Escape focuses first at ${width}`)
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
    await page.setViewportSize({ width: 899, height: 390 })
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
      await page.setViewportSize({ width: 899, height: 900 })
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
        // A fókuszcsapda (WP9) miatt a Shift+Tab a fiók utolsó elemére lép,
        // nem a hamburgerre; a hamburger fókuszát ezért közvetlenül adjuk.
        await page.locator(target).focus()
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
      await page.setViewportSize({ width: 900, height: 900 })
      await settle()
      await page.waitForFunction(() => document.body.style.overflow === 'auto')
      const expected = target === '#outside-focus' ? target : '.kc-site-header__brand'
      assert.ok(
        await page.locator(expected).evaluate((el) => el === document.activeElement),
        `resize focus: signedIn=${signedIn}, target=${target}`,
      )
      await page.setViewportSize({ width: 899, height: 900 })
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
      SUBMENU_ITEM_LINK,
      '#outside-focus',
      // WP36: a fiók-belépő kijelentkezve link, bejelentkezve menügomb —
      // mindkettő a fiók KÖZVETLEN gyereke (a lenyíló tételei rejtve).
      '.kc-site-header__actions > .kc-account-nav > :is(a, button)',
    ]) {
      await page.setViewportSize({ width: 900, height: 900 })
      await page.mouse.move(0, 899)
      await settle()
      const firstLink = page.locator(SUBMENU_ITEM_LINK).first()
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
      await page.setViewportSize({ width: 899, height: 900 })
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
      await page.setViewportSize({ width: 900, height: 900 })
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
    // WP36: üres CMS-menü mellett is áll a kódban rögzített „Kurzusok" tétel
    // (withCoursesNavItem), tehát a nav létezik, egyetlen linkkel.
    assert.equal(await page.locator('.kc-nav-desktop').count(), 1)
    assert.equal(await page.locator('.kc-nav-desktop__link').count(), 1)
    assert.equal(await page.locator('.kc-nav-desktop__link').getAttribute('href'), '/kurzusok')
    for (const control of ['a', 'outside']) {
      await page.setViewportSize({ width: 900, height: 900 })
      await page.mouse.move(0, 899)
      await settle()
      const target =
        control === 'outside'
          ? '#outside-focus'
          : `.kc-site-header__actions > .kc-account-nav > :is(a, button)`
      await page.locator('.kc-site-header__brand').focus()
      for (let step = 0; step < 20; step++) {
        if (await page.locator(target).evaluate((el) => el === document.activeElement)) break
        await page.keyboard.press('Tab')
      }
      assert.ok(await page.locator(target).evaluate((el) => el === document.activeElement))
      await page.setViewportSize({ width: 899, height: 900 })
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
      await page.setViewportSize({ width: 900, height: 900 })
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
      assert.equal(await page.locator('.kc-nav-desktop__link').count(), 1)
      console.log(`PASS empty-menu both directions ${signedIn}: ${control}`)
    }
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(failures, [])
  console.log(
    'PASS: responsive geometry, hamburger overhang, drawer focus trap, submenu arrow keys, account access, exact campaign label/current state, Escape and resize cleanup',
  )
} finally {
  await browser.close()
}
