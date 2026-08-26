import type { Product } from '../../payload-types'
import { streamVideoRef } from '../stream/contract'

/**
 * Kurzus tananyag egyetlen igazságforrása: modules ha van, különben videos → egy implicit modul.
 * ref = streamVideoRef; playable/countable szabályok a régi viselkedést őrzik.
 */

export const LESSON_KINDS = ['video', 'szoveg', 'link'] as const
export type LessonKind = (typeof LESSON_KINDS)[number]

/** A leckéhez csatolt letölthető anyag — kész, megjeleníthető alakban. */
export interface CurriculumAttachment {
  /** A gomb felirata: a megadott megnevezés, ennek hiányában a fájlnév. */
  label: string
  /** A fájl letöltési webcíme; null, ha a média-rekord nincs feltöltve. */
  url: string | null
}

export interface CurriculumLesson {
  /** STABIL azonosító — a haladás és a jegykiadás EZT használja, sosem sorszámot. */
  ref: string
  title: string
  kind: LessonKind
  summary: string | null
  /**
   * A Bunny-videó GUID-ja. `null`, ha nem videó-lecke VAGY ha a hívó
   * hozzáférés nélkül kérte a tananyagot (lásd `buildCurriculum` `hasAccess`).
   */
  streamAssetId: string | null
  durationSec: number | null
  /**
   * A videó feldolgozottsága — a `playable` már tartalmazza a döntést, de a
   * jegykiadás ebből tudja megkülönböztetni a „még készül" (409) és a
   * „hibás adat" (503) esetet, a felület pedig ebből mutat „Hamarosan" jelzést.
   */
  status: 'processing' | 'ready' | 'error' | null
  /** Külső link célja (csak `link` típusnál). */
  url: string | null
  /** A lecke szövege (Lexical) — `null`, ha nincs. */
  content: unknown
  attachments: CurriculumAttachment[]
  /** Elindítható-e most (videónál: kész + van GUID). */
  playable: boolean
  /** 0-alapú sorszám a TELJES, lapos leckelistán (előző/következő navigációhoz). */
  flatIndex: number
  /** 0-alapú sorszám a modulon belül. */
  indexInModule: number
  /** 0-alapú modul-sorszám. */
  moduleIndex: number
}

export interface CurriculumModule {
  /** A modul stabil azonosítója (nyitva/csukva állapot megjegyzéséhez). */
  id: string
  title: string
  summary: string | null
  lessons: CurriculumLesson[]
}

export interface Curriculum {
  modules: CurriculumModule[]
  /** Minden lecke a megjelenítési sorrendben — a lapos index forrása. */
  lessons: CurriculumLesson[]
  /** Igaz, ha a tananyag a RÉGI `videos` tömbből képződött. */
  legacy: boolean
}

/** A régi, lapos videólistából képzett implicit modul címe. */
export const LEGACY_MODULE_TITLE = 'A kurzus videói'

const trimmedOrNull = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * A lecke típusa. Ismeretlen/hiányzó érték → `video`: a mező bevezetése előtti
 * sorokban és a régi `videos` tömbben minden elem videó, és a videó-ág a
 * SZIGORÚBB (lejátszhatósághoz kész állapot és GUID is kell).
 */
function normalizeLessonKind(value: unknown): LessonKind {
  return LESSON_KINDS.includes(value as LessonKind) ? (value as LessonKind) : 'video'
}

/** Pozitív, véges hossz másodpercben; minden más → null. */
function normalizeDuration(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

const LESSON_STATUSES = ['processing', 'ready', 'error'] as const

/** Ismert videó-állapot, vagy null (nem videó / hiányzó mező). */
function normalizeStatus(value: unknown): 'processing' | 'ready' | 'error' | null {
  return LESSON_STATUSES.includes(value as (typeof LESSON_STATUSES)[number])
    ? (value as (typeof LESSON_STATUSES)[number])
    : null
}

/**
 * A `content` richText mező csak akkor kerül a modellbe, ha TÉNYLEGESEN van
 * tartalma. A Payload üres szerkesztőnél is ad egy root-objektumot; azt nem
 * érdemes kiküldeni a kliensnek, és a felület sem nyithat rá üres szövegdobozt.
 */
function normalizeContent(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const root = (value as { root?: { children?: unknown } }).root
  if (typeof root !== 'object' || root === null) {
    return null
  }
  const children = (root as { children?: unknown }).children
  if (!Array.isArray(children) || children.length === 0) {
    return null
  }
  // Egyetlen üres bekezdés = üres szerkesztő.
  if (children.length === 1) {
    const only = children[0]
    const onlyChildren =
      typeof only === 'object' && only !== null ? (only as { children?: unknown }).children : null
    if (Array.isArray(onlyChildren) && onlyChildren.length === 0) {
      return null
    }
  }
  return value
}

/** A media-relációból a letöltési URL és a megjelenítendő név. */
function normalizeAttachment(raw: unknown): CurriculumAttachment | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }
  const entry = raw as { label?: unknown; file?: unknown }
  const file = entry.file
  const sajatCimke = trimmedOrNull(entry.label)
  // A reláció NEM populált objektum. Két oka lehet:
  //  - depth: 0 lekérdezés (nyers azonosító) — ilyenkor sincs mit letölteni,
  //  - a médiafájlt TÖRÖLTÉK a Médiatárból: az idegen kulcs `ON DELETE SET NULL`,
  //    tehát a melléklet-sor megmarad, de fájl nélkül.
  // A sor ilyenkor is MEGMARAD, ha van neve: a néma eltüntetés a szerkesztő elől
  // is elrejtené a hibát (a lejátszó „a fájl feltöltése folyamatban" jelzést ír
  // ki rá — LessonBody.tsx). Név nélkül viszont nincs mit mutatni.
  if (typeof file !== 'object' || file === null) {
    return sajatCimke === null ? null : { label: sajatCimke, url: null }
  }
  const media = file as { url?: unknown; filename?: unknown }
  const url = trimmedOrNull(media.url)
  const label = sajatCimke ?? trimmedOrNull(media.filename)
  if (label === null && url === null) {
    return null
  }
  return { label: label ?? 'Letöltés', url }
}

function normalizeAttachments(raw: unknown): CurriculumAttachment[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const result: CurriculumAttachment[] = []
  for (const entry of raw) {
    const attachment = normalizeAttachment(entry)
    if (attachment !== null) {
      result.push(attachment)
    }
  }
  return result
}

/**
 * Elindítható-e a lecke. A videó-ág szabálya SZÓ SZERINT a régi
 * `isPlayableStreamVideo`-é: kész állapot ÉS nem üres GUID. Ez azért nem hívja
 * közvetlenül azt a függvényt, mert itt a GUID már el LEHET rejtve
 * (`hasAccess: false`) — a lejátszhatóság megítélése viszont a NYERS adatból
 * kell hogy történjen, különben a paywall-nézet üres tananyagot mutatna.
 */
function isLessonPlayable(kind: LessonKind, rawStreamAssetId: string | null, status: unknown): boolean {
  if (kind !== 'video') {
    return true
  }
  return status === 'ready' && rawStreamAssetId !== null
}

interface LessonSource {
  id?: string | null
  title?: string | null
  kind?: unknown
  summary?: string | null
  streamAssetId?: string | null
  durationSec?: number | null
  status?: unknown
  url?: string | null
  content?: unknown
  attachments?: unknown
}

interface BuildCounters {
  flatIndex: number
}

function toLesson(
  source: LessonSource,
  options: {
    hasAccess: boolean
    moduleIndex: number
    indexInModule: number
    counters: BuildCounters
    fallbackTitle: string
  },
): CurriculumLesson | null {
  const ref = streamVideoRef({
    id: source.id ?? null,
    streamAssetId: source.streamAssetId ?? null,
    status: null,
  })
  // Azonosító nélküli sor nem jelenhet meg: a haladása nem lenne rögzíthető, és
  // a jegykiadás sem tudná visszakeresni.
  if (ref === null) {
    return null
  }

  const kind = normalizeLessonKind(source.kind)
  const rawStreamAssetId = trimmedOrNull(source.streamAssetId)
  const lesson: CurriculumLesson = {
    ref,
    title: trimmedOrNull(source.title) ?? options.fallbackTitle,
    kind,
    summary: trimmedOrNull(source.summary),
    // S2/b: a GUID KIZÁRÓLAG élő hozzáféréssel kerül a modellbe (és így az
    // RSC-payloadba). A lejátszhatóság ettől függetlenül a nyers adatból dől el.
    streamAssetId: options.hasAccess && kind === 'video' ? rawStreamAssetId : null,
    durationSec: normalizeDuration(source.durationSec),
    status: normalizeStatus(source.status),
    // A FIZETŐS TARTALOM TÖBBI HORDOZÓJA IS hozzáférés-függő. A code review
    // mérte: korábban csak a GUID volt kapuzva, a szöveges lecke teljes
    // tartalma, a külső link célcíme és a mellékletek letöltési URL-jei
    // hozzáférés nélkül is bekerültek a modellbe — vagyis kiszivárogtak volna
    // mindenhová, ahová a modell eljut. A hozzáférés nélküli nézetnek a CÍM, a
    // típus és az összefoglaló elég (azok marketing-célra valók).
    url: options.hasAccess && kind === 'link' ? trimmedOrNull(source.url) : null,
    content: options.hasAccess ? normalizeContent(source.content) : null,
    attachments: options.hasAccess ? normalizeAttachments(source.attachments) : [],
    playable: isLessonPlayable(kind, rawStreamAssetId, source.status),
    flatIndex: options.counters.flatIndex,
    indexInModule: options.indexInModule,
    moduleIndex: options.moduleIndex,
  }
  options.counters.flatIndex += 1
  return lesson
}

/**
 * A termék tananyaga egységes modellben.
 *
 * @param product a kurzus (a `modules` és `videos` mezőkkel; a mellékletekhez
 *   `depth >= 1` kell, hogy a media-reláció populálva legyen)
 * @param hasAccess él-e a vevő hozzáférése — `false` esetén a `streamAssetId`
 *   MINDEN leckéből kimarad (S2/b), a szerkezet és a címek megmaradnak
 */
export function buildCurriculum(
  product: Pick<Product, 'modules' | 'videos'>,
  hasAccess: boolean,
): Curriculum {
  const counters: BuildCounters = { flatIndex: 0 }
  const rawModules = Array.isArray(product.modules) ? product.modules : []

  if (rawModules.length > 0) {
    const modules: CurriculumModule[] = []
    for (const [moduleIndex, rawModule] of rawModules.entries()) {
      const rawLessons = Array.isArray(rawModule.lessons) ? rawModule.lessons : []
      const lessons: CurriculumLesson[] = []
      for (const rawLesson of rawLessons) {
        const lesson = toLesson(rawLesson as LessonSource, {
          hasAccess,
          moduleIndex,
          indexInModule: lessons.length,
          counters,
          fallbackTitle: `${lessons.length + 1}. lecke`,
        })
        if (lesson !== null) {
          lessons.push(lesson)
        }
      }
      modules.push({
        id: trimmedOrNull(rawModule.id) ?? `modul-${moduleIndex + 1}`,
        title: trimmedOrNull(rawModule.title) ?? `${moduleIndex + 1}. modul`,
        summary: trimmedOrNull(rawModule.summary),
        lessons,
      })
    }

    const moduleLessons = modules.flatMap((entry) => entry.lessons)

    /** Modul-ág csak ha van legalább egy lecke — üres modul ne nyelje el a régi videos listát. */
    if (moduleLessons.length > 0) {
      return { modules, lessons: moduleLessons, legacy: false }
    }
    const vanRegiVideo = Array.isArray(product.videos) && product.videos.length > 0
    if (!vanRegiVideo) {
      // Nincs mire visszaesni: a kurzusnak tényleg nincs még tananyaga. A
      // modul-vázat megtartjuk, hogy a szerkesztő lássa, amit felvett.
      return { modules, lessons: [], legacy: false }
    }
    // Visszaesés a régi listára. A sorszámláló nullázandó: a modul-ág
    // (üres) bejárása után is 0-ról kell indulnia a lapos indexelésnek.
    counters.flatIndex = 0
  }

  // Régi, fejezet nélküli videólista → EGY implicit modul.
  const rawVideos = Array.isArray(product.videos) ? product.videos : []
  const lessons: CurriculumLesson[] = []
  for (const rawVideo of rawVideos) {
    const lesson = toLesson(
      { ...(rawVideo as LessonSource), kind: 'video' },
      {
        hasAccess,
        moduleIndex: 0,
        indexInModule: lessons.length,
        counters,
        fallbackTitle: `${lessons.length + 1}. rész`,
      },
    )
    if (lesson !== null) {
      lessons.push(lesson)
    }
  }
  if (lessons.length === 0) {
    return { modules: [], lessons: [], legacy: true }
  }
  return {
    modules: [{ id: 'legacy', title: LEGACY_MODULE_TITLE, summary: null, lessons }],
    lessons,
    legacy: true,
  }
}

/** A `ref`-hez tartozó lecke, vagy null. */
export function findLessonByRef(curriculum: Curriculum, ref: string): CurriculumLesson | null {
  const needle = ref.trim()
  if (needle.length === 0) {
    return null
  }
  return curriculum.lessons.find((lesson) => lesson.ref === needle) ?? null
}

/**
 * Lecke keresése a STABIL ref VAGY a Bunny-GUID alapján.
 *
 * A jegykiadás szerződése (src/lib/stream/contract.ts) mindkét alakot elfogadja
 * — a kliens a `streamVideoRef()`-et küldi (sor-id, ennek hiányában GUID), de a
 * végpont a GUID-ot közvetlenül is elfogadta, és ezt a viselkedést nem szabad
 * elvenni. A haladás-jelölés SZÁNDÉKOSAN nem ezt használja: ott kizárólag a
 * `ref` fogadható el, mert a `course-progress.videoRef` névtér egységes.
 */
export function findLessonByRefOrAsset(
  curriculum: Curriculum,
  needle: string,
): CurriculumLesson | null {
  const trimmed = needle.trim()
  if (trimmed.length === 0) {
    return null
  }
  return (
    curriculum.lessons.find(
      (lesson) => lesson.ref === trimmed || lesson.streamAssetId === trimmed,
    ) ?? null
  )
}

/** Csak az elindítható leckék (a haladás nevezője és a lejátszási sorrend). */
export function playableLessons(curriculum: Curriculum): CurriculumLesson[] {
  return curriculum.lessons.filter((lesson) => lesson.playable)
}

/**
 * Az első elindítható VIDEÓ-lecke — a lejátszási jegy alapértelmezett célpontja,
 * ha a kérés nem nevez meg leckét. Szándékosan csak videó: szöveges leckéhez és
 * linkhez nincs értelmezhető Bunny-jegy.
 */
export function firstPlayableVideoLesson(curriculum: Curriculum): CurriculumLesson | null {
  return curriculum.lessons.find((lesson) => lesson.kind === 'video' && lesson.playable) ?? null
}
