import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { Field, Tab } from 'payload'
import { describe, expect, it } from 'vitest'

import { Posts, AJANLOTT_KURZUS_LEIRAS } from '../collections/Posts'
import { APPOINTMENT_CTA_SLUGS } from '../components/content/post-article'
import { KOTOTT_WEBCIM_UTALAS, slugField, WEBCIM_LEIRAS } from '../fields/slug'

/**
 * H51 és H27 őr: a Blogbejegyzés-szerkesztő három név nélküli fülre bomlik
 * (a mezők adatútja nem változik), a cikk végi ajánló súgója a kód szerint
 * igaz, és a Posts szövegei a §8.1 szótárát követik („blogbejegyzés”).
 *
 * A séma-semlegesség három bizonyítéka közül ez a teszt a konfigurációt köti
 * (név nélküli fülek, változatlan mezőnév- és típuskészlet); a másik kettő a
 * G2 (schema-config-sync.test.ts) és a migráció-generátor üres eredménye.
 */

const forras = (ut: string): string =>
  readFileSync(fileURLToPath(new URL(ut, import.meta.url)), 'utf8')

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null

function flat(fields: Field[], acc: Field[] = []): Field[] {
  for (const field of fields) {
    if (field.type === 'row' || field.type === 'collapsible') flat(field.fields, acc)
    else if (field.type === 'tabs') {
      for (const tab of field.tabs) if (!('name' in tab)) flat(tab.fields, acc)
    } else acc.push(field)
  }
  return acc
}

const nevek = (fields: Field[]): string[] =>
  flat(fields).map((f) => ('name' in f ? f.name : `(${f.type})`))

const adminOf = (f: Field): Rec => ('admin' in f && isRec(f.admin) ? f.admin : {})

function tabsMezo(): { tabs: Tab[] } {
  const tabs = Posts.fields.find((f) => f.type === 'tabs')
  if (!tabs || tabs.type !== 'tabs') throw new Error('nincs fül')
  return tabs
}

/** A §3.1/§8.3 tipográfiai hibái (üres = tiszta). */
function tipografiaiHibak(text: string): string[] {
  const hibak: string[] = []
  if (/\s–\s|—/.test(text)) hibak.push(`gondolatjel: ${text}`)
  if (/["“]/.test(text)) hibak.push(`hibás idézőjel: ${text}`)
  if ([...text.matchAll(/„/g)].length !== [...text.matchAll(/”/g)].length) {
    hibak.push(`páratlan idézőjel: ${text}`)
  }
  for (const match of text.matchAll(/\p{Lu}{3,}/gu)) {
    if (!['SEO', 'GYIK', 'NHS'].includes(match[0])) hibak.push(`verzál szó (${match[0]}): ${text}`)
  }
  return hibak
}

/** A Posts minden szerkesztői szövege: címkék, leírások, sor-nevek, fülnevek. */
function szerkesztoiSzovegek(): string[] {
  const out: string[] = [String(Posts.labels?.singular), String(Posts.labels?.plural)]
  out.push(String(Posts.admin?.description))
  const bejar = (fields: Field[]): void => {
    for (const f of fields) {
      if ('label' in f && typeof f.label === 'string') out.push(f.label)
      if (typeof adminOf(f).description === 'string') out.push(String(adminOf(f).description))
      if ('labels' in f && isRec(f.labels)) {
        for (const v of Object.values(f.labels)) if (typeof v === 'string') out.push(v)
      }
      if (f.type === 'select') {
        for (const o of f.options)
          if (typeof o === 'object' && typeof o.label === 'string') out.push(o.label)
      }
      if (f.type === 'tabs') {
        for (const tab of f.tabs) {
          if (typeof tab.label === 'string') out.push(tab.label)
          bejar(tab.fields)
        }
      }
      if ('fields' in f && Array.isArray(f.fields)) bejar(f.fields)
    }
  }
  bejar(Posts.fields)
  return out
}

describe('H51: a Blogbejegyzés-szerkesztő három név nélküli fülre bomlik', () => {
  it('a fülek neve, sorrendje és tartalma', () => {
    const { tabs } = tabsMezo()
    expect(tabs.map((t) => t.label)).toEqual([
      'Blogbejegyzés',
      'GYIK és ajánló',
      'Kereső és megosztás',
    ])
    const tartalom = tabs.map((t) => nevek(t.fields))
    expect(tartalom[0]).toEqual(['title', 'excerpt', 'content', 'heroImage'])
    // Az Ajánlott kurzus elöl: a GYIK hossza nem tolja a nézeten kívülre (mérve).
    expect(tartalom[1]).toEqual(['ctaCourse', 'faq', 'relatedPosts'])
    expect(tartalom[2]).toEqual(['seoTitle', 'seoDescription', 'seoKeywords', 'ogImage'])
  })

  it('név nélküli fülek: a mezők adatútja gyökérszintű marad (Payload Tabs: a név csoportosítana)', () => {
    for (const tab of tabsMezo().tabs) {
      expect('name' in tab, String(tab.label)).toBe(false)
      expect('interfaceName' in tab).toBe(false)
    }
  })

  it('a fülnevekben nincs vessző (a Payload a hibalistát vesszőnél vágja)', () => {
    for (const tab of tabsMezo().tabs) expect(String(tab.label)).not.toContain(',')
    const hibalista = readFileSync(
      fileURLToPath(
        new URL(
          '../../node_modules/@payloadcms/ui/dist/elements/Toasts/fieldErrors.js',
          import.meta.url,
        ),
      ),
      'utf8',
    )
    expect(hibalista).toContain("errorsString.split(',')")
  })

  it('a mezőnevek, típusok és a kötelezőség változatlan (a fülek előtti állapothoz képest)', () => {
    const elvart: Array<[string, Field['type'], boolean | undefined]> = [
      ['title', 'text', true],
      ['slug', 'text', true],
      ['excerpt', 'textarea', undefined],
      ['content', 'richText', true],
      ['heroImage', 'upload', undefined],
      ['seoTitle', 'text', undefined],
      ['seoDescription', 'text', undefined],
      ['seoKeywords', 'array', undefined],
      ['ogImage', 'upload', undefined],
      ['status', 'select', true],
      ['publishedAt', 'date', undefined],
      ['order', 'number', undefined],
      ['author', 'relationship', undefined],
      ['reviewedBy', 'relationship', undefined],
      ['reviewedAt', 'date', undefined],
      ['nextReviewAt', 'date', undefined],
      ['categories', 'relationship', undefined],
      ['relatedPosts', 'relationship', undefined],
      ['faq', 'array', undefined],
      ['ctaCourse', 'relationship', undefined],
    ]
    const adatMezok = flat(Posts.fields).filter((f) => f.type !== 'ui')
    expect(adatMezok.map((f) => ('name' in f ? f.name : '')).sort()).toEqual(
      elvart.map(([n]) => n).sort(),
    )
    for (const [nev, tipus, kotelezo] of elvart) {
      const f = adatMezok.find((m) => 'name' in m && m.name === nev)
      expect(f?.type, nev).toBe(tipus)
      expect(f && 'required' in f ? f.required : undefined, nev).toBe(kotelezo)
    }
  })

  it('a tájékoztatók a fülek fölött, az oldalsávban a webcím, a dátumok, a szerző, az ellenőrzés és a kategóriák', () => {
    const gyoker = Posts.fields.map((f) => ('name' in f ? f.name : f.type))
    expect(gyoker.slice(0, 3)).toEqual(['kozzetetelAllapot', 'hubTajekoztato', 'tabs'])
    const oldalsav = Posts.fields
      .filter((f) => adminOf(f).position === 'sidebar')
      .map((f) => ('name' in f ? f.name : f.type))
    expect(oldalsav).toEqual([
      'slug',
      'kotottWebcim',
      'publishedAt',
      'author',
      'szerzoAdatlap',
      'reviewedBy',
      'reviewedAt',
      'nextReviewAt',
      'categories',
    ])
    // Oldalsávba csak gyökérszintű mező kerülhet: a fülekben egy sincs.
    for (const tab of tabsMezo().tabs) {
      for (const f of flat(tab.fields))
        expect(adminOf(f).position, 'name' in f ? f.name : '').toBeUndefined()
    }
    // A rejtett mezők a gyökérben maradnak.
    for (const nev of ['status', 'order']) {
      const f = Posts.fields.find((m) => 'name' in m && m.name === nev)
      expect(f ? adminOf(f).hidden : undefined, nev).toBe(true)
    }
  })

  it('a GYIK sorcímkéje beszédes (H13), a Kapcsolódó blogbejegyzések címkéje a szótár szerint', () => {
    const faq = flat(Posts.fields).find((f) => 'name' in f && f.name === 'faq')
    const rowLabel =
      faq && isRec(adminOf(faq).components) ? (adminOf(faq).components as Rec).RowLabel : undefined
    expect(rowLabel).toEqual({
      path: '/components/admin/SectionRowLabel#ArrayRowLabel',
      clientProps: { singular: 'Kérdés', titleFields: ['question'] },
    })
    const related = flat(Posts.fields).find((f) => 'name' in f && f.name === 'relatedPosts')
    expect(related && 'label' in related ? related.label : undefined).toBe(
      'Kapcsolódó blogbejegyzések',
    )
  })
})

describe('H27: az Ajánlott kurzus súgója a PostCourseCta és a post-article kódja szerint', () => {
  it('a leírás: csak a kurzust választod, üresen a kurzuslista, néhány blogbejegyzésnél időpontkérés', () => {
    const ajanlo = flat(Posts.fields).find((f) => 'name' in f && f.name === 'ctaCourse')
    expect(ajanlo ? adminOf(ajanlo).description : undefined).toBe(AJANLOTT_KURZUS_LEIRAS)
    expect(AJANLOTT_KURZUS_LEIRAS).toContain('Itt csak a kurzust választod')
    expect(AJANLOTT_KURZUS_LEIRAS).toContain(
      'a doboz többi szövege a weboldal kódjában van, azt a fejlesztő írja át',
    )
    expect(AJANLOTT_KURZUS_LEIRAS).toContain(
      'Üresen, vagy ha a kurzus nincs közzétéve vagy „Rejtett kurzus”, a doboz a kurzuslistára visz.',
    )
    expect(AJANLOTT_KURZUS_LEIRAS).toContain(
      'Néhány blogbejegyzés végén kurzus helyett időpontkérés áll: ezt a weboldal kódjában lévő lista dönti el, és ott ez a mező nem hat.',
    )
  })

  it('a kód: rögzített szövegek, üresen a kurzuslista, a lista az APPOINTMENT_CTA_SLUGS', () => {
    const cta = forras('../components/content/PostCourseCta.tsx')
    expect(cta).toContain("const NO_COURSE_HEADING = 'Hogyan tovább?'")
    expect(cta).toMatch(/if \(course === null\) \{[\s\S]*?href="\/kurzusok"/)
    expect(cta).toMatch(/<h2 className="kc-post-cta__title">\{courseTitle\(course\)\}<\/h2>/)
    expect(cta).toContain('{course.shortDescription !== null ? (')
    // Időpont-változatban a kurzus nem jelenik meg (a course prop nincs használva).
    expect(cta).toMatch(/if \(variant === 'idopont'\) \{[\s\S]*?<\/Card>\s*\)\s*\}/)
    const idopontAg =
      /if \(variant === 'idopont'\) \{([\s\S]*?)<\/Card>\s*\)\s*\}/.exec(cta)?.[1] ?? ''
    expect(idopontAg).not.toContain('course')
    const cikk = forras('../components/content/post-article.ts')
    expect(cikk).toMatch(/if \(!isDiscoverableCourse\(raw\)\) return null/)
    expect(APPOINTMENT_CTA_SLUGS.length).toBeGreaterThan(0)
    // „Rejtett kurzus” a Kurzusok unlisted mezőjének címkéje; a felfedezhetőség
    // szabálya a közzététel és a rejtettség (course-discovery.ts).
    expect(forras('../lib/course-discovery.ts')).toContain(
      "return product.status === 'published' && product.unlisted !== true",
    )
    expect(forras('../plugins/ecommerce.ts')).toContain(
      "label: 'Rejtett kurzus (csak közvetlen linkkel)'",
    )
    expect(forras('../plugins/ecommerce.ts')).toMatch(
      /name: 'shortDescription',\s*type: 'textarea',\s*label: 'Rövid leírás'/,
    )
  })
})

describe('Posts-szótár (§8.1) és tipográfia (§8.3)', () => {
  it('„cikk” és „bejegyzés” önálló szóként 0, csak „blogbejegyzés”', () => {
    const szovegek = szerkesztoiSzovegek()
    expect(szovegek.length).toBeGreaterThan(40)
    const onallo =
      /(?<![\p{L}-])(cikk|cikke|cikket|cikkek|bejegyzés|bejegyzést|bejegyzések)(?!\p{L})/iu
    expect(szovegek.filter((t) => onallo.test(t))).toEqual([])
  })

  it('0 gondolatjel, 0 hibás idézőjel, 0 verzál szó', () => {
    expect(szerkesztoiSzovegek().flatMap(tipografiaiHibak)).toEqual([])
  })

  it('a Webcím leírása a kötött webcímekre egy mondattal utal (csak az Oldalakon és a Blogbejegyzéseken)', () => {
    const slug = flat(Posts.fields).find((f) => 'name' in f && f.name === 'slug')
    expect(slug ? adminOf(slug).description : undefined).toBe(
      `${WEBCIM_LEIRAS} ${KOTOTT_WEBCIM_UTALAS}`,
    )
    expect(slugField('title').admin?.description).toBe(WEBCIM_LEIRAS)
    expect((KOTOTT_WEBCIM_UTALAS.match(/[.!?](\s|$)/g) ?? []).length).toBe(1)
  })
})
