import { REST_POST } from '@payloadcms/next/routes'
import { getPayload } from 'payload'

import { createProtectedResetPost } from '../../../../../lib/security/payload-rest-post'
import config from '../../../../../payload.config'

/**
 * POST /api/users/reset-password — jelszó-visszaállítás a jelszó-politika
 * szerveroldali kikényszerítésével (OWASP A07).
 * Ez az útvonal SZÁNDÉKOSAN ugyanaz, amit eddig a Payload REST catch-all
 * (`src/app/(payload)/api/[...slug]/route.ts`) szolgált ki: a Next.js a konkrét
 * szegmenst előbbre sorolja a `[...slug]` mintánál. A catch-all ugyanazt a
 * konstruktorból kapott védelmet futtatja az alternatív útvonal-alakokra is.
 */
export const POST = createProtectedResetPost({
  getPayload: () => getPayload({ config }),
  payloadPost: REST_POST(config),
})
