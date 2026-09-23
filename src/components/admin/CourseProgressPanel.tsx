'use client'

import { Button, useAuth, useDocumentInfo } from '@payloadcms/ui'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, type JSX } from 'react'

import { hasStaffOrOwnerRole } from '../../access/roles'
import type {
  CourseLessonDropOff,
  CourseProgressTotals,
  CourseStudentProgress,
  CourseStudentStatus,
} from '../../lib/admin/course-progress-stats'
import './course-progress-panel.css'
import {
  cardLabelStyle,
  cardStyle,
  cardValueStyle,
  cardsStyle,
  errorStyle,
  filterFieldStyle,
  filterRowStyle,
  noteStyle,
  panelStyle,
  rowStyle,
  srOnlyStyle,
  warningStyle,
} from './course-progress-styles'
import { LessonDropOffTable, StudentsTable } from './course-progress-tables'
import {
  csvFileName,
  filterStudents,
  readProgressDeepLink,
  sortStudents,
  studentsCsv,
  visibleCountLabel,
  NO_DATA,
  PROGRESS_PANEL_ANCHOR,
  STATUS_FILTER_OPTIONS,
  STUDENT_PAGE_SIZE,
  STUDENT_PAGE_STEP,
  type SortDirection,
  type StudentSortKey,
  type StudentStatusFilter,
} from './course-progress-view'

/**
 * „Kurzus-haladás" panel a kurzus (products) szerkesztőnézetében
 */

const REQUEST_TIMEOUT_MS = 30_000

/** Ennyi idő után engedjük el a CSV blob-URL-jét (lásd a `downloadCsv` mérését). */
const CSV_URL_RELEASE_MS = 1_000

/**
 * A magyar mikroszöveg-szabályzat (`docs/ui-sztenderdek.md` §3.1, §2.7) szerint
 * a hibaüzenet végig TEGEZ: a korábbi „Kérjük, próbáld újra később" egyetlen
 * mondaton belül keverte a magázást a tegezéssel.
 */
const GENERIC_ERROR = 'A kurzus-haladás most nem tölthető be. Próbáld újra később.'
const NETWORK_ERROR = 'Nem sikerült elérni a szervert. Ellenőrizd a kapcsolatot, és próbáld újra.'
const EMPTY_STATE = 'Ehhez a kurzushoz még senki nem kapott hozzáférést.'
const NO_MATCH = 'A szűrésnek egyetlen hallgató sem felel meg.'

/** A hallgató-táblázat képernyőolvasónak szóló neve (a `role="region"`-é is). */
const STUDENTS_CAPTION = 'A kurzushoz hozzáférő hallgatók haladása'
const STUDENTS_CAPTION_ID = 'kc-course-progress-hallgatok'
const LESSONS_CAPTION = 'Leckénkénti elvégzettség és lemorzsolódás'
const LESSONS_CAPTION_ID = 'kc-course-progress-leckek'

/** A végpont válasza — a panel által használt mezőkre szűkítve. */
interface CourseProgressData {
  students: CourseStudentProgress[]
  totals: CourseProgressTotals
  lessons: CourseLessonDropOff[]
  notice: string | null
  product: { title: string }
  meta: { generatedAt: string; totalLessons: number }
}

/** A lekérdezés eredménye. A hívó ebből ír állapotot, a kérés maga nem ír. */
type ProgressResult =
  | { ok: true; data: CourseProgressData }
  | { ok: false; message: string }

/** A szerver magyar hibaüzenete a válasz-törzsből ({ error: string }). */
function readServerError(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return null
  }
  const error = (body as Record<string, unknown>).error
  return typeof error === 'string' && error.trim().length > 0 ? error : null
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function readStatus(value: unknown): CourseStudentStatus {
  return value === 'befejezte' || value === 'folyamatban' ? value : 'nem-kezdte'
}

/**
 * A válasz szűkítése a panel modelljére.
 *
 * A `fetch` `unknown`-t ad, a `any` pedig tilos, ezért minden mező
 * típusszűkítve olvasódik. Hiányzó mező sosem dob: a panel inkább 0-t mutat,
 * mint hogy fehér képernyőre fusson egy váratlan válasz-alaktól.
 */
function readCourseProgress(body: unknown): CourseProgressData | null {
  if (typeof body !== 'object' || body === null) {
    return null
  }
  const record = body as Record<string, unknown>
  const rawStudents = Array.isArray(record.students) ? record.students : null
  const rawTotals = typeof record.totals === 'object' && record.totals !== null ? record.totals : null
  if (rawStudents === null || rawTotals === null) {
    return null
  }
  const totalsRecord = rawTotals as Record<string, unknown>

  const students: CourseStudentProgress[] = []
  for (const entry of rawStudents) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }
    const student = entry as Record<string, unknown>
    students.push({
      userId: readNumber(student.userId),
      name: readText(student.name),
      email: readText(student.email) ?? NO_DATA,
      completed: readNumber(student.completed),
      total: readNumber(student.total),
      percent: readNumber(student.percent),
      status: readStatus(student.status),
      lastActivityAt: readText(student.lastActivityAt),
      currentLessonTitle: readText(student.currentLessonTitle),
      enrolledAt: readText(student.enrolledAt),
    })
  }

  const lessons: CourseLessonDropOff[] = []
  if (Array.isArray(record.lessons)) {
    for (const entry of record.lessons) {
      if (typeof entry !== 'object' || entry === null) {
        continue
      }
      const lesson = entry as Record<string, unknown>
      lessons.push({
        lessonRef: readText(lesson.lessonRef) ?? '',
        title: readText(lesson.title) ?? 'Névtelen lecke',
        moduleTitle: readText(lesson.moduleTitle) ?? '',
        completedCount: readNumber(lesson.completedCount),
        dropOffFromPrevious: readNumber(lesson.dropOffFromPrevious),
      })
    }
  }

  return {
    students,
    totals: {
      enrolled: readNumber(totalsRecord.enrolled),
      started: readNumber(totalsRecord.started),
      completed: readNumber(totalsRecord.completed),
      notStarted: readNumber(totalsRecord.notStarted),
      averagePercent: readNumber(totalsRecord.averagePercent),
      completionRateOfEnrolled: readNumber(totalsRecord.completionRateOfEnrolled),
      completionRateOfStarted: readNumber(totalsRecord.completionRateOfStarted),
    },
    lessons,
    notice: readText(record.notice),
    product: {
      title:
        readText(
          (typeof record.product === 'object' && record.product !== null
            ? (record.product as Record<string, unknown>).title
            : null),
        ) ?? 'kurzus',
    },
    meta: {
      generatedAt:
        readText(
          typeof record.meta === 'object' && record.meta !== null
            ? (record.meta as Record<string, unknown>).generatedAt
            : null,
        ) ?? '',
      totalLessons: readNumber(
        typeof record.meta === 'object' && record.meta !== null
          ? (record.meta as Record<string, unknown>).totalLessons
          : null,
      ),
    },
  }
}

/**
 * A haladás lekérdezése. SZÁNDÉKOSAN nem ír állapotot, és sosem dob: az
 * eredményt a hívó vezeti be. Így ugyanaz a hívás használható a gombról és a
 * mély link mountkori effektjéből is, és az effekt törzsében nincs szinkron
 * `setState` (`react-hooks/set-state-in-effect`, lásd eslint.config.mjs).
 *
 * NAPLÓZÁS NINCS, és nem is lehet: hibaágon sem kerülhet hallgatói objektum a
 * naplóba (`docs/statisztika-audit-2026-08-21.md` 6.5 — a logger redact-listáján
 * rajta van az `email`, a `name` NINCS).
 */
async function fetchCourseProgress(productId: string): Promise<ProgressResult> {
  try {
    const response = await fetch(
      `/api/admin/course-progress?productId=${encodeURIComponent(productId)}`,
      {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    )
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    if (!response.ok) {
      return { ok: false, message: readServerError(body) ?? GENERIC_ERROR }
    }
    const parsed = readCourseProgress(body)
    return parsed === null ? { ok: false, message: GENERIC_ERROR } : { ok: true, data: parsed }
  } catch {
    // Hálózati hiba vagy időtúllépés: a művelet újrapróbálható marad.
    return { ok: false, message: NETWORK_ERROR }
  }
}

/** Egy összesítő kártya a felső sorban. */
function StatCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div style={cardStyle}>
      <span style={cardValueStyle}>{value}</span>
      <span style={cardLabelStyle}>{label}</span>
    </div>
  )
}

/**
 * A panel címsora.
 * A címsor eddig `h4` volt. MÉRVE (a Payload 3.88.0 forrásából): a szerkesztő-
 * oldal dokumentumcíme `h1` (@payloadcms/ui RenderTitle alapértelmezett
 * eleme), a `type: 'array'` és `type: 'group'` mezők címkéje pedig `h3`
 * (@payloadcms/ui fields/Array és fields/Group). A termékoldalon a panel
 * ELŐTT hét tömb-mező áll, tehát a DOM-ban a h1 → h4 ugrás valójában nem
 */
function PanelHeading(): JSX.Element {
  return <h3 style={{ marginTop: 0 }}>Kurzus-haladás</h3>
}

export function CourseProgressPanel() {
  const { id, isInitializing } = useDocumentInfo()
  const { user } = useAuth<{ id: number | string; role?: string | null }>()
  const searchParams = useSearchParams()

  /**
   * A mély link kérése. `useSearchParams` azért kell a `window.location`
   * helyett, mert a szerveren és a böngészőben UGYANAZT adja, tehát az ebből
   * származtatott kezdőállapot nem okoz hidratálás-eltérést.
   */
  const deepLinkStatus = readProgressDeepLink(searchParams.toString())

  const [data, setData] = useState<CourseProgressData | null>(null)
  // Mély linknél a betöltés azonnal indul, tehát a gomb már az első rendernél
  // „folyamatban" állapotú (NN/g 1. heurisztika: a rendszer mondja meg, mi
  // történik éppen).
  const [loading, setLoading] = useState(deepLinkStatus !== null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StudentStatusFilter>(deepLinkStatus ?? 'mind')
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<StudentSortKey>('haladas')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  /**
   * Hány sor látszik. A korlát azért kell, mert az admin UX-audit 305
   * hozzáférőnél 17 126 px magas panelt mért. A szűrő és a kereső viszont
   * VÉGIG a teljes halmazon dolgozik, tehát semmi nem vész el.
   */
  const [visibleLimit, setVisibleLimit] = useState(STUDENT_PAGE_SIZE)
  /** Az automata betöltés legfeljebb EGYSZER indulhat el. */
  const autoLoadStarted = useRef(false)

  const productId = typeof id === 'number' || typeof id === 'string' ? String(id) : null
  const staffOrOwner = hasStaffOrOwnerRole(user)

  /**
   * A lekérdezés eredményének bevezetése az állapotba.
   *
   * `useCallback`, mert a mély link effektje FÜGG tőle: memoizálás nélkül a
   * függőség minden renderben más volna, és az effekt fölöslegesen újraindulna
   * (a `react-hooks/exhaustive-deps` ezt jelzi is). A panel többi függvénye
   * marad sima függvény, azoktól nem függ effekt.
   */
  const applyResult = useCallback((result: ProgressResult): void => {
    if (result.ok) {
      setData(result.data)
      setErrorMessage(null)
    } else {
      setErrorMessage(result.message)
    }
    setLoading(false)
  }, [])

  // Sima függvény (nem useCallback): a kézi memoizáció itt csak zaj volna,
  // mert semmilyen effekt vagy memoizált gyerek nem függ tőle.
  const loadProgress = async (): Promise<void> => {
    if (productId === null) {
      return
    }
    setLoading(true)
    setErrorMessage(null)
    applyResult(await fetchCourseProgress(productId))
  }

  /**
   * A mély link kiszolgálása: automata betöltés, majd görgetés a panelre.
   *
   * Az effekt törzsében NINCS szinkron `setState` (a kérés egy külön, állapotot
   * nem író függvény, az írás a `then` folytatásában történik), ezért a
   * `react-hooks/set-state-in-effect` szabály nem sérül.
   *
   * A görgetés `behavior` nélkül, tehát AZONNAL ugrik: mozgás nincs, így a
   * `prefers-reduced-motion` sem sérülhet (WCAG 2.2 SC 2.3.3 Animation from
   * Interactions — https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html).
   */
  useEffect(() => {
    if (
      deepLinkStatus === null ||
      productId === null ||
      !staffOrOwner ||
      autoLoadStarted.current
    ) {
      return
    }
    autoLoadStarted.current = true
    document.getElementById(PROGRESS_PANEL_ANCHOR)?.scrollIntoView({ block: 'start' })
    void fetchCourseProgress(productId).then(applyResult)
  }, [applyResult, deepLinkStatus, productId, staffOrOwner])

  /** Ugyanarra az oszlopra kattintva megfordul az irány. */
  const toggleSort = (key: StudentSortKey): void => {
    if (key === sortKey) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
      return
    }
    setSortKey(key)
    setSortDirection('asc')
  }

  if (isInitializing) {
    return (
      <div className="field-type kc-course-progress" id={PROGRESS_PANEL_ANCHOR} style={panelStyle}>
        <PanelHeading />
        <p style={noteStyle}>Betöltés…</p>
      </div>
    )
  }

  if (!staffOrOwner) {
    return (
      <div className="field-type kc-course-progress" id={PROGRESS_PANEL_ANCHOR} style={panelStyle}>
        <PanelHeading />
        <p style={noteStyle}>A kurzus-haladást csak munkatárs vagy tulajdonos nézheti meg.</p>
      </div>
    )
  }

  if (productId === null) {
    return (
      <div className="field-type kc-course-progress" id={PROGRESS_PANEL_ANCHOR} style={panelStyle}>
        <PanelHeading />
        <p style={noteStyle}>
          Előbb mentsd a kurzust: haladást csak meglévő kurzushoz tudunk mutatni.
        </p>
      </div>
    )
  }

  const matchingStudents =
    data === null
      ? []
      : sortStudents(
          filterStudents(data.students, { status: statusFilter, query }),
          sortKey,
          sortDirection,
        )
  const visibleStudents = matchingStudents.slice(0, visibleLimit)

  /**
   * A LÁTHATÓ (szűrt és rendezett) sorok letöltése CSV-fájlba.
   *
   * Az export a SZŰRT teljes halmazt viszi, nem csak a kirajzolt szeletet: a
   * „ki nem kezdte még el" lista így egyetlen kattintással megvan, akkor is, ha
   * a táblázatban épp 25 sor látszik belőle.
   */
  const downloadCsv = (): void => {
    if (data === null) {
      return
    }
    const csv = studentsCsv(matchingStudents, { totalLessons: data.meta.totalLessons })
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = csvFileName(data.product.title, data.meta.generatedAt)
    document.body.appendChild(link)
    link.click()
    // A takarítás KÉSLELTETVE: mind a link eltávolítása, mind a blob-URL
    // elengedése. Böngészőben mérve: ha a horgony azonnal kikerül a DOM-ból (és
    // az objektum-URL azonnal visszavonódik), a letöltés ugyan elindul és a
    // tartalom is jó, de a böngésző ELVESZÍTI a fájlnevet („download" lesz a
    // javasolt név a „Kéztorna-otthon-haladas-2026-08-15.csv" helyett).
    window.setTimeout(() => {
      link.remove()
      URL.revokeObjectURL(url)
    }, CSV_URL_RELEASE_MS)
  }

  return (
    <div className="field-type kc-course-progress" id={PROGRESS_PANEL_ANCHOR} style={panelStyle}>
      <PanelHeading />
      {/* MINDIG a DOM-ban lévő élő régió: a képernyőolvasó csak így figyeli. */}
      <p aria-live="polite" role="status" style={srOnlyStyle}>
        {data === null
          ? ''
          : visibleCountLabel(visibleStudents.length, matchingStudents.length, data.students.length)}
      </p>
      <p style={noteStyle}>
        Ki kapott hozzáférést, ki kezdte el, és hol tart. A százalék ugyanabból a számításból
        jön, amit a vásárló is lát a lejátszóban.
      </p>

      <div style={rowStyle}>
        <Button
          buttonStyle="secondary"
          disabled={loading}
          onClick={() => {
            void loadProgress()
          }}
          size="medium"
        >
          {loading ? 'Betöltés…' : data === null ? 'Megnézem a haladást' : 'Frissítés'}
        </Button>
      </div>

      {errorMessage ? (
        <p role="alert" style={errorStyle}>
          {errorMessage}
        </p>
      ) : null}

      {data === null ? null : (
        <>
          {data.notice ? (
            <p role="status" style={warningStyle}>
              {data.notice}
            </p>
          ) : null}

          <div style={cardsStyle}>
            {/*
              „Hozzáfér", nem „Beiratkozott" (vezetői döntés,
              docs/statisztika-audit-2026-08-21.md 8.2): a hozzáférést ADÓ panel
              már ma is így beszél („Hozzáférés adása", „Hozzáférés megadva"), a
              users mező pedig „Megvásárolt kurzusok". Webshopban senki nem
              iratkozik be. A Statisztika oldal UGYANEBBEN a PR-ben vált át, hogy
              a két felület egyetlen pillanatra se mondjon mást ugyanarra
              (WCAG 2.2 SC 3.2.4 Consistent Identification —
              https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html).
            */}
            <StatCard label="Hozzáfér" value={String(data.totals.enrolled)} />
            <StatCard label="Elkezdte" value={String(data.totals.started)} />
            {/*
              A megrendelő SZÓ SZERINTI kérdése: „ki indította el a kurzust, KI
              MÉG NEM". A szám eddig is megvolt a szerveren (totals.notStarted),
              a panel be is olvasta, csak sosem jelenítette meg, tehát a
              munkatársnak 300 sort kellett volna kézzel megszámolnia.
            */}
            <StatCard label="Nem kezdte el" value={String(data.totals.notStarted)} />
            <StatCard label="Befejezte" value={String(data.totals.completed)} />
            <StatCard label="Átlagos haladás" value={`${String(data.totals.averagePercent)}%`} />
          </div>

          {data.totals.enrolled === 0 ? (
            <p style={{ ...noteStyle, marginTop: 'calc(var(--base) * 0.5)' }}>{EMPTY_STATE}</p>
          ) : (
            <>
              <div style={filterRowStyle}>
                <div style={filterFieldStyle}>
                  <label htmlFor="kineticare-progress-status" style={{ display: 'block' }}>
                    Állapot
                  </label>
                  <select
                    className="kc-admin-input"
                    id="kineticare-progress-status"
                    onChange={(event) => {
                      setStatusFilter(event.target.value as StudentStatusFilter)
                      setVisibleLimit(STUDENT_PAGE_SIZE)
                    }}
                    style={filterFieldStyle}
                    value={statusFilter}
                  >
                    {STATUS_FILTER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={filterFieldStyle}>
                  <label htmlFor="kineticare-progress-search" style={{ display: 'block' }}>
                    Keresés (név vagy e-mail)
                  </label>
                  <input
                    className="kc-admin-input"
                    id="kineticare-progress-search"
                    onChange={(event) => {
                      setQuery(event.target.value)
                      setVisibleLimit(STUDENT_PAGE_SIZE)
                    }}
                    placeholder="Pl. Kovács vagy kovacs@"
                    style={filterFieldStyle}
                    type="search"
                    value={query}
                  />
                </div>
                {/*
                  A régi „Letöltés táblázatba (CSV)" felirat NEM volt igaz: a gomb
                  fájlt tölt le, nem táblázatba tölt. A felirat E/1, mert a
                  látogató saját, következménnyel járó cselekvése (letöltött fájl)
                  — docs/ui-sztenderdek.md §3.1.5, P-1a.
                */}
                {/*
                  A gomb saját függőleges margója kikapcsolva: a szűrősor az
                  aljához igazít (flex-end), a Payload-gomb alapértelmezett
                  margója viszont a 40 px-es .kc-admin-input mezők fölé emelte.
                */}
                <Button
                  buttonStyle="secondary"
                  disabled={matchingStudents.length === 0}
                  margin={false}
                  onClick={downloadCsv}
                  size="small"
                >
                  Letöltöm a listát (CSV)
                </Button>
              </div>

              {/*
                Látható visszajelzés a szűrés eredményéről. Az ÉLŐ (felolvasott)
                párja a panel tetején, mindig jelen lévő rejtett régió: a
                feltételesen beillesztett élő régiót a képernyőolvasó jellemzően
                nem veszi észre, mert a beillesztés pillanatában még nincs mit
                figyelnie (code review-találat).
              */}
              <p style={{ ...noteStyle, marginBottom: 'calc(var(--base) * 0.25)' }}>
                {visibleCountLabel(
                  visibleStudents.length,
                  matchingStudents.length,
                  data.students.length,
                )}
              </p>

              <StudentsTable
                caption={STUDENTS_CAPTION}
                captionId={STUDENTS_CAPTION_ID}
                onSort={toggleSort}
                sortDirection={sortDirection}
                sortKey={sortKey}
                students={visibleStudents}
              />

              {visibleStudents.length === 0 ? <p style={noteStyle}>{NO_MATCH}</p> : null}

              {matchingStudents.length > visibleStudents.length ? (
                <div style={rowStyle}>
                  {/*
                    Puszta lapozás, nem elkötelező cselekvés, ezért E/2 tegező
                    alak (docs/ui-sztenderdek.md §3.1.5, P-1b).
                  */}
                  <Button
                    buttonStyle="secondary"
                    onClick={() => setVisibleLimit(visibleLimit + STUDENT_PAGE_STEP)}
                    size="medium"
                  >
                    {`Mutass még ${String(Math.min(STUDENT_PAGE_STEP, matchingStudents.length - visibleStudents.length))} hallgatót`}
                  </Button>
                </div>
              ) : null}

              {data.lessons.length > 0 ? (
                <details style={rowStyle}>
                  <summary>Leckénkénti lemorzsolódás</summary>
                  <LessonDropOffTable
                    caption={LESSONS_CAPTION}
                    captionId={LESSONS_CAPTION_ID}
                    enrolled={data.totals.enrolled}
                    lessons={data.lessons}
                  />
                </details>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  )
}

export default CourseProgressPanel
