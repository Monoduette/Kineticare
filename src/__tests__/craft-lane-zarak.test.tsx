import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PostArticle } from '../components/content/PostArticle'
import { PostCard } from '../components/content/PostCard'
import { PostsEmptyState } from '../components/content/PostsEmptyState'
import { COURSE_SOS_KEZRELAX, LEGACY_REDIRECTS } from '../lib/legacy-redirects'
import { blogJsonLd } from '../lib/seo'
import { faqMezore } from '../lib/tudastar/faq'
import {
  excerptFrom,
  extractArticleBody,
  markdownToLexical,
} from '../lib/tudastar/markdown-to-lexical'
import type { Post } from '../payload-types'

/**
 * ŐR — Craft-sáv tartalmi zárak a meglévő fixture-ökön.
 *
 * Szerkesztő / Design / Kutató. Nyilvános HTML = a `docs/cikkek` publikálandó
 * törzse + a belőle renderelt `PostArticle` (GYIK-kel) + a `/blog` lista
 * sablonja. Ads-kreatív = a kampánydoksi 5.3/6. tábláinak saját cellái, nem
 * a versenytárs 5.1 prózája. Orvosi szöveget és Ads-kreatívot a teszt nem
 * ír át: amit az élő fixture miatt nem lehet bukásra vinni, a
 * `docs/agent-feature-map.md` térképen marad.
 */

const REPO = fileURLToPath(new URL('../..', import.meta.url))

const CIKKEK = [
  { fajl: '1-miert-zsibbad-a-kezem', slug: 'miert-zsibbad-a-kezem' },
  { fajl: '2-keztoalagut-szindroma', slug: 'keztoalagut-szindroma' },
  { fajl: '3-teniszkonyok', slug: 'teniszkonyok' },
  { fajl: '4-pattano-ujj', slug: 'pattano-ujj' },
  { fajl: '5-csuklo-es-kezfajdalom', slug: 'csuklo-es-kezfajdalom' },
  { fajl: '6-csuklotores-utani-gyogytorna', slug: 'csuklotores-utani-gyogytorna' },
  { fajl: '7-inhuvelygyulladas', slug: 'inhuvelygyulladas' },
  { fajl: '8-befagyott-vall', slug: 'befagyott-vall' },
] as const

const SZERKESZTO_MINTAK: readonly { nev: string; minta: RegExp }[] = [
  { nev: 'DOI', minta: /\bDOI\b/i },
  { nev: 'doi.org', minta: /doi\.org/i },
  { nev: 'PMID', minta: /\bPMID\b/i },
  { nev: 'Semrush', minta: /\bSemrush\b/i },
  { nev: 'Ahrefs', minta: /\bAhrefs\b/i },
  { nev: 'volume (SEO)', minta: /\bvolume\b/i },
  { nev: 'hivatalos táblázat', minta: /hivatalos táblázat/i },
  { nev: 'Forrásjegyzék', minta: /Forrásjegyzék/ },
]

const TILTOTT_CIMEK = ['műtét előtt', 'mielőtt műtétre kerül sor'] as const

const KUTATO_SLUGOK = ['inhuvelygyulladas', 'befagyott-vall'] as const

function cikkPath(fajl: string): string {
  return join(REPO, 'docs', 'cikkek', `${fajl}.md`)
}

function olvas(relativ: string): string {
  return readFileSync(join(REPO, relativ), 'utf8')
}

function htmlSzoveg(html: string): string {
  return html
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function cikkPost(args: {
  slug: string
  title: string
  excerpt: string
  content: unknown
  faq?: { question: string; answer: string }[]
}): Post {
  return {
    id: 1,
    title: args.title,
    slug: args.slug,
    excerpt: args.excerpt,
    status: 'published',
    publishedAt: '2026-08-21T08:00:00.000Z',
    updatedAt: '2026-08-21T08:00:00.000Z',
    createdAt: '2026-08-20T08:00:00.000Z',
    content: args.content,
    categories: [{ id: 5, title: 'Kézrehabilitáció', slug: 'kezrehabilitacio' }],
    ...(args.faq ? { faq: args.faq } : {}),
  } as unknown as Post
}

interface NyilvanosCikk {
  slug: string
  title: string
  excerpt: string
  torzs: string
  html: string
}

function nyilvanosCikk(fajl: string, slug: string): NyilvanosCikk {
  const { title, lines } = extractArticleBody(readFileSync(cikkPath(fajl), 'utf8'))
  const excerpt = excerptFrom(lines)
  const content = markdownToLexical(lines)
  const faq = faqMezore(slug)
  const html = renderToStaticMarkup(
    createElement(PostArticle, {
      post: cikkPost({ slug, title, excerpt, content, faq }),
    }),
  )
  return { slug, title, excerpt, torzs: lines.join('\n'), html }
}

const MINDEN_CIKK: readonly NyilvanosCikk[] = CIKKEK.map((cikk) =>
  nyilvanosCikk(cikk.fajl, cikk.slug),
)

function cikkOf(slug: (typeof KUTATO_SLUGOK)[number]): NyilvanosCikk {
  const talalt = MINDEN_CIKK.find((cikk) => cikk.slug === slug)
  if (!talalt) throw new Error(`Hiányzó cikkfixture: ${slug}`)
  return talalt
}

function tiltottTalalat(szoveg: string, minta: RegExp): string | undefined {
  const talalt = szoveg.match(minta)
  return talalt?.[0]
}

function bibliografiaHtml(html: string): string[] {
  const hibak: string[] = []
  if (/<h[1-6][^>]*>\s*Források\s*<\/h[1-6]>/i.test(html)) hibak.push('Források címsor')
  if (html.includes('id="forrasok"')) hibak.push('id=forrasok')
  if (html.includes('kc-post-sources')) hibak.push('kc-post-sources')
  return hibak
}

/** Százalék, ami gyógyulás-ígéretként áll, nem epidemiológiai arányként. */
function gyogyulasiSzazalekIgeretek(szoveg: string): string[] {
  const hibak: string[] = []
  for (const talalat of szoveg.matchAll(/\d+(?:[.,]\d+)?\s*%/g)) {
    const index = talalat.index ?? 0
    const ctx = szoveg.slice(Math.max(0, index - 70), index + talalat[0].length + 70)
    const igeret = /gyógyulási arány|gyógyulási ráta|meggyógyul|rendbe jössz|sikerarány/i.test(ctx)
    const tagadott = /nem írunk|nem ígér/i.test(ctx)
    if (igeret && !tagadott) hibak.push(ctx.replace(/\s+/g, ' ').trim())
  }
  return hibak
}

/** `hetek alatt` csak a „amit nem írunk” katalógusban maradhat. */
function hetekAlattIgeretek(szoveg: string): string[] {
  const hibak: string[] = []
  for (const talalat of szoveg.matchAll(/hetek alatt/gi)) {
    const index = talalat.index ?? 0
    const ctx = szoveg.slice(Math.max(0, index - 160), index + talalat[0].length + 80)
    const tagadott = /nem írunk|nem ígér|Amit nem|Hogy otthon, egyedül/i.test(ctx)
    if (!tagadott) hibak.push(ctx.replace(/\s+/g, ' ').trim())
  }
  return hibak
}

function alkalomszamIgeretek(szoveg: string): string[] {
  return [...szoveg.matchAll(/(?:\d+\s*[-–]\s*\d+|\d+)\s*alkalommal/gi)].map(
    (talalat) => talalat[0],
  )
}

function onalloSzam(szoveg: string, szam: string): boolean {
  return new RegExp(`(?<!\\d)${szam}(?!\\d)`).test(szoveg)
}

function kampanyMd(): string {
  return olvas('docs/adwords-kampany.md')
}

function szekcio(forras: string, kezdet: string, veg: string): string {
  const eleje = forras.indexOf(kezdet)
  const vege = forras.indexOf(veg)
  if (eleje < 0 || vege < 0 || vege <= eleje) {
    throw new Error(`A kampánydoksi szekciója hiányzik: ${kezdet} → ${veg}`)
  }
  return forras.slice(eleje, vege)
}

/** A 5.3 RSA címsor- és leírás-cellái — nem az 5.1 versenytárs-próza. */
function rsaKreativok(md: string): string[] {
  const blokk = szekcio(md, '### 5.3 A hirdetésszövegek karakterszámmal', '### 5.4')
  const cellak: string[] = []
  let mode: 'cimsor' | 'leiras' | null = null
  for (const sor of blokk.split('\n')) {
    if (/^\| # \| Címsor \|/.test(sor)) {
      mode = 'cimsor'
      continue
    }
    if (/^\| # \| Leírás \|/.test(sor)) {
      mode = 'leiras'
      continue
    }
    if (mode === null) continue
    const illeszt = sor.match(/^\| \d+ \| (.+?) \| \d+ \|$/)
    if (illeszt?.[1]) cellak.push(illeszt[1].trim())
  }
  return cellak
}

function bovitmenyKreativok(md: string): string[] {
  const blokk = szekcio(md, '#### Sitelinkek', '### 6.1')
  const cellak: string[] = []
  for (const sor of blokk.split('\n')) {
    if (!sor.startsWith('|')) continue
    if (/^\|[-:| ]+\|$/.test(sor)) continue
    if (/^\| (Szöveg|Kiemelés|Érték) \|/.test(sor)) continue
    const mezok = sor
      .split('|')
      .map((mezo) => mezo.trim())
      .filter((mezo) => mezo.length > 0)
    if (mezok.length === 0) continue
    if (/^\d+$/.test(mezok[0]!)) continue
    const elso = mezok[0]!
    if (elso.startsWith('/') || elso.startsWith('`/')) continue
    cellak.push(elso)
    if (mezok.length >= 3 && !/^\d+$/.test(mezok[2]!)) cellak.push(mezok[2]!)
    if (mezok.length >= 5 && !/^\d+$/.test(mezok[4]!)) cellak.push(mezok[4]!)
  }
  return cellak
}

function vegsoUrlok(md: string): string[] {
  const blokk = szekcio(md, '### 7.2 A hozzárendelés', '### 7.3')
  return [...blokk.matchAll(/`(\/[^`]+)`/g)].map((talalat) => talalat[1]!)
}

function sitelinkCelok(md: string): string[] {
  const blokk = szekcio(md, '#### Sitelinkek', '#### Kiemelések')
  return [...blokk.matchAll(/`(\/[^`]+)`/g)].map((talalat) => talalat[1]!)
}

function fajlnevek(gyoker: string, kiveve: readonly string[] = []): string[] {
  const talalatok: string[] = []
  const bejar = (relativ: string): void => {
    for (const bejegyzes of readdirSync(join(REPO, relativ), { withFileTypes: true })) {
      const ut = `${relativ}/${bejegyzes.name}`
      if (kiveve.some((kivetel) => ut === kivetel || ut.startsWith(`${kivetel}/`))) continue
      if (bejegyzes.isDirectory()) {
        bejar(ut)
        continue
      }
      talalatok.push(ut)
    }
  }
  bejar(gyoker)
  return talalatok
}

describe('Szerkesztő — nyilvános /blog HTML nem visz kutatási jegyzéket', () => {
  it.each(MINDEN_CIKK.map((cikk) => [cikk.slug, cikk] as const))(
    '%s törzse és renderelt HTML-je mentes a tiltott jelölésektől',
    (_slug, cikk) => {
      const feluletek = [
        ['törzs', cikk.torzs],
        ['HTML', cikk.html],
        ['látható szöveg', htmlSzoveg(cikk.html)],
      ] as const
      for (const [hol, szoveg] of feluletek) {
        for (const { nev, minta } of SZERKESZTO_MINTAK) {
          expect(tiltottTalalat(szoveg, minta), `${cikk.slug} ${hol}: ${nev}`).toBeUndefined()
        }
      }
      expect(bibliografiaHtml(cikk.html), `${cikk.slug}: látható forrásjegyzék`).toEqual([])
    },
  )

  it('a /blog lista sablonja és a kártyák sem viszik a kutatási zsargont', () => {
    const lista = [
      olvas('src/app/(frontend)/blog/page.tsx'),
      olvas('src/app/(frontend)/blog/kategoria/[slug]/page.tsx'),
      renderToStaticMarkup(createElement(PostsEmptyState, { variant: 'tudastar' })),
      renderToStaticMarkup(createElement(PostsEmptyState, { variant: 'kategoria' })),
      JSON.stringify(
        blogJsonLd({
          name: 'Tudástár',
          description:
            'Kézrehabilitációs cikkek, gyakorlatok és szakmai tudástár a Kineticare-től.',
          path: '/blog',
          posts: MINDEN_CIKK.map((cikk, index) => ({
            ...cikkPost({
              slug: cikk.slug,
              title: cikk.title,
              excerpt: cikk.excerpt,
              content: { root: { type: 'root', children: [] } },
            }),
            id: index + 1,
          })),
        }),
      ),
      ...MINDEN_CIKK.map((cikk) =>
        renderToStaticMarkup(
          createElement(PostCard, {
            post: {
              id: 1,
              title: cikk.title,
              slug: cikk.slug,
              excerpt: cikk.excerpt,
              heroImage: null,
              publishedAt: '2026-08-21T08:00:00.000Z',
              categories: [{ id: 5, title: 'Kézrehabilitáció', slug: 'kezrehabilitacio' }],
              status: 'published',
            } as Pick<
              Post,
              | 'id'
              | 'title'
              | 'slug'
              | 'excerpt'
              | 'heroImage'
              | 'publishedAt'
              | 'categories'
              | 'status'
            >,
            variant: 'list',
          }),
        ),
      ),
    ].join('\n')

    for (const { nev, minta } of SZERKESZTO_MINTAK) {
      expect(tiltottTalalat(lista, minta), `lista: ${nev}`).toBeUndefined()
    }
    expect(bibliografiaHtml(lista)).toEqual([])
  })
})

describe('Design — a kezdőlap és a /kezrelax nem fizetett Ads-lander', () => {
  const kampany = kampanyMd()
  const landerek = vegsoUrlok(kampany)
  const sitelinkek = sitelinkCelok(kampany)

  it('a 7.2 végső URL-tábla kitöltött, és nem a / vagy a /kezrelax', () => {
    expect(landerek.length).toBeGreaterThanOrEqual(7)
    expect(landerek).not.toContain('/')
    expect(landerek).not.toContain('/kezrelax')
    expect(landerek.every((url) => url.startsWith('/'))).toBe(true)
  })

  it('a sitelink-célok sem a kezdőlapra vagy a /kezrelax átirányításra mennek', () => {
    expect(sitelinkek).toContain('/blog')
    expect(sitelinkek).not.toContain('/')
    expect(sitelinkek).not.toContain('/kezrelax')
  })

  it('a /kezrelax 308 a kanonikus SOS kurzusra, page route nincs', () => {
    const qr = LEGACY_REDIRECTS.find((rule) => rule.source === '/kezrelax')
    expect(qr?.destination).toBe(COURSE_SOS_KEZRELAX)
    expect(fajlnevek('src/app').some((ut) => ut.includes('/kezrelax'))).toBe(false)
  })

  it('az RSA és a bővítmény-kreatív celláiban nincs százalék- vagy alkalomszám-ígéret', () => {
    const kreativok = [...rsaKreativok(kampany), ...bovitmenyKreativok(kampany)]
    expect(kreativok.length, 'üres kreatív-parser: a zár nem mérne').toBeGreaterThan(100)
    for (const szoveg of kreativok) {
      expect(szoveg, `százalék-ígéret: ${szoveg}`).not.toMatch(/\d+\s*%/)
      expect(szoveg, `alkalomszám-ígéret: ${szoveg}`).not.toMatch(
        /(?:\d+\s*[-–]\s*\d+|\d+)\s*alkalommal/i,
      )
    }
  })

  it('a vevői felületen nincs kitalált orvosi/anatómiai diagram-fájl', () => {
    const minta =
      /anatomy|anatóm|csontváz|csontvaz|orvosi-ábra|orvosi-abra|medical-diagram|ízületi-ábra|izuleti-abra/i
    const vevoi = [
      ...fajlnevek('src/app/(frontend)'),
      ...fajlnevek('src/components', ['src/components/admin']),
    ]
    expect(vevoi.filter((ut) => minta.test(ut))).toEqual([])
  })
})

describe('Kutató — ínhüvely és befagyott váll nyilvános HTML', () => {
  it.each(KUTATO_SLUGOK)('%s címe nem műtéti címsor', (slug) => {
    const { title, html } = cikkOf(slug)
    const h1 = html
      .match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]
      ?.replace(/<[^>]+>/g, '')
      .trim()
    expect(h1).toBe(title)
    for (const cim of TILTOTT_CIMEK) {
      expect(title.toLowerCase(), `${slug} title`).not.toBe(cim)
      expect(title.toLowerCase(), `${slug} title`).not.toContain(cim)
    }
  })

  it('az ínhüvely nyilvános HTML-jében nincs önálló 112', () => {
    const { html, torzs } = cikkOf('inhuvelygyulladas')
    expect(onalloSzam(html, '112')).toBe(false)
    expect(onalloSzam(htmlSzoveg(html), '112')).toBe(false)
    expect(onalloSzam(torzs, '112')).toBe(false)
  })

  it.each(KUTATO_SLUGOK)(
    '%s törzse nem ígér gyógyulási százalékot, hetek alatti rendbejövést vagy alkalomszámot',
    (slug) => {
      const { html, torzs } = cikkOf(slug)
      const lathato = htmlSzoveg(html)
      for (const szoveg of [torzs, lathato]) {
        expect(gyogyulasiSzazalekIgeretek(szoveg), `${slug}: gyógyulási %`).toEqual([])
        expect(hetekAlattIgeretek(szoveg), `${slug}: hetek alatt ígéret`).toEqual([])
        expect(alkalomszamIgeretek(szoveg), `${slug}: alkalomszám`).toEqual([])
      }
    },
  )
})
