'use client'

import { useAuth } from '@payloadcms/ui'
import { useCallback, useReducer, useState, type CSSProperties } from 'react'

import { hasStaffOrOwnerRole } from '../../access/roles'
import type { BunnyLibraryKind, BunnyLibraryVideo } from '../../lib/stream/bunny-library'
import { BunnyVideoPicker } from './BunnyVideoPicker'
import { BunnyVideoUpload } from './BunnyVideoUpload'
import { BunnyVideoDialog } from './BunnyVideoDialog'
import { UNKNOWN_DURATION_LABEL } from './bunny-video-state'

/**
 * ÖRÖKSÉG: a korábbi, kurzusszerkesztőbe kötött Bunny-lista panel
 * (BunnyLibraryPanel, BunnyLibraryPanelView és a reducere). Ma egyetlen
 * mezőhöz sincs bekötve (course-editor-bindings.test.ts őrzi); a fájlból
 * élesben csak a lenti `BunnyVideoLibrary` fut, azt a Videótár nézet
 * (BunnyLibraryView.tsx) importálja. K50: a törlés külön kör, addig a
 * panel szövege sem utasíthat elavult, kézi azonosító-másolásra: a lecke
 * videóját ma a lecke „Videó kiválasztása” gombja választja ki, új videót a
 * Videótárban lehet feltölteni.
 */

const REQUEST_TIMEOUT_MS = 20_000

export const LIBRARY_SWITCH_HINT =
  'Videótárat váltottál. Töltsd be a listát, hogy ennek a tárnak a videói jelenjenek meg.'

export const LOAD_FAILED_MESSAGE = 'A videótár most nem tölthető be. Próbáld újra később.'

export const NETWORK_FAILED_MESSAGE =
  'Nem sikerült elérni a szervert. Ellenőrizd a kapcsolatot, és próbáld újra.'

export const COPY_FAILED_MESSAGE =
  'A másolás nem sikerült. Jelöld ki az azonosítót, és másold ki kézzel.'

const panelStyle: CSSProperties = {
  border: '1px solid var(--theme-elevation-150)',
  borderRadius: '4px',
  marginBottom: 'var(--base)',
  padding: 'calc(var(--base) * 0.75)',
}

const noteStyle: CSSProperties = {
  color: 'var(--theme-elevation-650)',
  margin: 0,
}

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 'calc(1rem * 14 / 13)',
  marginTop: 'calc(var(--base) * 0.5)',
}

const cellStyle: CSSProperties = {
  borderBottom: '1px solid var(--theme-elevation-100)',
  padding: '0.4rem 0.5rem 0.4rem 0',
  textAlign: 'left',
}

interface ListResponse {
  videos?: BunnyLibraryVideo[]
  truncated?: boolean
  error?: string
}

function readVideos(body: unknown): {
  videos: BunnyLibraryVideo[]
  error: string | null
  truncated: boolean
} {
  if (typeof body !== 'object' || body === null) {
    return { videos: [], error: 'A videótár válasza nem értelmezhető.', truncated: false }
  }
  const record = body as ListResponse
  if (typeof record.error === 'string' && record.error.trim().length > 0) {
    return { videos: [], error: record.error, truncated: false }
  }
  const videos = Array.isArray(record.videos) ? record.videos : []
  return { videos, error: null, truncated: record.truncated === true }
}

/** Ismeretlen hossznál ugyanaz a szöveg, mint a Videótárban (durationLabel), nem jel. */
function formatLength(lengthSec: number | null): string {
  if (lengthSec === null || lengthSec <= 0) {
    return UNKNOWN_DURATION_LABEL
  }
  const minutes = Math.floor(lengthSec / 60)
  const seconds = lengthSec % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export interface BunnyLibraryPanelState {
  /** A legördülőben ÉPP kiválasztott tár. */
  kind: BunnyLibraryKind
  /** A táblázat tartalma: mindig a `kind` szerinti tárból való. */
  videos: BunnyLibraryVideo[]
  error: string | null
  hint: string | null
  truncated: boolean
  loading: boolean
  loaded: boolean
  copiedGuid: string | null
}

export type BunnyLibraryPanelAction =
  | { type: 'library-changed'; kind: BunnyLibraryKind }
  | { type: 'load-started'; kind: BunnyLibraryKind }
  | {
      type: 'load-succeeded'
      kind: BunnyLibraryKind
      videos: BunnyLibraryVideo[]
      truncated: boolean
    }
  | { type: 'load-failed'; kind: BunnyLibraryKind; message: string }
  | { type: 'copy-succeeded'; guid: string }
  | { type: 'copy-failed' }

export const initialBunnyLibraryPanelState: BunnyLibraryPanelState = {
  kind: 'protected',
  videos: [],
  error: null,
  hint: null,
  truncated: false,
  loading: false,
  loaded: false,
  copiedGuid: null,
}

export function bunnyLibraryPanelReducer(
  state: BunnyLibraryPanelState,
  action: BunnyLibraryPanelAction,
): BunnyLibraryPanelState {
  switch (action.type) {
    case 'library-changed': {
      if (action.kind === state.kind) {
        return state
      }
      // Tiszta lap: a másik tár videói, a csonka-figyelmeztetés és a hibaüzenet
      // sem tartozik az új tárhoz.
      return {
        ...initialBunnyLibraryPanelState,
        kind: action.kind,
        hint: state.loaded ? LIBRARY_SWITCH_HINT : null,
      }
    }
    case 'load-started': {
      if (action.kind !== state.kind) {
        return state
      }
      return { ...state, loading: true, error: null, hint: null, copiedGuid: null }
    }
    case 'load-succeeded': {
      if (action.kind !== state.kind) {
        return state
      }
      return {
        ...state,
        loading: false,
        loaded: true,
        error: null,
        hint: null,
        videos: action.videos,
        truncated: action.truncated,
      }
    }
    case 'load-failed': {
      if (action.kind !== state.kind) {
        return state
      }
      return {
        ...state,
        loading: false,
        loaded: false,
        error: action.message,
        hint: null,
        videos: [],
        truncated: false,
        copiedGuid: null,
      }
    }
    case 'copy-succeeded':
      return { ...state, copiedGuid: action.guid, error: null }
    case 'copy-failed':
      return { ...state, copiedGuid: null, error: COPY_FAILED_MESSAGE }
  }
}

/**
 * A panel címsorának szintje.
 * A panel két helyen jelenik meg, KÜLÖNBÖZŐ címsor-környezetben. A kurzus
 * szerkesztőlapján mezőként ül, a Payload saját címsorai alatt: ott a `h3` a
 * helyes szint, ezért az alapértelmezés ez marad. Az önálló Videótár nézetben
 * viszont közvetlenül a lap `h1`-e alatt áll, tehát a `h3` egy szintet
 * ÁTUGRANA (h1 → h3), amit a WCAG 2.2 SC 1.3.1 (Info and Relationships)
 */
export type BunnyLibraryHeadingLevel = 'h2' | 'h3'

export interface BunnyLibraryPanelViewProps {
  state: BunnyLibraryPanelState
  onLibraryChange: (kind: BunnyLibraryKind) => void
  onLoad: () => void
  onCopy: (guid: string) => void
  /** A panel címsorának szintje; alap: `h3` (a termék-szerkesztő környezete). */
  headingLevel?: BunnyLibraryHeadingLevel
}

/** A panel megjelenítő fele: állapotot kap, nem tart. */
export function BunnyLibraryPanelView({
  state,
  onLibraryChange,
  onLoad,
  onCopy,
  headingLevel = 'h3',
}: BunnyLibraryPanelViewProps) {
  const Heading = headingLevel
  return (
    <div className="field-type" style={panelStyle}>
      <Heading style={{ marginTop: 0 }}>Videók a Bunny tárból</Heading>
      <p style={noteStyle}>
        Itt a tárban lévő felvételek listája látszik. Új videót a Videótárban tölthetsz fel. A lecke
        videóját a lecke „Videó kiválasztása” gombjával választod ki: a videó hossza és állapota
        magától kitöltődik, azonosítót nem kell kézzel beírni.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
        <label>
          Videótár{' '}
          <select
            value={state.kind}
            onChange={(event) => {
              onLibraryChange(event.target.value === 'public' ? 'public' : 'protected')
            }}
          >
            <option value="protected">Védett (fizetős leckék)</option>
            <option value="public">Nyilvános (előzetes)</option>
          </select>
        </label>
        <button type="button" onClick={onLoad} disabled={state.loading}>
          {state.loading ? 'Betöltés…' : state.loaded ? 'Lista frissítése' : 'Lista betöltése'}
        </button>
      </div>
      {state.error !== null ? (
        <p style={{ ...noteStyle, marginTop: '0.75rem' }} role="alert">
          {state.error}
        </p>
      ) : null}
      {state.hint !== null ? (
        <p style={{ ...noteStyle, marginTop: '0.75rem' }} role="status">
          {state.hint}
        </p>
      ) : null}
      {state.truncated ? (
        <p style={{ ...noteStyle, marginTop: '0.75rem' }}>
          A lista csonka: a tárban több videó van, mint amennyit egyben megjelenítünk. A hiányzó
          címet a Videótár keresőjével találod meg.
        </p>
      ) : null}
      {state.loaded && state.videos.length === 0 && state.error === null ? (
        <p style={{ ...noteStyle, marginTop: '0.75rem' }}>Ebben a tárban most nincs videó.</p>
      ) : null}
      {state.videos.length > 0 ? (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={cellStyle} scope="col">
                Cím
              </th>
              <th style={cellStyle} scope="col">
                Állapot
              </th>
              <th style={cellStyle} scope="col">
                Hossz
              </th>
              <th style={cellStyle} scope="col">
                Azonosító
              </th>
            </tr>
          </thead>
          <tbody>
            {state.videos.map((video) => (
              <tr key={video.guid}>
                <th style={cellStyle} scope="row">
                  {video.title}
                </th>
                <td style={cellStyle}>{video.statusLabel}</td>
                <td style={cellStyle}>{formatLength(video.lengthSec)}</td>
                <td style={cellStyle}>
                  <code>{video.guid}</code>{' '}
                  <button type="button" onClick={() => onCopy(video.guid)}>
                    {state.copiedGuid === video.guid ? 'Kimásolva' : 'Másolás'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}

export function BunnyLibraryPanel({
  headingLevel = 'h3',
}: { headingLevel?: BunnyLibraryHeadingLevel } = {}) {
  const { user } = useAuth<{ id: number | string; role?: string | null }>()
  const [state, dispatch] = useReducer(bunnyLibraryPanelReducer, initialBunnyLibraryPanelState)

  const load = useCallback(async (library: BunnyLibraryKind) => {
    dispatch({ type: 'load-started', kind: library })
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(`/api/admin/bunny-videos?library=${library}`, {
        credentials: 'include',
        signal: controller.signal,
      })
      const body: unknown = await response.json().catch(() => null)
      const parsed = readVideos(body)
      if (!response.ok) {
        dispatch({
          type: 'load-failed',
          kind: library,
          message: parsed.error ?? LOAD_FAILED_MESSAGE,
        })
        return
      }
      dispatch({
        type: 'load-succeeded',
        kind: library,
        videos: parsed.videos,
        truncated: parsed.truncated,
      })
    } catch {
      dispatch({ type: 'load-failed', kind: library, message: NETWORK_FAILED_MESSAGE })
    } finally {
      window.clearTimeout(timer)
    }
  }, [])

  const copyGuid = useCallback(async (guid: string) => {
    try {
      await navigator.clipboard.writeText(guid)
      dispatch({ type: 'copy-succeeded', guid })
    } catch {
      dispatch({ type: 'copy-failed' })
    }
  }, [])

  if (!hasStaffOrOwnerRole(user)) {
    return null
  }

  return (
    <BunnyLibraryPanelView
      state={state}
      onLibraryChange={(kind) => dispatch({ type: 'library-changed', kind })}
      onLoad={() => void load(state.kind)}
      onCopy={(guid) => void copyGuid(guid)}
      headingLevel={headingLevel}
    />
  )
}

export default BunnyLibraryPanel

/** Önálló nézet; a régi panel exportjai az átmeneti mező-bekötésekhez maradnak. */
export function BunnyVideoLibrary() {
  const { user } = useAuth<{ id: number | string; role?: string | null }>()
  const [library, setLibrary] = useState<BunnyLibraryKind>('protected')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [refresh, setRefresh] = useState(0)
  if (!hasStaffOrOwnerRole(user)) return null
  return (
    <div className="bunny-video">
      <div className="bunny-video-toolbar">
        <label>
          Videótár{' '}
          <select
            value={library}
            onChange={(event) =>
              setLibrary(event.target.value === 'public' ? 'public' : 'protected')
            }
          >
            <option value="protected">Védett</option>
            <option value="public">Nyilvános</option>
          </select>
        </label>
        {library === 'protected' && (
          <button type="button" onClick={() => setUploadOpen(true)}>
            Videó feltöltése
          </button>
        )}
      </div>
      <BunnyVideoPicker key={library} library={library} refreshKey={refresh} />
      {uploadOpen && (
        <BunnyVideoDialog
          title="Videó feltöltése"
          onClose={() => {
            setUploadOpen(false)
            setRefresh((n) => n + 1)
          }}
        >
          <BunnyVideoUpload onUploaded={() => setRefresh((n) => n + 1)} />
        </BunnyVideoDialog>
      )}
    </div>
  )
}
