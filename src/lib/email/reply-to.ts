/**
 * Reply-To cím a stáb-értesítőhöz (src/payload.config.ts, notifyStaffOnSubmission).
 */

/**
 * A Reply-To cím formai ellenőrzése: az űrlap-validátorok
 * (contact-submission, appointment/validation) mintája. Szóközt és sortörést
 * nem enged, így fejléc-injektálásra sem alkalmas.
 */
const STAFF_REPLY_TO_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
  const octets = (value: string) => new TextEncoder().encode(value).length
  const at = address.lastIndexOf('@')
  return (
    octets(address) <= STAFF_REPLY_TO_MAX_OCTETS &&
    octets(address.slice(0, at)) <= STAFF_REPLY_TO_LOCAL_MAX_OCTETS &&
    octets(address.slice(at + 1)) <= STAFF_REPLY_TO_DOMAIN_MAX_OCTETS
  )
}
