'use client'

import { useAuth, useFormFields } from '@payloadcms/ui'
import type { CSSProperties, JSX } from 'react'

import { hasOwnerRole } from '../../access/roles'
import { courseVisibilityNotice } from './course-visibility'

/**
 * A kurzus szerkesztőlapjának LÁTHATÓSÁG-figyelmeztetése (`type: 'ui'` mező).
 *
 * A szöveget és a döntést a tiszta `./course-visibility.ts` hozza (a
 * határesetek — kitöltetlen mező, archivált kurzus, staff vs. owner — ott
 * teszteltek); ez a komponens csak az űrlapállapotot és a szerepkört olvassa ki.
 *
 * A sáv a lap TETEJÉN áll, mert a hiba lényege épp az, hogy a szerkesztő a
 * felső sáv „Állapot: Közzétett" feliratának hisz — a cáfolatnak ugyanott kell
 * lennie, ahol a téves üzenet.
 */
export function CourseVisibilityNotice(): JSX.Element | null {
  const { user } = useAuth<{ id: number | string; role?: string | null }>()
  const status = useFormFields(([fields]) => fields?.status?.value)
  const unlisted = useFormFields(([fields]) => fields?.unlisted?.value)

  const notice = courseVisibilityNotice(status, hasOwnerRole(user), unlisted)
  const figyelmeztet = notice.kind === 'figyelmeztetes'

  // A Payload admin saját CSS-változóit használjuk, hogy a sáv világos és
  // sötét témában is illeszkedjen (a projekt `--kc-*` tokenjei a vevői
  // felületé, az adminban nincsenek betöltve).
  const style: CSSProperties = {
    border: `1px solid ${figyelmeztet ? 'var(--theme-warning-500)' : 'var(--theme-success-500)'}`,
    background: figyelmeztet ? 'var(--theme-warning-50)' : 'var(--theme-success-50)',
    color: 'var(--theme-elevation-800)',
    borderRadius: 'var(--style-radius-m, 6px)',
    padding: '0.75rem 1rem',
    marginBottom: '1.5rem',
    lineHeight: 1.5,
  }

  return (
    <div role={figyelmeztet ? 'alert' : 'status'} style={style}>
      <strong style={{ display: 'block', marginBottom: '0.25rem' }}>{notice.title}</strong>
      <span>{notice.body}</span>
    </div>
  )
}
