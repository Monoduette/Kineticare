import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  elokeszitoPozicio,
  fokuszCelra,
  hosszuUgras,
  type FokuszCel,
} from '../components/motion/AnchorScroll'

/**
 * ŐR — a 2026-08-17-i tulajdonosi észrevételek. Mindhárom szabályt MÉRÉS
 * hozta, és mindhármat elronthatná egy későbbi, jó szándékú szerkesztés.
 * Az „Így tudunk segíteni" (`.kc-services__title`) és az „Így működik az
 * online kurzus" (`.kc-section-title`) betűmérete MÁR AZELŐTT is azonos volt
 * (mérve: 46,4 px @1440, 32,55 px @390 — mindkettő a közös L lépcsőn). Amitől
 */

const REPO = fileURLToPath(new URL('..', import.meta.url))
const olvas = (relativUt: string): string => readFileSync(join(REPO, relativUt), 'utf8')

/** Kommentek nélküli forrás — a dokumentációban álló példa nem szabály. */
const kommentNelkul = (forras: string): string => forras.replace(/\/\*[\s\S]*?\*\//g, '')

/** Egy szelektor ÖSSZES szabálytörzse (a töréspont-változatok is). */
function szabalyTorzsek(css: string, szelektor: string): string[] {
  const tiszta = kommentNelkul(css)
  const torzsek: string[] = []
  let honnan = 0
  for (;;) {
    const kezdet = tiszta.indexOf(`${szelektor} {`, honnan)
    if (kezdet < 0) break
    const vege = tiszta.indexOf('}', kezdet)
    torzsek.push(tiszta.slice(kezdet, vege))
    honnan = vege
  }
  if (torzsek.length === 0) {
    throw new Error(`Nincs ilyen szabály a stíluslapon: ${szelektor}`)
  }
  return torzsek
}

const szabalyTorzs = (css: string, szelektor: string): string => szabalyTorzsek(css, szelektor)[0]

/** Egy deklaráció értéke a szabálytörzsből (pl. `font-size` → `var(--kc-font-l)`). */
function ertek(torzs: string, tulajdonsag: string): string {
  const talalat = new RegExp(`(?:^|[^-\\w])${tulajdonsag}:\\s*([^;]+);`).exec(torzs)
  if (talalat === null) {
    throw new Error(`A szabálytörzsben nincs ${tulajdonsag} deklaráció:\n${torzs}`)
  }
  return talalat[1].trim()
}

const servicesCss = olvas('app/(frontend)/styles/blocks/services.css')
const howCss = olvas('app/(frontend)/styles/blocks/how-it-works.css')
const contentCss = olvas('app/(frontend)/styles/content.css')
const motionCss = olvas('app/(frontend)/styles/motion.css')
const baseCss = olvas('app/(frontend)/styles/base.css')
const fontsCss = olvas('app/(frontend)/styles/fonts.css')
const layoutTsx = olvas('app/(frontend)/layout.tsx')
const anchorTsx = olvas('components/motion/AnchorScroll.tsx')

describe('1. a két kezdőlapi szekciócím EGY lépcsőn és EGY sortávon áll', () => {
  const servicesCim = szabalyTorzs(servicesCss, '.kc-services__title')
  const kozosCim = szabalyTorzs(contentCss, '.kc-section-title')

  it('mindkettő a közös L betűméret-lépcsőt viseli', () => {
    expect(ertek(servicesCim, 'font-size')).toBe('var(--kc-font-l)')
    expect(ertek(kozosCim, 'font-size')).toBe('var(--kc-font-l)')
    expect(ertek(servicesCim, 'font-size')).toBe(ertek(kozosCim, 'font-size'))
  })

  it('mindkettő a közös címsor-SORTÁVOT viseli (ez volt a látszólagos méretkülönbség)', () => {
    expect(ertek(servicesCim, 'line-height')).toBe('var(--kc-leading-heading)')
    expect(ertek(kozosCim, 'line-height')).toBe('var(--kc-leading-heading)')
  })

  it('a tábla-sortáv (1,06) nem jön vissza egyik szekciócímre sem', () => {
    expect(servicesCim).not.toContain('--kc-leading-board')
    expect(kozosCim).not.toContain('--kc-leading-board')
  })

  it('mindkettő ugyanazt a súlyt és címsor-betűt viszi', () => {
    expect(ertek(servicesCim, 'font-weight')).toBe('var(--kc-font-weight-normal)')
    expect(ertek(kozosCim, 'font-weight')).toBe('var(--kc-font-weight-normal)')
    expect(ertek(servicesCim, 'font-family')).toBe('var(--kc-font-heading)')
    expect(ertek(kozosCim, 'font-family')).toBe('var(--kc-font-heading)')
  })

  it('a rövid cím mértéke tágabb a régi, három sorra törő 7,2ch-nál', () => {
    const mertek = ertek(servicesCim, 'max-width')
    expect(mertek).toMatch(/^\d+(\.\d+)?ch$/)
    expect(Number.parseFloat(mertek)).toBeGreaterThan(7.2)
  })

  it('a hosszú CMS-cím fokozata BŐVEBB az alapnál (a fokozat nem üresedett ki)', () => {
    const alap = Number.parseFloat(ertek(servicesCim, 'max-width'))
    const hosszu = Number.parseFloat(ertek(szabalyTorzs(servicesCss, '.kc-services__title--long'), 'max-width'))
    expect(hosszu).toBeGreaterThan(alap)
  })
})

describe('2. a számozott sorok hierarchiája', () => {
  it('a hogyan-működik sor-cím 700-as törzsbetű (GOV.UK heading-s)', () => {
    const cim = szabalyTorzs(howCss, '.kc-how__step-title')
    expect(ertek(cim, 'font-weight')).toBe('var(--kc-font-weight-bold)')
    expect(ertek(cim, 'font-family')).toBe('var(--kc-font-body)')
    expect(szabalyTorzs(howCss, '.kc-how__text')).not.toContain('font-weight')
  })

  it('a szolgáltatások sor-cím Tenor serif, normál súly (mockup type-contrast)', () => {
    const cim = szabalyTorzs(servicesCss, '.kc-services__row-title')
    expect(ertek(cim, 'font-family')).toBe('var(--kc-font-heading)')
    expect(ertek(cim, 'font-weight')).toBe('var(--kc-font-weight-normal)')
    expect(szabalyTorzs(servicesCss, '.kc-services__text')).not.toContain('font-weight')
  })

  it('a szolgáltatások sor-cím a következő hierarchia-lépcsőn áll (L), a törzs M', () => {
    expect(ertek(szabalyTorzs(servicesCss, '.kc-services__row-title'), 'font-size')).toBe(
      'var(--kc-font-l)',
    )
    expect(ertek(szabalyTorzs(servicesCss, '.kc-services__text'), 'font-size')).toBe(
      'var(--kc-font-m)',
    )
  })

  it('a hogyan-működik cím és szöveg azonos M méreten áll (a szintet a súly adja)', () => {
    expect(ertek(szabalyTorzs(howCss, '.kc-how__step-title'), 'font-size')).toBe('var(--kc-font-m)')
    expect(ertek(szabalyTorzs(howCss, '.kc-how__text'), 'font-size')).toBe('var(--kc-font-m)')
  })

  it.each([
    ['services.css', servicesCss, '.kc-services__row-title'],
    ['how-it-works.css', howCss, '.kc-how__step-title'],
  ] as const)('%s — a sor-cím a közös címsor-sortávot viszi (nincs elemre írt szám)', (_nev, css, cimSzelektor) => {
    expect(ertek(szabalyTorzs(css, cimSzelektor), 'line-height')).toBe('var(--kc-leading-heading)')
  })

  it('a Tenor Sans-nak tényleg CSAK 400-as metszete van (a szintetikus félkövér tilalmának alapja)', () => {
    const tenorSulyok = [...kommentNelkul(fontsCss).matchAll(/font-family:\s*'Tenor Sans';[\s\S]*?font-weight:\s*([^;]+);/g)].map(
      (talalat) => talalat[1].trim(),
    )
    expect(tenorSulyok.length).toBeGreaterThan(0)
    expect(new Set(tenorSulyok)).toEqual(new Set(['400']))
  })

  it('a Nunito Sans variábilis metszete lefedi a 700-at (a súly VALÓDI, nem szintetikus)', () => {
    expect(kommentNelkul(fontsCss)).toMatch(/font-family:\s*'Nunito Sans';[\s\S]*?font-weight:\s*400 700;/)
  })

  it('egyetlen szabály sem kér 700-as súlyt a CÍMSOR-betűre (az szintetikus félkövér lenne)', () => {
    for (const [nev, css] of [
      ['services.css', servicesCss],
      ['how-it-works.css', howCss],
    ] as const) {
      const tiszta = kommentNelkul(css)
      for (const torzs of tiszta.split('}')) {
        if (!torzs.includes('var(--kc-font-heading)')) continue
        expect(torzs, `${nev}: címsor-betű félkövér súllyal`).not.toContain('--kc-font-weight-bold')
      }
    }
  })
})

describe('3. a hosszú horgony-ugrás rövidül, de sima marad', () => {
  it('egy nézetablaknál rövidebb ugrás MARAD sima', () => {
    expect(hosszuUgras(0, 900)).toBe(false)
    expect(hosszuUgras(450, 900)).toBe(false)
    expect(hosszuUgras(899, 900)).toBe(false)
    // Pontosan egy nézetablak: a mért Chromium-görbén 483 ms — a NN/g 500 ms-os
    // küszöbe ALATT, tehát még animálható.
    expect(hosszuUgras(900, 900)).toBe(false)
  })

  it('egy nézetablaknál hosszabb ugrás RÖVIDÍTENDŐ', () => {
    expect(hosszuUgras(901, 900)).toBe(true)
    // A tulajdonos által jelzett eset: /szolgaltatasok#rendeloi.
    expect(hosszuUgras(2048, 900)).toBe(true)
    expect(hosszuUgras(3138, 844)).toBe(true)
  })

  it('a felfelé tartó ugrás ugyanúgy számít (a menüpontra visszakattintás)', () => {
    expect(hosszuUgras(-2048, 900)).toBe(true)
    expect(hosszuUgras(-450, 900)).toBe(false)
  })

  it('nulla vagy értelmetlen nézetablak-magasságnál nem avatkozik be', () => {
    expect(hosszuUgras(5000, 0)).toBe(false)
    expect(hosszuUgras(5000, -100)).toBe(false)
  })

  it('a motion.css adja az azonnali görgetés osztályát', () => {
    expect(szabalyTorzs(motionCss, '.kc-scroll-instant')).toContain('scroll-behavior: auto')
  })

  it('a RÖVID ugrás sima marad: a globális smooth görgetés megmarad', () => {
    expect(kommentNelkul(baseCss)).toContain('scroll-behavior: smooth')
  })

  it('csökkentett mozgás mellett a MOZGÁS marad el, mégpedig ágankénti őrszemmel', () => {
    const tiszta = kommentNelkul(anchorTsx)
    expect(tiszta).toContain("matchMedia('(prefers-reduced-motion: reduce)')")
    // Mindkét MOZGÁS-ág első lépése az őrszem.
    expect(tiszta).toMatch(/const azonnal = \(\) => \{\s*if \(csokkentettMozgas\(\)\) \{/)
    expect(tiszta).toMatch(/const rovidit = \(pozicio: number\) => \{\s*if \(csokkentettMozgas\(\)\) \{/)
  })

  it('a horgony NÉLKÜLI belső hivatkozás (lap tetejére görgetés) is fedve van', () => {
    // Mérve: a menüpontra visszakattintva a lap 2055 px-t görgetett VISSZA,
    // ugyanazzal a ~690 ms-os elhúzással. A távolság ilyenkor a jelenlegi
    // görgetés-pozíció, mert az útválasztó a lap tetejére visz.
    const tiszta = kommentNelkul(anchorTsx)
    expect(tiszta).toContain('hosszuUgras(window.scrollY, window.innerHeight)')
  })

  it('a MÁSIK oldalra mutató horgony mindig azonnali (a cél még nem mérhető)', () => {
    const tiszta = kommentNelkul(anchorTsx)
    expect(tiszta).toMatch(/if \(link\.hash\.length > 0\) \{\s*\n\s*azonnal\(\)/)
  })

  it('a LAPON BELÜLI hosszú ugrás a cél elé fél képernyővel indul', () => {
    // Lefelé: a cél 3000, a nézetablak 900 → 3000 - 450 = 2550-től sima.
    expect(elokeszitoPozicio(3000, 0, 900)).toBe(2550)
    // Felfelé: a cél 0, a jelenlegi 2500 → 0 + 450 = 450-től sima.
    expect(elokeszitoPozicio(0, 2500, 900)).toBe(450)
    // A lap teteje fölé nem mehet.
    expect(elokeszitoPozicio(100, 3000, 900)).toBe(550)
    expect(elokeszitoPozicio(200, 0, 900)).toBe(0)
  })

  it('a maradék út PONTOSAN fél nézetablak, tehát a mért 333 ms-os sávban van', () => {
    // A NN/g ajánlott sávja 100–500 ms; a Chromium mért görbéjén 0,5
    // nézetablak = 333 ms. Ez a teszt azt őrzi, hogy az arány ne csússzon el.
    for (const [cel, jelenlegi, nezet] of [
      [3000, 0, 900],
      [0, 3138, 844],
      [5000, 100, 568],
    ] as const) {
      const indulo = elokeszitoPozicio(cel, jelenlegi, nezet)
      expect(Math.abs(cel - indulo)).toBeCloseTo(nezet * 0.5, 5)
    }
  })

  it('a KIINDULÓPONT beállítása `instant`, nem `auto` (mért csapda)', () => {
    // Az `auto` NEM azonnalit jelent, hanem azt, hogy a böngésző a CSS
    // `scroll-behavior`-t használja — ami itt `smooth`. Mérve: az `auto`-val
    // kért előkészítő ugrás MAGA is végiganimálódott (0 → 1685 px, 698 ms),
    // és a rákövetkező görgetés ismét a teljes utat tette meg.
    const tiszta = kommentNelkul(anchorTsx)
    expect(tiszta).not.toMatch(/scrollTo\([^)]*behavior: 'auto'/)
  })

  it('a lapon belüli ág a RÖVIDÍTÉST hívja, nem az azonnali módot', () => {
    const tiszta = kommentNelkul(anchorTsx)
    expect(tiszta).toMatch(/azonosOldal\(link\) && link\.hash\.length > 0[\s\S]{0,200}rovidit\(pozicio\)/)
    // A rövidítés a böngésző saját sima görgetésére bízza a maradékot:
    // a KIINDULÓPONT beállítása explicit `behavior: 'instant'`.
    expect(tiszta).toContain("behavior: 'instant'")
  })

  it('a külső hivatkozás kimarad (ott nincs mit görgetni)', () => {
    expect(kommentNelkul(anchorTsx)).toContain('link.host !== window.location.host')
  })

  it('a komponens NEM nyeli el a kattintást (az útválasztó és az előzmények érintetlenek)', () => {
    const tiszta = kommentNelkul(anchorTsx)
    expect(tiszta).not.toContain('preventDefault()')
    // A görgetést nem a komponens végzi: a `scrollIntoView` az útválasztóé.
    expect(tiszta).not.toContain('scrollIntoView')
  })

  it('a görgetést a BÖNGÉSZŐ végzi: egyetlen scrollTo, és az is azonnali', () => {
    // A komponens NEM animál magától (nincs rAF-ciklus, nincs időzített
    // lépegetés): egyetlen `scrollTo`-t hív, a KIINDULÓPONT beállítására,
    // explicit `behavior: 'instant'`-tal. A tényleges mozgást a böngésző saját
    // sima görgetése teszi meg, tehát az útválasztó, az előzmények és a
    // horgonyra kerülő fókusz érintetlen marad.
    const tiszta = kommentNelkul(anchorTsx)
    expect(tiszta.match(/window\.scrollTo/g)).toHaveLength(1)
    expect(tiszta).toMatch(/window\.scrollTo\(\{\s*\n?\s*behavior: 'instant',/)
    expect(tiszta).not.toContain('requestAnimationFrame')
    expect(tiszta).not.toContain('setInterval')
  })

  it('a kattintást ELFOGÁSI szakaszban figyeli (a görgetés indulása előtt kell átállni)', () => {
    expect(kommentNelkul(anchorTsx)).toContain("document.addEventListener('click', onClick, true)")
  })

  it('a storefront-elrendezés fel is csatolja', () => {
    expect(layoutTsx).toContain("from '@/components/motion/AnchorScroll'")
    expect(layoutTsx).toContain('<AnchorScroll />')
  })
})

/**
 * Próba-elem a `fokuszCelra` viselkedés-teszteléséhez. A projektben nincs
 * jsdom (a vitest `environment: 'node'`), ezért a fókuszáláshoz szükséges
 * elem-felületet itt utánozzuk. Minden valódi `HTMLElement` ugyanezt tudja.
 */
class ProbaElem implements FokuszCel {
  private readonly attributumok = new Map<string, string>()
  private blurKezelok: (() => void)[] = []
  /** A `focus()` hívások opciói, sorrendben — ezt méri a teszt. */
  readonly fokuszHivasok: { preventScroll: boolean }[] = []

  /** @param alapFokuszalhatosag a natív `tabIndex` attribútum nélkül (section: −1, a[href]: 0) */
  constructor(private readonly alapFokuszalhatosag: number = -1) {}

  get tabIndex(): number {
    const irt = this.attributumok.get('tabindex')
    return irt === undefined ? this.alapFokuszalhatosag : Number.parseInt(irt, 10)
  }

  hasAttribute(nev: string): boolean {
    return this.attributumok.has(nev)
  }

  getAttribute(nev: string): string | null {
    return this.attributumok.get(nev) ?? null
  }

  setAttribute(nev: string, ertek: string): void {
    this.attributumok.set(nev, ertek)
  }

  removeAttribute(nev: string): void {
    this.attributumok.delete(nev)
  }

  /** Egyszeri-e a feliratkozás? A `{ once: true }` nélkül a kezelők halmoznának. */
  egyszeriBlurFeliratkozas: boolean | null = null

  addEventListener(_tipus: 'blur', kezelo: () => void, opciok: { once: true }): void {
    this.egyszeriBlurFeliratkozas = opciok.once
    this.blurKezelok.push(kezelo)
  }

  focus(opciok: { preventScroll: boolean }): void {
    this.fokuszHivasok.push(opciok)
  }

  /** A fókusz elhagyása — a `{ once: true }` miatt minden kezelő egyszer fut. */
  blur(): void {
    const kezelok = this.blurKezelok
    this.blurKezelok = []
    for (const kezelo of kezelok) {
      kezelo()
    }
  }
}

describe('4. a horgony-ugrás után a FÓKUSZ is a célra kerül (WCAG 2.2 SC 2.4.3, N-13)', () => {
  it('a nem fókuszálható célt (section) fókuszálhatóvá teszi, és megfókuszálja', () => {
    const szekcio = new ProbaElem(-1)
    const ideiglenesek = new Set<FokuszCel>()
    fokuszCelra(szekcio, ideiglenesek)
    expect(szekcio.getAttribute('tabindex')).toBe('-1')
    expect(szekcio.fokuszHivasok).toEqual([{ preventScroll: true }])
    expect(ideiglenesek.has(szekcio)).toBe(true)
  })

  it('a fókuszálás NEM görget újra (preventScroll) — enélkül elromlana a beállított pozíció', () => {
    const szekcio = new ProbaElem(-1)
    fokuszCelra(szekcio, new Set<FokuszCel>())
    expect(szekcio.fokuszHivasok[0].preventScroll).toBe(true)
  })

  it('a cél elhagyásakor az ideiglenes tabindex LEKERÜL (a DOM nem marad átírva)', () => {
    const szekcio = new ProbaElem(-1)
    const ideiglenesek = new Set<FokuszCel>()
    fokuszCelra(szekcio, ideiglenesek)
    // A feliratkozás egyszeri: enélkül minden ugrásnál újabb kezelő gyűlne.
    expect(szekcio.egyszeriBlurFeliratkozas).toBe(true)
    szekcio.blur()
    expect(szekcio.hasAttribute('tabindex')).toBe(false)
    expect(ideiglenesek.size).toBe(0)
  })

  it('a MÁR fókuszálható célra nem írunk tabindexet (nem vesszük ki a Tab-sorrendből)', () => {
    // Natívan fókuszálható cél (pl. `a[href]` vagy `button`): `tabIndex` 0.
    const gomb = new ProbaElem(0)
    fokuszCelra(gomb, new Set<FokuszCel>())
    expect(gomb.hasAttribute('tabindex')).toBe(false)
    expect(gomb.fokuszHivasok).toEqual([{ preventScroll: true }])
  })

  it('a kézzel beállított tabindexhez sem nyúlunk hozzá', () => {
    const sajatSorrendu = new ProbaElem(-1)
    sajatSorrendu.setAttribute('tabindex', '0')
    fokuszCelra(sajatSorrendu, new Set<FokuszCel>())
    expect(sajatSorrendu.getAttribute('tabindex')).toBe('0')
  })

  it('ismételt ugrás ugyanarra a célra nem duplázza a nyilvántartást', () => {
    const szekcio = new ProbaElem(-1)
    const ideiglenesek = new Set<FokuszCel>()
    fokuszCelra(szekcio, ideiglenesek)
    fokuszCelra(szekcio, ideiglenesek)
    expect(ideiglenesek.size).toBe(1)
    expect(szekcio.fokuszHivasok).toHaveLength(2)
  })

  it('a LAPON BELÜLI ág fókuszál is, nemcsak görget', () => {
    const tiszta = kommentNelkul(anchorTsx)
    expect(tiszta).toMatch(
      /azonosOldal\(link\) && link\.hash\.length > 0[\s\S]{0,700}fokuszCelra\(celPont, nyilvantartas\)/,
    )
  })

  it('a lapon belüli fókusz FELTÉTLEN: nincs távolság-küszöb mögé zárva', () => {
    /**
     * MIÉRT KELL EZ A SOR (vezetői javítás, 2026-08-17): a fenti állítás csak a
     * hívás JELENLÉTÉT nézi 700 karakteren belül, a FELTÉTLENSÉGÉT nem. Egy
     * cáfoló ellenőrzés ezt kihasználva a fókuszt távolság-feltétel mögé zárta
     *
     *     if (celPont !== null && hosszuUgras(window.innerHeight * 2, …)) {
     *       fokuszCelra(celPont, nyilvantartas)
     *     }
     *
     * és a fájl 47/47 ZÖLD maradt, `tsc` 0 hibával — vagyis a rontás típushelyes
     * és néma volt, miközben pontosan a hirdetett szabályt sértette.
     *
     * A szabály, amit ez a teszt őriz: a fókuszt a WCAG 2.2 SC 2.4.3 (Focus
     * Order) kívánja, és az NEM ismer távolság-küszöböt. A MOZGÁS rövidítése
     * távolságfüggő (`hosszuUgras`), a FÓKUSZ nem lehet az: rövid ugrásnál is a
     * célra kell kerülnie, különben a billentyűzetes látogató Tab-ja a lap
     * tetejéről folytatná.
     *
     * A vizsgálat a lapon belüli ág törzsét metszi ki, és megköveteli, hogy a
     * `fokuszCelra` hívást körülvevő EGYETLEN feltétel a cél létezésének
     * vizsgálata legyen.
     */
    const tiszta = kommentNelkul(anchorTsx)
    const agKezdet = tiszta.indexOf('azonosOldal(link) && link.hash.length > 0')
    expect(agKezdet, 'nincs meg a lapon belüli ág').toBeGreaterThan(-1)
    const agVege = tiszta.indexOf('fokuszCelra(celPont, nyilvantartas)', agKezdet)
    expect(agVege, 'nincs meg a fókusz-hívás az ágban').toBeGreaterThan(agKezdet)

    // A hívás előtti utolsó feltétel: KIZÁRÓLAG a cél létezésének vizsgálata.
    const elotte = tiszta.slice(agKezdet, agVege)
    const feltetelek = [...elotte.matchAll(/if \(([^)]*)\)/gu)].map((t) => t[1].trim())
    const utolso = feltetelek.at(-1)
    expect(utolso, 'a fókusz-hívás előtt nincs feltétel').toBeDefined()
    expect(utolso, 'a fókuszt csak a cél LÉTEZÉSE feltételezheti').toBe('celPont !== null')

    // És a hívás előtti szakaszban NINCS távolság-vizsgálat a fókusz körül:
    // a `hosszuUgras` csak a MOZGÁS ágában (a `rovidit`-en belül) élhet.
    const celPontUtan = elotte.slice(elotte.indexOf('const celPont'))
    expect(celPontUtan, 'távolság-küszöb került a fókusz elé').not.toContain('hosszuUgras')
  })

  it('a hash-váltás (böngésző vissza-gombja) is a célra teszi a fókuszt', () => {
    const tiszta = kommentNelkul(anchorTsx)
    expect(tiszta).toMatch(/const onHashChange = \(\) => \{[\s\S]{0,300}fokuszCelra\(/)
  })

  it('LAPVÁLTÁS és hideg betöltés: az útvonalra fűzött hatás fókuszál', () => {
    // A komponens az elrendezésben ül, tehát útvonalváltáskor nem szerelődik
    // újra — a cél a kattintás pillanatában még nincs is a DOM-ban.
    const tiszta = kommentNelkul(anchorTsx)
    expect(tiszta).toContain("import { usePathname } from 'next/navigation'")
    expect(tiszta).toMatch(/fokuszCelra\(celPont, ideiglenesek\.current\)[\s\S]{0,60}\}, \[utvonal\]\)/)
  })

  it('a HIDEG betöltés kimarad: ott a böngésző már a célra állítja a kiindulópontot', () => {
    // Mérve: hideg betöltés után az első Tab a célon BELÜLI gombra visz
    // (sequential focus navigation starting point). Programozott fókusz ott
    // csak kárt tenne: felhasználói esemény híján a böngésző gyűrűt rajzolna
    // a szekció köré minden látogatónak (mérve: outline solid 3px).
    const tiszta = kommentNelkul(anchorTsx)
    expect(tiszta).toMatch(/if \(elsoFutas\.current\) \{\s*elsoFutas\.current = false\s*return/)
  })

  it('a fókusz-ág CSÖKKENTETT MOZGÁS mellett is fut (a két dolog nem ugyanaz)', () => {
    const tiszta = kommentNelkul(anchorTsx)
    // Nincs korai kilépés a hatás elején: a mozgás-korlát csak a mozgást veszi el.
    expect(tiszta).not.toMatch(/\.matches\)\s*\{\s*\n\s*return/)
    // A fókuszálás egyik hívási helye sincs mozgás-őrszem mögé zárva.
    for (const [, elotte] of tiszta.matchAll(/([\s\S]{0,200})fokuszCelra\(/g)) {
      expect(elotte).not.toContain('csokkentettMozgas()')
    }
  })

  it('leszereléskor a bent maradt ideiglenes tabindexek is lekerülnek', () => {
    const tiszta = kommentNelkul(anchorTsx)
    expect(tiszta).toMatch(
      /return \(\) => \{[\s\S]{0,400}for \(const elem of nyilvantartas\) \{\s*elem\.removeAttribute\('tabindex'\)/,
    )
  })
})
