import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Page } from '../payload-types'

/**
 * A „Kódban van” szalagok őre (modul-térkép H09 1. pont, H21, H35, H18, H46).
 *
 * 1. Az építők szövegei és linkjei: admin-útvonal-előtag, mélylink a Kapcsolat
 *    oldal első látható Időpontkérés szekciójára (ugyanaz a szabály, mint a
 *    kapcsolati e-mail feloldójában), a forrás-linkek felirata és célja BETŰRE
 *    a szekció-szalagoké (WCAG 2.2 SC 3.2.4).
 * 2. A szövegekben idézett nevek az admin valódi nevei (blokk- és
 *    gyűjtemény-címkék, a Barion-sáv címe).
 * 3. Tipográfia: nincs töltelék gondolatjel (– —), az idézőjel magyar („…”).
 * 4. A HomeView: `elonezet` nélkül bájtra a szalag nélküli kimenet, és a
 *    piszkozat-kimenetből a szalagot kivágva is ugyanaz jön ki; piszkozatban
 *    a szalag KÖZVETLENÜL a Barion-sáv előtt áll, mindkét ágban.
 * 5. Az ElonezetKeretSzalag nem piszkozatban null; a layout piszkozatban a
 *    fejléc és a lábléc ELŐTT rendereli, azon kívül a kimenet a szalag nélküli.
 * 6. A /kurzusok és a /blog route: piszkozatban előnézet-sáv + lapfej-szalag,
 *    azon kívül egyik sem; a JSON-LD a feloldott kapcsolati e-mailt viszi.
 */

// ---------------------------------------------------------------------------
// Mockok: adatbázis és hálózat nélkül
// ---------------------------------------------------------------------------

const allapot = vi.hoisted(() => ({
  draft: false,
  email: 'info@kineticare.hu',
  kapcsolatLap: null as unknown,
}))

vi.mock('next/headers', () => ({ draftMode: async () => ({ isEnabled: allapot.draft }) }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound')
  },
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}))
vi.mock('@/lib/cms', () => ({
  getPageBySlug: async () => allapot.kapcsolatLap,
  getPosts: async () => [],
  getContentCategories: async () => [],
  getPublishedPageSlugs: async () => new Set<string>(),
  getPublishedProducts: async () => [],
  getCategoryBySlug: async () => null,
}))
vi.mock('@/lib/contact-email-server', () => ({ getContactEmail: async () => allapot.email }))
vi.mock('@/lib/tudastar-lathatosag', () => ({ getTudastarLathato: async () => true }))
vi.mock('payload', async (eredeti) => ({
  ...(await eredeti<typeof import('payload')>()),
  getPayload: async () => ({ find: async () => ({ docs: [] }) }),
}))
vi.mock('../payload.config', () => ({ default: {} }))
// A layout keretének elemei: a fejléc és a lábléc adatbázisból dolgozik, az
// analitika kliens-oldali; itt csak a HELYÜK számít, ezért jelölő-csonkok.
vi.mock('@/components/layout/Header', () => ({
  Header: () => createElement('header', { 'data-csonk': 'fejlec' }),
}))
vi.mock('@/components/layout/Footer', () => ({
  FeloldottFooter: () => createElement('footer', { 'data-csonk': 'lablec' }),
}))
vi.mock('@/components/analytics/BarionPixel', () => ({
  BarionPixel: () => null,
  BarionPixelNoscript: () => null,
}))
vi.mock('@/components/analytics/ConsentBanner', () => ({ ConsentBanner: () => null }))
vi.mock('@/components/analytics/GoogleAnalytics', () => ({ GoogleAnalytics: () => null }))
vi.mock('@/components/analytics/PostHogPageView', () => ({ PostHogPageView: () => null }))
vi.mock('@/components/analytics/PostHogProvider', () => ({
  PostHogProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/components/motion/AnchorScroll', () => ({ AnchorScroll: () => null }))

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  allapot.draft = false
  allapot.email = 'info@kineticare.hu'
  allapot.kapcsolatLap = null
})

const { pageBlocks } = await import('../blocks')
const { Menus } = await import('../collections/Menus')
const { Pages } = await import('../collections/Pages')
const { Posts } = await import('../collections/Posts')
const { BARION_CIM, BARION_KEZDOLAP_CIM_ID } =
  await import('../components/checkout/BarionFizetesJelzes')
const { HomeView } = await import('../components/content/HomeView')
const { szekcioMelylink } = await import('../components/editor/szekcio-melylink')
const {
  BARION_SAV_NEV,
  EMAIL_MEZO_NEV,
  IDOPONTKERES_BLOKK_NEV,
  KODBAN_VAN,
  KURZUSKARTYAK_BLOKK_NEV,
  RESZBEN_KODBAN_VAN,
  barionSavSzalag,
  cimkeForrasok,
  elsoLathatoIdopontkeresId,
  fejlecSzalag,
  kapcsolatIdopontSzerkesztoHref,
  kodSzalag,
  lablecSzalag,
  listaFejSzalag,
  szerkesztoReteg,
} = await import('../components/editor/frontend/szerkeszto-szalag')
const { ElonezetKeretSzalag, SzerkesztoKodSzalag } =
  await import('../components/editor/frontend/SzerkesztoSzalag')
const { COURSE_SHOWCASE_MARK } = await import('../lib/course-showcase')
const { buildExitPreviewHref } = await import('../lib/preview/exit-preview')
const { KAPCSOLATI_EMAIL_TARTALEK, kapcsolatiEmailLayoutbol } = await import('../lib/contact-email')
const { UGRAS_FELIRAT, sectionSource } = await import('../lib/section-row-label')
const FrontendLayout = (await import('../app/(frontend)/layout')).default
const KurzusokPage = (await import('../app/(frontend)/kurzusok/page')).default
const BlogPage = (await import('../app/(frontend)/blog/page')).default

// ---------------------------------------------------------------------------
// Segédek
// ---------------------------------------------------------------------------

type Layout = NonNullable<Page['layout']>

interface EloLap {
  id: number
  slug: string
  title: string
  layout: Layout
}

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const ELO: Readonly<Record<string, EloLap>> = JSON.parse(
  readFileSync(join(REPO, 'src/__tests__/fixtures/elo-szekciosorok-2026-09-22.json'), 'utf8'),
) as Record<string, EloLap>

function elo(slug: string): EloLap {
  const lap = ELO[slug]
  if (!lap) {
    throw new Error(`Hiányzik a fixture-ből: ${slug}`)
  }
  return lap
}

const forras = (utvonal: string): string => readFileSync(join(REPO, utvonal), 'utf8')

function dekodol(html: string): string {
  return html
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

const szovegbe = (html: string): string => dekodol(html.replace(/<[^>]+>/g, ''))

const OSSZES = () => [
  barionSavSzalag(),
  fejlecSzalag(),
  lablecSzalag(),
  lablecSzalag({ kapcsolatIdopontHref: '/admin/collections/pages/7' }),
  listaFejSzalag('kurzusok'),
  listaFejSzalag('tudastar'),
]

const kodSzalagHtml = (szalag: Parameters<typeof SzerkesztoKodSzalag>[0]['szalag']): string =>
  renderToStaticMarkup(createElement(SzerkesztoKodSzalag, { szalag }))

/** A gyűjtemény többes számú címkéje (a Payload `labels.plural`-ja szöveg). */
function tobbesNev(gyujtemeny: { labels?: { plural?: unknown } }): string {
  const nev = gyujtemeny.labels?.plural
  return typeof nev === 'string' ? nev : ''
}

// ---------------------------------------------------------------------------
// 1. Az építők szövegei és linkjei
// ---------------------------------------------------------------------------

describe('az építők', () => {
  it('Barion-sáv: teljesen kódbeli, link nélkül', () => {
    const szalag = barionSavSzalag()
    expect(szalag.cimke).toBe(`Bankkártyás fizetés Barionnal · ${KODBAN_VAN}`)
    expect(szalag.magyarazat).toContain('az adminban nem szerkeszthető')
    expect(szalag.magyarazat).toContain('Barion elfogadóhelyi előírása')
    expect(szalag.linkek).toEqual([])
  })

  it('fejléc: a Menüpontok listájára visz, az admin-útvonal előtagjával', () => {
    expect(fejlecSzalag().cimke).toBe(`Fejléc · ${RESZBEN_KODBAN_VAN}`)
    expect(fejlecSzalag().magyarazat).toBe(
      'A menüpontokat a Menüpontok között írod át. A logó és a fiók ikonja a weboldal kódjában van. Ha a menüben nincs a Kurzusok oldalra vivő főmenüpont, a kód maga tesz egyet az első helyre.',
    )
    expect(fejlecSzalag().linkek).toEqual([
      {
        felirat: `${UGRAS_FELIRAT}: Menüpontok`,
        rejtettKontextus: ', a fejléc menüje',
        href: '/admin/collections/menus',
      },
    ])
    expect(fejlecSzalag({ adminRoute: '/szerk/' }).linkek[0]?.href).toBe('/szerk/collections/menus')
    expect(fejlecSzalag({ adminRoute: 'szerk' }).linkek[0]?.href).toBe('/szerk/collections/menus')
  })

  it('lábléc: mélylink a Kapcsolat oldal első látható Időpontkérés szekciójára (élő adat)', () => {
    const kapcsolat = elo('kapcsolat')
    const href = kapcsolatIdopontSzerkesztoHref({ lap: kapcsolat })
    expect(href).toBe(
      szekcioMelylink({
        collection: 'pages',
        id: kapcsolat.id,
        blokkId: '6a82eaf91c307f002219b8a8',
      }),
    )
    expect(href).toBe('/admin/collections/pages/7?szekcio=6a82eaf91c307f002219b8a8')
    const szalag = lablecSzalag({ ...(href ? { kapcsolatIdopontHref: href } : {}) })
    expect(szalag.cimke).toBe(`Lábléc · ${RESZBEN_KODBAN_VAN}`)
    expect(szalag.linkek).toEqual([
      {
        felirat: `${UGRAS_FELIRAT}: Kapcsolat oldal`,
        rejtettKontextus: ', Időpontkérés szekció, E-mail-cím mező',
        href,
      },
    ])
  })

  it('lábléc: Időpontkérés nélkül a Kapcsolat oldal szerkesztője, oldal nélkül az Oldalak listája', () => {
    expect(kapcsolatIdopontSzerkesztoHref({ lap: { id: 7, layout: [] } })).toBe(
      '/admin/collections/pages/7',
    )
    expect(kapcsolatIdopontSzerkesztoHref({ lap: null })).toBeUndefined()
    expect(lablecSzalag().linkek).toEqual([
      {
        felirat: `${UGRAS_FELIRAT}: Oldalak`,
        rejtettKontextus: ', a Kapcsolat oldal, Időpontkérés szekció, E-mail-cím mező',
        href: '/admin/collections/pages',
      },
    ])
    expect(
      kapcsolatIdopontSzerkesztoHref({ lap: { id: 7, layout: [] }, adminRoute: '/szerk' }),
    ).toBe('/szerk/collections/pages/7')
    expect(lablecSzalag({ adminRoute: '/szerk' }).linkek[0]?.href).toBe('/szerk/collections/pages')
  })

  it('a link célja ugyanaz a szekció, ahonnan a lábléc a kapcsolati e-mailt veszi', () => {
    const blokk = (id: string, email: string, visible?: boolean) => ({
      id,
      blockType: 'appointment',
      email,
      ...(visible === undefined ? {} : { sectionSettings: { visible } }),
    })
    const esetek: { layout: unknown[]; id: string | null; email: string | null }[] = [
      {
        layout: [blokk('a'.repeat(24), 'elso@pelda.hu'), blokk('b'.repeat(24), 'masodik@pelda.hu')],
        id: 'a'.repeat(24),
        email: 'elso@pelda.hu',
      },
      {
        layout: [
          { id: 'c'.repeat(24), blockType: 'richText' },
          blokk('a'.repeat(24), 'rejtett@pelda.hu', false),
          blokk('b'.repeat(24), 'lathato@pelda.hu', true),
        ],
        id: 'b'.repeat(24),
        email: 'lathato@pelda.hu',
      },
      { layout: [blokk('a'.repeat(24), 'x@pelda.hu', false)], id: null, email: null },
    ]
    for (const eset of esetek) {
      expect(elsoLathatoIdopontkeresId(eset.layout)).toBe(eset.id)
      expect(kapcsolatiEmailLayoutbol(eset.layout)).toBe(eset.email)
    }
    expect(elsoLathatoIdopontkeresId(null)).toBeNull()
    expect(elsoLathatoIdopontkeresId([blokk('nem-hexa', 'x@pelda.hu')])).toBeNull()
  })

  it('/kurzusok és /blog: a forrás-link BETŰRE a szekció-szalagok második linkje (SC 3.2.4)', () => {
    const kezdolap = elo('kezdolap')
    const reteg = szerkesztoReteg({ lap: kezdolap, blokkok: pageBlocks })
    const kartyak = Object.values(reteg.szekciok).find(
      (szalag) => kezdolap.layout[szalag.sorIndex]?.blockType === 'courseCards',
    )
    expect(kartyak?.forras?.link).toBeTruthy()
    const kurzusLink = listaFejSzalag('kurzusok').linkek[0]
    expect(kurzusLink?.felirat).toBe(kartyak?.forras?.link?.felirat)
    expect(kurzusLink?.href).toBe(kartyak?.forras?.link?.href)

    const tudastar = sectionSource({ blockType: 'knowledge' }, 'kezdolap')
    const blogLink = listaFejSzalag('tudastar').linkek[0]
    expect(blogLink?.felirat).toBe(`${UGRAS_FELIRAT}: ${tudastar?.hova?.nev ?? ''}`)
    expect(blogLink?.href).toBe(`/admin${tudastar?.hova?.adminPath ?? ''}`)
    expect(listaFejSzalag('kurzusok', { adminRoute: '/szerk' }).linkek[0]?.href).toBe(
      '/szerk/collections/products',
    )
  })

  it('a /kurzusok szövege a course-showcase.ts felirat-állandójára hivatkozik', () => {
    expect(listaFejSzalag('kurzusok').magyarazat).toContain(`„${COURSE_SHOWCASE_MARK}” felirat`)
  })

  it('kodSzalag: az általános építő másolatot ad, a bemenetet nem köti', () => {
    const linkek = [{ felirat: 'Ugrás', rejtettKontextus: '', href: '/admin' }]
    const szalag = kodSzalag({ cimke: 'X · Kódban van', magyarazat: 'Mondat.', linkek })
    expect(szalag).toEqual({ cimke: 'X · Kódban van', magyarazat: 'Mondat.', linkek })
    expect(szalag.linkek).not.toBe(linkek)
  })
})

// ---------------------------------------------------------------------------
// 2. A szövegekben idézett nevek az admin valódi nevei
// ---------------------------------------------------------------------------

describe('a szövegek neve = az admin neve', () => {
  it('Barion-sáv címe = a sáv címsora', () => {
    expect(BARION_SAV_NEV).toBe(BARION_CIM)
  })

  it('blokknevek a pageBlocks sorcímke-forrásából', () => {
    const forrasok = cimkeForrasok(pageBlocks)
    expect(IDOPONTKERES_BLOKK_NEV).toBe(forrasok.get('appointment')?.blockLabel)
    expect(KURZUSKARTYAK_BLOKK_NEV).toBe(forrasok.get('courseCards')?.blockLabel)
  })

  it('az E-mail-cím mező címkéje az Időpontkérés blokkban', () => {
    const blokk = pageBlocks.find((jelolt) => jelolt.slug === 'appointment')
    const mezo = blokk?.fields.find((jelolt) => 'name' in jelolt && jelolt.name === 'email')
    expect(mezo && 'label' in mezo ? mezo.label : null).toBe(EMAIL_MEZO_NEV)
  })

  it('gyűjtemény-nevek: Menüpontok, Oldalak, Blogbejegyzések', () => {
    expect(fejlecSzalag().linkek[0]?.felirat).toBe(`${UGRAS_FELIRAT}: ${tobbesNev(Menus)}`)
    expect(lablecSzalag().linkek[0]?.felirat).toBe(`${UGRAS_FELIRAT}: ${tobbesNev(Pages)}`)
    expect(listaFejSzalag('tudastar').linkek[0]?.felirat).toBe(
      `${UGRAS_FELIRAT}: ${tobbesNev(Posts)}`,
    )
    expect(listaFejSzalag('tudastar').magyarazat).toContain(tobbesNev(Posts))
  })
})

// ---------------------------------------------------------------------------
// 3. Tipográfia
// ---------------------------------------------------------------------------

describe('tipográfia (natív magyar, töltelék gondolatjel nélkül)', () => {
  const szovegek = () =>
    OSSZES().flatMap((szalag) => [
      szalag.cimke,
      szalag.magyarazat,
      ...szalag.linkek.flatMap((link) => [link.felirat, link.rejtettKontextus]),
    ])

  it('nincs – vagy — jel, sem egyenes vagy angol idézőjel', () => {
    for (const szoveg of szovegek()) {
      expect(szoveg).not.toMatch(/[–—]/)
      expect(szoveg).not.toMatch(/["“]/)
      expect(szoveg).not.toContain('...')
    }
  })

  it('az idézőjel magyar: minden „ után ” jön, párban', () => {
    for (const szoveg of szovegek()) {
      const nyito = (szoveg.match(/„/g) ?? []).length
      const zaro = (szoveg.match(/”/g) ?? []).length
      expect(nyito).toBe(zaro)
      expect(szoveg).not.toMatch(/”[^„]*”/)
    }
  })

  it('a magyarázat mondatokból áll (ponttal zárul), a címke jelzéssel végződik', () => {
    for (const szalag of OSSZES()) {
      expect(szalag.magyarazat.endsWith('.')).toBe(true)
      expect(
        szalag.cimke.endsWith(` · ${KODBAN_VAN}`) ||
          szalag.cimke.endsWith(` · ${RESZBEN_KODBAN_VAN}`),
      ).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// 4. A komponens
// ---------------------------------------------------------------------------

describe('SzerkesztoKodSzalag', () => {
  it('a meglévő szalag-osztályok + --kod, horgony-id nélkül', () => {
    const html = kodSzalagHtml(fejlecSzalag())
    expect(html.startsWith('<div class="kc-szerkeszto-szalag kc-szerkeszto-szalag--kod">')).toBe(
      true,
    )
    expect(html).not.toContain(' id="')
    expect(html).toContain('<p class="kc-szerkeszto-szalag__cimke">Fejléc · Részben kódban van</p>')
    expect(html).toContain('<p class="kc-szerkeszto-szalag__jelzes">')
  })

  it('a link akadálymentes neve a látható felirattal kezdődik (SC 2.5.3), utána a rejtett kontextus', () => {
    const html = kodSzalagHtml(fejlecSzalag())
    expect(html).toContain(
      '<a class="kc-szerkeszto-szalag__link" href="/admin/collections/menus">Ugrás oda, ahol szerkeszted: Menüpontok<span class="kc-visually-hidden">, a fejléc menüje</span></a>',
    )
    const link = /<a [^>]*>([\s\S]*?)<\/a>/.exec(html)?.[1] ?? ''
    expect(szovegbe(link)).toBe('Ugrás oda, ahol szerkeszted: Menüpontok, a fejléc menüje')
  })

  it('link nélküli szalagnál (Barion) nincs linksor és nincs <a>', () => {
    const html = kodSzalagHtml(barionSavSzalag())
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('kc-szerkeszto-szalag__linkek')
  })

  it('rejtett kontextus nélküli linknél nincs üres span', () => {
    const html = kodSzalagHtml(listaFejSzalag('kurzusok'))
    expect(html).toContain(
      '<a class="kc-szerkeszto-szalag__link" href="/admin/collections/products">Ugrás oda, ahol szerkeszted: Kurzusok</a>',
    )
  })
})

// ---------------------------------------------------------------------------
// 5. HomeView: a Barion-sáv szalagja
// ---------------------------------------------------------------------------

describe('HomeView: a Barion-sáv szalagja', () => {
  const kezdolap = () => ({ ...elo('kezdolap'), status: 'published' }) as unknown as Page
  const agak = [
    ['CMS-szekciósor (élő kezdőlap)', () => kezdolap()],
    ['tartalék-kezdőlap (home: null)', () => null],
  ] as const
  const render = (home: Page | null, extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      createElement(HomeView, { home, products: [], posts: [], testimonials: [], ...extra }),
    )

  for (const [nev, home] of agak) {
    it(`${nev}: elonezet=false = a prop nélküli kimenet, bájtra, szalag nélkül`, () => {
      const alap = render(home())
      expect(render(home(), { elonezet: false })).toBe(alap)
      expect(render(home(), { elonezet: false, kapcsolatiEmail: KAPCSOLATI_EMAIL_TARTALEK })).toBe(
        alap,
      )
      expect(alap).not.toContain('kc-szerkeszto')
    })

    it(`${nev}: elonezet=true → a szalag KÖZVETLENÜL a Barion-sáv előtt, és ez az egyetlen eltérés`, () => {
      const alap = render(home())
      const elonezet = render(home(), { elonezet: true })
      const szalag = kodSzalagHtml(barionSavSzalag())
      const barionCim = elonezet.indexOf(`id="${BARION_KEZDOLAP_CIM_ID}"`)
      const barionSav = elonezet.lastIndexOf('<section', barionCim)
      expect(barionSav).toBeGreaterThan(0)
      expect(elonezet.slice(barionSav - szalag.length, barionSav)).toBe(szalag)
      expect(elonezet.split('kc-szerkeszto-szalag--kod').length - 1).toBe(1)
      expect(elonezet.replace(szalag, '')).toBe(alap)
    })

    it(`${nev}: a kapcsolati e-mail az Organization JSON-LD-be kerül`, () => {
      const html = render(home(), { kapcsolatiEmail: 'rendelo@pelda.hu' })
      expect(html).toContain('"email":"rendelo@pelda.hu"')
      expect(html).not.toContain(`"email":"${KAPCSOLATI_EMAIL_TARTALEK}"`)
    })
  }
})

// ---------------------------------------------------------------------------
// 6. A keret: ElonezetKeretSzalag és a layout
// ---------------------------------------------------------------------------

describe('ElonezetKeretSzalag és a (frontend) layout', () => {
  it('nem piszkozatban null (fejléc és lábléc is)', () => {
    expect(ElonezetKeretSzalag({ elonezet: false, hely: 'fejlec' })).toBeNull()
    expect(
      ElonezetKeretSzalag({ elonezet: false, hely: 'lablec', kapcsolatIdopontHref: '/admin/x' }),
    ).toBeNull()
  })

  it('piszkozatban a fejléc- és a lábléc-szalag, a megadott e-mail-linkkel', () => {
    const fejlec = renderToStaticMarkup(
      createElement(ElonezetKeretSzalag, { elonezet: true, hely: 'fejlec' }),
    )
    expect(fejlec).toBe(kodSzalagHtml(fejlecSzalag()))
    const lablec = renderToStaticMarkup(
      createElement(ElonezetKeretSzalag, {
        elonezet: true,
        hely: 'lablec',
        kapcsolatIdopontHref: '/admin/collections/pages/7?szekcio=6a82eaf91c307f002219b8a8',
      }),
    )
    expect(lablec).toBe(
      kodSzalagHtml(
        lablecSzalag({
          kapcsolatIdopontHref: '/admin/collections/pages/7?szekcio=6a82eaf91c307f002219b8a8',
        }),
      ),
    )
  })

  const renderLayout = async () =>
    renderToStaticMarkup(
      (await FrontendLayout({ children: createElement('p', null, 'tartalom') })) as ReactNode,
    )

  it('nem piszkozatban a keret szalag nélküli, a sorrend fejléc → main → lábléc', async () => {
    const html = await renderLayout()
    expect(html).not.toContain('kc-szerkeszto')
    expect(html).toContain(
      '<header data-csonk="fejlec"></header><main id="tartalom"><p>tartalom</p></main><footer data-csonk="lablec"></footer>',
    )
  })

  it('piszkozatban a fejléc és a lábléc ELŐTT áll a szalag; kivágva a nem-piszkozat kimenet marad', async () => {
    const alap = await renderLayout()
    allapot.draft = true
    allapot.kapcsolatLap = { ...elo('kapcsolat'), status: 'published' }
    const html = await renderLayout()
    const fejlec = kodSzalagHtml(fejlecSzalag())
    const lablec = kodSzalagHtml(
      lablecSzalag({
        kapcsolatIdopontHref: '/admin/collections/pages/7?szekcio=6a82eaf91c307f002219b8a8',
      }),
    )
    expect(html).toContain(`${fejlec}<header data-csonk="fejlec">`)
    expect(html).toContain(`</main>${lablec}<footer data-csonk="lablec">`)
    expect(html.replace(fejlec, '').replace(lablec, '')).toBe(alap)
  })

  it('piszkozatban, Kapcsolat oldal nélkül a lábléc-szalag az Oldalak listájára visz', async () => {
    allapot.draft = true
    const html = await renderLayout()
    expect(html).toContain(kodSzalagHtml(lablecSzalag()))
  })

  it('a layout forrása: a lábléc a feloldóval, a szalag csak a piszkozat-ágban', () => {
    const layout = forras('src/app/(frontend)/layout.tsx')
    expect(layout).toContain('const lablec = <FeloldottFooter />')
    expect(layout).toContain('const { isEnabled: isDraft } = await draftMode()')
    expect(layout).toMatch(/\) : \(\s*<Header \/>\s*\)\}/)
    expect(layout).toMatch(/\) : \(\s*lablec\s*\)\}/)
    expect(layout.match(/<ElonezetKeretSzalag/g)).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// 7. A /kurzusok és a /blog route
// ---------------------------------------------------------------------------

describe('a /kurzusok és a /blog route', () => {
  const kurzusok = async () =>
    renderToStaticMarkup((await KurzusokPage({ searchParams: Promise.resolve({}) })) as ReactNode)
  const blog = async () =>
    renderToStaticMarkup((await BlogPage({ searchParams: Promise.resolve({}) })) as ReactNode)

  for (const [nev, lap, melyik, utvonal] of [
    ['/kurzusok', kurzusok, 'kurzusok', '/kurzusok'],
    ['/blog', blog, 'tudastar', '/blog'],
  ] as const) {
    it(`${nev}: publikált nézetben nincs előnézet-sáv és szalag`, async () => {
      const html = await lap()
      expect(html).not.toContain('kc-preview-bar')
      expect(html).not.toContain('kc-szerkeszto')
    })

    it(`${nev}: piszkozatban előnézet-sáv, utána a lapfej szalagja, utána a lap`, async () => {
      const alap = await lap()
      allapot.draft = true
      const html = await lap()
      const szalag = kodSzalagHtml(listaFejSzalag(melyik))
      expect(html.startsWith('<div class="kc-preview-bar">')).toBe(true)
      expect(html).toContain(`href="${buildExitPreviewHref(utvonal).replace(/&/g, '&amp;')}"`)
      expect(html).not.toContain('Vissza a szerkesztőbe')
      const szalagHelye = html.indexOf(szalag)
      expect(szalagHelye).toBeGreaterThan(0)
      expect(html.slice(szalagHelye + szalag.length)).toBe(alap)
    })

    it(`${nev}: a JSON-LD szervezet-csomópontja a feloldott kapcsolati e-mailt viszi`, async () => {
      allapot.email = 'rendelo@pelda.hu'
      const html = await lap()
      expect(html).toContain('"email":"rendelo@pelda.hu"')
      expect(html).not.toContain(`"email":"${KAPCSOLATI_EMAIL_TARTALEK}"`)
    })
  }
})

// ---------------------------------------------------------------------------
// 8. Forrás-olvasó: a három route átadja a kapcsolati e-mailt
// ---------------------------------------------------------------------------

describe('a JSON-LD a kapcsolati e-mail feloldóját kapja (H46)', () => {
  it('kezdőlap: getContactEmail() → HomeView kapcsolatiEmail → organizationJsonLd(kapcsolatiEmail)', () => {
    const route = forras('src/app/(frontend)/page.tsx')
    expect(route).toContain('getContactEmail(),')
    expect(route).toContain('kapcsolatiEmail={kapcsolatiEmail}')
    expect(route).toContain('elonezet={isDraft}')
    const nezet = forras('src/components/content/HomeView.tsx')
    expect(nezet.match(/organizationJsonLd\(kapcsolatiEmail\)/g)).toHaveLength(2)
    expect(nezet).not.toContain('organizationJsonLd()')
  })

  it('/kurzusok és /blog: siteGraphJsonLd({ …, contactEmail: kapcsolatiEmail })', () => {
    for (const fajl of [
      'src/app/(frontend)/kurzusok/page.tsx',
      'src/app/(frontend)/blog/page.tsx',
    ]) {
      const route = forras(fajl)
      expect(route).toContain('getContactEmail(),')
      expect(route).toContain('contactEmail: kapcsolatiEmail,')
    }
  })
})
