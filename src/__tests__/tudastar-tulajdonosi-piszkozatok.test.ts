import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { CIKK_KATEGORIA } from '../lib/tudastar-kategoriak'
import {
  excerptFrom,
  extractArticleBody,
  FORRAS_JELOLESEK,
  inlineNodes,
  LEKTORI_JELOLESEK,
  markdownToLexical,
} from '../lib/tudastar/markdown-to-lexical'
import { SEO_DESCRIPTION_MAX, SEO_TITLE_MAX } from '../lib/tudastar/seo-kulcsszavak'
import { celAllapot, CIKKEK, cikketFordit, fejlecMetaadat } from '../scripts/import-tudastar-cikkek'

/**
 * ŐRÖK — A TULAJDONOSI CIKKEK (9. és 10. cikk, 2026-09-19).
 *
 * A két cikk a tulajdonosok blogötlete, tulajdonosi utasításra élesbe szánva:
 * ugyanazon a két kapun megy át, mint a többi (CONFIRM ír, PUBLISH közzétesz).
 * A tulajdonosi kikötés (2026-09-19 este): „a cikkekre legyen study”, ezért
 * minden klinikai állítás mögött ellenőrzött tanulmány áll a cikkfájl H1
 * fölötti (nem renderelt) Forrás-ellenőrzés és Forráslista táblájában. A
 * tulajdonos késő esti döntése: a publikált cikkben NINCS Források szakasz és
 * nincs [n] jel („a kettő cikkből kerüljenek ki a források”).
 *
 *  P1  A lista: a két bejegyzés cikkfejlécből töltött SEO-val áll a listán,
 *      publikálási kivétel nélkül; a slugok egyediek; a fájl létezik; van
 *      kategória.
 *  P2  A fejléc: metaadat-tábla title/slug/seoTitle/seoDescription/Kategória
 *      sorokkal, a slug és a kategória a kóddal egyezik.
 *  P3  A törzs: 700–1100 szó; H2-tagolás; bekezdésenként legfeljebb 4 mondat;
 *      felsorolásonként legfeljebb 6 tétel; lezáró „Mikor keress minket?”
 *      belső linkkel.
 *  P4  Mikroszöveg: nincs kvirtmínusz és nincs szóközös gondolatjel a törzsben,
 *      a címben és a SEO-mezőkben (docs/ui-sztenderdek.md §3.1); nincs lektori
 *      vagy forrás-jelölés; a nem-diagnózis mondat megvan.
 *  P5  SEO: a leírás 150–160 karakter, a cím a keresőkorláton belül; a fordító
 *      a fejlécből tölti, a seoKeywords és a GYIK undefined (a betöltő nem nyúl
 *      a mezőhöz).
 *  P6  Belső linkek csak létező útvonalra (/szolgaltatasok, /kurzusok…,
 *      /blog/<importált slug>); a külső link https.
 *  P7  Források: a törzsben NINCS „## Források” szakasz és nincs [n] jel; a
 *      H1 fölötti Forráslista számozott, minden tétel DOI-val vagy
 *      PubMed-azonosítóval, vagy „nem tanulmány” jelöléssel (a study-alap a
 *      repóban ellenőrizhető marad).
 *  P8  `celAllapot`: kizárólag a PUBLISH kapu dönt, a két új cikknek nincs
 *      kivétele (OWNER_TUDASTAR_PUBLISH=igen őket is közzéteszi).
 *  P9  Fordító: a „[1]” jel és egy valódi link ugyanabban a sorban nem olvad
 *      össze; a szószám-őr (T4) szintjén nulla a szövegveszteség.
 */

const CIKKEK_DIR = path.join(process.cwd(), 'docs', 'cikkek')
const PISZKOZATOK = CIKKEK.filter((cikk) => cikk.seoForras === 'cikkfejlec')

const BELSO_UTVONALAK = new Set([
  '/szolgaltatasok',
  '/kurzusok',
  '/kurzusok/otthoni-kezrehab-program',
  '/kapcsolat',
  '/rolunk',
  ...CIKKEK.map((cikk) => `/blog/${cikk.slug}`),
])

interface Cikk {
  fajl: string
  slug: string
  nyers: string
  title: string
  lines: string[]
  /** A törzs (a publikált cikkben nincs Források szakasz). */
  proza: string[]
  /** A H1 fölötti, nem renderelt Forráslista sorai. */
  forrasok: string[]
}

function beolvas(fajl: string, slug: string): Cikk {
  const nyers = readFileSync(path.join(CIKKEK_DIR, fajl), 'utf8')
  const { title, lines } = extractArticleBody(nyers)
  const fejlec = nyers.split(/^# (?!LEKTOR)/m)[0] ?? ''
  const listaIndex = fejlec.indexOf('## Forráslista')
  const forrasok =
    listaIndex === -1
      ? []
      : fejlec
          .slice(listaIndex)
          .split('\n')
          .slice(1)
          .filter((sor) => sor.trim().length > 0)
  return { fajl, slug, nyers, title, lines, proza: lines, forrasok }
}

const CIKK_ESETEK = PISZKOZATOK.map((cikk) => [cikk.slug, cikk.fajl] as const)
const szavak = (sorok: readonly string[]): number =>
  sorok.join(' ').split(/\s+/).filter(Boolean).length

describe('P1 — a két tulajdonosi cikk a listán', () => {
  it('pontosan a 9. és 10. cikk tölt a cikkfejlécből, publikálási kivétel nélkül', () => {
    expect(PISZKOZATOK.map((cikk) => cikk.slug)).toEqual([
      'peace-and-love-friss-serules',
      'gipszben-a-kezed',
    ])
    for (const cikk of PISZKOZATOK) {
      expect(cikk.seoForras).toBe('cikkfejlec')
      // Nincs külön publikálási mező: a bejegyzés csak fajl, slug, seoForras.
      expect(Object.keys(cikk).sort()).toEqual(['fajl', 'seoForras', 'slug'])
      expect(existsSync(path.join(CIKKEK_DIR, cikk.fajl))).toBe(true)
      expect(CIKK_KATEGORIA[cikk.slug]).toBeDefined()
    }
  })

  it('a slugok és a fájlnevek egyediek az egész listán', () => {
    expect(new Set(CIKKEK.map((cikk) => cikk.slug)).size).toBe(CIKKEK.length)
    expect(new Set(CIKKEK.map((cikk) => cikk.fajl)).size).toBe(CIKKEK.length)
  })

  it('a mért nyolc cikk mérésből tölt', () => {
    const mert = CIKKEK.filter((cikk) => cikk.seoForras !== 'cikkfejlec')
    expect(mert).toHaveLength(8)
    for (const cikk of mert) expect(cikk.seoForras ?? 'meres').toBe('meres')
  })
})

describe('P2 — a cikkfejléc metaadat-táblája', () => {
  it.each(CIKK_ESETEK)(
    '%s: title, slug, seoTitle, seoDescription, Kategória, Állapot',
    (slug, fajl) => {
      const { nyers, title } = beolvas(fajl, slug)
      const sor = (mezo: string): string | undefined =>
        new RegExp(`^\\|\\s*${mezo}\\s*\\|\\s*(.+?)\\s*\\|\\s*$`, 'm').exec(nyers)?.[1]
      expect(sor('`title`')).toBe(title)
      expect(sor('`slug`')).toBe(`\`${slug}\``)
      expect(fejlecMetaadat(nyers, 'seoTitle').length).toBeGreaterThan(10)
      expect(fejlecMetaadat(nyers, 'seoDescription').length).toBeGreaterThan(10)
      const kategoria = /\|\s*Kategória\s*\|[^|]*\(`([a-z0-9-]+)`\)\s*\|/.exec(nyers)?.[1]
      expect(kategoria).toBe(CIKK_KATEGORIA[slug])
      expect(sor('Állapot')).toMatch(/OWNER_TUDASTAR_PUBLISH=igen/)
    },
  )

  it('hiányzó metaadat-sorra a fejléc-olvasó DOB, nem ad némán üreset', () => {
    expect(() => fejlecMetaadat('| `title` | x |', 'seoTitle')).toThrow(/seoTitle/)
  })
})

describe('P3 — hossz és tagolás', () => {
  it.each(CIKK_ESETEK)('%s: 700–1100 szó', (slug, fajl) => {
    const { proza } = beolvas(fajl, slug)
    const n = szavak(proza)
    expect(n, `${slug}: ${n} szó`).toBeGreaterThanOrEqual(700)
    expect(n, `${slug}: ${n} szó`).toBeLessThanOrEqual(1100)
  })

  it.each(CIKK_ESETEK)('%s: H2-tagolás, a záró szakaszok a helyükön', (slug, fajl) => {
    const { lines } = beolvas(fajl, slug)
    const h2 = lines.filter((sor) => sor.startsWith('## ')).map((sor) => sor.slice(3).trim())
    expect(h2.length).toBeGreaterThanOrEqual(7)
    expect(h2).toContain('Mikor keress minket?')
    expect(h2).toContain('Kik írták ezt a cikket?')
    expect(h2).toContain('Fontos tudnivaló')
    expect(h2[h2.length - 1]).toBe('Fontos tudnivaló')
    expect(h2).not.toContain('Források')
    expect(lines.filter((sor) => sor.startsWith('# '))).toHaveLength(0)
  })

  it.each(CIKK_ESETEK)('%s: bekezdésenként legfeljebb 4 mondat', (slug, fajl) => {
    const { proza } = beolvas(fajl, slug)
    const bekezdesek = proza
      .join('\n')
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter((b) => b.length > 0 && !b.startsWith('#') && !/^[-*] /.test(b))
    expect(bekezdesek.length).toBeGreaterThan(10)
    for (const b of bekezdesek) {
      const mondatok = (b.match(/[.!?](\s|$)/g) ?? []).length
      expect(mondatok, `${slug}: ${mondatok} mondat: „${b.slice(0, 60)}…”`).toBeLessThanOrEqual(4)
    }
  })

  it.each(CIKK_ESETEK)('%s: felsorolásonként legfeljebb 6 tétel', (slug, fajl) => {
    const { proza } = beolvas(fajl, slug)
    let hossz = 0
    let listak = 0
    for (const sor of [...proza, '']) {
      if (/^[-*] /.test(sor.trim())) {
        hossz += 1
      } else {
        if (hossz > 0) listak += 1
        expect(hossz, `${slug}: ${hossz} tételes felsorolás`).toBeLessThanOrEqual(6)
        hossz = 0
      }
    }
    expect(listak).toBeGreaterThanOrEqual(2)
  })

  it.each(CIKK_ESETEK)('%s: a „Mikor keress minket?” szakasz a rendelőre visz', (slug, fajl) => {
    const { lines } = beolvas(fajl, slug)
    const kezd = lines.findIndex((sor) => sor.trim() === '## Mikor keress minket?')
    const veg = lines.findIndex((sor, i) => i > kezd && sor.startsWith('## '))
    const szakasz = lines.slice(kezd, veg).join('\n')
    expect(szakasz).toContain('](/szolgaltatasok)')
    // Traumás sérülésnél az otthoni program leírása orvosi engedélyt kér, ezért
    // itt nincs kurzus-link, csak szöveges említés feltétellel.
    expect(szakasz).not.toContain('](/kurzusok')
    expect(szakasz).toMatch(/orvosod már mindent engedélyezett/)
  })
})

describe('P4 — magyar mikroszöveg és tilalmak', () => {
  it.each(CIKK_ESETEK)('%s: nincs kvirtmínusz, nincs szóközös gondolatjel', (slug, fajl) => {
    const { lines, title, nyers } = beolvas(fajl, slug)
    const torzs = lines.join('\n')
    expect(torzs).not.toMatch(/—/)
    expect(torzs).not.toMatch(/ – /)
    expect(title).not.toMatch(/[–—]/)
    expect(fejlecMetaadat(nyers, 'seoTitle')).not.toMatch(/[–—]/)
    expect(fejlecMetaadat(nyers, 'seoDescription')).not.toMatch(/[–—]/)
  })

  it.each(CIKK_ESETEK)('%s: nincs lektori és nincs forrás-jelölés a törzsben', (slug, fajl) => {
    const { lines } = beolvas(fajl, slug)
    const torzs = lines.join('\n')
    for (const jel of [...LEKTORI_JELOLESEK, ...FORRAS_JELOLESEK]) {
      expect(torzs, `${slug}: „${jel}”`).not.toContain(jel)
    }
  })

  it.each(CIKK_ESETEK)('%s: kimondja, hogy nem diagnózis, és tegez', (slug, fajl) => {
    const { lines } = beolvas(fajl, slug)
    const torzs = lines.join('\n')
    expect(torzs).toContain('nem helyettesíti a szakorvosi vizsgálatot')
    expect(torzs).not.toMatch(/\bÖn\b/)
    expect(torzs).toContain('Kiss Kata és Kocsis Kata vagyunk')
  })
})

describe('P5 — SEO a cikkfejlécből', () => {
  it.each(CIKK_ESETEK)('%s: leírás 150–160 karakter, cím a korláton belül', (slug, fajl) => {
    const { nyers } = beolvas(fajl, slug)
    const leiras = fejlecMetaadat(nyers, 'seoDescription')
    expect(leiras.length, `${slug}: ${leiras.length} karakter`).toBeGreaterThanOrEqual(150)
    expect(leiras.length, `${slug}: ${leiras.length} karakter`).toBeLessThanOrEqual(160)
    expect(leiras.length).toBeLessThanOrEqual(SEO_DESCRIPTION_MAX)
    expect(fejlecMetaadat(nyers, 'seoTitle').length).toBeLessThanOrEqual(SEO_TITLE_MAX)
  })

  it.each(CIKK_ESETEK)(
    '%s: a fordító a fejlécből tölt, seoKeywords és GYIK érintetlen',
    (slug, fajl) => {
      const cikk = cikketFordit(CIKKEK_DIR, fajl, slug, 'cikkfejlec')
      const { nyers, lines } = beolvas(fajl, slug)
      expect(cikk.seoTitle).toBe(fejlecMetaadat(nyers, 'seoTitle'))
      expect(cikk.seoDescription).toBe(fejlecMetaadat(nyers, 'seoDescription'))
      expect(cikk.seoKeywords).toBeUndefined()
      expect(cikk.faq).toBeUndefined()
      expect(cikk.excerpt).toBe(excerptFrom(lines))
      expect(cikk.excerpt.length).toBeGreaterThan(40)
    },
  )

  it.each(CIKK_ESETEK)('%s: mérésként kérve DOB, mert nincs kulcsszó-célzás', (slug, fajl) => {
    expect(() => cikketFordit(CIKKEK_DIR, fajl, slug)).toThrow(/Nincs mért kulcsszó-célzás/)
  })
})

describe('P6 — linkek', () => {
  it.each(CIKK_ESETEK)('%s: belső link csak létező útvonalra, külső csak https', (slug, fajl) => {
    const { lines } = beolvas(fajl, slug)
    const celok = [...lines.join('\n').matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1])
    expect(celok.length).toBeGreaterThan(0)
    for (const cel of celok) {
      if (cel.startsWith('/')) {
        expect(BELSO_UTVONALAK.has(cel), `${slug}: ismeretlen belső útvonal: ${cel}`).toBe(true)
      } else {
        expect(cel, `${slug}: nem https külső link: ${cel}`).toMatch(/^https:\/\//)
      }
    }
    expect(celok).not.toContain('/inhuvelygyulladas')
    expect(lines.join('\n')).not.toContain('de-quervain-szindroma')
  })
})

describe('P7 — Források: a törzsből kikerültek, a belső Forráslista megmaradt', () => {
  it.each(CIKK_ESETEK)('%s: a törzsben nincs Források szakasz és nincs [n] jel', (slug, fajl) => {
    const { proza } = beolvas(fajl, slug)
    const szoveg = proza.join('\n')
    expect(szoveg).not.toContain('## Források')
    expect(szoveg, `${slug}: maradt [n] jel`).not.toMatch(/\[\d+\]/)
    expect(szoveg).not.toMatch(/szakirodalom szerint/i)
  })

  it.each(CIKK_ESETEK)(
    '%s: a H1 fölötti Forráslista számozott, DOI-val vagy PubMed-azonosítóval',
    (slug, fajl) => {
      const { forrasok } = beolvas(fajl, slug)
      const tetelek = forrasok.filter((sor) => /^\d+\. /.test(sor.trim()))
      expect(tetelek.length).toBeGreaterThanOrEqual(5)
      tetelek.forEach((tetel, index) => {
        expect(
          tetel.trim().startsWith(`${index + 1}. `),
          `${slug}: rossz sorszám: ${tetel.slice(0, 30)}`,
        ).toBe(true)
        const tanulmany = /doi\.org\/10\.\d{4,}/.test(tetel) || /PubMed \d{7,8}/.test(tetel)
        const betegtajekoztato = /nem tanulmány/.test(tetel)
        expect(
          tanulmany || betegtajekoztato,
          `${slug}: forrás azonosító nélkül: ${tetel.slice(0, 60)}`,
        ).toBe(true)
      })
    },
  )
})

describe('P8 — celAllapot: egyetlen kapu, minden cikkre egyformán', () => {
  it('OWNER_TUDASTAR_PUBLISH=igen nélkül piszkozat, vele közzétéve', () => {
    expect(celAllapot(false)).toBe('draft')
    expect(celAllapot(true)).toBe('published')
  })

  it('a betöltő a célállapotot minden cikkre a celAllapot-ból veszi, kivétel nélkül', () => {
    const src = readFileSync(
      path.join(process.cwd(), 'src/scripts/import-tudastar-cikkek.ts'),
      'utf8',
    )
    expect(src).toMatch(/const allapot = celAllapot\(publikal\)/)
    expect(src).toMatch(/status: allapot,\s*_status: allapot,/)
    expect(src).not.toMatch(/tulajdonosPublikal/)
  })
})

describe('P9 — fordító', () => {
  it('a „[1]” jel és egy valódi link ugyanabban a sorban nem olvad össze', () => {
    const nodes = inlineNodes('Állítás [1]. Ezt [a szolgáltatások oldalon](/szolgaltatasok) írtuk.')
    const tipusok = nodes.map((n) => (n as unknown as { type: string }).type)
    expect(tipusok.filter((t) => t === 'link')).toHaveLength(1)
    const link = nodes.find(
      (n) => (n as unknown as { type: string }).type === 'link',
    ) as unknown as {
      fields: { url: string }
      children: { text: string }[]
    }
    expect(link.fields.url).toBe('/szolgaltatasok')
    expect(link.children[0].text).toBe('a szolgáltatások oldalon')
    const szoveg = nodes.map((n) => (n as unknown as { text?: string }).text ?? '').join('')
    expect(szoveg).toContain('[1]')
  })

  it('a hiányos linkjelölés szövegként marad meg', () => {
    const nodes = inlineNodes('Nyitott [zárójel és (zárójel) külön.')
    expect(nodes.every((n) => (n as unknown as { type: string }).type === 'text')).toBe(true)
  })

  it.each(CIKK_ESETEK)('%s: a Lexical-fa a törzs minden szavát hordozza', (slug, fajl) => {
    const { lines } = beolvas(fajl, slug)
    const doc = markdownToLexical(lines) as unknown as { root: unknown }
    const szoveg = (node: unknown): string => {
      if (node === null || typeof node !== 'object') return ''
      const n = node as { type?: string; text?: string; children?: unknown[] }
      if (n.type === 'text') return n.text ?? ''
      return (n.children ?? []).map(szoveg).join(' ')
    }
    const ki = szoveg(doc.root).split(/\s+/).filter(Boolean).length
    const be = szavak(
      lines.map((sor) =>
        sor
          .trim()
          .replace(/^#+ +/, '')
          .replace(/^[-*] +/, '')
          .replace(/^\d+\. +/, '')
          .replace(/\*\*/g, '')
          .replace(/\[(.+?)\]\((.+?)\)/g, '$1'),
      ),
    )
    expect(ki / be).toBeGreaterThan(0.99)
  })
})
