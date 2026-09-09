'use client'

import { useLayoutEffect, useRef, useId, type ReactNode } from 'react'
import { XIcon } from '@payloadcms/ui'
import './bunny-video.css'

export function BunnyVideoDialog({
  title,
  children,
  onClose,
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleID = useId()
  useLayoutEffect(() => {
    const dialog = ref.current!
    const previous = document.activeElement
    dialog.showModal()
    return () => {
      dialog.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])
  return (
    <dialog
      className="bunny-video bunny-video-dialog"
      ref={ref}
      aria-labelledby={titleID}
      onCancel={(event) => {
        event.stopPropagation()
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        onClose()
      }}
      onKeyDown={(event) => {
        if (
          event.key !== 'Tab' ||
          !(event.target instanceof Element) ||
          event.target.closest('dialog') !== event.currentTarget
        )
          return
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], iframe, [tabindex="0"]',
          ),
        ).filter(
          (element) =>
            element.getClientRects().length > 0 &&
            element.closest('dialog') === event.currentTarget,
        )
        const first = controls[0]
        const last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }}
    >
      <header className="bunny-video-toolbar">
        <h2 id={titleID}>{title}</h2>
        <button
          type="button"
          className="bunny-video-icon"
          aria-label="Bezárás"
          title="Bezárás"
          onClick={onClose}
        >
          <XIcon />
        </button>
      </header>
      {children}
    </dialog>
  )
}
