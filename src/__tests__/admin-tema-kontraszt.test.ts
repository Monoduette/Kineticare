import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * ADMIN TÉMA-RÉTEG ŐR — a src/app/(payload)/custom.scss végén álló,
 * az EGÉSZ Payload-adminra ható téma-réteg gépi párja (admin-audit CS1,
 * K02–K11, K30, K31; 2026-09-22).
 *
 * Mit véd:
 *   1. a szakasz rétegen KÍVÜL áll (a Payload CSS-e a @layer payload-default
 *      rétegben van, a rétegen kívüli szabály ezért nyer), és a Statisztika
 *      `.kc-adminstat` blokkja UTÁN, hogy annak regexes őrei érintetlenek
 *      maradjanak (statisztika-elrendezes.test.tsx, statisztika-diagram-tick.test.ts);
 *   2. mindkét téma-szelektor létezik, és a tokenek témánként AA-sak
 *      (WCAG 2.2 SC 1.4.3: szöveg ≥ 4,5:1; SC 1.4.11: mezőhatár és
 *      fókuszgyűrű ≥ 3:1) a Payload VALÓDI háttérszínein;
 *   3. a stílusszerződés (.kc-admin-input, .kc-admin-notice) a mért tokenekre
 *      hivatkozik, és a színei mindkét témán tartják a küszöböt;
 *   4. a vizsgáló függvény nem vakon zöld: szintetikus gyenge tokenre bukik.
 *
 * A háttérszíneket a teszt a node_modules/@payloadcms/ui colors.scss-éből
 * oldja fel (a téma-leképezéssel együtt), és a jegyzőkönyvben rögzített
 * referencia-értékeket ez ellen egyezteti: ha a pinned Payload színei
 * változnának, az őr hangosan bukik, nem hallgat.
 */

const REPO = process.cwd()
const olvas = (...reszek: string[]): string => readFileSync(join(REPO, ...reszek), 'utf8')

const CUSTOM_SCSS = olvas('src', 'app', '(payload)', 'custom.scss')
const PAYLOAD_SCSS = ['node_modules', '@payloadcms', 'ui', 'dist', 'scss']
const COLORS_SCSS = olvas(...PAYLOAD_SCSS, 'colors.scss')
const APP_SCSS = olvas(...PAYLOAD_SCSS, 'app.scss')

/** A téma-réteg fejkommentjének azonosító sora. */
const SZAKASZ_JEL = 'ADMIN TÉMA-RÉTEG'

// ───────────────────────────────────────────────────────────────────────────
// 1. KONTRASZT-MOTOR — a WCAG 2.2 normatív definíciója
//    https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
//    https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
// ───────────────────────────────────────────────────────────────────────────

type RGB = readonly [number, number, number]

function hexRgb(hex: string): RGB {
  const jel = hex.trim().replace('#', '').toLowerCase()
  if (!/^[0-9a-f]{6}$/.test(jel)) {
    throw new Error(`nem hatjegyű hexa szín: ${hex}`)
  }
  return [
    Number.parseInt(jel.slice(0, 2), 16),
    Number.parseInt(jel.slice(2, 4), 16),
    Number.parseInt(jel.slice(4, 6), 16),
  ]
}

function rgbHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

function luminancia([r, g, b]: RGB): number {
  const csatorna = (c: number): number => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * csatorna(r) + 0.7152 * csatorna(g) + 0.0722 * csatorna(b)
}

/** Kontraszt-arány két hexa színre, két tizedesre kerekítve. */
function arany(elo: string, hatter: string): number {
  const a = luminancia(hexRgb(elo))
  const b = luminancia(hexRgb(hatter))
  const [vilagos, sotet] = a >= b ? [a, b] : [b, a]
  return Math.round(((vilagos + 0.05) / (sotet + 0.05)) * 100) / 100
}

interface Par {
  elo: string
  hatter: string
  kuszob: number
  mire: string
}

interface Bukas extends Par {
  ertek: number
}

/**
 * A vizsgáló: minden párt kiszámol, és a küszöb alattiakat adja vissza.
 * A tesztek ezt hívják a valódi tokenekre, és a negatív eset egy szintetikus,
 * gyenge tokenre is (ott bukást KELL jeleznie).
 */
function vizsgal(parok: readonly Par[]): Bukas[] {
  return parok
    .map((p) => ({ ...p, ertek: arany(p.elo, p.hatter) }))
    .filter((p) => p.ertek < p.kuszob)
}

// ───────────────────────────────────────────────────────────────────────────
// 2. A PAYLOAD VALÓDI SZÍNEI (colors.scss + app.scss)
// ───────────────────────────────────────────────────────────────────────────

const kommentNelkul = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** `--color-<csalad>-<n>: rgb(r, g, b)` → hexa, a :root blokkból. */
function nyersPaletta(): Record<string, string> {
  const ki: Record<string, string> = {}
  for (const t of COLORS_SCSS.matchAll(/(--color-[a-z]+-\d+):\s*rgb\((\d+),\s*(\d+),\s*(\d+)\)/g)) {
    ki[t[1]] = rgbHex([Number(t[2]), Number(t[3]), Number(t[4])])
  }
  return ki
}

/** Egy blokk `--theme-*: var(--color-*)` leképezései. */
function lekepezes(blokk: string): Record<string, string> {
  const ki: Record<string, string> = {}
  for (const t of blokk.matchAll(/(--theme-[a-z]+-\d+):\s*var\((--color-[a-z]+-\d+)\)/g)) {
    ki[t[1]] = t[2]
  }
  return ki
}

type Tema = 'vilagos' | 'sotet'

/** A Payload core téma-tokenjei témánként, hexára feloldva (felülírás nélkül). */
function payloadTema(tema: Tema): Record<string, string> {
  const paletta = nyersPaletta()
  const gyoker = /:root\s*\{([\s\S]*?)\n {2}\}/.exec(COLORS_SCSS)?.[1] ?? ''
  const sotet = /html\[data-theme='dark'\]\s*\{([\s\S]*?)\n {2}\}/.exec(COLORS_SCSS)?.[1] ?? ''
  const terkep = { ...lekepezes(gyoker), ...(tema === 'sotet' ? lekepezes(sotet) : {}) }
  const ki: Record<string, string> = {}
  for (const [token, szin] of Object.entries(terkep)) {
    const hex = paletta[szin]
    if (hex !== undefined) ki[token] = hex
  }
  return ki
}

/**
 * A jegyzőkönyvben (custom.scss fejkomment) rögzített háttér-referenciák.
 * A teszt ezeket NEM hiszi el: a colors.scss-ből feloldott értékkel egyezteti.
 */
const REFERENCIA: Record<Tema, Record<string, string>> = {
  vilagos: {
    '--theme-elevation-0': '#ffffff',
    '--theme-elevation-50': '#f5f5f5',
    '--theme-elevation-100': '#ebebeb',
    '--theme-elevation-800': '#2f2f2f',
  },
  sotet: {
    '--theme-elevation-0': '#141414',
    '--theme-elevation-50': '#222222',
    '--theme-elevation-100': '#2f2f2f',
    '--theme-elevation-800': '#ebebeb',
    '--theme-elevation-1000': '#ffffff',
  },
}

// ───────────────────────────────────────────────────────────────────────────
// 3. A TÉMA-RÉTEG A custom.scss-BŐL
// ───────────────────────────────────────────────────────────────────────────

function szakasz(): string {
  const kezdet = CUSTOM_SCSS.indexOf(SZAKASZ_JEL)
  expect(kezdet, `a custom.scss-ben nincs „${SZAKASZ_JEL}” szakasz`).toBeGreaterThan(-1)
  const nyito = CUSTOM_SCSS.lastIndexOf('/*', kezdet)
  return CUSTOM_SCSS.slice(nyito)
}

/** A témánkénti token-blokk (`html:not([data-theme='dark'])` / `html[data-theme='dark']`). */
function temaBlokk(tema: Tema): string {
  const tiszta = kommentNelkul(szakasz())
  const minta =
    tema === 'vilagos'
      ? /html:not\(\[data-theme='dark'\]\)\s*\{([^}]*)\}/
      : /html\[data-theme='dark'\]\s*\{([^}]*)\}/
  return minta.exec(tiszta)?.[1] ?? ''
}

function temaTokenek(tema: Tema): Record<string, string> {
  const ki: Record<string, string> = {}
  for (const t of temaBlokk(tema).matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    ki[t[1]] = t[2].toLowerCase()
  }
  return ki
}

/** A téma ténylegesen érvényes színei: a core leképezése + a mi felülírásunk. */
function hatalyos(tema: Tema): Record<string, string> {
  return { ...payloadTema(tema), ...temaTokenek(tema) }
}

/** Egy szabályblokk törzse a szakaszból, szelektor szerint. */
function szabaly(szelektor: string): string {
  const tiszta = kommentNelkul(szakasz())
  const i = tiszta.indexOf(`${szelektor} {`)
  expect(i, `nincs „${szelektor}” szabály a téma-rétegben`).toBeGreaterThan(-1)
  const vege = tiszta.indexOf('}', i)
  return tiszta.slice(i, vege)
}

// ───────────────────────────────────────────────────────────────────────────
// 4. A PÁROK
// ───────────────────────────────────────────────────────────────────────────

const SZOVEG_TOKENEK = [
  '--theme-elevation-400',
  '--theme-elevation-450',
  '--theme-elevation-500',
  '--theme-elevation-550',
  '--theme-error-500',
  '--theme-success-500',
] as const

/** Háttérszerepek: lap (elevation-0), mező/sor (50), csak olvasható mező (100). */
const HATTEREK = ['--theme-elevation-0', '--theme-elevation-50', '--theme-elevation-100'] as const

/**
 * A szürke szöveg-tokenek mindhárom háttéren élnek (a 400-as a csak olvasható
 * mező értéke is). A hiba- és siker-szín csak a lapon és a mezőn jelenik meg;
 * sötétben a #2f2f2f-es csak olvasható háttéren ilyen szöveg nincs.
 */
function hattereiSzovegnek(token: string, tema: Tema): readonly string[] {
  const szinjelzo = token === '--theme-error-500' || token === '--theme-success-500'
  return szinjelzo && tema === 'sotet' ? HATTEREK.slice(0, 2) : HATTEREK
}

function parok(tema: Tema, szinek: Record<string, string>): Par[] {
  const ki: Par[] = []
  for (const token of SZOVEG_TOKENEK) {
    for (const hatter of hattereiSzovegnek(token, tema)) {
      ki.push({
        elo: szinek[token],
        hatter: szinek[hatter],
        kuszob: 4.5,
        mire: `${token} szöveg a ${hatter} háttéren`,
      })
    }
  }
  for (const hatter of HATTEREK) {
    ki.push({
      elo: szinek['--kc-admin-field-border'],
      hatter: szinek[hatter],
      kuszob: 3,
      mire: `--kc-admin-field-border mezőhatár a ${hatter} háttéren`,
    })
  }
  // Fókuszgyűrű: --accessibility-outline = 2px solid var(--theme-text);
  // a --theme-text világosban elevation-800, sötétben elevation-1000 (app.scss).
  const gyuru =
    tema === 'vilagos' ? szinek['--theme-elevation-800'] : szinek['--theme-elevation-1000']
  for (const hatter of HATTEREK) {
    ki.push({
      elo: gyuru,
      hatter: szinek[hatter],
      kuszob: 3,
      mire: `fókuszgyűrű a ${hatter} háttéren`,
    })
  }
  return ki
}

/** A .kc-admin-notice két változata: doboz-háttér, jelzőszín, szöveg. */
function noticeParok(tema: Tema, szinek: Record<string, string>): Par[] {
  const szoveg = szinek['--theme-elevation-800']
  const valtozatok = [
    {
      nev: 'tájékoztató',
      hatter: szinek['--theme-success-50'],
      jelzo: szinek['--theme-success-600'],
    },
    { nev: 'figyelem', hatter: szinek['--theme-warning-50'], jelzo: szinek['--theme-warning-600'] },
  ]
  const ki: Par[] = []
  for (const v of valtozatok) {
    ki.push({ elo: szoveg, hatter: v.hatter, kuszob: 4.5, mire: `${v.nev} doboz: szöveg` })
    ki.push({
      elo: v.jelzo,
      hatter: v.hatter,
      kuszob: 3,
      mire: `${v.nev} doboz: határ a doboz hátterén`,
    })
    for (const lap of ['--theme-elevation-0', '--theme-elevation-50']) {
      ki.push({
        elo: v.jelzo,
        hatter: szinek[lap],
        kuszob: 3,
        mire: `${v.nev} doboz: határ a ${lap} lapon`,
      })
    }
    ki.push({
      elo: gyuruSzin(tema, szinek),
      hatter: v.hatter,
      kuszob: 3,
      mire: `${v.nev} doboz: link fókuszgyűrűje`,
    })
  }
  return ki
}

function gyuruSzin(tema: Tema, szinek: Record<string, string>): string {
  return tema === 'vilagos' ? szinek['--theme-elevation-800'] : szinek['--theme-elevation-1000']
}

const TEMAK: ReadonlyArray<[string, Tema]> = [
  ['világos', 'vilagos'],
  ['sötét', 'sotet'],
]

// ───────────────────────────────────────────────────────────────────────────
// 5. TESZTEK
// ───────────────────────────────────────────────────────────────────────────

describe('a kontraszt-motor önmagán (WCAG 2.2 ismert értékei)', () => {
  it('a szélső esetek pontosak', () => {
    expect(arany('#000000', '#ffffff')).toBe(21)
    expect(arany('#ffffff', '#ffffff')).toBe(1)
    expect(arany('#767676', '#ffffff')).toBe(4.54)
  })
})

describe('a téma-réteg helye a custom.scss-ben', () => {
  it('a szakasz a Statisztika .kc-adminstat blokkjai UTÁN áll', () => {
    const kezdet = CUSTOM_SCSS.indexOf(SZAKASZ_JEL)
    const utolsoStat = CUSTOM_SCSS.lastIndexOf("[data-theme='dark'] .kc-adminstat {")
    expect(utolsoStat).toBeGreaterThan(-1)
    expect(kezdet).toBeGreaterThan(utolsoStat)
  })

  it('rétegen KÍVÜL áll: a szakaszban nincs @layer, és 0-s zárójel-mélységen kezdődik', () => {
    expect(kommentNelkul(szakasz())).not.toMatch(/@layer\b/)
    const elotte = kommentNelkul(CUSTOM_SCSS.slice(0, CUSTOM_SCSS.indexOf(SZAKASZ_JEL)))
    const melyseg = [...elotte].reduce((m, c) => m + (c === '{' ? 1 : c === '}' ? -1 : 0), 0)
    expect(melyseg).toBe(0)
  })

  it('mindkét téma-szelektor létezik, és a --theme-elevation-150-et NEM írja át', () => {
    expect(temaBlokk('vilagos').length).toBeGreaterThan(0)
    expect(temaBlokk('sotet').length).toBeGreaterThan(0)
    expect(kommentNelkul(szakasz())).not.toMatch(/--theme-elevation-150\s*:/)
  })

  it('az egyetlen !important a react-select fókuszán áll', () => {
    const tiszta = kommentNelkul(szakasz())
    const talalatok = [...tiszta.matchAll(/!important/g)]
    expect(talalatok).toHaveLength(1)
    expect(szabaly('.react-select .rs__control--is-focused')).toContain('!important')
  })
})

describe('a Payload háttér-referenciái egyeznek a pinned colors.scss-sel', () => {
  it.each(TEMAK)('%s téma', (_nev, tema) => {
    const core = payloadTema(tema)
    for (const [token, hex] of Object.entries(REFERENCIA[tema])) {
      expect(core[token], `${token} a colors.scss-ben`).toBe(hex)
    }
  })

  it('a fókuszgyűrű a --theme-text-ről rajzol, a mezőháttér sötétben elevation-50', () => {
    expect(APP_SCSS).toMatch(/--accessibility-outline:\s*2px solid var\(--theme-text\)/)
    expect(APP_SCSS).toMatch(/--theme-text:\s*var\(--theme-elevation-800\)/)
    expect(APP_SCSS).toMatch(/--theme-text:\s*var\(--theme-elevation-1000\)/)
    expect(APP_SCSS).toMatch(/--theme-input-bg:\s*var\(--theme-elevation-50\)/)
  })
})

describe.each(TEMAK)('téma-tokenek a %s témában (SC 1.4.3, 1.4.11, 2.4.7)', (_nev, tema) => {
  const szinek = hatalyos(tema)

  it('minden vizsgált token hexára oldódik', () => {
    const kell = [
      ...SZOVEG_TOKENEK,
      ...HATTEREK,
      '--kc-admin-field-border',
      '--theme-elevation-800',
      '--theme-success-50',
      '--theme-success-600',
      '--theme-warning-50',
      '--theme-warning-600',
    ]
    const hianyzo = kell.filter((t) => szinek[t] === undefined)
    expect(hianyzo, `nincs érték: ${hianyzo.join(', ')}`).toEqual([])
  })

  it('a mezőhatár-token a téma-blokkban él', () => {
    expect(temaTokenek(tema)['--kc-admin-field-border']).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('szöveg ≥ 4,5:1, mezőhatár és fókuszgyűrű ≥ 3:1 a Payload valódi hátterein', () => {
    const bukasok = vizsgal(parok(tema, szinek))
    expect(
      bukasok.map(
        (b) => `${b.mire}: ${b.elo} / ${b.hatter} = ${String(b.ertek)}:1 < ${String(b.kuszob)}`,
      ),
    ).toEqual([])
  })

  it('a .kc-admin-notice mindkét változata tartja a küszöböket', () => {
    const bukasok = vizsgal(noticeParok(tema, szinek))
    expect(
      bukasok.map(
        (b) => `${b.mire}: ${b.elo} / ${b.hatter} = ${String(b.ertek)}:1 < ${String(b.kuszob)}`,
      ),
    ).toEqual([])
  })
})

describe('stílusszerződés: a közös osztályok a mért tokenekre hivatkoznak', () => {
  it('.kc-admin-input: mezőhatár, mezőháttér, szöveg, ≥ 40 px, fókusz, letiltott állapot', () => {
    const alap = szabaly('.kc-admin-input')
    expect(alap).toMatch(/border:\s*1px solid var\(--kc-admin-field-border\)/)
    expect(alap).toMatch(/background:\s*var\(--theme-input-bg\)/)
    expect(alap).toMatch(/color:\s*var\(--theme-elevation-800\)/)
    expect(alap).toMatch(/min-height:\s*max\(40px,/)
    expect(alap).toMatch(/font:\s*inherit/)
    expect(szabaly('.kc-admin-input::placeholder')).toMatch(/color:\s*var\(--theme-elevation-400\)/)
    expect(szabaly('.kc-admin-input:focus-visible')).toMatch(
      /outline:\s*var\(--accessibility-outline\)/,
    )
    const tiltott = kommentNelkul(szakasz())
    expect(tiltott).toMatch(
      /\.kc-admin-input:disabled,\s*\.kc-admin-input\[readonly\]\s*\{[^}]*border-color:\s*transparent/,
    )
  })

  it('.kc-admin-notice: jelzőszín és háttér a success/warning 600/50 tokenről, 14 px / 1,5', () => {
    const alap = szabaly('.kc-admin-notice')
    expect(alap).toMatch(/--kc-admin-notice-accent:\s*var\(--theme-success-600\)/)
    expect(alap).toMatch(/--kc-admin-notice-bg:\s*var\(--theme-success-50\)/)
    expect(alap).toMatch(/border:\s*1px solid var\(--kc-admin-notice-accent\)/)
    expect(alap).toMatch(/border-inline-start-width:\s*4px/)
    expect(alap).toMatch(/color:\s*var\(--theme-elevation-800\)/)
    expect(alap).toMatch(/font-size:\s*max\(14px,/)
    expect(alap).toMatch(/line-height:\s*1\.5/)
    const figyelem = szabaly('.kc-admin-notice--figyelem')
    expect(figyelem).toMatch(/--kc-admin-notice-accent:\s*var\(--theme-warning-600\)/)
    expect(figyelem).toMatch(/--kc-admin-notice-bg:\s*var\(--theme-warning-50\)/)
    const linkek = szabaly('.kc-admin-notice__linkek a')
    expect(linkek).toMatch(/min-height:\s*24px/)
    expect(linkek).toMatch(/text-decoration:\s*underline/)
    expect(szabaly('.kc-admin-notice__linkek a:focus-visible')).toMatch(
      /outline:\s*var\(--accessibility-outline\)/,
    )
  })

  it('a mezőleírás 14 px és 1,5-ös sormagasság, mértékkel, az ármező leírásán is', () => {
    // A webshop-bővítmény ármezőjének saját, rétegen kívüli (0,2,0)-s
    // max-width szabálya van (plugin-ecommerce ui/PriceInput/index.css):
    // a szelektorlistának azt is le kell fednie, különben 96 karakteres sor.
    const tiszta = kommentNelkul(szakasz())
    const talalat =
      /\.field-description,\s*\.custom-view-description,\s*\.field-type\.formattedPrice \.formattedPriceDescription\s*\{([^}]*)\}/.exec(
        tiszta,
      )
    expect(talalat, 'nincs a mezőleírás-szabály a várt szelektorlistával').not.toBeNull()
    const leiras = talalat?.[1] ?? ''
    expect(leiras).toMatch(/font-size:\s*max\(14px,/)
    expect(leiras).toMatch(/line-height:\s*1\.5/)
    expect(leiras).toMatch(/max-width:\s*34em/)
  })
})

describe('mért regressziók ellen', () => {
  const tiszta = (): string => kommentNelkul(szakasz()).replace(/\s+/g, ' ')

  it('a globális link-fókusz :where()-rel nulla specifikusságú, így a saját komponensek gyűrűje nyer', () => {
    // A .kc-adminstat, a videótár és a .kc-admin-notice saját fókuszgyűrűje
    // (0,2,1)-es szelektor; a korábbi (0,3,1)-es globális szabály felülírta.
    expect(tiszta()).toMatch(
      /:where\(a:not\(\.step-nav__home\):not\(\.app-header__account\)\):focus-visible \{/,
    )
    expect(tiszta()).not.toMatch(
      /(^|[\s,}])a:not\(\.step-nav__home\):not\(\.app-header__account\):focus-visible/,
    )
  })

  it('a fejléc Fiók-ikonja ≥ 3:1 nyugalomban, és a sötét aktív állapot nem romlik (SC 1.4.11)', () => {
    // Mérve: a core graphic-account sziluettje fehéren 1,54:1, sötéten 2,08:1.
    const css = tiszta()
    expect(css).toMatch(
      /\.graphic-account:not\(\.graphic-account--active\):not\(:hover\) \.graphic-account__bg \{ stroke: var\(--kc-admin-field-border\); \}/,
    )
    expect(css).toMatch(/\.graphic-account__body \{ fill: var\(--theme-elevation-500\); \}/)
    expect(css).toMatch(
      /html\[data-theme='dark'\] \.graphic-account--active \.graphic-account__bg \{ fill: var\(--color-base-500\); \}/,
    )
    const parok: Par[] = []
    for (const [, tema] of TEMAK) {
      const sz = hatalyos(tema)
      parok.push(
        {
          elo: sz['--theme-elevation-500'],
          hatter: sz['--theme-elevation-50'],
          kuszob: 3,
          mire: `${tema}: sziluett a kör kitöltésén`,
        },
        {
          elo: sz['--kc-admin-field-border'],
          hatter: sz['--theme-elevation-0'],
          kuszob: 3,
          mire: `${tema}: kör kerete a lapon`,
        },
      )
    }
    const sotet = hatalyos('sotet')
    const alap500 = nyersPaletta()['--color-base-500']
    parok.push(
      {
        elo: sotet['--theme-elevation-1000'],
        hatter: alap500,
        kuszob: 3,
        mire: 'sötét aktív: fehér sziluett a körön',
      },
      {
        elo: alap500,
        hatter: sotet['--theme-elevation-0'],
        kuszob: 3,
        mire: 'sötét aktív: kör a lapon',
      },
    )
    // Világos aktív állapot: a core elevation-300-as köre (a core leképezésével
    // feloldva) és rajta a törzsszöveg-színű sziluett.
    const vilagos = hatalyos('vilagos')
    expect(css).toMatch(
      /html:not\(\[data-theme='dark'\]\) \.graphic-account--active \.graphic-account__body \{ fill: var\(--theme-elevation-800\); \}/,
    )
    parok.push({
      elo: vilagos['--theme-elevation-800'],
      hatter: vilagos['--theme-elevation-300'],
      kuszob: 3,
      mire: 'világos aktív: sziluett a körön',
    })
    expect(vizsgal(parok).map((b) => `${b.mire}: ${String(b.ertek)}:1`)).toEqual([])
    // A felülírt, világosabb sötét 500-as tokennel az aktív sziluett bukna: ezért kell a kivétel.
    expect(arany(sotet['--theme-elevation-1000'], sotet['--theme-elevation-500'])).toBeLessThan(3)
  })

  it('mobilon csak a gombsor ragad, és a sáv homályosító rétege nem takarja az űrlapot', () => {
    // Mérve 320/390 px-en: a tördelt meta 30–54 px-e a gombsor fölött ragadt;
    // a display: contents nélkül maradt blur-bg ::before/::after pedig az
    // egész űrlapot elhomályosította.
    const css = tiszta()
    const mobil = /@media \(max-width: 768px\) \{(.*)$/.exec(css)?.[1] ?? ''
    expect(mobil).toMatch(/\.doc-controls, \.doc-controls__wrapper \{ display: contents; \}/)
    expect(mobil).toMatch(
      /\.doc-controls::before, \.doc-controls::after, \.doc-controls__divider \{ display: none; \}/,
    )
    expect(mobil).toMatch(/\.doc-controls__controls-wrapper \{ position: sticky; top: 0;/)
    expect(mobil).toMatch(/\.doc-controls__controls \{ flex-wrap: wrap; overflow: visible;/)
  })

  it('a „Szekció hozzáadása” választó blokkneve tördel, nem csonkol (SC 1.4.10)', () => {
    // Mérve: 1280 px-en 4, 390 px-en 12, 320 px-en 17 név végződött „…”-ra a 19-ből.
    const css = tiszta()
    expect(css).toMatch(
      /\.blocks-drawer__block \.thumbnail-card__label \{ white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: break-word; \}/,
    )
    expect(css).toMatch(/\.blocks-drawer__block > \.thumbnail-card \{ height: 100%; \}/)
  })

  it('a morzsamenü levágása kihagyja az Irányítópult lenyíló választóját', () => {
    // Mérve 1440 px-en: az overflow: hidden a választó menüjét láthatatlanná
    // tette (a core ugyanezért veszi le ott a csonkolást, StepNav/index.scss).
    const css = tiszta()
    for (const osztaly of ['app-header__step-nav-wrapper', 'step-nav__last']) {
      const szabalyok = [...css.matchAll(new RegExp(`\\.${osztaly}([^{}]*)\\{([^}]*)\\}`, 'g'))]
      const levago = szabalyok.filter((t) => /overflow:\s*hidden/.test(t[2]))
      expect(levago.length, `${osztaly}: nincs levágó szabály`).toBeGreaterThan(0)
      for (const t of levago) {
        expect(t[1], `${osztaly}: a levágás nem zárja ki a dashboard-választót`).toMatch(
          /:not\( ?:has\(\.dashboard-breadcrumb-select, \.dashboard-breadcrumb-dropdown__editing\) ?\)/,
        )
      }
    }
  })
})

describe('negatív eset: a vizsgáló nem vakon zöld', () => {
  it('a core eredeti, gyenge világos 400-as tokenje (#9a9a9a) bukik', () => {
    const gyenge = { ...hatalyos('vilagos'), '--theme-elevation-400': '#9a9a9a' }
    const bukasok = vizsgal(parok('vilagos', gyenge))
    expect(bukasok.some((b) => b.mire.startsWith('--theme-elevation-400'))).toBe(true)
  })

  it('a core eredeti mezőhatára (elevation-150, #dddddd) bukik a 3:1-en', () => {
    const gyenge = { ...hatalyos('vilagos'), '--kc-admin-field-border': '#dddddd' }
    const bukasok = vizsgal(parok('vilagos', gyenge))
    expect(bukasok.some((b) => b.mire.startsWith('--kc-admin-field-border'))).toBe(true)
  })

  it('a felülírás nélküli sötét success-500 (#1587ba) a mező hátterén bukik', () => {
    const gyenge = { ...hatalyos('sotet'), '--theme-success-500': '#1587ba' }
    const bukasok = vizsgal(parok('sotet', gyenge))
    expect(bukasok.some((b) => b.mire.startsWith('--theme-success-500'))).toBe(true)
  })
})
