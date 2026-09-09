import { createHash } from 'node:crypto'
import {
  BUNNY_STREAM_API_ORIGIN,
  parseBunnyLibraryVideo,
  type BunnyLibraryKind,
} from './bunny-library'
import type { BunnyVideoDetailResponse, BunnyVideoPreviewResponse } from './bunny-upload-contract'
import {
  adminHandler,
  BUNNY_VIDEO_GUID,
  BunnyAdminError,
  bunnyJson,
  invalidInput,
  jsonObject,
  libraryConfig,
  libraryKind,
  record,
  type BunnyAdminDeps,
} from './bunny-upload-security'

async function detail(
  deps: BunnyAdminDeps,
  guid: string,
  kind: BunnyLibraryKind,
): Promise<BunnyVideoDetailResponse> {
  if (!BUNNY_VIDEO_GUID.test(guid)) invalidInput()
  const config = libraryConfig(kind)
  const raw = record(
    await bunnyJson(
      deps.fetchImpl ?? fetch,
      `${BUNNY_STREAM_API_ORIGIN}/library/${config.libraryId}/videos/${guid.toLowerCase()}`,
      config.apiKey,
    ),
  )
  const video = parseBunnyLibraryVideo(raw)
  if (
    !raw ||
    !video ||
    video.guid.toLowerCase() !== guid.toLowerCase() ||
    String(raw.videoLibraryId) !== config.libraryId ||
    video.status === null ||
    !Number.isInteger(video.status) ||
    video.status < 0 ||
    video.status > 8
  ) {
    throw new BunnyAdminError(502, 'invalid-response', 'A videótár válasza érvénytelen.')
  }
  // VideoModel 4 = Finished. Webhook status 3 means something different.
  return { library: kind, libraryId: config.libraryId, video, ready: video.status === 4 }
}

export function createBunnyVideoDetailHandler(deps: BunnyAdminDeps) {
  return adminHandler<string>(deps, 'detail', async (request, _context, guid) => {
    const params = new URL(request.url).searchParams
    if (params.getAll('library').length !== 1) invalidInput()
    return detail(deps, guid, libraryKind(params.get('library')))
  })
}

export function createBunnyVideoPreviewHandler(deps: BunnyAdminDeps) {
  return adminHandler<string>(
    deps,
    'preview',
    async (request, { now }, guid): Promise<BunnyVideoPreviewResponse> => {
      const body = await jsonObject(request, ['library'])
      const kind = libraryKind(body.library)
      const signingKey = process.env.BUNNY_STREAM_TOKEN_AUTH_KEY?.trim()
      if (kind === 'protected' && !signingKey)
        throw new BunnyAdminError(503, 'not-configured', 'A videó előnézete nincs beállítva.')
      const video = await detail(deps, guid, kind)
      if (!video.ready) throw new BunnyAdminError(409, 'not-ready', 'A videó még nem játszható le.')
      const url = new URL(
        `https://iframe.mediadelivery.net/embed/${video.libraryId}/${guid.toLowerCase()}`,
      )
      let expiresAt: number | null = null
      if (kind === 'protected' && signingKey) {
        // This admin-only preview is intentionally shorter than consumer playback.
        expiresAt = now + 300
        const token = createHash('sha256')
          .update(`${signingKey}${guid.toLowerCase()}${expiresAt}`)
          .digest('hex')
        url.searchParams.set('token', token)
        url.searchParams.set('expires', String(expiresAt))
      }
      return {
        library: kind,
        libraryId: video.libraryId,
        videoId: guid.toLowerCase(),
        embedUrl: url.toString(),
        expiresAt,
      }
    },
  )
}
