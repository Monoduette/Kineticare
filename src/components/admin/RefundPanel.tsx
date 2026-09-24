'use client'

import {
  Button,
  ConfirmationModal,
  useAuth,
  useDocumentInfo,
  useModal,
  useRouteCache,
} from '@payloadcms/ui'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'

import { hasOwnerRole } from '../../access/roles'
import { formatPriceHuf } from '../../lib/format-price'
import { REFUND_RECOVERY_ACTION_LABEL } from '../../lib/refund/recovery-action-label'
import {
  refundBlockedReason,
  refundConfirmText,
  validateRefundAmount,
  type RefundConfirmText,
} from './refund-amount'
import { useConfirmationDialogNames } from './confirmation-dialog-names'
import { hasRefundHistory, readRefundOperationalStatus } from './refund-operational-status'
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
 * szabályt: a kliensoldali ellenőrzések (kifizetett státusz, pozitív egész
 * összeg) csak kényelmi előszűrések, a szerver mindent újra ellenőriz.
 *
 * K12 (admin-audit, 2026-09-22), megjelenítési döntések:
 * - Élő régiók (WCAG 2.2 SC 4.1.3). A TARTÓS állapot (a mentett feldolgozási
 *   állapot nem ellenőrizhető, rendezetlen korábbi művelet, kézi ellenőrzést
 *   kérő mentett állapot) role="status": betöltéskor is megjelenhet, és az
 *   MDN szerint „[the alert role] should not be used on HTML that the user
 *   hasn't interacted with” (https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/alert_role);
 *   a Carbon is udvarias élő régiót ajánl minden nem sürgős üzenetre
 *   (https://carbondesignsystem.com/components/notification/accessibility/).
 *   A role="alert" csak a gombnyomás EREDMÉNYÉNEK jár (hiba, bizonytalan
 *   pénzügyi kimenet), a W3C Understanding 4.1.3 példája szerint
 *   (https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
 * - A mező hozzáférhető neve a látható címke (SC 2.5.3, Label in Name): a
 *   korábbi, eltérő aria-label felülírta volna
 *   (https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html).
 *   A kitöltési útmutató külön súgószöveg (SC 3.3.2; GOV.UK Error message
 *   és hint minta: https://design-system.service.gov.uk/components/error-message/),
 *   nem placeholder.
 * - A megerősítés a Payload saját ConfirmationModal-ja (a core törlés-
 *   megerősítésével azonos felület, SC 3.2.4), konkrét következménnyel és
 *   külön visszavonhatatlansági mondattal (NN/g, Confirmation Dialogs:
 *   https://www.nngroup.com/articles/confirmation-dialog/).
 */

const REQUEST_TIMEOUT_MS = 30_000

/** A megerősítő ablak azonosítója (a Payload modal-kezelőjében). */
export const REFUND_CONFIRM_MODAL_SLUG = 'kineticare-visszaterites-megerositese'

const AMOUNT_INPUT_ID = 'kineticare-refund-amount'

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

const noticeSpacing: CSSProperties = { marginTop: 'calc(var(--base) * 0.75)', marginBottom: 0 }

/**
 * „Ellenőrzés szükséges” doboz. A stílus a B1 stílusszerződése
 * (.kc-admin-notice--figyelem a custom.scss-ben, mindkét témán mért AA), a
 * jelentést a cím szövege mondja ki, nem csak a szín (SC 1.4.1). A `role` a
 * hívó döntése: tartós állapotnál status, gombnyomás eredményénél alert.
 */
function ReviewNotice({ role, children }: { role: 'alert' | 'status'; children: ReactNode }) {
  return (
    <div
      className="kc-admin-notice kc-admin-notice--figyelem"
      data-kc-uzenet="ellenorzes"
      role={role}
      style={noticeSpacing}
    >
      <p className="kc-admin-notice__cim">Ellenőrzés szükséges</p>
      <p className="kc-admin-notice__szoveg">{children}</p>
    </div>
  )
}

export function RefundPanel() {
  const { data, isInitializing } = useDocumentInfo()
  const { user } = useAuth<{ id: number | string; role?: string | null }>()
  const { clearRouteCache } = useRouteCache()
  const { closeModal, isModalOpen, openModal } = useModal()
  const hintId = useId()
  const errorId = useId()
  const confirmHeadingId = useId()
  const confirmBodyId = useId()
  const [confirmText, setConfirmText] = useState<RefundConfirmText | null>(null)
  const confirmOpen = isModalOpen(REFUND_CONFIRM_MODAL_SLUG)
  useConfirmationDialogNames(
    REFUND_CONFIRM_MODAL_SLUG,
    confirmOpen,
    confirmHeadingId,
    confirmBodyId,
  )

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
  // A megerősítő ablakban jóváhagyásra váró kérés. Ref, mert a jóváhagyás
  // aszinkron: a pénzmozgás előtt MINDEN őrt újra ellenőrizni kell.
  const pendingConfirmation = useRef<{
    orderNumber: string
    amountHuf: number | null
    visit: OrderVisit
  } | null>(null)
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
      // Igazoltan hatástalan korábbi művelet (a szerver szerint a kísérlet
      // provider_failed, pénz nem mozdult, és nincs rendezetlen állapot): a
      // kulcsa nem használható újra, a nyugtázás csak felesleges kattintás
      // lenne. Futó kérés mellett (busy) nem nyúlunk hozzá.
      const autoCleared: Partial<PanelState> = {}
      const settled = visit.operation
      if (
        settled &&
        status?.state === 'clear' &&
        status.operationState === 'no_effect' &&
        !busyOrders.current.has(key)
      ) {
        try {
          clearRefundOperation(key, settled.key)
          visit.operation = null
          lockedOrders.current.delete(key)
          Object.assign(autoCleared, { operation: null, locked: false })
        } catch {
          lockedOrders.current.add(key)
          Object.assign(autoCleared, { locked: true, warningMessage: OPERATION_WARNING })
        }
      }
      updatePanel(key, {
        ...initialState,
        ...autoCleared,
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

  // Rendelésváltáskor és a panel eltűnésekor a nyitva hagyott megerősítés
  // is megszűnik: egy korábbi rendelés jóváhagyása sosem futhat le itt.
  useEffect(
    () => () => {
      pendingConfirmation.current = null
      closeModal(REFUND_CONFIRM_MODAL_SLUG)
    },
    [orderNumber, closeModal],
  )

  // Sima függvények (nem useCallback): a React Compiler maga memoizál, a kézi
  // memoizáció itt csak a `preserve-manual-memoization` szabályba ütközne, mert
  // a dependenciák egy helyben képzett objektumból (readOrderSummary) jönnek.
  const canStartRefund = (visit: OrderVisit | null): visit is OrderVisit =>
    !!orderNumber &&
    visit?.orderNumber === orderNumber &&
    latestAllowed.current &&
    visit.status?.state === 'clear' &&
    !(visit.operation && visit.status.operationState !== 'unseen') &&
    !busyOrders.current.has(orderNumber) &&
    !lockedOrders.current.has(orderNumber)

  // 1. lépés: ellenőrzés, majd a megerősítő ablak. Pénz itt még nem mozdul.
  const requestRefund = (): void => {
    const visit = activeVisit.current
    if (!orderNumber || !canStartRefund(visit)) return
    const check = validateRefundAmount(amountInput, totalHuf)
    if (!check.ok) {
      updatePanel(orderNumber, { successMessage: null, errorMessage: check.message })
      return
    }
    pendingConfirmation.current = { orderNumber, amountHuf: check.amountHuf, visit }
    setConfirmText(refundConfirmText(orderNumber, check.amountHuf))
    openModal(REFUND_CONFIRM_MODAL_SLUG)
  }

  const cancelRefund = (): void => {
    pendingConfirmation.current = null
  }

  // 2. lépés: a jóváhagyás után az eredeti, változatlan folyamat. A várakozás
  // közben megváltozott állapotot (másik rendelés, új mentett állapot, futó
  // kérés) ugyanazok az őrök szűrik, mint a gombnyomást.
  const startRefund = async (): Promise<void> => {
    const pending = pendingConfirmation.current
    pendingConfirmation.current = null
    const visit = activeVisit.current
    if (
      !pending ||
      !orderNumber ||
      pending.orderNumber !== orderNumber ||
      pending.visit !== visit ||
      !canStartRefund(visit)
    ) {
      return
    }
    const check = { amountHuf: pending.amountHuf }

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
    // A szerver szövege önmagában teljes (mi történt, mi a teendő), ezért
    // változatlanul jelenik meg; a lezárt, hatástalan kísérletnél is ez mondja
    // meg, hogy pénz nem mozdult, és indítható-e új visszatérítés.
    if (result?.recoveryStatus === 'completed') {
      updatePanel(orderNumber, { successMessage: result.message })
      try {
        await clearRouteCache()
      } catch {
        if (activeVisit.current === visit)
          updatePanel(orderNumber, { warningMessage: REFRESH_WARNING })
      }
    } else {
      updatePanel(orderNumber, { warningMessage: result ? result.message : STATUS_WARNING })
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

  const history = hasRefundHistory(data)
  const amountDisabled =
    pending || locked || statusLoading || !!operation || recovery?.state !== 'clear'

  return (
    <div className="field-type" style={panelStyle}>
      <h3 style={{ marginTop: 0 }}>Visszatérítés</h3>
      {/* Az élő régió a tárolóé, hogy a lista és az egysoros állapot közti
          váltás (az első visszatérítés után) is elhangozzon. */}
      <div aria-live="polite" style={{ margin: 'var(--base) 0' }}>
        {history ? (
          <dl aria-label="Mentett visszatérítési állapotok" style={{ margin: 0 }}>
            {readRefundOperationalStatus(data).map(({ key, label, value }) => (
              <div key={key} style={{ marginBottom: 'calc(var(--base) * 0.5)' }}>
                <dt style={{ fontWeight: 600 }}>{label}</dt>
                <dd style={{ ...noteStyle, marginInlineStart: 0 }}>{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p style={noteStyle}>Ezen a rendelésen még nem volt visszatérítés.</p>
        )}
      </div>
      {blockedReason ? (
        <p style={noteStyle}>{blockedReason}</p>
      ) : (
        <>
          {totalHuf === null ? null : (
            <p style={noteStyle}>A rendelés végösszege: {formatPriceHuf(totalHuf)}.</p>
          )}
          <label
            htmlFor={AMOUNT_INPUT_ID}
            style={{ display: 'block', fontWeight: 600, marginTop: 'calc(var(--base) * 0.5)' }}
          >
            Visszatérítendő összeg (Ft)
          </label>
          <p id={hintId} style={{ ...noteStyle, marginBottom: 'calc(var(--base) * 0.25)' }}>
            Ha üresen hagyod, a teljes összeg visszajár.
          </p>
          <input
            aria-describedby={errorMessage ? `${hintId} ${errorId}` : hintId}
            className="kc-admin-input"
            disabled={amountDisabled}
            id={AMOUNT_INPUT_ID}
            inputMode="numeric"
            onChange={(event) => updatePanel(orderNumber, { amountInput: event.target.value })}
            style={{ width: '16rem' }}
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
              onClick={requestRefund}
              size="medium"
            >
              {pending ? 'Visszatérítés folyamatban…' : 'Visszatérítés indítása'}
            </Button>
          </div>
        </>
      )}
      {statusLoading ? <p style={noteStyle}>Mentett feldolgozási állapot ellenőrzése…</p> : null}
      {statusError ? <ReviewNotice role="status">{STATUS_WARNING}</ReviewNotice> : null}
      {operation && locked && !pending ? (
        <ReviewNotice role="status">{OPERATION_WARNING}</ReviewNotice>
      ) : null}
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
        // A mentett állapot szövege a szerveré, és kimondja a teendőt is
        // (src/lib/refund/refund-recovery.ts); általános útmutató nem kerül
        // mellé, mert az a konkrét teendőnek ellentmondhatna.
        <ReviewNotice role="status">{recovery.message}</ReviewNotice>
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
            {recovering ? `${REFUND_RECOVERY_ACTION_LABEL}…` : REFUND_RECOVERY_ACTION_LABEL}
          </Button>
        </>
      ) : null}
      {warningMessage ? (
        // A rendezetlen korábbi művelet tartós állapot (betöltéskor is
        // előállhat), minden más figyelmeztetés egy gombnyomás eredménye.
        <ReviewNotice role={warningMessage === OPERATION_WARNING ? 'status' : 'alert'}>
          {warningMessage}
        </ReviewNotice>
      ) : null}
      {errorMessage ? (
        <p
          data-kc-uzenet="hiba"
          id={errorId}
          role="alert"
          style={{ color: 'var(--theme-error-500)', marginBottom: 0 }}
        >
          {errorMessage}
        </p>
      ) : null}
      {successMessage ? (
        <p
          data-kc-uzenet="siker"
          role="status"
          style={{ color: 'var(--theme-success-500)', marginBottom: 0 }}
        >
          {successMessage}
        </p>
      ) : null}
      <ConfirmationModal
        body={
          confirmText ? (
            <div id={confirmBodyId}>
              <p>{confirmText.detail}</p>
              <p>
                <strong>{confirmText.warning}</strong>
              </p>
            </div>
          ) : null
        }
        cancelLabel="Mégse"
        confirmLabel="Visszatérítés indítása"
        heading={<h1 id={confirmHeadingId}>{confirmText?.heading ?? 'Visszatérítés'}</h1>}
        modalSlug={REFUND_CONFIRM_MODAL_SLUG}
        onCancel={cancelRefund}
        onConfirm={() => {
          // A megerősítő ablak azonnal bezárul; a folyamat állapotát a panel
          // „Visszatérítés folyamatban…” gombja és az eredményüzenet mutatja.
          void startRefund()
        }}
      />
    </div>
  )
}

export default RefundPanel
