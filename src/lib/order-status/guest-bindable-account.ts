/**
 * Vendég-vásárlás fiók-kötése: melyik meglévő users-rekordhoz szabad
 * hozzányúlni e-mail egyezés alapján.
 *
 * K2 (2026-08-22): az `email equals` kötés aktivált fiókra azt jelenti, hogy
 * aki előbb regisztrál egy idegen címet, megkapja a későbbi vendég-fizetés
 * kurzusát. Séma / `auth.verify` nélkül a fék: csak a rendszer által
 * létrehozott, még aktiválatlan `customer` fiók köthető (előző vendég-fizetés
 * vagy import). Owner/staff és aktivált vevő: a vendég jelentkezzen be.
 * Ugyanez a szabály dönt a fizetés utáni kötésnél is
 * (`resolve-order-customer.ts`).
 */

export function isGuestBindableAccount(user: {
  role?: string | null
  passwordSetupPending?: boolean | null
}): boolean {
  return user.role === 'customer' && user.passwordSetupPending === true
}
