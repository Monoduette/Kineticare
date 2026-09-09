import {
  guidPattern,
  httpsURL,
  parseVideo,
  record,
  type AdminVideo,
  type VideoLibrary,
} from './bunny-video-state'
import type {
  BunnyUploadResponse,
  BunnyVideoDetailResponse,
} from '../../lib/stream/bunny-upload-contract'
import type { Upload } from 'tus-js-client'

export function resumeBunnyUpload(
  upload: Pick<Upload, 'options' | 'url' | 'start'>,
  headers: UploadCredentials['headers'],
) {
  if (!upload.url) throw new Error('A korábbi feltöltés címe nem ismert. Ellenőrizd a videótárat.')
  // A TUS HEAD-hiba endpoint mellett retry nelkul is uj POST-ot inditana.
  upload.options.endpoint = null
  upload.options.headers = headers
  upload.start()
}

export class VideoRequestError extends Error {
  constructor(
    public status: number,
    public code: 'invalid-session' | null = null,
  ) {
    super('A videótár nem érhető el. Próbáld újra.')
  }
}
export async function videoRequest(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(20000)
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (!response.ok) {
    const body = record(await response.json().catch(() => null))
    const code = body?.code === 'invalid-session' ? 'invalid-session' : null
    throw new VideoRequestError(response.status, code)
  }
  return response.json()
}
export async function videoDetail(
  guid: string,
  library: VideoLibrary,
  signal?: AbortSignal,
): Promise<AdminVideo> {
  if (!guidPattern.test(guid)) throw new Error('A videó nem található.')
  const body = await videoRequest(
    `/api/admin/bunny-videos/${encodeURIComponent(guid)}?library=${library}`,
    undefined,
    signal,
  )
  const data = record(body)
  const video = parseVideo(data?.video)
  if (
    !video ||
    video.guid.toLowerCase() !== guid.toLowerCase() ||
    data?.library !== library ||
    typeof data?.ready !== 'boolean' ||
    typeof data.libraryId !== 'string'
  )
    throw new Error('A videó adatai nem olvashatók. Frissítsd a listát.')
  const ready: BunnyVideoDetailResponse['ready'] = data.ready
  return {
    ...video,
    status:
      ready && record(data.video)?.status === 4
        ? 'ready'
        : video.status === 'ready'
          ? 'processing'
          : video.status,
  }
}
export type UploadCredentials = BunnyUploadResponse
export function expiryTime(value: unknown): number {
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value
  return typeof value === 'string' ? Date.parse(value) : NaN
}
export function uploadCredentials(value: unknown): UploadCredentials {
  const body = record(value)
  const headers = record(body?.headers)
  const endpoint = httpsURL(body?.tusEndpoint)
  const expiresAt = body?.expiresAt
  if (
    !body ||
    typeof body.uploadSession !== 'string' ||
    !body.uploadSession ||
    typeof body.videoId !== 'string' ||
    !guidPattern.test(body.videoId) ||
    typeof body.libraryId !== 'string' ||
    !/^\d+$/.test(body.libraryId) ||
    endpoint !== 'https://video.bunnycdn.com/tusupload' ||
    !headers ||
    typeof headers.AuthorizationSignature !== 'string' ||
    typeof headers.AuthorizationExpire !== 'string' ||
    headers.VideoId !== body.videoId ||
    headers.LibraryId !== body.libraryId ||
    typeof expiresAt !== 'number' ||
    !Number.isFinite(expiresAt)
  )
    throw new Error('A feltöltési engedély nem olvasható.')
  return {
    uploadSession: body.uploadSession,
    videoId: body.videoId,
    libraryId: body.libraryId,
    tusEndpoint: endpoint,
    headers: {
      AuthorizationSignature: headers.AuthorizationSignature,
      AuthorizationExpire: headers.AuthorizationExpire,
      VideoId: body.videoId,
      LibraryId: body.libraryId,
    },
    expiresAt,
  }
}
