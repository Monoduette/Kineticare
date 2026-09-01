import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * ŐR — HÁROM-MÉRETES TIPOGRÁFIAI SKÁLA (tulajdonosi döntés, 2026-08-16).
 *
 * A szabály: az ÜGYFÉLOLDALI felületen legfeljebb HÁROM betűméret élhet.
 *
 *   L (--kc-font-l) — címek: a hero H1 ÉS a szekció-H2-k KÖZÖS mérete,
 *   M (--kc-font-m) — törzs: bekezdés, lead, nav, gomb, mező, kártyacím, ár,
 *   S (--kc-font-s) — kiegészítő: eyebrow, badge, meta-sor, apróbetű.
 *
 * Miért ŐR és nem csak konvenció: a repóban korábban 22 különböző fontméret
 * futott (9 törzs- + 13 tábla-lépcső), és mindegyik „egy jó okkal" került be.
 * Egyetlen új `font-size` deklaráció visszahozná a szétcsúszást anélkül, hogy
 * bárki észrevenné — ezt csak végrehajtható szabály tudja megakadályozni.
 *
 * A hierarchia NEM szegényedik: a szintet a méret MELLETT a súly (400/700),
 * a szín (ink / ink-soft / akcent-mély), a betűcsalád (Tenor Sans címsor /
 * Nunito Sans törzs) és a verzál+betűköz jelöli — lásd tokens.css.
 *
 * HATÓKÖR
 *  - A `(frontend)` route-group MINDEN stíluslapja + a storefront-komponensek
 *    saját CSS-ei (src/components/**).
 *  - Az inline `fontSize` a storefront TSX-ekben.
 *  - KIVÉTEL: a Payload ADMIN felülete (src/components/admin/**) — az nem a
 *    mi vizuális rendszerünk, a saját stílusnyelvét viszi.
 */

const REPO = fileURLToPath(new URL('..', import.meta.url))

const ENGEDETT = ['var(--kc-font-l)', 'var(--kc-font-m)', 'var(--kc-font-s)'] as const

/** Az admin felület kimarad: nem a storefront vizuális rendszere. */
const KIVETEL_UTAK = ['components/admin']

function fajlokat(gyoker: string, kiterjesztesek: string[]): string[] {
  const abszolut = join(REPO, gyoker)
  const talalat: string[] = []
  const bejar = (konyvtar: string): void => {
    for (const bejegyzes of readdirSync(konyvtar)) {
      const teljes = join(konyvtar, bejegyzes)
      if (statSync(teljes).isDirectory()) {
        bejar(teljes)
        continue
      }
      if (kiterjesztesek.some((veg) => bejegyzes.endsWith(veg))) {
        talalat.push(teljes)
      }
    }
  }
  bejar(abszolut)
  return talalat
    .map((teljes) => teljes.slice(REPO.length))
    .filter((ut) => !KIVETEL_UTAK.some((kivetel) => ut.startsWith(kivetel)))
    .sort()
}

/** Kommentek nélküli forrás — a dokumentációban szereplő példák nem szabályok. */
function kommentNelkul(forras: string): string {
  return forras.replace(/\/\*[\s\S]*?\*\//g, '')
}

const cssFajlok = [...fajlokat('app/(frontend)', ['.css']), ...fajlokat('components', ['.css'])]
const tsxFajlok = [
  ...fajlokat('app/(frontend)', ['.tsx']),
  ...fajlokat('components', ['.tsx', '.ts']),
]

describe('három-méretes tipográfiai skála — token-definíció', () => {
  const tokens = readFileSync(join(REPO, 'app/(frontend)/styles/tokens.css'), 'utf8')

  it('PONTOSAN három betűméret-token létezik, mind clamp-alapú (folytonos skála)', () => {
    const definiciok = [...tokens.matchAll(/^\s*(--kc-font-[a-z0-9-]+):\s*([^;]+);/gm)].map(
      (talalat) => [talalat[1], talalat[2].trim()] as const,
    )
    // A betűCSALÁD-tokenek (--kc-font-heading/body) és a súlyok nem méretek.
    const meretek = definiciok.filter(([nev]) => /^--kc-font-(l|m|s)$/.test(nev))
    expect(meretek.map(([nev]) => nev).sort()).toEqual(['--kc-font-l', '--kc-font-m', '--kc-font-s'])
    for (const [nev, ertek] of meretek) {
      expect(ertek, `${nev} nem clamp-alapú`).toMatch(/^clamp\(/)
    }
  })

  it('a törzs alsó határa 1rem — az iOS Safari így nem nagyít rá a mezőkre', () => {
    expect(tokens).toMatch(/--kc-font-m:\s*clamp\(1rem,/)
  })

  it('az L plafon 2rem (NN/g max. 32 px címsor), az S padló 0.875rem (14 px)', () => {
    // Visual Hierarchy: header up to 32px, body copy 14–16px.
    // https://www.nngroup.com/articles/visual-hierarchy-ux-definition/
    expect(tokens).toMatch(/--kc-font-l:\s*clamp\(2rem,\s*2rem,\s*2rem\)/)
    expect(tokens).toMatch(/--kc-font-s:\s*clamp\(0\.875rem,\s*0\.875rem,\s*0\.875rem\)/)
    expect(kommentNelkul(tokens)).not.toMatch(/2\.9rem/)
    expect(kommentNelkul(tokens)).not.toMatch(/0\.8125rem/)
  })

  it('a RÉGI, sokméretes skála egyetlen tokenje sincs többé definiálva', () => {
    expect(kommentNelkul(tokens)).not.toMatch(/--kc-text-[a-z0-9-]+\s*:/)
  })
})

describe('három-méretes tipográfiai skála — CSS-őr', () => {
  it('a storefront minden stíluslapját vizsgáljuk (a felderítés nem üresült ki)', () => {
    expect(cssFajlok.length).toBeGreaterThan(25)
    expect(cssFajlok).toContain('app/(frontend)/styles/tokens.css')
    expect(cssFajlok).toContain('app/(frontend)/kurzusok/kurzusok.css')
    expect(cssFajlok).toContain('components/scroll-scrub/scroll-scrub.css')
  })

  it('MINDEN font-size a három token valamelyikére hivatkozik', () => {
    const szabalytalan: string[] = []
    for (const ut of cssFajlok) {
      const sorok = readFileSync(join(REPO, ut), 'utf8').split('\n')
      let kommentben = false
      for (const [index, sor] of sorok.entries()) {
        // Egyszerű blokk-komment követés: a dokumentációban szabad a régi
        // lépcsőkről beszélni, deklarálni nem.
        const nyit = sor.lastIndexOf('/*')
        const zar = sor.lastIndexOf('*/')
        const sorEleveKommentben = kommentben
        if (nyit > zar) {
          kommentben = true
        } else if (zar > nyit) {
          kommentben = false
        }
        if (sorEleveKommentben || sor.trimStart().startsWith('*')) {
          continue
        }
        const talalat = /(^|[^-])font-size:\s*([^;]+);/.exec(sor)
        if (talalat === null) {
          continue
        }
        const ertek = talalat[2].trim()
        if (!ENGEDETT.includes(ertek as (typeof ENGEDETT)[number])) {
          szabalytalan.push(`${ut}:${index + 1} → ${ertek}`)
        }
      }
    }
    expect(szabalytalan, `skálán kívüli betűméret:\n${szabalytalan.join('\n')}`).toEqual([])
  })

  it('a lapon EGYEDI font-size értékből PONTOSAN három van', () => {
    const egyediek = new Set<string>()
    for (const ut of cssFajlok) {
      const kod = kommentNelkul(readFileSync(join(REPO, ut), 'utf8'))
      for (const talalat of kod.matchAll(/(?:^|[^-])font-size:\s*([^;]+);/g)) {
        egyediek.add(talalat[1].trim())
      }
    }
    expect([...egyediek].sort()).toEqual([...ENGEDETT].sort())
  })

  it('a három token MINDEGYIKE használatban van (a skála nem sorvadt el)', () => {
    const osszes = cssFajlok.map((ut) => readFileSync(join(REPO, ut), 'utf8')).join('\n')
    for (const token of ENGEDETT) {
      expect(osszes.includes(`font-size: ${token}`), `${token} sehol nincs használva`).toBe(true)
    }
  })

  it('a régi skála egyetlen tokenjére sem hivatkozik többé deklaráció', () => {
    const hivatkozok = cssFajlok.filter((ut) =>
      /var\(--kc-text-[a-z0-9-]+\)/.test(kommentNelkul(readFileSync(join(REPO, ut), 'utf8'))),
    )
    expect(hivatkozok).toEqual([])
  })
})

describe('három-méretes tipográfiai skála — inline (TSX) őr', () => {
  it('elemre írt fontSize csak a három token valamelyike lehet', () => {
    const szabalytalan: string[] = []
    for (const ut of tsxFajlok) {
      const sorok = readFileSync(join(REPO, ut), 'utf8').split('\n')
      for (const [index, sor] of sorok.entries()) {
        const talalat = /fontSize:\s*'([^']+)'/.exec(sor)
        if (talalat === null) {
          continue
        }
        if (!ENGEDETT.includes(talalat[1] as (typeof ENGEDETT)[number])) {
          szabalytalan.push(`${ut}:${index + 1} → ${talalat[1]}`)
        }
      }
    }
    expect(szabalytalan, `skálán kívüli inline betűméret:\n${szabalytalan.join('\n')}`).toEqual([])
  })
})

describe('globális tipográfiai finomságok', () => {
  const base = readFileSync(join(REPO, 'app/(frontend)/styles/base.css'), 'utf8')

  it('minden elemen mindkét motorra kér élsimítást (univerzális szelektor + html + body + űrlap + placeholder)', () => {
    const univerzal = base.slice(base.indexOf('*,'), base.indexOf('html {'))
    expect(univerzal).toContain('-webkit-font-smoothing: antialiased')
    expect(univerzal).toContain('-moz-osx-font-smoothing: grayscale')
    const htmlBlokk = base.slice(base.indexOf('html {'), base.indexOf('body {'))
    expect(htmlBlokk).toContain('-webkit-font-smoothing: antialiased')
    expect(htmlBlokk).toContain('-moz-osx-font-smoothing: grayscale')
    expect(base).toContain('-webkit-font-smoothing: antialiased')
    expect(base).toContain('-moz-osx-font-smoothing: grayscale')
    const urlap = base.slice(base.indexOf('button,'), base.indexOf('/* Link-alapnyelv'))
    expect(urlap).toContain('-webkit-font-smoothing: antialiased')
    expect(urlap).toContain('-moz-osx-font-smoothing: grayscale')
    expect(urlap).toContain('::placeholder')
  })

  it('a H1 és a H2 UGYANAZT az L lépcsőt viszi (a különbség nem méret)', () => {
    expect(base).toMatch(/h1,\s*\n\s*h2\s*\{\s*\n\s*font-size: var\(--kc-font-l\);/)
  })

  it('a böngésző small/sub/sup eleme az S tokenre esik, nem UA-százalékra', () => {
    expect(base).toMatch(/small,\s*\n\s*sub,\s*\n\s*sup\s*\{\s*\n\s*font-size: var\(--kc-font-s\);/)
  })

  it('a sima görgetés él, de `prefers-reduced-motion` esetén kikapcsol', () => {
    expect(base).toContain('scroll-behavior: smooth')
    const csokkentett = base.slice(base.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(csokkentett).toContain('scroll-behavior: auto')
  })
})
