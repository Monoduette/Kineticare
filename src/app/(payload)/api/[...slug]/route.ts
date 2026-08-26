import config from '@payload-config'
import {
  REST_DELETE,
  REST_GET,
  REST_OPTIONS,
  REST_PATCH,
  REST_POST,
  REST_PUT,
} from '@payloadcms/next/routes'

import { withPayloadRestRateLimit } from '@/lib/security/rate-limit'

/**
 * A POST IP-alapú kérés-korlátozón megy át (A2). Ez a catch-all szolgálja ki a
 * regisztrációt (`/api/users`), a jelszó-emlékeztetőt
 * (`/api/users/forgot-password`) és a kapcsolat-űrlap beküldését
 * (`/api/form-submissions`) — ezeknek nincs saját route-handlerük, így a korlát
 * ide kerül. A védett útvonalak és keretek listája az
 * `src/lib/security/rate-limit.ts`-ben él; minden más POST (és minden GET)
 */
export const GET = REST_GET(config)
export const POST = withPayloadRestRateLimit(REST_POST(config))
export const DELETE = REST_DELETE(config)
export const PATCH = REST_PATCH(config)
export const PUT = REST_PUT(config)
export const OPTIONS = REST_OPTIONS(config)
