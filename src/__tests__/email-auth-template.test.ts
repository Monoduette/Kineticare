import { describe, expect, it } from 'vitest'

import { inviteEmail } from '../lib/customer-import/send-invites'
import { resetPasswordEmail } from '../lib/email/templates/auth'
import { orderConfirmationEmail } from '../lib/email/templates/order'
import { freeCourseEmail } from '../lib/free-course/email'
import { buildPasswordResetUrl } from '../lib/password-reset-url'

const address = 'pelda+fiok@example.test'
const name = 'Őri <Példa> & Társa'
const token = 'DUMMY_NON_AUTHENTICATING_TEMPLATE_TOKEN+&'
const resetUrl = buildPasswordResetUrl('https://kineticare.example.test', token, '/kurzusaim/2')

describe('Jelszólevelek: közös megjelenés, személyes resetlink', () => {
  const renderers = {
    reset: () => resetPasswordEmail({ name, email: address, resetUrl }),
    free: () =>
      freeCourseEmail({
        name,
        email: address,
        courseTitle: 'Minta kurzus',
        activationUrl: resetUrl,
        expiresInDays: 7,
      }),
    invite: () => inviteEmail({ name, email: address, activationUrl: resetUrl }),
    order: () =>
      orderConfirmationEmail({
        buyerName: name,
        orderNumber: 'DUMMY-ORDER',
        items: [],
        totalHuf: 0,
        invoiceNote: false,
        coursesUrl: 'https://kineticare.example.test/kurzusaim',
        account: {
          kind: 'password-setup',
          email: address,
          activationUrl: resetUrl,
          expiresInDays: 7,
        },
      }),
  }

  it.each(Object.entries(renderers))(
    '%s: név és pontos fiókcím HTML-ben és szövegben',
    (_kind, render) => {
      const email = render()
      expect(email.html).toContain('Őri &lt;Példa&gt; &amp; Társa')
      expect(email.html).not.toContain('<Példa>')
      expect(email.html).toContain('A fiókod e-mail-címe:')
      expect(email.html).toContain(address)
      expect(email.text).toContain(`Kedves ${name}!`)
      expect(email.text).toContain(`A fiókod e-mail-címe: ${address}`)
    },
  )

  it.each(Object.entries(renderers))(
    '%s: a tokenes gomb a meglévő resetoldalra visz',
    (_kind, render) => {
      const email = render()
      const hrefs = [...email.html.matchAll(/href="([^"]+)"/g)].map((match) =>
        match[1].replaceAll('&amp;', '&'),
      )
      expect(hrefs.length).toBeGreaterThan(0)
      expect(hrefs.every((href) => href === resetUrl)).toBe(true)
      expect(email.text.includes(resetUrl)).toBe(true)
      expect(email.html).not.toContain('/belepes-atallas')
      const target = new URL(hrefs[0])
      expect(target.pathname).toBe('/jelszo-visszaallitas')
      expect(target.searchParams.get('token') === token).toBe(true)
      expect(target.searchParams.get('returnUrl')).toBe('/kurzusaim/2')
    },
  )

  it('reset: hiányzó névnél semleges megszólítás, hiányzó címnél nincs kitalált adat', () => {
    const email = resetPasswordEmail({ name: '   ', resetUrl })
    expect(email.text).toContain('Szia!')
    expect(email.text).not.toContain('A fiókod e-mail-címe:')
    expect(email.html).not.toContain('undefined')
  })
})
