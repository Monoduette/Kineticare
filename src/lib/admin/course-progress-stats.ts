import type { Curriculum } from '../curriculum/curriculum'
import { summarizeCurriculum } from '../curriculum/progress'

/**
 * Admin kurzus-haladás összesítő. Százalék: `summarizeCurriculum`; beiratkozott = enrollments lista.
 */

/** A hallgató állapota a kurzuson — a panel chipje ezt mutatja. */
export type CourseStudentStatus = 'nem-kezdte' | 'folyamatban' | 'befejezte'

/** Egy beiratkozott (a terméket a `purchases` listáján hordozó) felhasználó. */
export interface CourseEnrollment {
  userId: number
  email: string
  /** A megadott név, ha van — a users.name mező nem kötelező. */
  name: string | null
  /**
   * Mikor kapott hozzáférést, ha ismert.
   *
   * A `users.purchases` reláció SZÁNDÉKOSAN nem tárol dátumot (a séma
   * bővítése migrációt igényelne, ami tilos zóna), ezért a végpont jelenleg
   * nem tölti ki. A mező azért van itt, mert a hívó (pl. egy későbbi,
   * rendelésekből visszafejtett időpont — lásd src/lib/course-access-lookup.ts)
   * be tudja adni, és a panel ilyenkor változtatás nélkül megjeleníti.
   */
  enrolledAt?: string | null
}

/** Egy `course-progress` sor annyi mezővel, amennyit az összesítés ismer. */
export interface CourseProgressStatRow {
  userId: number
  videoRef: string
  /** A megjelölés ideje (ISO). Hiányzó/érvénytelen érték egyszerűen kimarad. */
  watchedAt?: string | null
}

/** Egy hallgató sora az admin táblázatában. */
export interface CourseStudentProgress {
  userId: number
  name: string | null
  email: string
  /** Kész (megjelölt, a tananyagban is meglévő) leckék száma. */
  completed: number
  /** Az elindítható leckék száma — a nevező. */
  total: number
  /** Kerekített százalék, 0–100. */
  percent: number
  status: CourseStudentStatus
  /** A legutolsó SZÁMÍTÓ lecke megjelölésének ideje (ISO), vagy null. */
  lastActivityAt: string | null
  /**
   * A folytatásra váró lecke címe — a vevő lejátszójában is EZ a következő
   * lépés. Befejezett kurzusnál `null`: ott nincs mit folytatni.
   */
  currentLessonTitle: string | null
  /** A beiratkozás ideje, ha a hívó megadta (lásd `CourseEnrollment`). */
  enrolledAt: string | null
}

/** A kurzus egészére vonatkozó összesítés — a panel felső kártyasora. */
export interface CourseProgressTotals {
  /** Hányan férnek hozzá a kurzushoz. */
  enrolled: number
  /** Közülük hányan kezdték el (legalább 1 kész lecke). */
  started: number
  /** Közülük hányan végezték el (minden elindítható lecke kész, total > 0). */
  completed: number
  /** Akik hozzáférnek, de még egy leckét sem jelöltek késznek. */
  notStarted: number
  /** A beiratkozottak százalékainak átlaga, egészre kerekítve (0–100). */
  averagePercent: number
  /**
   * Befejezők aránya a BEIRATKOZOTTAKHOZ mérve, egész százalékban (0–100).
   * 0 beiratkozottnál 0 (nincs nullával osztás).
   */
  completionRateOfEnrolled: number
  /**
   * Befejezők aránya az ELKEZDŐKHÖZ mérve, egész százalékban (0–100).
   * 0 elkezdőnél 0. Ez a „mennyire tartja meg a kurzus azt, aki nekiállt"
   * mérőszám — a marketing-oldali (hányan állnak neki) hatástól elválasztva.
   */
  completionRateOfStarted: number
}

/** Leckénkénti elvégzettség — a lemorzsolódás (funnel) sorai. */
export interface CourseLessonDropOff {
  lessonRef: string
  title: string
  moduleTitle: string
  /** Hány BEIRATKOZOTT hallgató jelölte késznek ezt a leckét. */
  completedCount: number
  /**
   * Az előző leckéhez képest elvesztett hallgatók száma. Az első leckénél 0.
   *
   * Negatív különbség (a későbbi leckét TÖBBEN végezték el, mert átugrották az
   * előzőt) 0-ként jelenik meg: a „lemorzsolódás" oszlop nem mutathat negatív
   * veszteséget. A tényleges darabszám a `completedCount`-ban változatlanul ott
   * van, tehát semmilyen információ nem vész el.
   */
  dropOffFromPrevious: number
}

export interface CourseProgressStats {
  /** A hallgatók a bemeneti (beiratkozási) sorrendben — a rendezés a felületé. */
  students: CourseStudentProgress[]
  totals: CourseProgressTotals
  lessons: CourseLessonDropOff[]
}

export interface CourseProgressStatsInput {
  curriculum: Curriculum
  enrollments: readonly CourseEnrollment[]
  progressRows: readonly CourseProgressStatRow[]
}

/** Nem üres szöveg, vagy null. */
function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Érvényes, véges azonosító (a JSON-ból és a DB-ből is jöhet hibás érték). */
function isUsableUserId(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** ISO-időbélyeg ezredmásodpercben, vagy null, ha értelmezhetetlen. */
function timestampMs(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null
  }
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

/** Egész százalék 0-osztás nélkül (0 nevező → 0). */
function percentage(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100)
}

/** Egy felhasználó összegyűjtött haladás-adata a csoportosítás után. */
interface UserProgressBucket {
  /** Minden megjelölt ref (a szűrést a közös modul végzi). */
  refs: Set<string>
  /** A SZÁMÍTÓ (a tananyagban meglévő, elindítható) leckék legutolsó ideje. */
  lastCountedAt: string | null
  lastCountedMs: number
}

/**
 * A kurzus teljes admin-összesítése.
 *
 * A függvény TISZTA: ugyanarra a bemenetre mindig ugyanaz a kimenet, nincs
 * óra-, DB- vagy hálózat-függése — így a szélsőséges esetek (0 beiratkozott,
 * 0 leckés kurzus, orphan ref, nem beiratkozott felhasználó haladás-sora,
 * duplikált sor) kimerítően tesztelhetők.
 */
export function buildCourseProgressStats(input: CourseProgressStatsInput): CourseProgressStats {
  const { curriculum, enrollments, progressRows } = input

  // 1) A tananyag ELINDÍTHATÓ leckéi megjelenítési sorrendben, modul-címmel.
  //    A lemorzsolódás-sorok és a „mi számít bele" halmaz is ebből képződik.
  const playable: Array<{ ref: string; title: string; moduleTitle: string }> = []
  // A `module` NÉV szándékosan kerülendő (Next.js lint-szabály: no-assign-module-variable).
  for (const chapter of curriculum.modules) {
    for (const lesson of chapter.lessons) {
      if (lesson.playable) {
        playable.push({ ref: lesson.ref, title: lesson.title, moduleTitle: chapter.title })
      }
    }
  }
  const playableRefs = new Set(playable.map((lesson) => lesson.ref))

  // 2) A beiratkozottak — userId szerint DEDUPLIKÁLVA. Ugyanaz a felhasználó
  //    kétszer nem kerülhet a táblázatba (és nem duplázhatja a nevezőt sem),
  //    akkor sem, ha a hívó lapozás közben kétszer adta át.
  const uniqueEnrollments: CourseEnrollment[] = []
  const enrolledIds = new Set<number>()
  for (const enrollment of enrollments) {
    if (!isUsableUserId(enrollment.userId) || enrolledIds.has(enrollment.userId)) {
      continue
    }
    enrolledIds.add(enrollment.userId)
    uniqueEnrollments.push(enrollment)
  }

  // 3) Haladás-sorok → userId szerinti kosarak. KIZÁRÓLAG a beiratkozottakét
  //    tartjuk meg: a hozzáférését vesztett felhasználó sorai nem torzíthatják
  //    sem a hallgatólistát, sem a lemorzsolódást.
  const buckets = new Map<number, UserProgressBucket>()
  for (const row of progressRows) {
    const ref = trimmedOrNull(row.videoRef)
    if (!isUsableUserId(row.userId) || ref === null || !enrolledIds.has(row.userId)) {
      continue
    }
    let bucket = buckets.get(row.userId)
    if (bucket === undefined) {
      bucket = { refs: new Set<string>(), lastCountedAt: null, lastCountedMs: Number.NEGATIVE_INFINITY }
      buckets.set(row.userId, bucket)
    }
    bucket.refs.add(ref)
    // Az utolsó aktivitás csak a SZÁMÍTÓ leckékből jöhet (lásd fejléc).
    if (playableRefs.has(ref)) {
      const ms = timestampMs(row.watchedAt)
      if (ms !== null && ms > bucket.lastCountedMs) {
        bucket.lastCountedMs = ms
        bucket.lastCountedAt = row.watchedAt ?? null
      }
    }
  }

  // 4) Hallgatónkénti sor — a százalék a KÖZÖS modulból.
  const students: CourseStudentProgress[] = []
  const lessonCompletedCounts = new Map<string, number>()
  let started = 0
  let completed = 0
  let percentSum = 0

  for (const enrollment of uniqueEnrollments) {
    const bucket = buckets.get(enrollment.userId)
    const refs = bucket?.refs ?? new Set<string>()
    const summary = summarizeCurriculum(curriculum, refs)

    const status: CourseStudentStatus = summary.complete
      ? 'befejezte'
      : summary.started
        ? 'folyamatban'
        : 'nem-kezdte'

    if (status !== 'nem-kezdte') {
      started += 1
    }
    if (status === 'befejezte') {
      completed += 1
    }
    percentSum += summary.percent

    // A lemorzsolódás-számláló ugyanabban a menetben töltődik: minden
    // beiratkozott minden KÉSZ, elindítható leckéjét egyszer számoljuk.
    for (const lesson of playable) {
      if (refs.has(lesson.ref)) {
        lessonCompletedCounts.set(lesson.ref, (lessonCompletedCounts.get(lesson.ref) ?? 0) + 1)
      }
    }

    students.push({
      userId: enrollment.userId,
      name: trimmedOrNull(enrollment.name),
      email: enrollment.email,
      completed: summary.completed,
      total: summary.total,
      percent: summary.percent,
      status,
      lastActivityAt: bucket?.lastCountedAt ?? null,
      // Befejezett kurzusnál a közös modul az ELSŐ leckére mutat vissza
      // (újranézés) — az adminban ez félrevezető lenne, ezért ott nincs
      // „aktuális lecke".
      currentLessonTitle: summary.complete ? null : (summary.resumeLesson?.title ?? null),
      enrolledAt: enrollment.enrolledAt ?? null,
    })
  }

  const enrolled = students.length
  const totals: CourseProgressTotals = {
    enrolled,
    started,
    completed,
    notStarted: enrolled - started,
    averagePercent: enrolled === 0 ? 0 : Math.round(percentSum / enrolled),
    completionRateOfEnrolled: percentage(completed, enrolled),
    completionRateOfStarted: percentage(completed, started),
  }

  // 5) Lemorzsolódás a megjelenítési sorrendben.
  const lessons: CourseLessonDropOff[] = []
  let previousCount: number | null = null
  for (const lesson of playable) {
    const completedCount = lessonCompletedCounts.get(lesson.ref) ?? 0
    lessons.push({
      lessonRef: lesson.ref,
      title: lesson.title,
      moduleTitle: lesson.moduleTitle,
      completedCount,
      dropOffFromPrevious: previousCount === null ? 0 : Math.max(0, previousCount - completedCount),
    })
    previousCount = completedCount
  }

  return { students, totals, lessons }
}
