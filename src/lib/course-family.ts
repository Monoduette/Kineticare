/**
 * Témakurzusok (2026-11-26, tulajdonosi kérés): a nagy fizetős program
 * témánként (csukló, könyök, hüvelykujj…) külön is megvehető. A témakurzus
 * egy rendes kurzus, a `parentCourses` mező mondja meg, melyik teljes
 * programban van benne a teljes anyaga.
 *
 * A mező SOHA nem ad hozzáférést: a lejátszó, a videó-token, a letöltés és a
 * haladás szabályai (src/access/*) kurzusonként, változatlanul döntenek. A
 * mező csak két dolgot vált ki: a program élő hozzáférésével rendelkező
 * vevő a témakurzus oldalán a programja linkjét látja vásárlógomb helyett, és
 * a pénztár nem engedi, hogy ugyanazért kétszer fizessen
 * (src/lib/checkout/start-checkout.ts). Terv:
 * https://claude.ai/artifact/8c1cDmfE2LvFnp3R8a7GYb
 */

/** Egy relációs érték (id vagy populate-olt objektum) pozitív egész azonosítója. */
function relationId(value: unknown): number | null {
  const id = typeof value === 'object' && value !== null ? (value as { id?: unknown }).id : value
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * A kurzus „Teljes program, amelynek része” azonosítói, ismétlés nélkül,
 * az eredeti sorrendben. Hibás vagy hiányzó érték üres listát ad.
 */
export function parentCourseIdsOf(
  product: { parentCourses?: unknown } | null | undefined,
): number[] {
  const raw: unknown = product?.parentCourses
  if (!Array.isArray(raw)) return []
  const ids: number[] = []
  for (const entry of raw) {
    const id = relationId(entry)
    if (id !== null && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/** Témakurzus-e: van legalább egy teljes programja. */
export function isTopicCourse(product: { parentCourses?: unknown } | null | undefined): boolean {
  return parentCourseIdsOf(product).length > 0
}

/** A szerkezeti szabályok megsértésének fajtái (a mentés-őr ezekre ad üzenetet). */
export type CourseFamilyViolation = 'self' | 'parent-is-topic' | 'topic-has-children'

export const COURSE_FAMILY_MESSAGES: Record<CourseFamilyViolation, string> = {
  self: 'Egy kurzus nem lehet a saját teljes programja. Válassz másik kurzust.',
  'parent-is-topic':
    'A kiválasztott kurzus maga is témakurzus. Teljes programnak csak olyan kurzust választhatsz, amelyik nem része másiknak.',
  'topic-has-children':
    'Ez a kurzus más témakurzusok teljes programja, ezért nem lehet maga is témakurzus. Előbb azoknál vedd ki ezt a kurzust.',
}

/**
 * Az egyszintű szerkezet tiszta ellenőrzése (DB nélkül): a hívó adja, hogy a
 * kiválasztott programok közül melyik témakurzus, és hogy erre a kurzusra
 * hivatkozik-e már bármelyik másik kurzus. Az első sértést adja vissza.
 */
export function courseFamilyViolation(input: {
  selfId: number | null
  parentIds: readonly number[]
  parentIdsThatAreTopics: ReadonlySet<number>
  selfHasChildren: boolean
}): CourseFamilyViolation | null {
  if (input.parentIds.length === 0) return null
  if (input.selfId !== null && input.parentIds.includes(input.selfId)) return 'self'
  if (input.parentIds.some((id) => input.parentIdsThatAreTopics.has(id))) return 'parent-is-topic'
  if (input.selfHasChildren) return 'topic-has-children'
  return null
}

/**
 * A kurzusoldal elrendezése (`pageLayout`). Ismeretlen vagy üres érték: a mai,
 * oldalsó vásárlódobozos oldal, így a régi soroknál semmi nem változik.
 */
export type CoursePageLayout = 'standard' | 'landing'

export function coursePageLayout(
  product: { pageLayout?: unknown } | null | undefined,
): CoursePageLayout {
  return product?.pageLayout === 'landing' ? 'landing' : 'standard'
}

/**
 * A kurzus leckesorainak száma: a modulok leckéi, ha van ilyen, különben a régi
 * videólista (ugyanaz a sorrend, mint a buildCurriculum-ban). Sorokat számol,
 * nem lejátszható leckéket, mert mentés előtt az új soroknak még nincs
 * azonosítójuk.
 */
export function lessonRowCount(product: { modules?: unknown; videos?: unknown }): number {
  let count = 0
  if (Array.isArray(product.modules)) {
    for (const entry of product.modules) {
      const lessons: unknown =
        typeof entry === 'object' && entry !== null
          ? (entry as { lessons?: unknown }).lessons
          : undefined
      if (Array.isArray(lessons)) count += lessons.length
    }
  }
  if (count > 0) return count
  return Array.isArray(product.videos) ? product.videos.length : 0
}

/**
 * Közzétett témakurzusnak kevesebb leckéje kell legyen, mint bármelyik teljes
 * programjának. Egy duplikált, ki nem húzott teljes program témakurzusként
 * olcsóbban adná a teljes anyagot, és a vevő a program áráért járó leckéket a
 * témakurzus áráért kapná meg. Üres (még lecke nélküli) programmal nem
 * hasonlítunk: ott nincs mit kiárusítani.
 */
export function topicCoversProgram(input: {
  topicLessons: number
  parentLessons: readonly number[]
}): number | null {
  for (const parentLessons of input.parentLessons) {
    if (parentLessons > 0 && input.topicLessons >= parentLessons) return parentLessons
  }
  return null
}

export function topicCoversProgramMessage(topicLessons: number, parentLessons: number): string {
  return `Ennek a témakurzusnak ${topicLessons} leckéje van, a teljes programnak ${parentLessons}. Témakurzusként csak a program egy része tehető közzé, különben a teljes anyag a témakurzus áráért lenne megvehető. Töröld a más témájú leckéket, vagy vedd ki a teljes programot a „Teljes program, amelynek része” mezőből.`
}

/** Duplikálás után a belső azonosító így végződik (Payload alapviselkedés egyedi szövegmezőn). */
const DUPLICATE_SKU_SUFFIX = /-\s*copy\s*$/i

export function hasDuplicateSkuSuffix(sku: unknown): boolean {
  return typeof sku === 'string' && DUPLICATE_SKU_SUFFIX.test(sku.trim())
}

export const DUPLICATE_SKU_PUBLISH_MESSAGE =
  'A belső azonosító még a másolat jelölését viseli („- Copy”). Ez áll a számlán és a Barion fizetőoldalán, ezért közzététel előtt írd át.'
