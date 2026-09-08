import config from '@payload-config'
import {
  REST_DELETE,
  REST_GET,
  REST_OPTIONS,
  REST_PATCH,
  REST_POST,
  REST_PUT,
} from '@payloadcms/next/routes'
import { getPayload } from 'payload'

import { withPrivateCourseFileResponse } from '@/access/privateResponse'
import { createProtectedPayloadPost } from '@/lib/security/payload-rest-post'

/**
 * A reset aliasai a konkrét útvonallal közös védett handlerre mennek: a
 * Next case-sensitive routingja nem kerülheti meg a Payload case-insensitive
 * reset endpointjára szánt védelmet. A login eredetellenőrzése a korlátozó előtt fut, így az
 * elutasított kérés nem jut el klónozásig, törzsolvasásig vagy Payloadig.
 * Utána minden POST az IP-alapú kérés-korlátozón megy át (A2). Ez a catch-all
 * szolgálja ki a regisztrációt (`/api/users`), a jelszó-emlékeztetőt
 * (`/api/users/forgot-password`) és a kapcsolat-űrlap beküldését
 * (`/api/form-submissions`) — ezeknek nincs saját route-handlerük, így a korlát
 * ide kerül. A védett útvonalak és keretek listája az
 * `src/lib/security/rate-limit.ts`-ben él; minden más POST és minden GET
 * CSRF-viselkedése változatlan.
 */
export const GET = withPrivateCourseFileResponse(REST_GET(config))
export const HEAD = GET
export const POST = withPrivateCourseFileResponse(
  createProtectedPayloadPost({
    getPayload: () => getPayload({ config }),
    payloadPost: REST_POST(config),
  }),
)
export const DELETE = withPrivateCourseFileResponse(REST_DELETE(config))
export const PATCH = withPrivateCourseFileResponse(REST_PATCH(config))
export const PUT = withPrivateCourseFileResponse(REST_PUT(config))
export const OPTIONS = withPrivateCourseFileResponse(REST_OPTIONS(config))
