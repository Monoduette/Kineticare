import { getPayload } from 'payload'
import config from '../../../../../payload.config'
import { createBunnyUploadHandler } from '../../../../../lib/stream/bunny-upload-handler'

export const runtime = 'nodejs'
export const POST = createBunnyUploadHandler({ getPayload: () => getPayload({ config }) })
