import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RenderBlocks } from '../components/blocks/RenderBlocks'
import { NotFoundView } from '../components/error/NotFoundView'
import { isTudastarHref } from '../lib/tudastar-kapcsolo'
import { layoutTudastarLinkekNelkul, lexicalTudastarLinkekNelkul } from '../lib/tudastar-link-szuro'
import type { Media, Page, Post } from '../payload-types'

/**
 * Tudástár-kapcsoló: a KIKAPCSOLT állapot hatása a renderelt HTML-re.
 *
 * 1. A tiszta linkszűrő (src/lib/tudastar-link-szuro.ts) szabályai és az, hogy
 *    a bemenetet nem módosítja.
 * 2. A RenderBlocks a szűrt szekciósorral MINDEN linket hordozó blokktípusnál
 *    0 Tudástár-hivatkozást ad, üres href és felirat nélküli gomb nélkül.
 * 3. A route-ok (kezdőlap, CMS-oldal, hub és cikk metaadata, 404) a kapcsolót
 *    követik: rejtett Tudástárnál posztlekérdezés sem fut, a Tudástár-lapok
 *    `noindex, follow` jelölést kapnak, az előnézet robots-metája elsőbbséget
 *    élvez.
 */

type LayoutBlock = NonNullable<Page['layout']>[number]

const h = vi.hoisted(() => ({
  lathato: true,
  draft: false,
  page: null as unknown,
  home: null as unknown,
  post: null as unknown,
  latestPosts: vi.fn(),
  pageSlugs: vi.fn(),
}))

vi.mock('@/lib/tudastar-lathatosag', () => ({ getTudastarLathato: async () => h.lathato }))
vi.mock('next/headers', () => ({ draftMode: async () => ({ isEnabled: h.draft }) }))
vi.mock('@/lib/appointment/section', () => ({
  getAppointmentSectionContext: async () => ({ formId: null, turnstileSiteKey: null }),
}))
vi.mock('@/lib/cms', () => ({
  HOME_PAGE_SLUG: 'kezdolap',
  getHomePage: async () => h.home,
  getPageBySlug: async () => h.page,
  getPostBySlug: async () => h.post,
  getLatestPosts: h.latestPosts,
  getPublishedPageSlugs: h.pageSlugs,
  getPublishedProducts: async () => [],
  getTestimonials: async () => [],
  getRelatedPosts: async () => [],
  getFreeProduct: async () => null,
}))

/**
 * A strukturált adat építőinek bemenete (a /kapcsolat route-teszthez). A két
 * függvény az eredetit hívja, csak feljegyzi, milyen szekciósort kapott; így
 * mérhető, hogy a JSON-LD a Tudástár-szűrt sorból épül-e.
 */
const sg = vi.hoisted(() => ({ kapcsolatAdatSorok: [] as unknown[], csapatSorok: [] as unknown[] }))
vi.mock('@/lib/seo-graph', async (importOriginal) => {
  const eredeti = await importOriginal<typeof import('../lib/seo-graph')>()
  return {
    ...eredeti,
    contactDataFromLayout: (layout: Parameters<typeof eredeti.contactDataFromLayout>[0]) => {
      sg.kapcsolatAdatSorok.push(layout)
      return eredeti.contactDataFromLayout(layout)
    },
    teamPersonsFromLayout: (layout: Parameters<typeof eredeti.teamPersonsFromLayout>[0]) => {
      sg.csapatSorok.push(layout)
      return eredeti.teamPersonsFromLayout(layout)
    },
  }
})

import HomePage from '../app/(frontend)/page'
import CmsPage, { generateMetadata as cmsMetadata } from '../app/(frontend)/[slug]/page'
import { generateMetadata as blogPostMetadata } from '../app/(frontend)/blog/[slug]/page'
import KapcsolatPage from '../app/(frontend)/kapcsolat/page'
import NotFound from '../app/(frontend)/not-found'
import GlobalNotFound from '../app/global-not-found'

// ---------------------------------------------------------------------------
// Fixtúrák
// ---------------------------------------------------------------------------

const text = (value: string) => ({ type: 'text', text: value, format: 0, version: 1 })
const link = (fields: Record<string, unknown>, label: string) => ({
  type: 'link',
  fields: { newTab: false, ...fields },
  children: [text(label)],
  version: 3,
})
const paragraph = (...children: unknown[]) => ({ type: 'paragraph', children, version: 1 })
const richText = (...children: unknown[]) => ({
  root: { type: 'root', children, direction: null, format: '', indent: 0, version: 1 },
})

const logo: Media = {
  id: 1,
  url: '/media/partner.png',
  alt: 'Partner logó',
  width: 200,
  height: 80,
  createdAt: '2026-09-22T00:00:00.000Z',
  updatedAt: '2026-09-22T00:00:00.000Z',
}

const post = (id: number, slug: string): Post =>
  ({
    id,
    title: `Cikk ${id}`,
    slug,
    excerpt: 'Kivonat.',
    status: 'published',
    publishedAt: '2026-09-01T00:00:00.000Z',
    categories: [],
    updatedAt: '2026-09-01T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
  }) as unknown as Post

/** Minden linket hordozó blokktípus, vegyesen Tudástár- és más célokkal. */
function linkesLayout(): LayoutBlock[] {
  return [
    {
      blockType: 'filmHero',
      id: 'film',
      title: 'Nyitó cím',
      ctas: [
        { id: 'c1', felirat: 'Kurzusok', url: '/kurzusok', ujAblakban: false },
        { id: 'c2', felirat: 'Olvasd a Tudástárt', url: '/blog/', ujAblakban: false },
      ],
      sectionSettings: {},
    },
    {
      blockType: 'credsStrip',
      id: 'creds',
      items: [{ id: 'i1', text: 'Akkreditált képzés' }],
      link: { felirat: 'Cikkek', url: 'https://www.kineticare.hu/blog', ujAblakban: false },
      sectionSettings: {},
    },
    {
      blockType: 'services',
      id: 'svc',
      title: 'Merre tovább?',
      rows: [
        {
          id: 'r1',
          title: 'Rendelő',
          body: 'Kezelés.',
          felirat: 'Kérj időpontot',
          url: '/kapcsolat',
        },
        {
          id: 'r2',
          title: 'Olvasnivaló',
          body: 'Cikkek.',
          felirat: 'Olvasd el',
          url: '/blog/pattano-ujj',
        },
        {
          id: 'r3',
          title: 'Tünet',
          body: 'Hub.',
          felirat: 'Tudj meg többet',
          url: '/keztoalagut-szindroma#gyik',
        },
      ],
      sectionSettings: {},
    },
    {
      blockType: 'pressLogos',
      id: 'press',
      logos: [
        { id: 'l1', image: logo, alt: 'Tudástár partner', url: '/blog/kategoria/kez-es-csuklo' },
        { id: 'l2', image: logo, alt: 'Rólunk partner', url: '/rolunk' },
      ],
      sectionSettings: {},
    },
    {
      blockType: 'teamMembers',
      id: 'team',
      title: 'Csapat',
      bookingLink: { felirat: 'Tudástár', url: '/blog', ujAblakban: false },
      members: [
        {
          id: 'm1',
          name: 'Kocsis Kata',
          role: 'Gyógytornász',
          link: { felirat: 'Cikkei', url: '/blog?szerzo=kata', ujAblakban: false },
        },
        {
          id: 'm2',
          name: 'Kiss Kata',
          role: 'Gyógytornász',
          link: { felirat: 'Szakmai háttér', url: '/rolunk#szakmai-hatter', ujAblakban: false },
        },
      ],
      sectionSettings: {},
    },
    {
      blockType: 'richText',
      id: 'rt',
      content: richText(
        paragraph(
          text('Bővebben a '),
          link({ linkType: 'custom', url: '/blog/teniszkonyok' }, 'teniszkönyökről'),
          text('.'),
        ),
        paragraph(link({ linkType: 'custom', url: '/blog' }, 'Irány a Tudástár')),
        paragraph(
          link(
            {
              linkType: 'internal',
              doc: { relationTo: 'posts', value: { id: 3, slug: 'inhuvelygyulladas' } },
            },
            'ínhüvely',
          ),
          text(' és '),
          link(
            {
              linkType: 'internal',
              doc: { relationTo: 'pages', value: { id: 9, slug: 'pattano-ujj' } },
            },
            'pattanó ujj',
          ),
          text(' és '),
          link(
            {
              linkType: 'internal',
              doc: { relationTo: 'pages', value: { id: 3, slug: 'rolunk' } },
            },
            'rólunk',
          ),
        ),
      ),
      sectionSettings: {},
    },
    {
      blockType: 'accordion',
      id: 'acc',
      title: 'Részletek',
      items: [
        {
          id: 'a1',
          cim: 'Ajánlott olvasmány',
          tartalom: richText(
            paragraph(
              text('Lásd a '),
              {
                type: 'autolink',
                fields: { url: 'https://kineticare.hu/befagyott-vall' },
                children: [text('vállról szóló cikket')],
                version: 2,
              },
              text(' és a '),
              link({ linkType: 'custom', url: '/kurzusok' }, 'kurzusokat'),
              text('.'),
            ),
          ),
        },
      ],
      sectionSettings: {},
    },
    {
      blockType: 'ctaBanner',
      id: 'cta',
      title: 'Olvass tovább',
      text: 'Szakmai cikkek.',
      cta: { felirat: 'Megnézem a Tudástárt', url: '/blog', ujAblakban: false },
      sectionSettings: {},
    },
    {
      blockType: 'freeSos',
      id: 'sos',
      title: 'Ingyenes villámkurzus',
      cta: { felirat: 'Tudástár', url: '/blog', ujAblakban: false },
      sectionSettings: {},
    },
    {
      blockType: 'knowledge',
      id: 'know',
      heading: 'Legfrissebb a tudástárból',
      limit: 3,
      sectionSettings: {},
    },
  ] as unknown as LayoutBlock[]
}

// ---------------------------------------------------------------------------
// HTML-mérők
// ---------------------------------------------------------------------------

const hrefs = (html: string): string[] =>
  [...html.matchAll(/\bhref="([^"]*)"/g)].map((match) => match[1].replace(/&amp;/g, '&'))
const tudastarHrefek = (html: string): string[] =>
  hrefs(html).filter((href) => isTudastarHref(href))

/** Az `<a>` és `<button>` elemek, amelyeknek nincs hozzáférhető neve. */
function feliratNelkuliVezerlok(html: string): string[] {
  const hibak: string[] = []
  for (const match of html.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const [teljes, , attrs, belso] = match
    const szoveg = belso
      .replace(/<img\b[^>]*\balt="([^"]+)"[^>]*>/g, ' $1 ')
      .replace(/<[^>]+>/g, '')
      .trim()
    if (szoveg.length === 0 && !/\baria-label="[^"]+"/.test(attrs)) hibak.push(teljes)
  }
  return hibak
}

function renderLayout(layout: LayoutBlock[], posts: Post[] = []): string {
  return renderToStaticMarkup(
    <RenderBlocks layout={layout} posts={posts} products={[]} testimonials={[]} />,
  )
}

beforeEach(() => {
  h.lathato = true
  h.draft = false
  h.page = null
  h.home = null
  h.post = null
  h.latestPosts.mockReset()
  h.latestPosts.mockResolvedValue([post(1, 'kezrehabilitacio-alapok'), post(2, 'pattano-ujj')])
  h.pageSlugs.mockReset()
  h.pageSlugs.mockResolvedValue(new Set<string>())
})

afterEach(() => {
  h.lathato = true
})

// ---------------------------------------------------------------------------
// 1. A tiszta szűrő
// ---------------------------------------------------------------------------

describe('layoutTudastarLinkekNelkul — a szabályok', () => {
  const szurt = layoutTudastarLinkekNelkul(linkesLayout())
  const blokk = <T extends LayoutBlock['blockType']>(type: T) =>
    szurt.find((block) => block.blockType === type) as Extract<LayoutBlock, { blockType: T }>

  it('a bemenetet nem módosítja (mélyen fagyasztott bemenettel is fut)', () => {
    const bemenet = linkesLayout()
    const elotte = JSON.stringify(bemenet)
    const fagyaszt = (value: unknown): void => {
      if (typeof value === 'object' && value !== null) {
        Object.freeze(value)
        for (const child of Object.values(value)) fagyaszt(child)
      }
    }
    fagyaszt(bemenet)
    expect(() => layoutTudastarLinkekNelkul(bemenet)).not.toThrow()
    expect(JSON.stringify(bemenet)).toBe(elotte)
  })

  it('a blokkok száma és sorrendje változatlan', () => {
    expect(szurt.map((block) => block.blockType)).toEqual(
      linkesLayout().map((block) => block.blockType),
    )
  })

  it('tiszta link-tömbből (Nyitó videó gombjai) az elem kikerül, a többi marad', () => {
    expect(blokk('filmHero').ctas).toEqual([
      { id: 'c1', felirat: 'Kurzusok', url: '/kurzusok', ujAblakban: false },
    ])
  })

  it('csoportban és tartalmi sorban a cél és a felirat ürül, a sor tartalma marad', () => {
    expect(blokk('ctaBanner').cta).toEqual({ felirat: null, url: null, ujAblakban: false })
    expect(blokk('credsStrip').link).toEqual({ felirat: null, url: null, ujAblakban: false })
    const rows = blokk('services').rows ?? []
    expect(rows[0]).toMatchObject({
      title: 'Rendelő',
      felirat: 'Kérj időpontot',
      url: '/kapcsolat',
    })
    expect(rows[1]).toMatchObject({
      title: 'Olvasnivaló',
      body: 'Cikkek.',
      felirat: null,
      url: null,
    })
    expect(rows[2]).toMatchObject({ title: 'Tünet', felirat: null, url: null })
    const logos = blokk('pressLogos').logos ?? []
    expect(logos[0]).toMatchObject({ alt: 'Tudástár partner', url: null })
    expect(logos[1]).toMatchObject({ alt: 'Rólunk partner', url: '/rolunk' })
    const team = blokk('teamMembers')
    expect(team.bookingLink).toEqual({ felirat: null, url: null, ujAblakban: false })
    expect(team.members?.[0]?.link).toEqual({ felirat: null, url: null, ujAblakban: false })
    expect(team.members?.[1]?.link?.url).toBe('/rolunk#szakmai-hatter')
  })

  it('a nem érintett blokk referenciája sem változik feleslegesen', () => {
    const layout = [
      { blockType: 'usps', id: 'u', title: 'Miért mi', cards: [] },
    ] as unknown as LayoutBlock[]
    expect(layoutTudastarLinkekNelkul(layout)[0]).toBe(layout[0])
  })
})

describe('lexicalTudastarLinkekNelkul — a link kibomlik, a szöveg marad', () => {
  it('egyedi url, belső cikk és belső hub-oldal kibomlik; más belső oldal marad', () => {
    const tartalom = richText(
      paragraph(
        link({ linkType: 'custom', url: '/blog/teniszkonyok' }, 'teniszkönyök'),
        link({ linkType: 'internal', doc: { relationTo: 'posts', value: 7 } }, 'cikk'),
        link(
          { linkType: 'internal', doc: { relationTo: 'pages', value: { slug: 'kez-zsibbadas' } } },
          'hub',
        ),
        link(
          { linkType: 'internal', doc: { relationTo: 'pages', value: { slug: 'rolunk' } } },
          'rólunk',
        ),
        {
          type: 'autolink',
          fields: { url: 'https://www.kineticare.hu/blog' },
          children: [text('auto')],
        },
      ),
    )
    const szurt = lexicalTudastarLinkekNelkul(tartalom)
    const elsoBekezdes = szurt.root.children[0] as {
      children: Array<{ type: string; text?: string }>
    }
    const gyerekek = elsoBekezdes.children
    expect(gyerekek.map((child) => child.type)).toEqual(['text', 'text', 'text', 'link', 'text'])
    expect(gyerekek.map((child) => child.text ?? 'LINK')).toEqual([
      'teniszkönyök',
      'cikk',
      'hub',
      'LINK',
      'auto',
    ])
  })

  it('nem Lexical bemenetre változatlanul visszaadja, és nem módosít', () => {
    expect(lexicalTudastarLinkekNelkul(null)).toBeNull()
    expect(lexicalTudastarLinkekNelkul('szöveg')).toBe('szöveg')
    const tartalom = richText(paragraph(link({ linkType: 'custom', url: '/blog' }, 'x')))
    const elotte = JSON.stringify(tartalom)
    lexicalTudastarLinkekNelkul(tartalom)
    expect(JSON.stringify(tartalom)).toBe(elotte)
  })
})

// ---------------------------------------------------------------------------
// 2. RenderBlocks a szűrt szekciósorral
// ---------------------------------------------------------------------------

describe('RenderBlocks — a szűrt szekciósor minden linkes blokktípussal', () => {
  const posts = [post(1, 'kezrehabilitacio-alapok')]

  it('kontroll: szűrés nélkül a fixtúra tényleg hordoz Tudástár-linkeket', () => {
    expect(tudastarHrefek(renderLayout(linkesLayout(), posts)).length).toBeGreaterThanOrEqual(8)
  })

  it('szűrve 0 Tudástár-href, 0 üres href, 0 felirat nélküli link vagy gomb', () => {
    const html = renderLayout(layoutTudastarLinkekNelkul(linkesLayout()), [])
    expect(tudastarHrefek(html)).toEqual([])
    expect(hrefs(html).filter((href) => href.trim().length === 0)).toEqual([])
    expect(feliratNelkuliVezerlok(html)).toEqual([])
    expect(html).not.toContain('kc-knowledge')
  })

  it('szűrve a nem Tudástár célok és a link-szövegek megmaradnak', () => {
    const html = renderLayout(layoutTudastarLinkekNelkul(linkesLayout()), [])
    for (const cel of ['/kurzusok', '/kapcsolat', '/rolunk', '/rolunk#szakmai-hatter']) {
      expect(hrefs(html), cel).toContain(cel)
    }
    for (const szoveg of [
      'teniszkönyökről',
      'Irány a Tudástár',
      'ínhüvely',
      'pattanó ujj',
      'vállról szóló cikket',
    ]) {
      expect(html, szoveg).toContain(szoveg)
    }
    expect(html).toContain('Olvasnivaló')
    expect(html).toContain('Tudástár partner')
  })
})

// ---------------------------------------------------------------------------
// 3. Route-ok
// ---------------------------------------------------------------------------

const cmsPage = (slug: string, layout: LayoutBlock[] = linkesLayout()): Page =>
  ({
    id: 5,
    title: 'Rólunk',
    slug,
    excerpt: 'Bevezető.',
    content: richText(paragraph(text('Szöveg.'))),
    layout,
    status: 'published',
    updatedAt: '2026-09-22T00:00:00.000Z',
    createdAt: '2026-09-22T00:00:00.000Z',
  }) as unknown as Page

describe('CMS-oldal route ([slug]) — a kapcsoló követése', () => {
  const render = async (slug: string) =>
    renderToStaticMarkup(await CmsPage({ params: Promise.resolve({ slug }) }))

  it('bekapcsolva a Tudástár-ajánló és a linkek megjelennek, a posztok lekérdezése fut', async () => {
    h.page = cmsPage('rolunk')
    const html = await render('rolunk')
    expect(h.latestPosts).toHaveBeenCalledTimes(1)
    expect(html).toContain('kc-knowledge')
    expect(tudastarHrefek(html).length).toBeGreaterThan(0)
  })

  it('kikapcsolva 0 Tudástár-href, nincs ajánló, és posztlekérdezés sem fut', async () => {
    h.lathato = false
    h.page = cmsPage('rolunk')
    const html = await render('rolunk')
    expect(tudastarHrefek(html)).toEqual([])
    expect(html).not.toContain('kc-knowledge')
    expect(h.latestPosts).not.toHaveBeenCalled()
    expect(h.pageSlugs).not.toHaveBeenCalled()
  })

  it('kikapcsolva a rich-text tartalmú lap linkje is kibomlik', async () => {
    h.lathato = false
    h.page = {
      ...cmsPage('adatvedelem', []),
      content: richText(
        paragraph(text('Lásd: '), link({ linkType: 'custom', url: '/blog' }, 'Tudástár')),
      ),
    }
    const html = await render('adatvedelem')
    expect(tudastarHrefek(html)).toEqual([])
    expect(html).toContain('Tudástár')
  })

  it('kikapcsolva a strukturált adat sem hirdet Tudástár-címet (Service url)', async () => {
    h.lathato = false
    h.page = cmsPage('szolgaltatasok')
    const html = await render('szolgaltatasok')
    const jsonLd = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((match) => match[1])
      .join('\n')
    expect(jsonLd).not.toMatch(/\/blog|keztoalagut-szindroma|pattano-ujj/)
  })
})

describe('metaadat — Tudástár-lapok noindex, follow kikapcsolva', () => {
  const NOINDEX_FOLLOW = { index: false, follow: true, googleBot: { index: false, follow: true } }

  it('a tünet-hub: bekapcsolva nincs robots-korlát, kikapcsolva noindex, follow', async () => {
    h.page = cmsPage('pattano-ujj', [])
    h.post = post(2, 'pattano-ujj')
    const props = { params: Promise.resolve({ slug: 'pattano-ujj' }) }
    expect((await cmsMetadata(props)).robots).toBeUndefined()
    h.lathato = false
    expect((await cmsMetadata(props)).robots).toEqual(NOINDEX_FOLLOW)
  })

  it('a forrás-cikk nélküli hub is noindex kikapcsolva', async () => {
    h.lathato = false
    h.page = cmsPage('pattano-ujj', [])
    h.post = null
    expect(
      (await cmsMetadata({ params: Promise.resolve({ slug: 'pattano-ujj' }) })).robots,
    ).toEqual(NOINDEX_FOLLOW)
  })

  it('nem hub CMS-oldal kikapcsolva is indexelhető marad', async () => {
    h.lathato = false
    h.page = cmsPage('rolunk')
    expect(
      (await cmsMetadata({ params: Promise.resolve({ slug: 'rolunk' }) })).robots,
    ).toBeUndefined()
  })

  it('a /blog/<cikk> kikapcsolva noindex, follow; bekapcsolva nincs robots-korlát', async () => {
    h.post = post(1, 'kezrehabilitacio-alapok')
    const props = { params: Promise.resolve({ slug: 'kezrehabilitacio-alapok' }) }
    expect((await blogPostMetadata(props)).robots).toBeUndefined()
    h.lathato = false
    expect((await blogPostMetadata(props)).robots).toEqual(NOINDEX_FOLLOW)
  })

  it('előnézetben (draft) a noindex, nofollow marad az erősebb, kikapcsolva is', async () => {
    h.lathato = false
    h.draft = true
    h.post = post(1, 'kezrehabilitacio-alapok')
    expect(
      (await blogPostMetadata({ params: Promise.resolve({ slug: 'kezrehabilitacio-alapok' }) }))
        .robots,
    ).toEqual({ index: false, follow: false })
    h.page = cmsPage('pattano-ujj', [])
    h.post = post(2, 'pattano-ujj')
    expect(
      (await cmsMetadata({ params: Promise.resolve({ slug: 'pattano-ujj' }) })).robots,
    ).toEqual({
      index: false,
      follow: false,
    })
  })
})

describe('kezdőlap route — a kapcsoló követése', () => {
  it('bekapcsolva a Tudástár-ajánló megjelenik', async () => {
    h.home = cmsPage('kezdolap', [
      { blockType: 'knowledge', id: 'k', limit: 3, sectionSettings: {} },
    ] as unknown as LayoutBlock[])
    const html = renderToStaticMarkup(await HomePage())
    expect(html).toContain('kc-knowledge')
    expect(h.latestPosts).toHaveBeenCalledTimes(1)
  })

  it('kikapcsolva 0 Tudástár-href, nincs ajánló, posztlekérdezés sem fut', async () => {
    h.lathato = false
    h.home = cmsPage('kezdolap')
    const html = renderToStaticMarkup(await HomePage())
    expect(tudastarHrefek(html)).toEqual([])
    expect(html).not.toContain('kc-knowledge')
    expect(h.latestPosts).not.toHaveBeenCalled()
    expect(h.pageSlugs).not.toHaveBeenCalled()
  })

  it('kikapcsolva a rögzített (szekciósor nélküli) kezdőlapon sincs Tudástár', async () => {
    h.lathato = false
    h.home = null
    const html = renderToStaticMarkup(await HomePage())
    expect(tudastarHrefek(html)).toEqual([])
    expect(html).not.toContain('kc-knowledge')
  })
})

describe('404 — Tudástár-javaslat csak bekapcsolva', () => {
  it('a (frontend) not-found bekapcsolva javasolja a Tudástárt, kikapcsolva nem', async () => {
    expect(hrefs(renderToStaticMarkup(await NotFound()))).toContain('/blog')
    h.lathato = false
    const html = renderToStaticMarkup(await NotFound())
    expect(tudastarHrefek(html)).toEqual([])
    expect(hrefs(html)).toEqual(expect.arrayContaining(['/kurzusok', '/', '/kapcsolat']))
  })

  it('a global-not-found (statikusan előrenderelt) sosem javasolja', () => {
    const html = renderToStaticMarkup(<GlobalNotFound />)
    expect(tudastarHrefek(html)).toEqual([])
    expect(hrefs(html)).toEqual(expect.arrayContaining(['/kurzusok', '/', '/kapcsolat']))
  })

  it('a NotFoundView alapértelmezése a bekapcsolt állapot (DB nélkül is renderelhető)', () => {
    expect(hrefs(renderToStaticMarkup(<NotFoundView />))).toContain('/blog')
    expect(tudastarHrefek(renderToStaticMarkup(<NotFoundView tudastarLathato={false} />))).toEqual(
      [],
    )
  })
})

// ---------------------------------------------------------------------------
// 4. A /kapcsolat route (kódbeli útvonal, CMS-szekciósorral)
// ---------------------------------------------------------------------------

/**
 * A /kapcsolat dedikált route, de a szekciósorát a `kapcsolat` slugú CMS-oldal
 * adja. A szerkesztő ide is tehet Tudástár-linket (időpontkérő mellé CTA-t,
 * szakember-kártya linkjét, rich textet), ezért a kapcsolót ez a lap is követi.
 */
describe('/kapcsolat route — a kapcsoló követése', () => {
  const IDOPONTKERES = '#idopontkeres'

  /** Időpontkérő, szakember-kártyák és minden más linkes blokktípus, vegyes célokkal. */
  function kapcsolatLayout(): LayoutBlock[] {
    return [
      {
        blockType: 'appointment',
        id: 'idopont',
        title: 'Kérj időpontot',
        helyszinek: [{ id: 'h1', cim: '1117 Budapest, Nádorliget u. 7/b' }],
        telefonszamok: [{ id: 't1', nev: 'Kocsis Kata', szam: '+36 30 169 2263' }],
        email: 'info@kineticare.hu',
        sectionSettings: { anchorId: 'idopontkeres' },
      },
      {
        blockType: 'teamMembers',
        id: 'kapcsolat-csapat',
        title: 'Hívd közvetlenül a gyógytornászt',
        bookingLink: { felirat: 'Kérj időpontot üzenetben', url: IDOPONTKERES, ujAblakban: false },
        members: [
          {
            id: 'k1',
            name: 'Kocsis Kata',
            role: 'Gyógytornász',
            bio: 'Kézterápiával foglalkozik.',
            phone: '+36 30 169 2263',
            link: { felirat: 'Olvasd el a cikkét', url: '/blog/pattano-ujj', ujAblakban: false },
          },
          {
            id: 'k2',
            name: 'Kiss Kata',
            role: 'Gyógytornász',
            phone: '+36 20 357 3493',
            link: { felirat: 'Tünetek', url: '/keztoalagut-szindroma', ujAblakban: false },
          },
        ],
        sectionSettings: {},
      },
      ...linkesLayout().filter((block) => block.blockType !== 'teamMembers'),
    ] as unknown as LayoutBlock[]
  }

  const kapcsolatOldal = (layout: LayoutBlock[] = kapcsolatLayout()): Page =>
    ({ ...cmsPage('kapcsolat', layout), title: 'Kapcsolat' }) as Page

  const render = async () => renderToStaticMarkup(await KapcsolatPage())

  const jsonLdSzoveg = (html: string): string =>
    [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((match) => match[1])
      .join('\n')

  beforeEach(() => {
    sg.kapcsolatAdatSorok.length = 0
    sg.csapatSorok.length = 0
  })

  it('kontroll: a fixtúra minden fajta Tudástár-linket hordoz', () => {
    const html = renderLayout(kapcsolatLayout())
    expect(tudastarHrefek(html)).toEqual(
      expect.arrayContaining([
        '/blog',
        'https://www.kineticare.hu/blog',
        '/blog/pattano-ujj',
        '/blog/teniszkonyok',
        '/blog/kategoria/kez-es-csuklo',
        '/blog/inhuvelygyulladas',
        '/keztoalagut-szindroma',
        '/pattano-ujj',
      ]),
    )
  })

  it('kikapcsolva 0 Tudástár-href, nincs üres href vagy felirat nélküli link, a JSON-LD-ben sincs /blog', async () => {
    h.lathato = false
    h.page = kapcsolatOldal()
    const html = await render()
    expect(tudastarHrefek(html)).toEqual([])
    expect(hrefs(html).filter((href) => href.trim().length === 0)).toEqual([])
    expect(feliratNelkuliVezerlok(html)).toEqual([])
    const jsonLd = jsonLdSzoveg(html)
    expect(jsonLd.length).toBeGreaterThan(0)
    expect(jsonLd).not.toContain('/blog')
    expect(jsonLd).not.toMatch(/keztoalagut-szindroma|pattano-ujj/)
    // A strukturált adat tartalma közben megmarad: cím, e-mail, szakemberek.
    expect(jsonLd).toContain('Nádorliget u. 7/b')
    expect(jsonLd).toContain('info@kineticare.hu')
    expect(jsonLd).toContain('Kocsis Kata')
  })

  it('kikapcsolva a strukturált adat építői a szűrt szekciósort kapják', async () => {
    h.lathato = false
    h.page = kapcsolatOldal()
    await render()
    const szurt = layoutTudastarLinkekNelkul(kapcsolatLayout())
    expect(sg.kapcsolatAdatSorok).toEqual([szurt])
    expect(sg.csapatSorok).toEqual([szurt])
  })

  it('bekapcsolva a Tudástár-linkek megjelennek, és a sor szűretlen', async () => {
    h.page = kapcsolatOldal()
    const html = await render()
    expect(tudastarHrefek(html)).toEqual(
      expect.arrayContaining([
        '/blog',
        '/blog/pattano-ujj',
        '/blog/teniszkonyok',
        '/keztoalagut-szindroma',
      ]),
    )
    expect(sg.kapcsolatAdatSorok).toEqual([kapcsolatLayout()])
    expect(sg.csapatSorok).toEqual([kapcsolatLayout()])
  })

  it('a nem Tudástár célok és a lap szerkezete mindkét állapotban megmarad', async () => {
    for (const lathato of [true, false]) {
      h.lathato = lathato
      h.page = kapcsolatOldal()
      const html = await render()
      for (const cel of ['/kurzusok', IDOPONTKERES, '/rolunk', '/kapcsolat']) {
        expect(hrefs(html), `${cel} (látható: ${lathato})`).toContain(cel)
      }
      expect(html).toContain('<h1>Kapcsolat</h1>')
      expect(html).toContain('id="idopontkeres"')
      expect(html).toContain('Kocsis Kata')
      expect(html).toContain('Olvasnivaló')
    }
  })

  it('CMS-oldal nélkül (üres szekciósor) kikapcsolva is csak a lapfej renderel', async () => {
    h.lathato = false
    h.page = null
    const html = await render()
    expect(html).toContain('<h1>Kapcsolat</h1>')
    expect(tudastarHrefek(html)).toEqual([])
  })
})
