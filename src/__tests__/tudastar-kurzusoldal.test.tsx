import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Curriculum } from '../lib/curriculum/curriculum'

/**
 * A Tudástár-kapcsoló a KURZUSOLDALON (/kurzusok/[slug]) és a LECKÉBEN
 * (/kurzusaim/[id]) — A2-2-2.
 *
 * A tulajdonos kérése, szó szerint: „ha kikapcsolom a tudástár menüpontot,
 * akkor azt szeretném, hogy sehol ne jelenjen meg … Ha visszakapcsolom majd,
 * akkor jöjjön vissza.” A kurzus leírása és a lecke szövege CMS-ből jövő
 * Lexical rich text, benne a szerkesztő Tudástár-linket is elhelyezhet.
 *
 * Mit rögzít:
 * - KIKAPCSOLT Tudástárnál a leírás és a lecke Tudástár-linkje kibomlik (a
 *   szöveg marad, a hivatkozás eltűnik), a többi link érintetlen; a rendes és
 *   az akciós kurzusnézetben is;
 * - a JSON-LD építők (courseJsonLd, siteGraphJsonLd, faqPageJsonLd) a SZŰRT
 *   kurzust kapják: vi.mock importOriginal-lal, átengedő burkolóval rögzítjük a
 *   bemenetüket;
 * - BEKAPCSOLT Tudástárnál a lap ugyanazt az objektumot kapja, amit az adatbázis
 *   adott (referencia-azonosság), tehát a kimenet bájtra azonos a szűrés
 *   nélkülivel;
 * - a bemenet nem változik (Object.freeze, mélyen).
 */

const mocks = vi.hoisted(() => ({
  draft: vi.fn(),
  auth: vi.fn(),
  find: vi.fn(),
  findByID: vi.fn(),
  lathato: vi.fn(),
  jsonLdBemenetek: [] as Array<{ epito: string; bemenet: unknown }>,
  player: vi.fn(),
  access: vi.fn(),
}))

vi.mock('next/headers', () => ({ draftMode: mocks.draft, headers: async () => new Headers() }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
  permanentRedirect: () => {
    throw new Error('REDIRECT')
  },
  redirect: () => {
    throw new Error('REDIRECT')
  },
}))
vi.mock('payload', () => ({
  getPayload: async () => ({ auth: mocks.auth, find: mocks.find, findByID: mocks.findByID }),
}))
vi.mock('../payload.config', () => ({ default: {} }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('../lib/tudastar-lathatosag', () => ({ getTudastarLathato: mocks.lathato }))
vi.mock('../components/analytics/TrackEvent', () => ({ TrackEvent: () => <span>TRACKING</span> }))
vi.mock('../components/courses/CourseBarionView', () => ({
  CourseBarionView: () => <span>BARION</span>,
}))
vi.mock('../components/courses/FreeCourseRequestForm', () => ({
  FreeCourseRequestForm: () => <span>CLAIM_FORM</span>,
}))
vi.mock('../components/account/CoursePlayer', () => ({
  CoursePlayer: (props: unknown) => {
    mocks.player(props)
    return <span>PLAYER</span>
  },
}))
vi.mock('../lib/course-access-lookup', () => ({
  resolveSingleCourseAccess: mocks.access,
  lookupPurchaseDates: async () => ({ failed: false, dates: new Map() }),
}))
vi.mock('../lib/course-progress/lookup', () => ({
  fetchWatchedRefs: async () => new Map(),
}))
vi.mock('../lib/seo', async (importOriginal) => {
  const eredeti = await importOriginal<typeof import('../lib/seo')>()
  return {
    ...eredeti,
    courseJsonLd: (bemenet: Parameters<typeof eredeti.courseJsonLd>[0]) => {
      mocks.jsonLdBemenetek.push({ epito: 'courseJsonLd', bemenet })
      return eredeti.courseJsonLd(bemenet)
    },
    faqPageJsonLd: (bemenet: Parameters<typeof eredeti.faqPageJsonLd>[0]) => {
      mocks.jsonLdBemenetek.push({ epito: 'faqPageJsonLd', bemenet })
      return eredeti.faqPageJsonLd(bemenet)
    },
  }
})
vi.mock('../lib/seo-graph', async (importOriginal) => {
  const eredeti = await importOriginal<typeof import('../lib/seo-graph')>()
  return {
    ...eredeti,
    siteGraphJsonLd: (bemenet: Parameters<typeof eredeti.siteGraphJsonLd>[0]) => {
      mocks.jsonLdBemenetek.push({ epito: 'siteGraphJsonLd', bemenet })
      return eredeti.siteGraphJsonLd(bemenet)
    },
  }
})

const { default: CoursePage } = await import('../app/(frontend)/kurzusok/[slug]/page')
const { default: KurzusaimPlayerPage } = await import('../app/(frontend)/kurzusaim/[id]/page')

/** Egy Lexical link-csomópont (egyedi webcímmel). */
function link(url: string, text: string) {
  return {
    type: 'link',
    version: 3,
    fields: { linkType: 'custom', url, newTab: false },
    children: [{ type: 'text', version: 1, text, format: 0 }],
  }
}

function bekezdes(...children: unknown[]) {
  return { type: 'paragraph', version: 1, children }
}

function szoveg(text: string) {
  return { type: 'text', version: 1, text, format: 0 }
}

function lexical(...children: unknown[]) {
  return { root: { type: 'root', version: 1, children } }
}

/** A leírás: Tudástár-cikk, tünet-hub, /blog és egy NEM Tudástár link. */
const leiras = lexical(
  bekezdes(
    szoveg('Olvasd el '),
    link('/blog/kezrehabilitacio-alapok', 'CIKK_SZOVEG'),
    szoveg(', a '),
    link('/keztoalagut-szindroma', 'HUB_SZOVEG'),
    szoveg(' és a '),
    link('https://kineticare.hu/blog', 'LISTA_SZOVEG'),
    szoveg(' oldalt, vagy írj a '),
    link('/kapcsolat', 'KAPCSOLAT_SZOVEG'),
    szoveg(' oldalon.'),
  ),
  { type: 'heading', tag: 'h2', version: 1, children: [szoveg('Gyakori kérdések')] },
  { type: 'heading', tag: 'h3', version: 1, children: [szoveg('Hol olvashatok még?')] },
  bekezdes(szoveg('A '), link('/blog', 'GYIK_LINK_SZOVEG'), szoveg(' cikkeiben.')),
)

const csomagosLeiras = lexical(
  bekezdes(szoveg('Bevezető: '), link('/blog/csomag-cikk', 'PROMO_CIKK_SZOVEG')),
  {
    type: 'block',
    version: 1,
    fields: {
      blockType: 'coursePackage',
      heading: 'CSOMAG_CIM',
      items: [{ icon: 'book', title: 'CSOMAG_TETEL', description: 'CSOMAG_LEIRAS' }],
    },
  },
  bekezdes(szoveg('Záró sor, '), link('/kapcsolat', 'PROMO_KAPCSOLAT')),
)

const leckeSzoveg = lexical(
  bekezdes(
    szoveg('Háttér: '),
    link('/blog/lecke-cikk', 'LECKE_CIKK_SZOVEG'),
    szoveg(', kérdés esetén '),
    link('/kapcsolat', 'LECKE_KAPCSOLAT'),
  ),
)

function melyFagyasztas<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) melyFagyasztas(child)
    Object.freeze(value)
  }
  return value
}

function kurzus(extra: Record<string, unknown> = {}) {
  return melyFagyasztas({
    id: 12,
    slug: 'kez-torna',
    displayTitle: 'Kéztorna',
    shortDescription: 'Otthon végezhető kézrehabilitáció.',
    status: 'published',
    priceInHUFEnabled: true,
    priceInHUF: 19900,
    longDescription: leiras,
    modules: [
      {
        id: 'modul-1',
        title: 'Alapok',
        lessons: [
          {
            id: 'lecke-1',
            title: 'Első lecke',
            kind: 'szoveg',
            content: leckeSzoveg,
          },
          {
            id: 'lecke-2',
            title: 'Második lecke',
            kind: 'szoveg',
            content: lexical(bekezdes(szoveg('Link nélküli lecke.'))),
          },
        ],
      },
    ],
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...extra,
  })
}

/** Minden href a HTML-ben. */
function hrefek(html: string): string[] {
  return [...html.matchAll(/\bhref="([^"]*)"/g)].map((match) => match[1] ?? '')
}

const TUDASTAR_HREF = /^(https:\/\/kineticare\.hu)?\/(blog(\/|$)|keztoalagut-szindroma$)/

/** Minden Lexical link-cím egy tetszőleges értékben (rekurzívan). */
function lexicalLinkek(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(lexicalLinkek)
  if (typeof value !== 'object' || value === null) return []
  const record = value as Record<string, unknown>
  const sajat =
    record.type === 'link' && typeof record.fields === 'object' && record.fields !== null
      ? [String((record.fields as Record<string, unknown>).url)]
      : []
  return [...sajat, ...Object.values(record).flatMap(lexicalLinkek)]
}

const props = { params: Promise.resolve({ slug: 'kez-torna' }) }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.jsonLdBemenetek.length = 0
  mocks.draft.mockResolvedValue({ isEnabled: false })
  mocks.auth.mockResolvedValue({ user: null })
})

describe('kurzusoldal: a leírás Tudástár-linkjei', () => {
  it('bekapcsolt Tudástárnál minden link a helyén, és a lap a betöltött objektumot kapja', async () => {
    const betoltott = kurzus()
    mocks.find.mockResolvedValue({ docs: [betoltott] })
    mocks.lathato.mockResolvedValue(true)

    const html = renderToStaticMarkup(await CoursePage(props))

    expect(hrefek(html)).toEqual(
      expect.arrayContaining([
        '/blog/kezrehabilitacio-alapok',
        '/keztoalagut-szindroma',
        'https://kineticare.hu/blog',
        '/kapcsolat',
      ]),
    )
    const course = mocks.jsonLdBemenetek.find((sor) => sor.epito === 'courseJsonLd')
    expect((course?.bemenet as { product: unknown }).product).toBe(betoltott)
  })

  it('kikapcsolt Tudástárnál 0 Tudástár-href, a link szövege és a többi link megmarad', async () => {
    mocks.find.mockResolvedValue({ docs: [kurzus()] })
    mocks.lathato.mockResolvedValue(false)

    const html = renderToStaticMarkup(await CoursePage(props))

    expect(hrefek(html).filter((href) => TUDASTAR_HREF.test(href))).toEqual([])
    expect(html).toContain('CIKK_SZOVEG')
    expect(html).toContain('HUB_SZOVEG')
    expect(html).toContain('LISTA_SZOVEG')
    expect(hrefek(html)).toContain('/kapcsolat')
    expect(html).toContain('KAPCSOLAT_SZOVEG')
  })

  it('kikapcsolva a JSON-LD építők a szűrt kurzust kapják (és a GYIK a szűrt leírásból épül)', async () => {
    const betoltott = kurzus()
    mocks.find.mockResolvedValue({ docs: [betoltott] })
    mocks.lathato.mockResolvedValue(false)

    const html = renderToStaticMarkup(await CoursePage(props))

    // A kurzus JSON-LD-je a SZŰRT kurzust kapja. A leckék szövege a
    // kurzusoldalon nem jelenik meg (buildCurriculum(product, false)), és
    // egyik építő sem olvassa, ezért a vizsgált rich text a leírás.
    const course = mocks.jsonLdBemenetek.find((sor) => sor.epito === 'courseJsonLd')
    const product = (course?.bemenet as { product: { longDescription: unknown } }).product
    expect(product).not.toBe(betoltott)
    expect(lexicalLinkek(product.longDescription)).toEqual(['/kapcsolat'])
    // A GYIK a leírás „Gyakori kérdések” szakaszából épül: a kérdés és a
    // válasz szövege megmarad, a link nélkül.
    const faq = mocks.jsonLdBemenetek.find((sor) => sor.epito === 'faqPageJsonLd')
    expect(JSON.stringify(faq?.bemenet)).toContain('GYIK_LINK_SZOVEG')
    const graph = mocks.jsonLdBemenetek.find((sor) => sor.epito === 'siteGraphJsonLd')
    expect(graph).toBeDefined()
    for (const sor of [faq, graph]) {
      expect(JSON.stringify(sor?.bemenet)).not.toMatch(/\/blog|keztoalagut-szindroma/)
    }
    // A teljes kimenet (a JSON-LD szkriptekkel együtt) sem hivatkozik a Tudástárra.
    expect(html).not.toMatch(/\/blog|keztoalagut-szindroma/)
  })

  it('a szűrés nem módosítja a betöltött kurzust (mélyen fagyasztott bemenet)', async () => {
    const betoltott = kurzus()
    mocks.find.mockResolvedValue({ docs: [betoltott] })
    mocks.lathato.mockResolvedValue(false)

    await expect(CoursePage(props)).resolves.toBeDefined()
    expect(lexicalLinkek(betoltott.longDescription)).toContain('/blog/kezrehabilitacio-alapok')
  })

  it('az akciós nézet (CourseDescriptionContent) is a szűrt leírást mutatja', async () => {
    const akcios = {
      promoEnabled: true,
      promoPriceHuf: 9900,
      promoStart: '2020-01-01T00:00:00.000Z',
      promoEnd: '2099-12-31T00:00:00.000Z',
      longDescription: csomagosLeiras,
    }
    mocks.find.mockResolvedValue({ docs: [kurzus(akcios)] })
    mocks.lathato.mockResolvedValue(true)
    const bekapcsolva = renderToStaticMarkup(await CoursePage(props))
    expect(bekapcsolva).toContain('CSOMAG_CIM')
    expect(hrefek(bekapcsolva)).toContain('/blog/csomag-cikk')

    mocks.find.mockResolvedValue({ docs: [kurzus(akcios)] })
    mocks.lathato.mockResolvedValue(false)
    const kikapcsolva = renderToStaticMarkup(await CoursePage(props))
    expect(kikapcsolva).toContain('CSOMAG_CIM')
    expect(kikapcsolva).toContain('PROMO_CIKK_SZOVEG')
    expect(hrefek(kikapcsolva).filter((href) => TUDASTAR_HREF.test(href))).toEqual([])
    expect(hrefek(kikapcsolva)).toContain('/kapcsolat')
  })

  it('link nélküli leírásnál a kikapcsolt állapot kimenete is azonos a bekapcsolttal', async () => {
    const tiszta = { longDescription: lexical(bekezdes(szoveg('Csak szöveg.'))) }
    mocks.find.mockResolvedValue({ docs: [kurzus(tiszta)] })
    mocks.lathato.mockResolvedValue(true)
    const be = renderToStaticMarkup(await CoursePage(props))
    mocks.find.mockResolvedValue({ docs: [kurzus(tiszta)] })
    mocks.lathato.mockResolvedValue(false)
    const ki = renderToStaticMarkup(await CoursePage(props))
    expect(ki).toBe(be)
  })
})

describe('lecke (/kurzusaim/[id]): a lecke szövegének Tudástár-linkjei', () => {
  const playerProps = { params: Promise.resolve({ id: '12' }) }

  function kurzusaimElokeszites(lathato: boolean) {
    const betoltott = kurzus()
    mocks.auth.mockResolvedValue({ user: { id: 5, purchases: [12] } })
    mocks.findByID.mockResolvedValue(betoltott)
    mocks.access.mockResolvedValue({ hasAccess: true, reason: 'unlimited', expiresAt: null })
    mocks.lathato.mockResolvedValue(lathato)
    return betoltott
  }

  function tananyag(): Curriculum {
    const hivas = mocks.player.mock.calls.at(-1)?.[0] as { curriculum: Curriculum }
    return hivas.curriculum
  }

  it('bekapcsolva a lecke szövege a betöltött objektum (referencia-azonos)', async () => {
    const betoltott = kurzusaimElokeszites(true)
    renderToStaticMarkup(await KurzusaimPlayerPage(playerProps))
    expect(tananyag().lessons[0]?.content).toBe(betoltott.modules[0]?.lessons[0]?.content)
    expect(lexicalLinkek(tananyag().lessons)).toContain('/blog/lecke-cikk')
  })

  it('kikapcsolva a lejátszó (RSC) bemenetében 0 Tudástár-link, a szöveg és a többi link marad', async () => {
    const betoltott = kurzusaimElokeszites(false)
    renderToStaticMarkup(await KurzusaimPlayerPage(playerProps))
    const curriculum = tananyag()
    // A modulok és a lapos lista ugyanazokat a lecke-objektumokat tartja,
    // ezért a lapos listát vizsgáljuk; a teljes modellben sincs Tudástár-link.
    expect(lexicalLinkek(curriculum.lessons)).toEqual(['/kapcsolat'])
    expect(JSON.stringify(curriculum)).not.toMatch(/\/blog/)
    expect(JSON.stringify(curriculum)).toContain('LECKE_CIKK_SZOVEG')
    // A változatlan lecke ugyanaz az objektum marad.
    expect(curriculum.lessons[1]?.content).toBe(betoltott.modules[0]?.lessons[1]?.content)
    // A bemenet nem változott.
    expect(lexicalLinkek(betoltott.modules)).toContain('/blog/lecke-cikk')
  })

  it('hozzáférés nélkül a kapcsolót nem is kérdezi (a szöveg úgysem kerül a modellbe)', async () => {
    kurzusaimElokeszites(false)
    mocks.auth.mockResolvedValue({ user: { id: 5, purchases: [] } })
    renderToStaticMarkup(await KurzusaimPlayerPage(playerProps))
    expect(mocks.lathato).not.toHaveBeenCalled()
    expect(tananyag().lessons.every((lesson) => lesson.content === null)).toBe(true)
  })
})
