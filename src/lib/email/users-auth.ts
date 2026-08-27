import type { Plugin } from 'payload'

import { buildPasswordResetUrl } from '../password-reset-url'
import { returnUrlFromForgotPasswordRequest } from '../return-url'
import { resetPasswordEmail, verifyEmail } from './templates/auth'

/**
 * Users auth e-mail sablonok plugin-injekció (T-018). Reset link a nyilvános
 * `/jelszo-visszaallitas` oldalra, nem adminra. Verify csak ha engedélyezett.
 */

function userDisplayName(user: unknown): string | null {
  if (typeof user !== 'object' || user === null) {
    return null
  }
  const name = (user as Record<string, unknown>).name
  return typeof name === 'string' ? name : null
}

export const usersAuthEmails: Plugin = (config) => {
  const serverURL = process.env.NEXT_PUBLIC_SERVER_URL ?? ''
  const adminRoute = config.routes?.admin ?? '/admin'

  return {
    ...config,
    collections: (config.collections ?? []).map((collection) => {
      if (collection.slug !== 'users') {
        return collection
      }
      const auth = typeof collection.auth === 'object' ? collection.auth : {}
      const existingForgotPassword =
        typeof auth.forgotPassword === 'object' ? auth.forgotPassword : {}
      const existingVerify = typeof auth.verify === 'object' ? auth.verify : {}

      return {
        ...collection,
        auth: {
          ...auth,
          forgotPassword: {
            ...existingForgotPassword,
            generateEmailSubject: () => resetPasswordEmail({ resetUrl: '' }).subject,
            generateEmailHTML: (args?: { token?: string; user?: unknown; req?: unknown }) => {
              const resetUrl = buildPasswordResetUrl(
                serverURL,
                args?.token ?? '',
                returnUrlFromForgotPasswordRequest(args?.req),
              )
              return resetPasswordEmail({ name: userDisplayName(args?.user), resetUrl }).html
            },
          },
          // A verify CSAK engedélyezett állapotban kap sablont (lásd a fejlécet).
          ...(auth.verify
            ? {
                verify: {
                  ...existingVerify,
                  generateEmailSubject: () => verifyEmail({ verifyUrl: '' }).subject,
                  generateEmailHTML: (args?: { token?: string; user?: unknown }) => {
                    const verifyUrl = `${serverURL}${adminRoute}/verify/${args?.token ?? ''}`
                    return verifyEmail({ name: userDisplayName(args?.user), verifyUrl }).html
                  },
                },
              }
            : {}),
        },
      }
    }),
  }
}

export default usersAuthEmails
