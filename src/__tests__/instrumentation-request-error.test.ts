import { describe, expect, it, vi } from 'vitest'

import type { RequestErrorContext, RequestErrorRequest } from '../lib/request-error'

/**
 * A Next csak akkor adja át a kiszökő szerveroldali kivételt, ha az
 * instrumentation `onRequestError`-t exportál (route-module.js
 * `instrumentationOnRequestError`). Enélkül a hiba csak a Next nyers
 * `⨯ …` soraként jelenik meg: request ID és útvonal nélkül, riasztás nélkül.
 */

const { reportMock } = vi.hoisted(() => ({ reportMock: vi.fn() }))

vi.mock('../lib/request-error', () => ({ reportRequestError: reportMock }))

import * as instrumentation from '../instrumentation'

describe('instrumentation.onRequestError', () => {
  it('exportálva van, és a kérés-hiba jelentőnek adja tovább a hibát', async () => {
    expect(typeof instrumentation.onRequestError).toBe('function')

    const error = new TypeError('Cannot read private member #state')
    const request: RequestErrorRequest = {
      path: '/api/posts/10',
      method: 'PATCH',
      headers: { 'x-request-id': 'req-1' },
    }
    const context: RequestErrorContext = {
      routerKind: 'App Router',
      routePath: '/api/[...slug]',
      routeType: 'route',
      revalidateReason: undefined,
    }

    await instrumentation.onRequestError(error, request, context)

    expect(reportMock).toHaveBeenCalledTimes(1)
    expect(reportMock).toHaveBeenCalledWith(error, request, context)
  })
})
