import { BUNNY_STREAM_API_ORIGIN } from './bunny-library'
import { BUNNY_UPLOAD_MAX_BYTES } from './bunny-upload-contract'
import {
  adminHandler,
  BUNNY_VIDEO_GUID,
  BunnyAdminError,
  bunnyJson,
  invalidInput,
  jsonObject,
  libraryConfig,
  record,
  type BunnyAdminDeps,
} from './bunny-upload-security'
import {
  assertUploadSecret,
  bindAuthenticatedSession,
  createUploadSession,
  uploadCredentials,
  verifyUploadSession,
} from './bunny-upload-session'

export function createBunnyUploadHandler(deps: BunnyAdminDeps) {
  const handler = adminHandler(
    deps,
    'upload',
    async (request, { payload, userId, authenticatedSessionId, now }) => {
      const body = await jsonObject(request, ['title', 'fileName', 'size', 'mimeType'])
      if (
        typeof body.title !== 'string' ||
        !body.title.trim() ||
        body.title.length > 200 ||
        /[\x00-\x1f\x7f]/.test(body.title) ||
        typeof body.fileName !== 'string' ||
        !body.fileName.trim() ||
        body.fileName.length > 255 ||
        /[/\\\x00-\x1f\x7f]/.test(body.fileName) ||
        typeof body.size !== 'number' ||
        !Number.isSafeInteger(body.size) ||
        body.size <= 0 ||
        body.size > BUNNY_UPLOAD_MAX_BYTES ||
        typeof body.mimeType !== 'string' ||
        !/^video\/[a-z0-9][a-z0-9.+-]{0,80}$/i.test(body.mimeType)
      )
        invalidInput()
      const config = libraryConfig('protected')
      assertUploadSecret(payload.secret)
      const authSessionBinding = bindAuthenticatedSession(payload.secret, authenticatedSessionId)
      // One attempt only: a timeout may mean Bunny already created the object.
      const raw = record(
        await bunnyJson(
          deps.fetchImpl ?? fetch,
          `${BUNNY_STREAM_API_ORIGIN}/library/${config.libraryId}/videos`,
          config.apiKey,
          { title: body.title.trim() },
        ),
      )
      if (
        !raw ||
        typeof raw.guid !== 'string' ||
        !BUNNY_VIDEO_GUID.test(raw.guid) ||
        String(raw.videoLibraryId) !== config.libraryId
      ) {
        throw new BunnyAdminError(
          502,
          'create-uncertain',
          'A létrehozás válasza érvénytelen. Ellenőrizd a videótárat újrapróbálás előtt.',
        )
      }
      const session = createUploadSession(
        payload.secret,
        userId,
        config.libraryId,
        raw.guid.toLowerCase(),
        now,
        authSessionBinding,
      )
      return uploadCredentials(session.uploadSession, session.capability, config.apiKey)
    },
  )
  return (request: Request) => handler(request, undefined)
}

export function createBunnyUploadSignHandler(deps: BunnyAdminDeps) {
  const handler = adminHandler(
    deps,
    'sign',
    async (request, { payload, userId, authenticatedSessionId, now }) => {
      const body = await jsonObject(request, ['uploadSession'])
      const config = libraryConfig('protected')
      const authSessionBinding = bindAuthenticatedSession(payload.secret, authenticatedSessionId)
      const capability = verifyUploadSession(
        body.uploadSession,
        payload.secret,
        userId,
        config.libraryId,
        now,
        authSessionBinding,
      )
      return uploadCredentials(body.uploadSession as string, capability, config.apiKey)
    },
  )
  return (request: Request) => handler(request, undefined)
}
