'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Upload } from 'tus-js-client'
import { BunnyVideoDialog } from './BunnyVideoDialog'
import {
  VideoRequestError,
  createRejection,
  resumeBunnyUpload,
  uploadCredentials,
  videoDetail,
  videoRequest,
  type UploadCredentials,
} from './bunny-video-client'
import { pollDelay, statusLabels, validateVideoFile, type AdminVideo } from './bunny-video-state'

type Phase =
  | 'idle'
  | 'creating'
  | 'uploading'
  | 'pausing'
  | 'paused'
  | 'processing'
  | 'ready'
  | 'error'
  | 'expired'
  | 'uncertain'
  | 'cancelled'

export function BunnyVideoUpload({
  onSelect,
  onUploaded,
}: {
  onSelect?: (video: AdminVideo) => void
  onUploaded?: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [video, setVideo] = useState<AdminVideo | null>(null)
  const [manual, setManual] = useState(false)
  const [restart, setRestart] = useState(false)
  const upload = useRef<Upload | null>(null)
  const credentials = useRef<UploadCredentials | null>(null)
  const controller = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const lock = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)
  const onUploadedRef = useRef(onUploaded)
  useEffect(() => {
    onUploadedRef.current = onUploaded
  }, [onUploaded])
  const id = useId()
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      controller.current?.abort()
      if (timer.current) clearTimeout(timer.current)
      void upload.current?.abort(false).catch(() => {})
      credentials.current = null
    }
  }, [])
  function alive(run: number) {
    return mounted.current && run === generation.current
  }
  async function refreshStatus(run: number, started: number, attempt: number, automatic: boolean) {
    const session = credentials.current
    if (!session || !alive(run)) return
    try {
      const detail = await videoDetail(session.videoId, 'protected', controller.current?.signal)
      if (!alive(run)) return
      setVideo(detail)
      if (detail.status === 'ready' || detail.status === 'error') {
        setPhase(detail.status)
        setManual(false)
        onUploadedRef.current?.()
        return
      }
      setPhase('processing')
    } catch {
      if (!alive(run)) return
      setError('Az állapot nem frissíthető. Próbáld újra.')
    }
    const delay = automatic ? pollDelay(attempt, Date.now() - started) : null
    if (delay === null) {
      setManual(true)
      return
    }
    timer.current = setTimeout(() => {
      if (Date.now() - started >= 600000) {
        if (alive(run)) setManual(true)
        return
      }
      void refreshStatus(run, started, attempt + 1, true)
    }, delay)
  }
  async function create() {
    if (!file || lock.current) return
    const problem = validateVideoFile(file)
    if (problem || !title.trim()) {
      setError(problem ?? 'Add meg a videó címét.')
      return
    }
    lock.current = true
    const run = ++generation.current
    controller.current?.abort()
    controller.current = new AbortController()
    setPhase('creating')
    setError('')
    setVideo(null)
    setProgress(0)
    setManual(false)
    credentials.current = null
    try {
      const response = await videoRequest(
        '/api/admin/bunny-uploads',
        { title: title.trim(), fileName: file.name, size: file.size, mimeType: file.type },
        controller.current.signal,
      )
      if (!alive(run)) return
      const session = uploadCredentials(response)
      credentials.current = session
      if (session.expiresAt * 1000 <= Date.now()) {
        setPhase('expired')
        return
      }
      const instance = new Upload(file, {
        endpoint: session.tusEndpoint,
        headers: session.headers,
        metadata: { filetype: file.type, title: title.trim() },
        storeFingerprintForResuming: false,
        removeFingerprintOnSuccess: true,
        retryDelays: null,
        onShouldRetry: () => false,
        onBeforeRequest: (request) => {
          // Ne kerülhessen aláírás egy átirányított, idegen TUS-erőforrásra.
          const url = new URL(request.getURL())
          if (url.origin !== 'https://video.bunnycdn.com' || !url.pathname.startsWith('/tusupload'))
            throw new Error('A feltöltés címe nem engedélyezett.')
          if (
            !alive(run) ||
            !credentials.current ||
            credentials.current.expiresAt * 1000 <= Date.now()
          )
            throw new Error('A feltöltési engedély lejárt.')
        },
        onProgress: (sent, total) => {
          if (alive(run)) setProgress(total ? Math.floor((sent / total) * 100) : 0)
        },
        onError: () => {
          if (!alive(run)) return
          if (!instance.url) {
            setPhase('uncertain')
            setError(
              'A feltöltés indulása nem igazolható. Ellenőrizd a videótárat új feltöltés előtt.',
            )
            return
          }
          setPhase(
            credentials.current && credentials.current.expiresAt * 1000 <= Date.now()
              ? 'expired'
              : 'paused',
          )
          setError('A feltöltés megszakadt. A folytatás ugyanahhoz a videóhoz kapcsolódik.')
        },
        onSuccess: () => {
          if (!alive(run)) return
          setProgress(100)
          setPhase('processing')
          setError('')
          void refreshStatus(run, Date.now(), 0, true)
        },
      })
      upload.current = instance
      setPhase('uploading')
      instance.start()
    } catch (cause) {
      if (!alive(run)) return
      const rejected = createRejection(cause)
      if (rejected) {
        // A szerver ELUTASÍTOTTA a kérést, mielőtt videót hozott volna létre:
        // a mezők maradnak, az indítás megismételhető. A „bizonytalan" ág a
        // válasz nélküli (hálózat, időtúllépés) és a feldolgozás közbeni hibáké.
        setPhase('idle')
        setError(rejected)
        return
      }
      setPhase('uncertain')
      setError(
        'A feltöltés létrehozása nem igazolható. Ellenőrizd a videótárat új feltöltés indítása előtt.',
      )
    } finally {
      lock.current = false
    }
  }
  async function pause() {
    if (lock.current) return
    lock.current = true
    setPhase('pausing')
    const run = generation.current
    try {
      await upload.current?.abort(false)
      if (alive(run)) setPhase('paused')
    } catch {
      if (alive(run)) {
        setPhase('paused')
        setError('A szüneteltetés nem igazolható. Ellenőrizd az állapotot.')
      }
    } finally {
      lock.current = false
    }
  }
  async function resume() {
    const session = credentials.current
    if (!session || !upload.current || lock.current) return
    if (!upload.current.url) {
      setPhase('uncertain')
      setError('A korábbi feltöltés címe nem ismert. Ellenőrizd a videótárat új feltöltés előtt.')
      return
    }
    if (session.expiresAt * 1000 <= Date.now()) {
      setPhase('expired')
      setError('A feltöltési engedély lejárt. Új feltöltést indíthatsz.')
      return
    }
    lock.current = true
    const run = generation.current
    setPhase('pausing')
    setError('')
    try {
      const refreshed = uploadCredentials(
        await videoRequest(
          '/api/admin/bunny-uploads/sign',
          { uploadSession: session.uploadSession },
          controller.current?.signal,
        ),
      )
      if (!alive(run)) return
      if (
        refreshed.videoId !== session.videoId ||
        refreshed.libraryId !== session.libraryId ||
        refreshed.uploadSession !== session.uploadSession ||
        refreshed.tusEndpoint !== session.tusEndpoint
      )
        throw new Error()
      if (refreshed.expiresAt * 1000 <= Date.now()) {
        setPhase('expired')
        return
      }
      credentials.current = refreshed
      setPhase('uploading')
      resumeBunnyUpload(upload.current, refreshed.headers)
    } catch (reason) {
      if (alive(run)) {
        const invalidSession =
          reason instanceof VideoRequestError &&
          reason.status === 403 &&
          reason.code === 'invalid-session'
        setPhase(
          session.expiresAt * 1000 <= Date.now() ||
            invalidSession ||
            (reason instanceof VideoRequestError && reason.status === 410)
            ? 'expired'
            : 'paused',
        )
        setError(
          invalidSession
            ? 'A feltöltési engedély már nem használható. Új feltöltést indíthatsz.'
            : 'A folytatás nem sikerült. Próbáld újra, vagy ellenőrizd a videótárat.',
        )
      }
    } finally {
      lock.current = false
    }
  }
  function cancel() {
    generation.current++
    controller.current?.abort()
    if (timer.current) clearTimeout(timer.current)
    void upload.current?.abort(false).catch(() => {})
    upload.current = null
    credentials.current = null
    setVideo(null)
    setPhase('cancelled')
    setError('')
  }
  const idle = phase === 'idle'
  return (
    <div className="bunny-video bunny-video-upload">
      <label htmlFor={`${id}-file`}>
        Videófájl
        <input
          id={`${id}-file`}
          type="file"
          accept="video/*"
          disabled={!idle}
          onChange={(e) => {
            const next = e.target.files?.[0] ?? null
            setFile(next)
            setTitle(next ? next.name.replace(/\.[^.]+$/, '') : '')
            setError(next ? (validateVideoFile(next) ?? '') : '')
          }}
        />
      </label>
      <label htmlFor={`${id}-title`}>
        Videó címe
        <input
          id={`${id}-title`}
          value={title}
          maxLength={200}
          disabled={!idle}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {phase !== 'idle' && (
        <p role="status">
          {phase === 'creating'
            ? 'Feltöltés előkészítése…'
            : phase === 'uploading'
              ? `Feltöltés: ${progress}%`
              : phase === 'paused'
                ? 'Szüneteltetve'
                : phase === 'pausing'
                  ? 'Várakozás…'
                  : phase === 'expired'
                    ? 'A feltöltési engedély már nem használható.'
                    : phase === 'uncertain'
                      ? 'A létrehozás eredménye bizonytalan.'
                      : phase === 'cancelled'
                        ? 'Feltöltés megszakítva. A tárban lévő videó nem lett törölve.'
                        : statusLabels[phase]}
        </p>
      )}
      {(phase === 'uploading' || phase === 'paused' || phase === 'pausing') && (
        <progress value={progress} max={100} aria-label="Feltöltés állapota" />
      )}
      {manual && <p role="status">Az automatikus ellenőrzés véget ért. Frissítsd az állapotot.</p>}
      <div className="bunny-video-actions">
        {idle && (
          <button
            type="button"
            disabled={!file || !title.trim() || !!(file && validateVideoFile(file))}
            onClick={() => void create()}
          >
            Feltöltés indítása
          </button>
        )}
        {phase === 'uploading' && (
          <button type="button" onClick={() => void pause()}>
            Szüneteltetés
          </button>
        )}
        {phase === 'paused' && (
          <button type="button" onClick={() => void resume()}>
            Folytatás
          </button>
        )}
        {phase === 'expired' && (
          <button type="button" onClick={() => setRestart(true)}>
            Új feltöltés indítása
          </button>
        )}
        {(manual || phase === 'error' || phase === 'ready') && (
          <button
            type="button"
            className="bunny-video-icon bunny-video-refresh"
            aria-label="Állapot frissítése"
            title="Állapot frissítése"
            onClick={() => {
              setError('')
              void refreshStatus(generation.current, Date.now(), 0, false)
            }}
          >
            <span aria-hidden="true">↻</span>
          </button>
        )}
        {phase === 'ready' && video && onSelect && (
          <button
            type="button"
            onClick={() => {
              if (lock.current) return
              lock.current = true
              const run = generation.current
              void videoDetail(video.guid, 'protected', controller.current?.signal)
                .then((detail) => {
                  if (alive(run)) {
                    if (detail.status === 'ready') onSelect(detail)
                    else {
                      setVideo(detail)
                      setPhase(detail.status === 'error' ? 'error' : 'processing')
                      setManual(true)
                      setError('A videó még nem kész. Frissítsd az állapotot.')
                    }
                  }
                })
                .catch(() => {
                  if (alive(run)) setError('A videó adatai nem frissíthetők. Próbáld újra.')
                })
                .finally(() => {
                  lock.current = false
                })
            }}
          >
            Videó használata
          </button>
        )}
        {!['idle', 'cancelled', 'ready', 'uncertain'].includes(phase) && (
          <button type="button" onClick={cancel}>
            Megszakítás
          </button>
        )}
      </div>
      {restart && (
        <BunnyVideoDialog title="Új feltöltést indítasz?" onClose={() => setRestart(false)}>
          <p>A korábbi videó a tárban marad.</p>
          <div className="bunny-video-actions">
            <button type="button" onClick={() => setRestart(false)}>
              Mégse
            </button>
            <button
              type="button"
              onClick={() => {
                setRestart(false)
                void upload.current?.abort(false).catch(() => {})
                void create()
              }}
            >
              Új feltöltés indítása
            </button>
          </div>
        </BunnyVideoDialog>
      )}
    </div>
  )
}
