'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'

/**
 * CourseBuyBar — a kurzusoldal ragadós vásárlósávja (ár + gomb).
 */
export interface CourseBuyBarProps {
  /**
   * A megfigyelt elem `id`-je: a vásárlódoboz GOMBJA (CourseCta). A sáv
   * pontosan akkor jelenik meg, amikor ez az elem nem látszik.
   */
  anchorId: string
  /**
   * További megfigyelt elemek `id`-i (pl. az akciós oldal záró sávjának gombja):
   * amíg BÁRMELYIK teljesen látszik, a sáv rejtve marad, hogy sose álljon két
   * elsődleges vásárlógomb egyszerre a képernyőn (Codex, #278).
   */
  alsoHideForIds?: string[]
  /** A kurzus címe — a sáv akadálymentes megnevezéséhez. */
  courseTitle: string
  /** A CTA felirata (a courses.ts resolveCourseCta állapotgépéből). */
  label: string
  href: string
  /** Kiírt ár („79 500 Ft") vagy „Ingyenes"; null, ha nincs mit kiírni. */
  priceLabel: string | null
}

/** A dokumentumgyökér jelölése, amíg a sáv látszik (scroll-padding + térköz). */
const ROOT_CLASS = 'kc-has-buybar'

/**
 * Ekkora látható hányad alatt lép be a sáv. A küszöb SZÁNDÉKOSAN „majdnem
 * teljesen": a részben levágott gomb nem elég.
 * MÉRVE (1366×768, süti-sávval): a doboz belső görgetése a gombnak csak a
 * felső 21 pixelét hagyta meg (53-ból), a KÖZEPE már a levágás alá esett —
 * `elementFromPoint` szerint tehát a gomb közepe nem volt kattintható, a
 * puszta „metszi-e" feltétel viszont igaznak látszott, és a sáv nem jelent
 */
const TELJESEN_LATSZIK = 0.99

export function CourseBuyBar({
  anchorId,
  alsoHideForIds,
  courseTitle,
  label,
  href,
  priceLabel,
}: CourseBuyBarProps) {
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const bar = barRef.current
    const targets = [anchorId, ...(alsoHideForIds ?? [])]
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null)
    const primary = document.getElementById(anchorId)
    if (bar === null || primary === null || typeof IntersectionObserver !== 'function') {
      return
    }
    const root = document.documentElement
    const apply = (show: boolean) => {
      bar.dataset.visible = show ? 'true' : 'false'
      root.classList.toggle(ROOT_CLASS, show)
    }
    // Célonként a legutóbbi láthatósági arány; a sáv csak akkor látszik, ha
    // EGYIK megfigyelt gomb sem látszik teljesen.
    const ratios = new Map<Element, number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          ratios.set(entry.target, entry.intersectionRatio)
        }
        const anyFullyVisible = [...ratios.values()].some((ratio) => ratio >= TELJESEN_LATSZIK)
        apply(!anyFullyVisible)
      },
      // Mindkét határon értesülünk: amikor a gomb egyáltalán eltűnik, és
      // amikor éppen teljesen láthatóvá válik.
      { threshold: [0, TELJESEN_LATSZIK] },
    )
    for (const target of targets) {
      observer.observe(target)
    }
    return () => {
      observer.disconnect()
      apply(false)
    }
  }, [anchorId, alsoHideForIds])

  return (
    <div
      aria-label={`${courseTitle}: vásárlás`}
      className="kc-course-buybar"
      data-visible="false"
      ref={barRef}
      role="region"
    >
      {priceLabel === null ? null : <p className="kc-course-buybar__price">{priceLabel}</p>}
      <Link className="kc-button kc-button--primary kc-course-buybar__cta" href={href}>
        {label}
      </Link>
    </div>
  )
}
