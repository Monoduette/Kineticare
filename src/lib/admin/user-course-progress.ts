import type { Curriculum } from '../curriculum/curriculum'
import { trimTruncatedProgress } from '../statistics/progress-truncation'
import {
  buildCourseProgressStats,
  type CourseEnrollment,
  type CourseProgressStatRow,
} from './course-progress-stats'
import type { UserCourseProgressEntry, UserProgressRow } from './user-progress-contract'

/**
 * Felhasználók-lista haladás-magja. Százalék: `buildCourseProgressStats`; csonkolás: trimTruncatedUserProgress.
 */

/** Egy kért felhasználó és a hozzáférhető kurzusainak azonosítói. */
export interface UserProgressUserInput {
  userId: number
  /** A `purchases` listából kiolvasott, EGYEDI kurzus-azonosítók. */
  productIds: readonly number[]
}

/** Egy `course-progress` sor annyi mezővel, amennyi ehhez a válaszhoz kell. */
export interface UserProgressSourceRow {
  userId: number
  productId: number
  videoRef: string
}

export interface TrimUserProgressInput {
  /** A kért, megtalált felhasználók. */
  users: readonly UserProgressUserInput[]
  /** A beolvasott haladás-sorok `['user','id']` sorrendben. */
  rows: readonly UserProgressSourceRow[]
  /** Elérte-e a haladás-lapozás a felső korlátot. */
  truncated: boolean
}

export interface TrimUserProgressResult {
  /** A megtartott felhasználók — csak akikről TELJES adatunk van. */
  users: UserProgressUserInput[]
  /** A megtartott haladás-sorok (az utolsó, félbevágott felhasználó nélkül). */
  rows: UserProgressSourceRow[]
  /** Hány felhasználó maradt ki a csonkolás miatt (naplózandó). */
  omitted: number
}

/**
 * Csonkolt haladás-lista levágása — a közös trimTruncatedProgress szabályt hívja.
 * Üres progress + truncated esetén mindenkit kihagy (lista-cellán nincs hova figyelmeztetni).
 */
export function trimTruncatedUserProgress(input: TrimUserProgressInput): TrimUserProgressResult {
  const users = [...input.users]
  const rows = [...input.rows]

  if (input.truncated && rows.length === 0) {
    return { users: [], rows: [], omitted: users.length }
  }

  const teljes = trimTruncatedProgress({
    progressRows: rows,
    enrollments: users,
    truncated: input.truncated,
  })
  return { users: teljes.enrollments, rows: teljes.progressRows, omitted: teljes.omitted }
}

export interface BuildUserProgressRowsInput {
  /** A felhasználók a csonkolás-szabály UTÁN. */
  users: readonly UserProgressUserInput[]
  /** A haladás-sorok a csonkolás-szabály UTÁN. */
  rows: readonly UserProgressSourceRow[]
  /**
   * Kurzus-azonosító → tananyag. Ami nincs benne (időközben törölt kurzus,
   * be nem olvasott tananyag), arról NEM adunk számot: a cella ott „nincs
   * adat"-ot mutat, ami igaz — szemben egy kitalált 0%-kal.
   */
  curriculums: ReadonlyMap<number, Curriculum>
}

/**
 * Felhasználónkénti haladás-sorok a szerződés szerinti alakban.
 *
 * A függvény TISZTA: ugyanarra a bemenetre mindig ugyanaz a kimenet, nincs
 * óra-, DB- vagy hálózat-függése.
 */
export function buildUserProgressRows(input: BuildUserProgressRowsInput): UserProgressRow[] {
  // 1) A felhasználók DEDUPLIKÁLVA, a bemeneti (kérési) sorrendet megtartva.
  //    Ugyanaz a felhasználó kétszer nem kerülhet a válaszba, akkor sem, ha a
  //    lapozás vagy a hívó kétszer adta át.
  const uniqueUsers: UserProgressUserInput[] = []
  const entriesByUser = new Map<number, UserCourseProgressEntry[]>()
  for (const user of input.users) {
    if (!Number.isFinite(user.userId) || entriesByUser.has(user.userId)) {
      continue
    }
    uniqueUsers.push(user)
    entriesByUser.set(user.userId, [])
  }

  // 2) Kurzusonkénti beiratkozás-listák. „Beiratkozott" itt is a közös
  //    definíció: akinek a `purchases` listáján rajta van a kurzus. Csak
  //    olyan kurzust veszünk elő, amelynek a tananyagát ismerjük.
  const enrollmentsByProduct = new Map<number, CourseEnrollment[]>()
  for (const user of uniqueUsers) {
    const seen = new Set<number>()
    for (const productId of user.productIds) {
      if (!Number.isFinite(productId) || seen.has(productId)) {
        continue
      }
      seen.add(productId)
      if (!input.curriculums.has(productId)) {
        continue
      }
      const list = enrollmentsByProduct.get(productId)
      // Az `email` üres sztring, a `name` null: a közös összesítő szerződése
      // kéri a mezőket, de ez a válasz SEM e-mailt, SEM nevet nem hordoz
      // (a lista sora amúgy is kiírja mindkettőt) — így személyes adat be sem
      // kerül ebbe az ágba.
      const enrollment: CourseEnrollment = { userId: user.userId, email: '', name: null }
      if (list === undefined) {
        enrollmentsByProduct.set(productId, [enrollment])
      } else {
        list.push(enrollment)
      }
    }
  }

  // 3) Haladás-sorok kurzusonként. A nem kért (vagy a csonkolásnál kihagyott)
  //    felhasználó sorait el sem tesszük: a közös összesítő is eldobná őket,
  //    de így memóriát sem foglalnak.
  const rowsByProduct = new Map<number, CourseProgressStatRow[]>()
  for (const row of input.rows) {
    if (!entriesByUser.has(row.userId) || !enrollmentsByProduct.has(row.productId)) {
      continue
    }
    const list = rowsByProduct.get(row.productId)
    // A `watchedAt` szándékosan hiányzik: a válasz csak százalékot és állapotot
    // hordoz, az utolsó aktivitás a kurzus szerkesztőlapjának a dolga.
    const statRow: CourseProgressStatRow = { userId: row.userId, videoRef: row.videoRef }
    if (list === undefined) {
      rowsByProduct.set(row.productId, [statRow])
    } else {
      list.push(statRow)
    }
  }

  // 4) Kurzusonként a KÖZÖS összesítő, majd inverzió felhasználóra. A kurzusok
  //    NÖVEKVŐ azonosító-sorrendben futnak, ezért a felhasználónkénti tömb is
  //    ebben a sorrendben áll össze — külön rendezés nélkül, determinisztikusan.
  const productIds = [...enrollmentsByProduct.keys()].sort((left, right) => left - right)
  for (const productId of productIds) {
    const curriculum = input.curriculums.get(productId)
    const enrollments = enrollmentsByProduct.get(productId)
    if (curriculum === undefined || enrollments === undefined) {
      continue
    }
    const stats = buildCourseProgressStats({
      curriculum,
      enrollments,
      progressRows: rowsByProduct.get(productId) ?? [],
    })
    // A nevező a KÖZÖS szabály szerint az ELINDÍTHATÓ leckék száma (ugyanaz a
    // `playable` szűrés, amit a `summarizeCurriculum` használ). A 0-t nem
    // nyeljük le: a cella ebből tudja megkülönböztetni a „még nincs tananyag"
    // esetet a valódi 0%-tól (user-progress-contract.ts, `lessonCount`).
    const lessonCount = curriculum.lessons.filter((lesson) => lesson.playable).length
    for (const student of stats.students) {
      entriesByUser.get(student.userId)?.push({
        productId,
        percent: student.percent,
        status: student.status,
        lessonCount,
      })
    }
  }

  // 5) A válasz sorai. A 0 vásárlású felhasználó ÜRES `courses` tömbbel
  //    szerepel: róla is van érvényes adatunk („nincs kurzusa"), és a cella
  //    így meg tudja különböztetni a betöltés alatti állapottól. Akiről
  //    NINCS adatunk (nem létező azonosító, csonkolás miatt kihagyott
  //    felhasználó), az be sem kerül a listába.
  return uniqueUsers.map((user) => ({
    userId: user.userId,
    courses: entriesByUser.get(user.userId) ?? [],
  }))
}
