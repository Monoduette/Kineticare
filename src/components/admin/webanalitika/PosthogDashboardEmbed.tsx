'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'

/**
 * A megosztott PostHog-dashboard beágyazása (admin Webanalitika).
 *
 * A grafikonokat a PostHog maga rajzolja (tulajdonosi kérés, 2026-11-07: „a
 * PostHog chartjait használjuk, ne építsünk sajátot”). A beágyazott oldal a
 * saját magasságát `postMessage`-dzsel jelzi a szülőnek:
 * `{ event: 'posthog:dimensions', name, height, width }` (PostHog
 * frontend/src/exporter/Exporter.tsx). Ezzel a keret pontosan akkora, mint a
 * tartalma, és nincs benne belső görgetősáv. Az üzenetet csak a FIX EU-cloud
 * originről és a saját keretnevünkkel fogadjuk el.
 *
 * A keret `src`-je csak AZUTÁN kerül be, hogy a figyelő már fut (Codex-review,
 * 2026-11-07): a PostHog a méretet betöltéskor küldi, és egy szerveren
 * renderelt, korán betöltő keret üzenete a hidratálás előtt elveszne.
 */

/** A keret neve: a PostHog ezt adja vissza a `name` mezőben. */
export const POSTHOG_EMBED_FRAME_NAME = 'kineticare-posthog-dashboard'

/** Kezdő magasság, amíg az első méret-üzenet meg nem érkezik. */
const INITIAL_HEIGHT_PX = 1600
const MIN_HEIGHT_PX = 400
const MAX_HEIGHT_PX = 20000

export function readEmbedHeight(data: unknown, frameName: string): number | null {
  if (typeof data !== 'object' || data === null) {
    return null
  }
  const record = data as Record<string, unknown>
  if (record.event !== 'posthog:dimensions' || record.name !== frameName) {
    return null
  }
  const height = record.height
  if (typeof height !== 'number' || !Number.isFinite(height)) {
    return null
  }
  return Math.min(MAX_HEIGHT_PX, Math.max(MIN_HEIGHT_PX, Math.ceil(height)))
}

const frameStyle: CSSProperties = {
  background: 'var(--kc-as-surface-raised, transparent)',
  border: '1px solid var(--kc-as-hairline-strong, var(--theme-elevation-150))',
  borderRadius: 'var(--kc-as-radius-md, 0)',
  display: 'block',
  width: '100%',
}

export function PosthogDashboardEmbed({ src, origin }: { src: string; origin: string }) {
  const [height, setHeight] = useState(INITIAL_HEIGHT_PX)
  const frameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== origin) {
        return
      }
      const next = readEmbedHeight(event.data, POSTHOG_EMBED_FRAME_NAME)
      if (next !== null) {
        setHeight(next)
      }
    }
    window.addEventListener('message', onMessage)
    if (frameRef.current && frameRef.current.getAttribute('src') !== src) {
      frameRef.current.src = src
    }
    return () => window.removeEventListener('message', onMessage)
  }, [origin, src])

  return (
    <iframe
      name={POSTHOG_EMBED_FRAME_NAME}
      ref={frameRef}
      style={{ ...frameStyle, height: `${height}px` }}
      title="Folyamatok és grafikonok a PostHogból"
    />
  )
}
