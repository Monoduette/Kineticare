import { ANALYTICS_EVENTS, captureAnalyticsEvent } from './posthog'

/**
 * Tanulási funnel PostHog események — csak technikai azonosítók; consent a captureAnalyticsEvent-ben.
 * course_started/completed kurzusonként egyszer.
 */

/** Minden tanulási eseményen ott lévő kurzus-azonosítás. */
export interface CourseEventCourse {
  courseId: number
  courseSku?: string | null
}

export interface LessonEventInput extends CourseEventCourse {
  /** A lecke STABIL refje (BSON ObjectID vagy Bunny-GUID) — nem személyes adat. */
  lessonRef: string
  lessonKind: 'video' | 'szoveg' | 'link'
  /** 0-alapú modul-sorszám a tananyagban. */
  moduleIndex: number
  /** A kurzus haladása a jelölés UTÁN, egész százalékban. */
  percent: number
}

const courseProps = (input: CourseEventCourse): Record<string, unknown> => ({
  courseId: input.courseId,
  // A null/undefined sku ne kerüljön ki üres mezőként.
  ...(typeof input.courseSku === 'string' && input.courseSku.length > 0
    ? { courseSku: input.courseSku }
    : {}),
})

/**
 * A tanuló ELKEZDTE a kurzust — az első lecke elkészültekor, kurzusonként
 * EGYSZER. (Szándékosan nem a lejátszó megnyitásakor: a puszta megnyitás
 * felfújná a „start rate"-et, és eltérne az admin haladás-nézet
 * definíciójától, ahol az „elkezdte" = legalább egy kész lecke.)
 */
export function trackCourseStarted(input: CourseEventCourse): void {
  captureAnalyticsEvent(ANALYTICS_EVENTS.courseStarted, courseProps(input))
}

/** Egy lecke elkészült (kézzel jelölve vagy automatikusan, nézettség alapján). */
export function trackLessonCompleted(input: LessonEventInput): void {
  captureAnalyticsEvent(ANALYTICS_EVENTS.lessonCompleted, {
    ...courseProps(input),
    lessonRef: input.lessonRef,
    lessonKind: input.lessonKind,
    moduleIndex: input.moduleIndex,
    percent: input.percent,
  })
}

/** Egy modul MINDEN elindítható leckéje elkészült. */
export function trackModuleCompleted(
  input: CourseEventCourse & { moduleIndex: number; percent: number },
): void {
  captureAnalyticsEvent(ANALYTICS_EVENTS.moduleCompleted, {
    ...courseProps(input),
    moduleIndex: input.moduleIndex,
    percent: input.percent,
  })
}

/** A kurzus MINDEN elindítható leckéje elkészült — kurzusonként EGYSZER. */
export function trackCourseCompleted(
  input: CourseEventCourse & { lessonCount: number },
): void {
  captureAnalyticsEvent(ANALYTICS_EVENTS.courseCompleted, {
    ...courseProps(input),
    lessonCount: input.lessonCount,
  })
}

/** Videó-mélység mérföldkövek (25/50/75/100) — lejátszófej pozíció, nem lefedettség. */

/** A mért videó-mélységek százalékban. A riportok pontosan ezekre bontanak. */
export const VIDEO_MILESTONE_PERCENTS = [25, 50, 75, 100] as const

/** Egy mérföldkő százaléka. Szűk unió: tetszőleges számot a típus nem enged át. */
export type VideoMilestonePercent = (typeof VIDEO_MILESTONE_PERCENTS)[number]

/** A videó-események közös azonosítása: melyik kurzus melyik leckéje. */
export interface VideoEventInput extends CourseEventCourse {
  /** A lecke STABIL refje (BSON ObjectID vagy Bunny-GUID) — nem személyes adat. */
  lessonRef: string
}

/**
 * A lecke videója TÉNYLEGESEN elindult — leckénként EGYSZER.
 *
 * Nem a lecke megnyitása: a megnyitás felfújná a számot (aki csak
 * belekattint, elindítottnak látszana), és a mérföldkövek nevezője hamis
 * lenne. Az indulás bizonyítéka a lejátszótól érkező, ELŐREHALADÓ pozíció.
 */
export function trackVideoStarted(input: VideoEventInput): void {
  captureAnalyticsEvent(ANALYTICS_EVENTS.videoStarted, {
    ...courseProps(input),
    lessonRef: input.lessonRef,
  })
}

/** Egy videó-mélység mérföldkő — leckénként és mérföldkövenként EGYSZER. */
export function trackVideoMilestone(
  input: VideoEventInput & { percent: VideoMilestonePercent },
): void {
  captureAnalyticsEvent(ANALYTICS_EVENTS.videoMilestone, {
    ...courseProps(input),
    lessonRef: input.lessonRef,
    percent: input.percent,
  })
}
