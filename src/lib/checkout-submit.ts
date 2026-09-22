import type { CheckoutBillingInput } from './checkout/billing'
import type { CheckoutGuestInput } from './checkout/guest'

/**
 * Checkout-submit — a /penztar beküldése a T-021 checkout-start végpontra.
 *
 * API-szerződés (T-021): POST /api/checkout/start
 * - Törzs: { productId, quantity?, consentWithdrawalWaiver: true, consentTerms: true,
 *   billing, guest? }
 * - A `consentTerms` az ÁSZF elfogadása (és az adatkezelési tájékoztató
 *   megismerése) EGYETLEN jelölőnégyzetből — az ÁSZF 22. bekezdése így írja le
 *   a szerződéskötést. MINDEN terméken kötelező, az ingyenesen is; hiánya →
 *   400. A szerver a rendelés vevő-pillanatképére `consentTerms` +
 *   `consentTermsAt` (ISO-időbélyeg) néven rögzíti.
 * - A kliens SOSEM küld árat — a végösszeg a szerver (T-021) számolja.
 * - A `billing` a pénztárban MEGADOTT számlázási adat (név/irsz/település/cím
 *   + opcionális adószám). Ez a rendelésre rögzített igazság: a szerver ebből
 *   építi a `customerSnapshot`-ot, és a számla is ebből készül. A felhasználó
 *   profilja csak ELŐKITÖLTÉS — ha a vevő a pénztárban mást ír, az érvényesül.
 *   A mező kötelező: nélküle (vagy hiányosan) a szerver 400-zal utasít el.
 * - A `guest` blokk (e-mail + név) KIZÁRÓLAG bejelentkezés nélkül megy ki, és
 *   akkor kötelező: a vendég-vásárlásnál ez azonosítja a vevőt (ide megy a
 *   hozzáférés és a jelszó-beállító link). Belépve a szerver figyelmen kívül
 *   hagyja — az igazság a munkamenet.
 * - Sikeres válasz: { orderNumber, gatewayUrl } → redirect a Barion fizetőfelületre.
 * - Hibák: 400 (validáció/waiver/számlázási adat/vendég-adat/archived/draft),
 *   404 (termék), 409 (duplavásárlás), 502 (Barion-hiba), 500 (általános).
 */

export type {
  BillingFieldError,
  BillingFieldName,
  BillingValidationResult,
  CheckoutBillingInput,
  NormalizedBilling,
} from './checkout/billing'
export type {
  CheckoutGuestInput,
  GuestFieldError,
  GuestFieldName,
  GuestValidationResult,
  NormalizedGuest,
} from './checkout/guest'

export interface CheckoutProduct {
  id: number
  sku: string
  priceHuf: number | null
  isFree: boolean
}

export interface CheckoutUser {
  name: string | null
  email: string | null
  billingName?: string | null
  billingZip?: string | null
  billingCity?: string | null
  billingStreet?: string | null
  taxNumber?: string | null
}

export interface CheckoutSubmitInput {
  productId: number
  quantity: number
  /**
   * A pénztárban megjelenített ár. A szerver nem ebből számol (a kliens ára
   * sosem forrás), csak összeveti a most érvényes árral, és eltérésnél 400-at ad.
   */
  priceHuf?: number
  consentWithdrawalWaiver: boolean
  /**
   * Az ÁSZF elfogadása + az adatkezelési tájékoztató megismerése — EGY
   * jelölőnégyzet, az ÁSZF 22. bekezdése szerint. Fizetős és ingyenes terméken
   * egyaránt kötelező.
   */
  consentTerms: boolean
  /** A pénztárban megadott számlázási adatok — a számla ebből készül. */
  billing: CheckoutBillingInput
  /**
   * Vendég-vásárlásnál a vevő azonosító adatai (e-mail + név). Bejelentkezett
   * vásárlásnál KIMARAD a törzsből.
   */
  guest?: CheckoutGuestInput
}

export type CheckoutSubmitResult =
  | { ok: true; orderNumber: string; gatewayUrl: string }
  | { ok: false; message: string }

/** Általános, felhasználóbarát hibaüzenet — a szerver-válasz felülírhatja. */
export const GENERIC_CHECKOUT_ERROR =
  'A fizetés indítása most nem sikerült. Próbáld újra néhány perc múlva, vagy írj nekünk a kapcsolatfelvételnél.'

export async function submitCheckout(
  input: CheckoutSubmitInput,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckoutSubmitResult> {
  try {
    const response = await fetchImpl('/api/checkout/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      credentials: 'include',
    })

    if (!response.ok) {
      let message = GENERIC_CHECKOUT_ERROR
      try {
        const body = (await response.json()) as { error?: string }
        if (typeof body.error === 'string' && body.error.length > 0) {
          message = body.error
        }
      } catch {
        // Nem JSON-válasz — marad az általános üzenet.
      }
      return { ok: false, message }
    }

    const body = (await response.json()) as { orderNumber?: string; gatewayUrl?: string }
    if (typeof body.orderNumber !== 'string' || typeof body.gatewayUrl !== 'string') {
      return { ok: false, message: GENERIC_CHECKOUT_ERROR }
    }
    return { ok: true, orderNumber: body.orderNumber, gatewayUrl: body.gatewayUrl }
  } catch {
    return { ok: false, message: GENERIC_CHECKOUT_ERROR }
  }
}
