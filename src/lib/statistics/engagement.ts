import type { CourseEnrollment, CourseProgressStatRow } from '../admin/course-progress-stats'
import { buildCourseProgressStats } from '../admin/course-progress-stats'
import { normalizeAudience, type CourseAudience } from '../course-audience'
import type { Curriculum } from '../curriculum/curriculum'

/** Kurzus-hatás aggregátor — számok a közös `buildCourseProgressStats`-ból. */

/** Egy kurzus hatás-sora a Statisztika nézet táblájában. */
export interface CourseEngagementRow {
  productId: number
  /** A kurzus emberi neve (displayTitle, ennek hiányában sku, végül #id). */
  title: string
  audience: CourseAudience
  /** Hányan férnek hozzá (users.purchases). */
  enrolled: number
  /** Közülük hányan kezdték el (legalább 1 kész lecke). */
  started: number
  /** Közülük hányan fejezték be. */
  completed: number
  /** Akik megvették (hozzáférnek), de egy leckét sem jelöltek késznek. */
  notStarted: number
  /** Elindítható leckék száma; 0-nál a felület külön állapot (nem hamis „nem kezdte el" lista). */
  totalLessons: number
  /** A hozzáférők százalékainak átlaga, egészre kerekítve (0–100). */
  averagePercent: number
  /** Befejezők aránya a hozzáférőkhöz mérve (0–100). */
  completionRateOfEnrolled: number
  /** Befejezők aránya az elkezdőkhöz mérve (0–100). */
  completionRateOfStarted: number
  /* notStartedNames/omitted/truncated kötelező — néma adatvesztés ellen. */
  /**
   * A „nem kezdte el" hallgatók NEVE, magyar betűrendben, legfeljebb
   * `NOT_STARTED_NAME_LIMIT` darab. E-MAIL SOSEM KERÜL IDE (a statisztika
   * oldalára csak név megy: docs/statisztika-audit-2026-08-21.md 6.7).
   */
  notStartedNames: string[]
  /**
   * Hány „nem kezdte el" hallgatónak NINCS megadott neve.
   *
   * A `users.name` kötelező mező, tehát ez normál üzemben 0. Ha mégis
   * előfordul (import, régi sor), a nevét nem tudjuk kiírni, az e-mailjét
   * pedig nem szabad — ezért a felület a DARABSZÁMÁT mondja ki, hogy a
   * névsor ne látszódjon teljesebbnek, mint amilyen.
   */
  notStartedWithoutName: number
  /**
   * Hány hozzáférő maradt ki a csonkolás miatt EBBŐL a kurzusból.
   *
   * Darabszámnál a csonkolás elfogadható alsó becslés; NÉVSORNÁL NEM AZ:
   * egy hiányzó név nem becslés, hanem hamis állítás egy konkrét emberről
   * („nincs a listán" → „nem kezdte el"). A `trimTruncatedProgress`
   * (src/lib/statistics/progress-truncation.ts) eddig is kiszámolta ezt az
   * értéket, de a lekérdező eldobta. A felület kurzusonként kimondja.
   */
  omitted: number
  /**
   * Igaz, ha EBBEN a kurzusban valamelyik lista a felső korlátba ütközött.
   *
   * Az `omitted` a csonkolás ISMERT vesztesége (a haladás-lista végén levágott
   * diákok). A hozzáférő-lista plafonjánál viszont nem tudjuk, hányan maradtak
   * ki: ott csak annyit állíthatunk, hogy a névsor hiányos. A kettő együtt adja
   * ki a becsületes mondatot.
   */
  truncated: boolean
}

/**
 * Legfeljebb ennyi név a Statisztika oldalon kurzusonként; teljes lista a kurzus szerkesztőlapján.
 */
export const NOT_STARTED_NAME_LIMIT = 10

export interface CourseEngagementReport {
  courses: CourseEngagementRow[]
  /** Igaz, ha bármely lekérdezés a felső korlát miatt csonkolt. */
  truncated: boolean
  /**
   * Hány kurzus maradt ki technikai hiba miatt.
   *
   * A lekérdező kurzusonként kap hibát (rossz tananyag-szerkezet, egy
   * megbicsakló adatbázis-hívás), és a hibás kurzust ÁTUGORJA, hogy a
   * többiről szóló jelentés megmaradjon. A hiányzó sort viszont nem
   * hallgatjuk el: ez a szám vezeti ki a felületre.
   */
  skipped: number
  /**
   * Hány hozzáférő maradt ki a csonkolás miatt ÖSSZESEN (a sorok `omitted`
   * értékeinek összege). A kurzusonkénti szám a soron van; ez a lap-szintű
   * figyelmeztetéshez kell, hogy a jelentés önmagában is megválaszolja a
   * „mennyi hiányzik" kérdést.
   */
  omitted: number
}

/** Egy kurzus nyers bemenete — a lekérdező (engagement-query) állítja elő. */
export interface CourseEngagementInput {
  productId: number
  title: string
  audience: unknown
  curriculum: Curriculum
  enrollments: readonly CourseEnrollment[]
  progressRows: readonly CourseProgressStatRow[]
  /**
   * Hány hozzáférőt dobott el a csonkolás-levágás (`trimTruncatedProgress`).
   *
   * KÖTELEZŐ, és ez SZÁNDÉKOS. Pontosan ez az érték veszett el eddig némán: a
   * levágás kiszámolta, a lekérdező meg eldobta, mert nem volt hova tenni.
   * Ha a mező opcionális lenne, ugyanaz a hiba bármikor visszajöhetne úgy,
   * hogy a fordító hallgat. Így viszont egy új hívóhely NEM tud létrejönni
   * anélkül, hogy állást foglalna: volt-e kihagyás vagy nem.
   */
  omitted: number
  /**
   * Elérte-e EBBEN a kurzusban valamelyik lista a felső korlátot.
   *
   * Ugyanaz a szabály, mint az `omitted`-nél: kötelező, mert a névsor
   * hiányossága nem maradhat kimondatlanul.
   */
  truncated: boolean
}

/** Nem negatív egész, vagy 0 — a hívó bármit adhat, a sor mindig ép marad. */
function nemNegativ(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/**
 * A „nem kezdte el" hallgatók neve, magyar betűrendben, plafonnal.
 *
 * A név a KÖZÖS összesítő hallgató-soraiból jön (`buildCourseProgressStats`),
 * nem külön képletből: a statisztika és a kurzuslap ugyanazt az állapotot
 * nevezi „nem kezdte el"-nek. E-mail nem kerül ki (döntési dokumentum 6.7).
 *
 * A betűrend azért kell, mert a beiratkozási sorrend a munkatársnak semmit
 * nem mond, a betűrendes lista viszont VÉGIGOLVASHATÓ és két betöltés között
 * ugyanaz marad (determinisztikus kimenet, tesztelhető).
 */
function notStartedNames(stats: ReturnType<typeof buildCourseProgressStats>): {
  names: string[]
  withoutName: number
} {
  const names: string[] = []
  let withoutName = 0
  for (const student of stats.students) {
    if (student.status !== 'nem-kezdte') {
      continue
    }
    if (student.name === null) {
      withoutName += 1
      continue
    }
    names.push(student.name)
  }
  names.sort((a, b) => a.localeCompare(b, 'hu'))
  return { names: names.slice(0, NOT_STARTED_NAME_LIMIT), withoutName }
}

/** Egy kurzus hatás-sora a KÖZÖS összesítőből. */
export function buildCourseEngagementRow(input: CourseEngagementInput): CourseEngagementRow {
  const stats = buildCourseProgressStats({
    curriculum: input.curriculum,
    enrollments: input.enrollments,
    progressRows: input.progressRows,
  })
  const nevek = notStartedNames(stats)
  return {
    productId: input.productId,
    title: input.title,
    audience: normalizeAudience(input.audience),
    enrolled: stats.totals.enrolled,
    started: stats.totals.started,
    completed: stats.totals.completed,
    notStarted: stats.totals.notStarted,
    // A nevező a KÖZÖS szabály szerinti `playable` leckeszám — ugyanaz a
    // szűrés, amit a `summarizeCurriculum` és a kurzuslap `meta.totalLessons`
    // mezője használ, tehát a két felület nem tud szétcsúszni.
    totalLessons: input.curriculum.lessons.filter((lesson) => lesson.playable).length,
    averagePercent: stats.totals.averagePercent,
    completionRateOfEnrolled: stats.totals.completionRateOfEnrolled,
    completionRateOfStarted: stats.totals.completionRateOfStarted,
    notStartedNames: nevek.names,
    notStartedWithoutName: nevek.withoutName,
    omitted: nemNegativ(input.omitted),
    truncated: input.truncated === true,
  }
}

/**
 * A teljes jelentés. A sorrend: legtöbb hozzáférő elöl (a bevétel-tábla
 * „legnagyobb elöl" mintája), azonos létszámnál magyar ábécé szerint —
 * determinisztikus, tesztelhető rendezés.
 */
export function buildCourseEngagementReport(
  inputs: readonly CourseEngagementInput[],
  options?: { truncated?: boolean; skipped?: number },
): CourseEngagementReport {
  const courses = inputs
    .map(buildCourseEngagementRow)
    .sort((a, b) => b.enrolled - a.enrolled || a.title.localeCompare(b.title, 'hu'))
  const skipped = nemNegativ(options?.skipped)
  const omitted = courses.reduce((sum, course) => sum + course.omitted, 0)
  return { courses, truncated: options?.truncated === true, skipped, omitted }
}
