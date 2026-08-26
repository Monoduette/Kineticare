import type { CurriculumModule } from '../../lib/curriculum/curriculum'

/**
 * CourseCurriculum — a tananyag (modulok → leckék) VÁSÁRLÁS ELŐTTI nézete.
 * Aki fizetős kurzust mérlegel, a TELJES tantervet akarja látni — ez a
 * GOV.UK „content that all users need to see" tilalma alá esik
 * (docs/ux-belso-oldalak-kutatas.md B5.2, 5.1). Ezért rács + horgony, nem
 * összecsukott lista.
 * KIZÁRÓLAG a szerkezetet: modulcím, összefoglaló, leckecímek, darabszám és
 */
export interface CourseCurriculumProps {
  modules: CurriculumModule[]
  headingId: string
  /** A szakasz címe (a szerkesztő tananyaga fölé). */
  heading: string
}

/** Percre kerekített hossz („48 perc"); 0/ismeretlen hossznál null. */
export function formatDurationMinutes(totalSec: number): string | null {
  if (!Number.isFinite(totalSec) || totalSec <= 0) {
    return null
  }
  const minutes = Math.max(1, Math.round(totalSec / 60))
  return `${minutes} perc`
}

/** „12 lecke · 48 perc" — a hossz csak akkor, ha van rögzített időtartam. */
export function moduleMetaLabel(module: CurriculumModule): string {
  const lessonCount = module.lessons.length
  const totalSec = module.lessons.reduce((sum, lesson) => sum + (lesson.durationSec ?? 0), 0)
  const duration = formatDurationMinutes(totalSec)
  const lessons = `${lessonCount} lecke`
  return duration === null ? lessons : `${lessons} · ${duration}`
}

/** A nem videós leckék típusjelölése (a videó az alapeset, azt nem jelöljük). */
function lessonKindLabel(kind: CurriculumModule['lessons'][number]['kind']): string | null {
  if (kind === 'szoveg') {
    return 'szöveges lecke'
  }
  if (kind === 'link') {
    return 'külső anyag'
  }
  return null
}

export function CourseCurriculum({ modules, headingId, heading }: CourseCurriculumProps) {
  const withLessons = modules.filter((module) => module.lessons.length > 0)
  if (withLessons.length === 0) {
    return null
  }

  return (
    <section aria-labelledby={headingId} className="kc-course-section" id="tananyag">
      <h2 className="kc-course-section__title" id={headingId}>
        {heading}
      </h2>
      <ol className="kc-course-modules" role="list">
        {withLessons.map((module, index) => (
          <li className="kc-course-module" key={module.id}>
            <p aria-hidden="true" className="kc-course-module__index">
              {String(index + 1).padStart(2, '0')}
            </p>
            <h3 className="kc-course-module__title">{module.title}</h3>
            {module.summary ? <p className="kc-course-module__summary">{module.summary}</p> : null}
            <p className="kc-course-module__meta">{moduleMetaLabel(module)}</p>
            <ul className="kc-course-module__lessons" role="list">
              {module.lessons.map((lesson) => {
                const kindLabel = lessonKindLabel(lesson.kind)
                return (
                  <li key={lesson.ref}>
                    {lesson.title}
                    {kindLabel === null ? null : (
                      <span className="kc-course-module__lesson-kind"> ({kindLabel})</span>
                    )}
                  </li>
                )
              })}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  )
}
