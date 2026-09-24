import { Window } from 'happy-dom'
import { act, createElement, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderToStaticMarkup } from 'react-dom/server'

import { REFUND_CONFIRM_MODAL_SLUG, RefundPanel } from '../components/admin/RefundPanel'
import { ensureRefundOperation, readRefundOperation } from '../components/admin/refund-operation'
import { REFUND_REVIEW_GUIDANCE } from '../components/admin/refund-response'
import { REFUND_RECOVERY_ACTION_LABEL } from '../lib/refund/recovery-action-label'

interface ModalProps {
  heading: ReactNode
  body: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  modalSlug: string
  onConfirm: () => Promise<void> | void
  onCancel?: () => void
}

const ui = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  user: { id: 1, role: 'owner' },
  initializing: false,
  refresh: vi.fn<() => void | Promise<void>>(),
  click: undefined as (() => void) | undefined,
  modal: undefined as ModalProps | undefined,
  closeModal: vi.fn<(slug: string) => void>(),
  // A megerősítő ablak (ConfirmationModal) felhasználói döntését a
  // confirmMock adja, ugyanúgy, ahogy korábban a window.confirm-ét.
  decide: undefined as (() => boolean) | undefined,
}))

vi.mock('@payloadcms/ui', () => ({
  useDocumentInfo: () => ({ data: ui.data, isInitializing: ui.initializing }),
  useAuth: () => ({ user: ui.user }),
  useRouteCache: () => ({ clearRouteCache: ui.refresh }),
  useModal: () => ({
    closeModal: ui.closeModal,
    isModalOpen: () => false,
    openModal: () => {
      const modal = ui.modal
      if (!modal) throw new Error('Expected a mounted ConfirmationModal')
      const decide = ui.decide
      // decide nélkül az ablak nyitva marad (a döntést a teszt később hozza).
      if (!decide) return
      if (decide()) void modal.onConfirm()
      else modal.onCancel?.()
    },
  }),
  ConfirmationModal: (props: ModalProps) => {
    ui.modal = props
    return null
  },
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
const statusFetchMock = vi.fn<typeof fetch>()
const transportMock = vi.fn<typeof fetch>()
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

function monetaryButton() {
  return Array.from(container.querySelectorAll('button')).find(
    (element) =>
      element.textContent?.startsWith('Visszatérítés indítása') ||
      element.textContent?.startsWith('Visszatérítés folyamatban'),
  )
}

function button() {
  const element = monetaryButton()
  if (!element) throw new Error('Expected the refund submit button')
  return element
}

async function submit() {
  await act(async () => {
    button().click()
  })
}

/** A sikeres visszatérítés üzenete (role="status", egyedi jelöléssel). */
function successMessage() {
  return container.querySelector('[data-kc-uzenet="siker"]')
}

/**
 * Kézi ellenőrzést kérő állapot („Ellenőrzés szükséges” doboz). A tartós
 * (betöltéskor is látható) állapot role="status", a gombnyomás eredménye
 * role="alert" (WCAG 2.2 SC 4.1.3); az őr mindkettőt elfogadja, a szerep külön
 * esetekben rögzített. A doboz szövege a szerveré, ha van (az önmagában
 * teljes, a panel nem fűz hozzá általános útmutatót); a kliens saját,
 * bizonytalan kimenetű szövegei az általános útmutatót hordozzák.
 */
function reviewNotices() {
  return Array.from(
    container.querySelectorAll(
      '[data-kc-uzenet="ellenorzes"][role="alert"], [data-kc-uzenet="ellenorzes"][role="status"]',
    ),
  )
}

function expectReview() {
  expect(reviewNotices().length).toBeGreaterThan(0)
  expect(successMessage()).toBeNull()
  expect(container.textContent).not.toContain('visszatérítés megtörtént')
  const submitButton = monetaryButton()
  if (submitButton) expect(submitButton.disabled).toBe(true)
}

beforeEach(async () => {
  ui.data = order()
  ui.user = { id: 1, role: 'owner' }
  ui.initializing = false
  ui.refresh.mockReset()
  ui.click = undefined
  ui.modal = undefined
  ui.closeModal.mockReset()
  ui.decide = () => confirmMock()
  fetchMock.mockReset().mockImplementation(async () => {
    throw new Error('Unexpected unconfigured request in refund UI test')
  })
  statusFetchMock.mockReset().mockImplementation(async (url, options) =>
    Response.json({
      orderNumber: decodeURIComponent(String(url).split('/').at(-2)!),
      state: 'clear',
      message: 'Nincs rendezetlen feldolgozás.',
      ...(new Headers(options?.headers).has('X-Refund-Operation-Key')
        ? { operationState: 'unseen' }
        : {}),
    }),
  )
  transportMock.mockReset().mockImplementation((url, options) => {
    if (options?.method === 'GET') return statusFetchMock(url, options)
    if (options?.method === 'POST') return fetchMock(url, options)
    throw new Error('Unexpected transport method')
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
  vi.stubGlobal('fetch', transportMock)
  confirmMock.mockReset().mockReturnValue(true)
  // A böngésző natív confirm-je már nem része a folyamatnak: ha mégis
  // meghívná valami, a teszt hangosan bukjon.
  Object.defineProperty(window, 'confirm', {
    value: () => {
      throw new Error('window.confirm must not be used by the refund panel')
    },
  })
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
        body: expect.any(String),
      }),
    )
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({
      operationKey: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    })
    expect(successMessage()?.textContent).toContain('Teljes visszatérítés megtörtént')
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
    expect(successMessage()?.textContent).toContain('Részleges visszatérítés megtörtént')
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
    const confirmed = successMessage()?.textContent
    expect(confirmed).toContain('Teljes visszatérítés megtörtént')

    await act(async () => {
      refreshed.resolve(undefined)
    })
    expect(successMessage()?.textContent).toBe(confirmed)
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
    expect(monetaryButton()).toBeUndefined()
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
      expect(successMessage()).toBeNull()
      await submit()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const first = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as {
        operationKey: string
      }
      const second = JSON.parse(String(fetchMock.mock.calls[1]![1]!.body)) as {
        operationKey: string
      }
      expect(second.operationKey).toBe(first.operationKey)
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
    const currentOrderAlerts = Array.from(container.querySelectorAll('[role="alert"]')).map(
      (element) => element.textContent,
    )
    const currentOperation = readRefundOperation(ORDER_B)
    await act(async () => {
      first.resolve(Response.json({ error: 'old failure' }, { status: 503 }))
    })
    expect(
      Array.from(container.querySelectorAll('[role="alert"]')).map(
        (element) => element.textContent,
      ),
    ).toEqual(currentOrderAlerts)
    expect(container.textContent).not.toContain('old failure')
    expect(readRefundOperation(ORDER_B)).toEqual(currentOperation)
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
      expect(successMessage()?.textContent).toContain('Teljes visszatérítés megtörtént')
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

describe('RefundPanel persisted recovery status', () => {
  async function remount() {
    await act(async () => {
      root.unmount()
    })
    const { createRoot } = await import('react-dom/client')
    root = createRoot(container)
    await render()
  }

  function savedStatus(state: string, orderNumber = ORDER_A) {
    return Response.json({ orderNumber, state, message: 'Mentett feldolgozási állapot.' })
  }

  function recoveryButton() {
    const element = Array.from(container.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('Feldolgozás folytatása'),
    )
    if (!element) throw new Error('Expected recovery button')
    return element
  }

  function acknowledgementButton() {
    return Array.from(container.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('Korábbi művelet nyugtázása'),
    )
  }

  function retryPreparationButton() {
    return Array.from(container.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('Korábbi művelet újrapróbálása'),
    )
  }

  it('remounts while the original POST is still preclaim and never replaces its key on unseen retry', async () => {
    const original = deferred<Response>()
    fetchMock
      .mockReturnValueOnce(original.promise)
      .mockRejectedValueOnce(new TypeError('Synthetic retry still pending'))
    await submit()
    const stored = readRefundOperation(ORDER_A)!
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await remount()
    expect(acknowledgementButton()).toBeUndefined()
    expect(readRefundOperation(ORDER_A)).toEqual(stored)
    await act(async () => {
      retryPreparationButton()!.click()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(readRefundOperation(ORDER_A)).toEqual(stored)
    await submit()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const sent = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]!.body)))
    expect(sent).toEqual([{ operationKey: stored.key }, { operationKey: stored.key }])
    expect(readRefundOperation(ORDER_A)).toEqual(stored)
    await act(async () => {
      original.resolve(Response.json(success()))
    })
  })

  it.each([null, 5000])(
    'unseen before claim survives reload and prepares only the identical key and amount: %j',
    async (amountHuf) => {
      // A sent request may still be awaiting GetState and has not claimed its durable intent.
      const stored = ensureRefundOperation(ORDER_A, amountHuf)
      statusFetchMock.mockImplementation(async () =>
        Response.json({
          orderNumber: ORDER_A,
          state: 'clear',
          operationState: 'unseen',
          message: 'Még nincs tartós nyom.',
        }),
      )
      await remount()
      expect(acknowledgementButton()).toBeUndefined()
      expect(button().disabled).toBe(true)
      const fresh = deferred<Response>()
      statusFetchMock.mockReturnValueOnce(fresh.promise)
      await act(async () => {
        retryPreparationButton()!.click()
      })
      expect(button().disabled).toBe(true)
      expect(readRefundOperation(ORDER_A)).toEqual(stored)
      expect(fetchMock).not.toHaveBeenCalled()
      await act(async () => {
        fresh.resolve(
          Response.json({
            orderNumber: ORDER_A,
            state: 'clear',
            operationState: 'unseen',
            message: 'Még nincs tartós nyom.',
          }),
        )
      })
      expect(readRefundOperation(ORDER_A)).toEqual(stored)
      expect(button().disabled).toBe(false)
      const input = container.querySelector('input') as HTMLInputElement
      expect(input.value).toBe(amountHuf === null ? '' : String(amountHuf))
      expect(input.disabled).toBe(true)
      expect(fetchMock).not.toHaveBeenCalled()
      fetchMock.mockRejectedValue(new TypeError('Synthetic original request still in flight'))
      await submit()
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        `/api/admin/orders/${ORDER_A}/refund`,
        expect.objectContaining({
          body: JSON.stringify({
            ...(amountHuf === null ? {} : { amountHuf }),
            operationKey: stored.key,
          }),
        }),
      )
      expect(readRefundOperation(ORDER_A)).toEqual(stored)
      expect(acknowledgementButton()).toBeUndefined()
    },
  )

  it.each(['pending', 'completed', 'no_effect', 'invalid'])(
    'fresh %s cannot unlock an unseen retry or clear its key',
    async (operationState) => {
      const stored = ensureRefundOperation(ORDER_A, 5000)
      statusFetchMock.mockImplementation(async () =>
        Response.json({
          orderNumber: ORDER_A,
          state: 'clear',
          operationState: 'unseen',
          message: 'Még nincs tartós nyom.',
        }),
      )
      await remount()
      statusFetchMock.mockImplementation(async () =>
        Response.json({
          orderNumber: ORDER_A,
          state: 'clear',
          operationState,
          message: 'Friss mentett állapot.',
        }),
      )
      await act(async () => {
        retryPreparationButton()!.click()
      })
      expect(button().disabled).toBe(true)
      expect(readRefundOperation(ORDER_A)).toEqual(stored)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it.each(['completed'])(
    'reloads keyed %s but clears nothing and sends no POST before explicit acknowledged refresh',
    async (operationState) => {
      const stored = ensureRefundOperation(ORDER_A, 5000)
      statusFetchMock.mockImplementation(async (url, options) =>
        Response.json({
          orderNumber: ORDER_A,
          state: 'clear',
          message: 'Mentett eredmény.',
          ...(new Headers(options?.headers).has('X-Refund-Operation-Key')
            ? { operationState }
            : {}),
        }),
      )
      await remount()
      expect(button().disabled).toBe(true)
      expect(readRefundOperation(ORDER_A)).toEqual(stored)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(successMessage()).toBeNull()
      expect(container.textContent).not.toContain('visszatérítés megtörtént')
      expect(statusFetchMock.mock.calls.at(-1)![0]).not.toContain(stored.key)
      expect(
        new Headers(statusFetchMock.mock.calls.at(-1)![1]!.headers).get('X-Refund-Operation-Key'),
      ).toBe(stored.key)
      const refresh = deferred<void>()
      ui.refresh.mockReturnValue(refresh.promise)
      await act(async () => {
        acknowledgementButton()!.click()
      })
      expect(button().disabled).toBe(true)
      expect(readRefundOperation(ORDER_A)).toEqual(stored)
      expect(fetchMock).not.toHaveBeenCalled()
      await act(async () => {
        refresh.resolve(undefined)
      })
      expect(readRefundOperation(ORDER_A)).toBeNull()
      expect(button().disabled).toBe(false)
      expect((container.querySelector('input') as HTMLInputElement).value).toBe('')
      expect(
        new Headers(statusFetchMock.mock.calls.at(-1)![1]!.headers).has('X-Refund-Operation-Key'),
      ).toBe(false)
      fetchMock.mockResolvedValue(Response.json(success()))
      await submit()
      const next = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as { operationKey: string }
      expect(next.operationKey).not.toBe(stored.key)
    },
  )

  it('az igazoltan hatástalan (no_effect) korábbi műveletet nyugtázás nélkül törli, és új kulccsal enged tovább', async () => {
    const stored = ensureRefundOperation(ORDER_A, 5000)
    statusFetchMock.mockImplementation(async (url, options) =>
      Response.json({
        orderNumber: ORDER_A,
        state: 'clear',
        message: 'Mentett eredmény.',
        ...(new Headers(options?.headers).has('X-Refund-Operation-Key')
          ? { operationState: 'no_effect' }
          : {}),
      }),
    )
    await remount()
    expect(readRefundOperation(ORDER_A)).toBeNull()
    expect(acknowledgementButton()).toBeUndefined()
    expect(button().disabled).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(successMessage()).toBeNull()
    expect(
      new Headers(statusFetchMock.mock.calls.at(-1)![1]!.headers).get('X-Refund-Operation-Key'),
    ).toBe(stored.key)
    fetchMock.mockResolvedValue(Response.json(success()))
    await submit()
    const next = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as { operationKey: string }
    expect(next.operationKey).not.toBe(stored.key)
  })

  it('a Barion végleges elutasítása (4xx, no_effect) után nyugtázás nélkül újrapróbálható, az ok látható marad', async () => {
    const error =
      'A Barion elutasította a visszatérítést, mert a Barion-tárcádban nincs elég egyenleg. Pénzmozgás nem történt.'
    fetchMock.mockResolvedValueOnce(Response.json({ error }, { status: 409 }))
    statusFetchMock.mockImplementation(async (url, options) =>
      Response.json({
        orderNumber: ORDER_A,
        state: 'clear',
        message: 'Mentett eredmény.',
        ...(new Headers(options?.headers).has('X-Refund-Operation-Key')
          ? { operationState: 'no_effect' }
          : {}),
      }),
    )
    await submit()
    const first = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as { operationKey: string }
    expect(container.textContent).toContain(error)
    expect(readRefundOperation(ORDER_A)).toBeNull()
    expect(acknowledgementButton()).toBeUndefined()
    expect(button().disabled).toBe(false)
    fetchMock.mockResolvedValueOnce(Response.json(success()))
    await submit()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const second = JSON.parse(String(fetchMock.mock.calls[1]![1]!.body)) as {
      operationKey: string
    }
    expect(second.operationKey).not.toBe(first.operationKey)
  })

  it.each([
    { operationState: 'pending' },
    {},
    { operationState: 'invalid' },
    { operationState: null },
    { operationState: 'completed', orderNumber: ORDER_B },
    { operationState: 'completed', state: 'manual_review' },
    { operationState: 'unseen', state: 'recoverable' },
    // Hatástalan kísérlet, de a rendelés nem rendezett: a kulcs nem törlődhet magától.
    { operationState: 'no_effect', state: 'manual_review' },
    { operationState: 'no_effect', state: 'recoverable' },
  ])(
    'keeps a reloaded key locked for unconfirmed or globally blocked outcome: %j',
    async (overrides) => {
      const stored = ensureRefundOperation(ORDER_A, null)
      statusFetchMock.mockImplementation(async () =>
        Response.json({
          orderNumber: ORDER_A,
          state: 'clear',
          message: 'Mentett állapot.',
          ...overrides,
        }),
      )
      await remount()
      expect(button().disabled).toBe(true)
      expect(acknowledgementButton()).toBeUndefined()
      expect(readRefundOperation(ORDER_A)).toEqual(stored)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('preserves the uncertain key across remount after a committed response was lost', async () => {
    fetchMock.mockRejectedValue(new TypeError('Synthetic lost success response'))
    statusFetchMock.mockImplementation(async (_url, options) =>
      Response.json({
        orderNumber: ORDER_A,
        state: 'clear',
        message: 'Mentett állapot.',
        ...(new Headers(options?.headers).has('X-Refund-Operation-Key')
          ? { operationState: 'completed' }
          : {}),
      }),
    )
    await submit()
    const stored = readRefundOperation(ORDER_A)
    expect(stored).not.toBeNull()
    await remount()
    expect(readRefundOperation(ORDER_A)).toEqual(stored)
    expect(button().disabled).toBe(true)
    expect(acknowledgementButton()).toBeDefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('A korábbi művelet feldolgozása lezárult.')
    expect(successMessage()).toBeNull()
  })

  it('retains a terminal key when acknowledgement cannot refresh the document', async () => {
    const stored = ensureRefundOperation(ORDER_A, null)
    statusFetchMock.mockImplementation(async () =>
      Response.json({
        orderNumber: ORDER_A,
        state: 'clear',
        operationState: 'completed',
        message: 'Mentett állapot.',
      }),
    )
    await remount()
    ui.refresh.mockRejectedValue(new Error('Synthetic refresh failure'))
    await act(async () => {
      acknowledgementButton()!.click()
    })
    expect(readRefundOperation(ORDER_A)).toEqual(stored)
    expect(button().disabled).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cannot POST when the operation key cannot be persisted', async () => {
    vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('Synthetic storage failure')
    })
    await submit()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(button().disabled).toBe(true)
  })

  it('waits for persisted GET before permitting money movement, with credentials, no-store and abort', async () => {
    const reply = deferred<Response>()
    statusFetchMock.mockReturnValue(reply.promise)
    await remount()
    expect(button().disabled).toBe(true)
    const callback = ui.click!
    await act(async () => {
      callback()
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(confirmMock).not.toHaveBeenCalled()
    expect(statusFetchMock).toHaveBeenLastCalledWith(
      `/api/admin/orders/${ORDER_A}/refund`,
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }),
    )
    await act(async () => {
      reply.resolve(savedStatus('clear'))
    })
    expect(button().disabled).toBe(false)
    expect(successMessage()).toBeNull()
    const reads = statusFetchMock.mock.calls.length
    await render()
    await render()
    expect(statusFetchMock).toHaveBeenCalledTimes(reads)
  })

  it('keeps the mounted operation guard while its initial status and lock display are pending', async () => {
    const stored = ensureRefundOperation(ORDER_A, 5000)
    const reply = deferred<Response>()
    statusFetchMock.mockReturnValueOnce(reply.promise)
    await remount()
    expect(button().disabled).toBe(true)
    const callback = ui.click!
    await act(async () => {
      callback()
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(confirmMock).not.toHaveBeenCalled()
    await act(async () => {
      reply.resolve(
        Response.json({
          orderNumber: ORDER_A,
          state: 'clear',
          operationState: 'unseen',
          message: 'Még nincs tartós nyom.',
        }),
      )
    })
    expect(button().disabled).toBe(true)
    expect(retryPreparationButton()).toBeDefined()
    expect(acknowledgementButton()).toBeUndefined()
    expect(readRefundOperation(ORDER_A)).toEqual(stored)
    await act(async () => {
      callback()
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(confirmMock).not.toHaveBeenCalled()
  })

  it.each([
    null,
    {},
    [],
    { orderNumber: ORDER_A, state: 'clear' },
    { orderNumber: ORDER_B, state: 'clear', message: 'Wrong order' },
    { orderNumber: ORDER_A, state: 'completed', message: 'Not a status state' },
    { orderNumber: ORDER_A, state: 'clear', message: '' },
    { orderNumber: ORDER_A, state: 'clear', message: 'Conflict', manualReviewRequired: true },
  ])('fails closed on malformed persisted status: %j', async (body) => {
    statusFetchMock.mockImplementation(async () => Response.json(body))
    await remount()
    expectReview()
    await submit()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['http', 'json', 'network', 'timeout'])(
    'fails closed on GET %s failure',
    async (kind) => {
      statusFetchMock.mockImplementation(async () => {
        if (kind === 'http')
          return Response.json(
            { orderNumber: ORDER_A, state: 'clear', message: 'Invalid HTTP' },
            { status: 503 },
          )
        if (kind === 'json') return new Response('{')
        if (kind === 'timeout') throw new DOMException('Synthetic timeout', 'TimeoutError')
        throw new TypeError('Synthetic network failure')
      })
      await remount()
      expectReview()
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('reconstructs manual-review lock across true reload and never announces GET success', async () => {
    statusFetchMock.mockImplementation(async () => savedStatus('manual_review'))
    await remount()
    expectReview()
    await remount()
    expectReview()
    expect(container.textContent).toContain('Mentett feldolgozási állapot.')
    expect(container.textContent).not.toContain('Feldolgozás folytatása')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps recovery separate from monetary refund even for a refunded document', async () => {
    statusFetchMock.mockImplementation(async () => savedStatus('recoverable'))
    ui.data = order(ORDER_A, 'refunded')
    await remount()
    expect(container.textContent).toContain('A pénzvisszatérítést nem indítja újra.')
    expect(container.textContent).not.toContain('Visszatérítés indítása')
    expect(recoveryButton().disabled).toBe(false)
    fetchMock.mockResolvedValue(
      Response.json({
        orderNumber: ORDER_A,
        recoveryStatus: 'completed',
        message: 'Synthetic completion',
      }),
    )
    statusFetchMock.mockImplementation(async () => savedStatus('clear'))
    const reads = statusFetchMock.mock.calls.length
    await act(async () => {
      recoveryButton().click()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/admin/orders/${ORDER_A}/refund`,
      expect.objectContaining({ method: 'POST', body: '{"action":"recover"}' }),
    )
    expect(confirmMock).not.toHaveBeenCalled()
    expect(statusFetchMock).toHaveBeenCalledTimes(reads + 1)
    // A szerver üzenete jelenik meg (pl. hogy a hatástalan kísérlet lezárult,
    // és indítható-e új visszatérítés), nem egy általános „rendezve”.
    expect(successMessage()?.textContent).toBe('Synthetic completion')
    expect(container.textContent).not.toContain('visszatérítés megtörtént')
    expect(ui.refresh).toHaveBeenCalledTimes(1)
  })

  it.each(['manual_review', 'wrong-order', 'malformed', 'network'])(
    'does not infer completed processing from recovery %s',
    async (kind) => {
      statusFetchMock.mockImplementation(async () => savedStatus('recoverable'))
      await remount()
      if (kind === 'network') fetchMock.mockRejectedValue(new TypeError('Synthetic failure'))
      else
        fetchMock.mockResolvedValue(
          Response.json(
            kind === 'malformed'
              ? {}
              : {
                  orderNumber: kind === 'wrong-order' ? ORDER_B : ORDER_A,
                  recoveryStatus: kind === 'manual_review' ? 'manual_review' : 'completed',
                  message: 'Kézi ellenőrzés szükséges.',
                },
          ),
        )
      statusFetchMock.mockImplementation(async () => savedStatus('manual_review'))
      await act(async () => {
        recoveryButton().click()
      })
      expectReview()
      expect(ui.refresh).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it('isolates late status from another order and from an earlier visit to the same order', async () => {
    const old = deferred<Response>()
    statusFetchMock.mockReturnValueOnce(old.promise)
    await remount()
    const oldSignal = statusFetchMock.mock.calls.at(-1)![1]!.signal!
    statusFetchMock.mockImplementation(async (url) =>
      savedStatus('manual_review', String(url).includes(ORDER_B) ? ORDER_B : ORDER_A),
    )
    await render(order(ORDER_B))
    expect(oldSignal.aborted).toBe(true)
    expectReview()
    await render(order(ORDER_A))
    expectReview()
    await act(async () => {
      old.resolve(savedStatus('clear'))
    })
    expectReview()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cannot re-enable an ambiguous refund through a later clear GET', async () => {
    fetchMock.mockRejectedValue(new TypeError('Synthetic lost acknowledgment'))
    const reads = statusFetchMock.mock.calls.length
    await submit()
    expect(statusFetchMock).toHaveBeenCalledTimes(reads + 1)
    expectReview()
    await submit()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('requires the post-outcome GET before allowing a new partial refund', async () => {
    const status = deferred<Response>()
    statusFetchMock.mockReturnValue(status.promise)
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
    expect(button().disabled).toBe(true)
    await act(async () => {
      status.resolve(savedStatus('manual_review'))
    })
    expect(button().disabled).toBe(true)
    await submit()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
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

  it('renders five semantic label/value pairs from saved data without mutation requests', async () => {
    await render(savedOrder())
    expect(summary().querySelectorAll('dt')).toHaveLength(5)
    expect(summary().querySelectorAll('dd')).toHaveLength(5)
    expect(summary().parentElement?.getAttribute('aria-live')).toBe('polite')
    expect(summary().textContent).toContain('Teljes visszatérítés van rögzítve a rendelésen')
    expect(summary().textContent).toContain('ellenőrizd a Barion felületén')
    expect(summary().textContent).toContain('legutóbbi helyesbítő sikertelen')
    expect(successMessage()).toBeNull()
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
      expect(rows['Visszatérítés a rendelésen']).toBe(
        'Teljes visszatérítés van rögzítve a rendelésen.',
      )
      expect(rows['Barion visszaigazolása']).toBe(
        'A Barion a mentett bejegyzésekben sikeres visszatérítést jelzett.',
      )
      expect(rows['Stornószámla']).toBe('Kiállított stornó van rögzítve.')
      expect(rows['Legutóbbi helyesbítő számla']).toBe(
        'A legutóbbi helyesbítő kiállítása van rögzítve; a korábbiak állapota ebből nem állapítható meg.',
      )
      expect(rows['Hozzáférések rendezése']).toBe('A mentett rendelésadatokból nem igazolható.')
      expect(successMessage()).toBeNull()
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
    // K12: mentett visszatérítés és számla-utóélet nélkül egyetlen mondat áll.
    expect(container.querySelector('dl')).toBeNull()
    expect(container.textContent).toContain('Ezen a rendelésen még nem volt visszatérítés.')
    expect(container.textContent).not.toContain('Teljes visszatérítés van rögzítve')
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
    expect(container.textContent).not.toContain('Barion visszaigazolása')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('RefundPanel K12: hozzáférhető név, élő régiók, megerősítés', () => {
  async function remountWith(statusBody: Record<string, unknown>) {
    statusFetchMock.mockImplementation(async () =>
      Response.json({ orderNumber: ORDER_A, message: 'Mentett állapot.', ...statusBody }),
    )
    await act(async () => {
      root.unmount()
    })
    const { createRoot } = await import('react-dom/client')
    root = createRoot(container)
    await render()
  }

  it('a mező neve a látható címke, a súgó a mezőhöz kötött, placeholder és aria-label nincs', () => {
    const input = container.querySelector('input') as HTMLInputElement
    const label = container.querySelector(`label[for="${input.id}"]`)
    expect(label?.textContent).toBe('Visszatérítendő összeg (Ft)')
    expect(input.hasAttribute('aria-label')).toBe(false)
    expect(input.hasAttribute('placeholder')).toBe(false)
    expect(input.className).toBe('kc-admin-input')
    const hint = document.getElementById(input.getAttribute('aria-describedby')!.split(' ')[0]!)
    expect(hint?.textContent).toBe('Ha üresen hagyod, a teljes összeg visszajár.')
    expect(container.textContent).not.toMatch(/[–—]/)
  })

  it('mentett visszatérítés nélkül egyetlen mondat áll az állapotlista helyett', () => {
    expect(container.querySelector('dl')).toBeNull()
    expect(container.textContent).toContain('Ezen a rendelésen még nem volt visszatérítés.')
  })

  it('betöltéskor a kézi ellenőrzést kérő mentett állapot role="status", nem alert', async () => {
    await remountWith({ state: 'manual_review' })
    expect(container.querySelector('[role="alert"]')).toBeNull()
    const notice = container.querySelector('[role="status"]')
    expect(notice?.textContent).toContain('Ellenőrzés szükséges')
    expect(notice?.textContent).toContain('Mentett állapot.')
  })

  it.each(['manual_review', 'recoverable'])(
    'a %s mentett állapot szövege a szerveré, általános útmutató nem kerül mellé',
    async (state) => {
      const message = `A „${REFUND_RECOVERY_ACTION_LABEL}” lekérdezi az eredményt a Barionból, új pénzvisszatérítést nem indít.`
      await remountWith({ state, message })
      const notice = container.querySelector('[data-kc-uzenet="ellenorzes"]')
      expect(notice?.textContent).toBe(`Ellenőrzés szükséges${message}`)
      expect(container.textContent).not.toContain(REFUND_REVIEW_GUIDANCE)
      expect(container.textContent).not.toContain('egyeztesd az eltérést')
    },
  )

  it('a helyreállító gomb felirata az, amire a szerver szövegei hivatkoznak', async () => {
    await remountWith({ state: 'recoverable' })
    const labels = Array.from(container.querySelectorAll('button')).map((item) => item.textContent)
    expect(labels).toContain(REFUND_RECOVERY_ACTION_LABEL)
  })

  it('a helyreállítás kézi ellenőrzést kérő válasza a szerver szövegével, útmutató nélkül jelenik meg', async () => {
    await remountWith({ state: 'recoverable' })
    const message =
      'A feldolgozás most nem fejeződött be, új pénzvisszatérítés nem indult. Frissítsd az oldalt.'
    fetchMock.mockResolvedValue(
      Response.json({ orderNumber: ORDER_A, recoveryStatus: 'manual_review', message }),
    )
    const recover = Array.from(container.querySelectorAll('button')).find(
      (item) => item.textContent === REFUND_RECOVERY_ACTION_LABEL,
    )!
    await act(async () => {
      recover.click()
    })
    const alert = container.querySelector('[data-kc-uzenet="ellenorzes"][role="alert"]')
    expect(alert?.textContent).toBe(`Ellenőrzés szükséges${message}`)
    expect(container.textContent).not.toContain(REFUND_REVIEW_GUIDANCE)
  })

  it('a szerver kézi ellenőrzést kérő 5xx szövege önmagában jelenik meg', async () => {
    const error = `A Barion nem adott értékelhető választ. Ne indíts új pénzvisszatérítést: a „${REFUND_RECOVERY_ACTION_LABEL}” gomb lekérdezi az eredményt a Barionból.`
    fetchMock.mockResolvedValue(
      Response.json({ error, manualReviewRequired: true }, { status: 503 }),
    )
    await submit()
    const alert = container.querySelector('[data-kc-uzenet="ellenorzes"][role="alert"]')
    expect(alert?.textContent).toBe(`Ellenőrzés szükséges${error}`)
  })

  it('betöltéskor a nem ellenőrizhető mentett állapot is role="status"', async () => {
    statusFetchMock.mockRejectedValue(new TypeError('Synthetic network failure'))
    await remountWith({})
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(reviewNotices().map((element) => element.getAttribute('role'))).toEqual(['status'])
  })

  it('a gombnyomás bizonytalan pénzügyi eredménye role="alert"', async () => {
    fetchMock.mockRejectedValue(new TypeError('Synthetic network failure'))
    await submit()
    expect(reviewNotices().some((element) => element.getAttribute('role') === 'alert')).toBe(true)
  })

  it('a megerősítő ablak konkrét következményt és visszavonhatatlansági mondatot mond', async () => {
    ui.decide = () => false
    await submit()
    const modal = ui.modal!
    expect(modal.modalSlug).toBe(REFUND_CONFIRM_MODAL_SLUG)
    expect(modal.confirmLabel).toBe('Visszatérítés indítása')
    expect(modal.cancelLabel).toBe('Mégse')
    const heading = renderToStaticMarkup(createElement('div', null, modal.heading))
    const body = renderToStaticMarkup(createElement('div', null, modal.body))
    expect(heading).toContain('Visszatéríted az összeget?')
    expect(body).toContain(`${ORDER_A} rendelés`)
    expect(body).toContain('<strong>A visszatérítés nem vonható vissza.</strong>')
    const text = `${heading}${body}`.replace(/<[^>]+>/g, ' ')
    expect(text).not.toMatch(/[–—"]|TELJES|Biztosan/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a másik rendelésre váltás elveti a nyitva hagyott megerősítést', async () => {
    ui.decide = undefined
    await submit()
    const staleConfirm = ui.modal!.onConfirm
    await render(order(ORDER_B))
    expect(ui.closeModal).toHaveBeenCalledWith(REFUND_CONFIRM_MODAL_SLUG)
    await act(async () => {
      await staleConfirm()
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(readRefundOperation(ORDER_A)).toBeNull()
    expect(readRefundOperation(ORDER_B)).toBeNull()
  })

  it('a jóváhagyás előtt beérkező tiltó állapot a pénzmozgást megállítja', async () => {
    ui.decide = undefined
    await submit()
    const heldConfirm = ui.modal!.onConfirm
    await render(order(ORDER_A, 'refunded'))
    await act(async () => {
      await heldConfirm()
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
