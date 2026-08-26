import { toWatchedRefSet } from '../../lib/course-progress/progress'
import type { Curriculum, CurriculumLesson } from '../../lib/curriculum/curriculum'
import { NO_LESSONS_LABEL, summarizeCurriculum } from '../../lib/curriculum/progress'
import type { CourseCover } from '../../lib/courses'
import { ctaLabel } from '../../lib/cta-vocabulary'

/**
 * A „Kurzusaim" lista TISZTA logikája — állapotgép, sorrend, feliratok.
 */

/** A kártya állapota — ez határozza meg a csoportot ÉS a gombfeliratot. */
export type CourseCardStatus =
  /** Elkezdte, de még nem fejezte be. */
  | 'in-progress'
  /** Van hozzáférése, de még egy leckét sem jelölt késznek. */
  | 'not-started'
  /** Minden elindítható lecke kész. */
  | 'completed'
  /** A hozzáférés lejárt (A1) — a lejátszó nem indul el. */
  | 'expired'

/** Az összecsukható „Befejezett kurzusok" szekció címének töve. */
export const COMPLETED_GROUP_TITLE = 'Befejezett kurzusok'

/** A lejárt hozzáférésű kurzusok szekciócíme. */
export const EXPIRED_GROUP_TITLE = 'Lejárt hozzáférésű kurzusok'

/** Az aktív (folyamatban + el nem kezdett) csoport — csak képernyőolvasónak. */
export const CURRENT_GROUP_TITLE = 'Folyamatban lévő és új kurzusaid'

/** Üres állapot — barátságos, nem szemrehányó. */
export const EMPTY_TITLE = 'Itt jelennek meg a kurzusaid'
export const EMPTY_BODY =
  'Még nincs elérhető kurzusod. Nézd meg a kínálatunkat: a megvásárolt kurzus azonnal itt nyílik meg.'
export const EMPTY_CTA_LABEL = ctaLabel('course-list-open')
export const EMPTY_CTA_HREF = '/kurzusok'

/**
 * A gombfeliratok — MIND a §3.2 szótárból (`src/lib/cta-vocabulary.ts`).
 * Az öt felirat korábban szabad szöveg volt („Kezdés", „Folytatás",
 * „Újranézés", „A kurzus megtekintése", „A kurzus megnyitása"), és mind az öt
 * eltért a jóváhagyott alaktól: deverbális főnév, tárgy nélkül (M-1, M-7). A
 * `docs/gomb-inventar.md` §5 ezt „Kurzus megkezdése: Kezdés" néven mérte is.
 * A `resumePrefix` LECKE-CÍMES összefűzése is megszűnt. A lecke neve mostantól
 */
export const CTA_LABELS = {
  start: ctaLabel('course-start'),
  /** Megkezdett kurzus folytatása (§3.2 #7). */
  resume: ctaLabel('course-continue'),
  /** Befejezett kurzus újranézése (§3.2 #29). */
  rewatch: ctaLabel('course-rewatch'),
  /** Lejárt hozzáférés: a kurzus SAJÁT (értékesítő) oldala (§3.2 #28). */
  expired: ctaLabel('course-sales-open'),
  /** Tananyag nélküli kurzus: nincs mit „kezdeni", de a kurzus megnyitható. */
  open: ctaLabel('course-start'),
} as const

/** A kártya kirajzolásához szükséges, MÁR KÉSZ (szerializálható) adatok. */
export interface CourseCardView {
  productId: number
  title: string
  /** A kártya és a gomb közös célja (lejátszó vagy — lejártnál — kurzusoldal). */
  href: string
  cover: CourseCover | null
  status: CourseCardStatus
  /** 0–100; tananyag nélküli kurzusnál 0. */
  percent: number
  completedLessons: number
  totalLessons: number
  /** Rajzolható-e haladás (kör + sáv): van tananyag ÉS él a hozzáférés. */
  showProgress: boolean
  /** A ProgressBar `aria-valuetext`-je — „12/18 lecke kész". */
  progressValueText: string
  /** Mikro-meta: „12/18 lecke · kb. 42 perc van hátra". */
  metaLine: string
  /** A gomb LÁTHATÓ felirata. */
  ctaLabel: string
  /**
   * A gomb akadálymentes nevének kiegészítése (vizuálisan rejtett): a kurzus
   * neve, megkezdett kurzuson a következő lecke nevével. Több kártya áll
   * egymás mellett, és a szótári felirat önmagában nem mondja meg, MELYIK
   * kurzusról van szó (WCAG 2.2 · 2.4.4 Link Purpose).
   */
  ctaContext: string
  /** „Hozzáférés eddig: 2027. 03. 04." — null, ha nincs ismert lejárat. */
  expiryLabel: string | null
  /** Empatikus üzenet lejárt hozzáférésnél — null, ha él a hozzáférés. */
  expiredMessage: string | null
}

/**
 * Hátralévő idő MÁSODPERCBEN: az elindítható, még NEM kész leckék `durationSec`
 * mezőinek összege.
 *
 * SZÁNDÉKOSAN közelítő. A CMS-ben a hossz opcionális mező, ezért előfordul,
 * hogy csak a leckék egy részén van kitöltve — ilyenkor a részösszeget adjuk, és
 * a felirat „kb." előtaggal jelzi a becslést. Ha EGYETLEN hátralévő leckén sincs
 * hossz, `null` a válasz, és a mikro-meta időszakasza elmarad: kitalált számot
 * nem írunk ki.
 */
export function remainingSeconds(
  lessons: readonly Pick<CurriculumLesson, 'ref' | 'playable' | 'durationSec'>[],
  watchedRefs: Iterable<string | null | undefined>,
): number | null {
  const watched = toWatchedRefSet([...watchedRefs])
  let total = 0
  for (const lesson of lessons) {
    if (!lesson.playable || watched.has(lesson.ref)) {
      continue
    }
    if (typeof lesson.durationSec === 'number' && Number.isFinite(lesson.durationSec)) {
      total += Math.max(0, lesson.durationSec)
    }
  }
  return total > 0 ? total : null
}

/**
 * Emberi időtartam-felirat: „kb. 42 perc", „kb. 1 óra 5 perc", „kb. 2 óra".
 *
 * Percre kerekít (a másodperc-pontosság itt zaj), és legalább 1 percet mond —
 * a „kb. 0 perc" félrevezető lenne. Nulla vagy hiányzó bemenetnél `null`, hogy a
 * hívó a teljes szakaszt elhagyhassa.
 */
export function formatRemainingLabel(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
    return null
  }
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) {
    return `kb. ${minutes} perc`
  }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `kb. ${hours} óra` : `kb. ${hours} óra ${rest} perc`
}

/**
 * A kártya mikro-metája — annyi információ, amennyi EGY pillantás alatt
 * feldolgozható:
 * - lejárt hozzáférésnél a haladás nem releváns, csak a kurzus mérete;
 * - tananyag nélküli kurzusnál a `NO_LESSONS_LABEL` (nincs „0/0 lecke");
 * - egyébként „kész/összes lecke", és — ha kiszámítható — a hátralévő idő.
 */
export function courseMetaLine(input: {
  status: CourseCardStatus
  completedLessons: number
  totalLessons: number
  remainingSec: number | null
}): string {
  if (input.totalLessons === 0) {
    return NO_LESSONS_LABEL
  }
  if (input.status === 'expired') {
    return `${input.totalLessons} lecke`
  }
  const lessons = `${input.completedLessons}/${input.totalLessons} lecke`
  const remaining = formatRemainingLabel(input.remainingSec)
  return remaining === null ? lessons : `${lessons} · ${remaining} van hátra`
}

/**
 * A gomb LÁTHATÓ felirata — az állapotgép kimenete, kizárólag szótári alakból.
 *
 * A KONKRÉT lecke neve nem itt, hanem a hozzáférhető névben él
 * (`courseCtaContext`): a vevőt tényleg az érdekli, MI következik, de a §3.2
 * #17 szabálya szerint az ilyen megkülönböztetés rejtett szövegbe való
 * (WCAG 2.2 · 2.5.3), nem a látható feliratba — különben ugyanaz a cselekvés
 * kártyánként más szót viselne (WCAG 2.2 · 3.2.4).
 */
export function courseCtaLabel(input: {
  status: CourseCardStatus
  totalLessons: number
}): string {
  switch (input.status) {
    case 'expired':
      return CTA_LABELS.expired
    case 'completed':
      return CTA_LABELS.rewatch
    case 'in-progress':
      return CTA_LABELS.resume
    default:
      return input.totalLessons === 0 ? CTA_LABELS.open : CTA_LABELS.start
  }
}

/**
 * A gomb hozzáférhető nevének KIEGÉSZÍTÉSE (vizuálisan rejtett szöveg).
 *
 * Mindig a kurzus neve; megkezdett kurzuson a KÖVETKEZŐ LECKE neve is — ez az
 * információ korábban a látható feliratban állt („Folytatás: <lecke>").
 * A hozzáférhető név így is a látható felirattal KEZDŐDIK (a hívóhely a
 * feliratot írja ki elsőként), tehát a WCAG 2.2 · 2.5.3 Label in Name teljesül,
 * és a hangvezérléses látogató a látható szóval is aktiválni tudja a gombot.
 */
export function courseCtaContext(input: {
  status: CourseCardStatus
  title: string
  resumeLessonTitle: string | null
}): string {
  const lesson = input.resumeLessonTitle?.trim()
  return input.status === 'in-progress' && lesson
    ? `${input.title}, következő lecke: ${lesson}`
    : input.title
}

/**
 * A kártya állapota. A lejárat MINDENT felülír: lejárt hozzáféréssel a
 * „Folytatás" hazugság lenne (a lejátszó 403-at ad), ezért ez az ág áll elöl.
 */
export function resolveCourseCardStatus(input: {
  hasAccess: boolean
  started: boolean
  complete: boolean
}): CourseCardStatus {
  if (!input.hasAccess) {
    return 'expired'
  }
  if (input.complete) {
    return 'completed'
  }
  return input.started ? 'in-progress' : 'not-started'
}

/** A kártya-nézet felépítéséhez szükséges nyers bemenet (a szerver-oldalról). */
export interface CourseCardInput {
  productId: number
  title: string
  href: string
  cover: CourseCover | null
  /** A tananyag-modell (`buildCurriculum`) kimenete. */
  curriculum: Curriculum
  /** A késznek jelölt leckék refjei (fetchWatchedRefs). */
  watchedRefs: Iterable<string | null | undefined>
  /** Él-e a hozzáférés (A1). Hiányzó hozzáférés-állapot = korlátlan → true. */
  hasAccess: boolean
  expiryLabel: string | null
  expiredMessage: string | null
}

/** Egy kurzus kész, kirajzolható kártya-nézete. */
export function buildCourseCardView(input: CourseCardInput): CourseCardView {
  // A deklarált típus EGYSZER bejárható iterátort is megenged, a függvény
  // viszont kétszer olvassa (haladás + hátralévő idő) — a code review mérte,
  // hogy generátor-bemenetnél a második bejárás üres, és a hátralévő idő
  // hamisan a teljes kurzuszhosszra ugrik. Ezért PONTOSAN EGYSZER járjuk be.
  const watchedRefs = [...input.watchedRefs]
  const progress = summarizeCurriculum(input.curriculum, watchedRefs)
  const status = resolveCourseCardStatus({
    hasAccess: input.hasAccess,
    started: progress.started,
    complete: progress.complete,
  })
  const remainingSec =
    status === 'expired' ? null : remainingSeconds(input.curriculum.lessons, watchedRefs)

  return {
    productId: input.productId,
    title: input.title,
    href: input.href,
    cover: input.cover,
    status,
    percent: progress.percent,
    completedLessons: progress.completed,
    totalLessons: progress.total,
    showProgress: status !== 'expired' && progress.total > 0,
    progressValueText: progress.label,
    metaLine: courseMetaLine({
      status,
      completedLessons: progress.completed,
      totalLessons: progress.total,
      remainingSec,
    }),
    ctaLabel: courseCtaLabel({
      status,
      totalLessons: progress.total,
    }),
    ctaContext: courseCtaContext({
      status,
      title: input.title,
      resumeLessonTitle: progress.resumeLesson?.title ?? null,
    }),
    expiryLabel: input.expiryLabel,
    expiredMessage: input.expiredMessage,
  }
}

/** A lista három megjelenítési csoportja. */
export interface CourseCardGroups {
  /** Folyamatban lévők, UTÁNUK az el nem kezdettek — egyetlen rácsban. */
  current: CourseCardView[]
  /** Befejezettek — összecsukott szekcióban. */
  completed: CourseCardView[]
  /** Lejárt hozzáférésűek — a lap alján, saját szekcióban. */
  expired: CourseCardView[]
}

/**
 * Csoportosítás + rendezés. A csoportokon belül a BEJÖVŐ sorrend marad
 * (stabil): az aktív csoportban előbb minden folyamatban lévő, utána minden el
 * nem kezdett kártya, mindkét szakaszon belül érintetlen sorrendben.
 */
export function groupCourseCards(cards: readonly CourseCardView[]): CourseCardGroups {
  const inProgress: CourseCardView[] = []
  const notStarted: CourseCardView[] = []
  const completed: CourseCardView[] = []
  const expired: CourseCardView[] = []

  for (const card of cards) {
    switch (card.status) {
      case 'in-progress':
        inProgress.push(card)
        break
      case 'not-started':
        notStarted.push(card)
        break
      case 'completed':
        completed.push(card)
        break
      default:
        expired.push(card)
        break
    }
  }

  return { current: [...inProgress, ...notStarted], completed, expired }
}

/**
 * Az oldal-fejléc összefoglaló sora: „3 kurzus · 1 folyamatban · 1 befejezve".
 *
 * EGYETLEN kurzusnál `null` — ott az összegzés nem mond semmit, amit a kártya
 * ne mondana el, és csak zajt adna a fejléchez. A nulla darabszámú szakaszok
 * kimaradnak (nem írunk ki „0 befejezve"-t).
 */
export function courseListSummary(cards: readonly CourseCardView[]): string | null {
  if (cards.length <= 1) {
    return null
  }
  const count = (status: CourseCardStatus): number =>
    cards.filter((card) => card.status === status).length

  const parts = [`${cards.length} kurzus`]
  const inProgress = count('in-progress')
  if (inProgress > 0) {
    parts.push(`${inProgress} folyamatban`)
  }
  const completed = count('completed')
  if (completed > 0) {
    parts.push(`${completed} befejezve`)
  }
  const expired = count('expired')
  if (expired > 0) {
    parts.push(`${expired} lejárt`)
  }
  return parts.join(' · ')
}
