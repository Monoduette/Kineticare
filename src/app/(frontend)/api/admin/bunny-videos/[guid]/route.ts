import { getPayload } from 'payload'
import config from '../../../../../../payload.config'
import { createBunnyVideoDetailHandler } from '../../../../../../lib/stream/bunny-video-detail-handler'

export const runtime = 'nodejs'
const handler = createBunnyVideoDetailHandler({ getPayload: () => getPayload({ config }) })
export async function GET(request: Request, context: { params: Promise<{ guid: string }> }) {
  return handler(request, (await context.params).guid)
}
