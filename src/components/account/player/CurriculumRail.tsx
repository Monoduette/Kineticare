'use client'

import { useEffect, useRef } from 'react'

import type { Curriculum } from '@/lib/curriculum/curriculum'
import type { CurriculumProgress } from '@/lib/curriculum/progress'

import { formatLessonDuration } from './navigation'
import {
  AttachmentIcon,
  CheckIcon,
  ChevronIcon,
  LessonKindIcon,
  LessonStatusIcon,
} from './icons'

/**
 * CURRICULUM-RAIL — a kurzus tananyaga modul-akkordeonként.
 * A rail NEM „egy nyitva" akkordeon: minden modul külön nyitható és csukható.
 * Egy tananyagban a vevő rendszeresen összehasonlít („hol tartok a 2.-ban, mi
 * jön a 3.-ban"), és az egymást bezáró panelek ezt ellehetetlenítik — a
 * kényszerű bezárás ráadásul elveszi a felhasználó által beállított nézetet.
 * A W3C APG ezért a független disclosure-t ajánlja alapesetnek.
 */

export interface CurriculumRailProps {
  curriculum: Curriculum
  progress: CurriculumProgress
  /** A késznek jelölt leckék refjei (a kliens optimista állapota). */
  watched: ReadonlySet<string>
  /** Az éppen nyitott lecke refje. */
  activeRef: string | null
  /** A nyitott modulok azonosítói. */
  openModuleIds: ReadonlySet<string>
  onToggleModule: (moduleId: string) => void
  onSelectLesson: (lessonRef: string) => void
  /**
   * Az azonosítók előtagja. Az `aria-controls`/`aria-labelledby` párokhoz
   * DOKUMENTUM-EGYEDI id kell; a lejátszó egy stabil, kurzus-alapú előtagot ad,
   * hogy a szerver- és a kliens-render azonosítói egyezzenek (a React
   * `useId`-je is jó lenne, de a rail két helyen — asztali sáv és mobil panel —
   * SOSEM jelenik meg egyszerre, így a stabil előtag egyszerűbb és olvashatóbb).
   */
  idPrefix: string
}

export function CurriculumRail({
  activeRef,
  curriculum,
  idPrefix,
  onSelectLesson,
  onToggleModule,
  openModuleIds,
  progress,
  watched,
}: CurriculumRailProps) {
  const activeButtonRef = useRef<HTMLButtonElement | null>(null)

  /**
   * Lecke-váltáskor a rail görgesse láthatóba az aktív sort. A `block: 'nearest'`
   * a LEHETŐ LEGKISEBB elmozdulást végzi: ha a sor már látszik, semmi sem
   * történik — így a mountkori (0. lecke) állapot nem rántja el az oldalt, egy
   * hosszú tananyag 30. leckéjénél viszont odagördít.
   */
  useEffect(() => {
    activeButtonRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeRef])

  return (
    <nav aria-label="A kurzus tananyaga" className="kc-player-rail">
      <ol className="kc-player-rail__modules">
        {curriculum.modules.map((courseModule, moduleIndex) => {
          const headerId = `${idPrefix}-modul-${moduleIndex}-fejlec`
          const panelId = `${idPrefix}-modul-${moduleIndex}-panel`
          const isOpen = openModuleIds.has(courseModule.id)
          const moduleProgress = progress.byModule[moduleIndex]
          const total = moduleProgress?.total ?? 0
          const completed = moduleProgress?.completed ?? 0
          const isModuleComplete = moduleProgress?.complete ?? false

          return (
            <li className="kc-player-rail__module" key={courseModule.id}>
              <h3 className="kc-player-rail__module-heading">
                <button
                  aria-controls={panelId}
                  aria-expanded={isOpen}
                  className="kc-player-rail__module-button"
                  id={headerId}
                  onClick={() => onToggleModule(courseModule.id)}
                  type="button"
                >
                  <span className="kc-player-rail__module-title">{courseModule.title}</span>
                  <span className="kc-player-rail__module-meta">
                    {isModuleComplete ? (
                      <CheckIcon className="kc-player-rail__module-check" />
                    ) : null}
                    {total > 0 ? (
                      <span className="kc-player-rail__module-count">
                        <span aria-hidden="true">
                          {completed}/{total}
                        </span>
                        <span className="kc-sr-only">
                          {completed} kész lecke a {total} leckéből
                        </span>
                      </span>
                    ) : null}
                    <ChevronIcon className="kc-player-rail__chevron" />
                  </span>
                </button>
              </h3>

              <div
                aria-labelledby={headerId}
                className="kc-player-rail__panel"
                hidden={!isOpen}
                id={panelId}
              >
                {courseModule.summary === null ? null : (
                  <p className="kc-player-rail__module-summary">{courseModule.summary}</p>
                )}
                <ol className="kc-player-rail__lessons">
                  {courseModule.lessons.map((lesson) => {
                    const isActive = lesson.ref === activeRef
                    const isWatched = watched.has(lesson.ref)
                    const duration = formatLessonDuration(lesson.durationSec)
                    // A nem elindítható (feldolgozás alatti) lecke állapota az
                    // egyetlen, amiről a vevőnek MOST nincs teendője.
                    const statusText = !lesson.playable
                      ? 'Hamarosan elérhető'
                      : isWatched
                        ? 'Befejezve'
                        : 'Nem kezdett'

                    return (
                      <li className="kc-player-rail__lesson" key={lesson.ref}>
                        <button
                          aria-current={isActive ? 'true' : undefined}
                          className={[
                            'kc-player-rail__lesson-button',
                            isActive ? 'kc-player-rail__lesson-button--active' : null,
                            isWatched ? 'kc-player-rail__lesson-button--done' : null,
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          disabled={!lesson.playable}
                          onClick={() => onSelectLesson(lesson.ref)}
                          ref={isActive ? activeButtonRef : undefined}
                          type="button"
                        >
                          <LessonStatusIcon
                            className="kc-player-rail__lesson-status"
                            complete={isWatched}
                          />
                          <LessonKindIcon
                            className="kc-player-rail__lesson-kind"
                            kind={lesson.kind}
                          />
                          <span className="kc-player-rail__lesson-title">{lesson.title}</span>
                          {lesson.attachments.length > 0 ? (
                            <AttachmentIcon className="kc-player-rail__lesson-attachment" />
                          ) : null}
                          <span aria-hidden="true" className="kc-player-rail__lesson-meta">
                            {lesson.playable ? (duration ?? '') : 'Hamarosan'}
                          </span>
                          <span className="kc-sr-only">
                            {statusText}
                            {lesson.attachments.length > 0 ? ', melléklettel' : ''}
                            {duration === null ? '' : `, hossza ${duration}`}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              </div>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
