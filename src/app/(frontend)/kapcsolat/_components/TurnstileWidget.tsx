'use client'

import Script from 'next/script'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * TurnstileWidget — Cloudflare Turnstile spam-ellenőrző widget (T-016).
 *
 * Csak akkor kerül a DOM-ba, ha a TURNSTILE_SITE_KEY be van állítva (ezt a
 * szerver-oldali page dönti el, és az űrlapok csak ekkor renderelik ezt a
 * komponenst). Kulcs nélkül a spam-védelem a szerveren is inaktív — ilyenkor
 * a widget rejtve marad, a beküldés akadálytalan.
 *
 * Nulla extra függőség: a hivatalos api.js-t next/script-tel töltjük, és a
 * window.turnstile.render explicit módját használjuk (managed mód).
 *
 * MÁSODIK PÉLDÁNY (hiba, mérve 2026-09-24, éles oldal, Chromium): a korábbi
 * `onLoad` a next/script-ben CSAK a szkript első betöltésekor fut le, ezért a
 * később megjelenő widget (a lábléc hírlevele után a /kapcsolat időpontkérése,
 * vagy lapváltás után bármelyik űrlap) sosem rajzolódott ki, és az űrlap nem
 * volt beküldhető. Az `onReady` a betöltéskor ÉS minden későbbi mountkor fut
 * (Next.js, Script component: https://nextjs.org/docs/app/api-reference/components/script#onready),
 * a mount-effekt pedig a már betöltött API-ra azonnal rajzol. Unmountkor a
 * widget eltávolítása (`turnstile.remove`) a Cloudflare ajánlott életciklusa
 * (Client-side rendering, „Optional calls”):
 * https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
 *
 * SZÉLESSÉG: a normál widget fix 300 px, ami 320 px-es kijelzőn vízszintes
 * görgetést okozott (WCAG 2.2 SC 1.4.10 Reflow). 300 px-nél keskenyebb
 * tárolóban a kompakt (150 px) változat rajzolódik:
 * https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/#widget-sizes
 */

interface TurnstileRenderOptions {
  sitekey: string
  callback: (token: string) => void
  'expired-callback'?: () => void
  'error-callback'?: () => void
  language?: string
  size?: 'normal' | 'flexible' | 'compact'
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string
  reset: (widgetId: string) => void
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

/** A normál widget szélessége (Cloudflare); ennél keskenyebb helyen kompakt. */
export const TURNSTILE_NORMAL_WIDTH_PX = 300

/**
 * Az űrlapok üzenete, ha a spam-ellenőrzés nem töltődött be (hálózat,
 * reklámblokkoló): a „még fut" itt félrevezető volna, mert sosem ér véget.
 */
export const TURNSTILE_UNAVAILABLE_ERROR =
  'A spam-ellenőrzés nem töltődött be, ezért most nem tudjuk elküldeni az űrlapot. Frissítsd az oldalt, és próbáld újra.'

export const TURNSTILE_SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/** A betöltés alatt álló közös api.js figyelése: időköz és felső korlát. */
export const TURNSTILE_POLL_MS = 200
export const TURNSTILE_WAIT_MS = 30_000

/** A tároló szélességéhez illő widget-méret. */
export function turnstileSize(containerWidth: number): 'normal' | 'compact' {
  return containerWidth > 0 && containerWidth < TURNSTILE_NORMAL_WIDTH_PX ? 'compact' : 'normal'
}

export interface TurnstileWidgetProps {
  siteKey: string
  /** Sikeres ellenőrzéskor kapjuk a tokent (a beküldéshez); lejárat/hiba után null. */
  onToken: (token: string | null) => void
  /**
   * Minden változása új ellenőrzést kér (a token egyszer használható: sikertelen
   * beküldés után a régi tokennel az újraküldés is elbukna).
   */
  resetKey?: number
  /** A szkript vagy az ellenőrzés hibája (az űrlap a „még fut" helyett mást mond). */
  onError?: () => void
}

export function TurnstileWidget({ siteKey, onToken, resetKey = 0, onError }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const sizeRef = useRef<'normal' | 'compact' | null>(null)
  const [scriptFailed, setScriptFailed] = useState(false)

  // A legfrissebb visszahívások ref-ben: a widget egyszer rajzolódik, de a
  // szülő új függvényt adhat minden renderben.
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
    const size = turnstileSize(container.clientWidth)
    sizeRef.current = size
    widgetIdRef.current = window.turnstile.render(container, {
      sitekey: siteKey,
      callback: (token) => onTokenRef.current(token),
      'expired-callback': () => onTokenRef.current(null),
      'error-callback': () => {
        onTokenRef.current(null)
        onErrorRef.current?.()
      },
      language: 'hu',
      size,
    })
  }, [siteKey])

  // Ha az API már betöltődött (másik űrlap vagy korábbi lap tette be), a
  // mount azonnal rajzol. Ha a közös api.js még ÉPP töltődik (egy másik widget
  // indította), a next/script a várakozó példányt nem az onReady-vel értesíti:
  // ilyenkor rövid időközönként figyeljük az API megjelenését (legfeljebb
  // TURNSTILE_WAIT_MS-ig). Unmountkor takarít.
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
          // Se betöltés, se hibaesemény (elakadt kérés, bővítmény): a widget
          // elérhetetlen, az űrlap ne mondja tovább, hogy az ellenőrzés fut.
          clearInterval(varakozas)
          setScriptFailed(true)
          onTokenRef.current(null)
          onErrorRef.current?.()
        }
      }, TURNSTILE_POLL_MS)
    }
    // Ha a tároló szélessége utólag lépi át a 300 px-es határt (elforgatás,
    // ablakméretezés), a widget a megfelelő méretben újrarajzolódik; a régi
    // token ilyenkor elvész, a látogató új ellenőrzést kap.
    const container = containerRef.current
    const figyelo =
      container && typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            const widgetId = widgetIdRef.current
            if (widgetId === null || !window.turnstile) {
              return
            }
            if (turnstileSize(container.clientWidth) === sizeRef.current) {
              return
            }
            try {
              window.turnstile.remove(widgetId)
            } catch {
              // A már eltávolított widget nem hiba.
            }
            widgetIdRef.current = null
            onTokenRef.current(null)
            renderWidget()
          })
        : null
    if (figyelo && container) {
      figyelo.observe(container)
    }
    return () => {
      figyelo?.disconnect()
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

  // Új ellenőrzés kérése (az első render kivételével).
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

  if (scriptFailed) {
    return (
      <p className="kc-contact-form__turnstile-error" role="alert">
        A spam-ellenőrzés betöltése nem sikerült. Frissítsd az oldalt, vagy próbáld később.
      </p>
    )
  }

  return (
    <>
      <Script
        onError={() => {
          setScriptFailed(true)
          onTokenRef.current(null)
          onErrorRef.current?.()
        }}
        onLoad={renderWidget}
        onReady={renderWidget}
        src={TURNSTILE_SCRIPT_SRC}
        strategy="afterInteractive"
      />
      {/* Külső: CSS-konténer (a szélessége a rendelkezésre álló hely); belső: a
          rajzolási hely, amely 300 px alatt a kompakt widget 140 px-ét foglalja
          le már a kirajzolás előtt (layout.css, CLS ellen). */}
      <div className="kc-contact-form__turnstile">
        <div className="kc-contact-form__turnstile-hely" ref={containerRef} />
      </div>
    </>
  )
}
