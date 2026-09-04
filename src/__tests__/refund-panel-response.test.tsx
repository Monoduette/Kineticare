import { Window } from 'happy-dom'
import { act, createElement, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RefundPanel } from '../components/admin/RefundPanel'

const ui = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  user: { id: 1, role: 'owner' },
  initializing: false,
  refresh: vi.fn<() => void | Promise<void>>(),
  click: undefined as (() => void) | undefined,
}))

vi.mock('@payloadcms/ui', () => ({
  useDocumentInfo: () => ({ data: ui.data, isInitializing: ui.initializing }),
  useAuth: () => ({ user: ui.user }),
  useRouteCache: () => ({ clearRouteCache: ui.refresh }),
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode
    disabled?: boolean
    onClick: () => void
  }) => {
    ui.click = onClick
    return createElement('button', { disabled, onClick }, children)
  },
}))

const ORDER_A = 'SYNTHETIC-REFUND-A'
const ORDER_B = 'SYNTHETIC-REFUND-B'
const fetchMock = vi.fn<typeof fetch>()
const confirmMock = vi.fn<() => boolean>()
let window: Window
let container: HTMLDivElement
let root: Root

function order(orderNumber = ORDER_A, status = 'paid') {
  return { orderNumber, status, totalHufSnapshot: 20000 }
}

function success(overrides: Record<string, unknown> = {}) {
  return {
    orderNumber: ORDER_A,
    type: 'full',
    amountHuf: 20000,
    transactionId: 'synthetic-transaction',
    refundedTransactionStatus: 'Refunded',
    alreadyRefundedHuf: 0,
    totalRefundedHuf: 20000,
    orderStatus: 'refunded',
    refundStatusOutcome: 'succeeded',
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function render(data = ui.data) {
  ui.data = data
  await act(async () => {
    root.render(createElement(RefundPanel))
  })
}

function button() {
  const element = container.querySelector('button')
  if (!element) throw new Error('Expected the refund submit button')
  return element
}

async function submit() {
  await act(async () => {
    button().click()
  })
}

function expectReview() {
  const alert = container.querySelector('[role="alert"]')
  expect(alert?.textContent).toContain('Ne indíts új')
  expect(container.querySelector('[role="status"]')).toBeNull()
  expect(container.textContent).not.toContain('visszatérítés megtörtént')
  const submitButton = container.querySelector('button')
  if (submitButton) expect(submitButton.disabled).toBe(true)
}

beforeEach(async () => {
  ui.data = order()
  ui.user = { id: 1, role: 'owner' }
  ui.initializing = false
  ui.refresh.mockReset()
  ui.click = undefined
  fetchMock.mockReset().mockImplementation(async () => {
    throw new Error('Unexpected unconfigured request in refund UI test')
  })
  window = new Window({ url: 'http://localhost:3000' })
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  vi.stubGlobal('navigator', window.navigator)
  vi.stubGlobal('HTMLElement', window.HTMLElement)
  vi.stubGlobal('Event', window.Event)
  vi.stubGlobal('MouseEvent', window.MouseEvent)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // Only the component transport is mocked; the external runner denies all network access.
  vi.stubGlobal('fetch', fetchMock)
  confirmMock.mockReset().mockReturnValue(true)
  Object.defineProperty(window, 'confirm', { value: confirmMock })
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await render()
})

afterEach(async () => {
  try {
    await act(async () => {
      root?.unmount()
    })
    container?.remove()
    await window.happyDOM.close()
  } finally {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})

describe('RefundPanel response presentation and current-mount guards', () => {
  it('keeps the existing endpoint, request body and validated full success', async () => {
    fetchMock.mockResolvedValue(Response.json(success()))
    await submit()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/admin/orders/${ORDER_A}/refund`,
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: '{}',
      }),
    )
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Teljes visszatérítés megtörtént',
    )
    expect(ui.refresh).toHaveBeenCalledTimes(1)
    expect(button().disabled).toBe(true)
  })

  it('allows another intentional partial refund after a validated success and refresh', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        success({
          type: 'partial',
          amountHuf: 5000,
          totalRefundedHuf: 5000,
          orderStatus: 'paid',
          refundedTransactionStatus: 'PartiallyRefunded',
        }),
      ),
    )
    await submit()
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Részleges visszatérítés megtörtént',
    )
    expect(button().disabled).toBe(false)
  })

  it('keeps same-order success without a navigation warning when refresh changes eligibility before resolving', async () => {
    const refreshed = deferred<void>()
    fetchMock.mockResolvedValue(Response.json(success()))
    ui.refresh.mockImplementation(() => {
      ui.data = order(ORDER_A, 'refunded')
      root.render(createElement(RefundPanel))
      return refreshed.promise
    })
    const callback = ui.click!
    await submit()
    expect(ui.refresh).toHaveBeenCalledTimes(1)
    expect(container.querySelector('button')).toBeNull()
    const confirmed = container.querySelector('[role="status"]')?.textContent
    expect(confirmed).toContain('Teljes visszatérítés megtörtént')

    await act(async () => {
      refreshed.resolve(undefined)
    })
    expect(container.querySelector('[role="status"]')?.textContent).toBe(confirmed)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).not.toContain('másik rendelés megnyitása')
    expect(container.textContent).toContain(
      'A rendelésen már teljes visszatérítés van rögzítve. Itt új visszatérítés nem indítható.',
    )
    expect(container.textContent).not.toContain('Ez a rendelés már vissza lett térítve.')
    await act(async () => {
      callback()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await render(order())
    expect(button().disabled).toBe(true)
    await act(async () => {
      callback()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('checks latest same-order eligibility before allowing a saved callback to submit', async () => {
    const callback = ui.click!
    await render(order(ORDER_A, 'refunded'))
    await act(async () => {
      callback()
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(confirmMock).not.toHaveBeenCalled()
  })

  it('blocks two callbacks synchronously before React commits disabled state', async () => {
    const reply = deferred<Response>()
    fetchMock.mockReturnValue(reply.promise)
    const callback = ui.click!
    await act(async () => {
      callback()
      callback()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(button().disabled).toBe(true)
    await act(async () => {
      reply.resolve(Response.json(success()))
    })
  })

  it.each(['network', 'timeout'])(
    'latches after %s rejection, including a saved callback',
    async (kind) => {
      fetchMock.mockRejectedValue(
        kind === 'timeout'
          ? new DOMException('Synthetic timeout', 'TimeoutError')
          : new TypeError('Synthetic network failure'),
      )
      const callback = ui.click!
      await submit()
      expectReview()
      await act(async () => {
        callback()
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(ui.refresh).not.toHaveBeenCalled()
    },
  )

  it.each([500, 502, 503, 504])(
    'latches HTTP %i even without an additive manual-review field',
    async (status) => {
      fetchMock.mockResolvedValue(Response.json({ error: 'Próbáld újra.' }, { status }))
      const callback = ui.click!
      await submit()
      expectReview()
      expect(container.textContent).not.toContain('Próbáld újra.')
      await act(async () => {
        callback()
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it('preserves the explicit backend cleanup message and manual-review latch after status refresh', async () => {
    const error = 'A visszatérítés már rögzítve van. A hozzáférések rendezése nem igazolható.'
    fetchMock.mockResolvedValue(
      Response.json({ error, manualReviewRequired: true }, { status: 503 }),
    )
    const callback = ui.click!
    await submit()
    expect(container.textContent).toContain(error)
    await render(order(ORDER_A, 'refunded'))
    expectReview()
    expect(container.textContent).toContain(error)
    await act(async () => {
      callback()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('presents an unknown provider outcome as a warning, never a confirmed refund', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        success({ refundStatusOutcome: 'unknown', refundedTransactionStatus: 'Unknown' }),
      ),
    )
    const callback = ui.click!
    await submit()
    expectReview()
    expect(container.textContent).toContain('Barion nem igazolta')
    await render(order(ORDER_A, 'refunded'))
    expectReview()
    expect(container.textContent).toContain(
      'A rendelésen már teljes visszatérítés van rögzítve. Itt új visszatérítés nem indítható.',
    )
    expect(container.textContent).not.toContain('Ez a rendelés már vissza lett térítve.')
    expect(container.querySelector('button')).toBeNull()
    await act(async () => {
      callback()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await render(order())
    expectReview()
    await act(async () => {
      callback()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not confirm a valid 2xx success body that explicitly requires manual review', async () => {
    fetchMock.mockResolvedValue(Response.json(success({ manualReviewRequired: true })))
    const callback = ui.click!
    await submit()
    expectReview()
    expect(ui.refresh).not.toHaveBeenCalled()
    await act(async () => {
      callback()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['null', null],
    ['empty object', {}],
    ['wrong order', success({ orderNumber: ORDER_B })],
    ['missing outcome', success({ refundStatusOutcome: undefined })],
    ['unexpected outcome', success({ refundStatusOutcome: 'failed' })],
    ['missing transaction', success({ transactionId: '' })],
    ['missing provider status', success({ refundedTransactionStatus: undefined })],
    ['invalid amount', success({ amountHuf: -1 })],
    ['missing prior amount', success({ alreadyRefundedHuf: undefined })],
    ['missing total', success({ totalRefundedHuf: undefined })],
    ['invalid type', success({ type: 'other' })],
    ['inconsistent status', success({ orderStatus: 'paid' })],
  ])('latches a malformed 2xx outcome: %s', async (_name, body) => {
    fetchMock.mockResolvedValue(Response.json(body))
    const callback = ui.click!
    await submit()
    expectReview()
    await act(async () => {
      callback()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not call malformed JSON a successful refund', async () => {
    fetchMock.mockResolvedValue(new Response('{', { status: 200 }))
    await submit()
    expectReview()
  })

  it.each([400, 401, 403, 409])(
    'keeps ordinary HTTP %i errors and allows retry',
    async (status) => {
      fetchMock.mockResolvedValue(
        Response.json({ error: 'Ellenőrizd a megadott összeget.' }, { status }),
      )
      await submit()
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        'Ellenőrizd a megadott összeget.',
      )
      expect(button().disabled).toBe(false)
      expect(container.querySelector('[role="status"]')).toBeNull()
      await submit()
      expect(fetchMock).toHaveBeenCalledTimes(2)
    },
  )

  it('does not latch a cancelled confirmation', async () => {
    confirmMock.mockReturnValue(false)
    await submit()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(button().disabled).toBe(false)
  })

  it('keeps the staff restriction', async () => {
    ui.user = { id: 2, role: 'staff' }
    await render()
    expect(container.textContent).toContain('csak a tulajdonos')
    expect(container.querySelector('button')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not apply a late failure to another order or unlock either pending order', async () => {
    const first = deferred<Response>()
    const second = deferred<Response>()
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const oldCallback = ui.click!
    await submit()
    await render(order(ORDER_B))
    expect(button().disabled).toBe(false)
    await submit()
    await act(async () => {
      first.resolve(Response.json({ error: 'old failure' }, { status: 503 }))
    })
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(button().disabled).toBe(true)
    await render(order(ORDER_A))
    expectReview()
    await act(async () => {
      oldCallback()
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => {
      second.resolve(Response.json(success({ orderNumber: ORDER_B })))
    })
    expectReview()
  })

  it('does not unlock a late partial result after navigating away and back', async () => {
    const reply = deferred<Response>()
    fetchMock.mockReturnValue(reply.promise)
    const callback = ui.click!
    await submit()
    await render(order(ORDER_B))
    await render(order(ORDER_A))
    await act(async () => {
      reply.resolve(
        Response.json(
          success({
            type: 'partial',
            amountHuf: 5000,
            totalRefundedHuf: 5000,
            orderStatus: 'paid',
            refundedTransactionStatus: 'PartiallyRefunded',
          }),
        ),
      )
    })
    expect(button().disabled).toBe(true)
    expect(ui.refresh).not.toHaveBeenCalled()
    await act(async () => {
      callback()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(['throw', 'reject'])(
    'preserves known success when cache refresh fails: %s',
    async (kind) => {
      fetchMock.mockResolvedValue(Response.json(success()))
      ui.refresh.mockImplementation(() => {
        if (kind === 'throw') throw new Error('Synthetic cache failure')
        return Promise.reject(new Error('Synthetic cache failure'))
      })
      const callback = ui.click!
      await submit()
      expect(container.querySelector('[role="status"]')?.textContent).toContain(
        'Teljes visszatérítés megtörtént',
      )
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('frissítése')
      expect(container.textContent).not.toContain('Nem sikerült elérni a szervert')
      expect(button().disabled).toBe(true)
      await act(async () => {
        callback()
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )
})

describe('RefundPanel saved operational summary', () => {
  function summary() {
    const element = container.querySelector('dl[aria-label="Mentett visszatérítési állapotok"]')
    if (!element) throw new Error('Expected the owner-only saved operational summary')
    return element
  }

  function savedOrder() {
    return {
      ...order(ORDER_A, 'refunded'),
      stornoStatus: 'none',
      correctiveInvoiceStatus: 'failed',
      refunds: [
        {
          transactionId: 'SYNTHETIC-ENTRY',
          amountHuf: 20000,
          type: 'full',
          refundedAt: '2026-09-04T00:00:00.000Z',
          status: 'Unknown',
        },
      ],
    }
  }

  it('renders five semantic label/value pairs from saved data without requests', async () => {
    await render(savedOrder())
    expect(summary().querySelectorAll('dt')).toHaveLength(5)
    expect(summary().querySelectorAll('dd')).toHaveLength(5)
    expect(summary().getAttribute('aria-live')).toBe('polite')
    expect(summary().textContent).toContain('Teljes visszatérítés van helyben rögzítve')
    expect(summary().textContent).toContain('ellenőrzés szükséges')
    expect(summary().textContent).toContain('legutóbbi helyesbítő sikertelen')
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ui.refresh).not.toHaveBeenCalled()
  })

  it('reconstructs the summary after a real React unmount/remount from document data', async () => {
    await render(savedOrder())
    const before = summary().innerHTML
    await act(async () => {
      root.unmount()
    })
    const { createRoot } = await import('react-dom/client')
    root = createRoot(container)
    await render()
    expect(summary().innerHTML).toBe(before)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ui.refresh).not.toHaveBeenCalled()
  })

  it('keeps cleanup explicitly unverified after all saved successes and remount', async () => {
    const data = savedOrder()
    await render({
      ...data,
      stornoStatus: 'storned',
      correctiveInvoiceStatus: 'issued',
      refunds: data.refunds.map((entry) => ({ ...entry, status: 'Refunded' })),
    })
    function expectSavedSuccessesWithUnknownCleanup() {
      const rows = Object.fromEntries(
        Array.from(summary().querySelectorAll('dt')).map((label) => [
          label.textContent,
          label.nextElementSibling?.textContent,
        ]),
      )
      expect(rows['Helyi visszatérítési nyom']).toBe('Teljes visszatérítés van helyben rögzítve.')
      expect(rows['Mentett szolgáltatói eredmény']).toBe(
        'A megjeleníthető bejegyzésekben sikeres eredmény van mentve.',
      )
      expect(rows['Stornó mentett állapota']).toBe('Kiállított stornó van rögzítve.')
      expect(rows['Legutóbbi helyesbítő mentett állapota']).toBe(
        'A legutóbbi helyesbítő kiállítása van rögzítve; a korábbiak állapota ebből nem állapítható meg.',
      )
      expect(rows['Hozzáférések rendezése']).toBe('A mentett rendelésadatokból nem igazolható.')
      expect(container.querySelector('[role="status"]')).toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
      expect(ui.refresh).not.toHaveBeenCalled()
    }
    expectSavedSuccessesWithUnknownCleanup()
    await act(async () => {
      root.unmount()
    })
    const { createRoot } = await import('react-dom/client')
    root = createRoot(container)
    await render()
    expectSavedSuccessesWithUnknownCleanup()
  })

  it('replaces saved summary data on order navigation without latching a new action', async () => {
    await render(savedOrder())
    await render({
      ...order(ORDER_B),
      refunds: [],
      stornoStatus: null,
      correctiveInvoiceStatus: null,
    })
    expect(summary().textContent).toContain('a pénzmozgás ebből nem állapítható meg')
    expect(summary().textContent).not.toContain('Teljes visszatérítés van helyben rögzítve')
    expect(button().disabled).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not expose any supplied private values in the summary', async () => {
    const canary = 'SYNTHETIC-SUMMARY-PRIVACY-CANARY'
    await render({
      ...savedOrder(),
      id: canary,
      refundReason: canary,
      customerSnapshot: { name: canary, email: canary },
      stornoStatus: canary,
      stornoNumber: canary,
      stornoLastError: canary,
      correctiveInvoiceStatus: canary,
      correctiveInvoiceNumber: canary,
      correctiveInvoiceLastError: canary,
      refunds: [
        {
          transactionId: canary,
          amountHuf: 987654321,
          reason: canary,
          type: 'full',
          refundedAt: canary,
          status: canary,
        },
      ],
    })
    expect(summary().outerHTML).not.toContain(canary)
    expect(summary().outerHTML).not.toContain('987654321')
    expect(summary().textContent).toContain('nem értelmezhető')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['staff', 'customer'])('does not reveal a summary to %s', async (role) => {
    ui.user = { id: 2, role }
    await render(savedOrder())
    expect(container.querySelector('dl')).toBeNull()
    expect(container.textContent).not.toContain('Mentett szolgáltatói')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
