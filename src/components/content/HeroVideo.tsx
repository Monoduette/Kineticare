'use client'

import { useEffect, useState } from 'react'

import { buildHeroStreamEmbedUrl, buildHeroStreamPosterUrl } from '@/lib/hero-video'

/**
 * HeroVideo — a kezdőlap fejlécének animált, reszponzív háttérvideója
 * (Bunny Stream publikus library, PUBLIKUS marketing-tartalom).
 * Viselkedés:
 * - A poszterkép azonnal megjelenik (a Bunny pull-zone thumbnailje), az
 * iframe csak utána mountolódik — így nincs fehér vaku az oldalletöltéskor.
 * - autoplay + muted + loop (a mobil autoplay-szabályoknak megfelelően:
 */
export interface HeroVideoProps {
  streamId: string
  /** Egyedi poszter-URL felülírás (alapból a Bunny automatikus thumbnailje). */
  posterUrl?: string
  className?: string
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export function HeroVideo({ streamId, posterUrl, className }: HeroVideoProps) {
  // Hiányzó Bunny-konfiguráció (publikus library-id / pull-zone hoszt) esetén
  // az URL-építők null-t adnak: ilyenkor a hiányzó elem egyszerűen kimarad, és
  // a hero a saját hátterével jelenik meg — nem lesz fekete doboz vagy törött
  // képikon belőle.
  const poster = posterUrl ?? buildHeroStreamPosterUrl(streamId)
  const embedUrl = buildHeroStreamEmbedUrl(streamId)
  const [showVideo, setShowVideo] = useState(false)

  useEffect(() => {
    const media = window.matchMedia(REDUCED_MOTION_QUERY)
    const update = (): void => setShowVideo(!media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '16 / 9',
        overflow: 'hidden',
        borderRadius: 'var(--kc-radius-lg)',
        /* A háttér korábban a landing NEM LÉTEZŐ tokennevére hivatkozott
           (kc-tint), ezért mindig a mellé írt legacy hexa fallbackre esett
           vissza. A szerep-token: --kc-color-surface-tint (#e6f0f8). A G-K1 őr
           (src/__tests__/gomb-kontraszt.test.ts) ezt a hibafajtát zárja ki. */
        backgroundColor: 'var(--kc-color-surface-tint)',
      }}
    >
      {poster === null ? null : (
        /* eslint-disable-next-line @next/next/no-img-element -- a poszterkép külső CDN-URL, a next/image konfigurációja nincs rá felkészítve */
        <img
          alt=""
          src={poster}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      )}
      {showVideo && embedUrl !== null ? (
        <iframe
          allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
          allowFullScreen={false}
          src={embedUrl}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            border: 'none',
          }}
          tabIndex={-1}
          title="Kineticare hero-videó"
        />
      ) : null}
    </div>
  )
}
