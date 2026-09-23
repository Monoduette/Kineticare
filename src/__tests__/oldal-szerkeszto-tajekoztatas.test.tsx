import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { Field } from 'payload'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * B3 őr: az Oldalak és a Blogbejegyzések szerkesztője (K17, K19, K25, K40,
 * K52, R1 #10, küldetés 6. pont).
 *
 * Mit rögzít:
 * - a „mi hol van” tájékoztatók UI-mezők (nincs oszlopuk), a feltételük csak
 *   UI-mezőn áll, a kötelező, a tömb és a blokk mezőn soha (a drizzle
 *   traverseFields.js a feltételt a gyerekek NOT NULL-jára is kiterjesztené);
 * - a title, az excerpt és a heroImage látható marad (SEO-tartalék, seo.ts);
 * - a Szekciók a Tartalom ELŐTT állnak (a lap sorrendje, NN/g #2);
 * - a Sorrend rejtett, a mellékmezők az oldalsávban, a dátumok magyar
 *   sorrendben, a lista a webcímre is keres;
 * - a szövegek igazak és tipográfiailag tiszták (0 gondolatjel, 0 hibás
 *   idézőjel, 0 verzál szó; docs/ui-sztenderdek.md §3.1);
 * - az Előnézet gomb, a közzétételi állapot és a Műveletnapló-link viselkedése.
 *
 * DOM nélkül fut (renderToStaticMarkup); a Payload-hookokat mockoljuk. A
 * `fetch` hangosan dob: tesztből SOSEM mehet ki hálózati hívás (CLAUDE.md,
 * 15. üzemeltetési tanulság).
 */

interface MockState {
  fields: Record<string, { value: unknown }>
  doc: {
    id?: number | string
    collectionSlug?: string
    hasPublishedDoc: boolean
    unpublishedVersionCount: number
    isTrashed?: boolean
  }
  user: { id: number; role: string } | null
  previewURL: string | undefined
  modified: boolean
}

const alap = (): MockState => ({
  fields: {},
  doc: { id: 1, collectionSlug: 'pages', hasPublishedDoc: true, unpublishedVersionCount: 0 },
  user: { id: 1, role: 'owner' },
  previewURL: undefined,
  modified: false,
})

let allapot: MockState = alap()

/** A mockolt Button utoljára kapott `extraButtonProps`-a (a kattintáskezelő innen érhető el). */
let gombExtraProps: Record<string, unknown> | undefined

vi.mock('@payloadcms/ui', () => ({
  useFormFields: (selector: (state: [Record<string, { value: unknown }>]) => unknown) =>
    selector([allapot.fields]),
  useDocumentInfo: () => allapot.doc,
  useConfig: () => ({ config: { routes: { admin: '/admin', api: '/api' } } }),
  useAuth: () => ({ user: allapot.user }),
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'version:publishChanges': 'Módosítások közzététele',
        // A doboz ezt NEM kéri; a mock azért adja meg, hogy egy visszacsúszást
        // a „nem kéri a Visszaállítás piszkozatként fordítását” teszt elkapjon.
        'version:restoreAsDraft': 'Visszaállítás piszkozatként',
      })[key] ?? key,
  }),
  useLivePreviewContext: () => ({ previewURL: allapot.previewURL }),
  useFormModified: () => allapot.modified,
  useFormBackgroundProcessing: () => false,
  ExternalLinkIcon: () => createElement('svg', { className: 'icon icon--externalLink' }),
  // A valódi Button `el="anchor"` + `newTab` mellett <a target="_blank" rel="noopener
  // noreferrer" title={aria-label}>-t ad (dist/elements/Button/index.js); a mock ugyanezt
  // képezi le, így a TŐLÜNK átadott propokat ellenőrizzük.
  Button: (props: {
    'aria-label'?: string
    className?: string
    children?: ReactNode
    extraButtonProps?: Record<string, unknown>
    icon?: ReactNode
    id?: string
    newTab?: boolean
    url?: string
  }) => {
    gombExtraProps = props.extraButtonProps
    return createElement(
      'a',
      {
        'aria-label': props['aria-label'],
        className: props.className,
        href: props.url,
        id: props.id,
        rel: props.newTab ? 'noopener noreferrer' : undefined,
        target: props.newTab ? '_blank' : undefined,
        title: props['aria-label'],
      },
      props.children,
      props.icon,
    )
  },
}))

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  allapot = alap()
  gombExtraProps = undefined
})

const { Pages } = await import('../collections/Pages')
const { Posts } = await import('../collections/Posts')
const { slugField } = await import('../fields/slug')
const { courseSlugField } = await import('../fields/course-slug')
const { seoKeywordsField } = await import('../fields/seo-keywords')
const notice = await import('../components/admin/HomePageEditNotice')
const allapotMod = await import('../components/admin/ElonezetAllapot')
const gomb = await import('../components/admin/ElonezetGomb')
const audit = await import('../components/admin/DocAuditLink')
const { sectionSettings, SECTION_SETTINGS_LABEL } = await import('../blocks/section-settings')
const { UGRAS_FELIRAT, sectionSource } = await import('../lib/section-row-label')
const { ADMIN_UTAK } = await import('../components/admin/KezdolapCel')

// ---------------------------------------------------------------------------
// Segédek
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null
}

function adminOf(field: Field): Rec {
  const admin: unknown = 'admin' in field ? field.admin : undefined
  return isRec(admin) ? admin : {}
}

/** A gyökérszintű (és név nélküli tárolóba tett) mezők sorrendben. */
function flatFields(fields: Field[], acc: Field[] = []): Field[] {
  for (const field of fields) {
    if (field.type === 'row' || field.type === 'collapsible') {
      flatFields(field.fields, acc)
      continue
    }
    if (field.type === 'tabs') {
      for (const tab of field.tabs) {
        if (!('name' in tab)) flatFields(tab.fields, acc)
      }
      continue
    }
    acc.push(field)
  }
  return acc
}

function names(fields: Field[]): string[] {
  return flatFields(fields).map((field) => ('name' in field ? field.name : `(${field.type})`))
}

function byName(fields: Field[], name: string): Field {
  const field = flatFields(fields).find((f) => 'name' in f && f.name === name)
  if (!field) throw new Error(`hiányzik: ${name}`)
  return field
}

/** Minden mező (gyerekekkel együtt) a teljes fában. */
function allFields(fields: Field[], acc: Field[] = []): Field[] {
  for (const field of fields) {
    acc.push(field)
    if ('fields' in field && Array.isArray(field.fields)) allFields(field.fields, acc)
    if (field.type === 'tabs') for (const tab of field.tabs) allFields(tab.fields, acc)
    if (field.type === 'blocks') {
      for (const block of field.blocks ?? []) {
        if (isRec(block) && Array.isArray(block.fields)) allFields(block.fields as Field[], acc)
      }
    }
  }
  return acc
}

/** A mezők felhasználónak szóló szövegei (címke, leírás, sor-nevek). */
function userTexts(fields: Field[]): string[] {
  const out: string[] = []
  for (const field of flatFields(fields)) {
    if ('label' in field && typeof field.label === 'string') out.push(field.label)
    const description = adminOf(field).description
    if (typeof description === 'string') out.push(description)
    if ('labels' in field && isRec(field.labels)) {
      for (const value of Object.values(field.labels))
        if (typeof value === 'string') out.push(value)
    }
    if (field.type === 'array') out.push(...userTexts(field.fields))
  }
  return out
}

/** A §3.1 tipográfiai szabályai szerint hibás részletek (üres = tiszta). */
function tipografiaiHibak(text: string): string[] {
  const hibak: string[] = []
  // Gondolatjel: szóközös nagykötőjel vagy bármely kvirtmínusz. A szóköz
  // nélküli nagykötőjel (2–6) tartomány, az megengedett (AkH. 264.).
  if (/\s–\s|—/.test(text)) hibak.push(`gondolatjel: ${text}`)
  // Egyenes vagy angol záró idézőjel a magyar szövegben.
  if (/["“]/.test(text)) hibak.push(`hibás idézőjel: ${text}`)
  // Minden „ nyitó után ” záró jön, mielőtt újabb „ nyílna.
  const nyitok = [...text.matchAll(/„/g)].length
  const zarok = [...text.matchAll(/”/g)].length
  if (nyitok !== zarok) hibak.push(`páratlan idézőjel: ${text}`)
  // Verzál szó (legalább 3 nagybetű), a bevett betűszavakon kívül.
  const betuszavak = new Set(['SEO', 'GYIK', 'NHS'])
  for (const match of text.matchAll(/\p{Lu}{3,}/gu)) {
    if (!betuszavak.has(match[0])) hibak.push(`verzál szó (${match[0]}): ${text}`)
  }
  return hibak
}

function mondatok(text: string): number {
  return (text.match(/[.!?](\s|$)/g) ?? []).length
}

// ---------------------------------------------------------------------------
// Séma-semlegesség és a mezők helye
// ---------------------------------------------------------------------------

describe('Pages: séma-semleges szerkezet (K17, K19)', () => {
  it('az oldal mezőin admin.condition csak UI-mezőn áll (kötelező, tömb, blokk mezőn soha)', () => {
    // A blokkok belseje a blokkfájlok gazdájáé; itt az oldal saját mezői és a
    // tömbök sorai számítanak.
    const oldalMezok = flatFields(Pages.fields).flatMap((field) =>
      field.type === 'array' ? [field, ...allFields(field.fields)] : [field],
    )
    for (const field of oldalMezok) {
      if (typeof adminOf(field).condition !== 'function') continue
      expect(
        field.type,
        `feltétel nem UI-mezőn: ${'name' in field ? field.name : field.type}`,
      ).toBe('ui')
    }
  })

  it('a title, az excerpt és a heroImage látható marad (SEO-tartalék)', () => {
    for (const name of ['title', 'excerpt', 'heroImage', 'content', 'layout', 'faq']) {
      const admin = adminOf(byName(Pages.fields, name))
      expect(admin.hidden, `${name} rejtve`).not.toBe(true)
      expect(admin.condition, `${name} feltételes`).toBeUndefined()
    }
  })

  it('a mezőnevek, típusok és a kötelezőség változatlan', () => {
    const expected: Array<[string, Field['type'], boolean | undefined]> = [
      ['title', 'text', true],
      ['slug', 'text', true],
      ['excerpt', 'textarea', undefined],
      ['content', 'richText', true],
      ['layout', 'blocks', undefined],
      ['heroImage', 'upload', undefined],
      ['order', 'number', undefined],
      ['faq', 'array', undefined],
    ]
    for (const [name, type, required] of expected) {
      const field = byName(Pages.fields, name)
      expect(field.type, name).toBe(type)
      expect('required' in field ? field.required : undefined, name).toBe(required)
    }
  })

  it('a sorrend: állapot, tájékoztató, lapfej, Szekciók, a régi Tartalom figyelmeztetéssel', () => {
    const sor = names(Pages.fields)
    // A hub-tájékoztató (H05) közvetlenül a közzétételi állapot után.
    expect(sor.slice(0, 3)).toEqual(['kozzetetelAllapot', 'hubTajekoztato', 'mihelyTajekoztato'])
    const i = (name: string): number => sor.indexOf(name)
    expect(i('title')).toBeLessThan(i('excerpt'))
    expect(i('excerpt')).toBeLessThan(i('heroImage'))
    expect(i('heroImage')).toBeLessThan(i('layout'))
    // A Szekciók a Tartalom ELŐTT (a lap sorrendje; a Tartalom szekciók mellett nem látszik).
    expect(i('layout')).toBeLessThan(i('content'))
    expect(i('regiTartalomTajekoztato')).toBe(i('content') - 1)
    expect(i('oldalGyikTajekoztato')).toBe(i('faq') - 1)
  })

  it('a UI-tájékoztatók feltételei', () => {
    const cond = (name: string) =>
      adminOf(byName(Pages.fields, name)).condition as (data: unknown) => boolean
    for (const name of ['mihelyTajekoztato', 'regiTartalomTajekoztato']) {
      expect(cond(name)({ layout: [{ blockType: 'about' }] })).toBe(true)
      expect(cond(name)({ layout: [] })).toBe(false)
      expect(cond(name)({})).toBe(false)
      expect(cond(name)(undefined)).toBe(false)
    }
    const gyik = cond('oldalGyikTajekoztato')
    expect(gyik({ slug: 'kezdolap' })).toBe(true)
    expect(gyik({ slug: 'kapcsolat' })).toBe(true)
    expect(gyik({ slug: 'rolunk' })).toBe(false)
    expect(gyik({ slug: 'keztoalagut-szindroma' })).toBe(false)
  })

  it('a blokk nevét a katalógus adja (a slugból), nem beégetett szöveg', () => {
    const field = byName(Pages.fields, 'mihelyTajekoztato')
    const components = adminOf(field).components
    const comp = isRec(components) ? components.Field : undefined
    const props = isRec(comp) ? comp.clientProps : undefined
    expect(isRec(props) ? typeof props.nyitoBlokkNev : undefined).toBe('string')
  })
})

describe('Pages és Posts: oldalsáv, rejtett Sorrend, dátum, kereső (K25, K40)', () => {
  it.each([
    ['pages', Pages],
    ['posts', Posts],
  ] as const)('%s: a Sorrend rejtett, az oszlop megmarad', (_name, collection) => {
    const order = byName(collection.fields, 'order')
    expect(order.type).toBe('number')
    expect(adminOf(order).hidden).toBe(true)
  })

  it.each([
    ['pages', Pages],
    ['posts', Posts],
  ] as const)('%s: mellékmezők az oldalsávban', (_name, collection) => {
    for (const name of [
      'slug',
      'publishedAt',
      'author',
      'reviewedBy',
      'reviewedAt',
      'nextReviewAt',
    ]) {
      expect(adminOf(byName(collection.fields, name)).position, name).toBe('sidebar')
    }
  })

  it.each([
    ['pages', Pages],
    ['posts', Posts],
  ] as const)(
    '%s: magyar dátumsorrend számjegyekkel, példával a leírásban',
    (_name, collection) => {
      for (const name of ['publishedAt', 'reviewedAt', 'nextReviewAt']) {
        const admin = adminOf(byName(collection.fields, name))
        const date = isRec(admin.date) ? admin.date : {}
        // AkH. 12. kiadás, 295. pont: „2014. 02. 28.” helyes keltezés.
        expect(date.displayFormat, name).toBe('yyyy. MM. dd.')
        expect(String(admin.description), name).toMatch(/pl\. 20\d\d\. \d\d\. \d\d\./)
        expect(String(admin.description), name).not.toMatch(
          /január|február|március|április|május|június|július|augusztus|szeptember|október|november|december/,
        )
      }
      for (const name of ['reviewedAt', 'nextReviewAt']) {
        const date = adminOf(byName(collection.fields, name)).date
        expect(isRec(date) ? date.pickerAppearance : undefined, name).toBe('dayOnly')
      }
    },
  )

  it.each([
    ['pages', Pages],
    ['posts', Posts],
  ] as const)('%s: egyik dátummező formátumában sincs hónap- vagy napnév (K25 őr)', (_n, c) => {
    // A Payload 3.88 DatePickere a magyar dátum-nyelvet csak az első render után
    // jegyzi be (DatePicker.js:108-129): a nevet adó token friss betöltéskor
    // angol szót mutat („2026. September 22.”). Csak számjegyes token maradhat.
    const datumMezok = allFields(c.fields).filter((field) => field.type === 'date')
    expect(datumMezok.length).toBeGreaterThanOrEqual(3)
    for (const field of datumMezok) {
      const date = adminOf(field).date
      const format = isRec(date) ? date.displayFormat : undefined
      if (format === undefined) continue
      expect(typeof format).toBe('string')
      const f = String(format)
      expect(f, `${'name' in field ? field.name : ''}: ${f}`).not.toMatch(/M{3,}|L{3,}|E{3,}/)
      // Szigorúbb: az idézett szövegen kívül csak y, M, d, H, m, s maradhat
      // (a P, G, a, b, B, e, c tokenek is angol szót adnának).
      const maradek = f
        .replace(/'[^']*'/g, '')
        .replace(/y+|M{1,2}|d{1,2}|H{1,2}|m{1,2}|s{1,2}/g, '')
      expect(maradek, f).not.toMatch(/[A-Za-z]/)
    }
  })

  it.each([
    ['pages', Pages],
    ['posts', Posts],
  ] as const)('%s: a lista a címre és a webcímre keres, a Webcím oszlop látszik', (_n, c) => {
    expect(c.admin?.listSearchableFields).toEqual(['title', 'slug'])
    expect(c.admin?.defaultColumns).toContain('slug')
  })

  it.each([
    ['pages', Pages],
    ['posts', Posts],
  ] as const)('%s: a feliratos Előnézet gomb be van kötve', (_name, collection) => {
    expect(collection.admin?.components?.edit?.PreviewButton).toBe(
      '/components/admin/ElonezetGomb#ElonezetGomb',
    )
    expect(names(collection.fields)[0]).toBe('kozzetetelAllapot')
  })

  it('címkék: Webcím, SEO-kulcsszavak; az oldalon „az oldal szakmai állításait”', () => {
    expect(slugField('title').label).toBe('Webcím')
    expect(courseSlugField.label).toBe('Webcím')
    expect(seoKeywordsField.label).toBe('SEO-kulcsszavak')
    expect(String(slugField('title').admin?.description)).toMatch(/kineticare\.hu\/rolunk/)
    expect(String(courseSlugField.admin?.description)).toMatch(/kineticare\.hu\/kurzusok\//)
    const reviewedBy = String(adminOf(byName(Pages.fields, 'reviewedBy')).description)
    expect(reviewedBy).toContain('az oldal szakmai állításait')
    expect(reviewedBy).not.toContain('cikk')
  })
})

describe('Őszinte leírások (K17, K19)', () => {
  const desc = (name: string): string => String(adminOf(byName(Pages.fields, name)).description)

  it('a Cím, a Rövid bevezető és a Fejléckép kimondja: a kezdőlapon (szekciókkal) nem látszik', () => {
    // A kezdőlap szekciók nélkül a HomeView beépített alapváltozatát rajzolja,
    // abban a Cím, a Bevezető és a Fejléckép IS látszik: ezért „amíg vannak
    // Szekciói” (igazság-tábla, H04; őr lent a HomeView sorain).
    expect(desc('title')).toMatch(/A legtöbb oldalon ez a lap nagy címe \(a Kapcsolat oldalon is\)/)
    expect(desc('title')).toMatch(/A kezdőlapon, amíg vannak Szekciói, a lapon nem jelenik meg/)
    expect(desc('title')).not.toMatch(/Kapcsolat oldalon a lapon nem jelenik meg/)
    expect(desc('title')).not.toMatch(/ez jelenik meg a lap tetején/)
    expect(desc('excerpt')).toMatch(/A kezdőlapon, amíg vannak Szekciói, csak az utóbbi\./)
    expect(desc('heroImage')).toMatch(
      /A Kapcsolat oldalon a lapon nem jelenik meg, a kezdőlapon sem, amíg annak vannak Szekciói\./,
    )
  })

  it('Kapcsolat: a Rövid bevezető NEM tartaléka a Google-leírásnak (H26), a route kódja szerint', () => {
    expect(desc('excerpt')).toMatch(
      /A Kapcsolat oldalon egyik sem: a lapon nem látszik, és üres SEO-leírásnál a weboldal beépített leírása kerül a Google-találatba\./,
    )
    expect(desc('seoDescription')).toMatch(
      /Ha üresen hagyod, a Rövid bevezető kerül oda, a Kapcsolat oldalon a weboldal beépített leírása\./,
    )
    const forras = readFileSync(
      fileURLToPath(new URL('../app/(frontend)/kapcsolat/page.tsx', import.meta.url)),
      'utf8',
    )
    // contactDescription: a Rövid bevezető helyén `excerpt: null`, üresen a kódtartalék.
    expect(forras).toMatch(
      /seoDescription: page\.seoDescription,\s*\}\)\s*: undefined\) \?\? CONTACT_FALLBACK_DESCRIPTION/,
    )
    expect(forras).toMatch(/title: CONTACT_TITLE,\s*excerpt: null,/)
  })

  it('a kezdőlap alapváltozata (szekciók nélkül) a Címet, a Bevezetőt és a Fejlécképet mutatja', () => {
    const homeView = readFileSync(
      fileURLToPath(new URL('../components/content/HomeView.tsx', import.meta.url)),
      'utf8',
    )
    expect(homeView).toContain('const layout = presentHomeLayout(home?.layout ?? [])')
    expect(homeView).toContain('if (layout.length > 0) {')
    expect(homeView).toMatch(/const title =\s*home\?\.title\?\.trim\(\) \|\|/)
    expect(homeView).toMatch(/const lead =\s*home\?\.excerpt\?\.trim\(\) \|\|/)
    expect(homeView).toMatch(/HERO_VIDEO_STREAM_ID !== null \? \([\s\S]*?\) : heroMedia \?/)
    const heroVideo = readFileSync(
      fileURLToPath(new URL('../lib/hero-video.ts', import.meta.url)),
      'utf8',
    )
    expect(heroVideo).toContain('export const HERO_VIDEO_STREAM_ID: string | null = null')
  })

  it('a Kapcsolat oldalról tett állítás a route kódjához kötve: a nagy cím a rekord Címe', () => {
    // Ha a route visszaáll a rögzített „Kapcsolat” címre, ez a teszt bukik, és a
    // Cím leírását, valamint a Kapcsolat tájékoztatóját is vissza kell írni.
    const forras = readFileSync(
      fileURLToPath(new URL('../app/(frontend)/kapcsolat/page.tsx', import.meta.url)),
      'utf8',
    )
    expect(forras).toContain('<h1>{contactHeading(page)}</h1>')
    expect(forras).toMatch(/return page\?\.title\?\.trim\(\) \|\| CONTACT_TITLE/)
    // A Rövid bevezető és a Fejléckép a Kapcsolat lapon nem renderel.
    expect(forras).not.toMatch(/PageHero|page\.excerpt|heroImage/)
  })

  it('a Tartalom és a Szekciók kimondja az elsőbbséget', () => {
    expect(desc('content')).toMatch(
      /Ha az oldalnak vannak Szekciói, ez a szöveg a lapon nem jelenik meg/,
    )
    expect(desc('layout')).toMatch(
      /Ha itt legalább egy szekció van, a lenti Tartalom a lapon nem jelenik meg/,
    )
    expect(desc('layout')).not.toMatch(/semmi nem vész el/)
  })

  it('a Szekciók leírása a rejtés valódi helyét és kapcsolóját nevezi meg (K28 után)', () => {
    // A csukott rész fejléce és a pipa címkéje ugyanabból a forrásból, amit a
    // felület mutat (WCAG 2.2 SC 3.2.4).
    const settings = sectionSettings()
    const csoport = settings.type === 'collapsible' ? settings.fields[0] : undefined
    const visible =
      csoport && csoport.type === 'group'
        ? csoport.fields.find((f) => 'name' in f && f.name === 'visible')
        : undefined
    const pipaCimke = visible && 'label' in visible ? visible.label : undefined
    expect(pipaCimke).toBe('Látható')
    expect(settings.type === 'collapsible' ? settings.label : undefined).toBe(
      SECTION_SETTINGS_LABEL,
    )
    expect(desc('layout')).toContain(`az alján nyisd ki a „${SECTION_SETTINGS_LABEL}” részt`)
    expect(desc('layout')).toContain(`vedd ki a „${String(pipaCimke)}” pipát`)
    expect(desc('layout')).toMatch(/úgy rejthetsz el, hogy a tartalma megmarad/)
    expect(desc('layout')).not.toMatch(/saját beállításai között/)
  })

  it('az oldal végi GYIK címkéje és leírása megmondja, hol NEM látszik', () => {
    const faq = byName(Pages.fields, 'faq')
    expect('label' in faq ? faq.label : '').toBe('Oldal végi GYIK')
    expect(desc('faq')).toMatch(/a kezdőlapon és a Kapcsolat oldalon nem/)
  })
})

describe('Tipográfia: a B3-fájlok felhasználói szövegei (§3.1)', () => {
  it('0 gondolatjel, 0 hibás idézőjel, 0 verzál szó a mezőkben', () => {
    const texts = [
      ...userTexts(Pages.fields),
      ...userTexts(Posts.fields),
      String(Pages.admin?.description),
      String(Posts.admin?.description),
      String(slugField('title').label),
      String(slugField('title').admin?.description),
      String(courseSlugField.label),
      String(courseSlugField.admin?.description),
      String(seoKeywordsField.label),
      String(seoKeywordsField.admin?.description),
    ]
    expect(texts.length).toBeGreaterThan(30)
    expect(texts.flatMap(tipografiaiHibak)).toEqual([])
  })

  it('0 gondolatjel, 0 hibás idézőjel, 0 verzál szó a komponensek szövegeiben', () => {
    const sorok = [
      { blockType: 'filmHero', lathato: true },
      { blockType: 'faq', lathato: true },
    ]
    const maskent = [
      ...sorok,
      { blockType: 'courseCards', lathato: true, forras: 'Kurzusok' },
      { blockType: 'testimonials', lathato: true, forras: 'Vélemények' },
    ]
    const szovegek = [
      notice.hazaTajekoztato('kezdolap', sorok, 'Nyitó videó (kéznyitás)'),
      notice.hazaTajekoztato('kezdolap', maskent, 'Nyitó videó (kéznyitás)'),
      notice.hazaTajekoztato('kapcsolat', sorok, 'Nyitó videó'),
      notice.hazaTajekoztato('kapcsolat', maskent, 'Nyitó videó'),
      notice.hazaTajekoztato('rolunk', [], 'Nyitó videó'),
      notice.hazaTajekoztato('rolunk', sorok, 'Nyitó videó'),
      notice.hazaTajekoztato('rolunk', maskent.slice(1), 'Nyitó videó'),
      notice.regiTartalomSzoveg(),
      notice.oldalGyikSzoveg('kezdolap', sorok, 'GYIK (gyakori kérdések)'),
      notice.oldalGyikSzoveg('kapcsolat', [], 'GYIK (gyakori kérdések)'),
    ].flatMap((sz) => [sz.cim, ...sz.bekezdesek])
    for (const a of ['kozzeteve', 'valtozott', 'piszkozat'] as const) {
      const sz = allapotMod.allapotSzoveg(a, 'Módosítások közzététele')
      szovegek.push(sz.cim, sz.szoveg)
    }
    szovegek.push(
      allapotMod.visszaallitasMondat('pages', 'Módosítások közzététele'),
      allapotMod.visszaallitasMondat('posts', 'Módosítások közzététele'),
      allapotMod.VALTOZATOK_FELIRAT,
      audit.AUDIT_LINK_FELIRAT,
      gomb.ELONEZET_FELIRAT,
      gomb.ELONEZET_NEV,
      gomb.VARAKOZO_SZOVEG,
      gomb.MENTETLEN_KERDES,
    )
    expect(szovegek.flatMap(tipografiaiHibak)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// „Mi hol van” tájékoztatók
// ---------------------------------------------------------------------------

describe('HomePageEditNotice: szövegek és számozás', () => {
  it.each([
    [1, 'az 01-es'],
    [2, 'a 02-es'],
    [3, 'a 03-as'],
    [5, 'az 05-ös'],
    [6, 'a 06-os'],
    [10, 'a 10-es'],
    [14, 'a 14-es'],
    [20, 'a 20-as'],
    [30, 'a 30-as'],
    [50, 'az 50-es'],
    [55, 'az 55-ös'],
    [60, 'a 60-as'],
  ])('%i → „%s”', (n, expected) => {
    expect(notice.sorszamKifejezes(n)).toBe(expected)
  })

  // Az élő kezdőlap szekciósora (helyi pages/1, 2026-09-23), a forrással.
  const kezdolapSorok: Array<{ blockType: string; lathato: boolean; forras?: string | null }> = [
    { blockType: 'filmHero', lathato: true },
    { blockType: 'credsStrip', lathato: true },
    { blockType: 'services', lathato: true },
    { blockType: 'courseCards', lathato: true, forras: 'Kurzusok' },
    // A freeSos forrása 2026-09-23 óta a Kurzusok (section-row-label.ts); a
    // felsorolásban egyszer szerepel, a kimenet ettől nem változik.
    { blockType: 'freeSos', lathato: true, forras: 'Kurzusok' },
    { blockType: 'about', lathato: true },
    { blockType: 'testimonials', lathato: true, forras: 'Vélemények' },
    { blockType: 'knowledge', lathato: true, forras: 'Blogbejegyzések' },
    { blockType: 'faq', lathato: true },
    { blockType: 'ctaBanner', lathato: true, forras: 'Kurzusok' },
  ]

  it('kezdőlap: a szekciók szövege lent, a legnagyobb cím és a beúszó szövegek az 01-es szekcióban', () => {
    const sz = notice.hazaTajekoztato('kezdolap', kezdolapSorok, 'Nyitó videó (kéznyitás)')
    expect(sz.bekezdesek).toEqual([
      'A lapon látható szekciók szövegét lent, a Szekciók között írod át.',
      `A legnagyobb cím és a videón beúszó szövegek az 01-es, „Nyitó videó (kéznyitás)” szekcióban vannak; ezt a szekciót a menü „${ADMIN_UTAK.videoSzovegei.felirat}” pontja is megnyitja.`,
      `Egyes szekciók tartalma máshonnan jön (itt: Kurzusok, Vélemények és Blogbejegyzések): ezek elején az „${UGRAS_FELIRAT}” link visz tovább.`,
      'A Cím, a Rövid bevezető és a Fejléckép mező a lapon nem jelenik meg: a keresőknek és a megosztási előnézetnek szól.',
    ])
  })

  it('a videón beúszó szövegek valóban a nyitó videós szekció mezői (a mondat igaz)', async () => {
    const { filmHero } = await import('../blocks/film-hero')
    const captions = allFields(filmHero.fields).find((f) => 'name' in f && f.name === 'captions')
    expect(captions && 'label' in captions ? captions.label : undefined).toBe(
      'Beúszó szövegek a videón',
    )
  })

  it('a „máshonnan jön” mondat ugyanazt a nevet és linkfeliratot adja, mint a szekció eleje', () => {
    // A forrás neve a sectionSource() hova.nev-e, a link a közös állandó.
    for (const [data, slug, nev] of [
      [{ blockType: 'courseCards' }, 'kezdolap', 'Kurzusok'],
      [{ blockType: 'testimonials' }, 'kezdolap', 'Vélemények'],
      [{ blockType: 'knowledge' }, 'kezdolap', 'Blogbejegyzések'],
      [{ blockType: 'ctaBanner', cta: { url: '/kurzusok' } }, 'kezdolap', 'Kurzusok'],
    ] as const) {
      expect(sectionSource(data, slug)?.hova?.nev).toBe(nev)
    }
    // A Rólunk oldal kiemelő sávjának képe beépített, ott nincs „ugrás oda”.
    expect(
      sectionSource({ blockType: 'ctaBanner', cta: { url: '/kurzusok' } }, 'rolunk')?.hova,
    ).toBeNull()
    expect(notice.maskentMondat(kezdolapSorok)).toContain(`„${UGRAS_FELIRAT}”`)
  })

  it('rejtett és máshonnan nem töltődő szekció nem kerül a felsorolásba; ilyenkor nincs mondat', () => {
    expect(
      notice.maskentToltodoForrasok([
        { blockType: 'testimonials', lathato: false, forras: 'Vélemények' },
        { blockType: 'about', lathato: true },
        { blockType: 'ctaBanner', lathato: true, forras: 'Kurzusok' },
      ]),
    ).toEqual(['Kurzusok'])
    expect(notice.maskentMondat([{ blockType: 'appointment', lathato: true }])).toBeNull()
    expect(notice.felsorolas(['A'])).toBe('A')
    expect(notice.felsorolas(['A', 'B'])).toBe('A és B')
    expect(notice.felsorolas(['A', 'B', 'C'])).toBe('A, B és C')
  })

  it('egyik változat sem állít „minden” vagy „többi látható” szöveget, és legfeljebb 4 mondat', () => {
    const valtozatok: Array<[string, typeof kezdolapSorok]> = [
      ['kezdolap', kezdolapSorok],
      ['kezdolap', [{ blockType: 'about', lathato: true }]],
      [
        'kapcsolat',
        [
          { blockType: 'appointment', lathato: true },
          { blockType: 'teamMembers', lathato: true },
        ],
      ],
      ['kapcsolat', kezdolapSorok.slice(1)],
      [
        'rolunk',
        [
          { blockType: 'richText', lathato: true },
          { blockType: 'testimonials', lathato: true, forras: 'Vélemények' },
        ],
      ],
      ['rolunk', [{ blockType: 'about', lathato: true }]],
      ['szakembereknek', kezdolapSorok],
    ]
    for (const [slug, sorok] of valtozatok) {
      const sz = notice.hazaTajekoztato(slug, sorok, 'Nyitó videó (kéznyitás)')
      const text = [sz.cim, ...sz.bekezdesek].join(' ')
      expect(text, `${slug}: ${text}`).not.toMatch(/minden/i)
      expect(text, `${slug}: ${text}`).not.toMatch(/többi látható/i)
      expect(text, `${slug}: ${text}`).not.toMatch(/a többi/i)
      expect(mondatok(sz.bekezdesek.join(' ')), `${slug}: ${text}`).toBeLessThanOrEqual(4)
      expect(sz.bekezdesek.flatMap(tipografiaiHibak)).toEqual([])
    }
  })

  it('Kapcsolat: a nagy cím a Cím mező, a Bevezető és a Fejléckép nem látszik', () => {
    const sz = notice.hazaTajekoztato(
      'kapcsolat',
      [
        { blockType: 'appointment', lathato: true },
        { blockType: 'teamMembers', lathato: true },
      ],
      'x',
    )
    expect(sz.bekezdesek).toEqual([
      'A lap nagy címe a fenti Cím mező.',
      'Alatta a szekciók jönnek, ezek szövegét lent, a Szekciók között írod át.',
      'A Rövid bevezető és a Fejléckép mező a lapon nem jelenik meg.',
    ])
    expect(sz.bekezdesek.join(' ')).not.toMatch(/rögzített/)
  })

  it('nyitó videós belső oldal: a legnagyobb cím helye, a lapfej rejtése és a lap vége', () => {
    const sz = notice.hazaTajekoztato(
      'szakembereknek',
      [
        { blockType: 'filmHero', lathato: true },
        { blockType: 'testimonials', lathato: true, forras: 'Vélemények' },
      ],
      'Nyitó videó (kéznyitás)',
    )
    expect(sz.bekezdesek).toEqual([
      'A lapon látható szekciók szövegét lent, a Szekciók között írod át.',
      'A legnagyobb cím az 01-es, „Nyitó videó (kéznyitás)” szekcióban áll: amíg ez látható, a Cím, a Rövid bevezető és a Fejléckép mező a lapon nem jelenik meg.',
      `Egyes szekciók tartalma máshonnan jön (itt: Vélemények): ezek elején az „${UGRAS_FELIRAT}” link visz tovább.`,
      'A Szekciók után jön az oldal végi GYIK és a szerzői doboz, ha ki vannak töltve: ezeket az „Oldal végi GYIK” mezőben, illetve a „Szerző” mezőtől lefelé írod át.',
    ])
  })

  it('a menüpontra csak akkor utal, ha a menüpont a látható nyitó szekciót nyitja meg', () => {
    // A „Kezdőlapi videó szövegei” az ELSŐ filmHero sort nyitja meg (KezdolapCel.ts).
    expect(ADMIN_UTAK.videoSzovegei.felirat).toBe('Kezdőlapi videó szövegei')
    const elso = notice.hazaTajekoztato('kezdolap', kezdolapSorok, 'Nyitó videó (kéznyitás)')
    expect(elso.bekezdesek[1]).toContain(`„${ADMIN_UTAK.videoSzovegei.felirat}” pontja`)
    const rejtettElol = notice.hazaTajekoztato(
      'kezdolap',
      [
        { blockType: 'filmHero', lathato: false },
        { blockType: 'filmHero', lathato: true },
      ],
      'Nyitó videó',
    )
    expect(rejtettElol.bekezdesek[1]).toContain('a 02-es, „Nyitó videó” szekcióban vannak.')
    expect(rejtettElol.bekezdesek.join(' ')).not.toContain(ADMIN_UTAK.videoSzovegei.felirat)
    // Más oldalon a menüpont nem ide visz, ott nem is említjük.
    const belso = notice.hazaTajekoztato('szakembereknek', kezdolapSorok, 'Nyitó videó')
    expect(belso.bekezdesek.join(' ')).not.toContain(ADMIN_UTAK.videoSzovegei.felirat)
  })

  it('rejtett nyitó szekció nem számít, a szám a valódi sorhoz igazodik', () => {
    const sz = notice.hazaTajekoztato(
      'kezdolap',
      [
        { blockType: 'filmHero', lathato: false },
        { blockType: 'about', lathato: true },
        { blockType: 'filmHero', lathato: true },
      ],
      'Nyitó videó',
    )
    expect(sz.bekezdesek[1]).toContain('a 03-as, „Nyitó videó” szekcióban')
  })

  it('lapfejes oldal (Rólunk): a lapfej, a szekciók, a kivétel és a lap vége a saját mezőiből', () => {
    const sz = notice.hazaTajekoztato(
      'rolunk',
      [
        { blockType: 'about', lathato: true },
        { blockType: 'testimonials', lathato: true, forras: 'Vélemények' },
        { blockType: 'ctaBanner', lathato: true, forras: null },
      ],
      'x',
    )
    expect(sz.bekezdesek).toEqual([
      'A Cím mező a lap nagy címe, alatta a Rövid bevezető áll, mellette vagy alatta a Fejléckép.',
      'Alattuk a szekciók jönnek, ezek szövegét lent, a Szekciók között írod át.',
      `Egyes szekciók tartalma máshonnan jön (itt: Vélemények): ezek elején az „${UGRAS_FELIRAT}” link visz tovább.`,
      'A Szekciók után jön az oldal végi GYIK és a szerzői doboz, ha ki vannak töltve: ezeket az „Oldal végi GYIK” mezőben, illetve a „Szerző” mezőtől lefelé írod át.',
    ])
  })

  it('a lap végi mondat a Pages.ts tényleges mezőcímkéit idézi (egy forrásból)', () => {
    const faq = byName(Pages.fields, 'faq')
    const author = byName(Pages.fields, 'author')
    const faqCimke = 'label' in faq ? String(faq.label) : ''
    const szerzoCimke = 'label' in author ? String(author.label) : ''
    const components = adminOf(byName(Pages.fields, 'mihelyTajekoztato')).components
    const comp = isRec(components) ? components.Field : undefined
    const props = isRec(comp) && isRec(comp.clientProps) ? comp.clientProps : {}
    expect(props.gyikMezoNev).toBe(faqCimke)
    expect(props.szerzoMezoNev).toBe(szerzoCimke)
    // „a Szerző mezőtől lefelé” pontosan a szerzői doboz mezői: az oldalsávban
    // a Szerző után a szakmai ellenőrzés három mezője jön, és ott a vége.
    const oldalsav = flatFields(Pages.fields)
      .filter((f) => adminOf(f).position === 'sidebar' && adminOf(f).hidden !== true)
      .map((f) => ('name' in f ? f.name : ''))
    // A szerző adatlapjára vivő link (H52) a Szerző alatt áll, a doboz része.
    expect(oldalsav.slice(oldalsav.indexOf('author'))).toEqual([
      'author',
      'szerzoAdatlap',
      'reviewedBy',
      'reviewedAt',
      'nextReviewAt',
    ])
    expect(byName(Pages.fields, 'szerzoAdatlap').type).toBe('ui')
    const sz = notice.hazaTajekoztato('rolunk', [{ blockType: 'about', lathato: true }], 'x', {
      gyik: faqCimke,
      szerzo: szerzoCimke,
    })
    expect(sz.bekezdesek.join(' ')).toContain(
      `az „${faqCimke}” mezőben, illetve a „${szerzoCimke}” mezőtől lefelé`,
    )
  })

  it('GYIK-figyelmeztetés: a látható GYIK szekció sorszámával', () => {
    const sorok = Array.from({ length: 14 }, (_v, i) => ({
      blockType: i === 13 ? 'faq' : 'about',
      lathato: true,
    }))
    const sz = notice.oldalGyikSzoveg('kezdolap', sorok, 'GYIK (gyakori kérdések)')
    expect(sz.cim).toBe('A kezdőlapon ez a GYIK nem jelenik meg.')
    expect(sz.bekezdesek[0]).toContain('a 14-es „GYIK (gyakori kérdések)” szekcióban')
  })

  it('renderelés: szekció nélkül semmi, szekcióval link a Szekciókhoz, élő régió nélkül', () => {
    allapot.fields = { slug: { value: 'kezdolap' } }
    expect(renderToStaticMarkup(createElement(notice.HomePageEditNotice, {}))).toBe('')
    allapot.fields = {
      slug: { value: 'kezdolap' },
      'layout.0.blockType': { value: 'filmHero' },
      'layout.1.blockType': { value: 'faq' },
      'layout.1.sectionSettings.visible': { value: true },
    }
    const html = renderToStaticMarkup(
      createElement(notice.HomePageEditNotice, { nyitoBlokkNev: 'Nyitó videó (kéznyitás)' }),
    )
    expect(html).toContain('href="#field-layout"')
    expect(html).toContain('Ugrás a Szekciókhoz')
    expect(html).toContain('kc-admin-notice')
    expect(html).not.toMatch(/role="(alert|status)"/)
    expect(html).not.toMatch(/minden|többi látható/i)
    // Máshonnan töltődő szekció nélkül nincs „máshonnan jön” mondat.
    expect(html).not.toContain(UGRAS_FELIRAT)
    const gyik = renderToStaticMarkup(createElement(notice.OldalGyikNotice, {}))
    expect(gyik).toContain('href="#layout-row-1"')
    allapot.fields = { slug: { value: 'rolunk' }, 'layout.0.blockType': { value: 'about' } }
    expect(renderToStaticMarkup(createElement(notice.OldalGyikNotice, {}))).toBe('')
  })

  it('renderelés: az űrlapállapotból számolt forrás (kártyák, rejtett sor, kiemelő sáv célja)', () => {
    allapot.fields = {
      slug: { value: 'kezdolap' },
      'layout.0.blockType': { value: 'filmHero' },
      'layout.1.blockType': { value: 'courseCards' },
      'layout.2.blockType': { value: 'testimonials' },
      'layout.2.sectionSettings.visible': { value: false },
      'layout.3.blockType': { value: 'knowledge' },
      'layout.4.blockType': { value: 'ctaBanner' },
      'layout.4.cta.url': { value: '/kurzusok' },
    }
    const html = renderToStaticMarkup(
      createElement(notice.HomePageEditNotice, { nyitoBlokkNev: 'Nyitó videó (kéznyitás)' }),
    )
    // A rejtett Vélemények kimarad, a Kurzusok egyszer szerepel.
    expect(html).toContain('(itt: Kurzusok és Blogbejegyzések)')
    expect(html).toContain(`„${UGRAS_FELIRAT}”`)
    expect(html).toContain('az 01-es, „Nyitó videó (kéznyitás)” szekcióban vannak')
    // A Rólunk oldalon a kiemelő sáv képe beépített montázs: nincs „ugrás oda”.
    allapot.fields = {
      slug: { value: 'rolunk' },
      'layout.0.blockType': { value: 'about' },
      'layout.1.blockType': { value: 'ctaBanner' },
      'layout.1.cta.url': { value: '/kurzusok' },
    }
    const rolunk = renderToStaticMarkup(createElement(notice.HomePageEditNotice, {}))
    expect(rolunk).not.toContain(UGRAS_FELIRAT)
    expect(rolunk).toContain('az „Oldal végi GYIK” mezőben, illetve a „Szerző” mezőtől lefelé')
  })
})

// ---------------------------------------------------------------------------
// Közzétételi állapot, visszaállítás, Műveletnapló
// ---------------------------------------------------------------------------

describe('ElonezetAllapot: három állapot, legfeljebb két mondat', () => {
  it.each([
    [true, 0, 'kozzeteve'],
    [true, 3, 'valtozott'],
    [false, 0, 'piszkozat'],
    [false, 2, 'piszkozat'],
  ] as const)('közzétett=%s, közzé nem tett=%i → %s', (published, count, expected) => {
    expect(allapotMod.kozzetetelAllapot(published, count)).toBe(expected)
  })

  it.each(['kozzeteve', 'valtozott', 'piszkozat'] as const)(
    '%s: legfeljebb 2 rövid mondat, a gomb neve betűre egyezik',
    (a) => {
      const sz = allapotMod.allapotSzoveg(a, 'Módosítások közzététele')
      expect(mondatok(`${sz.cim} ${sz.szoveg}`)).toBeLessThanOrEqual(2)
      if (a !== 'kozzeteve') expect(sz.szoveg).toContain('„Módosítások közzététele”')
    },
  )

  it('a változott állapot kimondja: a látogatók a legutóbb közzétett verziót látják', () => {
    const sz = allapotMod.allapotSzoveg('valtozott', 'Módosítások közzététele')
    expect(sz.cim).toBe('Van közzé nem tett módosításod.')
    expect(sz.szoveg).toContain('A látogatók még a legutóbb közzétett verziót látják')
    expect(sz.szoveg).toContain('Előnézettel')
  })

  it('a „piszkozat” cím „Nincs közzétéve.”; egyik állapot sem mond „sosem”-et vagy „változat”-ot', () => {
    // A hasPublishedDoc a fő dokumentum MOSTANI állapota (getVersions.js), ezért
    // visszavonás és piszkozat verzió visszaállítása után is hamis: „sosem
    // volt közzétéve” ebből nem állítható. A core „verzió”-nak hívja (SC 3.2.4).
    expect(allapotMod.allapotSzoveg('piszkozat', 'Módosítások közzététele').cim).toBe(
      'Nincs közzétéve.',
    )
    expect(allapotMod.allapotSzoveg('kozzeteve', 'Módosítások közzététele').szoveg).toBe(
      'A látogatók pontosan ezt a verziót látják.',
    )
    const szovegek = [
      ...(['kozzeteve', 'valtozott', 'piszkozat'] as const).flatMap((a) => {
        const sz = allapotMod.allapotSzoveg(a, 'Módosítások közzététele')
        return [sz.cim, sz.szoveg]
      }),
      allapotMod.visszaallitasMondat('pages', 'Módosítások közzététele'),
      allapotMod.visszaallitasMondat('posts', 'Módosítások közzététele'),
      allapotMod.VALTOZATOK_FELIRAT,
    ]
    for (const sz of szovegek) {
      expect(sz).not.toMatch(/sosem/i)
      expect(sz).not.toMatch(/változat/i)
      // docs/ui-sztenderdek.md §8.1: „közzététel”, nem „élesít”.
      expect(sz).not.toMatch(/élesít/i)
    }
    expect(allapotMod.VALTOZATOK_FELIRAT).toBe('Korábbi verziók és visszaállítás')
  })

  it.each([
    ['pages', 'Innen az oldal korábbi verzióját', 'szekcióval', 'a lap nem látszik'],
    [
      'posts',
      'Innen a blogbejegyzés korábbi verzióját',
      'bekezdéssel',
      'a blogbejegyzés nem látszik',
    ],
  ] as const)(
    '%s: a visszaállítás-mondat mindkét verziótípusra igaz, legfeljebb 2 mondat',
    (gyujtemeny, eleje, egyseg, kovetkezmeny) => {
      const m = allapotMod.visszaallitasMondat(gyujtemeny, 'Módosítások közzététele')
      expect(mondatok(m)).toBeLessThanOrEqual(2)
      expect(m.startsWith(eleje)).toBe(true)
      expect(m).toContain(`egy véletlenül törölt ${egyseg} együtt`)
      // Piszkozat verziónál nincs ilyen ág (Restore/index.js: canRestoreAsDraft).
      expect(m).not.toContain('Visszaállítás piszkozatként')
      expect(m).not.toMatch(/piszkozatként/)
      expect(m).toContain('Piszkozat verzió')
      expect(m).toContain(`${kovetkezmeny} a weboldalon`)
      expect(m).toContain('nem látszik a weboldalon')
      // Az átadott gombnév „…” idézőjelben, betűre (SC 3.2.4).
      expect(m).toContain('a „Módosítások közzététele” gombbal közzé nem teszed.')
      // Sosem közzétett lapnál is igaz: nincs „újra” (az A-1 K24-fordításával egyezően).
      expect(m).not.toContain('újra')
      expect(allapotMod.visszaallitasMondat(gyujtemeny, 'Próba gomb')).toContain('„Próba gomb”')
    },
  )

  it('az állítások a Payload core forrássoraihoz kötve (verzióemeléskor újra kell nézni)', () => {
    // Ha az upstream változik, ez a teszt bukik: a visszaállítás-mondatot és a
    // „Nincs közzétéve.” címet újra kell mérni (ElonezetAllapot.tsx fejléce).
    const core = (ut: string): string =>
      readFileSync(fileURLToPath(new URL(`../../node_modules/${ut}`, import.meta.url)), 'utf8')
    // „Visszaállítás piszkozatként” csak közzétett verziónál létezik.
    expect(core('@payloadcms/next/dist/views/Version/Restore/index.js')).toContain(
      "canRestoreAsDraft = status !== 'draft'",
    )
    // A fő gomb a verzió állapotát a fő dokumentumba írja (piszkozat → 404).
    expect(core('payload/dist/collections/operations/restoreVersion.js')).toContain(
      "result._status = draftArg ? 'draft' : result._status",
    )
    // A hasPublishedDoc a fő dokumentum mostani állapotából jön, nem a múltból.
    const getVersions = core('@payloadcms/next/dist/views/Document/getVersions.js')
    expect(getVersions).toMatch(/if \(doc\?\._status === 'published'\) \{\s*publishedDoc = doc;/)
    expect(getVersions).toMatch(/if \(publishedDoc\) \{\s*hasPublishedDoc = true;/)
  })

  it('a doboz nem kéri a „Visszaállítás piszkozatként” fordítását (a mock megadná)', () => {
    const html = renderToStaticMarkup(createElement(allapotMod.ElonezetAllapot))
    expect(html).not.toContain('Visszaállítás piszkozatként')
    expect(html).toContain('„Módosítások közzététele” gombbal közzé nem teszed.')
  })

  it('mountkor nincs role="alert", az élő régió üres; link a verziólistára', () => {
    allapot.doc = {
      id: 7,
      collectionSlug: 'pages',
      hasPublishedDoc: true,
      unpublishedVersionCount: 2,
    }
    const html = renderToStaticMarkup(createElement(allapotMod.ElonezetAllapot))
    expect(html).not.toContain('role="alert"')
    expect(html).toMatch(/<p role="status"[^>]*><\/p>/)
    expect(html).toContain('href="/admin/collections/pages/7/versions"')
    expect(html).toContain('Korábbi verziók és visszaállítás')
    expect(html).toContain('kc-admin-notice--figyelem')
    expect(html).toContain('korábbi verzióját egészben visszaállíthatod')
    expect(html).toContain('egy véletlenül törölt szekcióval együtt')
    expect(html).toContain('Piszkozat verzió visszaállítása után a lap nem látszik a weboldalon')
    expect(html).not.toContain('Visszaállítás piszkozatként')
  })

  it('mentetlen (új) dokumentumon és a kukában nem jelenik meg', () => {
    allapot.doc = { collectionSlug: 'pages', hasPublishedDoc: false, unpublishedVersionCount: 0 }
    expect(renderToStaticMarkup(createElement(allapotMod.ElonezetAllapot))).toBe('')
    allapot.doc = {
      id: 3,
      collectionSlug: 'pages',
      hasPublishedDoc: true,
      unpublishedVersionCount: 0,
      isTrashed: true,
    }
    expect(renderToStaticMarkup(createElement(allapotMod.ElonezetAllapot))).toBe('')
  })
})

describe('DocAuditLink: csak tulajdonosnak, a dokumentumra szűrve (K52)', () => {
  it.each([
    [{ role: 'owner' }, true],
    [{ role: 'staff' }, false],
    [{ role: 'customer' }, false],
    [{}, false],
    [null, false],
  ])('%j → látja: %s', (user, expected) => {
    expect(audit.latjaAMuveletnaplot(user)).toBe(expected)
  })

  it('a link a Műveletnapló listájára visz, entityType + entityId szűrővel', () => {
    const href = audit.auditLogHref('/admin', 'pages', 1)
    const url = new URL(href, 'http://x')
    expect(url.pathname).toBe('/admin/collections/audit-logs')
    expect(url.searchParams.get('where[or][0][and][0][entityType][equals]')).toBe('pages')
    expect(url.searchParams.get('where[or][0][and][1][entityId][equals]')).toBe('1')
  })

  it('renderelés: tulajdonosnak megjelenik, munkatársnak nem (a napló access-e változatlan)', () => {
    allapot.user = { id: 1, role: 'owner' }
    const owner = renderToStaticMarkup(createElement(allapotMod.ElonezetAllapot))
    expect(owner).toContain(audit.AUDIT_LINK_FELIRAT)
    expect(owner).toContain('/admin/collections/audit-logs?')
    allapot.user = { id: 2, role: 'staff' }
    const staff = renderToStaticMarkup(createElement(allapotMod.ElonezetAllapot))
    expect(staff).not.toContain('Műveletnapló')
    expect(renderToStaticMarkup(createElement(audit.DocAuditLink))).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Előnézet gomb
// ---------------------------------------------------------------------------

describe('ElonezetGomb: látható felirat, új lap, piszkozat-URL (R1 #10)', () => {
  it('a Payload előnézeti URL-je az elsődleges', () => {
    expect(
      gomb.elonezetHref(
        'http://localhost:3100/next/preview?collection=pages&slug=rolunk',
        'pages',
        'x',
      ),
    ).toBe('http://localhost:3100/next/preview?collection=pages&slug=rolunk')
  })

  it('tartalék: relatív út a webcímből, ugyanazzal a szűréssel, mint a route', () => {
    expect(gomb.elonezetHref(undefined, 'pages', 'kezdolap')).toBe(
      '/next/preview?collection=pages&slug=kezdolap',
    )
    expect(gomb.elonezetHref('', 'posts', 'kezfajdalom')).toBe(
      '/next/preview?collection=posts&slug=kezfajdalom',
    )
    expect(gomb.elonezetHref(undefined, 'pages', '//evil.example')).toBeNull()
    expect(gomb.elonezetHref(undefined, 'pages', '')).toBeNull()
    expect(gomb.elonezetHref(undefined, 'media', 'x')).toBeNull()
  })

  it('renderelés: látható „Előnézet”, a név vele kezdődik, új lapon nyílik', () => {
    allapot.previewURL = 'http://localhost:3100/next/preview?collection=pages&slug=rolunk'
    allapot.fields = { slug: { value: 'rolunk' } }
    const html = renderToStaticMarkup(createElement(gomb.ElonezetGomb))
    expect(html).toMatch(/>Előnézet</)
    expect(html).toContain('aria-label="Előnézet (új lapon nyílik)"')
    expect(gomb.ELONEZET_NEV.startsWith(gomb.ELONEZET_FELIRAT)).toBe(true)
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain(
      'href="http://localhost:3100/next/preview?collection=pages&amp;slug=rolunk"',
    )
    expect(html).toContain('aria-hidden="true"')
  })

  it('friss gépelés, mentetlen vagy épp mentődő változás mellett megvárja a mentést', () => {
    const most = 100_000
    // A Lexical a gépelést ~500 ms-on belül adja át az űrlapnak: addig a
    // „modified” még hamis, a gépelés ideje dönt.
    expect(gomb.varniKell(most, most - 100, false, false)).toBe(true)
    expect(gomb.varniKell(most, most - gomb.FRISS_GEPELES_MS - 1, false, false)).toBe(false)
    expect(gomb.varniKell(most, 0, true, false)).toBe(true)
    expect(gomb.varniKell(most, 0, false, true)).toBe(true)
    expect(gomb.varniKell(most, 0, false, false)).toBe(false)
    expect(gomb.MENTESRE_VAR_MS).toBeGreaterThan(2000)
  })

  /** Böngésző-ablak csonk: a tesztből sem nyílik lap, sem navigáció nem indul. */
  function ablakCsonk(ujLap: unknown, megerosit = false) {
    const assign = vi.fn()
    const open = vi.fn(() => ujLap)
    const confirm = vi.fn(() => megerosit)
    vi.stubGlobal('window', {
      open,
      confirm,
      location: { assign },
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    })
    return { assign, open, confirm }
  }

  const kattintas = () => ({
    button: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
  })

  it('letiltott új lapnál mentetlen változással NEM navigál el azonnal (a gomb kezelője)', () => {
    vi.useFakeTimers()
    const { assign, open, confirm } = ablakCsonk(null)
    allapot.previewURL = 'http://localhost:3100/next/preview?collection=pages&slug=rolunk'
    allapot.fields = { slug: { value: 'rolunk' } }
    allapot.modified = true
    renderToStaticMarkup(createElement(gomb.ElonezetGomb))
    const onClick = gombExtraProps?.onClick
    expect(typeof onClick).toBe('function')
    const esemeny = kattintas()
    ;(onClick as (e: unknown) => void)(esemeny)
    expect(esemeny.preventDefault).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledTimes(1)
    // A régi hiba: itt azonnal window.location.assign futott.
    expect(assign).not.toHaveBeenCalled()
    vi.advanceTimersByTime(gomb.MENTESRE_VAR_MS - gomb.VARAKOZAS_LEPES_MS)
    expect(assign).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
    // A mentés a várakozási idő alatt sem ért véget: kérdez, és nemleges
    // válaszra a szerkesztő marad (semmi nem vész el).
    vi.advanceTimersByTime(gomb.VARAKOZAS_LEPES_MS * 2)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm).toHaveBeenCalledWith(gomb.MENTETLEN_KERDES)
    expect(assign).not.toHaveBeenCalled()
  })

  it('letiltott új lapnál a mentés végét megvárja, és csak utána nyit ezen a lapon', () => {
    vi.useFakeTimers()
    const { assign, confirm } = ablakCsonk(null)
    let modositott = true
    let mentes = false
    const href = '/next/preview?collection=pages&slug=rolunk'
    gomb.elonezetMegnyitasa(href, () => modositott || mentes)
    vi.advanceTimersByTime(1000)
    expect(assign).not.toHaveBeenCalled()
    // Az automatikus mentés elindul: a módosítás már nem „mentetlen”, de fut a mentés.
    modositott = false
    mentes = true
    vi.advanceTimersByTime(1000)
    expect(assign).not.toHaveBeenCalled()
    // A mentés véget ért: a következő ellenőrzésnél nyit, egyszer.
    mentes = false
    vi.advanceTimersByTime(gomb.VARAKOZAS_LEPES_MS)
    expect(assign).toHaveBeenCalledTimes(1)
    expect(assign).toHaveBeenCalledWith(href)
    vi.advanceTimersByTime(gomb.MENTESRE_VAR_MS)
    expect(assign).toHaveBeenCalledTimes(1)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('letiltott új lapnál, ha a mentés nem ér véget, csak megerősítésre nyit', () => {
    vi.useFakeTimers()
    const { assign, confirm } = ablakCsonk(null, true)
    gomb.elonezetMegnyitasa('/next/preview?collection=posts&slug=x', () => true)
    vi.advanceTimersByTime(gomb.MENTESRE_VAR_MS + gomb.VARAKOZAS_LEPES_MS)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(assign).toHaveBeenCalledTimes(1)
  })

  it('új lap nyílhat: a szerkesztő marad, az új lap a mentés után kapja a címet', () => {
    vi.useFakeTimers()
    const ujLap = {
      opener: {} as unknown,
      document: { documentElement: { lang: '' }, title: '', body: { textContent: '' } },
      location: { href: 'about:blank' },
    }
    const { assign } = ablakCsonk(ujLap)
    let varni = true
    const href = '/next/preview?collection=pages&slug=rolunk'
    gomb.elonezetMegnyitasa(href, () => varni)
    expect(ujLap.opener).toBeNull()
    expect(ujLap.document.body.textContent).toBe(gomb.VARAKOZO_SZOVEG)
    vi.advanceTimersByTime(1000)
    expect(ujLap.location.href).toBe('about:blank')
    varni = false
    vi.advanceTimersByTime(gomb.VARAKOZAS_LEPES_MS)
    expect(ujLap.location.href).toBe(href)
    expect(assign).not.toHaveBeenCalled()
  })

  it('mentetlen dokumentumon (nincs azonosító) nincs gomb', () => {
    allapot.doc = { collectionSlug: 'pages', hasPublishedDoc: false, unpublishedVersionCount: 0 }
    allapot.fields = { slug: { value: 'uj-oldal' } }
    expect(renderToStaticMarkup(createElement(gomb.ElonezetGomb))).toBe('')
  })
})

// ---------------------------------------------------------------------------
// 2. kör: megosztási kép (H47), a kezdőlap nem szekció részei (H35, H39),
// oszlopválasztó (a B-1 kérése), szerzői adatlap (H52)
// ---------------------------------------------------------------------------

const forrasFajl = (ut: string): string =>
  readFileSync(fileURLToPath(new URL(ut, import.meta.url)), 'utf8')

describe('H47: a megosztási kép tartalékláncának súgója a seo.ts szerint', () => {
  const kep = (nev: string) =>
    ({ id: 1, alt: `${nev} leírása`, url: `/api/media/file/${nev}.jpg` }) as never

  it('a lánc: Megosztási kép → Fejléckép (Borítókép) → a Kineticare alapképe', async () => {
    const seo = await import('../lib/seo')
    const og = seo.resolveOgImageUrl({ title: 'x', ogImage: kep('og'), heroImage: kep('hero') })
    expect(og).toMatch(/\/api\/media\/file\/og\.jpg$/)
    const hero = seo.resolveOgImageUrl({ title: 'x', heroImage: kep('hero') })
    expect(hero).toMatch(/\/api\/media\/file\/hero\.jpg$/)
    expect(seo.resolveOgImageUrl({ title: 'x' })).toBeUndefined()
    // Üres láncnál a metaadat az alapképre esik vissza (/opengraph-image).
    const meta = seo.buildPageMetadata({ title: 'x' }, '/x')
    const kepek = meta.openGraph?.images
    const elso = Array.isArray(kepek) ? kepek[0] : kepek
    expect(isRec(elso) ? elso.url : elso).toBe(seo.DEFAULT_OG_IMAGE.url)
    expect(seo.DEFAULT_OG_IMAGE.url).toMatch(/\/opengraph-image$/)
    // A kezdőlap ága ugyanezt a láncot kapja (buildHomeMetadata).
    const home = seo.buildHomeMetadata({ title: 'Kezdőlap', heroImage: kep('hero') })
    const homeKepek = home.openGraph?.images
    const homeElso = Array.isArray(homeKepek) ? homeKepek[0] : homeKepek
    expect(String(isRec(homeElso) ? homeElso.url : homeElso)).toMatch(/hero\.jpg$/)
  })

  it('a Kapcsolat ága is ezt a láncot használja, az alapkép a csapatfotó', () => {
    expect(forrasFajl('../app/(frontend)/kapcsolat/page.tsx')).toContain(
      'const image = page ? resolveOgImageUrl(page) : undefined',
    )
    const ogKep = forrasFajl('../app/opengraph-image.tsx')
    expect(ogKep).toContain(
      "path.join(PUBLIC_DIR, 'media', 'team', 'founders-intro-white-1600.webp')",
    )
  })

  it('a Pages és a Posts leírásai betűre ugyanazt a láncot mondják (SC 3.2.4)', () => {
    const lanc = (tartalek: string) =>
      `Ha üres, a ${tartalek}, annak híján a Kineticare alapképe (csapatfotó) látszik.`
    expect(String(adminOf(byName(Pages.fields, 'ogImage')).description)).toContain(
      lanc('Fejléckép'),
    )
    expect(String(adminOf(byName(Posts.fields, 'ogImage')).description)).toContain(
      lanc('Borítókép'),
    )
    expect(String(adminOf(byName(Pages.fields, 'heroImage')).description)).toContain(
      'Ha a Megosztási kép üres, ez látszik a Facebook- és a Messenger-előnézetben; ha ez is üres, a Kineticare alapképe (csapatfotó).',
    )
    expect(String(adminOf(byName(Posts.fields, 'heroImage')).description)).toContain(
      'Ha a Megosztási kép üres, megosztáskor is ez látszik; ha ez is üres, a Kineticare alapképe (csapatfotó).',
    )
  })
})

describe('H35, H39: a kezdőlap nem szekció részei és a teljes törlés (nyitható rész)', () => {
  const kezdolapSorok = [
    { blockType: 'filmHero', lathato: true },
    { blockType: 'faq', lathato: true },
  ]

  it('csak a kezdőlapon van két pont; a bekezdések száma nem nő', () => {
    const kezdo = notice.hazaTajekoztato('kezdolap', kezdolapSorok, 'Nyitó videó')
    expect(kezdo.pontok).toEqual([notice.NEM_SZEKCIO_PONT, notice.MINDEN_SZEKCIO_TORLESE_PONT])
    expect(kezdo.bekezdesek.length).toBeLessThanOrEqual(4)
    for (const slug of ['kapcsolat', 'rolunk', 'szakembereknek']) {
      expect(notice.hazaTajekoztato(slug, kezdolapSorok, 'x').pontok, slug).toBeUndefined()
    }
    for (const pont of kezdo.pontok ?? []) {
      expect(tipografiaiHibak(pont)).toEqual([])
      expect(mondatok(pont)).toBe(1)
    }
  })

  it('a nem szekció részek mondata a kódhoz kötve: Menüpontok, lábléc, Barion-sáv', async () => {
    const { Menus } = await import('../collections/Menus')
    expect(Menus.labels?.plural).toBe(notice.MENUPONTOK_NEV)
    expect(forrasFajl('../components/layout/Header.tsx')).toContain(
      "import { getNavTree } from '../../lib/menus'",
    )
    expect(forrasFajl('../lib/menus.ts')).toContain("collection: 'menus'")
    expect(forrasFajl('../components/checkout/BarionFizetesJelzes.tsx')).toContain(
      `export const BARION_CIM = '${notice.BARION_SAV_CIM}'`,
    )
    // A szekciós kezdőlapon a Barion-sáv a RenderBlocks UTÁN, a kódban áll.
    expect(forrasFajl('../components/content/HomeView.tsx')).toMatch(
      /<RenderBlocks[\s\S]*?\/>\s*<BarionFizetesJelzes hely="kezdolap" \/>/,
    )
    expect(notice.NEM_SZEKCIO_PONT).toContain(`a ${notice.MENUPONTOK_NEV} között írod át`)
    expect(notice.NEM_SZEKCIO_PONT).toContain(`„${notice.BARION_SAV_CIM}” sávot`)
  })

  it('a teljes törlés mondata a HomeView tartalékához és a home-seed visszaírásához kötve', () => {
    // Üres szekciósor: a HomeView a beépített alapváltozatot rajzolja.
    expect(forrasFajl('../components/content/HomeView.tsx')).toContain('if (layout.length > 0) {')
    // Induláskor az onInit → ensureHomeBaseline → ensureHomeLayout üres sornál visszaír.
    const config = forrasFajl('../payload.config.ts')
    expect(config).toMatch(
      /async function onInit\(payload: Payload\)[\s\S]*?await ensureHomeBaseline\(payload\)/,
    )
    expect(config).toMatch(
      /async function ensureHomeBaseline[\s\S]*?await ensureHomeLayoutFrissTelepitesen\(payload, mediaIds\)/,
    )
    // A 2026-09-23-i A8 óta a seed csak teljesen üres Oldalak-gyűjteménynél ír:
    // a törölt szekciók maguktól nem kerülnek vissza, ezt mondja a doboz is.
    const seed = forrasFajl('../lib/home-seed.ts')
    expect(seed).toMatch(
      /ensureHomeLayoutFrissTelepitesen[\s\S]*?if \(oldalak > 0\) \{[\s\S]*?return/,
    )
    expect(notice.MINDEN_SZEKCIO_TORLESE_PONT).toContain('közzéteszed')
    expect(notice.MINDEN_SZEKCIO_TORLESE_PONT).toContain('maguktól nem kerülnek vissza')
    expect(notice.MINDEN_SZEKCIO_TORLESE_PONT).toContain('Verziók fülön')
  })

  it('renderelés: a nyitógomb a linksorban, aria-expanded="false", a rész rejtve, benne a Menüpontok link', () => {
    allapot.fields = {
      slug: { value: 'kezdolap' },
      'layout.0.blockType': { value: 'filmHero' },
    }
    const html = renderToStaticMarkup(createElement(notice.HomePageEditNotice, {}))
    expect(html).toMatch(
      /<ul class="kc-admin-notice__linkek">[\s\S]*Ugrás a Szekciókhoz[\s\S]*<button aria-controls="([^"]+)" aria-expanded="false"[^>]*type="button">[\s\S]*Fejléc, lábléc és a szekciók törlése<\/button>/,
    )
    const id = /aria-controls="([^"]+)"/.exec(html)?.[1] ?? ''
    expect(html).toContain(`hidden="" id="${id}"`)
    expect(html).toContain('href="/admin/collections/menus"')
    expect(html).toContain('Menüpontok (a fejléc menüje)')
    // Más oldalon nincs nyitható rész.
    allapot.fields = { slug: { value: 'rolunk' }, 'layout.0.blockType': { value: 'about' } }
    expect(renderToStaticMarkup(createElement(notice.HomePageEditNotice, {}))).not.toContain(
      'aria-expanded',
    )
  })
})

describe('Oszlopválasztó: a tájékoztató ui-mezők és a rejtett mezők nem oszlopok (a B-1 kérése)', () => {
  it.each([
    ['pages', Pages],
    ['posts', Posts],
  ] as const)('%s: minden ui-mező disableListColumn, kivéve a „Mi ez” oszlopot', (_n, c) => {
    // A gyűjtemény saját (gyökér- és fül-szintű) ui-mezői; a blokkok belsejében
    // álló ui-mezők nem listaoszlop-jelöltek, azok a blokkfájlok gazdájáé.
    const ui = flatFields(c.fields).filter((f) => f.type === 'ui')
    expect(ui.length).toBeGreaterThanOrEqual(4)
    for (const field of ui) {
      const nev = 'name' in field ? field.name : ''
      if (nev === 'oldalFajta') continue
      expect(adminOf(field).disableListColumn, nev).toBe(true)
    }
    for (const nev of ['status', 'order']) {
      const admin = adminOf(byName(c.fields, nev))
      expect(admin.hidden, nev).toBe(true)
      expect(admin.disableListColumn, nev).toBe(true)
    }
  })

  it('pages: a „Mi ez” oszlop cellás ui-mező, a listában a cím után', () => {
    const mezo = byName(Pages.fields, 'oldalFajta')
    expect(mezo.type).toBe('ui')
    expect('label' in mezo ? mezo.label : undefined).toBe('Mi ez')
    const components = adminOf(mezo).components
    expect(isRec(components) ? components.Cell : undefined).toBe(
      '/components/admin/PageKindCell#PageKindCell',
    )
    expect(isRec(components) ? components.Field : undefined).toBeUndefined()
    expect(adminOf(mezo).disableListColumn).toBeUndefined()
    expect(Pages.admin?.defaultColumns?.slice(0, 2)).toEqual(['title', 'oldalFajta'])
  })

  it('pages: a fő oldalak gyorslinkje a lista fölött (az A-1 komponense, a kérése szerint)', () => {
    expect(Pages.admin?.components?.beforeListTable).toEqual([
      '/components/admin/GyakoriTeendok#FoOldalakGyorslinkjei',
    ])
  })
})

describe('H52: a szerző adatlapjára vivő link (AuthorProfileLink)', () => {
  it('a felirat csak annak mondja, hogy „itt írod át”, aki átírhatja (canUpdateUser tükre)', async () => {
    const szerzo = await import('../components/admin/AuthorProfileLink')
    expect(szerzo.atirhatja({ id: 5, role: 'owner' }, '1')).toBe(true)
    expect(szerzo.atirhatja({ id: 1, role: 'staff' }, '1')).toBe(true)
    expect(szerzo.atirhatja({ id: 2, role: 'staff' }, '1')).toBe(false)
    expect(szerzo.atirhatja(null, '1')).toBe(false)
    expect(szerzo.adatlapFelirat('Kocsis Kata', true)).toEqual({
      link: 'A szerzői doboz szövegét itt írod át: Kocsis Kata adatlapja (új lapon)',
      megjegyzes: null,
    })
    const mas = szerzo.adatlapFelirat('Kiss Kata', false)
    expect(mas.link).toBe('A szerzői doboz szövege itt van: Kiss Kata adatlapja (új lapon)')
    expect(mas.megjegyzes).toBe('Átírni a tulajdonos vagy a szerző maga tudja.')
    expect(szerzo.adatlapFelirat(null, true).link).toContain('a kiválasztott munkatárs adatlapja')
    expect(szerzo.adatlapHref('/admin/', '7')).toBe('/admin/collections/users/7')
    expect(szerzo.szerzoAzonosito(3)).toBe('3')
    expect(szerzo.szerzoAzonosito({ id: 4 })).toBe('4')
    expect(szerzo.szerzoAzonosito(null)).toBeNull()
    for (const sz of [szerzo.adatlapFelirat('A', true), mas]) {
      expect(tipografiaiHibak(`${sz.link} ${sz.megjegyzes ?? ''}`)).toEqual([])
    }
    // Az írási szabály (NEM módosítjuk): tulajdonos mindent, munkatárs magát és a vásárlókat.
    const szabaly = forrasFajl('../access/users-update.ts')
    expect(szabaly).toMatch(/if \(hasOwnerRole\(req\.user\)\) \{\s*return true/)
    expect(szabaly).toMatch(
      /\{ id: \{ equals: req\.user\.id \} \},\s*\{ role: \{ equals: 'customer' \} \},/,
    )
  })

  it('renderelés: a Szerző kiválasztva → új lapon nyíló link az adatlapra; üresen semmi', async () => {
    const szerzo = await import('../components/admin/AuthorProfileLink')
    allapot.fields = { author: { value: 1 } }
    const html = renderToStaticMarkup(createElement(szerzo.AuthorProfileLink))
    expect(html).toContain('href="/admin/collections/users/1"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('A szerzői doboz szövegét itt írod át:')
    allapot.fields = {}
    expect(renderToStaticMarkup(createElement(szerzo.AuthorProfileLink))).toBe('')
  })

  it.each([
    ['pages', Pages],
    ['posts', Posts],
  ] as const)('%s: a link ui-mező közvetlenül a Szerző alatt, az oldalsávban', (_n, c) => {
    const nevek = names(c.fields)
    expect(nevek[nevek.indexOf('author') + 1]).toBe('szerzoAdatlap')
    const mezo = byName(c.fields, 'szerzoAdatlap')
    expect(adminOf(mezo).position).toBe('sidebar')
    const components = adminOf(mezo).components
    expect(isRec(components) ? components.Field : undefined).toBe(
      '/components/admin/AuthorProfileLink#AuthorProfileLink',
    )
  })
})
