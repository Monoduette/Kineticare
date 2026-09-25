import { afterEach, describe, expect, it, vi } from 'vitest'

import { getSzamlazzConfig, postInvoiceXml } from '../../lib/szamlazz/client'
import { SzamlazzApiError } from '../../lib/szamlazz/types'

/**
 * W1B-2: melyik beküldési hiba számít igazoltan hatás nélkülinek (noEffect).
 * Erre épül a helyesbítő egyetlen ismételt beküldése (refund-guard.ts), ezért
 * a lista szűk: csak a dokumentált `szlahu_down: true` karbantartási fejléc és
 * a kapcsolódás előtti hálózati hiba (névfeloldás, elutasított kapcsolat). Ami
 * a kapcsolat felépülése után történhetett (időtúllépés, bontott kapcsolat,
 * 5xx, értelmezhetetlen válasz, agent-hibakód), az bizonytalan kimenet: a
 * bizonylat létrejöhetett, így ismételt beküldés nem mehet ki rá.
 *
 * A teljes kliens-útvonal fut (postInvoiceXml → fetch → válasz-értelmezés); a
 * fetch-et stub adja (CLAUDE.md 15.: tesztből nincs valódi hálózati hívás).
 */

/** DUMMY érték, egyértelműen jelölve: NEM valódi Számla Agent kulcs. */
const config = getSzamlazzConfig({
  SZAMLAZZ_AGENT_KEY: 'DUMMY-W1B-R1-1-AGENT-KEY',
  SZAMLAZZ_AFAKULCS: 'AAM',
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function submissionError(answer: () => Promise<Response>): Promise<SzamlazzApiError> {
  vi.stubGlobal('fetch', vi.fn(answer))
  const outcome = await postInvoiceXml('<xmlszamla />', config).then(
    () => new Error('TESZT: a beküldésnek hibára kellett futnia'),
    (error: unknown) => error,
  )
  expect(outcome).toBeInstanceOf(SzamlazzApiError)
  return outcome as SzamlazzApiError
}

/** A Node hálózati hibája: kód és rendszerhívás (a Node `net`/`dns` alakja). */
function systemError(code: string, syscall: string): Error {
  return Object.assign(new Error(`${syscall} ${code} www.szamlazz.hu`), { code, syscall })
}

/** Az undici `fetch failed` hibája, a tényleges ok a `cause`-ban. */
function fetchFailed(cause?: unknown): TypeError {
  return cause === undefined
    ? new TypeError('fetch failed')
    : new TypeError('fetch failed', { cause })
}

describe('W1B-2: a karbantartási fejléc (szlahu_down)', () => {
  it.each([
    ['a dokumentált „true” érték, 200-as válasszal', 200, 'true', true],
    ['a dokumentált „true” érték, 503-as válasszal', 503, 'true', true],
    ['nem a dokumentált érték („1”): újrapróbálható, de nem bizonyíték', 200, '1', false],
  ] as const)('%s', async (_name, status, value, noEffect) => {
    const error = await submissionError(
      async () =>
        new Response('<html>Karbantartás</html>', { status, headers: { szlahu_down: value } }),
    )
    expect(error).toMatchObject({ kind: 'http', retryable: true, noEffect })
  })
})

describe('W1B-2: hálózati hiba a beküldésnél', () => {
  it.each([
    ['elutasított kapcsolat (ECONNREFUSED, connect)', systemError('ECONNREFUSED', 'connect'), true],
    ['névfeloldási hiba (ENOTFOUND, getaddrinfo)', systemError('ENOTFOUND', 'getaddrinfo'), true],
    [
      'átmeneti névfeloldási hiba (EAI_AGAIN, getaddrinfo)',
      systemError('EAI_AGAIN', 'getaddrinfo'),
      true,
    ],
    [
      'minden címre elutasított kapcsolat (AggregateError)',
      new AggregateError([
        systemError('ECONNREFUSED', 'connect'),
        systemError('ECONNREFUSED', 'connect'),
      ]),
      true,
    ],
    [
      'az egyik cím időtúllépéssel (vegyes AggregateError)',
      new AggregateError([
        systemError('ECONNREFUSED', 'connect'),
        systemError('ETIMEDOUT', 'connect'),
      ]),
      false,
    ],
    ['üres AggregateError', new AggregateError([]), false],
    ['bontott kapcsolat (ECONNRESET, read)', systemError('ECONNRESET', 'read'), false],
    ['ECONNREFUSED nem kapcsolódáskor (write)', systemError('ECONNREFUSED', 'write'), false],
    [
      'lezárt socket (UND_ERR_SOCKET)',
      Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
      false,
    ],
    [
      'kapcsolódási időtúllépés (UND_ERR_CONNECT_TIMEOUT)',
      Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' }),
      false,
    ],
    ['ok nélküli fetch-hiba', undefined, false],
  ] as const)('%s', async (_name, cause, noEffect) => {
    const error = await submissionError(async () => {
      throw fetchFailed(cause)
    })
    expect(error).toMatchObject({ kind: 'network', retryable: true, noEffect })
  })
})

describe('W1B-2: bizonytalan kimenet, nem bizonyíték', () => {
  it.each([
    [
      'időtúllépés (TimeoutError)',
      async (): Promise<Response> => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
      },
      'timeout',
    ],
    [
      'HTTP 503 karbantartási fejléc nélkül',
      async () => new Response('<html>Service Unavailable</html>', { status: 503 }),
      'http',
    ],
    [
      'értelmezhetetlen 200-as válasz',
      async () => new Response('<html>ismeretlen oldal</html>', { status: 200 }),
      'invalid_response',
    ],
    [
      'agent-hibakód (1)',
      async () =>
        new Response('', { status: 200, headers: { szlahu_error_code: '1', szlahu_error: 'x' } }),
      'agent',
    ],
    [
      'agent-hibakód (55)',
      async () =>
        new Response('', { status: 200, headers: { szlahu_error_code: '55', szlahu_error: 'x' } }),
      'agent',
    ],
  ] as const)('%s', async (_name, answer, kind) => {
    const error = await submissionError(answer)
    expect(error).toMatchObject({ kind, noEffect: false })
  })
})
