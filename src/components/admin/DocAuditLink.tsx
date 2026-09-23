'use client'

import { useAuth, useConfig, useDocumentInfo } from '@payloadcms/ui'
import type { JSX } from 'react'

/**
 * Link a Műveletnaplóra, az éppen szerkesztett dokumentumra szűrve (K52).
 *
 * A Payload verziólistája nem mutatja, ki mentett (upstream), a Műveletnapló
 * viszont a létrehozást, a közzétételt és a törlést szereplővel együtt
 * rögzíti (src/plugins/audit.ts: `create`, `publish`, `delete`). A link
 * felirata ezért azt ígéri, amit a napló tényleg tud: a tartalmi
 * szerkesztéseket (piszkozat-mentés, módosítások újbóli közzététele) a napló
 * nem rögzíti. NN/g, Match Between the System and the Real World: a rendszer
 * a felhasználó szavaival beszéljen
 * (https://www.nngroup.com/articles/match-system-real-world/).
 *
 * Csak a tulajdonos látja. Ez MEGJELENÍTÉSI döntés: a Műveletnapló olvasási
 * joga (src/collections/AuditLogs.ts `access.read: isOwner`) változatlan; aki
 * nem tulajdonos, annak a link üres listára vinne, ezért nem is mutatjuk.
 */

export const AUDIT_LINK_FELIRAT = 'Ki hozta létre, ki tette közzé? (Műveletnapló)'

interface AuditUser {
  role?: string | null
}

/** Csak a tulajdonos látja a linket (a napló access-e ugyanígy owner-only). */
export function latjaAMuveletnaplot(user: AuditUser | null | undefined): boolean {
  return user?.role === 'owner'
}

/**
 * A Műveletnapló listája az adott dokumentumra szűrve. A Payload listanézete a
 * `where` paramétert a szűrősávban is megjeleníti (`or → and` alak), így a
 * szűrés látható és módosítható marad.
 */
export function auditLogHref(
  adminRoute: string,
  collectionSlug: string,
  id: number | string,
): string {
  const base = adminRoute.replace(/\/+$/, '')
  const params = new URLSearchParams()
  params.set('where[or][0][and][0][entityType][equals]', collectionSlug)
  params.set('where[or][0][and][1][entityId][equals]', String(id))
  return `${base}/collections/audit-logs?${params.toString()}`
}

/** Listaelemként renderel (a tájékoztató linksorába illeszkedik), vagy semmit. */
export function DocAuditLink(): JSX.Element | null {
  const { user } = useAuth<AuditUser & { id: number | string }>()
  const { config } = useConfig()
  const { id, collectionSlug } = useDocumentInfo()
  if (!latjaAMuveletnaplot(user) || id === undefined || id === null || !collectionSlug) {
    return null
  }
  return (
    <li>
      <a href={auditLogHref(config.routes.admin, collectionSlug, id)}>{AUDIT_LINK_FELIRAT}</a>
    </li>
  )
}
