'use client'

import Link from 'next/link'
import { useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { GENERIC_UPDATE_ERROR, updateProfile, type ProfileUpdateInput } from '../../lib/account-client'
import type { CourseAccessView } from '../../lib/course-access'
import { courseHref } from '../../lib/course-url'
import { courseTitle } from '../../lib/courses'
import { ctaLabel, ctaProgressLabel } from '../../lib/cta-vocabulary'
import { formatPriceHuf } from '../../lib/format-price'
import { isTrustedInvoicePdfUrl } from '../../lib/szamlazz/invoice-url'
import { WITHDRAWAL_LINK_LABEL, withdrawalHref } from '../../lib/withdrawal/client'
import type { Order, User } from '../../payload-types'

/**
 * AccountView — a fiók áttekintése (adataim, rendeléseim, kurzusaim).
 *
 * A kurzusoknál a hozzáférés lejárata is látszik (A1); a szöveget a szerver
 * állítja elő (src/lib/course-access.ts), itt már csak megjelenítés történik.
 */
export interface AccountViewProps {
  user: User
  orders: Order[]
  /** productId → hozzáférés-állapot; hiányzó bejegyzés = korlátlan hozzáférés. */
  accessByProductId?: Record<number, CourseAccessView>
}

const ORDER_STATUS_LABELS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  created: { label: 'Létrehozva', tone: 'neutral' },
  payment_pending: { label: 'Fizetés folyamatban', tone: 'warning' },
  paid: { label: 'Fizetve', tone: 'success' },
  payment_failed: { label: 'Sikertelen fizetés', tone: 'danger' },
  cancelled: { label: 'Törölve', tone: 'neutral' },
  refunded: { label: 'Visszatérítve', tone: 'info' },
}

/**
 * A profilmentés visszajelzése — a hiba- és a sikerág egy helyen, külön
 * kiszedve, hogy a node-környezetű teszt (renderToStaticMarkup) is elérje.
 * A hibaág az account-client magyar üzenetét mutatja, role="alert"-tel.
 */
export function ProfileSaveFeedback({
  saved,
  saveError,
}: {
  saved: boolean
  saveError: string | null
}) {
  if (saveError !== null) {
    return (
      <span className="kc-account__error" role="alert">
        {saveError}
      </span>
    )
  }
  if (saved) {
    return (
      <span className="kc-account__saved" role="status">
        Mentve.
      </span>
    )
  }
  return null
}

export function AccountView({ accessByProductId, user, orders }: AccountViewProps) {
  const [profile, setProfile] = useState<ProfileUpdateInput>({
    name: user.name ?? '',
    billingName: user.billingName ?? '',
    billingZip: user.billingZip ?? '',
    billingCity: user.billingCity ?? '',
    billingStreet: user.billingStreet ?? '',
    taxNumber: user.taxNumber ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  /** A profilmentés hibaüzenete (magyar) — korábban NÉMA volt a hibaág. */
  const [saveError, setSaveError] = useState<string | null>(null)

  const update = (key: keyof ProfileUpdateInput, value: string) => {
    setProfile((previous) => ({ ...previous, [key]: value }))
    setSaved(false)
    setSaveError(null)
  }

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    setSaveError(null)
    const result = await updateProfile(profile)
    setSaving(false)
    if (result.ok) {
      setSaved(true)
    } else {
      // A hibaág is magyar visszajelzést ad — az account-client üzenetével.
      setSaveError(result.message ?? GENERIC_UPDATE_ERROR)
    }
  }

  const purchasedProducts = Array.isArray(user.purchases) ? user.purchases : []

  return (
    <div className="kc-account">
      <Card className="kc-account__section">
        <h2>Adataim</h2>
        <div className="kc-account__grid">
          <Field
            label="Név"
            name="name"
            onChange={(event) => update('name', event.target.value)}
            value={profile.name ?? ''}
          />
          <Field
            label="E-mail-cím"
            name="email"
            readOnly
            value={user.email ?? ''}
          />
          <Field
            label="Számlázási név"
            name="billingName"
            onChange={(event) => update('billingName', event.target.value)}
            value={profile.billingName ?? ''}
          />
          <Field
            label="Irányítószám"
            name="billingZip"
            onChange={(event) => update('billingZip', event.target.value)}
            value={profile.billingZip ?? ''}
          />
          <Field
            label="Település"
            name="billingCity"
            onChange={(event) => update('billingCity', event.target.value)}
            value={profile.billingCity ?? ''}
          />
          <Field
            label="Cím"
            name="billingStreet"
            onChange={(event) => update('billingStreet', event.target.value)}
            value={profile.billingStreet ?? ''}
          />
          <Field
            hint="Csak céges vásárlás esetén."
            label="Adószám"
            name="taxNumber"
            onChange={(event) => update('taxNumber', event.target.value)}
            value={profile.taxNumber ?? ''}
          />
        </div>
        <div className="kc-account__actions">
          {/* A felirat és a folyamatban-alakja is a §3.2 szótárból (#31 és L-1). */}
          <Button disabled={saving} onClick={handleSave}>
            {saving ? ctaProgressLabel('profile-save') : ctaLabel('profile-save')}
          </Button>
          <ProfileSaveFeedback saved={saved} saveError={saveError} />
        </div>
      </Card>

      <Card className="kc-account__section">
        <h2>Kurzusaim</h2>
        {/* Az üres állapot felirata a §3.2 #10 szótári sora: a kurzuskínálatra
            vivő hivatkozás mindenhol ugyanazt mondja (WCAG 2.2 · 3.2.4). A
            korábbi „Nézd meg a kurzusainkat" birtokos alak a mért nyolc
            párhuzamos felirat egyike volt. A tagmondatokat kettőspont
            választja, nem kvirtmínusz (§3.1.1). */}
        {purchasedProducts.length === 0 ? (
          <p>
            Még nincs kurzusod. <Link href="/kurzusok">{ctaLabel('course-list-open')}</Link>: az
            első ingyenes is lehet.
          </p>
        ) : (
          <ul className="kc-account__courses" role="list">
            {purchasedProducts.map((entry) => {
              const product = typeof entry === 'object' && entry !== null ? entry : null
              const productId = product?.id ?? (typeof entry === 'number' ? entry : null)
              if (productId === null) {
                return null
              }
              const access = accessByProductId?.[productId]
              const expired = access?.hasAccess === false
              return (
                <li key={productId}>
                  <a
                    className="kc-account__course"
                    href={
                      expired
                        ? // Nem populate-olt bejegyzésnél nincs slug — a régi,
                          // id-alapú cím marad, amit a route átirányít.
                          courseHref(product ?? { id: productId })
                        : `/kurzusaim/${productId}`
                    }
                  >
                    {product ? courseTitle(product) : `Kurzus #${productId}`}
                  </a>
                  {expired ? (
                    <span className="kc-course-access kc-course-access--expired">
                      {access?.expiredMessage}
                    </span>
                  ) : access?.expiryLabel ? (
                    <span className="kc-course-access">{access.expiryLabel}</span>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card className="kc-account__section">
        <h2>Rendeléseim</h2>
        {orders.length === 0 ? (
          <p>Még nincs rendelésed.</p>
        ) : (
          <ul className="kc-account__orders" role="list">
            {orders.map((order) => {
              const status = (order.status ? ORDER_STATUS_LABELS[order.status] : undefined) ?? {
                label: order.status ?? 'Ismeretlen',
                tone: 'neutral' as const,
              }
              const total = typeof order.totalHufSnapshot === 'number' ? order.totalHufSnapshot : null
              /*
               * A számlalink RENDERELÉSKOR is átmegy az allowlisten
               * (src/lib/szamlazz/invoice-url.ts), nem csak íráskor.
               *
               * Íráskor a Számlázz.hu válaszából érkező `vevoifiokurl` már
               * szűrve mentődik (src/lib/szamlazz/invoice.ts), DE az
               * `orders.invoicePdfUrl` az adminban közönséges, szerkeszthető
               * szövegmező (src/plugins/ecommerce.ts): nincs rajta `readOnly`
               * és nincs field-szintű access, tehát staff/owner kézzel bármit
               * beírhat — és az az érték itt, a VÁSÁRLÓ fiókjában kerülne
               * `href`-be. A védelemnek ezért ott is kell lennie, ahol a link
               * ténylegesen keletkezik.
               */
              const invoiceHref =
                typeof order.invoicePdfUrl === 'string' && isTrustedInvoicePdfUrl(order.invoicePdfUrl)
                  ? order.invoicePdfUrl
                  : null
              return (
                <li key={order.id} className="kc-account__order">
                  <div className="kc-account__order-row">
                    <span className="kc-account__order-number">{order.orderNumber}</span>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  <div className="kc-account__order-meta">
                    <span>{order.createdAt ? new Date(order.createdAt).toLocaleDateString('hu-HU') : ''}</span>
                    {total !== null ? <span>{formatPriceHuf(total)}</span> : null}
                    {invoiceHref ? (
                      <a href={invoiceHref} target="_blank" rel="noopener noreferrer">
                        {ctaLabel('invoice-download')}
                      </a>
                    ) : order.invoicePdfUrl ? (
                      // Van tárolt cím, de nem megbízható — a link NEM renderelődik
                      // linkként. A szöveg nem hazudik „feldolgozás alatt"-ot: a
                      // számla létezhet, csak ez a hivatkozás nem használható.
                      <span className="kc-account__order-invoice-pending">
                        A számla letöltése átmenetileg nem érhető el
                      </span>
                    ) : order.status === 'paid' ? (
                      <span className="kc-account__order-invoice-pending">A számla feldolgozás alatt</span>
                    ) : null}
                    {/* Elállási funkció a fizetett rendelésnél, előtöltött
                        rendelésszámmal (45/2014. Korm. rendelet 22. § (1b)). */}
                    {order.status === 'paid' && order.orderNumber ? (
                      <Link href={withdrawalHref(order.orderNumber)}>{WITHDRAWAL_LINK_LABEL}</Link>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
