'use client'

import {
  Button,
  ConfirmationModal,
  useAuth,
  useDocumentInfo,
  useModal,
  useRouteCache,
} from '@payloadcms/ui'
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react'

import { hasStaffOrOwnerRole } from '../../access/roles'
import { useConfirmationDialogNames } from './confirmation-dialog-names'

/**
 * „Kurzus ajándékozása" panel a felhasználó szerkesztőnézetében
 * (users `type: 'ui'` mező).
 * KIZÁRÓLAG felület: a hozzáférés-adás logikája a POST
 * /api/admin/grant-purchase végponton fut (src/lib/grant-purchase-route.ts →
 * src/lib/grant-purchase.ts), munkatársi vagy tulajdonosi jogosultsággal,
 * idempotensen és strukturált audit-naplózással. A users.purchases mező
 * field-access szinten írás-zárt, ezért a panel a végpontot hívja.
 *
 * K12 (admin-audit, 2026-09-22), megjelenítési döntések:
 * - A kurzuslista a kurzus CÍMÉT mutatja (displayTitle), a belső azonosító
 *   (sku) csak tartalék: a munkatárs a vásárló nyelvén keres (NN/g, Match
 *   between the system and the real world,
 *   https://www.nngroup.com/articles/match-system-real-world/). Azonos
 *   feliratoknál a belső azonosító különbözteti meg őket (readProductOptions).
 *   A végpont továbbra is a kurzus adatbázis-azonosítóját kapja, a kérés
 *   változatlan.
 * - A natív mezők a B1 stílusszerződésének .kc-admin-input osztályát kapják
 *   (custom.scss): legalább 40 px magasak, a keretük mindkét témán ≥ 3:1
 *   (WCAG 2.2 SC 1.4.11, 2.5.8).
 * - A kitöltési példa súgószöveg, nem placeholder (WCAG 2.2 SC 3.3.2; NN/g,
 *   https://www.nngroup.com/articles/form-design-placeholders/), a hibaüzenet
 *   a mezőhöz kötött (GOV.UK Error message,
 *   https://design-system.service.gov.uk/components/error-message/).
 * - A megerősítés a Payload ConfirmationModal-ja „…” idézőjellel és a
 *   visszavonhatatlanság kimondásával (NN/g, Confirmation Dialogs,
 *   https://www.nngroup.com/articles/confirmation-dialog/).
 */

const REQUEST_TIMEOUT_MS = 20_000

/** A megerősítő ablak azonosítója (a Payload modal-kezelőjében). */
export const GRANT_CONFIRM_MODAL_SLUG = 'kineticare-ajandekozas-megerositese'

/** §2.7 / A/9: „Kérjük" nélkül, a következő lépés kimondva (lásd RefundPanel). */
const GENERIC_ERROR = 'Az ajándékozás most nem sikerült. Próbáld újra néhány perc múlva.'
const NETWORK_ERROR = 'Nem sikerült elérni a szervert. Ellenőrizd a kapcsolatot, és próbáld újra.'
const PRODUCTS_ERROR =
  'A kurzusok listája nem tölthető be. Frissítsd az oldalt, és nyisd meg újra a panelt.'
export const NO_PRODUCTS_MESSAGE = 'Nincs közzétett kurzus, amelyet ajándékozni lehetne.'
export const PRODUCT_REQUIRED_MESSAGE = 'Válaszd ki, melyik kurzust ajándékozod.'
export const REASON_REQUIRED_MESSAGE = 'Add meg az ajándékozás okát. Ez kerül a Műveletnaplóba.'
export const GRANT_IRREVERSIBLE_SENTENCE =
  'Az ajándékozás a Műveletnaplóba kerül, és az adminban nem vonható vissza.'

export interface ProductOption {
  value: string
  label: string
}

/** A dokumentum-adatokból a vásárló e-mail-címe (a végpont ez alapján old fel). */
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
  return typeof message === 'string' && message.trim().length > 0
    ? message
    : 'A kurzust ajándékoztam.'
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/** Összevetési kulcs: a két felirat akkor „ugyanaz”, ha trim után, kis- és nagybetűtől függetlenül egyezik. */
function labelKey(label: string): string {
  return label.trim().toLocaleLowerCase('hu')
}

/** Azok az indexek, amelyek felirata legalább egy másik opcióéval ütközik. */
function collidingIndexes(labels: readonly string[]): Set<number> {
  const byKey = new Map<string, number[]>()
  labels.forEach((label, index) => {
    const key = labelKey(label)
    byKey.set(key, [...(byKey.get(key) ?? []), index])
  })
  const colliding = new Set<number>()
  for (const indexes of byKey.values()) {
    if (indexes.length > 1) indexes.forEach((index) => colliding.add(index))
  }
  return colliding
}

/**
 * A products REST-válasz szűkítése választható elemekre: a felirat a kurzus
 * címe (displayTitle), ennek hiányában a belső azonosító (sku), végső
 * tartalékként az adatbázis-azonosító. A lista cím szerint, magyar ábécé
 * szerint rendezett, hogy a munkatárs a megszokott névsorban keressen.
 *
 * Összetéveszthetetlenség (az ajándékozás visszavonhatatlan): ha két vagy több
 * felirat azonos, minden ütköző opció megkapja a belső azonosítóját
 * („ (belső azonosító: <sku>)”), ha az nem üres és eltér a felirattól. Ha így
 * is marad ütközés, az adatbázis-azonosító különbözteti meg őket („ (#<id>)”).
 * A megerősítő ablak ugyanezt a feliratot mutatja; a végpont az id-t kapja
 * (WCAG 2.2 SC 2.4.6 és 3.3.4; NN/g, Confirmation Dialogs,
 * https://www.nngroup.com/articles/confirmation-dialog/).
 */
export function readProductOptions(body: unknown): ProductOption[] {
  if (typeof body !== 'object' || body === null) {
    return []
  }
  const docs = (body as Record<string, unknown>).docs
  if (!Array.isArray(docs)) {
    return []
  }
  const entries: { id: string; sku: string | null; label: string }[] = []
  for (const doc of docs) {
    if (typeof doc !== 'object' || doc === null) {
      continue
    }
    const record = doc as Record<string, unknown>
    const id = record.id
    if (typeof id !== 'number' && typeof id !== 'string') {
      continue
    }
    const sku = nonEmptyText(record.sku)
    entries.push({
      id: String(id),
      sku,
      label: nonEmptyText(record.displayTitle) ?? sku ?? `#${String(id)}`,
    })
  }
  const labels = entries.map((entry) => entry.label)
  for (const index of collidingIndexes(labels)) {
    const { sku } = entries[index]
    if (sku && labelKey(sku) !== labelKey(labels[index])) {
      labels[index] = `${labels[index]} (belső azonosító: ${sku})`
    }
  }
  // Tartalék: az adatbázis-azonosító opciónként legfeljebb egyszer kerül a
  // feliratra, így a ciklus véges, és egyedi id mellett minden felirat egyedi.
  const withId = new Set<number>()
  const stillColliding = () => [...collidingIndexes(labels)].filter((index) => !withId.has(index))
  for (let remaining = stillColliding(); remaining.length > 0; remaining = stillColliding()) {
    for (const index of remaining) {
      labels[index] = `${labels[index]} (#${entries[index].id})`
      withId.add(index)
    }
  }
  return entries
    .map((entry, index) => ({ value: entry.id, label: labels[index] }))
    .sort((a, b) => a.label.localeCompare(b.label, 'hu'))
}

/** A megerősítő ablak törzse: melyik kurzust ki kapja meg. */
export function grantConfirmDetail(courseLabel: string, email: string): string {
  return `„${courseLabel}” kurzus: ${email} hozzáférést kap.`
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

const labelStyle: CSSProperties = {
  display: 'block',
  fontWeight: 600,
}

const errorStyle: CSSProperties = {
  color: 'var(--theme-error-500)',
  margin: 'calc(var(--base) * 0.25) 0 0',
}

/** Csak felolvasónak (GOV.UK Error message: rejtett „Error:” előtag). */
const visuallyHidden: CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

type GrantField = 'product' | 'reason'

interface PendingGrant {
  email: string
  productId: string
  reason: string
  label: string
}

export function GrantPurchasePanel() {
  const { data, isInitializing } = useDocumentInfo()
  const { user } = useAuth<{ id: number | string; role?: string | null }>()
  const { clearRouteCache } = useRouteCache()
  const { closeModal, isModalOpen, openModal } = useModal()

  const [open, setOpen] = useState(false)
  const [products, setProducts] = useState<ProductOption[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [productsError, setProductsError] = useState<string | null>(null)
  const [noProducts, setNoProducts] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState('')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<GrantField | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [confirmDetail, setConfirmDetail] = useState<string | null>(null)
  // A megerősítő ablakban jóváhagyásra váró kérés: pontosan azt küldjük el,
  // amit a munkatárs az ablakban látott.
  const pendingGrant = useRef<PendingGrant | null>(null)

  // Állandó azonosítók: a korábbi mérések (B1, admin-audit) ezekre hivatkoznak.
  const productId = 'kineticare-grant-product'
  const reasonId = 'kineticare-grant-reason'
  const reasonHintId = useId()
  const errorId = useId()
  const confirmHeadingId = useId()
  const confirmBodyId = useId()
  const confirmOpen = isModalOpen(GRANT_CONFIRM_MODAL_SLUG)
  useConfirmationDialogNames(GRANT_CONFIRM_MODAL_SLUG, confirmOpen, confirmHeadingId, confirmBodyId)

  const email = readUserEmail(data)

  // Másik felhasználó megnyitásakor vagy a panel eltűnésekor a nyitva hagyott
  // megerősítés is megszűnik.
  useEffect(
    () => () => {
      pendingGrant.current = null
      closeModal(GRANT_CONFIRM_MODAL_SLUG)
    },
    [email, closeModal],
  )

  const loadProducts = useCallback(async (): Promise<void> => {
    setLoadingProducts(true)
    setProductsError(null)
    setNoProducts(false)
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
      setNoProducts(options.length === 0)
    } catch {
      setProductsError(NETWORK_ERROR)
    } finally {
      setLoadingProducts(false)
    }
  }, [])

  const openPanel = useCallback((): void => {
    setOpen(true)
    setErrorMessage(null)
    setFieldError(null)
    setSuccessMessage(null)
    void loadProducts()
  }, [loadProducts])

  const showFieldError = (field: GrantField, message: string): void => {
    setSuccessMessage(null)
    setFieldError(field)
    setErrorMessage(message)
    // GOV.UK: a hiba a mezőnél áll, és a fókusz oda kerül, ahol javítani kell.
    document.getElementById(field === 'product' ? productId : reasonId)?.focus()
  }

  // 1. lépés: ellenőrzés, majd a megerősítő ablak. Itt még nem történik írás.
  const requestGrant = (): void => {
    if (!email || pending) {
      return
    }
    if (selectedProduct.length === 0) {
      showFieldError('product', PRODUCT_REQUIRED_MESSAGE)
      return
    }
    if (reason.trim().length === 0) {
      showFieldError('reason', REASON_REQUIRED_MESSAGE)
      return
    }
    const label =
      products.find((option) => option.value === selectedProduct)?.label ?? selectedProduct
    setErrorMessage(null)
    setFieldError(null)
    pendingGrant.current = { email, productId: selectedProduct, reason: reason.trim(), label }
    setConfirmDetail(grantConfirmDetail(label, email))
    openModal(GRANT_CONFIRM_MODAL_SLUG)
  }

  // 2. lépés: a jóváhagyott kérés elküldése (a végpont és a törzs változatlan).
  const submitGrant = async (): Promise<void> => {
    const grant = pendingGrant.current
    pendingGrant.current = null
    if (!grant || grant.email !== email) {
      return
    }
    setPending(true)
    setErrorMessage(null)
    setFieldError(null)
    setSuccessMessage(null)
    try {
      const response = await fetch('/api/admin/grant-purchase', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: grant.email,
          productIdOrSku: grant.productId,
          reason: grant.reason,
        }),
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
      // Hálózati hiba vagy időtúllépés: a művelet újrapróbálható marad.
      setErrorMessage(NETWORK_ERROR)
    } finally {
      setPending(false)
    }
  }

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
        <p style={noteStyle}>Kurzust csak munkatárs vagy tulajdonos ajándékozhat.</p>
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

  const describedBy = (field: GrantField, base?: string): string | undefined => {
    const ids = [base, fieldError === field ? errorId : undefined].filter(Boolean)
    return ids.length > 0 ? ids.join(' ') : undefined
  }

  // GOV.UK Error message: a mezőhiba a címke (és a súgó) után, a mező előtt áll,
  // és a mezőhöz kötött; a fókusz a mezőre kerül, ezért élő régió nem kell.
  const fieldErrorText = (field: GrantField) =>
    fieldError === field && errorMessage ? (
      <p data-kc-uzenet="mezohiba" id={errorId} style={errorStyle}>
        <span style={visuallyHidden}>Hiba: </span>
        {errorMessage}
      </p>
    ) : null

  return (
    <div className="field-type" style={panelStyle}>
      <h3 style={{ marginTop: 0 }}>Kurzus ajándékozása</h3>
      <p style={noteStyle}>
        Akkor használd, ha egy fizetés elakadt, vagy ajándékba adsz kurzust. Az ajándékozás a
        Műveletnaplóba kerül, és ha véletlenül kétszer indítod, akkor sem jön létre kétszer.
      </p>

      {open ? (
        <>
          <div style={rowStyle}>
            <label htmlFor={productId} style={labelStyle}>
              Kurzus
            </label>
            {fieldErrorText('product')}
            <select
              aria-describedby={describedBy('product')}
              aria-invalid={fieldError === 'product' ? true : undefined}
              className="kc-admin-input"
              disabled={pending || loadingProducts}
              id={productId}
              onChange={(event) => setSelectedProduct(event.target.value)}
              style={{ maxWidth: '32rem', width: '100%' }}
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
            <label htmlFor={reasonId} style={labelStyle}>
              Indok (kötelező)
            </label>
            <p id={reasonHintId} style={{ ...noteStyle, marginBottom: 'calc(var(--base) * 0.25)' }}>
              A Műveletnaplóba kerül. Például: elhibázott fizetés jóváírása.
            </p>
            {fieldErrorText('reason')}
            <textarea
              aria-describedby={describedBy('reason', reasonHintId)}
              aria-invalid={fieldError === 'reason' ? true : undefined}
              className="kc-admin-input"
              disabled={pending}
              id={reasonId}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              style={{ maxWidth: '32rem', width: '100%' }}
              value={reason}
            />
          </div>

          <div style={rowStyle}>
            <Button buttonStyle="secondary" disabled={pending} onClick={requestGrant} size="medium">
              {pending ? 'Ajándékozás folyamatban…' : 'Ajándékozom a kurzust'}
            </Button>
          </div>

          {productsError ? (
            <p role="alert" style={errorStyle}>
              {productsError}
            </p>
          ) : null}
          {noProducts ? (
            <p role="status" style={{ ...noteStyle, marginTop: 'calc(var(--base) * 0.25)' }}>
              {NO_PRODUCTS_MESSAGE}
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

      {errorMessage && fieldError === null ? (
        <p data-kc-uzenet="hiba" role="alert" style={errorStyle}>
          {errorMessage}
        </p>
      ) : null}
      {successMessage ? (
        <p
          data-kc-uzenet="siker"
          role="status"
          style={{ color: 'var(--theme-success-500)', margin: 'calc(var(--base) * 0.25) 0 0' }}
        >
          {successMessage}
        </p>
      ) : null}
      <ConfirmationModal
        body={
          confirmDetail ? (
            <div id={confirmBodyId}>
              <p>{confirmDetail}</p>
              <p>
                <strong>{GRANT_IRREVERSIBLE_SENTENCE}</strong>
              </p>
            </div>
          ) : null
        }
        cancelLabel="Mégse"
        confirmLabel="Ajándékozom a kurzust"
        heading={<h1 id={confirmHeadingId}>Ajándékozod a kurzust?</h1>}
        modalSlug={GRANT_CONFIRM_MODAL_SLUG}
        onCancel={() => {
          pendingGrant.current = null
        }}
        onConfirm={() => {
          // Az ablak azonnal bezárul; a folyamatot a panel gombja és az
          // eredményüzenet mutatja.
          void submitGrant()
        }}
      />
    </div>
  )
}

export default GrantPurchasePanel
