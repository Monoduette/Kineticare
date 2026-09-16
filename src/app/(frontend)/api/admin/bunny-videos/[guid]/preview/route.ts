import { getPayload } from 'payload'
import config from '../../../../../../../payload.config'
import { createBunnyVideoPreviewHandler } from '../../../../../../../lib/stream/bunny-video-detail-handler'

export const runtime = 'nodejs'
const handler = createBunnyVideoPreviewHandler({ getPayload: () => getPayload({ config }) })
export async function POST(request: Request, context: { params: Promise<{ guid: string }> }) {
  return handler(request, (await context.params).guid)
}
