'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { FieldDescription, FieldLabel, useAuth, useField, useForm } from '@payloadcms/ui'
import type { TextFieldClientProps } from 'payload'
import { hasStaffOrOwnerRole } from '../../access/roles'
import { BunnyVideoDialog } from './BunnyVideoDialog'
import { BunnyVideoPicker, BunnyVideoPreview } from './BunnyVideoPicker'
import { BunnyVideoUpload } from './BunnyVideoUpload'
import { videoDetail } from './bunny-video-client'
import {
  attachedVideoSummary,
  captureVideoTarget,
  fieldLabelFallback,
  guidPattern,
  videoFieldPatch,
  type AdminVideo,
  type VideoLibrary,
  type VideoTarget,
} from './bunny-video-state'

/**
 * Bunny-videó mező (nyilvános előzetes és lecke videója).
 *
 * K35 (admin-audit, 2026-09-22):
 * - A mező a config címkéjét és leírását mutatja a Payload saját FieldLabel
 *   és FieldDescription elemével (a korábbi beégetett felirat helyett), így a
 *   név és a súgó egy helyen, a mezőnél él (WCAG 2.2 SC 3.3.2 Labels or
 *   Instructions, https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html;
 *   SC 1.3.1: a csoport neve a címke, role="group" + aria-labelledby).
 * - Újratöltés után is látszik, melyik videó van a mezőn: a csatolt videó
 *   adatai („cím · 7:17 · Kész”) a meglévő videoDetail kliensből jönnek (NN/g,
 *   Visibility of System Status, https://www.nngroup.com/articles/visibility-system-status/;
 *   Recognition rather than recall, https://www.nngroup.com/articles/recognition-and-recall/).
 *   A lekérés csak akkor indul, amikor a mező láthatóvá válik (a csukott
 *   lecke-sorok tartalma is fel van csatolva), és oldalanként gyorsítótárazott.
 * - A kiválasztás, csere, leválasztás és megerősítés logikája változatlan.
 */

const readyDetailCache = new Map<string, Promise<AdminVideo>>()

/** A csatolt videó adatai; a kész videóé a lap élete alatt újrahasznosul. */
function attachedVideoDetail(guid: string, library: VideoLibrary): Promise<AdminVideo> {
  const key = `${library}:${guid.toLowerCase()}`
  const cached = readyDetailCache.get(key)
  if (cached) return cached
  const request = videoDetail(guid, library)
  readyDetailCache.set(key, request)
  request.then(
    (video) => {
      if (video.status !== 'ready') readyDetailCache.delete(key)
    },
    () => readyDetailCache.delete(key),
  )
  return request
}

function BunnyVideoField(props: TextFieldClientProps & { library: VideoLibrary }) {
  const { field: fieldConfig, library, path: stalePath, readOnly } = props
  const field = useField<string>({ potentiallyStalePath: stalePath })
  const labelId = useId()
  const descriptionId = useId()
  const root = useRef<HTMLDivElement>(null)
  const [attached, setAttached] = useState<{
    guid: string
    video: AdminVideo | null
  } | null>(null)
  const form = useForm()
  const { user } = useAuth<{ id: number | string; role?: string | null }>()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'pick' | 'upload'>('pick')
  const [pending, setPending] = useState<AdminVideo | null>(null)
  const [selected, setSelected] = useState<AdminVideo | null>(null)
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState('')
  const [unlinkOpen, setUnlinkOpen] = useState(false)
  const unlinkTarget = useRef<VideoTarget | null>(null)
  const confirmation = useRef<AbortController | null>(null)
  const target = useRef<VideoTarget | null>(null)
  const consumed = useRef(false)
  const disabled = !!readOnly || field.disabled || form.disabled || !hasStaffOrOwnerRole(user)
  const canView = hasStaffOrOwnerRole(user)
  const value = typeof field.value === 'string' ? field.value : ''
  const selectedGuid = selected?.guid ?? null
  useEffect(() => {
    if (!canView || !guidPattern.test(value) || selectedGuid === value) return
    let active = true
    let observer: IntersectionObserver | null = null
    const load = () => {
      attachedVideoDetail(value, library).then(
        (video) => {
          if (active) setAttached({ guid: value, video })
        },
        () => {
          if (active) setAttached({ guid: value, video: null })
        },
      )
    }
    const node = root.current
    if (typeof IntersectionObserver === 'undefined' || !node) load()
    else {
      observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer?.disconnect()
        load()
      })
      observer.observe(node)
    }
    return () => {
      active = false
      observer?.disconnect()
    }
  }, [canView, library, selectedGuid, value])
  const editable = useRef(!disabled)
  useLayoutEffect(() => {
    editable.current = !disabled
  }, [disabled])
  useEffect(
    () => () => {
      target.current = null
      consumed.current = true
      confirmation.current?.abort()
      unlinkTarget.current = null
    },
    [],
  )
  function close() {
    confirmation.current?.abort()
    confirmation.current = null
    target.current = null
    consumed.current = true
    setOpen(false)
    setPending(null)
    setConfirming(false)
  }
  function launch() {
    const captured = captureVideoTarget(form.getFields(), field.path, library)
    if (!captured) {
      setError('A lecke már nem szerkeszthető. Nyisd meg újra.')
      return
    }
    target.current = captured
    consumed.current = false
    setMode('pick')
    setError('')
    setOpen(true)
  }
  function cancelUnlink() {
    unlinkTarget.current = null
    setUnlinkOpen(false)
  }
  function launchUnlink() {
    if (!editable.current || library !== 'public') return
    const captured = captureVideoTarget(form.getFields(), field.path, library)
    if (!captured || !captured.initial) return
    unlinkTarget.current = captured
    setError('')
    setUnlinkOpen(true)
  }
  function unlink() {
    const captured = unlinkTarget.current
    if (
      !editable.current ||
      library !== 'public' ||
      field.path !== 'previewVideoStreamId' ||
      !captured
    )
      return
    const current = form.getFields().previewVideoStreamId
    cancelUnlink()
    if (!current || current.value !== captured.initial) {
      setError('A nyilvános előzetes közben megváltozott. Nyisd meg újra a leválasztást.')
      return
    }
    form.dispatchFields({
      type: 'UPDATE_MANY',
      formState: {
        previewVideoStreamId: {
          ...current,
          value: '',
          valid: true,
          errorMessage: undefined,
          isModified: true,
        },
      },
    })
    form.setModified(true)
    setSelected(null)
    setPreview(false)
  }
  function commit(video: AdminVideo) {
    if (!editable.current || consumed.current || !target.current) return
    const patch = videoFieldPatch(form.getFields(), target.current, video)
    if (!patch) {
      setError('A lecke közben megváltozott vagy törölve lett. Válaszd ki újra a videót.')
      close()
      return
    }
    consumed.current = true
    // Egyetlen Payload reducer-akció: nincs félkész GUID/hossz/állapot kombináció.
    form.dispatchFields({ type: 'UPDATE_MANY', formState: patch })
    form.setModified(true)
    setSelected(video)
    close()
  }
  function select(video: AdminVideo) {
    if (!target.current || consumed.current || !editable.current || video.status !== 'ready') return
    setConfirmError('')
    if (target.current.initial && target.current.initial !== video.guid) setPending(video)
    else commit(video)
  }
  function cancelConfirmation() {
    confirmation.current?.abort()
    confirmation.current = null
    setPending(null)
    setConfirming(false)
  }
  async function confirmReplacement() {
    if (!pending || confirmation.current || !editable.current) return
    const controller = new AbortController()
    confirmation.current = controller
    setConfirming(true)
    setConfirmError('')
    try {
      const detail = await videoDetail(pending.guid, library, controller.signal)
      if (controller.signal.aborted) return
      if (detail.status !== 'ready') {
        setConfirmError('A videó még nem kész. Frissítsd a listát.')
        return
      }
      commit(detail)
    } catch {
      if (!controller.signal.aborted)
        setConfirmError('A videó adatai nem frissíthetők. Próbáld újra.')
    } finally {
      if (!controller.signal.aborted) {
        confirmation.current = null
        setConfirming(false)
      }
    }
  }
  if (!canView) return null
  const current = selected?.guid === field.value ? selected : null
  const shown = current ?? (attached?.guid === value ? attached.video : null)
  const label = fieldConfig?.label || fieldLabelFallback(library)
  const description = fieldConfig?.admin?.description
  return (
    <div
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={labelId}
      className="bunny-video bunny-video-field field-type"
      ref={root}
      role="group"
    >
      <div className="bunny-video-toolbar">
        <div id={labelId}>
          <FieldLabel as="span" label={label} path={field.path} required={fieldConfig?.required} />
        </div>
        <div className="bunny-video-actions">
          <button type="button" disabled={disabled} onClick={launch}>
            {field.value ? 'Videó cseréje' : 'Videó kiválasztása'}
          </button>
          {field.value && (
            <button type="button" onClick={() => setPreview(true)}>
              Előnézet
            </button>
          )}
          {library === 'public' && field.value && (
            <button type="button" disabled={disabled} onClick={launchUnlink}>
              Nyilvános előzetes leválasztása
            </button>
          )}
        </div>
      </div>
      <p>
        {attachedVideoSummary(value, shown, attached?.guid === value && attached.video === null)}
      </p>
      {description ? (
        <div id={descriptionId}>
          <FieldDescription description={description} path={field.path} />
        </div>
      ) : null}
      {(error || field.showError) && <p role="alert">{error || field.errorMessage}</p>}
      {open && (
        <BunnyVideoDialog
          title={library === 'public' ? 'Nyilvános előzetes kiválasztása' : 'Lecke videója'}
          onClose={close}
        >
          {library === 'protected' && (
            <div className="bunny-video-tabs" role="group" aria-label="Videó forrása">
              <button type="button" aria-pressed={mode === 'pick'} onClick={() => setMode('pick')}>
                Videótár
              </button>
              <button
                type="button"
                aria-pressed={mode === 'upload'}
                onClick={() => setMode('upload')}
              >
                Feltöltés
              </button>
            </div>
          )}
          {mode === 'pick' && (
            <div>
              <BunnyVideoPicker library={library} disabled={disabled} onSelect={select} />
            </div>
          )}
          {library === 'protected' && (
            <div hidden={mode !== 'upload'}>
              <BunnyVideoUpload onSelect={select} />
            </div>
          )}
          {pending && (
            <BunnyVideoDialog title="Lecseréled a videót?" onClose={cancelConfirmation}>
              <p>{pending.title}</p>
              {confirmError && <p role="alert">{confirmError}</p>}
              <div className="bunny-video-actions">
                <button type="button" onClick={cancelConfirmation}>
                  Mégse
                </button>
                <button
                  type="button"
                  disabled={disabled || confirming}
                  onClick={() => void confirmReplacement()}
                >
                  {confirming ? 'Ellenőrzés…' : 'Videó cseréje'}
                </button>
              </div>
            </BunnyVideoDialog>
          )}
        </BunnyVideoDialog>
      )}
      {preview && field.value && (
        <BunnyVideoPreview guid={field.value} library={library} onClose={() => setPreview(false)} />
      )}
      {unlinkOpen && (
        <BunnyVideoDialog title="Leválasztod a nyilvános előzetest?" onClose={cancelUnlink}>
          <p>A videó a videótárban marad.</p>
          <div className="bunny-video-actions">
            <button type="button" onClick={cancelUnlink}>
              Mégse
            </button>
            <button type="button" disabled={disabled} onClick={unlink}>
              Nyilvános előzetes leválasztása
            </button>
          </div>
        </BunnyVideoDialog>
      )}
    </div>
  )
}
export function ProtectedBunnyVideoField(props: TextFieldClientProps) {
  return <BunnyVideoField {...props} library="protected" />
}
export function PublicBunnyVideoField(props: TextFieldClientProps) {
  return <BunnyVideoField {...props} library="public" />
}
