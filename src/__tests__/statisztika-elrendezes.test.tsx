import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { StatisticsReport } from '../components/admin/StatisticsReport'
import {
  cardStyle,
  cardValueStyle,
  leadStyle,
  noticeStyle,
  pageStyle,
  rowLinkStyle,
} from '../components/admin/statistics/styles'
import type { CourseEngagementReport } from '../lib/statistics/engagement'
import type { RevenueReport } from '../lib/statistics/revenue'

/**
 * ŐR — A STATISZTIKA NÉZET SZÉLESSÉGI RENDSZERE.
 *
 * A tulajdonos 2026-08-21-i panasza: a nézet „nem oldalszéles". A gyökérok egy
 * `max-width: 1024px` volt a lap-héjon, a Payload tartalmi sávja viszont ennél
 * jóval szélesebb. MÉRVE (Chromium, a DefaultTemplate geometriájával, nyitott
 * 275 px-es navigációval): 1920 px-es nézetablakon a sáv 1645 px, a nézet
 * 1024 px — a kitöltöttség 62,2%.
 *
 * Ez a fájl NEM string-egyezést néz: a stílus-objektumból SZÁMOLJA ki, mekkora
 * lesz a lap és a tartalma egy adott sávszélességen, a custom.scss VALÓDI
 * tokenjeivel. Egy string-állítás nem tudna különbséget tenni 1024 px és
 * „kitölti a sávot" között — pontosan ezért csúszhatott át a hiba eddig.
 *
 * Amit őriz:
 *   1. a lap kitölti a Payload tartalmi sávját (1280 / 1440 / 1920 px),
 *   2. ultraszéles kijelzőn a TARTALOM az 1584 px-es plafonnál megáll
 *      (IBM Carbon 2x rács max-töréspontja),
 *   3. a folyószöveg mértéke a mért 45–85 karakteres sávban marad,
 *   4. 320 px-en semmi nem lóg ki görgetőkonténeren kívül (WCAG 2.2 SC 1.4.10
 *      Reflow, G225 technikával a táblákra),
 *   5. a nézet nem tartalmaz nyers színértéket (minden szín tokenről jön),
 *   6. a sorbeli link érintőcélja a repó 44 px-es célértékét tartja a
 *      Payload kisebb (12 px-es) gyökérméreténél is.
 */

const REPO = process.cwd()
const BRAND_CSS = readFileSync(join(REPO, 'src', 'app', '(payload)', 'custom.scss'), 'utf8')

/** A Payload admin mért geometriája (@payloadcms/ui app.scss + vars.scss). */
const NAV_SZELESSEG = 275
/**
 * A 1024 px alatti gyökérméret: a Payload 12 px-e, HACSAK a custom.scss
 * admin téma-rétege felül nem írja (admin-audit K31, 2026-09-22: 13 px).
 * A VALÓDI custom.scss-ből olvassuk, hogy a modell ne térjen el attól, amit
 * a böngésző rajzol.
 */
const KOZEPES_GYOKER = ((): number => {
  const kommentNelkul = BRAND_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  const felulirt = /@media \(max-width: 1024px\)\s*\{\s*html\s*\{\s*font-size:\s*(\d+)px/.exec(
    kommentNelkul,
  )?.[1]
  return felulirt === undefined ? 12 : Number(felulirt)
})()
function payloadGyoker(nezetablak: number): number {
  // html { font-size: 13px }, mid-break (max-width: 1024px) → a Payloadban
  // 12px, a custom.scss téma-rétegével 13px.
  return nezetablak <= 1024 ? KOZEPES_GYOKER : 13
}
function payloadGutter(nezetablak: number): number {
  // --gutter-h: base(3) = 60px; mid-break → base(2) = 40px; small-break → base(0.8) = 16px.
  if (nezetablak <= 768) return 16
  if (nezetablak <= 1024) return 40
  return 60
}
function payloadSav(nezetablak: number): number {
  // A navigáció 768 px alatt átfedésben van, nem szűkíti a sávot.
  return nezetablak <= 768 ? nezetablak : nezetablak - NAV_SZELESSEG
}

/* ─────────────────────── CSS-hossz kiértékelő ───────────────────────
   Csak azt a nyelvtant ismeri, amit a nézet ténylegesen használ:
   var() fallbackkal, calc(), max(), min(), + - * /, px, rem, %. */

type Valtozok = Record<string, string>

/** A .kc-adminstat blokk `--kc-as-*` deklarációi a VALÓDI custom.scss-ből. */
function markaValtozok(gyokerPx: number): Valtozok {
  const kommentNelkul = BRAND_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  const valtozok: Valtozok = {
    '--kc-as-px': `${String(gyokerPx / 13)}px`,
  }
  for (const talalat of kommentNelkul.matchAll(/(--kc-as-[\w-]+)\s*:\s*([^;]+);/g)) {
    const nev = talalat[1]
    const ertek = talalat[2].trim()
    if (nev === '--kc-as-px' || valtozok[nev] !== undefined) continue
    valtozok[nev] = ertek
  }
  return valtozok
}

function behelyettesit(kifejezes: string, valtozok: Valtozok): string {
  let eredmeny = kifejezes
  for (let kor = 0; kor < 12; kor += 1) {
    const kezdet = eredmeny.indexOf('var(')
    if (kezdet === -1) return eredmeny
    let melyseg = 0
    let vege = kezdet
    for (let i = kezdet + 3; i < eredmeny.length; i += 1) {
      if (eredmeny[i] === '(') melyseg += 1
      else if (eredmeny[i] === ')') {
        melyseg -= 1
        if (melyseg === 0) {
          vege = i
          break
        }
      }
    }
    const belso = eredmeny.slice(kezdet + 4, vege)
    const vesszo = belso.indexOf(',')
    const nev = (vesszo === -1 ? belso : belso.slice(0, vesszo)).trim()
    const tartalek = vesszo === -1 ? '' : belso.slice(vesszo + 1).trim()
    const ertek = valtozok[nev] ?? tartalek
    if (ertek === '') throw new Error(`nincs értéke és tartaléka sem: ${nev}`)
    eredmeny = eredmeny.slice(0, kezdet) + `(${ertek})` + eredmeny.slice(vege + 1)
  }
  throw new Error(`túl mély var()-lánc: ${kifejezes}`)
}

/**
 * Kis rekurzív-leszállású kiértékelő. A `%` a megadott alapra vonatkozik
 * (a szülő szélessége), a `rem` a gyökér-betűméretre.
 */
function hossz(kifejezes: string, valtozok: Valtozok, alap: number, gyokerPx: number): number {
  const forras = behelyettesit(kifejezes, valtozok)
  let i = 0
  const atugor = (): void => {
    while (i < forras.length && /\s/.test(forras[i])) i += 1
  }
  const osszeg = (): number => {
    let ertek = szorzat()
    for (;;) {
      atugor()
      const jel = forras[i]
      if (jel !== '+' && jel !== '-') return ertek
      i += 1
      const jobb = szorzat()
      ertek = jel === '+' ? ertek + jobb : ertek - jobb
    }
  }
  const szorzat = (): number => {
    let ertek = egyseg()
    for (;;) {
      atugor()
      const jel = forras[i]
      if (jel !== '*' && jel !== '/') return ertek
      i += 1
      const jobb = egyseg()
      ertek = jel === '*' ? ertek * jobb : ertek / jobb
    }
  }
  const egyseg = (): number => {
    atugor()
    if (forras.startsWith('calc(', i)) {
      i += 5
      const ertek = osszeg()
      atugor()
      i += 1
      return ertek
    }
    if (forras.startsWith('max(', i) || forras.startsWith('min(', i)) {
      const legnagyobb = forras.startsWith('max(', i)
      i += 4
      const tagok: number[] = [osszeg()]
      for (;;) {
        atugor()
        if (forras[i] !== ',') break
        i += 1
        tagok.push(osszeg())
      }
      atugor()
      i += 1
      return legnagyobb ? Math.max(...tagok) : Math.min(...tagok)
    }
    if (forras[i] === '(') {
      i += 1
      const ertek = osszeg()
      atugor()
      i += 1
      return ertek
    }
    if (forras[i] === '-') {
      i += 1
      return -egyseg()
    }
    const szam = /^-?\d+(?:\.\d+)?(px|rem|%)?/.exec(forras.slice(i))
    if (szam === null) throw new Error(`értelmezhetetlen: ${forras.slice(i, i + 24)}`)
    i += szam[0].length
    const nyers = Number(szam[0].replace(/(px|rem|%)$/, ''))
    if (szam[1] === 'rem') return nyers * gyokerPx
    if (szam[1] === '%') return (nyers / 100) * alap
    return nyers
  }
  const eredmeny = osszeg()
  atugor()
  if (i !== forras.length) throw new Error(`maradék a kifejezésben: ${forras.slice(i)}`)
  return eredmeny
}

/** A lap-héj kiszámolt geometriája egy nézetablakon. */
function lapGeometria(nezetablak: number): { sav: number; nezet: number; belso: number } {
  const gyokerPx = payloadGyoker(nezetablak)
  const sav = payloadSav(nezetablak)
  const valtozok = markaValtozok(gyokerPx)
  valtozok['--gutter-h'] = `${String(payloadGutter(nezetablak))}px`
  const szelesseg = pageStyle.width === '100%' ? sav : sav
  const plafon =
    typeof pageStyle.maxWidth === 'string'
      ? hossz(pageStyle.maxWidth, valtozok, sav, gyokerPx)
      : Number.POSITIVE_INFINITY
  const nezet = Math.min(szelesseg, plafon)
  const oldalTerkoz = hossz(String(pageStyle.paddingInline), valtozok, nezet, gyokerPx)
  return { sav, nezet, belso: nezet - 2 * oldalTerkoz }
}

/* ─────────────────────── Minimál HTML-bejáró ─────────────────────── */

interface Elem {
  tag: string
  stilus: string
  osok: string[]
}

/** A renderelt markup elemei az ŐSEIK inline stílusával együtt. */
function elemek(html: string): Elem[] {
  const ures = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'path', 'rect', 'line', 'use'])
  const ki: Elem[] = []
  const verem: string[] = []
  for (const talalat of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|[^>])*?)(\/?)>/g)) {
    const zaro = talalat[1] === '/'
    const tag = talalat[2].toLowerCase()
    const attrs = talalat[3]
    const onzaro = talalat[4] === '/'
    if (zaro) {
      verem.pop()
      continue
    }
    const stilus = /style="([^"]*)"/.exec(attrs)?.[1] ?? ''
    ki.push({ tag, stilus, osok: [...verem] })
    if (!onzaro && !ures.has(tag)) verem.push(stilus)
  }
  return ki
}

function deklaracio(stilus: string, tulajdonsag: string): string | null {
  for (const resz of stilus.split(';')) {
    const ketto = resz.indexOf(':')
    if (ketto === -1) continue
    if (resz.slice(0, ketto).trim() === tulajdonsag) return resz.slice(ketto + 1).trim()
  }
  return null
}

/* ─────────────────────── Próbaadat ─────────────────────── */

const HONAPOK = [
  '2025-09',
  '2025-10',
  '2025-11',
  '2025-12',
  '2026-01',
  '2026-02',
  '2026-03',
  '2026-04',
  '2026-05',
  '2026-06',
  '2026-07',
  '2026-08',
]

const report: RevenueReport = {
  months: HONAPOK.map((month, i) => ({
    month,
    laikusHuf: 320000 + i * 41000,
    szakemberHuf: 180000 + i * 26000,
    totalHuf: 500000 + i * 67000,
    orderCount: 12 + i * 2,
  })),
  totals: { laikusHuf: 6870000, szakemberHuf: 4434000, totalHuf: 11304000, orderCount: 276 },
  courses: [
    {
      title: 'Kézrehabilitáció otthon: az alapok',
      sku: 'kez-rehab-otthon-alap',
      audience: 'laikus',
      revenueHuf: 2385000,
      orderCount: 30,
      itemCount: 30,
      freeItemCount: 4,
    },
    {
      title: 'Kézterápia gyógytornászoknak, 1. modul',
      sku: 'gyogytornasz-kezterapia-modul-1',
      audience: 'szakember',
      revenueHuf: 3600000,
      orderCount: 30,
      itemCount: 30,
      freeItemCount: 1,
    },
  ],
  funnel: {
    created: 7,
    paymentPending: 3,
    paid: 212,
    paymentFailed: 5,
    cancelled: 9,
    refunded: 4,
    other: 0,
    total: 240,
  },
  truncated: false,
}

const engagement: CourseEngagementReport = {
  courses: [
    {
      productId: 11,
      title: 'Kézrehabilitáció otthon: az alapok',
      audience: 'laikus',
      enrolled: 142,
      started: 121,
      completed: 63,
      notStarted: 21,
      totalLessons: 24,
      averagePercent: 58,
      completionRateOfEnrolled: 44,
      completionRateOfStarted: 52,
      notStartedNames: ['Bodor Anna', 'Kis Péter', 'Szabó Éva'],
      notStartedWithoutName: 0,
      omitted: 0,
      truncated: false,
    },
  ],
  truncated: false,
  skipped: 0,
  omitted: 0,
}

const HTML = renderToStaticMarkup(createElement(StatisticsReport, { report, engagement }))

/* ─────────────────────── Az őrök ─────────────────────── */

describe('Statisztika — a lap kitölti a Payload tartalmi sávját', () => {
  // A régi állapot MÉRT kitöltöttsége: 1440 px-en 87,9%, 1920 px-en 62,2%.
  // A küszöb ezért 99%: bármilyen visszatérő fix plafon megbukik rajta.
  it.each([
    [1280, 1005],
    [1440, 1165],
    [1920, 1645],
  ])('%i px-es nézetablakon a nézet a teljes %i px-es sávot elfoglalja', (nezetablak, varhatoSav) => {
    const { sav, nezet } = lapGeometria(nezetablak)
    expect(sav).toBe(varhatoSav)
    expect(nezet / sav).toBeGreaterThanOrEqual(0.99)
  })

  it('a lap oldal-margója a Payload SAJÁT nézet-margója (a bal él egy vonalban a többi nézettel)', () => {
    // --gutter-h: 60 px desktopon, 40 px 1024 alatt, 16 px 768 alatt.
    for (const [nezetablak, varhato] of [
      [1920, 60],
      [1024, 40],
      [768, 16],
    ] as const) {
      const { nezet, belso } = lapGeometria(nezetablak)
      expect((nezet - belso) / 2, `${String(nezetablak)} px`).toBeCloseTo(varhato, 3)
    }
  })

  it('ultraszéles kijelzőn a TARTALOM az 1584 px-es plafonnál megáll, a föld viszont széltől szélig ér', () => {
    // IBM Carbon 2x rács „max" töréspontja: 1584 px (99rem) — a rács-osztály
    // ugyanezt a max-widthet adja (v10 dokumentáció).
    for (const nezetablak of [2560, 3440]) {
      const { sav, nezet, belso } = lapGeometria(nezetablak)
      expect(nezet, `föld ${String(nezetablak)} px-en`).toBe(sav)
      expect(belso, `tartalom ${String(nezetablak)} px-en`).toBeCloseTo(1584, 3)
    }
  })
})

describe('Statisztika — a folyószöveg mértéke a széles lapon sem szalad el', () => {
  const MERT_KARAKTER_PX = 480 / 69 // 480 px-es mérték, MÉRVE 69 karakteres leghosszabb sor

  it.each([
    ['lead', leadStyle.maxWidth],
    ['notice', noticeStyle.maxWidth],
  ])('a %s mérték-tokenről kapja a plafont, nem elemre írt számról', (_nev, ertek) => {
    expect(String(ertek)).toContain('--kc-as-measure')
  })

  it('a mérték MÉRT karakterszáma a 45–85-ös tűrésben és az 50–75-ös célsávban van', () => {
    // A ráta a böngészős mérésből jön: 480 px-es doboz, 16 px Nunito Sans,
    // magyar szöveg, Range API-s soronkénti karakterszámlálás → 58–69 karakter.
    const valtozok = markaValtozok(13)
    const mertek = hossz(String(leadStyle.maxWidth), valtozok, 1525, 13)
    const karakter = mertek / MERT_KARAKTER_PX
    expect(karakter).toBeGreaterThanOrEqual(45)
    expect(karakter).toBeLessThanOrEqual(75)
  })
})

describe('Statisztika — a 32 px-es bevétel a kártyában marad', () => {
  it('a kártya-elrendezés 768 px-en két oszlop, nem négy 129 px-es cella', () => {
    // A fixture 11 304 000 Ft ~168 px a 32 px-es L lépcsőn. A korábbi
    // 128 px-es flex-padló egy sorban tartotta a négy kártyát.
    expect(HTML).toContain('kc-as-card-row')
    expect(HTML).toContain('kc-as-card')
    expect(cardStyle.minWidth).toBeUndefined()
    expect(cardValueStyle.fontSize).toContain('32')
    expect(cardValueStyle.overflowWrap).toBe('break-word')
    expect(BRAND_CSS).toContain('min-width: calc(220 * var(--kc-as-px))')
    expect(BRAND_CSS).toContain('@media (max-width: 1339px)')
    expect(BRAND_CSS).toContain('@media (max-width: 599px)')
  })
})

describe('Statisztika — 320 px-es reflow (WCAG 2.2 SC 1.4.10)', () => {
  it('minden szélesebb elem GÖRGETŐKONTÉNERBEN ül, a lap maga nem görget vízszintesen', () => {
    const nezetablak = 320
    const gyokerPx = payloadGyoker(nezetablak)
    const valtozok = markaValtozok(gyokerPx)
    valtozok['--gutter-h'] = `${String(payloadGutter(nezetablak))}px`
    const { belso } = lapGeometria(nezetablak)
    expect(belso).toBeGreaterThan(0)

    const gorget = (stilus: string): boolean => {
      const ertek = deklaracio(stilus, 'overflow-x')
      return ertek === 'auto' || ertek === 'scroll'
    }

    const vetkesek: string[] = []
    for (const elem of elemek(HTML)) {
      const minSzelesseg = deklaracio(elem.stilus, 'min-width')
      if (minSzelesseg === null) continue
      const px = hossz(minSzelesseg, valtozok, belso, gyokerPx)
      if (px <= belso) continue
      if (elem.osok.some(gorget)) continue
      vetkesek.push(`${elem.tag}: min-width ${String(Math.round(px))}px > ${String(belso)}px`)
    }
    expect(vetkesek).toEqual([])
  })

  it('a lap-héj maga nem visz min-widthet és nem szélesebb 100%-nál', () => {
    expect(pageStyle.minWidth).toBeUndefined()
    expect(pageStyle.width).toBe('100%')
  })

  it('mindhárom tábla és a diagram görgethető, nevesített és fókuszálható régióban ül', () => {
    // axe: scrollable-region-focusable; a G225 technika feltétele, hogy a
    // vízszintes görgetés a szekcióban maradjon, ne a lapon.
    const regiok = elemek(HTML).filter((e) => gorgetheto(e.stilus))
    expect(regiok.length).toBeGreaterThanOrEqual(4)
    const tablak = elemek(HTML).filter((e) => e.tag === 'table')
    expect(tablak).toHaveLength(3)
    for (const tabla of tablak) {
      expect(tabla.osok.some(gorgetheto)).toBe(true)
    }
    expect((HTML.match(/tabindex="0"/g) ?? []).length).toBeGreaterThanOrEqual(4)
    expect((HTML.match(/role="region"/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })
})

function gorgetheto(stilus: string): boolean {
  const ertek = deklaracio(stilus, 'overflow-x')
  return ertek === 'auto' || ertek === 'scroll'
}

describe('Statisztika — minden szín tokenről jön, nyers érték nincs', () => {
  const FAJLOK = [
    'src/components/admin/StatisticsReport.tsx',
    'src/components/admin/statistics/styles.ts',
    'src/components/admin/statistics/StatCard.tsx',
    'src/components/admin/statistics/TotalsCards.tsx',
    'src/components/admin/statistics/MonthlyRevenueSection.tsx',
    'src/components/admin/statistics/CourseRevenueTable.tsx',
    'src/components/admin/statistics/FunnelSection.tsx',
    'src/components/admin/statistics/CourseEngagementSection.tsx',
  ]

  it.each(FAJLOK)('%s nem tartalmaz nyers színértéket', (ut) => {
    const forras = readFileSync(join(REPO, ut), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    const hexa = forras.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
    const fuggveny = forras.match(/\b(rgba?|hsla?|color-mix)\s*\(/g) ?? []
    expect(hexa, `nyers hexa: ${hexa.join(', ')}`).toEqual([])
    expect(fuggveny, `nyers színfüggvény: ${fuggveny.join(', ')}`).toEqual([])
  })

  it('a renderelt nézet egyetlen színe sem nyers érték', () => {
    expect(HTML.match(/#[0-9a-fA-F]{6}\b/g) ?? []).toEqual([])
    expect(HTML.match(/\brgba?\(/g) ?? []).toEqual([])
  })
})

describe('Statisztika — érintőcél a széles lapon is (WCAG 2.2 SC 2.5.8, repó-cél 44 px)', () => {
  it('a sorbeli link legkisebb magassága a Payload MINDKÉT gyökérméreténél ≥ 44 CSS px', () => {
    // A széles lapon a linkszöveg EGY sorba fér, tehát a beágyazott doboz a
    // sormagasságra (mérve 22,5 px) esne vissza. A Payload 1024 px alatt
    // 12 px-es gyökeret ad: a puszta rem-alak ott 40,6 px-et adna.
    for (const gyokerPx of [12, 13]) {
      const valtozok = markaValtozok(gyokerPx)
      const px = hossz(String(rowLinkStyle.minHeight), valtozok, 0, gyokerPx)
      expect(px, `${String(gyokerPx)} px-es gyökéren`).toBeGreaterThanOrEqual(44)
    }
  })

  it('a link ténylegesen viseli ezt a stílust a renderelt nézetben', () => {
    const linkek = elemek(HTML).filter((e) => e.tag === 'a')
    expect(linkek.length).toBeGreaterThan(0)
    for (const link of linkek) {
      expect(deklaracio(link.stilus, 'min-height')).not.toBeNull()
    }
  })
})

/* ─────────────────── Kontraszt: a MÁRKA-TOKENEK párjai ───────────────────
   Miért kell ez itt: a storefront kontraszt-őre (gomb-kontraszt.test.ts G-K2)
   a storefront szelektorait méri, a `.kc-adminstat` scope-ot nem. A
   2026-08-21-i böngészős mérés talált is egy valódi bukást, amit semmi nem
   fogott meg: a felvezető sor sötét témában az accent-deepet vitte, MÉRVE
   2,87:1 az ink-földön (WCAG 2.2 SC 1.4.3 bukás). Ez az őr a custom.scss
   VALÓDI tokenértékeiből számol, tehát egy token-csere azonnal kibukik. */

function tokenSzinek(sotet: boolean): Record<string, string> {
  const kommentNelkul = BRAND_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  const vilagos = /\.kc-adminstat \{([\s\S]*?)\n\}/.exec(kommentNelkul)?.[1] ?? ''
  const sotetBlokk = /\[data-theme='dark'\] \.kc-adminstat \{([\s\S]*?)\n\}/.exec(kommentNelkul)?.[1] ?? ''
  expect(vilagos.length, 'nincs .kc-adminstat blokk').toBeGreaterThan(0)
  expect(sotetBlokk.length, 'nincs sötét blokk').toBeGreaterThan(0)
  const ki: Record<string, string> = {}
  for (const blokk of sotet ? [vilagos, sotetBlokk] : [vilagos]) {
    for (const t of blokk.matchAll(/(--kc-as-[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
      ki[t[1]] = t[2].toLowerCase()
    }
  }
  return ki
}

function relativLuminancia(hex: string): number {
  const csatorna = (n: number): number => {
    const s = n / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return 0.2126 * csatorna(r) + 0.7152 * csatorna(g) + 0.0722 * csatorna(b)
}

function kontraszt(elo: string, hatter: string): number {
  const a = relativLuminancia(elo)
  const b = relativLuminancia(hatter)
  const [nagy, kicsi] = a > b ? [a, b] : [b, a]
  return Math.round(((nagy + 0.05) / (kicsi + 0.05)) * 100) / 100
}

/** A nézetben ténylegesen előforduló előtér/háttér párok. */
const PAROK: Array<{ elo: string; hatter: string; kuszob: number; mire: string }> = [
  { elo: '--kc-as-text', hatter: '--kc-as-bg', kuszob: 4.5, mire: 'törzsszöveg a lap-földön' },
  { elo: '--kc-as-text', hatter: '--kc-as-surface-raised', kuszob: 4.5, mire: 'szöveg kártyán és táblán' },
  { elo: '--kc-as-text', hatter: '--kc-as-surface-hover', kuszob: 4.5, mire: 'szöveg kiemelt táblasoron' },
  { elo: '--kc-as-text-muted', hatter: '--kc-as-bg', kuszob: 4.5, mire: 'lead és megjegyzés' },
  { elo: '--kc-as-text-muted', hatter: '--kc-as-surface-raised', kuszob: 4.5, mire: 'oszlopfejléc és felirat' },
  { elo: '--kc-as-text-muted', hatter: '--kc-as-surface-hover', kuszob: 4.5, mire: 'oszlopfejléc kiemelt soron' },
  { elo: '--kc-as-eyebrow', hatter: '--kc-as-bg', kuszob: 4.5, mire: 'felvezető sor (13 px)' },
  { elo: '--kc-as-danger', hatter: '--kc-as-surface-raised', kuszob: 4.5, mire: 'kiemelt hibaszám' },
  { elo: '--kc-as-danger', hatter: '--kc-as-surface-hover', kuszob: 4.5, mire: 'kiemelt hibaszám kiemelt soron' },
  { elo: '--kc-as-hairline-strong', hatter: '--kc-as-surface-raised', kuszob: 3, mire: 'azonosító keret (1.4.11)' },
  { elo: '--kc-as-hairline-strong', hatter: '--kc-as-surface-hover', kuszob: 3, mire: 'azonosító keret kiemelt soron' },
  { elo: '--kc-as-focus', hatter: '--kc-as-bg', kuszob: 3, mire: 'fókuszgyűrű (2.4.7 + 1.4.11)' },
  { elo: '--kc-as-focus', hatter: '--kc-as-surface-raised', kuszob: 3, mire: 'fókuszgyűrű emelt felületen' },
  { elo: '--kc-as-accent', hatter: '--kc-as-bg', kuszob: 3, mire: 'felvezető-vonal (dekoráció)' },
  { elo: '--kc-as-diagram-otthoni', hatter: '--kc-as-surface-raised', kuszob: 3, mire: 'otthoni oszlop' },
  { elo: '--kc-as-diagram-szakmai', hatter: '--kc-as-surface-raised', kuszob: 3, mire: 'szakmai oszlop' },
]

describe.each([
  ['világos', false],
  ['sötét', true],
])('Statisztika — kontraszt a %s témában (WCAG 2.2 SC 1.4.3 és 1.4.11)', (_nev, sotet) => {
  const szinek = tokenSzinek(sotet)

  it('minden színtoken definiálva van hexa értékkel', () => {
    const hianyzo = [...new Set(PAROK.flatMap((p) => [p.elo, p.hatter]))].filter(
      (t) => szinek[t] === undefined,
    )
    expect(hianyzo, `nincs érték: ${hianyzo.join(', ')}`).toEqual([])
  })

  it.each(PAROK.map((p) => [`${p.mire} (${p.elo} / ${p.hatter})`, p] as const))(
    '%s',
    (_cimke, par) => {
      const ertek = kontraszt(szinek[par.elo], szinek[par.hatter])
      expect(
        ertek,
        `${par.mire}: ${szinek[par.elo]} a ${szinek[par.hatter]} háttéren ${String(ertek)}:1, ` +
          `a küszöb ${String(par.kuszob)}:1. Ha egy token értéke változott, a TOKENT kell ` +
          'javítani, nem a küszöböt (a custom.scss kontraszt-jegyzőkönyvét is frissítsd).',
      ).toBeGreaterThanOrEqual(par.kuszob)
    },
  )
})

describe('Statisztika — a diagram nem hagy félig üres kártyát a széles lapon', () => {
  it('a diagram kerete a diagram természetes szélességéhez igazodik', () => {
    // A RevenueChart SVG-jének felső szélessége 832 tervezési px (nem ezé a
    // fájlé), a kártya belső térköze 2 × 16, a kerete 2 × 1 → 866.
    const valtozok = markaValtozok(13)
    const keret = elemek(HTML).find(
      (e) => e.tag === 'div' && deklaracio(e.stilus, 'max-width') !== null && e.osok.length === 2,
    )
    expect(keret, 'nincs diagram-keret a szekcióban').toBeDefined()
    const px = hossz(String(deklaracio(keret?.stilus ?? '', 'max-width')), valtozok, 1525, 13)
    expect(px).toBeCloseTo(866, 3)
  })
})


describe('Statisztika — a kiemelt darabszám színe nem nyeli el a hover-visszajelzést', () => {
  /* MÉRT HIBA: a „Nem kezdte el" szám-linkje inline `color`-t vitt, a
     style-attribútum pedig MINDEN szelektort ver — a `.kc-adminstat a:hover`
     szabály (a lap link-nyelve) ezen az egy linken sosem érvényesült. A szín
     ezért osztályba került; ez az őr azt méri, hogy a rendezés helyes marad. */
  const cssKommentNelkul = BRAND_CSS.replace(/\/\*[\s\S]*?\*\//g, '')

  it('a kiemelés OSZTÁLYBÓL jön, a márka danger tokenjével', () => {
    expect(cssKommentNelkul).toMatch(
      /\.kc-adminstat \.kc-adminstat__count-danger\s*\{[^}]*color:\s*var\(--kc-as-danger\)/,
    )
  })

  it('a hover-szabály SPECIFIKUSABB, mint a kiemelés osztálya', () => {
    // `.kc-adminstat a:hover` = (0,2,1); `.kc-adminstat .kc-adminstat__count-danger`
    // = (0,2,0). A nagyobb nyer, tehát egér alatt a link-szín érvényesül.
    expect(cssKommentNelkul).toMatch(
      /\.kc-adminstat a:hover\s*\{[^}]*color:\s*var\(--kc-as-link-hover\)/,
    )
    // Az osztály NEM kap `a` elem-szelektort: azzal (0,2,1)-re nőne, és a
    // döntést a forrássorrend hozná — pontosan az a törékenység, amit
    // elkerülünk.
    expect(cssKommentNelkul).not.toMatch(/\.kc-adminstat a\.kc-adminstat__count-danger/)
  })

  it('a sötét ág a TOKENBŐL jön — külön szabály nem kell hozzá', () => {
    expect(cssKommentNelkul).toMatch(
      /\[data-theme='dark'\]\s*\.kc-adminstat\s*\{[^}]*--kc-as-danger:/,
    )
  })
})
