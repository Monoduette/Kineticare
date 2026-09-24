'use client'

import Script from 'next/script'
import { useCallback, useEffect, useRef } from 'react'

import {
  TURNSTILE_POLL_MS,
  TURNSTILE_SCRIPT_SRC,
  TURNSTILE_WAIT_MS,
  turnstileSize,
} from '@/app/(frontend)/kapcsolat/_components/TurnstileWidget'

/**
 * A pénztár LÁTHATATLAN Turnstile-ellenőrzése (a-checkout-9).
 *
 * MIÉRT NEM A KÖZÖS `TurnstileWidget`: az a kapcsolat-űrlapok látható
 * („managed", mindig kirajzolt) widgetje. A pénztárban a fizetőgomb előtti
 * utolsó lépésnél egy újabb látható doboz zavaró volna; a Cloudflare
 * `appearance: 'interaction-only'` beállítása ugyanazzal a site key-jel a
 * widgetet CSAK akkor mutatja, ha a látogatótól tényleg interakció kell
 * („The widget becomes visible only when visitor interaction is required.",
 * https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/).
 * A szkript-forrás, a várakozási korlát és a méretválasztás a közös modulból
 * jön, hogy a két út ne csússzon szét.
 *
 * A token EGYSZER használható és 300 mp után lejár (ugyanott: „Tokens are
 * single-use and expire after 300 seconds"). A lejáratot a widget
 * `refresh-expired: 'auto'` alapbeállítása magától frissíti; a
 * felhasznált tokent a `resetKey` növelése cseréli újra (sikertelen beküldés,
 * „vissza" gombos visszatérés).
 *
 * HIBA: ha a szkript nem töltődik be (reklámblokkoló, hálózat), vagy az
 * ellenőrzés hibát jelez, az `onError` szól; a pénztár ilyenkor a gomb
 * megnyomásakor érthető magyar üzenetet ad (form-submission.ts
 * CHECKOUT_TURNSTILE_FAILED_ERROR), nem hallgat.
 */
export interface CheckoutTurnstileProps {
  siteKey: string
  onToken: (token: string | null) => void
  onError: () => void
  /** Minden változása új ellenőrzést kér (az első render kivételével). */
  resetKey: number
}

export function CheckoutTurnstile({ siteKey, onToken, onError, resetKey }: CheckoutTurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const onTokenRef = useRef(onToken)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onTokenRef.current = onToken
    onErrorRef.current = onError
  }, [onToken, onError])

  const renderWidget = useCallback(() => {
    const container = containerRef.current
    if (!container || !window.turnstile || widgetIdRef.current !== null) {
      return
    }
    // A közös típusleírás (TurnstileWidget.tsx) az `appearance` kulcsot nem
    // sorolja fel; a Cloudflare render-API-ja elfogadja (lásd a fejkommentet).
    const options = {
      sitekey: siteKey,
      callback: (token: string) => onTokenRef.current(token),
      'expired-callback': () => onTokenRef.current(null),
      'error-callback': () => {
        onTokenRef.current(null)
        onErrorRef.current()
      },
      language: 'hu',
      size: turnstileSize(container.clientWidth),
      appearance: 'interaction-only' as const,
    }
    widgetIdRef.current = window.turnstile.render(container, options)
  }, [siteKey])

  // Ha az API már betöltődött, azonnal rajzolunk; ha még töltődik, rövid
  // időközönként figyeljük (legfeljebb TURNSTILE_WAIT_MS-ig), utána hibát
  // jelzünk — a közös widget bevált életciklusa.
  useEffect(() => {
    renderWidget()
    let varakozas: ReturnType<typeof setInterval> | undefined
    if (widgetIdRef.current === null) {
      const kezdet = Date.now()
      varakozas = setInterval(() => {
        if (window.turnstile) {
          renderWidget()
        }
        if (widgetIdRef.current !== null) {
          clearInterval(varakozas)
        } else if (Date.now() - kezdet > TURNSTILE_WAIT_MS) {
          clearInterval(varakozas)
          onTokenRef.current(null)
          onErrorRef.current()
        }
      }, TURNSTILE_POLL_MS)
    }
    return () => {
      if (varakozas !== undefined) {
        clearInterval(varakozas)
      }
      const widgetId = widgetIdRef.current
      widgetIdRef.current = null
      if (widgetId !== null) {
        try {
          window.turnstile?.remove(widgetId)
        } catch {
          // A már eltávolított widget nem hiba.
        }
      }
    }
  }, [renderWidget])

  const elozoResetKey = useRef(resetKey)
  useEffect(() => {
    if (elozoResetKey.current === resetKey) {
      return
    }
    elozoResetKey.current = resetKey
    onTokenRef.current(null)
    const widgetId = widgetIdRef.current
    if (widgetId !== null) {
      window.turnstile?.reset(widgetId)
    }
  }, [resetKey])

  return (
    <>
      <Script
        onError={() => {
          onTokenRef.current(null)
          onErrorRef.current()
        }}
        onLoad={renderWidget}
        onReady={renderWidget}
        src={TURNSTILE_SCRIPT_SRC}
        strategy="afterInteractive"
      />
      <div className="kc-checkout-turnstile" ref={containerRef} />
    </>
  )
}
