import type { FormState } from 'payload'
import { BUNNY_UPLOAD_MAX_BYTES } from '../../lib/stream/bunny-upload-contract'

export type VideoLibrary = 'protected' | 'public'
export type VideoStatus = 'uploading' | 'processing' | 'ready' | 'error'
export interface AdminVideo {
  guid: string
  title: string
  durationSec: number | null
  status: VideoStatus
  thumbnailUrl: string | null
}
export const statusLabels: Record<VideoStatus, string> = {
  uploading: 'Feltöltés',
  processing: 'Feldolgozás alatt',
  ready: 'Kész',
  error: 'Hiba',
}
export const guidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
export function httpsURL(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}
export function parseVideo(value: unknown): AdminVideo | null {
  const data = record(value)
  if (
    !data ||
    typeof data.guid !== 'string' ||
    !guidPattern.test(data.guid) ||
    typeof data.title !== 'string'
  )
    return null
  const duration = data.durationSec ?? data.lengthSec
  const status = data.status
  return {
    guid: data.guid,
    title: data.title,
    durationSec:
      typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 ? duration : null,
    status:
      status === 4 || status === 'ready'
        ? 'ready'
        : status === 5 || status === 6 || status === 'error'
          ? 'error'
          : status === 0 || status === 'uploading'
            ? 'uploading'
            : 'processing',
    thumbnailUrl: httpsURL(data.thumbnailUrl),
  }
}
export function validateVideoFile(
  file: { size: number; type: string },
  maxBytes = BUNNY_UPLOAD_MAX_BYTES,
): string | null {
  if (!file.size) return 'A fájl üres. Válassz másik videót.'
  if (file.size > maxBytes) return 'A fájl túl nagy. Legfeljebb 2 GiB méretű videót válassz.'
  if (!file.type.startsWith('video/')) return 'Videófájlt válassz.'
  return null
}
export function pollDelay(attempt: number, elapsed: number): number | null {
  if (elapsed >= 600000) return null
  return Math.min(30000, 5000 * (1 + attempt), 600000 - elapsed)
}
export function durationLabel(value: number | null): string {
  if (value === null) return 'Hossz még nem ismert'
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`
}

export function videoPagination(
  data: { totalItems?: unknown; pageSize?: unknown; truncated?: unknown },
  page: number,
  itemCount: number,
) {
  const pageSize =
    typeof data.pageSize === 'number' && Number.isInteger(data.pageSize) && data.pageSize > 0
      ? data.pageSize
      : 24
  const total =
    typeof data.totalItems === 'number' && Number.isFinite(data.totalItems) && data.totalItems >= 0
      ? data.totalItems
      : null
  const pages = total === null ? null : Math.max(1, Math.ceil(total / pageSize))
  return {
    total,
    pages,
    hasNext: pages === null ? data.truncated === true || itemCount === pageSize : page < pages,
  }
}

export interface VideoTarget {
  library: VideoLibrary
  rowID?: unknown
  moduleID?: unknown
  kind?: unknown
  initial: unknown
  legacy?: boolean
}
export function captureVideoTarget(
  fields: FormState,
  path: string,
  library: VideoLibrary,
): VideoTarget | null {
  if (library === 'public')
    return path === 'previewVideoStreamId' && fields[path]
      ? { library, initial: fields[path].value }
      : null
  const match = /^(videos\.\d+|modules\.\d+\.lessons\.\d+)\.streamAssetId$/.exec(path)
  if (!match || !fields[path]) return null
  const prefix = match[1]
  const rowID = fields[`${prefix}.id`]?.value
  const legacy = prefix.startsWith('videos.')
  const moduleID = legacy
    ? undefined
    : fields[`${prefix.split('.').slice(0, 2).join('.')}.id`]?.value
  const kind = fields[`${prefix}.kind`]?.value
  if (!rowID || (!legacy && !moduleID) || (kind != null && kind !== 'video')) return null
  return { library, rowID, moduleID, kind, legacy, initial: fields[path].value }
}
export function videoFieldPatch(
  fields: FormState,
  target: VideoTarget,
  video: AdminVideo,
): FormState | null {
  if (video.status !== 'ready') return null
  let path = 'previewVideoStreamId'
  if (target.library === 'protected') {
    const candidates = Object.keys(fields).filter((key) => {
      if (!(target.legacy ? /^videos\.\d+\.id$/ : /^modules\.\d+\.lessons\.\d+\.id$/).test(key))
        return false
      if (fields[key].value !== target.rowID) return false
      return (
        target.legacy ||
        fields[`${key.split('.').slice(0, 2).join('.')}.id`]?.value === target.moduleID
      )
    })
    if (candidates.length !== 1) return null
    const prefix = candidates[0].slice(0, -3)
    if (fields[`${prefix}.kind`]?.value !== target.kind) return null
    path = `${prefix}.streamAssetId`
  }
  if (!fields[path] || fields[path].value !== target.initial) return null
  const patch: FormState = {}
  const set = (key: string, value: unknown) => {
    patch[key] = { ...fields[key], value, valid: true, errorMessage: undefined, isModified: true }
  }
  set(path, video.guid)
  if (target.library === 'protected') {
    const prefix = path.slice(0, -'.streamAssetId'.length)
    set(`${prefix}.durationSec`, video.durationSec)
    set(`${prefix}.status`, video.status)
  }
  return patch
}
