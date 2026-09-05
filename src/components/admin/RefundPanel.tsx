'use client'

import { Button, useAuth, useDocumentInfo, useRouteCache } from '@payloadcms/ui'
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

import { hasOwnerRole } from '../../access/roles'
import { formatPriceHuf } from '../../lib/format-price'
import { refundBlockedReason, refundConfirmQuestion, validateRefundAmount } from './refund-amount'
import { readRefundOperationalStatus } from './refund-operational-status'
import {
  clearRefundOperation,
  ensureRefundOperation,
  readRefundOperation,
  type RefundOperation,
} from './refund-operation'
import {
  parseRefundRecoveryResponse,
  parseRefundRecoveryStatus,
  type RefundRecoveryStatus,
} from './refund-recovery-response'
import {
  presentRefundResponse,
  REFUND_REVIEW_GUIDANCE,
  REFUND_UNCERTAIN_MESSAGE,
  type RefundPresentation,
} from './refund-response'

/**
 * Visszatérítés-panel a rendelés szerkesztőnézetében (orders `type: 'ui'` mező).
 * KIZÁRÓLAG felület: a visszatérítés teljes üzleti logikája a meglévő,
 * kész szolgáltatásban él (src/lib/refund/*), amelyet a panel a
 * POST /api/admin/orders/[orderNumber]/refund végponton hív. A komponens
 * semmilyen pénzügyi döntést nem hoz, és nem másol le szerver-oldali
 * szabályt — a kliensoldali ellenőrzések (paid státusz, pozitív egész összeg,
 */

const REQUEST_TIMEOUT_MS = 30_000

const REFRESH_WARNING = `A rendelés nézetének frissítése nem sikerült. A visszatérítés fenti eredménye változatlan. ${REFUND_REVIEW_GUIDANCE}`
const NAVIGATION_WARNING = `A válasz másik rendelés megnyitása után érkezett, ezért a nézet nem frissült. ${REFUND_REVIEW_GUIDANCE}`
const STATUS_WARNING = `A mentett feldolgozási állapot nem ellenőrizhető. ${REFUND_REVIEW_GUIDANCE}`
const OPERATION_WARNING = `Korábbi visszatérítési művelet nyugtázása szükséges. ${REFUND_REVIEW_GUIDANCE}`

interface OrderVisit {
  orderNumber: string | null
  status: RefundRecoveryStatus | null
  request: AbortController | null
  operation: RefundOperation | null
}

interface PanelState {
  amountInput: string
  pending: boolean
  locked: boolean
  errorMessage: string | null
  warningMessage: string | null
  successMessage: string | null
  recovery: RefundRecoveryStatus | null
  statusLoading: boolean
  statusError: boolean
  recovering: boolean
  operation: RefundOperation | null
}

const EMPTY_PANEL: PanelState = {
  amountInput: '',
  pending: false,
  locked: false,
  errorMessage: null,
  warningMessage: null,
  successMessage: null,
  recovery: null,
  statusLoading: true,
  statusError: false,
  recovering: false,
  operation: null,
}

interface OrderSummary {
  orderNumber: string | null
  status: string | null
  totalHuf: number | null
}

/** A dokumentum-adatok (típustalan Data) szűkítése a panel által használt mezőkre. */
function readOrderSummary(data: unknown): OrderSummary {
  if (typeof data !== 'object' || data === null) {
    return { orderNumber: null, status: null, totalHuf: null }
  }
  const record = data as Record<string, unknown>
  const total =
    typeof record.totalHufSnapshot === 'number'
      ? record.totalHufSnapshot
      : typeof record.amount === 'number'
        ? record.amount
        : null
  return {
    orderNumber: typeof record.orderNumber === 'string' ? record.orderNumber : null,
    status: typeof record.status === 'string' ? record.status : null,
    totalHuf: total,
  }
}

const panelStyle: CSSProperties = {
  border: '1px solid var(--theme-elevation-150)',
  borderRadius: '4px',
  marginBottom: 'var(--base)',
  padding: 'calc(var(--base) * 0.75)',
}

const noteStyle: CSSProperties = {
  color: 'var(--theme-elevation-650)',
  margin: 0,
}

export function RefundPanel() {
  const { data, isInitializing } = useDocumentInfo()
  const { user } = useAuth<{ id: number | string; role?: string | null }>()
  const { clearRouteCache } = useRouteCache()

  const order = readOrderSummary(data)
  const { orderNumber, totalHuf } = order
  const blockedReason = refundBlockedReason(order.status)
  const allowed = !isInitializing && !!orderNumber && hasOwnerRole(user) && !blockedReason
  const [panels, setPanels] = useState(() => new Map<string, PanelState>())
  const {
    amountInput,
    pending,
    locked,
    errorMessage,
    warningMessage,
    successMessage,
    recovery,
    statusLoading,
    statusError,
    recovering,
    operation,
  } = (orderNumber && panels.get(orderNumber)) || EMPTY_PANEL
  // This guard lasts only for this mounted panel, not across reloads or tabs.
  const lockedOrders = useRef(new Set<string>())
  const activeVisit = useRef<OrderVisit | null>(null)
  const latestAllowed = useRef(false)
  const busyOrders = useRef(new Set<string>())
  const owner = hasOwnerRole(user)

  const updatePanel = useCallback((key: string, patch: Partial<PanelState>) => {
    setPanels((previous) => {
      const next = new Map(previous)
      next.set(key, { ...(previous.get(key) ?? EMPTY_PANEL), ...patch })
      return next
    })
  }, [])

  const loadStatus = useCallback(
    async (visit: OrderVisit, initialState: Partial<PanelState> = {}) => {
      const key = visit.orderNumber
      if (!key || activeVisit.current !== visit) return
      visit.request?.abort()
      const controller = new AbortController()
      visit.request = controller
      visit.status = null
      updatePanel(key, { statusLoading: true, statusError: false, recovery: null })
      let status: RefundRecoveryStatus | null = null
      try {
        const stored = readRefundOperation(key)
        if (visit.operation && stored?.key !== visit.operation.key)
          throw new Error('Refund operation changed')
        visit.operation = stored
        updatePanel(key, { operation: stored })
        const response = await fetch(`/api/admin/orders/${encodeURIComponent(key)}/refund`, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          ...(stored ? { headers: { 'X-Refund-Operation-Key': stored.key } } : {}),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        })
        status = parseRefundRecoveryStatus(response.status, await response.json(), key, !!stored)
      } catch {
        status = null
      }
      if (
        activeVisit.current !== visit ||
        visit.request !== controller ||
        controller.signal.aborted
      )
        return
      visit.status = status
      updatePanel(key, {
        ...initialState,
        recovery: status,
        statusLoading: false,
        statusError: !status,
      })
    },
    [updatePanel],
  )

  useLayoutEffect(() => {
    const visit: OrderVisit = { orderNumber, status: null, request: null, operation: null }
    activeVisit.current = visit
    if (!isInitializing && owner && orderNumber) {
      const initialState: Partial<PanelState> = {}
      try {
        visit.operation = readRefundOperation(orderNumber)
        if (visit.operation) {
          lockedOrders.current.add(orderNumber)
          initialState.operation = visit.operation
          initialState.locked = true
        }
      } catch {
        lockedOrders.current.add(orderNumber)
        initialState.locked = true
        initialState.warningMessage = OPERATION_WARNING
      }
      // The guard is synchronous; only the status load and its presentation are scheduled.
      queueMicrotask(() => {
        if (activeVisit.current === visit) void loadStatus(visit, initialState)
      })
    }
    return () => {
      visit.request?.abort()
      activeVisit.current = null
    }
  }, [orderNumber, isInitializing, owner, loadStatus])

  useLayoutEffect(() => {
    latestAllowed.current = allowed
  }, [allowed])

  // Sima függvény (nem useCallback): a React Compiler maga memoizál, a kézi
  // memoizáció itt csak a `preserve-manual-memoization` szabályba ütközne, mert
  // a dependenciák egy helyben képzett objektumból (readOrderSummary) jönnek.
  const startRefund = async (): Promise<void> => {
    const visit = activeVisit.current
    if (
      !orderNumber ||
      visit?.orderNumber !== orderNumber ||
      !latestAllowed.current ||
      visit.status?.state !== 'clear' ||
      (visit.operation && visit.status.operationState !== 'unseen') ||
      busyOrders.current.has(orderNumber) ||
      lockedOrders.current.has(orderNumber)
    ) {
      return
    }
    const check = validateRefundAmount(amountInput, totalHuf)
    if (!check.ok) {
      updatePanel(orderNumber, { successMessage: null, errorMessage: check.message })
      return
    }
    if (!window.confirm(refundConfirmQuestion(orderNumber, check.amountHuf))) {
      return
    }

    let requestOperation: RefundOperation
    try {
      requestOperation = ensureRefundOperation(orderNumber, check.amountHuf)
      visit.operation = requestOperation
    } catch {
      lockedOrders.current.add(orderNumber)
      updatePanel(orderNumber, { locked: true, warningMessage: OPERATION_WARNING })
      return
    }

    lockedOrders.current.add(orderNumber)
    busyOrders.current.add(orderNumber)
    visit.request?.abort()
    visit.status = null
    updatePanel(orderNumber, {
      pending: true,
      locked: true,
      errorMessage: null,
      warningMessage: null,
      successMessage: null,
      operation: requestOperation,
    })
    const isCurrentVisit = () => activeVisit.current === visit
    let result: RefundPresentation
    try {
      const response = await fetch(`/api/admin/orders/${encodeURIComponent(orderNumber)}/refund`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(check.amountHuf === null ? {} : { amountHuf: check.amountHuf }),
          operationKey: requestOperation.key,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      let body: unknown = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      result = presentRefundResponse(response.status, body, orderNumber)
    } catch {
      result = { kind: 'warning', message: REFUND_UNCERTAIN_MESSAGE }
    }
    busyOrders.current.delete(orderNumber)
    let operationCleared = false
    if (result.kind === 'success') {
      try {
        clearRefundOperation(orderNumber, requestOperation.key)
        visit.operation = null
        updatePanel(orderNumber, { operation: null })
        operationCleared = true
      } catch {
        updatePanel(orderNumber, { warningMessage: OPERATION_WARNING })
      }
    }
    // A fresh persisted read is required after every outcome, including errors.
    // It cannot remove the local ambiguous-payment latch.
    if (isCurrentVisit()) void loadStatus(visit)
    if (result.kind === 'warning') {
      updatePanel(orderNumber, { pending: false, warningMessage: result.message })
      return
    }
    if (result.kind === 'error') {
      const canRetry = isCurrentVisit()
      if (canRetry) lockedOrders.current.delete(orderNumber)
      updatePanel(orderNumber, {
        pending: false,
        locked: !canRetry,
        errorMessage: result.message,
        warningMessage: canRetry ? null : NAVIGATION_WARNING,
      })
      return
    }
    updatePanel(orderNumber, { amountInput: '', successMessage: result.message })
    if (!isCurrentVisit()) {
      updatePanel(orderNumber, { pending: false, warningMessage: NAVIGATION_WARNING })
      return
    }
    // Cache failures cannot change an already validated payment result.
    try {
      await clearRouteCache()
    } catch {
      updatePanel(orderNumber, { pending: false, warningMessage: REFRESH_WARNING })
      return
    }
    const canRefundAgain = result.type === 'partial' && isCurrentVisit() && operationCleared
    if (canRefundAgain) lockedOrders.current.delete(orderNumber)
    updatePanel(orderNumber, {
      pending: false,
      locked: !canRefundAgain,
      warningMessage: !isCurrentVisit()
        ? NAVIGATION_WARNING
        : operationCleared
          ? null
          : OPERATION_WARNING,
    })
  }

  const prepareOperationRetry = async (): Promise<void> => {
    const visit = activeVisit.current
    const stored = visit?.operation
    if (
      !orderNumber ||
      visit?.orderNumber !== orderNumber ||
      !stored ||
      !latestAllowed.current ||
      busyOrders.current.has(orderNumber) ||
      visit.status?.state !== 'clear' ||
      visit.status.operationState !== 'unseen'
    )
      return
    busyOrders.current.add(orderNumber)
    updatePanel(orderNumber, { pending: true, locked: true })
    try {
      await loadStatus(visit)
      if (
        activeVisit.current !== visit ||
        !latestAllowed.current ||
        visit.status?.state !== 'clear' ||
        visit.status.operationState !== 'unseen'
      )
        return
      const current = readRefundOperation(orderNumber)
      if (current?.key !== stored.key || current.amountHuf !== stored.amountHuf) return
      // Unseen may still be an in-flight pre-claim request. Keep its identity and amount.
      lockedOrders.current.delete(orderNumber)
      updatePanel(orderNumber, {
        locked: false,
        amountInput: stored.amountHuf === null ? '' : String(stored.amountHuf),
        errorMessage: null,
        warningMessage: null,
        successMessage: null,
      })
    } catch {
      if (activeVisit.current === visit)
        updatePanel(orderNumber, { warningMessage: OPERATION_WARNING })
    } finally {
      busyOrders.current.delete(orderNumber)
      if (activeVisit.current === visit) updatePanel(orderNumber, { pending: false })
    }
  }

  const acknowledgeOperation = async (): Promise<void> => {
    const visit = activeVisit.current
    const stored = visit?.operation
    if (
      !orderNumber ||
      visit?.orderNumber !== orderNumber ||
      !stored ||
      !owner ||
      busyOrders.current.has(orderNumber) ||
      visit.status?.state !== 'clear' ||
      !['completed', 'no_effect'].includes(visit.status.operationState ?? '')
    )
      return
    busyOrders.current.add(orderNumber)
    visit.request?.abort()
    visit.status = null
    updatePanel(orderNumber, { pending: true, locked: true })
    try {
      await clearRouteCache()
      if (activeVisit.current !== visit) return
      clearRefundOperation(orderNumber, stored.key)
      visit.operation = null
      lockedOrders.current.delete(orderNumber)
      updatePanel(orderNumber, {
        operation: null,
        amountInput: '',
        locked: false,
        errorMessage: null,
        warningMessage: null,
        successMessage: null,
      })
    } catch {
      if (activeVisit.current === visit)
        updatePanel(orderNumber, { warningMessage: OPERATION_WARNING })
    } finally {
      busyOrders.current.delete(orderNumber)
      updatePanel(orderNumber, { pending: false })
      if (activeVisit.current === visit) await loadStatus(visit)
    }
  }

  const startRecovery = async (): Promise<void> => {
    const visit = activeVisit.current
    if (
      !orderNumber ||
      visit?.orderNumber !== orderNumber ||
      !owner ||
      visit.status?.state !== 'recoverable' ||
      busyOrders.current.has(orderNumber)
    )
      return
    busyOrders.current.add(orderNumber)
    lockedOrders.current.add(orderNumber)
    visit.request?.abort()
    visit.status = null
    updatePanel(orderNumber, {
      pending: true,
      recovering: true,
      locked: true,
      successMessage: null,
      errorMessage: null,
      warningMessage: null,
    })
    let result: ReturnType<typeof parseRefundRecoveryResponse> = null
    try {
      const response = await fetch(`/api/admin/orders/${encodeURIComponent(orderNumber)}/refund`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'recover' }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      result = parseRefundRecoveryResponse(response.status, await response.json(), orderNumber)
    } catch {
      result = null
    }
    busyOrders.current.delete(orderNumber)
    updatePanel(orderNumber, { pending: false, recovering: false })
    if (activeVisit.current !== visit) return
    if (result?.recoveryStatus === 'completed') {
      updatePanel(orderNumber, { successMessage: 'A visszatérítés feldolgozása rendezve.' })
      try {
        await clearRouteCache()
      } catch {
        if (activeVisit.current === visit)
          updatePanel(orderNumber, { warningMessage: REFRESH_WARNING })
      }
    } else {
      updatePanel(orderNumber, {
        warningMessage: result ? `${result.message} ${REFUND_REVIEW_GUIDANCE}` : STATUS_WARNING,
      })
    }
    if (activeVisit.current === visit) await loadStatus(visit)
  }

  if (isInitializing) {
    return (
      <div className="field-type" style={panelStyle}>
        <h3 style={{ marginTop: 0 }}>Visszatérítés</h3>
        <p style={noteStyle}>Betöltés…</p>
      </div>
    )
  }

  if (!orderNumber) {
    return (
      <div className="field-type" style={panelStyle}>
        <h3 style={{ marginTop: 0 }}>Visszatérítés</h3>
        <p style={noteStyle}>A visszatérítés csak mentett, kifizetett rendelésen indítható.</p>
      </div>
    )
  }

  if (!hasOwnerRole(user)) {
    return (
      <div className="field-type" style={panelStyle}>
        <h3 style={{ marginTop: 0 }}>Visszatérítés</h3>
        <p style={noteStyle}>Visszatérítést csak a tulajdonos indíthat.</p>
      </div>
    )
  }

  return (
    <div className="field-type" style={panelStyle}>
      <h3 style={{ marginTop: 0 }}>Visszatérítés</h3>
      <dl
        aria-label="Mentett visszatérítési állapotok"
        aria-live="polite"
        style={{ margin: 'var(--base) 0' }}
      >
        {readRefundOperationalStatus(data).map(({ key, label, value }) => (
          <div key={key} style={{ marginBottom: 'calc(var(--base) * 0.5)' }}>
            <dt style={{ fontWeight: 600 }}>{label}</dt>
            <dd style={noteStyle}>{value}</dd>
          </div>
        ))}
      </dl>
      {blockedReason ? (
        <p style={noteStyle}>{blockedReason}</p>
      ) : (
        <>
          <p style={noteStyle}>
            {totalHuf === null
              ? 'Üresen hagyva a teljes összeg térül vissza.'
              : `A rendelés végösszege ${formatPriceHuf(totalHuf)}. Üresen hagyva a teljes összeg térül vissza.`}
          </p>
          <label
            htmlFor="kineticare-refund-amount"
            style={{ display: 'block', marginTop: 'calc(var(--base) * 0.5)' }}
          >
            Visszatérítendő összeg (Ft) — üres = teljes visszatérítés
          </label>
          <input
            aria-label="Visszatérítendő összeg forintban"
            disabled={
              pending || locked || statusLoading || !!operation || recovery?.state !== 'clear'
            }
            id="kineticare-refund-amount"
            inputMode="numeric"
            onChange={(event) => updatePanel(orderNumber, { amountInput: event.target.value })}
            placeholder="teljes összeg"
            style={{ maxWidth: '16rem' }}
            type="text"
            value={amountInput}
          />
          <div style={{ marginTop: 'calc(var(--base) * 0.5)' }}>
            <Button
              buttonStyle="secondary"
              disabled={
                pending ||
                locked ||
                statusLoading ||
                recovery?.state !== 'clear' ||
                (!!operation && recovery.operationState !== 'unseen')
              }
              onClick={() => {
                void startRefund()
              }}
              size="medium"
            >
              {pending ? 'Visszatérítés folyamatban…' : 'Visszatérítés indítása'}
            </Button>
          </div>
        </>
      )}
      {statusLoading ? <p style={noteStyle}>Mentett feldolgozási állapot ellenőrzése…</p> : null}
      {statusError ? <p role="alert">{STATUS_WARNING}</p> : null}
      {operation && locked && !pending ? <p role="alert">{OPERATION_WARNING}</p> : null}
      {operation &&
      recovery?.state === 'clear' &&
      ['completed', 'no_effect'].includes(recovery.operationState ?? '') ? (
        <>
          <p style={noteStyle}>
            {recovery.operationState === 'completed'
              ? 'A korábbi művelet feldolgozása lezárult.'
              : 'A korábbi művelethez nincs végrehajtott pénzvisszatérítés igazolva.'}
          </p>
          <Button
            buttonStyle="secondary"
            disabled={pending || statusLoading}
            onClick={() => {
              void acknowledgeOperation()
            }}
            size="medium"
          >
            Korábbi művelet nyugtázása
          </Button>
        </>
      ) : null}
      {operation &&
      locked &&
      allowed &&
      recovery?.state === 'clear' &&
      recovery.operationState === 'unseen' ? (
        <Button
          buttonStyle="secondary"
          disabled={pending || statusLoading}
          onClick={() => {
            void prepareOperationRetry()
          }}
          size="medium"
        >
          Korábbi művelet újrapróbálása
        </Button>
      ) : null}
      {recovery && recovery.state !== 'clear' ? (
        <p role="alert">
          {recovery.message} {REFUND_REVIEW_GUIDANCE}
        </p>
      ) : null}
      {recovery?.state === 'recoverable' ? (
        <>
          <p style={noteStyle}>A pénzvisszatérítést nem indítja újra.</p>
          <Button
            buttonStyle="secondary"
            disabled={pending || statusLoading}
            onClick={() => {
              void startRecovery()
            }}
            size="medium"
          >
            {recovering ? 'Feldolgozás folytatása…' : 'Feldolgozás folytatása'}
          </Button>
        </>
      ) : null}
      {warningMessage ? (
        <p
          role="alert"
          style={{ borderLeft: '4px solid currentColor', paddingLeft: '0.75rem', marginBottom: 0 }}
        >
          <strong>Ellenőrzés szükséges. </strong>
          {warningMessage}
        </p>
      ) : null}
      {errorMessage ? (
        <p role="alert" style={{ color: 'var(--theme-error-500)', marginBottom: 0 }}>
          {errorMessage}
        </p>
      ) : null}
      {successMessage ? (
        <p role="status" style={{ color: 'var(--theme-success-500)', marginBottom: 0 }}>
          {successMessage}
        </p>
      ) : null}
    </div>
  )
}

export default RefundPanel
