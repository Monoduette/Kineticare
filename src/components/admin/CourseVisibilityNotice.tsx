'use client'

import { useAuth, useFormFields } from '@payloadcms/ui'
import type { JSX } from 'react'

import { hasOwnerRole } from '../../access/roles'
import { courseVisibilityNotice, type CourseVisibilityNotice as Notice } from './course-visibility'

/** A törzsszöveg; a kiemelendő részlet <strong> (verzál helyett). */
function NoticeBody({ notice }: { notice: Notice }): JSX.Element {
  const at = notice.emphasis ? notice.body.indexOf(notice.emphasis) : -1
  if (!notice.emphasis || at < 0) {
    return <p className="kc-admin-notice__szoveg">{notice.body}</p>
  }
  return (
    <p className="kc-admin-notice__szoveg">
      {notice.body.slice(0, at)}
      <strong>{notice.emphasis}</strong>
      {notice.body.slice(at + notice.emphasis.length)}
    </p>
  )
}

/**
 * A kurzus szerkesztőlapjának LÁTHATÓSÁG-figyelmeztetése (`type: 'ui'` mező).
 *
 * A szöveget és a döntést a tiszta `./course-visibility.ts` hozza (a
 * határesetek: kitöltetlen mező, archivált kurzus, munkatárs és tulajdonos,
 * ott teszteltek); ez a komponens csak az űrlapállapotot és a szerepkört
 * olvassa ki.
 *
 * A sáv a lap TETEJÉN áll, mert a hiba lényege épp az, hogy a szerkesztő a
 * felső sáv „Állapot: Közzétett" feliratának hisz: a cáfolatnak ugyanott kell
 * lennie, ahol a téves üzenet.
 *
 * K42 (admin-audit, 2026-09-22):
 * - Tartós állapot, ezért role="status" (udvarias élő régió). A szerkesztő a
 *   mezőt átállítva hallja az új állapotot, betöltéskor viszont nem szakítja
 *   félbe a felolvasást (WCAG 2.2 SC 4.1.3; MDN, alert role:
 *   https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/alert_role).
 * - A stílus a B1 stílusszerződése (.kc-admin-notice, figyelmeztetésnél
 *   --figyelem, a custom.scss-ben mindkét témán mért AA), saját szín nélkül.
 */
export function CourseVisibilityNotice(): JSX.Element | null {
  const { user } = useAuth<{ id: number | string; role?: string | null }>()
  const status = useFormFields(([fields]) => fields?.status?.value)
  const unlisted = useFormFields(([fields]) => fields?.unlisted?.value)

  const notice = courseVisibilityNotice(status, hasOwnerRole(user), unlisted)
  const figyelmeztet = notice.kind === 'figyelmeztetes'

  return (
    <div
      className={figyelmeztet ? 'kc-admin-notice kc-admin-notice--figyelem' : 'kc-admin-notice'}
      role="status"
      style={{ marginBottom: '1.5rem' }}
    >
      <p className="kc-admin-notice__cim">
        <strong>{notice.title}</strong>
      </p>
      <NoticeBody notice={notice} />
    </div>
  )
}
