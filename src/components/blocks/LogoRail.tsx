'use client'

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type ReactNode,
} from 'react'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function subscribeMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

const reducedMotion = () => window.matchMedia(REDUCED_MOTION).matches
const staticOnServer = () => true

/**
 * Az SSR/JS nélküli és reduced-motion alapállapot egy teljes, statikus lista.
 * Normál módban a második, inert lista kizárólag a folytonos vizuális hurkot
 * zárja; a képernyőolvasó és a fókuszsorrend minden eredeti logót egyszer kap meg.
 * https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html
 */
export function LogoRail({ children, count }: { children: ReactNode; count: number }) {
  const reduced = useSyncExternalStore(subscribeMotion, reducedMotion, staticOnServer)
  const id = useId()

  // Reduced-motion alatt a mozgó DOM és a vizuális másolat is teljesen megszűnik.
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
  const [paused, setPaused] = useState(false)
  const [measured, setMeasured] = useState(false)
  const viewport = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const originalRow = useRef<HTMLUListElement>(null)
  const label = paused ? 'Elindítom a logósort' : 'Megállítom a logósort'

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) setPaused(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    const viewportElement = viewport.current
    const trackElement = track.current
    const rowElement = originalRow.current
    if (!viewportElement || !trackElement || !rowElement) return

    const measure = () => {
      const viewportWidth = viewportElement.clientWidth
      if (viewportWidth <= 0) return

      const items = Array.from(rowElement.children) as HTMLElement[]
      const rowGap = Number.parseFloat(getComputedStyle(rowElement).gap) || 0
      const trackGap = Number.parseFloat(getComputedStyle(trackElement).gap) || 0
      const contentWidth =
        items.reduce((width, item) => width + item.getBoundingClientRect().width, 0) +
        Math.max(0, items.length - 1) * rowGap
      const cycleWidth = Math.ceil(Math.max(viewportWidth, contentWidth))

      viewportElement.style.setProperty(
        '--kc-press-viewport-width',
        `${Math.ceil(viewportWidth)}px`,
      )
      viewportElement.style.setProperty('--kc-press-cycle-width', `${cycleWidth}px`)
      viewportElement.style.setProperty('--kc-press-cycle-offset', `${-(cycleWidth + trackGap)}px`)
      setMeasured(true)
    }
    measure()

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(viewportElement)
    observer.observe(rowElement)
    Array.from(rowElement.children).forEach((item) => observer.observe(item))
    return () => observer.disconnect()
  }, [])

  function keepFocusedLogoVisible(event: FocusEvent<HTMLDivElement>) {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    requestAnimationFrame(() => target.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
  }

  function resetFocusScroll(event: FocusEvent<HTMLDivElement>) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
      return
    event.currentTarget.scrollLeft = 0
  }

  return (
    <div
      className="kc-press__rail"
      data-measured={measured}
      data-motion="marquee"
      data-paused={paused}
    >
      <div className="kc-press__controls">
        <button
          aria-controls={id}
          aria-label={label}
          aria-pressed={paused}
          className="kc-press__control"
          onClick={() => setPaused((current) => !current)}
          type="button"
        >
          <span aria-hidden="true" className="kc-press__control-icon">
            {paused ? '▶' : 'Ⅱ'}
          </span>
          <span aria-hidden="true" className="kc-press__control-label">
            {label}
          </span>
        </button>
      </div>
      <div
        className="kc-press__viewport"
        id={id}
        onBlurCapture={resetFocusScroll}
        onFocusCapture={keepFocusedLogoVisible}
        ref={viewport}
      >
        <div className="kc-press__track" ref={track}>
          <ul className="kc-press__row" ref={originalRow}>
            {children}
          </ul>
          <ul aria-hidden="true" className="kc-press__row" inert>
            {children}
          </ul>
        </div>
      </div>
    </div>
  )
}
