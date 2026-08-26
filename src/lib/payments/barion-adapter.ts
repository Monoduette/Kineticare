import type { PaymentAdapter } from '@payloadcms/plugin-ecommerce/types'
import type { Endpoint, GroupField } from 'payload'

import type { User } from '../../payload-types'
import { logger } from '../logger'
import type { CheckoutBillingInput } from '../checkout/billing'
import { startCheckout } from '../checkout/start-checkout'

/**
 * Plugin PaymentAdapter-héj a saját checkout-start fölött.
 * `confirmOrder` mindig dob (plugin beta-hiba). Nincs a paymentMethods-ben;
 * a `/payments/*` végpontokat a szűrő is eltávolítja. confirmOrder tilos.
 */

const BARION_ADMIN_GROUP: GroupField = {
  name: 'barion',
  type: 'group',
  label: 'Barion',
  admin: {
    condition: (data) => data?.paymentMethod === 'barion',
  },
  fields: [
    {
      name: 'barionPaymentId',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'A Barion Payment/Start válaszban kapott PaymentId.',
      },
    },
  ],
}

/** Relationship-érték → dokumentum-id (number vagy populate-olt doc). */
function relationshipId(value: unknown): number | string | null {
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'string' && value.length > 0) {
    return value
  }
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'number' || typeof id === 'string') {
      return id
    }
  }
  return null
}

/**
 * A plugin cart-alakja NEM hordoz számlázási adatot, a checkout-szolgáltatás
 * viszont KÖTELEZŐEN kéri (nincs benne rejtett profil-visszaesés). Ezért a
 * hiányzó adatot itt, a hívó oldalán, KIMONDVA a felhasználó tárolt profiljából
 * állítjuk elő — a validáció ezen az úton is lefut, tehát hiányos profillal
 * ezen az ágon sem jöhet létre számlázhatatlan rendelés.
 */
function billingFromProfile(user: User): CheckoutBillingInput {
  return {
    // A `buyerFromOrder` is a billingName → name sorrendet követi (invoice.ts).
    name: user.billingName ?? user.name ?? '',
    zip: user.billingZip ?? '',
    city: user.billingCity ?? '',
    street: user.billingStreet ?? '',
    ...(user.taxNumber ? { taxNumber: user.taxNumber } : {}),
  }
}

export const barionPaymentAdapter: PaymentAdapter = {
  name: 'barion',
  label: 'Barion bankkártyás fizetés',
  group: BARION_ADMIN_GROUP,
  initiatePayment: async ({ data, req }) => {
    if (!req.user) {
      throw new Error('A fizetés indításához bejelentkezés szükséges.')
    }
    // A plugin cart-alakú inputját a kosármentes checkout-szolgáltatásra képezzük:
    // az első cart-tétel a megvásárolandó kurzus (egy kurzus = egy rendelés).
    const items = Array.isArray(data.cart?.items) ? data.cart.items : []
    const firstItem = items[0] as { product?: unknown; quantity?: unknown } | undefined
    const productId = relationshipId(firstItem?.product)
    if (productId === null) {
      throw new Error('A kosár üres — nincs megvásárolható tétel a fizetés indításához.')
    }

    const user = req.user as unknown as User
    const result = await startCheckout({
      payload: req.payload,
      user,
      input: {
        productId: typeof productId === 'string' ? Number(productId) : productId,
        quantity: firstItem?.quantity ?? 1,
        consentWithdrawalWaiver:
          (data as Record<string, unknown>).consentWithdrawalWaiver === true,
        // Az ÁSZF-elfogadás a szerveren KÖTELEZŐ (start-checkout.ts): a
        // szerződés ettől jön létre (ÁSZF 22. bekezdés). Az adapter a hívó
        // adatából adja tovább, saját `true`-t NEM talál ki — különben ez az
        // út némán megkerülné az elfogadást.
        consentTerms: (data as Record<string, unknown>).consentTerms === true,
        billing: billingFromProfile(user),
      },
    })

    return {
      message: `Barion-fizetés elindítva (${result.orderNumber}) — irányítsd a vevőt a GatewayUrl-re.`,
      orderNumber: result.orderNumber,
      gatewayUrl: result.gatewayUrl,
    }
  },
  // LÁSD A FEJLÉC 1. PONTJÁT: ez a függvény szándékosan NEM hajtható végre —
  // a `paid` átmenet kizárólag a Barion-callback-útvonal (T-022) joga.
  confirmOrder: async (): Promise<never> => {
    throw new Error(
      'A fizetés jóváhagyása a plugin confirmOrder-útvonalán TILOS: a plugin ismert ' +
        'beta-hibája miatt a confirmOrder nem ellenőrzi a fizetés tényleges státuszát. ' +
        'A rendelés paid-re állítása kizárólag a saját Barion-callback-útvonalon történhet (T-022).',
    )
  },
}

/**
 * T-063 védelmi szűrő: eltávolítja a plugin által esetleg regisztrált
 * `/payments/*` végpontokat (initiate + confirm-order) a végleges configból.
 *
 * Így akkor sem hívható le a plugin confirmOrder-je, ha egy későbbi
 * módosítás mégis felvenné az adaptert a paymentMethods tömbbe — a fizetés
 * indításának egyetlen útvonala a saját POST /api/checkout/start marad.
 */
export function withoutPluginPaymentEndpoints(endpoints: Endpoint[] | undefined): Endpoint[] {
  const list = endpoints ?? []
  const kept = list.filter(
    (endpoint) => !(typeof endpoint.path === 'string' && endpoint.path.startsWith('/payments/')),
  )
  if (kept.length !== list.length) {
    const removed = list
      .filter((endpoint) => !kept.includes(endpoint))
      .map((endpoint) => endpoint.path)
    logger.warn('T-063: plugin payment-végpontok eltávolítva a configból (confirmOrder-tiltás)', {
      paths: removed,
    })
  }
  return kept
}
