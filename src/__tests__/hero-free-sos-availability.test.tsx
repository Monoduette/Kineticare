import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FilmHero } from '../components/blocks/FilmHero'
import { RenderBlocks } from '../components/blocks/RenderBlocks'
import { HomeView } from '../components/content/HomeView'
import { HeroCta } from '../components/content/home/HeroCta'
import { ctaLabel } from '../lib/cta-vocabulary'
import type { BlockFilmHero, BlockFreeSos, Page, Product } from '../payload-types'

const product = (overrides: Partial<Product> = {}): Product =>
  ({
    id: 2,
    slug: 'sos-fixture',
    displayTitle: 'SOS tesztkurzus',
    status: 'published',
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
const unavailable: [string, Product[]][] = [
  ['üres', []],
  ['fizetős', [product({ priceInHUFEnabled: true, priceInHUF: 10000 })]],
  ['nulla ár, de nem explicit ingyenes', [product({ priceInHUFEnabled: true, priceInHUF: 0 })]],
  ['hiányos ár', [product({ priceInHUFEnabled: true, priceInHUF: null })]],
  ['hiányzó árkapcsoló', [product({ priceInHUFEnabled: undefined })]],
  ['draft', [product({ status: 'draft' })]],
  ['archived', [product({ status: 'archived' })]],
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
afterEach(() => vi.unstubAllGlobals())

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
    expect(html).toContain('href="/kurzusok/sos-fixture"')
    expect(html).toContain('Elindítom ingyen')
  })
})

describe('P1: FilmHero és a generikus CMS-oldalak SOS-elérhetősége', () => {
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
