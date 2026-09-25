import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CourseEngagementSection } from '../components/admin/statistics/CourseEngagementSection'
import { StatisticsReport } from '../components/admin/StatisticsReport'
import { buildCurriculum, type Curriculum } from '../lib/curriculum/curriculum'
import { courseProgressHref } from '../lib/statistics/course-links'
import {
  buildCourseEngagementReport,
  buildCourseEngagementRow,
  NOT_STARTED_NAME_LIMIT,
  type CourseEngagementInput,
  type CourseEngagementReport,
  type CourseEngagementRow,
} from '../lib/statistics/engagement'
import {
  ENGAGEMENT_ENROLLMENT_MAX,
  ENGAGEMENT_PROGRESS_MAX,
  queryCourseEngagement,
  type QueryCourseEngagementDeps,
} from '../lib/statistics/engagement-query'
import { aggregateOrderFunnel, buildRevenueReport } from '../lib/statistics/revenue'
import type { Product } from '../payload-types'

/**
 * Kurzus-hatás (eladás × haladás) tesztek — aggregátor, lekérdezés mockkal
 * és a szekció renderelése. Hálózat és adatbázis nincs: a Payload local API-t
 * a `find` dispatch-mock helyettesíti (repo-szabály: tesztből sosem megy ki
 * valódi hívás).
 */

/** Kétleckés (mindkettő elindítható) tananyag a régi videólistából. */
function ketLeckesTananyag(): Curriculum {
  return buildCurriculum(
    {
      modules: null,
      videos: [
        { id: 'v1', title: '1. lecke', streamAssetId: 'g1', status: 'ready', durationSec: 60 },
        { id: 'v2', title: '2. lecke', streamAssetId: 'g2', status: 'ready', durationSec: 60 },
      ],
    } as Pick<Product, 'modules' | 'videos'>,
    true,
  )
}

function enrollment(userId: number, name: string | null = null) {
  return { userId, email: '', name }
}

/** A csonkolás-mezők nélkül egyetlen bemenet sem fordul le: ez szándékos. */
const EP: Pick<CourseEngagementInput, 'omitted' | 'truncated'> = { omitted: 0, truncated: false }

describe('buildCourseEngagementRow', () => {
  it('vegyes állapotokat a közös összesítő szerint számol', () => {
    // A: mindkét lecke kész (befejezte), B: egy lecke (folyamatban),
    // C: semmi (el sem kezdte).
    const row = buildCourseEngagementRow({
      ...EP,
      productId: 7,
      title: 'Otthoni kéztorna',
      audience: 'laikus',
      curriculum: ketLeckesTananyag(),
      enrollments: [enrollment(1), enrollment(2), enrollment(3)],
      progressRows: [
        { userId: 1, videoRef: 'v1' },
        { userId: 1, videoRef: 'v2' },
        { userId: 2, videoRef: 'v1' },
      ],
    })
    expect(row.enrolled).toBe(3)
    expect(row.started).toBe(2)
    expect(row.completed).toBe(1)
    expect(row.notStarted).toBe(1)
    // (100 + 50 + 0) / 3 = 50
    expect(row.averagePercent).toBe(50)
    expect(row.completionRateOfEnrolled).toBe(33)
    expect(row.completionRateOfStarted).toBe(50)
  })

  it('0 hozzáférőnél minden számláló 0, nincs nullával osztás', () => {
    const row = buildCourseEngagementRow({
      ...EP,
      productId: 1,
      title: 'Üres kurzus',
      audience: 'szakember',
      curriculum: ketLeckesTananyag(),
      enrollments: [],
      progressRows: [{ userId: 9, videoRef: 'v1' }],
    })
    expect(row).toMatchObject({
      enrolled: 0,
      started: 0,
      completed: 0,
      notStarted: 0,
      averagePercent: 0,
      completionRateOfEnrolled: 0,
      completionRateOfStarted: 0,
    })
  })

  it('ismeretlen audience a laikus ágra esik vissza', () => {
    const row = buildCourseEngagementRow({
      ...EP,
      productId: 1,
      title: 'Kurzus',
      audience: null,
      curriculum: ketLeckesTananyag(),
      enrollments: [],
      progressRows: [],
    })
    expect(row.audience).toBe('laikus')
  })
})

describe('buildCourseEngagementReport', () => {
  it('0 kurzusnál üres, nem csonkolt jelentést ad', () => {
    expect(buildCourseEngagementReport([])).toEqual({
      courses: [],
      truncated: false,
      skipped: 0,
      omitted: 0,
    })
  })

  it('a truncated jelzést továbbadja', () => {
    expect(buildCourseEngagementReport([], { truncated: true }).truncated).toBe(true)
  })

  it('a legtöbb hozzáférőt sorolja előre, holtversenyben magyar ábécé dönt', () => {
    const base: Omit<CourseEngagementInput, 'productId' | 'title' | 'enrollments'> = {
      ...EP,
      audience: 'laikus',
      curriculum: ketLeckesTananyag(),
      progressRows: [],
    }
    const report = buildCourseEngagementReport([
      { ...base, productId: 1, title: 'Cékla', enrollments: [enrollment(1)] },
      { ...base, productId: 2, title: 'Árvácska', enrollments: [enrollment(1)] },
      {
        ...base,
        productId: 3,
        title: 'Nagy kurzus',
        enrollments: [enrollment(1), enrollment(2)],
      },
    ])
    expect(report.courses.map((c) => c.title)).toEqual(['Nagy kurzus', 'Árvácska', 'Cékla'])
  })
})

interface FindArgs {
  collection: string
  where?: Record<string, unknown>
  page?: number
  limit?: number
  select?: Record<string, unknown>
  overrideAccess?: boolean
}

/** Lapozó mock: a teljes doc-listából a kért lapot adja vissza. */
function pagedResult<T>(docs: T[], page: number, limit: number) {
  const start = (page - 1) * limit
  const pageDocs = docs.slice(start, start + limit)
  return { docs: pageDocs, totalDocs: docs.length, hasNextPage: start + limit < docs.length }
}

/**
 * A user-dokumentum a mockban SZÁNDÉKOSAN több mezőt hordoz, mint amennyit a
 * lekérdezés kikér (e-mailt is): így az őr-teszt nem a mock jóindulatát méri,
 * hanem azt, hogy a kód nem viszi tovább az érzékeny mezőt.
 */
function createPayloadMock(data: {
  products: Record<string, unknown>[]
  usersByProduct: Record<number, Record<string, unknown>[]>
  progressByProduct: Record<number, { user: number; videoRef: string }[]>
}): { deps: QueryCourseEngagementDeps; calls: FindArgs[] } {
  const calls: FindArgs[] = []
  const find = (rawArgs: unknown) => {
    const args = rawArgs as FindArgs
    calls.push(args)
    const page = args.page ?? 1
    const limit = args.limit ?? 10
    if (args.collection === 'products') {
      return Promise.resolve(pagedResult(data.products, page, limit))
    }
    const whereEquals = (kulcs: string): number => {
      const feltetel = args.where?.[kulcs] as { equals?: unknown } | undefined
      return typeof feltetel?.equals === 'number' ? feltetel.equals : -1
    }
    if (args.collection === 'users') {
      return Promise.resolve(
        pagedResult(data.usersByProduct[whereEquals('purchases')] ?? [], page, limit),
      )
    }
    if (args.collection === 'course-progress') {
      return Promise.resolve(
        pagedResult(data.progressByProduct[whereEquals('product')] ?? [], page, limit),
      )
    }
    throw new Error(`váratlan collection: ${args.collection}`)
  }
  return { deps: { payload: { find } as unknown as QueryCourseEngagementDeps['payload'] }, calls }
}

describe('queryCourseEngagement', () => {
  const videos = [
    { id: 'v1', title: '1. lecke', streamAssetId: 'g1', status: 'ready' },
    { id: 'v2', title: '2. lecke', streamAssetId: 'g2', status: 'ready' },
  ]

  it('kurzusonként összerakja a hatás-sorokat a mockolt Payloadból', async () => {
    const { deps, calls } = createPayloadMock({
      products: [
        { id: 1, displayTitle: 'Otthoni kéztorna', sku: 'otthoni', audience: 'laikus', videos },
        { id: 2, sku: 'szakmai-alap', audience: 'szakember', videos },
      ],
      usersByProduct: {
        1: [{ id: 10 }, { id: 11 }],
        2: [{ id: 10 }],
      },
      progressByProduct: {
        1: [
          { user: 10, videoRef: 'v1' },
          { user: 10, videoRef: 'v2' },
        ],
        2: [],
      },
    })

    const report = await queryCourseEngagement(deps)
    expect(report.truncated).toBe(false)
    expect(report.courses).toHaveLength(2)

    const otthoni = report.courses.find((c) => c.productId === 1)
    expect(otthoni).toMatchObject({
      title: 'Otthoni kéztorna',
      audience: 'laikus',
      enrolled: 2,
      started: 1,
      completed: 1,
      notStarted: 1,
      averagePercent: 50,
    })
    // displayTitle nélkül az sku a név (a course-progress handler sorrendje).
    const szakmai = report.courses.find((c) => c.productId === 2)
    expect(szakmai).toMatchObject({ title: 'szakmai-alap', audience: 'szakember', enrolled: 1 })

    // Minden lekérdezés a szerepkör-kapu utáni szerződéssel fut.
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((call) => call.overrideAccess === true)).toBe(true)
    // Érzékeny vevő-mező nincs kiválasztva: a users-select PONTOSAN a nevet
    // kéri (az id-t a Payload select-módban mindig adja). Ha valaki ide
    // felveszi az e-mailt, ez a sor azonnal bukik.
    const usersCall = calls.find((call) => call.collection === 'users')
    expect(usersCall?.select).toEqual({ name: true })
  })

  it('0 kurzusnál üres jelentést ad, users-lekérdezés nélkül', async () => {
    const { deps, calls } = createPayloadMock({
      products: [],
      usersByProduct: {},
      progressByProduct: {},
    })
    const report = await queryCourseEngagement(deps)
    expect(report).toEqual({ courses: [], truncated: false, skipped: 0, omitted: 0 })
    expect(calls.filter((call) => call.collection === 'users')).toHaveLength(0)
  })

  it('a felső korlát elérésekor csonkolást jelez', async () => {
    // A plafonnál eggyel több hozzáférő: a lapozásnak korlátoznia kell,
    // és a jelentésnek ki kell mondania a csonkolást.
    const sokUser = Array.from({ length: ENGAGEMENT_ENROLLMENT_MAX + 1 }, (_, i) => ({
      id: i + 1,
    }))
    const { deps } = createPayloadMock({
      products: [{ id: 1, sku: 'nagy', audience: 'laikus', videos }],
      usersByProduct: { 1: sokUser },
      progressByProduct: { 1: [] },
    })
    const report = await queryCourseEngagement(deps)
    expect(report.truncated).toBe(true)
    expect(report.courses[0]?.enrolled).toBe(ENGAGEMENT_ENROLLMENT_MAX)
  })

  it('csonkolt haladásnál a kimaradó diákok NEM „nem kezdte el"-ként jelennek meg', async () => {
    // A 2026-08-21-i kódvizsgálat HIGH (F1) találata, mért reprodukcióval:
    // 800 beiratkozott, MINDENKI mind a 20 leckével készen → 16 000 haladás-sor
    // a 10 000-es plafon ellen. A levágás nélkül a riport 300 KÉSZ diákot
    // „nem kezdte el"-nek mutatott, az átlagot pedig 63%-nak (a valóság 100%).
    // A torzítás iránya ellentétes a `truncated` jelzés ígéretével — ezért nem
    // elég a figyelmeztetés, a sornak magának kell igazat mondania.
    const huszLecke = Array.from({ length: 20 }, (_, i) => ({
      id: `v${String(i + 1)}`,
      title: `${String(i + 1)}. lecke`,
      streamAssetId: `g${String(i + 1)}`,
      status: 'ready',
    }))
    const diakok = Array.from({ length: 800 }, (_, i) => ({ id: i + 1 }))
    const sorok = diakok.flatMap((diak) =>
      huszLecke.map((lecke) => ({ user: diak.id, videoRef: lecke.id })),
    )
    expect(sorok.length).toBe(16_000)
    expect(sorok.length).toBeGreaterThan(ENGAGEMENT_PROGRESS_MAX)

    const { deps } = createPayloadMock({
      products: [{ id: 1, sku: 'nagy', audience: 'laikus', videos: huszLecke }],
      usersByProduct: { 1: diakok },
      progressByProduct: { 1: sorok },
    })
    const report = await queryCourseEngagement(deps)
    const sor = report.courses[0]

    expect(report.truncated).toBe(true)
    // A 10 000. sor pont az 500. diák utolsó leckéje. Őt is eldobjuk: a
    // plafonon nem tudhatjuk, hogy a sorai nem vágódtak-e félbe.
    expect(sor?.enrolled).toBe(499)
    expect(sor?.started).toBe(499)
    expect(sor?.completed).toBe(499)
    // EZ a tétel: kész diák sosem eshet a „nem kezdte el" oszlopba.
    expect(sor?.notStarted).toBe(0)
    expect(sor?.averagePercent).toBe(100)
    // A hibás (levágás nélküli) értékek, hogy a mutáció itt hangosan bukjon.
    expect(sor?.notStarted).not.toBe(300)
    expect(sor?.averagePercent).not.toBe(63)

    // ŐR — A KIHAGYÁS ÁTMEGY A JELENTÉSBE.
    // A levágás 800-ból 499-et tartott meg, tehát 301 hozzáférőről semmilyen
    // adatunk nincs. Ez az érték korábban ELVESZETT (a lekérdező eldobta a
    // `trimTruncatedProgress` `omitted` mezőjét). Darabszámnál ez elfogadható
    // alsó becslés volt, NÉVSORNÁL viszont hamis állítás lenne elhallgatni.
    expect(sor?.omitted).toBe(301)
    expect(sor?.truncated).toBe(true)
    expect(report.omitted).toBe(301)
  })

  it('egy kurzus hibája nem viszi el a többi kurzus sorát, és a kimaradás látszik', async () => {
    // F7 (2026-08-21): a ciklusban nem volt kurzusonkénti hibakezelés, tehát
    // egyetlen rossz termék az EGÉSZ Kurzus-hatás szekciót elvitte.
    const videos = [{ id: 'v1', title: '1. lecke', streamAssetId: 'g1', status: 'ready' }]
    const calls: FindArgs[] = []
    const find = (rawArgs: unknown) => {
      const args = rawArgs as FindArgs
      calls.push(args)
      const page = args.page ?? 1
      const limit = args.limit ?? 10
      if (args.collection === 'products') {
        return Promise.resolve(
          pagedResult(
            [
              { id: 1, sku: 'ep', audience: 'laikus', videos },
              { id: 2, sku: 'romlott', audience: 'laikus', videos },
            ],
            page,
            limit,
          ),
        )
      }
      const feltetel = args.where?.[args.collection === 'users' ? 'purchases' : 'product'] as
        { equals?: unknown } | undefined
      if (feltetel?.equals === 2) {
        return Promise.reject(new Error('adatbázis-hiba a 2. kurzusnál'))
      }
      if (args.collection === 'users') {
        return Promise.resolve(pagedResult([{ id: 10 }], page, limit))
      }
      return Promise.resolve(pagedResult([{ user: 10, videoRef: 'v1' }], page, limit))
    }

    const report = await queryCourseEngagement({
      payload: { find } as unknown as QueryCourseEngagementDeps['payload'],
    })

    // Az ép kurzus sora megvan…
    expect(report.courses).toHaveLength(1)
    expect(report.courses[0]).toMatchObject({ productId: 1, enrolled: 1, completed: 1 })
    // …a hibás kurzus pedig nem tűnik el némán.
    expect(report.skipped).toBe(1)
  })

  it('a plafonok a kurzus-haladás handler plafonjainak a fele', () => {
    expect(ENGAGEMENT_ENROLLMENT_MAX).toBe(1000)
    expect(ENGAGEMENT_PROGRESS_MAX).toBe(10_000)
  })
})

/** Egy kész sor a rendereléshez; a felülírás mezőnként megy. */
function sor(overrides: Partial<CourseEngagementRow> = {}): CourseEngagementRow {
  return {
    productId: 42,
    title: 'Otthoni kéztorna',
    audience: 'laikus',
    enrolled: 12,
    started: 8,
    completed: 3,
    notStarted: 4,
    totalLessons: 20,
    averagePercent: 47,
    completionRateOfEnrolled: 25,
    completionRateOfStarted: 38,
    notStartedNames: ['Bodor Anna', 'Kis Péter', 'Szabó Éva', 'Ürögi Zoltán'],
    notStartedWithoutName: 0,
    omitted: 0,
    truncated: false,
    ...overrides,
  }
}

describe('CourseEngagementSection', () => {
  const mintaReport: CourseEngagementReport = {
    courses: [sor()],
    truncated: false,
    skipped: 0,
    omitted: 0,
  }

  it('kirajzolja a fejléceket, a számokat és a kurzuslap-linket', () => {
    const html = renderToStaticMarkup(
      createElement(CourseEngagementSection, { engagement: mintaReport }),
    )
    expect(html).toContain('Ki hol tart a kurzusokban')
    // Az oszlopnevek SZÓRÓL SZÓRA a Kurzus-haladás panel címkéi („Hozzáfér",
    // „Nem kezdte el") — egy fogalom egy szó (WCAG 3.2.4). A szóhasználat a
    // 2026-08-21-i vezetői döntés: „Hozzáfér", nem „Beiratkozott".
    for (const fejlec of [
      'Kurzus',
      'Kinek szól',
      'Hozzáfér',
      'Elkezdte',
      'Befejezte',
      'Nem kezdte el',
      'Átlagos haladás',
    ]) {
      expect(html).toContain(fejlec)
    }
    expect(html).not.toContain('Beiratkozott')
    expect(html).not.toContain('El sem kezdte')
    expect(html).toContain('Otthoni kéztorna')
    expect(html).toContain('47%')
    expect(html).toContain(`href="${courseProgressHref(42)}"`)
    expect(html).toContain('Névsor és szűrés a kurzus lapján')
    // A „ki az konkrétan" útbaigazítás magyarul, a kurzuslapra mutatva.
    expect(html).toContain('állapot szerint szűrhetsz')
  })

  it('a „Nem kezdte el" SZÁM maga link, a rögzített mély-link alakkal', () => {
    // A szerződés (vezetői döntés, 2026-08-21):
    //   /admin/collections/products/<id>?haladas=nem-kezdte#kurzus-haladas
    // A panel ebből tudja, hogy magától be kell töltenie, be kell állítania a
    // szűrőt, és a panelre kell görgetnie. Az URL-t EGY helyen állítjuk elő
    // (src/lib/statistics/course-links.ts).
    const html = renderToStaticMarkup(
      createElement(CourseEngagementSection, { engagement: mintaReport }),
    )
    expect(html).toContain(
      'href="/admin/collections/products/42?haladas=nem-kezdte#kurzus-haladas"',
    )
    expect(courseProgressHref(42, 'nem-kezdte')).toBe(
      '/admin/collections/products/42?haladas=nem-kezdte#kurzus-haladas',
    )
    // A puszta szám nem mondja meg, hova visz: az akadálymentes nevet az
    // aria-label adja, és TARTALMAZZA a látható szöveget (WCAG 2.5.3).
    expect(html).toContain('aria-label="4 hallgató nem kezdte el, névsor a kurzus lapján')

    // Nullánál nincs link: egy üres szűrt lista zsákutca lenne.
    const nulla = renderToStaticMarkup(
      createElement(CourseEngagementSection, {
        engagement: { ...mintaReport, courses: [sor({ notStarted: 0, notStartedNames: [] })] },
      }),
    )
    expect(nulla).not.toContain('haladas=nem-kezdte')
  })

  it('kiírja a „nem kezdte el" NEVEKET, nyitható blokkban', () => {
    const html = renderToStaticMarkup(
      createElement(CourseEngagementSection, { engagement: mintaReport }),
    )
    expect(html).toContain('<details>')
    expect(html).toContain('Kik nem kezdték el (4)')
    for (const nev of ['Bodor Anna', 'Kis Péter', 'Szabó Éva', 'Ürögi Zoltán']) {
      expect(html).toContain(nev)
    }
    expect(html).toContain('A teljes névsor a kurzus lapján van.')
  })

  it('ha a lista hosszabb a plafonnál, ezt kimondja', () => {
    const html = renderToStaticMarkup(
      createElement(CourseEngagementSection, {
        engagement: {
          ...mintaReport,
          courses: [
            sor({
              notStarted: 30,
              notStartedNames: Array.from(
                { length: NOT_STARTED_NAME_LIMIT },
                (_, i) => `Teszt Elek ${String(i + 1)}`,
              ),
            }),
          ],
        },
      }),
    )
    expect(html).toContain(`A lista az első ${String(NOT_STARTED_NAME_LIMIT)} nevet mutatja`)
  })

  it('a névtelen hallgatókat DARABSZÁMMAL mondja ki, nem hallgatja el', () => {
    const html = renderToStaticMarkup(
      createElement(CourseEngagementSection, {
        engagement: {
          ...mintaReport,
          courses: [
            sor({ notStarted: 4, notStartedNames: ['Kis Péter'], notStartedWithoutName: 3 }),
          ],
        },
      }),
    )
    expect(html).toContain('3 hallgató neve nincs megadva')
  })

  it('a hibára kimaradt kurzusokat kimondja, egyes és többes számban is', () => {
    const egy = renderToStaticMarkup(
      createElement(CourseEngagementSection, { engagement: { ...mintaReport, skipped: 1 } }),
    )
    expect(egy).toContain('Egy kurzus adata technikai hiba miatt kimaradt')

    const tobb = renderToStaticMarkup(
      createElement(CourseEngagementSection, { engagement: { ...mintaReport, skipped: 3 } }),
    )
    expect(tobb).toContain('3 kurzus adata technikai hiba miatt kimaradt')

    // Ha nincs kimaradás, a mondat sem jelenik meg.
    const nulla = renderToStaticMarkup(
      createElement(CourseEngagementSection, { engagement: mintaReport }),
    )
    expect(nulla).not.toContain('technikai hiba miatt kimaradt')
  })

  it('a görgethető tábla-régió billentyűzetről fókuszálható és nevesített (WCAG 2.1.1, 4.1.2)', () => {
    // axe: scrollable-region-focusable; minta: Adrian Roselli,
    // https://adrianroselli.com/2020/11/under-engineered-responsive-tables.html
    const html = renderToStaticMarkup(
      createElement(CourseEngagementSection, { engagement: mintaReport }),
    )
    expect(html).toContain('role="region"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('aria-labelledby="kc-stat-kurzushatas-cim"')
    expect(html).toContain('id="kc-stat-kurzushatas-cim"')
  })

  it('a nullánál nagyobb „Nem kezdte el" érték kiemelést kap, a 0 nem', () => {
    const html = renderToStaticMarkup(
      createElement(CourseEngagementSection, { engagement: mintaReport }),
    )
    // A kiemelés OSZTÁLYON keresztül megy, nem inline színnel: az inline
    // `color` a `.kc-adminstat a:hover` szabályt verné, tehát a link
    // hover-visszajelzése ezen az EGY linken sosem érvényesülne.
    expect(html).toContain('class="kc-adminstat__count-danger"')
    // A szín továbbra is a MÁRKA danger tokenje (6,54:1 fehéren); a Payload
    // `--theme-error-500` tartaléka KIKERÜLT (fehéren mérve 4,13:1, a 4,5:1
    // küszöb alatt — vezetői döntés, 2026-08-21). Magát a CSS-szabályt a
    // statisztika-elrendezes.test.tsx méri a VALÓDI custom.scss-ből.
    expect(html).not.toContain('--theme-error-500')

    const mindenkiElkezdte: CourseEngagementReport = {
      ...mintaReport,
      courses: [sor({ notStarted: 0, started: 12, notStartedNames: [] })],
    }
    const html0 = renderToStaticMarkup(
      createElement(CourseEngagementSection, { engagement: mindenkiElkezdte }),
    )
    expect(html0).not.toContain('kc-adminstat__count-danger')
  })

  it('a kiemelt szám színe NEM inline: a hover-szabály felül tudja írni', () => {
    // A `.kc-adminstat a:hover` specifikussága (0,2,1) nagyobb, mint az
    // osztályé (0,2,0) — ez a rendezés adja vissza a link-nyelv
    // hover-visszajelzését, amit az inline stílus elnyelt.
    const html = renderToStaticMarkup(
      createElement(CourseEngagementSection, { engagement: mintaReport }),
    )
    const link = /<a[^>]*kc-adminstat__count-danger[^>]*>/.exec(html)?.[0] ?? ''
    expect(link).not.toBe('')
    expect(link).not.toMatch(/style="[^"]*color:/)
  })

  it('hiányzó adatnál magyar magyarázatot mutat, nem táblát', () => {
    const html = renderToStaticMarkup(createElement(CourseEngagementSection, { engagement: null }))
    expect(html).toContain('Ki hol tart a kurzusokban')
    expect(html).toContain('nem tölthetők be')
    expect(html).not.toContain('<table')
  })

  it('üres kurzuslistánál ezt magyarul mondja ki', () => {
    const html = renderToStaticMarkup(
      createElement(CourseEngagementSection, {
        engagement: { courses: [], truncated: false, skipped: 0, omitted: 0 },
      }),
    )
    expect(html).toContain('Még nincs kurzus')
  })

  it('csonkolt adatnál kimondja, hogy a számok a valóságnál kisebbek lehetnek', () => {
    const html = renderToStaticMarkup(
      createElement(CourseEngagementSection, {
        engagement: { ...mintaReport, truncated: true },
      }),
    )
    expect(html).toContain('a valóságnál kisebbek lehetnek')
    expect(html).toContain('A pontos, hallgatónkénti lista a kurzus lapján van.')
    // A régi, homályos megfogalmazás nem térhet vissza.
    expect(html).not.toContain('alsó becslések')
  })
})

/**
 * ŐR — A KIHAGYOTT HALLGATÓK SZÁMA MEGJELENIK A FELÜLETEN.
 *
 * Ez a kiírás legfontosabb pontja. Darabszámnál a csonkolás elfogadható alsó
 * becslés; NÉVSORNÁL nem az: ha „Kis Anna" hiányzik a listáról, a lista azt
 * állítja róla, hogy elkezdte a kurzust. A jelentés eddig el sem hozta ezt az
 * értéket, most kurzusonként hordozza, és a felület KIMONDJA.
 *
 * Mutációs próba (2026-08-21, kézzel futtatva): ha a `CourseEngagementSection`
 * `nevsorMagyarazat` függvényéből kivesszük az `omitted` ágat, ez a teszt
 * bukik; ha az `engagement-query` visszaáll a régi, `omitted`-et eldobó
 * alakra, a lekérdezés-oldali ág bukik.
 */
describe('ŐR: a csonkolás miatt kihagyott hallgatókat a felület kimondja', () => {
  it('kurzusonként kiírja, hány hozzáférő adata maradt ki', () => {
    const html = renderToStaticMarkup(
      createElement(CourseEngagementSection, {
        engagement: {
          courses: [sor({ omitted: 301, truncated: true })],
          truncated: true,
          skipped: 0,
          omitted: 301,
        },
      }),
    )
    expect(html).toContain('301 hozzáférő adata nem fért bele a lekérdezésbe')
    expect(html).toContain('ezért ez a névsor hiányos')
  })

  it('ismeretlen darabszámú csonkolásnál is kimondja, hogy a névsor hiányos', () => {
    // A hozzáférő-lista plafonjánál nem tudjuk, hányan maradtak ki: ott csak
    // annyit állíthatunk, hogy a lista hiányos. Hallgatni erről tilos.
    const html = renderToStaticMarkup(
      createElement(CourseEngagementSection, {
        engagement: {
          courses: [sor({ omitted: 0, truncated: true })],
          truncated: true,
          skipped: 0,
          omitted: 0,
        },
      }),
    )
    expect(html).toContain(
      'A kurzusnak a megjeleníthetőnél több adata van, ezért ez a névsor hiányos.',
    )
  })

  it('kihagyás nélkül NEM állítja, hogy hiányos a lista', () => {
    const html = renderToStaticMarkup(
      createElement(CourseEngagementSection, {
        engagement: { courses: [sor()], truncated: false, skipped: 0, omitted: 0 },
      }),
    )
    expect(html).not.toContain('hiányos')
  })

  it('a figyelmeztetés akkor is látszik, ha MINDENKI elkezdte (nincs nyitható blokk)', () => {
    // MÉRT HIBA: a mondat kizárólag a `notStarted > 0` mögötti nyitható
    // blokkban élt, tehát pont akkor volt láthatatlan, amikor a tábla azt
    // állítja, hogy senki nem maradt le — holott a kimaradt hozzáférők között
    // lehet olyan, aki nem kezdte el.
    const html = renderToStaticMarkup(
      createElement(CourseEngagementSection, {
        engagement: {
          courses: [sor({ notStarted: 0, started: 12, notStartedNames: [], omitted: 5 })],
          truncated: false,
          skipped: 0,
          omitted: 5,
        },
      }),
    )
    expect(html).not.toContain('<details>')
    expect(html).toContain('5 hozzáférő adata nem fért bele a lekérdezésbe')
  })

  it('az `omitted` és a `truncated` mondata EGYSZERRE is megjelenik', () => {
    // Korábban `else if` kötötte a kettőt: az `omitted` elnyomta a
    // `truncated` mondatát, holott a kettő mást állít (az egyik ISMERT
    // veszteséget nevez meg, a másik azt, hogy a veszteség mértékét sem
    // tudjuk).
    const html = renderToStaticMarkup(
      createElement(CourseEngagementSection, {
        engagement: {
          courses: [sor({ omitted: 301, truncated: true })],
          truncated: true,
          skipped: 0,
          omitted: 301,
        },
      }),
    )
    expect(html).toContain('301 hozzáférő adata nem fért bele a lekérdezésbe')
    expect(html).toContain('A kurzusnak a megjeleníthetőnél több adata van')
  })

  it('azonos nevű hallgatók MINDEGYIKE megjelenik a névsorban', () => {
    // A React a puszta névből képzett kulcsnál a második azonos nevű elemet
    // eldobná — a névsor így csendben rövidülne.
    const html = renderToStaticMarkup(
      createElement(CourseEngagementSection, {
        engagement: {
          courses: [sor({ notStarted: 2, notStartedNames: ['Kis Péter', 'Kis Péter'] })],
          truncated: false,
          skipped: 0,
          omitted: 0,
        },
      }),
    )
    expect(html.match(/<li>Kis Péter<\/li>/g)).toHaveLength(2)
  })
})

/**
 * ŐR — A 0 ELINDÍTHATÓ LECKÉS KURZUS NEM ÁLLÍT SEMMIT A VEVŐKRŐL.
 *
 * MÉRVE (vezetői kör, 2026-08-21): a lecke `status` alapértelmezése
 * `processing`, ezért egy frissen feltöltött kurzusnál a nevező 0. A közös
 * összesítő ilyenkor — helyesen — mindenkit `nem-kezdte` állapotba sorol, a
 * tábla viszont ebből azt állította, hogy a hozzáférők egyike sem kezdte el,
 * NÉV SZERINT felsorolva őket, piros kiemeléssel és mély linkkel. Ez konkrét
 * emberekről tett hamis állítás. A „nincs tananyag" ezért KÜLÖN megjelenési
 * állapot.
 */
describe('ŐR: a tananyag nélküli kurzus külön megjelenési állapot', () => {
  const tananyagNelkul: CourseEngagementReport = {
    courses: [
      sor({
        totalLessons: 0,
        enrolled: 5,
        started: 0,
        completed: 0,
        notStarted: 5,
        averagePercent: 0,
        notStartedNames: ['Bodor Anna', 'Kis Péter'],
      }),
    ],
    truncated: false,
    skipped: 0,
    omitted: 0,
  }

  it('a haladás-cellák helyén a TÉNY áll, se százalék, se „nem kezdte el"', () => {
    const html = renderToStaticMarkup(
      createElement(CourseEngagementSection, { engagement: tananyagNelkul }),
    )
    expect(html).toContain('Még nincs tananyag')
    // Százalék-cella nincs (a `width:100%`-féle STÍLUS-értékek nem számítanak,
    // ezért a cella-tartalomra illesztünk).
    expect(html).not.toMatch(/>\s*\d+%\s*</)
  })

  it('sem névsor, sem piros kiemelés, sem mély link nem jelenik meg', () => {
    const html = renderToStaticMarkup(
      createElement(CourseEngagementSection, { engagement: tananyagNelkul }),
    )
    expect(html).not.toContain('<details>')
    expect(html).not.toContain('Bodor Anna')
    expect(html).not.toContain('kc-adminstat__count-danger')
    expect(html).not.toContain(courseProgressHref(42, 'nem-kezdte'))
  })

  it('a „Hozzáfér" darabszám MEGMARAD — az igaz', () => {
    const html = renderToStaticMarkup(
      createElement(CourseEngagementSection, { engagement: tananyagNelkul }),
    )
    // A kurzus sora a hozzáférők számával együtt látszik, tehát a munkatárs
    // tudja, hogy van kinek feltölteni a tananyagot.
    expect(html).toContain('>5</td>')
    // A kurzus lapjára vezető link megmarad (az nem állít semmit senkiről).
    expect(html).toContain(courseProgressHref(42))
  })

  it('a leckeszám a KÖZÖS `playable` szabályból jön, nem külön képletből', () => {
    const feldolgozasAlatt = buildCurriculum(
      {
        modules: null,
        videos: [
          {
            id: 'v1',
            title: '1. lecke',
            streamAssetId: 'g1',
            status: 'processing',
            durationSec: 60,
          },
        ],
      } as Pick<Product, 'modules' | 'videos'>,
      true,
    )
    const row = buildCourseEngagementRow({
      productId: 9,
      title: 'Új kurzus',
      audience: 'laikus',
      curriculum: feldolgozasAlatt,
      enrollments: [{ userId: 1, email: '', name: 'Kis Péter' }],
      progressRows: [],
      ...EP,
    })
    expect(row.totalLessons).toBe(0)
    // Kontroll: kész videónál már van mit számolni.
    expect(
      buildCourseEngagementRow({
        productId: 9,
        title: 'Kész kurzus',
        audience: 'laikus',
        curriculum: ketLeckesTananyag(),
        enrollments: [{ userId: 1, email: '', name: 'Kis Péter' }],
        progressRows: [],
        ...EP,
      }).totalLessons,
    ).toBe(2)
  })
})

/**
 * ŐR — E-MAIL SOSEM KERÜL A STATISZTIKA-OLDALRA.
 *
 * A döntési dokumentum 6.7 pontja: a lapra csak NÉV megy. A mock
 * SZÁNDÉKOSAN e-mailt is ad vissza a users-lekérdezésre (mintha a select
 * bővült volna), tehát a teszt nem a mock jóindulatát méri: ha bárki
 * továbbvinné az e-mailt az enrollment-be vagy a névsorba, a renderelt lapon
 * megjelenne, és ez a teszt bukna.
 */
describe('ŐR: a statisztika-oldal nem ír ki e-mailt', () => {
  const videos = [{ id: 'v1', title: '1. lecke', streamAssetId: 'g1', status: 'ready' }]

  it('a névsorban a NÉV szerepel, az e-mail sehol', async () => {
    const { deps, calls } = createPayloadMock({
      products: [
        { id: 3, displayTitle: 'Otthoni kéztorna', sku: 'otthoni', audience: 'laikus', videos },
      ],
      usersByProduct: {
        3: [
          { id: 10, name: 'Kis Anna', email: 'kis.anna@pelda.hu' },
          { id: 11, name: 'Nagy Béla', email: 'nagy.bela@pelda.hu' },
        ],
      },
      progressByProduct: { 3: [] },
    })

    const report = await queryCourseEngagement(deps)
    expect(report.courses[0]?.notStartedNames).toEqual(['Kis Anna', 'Nagy Béla'])

    const html = renderToStaticMarkup(
      createElement(CourseEngagementSection, { engagement: report }),
    )
    expect(html).toContain('Kis Anna')
    expect(html).toContain('Nagy Béla')
    expect(html).not.toContain('pelda.hu')
    expect(html).not.toContain('@')

    // A jelentés maga sem hordozhat e-mailt (nem csak a render szűr).
    expect(JSON.stringify(report)).not.toContain('@')

    // És a lekérdezés nem is kéri ki: a select PONTOSAN a nevet tartalmazza.
    const usersCall = calls.find((call) => call.collection === 'users')
    expect(usersCall?.select).toEqual({ name: true })
  })
})

describe('StatisticsReport + kurzus-hatás integráció', () => {
  const revenueReport = buildRevenueReport([], aggregateOrderFunnel([]), {
    now: new Date('2026-08-15T12:00:00Z'),
  })

  it('engagement nélkül is renderel: bevétel + magyar magyarázat a szekcióban', () => {
    const html = renderToStaticMarkup(
      createElement(StatisticsReport, { report: revenueReport, engagement: null }),
    )
    expect(html).toContain('Statisztika')
    expect(html).toContain('Havi befizetések (tájékoztató)')
    expect(html).toContain('Ki hol tart a kurzusokban')
    expect(html).toContain('nem tölthetők be')
  })

  it('engagement adattal a haladás-tábla is megjelenik', () => {
    const html = renderToStaticMarkup(
      createElement(StatisticsReport, {
        report: revenueReport,
        engagement: {
          courses: [sor({ productId: 1, enrolled: 5, started: 2, completed: 1, notStarted: 3 })],
          truncated: false,
          skipped: 0,
          omitted: 0,
        },
      }),
    )
    expect(html).toContain('Nem kezdte el')
    expect(html).toContain(`href="${courseProgressHref(1)}"`)
  })

  /**
   * ŐR — A SZEKCIÓK SORRENDJE (vezetői döntés, 2026-08-21).
   *
   * A cselekvésre késztető szekció van felül. A lap korábban a 12 havi
   * kumulált bevétellel kezdett, és a sikertelen fizetés a negyedik helyre,
   * hajtás alá került. A sorrend a lap lényege, ezért őr védi.
   */
  it('a szekciók a döntés szerinti sorrendben állnak', () => {
    const html = renderToStaticMarkup(
      createElement(StatisticsReport, {
        report: revenueReport,
        engagement: { courses: [sor()], truncated: false, skipped: 0, omitted: 0 },
      }),
    )
    const cimek = [...html.matchAll(/<h2>([^<]*)<\/h2>/g)].map((t) => t[1])
    expect(cimek).toEqual([
      'Bevétel az elmúlt 12 hónapban',
      'Rendelések állapota',
      'Ki hol tart a kurzusokban',
      'Havi befizetések (tájékoztató)',
      'Bevétel kurzusonként',
    ])
    // Az összesítő kártyák FÖLÖTT is van címsor (WCAG 2.2 SC 2.4.6).
    expect(html.indexOf('Bevétel az elmúlt 12 hónapban')).toBeLessThan(
      html.indexOf('Bruttó befizetések (tájékoztató)'),
    )
  })
})
