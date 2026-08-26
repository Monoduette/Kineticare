import { REST_POST } from '@payloadcms/next/routes'
import { getPayload } from 'payload'

import { createResetPasswordHandler } from '../../../../../lib/security/reset-password-route'
import config from '../../../../../payload.config'

/**
 * POST /api/users/reset-password — jelszó-visszaállítás a jelszó-politika
 * szerveroldali kikényszerítésével (OWASP A07).
 * Ez az útvonal SZÁNDÉKOSAN ugyanaz, amit eddig a Payload REST catch-all
 * (`src/app/(payload)/api/[...slug]/route.ts`) szolgált ki: a Next.js a konkrét
 * szegmenst előbbre sorolja a `[...slug]` mintánál, ezért minden ide érkező
 * kérés — a saját űrlapé, az admin reset-oldaláé és a végpont közvetlen hívása
 */
const payloadRestPost = REST_POST(config)

export const POST = createResetPasswordHandler({
  getPayload: () => getPayload({ config }),
  forwardToPayload: (request) =>
    payloadRestPost(request, {
      params: Promise.resolve({ slug: ['users', 'reset-password'] }),
    }),
})
