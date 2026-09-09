import { useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import type { TextFieldClientProps, FormState } from 'payload'
import { fixture, FixturePath } from './payload-ui'
import { tusFixture } from './tus'
import {
  ProtectedBunnyVideoField,
  PublicBunnyVideoField,
} from '../../../components/admin/BunnyVideoField'
import { BunnyVideoLibrary } from '../../../components/admin/BunnyLibraryPanel'
import './theme.css'

const guid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const previous = '11111111-2222-3333-4444-555555555555'
function row(index: number, id: string, asset = ''): FormState {
  const prefix = `modules.0.lessons.${index}`
  return Object.fromEntries(
    Object.entries({
      id,
      title: `Saját cím ${id}`,
      kind: 'video',
      order: index,
      streamAssetId: asset,
      durationSec: 10,
      status: 'processing',
    }).map(([key, value]) => [`${prefix}.${key}`, { value, valid: true }]),
  )
}
const query = new URLSearchParams(location.search)
const scenario = query.get('scenario') ?? 'normal'
fixture.publish({
  'modules.0.id': { value: 'module-a', valid: true },
  ...row(0, 'a', scenario === 'replace' ? previous : ''),
  ...row(1, 'b'),
  previewVideoStreamId: { value: scenario.startsWith('public-') ? previous : '', valid: true },
})
const requests: { method: string; path: string }[] = []
let initCount = 0
let finalExpiry = 0
let released = false
let release: () => void = () => {
  released = true
}
const rawVideo = {
  guid,
  title: 'Kézrehabilitáció: finommozgások és mindennapi gyakorlatok',
  lengthSec: 123,
  status: 4,
  statusLabel: 'Kész',
  dateUploaded: null,
  thumbnailUrl: 'https://fixture.b-cdn.net/thumbnail.webp',
}
const credentials = () => ({
  uploadSession: 'DUMMY-session',
  videoId: guid,
  libraryId: '123',
  tusEndpoint: 'https://video.bunnycdn.com/tusupload',
  headers: {
    AuthorizationSignature: 'DUMMY-signature',
    AuthorizationExpire: String(Math.floor(Date.now() / 1000) + 3600),
    VideoId: guid,
    LibraryId: '123',
  },
  expiresAt:
    Math.floor(Date.now() / 1000) +
    (scenario === 'expired' && initCount === 1
      ? -1
      : ['resume-expiry', 'sign-expiry'].includes(scenario) && initCount === 1
        ? 2
        : 3600),
})
window.fetch = async (input, options) => {
  const url = new URL(String(input), location.origin)
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/admin/bunny-'))
    throw new Error('Fixture blocks all non-mock fetch')
  requests.push({ method: options?.method ?? 'GET', path: url.pathname + url.search })
  if (url.pathname === '/api/admin/bunny-uploads') {
    initCount++
    if (scenario === 'uncertain') throw new Error('DUMMY lost response')
    const granted = credentials()
    finalExpiry = granted.expiresAt
    return Response.json(granted)
  }
  if (url.pathname.endsWith('/sign')) {
    if (scenario === 'sign-invalid-session')
      return Response.json(
        { code: 'invalid-session', error: 'DUMMY-private-upstream-message' },
        { status: 403 },
      )
    if (scenario === 'sign-unauthorized')
      return Response.json({ code: 'unauthorized' }, { status: 401 })
    if (scenario === 'sign-forbidden') return Response.json({ code: 'forbidden' }, { status: 403 })
    if (scenario === 'sign-transient')
      return Response.json({ code: 'invalid-session' }, { status: 503 })
    if (scenario === 'sign-expiry') {
      await new Promise((resolve) => setTimeout(resolve, 3000))
      return Response.json({ code: 'invalid-session' }, { status: 403 })
    }
    return Response.json(credentials())
  }
  const library =
    url.searchParams.get('library') ??
    (options?.body ? JSON.parse(String(options.body)).library : 'protected')
  if (url.pathname.endsWith('/preview'))
    return Response.json({
      library,
      libraryId: '123',
      videoId: guid,
      embedUrl: `https://iframe.mediadelivery.net/embed/123/${guid}`,
      expiresAt: library === 'public' ? null : Math.floor(Date.now() / 1000) + 60,
    })
  if (url.pathname.endsWith(guid)) {
    if (scenario === 'reorder')
      fixture.publish({ ...fixture.fields, ...row(0, 'b'), ...row(1, 'a') })
    if (scenario === 'delete')
      fixture.publish({ 'modules.0.id': { value: 'module-a', valid: true }, ...row(0, 'b') })
    if (scenario === 'late' && !released)
      await new Promise<void>((resolve) => {
        release = () => {
          released = true
          resolve()
        }
      })
    return Response.json({
      library,
      libraryId: '123',
      video: { ...rawVideo, status: scenario === 'processing' ? 2 : 4 },
      ready: scenario !== 'processing',
    })
  }
  if (scenario === 'list-error') return Response.json({}, { status: 503 })
  const page = Number(url.searchParams.get('page') ?? 1)
  const search = url.searchParams.get('search') ?? ''
  const videos = search === 'nincs' ? [] : [rawVideo]
  return Response.json({
    videos:
      scenario === 'malformed-list' ? [{}] : scenario === 'partial-list' ? [rawVideo, {}] : videos,
    totalItems: scenario === 'unknown-total' ? null : videos.length,
    truncated: scenario === 'unknown-total' && page === 1,
    page,
    pageSize: 24,
  })
}
Object.assign(window, {
  bunnyFixture: {
    fixture,
    tusFixture,
    requests,
    release: () => release(),
    get initCount() {
      return initCount
    },
    get finalExpiry() {
      return finalExpiry
    },
  },
})

function App() {
  const fields = useSyncExternalStore(
    (fn) => {
      fixture.subscribers.add(fn)
      return () => {
        fixture.subscribers.delete(fn)
      }
    },
    () => fixture.fields,
  )
  const [publicField, setPublicField] = useState(false)
  const [library, setLibrary] = useState(query.get('view') === 'library')
  const path =
    Object.keys(fields)
      .find((key) => key.endsWith('.id') && fields[key].value === 'a')
      ?.replace(/\.id$/, '.streamAssetId') ?? 'modules.0.lessons.0.streamAssetId'
  const props = {
    path: 'modules.0.lessons.0.streamAssetId',
    field: { name: 'streamAssetId', type: 'text' },
  } as TextFieldClientProps
  return (
    <main>
      <h1>Videótár</h1>
      <div className="fixture-tools">
        <label>
          <input
            type="checkbox"
            checked={publicField}
            onChange={(event) => setPublicField(event.target.checked)}
          />{' '}
          Nyilvános mező
        </label>
        <label>
          <input
            type="checkbox"
            checked={library}
            onChange={(event) => setLibrary(event.target.checked)}
          />{' '}
          Önálló tár
        </label>
      </div>
      {library ? (
        <BunnyVideoLibrary />
      ) : publicField ? (
        <FixturePath path="previewVideoStreamId">
          <PublicBunnyVideoField
            {...props}
            path="previewVideoStreamId"
            readOnly={scenario === 'public-readonly'}
          />
        </FixturePath>
      ) : (
        <FixturePath path={path}>
          <ProtectedBunnyVideoField {...props} />
        </FixturePath>
      )}
      <output aria-label="Mezőfrissítések">{fixture.commits}</output>
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
