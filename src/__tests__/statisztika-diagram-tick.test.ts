import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RevenueChart } from '../components/admin/RevenueChart'
import { aggregateMonthlyRevenue } from '../lib/statistics/revenue'

/**
 * ŐR — A BEVÉTEL-DIAGRAM TICKJE EGYETLEN GYÖKÉRMÉRETEN SEM ESIK 12 px ALÁ.
 * A #126 (px→rem) a diagram `min-width`-ét `'720px'`-ről
 * `calc(720 * var(--kc-as-px, 1px))`-re cserélte. A `--kc-as-px` a
 * `calc(1rem / 13)` — a Payload-admin 13 px-es gyökeréhez igazítva. CSAKHOGY a
 * Payload 1024 px alatt 12 px-re viszi a gyökeret, ott tehát az egység
 */

const REPO = process.cwd()
const olvas = (...reszek: string[]): string => readFileSync(join(REPO, ...reszek), 'utf8')

const PAYLOAD_SCSS = ['node_modules', '@payloadcms', 'ui', 'dist', 'scss']

/** A tervezett legkisebb tick-méret px-ben (a #125 mért alapállapota). */
const TICK_MINIMUM_PX = 12

/**
 * A Payload-admin gyökér-betűméretei px-ben, a saját scss-éből kiolvasva:
 * az alapértelmezés (`$baseline-body-size`) és a mid-break-en érvényes érték
 * (`html { @include mid-break { font-size: … } }`).
 */
function payloadGyokerMeretek(): number[] {
  const vars = olvas(...PAYLOAD_SCSS, 'vars.scss')
  const app = olvas(...PAYLOAD_SCSS, 'app.scss')

  const alap = /\$baseline-body-size:\s*([\d.]+)px/.exec(vars)?.[1]
  expect(alap, 'a Payload $baseline-body-size nem olvasható ki — az őr elavult').toBeDefined()

  const htmlBlokk = /\bhtml\s*\{([\s\S]*?)\n {2}\}/.exec(app)?.[1]
  expect(htmlBlokk, 'a Payload html-blokkja nem olvasható ki — az őr elavult').toBeDefined()
  const torott = /@include mid-break\s*\{[^}]*font-size:\s*([\d.]+)px/.exec(htmlBlokk ?? '')?.[1]
  expect(torott, 'a Payload mid-break gyökérmérete nem olvasható ki — az őr elavult').toBeDefined()

  return [Number(alap), Number(torott)]
}

/** A `--kc-as-px` osztója a custom.scss-ből (`calc(1rem / N)`). */
function egysegOszto(): number {
  const scss = olvas('src', 'app', '(payload)', 'custom.scss').replace(/\/\*[\s\S]*?\*\//g, '')
  const n = /--kc-as-px:\s*calc\(\s*1rem\s*\/\s*([\d.]+)\s*\)/.exec(scss)?.[1]
  expect(n, 'a --kc-as-px definíciója nem olvasható ki — az őr elavult').toBeDefined()
  return Number(n)
}

/** A viewBox szélessége és a tick betűmérete a komponens forrásából. */
function diagramMeretek(): { viewBoxSzelesseg: number; tickBetumeret: number } {
  const src = olvas('src', 'components', 'admin', 'RevenueChart.tsx')
  const w = /const width = (\d+)/.exec(src)?.[1]
  const tick = /fontSize="(\d+)"/.exec(src)?.[1]
  expect(w, 'a viewBox szélessége nem olvasható ki — az őr elavult').toBeDefined()
  expect(tick, 'a tick betűmérete nem olvasható ki — az őr elavult').toBeDefined()
  return { viewBoxSzelesseg: Number(w), tickBetumeret: Number(tick) }
}

/**
 * A min-width CSS-kifejezés kiértékelése adott `--kc-as-px` mellett.
 *
 * SZŰK, SZÁNDÉKOSAN: csak azokat az alakokat ismeri, amiket ma használunk
 * (`max(...)`, `calc(...)`, szorzás, px-es szám, `var(--kc-as-px, …)`). Ha a
 * kifejezés alakja megváltozik, az őr HANGOSAN elbukik — nem hallgat, és nem
 * enged át ismeretlen alakot.
 */
function kiertekelPx(kifejezes: string, egysegPx: number): number {
  const s = kifejezes.trim()

  const max = /^max\((.*)\)$/s.exec(s)
  if (max) {
    return Math.max(...szetvag(max[1]).map((r) => kiertekelPx(r, egysegPx)))
  }
  const min = /^min\((.*)\)$/s.exec(s)
  if (min) {
    return Math.min(...szetvag(min[1]).map((r) => kiertekelPx(r, egysegPx)))
  }
  const calc = /^calc\((.*)\)$/s.exec(s)
  if (calc) {
    return kiertekelPx(calc[1], egysegPx)
  }
  if (/^var\(--kc-as-px\b/.test(s)) {
    return egysegPx
  }
  const szorzat = /^(.+?)\s*\*\s*(.+)$/s.exec(s)
  if (szorzat && kiegyensulyozott(szorzat[1])) {
    return kiertekelPx(szorzat[1], egysegPx) * kiertekelPx(szorzat[2], egysegPx)
  }
  const px = /^([\d.]+)px$/.exec(s)
  if (px) {
    return Number(px[1])
  }
  const szam = /^([\d.]+)$/.exec(s)
  if (szam) {
    return Number(szam[1])
  }
  throw new Error(`ismeretlen alakú CSS-kifejezés, az őr nem tudja megmérni: ${s}`)
}

/** Vesszős lista szétvágása a legfelső szinten (a zárójeleken belül nem vág). */
function szetvag(lista: string): string[] {
  const reszek: string[] = []
  let melyseg = 0
  let aktualis = ''
  for (const ch of lista) {
    if (ch === '(') melyseg += 1
    if (ch === ')') melyseg -= 1
    if (ch === ',' && melyseg === 0) {
      reszek.push(aktualis)
      aktualis = ''
      continue
    }
    aktualis += ch
  }
  reszek.push(aktualis)
  return reszek
}

function kiegyensulyozott(resz: string): boolean {
  let melyseg = 0
  for (const ch of resz) {
    if (ch === '(') melyseg += 1
    if (ch === ')') melyseg -= 1
    if (melyseg < 0) return false
  }
  return melyseg === 0
}

/** A kirenderelt SVG min-width kifejezése (a stílusattribútumból). */
function minWidthKifejezes(): string {
  const rows = aggregateMonthlyRevenue([], { months: 12, now: new Date('2026-08-20T00:00:00Z') })
  const html = renderToStaticMarkup(createElement(RevenueChart, { rows }))
  const talalat = /min-width:\s*([^;"]+)/.exec(html)?.[1]
  expect(talalat, 'a diagram markupjában nincs min-width — az őr elavult').toBeDefined()
  return (talalat ?? '').trim()
}

describe('Bevétel-diagram: a tick MÉRT mérete minden Payload-gyökéren ≥ 12 px', () => {
  it('a mérés bemenetei a VALÓDI forrásokból jönnek, nem a tesztből', () => {
    const gyokerek = payloadGyokerMeretek()
    const oszto = egysegOszto()
    const { viewBoxSzelesseg, tickBetumeret } = diagramMeretek()

    expect(gyokerek.length).toBe(2)
    for (const g of gyokerek) expect(g).toBeGreaterThan(0)
    expect(oszto).toBeGreaterThan(0)
    expect(viewBoxSzelesseg).toBeGreaterThan(0)
    expect(tickBetumeret).toBeGreaterThan(0)
  })

  it('egyik gyökérméreten sem esik a tick 12 px alá', () => {
    const gyokerek = payloadGyokerMeretek()
    const oszto = egysegOszto()
    const { viewBoxSzelesseg, tickBetumeret } = diagramMeretek()
    const kifejezes = minWidthKifejezes()

    for (const gyoker of gyokerek) {
      const egysegPx = gyoker / oszto
      const rajzoltSzelesseg = kiertekelPx(kifejezes, egysegPx)
      const skala = rajzoltSzelesseg / viewBoxSzelesseg
      const tick = tickBetumeret * skala
      expect(
        tick,
        `${gyoker}px-es gyökéren a tick ${tick.toFixed(2)}px (min-width: ${kifejezes}, ` +
          `--kc-as-px=${egysegPx.toFixed(4)}px, rajzolt szélesség ${rajzoltSzelesseg.toFixed(1)}px)`,
      ).toBeGreaterThanOrEqual(TICK_MINIMUM_PX)
    }
  })

  it('a rem-skála FÖLFELÉ megmarad: nagyobb gyökéren a diagram nő', () => {
    // A max() csak alsó korlát — a WCAG C14 szerinti fölfelé skálázást nem
    // szabad elvennie (NN/g, Let Users Control Font Size).
    const oszto = egysegOszto()
    const kifejezes = minWidthKifejezes()
    const alap = kiertekelPx(kifejezes, oszto / oszto)
    const dupla = kiertekelPx(kifejezes, (2 * oszto) / oszto)
    expect(dupla).toBeGreaterThan(alap)
  })
})
