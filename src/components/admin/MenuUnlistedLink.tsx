'use client'

import { useDocumentInfo, useFormFields } from '@payloadcms/ui'
import { useCallback, useEffect, useState, type CSSProperties, type JSX } from 'react'

import { buildMenuPublicUrl, type MenuPublicUrlResult } from '../../lib/menu-public-url'

/**
 * „Közvetlen link" doboz a menüpont szerkesztőlapján (UI-mező, nem tárol
 * adatot). Csak bekapcsolt „Rejtett link" mellett látszik (a mező
 * `condition`-je a Menus collectionben), és a menüpont ABSZOLÚT linkjét
 * mutatja egy csak-olvasható mezőben, „Másolás" gombbal.
 *
 * ÉLŐ ÉRTÉK: az űrlap aktuális mezőiből dolgozik (`useFormFields`), tehát a
 * cél átválasztása után azonnal a friss linket mutatja, mentés nélkül is. A
 * cél (oldal, cikk, kurzus) az űrlapban csak azonosítóként él (az admin
 * szerkesztőlap depth 0-val kapja az adatot), ezért a slugot és a státuszt a
 * REST API-ról töltjük be (`/api/<collection>/<id>`), az admin saját
 * sütijével.
 *
 * A linket UGYANAZ a feloldás adja, mint a fejléc-navigációét
 * (src/lib/menu-public-url.ts → src/lib/menu-tree.ts), így a kimásolt cím
 * sosem térhet el attól, amit a menü adna (WCAG 2.2 SC 3.2.4 Consistent
 * Identification). A másolás visszajelzése a BunnyLibraryPanel mintája:
 * „Kimásolva" 2 másodpercig, hibánál magyar üzenet, amely kézi másolásra
 * irányít (a vágólap-API biztonságos környezet és engedély nélkül elutasít).
 *
 * A stílus a Payload admin saját CSS-változóira épül (`--theme-elevation-*`,
 * `--style-radius-m`): a projekt `--kc-*` tokenjei a vevői felületé, az
 * adminban nincsenek betöltve (lásd CourseVisibilityNotice.tsx).
 */

export const SAVE_FIRST_MESSAGE = 'Mentés után itt jelenik meg a link.'

export const NO_TARGET_MESSAGE =
  'Válaszd ki a menüpont célját (vagy add meg a webcímet), és a link itt jelenik meg.'

export const LOADING_MESSAGE = 'A cél betöltése folyamatban.'

export const LOAD_FAILED_MESSAGE =
  'A cél most nem tölthető be. Mentsd el a menüpontot, és nyisd meg újra.'

export const DRAFT_TARGET_WARNING =
  'A cél még nincs közzétéve, ezért ez a link 404-es hibaoldalt ad, amíg a célt közzé nem teszed.'

export const UNLISTED_NOTE =
  'A menüpont nem jelenik meg a fejlécben és a mobil menüben. Aki ezt a linket megkapja, eléri a célt.'

export const COPY_LABEL = 'Másolás'

export const COPIED_LABEL = 'Kimásolva'

export const COPY_FAILED_MESSAGE =
  'A másolás nem sikerült. Jelöld ki a linket, és másold ki kézzel.'

/** A „Kimásolva" visszajelzés hossza (a BunnyLibraryPanel mintája). */
export const COPIED_FEEDBACK_MS = 2000

export type MenuUnlistedLinkState =
  /** Új, még nem mentett menüpont, feloldható cél nélkül. */
  | { kind: 'save-first' }
  /** Mentett menüpont, de a cél/webcím hiányzik vagy nem feloldható. */
  | { kind: 'no-target' }
  /** A cél-dokumentum betöltése folyamatban. */
  | { kind: 'loading' }
  /** A cél-dokumentum nem tölthető be. */
  | { kind: 'load-failed' }
  /** Kész link; `targetPublished: false` piszkozat célt jelez. */
  | { kind: 'ready'; absoluteUrl: string; targetPublished: boolean | null }

interface TargetLoad {
  key: string
  doc: Record<string, unknown> | null
}

/**
 * A doboz állapota a feloldás eredményéből (tiszta függvény, tesztelhető).
 *
 * @param resolved  a `buildMenuPublicUrl` eredménye az űrlap adataiból
 * @param isSaved   van-e már azonosítója a dokumentumnak
 * @param target    a betöltött cél (kulcs + dokumentum), vagy hiba (`doc: null`)
 * @param origin    az oldal eredete (a betöltött cél újra-feloldásához)
 */
export function deriveMenuUnlistedLinkState(
  resolved: MenuPublicUrlResult | null,
  isSaved: boolean,
  target: TargetLoad | null,
  origin: unknown,
): MenuUnlistedLinkState {
  if (resolved === null) {
    return { kind: isSaved ? 'no-target' : 'save-first' }
  }
  if (resolved.kind === 'ready') {
    return {
      kind: 'ready',
      absoluteUrl: resolved.absoluteUrl,
      targetPublished: resolved.targetPublished,
    }
  }
  const key = targetKey(resolved)
  if (target === null || target.key !== key) {
    return { kind: 'loading' }
  }
  if (target.doc === null) {
    return { kind: 'load-failed' }
  }
  const populated = buildMenuPublicUrl(
    {
      type: typeFor(resolved.relationTo),
      ref: { relationTo: resolved.relationTo, value: target.doc },
    },
    origin,
  )
  if (populated === null || populated.kind !== 'ready') {
    // Betöltött cél slug nélkül: nincs miből címet képezni.
    return { kind: isSaved ? 'no-target' : 'save-first' }
  }
  return {
    kind: 'ready',
    absoluteUrl: populated.absoluteUrl,
    targetPublished: populated.targetPublished,
  }
}

function targetKey(resolved: Extract<MenuPublicUrlResult, { kind: 'needs-target' }>): string {
  return `${resolved.relationTo}/${resolved.id}`
}

/** A cél REST-útvonala a `collection/id` kulcsból (depth 0: csak a saját mezők kellenek). */
export function targetApiPath(key: string): string {
  const separator = key.indexOf('/')
  const relationTo = key.slice(0, separator)
  const id = key.slice(separator + 1)
  return `/api/${relationTo}/${encodeURIComponent(id)}?depth=0`
}

function typeFor(relationTo: 'pages' | 'posts' | 'products'): 'page' | 'post' | 'product' {
  switch (relationTo) {
    case 'pages':
      return 'page'
    case 'posts':
      return 'post'
    default:
      return 'product'
  }
}

/** Az oldal eredete: build-időben beégetett NEXT_PUBLIC_SERVER_URL, különben a böngésző eredete. */
export function readAdminOrigin(): string | undefined {
  const configured = process.env.NEXT_PUBLIC_SERVER_URL
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return configured
  }
  return typeof window !== 'undefined' ? window.location.origin : undefined
}

const panelStyle: CSSProperties = {
  border: '1px solid var(--theme-elevation-150)',
  borderRadius: 'var(--style-radius-m, 6px)',
  marginBottom: 'var(--base)',
  padding: 'calc(var(--base) * 0.75)',
}

const noteStyle: CSSProperties = {
  color: 'var(--theme-elevation-650)',
  margin: 0,
}

const warningStyle: CSSProperties = {
  border: '1px solid var(--theme-warning-500)',
  background: 'var(--theme-warning-50)',
  color: 'var(--theme-elevation-800)',
  borderRadius: 'var(--style-radius-m, 6px)',
  padding: '0.5rem 0.75rem',
  margin: 'calc(var(--base) * 0.5) 0 0',
  lineHeight: 1.5,
}

const rowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.5rem',
  alignItems: 'center',
  marginTop: 'calc(var(--base) * 0.5)',
}

const inputStyle: CSSProperties = {
  flex: '1 1 16rem',
  minWidth: 0,
  font: 'inherit',
  padding: '0.5rem 0.75rem',
  border: '1px solid var(--theme-elevation-250)',
  borderRadius: 'var(--style-radius-m, 6px)',
  background: 'var(--theme-elevation-50)',
  color: 'var(--theme-elevation-1000)',
}

const buttonStyle: CSSProperties = {
  font: 'inherit',
  // WCAG 2.2 SC 2.5.8 Target Size (Minimum): legalább 24×24 CSS px célfelület.
  minHeight: '2.5rem',
  padding: '0.5rem 1rem',
  border: '1px solid var(--theme-elevation-400)',
  borderRadius: 'var(--style-radius-m, 6px)',
  background: 'var(--theme-elevation-100)',
  color: 'var(--theme-elevation-1000)',
  cursor: 'pointer',
}

export interface MenuUnlistedLinkViewProps {
  state: MenuUnlistedLinkState
  copied: boolean
  copyError: string | null
  onCopy: (url: string) => void
}

/** Megjelenítés (állapot-független, tesztelhető). */
export function MenuUnlistedLinkView({
  state,
  copied,
  copyError,
  onCopy,
}: MenuUnlistedLinkViewProps): JSX.Element {
  const messageFor: Record<Exclude<MenuUnlistedLinkState['kind'], 'ready'>, string> = {
    'save-first': SAVE_FIRST_MESSAGE,
    'no-target': NO_TARGET_MESSAGE,
    loading: LOADING_MESSAGE,
    'load-failed': LOAD_FAILED_MESSAGE,
  }

  return (
    <div style={panelStyle}>
      <p style={noteStyle}>{UNLISTED_NOTE}</p>
      {state.kind === 'ready' ? (
        <>
          <div style={rowStyle}>
            <input
              type="text"
              readOnly
              value={state.absoluteUrl}
              aria-label="Közvetlen link"
              style={inputStyle}
              onFocus={(event) => event.currentTarget.select()}
            />
            <button type="button" style={buttonStyle} onClick={() => onCopy(state.absoluteUrl)}>
              {copied ? COPIED_LABEL : COPY_LABEL}
            </button>
          </div>
          {/* A „Kimásolva" váltás a felolvasónak is szól, nem csak a gomb feliratán. */}
          <p role="status" aria-live="polite" style={{ ...noteStyle, marginTop: '0.25rem' }}>
            {copied ? COPIED_LABEL : copyError}
          </p>
          {state.targetPublished === false ? (
            <p role="alert" style={warningStyle}>
              {DRAFT_TARGET_WARNING}
            </p>
          ) : null}
        </>
      ) : (
        <p role="status" style={{ ...noteStyle, marginTop: '0.5rem' }}>
          {messageFor[state.kind]}
        </p>
      )}
    </div>
  )
}

function readDoc(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || !('id' in body)) {
    return null
  }
  return body as Record<string, unknown>
}

export function MenuUnlistedLink(): JSX.Element {
  const { id } = useDocumentInfo()
  const type = useFormFields(([fields]) => fields?.type?.value)
  const ref = useFormFields(([fields]) => fields?.ref?.value)
  const url = useFormFields(([fields]) => fields?.url?.value)

  const origin = readAdminOrigin()
  const resolved = buildMenuPublicUrl({ type, ref, url }, origin)
  const neededKey = resolved?.kind === 'needs-target' ? targetKey(resolved) : null

  const [target, setTarget] = useState<TargetLoad | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)

  // A betöltést a `collection/id` kulcs vezérli: a cél átválasztásakor új
  // kérés indul, a régi megszakad, a korábbi cél linkje nem ragadhat a lapon.
  useEffect(() => {
    if (neededKey === null) {
      return
    }
    const controller = new AbortController()
    const load = async () => {
      try {
        const response = await fetch(targetApiPath(neededKey), {
          credentials: 'include',
          signal: controller.signal,
        })
        const body: unknown = await response.json().catch(() => null)
        const doc = response.ok ? readDoc(body) : null
        setTarget({ key: neededKey, doc })
      } catch {
        if (!controller.signal.aborted) {
          setTarget({ key: neededKey, doc: null })
        }
      }
    }
    void load()
    return () => controller.abort()
  }, [neededKey])

  useEffect(() => {
    if (!copied) {
      return
    }
    const timer = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  const onCopy = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopyError(null)
      setCopied(true)
    } catch {
      setCopied(false)
      setCopyError(COPY_FAILED_MESSAGE)
    }
  }, [])

  const state = deriveMenuUnlistedLinkState(
    resolved,
    id !== undefined && id !== null && id !== '',
    target,
    origin,
  )

  return (
    <MenuUnlistedLinkView
      state={state}
      copied={copied}
      copyError={copyError}
      onCopy={(value) => void onCopy(value)}
    />
  )
}
