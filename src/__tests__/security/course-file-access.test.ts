import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { PayloadRequest, SanitizedConfig, Where } from 'payload'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  COURSE_FILE_BATCH,
  courseFileReadAccess,
  MAX_FILE_ACCESS_QUERIES,
} from '../../access/courseFileRead'
import { withPrivateCourseFileResponse } from '../../access/privateResponse'
import { protectCourseFileUpdate } from '../../collections/CourseFiles'
import { validateCourseAttachments } from '../../fields/course-attachments'
import configPromise from '../../payload.config'
import { buildCurriculum } from '../../lib/curriculum/curriculum'
import type { Product } from '../../payload-types'

type Doc = Record<string, unknown>
type Query = {
  collection: string
  where?: Where
  select?: Doc
  id?: number
  overrideAccess?: boolean
  limit?: number
  page?: number
}
let getFile: (req: PayloadRequest) => Promise<Response>
let updateByID: (args: unknown) => Promise<unknown>
let findOperation: (args: unknown) => Promise<{ docs: Doc[]; totalDocs: number }>
let countOperation: (args: unknown) => Promise<{ totalDocs: number }>
let afterRead: (args: unknown) => Promise<Doc>
let getDataLoader: (req: PayloadRequest) => PayloadRequest['payloadDataLoader']
let sanitizedConfig: SanitizedConfig
let fixture: string
const now = new Date('2026-09-08T12:00:00Z')
const pixels = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N/8AAAAASUVORK5CYII=',
  'base64',
)

beforeAll(async () => {
  const entry = createRequire(import.meta.url).resolve('payload')
  getFile = (
    await import(pathToFileURL(entry.replace(/index\.js$/, 'uploads/endpoints/getFile.js')).href)
  ).getFileHandler
  updateByID = (
    await import(
      pathToFileURL(entry.replace(/index\.js$/, 'collections/operations/updateByID.js')).href
    )
  ).updateByIDOperation
  findOperation = (
    await import(pathToFileURL(entry.replace(/index\.js$/, 'collections/operations/find.js')).href)
  ).findOperation
  countOperation = (
    await import(pathToFileURL(entry.replace(/index\.js$/, 'collections/operations/count.js')).href)
  ).countOperation
  afterRead = (
    await import(pathToFileURL(entry.replace(/index\.js$/, 'fields/hooks/afterRead/index.js')).href)
  ).afterRead
  getDataLoader = (
    await import(pathToFileURL(entry.replace(/index\.js$/, 'collections/dataloader.js')).href)
  ).getDataLoader
  sanitizedConfig = await configPromise
  fixture = await mkdtemp(path.join(os.tmpdir(), 'kc-private-file-fixture-'))
  for (const name of [
    'private.png',
    ...['xs', 'sm', 'md', 'lg', 'og'].map((size) => `private-${size}.png`),
  ]) {
    await writeFile(path.join(fixture, name), pixels)
  }
})
afterAll(async () => {
  if (fixture) await rm(fixture, { recursive: true, force: true })
})
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
})
afterEach(() => {
  vi.useRealTimers()
})

function matches(doc: Doc, where: Where): boolean {
  if (where.and) return where.and.every((item) => matches(doc, item))
  if (where.or) return where.or.some((item) => matches(doc, item))
  return Object.entries(where).every(([key, condition]) => {
    const actual = key
      .split('.')
      .reduce<unknown>(
        (value, part) =>
          typeof value === 'object' && value !== null ? (value as Doc)[part] : undefined,
        doc,
      )
    const filter = condition as { equals?: unknown; in?: unknown[] }
    return filter.in ? filter.in.includes(actual) : actual === filter.equals
  })
}

function course(id = 42, files = [71]): Doc {
  return {
    id,
    status: 'published',
    _status: 'published',
    accessDurationDays: 30,
    modules: [{ lessons: [{ attachments: files.map((protectedFile) => ({ protectedFile })) }] }],
  }
}

function harness(
  options: {
    role?: 'anonymous' | 'customer' | 'staff' | 'owner'
    purchases?: number[]
    courses?: Doc[]
    asset?: Doc | null
    extraAssets?: Doc[]
    fail?: 'candidate' | 'snapshot' | 'metadata' | 'orders' | 'users'
    paidAt?: string | null
    grantAt?: string
  } = {},
) {
  const asset =
    options.asset === undefined
      ? {
          id: 71,
          course: 42,
          filename: 'private.png',
          sizes: Object.fromEntries(
            ['xs', 'sm', 'md', 'lg', 'og'].map((size) => [
              size,
              { filename: `private-${size}.png` },
            ]),
          ),
        }
      : options.asset
  const courses = options.courses ?? [course()]
  const find = vi.fn(async (query: Query) => {
    if (query.collection === 'course-files') {
      if (query.overrideAccess === false)
        return findOperation({ ...query, collection: req.payload.collections['course-files'], req })
      if (options.fail === 'candidate') throw new Error('Szintetikus file hiba')
      return { docs: asset ? [asset] : [], hasNextPage: false }
    }
    if (query.collection === 'products') {
      const snapshot = query.select?.modules !== undefined
      if (options.fail === (snapshot ? 'snapshot' : 'metadata'))
        throw new Error('Szintetikus snapshot hiba')
      return { docs: courses.filter((doc) => matches(doc, query.where!)), hasNextPage: false }
    }
    if (query.collection === 'orders') {
      if (options.fail === 'orders') throw new Error('Szintetikus order hiba')
      const paidAt = options.paidAt === undefined ? '2026-09-01T12:00:00Z' : options.paidAt
      return {
        docs:
          paidAt === null
            ? []
            : [
                {
                  id: 80,
                  status: 'paid',
                  createdAt: paidAt,
                  items: courses.map((doc) => ({ product: doc.id })),
                },
              ],
        hasNextPage: false,
      }
    }
    throw new Error(`Nem engedélyezett fixture query: ${query.collection}`)
  })
  const findByID = vi.fn(async (query: Query) => {
    if (query.collection === 'course-files') return asset
    if (options.fail === 'users') throw new Error('Szintetikus grant hiba')
    return {
      id: 7,
      purchases: options.purchases ?? [42],
      accessGrants: options.grantAt ? [{ product: 42, grantedAt: options.grantAt }] : [],
    }
  })
  const dbFindOne = vi.fn(async ({ where }: { where: Where }) =>
    asset && matches(asset, where) ? asset : null,
  )
  const availableAssets = [...(asset ? [asset] : []), ...(options.extraAssets ?? [])]
  const matching = (query: Query) =>
    availableAssets.filter((doc) => !query.where || matches(doc, query.where))
  const dbFind = vi.fn(async (query: Query) => {
    const docs = matching(query)
    const limit = query.limit || docs.length || 1
    const page = query.page || 1
    return {
      docs: structuredClone(docs.slice((page - 1) * limit, page * limit)),
      totalDocs: docs.length,
      totalPages: Math.ceil(docs.length / limit),
      page,
      limit,
      hasNextPage: page * limit < docs.length,
    }
  })
  const dbCount = vi.fn(async (query: Query) => ({ totalDocs: matching(query).length }))
  const role = options.role ?? 'customer'
  const sanitizedCollection = sanitizedConfig.collections.find(
    (item) => item.slug === 'course-files',
  )!
  const config = {
    ...sanitizedCollection,
    upload: { ...(sanitizedCollection.upload as object), staticDir: fixture },
  }
  const req = {
    context: {},
    user: role === 'anonymous' ? null : { id: 7, role, purchases: options.purchases ?? [42] },
    method: 'GET',
    routeParams: { collection: 'course-files', filename: 'private.png' },
    headers: new Headers(),
    searchParams: new URLSearchParams(),
    query: {},
    t: () => 'Forbidden',
    locale: 'hu',
    fallbackLocale: null,
    payload: {
      config: sanitizedConfig,
      collections: {
        ...Object.fromEntries(
          sanitizedConfig.collections.map((item) => [item.slug, { config: item }]),
        ),
        'course-files': { config },
      },
      find,
      findByID,
      db: { defaultIDType: 'number', findOne: dbFindOne, find: dbFind, count: dbCount },
      logger: { error: vi.fn() },
    },
  } as unknown as PayloadRequest
  req.payloadDataLoader = getDataLoader(req)
  const access = (id?: number) => courseFileReadAccess({ id, req })
  const route = withPrivateCourseFileResponse(async (request) => {
    req.headers = request.headers
    Object.defineProperty(req, 'method', { value: request.method, configurable: true })
    try {
      return await getFile(req)
    } catch (error) {
      const status =
        typeof error === 'object' && error !== null && 'status' in error
          ? Number(error.status)
          : 500
      return Response.json({ errors: [{ message: 'Hozzáférés megtagadva' }] }, { status })
    }
  })
  const file = (method = 'GET', headers?: HeadersInit) =>
    route(
      new Request('https://example.test/api/course-files/file/private.png', { method, headers }),
      { params: Promise.resolve({ slug: ['course-files', 'file', 'private.png'] }) },
    )
  const readCourse = (doc: Doc) =>
    afterRead({
      collection: req.payload.collections.products.config,
      context: req.context,
      depth: 1,
      doc: structuredClone(doc),
      draft: false,
      fallbackLocale: null,
      global: null,
      locale: 'hu',
      overrideAccess: false,
      req,
      showHiddenFields: false,
    })
  const list = (page = 1) =>
    findOperation({
      collection: req.payload.collections['course-files'],
      req,
      overrideAccess: false,
      disableErrors: true,
      depth: 0,
      page,
      limit: 1,
    })
  const count = () =>
    countOperation({
      collection: req.payload.collections['course-files'],
      req,
      overrideAccess: false,
      disableErrors: true,
    })
  return {
    access,
    file,
    req,
    find,
    findByID,
    dbFindOne,
    dbFind,
    asset,
    config,
    readCourse,
    list,
    count,
  }
}

describe('védett fájl: committed hivatkozás ÉS élő entitlement', () => {
  it.each(['anonymous', 'customer'] as const)(
    '%s nem vevő nem olvas metát vagy fájlt',
    async (role) => {
      const { access, file, find } = harness({ role, purchases: [] })
      expect(await access()).toBe(false)
      const response = await file()
      expect(response.status).toBe(403)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      if (role === 'anonymous') expect(find).not.toHaveBeenCalled()
    },
  )

  it.each([
    'private.png',
    'private-xs.png',
    'private-sm.png',
    'private-md.png',
    'private-lg.png',
    'private-og.png',
  ])('aktív vevő a pinned file-handleren át olvassa: %s', async (filename) => {
    const { req, file, dbFindOne } = harness()
    req.routeParams!.filename = filename
    const response = await file()
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pixels)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(dbFindOne).toHaveBeenCalledOnce()
  })

  it.each([
    { paidAt: '2025-01-01T12:00:00Z' },
    { courses: [course(42, [])] },
    { courses: [{ ...course(), _status: 'draft' }] },
    { courses: [course(43)], purchases: [42] },
    { asset: { id: 71, course: 43, filename: 'private.png' }, courses: [course(42, [71])] },
    { asset: { id: 71, course: null, filename: 'private.png' } },
    { asset: null },
  ])('lejárt, draft, orphan vagy más kurzus fájlja tiltott: %j', async (options) => {
    expect((await harness(options).file()).status).toBe(403)
  })

  it.each([
    { paidAt: null, grantAt: '2026-09-01T12:00:00Z' },
    { paidAt: null, courses: [{ ...course(), accessDurationDays: null }] },
    { courses: [{ ...course(), status: 'archived' }] },
    { role: 'staff' as const, courses: [course(42, [])], purchases: [] },
    { role: 'owner' as const, courses: [course(42, [])], purchases: [] },
  ])('ajándék, korlátlan, archív és staff megmarad: %j', async (options) => {
    const response = await harness(options).file()
    expect(response.status).toBe(200)
    await response.body?.cancel()
  })

  it.each(['candidate', 'snapshot', 'metadata', 'orders', 'users'] as const)(
    '%s lookup hiba nem nyitja a fájlt',
    async (fail) => {
      expect((await harness({ fail, paidAt: null }).file()).status).toBe(403)
    },
  )

  it('lista/count filter a tulajdonoskurzust is köti; draft és más kurzus nem jelenik meg', async () => {
    const { access, find } = harness({
      courses: [course(42, [71, 99]), course(43, [72])],
      purchases: [42],
    })
    const where = await access()
    expect(typeof where).toBe('object')
    const assets = [
      { id: 71, course: 42 },
      { id: 99, course: 43 },
      { id: 72, course: 43 },
      { id: 90, course: 42 },
    ]
    expect(assets.filter((asset) => matches(asset, where as Where))).toEqual([
      { id: 71, course: 42 },
    ])
    expect(await access()).toBe(where)
    expect(find.mock.calls.filter(([query]) => query.collection === 'products')).toHaveLength(2)
  })

  it('100-as snapshot batch és végleges 1000-kurzus korlát', async () => {
    const courses = Array.from({ length: COURSE_FILE_BATCH + 1 }, (_, index) =>
      course(index + 1, []),
    )
    const scoped = harness({ courses, purchases: courses.map((doc) => doc.id as number) })
    expect(await scoped.access()).toBe(false)
    expect(
      scoped.find.mock.calls.filter(([query]) => query.collection === 'products'),
    ).toHaveLength(2)
    const tooMany = harness({ purchases: Array.from({ length: 1001 }, (_, index) => index + 1) })
    expect(await tooMany.access()).toBe(false)
    expect(tooMany.find).not.toHaveBeenCalled()
  })

  it('az ismeretlen direct lookup kérésbudgetje véges', async () => {
    const { access, find } = harness({ asset: null })
    for (let id = 1; id <= MAX_FILE_ACCESS_QUERIES + 3; id += 1)
      expect(await access(id)).toBe(false)
    expect(find).toHaveBeenCalledTimes(MAX_FILE_ACCESS_QUERIES)
  })

  it('azonos filename lookup megosztott Promise, a külön kérés friss ellenőrzés', async () => {
    const first = harness()
    const responses = await Promise.all([first.file(), first.file()])
    for (const response of responses) {
      expect(response.status).toBe(200)
      await response.body?.cancel()
    }
    expect(
      first.find.mock.calls.filter(([query]) => query.collection === 'course-files'),
    ).toHaveLength(1)
    expect((await harness({ paidAt: '2025-01-01T12:00:00Z' }).file()).status).toBe(403)
  })
})

describe('fájlválasz: range, HEAD és hiba ugyanazon private cache szabályon', () => {
  it('range 206 megőrzi a bytes és cache fejléceket', async () => {
    const response = await harness().file('GET', { Range: 'bytes=0-7' })
    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Range')).toBe(`bytes 0-7/${pixels.length}`)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pixels.subarray(0, 8))
  })
  it('HEAD engedélyt ellenőriz és body nélkül azonos hosszt ad', async () => {
    const response = await harness().file('HEAD')
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Length')).toBe(String(pixels.length))
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.text()).toBe('')
    expect((await harness({ purchases: [] }).file('HEAD')).status).toBe(403)
  })
  it('416 és 500 sem cache-elhető', async () => {
    const invalid = await harness().file('GET', { Range: 'bytes=99999-' })
    expect(invalid.status).toBe(416)
    expect(invalid.headers.get('Cache-Control')).toBe('private, no-store')
    const missing = harness({ asset: { id: 71, course: 42, filename: 'missing.png' } })
    missing.req.routeParams!.filename = 'missing.png'
    const response = await missing.file()
    expect(response.status).toBe(500)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })
})

describe('szanitált config + pinned afterRead/DataLoader/find/count együtt', () => {
  function lessonDoc(): Doc {
    return {
      ...course(),
      modules: [
        {
          id: 'module',
          title: 'Fejezet',
          lessons: [
            {
              id: 'lesson',
              kind: 'szoveg',
              title: 'Lecke',
              attachments: [
                {
                  id: 'attachment',
                  label: 'Védett',
                  protectedFile: 71,
                  file: { id: 3, url: '/api/media/file/PUBLIC-FALLBACK.png' },
                },
              ],
            },
          ],
        },
      ],
    }
  }
  it('a committed privát relation populálódik, a public fallback eltűnik', async () => {
    const scoped = harness({
      asset: { id: 71, course: 42, filename: 'private.png', alt: 'Privát kép' },
    })
    const result = await scoped.readCourse(lessonDoc())
    const curriculum = buildCurriculum(result as unknown as Product, true)
    expect(curriculum.lessons[0]?.attachments[0]?.url).toContain(
      '/api/course-files/file/private.png',
    )
    expect(JSON.stringify(result)).not.toContain('PUBLIC-FALLBACK')
    expect(
      scoped.find.mock.calls.filter(
        ([query]) => query.collection === 'course-files' && query.overrideAccess === false,
      ),
    ).toHaveLength(1)
  })
  it('a draft-only relation denied populationja ID marad, URL/public fallback nélkül', async () => {
    const scoped = harness({ courses: [course(42, [])] })
    const result = await scoped.readCourse(lessonDoc())
    const curriculum = buildCurriculum(result as unknown as Product, true)
    expect(curriculum.lessons[0]?.attachments[0]?.url).toBeNull()
    expect(JSON.stringify(result)).not.toContain('PUBLIC-FALLBACK')
    expect(JSON.stringify(result)).not.toContain('private.png')
  })
  it('lapozott meta és count csak az aktuális kurzusban hivatkozott saját fájlokat számolja', async () => {
    const scoped = harness({
      courses: [course(42, [71, 72, 99])],
      extraAssets: [
        { id: 72, course: 42, filename: 'second.png' },
        { id: 99, course: 43, filename: 'cross.png' },
        { id: 90, course: 42, filename: 'draft.png' },
      ],
    })
    expect((await scoped.list(1)).docs.map((doc) => doc.id)).toEqual([71])
    expect((await scoped.list(2)).docs.map((doc) => doc.id)).toEqual([72])
    expect((await scoped.list(3)).docs).toEqual([])
    expect(await scoped.count()).toEqual({ totalDocs: 2 })
    expect(scoped.req.responseHeaders?.get('Cache-Control')).toBe('private, no-store')
  })
  it.each(['anonymous', 'customer'] as const)(
    '%s nem vevő meta/count 0 a valódi műveleten',
    async (role) => {
      const scoped = harness({ role, purchases: [] })
      expect((await scoped.list()).docs).toEqual([])
      expect(await scoped.count()).toEqual({ totalDocs: 0 })
      expect(scoped.dbFind).not.toHaveBeenCalled()
    },
  )
})

describe('fájltulajdon és byte-ok immutábilisak a lehetséges törlés ELŐTT', () => {
  it('a tényleges pinned updateByID a fájlcsere előtt leáll overrideAccess mellett is', async () => {
    const { req, config, findByID, dbFindOne } = harness({ role: 'staff' })
    req.file = { data: pixels, mimetype: 'image/png', name: 'replacement.png', size: pixels.length }
    await expect(
      updateByID({
        id: 71,
        data: { alt: 'Új kép' },
        collection: { config },
        req,
        disableTransaction: true,
        overrideAccess: true,
      }),
    ).rejects.toMatchObject({ status: 400 })
    expect(findByID).not.toHaveBeenCalled()
    expect(dbFindOne).not.toHaveBeenCalled()
    expect(await readFile(path.join(fixture, 'private.png'))).toEqual(pixels)
  })
  it.each([{ course: 43 }, { filename: 'other.png' }, { sizes: {} }, { focalX: 99 }])(
    'metadata body nem változtathat tulajdonost/fájlt: %j',
    async (data) => {
      const { req, config } = harness({ role: 'staff' })
      const args = { id: 71, data, req, collection: { config } }
      await expect(
        protectCourseFileUpdate({
          args,
          operation: 'update',
          req,
          collection: config,
          context: {},
        } as unknown as Parameters<typeof protectCourseFileUpdate>[0]),
      ).rejects.toMatchObject({ status: 400 })
    },
  )
  it('alt-szöveg és változatlan course továbbra is menthető', async () => {
    const { req, config } = harness({ role: 'staff' })
    const args = { id: 71, data: { alt: 'Pontos leírás', course: 42 }, req, collection: { config } }
    expect(
      await protectCourseFileUpdate({
        args,
        operation: 'update',
        req,
        collection: config,
        context: {},
      } as unknown as Parameters<typeof protectCourseFileUpdate>[0]),
    ).toBe(args)
  })
  it.each([
    { rows: [] },
    { rows: [{ file: 71 }] },
    { rows: [{ protectedFile: 72 }] },
    { rows: [{ file: null, protectedFile: 72 }] },
  ])('érvényes legacy/private sor: %j', ({ rows }) => {
    expect(validateCourseAttachments(rows)).toBe(true)
  })
  it.each([{ rows: [{}] }, { rows: [{ file: 71, protectedFile: 72 }] }])(
    'kettős vagy üres file-forrás nem menthető: %j',
    ({ rows }) => {
      expect(validateCourseAttachments(rows)).toEqual(expect.any(String))
    },
  )
})
