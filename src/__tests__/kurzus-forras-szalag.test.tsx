import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildCourseSalesContent,
  type CourseFactsInput,
  type CourseSalesContentForrassal,
} from '../components/courses/sales-content'
import {
  AKCIOS_MEGJELENES_DOBOZ,
  AR_ES_HOZZAFERES_FUL,
  elesbenAkciosElrendezes,
  KURZUS_MEZOK,
  KURZUSOLDAL_FUL,
  kurzusForrasSzalagok,
  NEKED_VALO_LINK,
  NEKED_VALO_LISTA,
  NEM_JAVASOLJUK_LINK,
  NEM_JAVASOLJUK_LISTA,
  SZAKASZ_CIMEK,
  TANANYAG_FUL,
  type KurzusForrasSzalagok,
  type KurzusSzalagTermek,
} from '../components/editor/frontend/kurzus-forras-szalag'
import {
  KurzusAkciosSzalag,
  KurzusOldalForrasSzalag,
  KurzusSzakaszForrasSzalag,
} from '../components/editor/frontend/KurzusForrasSzalag'
import type { Product } from '../payload-types'

/**
 * A kurzusoldal forrás-szalagjainak őre (modul-térkép H50/A19).
 *
 * 1. A sales-content forrás-metaadata: külön mező, a leírás kulcsszavas
 *    címsora, beépített tartalék; a meglévő kimenet mezői változatlanok.
 * 2. A szalagok: minden forrás-eset, a `?mezo=<pontos mezőnév>` link, nincs
 *    szakasz → nincs szalag, akciós figyelmeztetés csak élő akciónál.
 * 3. A mező- és fülnevek BETŰRE az admin feliratai (forrás-olvasás az
 *    ecommerce.ts-ből és a course-modules.ts-ből; WCAG 2.2 SC 3.2.4).
 * 4. Tipográfia: nincs töltelék gondolatjel (– —).
 * 5. A route: a szalagok CSAK `isPreview` mellett, a látogatói kimenetben
 *    nyomuk sincs; a JSON-LD a kapcsolati e-mailt viszi.
 */

const gyoker = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const forras = (utvonal: string): string => readFileSync(join(gyoker, utvonal), 'utf8')

// ---------------------------------------------------------------------------
// Lexical-fixtúrák
// ---------------------------------------------------------------------------

type Csomopont = Record<string, unknown>
const szoveg = (text: string): Csomopont => ({ type: 'text', text })
const cimsor = (text: string, tag = 'h2'): Csomopont => ({
  type: 'heading',
  tag,
  children: [szoveg(text)],
})
const bekezdes = (text: string): Csomopont => ({ type: 'paragraph', children: [szoveg(text)] })
const lista = (...sorok: string[]): Csomopont => ({
  type: 'list',
  children: sorok.map((sor) => ({ type: 'listitem', children: [szoveg(sor)] })),
})
const leiras = (...children: Csomopont[]): Product['longDescription'] =>
  ({
    root: { type: 'root', children, direction: null, format: '', indent: 0, version: 1 },
  }) as unknown as Product['longDescription']

const facts: CourseFactsInput = {
  moduleCount: 2,
  lessonCount: 5,
  accessDurationDays: null,
  free: false,
  hasPreview: false,
}

const KINEK_CIMSOR = 'Ez a program tökéletes számodra, ha…'
const NEM_CIMSOR = 'Nem javasoljuk a programot, ha…'
const GARANCIA_CIMSOR = '30 napos kipróbálási garancia'
const GYIK_CIMSOR = 'Kérdések, amik talán felmerültek benned'

/** Régi, egyben írt leírás: minden kiemelt szakasz a címsorai alól jön. */
function reginLeiras(): Product['longDescription'] {
  return leiras(
    bekezdes('Bevezető szöveg a kurzusról.'),
    cimsor(KINEK_CIMSOR),
    lista('Fáj a csuklód gépelés közben', 'Otthon gyakorolnál'),
    cimsor(NEM_CIMSOR),
    lista('Friss műtét után vagy'),
    cimsor(GARANCIA_CIMSOR),
    bekezdes('Ha nem vagy elégedett, visszaadjuk az árát.'),
    cimsor(GYIK_CIMSOR),
    cimsor('Mennyi ideig érem el?', 'h3'),
    bekezdes('Örökre.'),
  )
}

type SalesTermek = Parameters<typeof buildCourseSalesContent>[0]
const ures: SalesTermek = {
  longDescription: null,
  salesHighlights: null,
  howItWorks: null,
  fitFor: null,
  notFitFor: null,
  guaranteeTitle: null,
  guaranteeText: null,
  faq: null,
}

const kitoltott: SalesTermek = {
  longDescription: leiras(bekezdes('Csak bevezető.')),
  salesHighlights: [{ text: 'Örökös hozzáférés' }],
  howItWorks: [{ title: 'Megveszed', text: 'Bankkártyával.' }],
  fitFor: [{ text: 'Otthon gyakorolnál' }],
  notFitFor: [{ text: 'Friss műtét után vagy' }],
  guaranteeTitle: '30 napos garancia',
  guaranteeText: 'Visszaadjuk az árát.',
  faq: [{ question: 'Meddig érem el?', answer: 'Örökre.' }],
}

const termek: KurzusSzalagTermek = {
  id: 12,
  displayTitle: 'Kéztorna otthon',
  sku: 'KT-01',
  status: 'published',
  _status: 'draft',
  priceInHUFEnabled: true,
  priceInHUF: 19900,
  promoEnabled: false,
}

const AKTIV_AKCIO = {
  promoEnabled: true,
  promoPriceHuf: 9900,
  promoStart: '2020-01-01T00:00:00.000Z',
  promoEnd: '2099-12-31T00:00:00.000Z',
}
const MOST = new Date('2026-09-23T10:00:00.000Z')

function szalagok(
  sales: CourseSalesContentForrassal,
  extra: Partial<Parameters<typeof kurzusForrasSzalagok>[0]> = {},
): KurzusForrasSzalagok {
  return kurzusForrasSzalagok({ product: termek, sales, now: MOST, ...extra })
}

/** Az összes szöveg egy objektumban (a tipográfia-őrhöz). */
function szovegek(ertek: unknown): string[] {
  if (typeof ertek === 'string') return [ertek]
  if (Array.isArray(ertek)) return ertek.flatMap(szovegek)
  if (typeof ertek === 'object' && ertek !== null) return Object.values(ertek).flatMap(szovegek)
  return []
}

// ---------------------------------------------------------------------------
// 1. sales-content: forrás-metaadat
// ---------------------------------------------------------------------------

describe('buildCourseSalesContent — forrás-metaadat', () => {
  it('kitöltött mezőknél minden szakasz a saját mezőjéből jön', () => {
    const { forrasok } = buildCourseSalesContent(kitoltott, facts)
    expect(forrasok).toEqual({
      leiras: { mezo: 'longDescription', cimsor: null, tartalek: false },
      lepesek: { mezo: 'howItWorks', cimsor: null, tartalek: false },
      kinekValo: { mezo: 'fitFor', cimsor: null, tartalek: false },
      kinekNem: { mezo: 'notFitFor', cimsor: null, tartalek: false },
      garancia: { mezo: 'guaranteeTitle', cimsor: null, tartalek: false },
      gyik: { mezo: 'faq', cimsor: null, tartalek: false },
      elonyok: { mezo: 'salesHighlights', cimsor: null, tartalek: false },
    })
  })

  it('üres mezőknél a leírás kulcsszavas címsorát nevezi meg', () => {
    const { forrasok } = buildCourseSalesContent({ ...ures, longDescription: reginLeiras() }, facts)
    expect(forrasok.kinekValo).toEqual({
      mezo: 'longDescription',
      cimsor: KINEK_CIMSOR,
      tartalek: false,
    })
    expect(forrasok.kinekNem.cimsor).toBe(NEM_CIMSOR)
    expect(forrasok.garancia.cimsor).toBe(GARANCIA_CIMSOR)
    expect(forrasok.gyik.cimsor).toBe(GYIK_CIMSOR)
    expect(forrasok.lepesek).toEqual({ mezo: 'howItWorks', cimsor: null, tartalek: true })
    // A törzs első felsorolása a kiemelt szakaszokkal együtt kikerült: tényadat-tartalék.
    expect(forrasok.elonyok).toEqual({ mezo: 'salesHighlights', cimsor: null, tartalek: true })
  })

  it('a pipás sorok a leírás első felsorolásából: a forrás a Részletes leírás', () => {
    const { forrasok, highlights } = buildCourseSalesContent(
      { ...ures, longDescription: leiras(lista('Első előny', 'Második előny')) },
      facts,
    )
    expect(highlights).toEqual(['Első előny', 'Második előny'])
    expect(forrasok.elonyok).toEqual({ mezo: 'longDescription', cimsor: null, tartalek: false })
  })

  it('ingyenes kurzuson nincs garancia, a forrás a mező (nem a leírás)', () => {
    const tartalom = buildCourseSalesContent(
      { ...ures, longDescription: reginLeiras() },
      { ...facts, free: true },
    )
    expect(tartalom.guarantee).toBeNull()
    expect(tartalom.forrasok.garancia).toEqual({
      mezo: 'guaranteeTitle',
      cimsor: null,
      tartalek: false,
    })
  })

  it('a meglévő kimenet mezői változatlanok (csak a `forrasok` új)', () => {
    const tartalom = buildCourseSalesContent({ ...ures, longDescription: reginLeiras() }, facts)
    expect(Object.keys(tartalom).sort()).toEqual(
      ['highlights', 'steps', 'fitFor', 'notFitFor', 'guarantee', 'faq', 'body', 'forrasok'].sort(),
    )
    expect(tartalom.fitFor).toEqual(['Fáj a csuklód gépelés közben', 'Otthon gyakorolnál'])
    expect(tartalom.guarantee).toEqual({
      title: GARANCIA_CIMSOR,
      text: 'Ha nem vagy elégedett, visszaadjuk az árát.',
    })
  })
})

// ---------------------------------------------------------------------------
// 2. A szalagok
// ---------------------------------------------------------------------------

describe('kurzusForrasSzalagok — forrás-esetek', () => {
  it('külön mező kitöltve: a mezőt és a fület nevezi meg, a link a mezőre visz', () => {
    const s = szalagok(buildCourseSalesContent(kitoltott, facts), {
      tananyag: 'modulok',
      galeria: true,
    })
    expect(s.szakaszok['hogyan-mukodik']).toMatchObject({
      cimke: '„Hogyan működik?” szakasz',
      forrasMondat: 'A Kurzusoldal fül „Hogyan működik? (lépések)” mezőjéből.',
      tartalek: false,
      link: {
        felirat: 'Szerkesztem',
        href: '/admin/collections/products/12?mezo=howItWorks',
        rejtettKontextus:
          ': „Hogyan működik?” szakasz, Kurzusoldal fül, Hogyan működik? (lépések) mező',
      },
      masodikLink: null,
    })
    expect(s.szakaszok.garancia?.forrasMondat).toBe(
      'A Kurzusoldal fül „Garancia címe” és „Garancia szövege” mezőjéből.',
    )
    expect(s.szakaszok.garancia?.link.href).toBe(
      '/admin/collections/products/12?mezo=guaranteeTitle',
    )
    expect(s.szakaszok.gyik?.link.href).toBe('/admin/collections/products/12?mezo=faq')
    expect(s.szakaszok.tananyag).toMatchObject({
      forrasMondat: 'A Tananyag fül „Tananyag (modulok)” mezőjéből.',
      link: { href: '/admin/collections/products/12?mezo=modules' },
    })
    expect(s.szakaszok.galeria?.link.href).toBe('/admin/collections/products/12?mezo=gallery')
    // A két lista két külön mezőből: két link, két KÜLÖN felirattal (SC 2.4.4).
    expect(s.szakaszok['kinek-valo']).toMatchObject({
      forrasMondat: `A „${NEKED_VALO_LISTA}” lista a Kurzusoldal fül „Kinek való (pipás lista)” mezőjéből jön. A „${NEM_JAVASOLJUK_LISTA}” lista a Kurzusoldal fül „Kinek nem való” mezőjéből jön.`,
      link: { felirat: NEKED_VALO_LINK, href: '/admin/collections/products/12?mezo=fitFor' },
      masodikLink: {
        felirat: NEM_JAVASOLJUK_LINK,
        href: '/admin/collections/products/12?mezo=notFitFor',
      },
    })
    expect(s.szakaszok['mi-ez']?.forrasMondat).toBe(
      'A Kurzusoldal fül „Részletes leírás” mezőjéből.',
    )
  })

  it('kulcsszavas címsorból kivágva: a címsort idézi, a leírásra visz, és megmondja a teendőt', () => {
    const s = szalagok(buildCourseSalesContent({ ...ures, longDescription: reginLeiras() }, facts))
    expect(s.szakaszok.garancia).toMatchObject({
      forrasMondat: `A Részletes leírás „${GARANCIA_CIMSOR}” címsora alól. Ha a „Garancia címe” és a „Garancia szövege” mezőt is kitöltöd, azok látszanak helyette.`,
      link: { href: '/admin/collections/products/12?mezo=longDescription' },
    })
    expect(s.szakaszok.gyik?.forrasMondat).toBe(
      `A Részletes leírás „${GYIK_CIMSOR}” címsora alól. Ha a „Gyakori kérdések (GYIK)” mezőt kitöltöd, az látszik helyette.`,
    )
    // Mindkét lista a leírásból: egy link, a szokásos „Szerkesztem” felirattal.
    expect(s.szakaszok['kinek-valo']).toMatchObject({
      link: { felirat: 'Szerkesztem', href: '/admin/collections/products/12?mezo=longDescription' },
      masodikLink: null,
    })
    expect(s.szakaszok['kinek-valo']?.forrasMondat).toContain(`„${KINEK_CIMSOR}” címsora alól jön`)
    // A „A kurzusról” szalag megnevezi a kivágott címsorokat.
    expect(s.szakaszok['mi-ez']?.forrasMondat).toBe(
      `A Kurzusoldal fül „Részletes leírás” mezőjéből. Ezek a címsorok a hozzájuk tartozó szöveggel együtt lejjebb, külön szakaszban látszanak: „${KINEK_CIMSOR}”, „${NEM_CIMSOR}”, „${GARANCIA_CIMSOR}”, „${GYIK_CIMSOR}”.`,
    )
  })

  it('egyetlen kivágott címsornál egyes számban szól', () => {
    const s = szalagok(
      buildCourseSalesContent(
        {
          ...kitoltott,
          fitFor: null,
          longDescription: reginLeiras(),
        },
        facts,
      ),
    )
    expect(s.szakaszok['mi-ez']?.forrasMondat).toBe(
      `A Kurzusoldal fül „Részletes leírás” mezőjéből. A „${KINEK_CIMSOR}” címsor a hozzá tartozó szöveggel együtt lejjebb, külön szakaszban látszik.`,
    )
  })

  it('üres mező: a beépített tartalékot mondja ki, figyelmeztető szalaggal', () => {
    const s = szalagok(buildCourseSalesContent(ures, facts))
    expect(s.szakaszok['hogyan-mukodik']).toMatchObject({
      forrasMondat:
        'A „Hogyan működik? (lépések)” mező üres, ezért a beépített 3 lépés látszik. Ha kitöltöd, a te lépéseid jelennek meg.',
      tartalek: true,
      link: { href: '/admin/collections/products/12?mezo=howItWorks' },
    })
    expect(s.oldal.jelzes).toBe(
      'A „Fő előnyök (pipás sorok)” mező üres, és a leírásban sincs felsorolás, ezért a vásárlódobozban a tananyag adataiból épített sorok látszanak.',
    )
    expect(s.oldal.linkek[1]?.href).toBe('/admin/collections/products/12?mezo=salesHighlights')
  })

  it('nincs szakasz → nincs szalag', () => {
    const s = szalagok(buildCourseSalesContent(ures, { ...facts, free: true }))
    expect(Object.keys(s.szakaszok)).toEqual(['hogyan-mukodik'])
    for (const id of ['mi-ez', 'galeria', 'tananyag', 'kinek-valo', 'garancia', 'gyik'] as const) {
      expect(s.szakaszok[id]).toBeUndefined()
    }
  })

  it('csak az egyik „kinek” lista van: a másikról kimondja, miért nem látszik', () => {
    const s = szalagok(
      buildCourseSalesContent({ ...ures, fitFor: [{ text: 'Otthon gyakorolnál' }] }, facts),
    )
    expect(s.szakaszok['kinek-valo']?.forrasMondat).toBe(
      `A „${NEKED_VALO_LISTA}” lista a Kurzusoldal fül „Kinek való (pipás lista)” mezőjéből jön. A „${NEM_JAVASOLJUK_LISTA}” lista nem látszik, mert a „Kinek nem való” mező üres, és a leírásban sincs ilyen címsor.`,
    )
    expect(s.szakaszok['kinek-valo']?.masodikLink?.href).toBe(
      '/admin/collections/products/12?mezo=notFitFor',
    )
  })

  it('régi videólista: a Videók mezőre visz, és megmondja, miért', () => {
    const s = szalagok(buildCourseSalesContent(ures, facts), { tananyag: 'regi' })
    expect(s.szakaszok.tananyag).toMatchObject({
      forrasMondat:
        'A Tananyag fül „Videók (régi, fejezet nélküli lista)” mezőjéből, mert a „Tananyag (modulok)” mezőben még nincs lecke.',
      link: { href: '/admin/collections/products/12?mezo=videos' },
    })
  })

  it('az oldal-szalag a kurzus szerkesztőjére visz, mező nélkül', () => {
    const s = szalagok(buildCourseSalesContent(kitoltott, facts), { adminRoute: '/kezelo/' })
    expect(s.oldal.cimke).toBe('Az egész kurzus: Kéztorna otthon')
    expect(s.oldal.linkek[0]).toEqual({
      felirat: 'Szerkesztem',
      rejtettKontextus: ': az egész kurzus, Kéztorna otthon',
      href: '/kezelo/collections/products/12',
    })
    expect(s.oldal.jelzes).toBe(
      'A vásárlódoboz pipás sorai a Kurzusoldal fül „Fő előnyök (pipás sorok)” mezőjéből jönnek.',
    )
  })

  it('minden link `?mezo=<pontos mezőnév>` alakú, és a mezőnév a szótárban van', () => {
    const esetek = [
      szalagok(buildCourseSalesContent(kitoltott, facts), { tananyag: 'modulok', galeria: true }),
      szalagok(buildCourseSalesContent({ ...ures, longDescription: reginLeiras() }, facts), {
        tananyag: 'regi',
        product: { ...termek, ...AKTIV_AKCIO },
      }),
    ]
    const linkek = esetek.flatMap((s) => [
      ...Object.values(s.szakaszok).flatMap((sz) =>
        sz ? [sz.link, ...(sz.masodikLink ? [sz.masodikLink] : [])] : [],
      ),
      ...s.oldal.linkek.slice(1),
      ...(s.akcios ? [s.akcios.link] : []),
    ])
    expect(linkek.length).toBeGreaterThan(10)
    for (const link of linkek) {
      const talalat = /^\/admin\/collections\/products\/12\?mezo=([A-Za-z]+)$/.exec(link.href)
      expect(talalat, link.href).not.toBeNull()
      expect(Object.keys(KURZUS_MEZOK)).toContain(talalat?.[1])
      expect(link.felirat.startsWith('Szerkesztem')).toBe(true)
      expect(link.rejtettKontextus.startsWith(': ')).toBe(true)
    }
  })
})

describe('kurzusForrasSzalagok — akciós figyelmeztetés', () => {
  it('élő akciónál megjelenik, a piszkozat (`_status: draft`) ellenére is', () => {
    const s = szalagok(buildCourseSalesContent(kitoltott, facts), {
      product: { ...termek, ...AKTIV_AKCIO },
    })
    expect(s.akcios).toEqual({
      cimke: 'Akciós elrendezés: az előnézet nem mutatja',
      szoveg:
        'Élesben ez a kurzus akciós elrendezésben jelenik meg, mert az akció most él. Az előnézet a normál elrendezést mutatja, az akciós oldalt a közzététel után, a kurzus nyilvános címén látod.',
      link: {
        felirat: 'Szerkesztem az akció beállításait',
        rejtettKontextus: ': Ár és hozzáférés fül, Akciós megjelenés',
        href: '/admin/collections/products/12?mezo=promoEnabled',
      },
    })
  })

  it.each([
    ['kikapcsolt akció', { ...termek }],
    ['lejárt akció', { ...termek, ...AKTIV_AKCIO, promoEnd: '2021-01-01T00:00:00.000Z' }],
    ['nem közzétett láthatóság', { ...termek, ...AKTIV_AKCIO, status: 'draft' as const }],
    ['ár nélkül', { ...termek, ...AKTIV_AKCIO, priceInHUFEnabled: false }],
  ])('nem akciós kurzusnál nincs: %s', (_nev, product) => {
    expect(szalagok(buildCourseSalesContent(kitoltott, facts), { product }).akcios).toBeNull()
    expect(elesbenAkciosElrendezes(product, MOST)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3. A nevek betűre az admin feliratai (SC 3.2.4)
// ---------------------------------------------------------------------------

describe('a mező- és fülnevek az admin feliratai', () => {
  const ecommerce = forras('plugins/ecommerce.ts')
  const tananyagMezo = forras('fields/course-modules.ts')

  it.each(Object.entries(KURZUS_MEZOK))('%s: név és felirat', (nev, { cimke }) => {
    const hely = nev === 'modules' ? tananyagMezo : ecommerce
    const minta = new RegExp(
      `name: '${nev}',\\s*type: '[a-zA-Z]+',(?:\\s*[a-zA-Z]+: [^\\n]+,)*?\\s*label: '${cimke.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`,
    )
    expect(hely).toMatch(minta)
  })

  it('a fülek és az akció-doboz felirata', () => {
    for (const ful of [KURZUSOLDAL_FUL, TANANYAG_FUL, AR_ES_HOZZAFERES_FUL]) {
      expect(ecommerce).toContain(`{ label: '${ful}', fields: [] as Field[] }`)
    }
    expect(ecommerce).toContain(`label: '${AKCIOS_MEGJELENES_DOBOZ}'`)
    // A fül-hozzárendelés: modules/videos a Tananyag (3), a promó-mezők az Ár és hozzáférés (1).
    expect(ecommerce).toMatch(/\['modules', 'videos'\]\.includes\(name \?\? ''\)\s*\?\s*3/)
    expect(ecommerce).toContain('coursePromoFieldNameSet.has(name)')
  })
})

// ---------------------------------------------------------------------------
// 4. Tipográfia és renderelés
// ---------------------------------------------------------------------------

describe('szövegek és renderelés', () => {
  const minden = [
    szalagok(buildCourseSalesContent(kitoltott, facts), { tananyag: 'modulok', galeria: true }),
    szalagok(buildCourseSalesContent({ ...ures, longDescription: reginLeiras() }, facts), {
      tananyag: 'regi',
      product: { ...termek, ...AKTIV_AKCIO },
    }),
    szalagok(buildCourseSalesContent({ ...ures, fitFor: [{ text: 'Sor' }] }, facts)),
  ]

  it('nincs töltelék gondolatjel (– —), az idézőjel magyar', () => {
    for (const s of szovegek(minden)) {
      expect(s).not.toMatch(/[–—]/)
      expect(s).not.toMatch(/"/)
    }
  })

  it('a szakasz-szalag a meglévő kc-szerkeszto-szalag osztályokkal, rejtett kontextussal', () => {
    const szakasz = minden[0]?.szakaszok['kinek-valo']
    if (!szakasz) throw new Error('hiányzó szalag')
    const html = renderToStaticMarkup(<KurzusSzakaszForrasSzalag szalag={szakasz} />)
    expect(html).toContain(
      '<div class="kc-szerkeszto-szalag"><div class="kc-szerkeszto-szalag__belso">',
    )
    expect(html).toContain(
      'class="kc-szerkeszto-szalag__link" href="/admin/collections/products/12?mezo=fitFor"',
    )
    expect(html).toContain('kc-szerkeszto-szalag__link kc-szerkeszto-szalag__link--masodlagos')
    expect(html).toContain('<span class="kc-visually-hidden">: „Kinek való, és kinek nem?” szakasz')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('target=')
  })

  it('a tartalék szakasz és az akciós szalag figyelmeztető felületet kap', () => {
    const tartalek = szalagok(buildCourseSalesContent(ures, facts)).szakaszok['hogyan-mukodik']
    if (!tartalek) throw new Error('hiányzó szalag')
    expect(renderToStaticMarkup(<KurzusSzakaszForrasSzalag szalag={tartalek} />)).toContain(
      'class="kc-szerkeszto-szalag kc-szerkeszto-szalag--figyelem"',
    )
    const akcios = minden[1]?.akcios
    if (!akcios) throw new Error('hiányzó akciós szalag')
    const html = renderToStaticMarkup(<KurzusAkciosSzalag szalag={akcios} />)
    expect(html).toContain('kc-szerkeszto-szalag--figyelem')
    expect(html).toContain('kc-container kc-szerkeszto-szalag__belso')
    const oldal = minden[0]?.oldal
    if (!oldal) throw new Error('hiányzó oldal-szalag')
    expect(renderToStaticMarkup(<KurzusOldalForrasSzalag szalag={oldal} />)).toContain(
      'href="/admin/collections/products/12">Szerkesztem<span class="kc-visually-hidden">: az egész kurzus, Kéztorna otthon</span>',
    )
  })
})

// ---------------------------------------------------------------------------
// 5. A route
// ---------------------------------------------------------------------------

const ROUTE = 'app/(frontend)/kurzusok/[slug]/page.tsx'

describe('a route forrása', () => {
  const route = forras(ROUTE)

  it('a szalagok kizárólag az `isPreview` ágban épülnek és renderelődnek', () => {
    expect(route).toMatch(/const forrasSzalagok = isPreview\s*\?\s*kurzusForrasSzalagok\(/)
    expect(route).toMatch(/: null\s*const forrassal = /)
    // A szakasz-szalag csak a `forrassal`-ban, ami forrasSzalagok nélkül a csomópontot adja vissza.
    expect(route.match(/<KurzusSzakaszForrasSzalag /g)).toHaveLength(1)
    expect(route).toMatch(
      /const szalag = forrasSzalagok\?\.szakaszok\[szakaszId\]\s*return szalag \?/,
    )
    // Az oldal- és az akciós szalag a `forrasSzalagok !== null` ágban.
    const eleje = route.indexOf('      {forrasSzalagok !== null ? (')
    const vege = route.indexOf('\n      ) : null}\n      {structuredHead}')
    expect(eleje).toBeGreaterThan(0)
    expect(vege).toBeGreaterThan(eleje)
    const ag = route.slice(eleje, vege)
    for (const elem of ['<PreviewBar', '<KurzusAkciosSzalag', '<KurzusOldalForrasSzalag']) {
      expect(ag).toContain(elem)
      expect(route.split(elem)).toHaveLength(2)
    }
    // Minden szakasz a forrassal-on át kerül a tömbbe.
    for (const id of [
      'mi-ez',
      'galeria',
      'hogyan-mukodik',
      'tananyag',
      'kinek-valo',
      'garancia',
      'gyik',
    ]) {
      expect(route).toContain(`node: forrassal(\n        '${id}',`)
    }
    // A promó-feltétel változatlan: előnézetben nincs akciós sablon.
    expect(route).toMatch(
      /isCoursePromoDisplayed\(product\) && priceBadge === 'price' && price !== null && !isPreview/,
    )
  })

  it('a siteGraphJsonLd megkapja a kapcsolati e-mailt', () => {
    expect(route).toContain("import { getContactEmail } from '@/lib/contact-email-server'")
    expect(route).toContain('contactEmail: await getContactEmail(),')
  })

  it('a szalag-címek betűre a route címsorai', () => {
    expect(route).toContain(`>\n            ${SZAKASZ_CIMEK['mi-ez']}\n          </h2>`)
    expect(route).toContain(`heading="${SZAKASZ_CIMEK['hogyan-mukodik']}"`)
    expect(route).toContain(`heading="${SZAKASZ_CIMEK.tananyag}"`)
    expect(route).toContain(`heading="${SZAKASZ_CIMEK['kinek-valo']}"`)
    expect(route).toContain(`heading="${SZAKASZ_CIMEK.gyik}"`)
    expect(route).toContain(`fitTitle="${NEKED_VALO_LISTA}"`)
    expect(route).toContain(`notFitTitle="${NEM_JAVASOLJUK_LISTA}"`)
  })
})

const mocks = vi.hoisted(() => ({
  draft: vi.fn(),
  auth: vi.fn(),
  find: vi.fn(),
}))
vi.mock('next/headers', () => ({ draftMode: mocks.draft, headers: async () => new Headers() }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
  permanentRedirect: () => {
    throw new Error('REDIRECT')
  },
}))
vi.mock('payload', () => ({ getPayload: async () => ({ auth: mocks.auth, find: mocks.find }) }))
vi.mock('../payload.config', () => ({ default: {} }))
vi.mock('../lib/contact-email-server', () => ({
  getContactEmail: async () => 'info@kineticare.hu',
}))
vi.mock('../lib/tudastar-lathatosag', () => ({ getTudastarLathato: async () => true }))
vi.mock('../components/analytics/TrackEvent', () => ({ TrackEvent: () => <span>TRACKING</span> }))
vi.mock('../components/courses/CourseBarionView', () => ({
  CourseBarionView: () => <span>BARION</span>,
}))
vi.mock('../components/courses/FreeCourseRequestForm', () => ({
  FreeCourseRequestForm: () => <span>CLAIM_FORM</span>,
}))

const { default: CoursePage } = await import('../app/(frontend)/kurzusok/[slug]/page')

const props = { params: Promise.resolve({ slug: 'kez-torna' }) }
const kurzus = {
  ...kitoltott,
  longDescription: reginLeiras(),
  howItWorks: null,
  id: 12,
  slug: 'kez-torna',
  displayTitle: 'Kéztorna otthon',
  status: 'published',
  priceInHUFEnabled: true,
  priceInHUF: 19900,
  ...AKTIV_AKCIO,
  modules: [
    {
      id: 'modul',
      title: 'Alapok',
      lessons: [{ id: 'lecke', title: 'Első lecke', status: 'ready', streamAssetId: 'GUID' }],
    },
  ],
}

describe('a route renderelve', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.auth.mockResolvedValue({ user: { id: 7, role: 'staff' } })
    mocks.find.mockResolvedValue({ docs: [{ ...kurzus, _status: 'draft' }] })
  })

  it('előnézetben: előnézet-sáv, akciós figyelmeztetés, oldal-szalag, majd minden szakasz előtt szalag', async () => {
    mocks.draft.mockResolvedValue({ isEnabled: true })
    const html = renderToStaticMarkup(await CoursePage(props))
    const sav = html.indexOf('kc-preview-bar')
    const akcios = html.indexOf('Akciós elrendezés: az előnézet nem mutatja')
    const oldal = html.indexOf('Az egész kurzus: Kéztorna otthon')
    expect(sav).toBeGreaterThanOrEqual(0)
    expect(akcios).toBeGreaterThan(sav)
    expect(oldal).toBeGreaterThan(akcios)
    // Az előnézet a normál elrendezés (a vásárlódoboz), nem az akciós sablon.
    expect(html).toContain('kc-course-layout')
    for (const [cimke, szakaszId] of [
      ['„A kurzusról” szakasz', 'id="mi-ez"'],
      ['„Hogyan működik?” szakasz', 'id="hogyan-mukodik-cim"'],
      ['„Tananyag” szakasz', 'id="tananyag-cim"'],
      ['„Kinek való, és kinek nem?” szakasz', 'id="kinek-valo-cim"'],
      ['„Garancia” szakasz', 'id="garancia"'],
      ['„Gyakori kérdések” szakasz', 'id="gyik-cim"'],
    ] as const) {
      const szalagHelye = html.indexOf(`<p class="kc-szerkeszto-szalag__cimke">${cimke}</p>`)
      expect(szalagHelye, cimke).toBeGreaterThan(oldal)
      expect(html.indexOf(szakaszId), cimke).toBeGreaterThan(szalagHelye)
    }
    expect(html).toContain('href="/admin/collections/products/12?mezo=howItWorks"')
    expect(html).toContain('href="/admin/collections/products/12?mezo=longDescription"')
    expect(html).toContain('href="/admin/collections/products/12?mezo=modules"')
    expect(html).toContain('href="/admin/collections/products/12?mezo=promoEnabled"')
    expect(html).not.toContain('/penztar')
  })

  it('nem előnézetben a szalagoknak nyoma sincs, és a JSON-LD a kapcsolati e-mailt viszi', async () => {
    mocks.draft.mockResolvedValue({ isEnabled: false })
    mocks.auth.mockResolvedValue({ user: null })
    mocks.find.mockResolvedValue({ docs: [{ ...kurzus, promoEnabled: false }] })
    const html = renderToStaticMarkup(await CoursePage(props))
    expect(html).toContain('kc-course-layout')
    for (const nyom of [
      'kc-szerkeszto-szalag',
      '?mezo=',
      '/admin/',
      'kc-preview-bar',
      'Az egész kurzus',
    ]) {
      expect(html).not.toContain(nyom)
    }
    expect(html).toContain('"email":"info@kineticare.hu"')
  })
})
