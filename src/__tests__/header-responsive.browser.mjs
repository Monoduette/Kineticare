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
/**
 * A fejléc hamburgere: a `.kc-nav-mobile` KÖZVETLEN `button` gyereke. 2026-10-16
 * óta natív popover-nyitó (`popovertarget`), React `onClick` nélkül; a régi
 * böngészős `<details>`-tartalék `summary`-ja nem `button`, ezért nem egyezik.
 */
const MOBILE_TOGGLE = '.kc-nav-mobile > button.kc-nav-mobile__toggle'
/** A fiók (`popover="manual"`) és a fejlécében álló bezáró gomb. */
const MOBILE_DRAWER = '#kc-mobile-menu'
const MOBILE_CLOSE = `${MOBILE_DRAWER} button[aria-label="Menü bezárása"]`
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
      import { renderToString } from 'react-dom/server'
      import { Header } from './src/components/layout/Header'
      const root = createRoot(document.getElementById('root'))
      window.renderHeader = async (signedIn, emptyMenu = false) => {
        window.fixtureSignedIn = signedIn
        window.fixtureEmptyMenu = emptyMenu
        root.render(<React.Fragment key={String(signedIn) + String(emptyMenu)}>{await Header()}</React.Fragment>)
      }
      // A szerver-renderelt HTML, ahogy a hidratálás ELŐTT a böngészőbe ér.
      window.renderHeaderHtml = async (signedIn) => {
        window.fixtureSignedIn = signedIn
        window.fixtureEmptyMenu = false
        return renderToString(await Header())
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
            contents = `export const usePathname = () => '/kurzusok/otthoni-kezrehab-program-akcio'`
          } else if (args.path === 'next/link') {
            contents = `const next = require(${JSON.stringify(path.join(root, 'node_modules/next/dist/client/link.js'))}); export default next.default`
          } else if (args.path.endsWith('/header-user')) {
            contents = `export const getHeaderAuthState = async () => ({signedIn: window.fixtureSignedIn})`
          } else if (args.path.endsWith('/menus')) {
            contents = `
            const item = (id, label, href, children = []) => ({id, label, href, children, isExternal: false, openInNewTab: false})
            // Az „olcsó dolgok itt" az ÉLŐ Payload-menü extra gyereke (a WP60
            // óta az akciós kurzus oldalára mutat, a demó /akcios-kurzus route
            // megszűnt), nem a seed terve. A fixture szándékosan megtartja,
            // hogy a túlcsordulás/fiók extra CMS-ponttal is mérhető.
            export const getNavTree = async () => window.fixtureEmptyMenu ? [] : [
              item(1, 'Szolgáltatások', '/szolgaltatasok', [
                item(4, 'Rendelői kezelések', '/kezelesek'), item(5, 'Szakmai képzés', '/szakmai-kepzesek'),
                item(6, 'SOS KézRelax', '/kurzusok/sos'), item(8, 'olcsó dolgok itt', '/kurzusok/otthoni-kezrehab-program-akcio')
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
  // Hálózatmentes: minden kérés elakad, KIVÉVE a márka-logó SVG-jét (WP49), amit
  // a lemezről szolgálunk — enélkül a fejléc <img>-je törött képként mérne.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/assets/brand/') && url.pathname.endsWith('.svg')) {
      const body = await readFile(path.join(root, 'public', url.pathname))
      await route.fulfill({ body, contentType: 'image/svg+xml' })
      return
    }
    await route.abort()
  })
  await page.setContent(
    // A <base> a gyökér-relatív képútvonalakat (a logó SVG-jét) feloldhatóvá
    // teszi az about:blank dokumentumban; a route-kezelő szolgálja ki.
    `<html lang="hu"><head><base href="http://kineticare.test/"><style>${styles}</style></head><body><div id="root"></div></body></html>`,
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
  // A mobil fiók állapota 2026-10-16 óta NATÍV (popover API): nyitva a fiók
  // `:popover-open`, a lap görgetését a CSS zárja (`html:has(...:popover-open)
  // { overflow: hidden }`, nem `body.style.overflow`), a hamburger kibontott
  // állapotát pedig a böngésző maga közli (HTML-AAM: popovertarget →
  // expanded), kézi `aria-expanded` nélkül. Ezt a Chromium akadálymentességi
  // fáján (CDP) mérjük: a Playwright szerepkör-lekérdezése csak az
  // `aria-expanded` attribútumot olvassa, a natív állapotot nem látja.
  const cdp = await page.context().newCDPSession(page)
  const drawerOpen = () =>
    page.evaluate(
      (selector) => document.querySelector(selector).matches(':popover-open'),
      MOBILE_DRAWER,
    )
  const pageScrollLocked = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).overflow === 'hidden')
  const toggleExpanded = async () => {
    const { root: doc } = await cdp.send('DOM.getDocument', { depth: 0 })
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: doc.nodeId,
      selector: MOBILE_TOGGLE,
    })
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', {
      nodeId,
      fetchRelatives: false,
    })
    return nodes[0]?.properties?.find((property) => property.name === 'expanded')?.value.value
  }
  const isFocused = (selector) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => el === document.activeElement)
  const waitDrawerClosed = () =>
    page.waitForFunction(
      (selector) => !document.querySelector(selector).matches(':popover-open'),
      MOBILE_DRAWER,
    )
  const openDrawer = async () => {
    await page.locator(MOBILE_TOGGLE).click()
    await page.waitForFunction(
      (selector) => document.querySelector(selector).matches(':popover-open'),
      MOBILE_DRAWER,
    )
  }
  /** Nyitott/zárt állapot a három megfigyelhető jel szerint (a hamburger látható szélességen). */
  const assertDrawerState = async (open, label) => {
    assert.equal(await drawerOpen(), open, `drawer :popover-open ${label}`)
    assert.equal(await pageScrollLocked(), open, `html overflow hidden ${label}`)
    assert.equal(await toggleExpanded(), open, `hamburger native expanded ${label}`)
  }
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
          // A hamburger célfelülete legalább 44×44 px (layout.css, WCAG 2.2 SC
          // 2.5.8; Apple HIG Layout).
          hamburgerSize: (() => {
            const toggle = document.querySelector('.kc-site-header__actions .kc-nav-mobile__toggle')
            if (!toggle || getComputedStyle(toggle).display === 'none') return null
            const b = toggle.getBoundingClientRect()
            return { width: b.width, height: b.height }
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
          assert.ok(
            geometry.hamburgerSize &&
              geometry.hamburgerSize.width >= 44 &&
              geometry.hamburgerSize.height >= 44,
            `hamburger target below 44x44 at ${width}: ${JSON.stringify(geometry.hamburgerSize)}`,
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
        await assertDrawerState(false, `before open at ${width}`)
        await openDrawer()
        await assertDrawerState(true, `after open at ${width}`)
        // Nyitáskor a React a bezáró gombra viszi a fókuszt (APG modális párbeszéd).
        await page.waitForFunction(
          (selector) => document.activeElement === document.querySelector(selector),
          MOBILE_CLOSE,
        )
      } else {
        await page.locator('.kc-site-header__brand').focus()
        // WP36: az első főmenüpont a „Kurzusok" (almenü nélkül); az almenüt az
        // első ALMENÜS menüpont fókusza nyitja.
        await page.locator(SUBMENU_ITEM_LINK).first().focus()
      }
      const campaign = nav.getByRole('link', { name: 'olcsó dolgok itt', exact: true })
      await campaign.waitFor({ state: 'visible' })
      assert.equal(await campaign.getAttribute('href'), '/kurzusok/otthoni-kezrehab-program-akcio')
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
        // Érintési célok a fiókban (layout.css, 2026-10-16): menüpont 56 px,
        // almenüpont 48 px, a bezáró gomb 44×44 px.
        const targets = await page.evaluate((closeSelector) => {
          const heights = (selector) =>
            [...document.querySelectorAll(selector)]
              .filter((el) => el.getClientRects().length > 0)
              .map((el) => el.getBoundingClientRect().height)
          const close = document.querySelector(closeSelector).getBoundingClientRect()
          return {
            links: heights('.kc-nav-mobile__link'),
            sublinks: heights('.kc-nav-mobile__sublink'),
            close: { width: close.width, height: close.height },
          }
        }, MOBILE_CLOSE)
        assert.ok(targets.links.length > 0 && targets.sublinks.length > 0, 'drawer links rendered')
        assert.ok(
          targets.links.every((height) => height >= 55.5),
          `drawer link below 56px at ${width}: ${targets.links}`,
        )
        assert.ok(
          targets.sublinks.every((height) => height >= 47.5),
          `drawer sublink below 48px at ${width}: ${targets.sublinks}`,
        )
        assert.ok(
          targets.close.width >= 44 && targets.close.height >= 44,
          `drawer close button below 44x44 at ${width}: ${JSON.stringify(targets.close)}`,
        )
      }
      if (geometry.mobile) {
        // FÓKUSZCSAPDA (WP9): az utolsó fiókelemről a Tab az elsőre (bezáró
        // gomb), az elsőről a Shift+Tab az utolsóra lép; a fókusz nem kerül
        // a fátyol (`::backdrop`) alá (WCAG 2.2 SC 2.4.11; APG modális párbeszéd).
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
        assert.ok(await isFocused(MOBILE_CLOSE), `drawer focus trap forward at ${width}`)
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
        // A manual popover magától nem zár Escape-re: a React zár, és a
        // fókuszt a hamburgerre adja vissza.
        await assertDrawerState(false, `after Escape at ${width}`)
        assert.ok(
          await isFocused(MOBILE_TOGGLE),
          `Escape returns focus to the hamburger at ${width}`,
        )
        // Bezáró gomb: zár, a fókusz a hamburgerre tér vissza.
        await openDrawer()
        await page.locator(MOBILE_CLOSE).click()
        await waitDrawerClosed()
        await assertDrawerState(false, `after close button at ${width}`)
        assert.ok(
          await isFocused(MOBILE_TOGGLE),
          `close button returns focus to the hamburger at ${width}`,
        )
        // Fátyol: a fiók dobozán kívüli koppintás zár, a fókusz a hamburgerre
        // tér vissza, és a koppintás NEM ér le a fátyol alatti lapelemre (a
        // fiók modális: APG modális párbeszéd, a háttér nem működtethető). A
        // lapelem mása egy rögzített gomb a koppintás pontján.
        await openDrawer()
        const drawerBox = await page.locator(MOBILE_DRAWER).boundingBox()
        assert.ok(drawerBox && drawerBox.x >= 40, `no backdrop area left of the drawer at ${width}`)
        const tap = { x: Math.floor(drawerBox.x / 2), y: 450 }
        await page.evaluate(({ x, y }) => {
          const under = document.createElement('button')
          under.id = 'under-backdrop-fixture'
          under.textContent = 'Lapelem a fátyol alatt'
          Object.assign(under.style, {
            position: 'fixed',
            left: `${x - 10}px`,
            top: `${y - 10}px`,
            width: '20px',
            height: '20px',
          })
          under.addEventListener('click', () => {
            under.dataset.clicked = 'true'
          })
          document.body.append(under)
        }, tap)
        await page.mouse.click(tap.x, tap.y)
        await settle()
        // A három jelet külön gyűjtjük, hogy a hibajelentés mindet megnevezze.
        const backdrop = {
          reachedBeneath: await page.evaluate(
            () => document.getElementById('under-backdrop-fixture').dataset.clicked === 'true',
          ),
          stillOpen: await drawerOpen(),
          focusOnHamburger: await isFocused(MOBILE_TOGGLE),
        }
        await page.evaluate(() => document.getElementById('under-backdrop-fixture').remove())
        if (backdrop.reachedBeneath)
          failures.push(
            `backdrop tap reached the page element beneath at ${width}, signedIn=${signedIn}`,
          )
        if (backdrop.stillOpen) {
          failures.push(`backdrop tap did not close the drawer at ${width}, signedIn=${signedIn}`)
          await page.locator(MOBILE_CLOSE).click()
          await waitDrawerClosed()
        } else {
          await assertDrawerState(false, `after backdrop tap at ${width}`)
          if (!backdrop.focusOnHamburger)
            failures.push(`backdrop tap did not return focus to the hamburger at ${width}`)
        }
      }
    }
    await page.setViewportSize({ width: 899, height: 390 })
    await settle()
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--kc-consent-offset', '144px')
      // A süti-sáv rétegének mása (consent-banner.css: rögzített, alul,
      // z-index 1000); a tartalma nem számít, csak a rétegrend.
      const layer = document.createElement('div')
      layer.id = 'consent-layer-fixture'
      Object.assign(layer.style, {
        position: 'fixed',
        insetInline: '0',
        bottom: '0',
        height: '144px',
        zIndex: '1000',
        background: '#fff',
      })
      document.body.append(layer)
    })
    await openDrawer()
    const campaign = page
      .locator(MOBILE_DRAWER)
      .getByRole('link', { name: 'olcsó dolgok itt', exact: true })
    await campaign.focus()
    await campaign.scrollIntoViewIfNeeded()
    const box = await campaign.boundingBox()
    assert.ok(
      box && box.y >= 0 && box.y + box.height <= 390 - 144,
      'campaign reachable above consent offset',
    )
    const layers = await page.evaluate(
      ({ drawerSelector, closeSelector }) => {
        const drawer = document.querySelector(drawerSelector)
        const rect = drawer.getBoundingClientRect()
        const close = document.querySelector(closeSelector).getBoundingClientRect()
        return {
          // A fiók maga görget (overflow-y: auto), nem a lap.
          drawerScrollTop: drawer.scrollTop,
          // Görgetett fiókban a ragadós fejléc bezáró gombja marad felül.
          closeOnTop:
            document
              .elementFromPoint(close.left + close.width / 2, close.top + close.height / 2)
              ?.closest(closeSelector) !== null,
          closeTop: close.top,
          // Felső réteg (top layer): a z-index 1000-es sáv a nyitott fiókot nem takarja.
          drawerAboveBanner: drawer.contains(
            document.elementFromPoint(rect.left + rect.width / 2, window.innerHeight - 20),
          ),
        }
      },
      { drawerSelector: MOBILE_DRAWER, closeSelector: MOBILE_CLOSE },
    )
    assert.ok(layers.drawerScrollTop > 0, `drawer did not scroll: ${JSON.stringify(layers)}`)
    assert.ok(
      layers.closeOnTop && layers.closeTop >= 0,
      `sticky close button covered: ${JSON.stringify(layers)}`,
    )
    assert.ok(layers.drawerAboveBanner, 'open drawer must sit above the consent layer')
    await campaign.press('Enter')
    await waitDrawerClosed()
    await assertDrawerState(false, 'after campaign link activation')
    await page.evaluate(() => {
      document.documentElement.style.removeProperty('--kc-consent-offset')
      document.getElementById('consent-layer-fixture').remove()
    })
  }
  // A gyűjtött (nem megszakító) hibákat a futás végén egyben jelentjük, hogy a
  // fátyol-ellenőrzés bukása mellett a többi szerződés is lefusson.
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
      MOBILE_TOGGLE,
      MOBILE_CLOSE,
      '.kc-nav-mobile__sublink',
      '.kc-account-nav--drawer a',
      '#outside-focus',
    ]) {
      await page.setViewportSize({ width: 899, height: 900 })
      await settle()
      await openDrawer()
      await assertDrawerState(true, `before resize, target=${target}`)
      await page.locator(target).first().waitFor({ state: 'visible' })
      if (target === MOBILE_TOGGLE) {
        const closeButton = page.locator(MOBILE_CLOSE)
        await closeButton.waitFor({ state: 'visible' })
        await closeButton.focus()
        assert.ok(await isFocused(MOBILE_CLOSE))
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
      // Asztali szélességen a React zár: a popover és vele a CSS-es
      // görgetészár is elengedődik (a rejtett fiók nem tarthatja zárva a lapot).
      await waitDrawerClosed()
      assert.equal(await pageScrollLocked(), false, `scroll lock released at 900, target=${target}`)
      const expected = target === '#outside-focus' ? target : '.kc-site-header__brand'
      assert.ok(
        await page.locator(expected).evaluate((el) => el === document.activeElement),
        `resize focus: signedIn=${signedIn}, target=${target}`,
      )
      await page.setViewportSize({ width: 899, height: 900 })
      await settle()
      await assertDrawerState(false, `back at 899, target=${target}`)
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
      await assertDrawerState(false, `desktop -> 899, target=${target}`)
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
      await openDrawer()
      await assertDrawerState(true, `empty menu open, control=${control}`)
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
      // 900 px-en a hamburger rejtett, ezért itt a fiók és a görgetészár a mérce.
      await waitDrawerClosed()
      assert.equal(await pageScrollLocked(), false, `empty-menu scroll lock, control=${control}`)
      assert.equal(await page.locator('.kc-nav-desktop__link').count(), 1)
      console.log(`PASS empty-menu both directions ${signedIn}: ${control}`)
    }
  }
  // HIDRATÁLÁS ELŐTT (2026-10-16, a mobil halott kattintások javítása): a
  // fiókot a böngésző nyitja és zárja, JavaScript nélkül. A szerver-renderelt
  // HTML-t kikapcsolt JavaScripttel töltjük be, tehát egyetlen React-kezelő
  // sem fut; egy `onClick`-es nyitásra visszaálló hamburger itt elbukik.
  const serverHtml = await page.evaluate(() => window.renderHeaderHtml(false))
  const noScript = await browser.newContext({
    javaScriptEnabled: false,
    reducedMotion: 'reduce',
    viewport: { width: 390, height: 900 },
  })
  try {
    const staticPage = await noScript.newPage()
    staticPage.setDefaultTimeout(5000)
    await staticPage.route('**/*', (route) => route.abort())
    await staticPage.setContent(
      `<html lang="hu"><head><style>${styles}</style></head><body><div id="root">${serverHtml}</div></body></html>`,
    )
    const staticCampaign = staticPage
      .locator(MOBILE_DRAWER)
      .getByRole('link', { name: 'olcsó dolgok itt', exact: true })
    assert.equal(await staticCampaign.isVisible(), false, 'drawer closed in server HTML')
    await staticPage.locator(MOBILE_TOGGLE).click()
    await staticCampaign.waitFor({ state: 'visible' })
    assert.ok(
      await staticPage.evaluate(
        () => getComputedStyle(document.documentElement).overflow === 'hidden',
      ),
      'no-JS scroll lock while open',
    )
    await staticPage.locator(MOBILE_CLOSE).click()
    await staticCampaign.waitFor({ state: 'hidden' })
    assert.equal(
      await staticPage.evaluate(
        (selector) => document.querySelector(selector).matches(':popover-open'),
        MOBILE_DRAWER,
      ),
      false,
      'no-JS close button hides the drawer',
    )
    console.log('PASS no-JS: server HTML opens and closes the drawer without React')
  } finally {
    await noScript.close()
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(failures, [])
  console.log(
    'PASS: responsive geometry, hamburger overhang and 44x44 target, native popover open/close (toggle, close button, backdrop, Escape, link), CSS scroll lock, native expanded state, drawer scroll and top layer, drawer focus trap, submenu arrow keys, account access, exact campaign label/current state, resize cleanup, no-JS opening',
  )
} finally {
  await browser.close()
}
