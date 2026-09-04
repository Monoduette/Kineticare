'use client'

import { Button, useAuth, useDocumentInfo, useRouteCache } from '@payloadcms/ui'
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

import { hasOwnerRole } from '../../access/roles'
import { formatPriceHuf } from '../../lib/format-price'
import { refundBlockedReason, refundConfirmQuestion, validateRefundAmount } from './refund-amount'
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

interface PanelState {
  amountInput: string
  pending: boolean
  locked: boolean
  errorMessage: string | null
  warningMessage: string | null
  successMessage: string | null
}

const EMPTY_PANEL: PanelState = {
  amountInput: '',
  pending: false,
  locked: false,
  errorMessage: null,
  warningMessage: null,
  successMessage: null,
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
  const { amountInput, pending, locked, errorMessage, warningMessage, successMessage } =
    (orderNumber && panels.get(orderNumber)) || EMPTY_PANEL
  // This guard lasts only for this mounted panel, not across reloads or tabs.
  const lockedOrders = useRef(new Set<string>())
  const activeVisit = useRef<{ orderNumber: string | null } | null>(null)
  const latestAllowed = useRef(false)

  useLayoutEffect(() => {
    activeVisit.current = { orderNumber }
    return () => {
      activeVisit.current = null
    }
  }, [orderNumber])

  useLayoutEffect(() => {
    latestAllowed.current = allowed
  }, [allowed])

  const updatePanel = (key: string, patch: Partial<PanelState>) => {
    setPanels((previous) => {
      const next = new Map(previous)
      next.set(key, { ...(previous.get(key) ?? EMPTY_PANEL), ...patch })
      return next
    })
  }

  // Sima függvény (nem useCallback): a React Compiler maga memoizál, a kézi
  // memoizáció itt csak a `preserve-manual-memoization` szabályba ütközne, mert
  // a dependenciák egy helyben képzett objektumból (readOrderSummary) jönnek.
  const startRefund = async (): Promise<void> => {
    const visit = activeVisit.current
    if (
      !orderNumber ||
      visit?.orderNumber !== orderNumber ||
      !latestAllowed.current ||
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

    lockedOrders.current.add(orderNumber)
    updatePanel(orderNumber, {
      pending: true,
      locked: true,
      errorMessage: null,
      warningMessage: null,
      successMessage: null,
    })
    const isCurrentVisit = () => activeVisit.current === visit
    let result: RefundPresentation
    try {
      const response = await fetch(`/api/admin/orders/${encodeURIComponent(orderNumber)}/refund`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(check.amountHuf === null ? {} : { amountHuf: check.amountHuf }),
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
    const canRefundAgain = result.type === 'partial' && isCurrentVisit()
    if (canRefundAgain) lockedOrders.current.delete(orderNumber)
    updatePanel(orderNumber, {
      pending: false,
      locked: !canRefundAgain,
      warningMessage: isCurrentVisit() ? null : NAVIGATION_WARNING,
    })
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
            disabled={pending || locked}
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
              disabled={pending || locked}
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
