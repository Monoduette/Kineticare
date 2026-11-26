'use client'

import { useDocumentInfo, useFormFields } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

import { parentCourseIdsOf } from '../../lib/course-family'

/**
 * „Témakurzusok ebből a programból” (UI-mező a kurzusszerkesztő „Ár és
 * hozzáférés” fülén, nem tárol adatot).
 *
 * A kapcsolatot a témakurzus tárolja (`parentCourses`), ezért a teljes program
 * lapján e nélkül nem látszana, mely témakurzusok hivatkoznak rá. A lista csak
 * olvasható: a kapcsolatot a témakurzus lapján lehet állítani (tulajdonos).
 * Payload join mező helyett azért kliens-lekérés, mert a join minden olvasásnál
 * lefutna, és piszkozatos gyűjteményen ismert hibája van (payload#19478).
 *
 * Az állapot szövegesen is ott áll (WCAG 2.2 SC 1.4.1), a betöltés és a hiba
 * `role="status"`-szal jelzett (NN/g, Visibility of System Status:
 * https://www.nngroup.com/articles/visibility-system-status/).
 */

const REQUEST_TIMEOUT_MS = 20_000

const STATUS_LABELS: Record<string, string> = {
  draft: 'piszkozat',
  published: 'közzétéve',
  archived: 'archivált',
}

interface TopicRow {
  id: number
  title: string
  status: string
}

type PanelState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; rows: TopicRow[] }

function readRows(body: unknown): TopicRow[] {
  const docs = (body as { docs?: unknown } | null)?.docs
  if (!Array.isArray(docs)) return []
  const rows: TopicRow[] = []
  for (const doc of docs) {
    if (typeof doc !== 'object' || doc === null) continue
    const { id, sku, displayTitle, status } = doc as Record<string, unknown>
    if (typeof id !== 'number') continue
    const title =
      typeof displayTitle === 'string' && displayTitle.trim().length > 0
        ? displayTitle.trim()
        : typeof sku === 'string' && sku.trim().length > 0
          ? sku.trim()
          : `#${id}`
    rows.push({ id, title, status: typeof status === 'string' ? status : '' })
  }
  return rows
}

export function TopicCoursesPanel() {
  const { id } = useDocumentInfo()
  const parentCourses = useFormFields(([fields]) => fields?.parentCourses?.value)
  const isTopic = parentCourseIdsOf({ parentCourses }).length > 0
  const docId = typeof id === 'number' ? id : null
  const [state, setState] = useState<PanelState>({ kind: 'loading' })

  useEffect(() => {
    if (docId === null || isTopic) return undefined
    const controller = new AbortController()
    let unmounted = false
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    const query = new URLSearchParams({
      depth: '0',
      limit: '100',
      draft: 'true',
      sort: 'sku',
      'where[parentCourses][in][0]': String(docId),
      'select[sku]': 'true',
      'select[displayTitle]': 'true',
      'select[status]': 'true',
    })
    fetch(`/api/products?${query.toString()}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        const rows = readRows(await response.json())
        if (!unmounted) setState({ kind: 'ready', rows })
      })
      .catch(() => {
        // Időtúllépés vagy hálózati hiba; a lap elhagyása nem hiba.
        if (!unmounted) setState({ kind: 'error' })
      })
      .finally(() => clearTimeout(timer))
    return () => {
      unmounted = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [docId, isTopic])

  // Új (még nem mentett) kurzuson és témakurzuson nincs mit mutatni: a
  // témakurzusnak nem lehet témakurzusa (course-family-guard.ts).
  if (docId === null || isTopic) return null

  return (
    <section aria-labelledby="kc-topic-courses-title" style={{ marginBottom: 'var(--base)' }}>
      <h3 id="kc-topic-courses-title">Témakurzusok ebből a programból</h3>
      {state.kind === 'loading' ? <p role="status">Betöltés…</p> : null}
      {state.kind === 'error' ? (
        <p role="status">A témakurzusok listája most nem tölthető be. Frissítsd az oldalt.</p>
      ) : null}
      {state.kind === 'ready' && state.rows.length === 0 ? (
        <p>
          Ehhez a programhoz még nincs témakurzus. Témakurzust a kurzus duplikálásával kezdhetsz,
          majd a másolat „Teljes program, amelynek része” mezőjében ezt a programot választod.
        </p>
      ) : null}
      {state.kind === 'ready' && state.rows.length > 0 ? (
        <ul>
          {state.rows.map((row) => (
            <li key={row.id}>
              <a href={`/admin/collections/products/${row.id}`}>{row.title}</a>
              {STATUS_LABELS[row.status] ? ` (${STATUS_LABELS[row.status]})` : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
