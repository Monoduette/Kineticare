'use client'

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function subscribeMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

const reducedMotion = () => window.matchMedia(REDUCED_MOTION).matches
const staticOnServer = () => true

/**
 * Egy eredeti lista, csak kérésre mozgó, véges bejárással. SSR/JS nélkül és
 * reduced-motion esetén minden logó látható, sorokra tördelve.
 * https://www.w3.org/WAI/tutorials/carousels/animations/
 * https://www.nngroup.com/articles/auto-forwarding/
 */
export function LogoRail({ children, count }: { children: ReactNode; count: number }) {
  const reduced = useSyncExternalStore(subscribeMotion, reducedMotion, staticOnServer)
  const id = useId()

  // A mozgó rész megszűnik a beállítás váltásakor: nem indul újra magától.
  if (reduced || count < 2) {
    return (
      <div className="kc-press__rail" data-motion="static">
        <ul className="kc-press__row" id={id}>
          {children}
        </ul>
      </div>
    )
  }

  return <MotionRail id={id}>{children}</MotionRail>
}

function MotionRail({ children, id }: { children: ReactNode; id: string }) {
  const [railMode, setRailMode] = useState(false)
  const [playing, setPlaying] = useState(false)
  const viewport = useRef<HTMLDivElement>(null)
  const elapsed = useRef(0)
  const stop = () => setPlaying(false)
  const label = playing ? 'Megállítom a logósort' : 'Elindítom a logósort'

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) setPlaying(false)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    const element = viewport.current
    if (!playing || !element) return

    let frame = 0
    let previous: number | undefined
    let position = element.scrollLeft
    const tick = (now: number) => {
      // Háttérből visszatérve sem ugrik a sor. Egy indítás legfeljebb 60 s.
      const duration = previous === undefined ? 0 : now - previous
      const delta = Math.min(duration, 64)
      previous = now
      elapsed.current += duration
      const end = Math.max(0, element.scrollWidth - element.clientWidth)
      position = Math.min(end, position + (delta * 32) / 1000)
      element.scrollLeft = position
      if (position >= end || elapsed.current >= 60_000 || document.hidden) {
        setPlaying(false)
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing])

  function toggle() {
    if (playing) {
      stop()
      return
    }
    const element = viewport.current
    if (element && element.scrollLeft >= element.scrollWidth - element.clientWidth - 1) {
      element.scrollLeft = 0
    }
    elapsed.current = 0
    setRailMode(true)
    setPlaying(true)
  }

  return (
    <div className="kc-press__rail" data-motion={railMode ? 'rail' : 'static'}>
      <div className="kc-press__controls">
        <button
          aria-controls={id}
          aria-label={label}
          className="kc-press__control"
          onClick={toggle}
          type="button"
        >
          <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span>
          <span aria-hidden="true" className="kc-press__control-label">
            {label}
          </span>
        </button>
      </div>
      <div
        className="kc-press__viewport"
        onFocusCapture={stop}
        onMouseEnter={stop}
        onPointerDown={stop}
        onWheel={stop}
        ref={viewport}
      >
        <ul className="kc-press__row" id={id}>
          {children}
        </ul>
      </div>
    </div>
  )
}
