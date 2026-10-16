/**
 * Nyitott mobilmenü + látható sütisáv: a „Kapcsolat” menüpont elérhető.
 *
 * MIT VÉD. Az első látogatás pillanata, amikor a sütisáv még kint van, éppen
 * az, amikor valaki a kapcsolatot keresi. Korábban a sáv (z-index 1000) a fiók
 * (z-index 80) fölé került, és kis kijelzőn eltakarta az utolsó menüpontokat.
 * 2026-10-16 óta a fiók natív popover a böngésző felső rétegében, a sáv pedig
 * nyitott fióknál egy sorra csukódik (consent-banner.css). Ha valaki a fiókot
 * kiveszi a felső rétegből, vagy a sáv újra a fiók fölé kerül, a „Kapcsolat”
 * helyén a sáv eleme áll, és ez a teszt bukik.
 *
 * MÉRÉS. 375×667 (iPhone SE) és 320×568 nézetben, friss látogatóval (nincs
 * tárolt süti-döntés, tehát a sáv látszik): a fiók kinyitása és a beúszás
 * vége után a „Kapcsolat” link a nézetbe görgetve kattintható, azaz a
 * középpontjában az `elementFromPoint` a linket (vagy annak gyermekét) adja,
 * és a koppintás a /kapcsolat oldalra visz.
 *
 * Futtatás egy `next build` + `next start` példány ellen (adatbázissal, a
 * menüben legyen „Kapcsolat” pont):
 *   node tests/e2e/mobil-menu-suti-sav.e2e.mjs <playwright/index.mjs> <alap-URL>
 * Opcionális: KC_BROWSER_EXECUTABLE a Chromium útvonalával.
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [playwrightPath, baseUrl] = process.argv.slice(2)
assert.ok(playwrightPath && baseUrl, 'Használat: node <fájl> <playwright/index.mjs> <alap-URL>')
const { chromium, devices } = await import(pathToFileURL(path.resolve(playwrightPath)).href)

const NEZETEK = [
  { width: 375, height: 667 },
  { width: 320, height: 568 },
]

const browser = await chromium.launch(
  process.env.KC_BROWSER_EXECUTABLE ? { executablePath: process.env.KC_BROWSER_EXECUTABLE } : {},
)
const hibak = []
try {
  for (const viewport of NEZETEK) {
    const nev = `${viewport.width}×${viewport.height}`
    const context = await browser.newContext({ ...devices['iPhone SE'], viewport })
    const page = await context.newPage()
    await page.goto(new URL('/', baseUrl).href, { waitUntil: 'load' })

    // A sáv a hidratálás után jelenik meg (a tárolt döntést a kliens olvassa).
    const sav = page.locator('.kc-consent-banner')
    await sav.waitFor({ state: 'visible', timeout: 30_000 })

    await page.locator('.kc-site-header__bar .kc-nav-mobile__toggle').first().tap()
    const fiok = page.locator('#kc-mobile-menu')
    await page.waitForFunction(() =>
      document.getElementById('kc-mobile-menu')?.matches(':popover-open'),
    )
    // A beúszó átmenet vége (mozgást engedő beállításnál 200 ms).
    await fiok.evaluate((elem) => Promise.all(elem.getAnimations().map((a) => a.finished)))

    assert.ok(await sav.isVisible(), `${nev}: a sütisávnak nyitott fióknál is látszania kell`)
    const savMagassag = (await sav.boundingBox())?.height ?? 0
    const gombok = await page
      .locator('.kc-consent-banner__button')
      .evaluateAll((elemek) => elemek.map((elem) => elem.getBoundingClientRect().top))
    // Egy sorra csukva: a két döntőgomb egy sorban, a szöveg vizuálisan rejtett.
    if (gombok.length !== 2 || Math.abs(gombok[0] - gombok[1]) > 1) {
      hibak.push(`${nev}: a sütisáv gombjai nem egy sorban állnak nyitott fióknál`)
    }

    const kapcsolat = fiok.getByRole('link', { name: 'Kapcsolat', exact: true })
    await kapcsolat.scrollIntoViewIfNeeded()
    const talalat = await kapcsolat.evaluate((link) => {
      const doboz = link.getBoundingClientRect()
      const x = doboz.left + doboz.width / 2
      const y = doboz.top + doboz.height / 2
      const elem = document.elementFromPoint(x, y)
      return {
        lathato: y > 0 && y < window.innerHeight,
        sajat: elem === link || link.contains(elem),
        mi: elem ? `${elem.tagName.toLowerCase()}.${elem.className}` : 'semmi',
      }
    })
    console.log(
      `${nev}: sütisáv ${Math.round(savMagassag)} px magas; a „Kapcsolat” középpontjában: ${talalat.mi}`,
    )
    if (!talalat.lathato || !talalat.sajat) {
      hibak.push(`${nev}: a „Kapcsolat” link nem kattintható, a helyén ez áll: ${talalat.mi}`)
    } else {
      await kapcsolat.tap()
      await page.waitForURL((url) => url.pathname === '/kapcsolat', { timeout: 30_000 })
    }
    await context.close()
  }
} finally {
  await browser.close()
}

assert.deepEqual(hibak, [], hibak.join('\n'))
console.log(
  'PASS: nyitott fiók és látható sütisáv mellett a „Kapcsolat” kattintható (375×667, 320×568)',
)
