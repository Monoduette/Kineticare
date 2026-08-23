'use client'

import { Button, useAuth, useDocumentInfo, useRouteCache } from '@payloadcms/ui'
import { useCallback, useState, type CSSProperties } from 'react'

import { hasStaffOrOwnerRole } from '../../access/roles'

/**
 * „Kurzus ajándékozása" panel a felhasználó szerkesztőnézetében
 * (users `type: 'ui'` mező).
 *
 * KIZÁRÓLAG felület: a hozzáférés-adás logikája a POST
 * /api/admin/grant-purchase végponton fut (src/lib/grant-purchase-route.ts →
 * src/lib/grant-purchase.ts), staff/owner jogosultsággal, idempotensen és
 * strukturált audit-naplózással. A users.purchases mező field-access szinten
 * rendszer-írású marad — a panel SOHA nem írja közvetlenül, csak a végpontot
 * hívja, amely szerver-oldalon, overrideAccess-szel ír (pontosan úgy, ahogy a
 * CLI-script eddig).
 *
 * A kurzuslistát a panel megnyitásakor (felhasználói interakcióra) tölti be a
 * Payload REST API-ról, sütis munkamenettel (credentials: 'include') — így
 * nincs mount-effekt, és a szerkesztőnézet betöltése sem lassul.
 */

const REQUEST_TIMEOUT_MS = 20_000

/** §2.7 / A/9: „Kérjük" nélkül, a következő lépés kimondva (lásd RefundPanel). */
const GENERIC_ERROR = 'Az ajándékozás most nem sikerült. Próbáld újra néhány perc múlva.'
const NETWORK_ERROR = 'Nem sikerült elérni a szervert. Ellenőrizd a kapcsolatot, és próbáld újra.'
const PRODUCTS_ERROR =
  'A kurzusok listája nem tölthető be. Frissítsd az oldalt, és nyisd meg újra a panelt.'

interface ProductOption {
  value: string
  label: string
}

/** A dokumentum-adatokból a vevő e-mail-címe (a végpont ez alapján old fel). */
function readUserEmail(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) {
    return null
  }
  const email = (data as Record<string, unknown>).email
  return typeof email === 'string' && email.trim().length > 0 ? email : null
}

/** A szerver magyar hibaüzenete a válasz-törzsből ({ error: string }). */
function readServerError(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return null
  }
  const error = (body as Record<string, unknown>).error
  return typeof error === 'string' && error.trim().length > 0 ? error : null
}

/** A sikeres válasz magyar üzenete ({ status, message }). */
function readGrantMessage(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    return 'A kurzust ajándékoztam.'
  }
  const message = (body as Record<string, unknown>).message
  return typeof message === 'string' && message.trim().length > 0 ? message : 'A kurzust ajándékoztam.'
}

/** A products REST-válasz szűkítése választható elemekre. */
function readProductOptions(body: unknown): ProductOption[] {
  if (typeof body !== 'object' || body === null) {
    return []
  }
  const docs = (body as Record<string, unknown>).docs
  if (!Array.isArray(docs)) {
    return []
  }
  const options: ProductOption[] = []
  for (const doc of docs) {
    if (typeof doc !== 'object' || doc === null) {
      continue
    }
    const record = doc as Record<string, unknown>
    const id = record.id
    if (typeof id !== 'number' && typeof id !== 'string') {
      continue
    }
    const sku = record.sku
    options.push({
      value: String(id),
      label: typeof sku === 'string' && sku.trim().length > 0 ? sku : `#${String(id)}`,
    })
  }
  return options
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

const rowStyle: CSSProperties = {
  marginTop: 'calc(var(--base) * 0.5)',
}

export function GrantPurchasePanel() {
  const { data, isInitializing } = useDocumentInfo()
  const { user } = useAuth<{ id: number | string; role?: string | null }>()
  const { clearRouteCache } = useRouteCache()

  const [open, setOpen] = useState(false)
  const [products, setProducts] = useState<ProductOption[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [productsError, setProductsError] = useState<string | null>(null)
  const [selectedProduct, setSelectedProduct] = useState('')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const email = readUserEmail(data)

  const loadProducts = useCallback(async (): Promise<void> => {
    setLoadingProducts(true)
    setProductsError(null)
    try {
      const response = await fetch(
        '/api/products?where[status][equals]=published&limit=200&depth=0&sort=sku',
        {
          credentials: 'include',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      )
      if (!response.ok) {
        setProductsError(PRODUCTS_ERROR)
        return
      }
      const body: unknown = await response.json()
      const options = readProductOptions(body)
      setProducts(options)
      if (options.length === 0) {
        setProductsError('Nincs közzétett kurzus, amit ajándékozni lehetne.')
      }
    } catch {
      setProductsError(NETWORK_ERROR)
    } finally {
      setLoadingProducts(false)
    }
  }, [])

  const openPanel = useCallback((): void => {
    setOpen(true)
    setErrorMessage(null)
    setSuccessMessage(null)
    void loadProducts()
  }, [loadProducts])

  const submitGrant = useCallback(async (): Promise<void> => {
    if (!email) {
      return
    }
    if (selectedProduct.length === 0) {
      setSuccessMessage(null)
      setErrorMessage('Válassz kurzust az ajándékozáshoz.')
      return
    }
    if (reason.trim().length === 0) {
      setSuccessMessage(null)
      setErrorMessage('Add meg az indokot: ez kerül az audit-naplóba.')
      return
    }
    const label = products.find((option) => option.value === selectedProduct)?.label ?? selectedProduct
    if (
      !window.confirm(
        `Biztosan ajándékozod a(z) "${label}" kurzust ennek a felhasználónak: ${email}?`,
      )
    ) {
      return
    }

    setPending(true)
    setErrorMessage(null)
    setSuccessMessage(null)
    try {
      const response = await fetch('/api/admin/grant-purchase', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, productIdOrSku: selectedProduct, reason: reason.trim() }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
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
      setSuccessMessage(readGrantMessage(body))
      setReason('')
      // A nézet frissítése, hogy a „Megvásárolt kurzusok" mező is mutassa.
      clearRouteCache()
    } catch {
      // Hálózati hiba vagy időtúllépés — a művelet újrapróbálható marad.
      setErrorMessage(NETWORK_ERROR)
    } finally {
      setPending(false)
    }
  }, [clearRouteCache, email, products, reason, selectedProduct])

  if (isInitializing) {
    return (
      <div className="field-type" style={panelStyle}>
        <h3 style={{ marginTop: 0 }}>Kurzus ajándékozása</h3>
        <p style={noteStyle}>Betöltés…</p>
      </div>
    )
  }

  if (!hasStaffOrOwnerRole(user)) {
    return (
      <div className="field-type" style={panelStyle}>
        <h3 style={{ marginTop: 0 }}>Kurzus ajándékozása</h3>
        <p style={noteStyle}>
          Kurzust csak munkatárs vagy tulajdonos ajándékozhat.
        </p>
      </div>
    )
  }

  if (!email) {
    return (
      <div className="field-type" style={panelStyle}>
        <h3 style={{ marginTop: 0 }}>Kurzus ajándékozása</h3>
        <p style={noteStyle}>
          Előbb mentsd a felhasználót: az ajándékozás az e-mail-cím alapján történik.
        </p>
      </div>
    )
  }

  return (
    <div className="field-type" style={panelStyle}>
      <h3 style={{ marginTop: 0 }}>Kurzus ajándékozása</h3>
      <p style={noteStyle}>
        Kézi ajándékozás (elhibázott fizetés, ajándék kurzus). A művelet naplózásra kerül, és
        ismételt megadás esetén sem duplázódik.
      </p>

      {open ? (
        <>
          <div style={rowStyle}>
            <label
              htmlFor="kineticare-grant-product"
              style={{ display: 'block' }}
            >
              Kurzus
            </label>
            <select
              disabled={pending || loadingProducts}
              id="kineticare-grant-product"
              onChange={(event) => setSelectedProduct(event.target.value)}
              value={selectedProduct}
            >
              <option value="">
                {loadingProducts ? 'Kurzusok betöltése…' : 'Válassz kurzust…'}
              </option>
              {products.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div style={rowStyle}>
            <label htmlFor="kineticare-grant-reason" style={{ display: 'block' }}>
              Indok (kötelező)
            </label>
            <textarea
              disabled={pending}
              id="kineticare-grant-reason"
              onChange={(event) => setReason(event.target.value)}
              placeholder="Pl. elhibázott fizetés jóváírása"
              rows={2}
              style={{ maxWidth: '32rem', width: '100%' }}
              value={reason}
            />
          </div>

          <div style={rowStyle}>
            <Button
              buttonStyle="secondary"
              disabled={pending}
              onClick={() => {
                void submitGrant()
              }}
              size="medium"
            >
              {pending ? 'Ajándékozás folyamatban…' : 'Ajándékozom a kurzust'}
            </Button>
          </div>

          {productsError ? (
            <p role="alert" style={{ color: 'var(--theme-error-500)', marginBottom: 0 }}>
              {productsError}
            </p>
          ) : null}
        </>
      ) : (
        <div style={rowStyle}>
          <Button buttonStyle="secondary" onClick={openPanel} size="medium">
            Kurzus ajándékozása
          </Button>
        </div>
      )}

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

export default GrantPurchasePanel
