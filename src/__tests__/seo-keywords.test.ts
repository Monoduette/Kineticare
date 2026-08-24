import { readFileSync } from 'node:fs'

import type { Field, Payload } from 'payload'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { Pages } from '../collections/Pages'
import { Posts } from '../collections/Posts'
import { HomeView } from '../components/content/HomeView'
import { PageEeat } from '../components/content/PageEeat'
import { PostArticle } from '../components/content/PostArticle'
import { seoKeywordsField } from '../fields/seo-keywords'
import {
  buildDocMetadata,
  buildHomeMetadata,
  buildStaticPageMetadata,
  courseListingJsonLd,
  homeWebPageJsonLd,
} from '../lib/seo'
import { cmsPageJsonLd, postArticleJsonLd } from '../lib/seo-cikk'
import {
  resolveSeoKeywords,
  SEO_KEYWORDS_MAX_LENGTH,
  SEO_KEYWORDS_MAX_ROWS,
} from '../lib/seo-keywords'
import {
  CIKK_KULCSSZAVAK,
  kulcsszoFor,
  KURZUSLISTA_KULCSSZAVAK,
  kurzusKulcsszavakFor,
  kurzusSeoKeywordsFor,
  meresToSeoKeywords,
  OLDAL_KULCSSZAVAK,
  oldalKulcsszavakFor,
  oldalSeoKeywordsFor,
} from '../lib/tudastar/seo-kulcsszavak'
import type { Page, Post } from '../payload-types'
import configPromise from '../payload.config'
import {
  CIKKEK,
  cikketFordit,
  kurzusKulcsszavakatSzinkronizal,
  oldalKulcsszavakatSzinkronizal,
} from '../scripts/import-tudastar-cikkek'

/**
 * CMS `seoKeywords`: szerkeszthető mező a posztokon, az oldalakon és a
 * kurzusokon.
 *
 * A kifejezések a HTML-forrásba mennek (JSON-LD + meta keywords). A nyilvános
 * lapon NEM jelennek meg külön listaként. Üres mezőnél nincs meta-tag és
 * nincs JSON-LD kulcs — H1-ből kitalálni tilos.
 */

const TORZS = {
  root: {
    type: 'root',
    direction: 'ltr',
    format: '',
    indent: 0,
    version: 1,
    children: [
      {
        type: 'paragraph',
        direction: 'ltr',
        format: '',
        indent: 0,
        version: 1,
        children: [
          {
            type: 'text',
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
            text: 'Rövid bevezető a törzsben.',
            version: 1,
          },
        ],
      },
    ],
  },
}

const lapPost = (overrides: Record<string, unknown> = {}): Post =>
  ({
    id: 3,
    title: 'Teniszkönyök kezelése házilag',
    slug: 'teniszkonyok',
    excerpt: 'Mit tehetsz otthon, ha belenyilall a könyöködbe.',
    status: 'published',
    publishedAt: '2026-08-10T08:00:00.000Z',
    updatedAt: '2026-08-12T09:30:00.000Z',
    createdAt: '2026-08-09T08:00:00.000Z',
    content: TORZS,
    ...overrides,
  }) as unknown as Post

const lapOldal = (overrides: Record<string, unknown> = {}): Page =>
  ({
    id: 8,
    title: 'Rólunk',
    slug: 'rolunk',
    excerpt: 'A Kineticare gyógytornászai.',
    status: 'published',
    publishedAt: '2026-08-10T08:00:00.000Z',
    updatedAt: '2026-08-12T09:30:00.000Z',
    createdAt: '2026-08-09T08:00:00.000Z',
    content: TORZS,
    ...overrides,
  }) as unknown as Page

function visibleHtml(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
}

function jsonLdBlocks(html: string): Record<string, unknown>[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (match) => JSON.parse(match[1]!.replace(/\\u003c/g, '<')) as Record<string, unknown>,
  )
}

function rootFields(fields: Field[], acc = new Map<string, Field>()): Map<string, Field> {
  for (const field of fields) {
    if ('name' in field && typeof field.name === 'string') {
      acc.set(field.name, field)
      continue
    }
    if (field.type === 'row' || field.type === 'collapsible' || field.type === 'group') {
      rootFields(field.fields, acc)
      continue
    }
    if (field.type === 'tabs') {
      for (const tab of field.tabs) {
        if (!('name' in tab)) {
          rootFields(tab.fields, acc)
        }
      }
    }
  }
  return acc
}

describe('seoKeywords mező a posts, pages és products kollekción', () => {
  it.each([
    ['posts', Posts],
    ['pages', Pages],
  ] as const)('%s.seoKeywords array, 48-as plafon, nem kötelező', (_name, collection) => {
    const field = rootFields(collection.fields).get('seoKeywords')
    expect(field, `${collection.slug}.seoKeywords hiányzik`).toBeDefined()
    expect(field).toBe(seoKeywordsField)
    if (field?.type !== 'array') {
      throw new Error('seoKeywords nem array')
    }
    expect(field.required).toBeUndefined()
    expect(field.maxRows).toBe(SEO_KEYWORDS_MAX_ROWS)
    expect(field.maxRows).toBe(48)
    expect(field.label).toBe('SEO kulcsszavak')
    const description = field.admin?.description
    expect(typeof description).toBe('string')
    expect(String(description)).toMatch(/forráskódba mennek/)
    expect(String(description)).toMatch(/lapon nem látszanak/)
    const phrase = field.fields.find((row) => 'name' in row && row.name === 'phrase')
    expect(phrase?.type).toBe('text')
    expect(phrase && 'required' in phrase ? phrase.required : undefined).toBe(true)
    expect(phrase && 'maxLength' in phrase ? phrase.maxLength : undefined).toBe(
      SEO_KEYWORDS_MAX_LENGTH,
    )
    expect(phrase && 'maxLength' in phrase ? phrase.maxLength : undefined).toBe(80)
    expect(field.type).toBe('array')
  })

  it('a products kollekción is a közös seoKeywordsField áll a seoDescription után', async () => {
    const config = await configPromise
    const products = (config.collections ?? []).find((collection) => collection.slug === 'products')
    expect(products, 'products collection hiányzik').toBeDefined()
    const fields = rootFields(products!.fields)
    expect(fields.get('seoKeywords')).toBe(seoKeywordsField)
    expect(fields.has('seoTitle')).toBe(true)
    expect(fields.has('seoDescription')).toBe(true)
    expect(fields.has('noindex')).toBe(false)
    const names = products!.fields.flatMap((field) =>
      'name' in field && typeof field.name === 'string' ? [field.name] : [],
    )
    expect(names.indexOf('seoKeywords')).toBe(names.indexOf('seoDescription') + 1)
  })

  it('a seoTitle és a seoDescription megmarad, nincs noindex mező', () => {
    for (const collection of [Posts, Pages]) {
      const fields = rootFields(collection.fields)
      expect(fields.has('seoTitle')).toBe(true)
      expect(fields.has('seoDescription')).toBe(true)
      expect(fields.has('noindex')).toBe(false)
    }
  })
})

describe('resolveSeoKeywords', () => {
  it('kitöltött sorokból egyedi, trimmelt listát ad', () => {
    expect(
      resolveSeoKeywords([
        { phrase: '  teniszkönyök  ' },
        { phrase: 'teniszkönyök' },
        { phrase: '   ' },
        { phrase: 'teniszkönyök gyakorlatok' },
      ]),
    ).toEqual(['teniszkönyök', 'teniszkönyök gyakorlatok'])
  })

  it('üres tömb, hiányzó mező és csupa üres sor → undefined', () => {
    expect(resolveSeoKeywords(undefined)).toBeUndefined()
    expect(resolveSeoKeywords(null)).toBeUndefined()
    expect(resolveSeoKeywords([])).toBeUndefined()
    expect(resolveSeoKeywords([{ phrase: '' }, { phrase: '   ' }])).toBeUndefined()
  })

  it('a maxRows plafonnál megáll', () => {
    const rows = Array.from({ length: SEO_KEYWORDS_MAX_ROWS + 3 }, (_, index) => ({
      phrase: `kifejezés-${index + 1}`,
    }))
    expect(resolveSeoKeywords(rows)).toHaveLength(SEO_KEYWORDS_MAX_ROWS)
  })

  it('a maxLength plafonig tartó kifejezést nem vágja csonkra', () => {
    const phrase = 'k'.repeat(SEO_KEYWORDS_MAX_LENGTH)
    expect(phrase).toHaveLength(80)
    expect(resolveSeoKeywords([{ phrase }])).toEqual([phrase])
  })
})

describe('buildDocMetadata keywords meta-tag', () => {
  it('kitöltött mező → keywords tömb a metaadatokban', () => {
    const metadata = buildDocMetadata(
      {
        title: 'Cím a H1-en',
        seoKeywords: [{ phrase: 'teniszkönyök' }, { phrase: 'teniszkönyök gyakorlatok' }],
      },
      '/blog/teniszkonyok',
    )
    expect(metadata.keywords).toEqual(['teniszkönyök', 'teniszkönyök gyakorlatok'])
    expect(metadata.title).toBe('Cím a H1-en')
  })

  it('üres mezőnél nincs keywords kulcs, a H1-et nem tölti bele', () => {
    const metadata = buildDocMetadata({ title: 'Csak a H1' }, '/blog/valami')
    expect('keywords' in metadata).toBe(false)
    expect(metadata.keywords).toBeUndefined()
    const ures = buildDocMetadata({ title: 'Csak a H1', seoKeywords: [] }, '/blog/valami')
    expect('keywords' in ures).toBe(false)
  })
})

describe('JSON-LD a CMS mezőből', () => {
  it('poszt: kitöltött seoKeywords a keywords kulcsba kerül', () => {
    const jsonLd = postArticleJsonLd({
      post: { title: 'Teniszkönyök kezelése házilag' },
      path: '/blog/teniszkonyok',
      keywords: ['teniszkönyök', 'teniszkönyök gyakorlatok'],
    })
    expect(jsonLd.keywords).toBe('teniszkönyök, teniszkönyök gyakorlatok')
  })

  it('poszt: üres keywords → a kulcs kimarad', () => {
    const jsonLd = postArticleJsonLd({
      post: { title: 'Valami más' },
      path: '/blog/valami',
    })
    expect('keywords' in jsonLd).toBe(false)
  })

  it('oldal: kitöltött mező a MedicalWebPage keywords kulcsába kerül', () => {
    const jsonLd = cmsPageJsonLd({
      page: { title: 'Rólunk' },
      path: '/rolunk',
      keywords: ['kézrehabilitáció', 'gyógytorna Budapest'],
    })
    expect(jsonLd.keywords).toBe('kézrehabilitáció, gyógytorna Budapest')
  })

  it('oldal: üres mezőnél nincs keywords kulcs', () => {
    const jsonLd = cmsPageJsonLd({ page: { title: 'Rólunk' }, path: '/rolunk' })
    expect('keywords' in jsonLd).toBe(false)
  })
})

describe('nyilvános HTML: forrásban benne, lapon nincs felhő', () => {
  const nonce = 'xyzzy-kulcsszo-teszt-9f3a'

  it('a cikk JSON-LD-je tartalmazza a CMS kifejezéseket, a látható HTML nem', () => {
    const post = lapPost({
      title: 'Cím a H1-en',
      excerpt: 'Lead a hero-ban.',
      seoKeywords: [{ phrase: nonce }, { phrase: 'második kifejezés' }],
    })
    const html = renderToStaticMarkup(createElement(PostArticle, { post }))
    const visible = visibleHtml(html)
    const article = jsonLdBlocks(html).find((block) => Array.isArray(block['@type']))

    expect(article, 'nincs cikk JSON-LD').toBeDefined()
    expect(String(article!.keywords)).toContain(nonce)
    expect(String(article!.keywords)).toContain('második kifejezés')
    expect(visible).not.toContain(nonce)
    expect(visible).not.toMatch(/kc-seo-keywords|kulcsszó-felhő|seo-keywords/i)
    expect(html).not.toMatch(/<meta\s+name="keywords"/i)
  })

  it('üres seoKeywords mellett a cikk JSON-LD-jében nincs keywords kulcs', () => {
    const html = renderToStaticMarkup(createElement(PostArticle, { post: lapPost() }))
    const article = jsonLdBlocks(html).find((block) => Array.isArray(block['@type']))
    expect(article, 'nincs cikk JSON-LD').toBeDefined()
    expect('keywords' in article!).toBe(false)
  })

  it('az oldal JSON-LD-je tartalmazza a CMS kifejezéseket, látható felhő nincs', () => {
    const page = lapOldal({
      title: 'Szöveges oldal',
      excerpt: 'Bevezető.',
      seoKeywords: [{ phrase: nonce }],
    })
    const html = renderToStaticMarkup(createElement(PageEeat, { page, path: '/rolunk' }))
    const visible = visibleHtml(html)
    const schema = jsonLdBlocks(html).find((block) => block['@type'] === 'MedicalWebPage')

    expect(schema, 'nincs MedicalWebPage JSON-LD').toBeDefined()
    expect(String(schema!.keywords)).toContain(nonce)
    expect(visible).not.toContain(nonce)
    expect(visible).not.toMatch(/kc-seo-keywords|kulcsszó-felhő|seo-keywords/i)
    expect(html).not.toMatch(/<h[1-6][^>]*>\s*SEO kulcsszavak/)
  })
})

describe('tudástár-importer: a nyolc slug a mért táblából tölti a mezőt', () => {
  const cikkekDir = `${process.cwd()}/docs/cikkek`

  it.each(CIKKEK.map((cikk) => [cikk.slug, cikk.fajl] as const))(
    '%s: elsodleges elöl, utána a masodlagosak',
    (slug, fajl) => {
      const meres = CIKK_KULCSSZAVAK.find((item) => item.slug === slug)
      expect(meres, `nincs mérés: ${slug}`).toBeDefined()
      const cikk = cikketFordit(cikkekDir, fajl, slug)
      expect(cikk.seoKeywords.map((row) => row.phrase)).toEqual([
        meres!.elsodleges,
        ...meres!.masodlagos,
      ])
      expect(cikk.seoKeywords).toEqual(meresToSeoKeywords(meres!))
      expect(cikk.seoKeywords.length).toBeLessThanOrEqual(SEO_KEYWORDS_MAX_ROWS)
    },
  )

  it('az importer nem noindexel és nem ír kitalált oldalkulcsszót', () => {
    expect(rootFields(Posts.fields).has('noindex')).toBe(false)
    expect(rootFields(Pages.fields).has('noindex')).toBe(false)
  })
})

/** Search lock 2026-08-24, vágatlan lista. Rangsor, volumen, KD nem része. */
const SEARCH_LOCK_CIKK = JSON.parse(
  readFileSync(`${process.cwd()}/src/lib/tudastar/search-lock-2026-08-24.json`, 'utf8'),
) as Record<string, readonly string[]>

const SEARCH_LOCK_COUNTS: Record<string, number> = {
  'miert-zsibbad-a-kezem': 43,
  'keztoalagut-szindroma': 22,
  teniszkonyok: 32,
  'pattano-ujj': 9,
  'csuklo-es-kezfajdalom': 31,
  'csuklotores-utani-gyogytorna': 16,
  inhuvelygyulladas: 41,
  'befagyott-vall': 21,
}

describe('Search lock 2026-08-24: cikk seoKeywords', () => {
  it.each(Object.entries(SEARCH_LOCK_CIKK))(
    '%s: meresToSeoKeywords == a vágatlan lockolt lista, ≤48',
    (slug, lock) => {
      const meres = kulcsszoFor(slug)
      expect(meres, `nincs mérés: ${slug}`).toBeDefined()
      const phrases = meresToSeoKeywords(meres!).map((row) => row.phrase)
      expect(phrases).toEqual([...lock])
      expect(phrases).toHaveLength(SEARCH_LOCK_COUNTS[slug] ?? -1)
      expect(phrases).toHaveLength(lock.length)
      expect(phrases.length).toBeLessThanOrEqual(SEO_KEYWORDS_MAX_ROWS)
      expect(phrases[0]).toBe(meres!.elsodleges)
      expect(phrases.join(' ')).not.toMatch(/\b(KD|volumen|rangsor)\b/i)
      for (const kifejezes of phrases) {
        expect(
          kifejezes.length,
          `${slug}: „${kifejezes}” > ${SEO_KEYWORDS_MAX_LENGTH}`,
        ).toBeLessThanOrEqual(SEO_KEYWORDS_MAX_LENGTH)
      }
    },
  )

  it('ínhüvely: 41 tétel, nincs boka/láb/BNO; krém és gyógyszer a lockban marad', () => {
    const phrases = meresToSeoKeywords(kulcsszoFor('inhuvelygyulladas')!).map((row) => row.phrase)
    expect(phrases).toHaveLength(41)
    const egyben = phrases.join(' | ').toLowerCase()
    expect(egyben).not.toMatch(/\bboka\b/)
    expect(egyben).not.toMatch(/\bláb\b/)
    expect(egyben).not.toContain('bno')
    expect(egyben).toMatch(/krém/)
    expect(egyben).toMatch(/gyógyszer/)
  })

  it('váll: 21 tétel, nincs pontosan fagyott váll és vállfájdalom', () => {
    const phrases = meresToSeoKeywords(kulcsszoFor('befagyott-vall')!).map((row) => row.phrase)
    expect(phrases).toHaveLength(21)
    expect(phrases).not.toContain('fagyott váll')
    expect(phrases).not.toContain('vállfájdalom')
    expect(phrases).toContain('befagyott váll')
  })

  it('HOLD: lelki okai, dupuytren, más slug primére nincs a nyolc listában', () => {
    const primaries = CIKK_KULCSSZAVAK.map((item) => item.elsodleges)
    for (const meres of CIKK_KULCSSZAVAK) {
      const phrases = meresToSeoKeywords(meres).map((row) => row.phrase)
      expect(phrases).not.toContain('lelki okai')
      expect(phrases).not.toContain('dupuytren')
      expect(phrases.join(' | ').toLowerCase()).not.toContain('lelki okai')
      expect(phrases.join(' | ').toLowerCase()).not.toContain('dupuytren')
      const idegen = primaries.filter((phrase) => phrase !== meres.elsodleges)
      for (const masik of idegen) {
        expect(phrases.slice(1), `${meres.slug} tartalmazza ${masik} primért`).not.toContain(masik)
      }
    }
  })

  it('seoTitle, volumen, nehezseg, targy, indok a lock után is megmarad', () => {
    const inh = kulcsszoFor('inhuvelygyulladas')!
    expect(inh.volumen).toBe(2200)
    expect(inh.nehezseg).toBe(18)
    expect(inh.seoTitle).toBe('Ínhüvelygyulladás: tünetek és mit tehetsz')
    expect(inh.targy).toEqual({ tipus: 'MedicalCondition', nev: 'Ínhüvelygyulladás' })
    expect(inh.indok.length).toBeGreaterThan(40)

    const vall = kulcsszoFor('befagyott-vall')!
    expect(vall.volumen).toBe(880)
    expect(vall.nehezseg).toBe(12)
    expect(vall.seoTitle).toBe('Befagyott váll: szakaszok és teendők')

    const csuklo = kulcsszoFor('csuklo-es-kezfajdalom')!
    expect(csuklo.elsodleges).toBe('csukló fájdalom')
  })
})

describe('Search lock 2026-08-24: pages seoKeywords', () => {
  it('kezdolap / szolgaltatasok / rolunk a lockolt listát viszi', () => {
    expect(oldalKulcsszavakFor('kezdolap')).toEqual([
      'Kineticare',
      'kéztorna',
      'kéztorna gyakorlatok',
      'otthoni gyógytorna',
    ])
    expect(oldalKulcsszavakFor('szolgaltatasok')).toEqual(['kéztorna', 'otthoni gyógytorna'])
    expect(oldalKulcsszavakFor('rolunk')).toEqual(['Kiss Kata', 'Kocsis Kata', 'Kineticare'])
    expect(oldalSeoKeywordsFor('kezdolap')?.map((row) => row.phrase)).toEqual([
      'Kineticare',
      'kéztorna',
      'kéztorna gyakorlatok',
      'otthoni gyógytorna',
    ])
  })

  it('kapcsolat / impresszum / adatvedelem / aszf / kurzusok szándékosan üres', () => {
    for (const slug of ['kapcsolat', 'impresszum', 'adatvedelem', 'aszf', 'kurzusok']) {
      expect(oldalKulcsszavakFor(slug), slug).toBeUndefined()
      expect(oldalSeoKeywordsFor(slug), slug).toBeUndefined()
      expect(slug in OLDAL_KULCSSZAVAK, `${slug} legyen a lock-táblában`).toBe(true)
    }
  })

  it('A-gyökér pages slugok nincsenek a lock-táblában', () => {
    for (const slug of ['inhuvelygyulladas', 'keztoalagut-szindroma', 'teniszkonyok']) {
      expect(slug in OLDAL_KULCSSZAVAK).toBe(false)
      expect(oldalSeoKeywordsFor(slug)).toBeUndefined()
    }
  })
})

describe('Search lock 2026-08-24: kurzus seoKeywords', () => {
  const harom = ['otthoni gyógytorna', 'kéztorna', 'kéztorna gyakorlatok'] as const

  it('otthoni-kezrehab-program és /kurzusok listing ugyanaz a 3, primér otthoni gyógytorna', () => {
    expect([...KURZUSLISTA_KULCSSZAVAK]).toEqual([...harom])
    expect(KURZUSLISTA_KULCSSZAVAK[0]).toBe('otthoni gyógytorna')
    expect(kurzusKulcsszavakFor('otthoni-kezrehab-program')).toEqual([...harom])
    expect(kurzusSeoKeywordsFor('otthoni-kezrehab-program')?.map((row) => row.phrase)).toEqual([
      ...harom,
    ])
    expect(harom[0]).not.toBe('kéztorna')
  })

  it('SOS szándékosan üres', () => {
    expect(kurzusKulcsszavakFor('sos-kezrelax-villamkurzus')).toBeUndefined()
    expect(kurzusSeoKeywordsFor('sos-kezrelax-villamkurzus')).toBeUndefined()
  })

  it('/kurzusok listing metadata a lockolt három kifejezést viszi', () => {
    const src = readFileSync(`${process.cwd()}/src/app/(frontend)/kurzusok/page.tsx`, 'utf8')
    expect(src).toContain('keywords: KURZUSLISTA_KULCSSZAVAK')
    expect(src).toContain('courseListingJsonLd')
    expect(src).not.toMatch(/LEGACY_REDIRECTS/)
    const meta = buildStaticPageMetadata({
      title: 'Kurzusok',
      description: 'Leírás.',
      path: '/kurzusok',
      keywords: KURZUSLISTA_KULCSSZAVAK,
    })
    expect(meta.keywords).toEqual([...harom])
    expect(meta.alternates?.canonical).toBe('/kurzusok')
  })

  it('/kurzusok listing JSON-LD a lockolt 3 kifejezést viszi, primér otthoni gyógytorna', () => {
    const jsonLd = courseListingJsonLd()
    expect(jsonLd['@type']).toBe('CollectionPage')
    expect(jsonLd.keywords).toBe('otthoni gyógytorna, kéztorna, kéztorna gyakorlatok')
    expect(String(jsonLd.keywords).split(', ')[0]).toBe('otthoni gyógytorna')
  })

  it('SOS termékoldal nem kapja a listing kulcsszavait', () => {
    const src = readFileSync(
      `${process.cwd()}/src/app/(frontend)/kurzusok/[slug]/page.tsx`,
      'utf8',
    )
    expect(src).not.toContain('KURZUSLISTA_KULCSSZAVAK')
    expect(src).not.toContain('courseListingJsonLd')
    expect(kurzusKulcsszavakFor('sos-kezrelax-villamkurzus')).toBeUndefined()
  })
})

describe('kezdőlap / JSON-LD és meta keywords a CMS seoKeywords-ből', () => {
  const negy = [
    'Kineticare',
    'kéztorna',
    'kéztorna gyakorlatok',
    'otthoni gyógytorna',
  ] as const

  it('kitöltött kezdolap seoKeywords → buildHomeMetadata a 4 kifejezés', () => {
    const metadata = buildHomeMetadata({
      title: 'Kezdőlap',
      seoKeywords: negy.map((phrase) => ({ phrase })),
    })
    expect(metadata.keywords).toEqual([...negy])
    expect(metadata.alternates?.canonical).toBe('/')
  })

  it('üres kezdolap seoKeywords → / metadata-ban nincs keywords kulcs', () => {
    expect('keywords' in buildHomeMetadata({ title: 'Kezdőlap' })).toBe(false)
    expect('keywords' in buildHomeMetadata({ title: 'Kezdőlap', seoKeywords: [] })).toBe(false)
    expect('keywords' in buildHomeMetadata(null)).toBe(false)
  })

  it('H1-ből nem talál ki kulcsszót', () => {
    const metadata = buildHomeMetadata({
      title: 'Hatékony és biztonságos módszerek a kéz fájdalmaira',
      seoKeywords: [],
    })
    expect('keywords' in metadata).toBe(false)
    const jsonLd = homeWebPageJsonLd({
      title: 'Hatékony és biztonságos módszerek a kéz fájdalmaira',
      seoKeywords: [],
    })
    expect('keywords' in jsonLd).toBe(false)
  })

  it('kitöltött seoKeywords → WebPage JSON-LD a 4 kifejezés, látható HTML-ben nincs felhő', () => {
    const nonce = 'xyzzy-kezdolap-kulcsszo-teszt-8c2b'
    const html = renderToStaticMarkup(
      createElement(HomeView, {
        home: lapOldal({
          slug: 'kezdolap',
          title: 'Hatékony módszerek a kéz fájdalmaira',
          seoKeywords: [...negy, nonce].map((phrase) => ({ phrase })),
        }),
        products: [],
        posts: [],
      }),
    )
    const visible = visibleHtml(html)
    const pageSchema = jsonLdBlocks(html).find((block) => block['@type'] === 'WebPage')

    expect(pageSchema, 'nincs WebPage JSON-LD a kezdőlapon').toBeDefined()
    expect(pageSchema!.keywords).toBe([...negy, nonce].join(', '))
    const org = jsonLdBlocks(html).find((block) => block['@type'] === 'Organization')
    expect(org).toBeDefined()
    expect('keywords' in org!).toBe(false)
    expect(visible).not.toContain(nonce)
    expect(visible).not.toMatch(/kc-seo-keywords|kulcsszó-felhő|seo-keywords/i)
    expect(html).not.toMatch(/<meta\s+name="keywords"/i)
  })

  it('üres seoKeywords → a kezdőlap JSON-LD-jében nincs keywords kulcs', () => {
    const html = renderToStaticMarkup(
      createElement(HomeView, {
        home: lapOldal({ slug: 'kezdolap', title: 'Kezdőlap', seoKeywords: [] }),
        products: [],
        posts: [],
      }),
    )
    const pageSchema = jsonLdBlocks(html).find((block) => block['@type'] === 'WebPage')
    expect(pageSchema, 'nincs WebPage JSON-LD').toBeDefined()
    expect('keywords' in pageSchema!).toBe(false)
    expect(jsonLdBlocks(html).some((block) => 'keywords' in block)).toBe(false)
  })

  it('a / generateMetadata a buildHomeMetadata úton viszi a seoKeywords-t', () => {
    const src = readFileSync(`${process.cwd()}/src/app/(frontend)/page.tsx`, 'utf8')
    expect(src).toContain('buildHomeMetadata')
    expect(src).toContain('getHomePage')
    expect(src).not.toContain('buildStaticPageMetadata')
  })
})

describe('oldalKulcsszavakatSzinkronizal: csak meglévő rekord, csak seoKeywords', () => {
  function pagesPayload(docsBySlug: Record<string, { id: number } | undefined>) {
    const find = vi.fn(
      async (args: { collection: string; where: { slug: { equals: string } } }) => {
        expect(args.collection).toBe('pages')
        const doc = docsBySlug[args.where.slug.equals]
        return { docs: doc ? [doc] : [] }
      },
    )
    const update = vi.fn<(args: { id: number; data: Record<string, unknown> }) => Promise<object>>(
      async () => ({}),
    )
    const create = vi.fn(async () => {
      throw new Error('pages create tilos')
    })
    return { find, update, create, payload: { find, update, create } as unknown as Payload }
  }

  it('írja a három kitöltött oldalt, üreset kihagyja, hiányzót nem hozza létre', async () => {
    const { find, update, create, payload } = pagesPayload({
      kezdolap: { id: 1 },
      szolgaltatasok: { id: 2 },
      rolunk: { id: 3 },
      kapcsolat: { id: 4 },
      impresszum: { id: 5 },
      adatvedelem: { id: 6 },
      aszf: { id: 7 },
    })

    const eredmeny = await oldalKulcsszavakatSzinkronizal(payload, { dryRun: false })

    expect(create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(3)
    expect(eredmeny).toEqual({ frissitve: 3, kihagyva: 4, hianyzik: 1 })
    expect(find).toHaveBeenCalled()

    const irt = update.mock.calls.map(([args]) => {
      expect(Object.keys(args.data)).toEqual(['seoKeywords'])
      expect(args.data).not.toHaveProperty('title')
      expect(args.data).not.toHaveProperty('status')
      expect(args.data).not.toHaveProperty('content')
      expect(args.data).not.toHaveProperty('author')
      expect(args.data).not.toHaveProperty('faq')
      return {
        id: args.id,
        phrases: (args.data.seoKeywords as { phrase: string }[]).map((row) => row.phrase),
      }
    })
    expect(irt).toEqual([
      { id: 1, phrases: ['Kineticare', 'kéztorna', 'kéztorna gyakorlatok', 'otthoni gyógytorna'] },
      { id: 2, phrases: ['kéztorna', 'otthoni gyógytorna'] },
      { id: 3, phrases: ['Kiss Kata', 'Kocsis Kata', 'Kineticare'] },
    ])
  })

  it('dry-run mellett nem ír', async () => {
    const { update, create, payload } = pagesPayload({ kezdolap: { id: 1 } })
    const eredmeny = await oldalKulcsszavakatSzinkronizal(payload, { dryRun: true })
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(eredmeny.frissitve).toBe(0)
  })

  it('a script pages-re create-et nem hív, noindex mező nincs', () => {
    const src = readFileSync(`${process.cwd()}/src/scripts/import-tudastar-cikkek.ts`, 'utf8')
    expect(src).toMatch(/OWNER_TUDASTAR_CONFIRM/)
    expect(src).toContain("collection: 'pages'")
    expect(src).not.toMatch(/collection:\s*'pages'[\s\S]{0,200}payload\.create/)
    expect(src).not.toMatch(/payload\.create\([\s\S]{0,200}collection:\s*'pages'/)
    expect(rootFields(Posts.fields).has('noindex')).toBe(false)
    expect(rootFields(Pages.fields).has('noindex')).toBe(false)
  })
})

describe('kurzusKulcsszavakatSzinkronizal: csak meglévő rekord, csak seoKeywords', () => {
  function productsPayload(docsBySlug: Record<string, { id: number } | undefined>) {
    const find = vi.fn(
      async (args: { collection: string; where: { slug: { equals: string } } }) => {
        expect(args.collection).toBe('products')
        const doc = docsBySlug[args.where.slug.equals]
        return { docs: doc ? [doc] : [] }
      },
    )
    const update = vi.fn<(args: { id: number; data: Record<string, unknown> }) => Promise<object>>(
      async () => ({}),
    )
    const create = vi.fn(async () => {
      throw new Error('products create tilos')
    })
    return { find, update, create, payload: { find, update, create } as unknown as Payload }
  }

  it('írja az otthoni programot, az SOS-t kihagyja, hiányzót nem hozza létre', async () => {
    const { find, update, create, payload } = productsPayload({
      'otthoni-kezrehab-program': { id: 11 },
      'sos-kezrelax-villamkurzus': { id: 12 },
    })

    const eredmeny = await kurzusKulcsszavakatSzinkronizal(payload, { dryRun: false })

    expect(create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(1)
    expect(eredmeny).toEqual({ frissitve: 1, kihagyva: 1, hianyzik: 0 })
    expect(find).toHaveBeenCalled()

    const [args] = update.mock.calls[0]!
    expect(args.id).toBe(11)
    expect(Object.keys(args.data)).toEqual(['seoKeywords'])
    expect(args.data).not.toHaveProperty('sku')
    expect(args.data).not.toHaveProperty('status')
    expect(args.data).not.toHaveProperty('priceInHUF')
    expect((args.data.seoKeywords as { phrase: string }[]).map((row) => row.phrase)).toEqual([
      'otthoni gyógytorna',
      'kéztorna',
      'kéztorna gyakorlatok',
    ])
  })

  it('hiányzó kurzust nem hozza létre', async () => {
    const { update, create, payload } = productsPayload({})
    const eredmeny = await kurzusKulcsszavakatSzinkronizal(payload, { dryRun: false })
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(eredmeny).toEqual({ frissitve: 0, kihagyva: 0, hianyzik: 2 })
  })

  it('dry-run mellett nem ír', async () => {
    const { update, create, payload } = productsPayload({
      'otthoni-kezrehab-program': { id: 11 },
    })
    const eredmeny = await kurzusKulcsszavakatSzinkronizal(payload, { dryRun: true })
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(eredmeny.frissitve).toBe(0)
  })

  it('a script products-re create-et nem hív', () => {
    const src = readFileSync(`${process.cwd()}/src/scripts/import-tudastar-cikkek.ts`, 'utf8')
    expect(src).toContain("collection: 'products'")
    expect(src).not.toMatch(/collection:\s*'products'[\s\S]{0,200}payload\.create/)
    expect(src).not.toMatch(/payload\.create\([\s\S]{0,200}collection:\s*'products'/)
  })
})
