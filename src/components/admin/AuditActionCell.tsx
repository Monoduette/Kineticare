'use client'

import { useFormFields } from '@payloadcms/ui'
import type { JSX } from 'react'

/**
 * A Műveletnapló lista „Művelet” és „Érintett típus” oszlopának cellái (K39).
 *
 * A napló a kódba írt azonosítókat tárolja („publish”, „pages”,
 * „grant-purchase”, „customer-import.legacy-purchase”), és a lista ezeket
 * nyersen mutatta. A tulajdonos nem fejlesztő: a felületnek az ő nyelvén kell
 * beszélnie. NN/g, Match Between the System and the Real World: „The system
 * should speak the users' language … rather than system-oriented terms”
 * (https://www.nngroup.com/articles/match-system-real-world/). A tárolt érték
 * NEM változik (a kereső és a szűrő továbbra is a kódra keres), csak a
 * megjelenítés; ismeretlen kódnál a nyers érték marad látható, hogy új
 * műveletfajta se tűnjön el a listából.
 *
 * A kódok forrása (mind a repóban, grep-pel összegyűjtve):
 * - src/plugins/audit.ts: create, publish, delete, refund-update, role-change,
 *   purchase-change (egy mentés több műveletet is jelölhet vesszővel, pl.
 *   „publish,purchase-change”);
 * - src/lib/grant-purchase.ts: grant-purchase;
 * - src/lib/customer-import/execute.ts: customer-import.legacy-purchase;
 * - src/lib/media-recovery-provenance.ts: media.recovery.provenance.v1;
 * - src/lib/refund/recovery-receipts.ts és refund-recovery.ts: a refund-*
 *   nyugták, valamint order-refund és order-partial-refund.
 * Az entitástípus a collection slugja; a feliratok a collectionök magyar
 * egyes számú címkéi.
 */

export const AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
  create: 'Létrehozás',
  publish: 'Közzététel',
  delete: 'Törlés',
  'refund-update': 'Visszatérítési adatok módosítása',
  'role-change': 'Szerepkör módosítása',
  'purchase-change': 'Megvásárolt kurzusok módosítása',
  'grant-purchase': 'Hozzáférés kézi megadása',
  'customer-import.legacy-purchase': 'Régi vásárlás átvétele',
  'media.recovery.provenance.v1': 'Képfájl eredetének rögzítése',
  'refund-prepared': 'Visszatérítés előkészítése',
  'refund-provider-succeeded': 'Visszatérítés a Barionnál',
  'refund-cleanup-started': 'Hozzáférés rendezésének indítása',
  'refund-cleanup-done': 'Hozzáférés rendezése',
  'refund-cleanup-manual': 'Hozzáférés kézi rendezése szükséges',
  'refund-invoice-started': 'Stornó vagy helyesbítő számla indítása',
  'refund-invoice-done': 'Stornó vagy helyesbítő számla kiállítása',
  'order-refund': 'Teljes visszatérítés',
  'order-partial-refund': 'Részleges visszatérítés',
}

export const AUDIT_ENTITY_LABELS: Readonly<Record<string, string>> = {
  pages: 'Oldal',
  posts: 'Blogbejegyzés',
  products: 'Kurzus',
  orders: 'Rendelés',
  users: 'Felhasználó',
  media: 'Kép',
  'refund-intents': 'Visszatérítési szándék',
}

/** Üres cella kimondott szövege (a Payload angol „<No …>” helyőrzője helyett). */
export const AUDIT_EMPTY_LABEL = 'Nincs megadva'

function readCode(cellData: unknown): string | null {
  if (typeof cellData !== 'string') return null
  const code = cellData.trim()
  return code === '' ? null : code
}

/** Mondatközi alak a felsorolás 2. és további tagjához (kódpontonként bontva). */
function inlineLabel(label: string): string {
  const [first = '', ...rest] = label
  return first.toLocaleLowerCase('hu-HU') + rest.join('')
}

/**
 * A művelet felirata. Vesszővel összefűzött kódnál minden tagot külön fordít,
 * a második tagtól mondatközi kisbetűvel („Közzététel, megvásárolt kurzusok
 * módosítása”). Ismeretlen tagnál a nyers kód marad.
 */
export function auditActionLabel(cellData: unknown): string {
  const code = readCode(cellData)
  if (code === null) return AUDIT_EMPTY_LABEL
  const parts = code
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
  if (parts.length === 0) return AUDIT_EMPTY_LABEL
  return parts
    .map((part, index) => {
      const label = AUDIT_ACTION_LABELS[part]
      if (label === undefined) return part
      return index === 0 ? label : inlineLabel(label)
    })
    .join(', ')
}

/** Az érintett tartalomtípus felirata; ismeretlen slugnál a nyers érték. */
export function auditEntityLabel(cellData: unknown): string {
  const code = readCode(cellData)
  if (code === null) return AUDIT_EMPTY_LABEL
  return AUDIT_ENTITY_LABELS[code] ?? code
}

/**
 * A szerkesztőnézet magyar jelentése: a lista „Közzététel”-t mutat, a
 * megnyitott bejegyzés mezője viszont a tárolt kódot („publish”). Hogy a két
 * felület ugyanazt mondja (WCAG 2.2 SC 3.2.4 Consistent Identification), a mező
 * alatt a jelentés áll. Ismeretlen kódnál nem ír semmit.
 */
export function auditMeaningText(code: unknown, kind: 'action' | 'entity'): string | null {
  const raw = readCode(code)
  if (raw === null) return null
  const label = kind === 'action' ? auditActionLabel(raw) : auditEntityLabel(raw)
  return label === raw ? null : `Jelentése: ${label}`
}

function AuditMeaning({
  path,
  kind,
}: {
  path: string
  kind: 'action' | 'entity'
}): JSX.Element | null {
  const value = useFormFields(([fields]) => fields[path]?.value)
  const text = auditMeaningText(value, kind)
  return text === null ? null : <div className="field-description">{text}</div>
}

export function AuditActionDescription({ path }: { path: string }): JSX.Element | null {
  return <AuditMeaning kind="action" path={path} />
}

export function AuditEntityTypeDescription({ path }: { path: string }): JSX.Element | null {
  return <AuditMeaning kind="entity" path={path} />
}

export function AuditActionCell({ cellData }: { cellData?: unknown }): JSX.Element {
  return <span>{auditActionLabel(cellData)}</span>
}

export function AuditEntityTypeCell({ cellData }: { cellData?: unknown }): JSX.Element {
  return <span>{auditEntityLabel(cellData)}</span>
}

export default AuditActionCell
