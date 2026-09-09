import { getPayload } from 'payload'
import config from '../../../../../../payload.config'
import { createBunnyUploadSignHandler } from '../../../../../../lib/stream/bunny-upload-handler'

export const runtime = 'nodejs'
export const POST = createBunnyUploadSignHandler({ getPayload: () => getPayload({ config }) })
