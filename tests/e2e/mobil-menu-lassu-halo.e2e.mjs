/**
 * Mobilmenü lassú hálózaton: az ELSŐ koppintás nyit, elnyelt koppintás nélkül.
 *
 * MIT VÉD. A PostHog szerint a mobil halott kattintások 54%-a a fejléc
 * hamburgerére esett: lassú hálózaton a fejléc már látszott, de a nyitás egy
 * React `onClick` volt, és a hidratálásig (3–5 mp) a koppintás elveszett. A
 * menü 2026-10-16 óta natív popover (MobileNav.tsx): a böngésző nyitja, a
 * hidratálás előtt is. Ha valaki visszateszi a nyitást JavaScriptre, ez a
 * teszt bukik (ellenpróba: a 2026-10-16 előtti main-en mind a három oldalon
 * bukik, lásd a PR-t).
 *
 * PROFIL (a halott kattintás-elemzés lassított profilja): iPhone 14 emuláció,
 * CDP Network.emulateNetworkConditions (150 ms késleltetés, 1,6 Mbit/s le),
 * Emulation.setCPUThrottlingRate 4. Minden oldalt `domcontentloaded`-ig
 * töltünk, és AZONNAL koppintunk; a fióknak 500 ms-on belül nyitva kell lennie
 * (`:popover-open`, régi böngészőn `details[open]`).
 *
 * Futtatás egy `next build` + `next start` példány ellen (adatbázissal, a menü
 * a CMS-ből jön):
 *   node tests/e2e/mobil-menu-lassu-halo.e2e.mjs <playwright/index.mjs> <alap-URL>
 * Opcionális: KC_BROWSER_EXECUTABLE a Chromium útvonalával.
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [playwrightPath, baseUrl] = process.argv.slice(2)
assert.ok(playwrightPath && baseUrl, 'Használat: node <fájl> <playwright/index.mjs> <alap-URL>')
const { chromium, devices } = await import(pathToFileURL(path.resolve(playwrightPath)).href)

const OLDALAK = ['/', '/szolgaltatasok', '/rolunk']
const NYITASI_HATAR_MS = 500
const GOMB = '.kc-site-header__bar .kc-nav-mobile__toggle'

/**
 * Nyitva van-e a fiók: popover (`:popover-open`) vagy a `<details>` tartalék.
 * Ha egyik sincs a lapon (a 2026-10-16 előtti, React-állapotú menü), a régi
 * fiók saját jele, a `data-open="true"` számít. Így az ellenpróba a régi kódon
 * is a valódi okból (nem nyílt ki) bukik, nem azért, mert a teszt nem találja
 * a fiókot. (A doboz láthatósága nem jó jel: a stíluslap megérkezése előtt a
 * rejtett fiók is a nézetablakban áll.)
 */
const NYITVA = () => {
  const fiok = document.getElementById('kc-mobile-menu')
  if (fiok && fiok.hasAttribute('popover') && typeof fiok.showPopover === 'function') {
    return fiok.matches(':popover-open')
  }
  const tartalek = document.querySelector('.kc-nav-mobile__fallback')
  if (tartalek) {
    return tartalek.hasAttribute('open')
  }
  return document.querySelector('.kc-nav-mobile__drawer')?.getAttribute('data-open') === 'true'
}

/**
 * Csak a vizsgált szerver felé mehet kérés (CLAUDE.md 15.): a PostHog, a
 * Barion, a Meta és minden más külső hívás elutasítva.
 */
async function csakSajatSzerver(context, alapUrl) {
  const sajat = new URL(alapUrl).origin
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === sajat ? route.continue() : route.abort(),
  )
}

const browser = await chromium.launch(
  process.env.KC_BROWSER_EXECUTABLE ? { executablePath: process.env.KC_BROWSER_EXECUTABLE } : {},
)
const hibak = []
try {
  for (const oldal of OLDALAK) {
    const context = await browser.newContext({ ...devices['iPhone 14'] })
    await csakSajatSzerver(context, baseUrl)
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })

    const indulas = Date.now()
    await page.goto(new URL(oldal, baseUrl).href, { waitUntil: 'domcontentloaded' })
    const dcl = Date.now() - indulas

    // Nincs várakozás a hidratálásra: a gomb a szerver-HTML-ben már ott van.
    const gomb = page.locator(GOMB).first()
    const doboz = await gomb.boundingBox()
    assert.ok(doboz, `${oldal}: a menügomb nem látszik DOMContentLoaded után`)
    const koppintas = Date.now()
    await page.touchscreen.tap(doboz.x + doboz.width / 2, doboz.y + doboz.height / 2)

    let nyitva = false
    while (Date.now() - koppintas <= NYITASI_HATAR_MS) {
      if (await page.evaluate(NYITVA)) {
        nyitva = true
        break
      }
      await page.waitForTimeout(20)
    }
    const reakcio = Date.now() - koppintas
    console.log(
      `${oldal}: DOMContentLoaded ${dcl} ms, első koppintás → ${nyitva ? `nyitva ${reakcio} ms alatt` : 'NEM nyílt'}`,
    )
    if (!nyitva) {
      hibak.push(
        `${oldal}: az első koppintás után ${NYITASI_HATAR_MS} ms-on belül nem nyílt ki a menü (elnyelt koppintás: 1)`,
      )
    }
    await context.close()
  }
} finally {
  await browser.close()
}

assert.deepEqual(hibak, [], hibak.join('\n'))
console.log(
  'PASS: lassított profilon az első koppintás 500 ms-on belül nyitja a menüt, elnyelt koppintás: 0',
)
