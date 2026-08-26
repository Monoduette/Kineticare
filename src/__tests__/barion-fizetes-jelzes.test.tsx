import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CheckoutForm } from '../components/checkout/CheckoutForm'
import {
  BARION_CIM,
  BARION_KEZDOLAP_CIM_ID,
  BARION_KEZDOLAP_SZOVEG,
  BARION_LOGOSOR_ALT,
  BARION_LOGOSOR_MAGASSAG,
  BARION_LOGOSOR_SRC,
  BARION_LOGOSOR_SZELESSEG,
  BARION_PENZTAR_SZOVEG,
  BarionFizetesJelzes,
} from '../components/checkout/BarionFizetesJelzes'
import { HomeView } from '../components/content/HomeView'
import type { Page, Product } from '../payload-types'

/**
 * ŐR — BARION FIZETÉSI JELZÉS (kezdőlap + pénztár).
 * A Barion elfogadóhely-jóváhagyásának KÖTELEZŐ tétele: „…előfeltétele az
 * elfogadóhely jóváhagyásának, hogy a logósort módosítás nélkül feltüntesd a
 * webshopod fő- és fizetési oldalán."
 * A MÉRT KIINDULÁS (2026-08-17): a felületen SEHOL nem jelent meg a Barion mint
 */

const REPO = fileURLToPath(new URL('..', import.meta.url))
const GYOKER = join(REPO, '..')

const olvas = (relativUt: string): string => readFileSync(join(GYOKER, relativUt), 'utf8')

const LOGOSOR_UT = 'public/assets/barion/barion-smart-banner-light.svg'
const CSS_UT = 'src/app/(frontend)/styles/blocks/barion-fizetes.css'

/**
 * A Barion `barion-smart-payment-banner-EU.zip` csomagjából (2026-08-17-i
 * letöltés) származó `svg/barion-smart-banner-light.svg` ellenőrzőösszege.
 * A forrást és a dátumot a public/assets/barion/README.md rögzíti.
 */
const HIVATALOS_SHA256 = '5174575fe2da41b985688c67099e2cfe4260516af8c311b8dec8494a9ced48ec'

function render(node: ReactNode): string {
  return renderToStaticMarkup(createElement(Fragment, null, node))
}

function termek(overrides: Partial<Product> & { id: number }): Product {
  return {
    sku: `Kurzus ${overrides.id}`,
    shortDescription: 'Otthon végezhető program.',
    coverImage: null,
    priceInHUF: 19990,
    priceInHUFEnabled: true,
    status: 'published',
    updatedAt: '',
    createdAt: '',
    ...overrides,
  } as unknown as Product
}

function kezdolapOldal(layout: NonNullable<Page['layout']>): Page {
  return {
    id: 1,
    title: 'Hatékony és biztonságos módszerek a kéz és a kar fájdalmai ellen',
    slug: 'kezdolap',
    excerpt: 'Bevezető.',
    content: null,
    layout,
    heroImage: null,
    seoTitle: null,
    seoDescription: null,
    ogImage: null,
    status: 'published',
    publishedAt: null,
    order: null,
    updatedAt: '',
    createdAt: '',
  } as unknown as Page
}

/** A pénztári űrlap markupja (fizetős vagy ingyenes termékkel). */
function penztarMarkup({ isFree }: { isFree: boolean }): string {
  return render(
    createElement(CheckoutForm, {
      product: {
        id: 1,
        sku: 'Teszt kurzus',
        priceHuf: isFree ? null : 19990,
        isFree,
      },
      user: null,
      alreadyPurchased: false,
    }),
  )
}

// ───────────────────────────────────────────────────────────────────────────
// KONTRASZT-MOTOR — a WCAG 2.2 normatív definíciója
// https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
// https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
// ───────────────────────────────────────────────────────────────────────────

type RGB = readonly [number, number, number]

const csatorna = (c: number): number => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

const luminancia = ([r, g, b]: RGB): number =>
  0.2126 * csatorna(r) + 0.7152 * csatorna(g) + 0.0722 * csatorna(b)

const arany = (a: RGB, b: RGB): number => {
  const la = luminancia(a)
  const lb = luminancia(b)
  const [vilagos, sotet] = la >= lb ? [la, lb] : [lb, la]
  return (vilagos + 0.05) / (sotet + 0.05)
}

const hexRgb = (hex: string): RGB => {
  const jel = hex.trim().replace('#', '')
  const teljes =
    jel.length === 3
      ? jel
          .split('')
          .map((c) => c + c)
          .join('')
      : jel
  return [
    Number.parseInt(teljes.slice(0, 2), 16),
    Number.parseInt(teljes.slice(2, 4), 16),
    Number.parseInt(teljes.slice(4, 6), 16),
  ]
}

/** A tokens.css `--kc-*` deklarációi, `var()`-láncokkal együtt feloldva. */
function tokenTerkep(): Map<string, string> {
  const forras = olvas('src/app/(frontend)/styles/tokens.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const nyers = new Map<string, string>()
  for (const talalat of forras.matchAll(/^\s*(--kc-[a-z0-9-]+):\s*([^;]+);/gm)) {
    nyers.set(talalat[1], talalat[2].trim())
  }
  const feloldott = new Map<string, string>()
  const felold = (nev: string, melyseg = 0): string => {
    const ertek = nyers.get(nev)
    if (ertek === undefined || melyseg > 8) {
      return ''
    }
    const hivatkozas = /^var\((--kc-[a-z0-9-]+)\)$/.exec(ertek)
    return hivatkozas === null ? ertek : felold(hivatkozas[1], melyseg + 1)
  }
  for (const nev of nyers.keys()) {
    feloldott.set(nev, felold(nev))
  }
  return feloldott
}

/** Egy CSS-szabály törzse a megadott szelektorra (az első előfordulás). */
function szabalyTorzs(css: string, szelektor: string): string {
  const minta = new RegExp(
    `${szelektor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
    'm',
  )
  const talalat = minta.exec(css.replace(/\/\*[\s\S]*?\*\//g, ''))
  return talalat === null ? '' : talalat[1]
}

/** `1.5rem` / `24px` → CSS-pixel (1rem = 16px). */
function pixel(ertek: string): number {
  const rem = /^([\d.]+)rem$/.exec(ertek.trim())
  if (rem !== null) {
    return Number.parseFloat(rem[1]) * 16
  }
  const px = /^([\d.]+)px$/.exec(ertek.trim())
  return px === null ? Number.NaN : Number.parseFloat(px[1])
}

// ───────────────────────────────────────────────────────────────────────────
// 1. A LOGÓ EREDETE — hivatalos csomag, változtatás nélkül
// ───────────────────────────────────────────────────────────────────────────

describe('Barion logósor: hivatalos eszköz, módosítás nélkül', () => {
  it('a kiszolgált SVG BITRE a Barion hivatalos csomagjából való (SHA-256)', () => {
    const tartalom = readFileSync(join(GYOKER, LOGOSOR_UT))
    const lenyomat = createHash('sha256').update(tartalom).digest('hex')
    expect(
      lenyomat,
      'A logósor eltér a Barion csomagjában lévő fájltól. A Barion kikötése: „a logósort MÓDOSÍTÁS NÉLKÜL feltüntesd". Ha új csomag jött, a public/assets/barion/README.md-t és ezt az összeget együtt kell frissíteni.',
    ).toBe(HIVATALOS_SHA256)
  })

  it('a komponens pontosan ezt a fájlt hivatkozza, az eredeti rajzaránnyal', () => {
    expect(BARION_LOGOSOR_SRC).toBe(`/${LOGOSOR_UT.replace(/^public\//, '')}`)
    const svg = olvas(LOGOSOR_UT)
    expect(svg).toContain(`viewBox="0 0 ${BARION_LOGOSOR_SZELESSEG} ${BARION_LOGOSOR_MAGASSAG}"`)
  })

  it('az SVG nem tartalmaz scriptet, eseménykezelőt vagy külső hivatkozást', () => {
    // Az SVG-t közvetlenül, `<img>`-ben szolgáljuk ki. Ez a beágyazási mód
    // önmagában is inaktívvá teszi a scriptet, de a fájl tisztaságát akkor is
    // rögzítjük: egy későbbi inline beemelés így nem hozhat be aktív kódot.
    const svg = olvas(LOGOSOR_UT)
    expect(svg).not.toMatch(/<script/i)
    expect(svg).not.toMatch(/\son[a-z]+\s*=/i)
    expect(svg).not.toMatch(/<foreignObject/i)
    const kulsoHivatkozasok = [...svg.matchAll(/https?:\/\/[^"' )]+/g)].map((t) => t[0])
    expect(kulsoHivatkozasok).toEqual(['http://www.w3.org/2000/svg'])
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 2. A PÉNZTÁR — a fizetőgomb mellett, de csak fizetős terméken
// ───────────────────────────────────────────────────────────────────────────

describe('Pénztár: a fizetési jelzés a beküldőgomb mellett áll', () => {
  it('fizetős terméknél megjelenik a hivatalos logósor és a magyarázat', () => {
    const html = penztarMarkup({ isFree: false })
    expect(html).toContain(BARION_LOGOSOR_SRC)
    expect(html).toContain(BARION_LOGOSOR_ALT)
    expect(html).toContain(BARION_PENZTAR_SZOVEG)
    expect(html).toContain(BARION_CIM)
  })

  it('a jelzés a beküldőgomb ELŐTT áll a dokumentumban (a döntés előtt olvassa el)', () => {
    const html = penztarMarkup({ isFree: false })
    const jelzesIndex = html.indexOf('kc-barion--penztar')
    const gombIndex = html.indexOf('type="submit"')
    expect(jelzesIndex).toBeGreaterThan(-1)
    expect(gombIndex).toBeGreaterThan(-1)
    expect(
      jelzesIndex,
      'A Barion-jelzésnek a fizetőgomb ELŐTT kell állnia: ez az utolsó, amit a vevő a kattintás előtt elolvas (Baymard: a biztonsági jelzés a beviteli/döntési területen belül hasson).',
    ).toBeLessThan(gombIndex)
  })

  it('INGYENES terméknél NEM jelenik meg (ott nincs Barion-fizetés)', () => {
    const html = penztarMarkup({ isFree: true })
    expect(
      html.includes(BARION_LOGOSOR_SRC),
      'Ingyenes kurzusnál a pénztár fizetés nélkül nyit hozzáférést, Barion felé semmi nem megy. A fizetési jelzés ott hazugság lenne.',
    ).toBe(false)
    expect(html).not.toContain(BARION_PENZTAR_SZOVEG)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 3. A KEZDŐLAP — mindkét renderelési ágon
// ───────────────────────────────────────────────────────────────────────────

describe('Kezdőlap: a fizetési jelzés mindkét ágon kint van', () => {
  it('a rögzített (CMS-szekciósor nélküli) kezdőlapon megjelenik', () => {
    const html = render(
      createElement(HomeView, {
        home: null,
        products: [termek({ id: 1 })],
        posts: [],
      }),
    )
    expect(html).toContain(BARION_LOGOSOR_SRC)
    expect(html).toContain(BARION_KEZDOLAP_SZOVEG)
  })

  it('a CMS-szekciósoros kezdőlapon is megjelenik (a szerkesztő nem tudja kikapcsolni)', () => {
    const html = render(
      createElement(HomeView, {
        home: kezdolapOldal([
          {
            blockType: 'welcome',
            id: 'welcome-1',
            title: 'Üdv',
            body: null,
          },
        ] as unknown as NonNullable<Page['layout']>),
        products: [termek({ id: 1 })],
        posts: [],
      }),
    )
    expect(
      html.includes(BARION_LOGOSOR_SRC),
      'A logósor a FŐOLDALON kötelező. Ha csak a rögzített ágon renderelnénk, egy CMS-szekciósor beállítása némán levenné a lapról.',
    ).toBe(true)
  })

  it('a kezdőlapi szekciónak van hozzáférhető NEVE (aria-labelledby → létező címsor)', () => {
    const html = render(createElement(BarionFizetesJelzes, { hely: 'kezdolap' }))
    expect(html).toContain(`aria-labelledby="${BARION_KEZDOLAP_CIM_ID}"`)
    expect(html).toMatch(new RegExp(`<h2[^>]*id="${BARION_KEZDOLAP_CIM_ID}"[^>]*>`))
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 4. AKADÁLYMENTESSÉG ÉS MIKROSZÖVEG
// ───────────────────────────────────────────────────────────────────────────

describe('A jelzés akadálymentessége és szövege', () => {
  it('a két helyen UGYANAZ a kép és UGYANAZ az alt (WCAG 2.2 SC 3.2.4)', () => {
    const kezdolap = render(createElement(BarionFizetesJelzes, { hely: 'kezdolap' }))
    const penztar = render(createElement(BarionFizetesJelzes, { hely: 'penztar' }))
    const kep = (html: string): string => /<img[^>]*>/.exec(html)?.[0] ?? ''
    const src = (tag: string): string => /src="([^"]*)"/.exec(tag)?.[1] ?? ''
    const alt = (tag: string): string => /alt="([^"]*)"/.exec(tag)?.[1] ?? ''
    expect(src(kep(kezdolap))).toBe(src(kep(penztar)))
    expect(alt(kep(kezdolap))).toBe(alt(kep(penztar)))
    expect(alt(kep(kezdolap))).not.toBe('')
  })

  it('az alt megnevezi a fizetési módokat (SC 1.1.1: a kép INFORMÁCIÓT hordoz)', () => {
    for (const mod of ['Barion', 'Mastercard', 'VISA', 'Apple Pay', 'Google Pay']) {
      expect(BARION_LOGOSOR_ALT).toContain(mod)
    }
  })

  it('a vevői szöveg megmondja, mi történik a kártyaadattal és hova kerül a fizetés', () => {
    for (const szoveg of [BARION_KEZDOLAP_SZOVEG, BARION_PENZTAR_SZOVEG]) {
      expect(szoveg).toContain('Barion')
      expect(szoveg.toLowerCase()).toContain('kártyaadat')
    }
    expect(BARION_PENZTAR_SZOVEG).toContain('visszatérsz')
    expect(BARION_KEZDOLAP_SZOVEG).toContain('nem látja és nem tárolja')
  })

  it('a vevői szövegben nincs gondolatjel és nincs kvirtmínusz (magyar mikroszöveg)', () => {
    // A karaktereket kódpontból építjük, hogy maga az őrfájl se hordozza őket.
    const kvirt = String.fromCharCode(0x2014)
    const gondolatjel = String.fromCharCode(0x2013)
    for (const szoveg of [
      BARION_CIM,
      BARION_LOGOSOR_ALT,
      BARION_KEZDOLAP_SZOVEG,
      BARION_PENZTAR_SZOVEG,
    ]) {
      expect(szoveg).not.toContain(kvirt)
      expect(szoveg).not.toContain(gondolatjel)
    }
  })

  it('a komponens nem hoz be interaktív elemet, tehát új érintőcél sem keletkezik', () => {
    // WCAG 2.2 SC 2.5.8 a POINTER-CÉLOKRA vonatkozik. A jelzésben szándékosan
    // nincs link/gomb: a fizetés pillanatában egy kifelé mutató link kivinné a
    // vevőt a vásárlásból. Ha ide valaha link kerül, ez az őr kidől, és a
    // 24×24 CSS px-es célméretet KÜLÖN mérni kell.
    for (const hely of ['kezdolap', 'penztar'] as const) {
      const html = render(createElement(BarionFizetesJelzes, { hely }))
      expect(html).not.toMatch(/<a[\s>]/)
      expect(html).not.toMatch(/<button[\s>]/)
      expect(html).not.toMatch(/<input[\s>]/)
    }
  })

  it('a címsor DOM-szövege mondatkezdő nagybetűs (a verzál csak CSS-transzformáció)', () => {
    // docs/ui-sztenderdek.md M-4. A kezdőlapi csík `.kc-eyebrow` nagybetűs
    // MEGJELENÉST kap; a felolvasott szöveg attól még normál írásmódú marad.
    expect(BARION_CIM).toBe(BARION_CIM.charAt(0) + BARION_CIM.slice(1).toLowerCase())
    const css = olvas('src/app/(frontend)/styles/content.css')
    expect(szabalyTorzs(css, '.kc-eyebrow')).toContain('text-transform: uppercase')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 5. MÉRÉS — kontraszt és 320 px-es reflow
// ───────────────────────────────────────────────────────────────────────────

describe('Mért kontraszt (WCAG 2.2 SC 1.4.3)', () => {
  const tokenek = tokenTerkep()
  const szin = (nev: string): RGB => {
    const ertek = tokenek.get(nev)
    expect(ertek, `Hiányzó vagy feloldhatatlan token: ${nev}`).toMatch(/^#[0-9a-fA-F]{3,8}$/)
    return hexRgb(ertek as string)
  }

  const parok = [
    // Kezdőlapi csík — a lap-háttéren (paper).
    ['kezdőlapi címsor (primary a paperen)', '--kc-color-primary', '--kc-color-bg'],
    ['kezdőlapi szöveg (muted a paperen)', '--kc-color-text-muted', '--kc-color-bg'],
    // Pénztári kártya — fehér, megemelt felületen.
    ['pénztári címsor (text a kártyán)', '--kc-color-text', '--kc-color-surface-raised'],
    ['pénztári szöveg (muted a kártyán)', '--kc-color-text-muted', '--kc-color-surface-raised'],
  ] as const

  for (const [nev, elo, hatter] of parok) {
    it(`${nev} ≥ 4,5:1`, () => {
      const mert = arany(szin(elo), szin(hatter))
      expect(mert, `${nev}: mért ${mert.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('a jelzés szövege KIZÁRÓLAG a mért szerep-tokeneket használja (nyers hex nincs)', () => {
    const css = olvas(CSS_UT).replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(szabalyTorzs(css, '.kc-barion__szoveg')).toContain('var(--kc-color-text-muted)')
  })
})

describe('Mért elrendezés: 320 px-en nincs vízszintes túlcsordulás (SC 1.4.10)', () => {
  const tokenek = tokenTerkep()
  const css = olvas(CSS_UT)
  const logosor = szabalyTorzs(css, '.kc-barion__logosor')

  it('a logósor arányosan méreteződik: 100% szélesség, automatikus magasság, rögzített arány', () => {
    expect(logosor).toContain('width: 100%')
    expect(logosor).toContain('height: auto')
    expect(logosor).toContain(
      `aspect-ratio: ${BARION_LOGOSOR_SZELESSEG} / ${BARION_LOGOSOR_MAGASSAG}`,
    )
  })

  it('semmilyen fix minimális szélesség nincs a logósoron (ez lenne az EGYETLEN túlcsordulási út)', () => {
    expect(logosor).not.toMatch(/min-width/)
    // A `max-width` megengedett (felső fék, a kötőjel miatt nem illeszkedik) és
    // a `width: 100%` is (arányos); a FIX hosszegység (px/rem/em) nem.
    expect(logosor).not.toMatch(/(^|[^-])width:\s*[\d.]+(px|rem|em)/)
  })

  it('320 px-es nézetablakon a számolt szélességek beleférnek', () => {
    const oldalMargo = pixel(tokenek.get('--kc-container-gutter') ?? '')
    const kartyaBelso = pixel(
      /padding:\s*([^;]+);/
        .exec(szabalyTorzs(olvas('src/app/(frontend)/styles/ui.css'), '.kc-card--padded'))?.[1]
        ?.trim()
        .replace(/^var\((--kc-[a-z0-9-]+)\)$/, (_, nev: string) => tokenek.get(nev) ?? '') ?? '',
    )
    expect(oldalMargo).toBeGreaterThan(0)
    expect(kartyaBelso).toBeGreaterThan(0)

    const nezetablak = 320
    // A `kc-container` a nézetablak teljes szélességét kapja, oldalanként a
    // margóval; a pénztári kártya ezen belül még a belső margóját és az 1px
    // keretét is leveszi.
    const kezdolapSzelesseg = nezetablak - 2 * oldalMargo
    const penztarSzelesseg = kezdolapSzelesseg - 2 * kartyaBelso - 2

    expect(kezdolapSzelesseg).toBe(272)
    expect(penztarSzelesseg).toBe(222)
    expect(kezdolapSzelesseg).toBeLessThanOrEqual(nezetablak)
    expect(penztarSzelesseg).toBeLessThanOrEqual(kezdolapSzelesseg)

    // A logósor a rendelkezésre álló szélességet veszi fel (a 22rem-es fék
    // ennél jóval nagyobb), a magasság az arányból jön.
    const arányos = (szelesseg: number): number =>
      (szelesseg * BARION_LOGOSOR_MAGASSAG) / BARION_LOGOSOR_SZELESSEG
    expect(arányos(kezdolapSzelesseg)).toBeCloseTo(51.81, 1)
    expect(arányos(penztarSzelesseg)).toBeCloseTo(42.29, 1)
  })

  it('a sorhossz mindkét helyen a 45–85 karakteres sávban marad', () => {
    // A repó MÉRT állandója (tokens.css „Mérték" szakasza, fontTools/hmtx a
    // Nunito Sans wght 400 példányán, n = 5981 karakter): az átlagos karakter
    // 0,4542em. A karakterszám ebből és a mértékből SZÁMOLHATÓ, nem becslés.
    const ATLAG_KARAKTER_EM = 0.4542
    const karakter = (mertekRem: number, betuPx: number): number =>
      (mertekRem * 16) / (ATLAG_KARAKTER_EM * betuPx)

    const mertek = (torzs: string): string =>
      /max-width:\s*var\((--kc-measure[a-z-]*)\)/.exec(torzs)?.[1] ?? ''
    const remErtek = (token: string): number => pixel(tokenek.get(token) ?? '') / 16

    // Kezdőlap: S lépcső, felső vége 0,875rem = 14px.
    const kezdolapMertek = mertek(szabalyTorzs(css, '.kc-barion--kezdolap .kc-barion__szoveg'))
    expect(kezdolapMertek).not.toBe('')
    const kezdolapKarakter = karakter(remErtek(kezdolapMertek), 14)
    expect(kezdolapKarakter).toBeGreaterThanOrEqual(45)
    expect(
      kezdolapKarakter,
      `A kezdőlapi csík sora ${kezdolapKarakter.toFixed(1)} karakter — a 85-ös sávhatár és a WCAG 2.2 SC 1.4.8 80-as plafonja alatt kell maradnia.`,
    ).toBeLessThanOrEqual(80)

    // Pénztár: M lépcső, felső vége 1,125rem = 18px.
    const penztarMertek = mertek(szabalyTorzs(css, '.kc-barion__szoveg'))
    expect(penztarMertek).not.toBe('')
    const penztarKarakter = karakter(remErtek(penztarMertek), 18)
    expect(penztarKarakter).toBeGreaterThanOrEqual(45)
    expect(penztarKarakter).toBeLessThanOrEqual(80)
  })

  it('a mobil (egy oszlopos) elrendezést csak 900 px FÖLÖTT váltja rácsra', () => {
    // A 320 px-es mérés csak akkor marad érvényes, ha a többoszlopos rács a
    // kis nézetablakon egyáltalán be sem lép.
    const media = /@media\s*\(min-width:\s*900px\)/.exec(css)
    expect(media).not.toBeNull()
    const racsIndex = css.indexOf('grid-template-columns')
    expect(racsIndex).toBeGreaterThan((media as RegExpExecArray).index)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// A BARION SAJÁT FEJLESZTŐI ÚTMUTATÓJÁNAK NORMATÍV SZABÁLYAI
//
// Forrás: a hivatalos `barion-smart-payment-banner-EU.zip` csomag
// „Dev guide.pdf" fájlja (Smart Payment Banner Developer Guidelines, 2025.
// október; a csomag letöltése és ellenőrzőösszege: public/assets/barion/README.md).
//
// A PDF beágyazott betűi részhalmaz-kódoltak, ezért a szövege csak
// betűtípusonként külön ToUnicode-táblával fejthető vissza — egy összevont
// táblával kevert, olvashatatlan eredményt ad. A visszafejtett, SZÓ SZERINTI
// kikötések, amelyekre az alábbi állítások épülnek:
//
//   „Do not stretch, crop, or distort the logos."
//   „Maintain original aspect ratios."
//   „Do not add shadows, borders, or effects."
//   „On smaller screens, switch to the medium or small banner version."
//   „Maintain clear spacing around the banner (at least 8px padding from
//    other elements)."
//   „Optimize image files for web (use SVG or high-resolution PNG)."
//
// MIÉRT EGYETLEN SVG, HÁROM MÉRET HELYETT: a csomag három mérete (Large 1133×215,
// Medium 892×165, Small 602×108) KIZÁRÓLAG PNG-ként létezik; az `svg/` mappában
// méretenkénti változat nincs, csak `barion-smart-banner-light.svg` és
// `-dark.svg`. A „kisebb képernyőn kisebb változat" kikötés tehát a raszteres
// útra vonatkozik; az útmutató által kifejezetten ajánlott SVG-nél ugyanezt az
// arányos kicsinyítés adja, veszteség nélkül. Ezt a döntést itt rögzítjük, hogy
// egy későbbi „raktuk be a PNG-t is" kör ne látszódjon javításnak.
// ───────────────────────────────────────────────────────────────────────────

describe('A Barion fejlesztői útmutatójának mért betartása', () => {
  const css = olvas(CSS_UT)
  const tokenek = tokenTerkep()
  const logosor = szabalyTorzs(css, '.kc-barion__logosor')

  it('a logósoron NINCS árnyék, keret vagy effekt („Do not add shadows, borders, or effects")', () => {
    for (const tiltott of ['box-shadow', 'border', 'outline', 'filter', 'backdrop-filter']) {
      expect(
        logosor,
        `A hivatalos logósorra nem kerülhet ${tiltott} — a Barion fejlesztői útmutatója kifejezetten tiltja.`,
      ).not.toContain(tiltott)
    }
  })

  it('a logósor nem nyúlik, nem vágódik és nem torzul („Do not stretch, crop, or distort")', () => {
    // Az arány rögzített (ezt a reflow-blokk is méri), itt a HÁROM torzító út
    // hiányát mondjuk ki: a nem arányos illesztés, a vágás és a skálázás.
    expect(logosor).not.toMatch(/object-fit:\s*(cover|fill)/)
    expect(logosor).not.toContain('clip-path')
    expect(logosor).not.toMatch(/transform:\s*scale/)
    expect(logosor).toContain(
      `aspect-ratio: ${BARION_LOGOSOR_SZELESSEG} / ${BARION_LOGOSOR_MAGASSAG}`,
    )
  })

  it('a logósor körül MINDKÉT helyen legalább 8px szabad tér marad', () => {
    // Az útmutató számszerű kikötése. A jelzés belső ritmusát flex-rés adja, a
    // külső teret a kezdőlapon a szekció függőleges margója, a pénztárban a
    // kártya belső margója — mindhármat tokenről, tehát mérhetően.
    const res = (torzs: string): number =>
      pixel(
        /gap:\s*(?:[^;]*\s)?var\((--kc-space-\d)\)/
          .exec(torzs)?.[1]
          ?.replace(/^(.*)$/, (_, nev: string) => tokenek.get(nev) ?? '') ?? '',
      )

    const kezdolapRes = res(szabalyTorzs(css, '.kc-barion--kezdolap .kc-barion__inner'))
    const penztarRes = res(szabalyTorzs(css, '.kc-barion--penztar'))

    expect(kezdolapRes).toBeGreaterThanOrEqual(8)
    expect(penztarRes).toBeGreaterThanOrEqual(8)

    // A kezdőlapi csík függőleges saját tere a hajszálvonal alatt.
    const kezdolapBelso = pixel(
      /padding-block:\s*var\((--kc-space-\d)\)/
        .exec(szabalyTorzs(css, '.kc-barion--kezdolap .kc-barion__inner'))?.[1]
        ?.replace(/^(.*)$/, (_, nev: string) => tokenek.get(nev) ?? '') ?? '',
    )
    expect(kezdolapBelso).toBeGreaterThanOrEqual(8)
  })

  it('a kiszolgált eszköz SVG (az útmutató által ajánlott formátum)', () => {
    expect(BARION_LOGOSOR_SRC.endsWith('.svg')).toBe(true)
    expect(olvas(LOGOSOR_UT).trimStart().startsWith('<')).toBe(true)
  })
})
