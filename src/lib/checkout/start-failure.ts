import { BarionApiError } from '../barion'

/**
 * A Payment/Start hibájának osztályozása: LÉTREHOZOTT-E fizetést a Barion.
 *
 * - `rejected`: a Barion a kérést feldolgozta és hibajelzéssel elutasította,
 *   tehát fizetés NEM jött létre. Ilyen a HTTP 400/401/403/422 nem üres
 *   Errors tömbbel, és a HTTP 200-as, Errors tömbös válasz (a kliens ezt
 *   `provider` fajtájú hibának adja). Forrás: docs.barion.com
 *   Error_codes_notifications, „Responsive web payment" szakasz (Wayback
 *   20241014080026, oldid 4553): AuthenticationFailed, ModelValidationError,
 *   ShopIsInDraftState, ShopIsClosed, InvalidUser, UserCantReceiveEMoney stb.
 *   A rendelés ilyenkor payment_failed lehet, a vevő azonnal újrapróbálhatja.
 * - `uncertain`: timeout, hálózati hiba, 5xx, értelmezhetetlen válasz, Errors
 *   nélküli 4xx vagy bármi más. A Barion ilyenkor létrehozhatta a fizetést,
 *   csak a válasz nem ért el hozzánk. Itt marad a fail-closed várakozás.
 *
 * A Barion-oldali ErrorCode-okra PONTOS egyezéssel szűrünk (a repó
 * BARION_AUTH_ERROR_CODES-konvenciója), mintaillesztés nélkül.
 */
export type StartFailure =
  | {
      kind: 'rejected'
      httpStatus: number | null
      errorCodes: string[]
      /** Üzemeltetői teendő a naplóba; null, ha a kód nem ismert. */
      operatorHint: string | null
    }
  | { kind: 'uncertain' }

/** HTTP-státuszok, amelyeknél a nem üres Errors tömb végleges elutasítást jelent. */
export const BARION_START_REJECTION_HTTP_STATUSES: readonly number[] = [400, 401, 403, 422]

/**
 * Ismert Start-hibakódok → mit ellenőrizzen az üzemeltető. A leírások a
 * docs.barion.com Error_codes_notifications oldal „Responsive web payment"
 * szakaszát követik (lásd fent).
 */
export const BARION_START_OPERATOR_HINTS: Readonly<Record<string, string>> = {
  AuthenticationFailed:
    'a POSKey hibás, a nyilvános kulcs került a titkos helyére, vagy nem az aktív környezethez tartozik ' +
    '(BARION_ENVIRONMENT, BARION_API_URL, BARION_POSKEY_PROD / BARION_POSKEY_TEST)',
  ModelValidationError:
    'a Start-kérés valamelyik mezője nem felel meg a Barion szabályainak (a hibaüzenet címe megnevezi); ' +
    'ha a 3DS-mezők egyikét nevezi meg, vagy közvetlenül deploy után jelentkezik: BARION_SEND_3DS=false a Railway-en, és szólj a fejlesztőnek',
  InvalidUser:
    'a fizetés valamelyik résztvevője nem teljesen regisztrált Barion-felhasználó (BARION_PAYEE_EMAIL)',
  UserCantReceiveEMoney:
    'a kedvezményezett (BARION_PAYEE_EMAIL) nem teljesen regisztrált, aktivált Barion-tárca',
  ShopIsInDraftState: 'a Barion-bolt még nincs jóváhagyásra beküldve (secure.barion.com)',
  ShopIsClosed: 'a Barion-bolt zárva van vagy még nincs jóváhagyva, fizetés nem fogadható',
}

function operatorHintFor(errorCodes: readonly string[]): string | null {
  for (const code of errorCodes) {
    const match = Object.entries(BARION_START_OPERATOR_HINTS).find(
      ([known]) => known.toLowerCase() === code.toLowerCase(),
    )
    if (match) {
      return match[1]
    }
  }
  return null
}

export function classifyStartFailure(error: unknown): StartFailure {
  if (!(error instanceof BarionApiError) || error.providerErrors.length === 0) {
    return { kind: 'uncertain' }
  }
  const httpStatus = error.httpStatus ?? null
  const rejected =
    error.kind === 'provider' ||
    (error.kind === 'http' &&
      httpStatus !== null &&
      BARION_START_REJECTION_HTTP_STATUSES.includes(httpStatus))
  if (!rejected) {
    return { kind: 'uncertain' }
  }
  const errorCodes = error.providerErrors.map((providerError) => providerError.ErrorCode)
  return { kind: 'rejected', httpStatus, errorCodes, operatorHint: operatorHintFor(errorCodes) }
}
