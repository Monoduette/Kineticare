import { LESSON_KIND_LINK, LESSON_KIND_TEXT, LESSON_KIND_VIDEO } from '../../fields/course-modules'

/**
 * A TANANYAG összecsukott sorainak felirata — tiszta, React-mentes logika.
 * Az admin UX-audit mérte: a csukott sorok felirata a SORSZÁM volt („Modul 01"…
 * „Modul 08", bennük „Lecke 01"…„Lecke 06"), tehát a hét beszédes című modul
 * („1. ALAPOK — Így kezdj neki", „BÓNUSZOK", „Facebook csoport") nyolc
 * TELJESEN EGYFORMA szürke csíkként jelent meg. A szerkesztőnek egyesével kellett
 * kinyitogatnia a sorokat, hogy megtalálja, amelyikhez leckét akart adni — és
 */

/** A névtelen sor JELZÉSE — a kitöltetlen kötelező cím így azonnal feltűnik. */
export const NEVTELEN_MODUL = '(névtelen modul)'
export const NEVTELEN_LECKE = '(névtelen lecke)'

/** A nem lejátszható videó jelzése a csukott soron. */
export const NEM_JATSZHATO = 'még nem játszható'

function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** A Payload sorszáma 1-alapú; hiányzó/érvénytelen érték esetén 1. */
function sorszam(rowNumber: unknown): number {
  return typeof rowNumber === 'number' && Number.isFinite(rowNumber) && rowNumber >= 1
    ? Math.floor(rowNumber)
    : 1
}

/** A lecke típusának emberi neve. Ismeretlen/üres típus → „Videó" (a modell is így ért). */
function lecketipusNeve(kind: unknown): string {
  switch (kind) {
    case LESSON_KIND_TEXT:
      return 'Szöveges'
    case LESSON_KIND_LINK:
      return 'Külső link'
    case LESSON_KIND_VIDEO:
    default:
      return 'Videó'
  }
}

export interface ModuleRowData {
  title?: unknown
  lessons?: unknown
}

/**
 * Egy modul csukott sorának felirata: a CÍM és a leckék száma.
 *
 * @param data a sor adatai a szerkesztő űrlapállapotából
 * @param rowNumber a Payload 1-alapú sorszáma (a névtelen sor azonosításához)
 */
export function moduleRowLabel(data: ModuleRowData | null | undefined, rowNumber?: number): string {
  const szam = sorszam(rowNumber)
  const cim = trimmedOrNull(data?.title) ?? `${String(szam)}. modul — ${NEVTELEN_MODUL}`
  const leckek = Array.isArray(data?.lessons) ? data.lessons.length : 0
  if (leckek === 0) {
    return `${cim} (nincs lecke)`
  }
  return `${cim} (${String(leckek)} lecke)`
}

export interface LessonRowData {
  title?: unknown
  kind?: unknown
  status?: unknown
}

/**
 * Egy lecke csukott sorának felirata: a CÍM, a típus, és videónál a
 * lejátszhatóság.
 *
 * A „még nem játszható" jelzés azért van itt, mert az audit szerint ez a
 * kurzusfeltöltés egyik leggyakoribb NÉMA hibája: a videó feltöltődik, de az
 * állapota „Feldolgozás alatt" marad, és a vevőnél egyszerűen nem indul el.
 * Csukott soron látva azonnal szembetűnik.
 */
export function lessonRowLabel(data: LessonRowData | null | undefined, rowNumber?: number): string {
  const szam = sorszam(rowNumber)
  const cim = trimmedOrNull(data?.title) ?? `${String(szam)}. lecke — ${NEVTELEN_LECKE}`
  const tipus = lecketipusNeve(data?.kind)
  const videos = data?.kind === undefined || data.kind === null || data.kind === LESSON_KIND_VIDEO
  if (videos && data?.status !== 'ready') {
    return `${cim} · ${tipus} · ${NEM_JATSZHATO}`
  }
  return `${cim} · ${tipus}`
}
