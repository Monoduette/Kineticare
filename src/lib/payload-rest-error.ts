/**
 * Payload REST hibaválasz → EMBERI, magyar üzenet.
 *
 * A Payload (és a plugin-jai) a hibát `{ errors: [{ message }] }` alakban
 * adják vissza; a saját hookjaink `APIError`-jai már magyarul érkeznek (pl. a
 * kapcsolat-űrlap consent-hibái, a Turnstile-hibák, a rate-limit 429-e), ezért
 * azokat SZÓ SZERINT jelenítjük meg. Ha a válasz nem értelmezhető (nem JSON,
 * üres törzs, proxy-hibaoldal), a hívó által adott általános üzenet marad.
 *
 * A Payload a NEM nyilvános (500-as) hibák szövegét a saját angol
 * „Something went wrong." üzenetére cseréli
 * (node_modules/payload/dist/utilities/routeError.js). Ezt a látogató nem
 * értené, ezért ilyenkor is a hívó magyar általános üzenete jelenik meg.
 */

/** A Payload maszkolt belső hibájának szövege (pont nélkül is). */
const PAYLOAD_GENERIC_ERROR_PATTERN = /^something went wrong\.?$/i

/** Megjeleníthető-e a szerver által küldött üzenet a látogatónak. */
function isDisplayableMessage(message: unknown): message is string {
  if (typeof message !== 'string') {
    return false
  }
  const trimmed = message.trim()
  return trimmed.length > 0 && !PAYLOAD_GENERIC_ERROR_PATTERN.test(trimmed)
}

/**
 * @param response a sikertelen (nem `ok`) válasz
 * @param fallback általános magyar üzenet, ha a törzsből nem nyerhető ki
 *   megjeleníthető hiba
 */
export async function extractPayloadErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as {
      errors?: Array<{ message?: string }>
      message?: string
    }
    // Az első MEGJELENÍTHETŐ hiba; üres vagy maszkolt szöveg után a felső
    // szintű `message` következik, és csak mindkettő hiányában a tartalék.
    const first = body.errors?.find((entry) => isDisplayableMessage(entry.message))
    if (first?.message !== undefined) {
      return first.message
    }
    if (isDisplayableMessage(body.message)) {
      return body.message
    }
  } catch {
    // Nem JSON-válasz — marad az általános üzenet.
  }
  return fallback
}
