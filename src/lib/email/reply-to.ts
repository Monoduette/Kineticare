/**
 * Reply-To cím a stáb-értesítőhöz (src/payload.config.ts, notifyStaffOnSubmission).
 */

/**
 * A Reply-To cím formai ellenőrzése, szigorúbban az űrlap-validátoroknál: a
 * szolgáltató érvénytelen `reply_to` miatt az EGÉSZ stáb-levelet elutasíthatja,
 * ezért csak ASCII-cím mehet (a cím a levél törzsében úgyis szerepel).
 * - Helyi rész: RFC 5322 3.2.3 dot-atom (nincs kezdő, záró vagy dupla pont).
 * - Domain: RFC 1035 2.3.1 címkék (betű/szám/kötőjel, kötőjel nem a szélén,
 *   legfeljebb 63 karakter), legalább két címke, betűs vagy `xn--` TLD.
 * Szóközt és sortörést nem enged, így fejléc-injektálásra sem alkalmas.
 */
const STAFF_REPLY_TO_EMAIL_PATTERN =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59})$/

/**
 * Az SMTP (RFC 5321, 4.5.3.1) hosszkorlátai oktettben: a teljes cím 254, a
 * helyi rész (@ előtt) 64, a domain 253. Ezeken túl a Resend az EGÉSZ levelet
 * elutasítaná, ezért ilyen címnél a stáb-értesítő Reply-To nélkül megy.
 */
const STAFF_REPLY_TO_MAX_OCTETS = 254
const STAFF_REPLY_TO_LOCAL_MAX_OCTETS = 64
const STAFF_REPLY_TO_DOMAIN_MAX_OCTETS = 253

/** Használható-e a cím Reply-To-ként (forma + SMTP-hosszkorlátok). */
export function isUsableReplyToAddress(address: string): boolean {
  if (!STAFF_REPLY_TO_EMAIL_PATTERN.test(address)) {
    return false
  }
  // A minta csak ASCII-t enged: itt a karakterszám egyenlő az oktettszámmal.
  const at = address.lastIndexOf('@')
  return (
    address.length <= STAFF_REPLY_TO_MAX_OCTETS &&
    at <= STAFF_REPLY_TO_LOCAL_MAX_OCTETS &&
    address.length - at - 1 <= STAFF_REPLY_TO_DOMAIN_MAX_OCTETS
  )
}
