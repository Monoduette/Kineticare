import { describe, expect, it } from 'vitest'

import * as billing from '../../lib/checkout/billing'
import * as formSubmission from '../../lib/checkout/form-submission'
import * as guest from '../../lib/checkout/guest'
import * as pendingPayment from '../../lib/checkout/pending-payment'

/**
 * a-checkout-12/7 őre: a pénztár vevőnek szóló üzenetei natív magyarok,
 * töltelék gondolatjel (U+2013, U+2014) és API-mezőnév nélkül
 * (docs/ui-sztenderdek.md §3.1.2 és §2.7; GOV.UK Error message:
 * https://design-system.service.gov.uk/components/error-message/).
 */

function stringConstants(module: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(module).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === 'string' && /^[A-Z][A-Z0-9_]+$/.test(entry[0]),
  )
}

const MESSAGES: Array<[string, string]> = [
  ...stringConstants(billing),
  ...stringConstants(formSubmission).filter(
    ([name]) => name.endsWith('_ERROR') || name.startsWith('CHECKOUT_'),
  ),
  ...stringConstants(guest),
  ...stringConstants(pendingPayment),
  ['checkoutPaymentInProgressMessage', pendingPayment.checkoutPaymentInProgressMessage(12)],
  ['checkoutStartUncertainMessage', pendingPayment.checkoutStartUncertainMessage(12)],
  ['checkoutStartRejectedWaitMessage', pendingPayment.checkoutStartRejectedWaitMessage(12)],
]

describe('a pénztár vevői üzenetei', () => {
  it('a vizsgált halmaz tartalmazza az új üzeneteket (az őr nem üres)', () => {
    const names = MESSAGES.map(([name]) => name)
    expect(names).toEqual(
      expect.arrayContaining([
        'BILLING_SUMMARY_MISSING',
        'GUEST_SUMMARY_MISSING',
        'CHECKOUT_START_REJECTED',
        'CHECKOUT_PAYMENT_CONFIG_UNAVAILABLE',
        'CHECKOUT_PAYEE_EMAIL_GUEST',
        'CHECKOUT_PAYEE_EMAIL_ACCOUNT',
        'CHECKOUT_GUEST_FINISH_AFTER_LOGIN',
        'CHECKOUT_PAYMENT_STATE_UNVERIFIED',
      ]),
    )
  })

  it.each(MESSAGES)('%s: nincs gondolatjel és API-mezőnév', (_name, message) => {
    expect(message).not.toMatch(/[–—]/)
    expect(message).not.toMatch(/consentTerms|consentWithdrawalWaiver|archivált/)
  })

  it('a vendég „belépés után" üzenete a jelszó nélküli vevőnek is kiutat ad', () => {
    expect(formSubmission.CHECKOUT_GUEST_FINISH_AFTER_LOGIN).toContain(
      '„Elfelejtetted a jelszavad?”',
    )
    expect(formSubmission.CHECKOUT_GUEST_FINISH_AFTER_LOGIN).toContain('jelszó-beállító link')
  })
})
