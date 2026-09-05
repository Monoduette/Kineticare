import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FilmHero } from '../components/blocks/FilmHero'
import { RenderBlocks } from '../components/blocks/RenderBlocks'
import { HomeView } from '../components/content/HomeView'
import { HeroCta } from '../components/content/home/HeroCta'
import { Button } from '../components/ui/Button'
import { ctaLabel } from '../lib/cta-vocabulary'
import type { BlockFilmHero, BlockFreeSos, Page, Product } from '../payload-types'

const product = (overrides: Partial<Product> = {}): Product =>
  ({
    id: 2,
    slug: 'sos-kezrelax-villamkurzus',
    displayTitle: 'SOS tesztkurzus',
    status: 'published',
    _status: 'published',
    priceInHUFEnabled: false,
    ...overrides,
  }) as Product

const film: BlockFilmHero = {
  blockType: 'filmHero',
  title: 'Tesztfilm',
  ctas: [
    { url: '/kurzusok', felirat: ctaLabel('course-list-open') },
    { url: '#ingyenes', felirat: ctaLabel('free-strip-jump') },
  ],
}
const sos: BlockFreeSos = { blockType: 'freeSos', title: 'Ingyenes SOS', id: 'sos' }
type Layout = NonNullable<Page['layout']>
const unrelatedFree = product({
  id: 9,
  slug: 'masik-ingyenes',
  displayTitle: 'Másik ingyenes kurzus',
})
const unavailable: [string, Product[]][] = [
  ['üres', []],
  ['fizetős', [product({ priceInHUFEnabled: true, priceInHUF: 10000 })]],
  ['nulla ár, de nem explicit ingyenes', [product({ priceInHUFEnabled: true, priceInHUF: 0 })]],
  ['hiányos ár', [product({ priceInHUFEnabled: true, priceInHUF: null })]],
  ['hiányzó árkapcsoló', [product({ priceInHUFEnabled: undefined })]],
  ['draft', [product({ status: 'draft' })]],
  ['Payload draft', [product({ _status: 'draft' })]],
  ['Payload null státusz', [product({ _status: null })]],
  ['hiányzó Payload státusz', [product({ _status: undefined })]],
  ['archived', [product({ status: 'archived' })]],
  ['csak másik ingyenes kurzus', [unrelatedFree]],
  ['draft SOS és másik ingyenes kurzus', [unrelatedFree, product({ status: 'draft' })]],
  [
    'fizetős SOS és másik ingyenes kurzus',
    [unrelatedFree, product({ priceInHUFEnabled: true, priceInHUF: 10000 })],
  ],
  ['archived SOS és másik ingyenes kurzus', [unrelatedFree, product({ status: 'archived' })]],
  ['slug nélküli ingyenes kurzus', [product({ slug: null })]],
]

function blocks(layout: Layout, products: Product[] = []) {
  return renderToStaticMarkup(
    createElement(RenderBlocks, { layout, products, posts: [], testimonials: [] }),
  )
}

function expectNoFreeReference(html: string) {
  expect(html).not.toContain(ctaLabel('free-strip-jump'))
  expect(html).not.toContain('href="#ingyenes"')
  expect(html).not.toContain('ingyenes SOS gyakorlatok')
  expect(html).not.toContain('Elindítom ingyen')
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Hálózat tiltva a hero-tesztben')
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('P1: a rögzített hero és az SOS ugyanazt az ellenőrzött terméket használja', () => {
  it('HeroCta adat nélkül nem állít ingyenes elérhetőséget', () => {
    const html = renderToStaticMarkup(createElement(HeroCta))
    expectNoFreeReference(html)
    expect(html).toContain('href="/kurzusok"')
  })

  it.each(unavailable)(
    '%s kínálatnál nincs hero-ígéret, de van semleges továbblépés',
    (_, products) => {
      const html = renderToStaticMarkup(
        createElement(HomeView, { home: null, products, posts: [] }),
      )
      expectNoFreeReference(html)
      expect(html).toContain('>Kurzusaink</h2>')
      expect(html).toContain('href="/kurzusok"')
    },
  )

  it('a hiányos termék nem takarja el a későbbi explicit ingyenes terméket', () => {
    const html = renderToStaticMarkup(
      createElement(HomeView, {
        home: null,
        products: [product({ id: 1, priceInHUFEnabled: undefined }), product()],
        posts: [],
      }),
    )
    expect(html).toContain(ctaLabel('free-strip-jump'))
    expect(html).toContain('href="#ingyenes"')
    expect(html).toContain('href="/kurzusok/sos-kezrelax-villamkurzus"')
    expect(html).toContain('Elindítom ingyen')
  })
})

describe('P1: FilmHero és a generikus CMS-oldalak SOS-elérhetősége', () => {
  it.each([true, false])(
    'csak a kanonikus SOS-t ajánlja, függetlenül a másik ingyenes kurzus sorrendjétől: %s',
    (unrelatedFirst) => {
      const products = unrelatedFirst ? [unrelatedFree, product()] : [product(), unrelatedFree]
      const outputs = [
        blocks([film, sos], products),
        renderToStaticMarkup(createElement(HomeView, { home: null, products, posts: [] })),
      ]
      for (const html of outputs) {
        expect(html).toContain('href="/kurzusok/sos-kezrelax-villamkurzus"')
        expect(html).toContain(ctaLabel('free-strip-jump'))
        expect(html).toContain('Elindítom ingyen')
        expect(html).not.toContain('href="/kurzusok/masik-ingyenes"')
        expect(html).not.toContain('Másik ingyenes kurzus')
      }
    },
  )
  it('önálló FilmHero hiányzó adatból nem feltételez ingyenes kínálatot', () => {
    const html = renderToStaticMarkup(createElement(FilmHero, { block: film }))
    expectNoFreeReference(html)
    expect(html).toContain('href="/kurzusok"')
    expect(html).toContain('A következő mozdulat a tiéd')
  })

  it.each(unavailable)(
    '%s terméklista mellett a CMS filmsáv sem ígér ingyenes gyakorlatot',
    (_, products) => {
      const html = blocks([film, sos], products)
      expectNoFreeReference(html)
      expect(html).toContain('>Kurzusaink</h2>')
    },
  )

  it('a CMS HomeView továbbadja az explicit ingyenes terméket a filmsávhoz', () => {
    const home = { title: 'Teszt kezdőlap', layout: [film, sos] } as Page
    const html = renderToStaticMarkup(
      createElement(HomeView, {
        home,
        products: [product()],
        posts: [],
      }),
    )
    expect(html).toContain(ctaLabel('free-strip-jump'))
    expect(html).toContain('href="#ingyenes"')
    expect(html).toContain('ingyenes SOS gyakorlatok')
    expect(html).toContain('Elindítom ingyen')
  })

  it.each(unavailable)(
    '%s kínálattal a CMS HomeView is a semleges állapotot adja tovább',
    (_, products) => {
      const html = renderToStaticMarkup(
        createElement(HomeView, {
          home: { title: 'Teszt kezdőlap', layout: [film, sos] } as Page,
          products,
          posts: [],
        }),
      )
      expectNoFreeReference(html)
      expect(html).toContain('>Kurzusaink</h2>')
    },
  )

  it.each([
    ['hiányzó szekció', [film]],
    ['rejtett szekció', [film, { ...sos, sectionSettings: { visible: false } }]],
    ['a film előtti szekció', [sos, film]],
  ] satisfies [string, Layout][])(
    '%s esetén nincs lentebbi ajánlatot ígérő filmsáv',
    (_, layout) => {
      const html = blocks(layout, [product()])
      expect(html).not.toContain(ctaLabel('free-strip-jump'))
      expect(html).not.toContain('href="#ingyenes"')
      expect(html).not.toContain('ingyenes SOS gyakorlatok')
    },
  )

  it('a látható SOS egyedi horgonyára igazítja a régi #ingyenes linket', () => {
    const html = blocks([film, { ...sos, sectionSettings: { anchorId: 'proba' } }], [product()])
    expect(html).toContain('href="#proba"')
    expect(html).toContain('id="proba"')
    expect(html).not.toContain('href="#ingyenes"')
    expect(html).toContain('ingyenes SOS gyakorlatok')
  })

  it('az egyedi, rejtett SOS-horgonyra mutató CTA sem marad meg', () => {
    const html = blocks(
      [
        { ...film, ctas: [{ url: '#proba', felirat: ctaLabel('free-strip-jump') }] },
        { ...sos, sectionSettings: { anchorId: 'proba', visible: false } },
      ],
      [product()],
    )
    expectNoFreeReference(html)
    expect(html).not.toContain('href="#proba"')
  })

  it('ismételt SOS esetén a tényleges későbbi szekció azonosítóját használja', () => {
    const html = blocks([sos, film, { ...sos, id: 'masodik' }], [product()])
    expect(html).toContain('href="#ingyenes-masodik"')
    expect(html).toContain('id="ingyenes-masodik"')
    expect(html).toContain('ingyenes SOS gyakorlatok')
  })

  it('a gyökérre mutató SOS-ígéretet is elhagyja igazolt kínálat nélkül', () => {
    const html = renderToStaticMarkup(
      createElement(FilmHero, {
        block: { ...film, ctas: [{ url: '/#ingyenes', felirat: ctaLabel('free-strip-jump') }] },
      }),
    )
    expectNoFreeReference(html)
    expect(html).not.toContain('href="/#ingyenes"')
  })

  it('az egyéb szerkesztői linkek felirata és célja nem változik', () => {
    const html = blocks([
      {
        ...film,
        ctas: [
          { url: '/kurzusok', felirat: 'Saját kurzusfelirat' },
          { url: '#bemutatkozas', felirat: 'Ismerj meg minket' },
        ],
      },
    ])
    expect(html).toContain('Saját kurzusfelirat')
    expect(html).toContain('href="/kurzusok"')
    expect(html).toContain('Ismerj meg minket')
    expect(html).toContain('href="#bemutatkozas"')
  })
})

describe('P2: a közvetlen SOS-kurzuslink ugyanahhoz az ajánlati ellenőrzéshez tartozik', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://kineticare.hu')
    vi.stubEnv('EXTRA_ALLOWED_ORIGINS', 'https://cors-only.invalid')
  })
  const directTargets = [
    '/kurzusok/sos-kezrelax-villamkurzus',
    '/kurzusok/sos-kezrelax-villamkurzus/',
    '/kurzusok/sos-kezrelax-villamkurzus?utm_source=teszt',
    '/kurzusok/sos-kezrelax-villamkurzus#reszletek',
    ' /kurzusok/sos-kezrelax-villamkurzus/?utm_source=teszt#reszletek ',
    '/kurzusok/sos-kezrelax-villamkurzus?utm_source=teszt&utm_medium=email#reszletek',
    '/kurzusok/%73os-kezrelax-villamkurzus',
    '/masik/../kurzusok/sos-kezrelax-villamkurzus',
    '/kezrelax',
    '/KezRelax',
    'https://kineticare.hu/KEZRELAX/',
    'https://kineticare.hu/kezrelax/?utm_source=teszt#reszletek',
    ...['https://kineticare.hu', 'https://www.kineticare.hu', 'https://KINETICARE.HU:443'].flatMap(
      (origin) => [
        `${origin}/kurzusok/sos-kezrelax-villamkurzus`,
        `${origin}/kurzusok/sos-kezrelax-villamkurzus/`,
        ` ${origin}/kurzusok/sos-kezrelax-villamkurzus/?utm_source=teszt#reszletek `,
        `${origin}/kurzusok/%73os-kezrelax-villamkurzus`,
      ],
    ),
  ]
  const customLabel = 'Próbáld ki ingyen a kézgyakorlatokat'
  const directFilm = (url: string): BlockFilmHero => ({
    ...film,
    ctas: [
      { url: '/kurzusok', felirat: 'Saját kurzusfelirat' },
      { url, felirat: customLabel, ujAblakban: true },
    ],
  })

  it.each(['draft', null, undefined] as const)(
    'published üzleti státusz mellett a Payload %s nem enged közvetlen vagy horgonyos ígéretet',
    (_status) => {
      const layout: Layout = [
        { ...film, ctas: [...directFilm(directTargets[0]).ctas!, ...film.ctas!] },
        sos,
      ]
      const products = [product({ _status })]
      const outputs = [
        blocks(layout, products),
        renderToStaticMarkup(
          createElement(HomeView, {
            home: { title: 'Teszt kezdőlap', layout } as Page,
            products,
            posts: [],
          }),
        ),
      ]
      for (const html of outputs) {
        expectNoFreeReference(html)
        expect(html).not.toContain(customLabel)
        expect(html).not.toContain(`href="${directTargets[0]}"`)
        expect(html).toContain('>Kurzusaink</h2>')
        expect(html).toContain('href="/kurzusok"')
      }
    },
  )

  it.each(directTargets)(
    'hiányzó/draft/fizetős SOS esetén a közvetlen link sem marad: %s',
    (url) => {
      for (const products of [
        [],
        [product({ status: 'draft' })],
        [product({ priceInHUFEnabled: true, priceInHUF: 10000 })],
        [unrelatedFree],
      ]) {
        const html = blocks([directFilm(url), sos], products)
        expect(html).not.toContain(customLabel)
        expect(html).not.toContain(`href="${url.trim()}"`)
        expect(html).not.toContain('ingyenes SOS gyakorlatok')
        expect(html).toContain('Saját kurzusfelirat')
        expect(html).toContain('href="/kurzusok"')
        expect(html).toContain('>Kurzusaink</h2>')
      }
    },
  )

  it.each(directTargets)(
    'igazolt SOS mellett a közvetlen cél, CMS-felirat és új lap megmarad: %s',
    (url) => {
      const html = blocks([directFilm(url), sos], [product()])
      // A Next Link meglévő záróperjel-normalizálása marad; a FilmHero nem
      // cserélheti a közvetlen célt horgonyra, és nem veszíthet query/hash-t.
      const baseline = renderToStaticMarkup(<Button href={url}>{customLabel}</Button>)
      const expectedHref = baseline.match(/href="[^"]*"/)?.[0]
      const customLink = html.match(new RegExp(`<a\\b[^>]*>${customLabel}</a>`))?.[0]
      expect(expectedHref).toBeDefined()
      expect(customLink).toContain(expectedHref)
      expect(customLink).toContain('target="_blank"')
      expect(html).toContain('ingyenes SOS gyakorlatok')
    },
  )

  it.each([
    '/kurzusok/masik-ingyenes',
    '/kurzusok/sos-kezrelax-villamkurzus-masolat',
    '/kurzusok/sos-kezrelax-villamkurzus/masik',
    '/kurzusok?next=/kurzusok/sos-kezrelax-villamkurzus',
    '/blog#sos-kezrelax-villamkurzus',
    'https://example.invalid/kurzusok/sos-kezrelax-villamkurzus',
    'https://example.invalid/kurzusok/sos-kezrelax-villamkurzus/?utm_source=teszt#reszletek',
    'https://example.invalid/#ingyenes',
    'https://kineticare.invalid/kurzusok/sos-kezrelax-villamkurzus',
    'https://kineticare.hu.example.invalid/kurzusok/sos-kezrelax-villamkurzus',
    'https://kineticare.hu@example.invalid/kurzusok/sos-kezrelax-villamkurzus',
    'https://kineticare.hu:8443/kurzusok/sos-kezrelax-villamkurzus',
    'http://kineticare.hu/kurzusok/sos-kezrelax-villamkurzus',
    'https://cors-only.invalid/kurzusok/sos-kezrelax-villamkurzus',
    '/kurzusok/%ZZsos-kezrelax-villamkurzus',
  ])('független vagy külső cél nem lesz helyi SOS-ajánlat: %s', (url) => {
    for (const freeSosHref of [null, '#ingyenes']) {
      const html = renderToStaticMarkup(
        createElement(FilmHero, {
          block: directFilm(url),
          freeSosHref,
        }),
      )
      expect(html).toContain(`href="${url}"`)
      expect(html).toContain(customLabel)
      expect(html).toContain('target="_blank"')
    }
  })

  it.each([
    '#ingyenes',
    '/?utm_source=teszt#ingyenes',
    'https://kineticare.hu/#ingyenes',
    'https://www.kineticare.hu/?utm_source=teszt#ingyenes',
    'https://kineticare.hu/#%69ngyenes',
    'https://kineticare.hu/#proba',
  ])('a saját SOS-horgony csak tényleges későbbi szekcióra mutathat: %s', (url) => {
    const anchoredSos = { ...sos, sectionSettings: { anchorId: 'proba' } }
    expect(
      renderToStaticMarkup(
        createElement(FilmHero, {
          block: directFilm(url),
          hasFreeSos: true,
          freeSosAnchorIds: ['proba'],
        }),
      ),
    ).not.toContain(customLabel)
    for (const layout of [
      [directFilm(url), { ...anchoredSos, sectionSettings: { anchorId: 'proba', visible: false } }],
      [anchoredSos, directFilm(url)],
    ] satisfies Layout[]) {
      expect(blocks(layout, [product()])).not.toContain(customLabel)
    }
    const html = blocks([directFilm(url), anchoredSos], [product()])
    const link = html.match(new RegExp(`<a\\b[^>]*>${customLabel}</a>`))?.[0]
    expect(link).toContain('href="#proba"')
    expect(link).toContain('target="_blank"')
    expect(blocks([directFilm(url), anchoredSos], [])).not.toContain(customLabel)
  })

  it('a konfigurált publikus origin a saját cél, nem a CORS-lista minden tagja', () => {
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://preview.example.test:8443')
    expect(
      blocks([directFilm('https://preview.example.test:8443/kurzusok/sos-kezrelax-villamkurzus')]),
    ).not.toContain(customLabel)
    expect(
      blocks([directFilm('https://kineticare.hu/kurzusok/sos-kezrelax-villamkurzus')]),
    ).toContain(customLabel)
  })

  it.each(['https://kineticare.hu', 'https://www.kineticare.hu'])(
    'Railway-primer mellett a konfigurált cutover domain is saját SOS-cél: %s',
    (origin) => {
      vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://kineticare-production.up.railway.app')
      vi.stubEnv(
        'EXTRA_ALLOWED_ORIGINS',
        'https://kineticare.hu, https://www.kineticare.hu, https://cors-only.invalid',
      )
      const url = `${origin}/kurzusok/sos-kezrelax-villamkurzus?utm_source=teszt#reszletek`
      for (const products of [
        [],
        [product({ _status: 'draft' })],
        [product({ priceInHUFEnabled: true, priceInHUF: 10000 })],
      ]) {
        expect(blocks([directFilm(url), sos], products)).not.toContain(customLabel)
        expect(blocks([directFilm(`${origin}/#ingyenes`), sos], products)).not.toContain(
          customLabel,
        )
      }
      for (const layout of [
        [directFilm(url)],
        [sos, directFilm(url)],
        [directFilm(url), { ...sos, sectionSettings: { visible: false } }],
      ] satisfies Layout[]) {
        expect(blocks(layout, [product()])).toContain(`href="${url}"`)
      }
      expect(
        blocks(
          [directFilm(`${origin}/#ingyenes`), { ...sos, sectionSettings: { anchorId: 'proba' } }],
          [product()],
        ),
      ).toContain('href="#proba"')
      expect(
        blocks([directFilm('https://cors-only.invalid/kurzusok/sos-kezrelax-villamkurzus')]),
      ).toContain(customLabel)
    },
  )

  it.each([
    'https://kineticare.hu:8443',
    'http://kineticare.hu',
    'https://kineticare.hu.example.invalid',
  ])('a CORS-kivétel nem tesz tetszőleges cutover origint sajáttá: %s', (origin) => {
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://kineticare-production.up.railway.app')
    vi.stubEnv('EXTRA_ALLOWED_ORIGINS', origin)
    expect(blocks([directFilm(`${origin}/kurzusok/sos-kezrelax-villamkurzus`)])).toContain(
      customLabel,
    )
  })

  it('önálló FilmHero hiányzó ellenőrzött adatnál a közvetlen linket is elhagyja', () => {
    const html = renderToStaticMarkup(
      createElement(FilmHero, { block: directFilm(directTargets[0]) }),
    )
    expect(html).not.toContain(customLabel)
    expect(html).toContain('Saját kurzusfelirat')
  })

  it.each(['hiányzó', 'rejtett', 'korábbi'])(
    'igazolt kurzushoz a közvetlen link %s SOS-szekció mellett is működik, az ugrólink nem',
    (sectionState) => {
      const directAndAnchor: BlockFilmHero = {
        ...film,
        ctas: [
          { url: directTargets[0], felirat: customLabel },
          { url: '#ingyenes', felirat: ctaLabel('free-strip-jump') },
        ],
      }
      const layout: Layout =
        sectionState === 'hiányzó'
          ? [directAndAnchor]
          : sectionState === 'rejtett'
            ? [directAndAnchor, { ...sos, sectionSettings: { visible: false } }]
            : [sos, directAndAnchor]
      const html = blocks(layout, [product()])
      expect(html).toContain(customLabel)
      expect(html).toContain(`href="${directTargets[0]}"`)
      expect(html).not.toContain('href="#ingyenes"')
      expect(html).not.toContain(ctaLabel('free-strip-jump'))
      expect(html).not.toContain('ingyenes SOS gyakorlatok')
    },
  )
})
