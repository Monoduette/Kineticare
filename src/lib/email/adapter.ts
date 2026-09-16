import type { EmailAdapter } from 'payload'

import { parseFromAddress } from './mask'
import { sendMail } from './provider'
import type { SendResult } from './types'

/**
 * Payload EmailAdapter a saját provider-réteg fölé (T-018).
 *
 * Ezt adja a payload.config `email` mezője, így a Payload auth e-mail-funkciói
 * (forgot-password, verify) is a Resend/SMTP/noop provideren mennek ki —
 * konfiguráció nélkül (dev) sosem crashelnek.
 */

/**
 * Szöveges (text/plain) változat a HTML-ből, ha a hívó nem adott.
 *
 * A Payload `forgotPassword`/`verify` művelete CSAK HTML-t ad át
 * (`generateEmailHTML`), szöveges sablon-hook nincs. Korábban a
 * `text/plain` rész ÜRESEN ment ki (mérve 2026-09-16, WP41, helyi
 * SMTP-gyűjtővel): a csak-szöveges olvasók és a levélszűrők üres levelet
 * láttak, a visszaállító link kizárólag a HTML-részben volt. A HTML-ből
 * vezetett szöveg a linket is megőrzi (a sablon a gomb alatt kiírja a
 * címet), ezért a levél a HTML-t nem mutató kliensben is használható.
 */
export function plainTextFromHtml(html: string): string {
  const withoutBlocks = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
  const withBreaks = withoutBlocks
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|table|blockquote)>/gi, '\n')
  const stripped = withBreaks.replace(/<[^>]+>/g, '')
  const decoded = stripped
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
  return decoded
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line, index, lines) => line.length > 0 || (index > 0 && lines[index - 1].length > 0))
    .join('\n')
    .trim()
}

export const kineticareEmailAdapter: EmailAdapter<SendResult> = () => {
  const from = parseFromAddress(process.env.EMAIL_FROM)
  return {
    name: 'kineticare-provider',
    defaultFromAddress: from.address,
    defaultFromName: from.name,
    sendEmail: async (message) => {
      const to = Array.isArray(message.to) ? message.to : [message.to]
      const html = typeof message.html === 'string' ? message.html : ''
      const givenText = typeof message.text === 'string' ? message.text.trim() : ''
      return sendMail({
        to: to.filter((recipient): recipient is string => typeof recipient === 'string'),
        subject: message.subject,
        html,
        text: givenText.length > 0 ? givenText : plainTextFromHtml(html),
      })
    },
  }
}
