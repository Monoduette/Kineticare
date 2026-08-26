'use client'

import { Button, useAuth, useDocumentInfo, useRouteCache } from '@payloadcms/ui'
import { useState, type CSSProperties } from 'react'

import { hasOwnerRole } from '../../access/roles'
import { formatPriceHuf } from '../../lib/format-price'
import { refundBlockedReason, refundConfirmQuestion, validateRefundAmount } from './refund-amount'

/**
 * Visszatérítés-panel a rendelés szerkesztőnézetében (orders `type: 'ui'` mező).
 * KIZÁRÓLAG felület: a visszatérítés teljes üzleti logikája a meglévő,
 * kész szolgáltatásban él (src/lib/refund/*), amelyet a panel a
 * POST /api/admin/orders/[orderNumber]/refund végponton hív. A komponens
 * semmilyen pénzügyi döntést nem hoz, és nem másol le szerver-oldali
 * szabályt — a kliensoldali ellenőrzések (paid státusz, pozitív egész összeg,
 */

const REQUEST_TIMEOUT_MS = 30_000

/**
 * A magyar mikroszöveg-szabályzat (`docs/ui-sztenderdek.md` §2.7, A/9) szerint
 * a hibaüzenet TEGEZ és megmondja a következő lépést: a korábbi „Kérjük,
 * próbáld újra később" udvariaskodott (GOV.UK: a „please" választást sugall
 * ott, ahol nincs választás), és a „később"-től nem lett okosabb az olvasó.
 */
const GENERIC_ERROR = 'A visszatérítés most nem sikerült. Próbáld újra néhány perc múlva.'
const NETWORK_ERROR = 'Nem sikerült elérni a szervert. Ellenőrizd a kapcsolatot, és próbáld újra.'

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

/** A szerver magyar hibaüzenete a válasz-törzsből ({ error: string }). */
function readServerError(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return null
  }
  const error = (body as Record<string, unknown>).error
  return typeof error === 'string' && error.trim().length > 0 ? error : null
}

/**
 * A sikeres válasz olvasása ({ type, transactionId, amountHuf, refundStatusOutcome }).
 *
 * M-11: a `refundStatusOutcome: 'unknown'` azt jelenti, hogy a Barion nem
 * igazolta vissza a tranzakció sikerét — a visszatérítés rögzült (a maradvány
 * másodszor nem téríthető vissza), de bizonylat NEM készült. Ezt ki KELL írni az
 * ügyintézőnek, különben a rutinszerű „megtörtént" üzenet elfedné a teendőt.
 */
function readSuccessMessage(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    return 'A visszatérítés megtörtént.'
  }
  const record = body as Record<string, unknown>
  const type = record.type === 'partial' ? 'Részleges' : 'Teljes'
  const amount = typeof record.amountHuf === 'number' ? formatPriceHuf(record.amountHuf) : null
  const transactionId =
    typeof record.transactionId === 'string' ? record.transactionId : 'ismeretlen'
  const base = `${type} visszatérítés megtörtént${amount ? ` (${amount})` : ''}. Tranzakció-azonosító: ${transactionId}`
  if (record.refundStatusOutcome === 'unknown') {
    return `${base} FIGYELEM: a Barion nem igazolta vissza a visszatérítés státuszát, ezért számlázási bizonylat nem készült. Ellenőrizd a Barion felületén, és a bizonylatot állítsd ki kézzel.`
  }
  return base
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

  const [amountInput, setAmountInput] = useState('')
  const [pending, setPending] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const order = readOrderSummary(data)
  const { orderNumber, totalHuf } = order

  // Sima függvény (nem useCallback): a React Compiler maga memoizál, a kézi
  // memoizáció itt csak a `preserve-manual-memoization` szabályba ütközne, mert
  // a dependenciák egy helyben képzett objektumból (readOrderSummary) jönnek.
  const startRefund = async (): Promise<void> => {
    if (!orderNumber) {
      return
    }
    const check = validateRefundAmount(amountInput, totalHuf)
    if (!check.ok) {
      setSuccessMessage(null)
      setErrorMessage(check.message)
      return
    }
    if (!window.confirm(refundConfirmQuestion(orderNumber, check.amountHuf))) {
      return
    }

    setPending(true)
    setErrorMessage(null)
    setSuccessMessage(null)
    try {
      const response = await fetch(
        `/api/admin/orders/${encodeURIComponent(orderNumber)}/refund`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(check.amountHuf === null ? {} : { amountHuf: check.amountHuf }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      )
      let body: unknown = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      if (!response.ok) {
        setErrorMessage(readServerError(body) ?? GENERIC_ERROR)
        return
      }
      setAmountInput('')
      setSuccessMessage(readSuccessMessage(body))
      // A nézet frissítése, hogy a státusz és a visszatérítési nyom látszódjon.
      clearRouteCache()
    } catch {
      // Hálózati hiba vagy időtúllépés — a művelet újrapróbálható marad.
      setErrorMessage(NETWORK_ERROR)
    } finally {
      setPending(false)
    }
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
        <p style={noteStyle}>
          A visszatérítés csak mentett, kifizetett rendelésen indítható.
        </p>
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

  const blockedReason = refundBlockedReason(order.status)
  if (blockedReason) {
    return (
      <div className="field-type" style={panelStyle}>
        <h3 style={{ marginTop: 0 }}>Visszatérítés</h3>
        <p style={noteStyle}>{blockedReason}</p>
      </div>
    )
  }

  return (
    <div className="field-type" style={panelStyle}>
      <h3 style={{ marginTop: 0 }}>Visszatérítés</h3>
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
        disabled={pending}
        id="kineticare-refund-amount"
        inputMode="numeric"
        onChange={(event) => setAmountInput(event.target.value)}
        placeholder="teljes összeg"
        style={{ maxWidth: '16rem' }}
        type="text"
        value={amountInput}
      />
      <div style={{ marginTop: 'calc(var(--base) * 0.5)' }}>
        <Button
          buttonStyle="secondary"
          disabled={pending}
          onClick={() => {
            void startRefund()
          }}
          size="medium"
        >
          {pending ? 'Visszatérítés folyamatban…' : 'Visszatérítés indítása'}
        </Button>
      </div>
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
