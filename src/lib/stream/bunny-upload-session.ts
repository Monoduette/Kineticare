import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { BUNNY_UPLOAD_FINAL_TTL_SECONDS, type BunnyUploadResponse } from './bunny-upload-contract'
import { BUNNY_VIDEO_GUID, BunnyAdminError, record } from './bunny-upload-security'

const PURPOSE = 'kineticare:bunny-upload:v1'
interface UploadCapability {
  purpose: typeof PURPOSE
  version: 1
  sessionId: string
  authSessionBinding: string
  userId: string
  libraryId: string
  videoId: string
  issuedAt: number
  expiresAt: number
}

function mac(encoded: string, secret: string) {
  if (typeof secret !== 'string' || !secret.trim()) {
    throw new BunnyAdminError(503, 'not-configured', 'A feltöltés hitelesítése nincs beállítva.')
  }
  const key = createHmac('sha256', secret).update(PURPOSE).digest()
  return createHmac('sha256', key).update(encoded).digest()
}

export function assertUploadSecret(secret: string) {
  mac('', secret)
}

/** _sid comes only from payload.auth after JWT verification and session lookup. */
export function bindAuthenticatedSession(secret: string, authenticatedSessionId: unknown): string {
  assertUploadSecret(secret)
  if (
    typeof authenticatedSessionId !== 'string' ||
    !authenticatedSessionId ||
    authenticatedSessionId.length > 256
  ) {
    throw new BunnyAdminError(
      403,
      'invalid-auth-session',
      'Érvényes bejelentkezési munkamenet szükséges.',
    )
  }
  return createHmac('sha256', secret)
    .update('kineticare:bunny-auth-session:v1\0')
    .update(authenticatedSessionId)
    .digest('hex')
}

export function createUploadSession(
  secret: string,
  userId: string,
  libraryId: string,
  videoId: string,
  now: number,
  authSessionBinding: string,
) {
  const capability: UploadCapability = {
    purpose: PURPOSE,
    version: 1,
    sessionId: randomUUID(),
    authSessionBinding,
    userId,
    libraryId,
    videoId,
    issuedAt: now,
    expiresAt: now + BUNNY_UPLOAD_FINAL_TTL_SECONDS,
  }
  const encoded = Buffer.from(JSON.stringify(capability)).toString('base64url')
  return { capability, uploadSession: `${encoded}.${mac(encoded, secret).toString('base64url')}` }
}

export function verifyUploadSession(
  uploadSession: unknown,
  secret: string,
  userId: string,
  libraryId: string,
  now: number,
  authSessionBinding: string,
): UploadCapability {
  const reject = () =>
    new BunnyAdminError(403, 'invalid-session', 'A feltöltési munkamenet érvénytelen vagy lejárt.')
  if (typeof uploadSession !== 'string' || uploadSession.length > 2048) throw reject()
  const parts = uploadSession.split('.')
  const [encoded, signature] = parts
  if (
    parts.length !== 2 ||
    !encoded ||
    !signature ||
    !/^[A-Za-z0-9_-]+$/.test(encoded) ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature)
  )
    throw reject()
  const expected = mac(encoded, secret)
  const actual = Buffer.from(signature, 'base64url')
  if (
    actual.length !== expected.length ||
    actual.toString('base64url') !== signature ||
    !timingSafeEqual(actual, expected)
  )
    throw reject()
  let value: unknown
  try {
    value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    throw reject()
  }
  const c = record(value)
  if (
    !c ||
    c.purpose !== PURPOSE ||
    c.version !== 1 ||
    typeof c.sessionId !== 'string' ||
    !BUNNY_VIDEO_GUID.test(c.sessionId) ||
    c.authSessionBinding !== authSessionBinding ||
    c.userId !== userId ||
    c.libraryId !== libraryId ||
    typeof c.videoId !== 'string' ||
    !BUNNY_VIDEO_GUID.test(c.videoId) ||
    typeof c.issuedAt !== 'number' ||
    !Number.isSafeInteger(c.issuedAt) ||
    c.issuedAt > now ||
    typeof c.expiresAt !== 'number' ||
    !Number.isSafeInteger(c.expiresAt) ||
    c.expiresAt <= now ||
    c.expiresAt - c.issuedAt !== BUNNY_UPLOAD_FINAL_TTL_SECONDS
  )
    throw reject()
  return c as unknown as UploadCapability
}

export function uploadCredentials(
  uploadSession: string,
  c: UploadCapability,
  apiKey: string,
): BunnyUploadResponse {
  const signature = createHash('sha256')
    .update(`${c.libraryId}${apiKey}${c.expiresAt}${c.videoId}`)
    .digest('hex')
  return {
    uploadSession,
    videoId: c.videoId,
    libraryId: c.libraryId,
    tusEndpoint: 'https://video.bunnycdn.com/tusupload',
    expiresAt: c.expiresAt,
    headers: {
      AuthorizationSignature: signature,
      AuthorizationExpire: String(c.expiresAt),
      VideoId: c.videoId,
      LibraryId: c.libraryId,
    },
  }
}
