import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A /kurzusok/[slug] „Fotós fejléc” kinézete (pageLayout = landing) és a
 * program oldalának témakurzus-szakasza.
 *  - landing + kiírt ár → a fotós sablon akció NÉLKÜL: nincs „Akciós ár”
 *    jelzés, nincs áthúzott ár, a rejtett ár-címke „Ár:” (a felirat igaz);
 *  - élő akció mellett az akciós jelzés marad (az akció él, az állítás igaz);
 *  - ingyenes kurzuson nincs fotós sablon (nincs ár-sor);
 *  - előnézetben a fotós sablon látszik, kivéve ha a kurzus élesben akciós
 *    lenne (az előnézet szalagja a normál elrendezést ígéri);
 *  - a program oldalán a közzétett, listázható témakurzusok rácsa a
 *    tananyag után; témakurzuson nincs ilyen lekérdezés.
 */

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
vi.mock('../components/analytics/TrackEvent', () => ({ TrackEvent: () => <span>TRACKING</span> }))
vi.mock('../components/courses/CourseBarionView', () => ({
  CourseBarionView: () => <span>BARION</span>,
}))
vi.mock('../components/courses/FreeCourseRequestForm', () => ({
  FreeCourseRequestForm: () => <span>CLAIM_FORM</span>,
}))

import CoursePage from '../app/(frontend)/kurzusok/[slug]/page'
import { formatPriceHuf } from '../lib/format-price'

const props = { params: Promise.resolve({ slug: 'csuklo' }) }
const base = {
  id: 21,
  slug: 'csuklo',
  displayTitle: 'Csukló témakurzus',
  shortDescription: 'A csukló otthoni tornája.',
  status: 'published',
  pageLayout: 'landing',
  priceInHUFEnabled: true,
  priceInHUF: 19900,
  promoEnabled: false,
  modules: [
    {
      id: 'module',
      title: 'Alapok',
      lessons: [{ id: 'lesson', title: 'Elso lecke', status: 'ready', streamAssetId: 'GUID' }],
    },
  ],
}

const program = {
  ...base,
  id: 1,
  slug: 'otthoni-kezrehab-program',
  displayTitle: 'Otthoni KézRehab Program',
  pageLayout: 'standard',
  priceInHUF: 79500,
}

function topic(id: number, slug: string, title: string, extra: Record<string, unknown> = {}) {
  return { ...base, id, slug, displayTitle: title, parentCourses: [1], ...extra }
}

function isTopicQuery(args: { where?: unknown } | undefined): boolean {
  return JSON.stringify(args?.where ?? null).includes('parentCourses')
}

/** A route lekérdezései: a kurzus maga, illetve (program esetén) a témakurzusai. */
function serve(page: Record<string, unknown>, topics: Record<string, unknown>[] = []) {
  mocks.find.mockImplementation(async (args: { where?: unknown }) =>
    isTopicQuery(args) ? { docs: topics } : { docs: [page] },
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.draft.mockResolvedValue({ isEnabled: false })
  mocks.auth.mockResolvedValue({ user: null })
  serve(base)
})

describe('kurzusoldal — Fotós fejléc kinézet', () => {
  it('akció nélkül a fotós sablon akció-jelzés és áthúzott ár nélkül, igaz ár-címkével', async () => {
    const html = renderToStaticMarkup(await CoursePage(props))
    expect(html).toContain('kc-promo-hero')
    expect(html).toContain('kc-promo-course--landing')
    expect(html).not.toContain('Akciós ár')
    expect(html).not.toContain('akciós áron')
    expect(html).not.toContain('<s>')
    expect(html).toContain(`<span class="kc-visually-hidden">Ár: </span>${formatPriceHuf(19900)}`)
    expect(html).toContain('Kezdd el a kurzust')
    expect(html).toContain('href="/penztar?termek=21"')
    expect(html).toContain('"price":19900')
    expect(html).not.toContain('kc-course-buybox')
  })

  it('élő akció mellett a fotós kurzus az akciós jelzést kapja', async () => {
    serve({
      ...base,
      promoEnabled: true,
      promoPriceHuf: 14900,
      promoStart: '2020-01-01T00:00:00.000Z',
      promoEnd: '2099-12-31T00:00:00.000Z',
    })
    const html = renderToStaticMarkup(await CoursePage(props))
    expect(html).toContain('<p class="kc-promo-hero__badge">Akciós ár</p>')
    expect(html).toContain(`<s>${formatPriceHuf(19900)}</s>`)
    expect(html).not.toContain('kc-promo-course--landing')
  })

  it('ingyenes kurzuson a fotós kinézet sem ad fotós sablont', async () => {
    serve({ ...base, priceInHUFEnabled: false })
    const html = renderToStaticMarkup(await CoursePage(props))
    expect(html).not.toContain('kc-promo-hero')
    expect(html).toContain('CLAIM_FORM')
  })

  it('a rendes kinézet a rendes kurzusoldalt adja', async () => {
    serve({ ...base, pageLayout: 'standard' })
    const html = renderToStaticMarkup(await CoursePage(props))
    expect(html).not.toContain('kc-promo-hero')
    expect(html).toContain('kc-course-buybox')
  })

  it('előnézetben a fotós sablon látszik az előnézet-sávval, kapcsolódó kurzusok nélkül', async () => {
    mocks.draft.mockResolvedValue({ isEnabled: true })
    mocks.auth.mockResolvedValue({ user: { id: 7, role: 'staff' } })
    serve({
      ...base,
      _status: 'draft',
      relatedProducts: [{ ...program, id: 2, slug: 'masik', displayTitle: 'KAPCSOLODO_KURZUS' }],
    })
    const html = renderToStaticMarkup(await CoursePage(props))
    expect(html).toContain('Előnézet:')
    expect(html).toContain('kc-promo-hero')
    expect(html).not.toContain('KAPCSOLODO_KURZUS')
    expect(html).not.toContain('TRACKING')
  })

  it('előnézetben a normál elrendezés marad, ha a kurzus élesben akciós lenne', async () => {
    mocks.draft.mockResolvedValue({ isEnabled: true })
    mocks.auth.mockResolvedValue({ user: { id: 7, role: 'staff' } })
    serve({
      ...base,
      _status: 'draft',
      promoEnabled: true,
      promoPriceHuf: 14900,
      promoStart: '2020-01-01T00:00:00.000Z',
      promoEnd: '2099-12-31T00:00:00.000Z',
    })
    const html = renderToStaticMarkup(await CoursePage(props))
    expect(html).toContain('Előnézet:')
    expect(html).not.toContain('kc-promo-hero')
  })
})

describe('kurzusoldal — témakurzusok a program oldalán', () => {
  const programProps = { params: Promise.resolve({ slug: 'otthoni-kezrehab-program' }) }

  it('a program oldalán a közzétett, listázható témakurzusok rácsa a tananyag után', async () => {
    serve(program, [
      topic(21, 'csuklo', 'CSUKLO_TEMA'),
      topic(22, 'vall', 'REJTETT_TEMA', { unlisted: true }),
    ])
    const html = renderToStaticMarkup(await CoursePage(programProps))
    expect(html).toContain('Csak egy területen fáj?')
    expect(html).toContain('CSUKLO_TEMA')
    expect(html).not.toContain('REJTETT_TEMA')
    expect(html).toContain('href="/kurzusok/csuklo"')
    expect(html.indexOf('id="tananyag"')).toBeLessThan(html.indexOf('id="temakurzusok"'))
    expect(html).toContain('href="#temakurzusok"')
    // A lekérdezés nyilvános olvasással fut, csak közzétett témakurzusra.
    const query = mocks.find.mock.calls.map((call) => call[0]).find(isTopicQuery)
    expect(query?.overrideAccess).toBe(false)
    expect(JSON.stringify(query?.where)).toContain('"published"')
  })

  it('témakurzus nélkül nincs szakasz, a program oldala változatlan', async () => {
    serve(program, [])
    const html = renderToStaticMarkup(await CoursePage(programProps))
    expect(html).not.toContain('Csak egy területen fáj?')
    expect(html).not.toContain('temakurzusok')
  })

  it('hibás lekérdezésnél a program oldala szakasz nélkül is megjelenik', async () => {
    mocks.find.mockImplementation(async (args: { where?: unknown }) => {
      if (isTopicQuery(args)) {
        throw new Error('adatbázis-hiba')
      }
      return { docs: [program] }
    })
    const html = renderToStaticMarkup(await CoursePage(programProps))
    expect(html).toContain('Otthoni KézRehab Program')
    expect(html).not.toContain('Csak egy területen fáj?')
  })

  it('témakurzus oldalán nem kérdezi le a testvér-témakurzusokat', async () => {
    serve(topic(21, 'csuklo', 'CSUKLO_TEMA', { pageLayout: 'standard' }))
    renderToStaticMarkup(await CoursePage(props))
    expect(mocks.find.mock.calls.map((call) => call[0]).some(isTopicQuery)).toBe(false)
  })
})
