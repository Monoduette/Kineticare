import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { PayloadRequest } from 'payload'
import type { RouteKind } from 'next/dist/server/route-kind'
import { RouteMatcher } from 'next/dist/server/route-matchers/route-matcher'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import nextConfig from '../../../next.config'
import { Media } from '../../collections/Media'
import { buildCurriculum } from '../../lib/curriculum/curriculum'
import type { Product } from '../../payload-types'

let getFile: (req: PayloadRequest) => Promise<Response>
let validateImage: (url: string) => { errorMessage?: string }
let fixture: string
let decodeFileRoute: (pathname: string) => string
const pixels = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N/8AAAAASUVORK5CYII=',
  'base64',
)

beforeAll(async () => {
  const require = createRequire(import.meta.url)
  const entry = require.resolve('payload')
  const { match } = createRequire(entry)('path-to-regexp')
  const matcher = new RouteMatcher({
    kind: 'APP_ROUTE' as RouteKind,
    pathname: '/api/[...slug]',
    page: '/api/[...slug]/route',
    bundlePath: '',
    filename: '',
  })
  const fileMatch = match('/file/:filename', { decode: decodeURIComponent })
  decodeFileRoute = (pathname) => {
    const slug = matcher.test(pathname)?.params?.slug
    if (!Array.isArray(slug)) throw new Error('Nem catch-all tesztútvonal')
    const payloadPath = `/${slug
      .slice(1)
      .map((part) => encodeURIComponent(part))
      .join('/')}`
    const matched = fileMatch(payloadPath)
    if (!matched) throw new Error('Nem Payload file tesztútvonal')
    return matched.params.filename
  }
  getFile = (
    await import(pathToFileURL(entry.replace(/index\.js$/, 'uploads/endpoints/getFile.js')).href)
  ).getFileHandler
  const { ImageOptimizerCache } = require('next/dist/server/image-optimizer.js')
  const { imageConfigDefault } = require('next/dist/shared/lib/image-config.js')
  validateImage = (url) =>
    ImageOptimizerCache.validateParams(
      { headers: {} },
      { url, w: '640', q: '75' },
      { ...nextConfig, images: { ...imageConfigDefault, ...nextConfig.images } },
      false,
    )
  fixture = await mkdtemp(path.join(os.tmpdir(), 'kc-private-media-fixture-'))
  await mkdir(path.join(fixture, '_course_files'))
  await writeFile(path.join(fixture, 'public.png'), pixels)
  await writeFile(path.join(fixture, '_course_files', 'private.png'), pixels)
})

afterAll(async () => {
  if (fixture) await rm(fixture, { recursive: true, force: true })
})

function publicRequest(filename: string): PayloadRequest {
  return {
    routeParams: { collection: 'media', filename },
    headers: new Headers(),
    searchParams: new URLSearchParams(),
    context: {},
    user: null,
    t: () => 'Forbidden',
    payload: {
      config: { cors: [] },
      collections: {
        media: {
          config: { ...Media, upload: { ...(Media.upload as object), staticDir: fixture } },
        },
      },
      db: { findOne: vi.fn() },
      logger: { error: vi.fn() },
    },
  } as unknown as PayloadRequest
}

describe('a publikus file-végpont nem érheti el a privát almappát', () => {
  it('a nyilvános képet a tényleges pinned Payload továbbra is kiszolgálja', async () => {
    const response = await getFile(publicRequest('public.png'))
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pixels)
  })

  it.each([
    '_course_files/private.png',
    '_course_files\\private.png',
    '%2f_course_files%2fprivate.png',
    '%252f_course_files%252fprivate.png',
  ])('a route-decoded %s nem basename', async (filename) => {
    const read = Media.access!.read!
    expect(
      await read({ req: publicRequest(filename), data: { filename }, isReadingStaticFile: true }),
    ).toBe(false)
  })

  it('a pinned getFileHandler sem olvashat a gyökéren belüli privát alkönyvtárból', async () => {
    await expect(getFile(publicRequest('_course_files/private.png'))).rejects.toMatchObject({
      status: 403,
    })
  })

  it.each([
    '/api/media/file/_course_files%2Fprivate.png',
    '/api/media/FILE/_course_files%5Cprivate.png',
    '/api/media/file/_course_files%252Fprivate.png',
  ])('Next és Payload tényleges route decode-ja után %s is zárt', async (pathname) => {
    const filename = decodeFileRoute(pathname)
    expect(
      await Media.access!.read!({
        req: publicRequest(filename),
        data: { filename },
        isReadingStaticFile: true,
      }),
    ).toBe(false)
  })
})

describe('a pinned Next optimizer csak nyilvános képeket fogad', () => {
  it.each([
    '/api/course-files/file/private.png',
    '/api/course-files/file/private-xs.png',
    '/api/cour%73e-files/file/private.png',
    '/api/course-files/71',
  ])('%s nem kaphat megosztott optimizer cache-t', (url) => {
    expect(validateImage(url).errorMessage).toBeTruthy()
  })

  it.each([
    '/api/media/file/public.png',
    '/api/media/file/public-320x200.webp',
    '/media/team/portrait.webp',
    '/assets/legacy/public.webp',
    '/_next/static/media/import.hash.png',
  ])('%s korábbi publikus kép optimalizálható', (url) => {
    expect(validateImage(url).errorMessage).toBeUndefined()
  })
  it('az allowlisted public URL encoded alútját a mögöttes file gate tiltja', async () => {
    const url = '/api/media/file/_course_files%2Fprivate.png'
    expect(validateImage(url).errorMessage).toBeUndefined()
    await expect(getFile(publicRequest(decodeFileRoute(url)))).rejects.toMatchObject({
      status: 403,
    })
  })
})

describe('a privát melléklet nem eshet vissza a nyilvános eredetire', () => {
  it.each([73, { id: 73 }])('hiányzó/denied private reláció: %j', (protectedFile) => {
    const product = {
      modules: [
        {
          id: 'module',
          lessons: [
            {
              id: 'lesson',
              kind: 'szoveg',
              title: 'Lecke',
              attachments: [
                { label: 'Segédlet', protectedFile, file: { url: '/api/media/file/public.png' } },
              ],
            },
          ],
        },
      ],
    } as unknown as Product
    const result = buildCurriculum(product, true)
    expect(result.lessons[0]?.attachments[0]?.url).toBeNull()
  })
})
