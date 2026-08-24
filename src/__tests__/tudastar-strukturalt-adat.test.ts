import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PostArticle } from '../components/content/PostArticle'
import { postFaqItems as postFaqItemsOfPost } from '../components/content/post-article'
import { absoluteUrl, articleJsonLd, blogJsonLd, breadcrumbJsonLd } from '../lib/seo'
import {
  POST_FAQ_MAX_ITEMS,
  postArticleJsonLd,
  postFaqItems,
  postFaqJsonLd,
  type ArticleSeoPost,
  type PostFaqSource,
} from '../lib/seo-cikk'
import { kulcsszoFor } from '../lib/tudastar/seo-kulcsszavak'
import type { Post } from '../payload-types'

/**
 * ŐR — a Tudástár strukturált adata ÉRVÉNYES és a látható tartalommal
 * KONZISZTENS.
 *
 * Miért teszteljük. A strukturált adat legdrágább hibája az, amikor a séma
 * TÖBBET állít, mint amit a lap mutat: a kereső ilyenkor elveti az egészet,
 * és semmilyen hibaüzenet nem jelzi. A `docs/seo-geo-llm.md` alapszabálya
 * ezért: „a séma minden mezője a LÁTHATÓ tartalomból jön".
 *
 * A GEO-oldali cél ugyanez: az AI-válaszok szövegdarabokat idéznek, tehát a
 * gépi leírásnak pontosan azt kell mondania, ami a lapon áll.
 */

const post = (overrides: Partial<Post> = {}): Post =>
  ({
    id: 11,
    title: 'Levették a gipszet a csuklómról, mit csináljak?',
    slug: 'gipsz-utan',
    excerpt: 'Az első hét gyakorlatai és a leggyakoribb hibák.',
    publishedAt: '2026-08-10T08:00:00.000Z',
    updatedAt: '2026-08-12T08:00:00.000Z',
    ...overrides,
  }) as unknown as Post

describe('Blog (lista) JSON-LD', () => {
  it('a Tudástárat írja le, magyar nyelvvel és kanonikus URL-lel', () => {
    const jsonLd = blogJsonLd({
      name: 'Tudástár',
      description: 'Cikkek.',
      path: '/blog',
      posts: [],
    })

    expect(jsonLd['@type']).toBe('Blog')
    expect(jsonLd.name).toBe('Tudástár')
    expect(jsonLd.inLanguage).toBe('hu-HU')
    expect(jsonLd.url).toBe(absoluteUrl('/blog'))
  })

  it('ÜRES listánál nem hirdet egyetlen cikket sem', () => {
    // Nulla elemű gyűjtemény meghirdetése pontosan az az eltérés a látható
    // tartalomtól, ami miatt a keresők elvetik a strukturált adatot.
    const jsonLd = blogJsonLd({ name: 'Tudástár', path: '/blog', posts: [] })
    expect(jsonLd.blogPost).toBeUndefined()
  })

  it('a felsorolt cikkek PONTOSAN a megjelenítettek, kanonikus címükkel', () => {
    const jsonLd = blogJsonLd({ name: 'Tudástár', path: '/blog', posts: [post()] })
    const entries = jsonLd.blogPost as Array<Record<string, unknown>>

    expect(entries).toHaveLength(1)
    expect(entries[0]!['@type']).toBe('BlogPosting')
    expect(entries[0]!.headline).toBe('Levették a gipszet a csuklómról, mit csináljak?')
    expect(entries[0]!.url).toBe(absoluteUrl('/blog/gipsz-utan'))
    expect(entries[0]!.datePublished).toBe('2026-08-10T08:00:00.000Z')
  })

  it('slug nélküli poszt nem kerül a listába (értelmezhetetlen URL lenne)', () => {
    const jsonLd = blogJsonLd({
      name: 'Tudástár',
      path: '/blog',
      posts: [post({ slug: '' } as Partial<Post>)],
    })
    expect(jsonLd.blogPost).toBeUndefined()
  })

  it('kategória-oldalon a saját címét és útvonalát viseli', () => {
    const jsonLd = blogJsonLd({
      name: 'Kézrehabilitáció',
      path: '/blog/kategoria/kezrehabilitacio',
      posts: [post()],
    })
    expect(jsonLd.url).toBe(absoluteUrl('/blog/kategoria/kezrehabilitacio'))
  })
})

describe('Article JSON-LD (bejegyzés-oldal)', () => {
  it('a látható címmel, bevezetővel és dátumokkal egyezik', () => {
    const jsonLd = articleJsonLd({ post: post(), path: '/blog/gipsz-utan', authorName: 'Kata' })

    expect(jsonLd['@type']).toBe('Article')
    expect(jsonLd.headline).toBe(post().title)
    expect(jsonLd.description).toBe(post().excerpt)
    expect(jsonLd.datePublished).toBe('2026-08-10T08:00:00.000Z')
    expect(jsonLd.dateModified).toBe('2026-08-12T08:00:00.000Z')
    expect((jsonLd.author as Record<string, unknown>).name).toBe('Kata')
    expect(jsonLd.mainEntityOfPage).toBe(absoluteUrl('/blog/gipsz-utan'))
  })

  it('magyar nyelvet közöl (entitás-egyértelműsítés az AI-válaszokhoz)', () => {
    expect(articleJsonLd({ post: post(), path: '/blog/gipsz-utan' }).inLanguage).toBe('hu-HU')
  })

  it('szerző nélkül NINCS author kulcs (a kiadó a publisher Organization)', () => {
    const jsonLd = articleJsonLd({ post: post(), path: '/blog/gipsz-utan' })
    expect('author' in jsonLd).toBe(false)
    expect((jsonLd.publisher as Record<string, unknown>).name).toBe('Kineticare')
    expect((jsonLd.publisher as Record<string, unknown>)['@type']).toBe('Organization')
  })

  it('hiányzó bevezetőnél nincs üres description', () => {
    const jsonLd = articleJsonLd({ post: post({ excerpt: null }), path: '/blog/gipsz-utan' })
    expect(jsonLd.description).toBeUndefined()
  })
})

describe('BreadcrumbList a Tudástárban', () => {
  it('a kategória-oldal morzsája a bevett, kétszintű alak (Tudástár → lap)', () => {
    // Ugyanaz a séma, mint a bejegyzés- és a kurzusoldalon: a szekció
    // gyökere, majd az aktuális lap.
    const items = breadcrumbJsonLd([
      { name: 'Tudástár', path: '/blog' },
      { name: 'Kézrehabilitáció', path: '/blog/kategoria/kezrehabilitacio' },
    ]).itemListElement as Array<Record<string, unknown>>

    expect(items).toHaveLength(2)
    expect(items[0]!.position).toBe(1)
    expect(items[0]!.item).toBe(absoluteUrl('/blog'))
    expect(items[1]!.item).toBe(absoluteUrl('/blog/kategoria/kezrehabilitacio'))
  })
})

// ---------------------------------------------------------------------------
// Cikk-séma (src/lib/seo-cikk.ts) — Article + MedicalWebPage, szerző, lektor,
// ellenőrzési dátum, GYIK.
//
// Ez a réteg az egészségügyi (YMYL) tartalom miatt szigorúbb a fenti,
// általános Article-sémánál: szerzőt, lektort és ellenőrzési napot is közöl.
// A két gyógytornász szakmai renoméja a tét, ezért minden állítás, amit a
// séma tesz, a LÁTHATÓ tartalomból kell hogy jöjjön — és amit nem tudunk
// igazolni (lektor, ellenőrzés napja), azt a séma ki sem mondja.
// ---------------------------------------------------------------------------

const cikk = (overrides: Partial<ArticleSeoPost> = {}): ArticleSeoPost => ({
  title: 'Levették a gipszet a csuklómról, mit csináljak?',
  excerpt: 'Az első hét gyakorlatai és a leggyakoribb hibák.',
  publishedAt: '2026-08-10T08:00:00.000Z',
  updatedAt: '2026-08-12T09:30:00.000Z',
  ...overrides,
})

const KATA = { name: 'Kocsis Kata', credentials: 'gyógytornász, kézterapeuta' }
const LEKTOR = { name: 'Nagy Kata', credentials: 'gyógytornász' }

/** A cikk-séma egy adott kulcsa objektumként (a node-ok mind Record-ok). */
const node = (jsonLd: Record<string, unknown>, key: string): Record<string, unknown> =>
  jsonLd[key] as Record<string, unknown>

describe('Cikk-séma: kettős típus (Article + MedicalWebPage)', () => {
  it('EGY entitás, tömbös @type-tal, nem két külön node', () => {
    // Két node ugyanarról a lapról két entitásnak látszana a gépi olvasónak
    // (a kezdőlapi duplikált Organization hibája). A MedicalWebPage a WebPage
    // altípusa, ezért teszi érvényessé a lastReviewed/reviewedBy mezőt.
    const jsonLd = postArticleJsonLd({ post: cikk(), path: '/blog/gipsz-utan' })

    expect(jsonLd['@type']).toEqual(['Article', 'MedicalWebPage'])
  })

  it('a @context a schema.org, hogy a node egyáltalán értelmezhető legyen', () => {
    const jsonLd = postArticleJsonLd({ post: cikk(), path: '/blog/gipsz-utan' })
    expect(jsonLd['@context']).toBe('https://schema.org')
  })

  it('magyar nyelvet közöl (entitás-egyértelműsítés az AI-válaszokhoz)', () => {
    const jsonLd = postArticleJsonLd({ post: cikk(), path: '/blog/gipsz-utan' })
    expect(jsonLd.inLanguage).toBe('hu-HU')
  })

  it('a headline KARAKTERRE a látható cím, csonkítás nélkül', () => {
    // A Google Article-dokumentációja nem szab karakterkorlátot, a séma és a
    // látható H1 eltérése viszont pont az, amiért elvetik a strukturált adatot.
    const hosszuCim =
      'Meddig tart a felépülés csuklótörés után, és mikor kezdhetem el újra a mindennapi mozdulatokat otthon?'
    const jsonLd = postArticleJsonLd({ post: cikk({ title: hosszuCim }), path: '/blog/x' })

    expect(jsonLd.headline).toBe(hosszuCim)
  })

  it('a description a látható bevezető; bevezető nélkül nincs üres mező', () => {
    const vanBevezeto = postArticleJsonLd({ post: cikk(), path: '/blog/gipsz-utan' })
    const nincsBevezeto = postArticleJsonLd({ post: cikk({ excerpt: null }), path: '/blog/x' })
    const uresBevezeto = postArticleJsonLd({ post: cikk({ excerpt: '   ' }), path: '/blog/x' })

    expect(vanBevezeto.description).toBe('Az első hét gyakorlatai és a leggyakoribb hibák.')
    expect('description' in nincsBevezeto).toBe(false)
    expect('description' in uresBevezeto).toBe(false)
  })

  it('a mainEntityOfPage a KAPOTT útvonal abszolút alakja', () => {
    const jsonLd = postArticleJsonLd({ post: cikk(), path: '/blog/gipsz-utan' })
    expect(jsonLd.mainEntityOfPage).toBe(absoluteUrl('/blog/gipsz-utan'))
  })

  it('a kép tömbben, abszolút URL-lel megy ki; kép nélkül nincs image kulcs', () => {
    const kepes = postArticleJsonLd({
      post: cikk(),
      path: '/blog/x',
      imageUrl: absoluteUrl('/media/gipsz-og.jpg'),
    })
    const kepetlen = postArticleJsonLd({ post: cikk(), path: '/blog/x' })

    expect(kepes.image).toEqual([absoluteUrl('/media/gipsz-og.jpg')])
    expect('image' in kepetlen).toBe(false)
  })

  it('a kiadó minden cikken a Kineticare Organization, kanonikus gyökérrel', () => {
    const publisher = node(postArticleJsonLd({ post: cikk(), path: '/blog/x' }), 'publisher')

    expect(publisher['@type']).toBe('Organization')
    expect(publisher.name).toBe('Kineticare')
    expect(publisher.url).toBe(absoluteUrl('/'))
  })

  it('egyetlen kulcs sem hordoz undefined értéket (a JsonLd JSON.stringify-olja)', () => {
    const jsonLd = postArticleJsonLd({ post: cikk(), path: '/blog/x' })
    const undefinedKulcsok = Object.entries(jsonLd)
      .filter(([, value]) => value === undefined)
      .map(([key]) => key)

    expect(undefinedKulcsok).toEqual([])
  })
})

describe('Cikk-séma: szerző és lektor (E-E-A-T)', () => {
  it('a szerző Person, a NEVE csak név, a titulus a jobTitle-ben', () => {
    // Google Article structured data: „author.name — only specify the name of
    // the author. Don't add any other piece of information" — a titulushoz a
    // jobTitle tulajdonság való.
    const author = node(
      postArticleJsonLd({ post: cikk(), path: '/blog/x', author: KATA }),
      'author',
    )

    expect(author['@type']).toBe('Person')
    expect(author.name).toBe('Kocsis Kata')
    expect(author.jobTitle).toBe('gyógytornász, kézterapeuta')
  })

  it('a szerző url-je a látható szerző-blokk célja (/rolunk), abszolút alakban', () => {
    const author = node(
      postArticleJsonLd({ post: cikk(), path: '/blog/x', author: KATA }),
      'author',
    )
    expect(author.url).toBe(absoluteUrl('/rolunk'))
  })

  it('titulus nélküli szerzőnél nincs üres jobTitle', () => {
    const author = node(
      postArticleJsonLd({ post: cikk(), path: '/blog/x', author: { name: 'Kocsis Kata' } }),
      'author',
    )

    expect(author.name).toBe('Kocsis Kata')
    expect('jobTitle' in author).toBe(false)
  })

  it('a név és a titulus körüli szóközöket levágja', () => {
    const author = node(
      postArticleJsonLd({
        post: cikk(),
        path: '/blog/x',
        author: { name: '  Kocsis Kata  ', credentials: '  gyógytornász  ' },
      }),
      'author',
    )

    expect(author.name).toBe('Kocsis Kata')
    expect(author.jobTitle).toBe('gyógytornász')
  })

  it('SZERZŐ NÉLKÜL nincs author kulcs, a kiadó a publisher Organization', () => {
    // Sem Person{name:'Kineticare'}, sem Organization-szerző-tartalék:
    // a kereső ne higgye, hogy a szervezet írta a lapot, ha nincs kitöltött user.
    const jsonLd = postArticleJsonLd({ post: cikk(), path: '/blog/x' })
    const publisher = node(jsonLd, 'publisher')

    expect('author' in jsonLd).toBe(false)
    expect(publisher['@type']).toBe('Organization')
    expect(publisher.name).toBe('Kineticare')
    expect(publisher.url).toBe(absoluteUrl('/'))
  })

  it('üres nevű szerzőnél sincs author kulcs (nem Organization-tartalék)', () => {
    const jsonLd = postArticleJsonLd({
      post: cikk(),
      path: '/blog/x',
      author: { name: '   ' },
    })
    expect('author' in jsonLd).toBe(false)
    expect(node(jsonLd, 'publisher')['@type']).toBe('Organization')
  })

  it('kitöltött user author SOHA nem Organization és SOHA nem SITE_NAME', () => {
    const jsonLd = postArticleJsonLd({ post: cikk(), path: '/blog/x', author: KATA })
    const author = node(jsonLd, 'author')
    const publisher = node(jsonLd, 'publisher')

    expect(author['@type']).toBe('Person')
    expect(author.name).toBe('Kocsis Kata')
    expect(author.name).not.toBe('Kineticare')
    expect(publisher['@type']).toBe('Organization')
    expect(publisher.name).toBe('Kineticare')
  })

  it('reviewedBy CSAK akkor, ha tényleg van lektor', () => {
    const lektorral = postArticleJsonLd({
      post: cikk(),
      path: '/blog/x',
      author: KATA,
      reviewer: LEKTOR,
    })
    const lektor = node(lektorral, 'reviewedBy')
    const lektortalan = postArticleJsonLd({ post: cikk(), path: '/blog/x', author: KATA })

    expect(lektor['@type']).toBe('Person')
    expect(lektor.name).toBe('Nagy Kata')
    expect(lektor.jobTitle).toBe('gyógytornász')
    expect('reviewedBy' in lektortalan).toBe(false)
  })
})

describe('Cikk-séma: dátumok (a módosítás NEM ellenőrzés)', () => {
  it('a datePublished és a dateModified időzónástul, változatlanul megy ki', () => {
    // A Google Article-dokumentációja ISO 8601-et kér, és kifejezetten ajánlja
    // az időzóna közlését; a schema.org szerint mindkettő Date ÉS DateTime.
    const jsonLd = postArticleJsonLd({ post: cikk(), path: '/blog/x' })

    expect(jsonLd.datePublished).toBe('2026-08-10T08:00:00.000Z')
    expect(jsonLd.dateModified).toBe('2026-08-12T09:30:00.000Z')
  })

  it('hiányzó dátumnál nincs üres kulcs', () => {
    const jsonLd = postArticleJsonLd({
      post: cikk({ publishedAt: null, updatedAt: null }),
      path: '/blog/x',
    })

    expect('datePublished' in jsonLd).toBe(false)
    expect('dateModified' in jsonLd).toBe(false)
  })

  it('a lastReviewed NAPRA pontos (a schema.org szerint Date, nem DateTime)', () => {
    const jsonLd = postArticleJsonLd({
      post: cikk(),
      path: '/blog/x',
      lastReviewed: '2026-08-18T14:25:00.000Z',
    })

    expect(jsonLd.lastReviewed).toBe('2026-08-18')
  })

  it('a már napra pontos érték változatlanul megy át', () => {
    const jsonLd = postArticleJsonLd({ post: cikk(), path: '/blog/x', lastReviewed: '2026-08-18' })
    expect(jsonLd.lastReviewed).toBe('2026-08-18')
  })

  it('ELLENŐRZÉS NÉLKÜL nincs lastReviewed (dátumot kitalálni tilos)', () => {
    const nincs = postArticleJsonLd({ post: cikk(), path: '/blog/x' })
    const ures = postArticleJsonLd({ post: cikk(), path: '/blog/x', lastReviewed: '   ' })
    const nullas = postArticleJsonLd({ post: cikk(), path: '/blog/x', lastReviewed: null })
    const ertelmetlen = postArticleJsonLd({
      post: cikk(),
      path: '/blog/x',
      lastReviewed: 'tavaly ősszel',
    })

    expect('lastReviewed' in nincs).toBe(false)
    expect('lastReviewed' in ures).toBe(false)
    expect('lastReviewed' in nullas).toBe(false)
    expect('lastReviewed' in ertelmetlen).toBe(false)
  })

  it('a dokumentum-módosítás és a szakmai ellenőrzés KÜLÖN mezőben él', () => {
    // Egy vessző-javítás nem szakmai ellenőrzés: a két dátum nem keverhető.
    const jsonLd = postArticleJsonLd({
      post: cikk({ updatedAt: '2026-08-20T11:00:00.000Z' }),
      path: '/blog/x',
      lastReviewed: '2026-06-02T00:00:00.000Z',
    })

    expect(jsonLd.dateModified).toBe('2026-08-20T11:00:00.000Z')
    expect(jsonLd.lastReviewed).toBe('2026-06-02')
  })

  it('a lektor és az ellenőrzési nap FÜGGETLENÜL is kimehet', () => {
    const csakLektor = postArticleJsonLd({ post: cikk(), path: '/blog/x', reviewer: LEKTOR })
    const csakDatum = postArticleJsonLd({
      post: cikk(),
      path: '/blog/x',
      lastReviewed: '2026-06-02',
    })

    expect('reviewedBy' in csakLektor).toBe(true)
    expect('lastReviewed' in csakLektor).toBe(false)
    expect('reviewedBy' in csakDatum).toBe(false)
    expect(csakDatum.lastReviewed).toBe('2026-06-02')
  })
})

describe('Cikk-séma: a MÉRT kulcsszavak és a cikk TÁRGYA', () => {
  // A `keywords` és az `about` a Monid-mérésből jön
  // (src/lib/tudastar/seo-kulcsszavak.ts). Ez a két mező az EGYETLEN hely,
  // ahol a mérés kifejezései gépi olvasásra is kikerülnek a lapról, ezért
  // külön őrt kap: ha valaki átépíti a séma-építőt és elveszti őket, ez a
  // blokk bukjon.

  it('a keywords VESSZŐVEL elválasztott szöveg (a schema.org saját alakja)', () => {
    // https://schema.org/keywords — „Multiple textual entries in a keywords
    // list are typically delimited by commas, or by repeating the property".
    const jsonLd = postArticleJsonLd({
      post: cikk(),
      path: '/blog/x',
      keywords: ['teniszkönyök', 'teniszkönyök gyakorlatok'],
    })

    expect(jsonLd.keywords).toBe('teniszkönyök, teniszkönyök gyakorlatok')
  })

  it('trimmel, az üres tételt eldobja, és nem ismétel', () => {
    const jsonLd = postArticleJsonLd({
      post: cikk(),
      path: '/blog/x',
      keywords: ['  teniszkönyök  ', 'teniszkönyök', '   ', 'teniszkönyök gyakorlatok'],
    })

    expect(jsonLd.keywords).toBe('teniszkönyök, teniszkönyök gyakorlatok')
  })

  it('csupa üres kulcsszónál NINCS keywords kulcs (nem üres mező)', () => {
    const jsonLd = postArticleJsonLd({ post: cikk(), path: '/blog/x', keywords: ['', '   '] })
    expect('keywords' in jsonLd).toBe(false)
  })

  it('az about PONTOSAN két kulcsot visz: @type és name', () => {
    // A cikk TÁRGYA entitásként még nem klinikai állítás. Klinikai állítás a
    // possibleTreatment/signOrSymptom/typicalTest volna — a node szerkezetileg
    // nem tud ilyet előállítani, és ezt itt meg is mérjük.
    const jsonLd = postArticleJsonLd({
      post: cikk(),
      path: '/blog/x',
      about: { tipus: 'MedicalCondition', nev: 'Teniszkönyök' },
    })
    const about = node(jsonLd, 'about')

    expect(about).toEqual({ '@type': 'MedicalCondition', name: 'Teniszkönyök' })
    expect(Object.keys(about).sort()).toEqual(['@type', 'name'])
  })

  it('a panasz-típus (MedicalSignOrSymptom) is átmegy, névvel', () => {
    // Thing > MedicalEntity > MedicalCondition > MedicalSignOrSymptom
    // (https://schema.org/MedicalSignOrSymptom).
    const jsonLd = postArticleJsonLd({
      post: cikk(),
      path: '/blog/x',
      about: { tipus: 'MedicalSignOrSymptom', nev: 'Kézzsibbadás' },
    })

    expect(node(jsonLd, 'about')['@type']).toBe('MedicalSignOrSymptom')
    expect(node(jsonLd, 'about').name).toBe('Kézzsibbadás')
  })

  it('név nélküli tárgynál nincs about (üres entitást nem hirdetünk)', () => {
    const jsonLd = postArticleJsonLd({
      post: cikk(),
      path: '/blog/x',
      about: { tipus: 'MedicalCondition', nev: '   ' },
    })
    expect('about' in jsonLd).toBe(false)
  })

  it('MÉRÉS NÉLKÜL egyik mező sem jelenik meg', () => {
    const jsonLd = postArticleJsonLd({ post: cikk(), path: '/blog/x', author: KATA })

    expect('keywords' in jsonLd).toBe(false)
    expect('about' in jsonLd).toBe(false)
  })
})

describe('Cikk-séma: amit TUDATOSAN nem állít', () => {
  it('nincs kitalált klinikai vagy értékelési adat a node-ban', () => {
    // A gépi formában kódolt klinikai állítás ugyanúgy állítás: az orvosi
    // tartalom-szabály (minden állításhoz forrás) a sémára is áll. Az
    // értékelés-mezőket a fogyasztóvédelem és a Google irányelve is tiltja
    // valós adat nélkül.
    //
    // Az `about` NEM tartozik ide (felülvizsgálva 2026-08-21): az értéke a
    // cikk tárgya entitásként, `@type` + `name` alakban, vagyis pontosan az,
    // amiről a látható H1 és a törzs szól. A klinikai ALTULAJDONSÁGOK viszont
    // továbbra is tiltottak, és a lista őrzi őket.
    const jsonLd = postArticleJsonLd({
      post: cikk(),
      path: '/blog/x',
      author: KATA,
      reviewer: LEKTOR,
      lastReviewed: '2026-08-18',
      imageUrl: absoluteUrl('/media/x.jpg'),
      about: { tipus: 'MedicalCondition', nev: 'Teniszkönyök' },
      keywords: ['teniszkönyök'],
    })

    for (const tiltott of [
      'citation',
      'aggregateRating',
      'review',
      'speakable',
      'medicalAudience',
      'medicalSpecialty',
    ]) {
      expect(tiltott in jsonLd).toBe(false)
    }
    for (const klinikai of ['possibleTreatment', 'signOrSymptom', 'typicalTest', 'riskFactor']) {
      expect(klinikai in node(jsonLd, 'about')).toBe(false)
    }
  })
})

describe('Cikk-GYIK: a séma és a látható lista KÖZÖS forrása', () => {
  const nyers = (): PostFaqSource[] => [
    {
      question: 'Mikor kezdhetem el a gyakorlatokat?',
      answer: 'A kezelőorvosod jóváhagyása után.',
    },
    { question: 'Fájhat a torna?', answer: 'Enyhe húzó érzés lehet, éles fájdalom nem.' },
  ]

  it('trimmel, és a sorrendet megtartja', () => {
    const items = postFaqItems([
      { question: '  Mikor kezdhetem el a gyakorlatokat?  ', answer: '  A jóváhagyás után.  ' },
      { question: 'Fájhat a torna?', answer: 'Enyhe húzó érzés lehet.' },
    ])

    expect(items).toEqual([
      { question: 'Mikor kezdhetem el a gyakorlatokat?', answer: 'A jóváhagyás után.' },
      { question: 'Fájhat a torna?', answer: 'Enyhe húzó érzés lehet.' },
    ])
  })

  it('a hiányos tétel MINDKETTŐBŐL kimarad (kérdés vagy válasz nélkül)', () => {
    const items = postFaqItems([
      { question: 'Van kérdés, nincs válasz?', answer: '' },
      { question: '   ', answer: 'Van válasz, nincs kérdés.' },
      { question: 'Ez a teljes tétel?', answer: 'Igen.' },
      { question: 'Csak kérdés' },
      { answer: 'Csak válasz' },
      { question: null, answer: null },
    ])

    expect(items).toEqual([{ question: 'Ez a teljes tétel?', answer: 'Igen.' }])
  })

  it('a plafon 6 tétel (a posts.faq maxRows-ával azonos szám)', () => {
    // Külön kimondva, mert a többi eset a konstanshoz méri magát: ha a szám
    // elcsúszik, a séma és a CMS-korlát szétválik, és a lint L11 szabálya
    // (2-6 tétel) is más plafonhoz mérne.
    expect(POST_FAQ_MAX_ITEMS).toBe(6)
  })

  it(`legfeljebb ${POST_FAQ_MAX_ITEMS} tétel jelenik meg, az elsők`, () => {
    // A maxRows csak az admin-szerkesztőt fogja meg; a seed, az import és a
    // REST-API nem futtatja. A plafon a renderelésre is kell.
    const sok = Array.from({ length: 9 }, (_unused, index) => ({
      question: `Kérdés ${index + 1}?`,
      answer: `Válasz ${index + 1}.`,
    }))
    const items = postFaqItems(sok)

    expect(items).toHaveLength(POST_FAQ_MAX_ITEMS)
    expect(items[0]!.question).toBe('Kérdés 1?')
    expect(items[POST_FAQ_MAX_ITEMS - 1]!.question).toBe(`Kérdés ${POST_FAQ_MAX_ITEMS}?`)
  })

  it('üres, null és undefined mezőnél üres lista (nem hiba)', () => {
    expect(postFaqItems([])).toEqual([])
    expect(postFaqItems(null)).toEqual([])
    expect(postFaqItems(undefined)).toEqual([])
  })

  it('NINCS FAQPage node, ha nincs érvényes tétel', () => {
    // Nulla elemű GYIK meghirdetése pont az az eltérés a látható tartalomtól,
    // ami miatt a keresők elvetik a strukturált adatot.
    expect(postFaqJsonLd([])).toBeUndefined()
    expect(postFaqJsonLd(postFaqItems([{ question: 'Csonka?', answer: '  ' }]))).toBeUndefined()
  })

  it('a FAQPage node a szokott alak, magyar nyelvvel', () => {
    const jsonLd = postFaqJsonLd(postFaqItems(nyers()))!

    expect(jsonLd['@context']).toBe('https://schema.org')
    expect(jsonLd['@type']).toBe('FAQPage')
    expect(jsonLd.inLanguage).toBe('hu-HU')
  })

  it('a mainEntity PONTOSAN a megjelenített tételeket viszi, sorrendben', () => {
    const items = postFaqItems(nyers())
    const mainEntity = postFaqJsonLd(items)!.mainEntity as Array<Record<string, unknown>>

    expect(mainEntity).toHaveLength(items.length)
    expect(mainEntity.map((entry) => entry.name)).toEqual(items.map((item) => item.question))
    expect(mainEntity[0]!['@type']).toBe('Question')
    expect(node(mainEntity[0]!, 'acceptedAnswer')['@type']).toBe('Answer')
  })

  it('a válasz CSONKOLATLANUL kerül a sémába (a csonkolt válasz félreidézhető)', () => {
    const hosszuValasz =
      `A gipsz levétele után az első hét célja a duzzanat csökkentése és a csukló óvatos mozgásba hozása. ${'Ismételd naponta többször, mindig fájdalomhatáron belül. '.repeat(6)}`.trim()
    const items = postFaqItems([{ question: 'Mit csináljak az első héten?', answer: hosszuValasz }])
    const mainEntity = postFaqJsonLd(items)!.mainEntity as Array<Record<string, unknown>>

    expect(hosszuValasz.length).toBeGreaterThan(400)
    expect(node(mainEntity[0]!, 'acceptedAnswer').text).toBe(hosszuValasz)
  })
})

// ---------------------------------------------------------------------------
// A CIKKOLDAL RENDERELT SÉMÁJA — az építő és a lap ÖSSZE VAN KÖTVE
//
// Miért kell a fenti egység-tesztek MELLÉ ez a réteg. A `postArticleJsonLd`
// hónapokig hibátlanul megvolt és zölden tesztelt, miközben a cikkoldal a régi
// `articleJsonLd`-t hívta: a `MedicalWebPage` típus, a `reviewedBy` és a
// `lastReviewed` SOHA nem jutott ki egyetlen lapra sem. Egység-teszt ezt nem
// foghatta meg, mert a hiba a HÍVÁSI helyen volt. Ez a blokk ezért a
// SZERVER-RENDELT kimenetből olvassa vissza a sémát — pontosan azt, amit a
// keresőrobot lát.
// ---------------------------------------------------------------------------

/** Minimális, érvényes Lexical-törzs a komponens-rendereléshez. */
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
            text: 'Rövid bevezető.',
            version: 1,
          },
        ],
      },
    ],
  },
}

/**
 * Cikk-fixture a komponenshez.
 *
 * A `Record<string, unknown>` + kettős konverzió SZÁNDÉKOS: a cikkoldal olyan
 * mezőket is olvas (`faq`, `reviewedBy`, `reviewedAt`), amelyeket a séma-kör
 * vezet be, és a felület szerződése épp az, hogy nélkülük is helyesen működik.
 */
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
    categories: [{ id: 5, title: 'Kézrehabilitáció', slug: 'kezrehabilitacio' }],
    ...overrides,
  }) as unknown as Post

/** A lap összes JSON-LD blokkja, feloldva. */
function jsonLdBlocks(post: Post): Record<string, unknown>[] {
  const html = renderToStaticMarkup(createElement(PostArticle, { post }))
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (match) => JSON.parse(match[1]!.replace(/\\u003c/g, '<')) as Record<string, unknown>,
  )
}

/** A cikk-entitás node-ja a renderelt lapról (az egyetlen tömbös @type). */
function cikkSema(post: Post): Record<string, unknown> {
  const article = jsonLdBlocks(post).find((block) => Array.isArray(block['@type']))
  expect(article, 'nincs cikk-entitás a renderelt lapon').toBeDefined()
  return article!
}

describe('A renderelt cikkoldal sémája', () => {
  it('a lapra a KETTŐS típusú node kerül ki, nem a régi sima Article', () => {
    expect(cikkSema(lapPost())['@type']).toEqual(['Article', 'MedicalWebPage'])
  })

  it('a lapon PONTOSAN egy cikk-entitás áll (nem két külön node)', () => {
    const cikkNodeok = jsonLdBlocks(lapPost()).filter((block) => Array.isArray(block['@type']))
    expect(cikkNodeok).toHaveLength(1)
  })

  it('SZERZŐ NÉLKÜL a renderelt lapon nincs author kulcs, a publisher Organization', () => {
    const jsonLd = cikkSema(lapPost())
    expect('author' in jsonLd).toBe(false)
    expect(node(jsonLd, 'publisher')['@type']).toBe('Organization')
    expect(node(jsonLd, 'publisher').name).toBe('Kineticare')
  })

  it('nyers author-id nem hamisít Person-t és nem rak Organization-t a szerző helyére', () => {
    // Az élő `/blog/*` cikkeken a Katák neve a törzsben áll, a CMS author
    // mezője viszont üres vagy populálatlan: a séma ne találjon ki személyt,
    // és ne állítsa a kiadót szerzőnek.
    const jsonLd = cikkSema(lapPost({ author: 2 }))
    expect('author' in jsonLd).toBe(false)
    expect(node(jsonLd, 'publisher')['@type']).toBe('Organization')
    expect(node(jsonLd, 'publisher').name).toBe('Kineticare')
  })

  it('üres faq mellett nincs FAQPage a renderelt lapon', () => {
    const html = renderToStaticMarkup(createElement(PostArticle, { post: lapPost() }))
    expect(html).not.toContain('"@type":"FAQPage"')
  })

  it('a sablon nem tesz látható Források-listát a cikkre, ha a törzsben nincs', () => {
    const html = renderToStaticMarkup(createElement(PostArticle, { post: lapPost() }))
    expect(html).not.toMatch(/<h[1-6][^>]*>\s*Források\s*<\/h[1-6]>/)
    expect(html).not.toContain('id="forrasok"')
    expect(html).not.toContain('kc-post-sources')
    const jsonLd = cikkSema(lapPost())
    expect('citation' in jsonLd).toBe(false)
  })

  it('szerzővel Person megy ki, a titulus a jobTitle-ben', () => {
    const author = node(
      cikkSema(lapPost({ author: { id: 2, name: 'Kocsis Kata', credentials: 'gyógytornász' } })),
      'author',
    )

    expect(author['@type']).toBe('Person')
    expect(author['@type']).not.toBe('Organization')
    expect(author.name).toBe('Kocsis Kata')
    expect(author.name).not.toBe('Kineticare')
    expect(author.jobTitle).toBe('gyógytornász')
  })

  it('a MÉRT kulcsszavak és a cikk tárgya KIKERÜL a lapra', () => {
    // REGRESSZIÓS ŐR: ha valaki átállítja a séma-építőt és elveszti ezt a két
    // mezőt, ez bukik. A várt értékek magából a mérésből jönnek, nem
    // másolatból — így a mérés bővülése nem teszi hazuggá a tesztet.
    const meres = kulcsszoFor('teniszkonyok')
    expect(meres, 'a teniszkönyök-cikkhez van mérés').toBeDefined()

    const jsonLd = cikkSema(lapPost())
    const keywords = String(jsonLd.keywords)

    for (const kifejezes of [meres!.elsodleges, ...meres!.masodlagos]) {
      expect(keywords, `hiányzik a kulcsszó: ${kifejezes}`).toContain(kifejezes)
    }
    expect(jsonLd.about).toEqual({ '@type': meres!.targy.tipus, name: meres!.targy.nev })
  })

  it('MÉRÉS NÉLKÜLI cikken nincs keywords és nincs about', () => {
    const jsonLd = cikkSema(lapPost({ slug: 'nincs-hozza-meres', title: 'Valami más' }))

    expect('keywords' in jsonLd).toBe(false)
    expect('about' in jsonLd).toBe(false)
  })

  it('LEKTORÁLT cikken a reviewedBy és a lastReviewed is kikerül', () => {
    const jsonLd = cikkSema(
      lapPost({
        reviewedBy: { id: 7, name: 'Nagy Kata', credentials: 'gyógytornász' },
        reviewedAt: '2026-08-18T14:25:00.000Z',
      }),
    )

    expect(node(jsonLd, 'reviewedBy')['@type']).toBe('Person')
    expect(node(jsonLd, 'reviewedBy').name).toBe('Nagy Kata')
    // A schema.org szerint a lastReviewed értéke Date, nem DateTime.
    expect(jsonLd.lastReviewed).toBe('2026-08-18')
  })

  it('ELLENŐRZÉS NÉLKÜL egyik ellenőrzés-mező sem jelenik meg', () => {
    // Ellenőrzés-dátum ellenőrzés nélkül hazugság (docs/tudastar-ux-terv.md 5.6).
    const jsonLd = cikkSema(lapPost())

    expect('reviewedBy' in jsonLd).toBe(false)
    expect('lastReviewed' in jsonLd).toBe(false)
  })

  it('a lektor önmagában, dátum nélkül is kimehet (és fordítva)', () => {
    const csakLektor = cikkSema(
      lapPost({ reviewedBy: { id: 7, name: 'Nagy Kata', credentials: 'gyógytornász' } }),
    )
    const csakDatum = cikkSema(lapPost({ reviewedAt: '2026-06-02' }))

    expect('reviewedBy' in csakLektor).toBe(true)
    expect('lastReviewed' in csakLektor).toBe(false)
    expect('reviewedBy' in csakDatum).toBe(false)
    expect(csakDatum.lastReviewed).toBe('2026-06-02')
  })

  it('a séma a LÁTHATÓ címet és bevezetőt viszi', () => {
    const jsonLd = cikkSema(lapPost())

    expect(jsonLd.headline).toBe('Teniszkönyök kezelése házilag')
    expect(jsonLd.description).toBe('Mit tehetsz otthon, ha belenyilall a könyöködbe.')
    expect(jsonLd.mainEntityOfPage).toBe(absoluteUrl('/blog/teniszkonyok'))
  })
})

// ---------------------------------------------------------------------------
// EGYETLEN GYIK-SZŰRŐ A REPÓBAN
//
// A `postFaqItems` korábban KÉT példányban élt: a komponens-oldali változat a
// dokumentumból olvasott és saját szűrőt futtatott, a séma-oldali pedig egy
// tömböt kapott. Két külön szűrő idővel szétcsúszik, és pont az a látható
// lista és séma közti eltérés keletkezik belőle, ami miatt a keresők elvetik a
// strukturált adatot. A komponens-oldali változat ma CSAK OLVAS, a szűrést a
// séma-rétegre bízza — ezt méri ez a blokk.
// ---------------------------------------------------------------------------

describe('A komponens-oldali GYIK-olvasó a séma-réteg szűrőjét használja', () => {
  it('ugyanúgy trimmel és ugyanúgy dobja a hiányos tételt', () => {
    const doksi = lapPost({
      faq: [
        { question: '  Meddig tart?  ', answer: '  Az okától függ.  ' },
        { question: 'Válasz nélküli kérdés?', answer: '   ' },
        { question: null, answer: 'Kérdés nélküli válasz.' },
      ],
    })

    expect(postFaqItemsOfPost(doksi)).toEqual([
      { question: 'Meddig tart?', answer: 'Az okától függ.' },
    ])
  })

  it('a plafon a KÖZÖS konstans, nem egy külön beégetett szám', () => {
    const sok = Array.from({ length: POST_FAQ_MAX_ITEMS + 3 }, (_unused, index) => ({
      question: `Kérdés ${index + 1}?`,
      answer: `Válasz ${index + 1}.`,
    }))

    expect(postFaqItemsOfPost(lapPost({ faq: sok }))).toHaveLength(POST_FAQ_MAX_ITEMS)
  })

  it('a két belépési pont UGYANAZT adja ugyanarra a bemenetre', () => {
    const nyers = [
      { question: 'Meddig tart?', answer: 'Az okától függ.' },
      { question: 'Kell sín?', answer: 'A tünetektől függ.' },
      { question: '  ', answer: 'Csonka.' },
    ]

    expect(postFaqItemsOfPost(lapPost({ faq: nyers }))).toEqual(postFaqItems(nyers))
  })

  it('nem szöveges mező nem okoz hibát, csak kimarad', () => {
    const doksi = lapPost({ faq: [{ question: 42, answer: 'Szám a kérdés helyén.' }] })
    expect(postFaqItemsOfPost(doksi)).toEqual([])
  })

  it('faq mező nélküli cikken üres a lista (nem hiba)', () => {
    expect(postFaqItemsOfPost(lapPost())).toEqual([])
  })
})
