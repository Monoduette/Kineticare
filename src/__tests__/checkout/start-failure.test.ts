import { describe, expect, it } from 'vitest'

import { BarionApiError, type BarionErrorKind } from '../../lib/barion'
import { BARION_START_OPERATOR_HINTS, classifyStartFailure } from '../../lib/checkout/start-failure'

/**
 * a-checkout-2: a Start-hiba osztályozása dönti el, marad-e 30 percig a
 * fail-closed várakozás. Csak az a hiba „elutasított", amelyből biztosan
 * tudjuk, hogy a Barion NEM hozott létre fizetést.
 */

const START_ENDPOINT = 'POST /v2/Payment/Start'

function barionError(
  kind: BarionErrorKind,
  httpStatus: number | undefined,
  codes: string[] = [],
): BarionApiError {
  return new BarionApiError({
    message: 'DUMMY',
    kind,
    endpoint: START_ENDPOINT,
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    providerErrors: codes.map((code) => ({ ErrorCode: code, Title: 'DUMMY', Description: '' })),
  })
}

describe('classifyStartFailure — elutasított (fizetés nem jött létre)', () => {
  it.each([400, 401, 403, 422])('HTTP %i + nem üres Errors tömb → rejected', (status) => {
    expect(classifyStartFailure(barionError('http', status, ['ModelValidationError']))).toEqual({
      kind: 'rejected',
      httpStatus: status,
      errorCodes: ['ModelValidationError'],
      operatorHint: BARION_START_OPERATOR_HINTS.ModelValidationError,
    })
  })

  it('HTTP 200 + Errors tömb (provider) → rejected', () => {
    const failure = classifyStartFailure(barionError('provider', 200, ['UserCantReceiveEMoney']))
    expect(failure).toMatchObject({ kind: 'rejected', errorCodes: ['UserCantReceiveEMoney'] })
  })

  it.each([
    'AuthenticationFailed',
    'ModelValidationError',
    'InvalidUser',
    'UserCantReceiveEMoney',
    'ShopIsInDraftState',
    'ShopIsClosed',
  ])('%s → üzemeltetői teendő a naplóhoz', (code) => {
    const failure = classifyStartFailure(barionError('http', 400, [code]))
    expect(failure.kind).toBe('rejected')
    expect(failure.kind === 'rejected' ? failure.operatorHint : null).toBe(
      BARION_START_OPERATOR_HINTS[code],
    )
  })

  it('az ismert kód kis-nagybetűtől függetlenül egyezik, az ismeretlenhez nincs teendő', () => {
    const lower = classifyStartFailure(barionError('http', 401, ['authenticationfailed']))
    expect(lower.kind === 'rejected' ? lower.operatorHint : null).toBe(
      BARION_START_OPERATOR_HINTS.AuthenticationFailed,
    )
    const unknown = classifyStartFailure(barionError('http', 400, ['SomethingNew']))
    expect(unknown).toMatchObject({ kind: 'rejected', operatorHint: null })
  })
})

describe('classifyStartFailure — bizonytalan (a Barion létrehozhatta a fizetést)', () => {
  it.each([
    ['timeout', barionError('timeout', undefined)],
    ['hálózati hiba', barionError('network', undefined)],
    ['HTTP 500 Errors-szal is', barionError('http', 500, ['InternalServerError'])],
    ['HTTP 503 Errors nélkül', barionError('http', 503)],
    ['HTTP 401 Errors nélkül (közbülső réteg)', barionError('http', 401)],
    ['HTTP 404 Errors-szal (útvonal-eltérés)', barionError('http', 404, ['NotFound'])],
    ['HTTP 429', barionError('http', 429, ['TooManyRequests'])],
    ['értelmezhetetlen válasz', barionError('invalid_response', 200)],
    ['nem Barion-hiba', new Error('DUMMY')],
    ['nem is Error', 'DUMMY'],
  ])('%s → uncertain', (_label, error) => {
    expect(classifyStartFailure(error)).toEqual({ kind: 'uncertain' })
  })
})
