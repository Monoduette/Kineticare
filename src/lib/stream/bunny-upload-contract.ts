import type { BunnyLibraryKind, BunnyLibraryVideo } from './bunny-library'

/** Client metadata guard only, NOT a provider-enforced quota. */
export const BUNNY_UPLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024
export const BUNNY_UPLOAD_FINAL_TTL_SECONDS = 6 * 60 * 60

export interface BunnyUploadInput {
  title: string
  fileName: string
  size: number
  mimeType: string
}

export interface BunnyUploadResponse {
  uploadSession: string
  videoId: string
  libraryId: string
  tusEndpoint: string
  headers: {
    AuthorizationSignature: string
    AuthorizationExpire: string
    VideoId: string
    LibraryId: string
  }
  /** Unix seconds; re-signing never extends this final expiry. */
  expiresAt: number
}

export interface BunnyVideoDetailResponse {
  library: BunnyLibraryKind
  libraryId: string
  video: BunnyLibraryVideo
  ready: boolean
}

export interface BunnyVideoPreviewResponse {
  library: BunnyLibraryKind
  libraryId: string
  videoId: string
  embedUrl: string
  /** Unix seconds, or null for a canonical unsigned public embed. */
  expiresAt: number | null
}

export interface BunnyAdminErrorResponse {
  error: string
  code: string
  requestId: string
}
