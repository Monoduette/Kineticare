import type { JSX } from 'react'

import type {
  CourseLessonDropOff,
  CourseStudentProgress,
} from '../../lib/admin/course-progress-stats'
import {
  cellStyle,
  chipStyle,
  headCellStyle,
  progressCellStyle,
  rowHeaderStyle,
  sortButtonStyle,
  sortGlyphInactiveStyle,
  sortGlyphStyle,
  sortHeadCellStyle,
  srOnlyStyle,
  tableStyle,
  tableWrapStyle,
} from './course-progress-styles'
import {
  ariaSortValue,
  dropOffLabel,
  formatRelativeHungarian,
  moduleColumnCell,
  nextLessonLabel,
  ringGeometry,
  sortIndicator,
  statusChipColors,
  statusLabel,
  studentRowLabel,
  NO_DATA,
  type SortDirection,
  type StudentSortKey,
} from './course-progress-view'

/**
 * A kurzus-haladás panel KÉT TÁBLÁZATA, a Payload-függőségektől mentesen.
 */

/** Kis, DEKORATÍV kördiagram — az információt a mellette álló szám hordozza. */
export function ProgressRing({ percent }: { percent: number }): JSX.Element {
  const { radius, circumference, dash, gap } = ringGeometry(percent)
  const size = 30
  const center = size / 2
  return (
    <svg aria-hidden="true" focusable="false" height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
      <circle
        cx={center}
        cy={center}
        fill="none"
        r={radius}
        stroke="var(--theme-elevation-150)"
        strokeWidth={3}
      />
      <circle
        cx={center}
        cy={center}
        fill="none"
        r={radius}
        stroke={percent >= 100 ? 'var(--theme-success-500)' : 'var(--theme-elevation-800)'}
        strokeDasharray={`${String(dash)} ${String(gap)}`}
        strokeDashoffset={circumference / 4}
        strokeLinecap="round"
        strokeWidth={3}
        // A 0%-os ív ne látszódjon pontnak a lekerekített végződés miatt.
        style={{ opacity: dash === 0 ? 0 : 1 }}
      />
    </svg>
  )
}

/** Egy rendezhető oszlopfejléc: gomb + látható rendezés-jelölés. */
function SortableHead({
  column,
  label,
  onSort,
  sortDirection,
  sortKey,
}: {
  column: StudentSortKey
  label: string
  onSort: (key: StudentSortKey) => void
  sortDirection: SortDirection
  sortKey: StudentSortKey
}): JSX.Element {
  const indicator = sortIndicator(column, sortKey, sortDirection)
  return (
    <th
      aria-sort={ariaSortValue(column, sortKey, sortDirection)}
      scope="col"
      style={sortHeadCellStyle}
    >
      <button onClick={() => onSort(column)} style={sortButtonStyle} type="button">
        {label}
        {/* A jel `aria-hidden`: az állapotot a fenti `aria-sort` közli, kétszer
            felolvasni zaj lenne. A látó felhasználónak viszont ez az EGYETLEN
            jelzés, hogy az oszlop rendezhető. */}
        <span
          aria-hidden="true"
          style={indicator.active ? sortGlyphStyle : sortGlyphInactiveStyle}
        >
          {indicator.glyph}
        </span>
      </button>
    </th>
  )
}

export interface StudentsTableProps {
  caption: string
  captionId: string
  onSort: (key: StudentSortKey) => void
  sortDirection: SortDirection
  sortKey: StudentSortKey
  students: readonly CourseStudentProgress[]
}

/** „Ki hol tart": hallgatónkénti haladás-táblázat. */
export function StudentsTable({
  caption,
  captionId,
  onSort,
  sortDirection,
  sortKey,
  students,
}: StudentsTableProps): JSX.Element {
  return (
    <div style={tableWrapStyle} role="region" aria-labelledby={captionId} tabIndex={0}>
      <table style={tableStyle}>
        <caption id={captionId} style={srOnlyStyle}>
          {caption}
        </caption>
        <thead>
          <tr>
            <SortableHead
              column="nev"
              label="Név"
              onSort={onSort}
              sortDirection={sortDirection}
              sortKey={sortKey}
            />
            <th scope="col" style={headCellStyle}>
              E-mail
            </th>
            <th scope="col" style={headCellStyle}>
              Állapot
            </th>
            <SortableHead
              column="haladas"
              label="Haladás"
              onSort={onSort}
              sortDirection={sortDirection}
              sortKey={sortKey}
            />
            <SortableHead
              column="aktivitas"
              label="Utolsó aktivitás"
              onSort={onSort}
              sortDirection={sortDirection}
              sortKey={sortKey}
            />
            <th scope="col" style={headCellStyle}>
              Következő lecke
            </th>
          </tr>
        </thead>
        <tbody>
          {students.map((student) => {
            const chip = statusChipColors(student.status)
            const relative = formatRelativeHungarian(student.lastActivityAt)
            return (
              <tr key={student.userId}>
                <th scope="row" style={rowHeaderStyle}>
                  {studentRowLabel(student)}
                </th>
                <td style={cellStyle}>{student.email}</td>
                <td style={cellStyle}>
                  <span style={{ ...chipStyle, background: chip.background, color: chip.color }}>
                    {statusLabel(student.status)}
                  </span>
                </td>
                <td style={cellStyle}>
                  <span style={progressCellStyle}>
                    <ProgressRing percent={student.percent} />
                    <span style={{ whiteSpace: 'nowrap' }}>
                      {`${String(student.completed)}/${String(student.total)} · ${String(student.percent)}%`}
                    </span>
                  </span>
                </td>
                <td style={cellStyle}>
                  {relative === null ? (
                    NO_DATA
                  ) : (
                    <time dateTime={student.lastActivityAt ?? undefined}>{relative}</time>
                  )}
                </td>
                <td style={cellStyle}>{nextLessonLabel(student)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export interface LessonDropOffTableProps {
  caption: string
  captionId: string
  enrolled: number
  lessons: readonly CourseLessonDropOff[]
}

/** Leckénkénti elvégzettség és lemorzsolódás. */
export function LessonDropOffTable({
  caption,
  captionId,
  enrolled,
  lessons,
}: LessonDropOffTableProps): JSX.Element {
  return (
    <div style={tableWrapStyle} role="region" aria-labelledby={captionId} tabIndex={0}>
      <table style={tableStyle}>
        <caption id={captionId} style={srOnlyStyle}>
          {caption}
        </caption>
        <thead>
          <tr>
            <th scope="col" style={headCellStyle}>
              Fejezet
            </th>
            <th scope="col" style={headCellStyle}>
              Lecke
            </th>
            <th scope="col" style={headCellStyle}>
              Elvégezte
            </th>
            <th scope="col" style={headCellStyle}>
              Lemorzsolódás
            </th>
          </tr>
        </thead>
        <tbody>
          {lessons.map((lesson, index) => {
            const elozo = index === 0 ? null : lessons[index - 1]
            const fejezet = moduleColumnCell(lesson.moduleTitle, elozo?.moduleTitle ?? null)
            return (
              <tr key={lesson.lessonRef}>
                <td style={cellStyle}>
                  {/* Az ISMÉTLŐDŐ fejezetcím vizuálisan eltűnik, a képernyőolvasó
                      viszont MEGKAPJA: az üres cella eddig azt jelentette, hogy a
                      2., 3., 4. lecke sorában nem derült ki, melyik fejezetről van
                      szó (WCAG 2.2 SC 1.3.1). */}
                  <span style={fejezet.repeated ? srOnlyStyle : undefined}>{fejezet.text}</span>
                </td>
                <th scope="row" style={rowHeaderStyle}>
                  {lesson.title}
                </th>
                <td style={cellStyle}>
                  {`${String(lesson.completedCount)}/${String(enrolled)}`}
                </td>
                <td style={cellStyle}>
                  {dropOffLabel(index, lesson.completedCount, elozo?.completedCount ?? null)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
