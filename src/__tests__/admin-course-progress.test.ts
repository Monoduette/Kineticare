import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import {
  ariaSortValue,
  csvFileName,
  dropOffLabel,
  filterStudents,
  formatRelativeHungarian,
  moduleColumnCell,
  nextLessonLabel,
  readProgressDeepLink,
  ringGeometry,
  sortIndicator,
  sortStudents,
  statusLabel,
  studentRowLabel,
  studentsCsv,
  visibleCountLabel,
  NO_DATA,
  PROGRESS_DEEP_LINK_PARAM,
  PROGRESS_PANEL_ANCHOR,
} from '../components/admin/course-progress-view'
import {
  createCourseProgressHandler,
  ENROLLMENT_MAX,
  ENROLLMENT_PAGE_SIZE,
  PROGRESS_MAX,
} from '../lib/admin/course-progress-handler'
import {
  buildCourseProgressStats,
  type CourseEnrollment,
  type CourseProgressStatRow,
  type CourseStudentProgress,
} from '../lib/admin/course-progress-stats'
import { buildCurriculum, type Curriculum } from '../lib/curriculum/curriculum'

/** Admin kurzus-haladás: tiszta függvények + injektált Payload-mock; nincs hálózat. */

/** Videó-lecke a tananyaghoz — `ready` státusz nélkül nem lenne elindítható. */
function lesson(id: string, title: string, status: 'ready' | 'processing' = 'ready') {
  return { id, title, kind: 'video' as const, streamAssetId: `guid-${id}`, status, durationSec: 60 }
}

/** Kétmodulos, 4 elindítható leckés próbakurzus. */
function demoCurriculum(): Curriculum {
  return buildCurriculum(
    {
      modules: [
        {
          title: '1. fejezet',
          lessons: [lesson('l1', 'Első lecke'), lesson('l2', 'Második lecke')],
        },
        {
          title: '2. fejezet',
          lessons: [lesson('l3', 'Harmadik lecke'), lesson('l4', 'Negyedik lecke')],
        },
      ],
      videos: null,
    } as unknown as Parameters<typeof buildCurriculum>[0],
    true,
  )
}

function enrollment(userId: number, name: string): CourseEnrollment {
  return { userId, email: `user${String(userId)}@example.test`, name }
}

function row(userId: number, videoRef: string, watchedAt?: string): CourseProgressStatRow {
  return { userId, videoRef, watchedAt: watchedAt ?? '2026-08-01T10:00:00.000Z' }
}

describe('buildCourseProgressStats — összesítés', () => {
  it('0 beiratkozott: minden összesítő 0, nincs nullával osztás', () => {
    const stats = buildCourseProgressStats({
      curriculum: demoCurriculum(),
      enrollments: [],
      progressRows: [],
    })

    expect(stats.students).toEqual([])
    expect(stats.totals).toEqual({
      enrolled: 0,
      started: 0,
      completed: 0,
      notStarted: 0,
      averagePercent: 0,
      completionRateOfEnrolled: 0,
      completionRateOfStarted: 0,
    })
    // A lemorzsolódás-sorok a TANANYAGBÓL jönnek, tehát léteznek beiratkozott nélkül is.
    expect(stats.lessons).toHaveLength(4)
    expect(stats.lessons.every((entry) => entry.completedCount === 0)).toBe(true)
  })

  it('0 leckés kurzus: 0% és „nem-kezdte", nincs hiba', () => {
    const stats = buildCourseProgressStats({
      curriculum: buildCurriculum({ modules: null, videos: null }, true),
      enrollments: [enrollment(1, 'Kovács Anna')],
      progressRows: [row(1, 'barmi')],
    })

    expect(stats.lessons).toEqual([])
    expect(stats.students[0]).toMatchObject({
      completed: 0,
      total: 0,
      percent: 0,
      status: 'nem-kezdte',
      currentLessonTitle: null,
    })
    expect(stats.totals.averagePercent).toBe(0)
    expect(stats.totals.completionRateOfEnrolled).toBe(0)
  })

  it('senki nem kezdte el: started 0, notStarted = enrolled', () => {
    const stats = buildCourseProgressStats({
      curriculum: demoCurriculum(),
      enrollments: [enrollment(1, 'A'), enrollment(2, 'B')],
      progressRows: [],
    })

    expect(stats.totals).toMatchObject({ enrolled: 2, started: 0, completed: 0, notStarted: 2 })
    expect(stats.students.map((student) => student.status)).toEqual(['nem-kezdte', 'nem-kezdte'])
    expect(stats.students[0].currentLessonTitle).toBe('Első lecke')
  })

  it('mindenki befejezte: 100%, és nincs „aktuális lecke"', () => {
    const refs = ['l1', 'l2', 'l3', 'l4']
    const stats = buildCourseProgressStats({
      curriculum: demoCurriculum(),
      enrollments: [enrollment(1, 'A'), enrollment(2, 'B')],
      progressRows: [1, 2].flatMap((userId) => refs.map((ref) => row(userId, ref))),
    })

    expect(stats.totals).toMatchObject({
      enrolled: 2,
      started: 2,
      completed: 2,
      notStarted: 0,
      averagePercent: 100,
      completionRateOfEnrolled: 100,
      completionRateOfStarted: 100,
    })
    expect(stats.students.every((student) => student.status === 'befejezte')).toBe(true)
    expect(stats.students.every((student) => student.currentLessonTitle === null)).toBe(true)
  })

  it('vegyes állapotok: átlag és arányok a definíció szerint', () => {
    const stats = buildCourseProgressStats({
      curriculum: demoCurriculum(),
      enrollments: [enrollment(1, 'A'), enrollment(2, 'B'), enrollment(3, 'C'), enrollment(4, 'D')],
      progressRows: [
        // 1: mind a 4 → 100% (befejezte)
        row(1, 'l1'),
        row(1, 'l2'),
        row(1, 'l3'),
        row(1, 'l4'),
        // 2: 2 lecke → 50% (folyamatban)
        row(2, 'l1'),
        row(2, 'l2'),
        // 3: 1 lecke → 25% (folyamatban)
        row(3, 'l1'),
        // 4: semmi → 0% (nem kezdte)
      ],
    })

    expect(stats.totals.enrolled).toBe(4)
    expect(stats.totals.started).toBe(3)
    expect(stats.totals.completed).toBe(1)
    expect(stats.totals.notStarted).toBe(1)
    // (100 + 50 + 25 + 0) / 4 = 43,75 → 44
    expect(stats.totals.averagePercent).toBe(44)
    // 1/4 = 25%, 1/3 = 33%
    expect(stats.totals.completionRateOfEnrolled).toBe(25)
    expect(stats.totals.completionRateOfStarted).toBe(33)
    expect(stats.students[1]).toMatchObject({ percent: 50, currentLessonTitle: 'Harmadik lecke' })
  })

  it('orphan ref (törölt leckére mutató sor) nem számít bele', () => {
    const stats = buildCourseProgressStats({
      curriculum: demoCurriculum(),
      enrollments: [enrollment(1, 'A')],
      progressRows: [row(1, 'l1'), row(1, 'torolt-lecke'), row(1, '   ')],
    })

    expect(stats.students[0]).toMatchObject({ completed: 1, total: 4, percent: 25 })
    // Az orphan sor a lemorzsolódásban sem jelenik meg új sorként.
    expect(stats.lessons.map((entry) => entry.lessonRef)).toEqual(['l1', 'l2', 'l3', 'l4'])
  })

  it('nem beiratkozott felhasználó haladás-sorai teljesen kimaradnak', () => {
    const stats = buildCourseProgressStats({
      curriculum: demoCurriculum(),
      enrollments: [enrollment(1, 'A')],
      progressRows: [row(1, 'l1'), row(99, 'l1'), row(99, 'l2'), row(99, 'l3'), row(99, 'l4')],
    })

    expect(stats.students).toHaveLength(1)
    expect(stats.totals).toMatchObject({ enrolled: 1, started: 1, completed: 0 })
    // A 99-es sorai nem duzzasztják fel az első lecke elvégzettségét.
    expect(stats.lessons[0].completedCount).toBe(1)
  })

  it('duplikált haladás-sor nem torzít', () => {
    const stats = buildCourseProgressStats({
      curriculum: demoCurriculum(),
      enrollments: [enrollment(1, 'A')],
      progressRows: [row(1, 'l1'), row(1, 'l1'), row(1, 'l1')],
    })

    expect(stats.students[0]).toMatchObject({ completed: 1, percent: 25 })
    expect(stats.lessons[0].completedCount).toBe(1)
  })

  it('duplikált beiratkozás (ugyanaz a userId kétszer) egyszer jelenik meg', () => {
    const stats = buildCourseProgressStats({
      curriculum: demoCurriculum(),
      enrollments: [enrollment(1, 'A'), enrollment(1, 'A ismét')],
      progressRows: [row(1, 'l1')],
    })

    expect(stats.students).toHaveLength(1)
    expect(stats.totals.enrolled).toBe(1)
    expect(stats.lessons[0].completedCount).toBe(1)
  })

  it('a feldolgozás alatti videó nem kerül a nevezőbe és a lemorzsolódásba sem', () => {
    const curriculum = buildCurriculum(
      {
        modules: [
          {
            title: 'F',
            lessons: [lesson('l1', 'Kész lecke'), lesson('l2', 'Készülő lecke', 'processing')],
          },
        ],
        videos: null,
      } as unknown as Parameters<typeof buildCurriculum>[0],
      true,
    )
    const stats = buildCourseProgressStats({
      curriculum,
      enrollments: [enrollment(1, 'A')],
      progressRows: [row(1, 'l1')],
    })

    expect(stats.students[0]).toMatchObject({ completed: 1, total: 1, percent: 100, status: 'befejezte' })
    expect(stats.lessons).toHaveLength(1)
  })

  it('lastActivityAt a legkésőbbi SZÁMÍTÓ megjelölés; az orphan sor nem viszi előre', () => {
    const stats = buildCourseProgressStats({
      curriculum: demoCurriculum(),
      enrollments: [enrollment(1, 'A')],
      progressRows: [
        row(1, 'l1', '2026-08-01T08:00:00.000Z'),
        row(1, 'l2', '2026-08-03T08:00:00.000Z'),
        row(1, 'torolt', '2026-08-30T08:00:00.000Z'),
        { userId: 1, videoRef: 'l3', watchedAt: 'nem-datum' },
      ],
    })

    expect(stats.students[0].lastActivityAt).toBe('2026-08-03T08:00:00.000Z')
  })

  it('lemorzsolódás: leckénkénti elvégzettség és a veszteség az előzőhöz képest', () => {
    const stats = buildCourseProgressStats({
      curriculum: demoCurriculum(),
      enrollments: [enrollment(1, 'A'), enrollment(2, 'B'), enrollment(3, 'C')],
      progressRows: [
        row(1, 'l1'),
        row(2, 'l1'),
        row(3, 'l1'),
        row(1, 'l2'),
        row(2, 'l2'),
        row(1, 'l3'),
        // l4-et senki
      ],
    })

    expect(
      stats.lessons.map((entry) => [entry.title, entry.completedCount, entry.dropOffFromPrevious]),
    ).toEqual([
      ['Első lecke', 3, 0],
      ['Második lecke', 2, 1],
      ['Harmadik lecke', 1, 1],
      ['Negyedik lecke', 0, 1],
    ])
    expect(stats.lessons[0].moduleTitle).toBe('1. fejezet')
    expect(stats.lessons[3].moduleTitle).toBe('2. fejezet')
  })

  it('átugrott lecke: a „visszaugró" darabszám nem ad negatív lemorzsolódást', () => {
    const stats = buildCourseProgressStats({
      curriculum: demoCurriculum(),
      enrollments: [enrollment(1, 'A'), enrollment(2, 'B')],
      // Az l2-t senki, az l3-at mindenki — a 2. lecke „gödör" a tölcsérben.
      progressRows: [row(1, 'l1'), row(2, 'l1'), row(1, 'l3'), row(2, 'l3')],
    })

    expect(stats.lessons.map((entry) => entry.dropOffFromPrevious)).toEqual([0, 2, 0, 2])
    expect(stats.lessons[2].completedCount).toBe(2)
  })
})

/* HTTP-végpont — injektált Payload-mock, nincs hálózat. */

const URL_BASE = 'http://localhost:3000/api/admin/course-progress'

interface MockOptions {
  authUser?: { id: number; role: string } | null
  productExists?: boolean
  users?: Array<{ id: number; email: string; name?: string | null }>
  progress?: Array<{ user: number; videoRef: string; watchedAt: string }>
  /** Ennyi leckéből álljon a próbakurzus (alapértelmezés: a 4 leckés demó). */
  lessonCount?: number
  /**
   * Mely lapozás-mezőket adja vissza a mock.
   *
   * A valódi Payload MINDKETTŐT megadja (`teljes`), de a csonkolás-szabály
   * tartalék-ágait csak úgy lehet megmérni, ha a mock szándékosan elhagyja
   * őket — pontosan ezen az ágon jelentett a felület hiánytalan adatra
   * csonkolást.
   */
  pageMeta?: 'teljes' | 'csak-total' | 'egyik-sem'
}

/**
 * Lapozást is kiszolgáló Payload-mock: a `find` a `page`/`limit` szerint szeletel,
 * és `hasNextPage`-et is ad — így a handler lapozó ciklusa VALÓDIAN fut le.
 */
function createMockPayload(options: MockOptions = {}) {
  const users = options.users ?? [
    { id: 1, email: 'anna@example.test', name: 'Kovács Anna' },
    { id: 2, email: 'bela@example.test', name: 'Nagy Béla' },
  ]
  const progress = options.progress ?? [
    { user: 1, videoRef: 'l1', watchedAt: '2026-08-10T08:00:00.000Z' },
    { user: 1, videoRef: 'l2', watchedAt: '2026-08-11T08:00:00.000Z' },
  ]
  const product =
    options.lessonCount === undefined
      ? {
          id: 42,
          displayTitle: 'Kéztorna otthon',
          sku: 'DEMO-001',
          modules: [
            {
              title: '1. fejezet',
              lessons: [lesson('l1', 'Első lecke'), lesson('l2', 'Második lecke')],
            },
            {
              title: '2. fejezet',
              lessons: [lesson('l3', 'Harmadik lecke'), lesson('l4', 'Negyedik lecke')],
            },
          ],
          videos: null,
        }
      : {
          id: 42,
          displayTitle: 'Kéztorna otthon',
          sku: 'DEMO-001',
          modules: [
            {
              title: '1. fejezet',
              lessons: Array.from({ length: options.lessonCount }, (_, index) =>
                lesson(`l${String(index + 1)}`, `${String(index + 1)}. lecke`),
              ),
            },
          ],
          videos: null,
        }

  const calls: Array<{
    collection: string
    page?: number
    limit?: number
    sort?: string | string[]
  }> = []

  /** A `sort` mező érvényesítése a mockolt haladás-sorokon (stabil rendezés). */
  const sortolt = (
    rows: Array<{ user: number; videoRef: string; watchedAt: string }>,
    sort: string | string[] | undefined,
  ) => {
    const mezok = Array.isArray(sort) ? sort : sort === undefined ? [] : [sort]
    if (!mezok.includes('user')) {
      return rows
    }
    return rows
      .map((entry, index) => ({ entry, index }))
      .sort((left, right) =>
        left.entry.user === right.entry.user
          ? left.index - right.index
          : left.entry.user - right.entry.user,
      )
      .map(({ entry }) => entry)
  }

  const pageMeta = options.pageMeta ?? 'teljes'
  const page = <T,>(rows: T[], pageNumber = 1, limit = 10) => {
    const start = (pageNumber - 1) * limit
    const docs = rows.slice(start, start + limit)
    return {
      docs,
      ...(pageMeta === 'egyik-sem' ? {} : { totalDocs: rows.length }),
      ...(pageMeta === 'teljes' ? { hasNextPage: start + docs.length < rows.length } : {}),
    }
  }

  const payload = {
    auth: vi.fn(async () => ({
      user:
        options.authUser === undefined ? { id: 1, role: 'owner' } : options.authUser,
    })),
    find: vi.fn(
      async (args: {
        collection: string
        page?: number
        limit?: number
        sort?: string | string[]
      }) => {
      calls.push({
        collection: args.collection,
        page: args.page,
        limit: args.limit,
        sort: args.sort,
      })
      if (args.collection === 'products') {
        return (options.productExists ?? true)
          ? { docs: [product], totalDocs: 1, hasNextPage: false }
          : { docs: [], totalDocs: 0, hasNextPage: false }
      }
      if (args.collection === 'users') {
        return page(users, args.page, args.limit)
      }
      if (args.collection === 'course-progress') {
        // A mock TISZTELETBEN TARTJA a rendezést — enélkül a csonkolási teszt
        // épp azt a viselkedést nem tudná ellenőrizni, ami a javítás lényege.
        const sorted = sortolt(progress, args.sort)
        return page(sorted, args.page, args.limit)
      }
      return { docs: [], totalDocs: 0, hasNextPage: false }
      },
    ),
  }

  return { payload: payload as unknown as Payload, calls }
}

function handlerFor(options: MockOptions = {}) {
  const { payload, calls } = createMockPayload(options)
  return { handler: createCourseProgressHandler({ getPayload: async () => payload }), calls }
}

function getRequest(query = '?productId=42'): Request {
  return new Request(`${URL_BASE}${query}`, { method: 'GET' })
}

describe('GET /api/admin/course-progress — jogosultság és validálás', () => {
  it('401, ha nincs bejelentkezett felhasználó', async () => {
    const { handler } = handlerFor({ authUser: null })

    const response = await handler(getRequest())
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(401)
    expect(body.error).toContain('bejelentkezés')
  })

  it('403 customer szerepkörrel', async () => {
    const { handler } = handlerFor({ authUser: { id: 9, role: 'customer' } })

    const response = await handler(getRequest())
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(403)
    expect(body.error).toContain('jogosultság')
  })

  it('400 hiányzó productId esetén', async () => {
    const { handler } = handlerFor()

    const response = await handler(getRequest(''))
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(400)
    // A SZÁNDÉKOT mérjük, nem a megfogalmazást: az üzenet mondja meg, MELYIK
    // adat hiányzik, és mondja meg a teendőt (docs/ui-sztenderdek.md §2.7).
    // A korábbi `toContain('kurzus-azonosító')` a kötőjeles alakra kötötte a
    // tesztet, ezért egy jogos átfogalmazás elbuktatta.
    // A két szó EGYÜTT, ebben a sorrendben kell: a korábbi, külön `toContain`
    // páros egy „a felhasználó azonosítója… kurzus…" alakú, ROSSZ MEZŐT
    // megnevező üzenetet is átengedett volna.
    expect(body.error).toMatch(/kurzus\w* azonosító/i)
    expect(body.error).toMatch(/Nyisd|Frissítsd|próbáld/i)
  })

  it('400 nem szám vagy nem pozitív productId esetén', async () => {
    const { handler } = handlerFor()

    for (const query of ['?productId=abc', '?productId=0', '?productId=-3', '?productId=1.5']) {
      const response = await handler(getRequest(query))
      expect(response.status).toBe(400)
    }
  })

  it('MINDEN ág no-store fejlécet ad (200, 401, 403, 400, 404, 500)', async () => {
    // A 200-as ág névvel és e-maillel azonosított hallgatók haladását
    // hordozza; a tiltó ágak azért kapják meg, hogy egy 401/403 válasz ne
    // ragadhasson be a bejelentkezés utánra.
    const { handler } = handlerFor()
    expect((await handler(getRequest())).headers.get('Cache-Control')).toBe('no-store')
    expect((await handler(getRequest(''))).headers.get('Cache-Control')).toBe('no-store')

    const anon = handlerFor({ authUser: null })
    expect((await anon.handler(getRequest())).headers.get('Cache-Control')).toBe('no-store')

    const customer = handlerFor({ authUser: { id: 9, role: 'customer' } })
    expect((await customer.handler(getRequest())).headers.get('Cache-Control')).toBe('no-store')

    const nincsKurzus = handlerFor({ productExists: false })
    expect((await nincsKurzus.handler(getRequest())).headers.get('Cache-Control')).toBe('no-store')

    const hibas = createCourseProgressHandler({
      getPayload: async () => {
        throw new Error('adatbázis nem elérhető')
      },
    })
    expect((await hibas(getRequest())).headers.get('Cache-Control')).toBe('no-store')
  })

  it('404 ismeretlen kurzusnál', async () => {
    const { handler } = handlerFor({ productExists: false })

    const response = await handler(getRequest())
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(404)
    expect(body.error).toContain('Nincs ilyen kurzus')
  })

  it('500 váratlan technikai hibánál (magyar üzenet)', async () => {
    const handler = createCourseProgressHandler({
      getPayload: async () => {
        throw new Error('adatbázis nem elérhető')
      },
    })

    const response = await handler(getRequest())
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(500)
    // §2.7: a hibaüzenet a helyzetet és a teendőt mondja (nem „Váratlan hiba…").
    expect(body.error).toContain('A kurzus-haladás most nem kérdezhető le')
  })
})

describe('GET /api/admin/course-progress — 200 válasz', () => {
  it('staff szerepkörrel is kiszolgál, és a KÖZÖS számítás szerinti százalékot adja', async () => {
    const { handler } = handlerFor({ authUser: { id: 5, role: 'staff' } })

    const response = await handler(getRequest())
    const body = (await response.json()) as {
      product: { id: number; title: string }
      totals: { enrolled: number; started: number; completed: number; averagePercent: number }
      students: CourseStudentProgress[]
      lessons: Array<{ lessonRef: string; completedCount: number }>
      meta: { totalLessons: number; enrollments: { returned: number; truncated: boolean } }
      notice: string | null
    }

    expect(response.status).toBe(200)
    expect(body.product).toEqual({ id: 42, title: 'Kéztorna otthon' })
    expect(body.meta.totalLessons).toBe(4)
    expect(body.totals).toMatchObject({ enrolled: 2, started: 1, completed: 0, averagePercent: 25 })
    expect(body.students[0]).toMatchObject({
      userId: 1,
      name: 'Kovács Anna',
      completed: 2,
      total: 4,
      percent: 50,
      status: 'folyamatban',
      currentLessonTitle: 'Harmadik lecke',
      lastActivityAt: '2026-08-11T08:00:00.000Z',
    })
    expect(body.students[1]).toMatchObject({ userId: 2, percent: 0, status: 'nem-kezdte' })
    expect(body.lessons).toHaveLength(4)
    expect(body.meta.enrollments).toEqual({ returned: 2, total: 2, truncated: false, omitted: 0 })
    expect(body.notice).toBeNull()
  })

  it('nulla beiratkozottnál üres lista, hibátlan összesítéssel', async () => {
    const { handler } = handlerFor({ users: [], progress: [] })

    const response = await handler(getRequest())
    const body = (await response.json()) as {
      students: unknown[]
      totals: { enrolled: number }
    }

    expect(response.status).toBe(200)
    expect(body.students).toEqual([])
    expect(body.totals.enrolled).toBe(0)
  })

  it('a beiratkozottakat LAPOZVA olvassa be — a 10-es alapértelmezett limit nem csonkol', async () => {
    const manyUsers = Array.from({ length: ENROLLMENT_PAGE_SIZE + 25 }, (_, index) => ({
      id: index + 1,
      email: `u${String(index + 1)}@example.test`,
      name: `Hallgató ${String(index + 1)}`,
    }))
    const { handler, calls } = handlerFor({ users: manyUsers, progress: [] })

    const response = await handler(getRequest())
    const body = (await response.json()) as {
      totals: { enrolled: number }
      meta: { enrollments: { returned: number; truncated: boolean } }
    }

    expect(body.totals.enrolled).toBe(manyUsers.length)
    expect(body.meta.enrollments).toEqual({
      returned: manyUsers.length,
      total: manyUsers.length,
      truncated: false,
      omitted: 0,
    })
    // Explicit limit MINDEN lekérdezésen — sosem az alapértelmezett 10.
    expect(calls.filter((call) => call.collection === 'users')).toHaveLength(2)
    expect(calls.every((call) => call.collection === 'products' || call.limit !== undefined)).toBe(true)
  })

  it('a felső korlát fölött CSONKOL, és ezt ki is mondja (nem hallgatja el)', async () => {
    const manyUsers = Array.from({ length: ENROLLMENT_MAX + 5 }, (_, index) => ({
      id: index + 1,
      email: `u${String(index + 1)}@example.test`,
      name: null,
    }))
    const { handler } = handlerFor({ users: manyUsers, progress: [] })

    const response = await handler(getRequest())
    const body = (await response.json()) as {
      totals: { enrolled: number }
      meta: { enrollments: { returned: number; total: number; truncated: boolean } }
      notice: string | null
    }

    expect(body.totals.enrolled).toBe(ENROLLMENT_MAX)
    expect(body.meta.enrollments).toEqual({
      returned: ENROLLMENT_MAX,
      total: manyUsers.length,
      truncated: true,
      omitted: 0,
    })
    expect(body.notice).toContain('csonkolt')
  })

  it('pontosan a korláttal egyező létszám NEM számít csonkoltnak', async () => {
    const exactUsers = Array.from({ length: ENROLLMENT_MAX }, (_, index) => ({
      id: index + 1,
      email: `u${String(index + 1)}@example.test`,
      name: null,
    }))
    const { handler } = handlerFor({ users: exactUsers, progress: [] })

    const response = await handler(getRequest())
    const body = (await response.json()) as {
      meta: { enrollments: { truncated: boolean } }
      notice: string | null
    }

    expect(body.meta.enrollments.truncated).toBe(false)
    expect(body.notice).toBeNull()
  })

  it('pontosan a korláton, `hasNextPage` NÉLKÜL sem csonkolt (a totalDocs dönt)', async () => {
    // MÉRT HIBA (vezetői kör, 2026-08-21): a `hasNextPage` hiányában a szabály
    // a „tele volt az utolsó lap" becslésre esett vissza, és a PONTOSAN a
    // korláttal egyező, TELJES halmazt is csonkoltnak jelölte — a panel
    // hiánytalan adatra írta ki, hogy a lista csonka.
    const exactUsers = Array.from({ length: ENROLLMENT_MAX }, (_unused, index) => ({
      id: index + 1,
      email: `u${String(index + 1)}@example.test`,
      name: null,
    }))
    const { handler } = handlerFor({
      users: exactUsers,
      progress: [],
      pageMeta: 'csak-total',
    })

    const response = await handler(getRequest())
    const body = (await response.json()) as {
      meta: { enrollments: { truncated: boolean; total: number | null } }
      notice: string | null
    }

    expect(body.meta.enrollments.total).toBe(ENROLLMENT_MAX)
    expect(body.meta.enrollments.truncated).toBe(false)
    expect(body.notice).toBeNull()
  })

  it('a korlát FÖLÖTT `hasNextPage` nélkül is csonkoltnak jelöl', async () => {
    const manyUsers = Array.from({ length: ENROLLMENT_MAX + 5 }, (_unused, index) => ({
      id: index + 1,
      email: `u${String(index + 1)}@example.test`,
      name: null,
    }))
    const { handler } = handlerFor({
      users: manyUsers,
      progress: [],
      pageMeta: 'csak-total',
    })

    const body = (await (await handler(getRequest())).json()) as {
      meta: { enrollments: { truncated: boolean } }
      notice: string | null
    }
    expect(body.meta.enrollments.truncated).toBe(true)
    expect(body.notice).toContain('csonkolt')
  })

  it('EGYIK lapozás-szám nélkül a tartalék-ág marad — inkább jelez, mint hallgat', async () => {
    // Valós Payload-válaszban ez nem fordul elő; a becslés szándékosan a
    // hamis pozitív irányába téved, mert az elhallgatott csonkolás a
    // súlyosabb hiba.
    const exactUsers = Array.from({ length: ENROLLMENT_MAX }, (_unused, index) => ({
      id: index + 1,
      email: `u${String(index + 1)}@example.test`,
      name: null,
    }))
    const { handler } = handlerFor({
      users: exactUsers,
      progress: [],
      pageMeta: 'egyik-sem',
    })

    const body = (await (await handler(getRequest())).json()) as {
      meta: { enrollments: { truncated: boolean } }
    }
    expect(body.meta.enrollments.truncated).toBe(true)
  })
})

/** Csonkolás után a listázott diákok százaléka hiánytalan adatra épül (user-határ vágás). */
describe('GET /api/admin/course-progress — csonkolás és HELYES százalékok', () => {
  /** 20 leckés kurzus, `hallgatok` fővel, MINDENKI végigcsinálta. */
  function teljesenElvegezte(hallgatok: number, leckek: number) {
    const users = Array.from({ length: hallgatok }, (_, index) => ({
      id: index + 1,
      email: `u${String(index + 1)}@example.test`,
      name: `Hallgató ${String(index + 1)}`,
    }))
    // A sorok LECKE szerint csoportosítva születnek — ez modellezi a valóságot
    // (a beszúrási sorrend időrendi, nem felhasználónkénti).
    const progress: Array<{ user: number; videoRef: string; watchedAt: string }> = []
    for (let lessonIndex = 1; lessonIndex <= leckek; lessonIndex += 1) {
      for (const user of users) {
        progress.push({
          user: user.id,
          videoRef: `l${String(lessonIndex)}`,
          watchedAt: '2026-08-01T10:00:00.000Z',
        })
      }
    }
    return { users, progress }
  }

  it('a haladás-olvasás FELHASZNÁLÓ szerint rendez (ez teszi user-határon vághatóvá)', async () => {
    const { handler, calls } = handlerFor()
    await handler(getRequest())

    const progressCalls = calls.filter((call) => call.collection === 'course-progress')
    expect(progressCalls.length).toBeGreaterThan(0)
    for (const call of progressCalls) {
      expect(call.sort).toEqual(['user', 'id'])
    }
  })

  it('csonkolásnál EGYETLEN megjelenített diák százaléka sem alulmért', async () => {
    const { users, progress } = teljesenElvegezte(1500, 20)
    expect(progress.length).toBeGreaterThan(PROGRESS_MAX)

    const { handler } = handlerFor({ users, progress, lessonCount: 20 })
    const response = await handler(getRequest())
    const body = (await response.json()) as {
      students: CourseStudentProgress[]
      totals: { enrolled: number; completed: number }
      meta: {
        totalLessons: number
        enrollments: { returned: number; total: number | null; truncated: boolean; omitted: number }
        progressRows: { returned: number; truncated: boolean }
      }
      notice: string | null
    }

    expect(response.status).toBe(200)
    expect(body.meta.totalLessons).toBe(20)
    expect(body.meta.progressRows.truncated).toBe(true)

    // EZ a lényeg: aki szerepel a listában, annál a szám IGAZ — mindenki 100%.
    expect(body.students.length).toBeGreaterThan(0)
    for (const student of body.students) {
      expect(student.percent).toBe(100)
      expect(student.completed).toBe(20)
      expect(student.status).toBe('befejezte')
    }
    expect(body.totals.completed).toBe(body.students.length)

    // A kimaradt diákokat a válasz KIMONDJA — nem hallgatja el, és nem is
    // mutat róluk hamis (0%-os vagy alulmért) sort.
    expect(body.meta.enrollments.omitted).toBeGreaterThan(0)
    expect(body.meta.enrollments.returned).toBe(body.students.length)
    expect(body.meta.enrollments.returned + body.meta.enrollments.omitted).toBe(users.length)
    expect(body.notice).toContain('kimaradt')
  })

  it('a kimaradó diákok a NAGYOBB azonosítójúak (a lista eleje teljes)', async () => {
    const { users, progress } = teljesenElvegezte(1500, 20)
    const { handler } = handlerFor({ users, progress, lessonCount: 20 })

    const body = (await (await handler(getRequest())).json()) as {
      students: CourseStudentProgress[]
    }

    const azonositok = body.students.map((student) => student.userId)
    expect(azonositok[0]).toBe(1)
    // Folytonos, hézagmentes tartomány 1-től — nem „lyukas" minta.
    expect(azonositok).toEqual(azonositok.map((_, index) => index + 1))
  })

  it('csonkolás NÉLKÜL semmi nem marad ki (a javítás nem szűkít feleslegesen)', async () => {
    const { users, progress } = teljesenElvegezte(50, 20)
    const { handler } = handlerFor({ users, progress, lessonCount: 20 })

    const body = (await (await handler(getRequest())).json()) as {
      students: CourseStudentProgress[]
      meta: { enrollments: { omitted: number; truncated: boolean } }
      notice: string | null
    }

    expect(body.students).toHaveLength(50)
    expect(body.meta.enrollments.omitted).toBe(0)
    expect(body.notice).toBeNull()
    expect(body.students.every((student) => student.percent === 100)).toBe(true)
  })
})

/* Panel tiszta nézet-logika. */

function student(
  overrides: Partial<CourseStudentProgress> & Pick<CourseStudentProgress, 'userId'>,
): CourseStudentProgress {
  return {
    name: null,
    email: `u${String(overrides.userId)}@example.test`,
    completed: 0,
    total: 4,
    percent: 0,
    status: 'nem-kezdte',
    lastActivityAt: null,
    currentLessonTitle: null,
    enrolledAt: null,
    ...overrides,
  }
}

describe('course-progress-view — szűrés, keresés, rendezés', () => {
  const students = [
    student({ userId: 1, name: 'Kovács Anna', percent: 50, status: 'folyamatban', lastActivityAt: '2026-08-10T08:00:00.000Z' }),
    student({ userId: 2, name: 'Nagy Béla', percent: 100, status: 'befejezte', lastActivityAt: '2026-08-12T08:00:00.000Z' }),
    student({ userId: 3, name: 'Szabó Csilla', percent: 0, status: 'nem-kezdte' }),
  ]

  it('állapot-szűrő', () => {
    expect(filterStudents(students, { status: 'befejezte', query: '' }).map((s) => s.userId)).toEqual([2])
    expect(filterStudents(students, { status: 'mind', query: '' })).toHaveLength(3)
  })

  it('keresés névre és e-mailre, ékezet-érzéketlenül', () => {
    expect(filterStudents(students, { status: 'mind', query: 'kovacs' }).map((s) => s.userId)).toEqual([1])
    expect(filterStudents(students, { status: 'mind', query: 'SZABÓ' }).map((s) => s.userId)).toEqual([3])
    expect(filterStudents(students, { status: 'mind', query: 'u2@' }).map((s) => s.userId)).toEqual([2])
    expect(filterStudents(students, { status: 'mind', query: 'nincs ilyen' })).toEqual([])
  })

  it('a szűrő és a kereső együtt is dolgozik', () => {
    expect(
      filterStudents(students, { status: 'folyamatban', query: 'nagy' }),
    ).toEqual([])
  })

  it('haladás szerinti rendezés SZÁM szerint, mindkét irányban', () => {
    expect(sortStudents(students, 'haladas', 'asc').map((s) => s.percent)).toEqual([0, 50, 100])
    expect(sortStudents(students, 'haladas', 'desc').map((s) => s.percent)).toEqual([100, 50, 0])
  })

  it('a rendezés nem módosítja a bemeneti tömböt', () => {
    const before = students.map((s) => s.userId)
    sortStudents(students, 'haladas', 'desc')
    expect(students.map((s) => s.userId)).toEqual(before)
  })

  it('azonos százaléknál a név dönt (determinisztikus sorrend)', () => {
    const tie = [
      student({ userId: 10, name: 'Zsolt', percent: 25 }),
      student({ userId: 11, name: 'Anna', percent: 25 }),
    ]
    expect(sortStudents(tie, 'haladas', 'asc').map((s) => s.name)).toEqual(['Anna', 'Zsolt'])
  })

  it('aktivitás szerinti rendezés: a soha nem aktív hallgató növekvő sorrendben elöl', () => {
    expect(sortStudents(students, 'aktivitas', 'asc').map((s) => s.userId)).toEqual([3, 1, 2])
    expect(sortStudents(students, 'aktivitas', 'desc').map((s) => s.userId)).toEqual([2, 1, 3])
  })

  it('aria-sort csak az aktív oszlopon', () => {
    expect(ariaSortValue('haladas', 'haladas', 'asc')).toBe('ascending')
    expect(ariaSortValue('haladas', 'haladas', 'desc')).toBe('descending')
    expect(ariaSortValue('nev', 'haladas', 'asc')).toBe('none')
  })

  it('magyar állapot-feliratok', () => {
    expect(statusLabel('nem-kezdte')).toBe('Nem kezdte el')
    expect(statusLabel('folyamatban')).toBe('Folyamatban')
    expect(statusLabel('befejezte')).toBe('Befejezte')
  })
})

describe('course-progress-view — relatív idő és ring-geometria', () => {
  const now = new Date('2026-08-15T12:00:00.000Z')

  it('magyar relatív időpontok', () => {
    expect(formatRelativeHungarian('2026-08-15T11:59:30.000Z', now)).toBe('az imént')
    expect(formatRelativeHungarian('2026-08-15T11:30:00.000Z', now)).toBe('30 perce')
    expect(formatRelativeHungarian('2026-08-15T08:00:00.000Z', now)).toBe('4 órája')
    expect(formatRelativeHungarian('2026-08-14T10:00:00.000Z', now)).toBe('tegnap')
    expect(formatRelativeHungarian('2026-08-12T12:00:00.000Z', now)).toBe('3 napja')
    expect(formatRelativeHungarian('2026-08-01T12:00:00.000Z', now)).toBe('2 hete')
    expect(formatRelativeHungarian('2026-06-01T12:00:00.000Z', now)).toBe('2 hónapja')
    expect(formatRelativeHungarian('2024-06-01T12:00:00.000Z', now)).toBe('2 éve')
  })

  it('hiányzó vagy értelmezhetetlen időpont → null; jövőbeli → „az imént"', () => {
    expect(formatRelativeHungarian(null, now)).toBeNull()
    expect(formatRelativeHungarian('', now)).toBeNull()
    expect(formatRelativeHungarian('nem-datum', now)).toBeNull()
    expect(formatRelativeHungarian('2026-09-01T12:00:00.000Z', now)).toBe('az imént')
  })

  it('a ring ívhossza a százalékkal arányos, és a hibás érték sem fut túl', () => {
    const full = ringGeometry(100)
    expect(full.dash).toBeCloseTo(full.circumference)
    expect(full.gap).toBeCloseTo(0)

    const half = ringGeometry(50)
    expect(half.dash).toBeCloseTo(half.circumference / 2)

    expect(ringGeometry(0).dash).toBe(0)
    expect(ringGeometry(-10).dash).toBe(0)
    expect(ringGeometry(500).dash).toBeCloseTo(ringGeometry(100).circumference)
    expect(ringGeometry(Number.NaN).dash).toBe(0)
  })
})

/* Panel UX-javítások (szűrés-visszajelzés, következő lecke oszlop). */

function diak(
  overrides: Partial<CourseStudentProgress> & { userId: number },
): CourseStudentProgress {
  return {
    name: `Hallgató ${String(overrides.userId)}`,
    email: `u${String(overrides.userId)}@example.test`,
    completed: 0,
    total: 4,
    percent: 0,
    status: 'nem-kezdte',
    lastActivityAt: null,
    currentLessonTitle: 'Első lecke',
    enrolledAt: null,
    ...overrides,
  }
}

describe('visibleCountLabel — élő visszajelzés a szűrésről', () => {
  // Szűrésnél látszódjon a találatok száma (korábban 305 sort kellett kézzel számolni).
  it('szűrés nélkül, korlát nélkül csak a létszámot mondja', () => {
    expect(visibleCountLabel(12, 12, 12)).toBe('12 hallgató')
  })

  it('KORLÁTOZOTT listánál kimondja, hány sor látszik', () => {
    expect(visibleCountLabel(25, 305, 305)).toBe('305 hallgatóból 25 látszik')
  })

  it('szűrésnél a TALÁLATOK számát mondja', () => {
    expect(visibleCountLabel(41, 41, 305)).toBe('305 hallgatóból 41 felel meg a szűrésnek')
  })

  it('szűrés ÉS korlát együtt is egyértelmű', () => {
    expect(visibleCountLabel(25, 41, 305)).toBe(
      '305 hallgatóból 41 felel meg a szűrésnek, ebből 25 látszik',
    )
  })

  it('nulla találatnál sem törik el', () => {
    expect(visibleCountLabel(0, 0, 305)).toBe('305 hallgatóból 0 felel meg a szűrésnek')
  })
})

describe('nextLessonLabel — „Következő lecke" oszlop', () => {
  // „Nem kezdte el” soron ne álljon leckecím, mintha ott tartana.
  it('a NEM KEZDTE EL soron kimondja, hogy ez még csak a kezdőpont', () => {
    expect(
      nextLessonLabel({ status: 'nem-kezdte', currentLessonTitle: 'Fontos tudnivalók' }),
    ).toBe('Itt fog kezdeni: Fontos tudnivalók')
  })

  it('folyamatban lévőnél a lecke címe áll', () => {
    expect(nextLessonLabel({ status: 'folyamatban', currentLessonTitle: 'Harmadik lecke' })).toBe(
      'Harmadik lecke',
    )
  })

  it('befejezettnél nincs következő lecke, és ezt KI IS MONDJA', () => {
    expect(nextLessonLabel({ status: 'befejezte', currentLessonTitle: null })).toBe(
      'Nincs hátralévő lecke',
    )
  })

  // Kész kurzus vs. nincs elindítható lecke: külön felirat kell (nem mindkettő „—”).
  it('lecke nélküli kurzusnál NEM azt mondja, hogy befejezte', () => {
    expect(nextLessonLabel({ status: 'nem-kezdte', currentLessonTitle: null })).toBe(NO_DATA)
    expect(nextLessonLabel({ status: 'folyamatban', currentLessonTitle: null })).toBe(NO_DATA)
  })

  it('egyetlen felirat sem visel kvirtmínuszt (ui-sztenderdek §3.1.1)', () => {
    const feliratok = [
      nextLessonLabel({ status: 'befejezte', currentLessonTitle: null }),
      nextLessonLabel({ status: 'nem-kezdte', currentLessonTitle: null }),
      nextLessonLabel({ status: 'nem-kezdte', currentLessonTitle: 'Bevezető' }),
      visibleCountLabel(25, 41, 305),
      NO_DATA,
    ]
    for (const felirat of feliratok) {
      expect(felirat, felirat).not.toContain(String.fromCodePoint(0x2014))
    }
  })
})

describe('dropOffLabel — a lemorzsolódás-oszlop', () => {
  /**
   * A mért félrevezetés: a „—" KÉT dolgot jelentett („ez az első lecke" ÉS
   * „nem volt veszteség"), a növekedést pedig 0-ra vágta a kód — így a
   * modulhatárokon a tölcsér olvashatatlan volt (3/305 után 221/305, jelzés nélkül).
   */
  it('az ELSŐ leckét külön jelöli — nincs mihez hasonlítani', () => {
    expect(dropOffLabel(0, 305, null)).toBe('(kezdés)')
  })

  it('a nulla veszteség NEM ugyanaz, mint a kezdés', () => {
    expect(dropOffLabel(3, 200, 200)).toBe('0 fő')
  })

  it('a veszteséget negatív előjellel mutatja', () => {
    expect(dropOffLabel(2, 180, 200)).toBe('−20 fő')
  })

  it('a NÖVEKEDÉS is látszik (a modulhatárok így értelmezhetők)', () => {
    expect(dropOffLabel(6, 221, 3)).toBe('+218 fő')
  })
})

describe('moduleColumnCell — a fejezetcím ismétlődése', () => {
  it('a modul ELSŐ során NEM ismétlődőként jelenik meg', () => {
    expect(moduleColumnCell('4. ELŐZD MEG A BAJT', null)).toEqual({
      text: '4. ELŐZD MEG A BAJT',
      repeated: false,
    })
    expect(moduleColumnCell('4. ELŐZD MEG A BAJT', '3. GYAKORLATOK')).toEqual({
      text: '4. ELŐZD MEG A BAJT',
      repeated: false,
    })
  })

  /**
   * A korábbi változat ÜRES STRINGET adott, tehát a cella tényleg üres maradt:
   * a képernyőolvasó a modul 2., 3., 4. leckéjénél nem tudta megmondani, melyik
   * fejezetről van szó (WCAG 2.2 SC 1.3.1). A szöveg mostantól MINDIG ott van,
   * csak a megjelenítés rejti el.
   */
  it('ismétlődésnél a SZÖVEG megmarad, csak a `repeated` billen át', () => {
    const cella = moduleColumnCell('4. ELŐZD MEG A BAJT', '4. ELŐZD MEG A BAJT')
    expect(cella.repeated).toBe(true)
    expect(cella.text).toBe('4. ELŐZD MEG A BAJT')
  })

  it('üres fejezetcímnél sem marad üres a cella', () => {
    expect(moduleColumnCell('', null)).toEqual({ text: NO_DATA, repeated: false })
    expect(moduleColumnCell('   ', null).text).toBe(NO_DATA)
  })
})

describe('studentRowLabel — a sorfejléc azonosítója', () => {
  it('a nevet viszi, ha van', () => {
    expect(studentRowLabel({ name: 'Kovács Anna', email: 'anna@example.test' })).toBe('Kovács Anna')
  })

  /**
   * A sorfejléc nem lehet üres: ezt olvassa fel a képernyőolvasó a „67%" cella
   * előtt. Név híján az e-mail azonosít — UGYANAZ a tartalék, amit a névszerinti
   * rendezés használ, tehát a sorrend és a felolvasott azonosító nem csúszik szét.
   */
  it('név híján az e-mail azonosít', () => {
    expect(studentRowLabel({ name: null, email: 'anna@example.test' })).toBe('anna@example.test')
    expect(studentRowLabel({ name: '   ', email: 'anna@example.test' })).toBe('anna@example.test')
  })

  it('se név, se e-mail: akkor sem üres', () => {
    expect(studentRowLabel({ name: null, email: '' })).toBe(NO_DATA)
  })
})

describe('sortIndicator — LÁTHATÓ rendezés-jelölés', () => {
  /**
   * Eddig CSAK `aria-sort` volt: a látó felhasználó nem tudta, hogy a fejléc
   * rendezhető, és azt sem, melyik szerint áll a lista (NN/g, Data Tables).
   * A három jel ALAKBAN különbözik, nem árnyalatban (WCAG 2.2 SC 1.4.1).
   */
  it('az AKTÍV oszlop iránya látszik', () => {
    expect(sortIndicator('haladas', 'haladas', 'asc')).toEqual({ glyph: '↑', active: true })
    expect(sortIndicator('haladas', 'haladas', 'desc')).toEqual({ glyph: '↓', active: true })
  })

  it('az inaktív oszlopon is van jel — hogy látszódjon: rendezhető', () => {
    expect(sortIndicator('nev', 'haladas', 'asc')).toEqual({ glyph: '⇅', active: false })
  })

  it('a három jel PÁRONKÉNT különbözik (nem csak a szín különbözteti meg)', () => {
    const jelek = new Set([
      sortIndicator('nev', 'nev', 'asc').glyph,
      sortIndicator('nev', 'nev', 'desc').glyph,
      sortIndicator('nev', 'haladas', 'asc').glyph,
    ])
    expect(jelek.size).toBe(3)
  })
})

describe('readProgressDeepLink — a Statisztika oldalról érkező mély link', () => {
  /**
   * A szerződés KÖTÖTT (docs/statisztika-audit-2026-08-21.md 1. pont):
   *   /admin/collections/products/<id>?haladas=nem-kezdte#kurzus-haladas
   * A panel ilyenkor magától tölt be, beállítja a szűrőt és odagörget.
   * Paraméter nélkül MINDEN marad a gombra induló viselkedésnél (a mai
   * fejkomment teljesítmény-indoka sértetlen).
   */
  it('a szerződés három állapotát elfogadja', () => {
    expect(readProgressDeepLink('?haladas=nem-kezdte')).toBe('nem-kezdte')
    expect(readProgressDeepLink('?haladas=folyamatban')).toBe('folyamatban')
    expect(readProgressDeepLink('?haladas=befejezte')).toBe('befejezte')
  })

  it('a kérdőjel nélküli alakot is érti (URLSearchParams.toString())', () => {
    expect(readProgressDeepLink('haladas=befejezte')).toBe('befejezte')
  })

  it('más paraméterek mellől is kiszedi', () => {
    expect(readProgressDeepLink('?limit=10&haladas=folyamatban&sort=-id')).toBe('folyamatban')
  })

  it('paraméter NÉLKÜL null — ilyenkor nincs automata betöltés', () => {
    expect(readProgressDeepLink('')).toBeNull()
    expect(readProgressDeepLink(null)).toBeNull()
    expect(readProgressDeepLink(undefined)).toBeNull()
    expect(readProgressDeepLink('?limit=10')).toBeNull()
  })

  it('ISMERETLEN vagy hibás érték: úgy viselkedik, mintha nem lenne paraméter', () => {
    expect(readProgressDeepLink('?haladas=elakadt')).toBeNull()
    expect(readProgressDeepLink('?haladas=')).toBeNull()
    expect(readProgressDeepLink('?haladas=NEM-KEZDTE')).toBeNull()
    expect(readProgressDeepLink('?haladas[]=nem-kezdte')).toBeNull()
    // A „mind" nincs a szerződésben, és nem is szűkít semmire.
    expect(readProgressDeepLink('?haladas=mind')).toBeNull()
  })

  it('értelmezhetetlen query-stringen sem dob', () => {
    expect(() => readProgressDeepLink('%%%')).not.toThrow()
    expect(readProgressDeepLink('%%%')).toBeNull()
  })

  it('a paraméter és a horgony neve a szerződés szerinti', () => {
    expect(PROGRESS_DEEP_LINK_PARAM).toBe('haladas')
    expect(PROGRESS_PANEL_ANCHOR).toBe('kurzus-haladas')
  })
})

describe('studentsCsv / csvFileName — exportálás', () => {
  const diakok = [
    diak({
      userId: 1,
      name: 'Kovács "Anna"',
      completed: 2,
      percent: 50,
      status: 'folyamatban',
      lastActivityAt: '2026-08-11T08:00:00.000Z',
      currentLessonTitle: 'Harmadik lecke',
    }),
    diak({ userId: 2, name: null }),
  ]

  /**
   * A magyar Excel két dolgon bukik el: BOM nélkül összetöri az ékezeteket,
   * vesszős elválasztónál pedig minden sort EGY cellába tömörít.
   */
  it('UTF-8 BOM-mal kezdődik és PONTOSVESSZŐVEL tagol', () => {
    const csv = studentsCsv(diakok, { totalLessons: 4 })
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.split('\r\n')[0]).toBe(
      '﻿"Név";"E-mail";"Állapot";"Elvégzett leckék";"Összes lecke";"Haladás (%)";"Utolsó aktivitás";"Következő lecke"',
    )
  })

  it('az idézőjelet a mezőben megduplázza (nem töri el a sort)', () => {
    const csv = studentsCsv(diakok, { totalLessons: 4 })
    expect(csv).toContain('"Kovács ""Anna"""')
  })

  it('a hiányzó nevet üres mezőként viszi, nem „null"-ként', () => {
    const sorok = studentsCsv(diakok, { totalLessons: 4 }).split('\r\n')
    expect(sorok[2].startsWith('"";')).toBe(true)
    expect(sorok[2]).not.toContain('null')
  })

  it('a sorok CRLF-fel zárulnak (RFC 4180 / Excel)', () => {
    expect(studentsCsv(diakok, { totalLessons: 4 }).endsWith('\r\n')).toBe(true)
  })

  it('üres listánál is szabályos, fejléces fájl születik', () => {
    const csv = studentsCsv([], { totalLessons: 4 })
    expect(csv.split('\r\n').filter((sor) => sor.length > 0)).toHaveLength(1)
  })

  it('a fájlnév a kurzus nevét és a dátumot hordozza', () => {
    expect(csvFileName('Keztorna otthon', '2026-08-15T12:00:00.000Z')).toBe(
      'Keztorna-otthon-haladas-2026-08-15.csv',
    )
  })

  /**
   * BÖNGÉSZŐBEN MÉRT hiba: a Chromium NÉMÁN eldobja a `download` attribútum
   * teljes értékét, ha az nem ASCII — a fájl „download" néven mentődik. A
   * tartalom közben helyes marad, tehát egységteszttel ez nem látszott: ezért
   * őrizzük itt, ASCII-ra írt névvel.
   */
  it('a fájlnév ÉKEZETMENTES (különben a böngésző eldobja az egész nevet)', () => {
    expect(csvFileName('Kéztorna otthon — 8 hetes', '2026-08-15T12:00:00.000Z')).toBe(
      'Keztorna-otthon-8-hetes-haladas-2026-08-15.csv',
    )
    expect(csvFileName('Őszi tréning', '2026-08-15T12:00:00.000Z')).toBe(
      'Oszi-trening-haladas-2026-08-15.csv',
    )
  })

  it('a fájlnévből kiesik minden fájlrendszer-tiltott és nem ASCII karakter', () => {
    expect(csvFileName('Kurzus/2: "próba"? 🎉', '2026-08-15T12:00:00.000Z')).toBe(
      'Kurzus2-proba-haladas-2026-08-15.csv',
    )
  })

  it('üres kurzusnév és hibás dátum mellett sem lesz értelmetlen fájlnév', () => {
    expect(csvFileName('   ', '')).toBe('kurzus-haladas-datum-nelkul.csv')
  })
})
