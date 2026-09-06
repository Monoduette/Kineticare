import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

/**
 * ŐR — A HÁROM-MÉRETES TIPOGRÁFIA UTÁNI VIZUÁLIS REGRESSZIÓK.
 *
 * A 2026-08-16-i skála-átállás ~200 helyen írta át a betűméreteket. A tesztek
 * zöldek maradtak, mert a méret-szabályt őrizték — a MÉRETVÁLTÁS KÖVETKEZMÉNYEIT
 * viszont senki nem mérte. A böngészős (Chromium, 320/390/768/900/1280/1440/1920 px)
 * audit hat olyan hibát talált, amit egyik meglévő teszt sem fogott meg:
 *
 *  1. a jogi oldalak kiírt webcíme nem tört meg → a DOKUMENTUM vízszintesen
 *     görgethető lett (mérve /aszf-en: 320 px-es nézetablakban 578 px,
 *     390 px-esben 580 px széles dokumentum) — WCAG 2.2, 1.4.10 Reflow;
 *  2. a welcome-tábla címe 18ch-ra volt szorítva: 22 karakter/sor kapacitás,
 *     ötsoros cím, mellette 1253 px üres hely (1440 px-en mérve);
 *  3. a welcome-tábla két hasábjának térköz-ritmusa szétcsúszott (a rács köze
 *     72 px, a jobb hasáb belső térköze 36 px volt: az elválasztó vonal a jobb
 *     oldali szöveghez tapadt), és mindkét oldal a rácson kívüli 1,1rem-et vitt;
 *  4. a welcome-tábla 100dvh-s magassága mellett a kitöltöttség 39–59% volt,
 *     míg a többi kezdőlapi tábláé 78–96%;
 *  5. a Rólunk-tábla szöveghasábja 35–40 karakter/sor sorhosszra esett (a
 *     bekezdés a ~13 px-es tábla-lépcsőről a 18 px-es törzsméretre került, a
 *     hasáb szélessége viszont nem változott);
 *  6. a pénztár súgósora 96–100 karakter/sor volt (mérték nélkül, 622 px-es
 *     mezőszélességgel), a mobil garancia-doboz szövege pedig 31 karakter/sor.
 *
 * Mindegyik javítás a MEGENGEDETT eszközökkel készült (térköz, tábla-magasság,
 * mérték, sortáv) — betűméret egyet sem változott, azt a
 * `tipografia-harom-meret.test.ts` őrzi tovább.
 *
 * 2026-08-18: az 1. pont (1.4.10 Reflow) őrzése ÁTKERÜLT a
 * `reflow-hasabmeres.test.ts`-be. Az itteni változat tulajdonságot nézett, nem
 * mért, ezért zöld maradt, amikor a hiba `<p>`-ből `<h2>`-be költözött. Az itt
 * maradt ellenőrzések a CSS-ben rögzíthető, MÁS jellegű szabályok (közös token
 * használata, térköz-arány); ahol a helyes érték a kimeneten dől el, ott mérő
 * őr való.
 */

const REPO = fileURLToPath(new URL('..', import.meta.url))

const olvas = (ut: string): string => readFileSync(join(REPO, ut), 'utf8')

/** Kommentek nélküli forrás — a magyarázatban szereplő régi értékek nem szabályok. */
const kommentNelkul = (forras: string): string => forras.replace(/\/\*[\s\S]*?\*\//g, '')

/** Egy szelektor deklarációs blokkja (az első előfordulásé), kommentek nélkül. */
function blokk(css: string, szelektor: string): string {
  const tiszta = kommentNelkul(css)
  const index = tiszta.indexOf(`${szelektor} {`)
  expect(index, `nincs ilyen szabály: ${szelektor}`).toBeGreaterThan(-1)
  const vege = tiszta.indexOf('}', index)
  return tiszta.slice(index, vege)
}

/**
 * A 1.4.10 Reflow ŐRE ÁTKÖLTÖZÖTT a `reflow-hasabmeres.test.ts`-be.
 *
 * Ami itt állt, tulajdonság-ellenőrzés volt: azt nézte, hogy a
 * `.kc-richtext blockquote` szabályban SZEREPEL-E az `overflow-wrap` szó.
 * Zöld maradt egy bizonyítottan túlcsorduló lapon — a szabály a bekezdéseken
 * ott volt, a CÍMSOROKON nem (mérve, Chromium: /aszf 320 px-es nézetablakban
 * 348 px széles dokumentum, a „Felelősségkorlátozás" h2 miatt). Mutáció sem
 * kellett hozzá: a vak folt magától nyílt ki.
 *
 * Az új őr a KIMENETET méri — a valódi tartalomból, a valódi CSS-ből és a
 * valódi betűmetrikából számolja a dokumentum-szélességet 320 és 390 px-en.
 * Ide csak a mérték-szabály többi, szintén mért következménye maradt.
 */
describe('folyószöveg-mérték és szakaszcím-ritmus', () => {
  const content = olvas('app/(frontend)/styles/content.css')

  it('a folyószöveg mértéke a közös tokenről jön (nem elemre írt érték)', () => {
    const szabaly = blokk(content, '.kc-richtext blockquote')
    expect(szabaly).toContain('max-width: var(--kc-measure)')
  })

  it('a folyószöveg-szakaszcím fölött nagyobb a térköz, mint a bekezdések közt', () => {
    // A H2 az L lépcsőn áll (NN/g szerint 32 px); a fölötte lévő 32 px (space-6)
    // a saját méreténél kisebb volt, és csak kétszerese a 16 px-es
    // bekezdésköznek — az ÁSZF 13 szakaszcíme így alig vált ki a szövegből.
    const h2 = blokk(content, '.kc-richtext h2')
    expect(h2).toContain('margin-top: var(--kc-space-7)')
  })
})

describe('welcome tábla — mérték, ritmus, magasság', () => {
  const welcome = olvas('app/(frontend)/styles/blocks/welcome.css')
  const tiszta = kommentNelkul(welcome)

  it('a cím mértéke nem szorítja vissza a régi, ötsoros hasábra', () => {
    const cim = blokk(welcome, '.kc-welcome__title')
    const talalat = /max-width:\s*(\d+(?:\.\d+)?)ch/.exec(cim)
    expect(talalat, 'a cím mértéke ch-ban, tokenizálhatóan legyen kiírva').not.toBeNull()
    const ch = Number(talalat?.[1])
    // 1ch ≈ 1,22 tényleges karakter a Tenor Sans L lépcsőjén (a lapon mérve),
    // tehát a 45–85 karakteres sávhoz ~37–70ch tartozik. A felső korlát a
    // sáv tetejét NEM lépheti át ultraszéles kijelzőn sem.
    expect(ch).toBeGreaterThanOrEqual(37)
    expect(ch).toBeLessThanOrEqual(70)
  })

  it('a két hasáb UGYANARRÓL a térköz-tokenről kapja a ritmusát', () => {
    expect(tiszta).toContain('--kc-welcome-rhythm:')
    const tetel = blokk(welcome, '.kc-welcome__checklist-item')
    const bekezdes = blokk(welcome, '.kc-welcome__side-text')
    expect(tetel).toContain('var(--kc-welcome-rhythm)')
    expect(bekezdes).toContain('var(--kc-welcome-rhythm)')
  })

  it('az elválasztó vonal két oldalán UGYANAKKORA a hasábköz', () => {
    expect(tiszta).toContain('--kc-welcome-gutter:')
    // A rács köze és a jobb hasáb bal belső térköze ugyanaz az érték: a vonal
    // (a jobb hasáb bal kerete) így optikailag a hasábköz közepén áll.
    expect(tiszta).toMatch(/\.kc-welcome__grid\s*\{[^}]*gap:\s*var\(--kc-welcome-gutter\)/)
    expect(tiszta).toMatch(/padding-left:\s*var\(--kc-welcome-gutter\)/)
  })

  it('nincs a 4px-es térközrácson kívüli, kézi rem-érték', () => {
    // A korábbi 1,1rem (17,6px) sem a rácson, sem a másik hasáb ritmusán nem ült.
    expect(tiszta).not.toMatch(/(padding|margin)[^;:]*:\s*[^;]*\b1\.1rem/)
  })

  it('a tábla magassága mérsékelt: nem feszül 100dvh-ra', () => {
    // A tartalom mérve 420–475px; 100dvh mellett a kitöltöttség 39–59% volt.
    expect(tiszta).toMatch(/\.kc-section\.kc-board\.kc-welcome\s*\{[^}]*min-height:\s*34rem/)
    expect(tiszta).not.toContain('100dvh')
  })

  it('a tétel-sortáv a törzsszöveg sávjában van (1,55–1,7)', () => {
    const tetel = blokk(welcome, '.kc-welcome__checklist-item')
    const talalat = /line-height:\s*(\d+(?:\.\d+)?)/.exec(tetel)
    expect(talalat).not.toBeNull()
    const lh = Number(talalat?.[1])
    expect(lh).toBeGreaterThanOrEqual(1.55)
    expect(lh).toBeLessThanOrEqual(1.7)
  })
})

describe('Rólunk tábla — a szöveghasáb mértéke', () => {
  const about = olvas('app/(frontend)/styles/blocks/about.css')
  const tiszta = kommentNelkul(about)

  it('a szöveghasáb legalább 38%-ot kap (a 45 karakteres alsó határhoz)', () => {
    const talalat = /grid-template-columns:\s*minmax\([^,]+,\s*(\d+(?:\.\d+)?)%\)/.exec(tiszta)
    expect(talalat, 'a háromhasábos tábla-rács nem található').not.toBeNull()
    expect(Number(talalat?.[1])).toBeGreaterThanOrEqual(38)
  })

  it('a tablet-kalibráció szöveghasábja is bővebb 35%-nál', () => {
    const talalat = /grid-template-columns:\s*(\d+(?:\.\d+)?)%\s+\d/.exec(tiszta)
    expect(talalat).not.toBeNull()
    expect(Number(talalat?.[1])).toBeGreaterThanOrEqual(40)
  })

  it('a tábla-cím mértéke nem a régi, ötsoros 7,4ch', () => {
    const cim = blokk(about, '.kc-about__title')
    const talalat = /max-width:\s*(\d+(?:\.\d+)?)ch/.exec(cim)
    expect(talalat).not.toBeNull()
    expect(Number(talalat?.[1])).toBeGreaterThanOrEqual(37)
  })
})

describe('űrlap-súgó és garancia-doboz — sorhossz', () => {
  it('a mezők súgósora mértéket kap (a 85 karakteres felső határ alá)', () => {
    const ui = olvas('app/(frontend)/styles/ui.css')
    const hint = blokk(ui, '.kc-field__hint')
    expect(hint).toMatch(/max-width:\s*var\(--kc-measure(-comfort)?\)/)
  })

  it('a garancia-doboz szűk kijelzőn EGY hasáb, a kétoszlopos alak 600px-től él', () => {
    const kurzusok = olvas('app/(frontend)/kurzusok/kurzusok.css')
    const alap = blokk(kurzusok, '.kc-course-guarantee')
    expect(alap).toContain('grid-template-columns: minmax(0, 1fr)')
    const tiszta = kommentNelkul(kurzusok)
    const media = tiszta.indexOf('@media (min-width: 600px)')
    expect(media, 'nincs 600px-es töréspont a garancia-dobozhoz').toBeGreaterThan(-1)
    expect(tiszta.slice(media, media + 400)).toContain('.kc-course-guarantee')
  })
})

describe('fejléc-navigáció — tartalék a menüsávban', () => {
  const layout = olvas('app/(frontend)/styles/layout.css')

  it('a menülink belső térköze legfeljebb a 8px-es lépcső', () => {
    const link = blokk(layout, '.kc-nav-desktop__link')
    expect(link).toMatch(/padding:\s*var\(--kc-space-2\)\s*;/)
  })

  it('a menülista nem költ külön térközre a linkek közé', () => {
    const lista = blokk(layout, '.kc-nav-desktop__list')
    expect(lista).toMatch(/gap:\s*0\s*;/)
  })

  it('a desktop, mobil és fiók ugyanazon a tartalomhoz mért határon vált', () => {
    // A 900px-es menüsor és a 75em-es kijelentkezés-pirula szándékosan külön.
    // A geometriát a header-responsive.browser.mjs méri; ez a szabály az
    // együttváltó menü/fiók/hamburger hármast védi.
    const css = postcss.parse(layout)
    for (const selector of ['.kc-nav-desktop', '.kc-nav-mobile', '.kc-account-nav']) {
      const queries: string[] = []
      css.walkRules(selector, (rule) => {
        if (rule.parent?.type === 'atrule' && rule.parent.name === 'media') {
          queries.push(rule.parent.params)
        }
      })
      expect(queries).toEqual(['(min-width: 900px)'])
    }
    expect(olvas('components/layout/MobileNav.tsx')).toContain("matchMedia('(min-width: 900px)')")
    expect(olvas('components/layout/DesktopNav.tsx')).toContain("matchMedia('(min-width: 900px)')")
    expect(olvas('components/layout/AccountNav.tsx')).toContain("matchMedia('(min-width: 900px)')")
  })
})
