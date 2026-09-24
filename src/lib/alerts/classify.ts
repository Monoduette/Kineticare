/**
 * Riasztás-felismerés: melyik error-szintű naplósor riasztás, és mi a kódja.
 *
 * TISZTA modul (sem logger, sem szerver-függőség): a `src/lib/logger.ts`
 * importálja, a logger pedig kliens-komponensből is betöltődik
 * (`app/(frontend)/error.tsx`). Ide ezért csak szövegfeldolgozás kerülhet.
 *
 * Egy error-sor akkor riasztás, ha
 *  - az üzenete „RIASZTÁS" előtaggal kezdődik (a meglévő hívóhelyek
 *    konvenciója), vagy
 *  - a kötései vagy a context `alert: true`-t hordoznak (az `emitAlert`
 *    segédlet ezt adja, `alertCode`-dal együtt).
 *
 * A riasztáskód a Railway-szűrő (`@alertCode:<kód>`) és a levél-fojtás kulcsa,
 * ezért stabil, ékezet nélküli, kötőjeles szó: ha a hívó ad érvényes kódot,
 * az marad; ha nem, az ismert üzenet-előtagok táblája, végül az üzenet első
 * tagmondatából képzett slug adja.
 */

/** A riasztás-előtag, amellyel a meglévő hívóhelyek az owner-teendőt jelölik. */
export const ALERT_MESSAGE_PREFIX = 'RIASZTÁS'

/** A riasztáskód felső hossza (Railway-attribútum és fojtás-kulcs). */
export const MAX_ALERT_CODE_LENGTH = 64

/** Tartalék kód, ha az üzenetből semmi értelmes nem képezhető. */
export const FALLBACK_ALERT_CODE = 'riasztas'

const ALERT_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * A saját (új) riasztásaink kódjai. Egy helyen, hogy a Railway-szűrő, a
 * runbook és a teszt ugyanazt a szót használja.
 */
export const ALERT_CODES = {
  /** payment_pending rendelés 24 óránál régebben (akkor is, ha a GetState hibázik). */
  fuggoFizetes24Ora: 'fuggo-fizetes-24-ora',
  /** Beragadt `processing` job-sor, amelyet a schedule-guard feloldott. */
  beragadtJob: 'beragadt-job',
  /** A job-ütemezés duplikátum-ellenőrzése nem futott le (DB-hiba). */
  utemezesEllenorzesHiba: 'utemezes-ellenorzes-hiba',
  /** A napi összesítő összeállítása hibára futott. */
  napiOsszesitoHiba: 'napi-osszesito-hiba',
  /** Tartós refund-ellenőrzés (a pénz sorsa tisztázatlan). */
  refundEllenorzesreVar: 'refund-ellenorzesre-var',
  /** Automatikus visszatérítés (paid-reject) sikertelen. */
  automatikusVisszateritesSikertelen: 'automatikus-visszaterites-sikertelen',
} as const

/**
 * Meglévő, NEM általunk írt riasztás-üzenetek ismert előtagjai → kód. Így a
 * `src/lib/order-poll/service.ts` 24 órás riasztása és a saját (GetState-hibát
 * is lefedő) riasztásunk UGYANAZT a kódot kapja, tehát egy levél-fojtáson
 * osztozik. Az összevetés az előtag utáni szövegre, ékezet- és
 * kisbetű-függetlenül történik.
 */
const KNOWN_MESSAGE_CODES: ReadonlyArray<readonly [string, string]> = [
  ['a rendelés 24 órája payment_pending', ALERT_CODES.fuggoFizetes24Ora],
  ['tartós refund ellenőrzésre vár', ALERT_CODES.refundEllenorzesreVar],
  ['paid-reject recovery sikertelen', ALERT_CODES.automatikusVisszateritesSikertelen],
]

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Ékezetmentes, kisbetűs alak (NFD + a kombináló jelek törlése). */
function foldText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Az üzenet a riasztás-előtaggal kezdődik-e (vezető szóközök nélkül). */
export function hasAlertPrefix(msg: string): boolean {
  return msg.trimStart().startsWith(ALERT_MESSAGE_PREFIX)
}

/** Az üzenet a „RIASZTÁS:" előtag nélkül, vágva. */
export function stripAlertPrefix(msg: string): string {
  const trimmed = msg.trim()
  if (!trimmed.startsWith(ALERT_MESSAGE_PREFIX)) {
    return trimmed
  }
  return trimmed
    .slice(ALERT_MESSAGE_PREFIX.length)
    .replace(/^\s*:\s*/, '')
    .trim()
}

/** Érvényes riasztáskód-e (kisbetű, számjegy, egyszeres kötőjel, max. 64). */
export function isValidAlertCode(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ALERT_CODE_LENGTH &&
    ALERT_CODE_PATTERN.test(value)
  )
}

/**
 * Kód az üzenetből: az első mondatrész (gondolatjel vagy pont+szóköz előtt),
 * a zárójeles közbevetés nélkül, ékezet nélkül, kötőjellel. Szóhatáron
 * vágunk, hogy a kód olvasható maradjon.
 */
export function alertCodeFromMessage(msg: string): string {
  const body = stripAlertPrefix(msg)
  const foldedBody = foldText(body)
  for (const [prefix, code] of KNOWN_MESSAGE_CODES) {
    if (foldedBody.startsWith(foldText(prefix))) {
      return code
    }
  }
  const firstClause = foldedBody.replace(/\([^)]*\)/g, ' ').split(/\s[—–-]\s|\.\s/)[0] ?? ''
  const slug = firstClause.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (slug.length === 0) {
    return FALLBACK_ALERT_CODE
  }
  if (slug.length <= MAX_ALERT_CODE_LENGTH) {
    return slug
  }
  const cut = slug.slice(0, MAX_ALERT_CODE_LENGTH)
  const lastDash = cut.lastIndexOf('-')
  return (lastDash > 0 ? cut.slice(0, lastDash) : cut).replace(/-+$/g, '')
}

/**
 * A riasztáskód, ha a sor riasztás; különben `null`.
 *
 * Csak error-szintű sorra hívandó (a logger ezt biztosítja). A context
 * felülírja a kötést, ahogy a naplósorban is a hívás-szintű adat a
 * specifikusabb.
 */
export function resolveAlertCode(msg: string, bindings: unknown, context: unknown): string | null {
  const fromBindings = isRecord(bindings) ? bindings : {}
  const fromContext = isRecord(context) ? context : {}
  const flagged = fromContext.alert === true || fromBindings.alert === true
  if (!flagged && !hasAlertPrefix(msg)) {
    return null
  }
  const explicit = fromContext.alertCode ?? fromBindings.alertCode
  if (isValidAlertCode(explicit)) {
    return explicit
  }
  return alertCodeFromMessage(msg)
}
