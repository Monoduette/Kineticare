'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAuth, useField, useForm } from '@payloadcms/ui'
import type { TextFieldClientProps } from 'payload'
import { hasStaffOrOwnerRole } from '../../access/roles'
import { BunnyVideoDialog } from './BunnyVideoDialog'
import { BunnyVideoPicker, BunnyVideoPreview } from './BunnyVideoPicker'
import { BunnyVideoUpload } from './BunnyVideoUpload'
import { videoDetail } from './bunny-video-client'
import {
  captureVideoTarget,
  durationLabel,
  statusLabels,
  videoFieldPatch,
  type AdminVideo,
  type VideoLibrary,
  type VideoTarget,
} from './bunny-video-state'

function BunnyVideoField(props: TextFieldClientProps & { library: VideoLibrary }) {
  const { library, path: stalePath, readOnly } = props
  const field = useField<string>({ potentiallyStalePath: stalePath })
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
      setError('Az előzetes közben megváltozott. Nyisd meg újra a leválasztást.')
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
    // Egyetlen Payload reducer-akcio: nincs felkesz GUID/hossz/allapot kombinacio.
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
  if (!hasStaffOrOwnerRole(user)) return null
  const current = selected?.guid === field.value ? selected : null
  return (
    <div className="bunny-video bunny-video-field field-type">
      <div className="bunny-video-toolbar">
        <span>{library === 'public' ? 'Előzetes videó' : 'Lecke videója'}</span>
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
              Előzetes leválasztása
            </button>
          )}
        </div>
      </div>
      {current ? (
        <p>
          {current.title} · {durationLabel(current.durationSec)} · {statusLabels[current.status]}
        </p>
      ) : field.value ? (
        <p>Videó csatolva</p>
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
                  {confirming ? 'Ellenőrzés...' : 'Videó cseréje'}
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
        <BunnyVideoDialog title="Leválasztod az előzetest?" onClose={cancelUnlink}>
          <p>A videó a videótárban marad.</p>
          <div className="bunny-video-actions">
            <button type="button" onClick={cancelUnlink}>
              Mégse
            </button>
            <button type="button" disabled={disabled} onClick={unlink}>
              Előzetes leválasztása
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
