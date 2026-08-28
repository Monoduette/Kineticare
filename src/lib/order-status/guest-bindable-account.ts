/**
 * Vendég-vásárlás fiók-kötése: melyik meglévő users-rekordhoz szabad
 * hozzányúlni e-mail egyezés alapján.
 *
 * K2 (2026-08-22): az `email equals` kötés aktivált fiókra azt jelenti, hogy
 * aki előbb regisztrál egy idegen címet, megkapja a későbbi vendég-fizetés
 * kurzusát. Séma / `auth.verify` nélkül a fék: csak a rendszer által
 * létrehozott, még aktiválatlan `customer` fiók köthető (előző vendég-fizetés
 * vagy import). Owner/staff és aktivált vevő: a vendég jelentkezzen be.
 */

export function isGuestBindableAccount(user: {
  role?: string | null
  passwordSetupPending?: boolean | null
}): boolean {
  return user.role === 'customer' && user.passwordSetupPending === true
}

/**
 * Paid-teljesítés fiók-kötése: a pénz MÁR le van vonva (GetState v4 +
 * összeg-assert után). Aktivált `customer` is köthető — a kurzus kiadása
 * előbbre való, mint a „jelentkezz be" K2-szabály. A K2-lopás a Starton
 * marad (`isGuestBindableAccount` + `CHECKOUT_GUEST_EXISTING_ACCOUNT`).
 *
 * Staff/owner ide NEM tartozik: azokhoz a paid-ág terminálisan rejectel.
 */
export function isPaidFulfillmentBindableAccount(user: { role?: string | null }): boolean {
  return user.role === 'customer'
}
