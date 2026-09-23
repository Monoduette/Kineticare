'use client'

import { useEffect, useRef, useState, useId } from 'react'
import { ChevronIcon, SearchIcon } from '@payloadcms/ui'
import { BunnyVideoDialog } from './BunnyVideoDialog'
import { expiryTime, videoDetail, videoRequest } from './bunny-video-client'
import {
  durationLabel,
  httpsURL,
  parseVideo,
  record,
  statusLabels,
  videoPagination,
  type AdminVideo,
  type VideoLibrary,
} from './bunny-video-state'
import './bunny-video.css'

export function BunnyVideoPreview({
  guid,
  library,
  onClose,
}: {
  guid: string
  library: VideoLibrary
  onClose: () => void
}) {
  const [url, setURL] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    void videoRequest(
      `/api/admin/bunny-videos/${encodeURIComponent(guid)}/preview`,
      { library },
      controller.signal,
    )
      .then((body) => {
        if (controller.signal.aborted) return
        const data = record(body)
        const embed = httpsURL(data?.embedUrl)
        const unsignedPublic = library === 'public' && data?.expiresAt === null
        const expires = expiryTime(data?.expiresAt)
        if (
          !embed ||
          new URL(embed).hostname !== 'iframe.mediadelivery.net' ||
          data?.library !== library ||
          data?.videoId !== guid ||
          (!unsignedPublic && (!Number.isFinite(expires) || expires <= Date.now()))
        )
          throw new Error()
        setURL(embed)
        if (!unsignedPublic)
          timer = setTimeout(
            () => {
              setURL(null)
              setError('Az előnézet lejárt. Nyisd meg újra.')
            },
            Math.min(expires - Date.now(), 2147483647),
          )
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Az előnézet nem érhető el. Nyisd meg újra.')
      })
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [guid, library])
  return (
    <BunnyVideoDialog title="Videó előnézete" onClose={onClose}>
      {error ? (
        <p role="alert">{error}</p>
      ) : url ? (
        <iframe
          className="bunny-video-player"
          src={url}
          title="Videó előnézete"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="no-referrer"
        />
      ) : (
        <p role="status">Betöltés…</p>
      )}
    </BunnyVideoDialog>
  )
}

export interface BunnyVideoPickerProps {
  library: VideoLibrary
  onSelect?: (video: AdminVideo) => void
  refreshKey?: number
  disabled?: boolean
}
export function BunnyVideoPicker({
  library,
  onSelect,
  refreshKey = 0,
  disabled = false,
}: BunnyVideoPickerProps) {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [loaded, setLoaded] = useState<{
    key: string
    error: string
    result: {
      videos: AdminVideo[]
      total: number | null
      pages: number | null
      hasNext: boolean
    } | null
  } | null>(null)
  const [error, setError] = useState('')
  const [selecting, setSelecting] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const activeSelection = useRef<AbortController | null>(null)
  const id = useId()
  const requestKey = JSON.stringify([library, query, page, refresh, refreshKey])
  const loading = loaded?.key !== requestKey
  const result = loading ? null : loaded?.result
  const loadError = loading ? '' : loaded?.error
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({
      library,
      search: query,
      page: String(page),
      pageSize: '24',
    })
    void videoRequest(`/api/admin/bunny-videos?${params}`, undefined, controller.signal)
      .then((body) => {
        if (controller.signal.aborted) return
        const data = record(body)
        if (!data || !Array.isArray(data.videos)) throw new Error()
        const videos = data.videos.map((item) => {
          const video = parseVideo(item)
          if (!video) throw new Error('A videótár hiányos adatokat küldött.')
          return video
        })
        setLoaded({
          key: requestKey,
          error: '',
          result: {
            videos,
            ...videoPagination(data, page, data.videos.length),
          },
        })
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setLoaded({
            key: requestKey,
            result: null,
            error: 'A videók nem tölthetők be. Frissítsd a listát.',
          })
      })
    return () => controller.abort()
  }, [library, query, page, requestKey])
  useEffect(() => () => activeSelection.current?.abort(), [])
  async function select(guid: string) {
    if (activeSelection.current || disabled) return
    const controller = new AbortController()
    activeSelection.current = controller
    setSelecting(guid)
    setError('')
    try {
      const video = await videoDetail(guid, library, controller.signal)
      if (video.status !== 'ready') {
        if (!controller.signal.aborted) setError('A videó még nem kész. Frissítsd a listát.')
        return
      }
      if (!controller.signal.aborted) onSelect?.(video)
    } catch {
      if (!controller.signal.aborted) setError('A videó adatai nem tölthetők be. Próbáld újra.')
    } finally {
      if (!controller.signal.aborted) {
        activeSelection.current = null
        setSelecting(null)
      }
    }
  }
  return (
    <section
      className="bunny-video"
      aria-label={library === 'public' ? 'Nyilvános videók' : 'Védett videók'}
    >
      <div className="bunny-video-toolbar">
        <label className="bunny-video-search" htmlFor={id}>
          <span>Cím keresése</span>
          <span className="bunny-video-search-input">
            <SearchIcon />
            <input
              id={id}
              type="search"
              maxLength={200}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </span>
        </label>
        <button
          type="button"
          className="bunny-video-icon bunny-video-refresh"
          aria-label="Lista frissítése"
          title="Lista frissítése"
          onClick={() => setRefresh((n) => n + 1)}
          disabled={loading}
        >
          <span aria-hidden="true">↻</span>
        </button>
      </div>
      {/* A kiválasztás hibája a gombnyomás eredménye (alert); a lista
          betöltésének hibája a lap állapota, betöltéskor is előállhat, ezért
          udvarias status (WCAG 2.2 SC 4.1.3; MDN, alert role:
          https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/alert_role). */}
      {error ? <p role="alert">{error}</p> : loadError ? <p role="status">{loadError}</p> : null}
      <div aria-busy={loading} className="bunny-video-results">
        {loading && <p role="status">Betöltés…</p>}
        {result?.videos.length === 0 && <p role="status">Nincs találat.</p>}
        <ul className="bunny-video-list">
          {result?.videos.map((video) => (
            <li key={video.guid} className="bunny-video-row">
              <div className="bunny-video-thumb">
                {video.thumbnailUrl ? (
                  // Szolgáltatói képek: ne kerüljenek a Next nyilvános képoptimalizáló gyorsítótárába.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={video.thumbnailUrl}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span>{statusLabels[video.status]}</span>
                )}
              </div>
              <div className="bunny-video-meta">
                <strong>{video.title}</strong>
                <span>
                  {statusLabels[video.status]} · {durationLabel(video.durationSec)}
                </span>
              </div>
              <div className="bunny-video-actions">
                <button type="button" onClick={() => setPreview(video.guid)}>
                  Előnézet
                </button>
                {onSelect && (
                  <button
                    type="button"
                    disabled={disabled || selecting !== null || video.status !== 'ready'}
                    onClick={() => void select(video.guid)}
                  >
                    {selecting === video.guid ? 'Ellenőrzés…' : 'Kiválasztás'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
      {result && (
        <div className="bunny-video-toolbar bunny-video-pagination">
          <span>
            {result.total === null
              ? `${page}. oldal`
              : `${result.total} videó · ${page} / ${result.pages}`}
          </span>
          <div className="bunny-video-actions">
            <button
              type="button"
              className="bunny-video-icon bunny-video-prev"
              title="Előző oldal"
              aria-label="Előző oldal"
              disabled={loading || page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronIcon />
            </button>
            <button
              type="button"
              className="bunny-video-icon bunny-video-next"
              title="Következő oldal"
              aria-label="Következő oldal"
              disabled={loading || !result.hasNext}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronIcon />
            </button>
          </div>
        </div>
      )}
      {preview && (
        <BunnyVideoPreview
          key={`${library}-${preview}`}
          guid={preview}
          library={library}
          onClose={() => setPreview(null)}
        />
      )}
    </section>
  )
}
