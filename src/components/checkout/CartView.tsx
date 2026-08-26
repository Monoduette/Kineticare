'use client'

import Link from 'next/link'
import { useEffect } from 'react'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PriceTag } from '@/components/ui/PriceTag'
import {
  CART_FREE_LABEL,
  cartItemAvailability,
  cartItemNote,
  cartScopeNote,
  useCart,
  type CartItem,
} from '../../lib/cart'
import { COURSE_BASE_PATH, courseCtaHref, courseHref } from '../../lib/course-url'
import { checkoutHref } from '../../lib/courses'
import { ctaLabel } from '../../lib/cta-vocabulary'

/**
 * CartView — kosár megjelenítés (localStorage + /kosar?termek= konvenció).
 * Tételenkénti cselekvés a sorban; a sáv csak összeg + következő lépés.
 * Blokkolt ág: nincs letiltott gomb (GOV.UK); egy primary a sávban.
 * Feliratok: cta-vocabulary.ts (G-UI1 őr).
 */
export interface CartViewProps {
  initialItem: CartItem | null
  isLoggedIn: boolean
}

/**
 * Egy kosártétel sora — a saját ár-állapotával, magyarázatával és cselekvésével.
 *
 * A sor SOSEM mutat árat a nem vásárolható tételre: ez az első a négy rétegből,
 * ami megakadályozza, hogy a látogató azt higgye, azért is fizet.
 */
function CartRow({ item, onRemove }: { item: CartItem; onRemove: () => void }) {
  const availability = cartItemAvailability(item)
  const note = cartItemNote(item)

  return (
    <li className="kc-cart__item">
      <Card padded>
        <div className="kc-cart__row">
          <div className="kc-cart__info">
            <Link
              className="kc-cart__title"
              href={courseHref({ id: item.productId, slug: item.slug })}
            >
              {item.sku}
            </Link>
            {item.shortDescription ? (
              <p className="kc-cart__description">{item.shortDescription}</p>
            ) : null}
            {/* A blokkoló ok a tétel MELLETT áll, nem a sáv aljában: NN/g
                szerint a hibaüzenet ott a leghasznosabb, ahol a probléma van. */}
            {note ? <p className="kc-cart__note">{note}</p> : null}
          </div>
          <div className="kc-cart__price">
            {availability === 'free' ? (
              <span className="kc-cart__free">{CART_FREE_LABEL}</span>
            ) : availability === 'paid' && item.priceHuf !== null ? (
              <PriceTag priceHuf={item.priceHuf} />
            ) : null}
          </div>
          {/* A tétel neve REJTETT szövegként a gombokon belül: több tételnél a
              puszta felirat nem egyedi (WCAG 2.2 SC 2.4.4), a `Button` pedig
              az `aria-label`-t nem adja tovább a DOM-nak. */}
          <div className="kc-cart__actions">
            {availability === 'free' ? (
              // Az ingyenes tétel NEM hiba: saját, működő útja van. Az igénylő
              // űrlap a kurzusoldalon áll — ugyanoda küld tovább az ingyenes
              // termék /penztar-ja is. A súly a szótár szerinti `secondary`
              // (§3.2 C-2), így a lap egyetlen elsődleges gombja a sávé marad.
              <Button
                href={courseCtaHref({ id: item.productId, slug: item.slug })}
                size="sm"
                variant="secondary"
              >
                {ctaLabel('free-course-claim')}
                <span className="kc-visually-hidden">: {item.sku}</span>
              </Button>
            ) : null}
            <Button onClick={onRemove} size="sm" variant="ghost">
              {ctaLabel('cart-remove-item')}
              <span className="kc-visually-hidden">: {item.sku}</span>
            </Button>
          </div>
        </div>
      </Card>
    </li>
  )
}

export function CartView({ initialItem, isLoggedIn }: CartViewProps) {
  const { state, add, remove, summary, isEmpty } = useCart()

  useEffect(() => {
    if (initialItem) {
      add(initialItem)
    }
    // Az `add` a useCartból stabil (useCallback) — az effekt KLIENS-NAVIGÁCIÓNÁL
    // is újrafut: /kosar?termek=A → /kosar?termek=B váltásnál B is bekerül.
  }, [initialItem, add])

  if (isEmpty && !initialItem) {
    return (
      <div className="kc-cart-empty" role="status">
        <p>A kosarad jelenleg üres.</p>
        <Button href={COURSE_BASE_PATH}>{ctaLabel('course-list-open')}</Button>
      </div>
    )
  }

  // A pénztár szerver-oldala csak a ?termek= query-t látja (a kosár
  // localStorage-os) — a link a CÉLTÉTEL id-jét viszi. A cél az első MEGVEHETŐ
  // tétel, nem az első tétel: lásd a `cartSummary` indoklását.
  const target = summary.target
  // Mire vonatkozik a fizetés? Csak akkor mondjuk ki, ha a kosárban a fizetett
  // tételen kívül más is van — különben fölösleges zaj lenne.
  const scopeNote = cartScopeNote(summary)

  return (
    <div className="kc-cart">
      <ul className="kc-cart__list" role="list">
        {state.items.map((item) => (
          <CartRow item={item} key={item.productId} onRemove={() => remove(item.productId)} />
        ))}
      </ul>

      <div className="kc-cart__summary">
        {summary.totalLabel === null ? null : (
          <p className="kc-cart__total">
            Végösszeg: <strong>{summary.totalLabel}</strong>
          </p>
        )}
        {/* A fizetés HATÓKÖRE közvetlenül a végösszeg alatt: a látogató itt
            tudja meg, hogy a kosárban maradó többi tételért most nem fizet. */}
        {scopeNote ? <p className="kc-cart__scope">{scopeNote}</p> : null}
        {summary.kind === 'amount' ? (
          <p className="kc-cart__total-note">
            A fizetendő végösszeget a rendszer a fizetéskor, a szerveren újraszámolja.
          </p>
        ) : null}

        {/* Alternatíva CSAK akkor, ha a kosárban semmi nem vihető tovább:
            Baymard szerint a puszta tiltás mellől 30% máshol keres tovább. Ha
            van fizetés-út, ez a gomb kimarad, mert két elsődleges gomb egy
            lapon gyengíti egymást (GOV.UK, Button). */}
        {summary.kind === 'blocked' ? (
          <Button href={COURSE_BASE_PATH}>{ctaLabel('course-list-open')}</Button>
        ) : null}

        {summary.kind === 'amount' && target !== null ? (
          isLoggedIn ? (
            <Button href={checkoutHref(target.productId)}>{ctaLabel('cart-to-checkout')}</Button>
          ) : (
            // B6 (docs/gomb-inventar.md): a kosár bejelentkezésre kényszerít,
            // miközben a /penztar 2026-08-15 óta vendég-vásárlást is enged. A
            // feloldás az informacios-architektura.md 8. fejezetének javítási
            // terve szerint halad, NEM innen — ez az ág addig változatlan.
            <Button href={`/belepes?returnUrl=${encodeURIComponent(checkoutHref(target.productId))}`}>
              Belépés a fizetéshez
            </Button>
          )
        ) : null}
      </div>
    </div>
  )
}
