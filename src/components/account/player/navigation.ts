import { ctaLabel } from '@/lib/cta-vocabulary'
import type { Curriculum, CurriculumLesson } from '@/lib/curriculum/curriculum'

/**
 * A kurzus-lejátszó TISZTA logikája — navigáció, gombfeliratok, modul-nyitottság,
 * 1. Előző/következő lecke — a NEM elindítható (feldolgozás alatti) leckéket
 */

/* ════════════════════════════════════════════════════════════════════════════
   1. NAVIGÁCIÓ
   ════════════════════════════════════════════════════════════════════════════ */

/** Az elindítható leckék a megjelenítési sorrendben — a navigáció gerince. */
export function navigableLessons(curriculum: Curriculum): CurriculumLesson[] {
  return curriculum.lessons.filter((lesson) => lesson.playable)
}

export interface AdjacentLessons {
  previous: CurriculumLesson | null
  next: CurriculumLesson | null
}

/**
 * A `currentRef`-hez tartozó lecke szomszédai az ELINDÍTHATÓ leckék listáján.
 *
 * A modulhatár nem határ: a navigáció a kurzus egészén halad végig, mert a
 * vevő szempontjából a modul csak csoportosítás. Ismeretlen (vagy nem
 * elindítható) `currentRef` esetén mindkét irány `null` — ilyenkor a felület
 * egyszerűen nem mutat lépés-gombot, ahelyett hogy találgatna.
 */
export function adjacentLessons(curriculum: Curriculum, currentRef: string | null): AdjacentLessons {
  if (currentRef === null) {
    return { previous: null, next: null }
  }
  const sequence = navigableLessons(curriculum)
  const index = sequence.findIndex((lesson) => lesson.ref === currentRef)
  if (index < 0) {
    return { previous: null, next: null }
  }
  return {
    previous: index > 0 ? sequence[index - 1] : null,
    next: index + 1 < sequence.length ? sequence[index + 1] : null,
  }
}

/** A leckét tartalmazó modul címe (a modulhatár jelzéséhez), vagy null. */
export function moduleTitleOf(curriculum: Curriculum, lesson: CurriculumLesson): string | null {
  return curriculum.modules[lesson.moduleIndex]?.title ?? null
}

/* ════════════════════════════════════════════════════════════════════════════
   2. AZ AKCIÓSÁV ÁLLAPOTGÉPE
   ════════════════════════════════════════════════════════════════════════════ */

export type PrimaryActionKind =
  /** Az aktuális lecke még nincs késznek jelölve: a gomb JELÖL és LÉP. */
  | 'complete-and-advance'
  /** Az aktuális lecke már kész: a gomb csak LÉP. */
  | 'advance'
  /** Utolsó lecke, még nincs kész: a gomb JELÖL és a kurzus ezzel elkészül. */
  | 'complete-course'
  /** Minden lecke kész — a gomb már csak visszajelzés, nincs teendő. */
  | 'course-complete'

export interface PrimaryAction {
  kind: PrimaryActionKind
  /** A gomb LÁTHATÓ felirata (nyíl-glifa nélkül — azt a komponens teszi hozzá). */
  label: string
  /** Modulhatáron a felvezető sor („Következő modul: …"), különben null. */
  moduleHint: string | null
  /** A teljes hozzáférhető név — a látható feliratot MAGÁBAN FOGLALJA (WCAG 2.5.3). */
  ariaLabel: string
  /** Jelölje-e késznek a kattintás az AKTUÁLIS leckét. */
  marksWatched: boolean
  /** Melyik leckére lépjen a kattintás után; null = marad az aktuálison. */
  targetRef: string | null
  /** Letiltott állapot (kizárólag a „minden kész" visszajelzésnél). */
  disabled: boolean
}

export interface SecondaryAction {
  label: string
  ariaLabel: string
  targetRef: string
}

/**
 * Az „Előző" gomb. Ha nincs előző lecke, `null` — a felület ilyenkor NEM tesz
 * ki letiltott gombot: az üres hely kevésbé zavaró, mint egy sosem használható
 * vezérlő (a letiltott gomb ráadásul fókuszálhatatlan zaj a billentyűzeten).
 */
export function previousAction(
  curriculum: Curriculum,
  currentRef: string | null,
): SecondaryAction | null {
  const { previous } = adjacentLessons(curriculum, currentRef)
  if (previous === null) {
    return null
  }
  return {
    label: `Előző: ${previous.title}`,
    // A hozzáférhető név a LÁTHATÓ felirattal kezdődik (WCAG 2.5.3 Label in
    // Name): a hangvezérlés a látható szöveget mondja ki, és annak benne kell
    // lennie a névben. A „lecke" pontosítás a felirat UTÁN áll.
    ariaLabel: `Előző: ${previous.title} (előző lecke)`,
    targetRef: previous.ref,
  }
}

/**
 * Az elsődleges akció az AKTUÁLIS lecke és a haladás állapotából.
 *
 * @param curriculum a tananyag
 * @param currentRef az éppen nyitott lecke stabil azonosítója
 * @param watched a késznek jelölt leckék refjei (a kliens optimista állapota)
 * @returns az akció leírása, vagy null, ha nincs értelmezhető aktuális lecke
 */
export function primaryAction(
  curriculum: Curriculum,
  currentRef: string | null,
  watched: ReadonlySet<string>,
): PrimaryAction | null {
  if (currentRef === null) {
    return null
  }
  const sequence = navigableLessons(curriculum)
  const index = sequence.findIndex((lesson) => lesson.ref === currentRef)
  if (index < 0) {
    return null
  }
  const current = sequence[index]
  const next = index + 1 < sequence.length ? sequence[index + 1] : null
  const isWatched = watched.has(current.ref)

  if (next === null) {
    // Utolsó lecke. A „minden kész" ág AZ EGÉSZ kurzust nézi: az utolsó lecke
    // önmagában akkor is kész lehet, ha korábban kihagyott valamit.
    const everythingDone = sequence.every((lesson) => watched.has(lesson.ref))
    if (everythingDone) {
      return {
        kind: 'course-complete',
        label: 'Minden lecke kész',
        moduleHint: null,
        ariaLabel: 'Minden lecke kész',
        marksWatched: false,
        targetRef: null,
        disabled: true,
      }
    }
    if (!isWatched) {
      /**
       * A „Kurzus befejezése" ígéret CSAK akkor igaz, ha az utolsó lecke
       * megjelölésével tényleg minden kész lesz. A code review mérte az
       * ellenkező esetet: a railből az utolsó leckére előreugorva a gomb
       * „Kurzus befejezése"-t ígért, kattintásra megjelölte a leckét, de a
       * kurzus NEM lett kész, navigáció nem történt, és a fókusz a helyén
       * ragadt egy megváltozott feliratú gombon. Ha van még hiányzó lecke, a
       * gomb jelöl ÉS a hiányzó munkához visz — pontosan azt mondja, amit tesz.
       */
      const mindenMasKesz = sequence.every(
        (lesson) => lesson.ref === current.ref || watched.has(lesson.ref),
      )
      if (mindenMasKesz) {
        // A felirat a §3.2 #30 szótári sora. A hozzáférhető név a LÁTHATÓ
        // felirattal kezdődik (WCAG 2.2 · 2.5.3 Label in Name), a lecke nevét
        // pedig kettőspont vezeti be — kvirtmínusz a vevői szövegben tilos
        // (§3.1.1).
        const label = ctaLabel('course-finish')
        return {
          kind: 'complete-course',
          label,
          moduleHint: null,
          ariaLabel: `${label}: ${current.title} megjelölése késznek`,
          marksWatched: true,
          targetRef: null,
          disabled: false,
        }
      }
      const elsoHianyzo = sequence.find(
        (lesson) => lesson.ref !== current.ref && !watched.has(lesson.ref),
      )
      if (elsoHianyzo !== undefined) {
        const hianyzoModulCime = moduleTitleOf(curriculum, elsoHianyzo)
        const label = `Kész, tovább: ${elsoHianyzo.title}`
        return {
          kind: 'complete-and-advance',
          label,
          moduleHint: hianyzoModulCime === null ? null : `Modul: ${hianyzoModulCime}`,
          ariaLabel: hianyzoModulCime === null ? label : `${label} (${hianyzoModulCime})`,
          marksWatched: true,
          targetRef: elsoHianyzo.ref,
          disabled: false,
        }
      }
    }

    /**
     * Az utolsó lecke MÁR kész, a kurzus mégsem teljes: a vevő korábban
     * kihagyott valamit (tipikusan a railből ugrott előre az utolsó leckére).
     *
     * Korábban ez az ág is a „Kurzus befejezése" gombot adta, `marksWatched:
     * true` + `targetRef: null` értékkel — de a lecke már kész volt, ezért a
     * jelölés azonnal kilépett, navigáció pedig nem volt: egy ENGEDÉLYEZETT
     * gomb, ami a kurzus befejezését ígérte, és a kattintásra SEMMI nem
     * történt (se jelölés, se lépés, se hibaüzenet). Ehelyett most oda
     * léptetünk, ahol a hiányzó munka van: az első még nem kész leckére.
     */
    const hianyzo = sequence.find((lesson) => !watched.has(lesson.ref))
    if (hianyzo === undefined) {
      // Elvi ág: `everythingDone` már kizárta — a teljesség kedvéért.
      return {
        kind: 'course-complete',
        label: 'Minden lecke kész',
        moduleHint: null,
        ariaLabel: 'Minden lecke kész',
        marksWatched: false,
        targetRef: null,
        disabled: true,
      }
    }
    const hianyzoModul = moduleTitleOf(curriculum, hianyzo)
    const label = `Hátralévő lecke: ${hianyzo.title}`
    return {
      kind: 'advance',
      label,
      moduleHint: hianyzoModul === null ? null : `Modul: ${hianyzoModul}`,
      ariaLabel: hianyzoModul === null ? label : `${label} (${hianyzoModul})`,
      marksWatched: false,
      targetRef: hianyzo.ref,
      disabled: false,
    }
  }

  const crossesModule = next.moduleIndex !== current.moduleIndex
  const nextModuleTitle = crossesModule ? moduleTitleOf(curriculum, next) : null
  const moduleHint = nextModuleTitle === null ? null : `Következő modul: ${nextModuleTitle}`
  const label = isWatched ? `Következő: ${next.title}` : `Kész, tovább: ${next.title}`

  return {
    kind: isWatched ? 'advance' : 'complete-and-advance',
    label,
    moduleHint,
    // A hozzáférhető név a látható felirattal KEZDŐDIK, hogy a hangvezérlés
    // („kattints a Kész, tovább…") is működjön (WCAG 2.5.3 Label in Name).
    ariaLabel: moduleHint === null ? label : `${label} (${moduleHint})`,
    marksWatched: !isWatched,
    targetRef: next.ref,
    disabled: false,
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   3. A MODUL-AKKORDEON ÁLLAPOTA
   ════════════════════════════════════════════════════════════════════════════ */

/** A `localStorage`-kulcs előtagja — a kurzus azonosítója kerül mögé. */
export const MODULE_STATE_KEY_PREFIX = 'kc-player-modulok-'

/** Kurzusonként külön kulcs: két kurzus nyitottsága nem üti egymást. */
export function moduleStateKey(productId: number): string {
  return `${MODULE_STATE_KEY_PREFIX}${productId}`
}

/**
 * A `localStorage` MINIMÁLIS felülete, amennyit ez a modul használ. Így a teszt
 * be tud adni egy hamis (akár dobó) tárolót, a modul pedig nem függ a
 * `window`-tól — szerveroldali importnál sem robban.
 */
export interface ModuleStateStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * A megőrzött nyitott-modul azonosítók beolvasása.
 *
 * SOSEM DOB: privát böngészőmódban a `localStorage` elérése maga is
 * `SecurityError`-t vet, a tárolt érték pedig lehet elavult vagy kézzel
 * elrontott JSON. Bármelyik hiba esetén `null` a válasz — a hívó ilyenkor a
 * kezdőállapotot használja, és a lejátszó ettől még hibátlanul működik.
 */
export function readModuleState(
  storage: ModuleStateStorage | null | undefined,
  key: string,
): string[] | null {
  if (!storage) {
    return null
  }
  try {
    const raw = storage.getItem(key)
    if (raw === null) {
      return null
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return null
    }
    return parsed.filter((entry): entry is string => typeof entry === 'string')
  } catch {
    return null
  }
}

/** A nyitott modulok megőrzése. SOSEM DOB (kvóta-túllépés, privát mód). */
export function writeModuleState(
  storage: ModuleStateStorage | null | undefined,
  key: string,
  openModuleIds: Iterable<string>,
): void {
  if (!storage) {
    return
  }
  try {
    storage.setItem(key, JSON.stringify([...openModuleIds]))
  } catch {
    // A nyitottság megőrzése KÉNYELMI funkció: a hiánya nem hiba, és nem is
    // közölnivaló a felhasználóval.
  }
}

/**
 * A kezdőállapot: KIZÁRÓLAG az aktuális lecke modulja nyitva.
 *
 * MIÉRT NEM MINDEN: 8–12 modulos kurzusnál a teljesen nyitott lista több
 * képernyőnyi, és a vevő elveszti a helyét benne; a csukott lista viszont
 * áttekinthető, és egy kattintással bővíthető. A felület FÜGGETLEN
 * disclosure-öket használ (nem „egy nyitva" akkordeont), ezért a vevő
 * tetszőleges kombinációt beállíthat — ezt őrizzük meg.
 *
 * Az érték determinisztikus (nem függ tárolótól), ezért a szerver- és a
 * kliens-oldali első render EGYEZIK: nincs hidratálási eltérés.
 */
export function initialOpenModuleIds(curriculum: Curriculum, activeRef: string | null): string[] {
  const active =
    activeRef === null ? null : curriculum.lessons.find((lesson) => lesson.ref === activeRef) ?? null
  const activeModuleId =
    active === null ? null : curriculum.modules[active.moduleIndex]?.id ?? null
  if (activeModuleId !== null) {
    return [activeModuleId]
  }
  // Nincs aktív lecke (üres vagy csupa feldolgozás alatti tananyag): az első
  // modul nyíljon ki, hogy a lista ne tűnjön üresnek.
  const first = curriculum.modules[0]
  return first ? [first.id] : []
}

/**
 * A megőrzött állapot ÖSSZEFÉSÜLÉSE a jelenlegi tananyaggal.
 *
 * A tananyag a két látogatás között átszerkeszthető: modul törölhető,
 * átnevezhető, új jöhet hozzá. Ezért
 * - a már nem létező modul-azonosítók kiesnek (különben örökre ott ragadnának),
 * - az AKTUÁLIS lecke modulja MINDIG nyitva van, akkor is, ha a tárolt állapot
 *   csukva hagyná — máskülönben a vevő nem látná, hol tart,
 * - `stored === null` (nincs mentés vagy hibás) esetén a kezdőállapot jön.
 */
export function mergeModuleState(
  curriculum: Curriculum,
  stored: readonly string[] | null,
  activeRef: string | null,
): string[] {
  if (stored === null) {
    return initialOpenModuleIds(curriculum, activeRef)
  }
  const known = new Set(curriculum.modules.map((entry) => entry.id))
  const open = new Set(stored.filter((id) => known.has(id)))
  for (const id of initialOpenModuleIds(curriculum, activeRef)) {
    open.add(id)
  }
  // A modulok SORRENDJE a tananyagé — a halmaz bejárási sorrendje nem az.
  return curriculum.modules.map((entry) => entry.id).filter((id) => open.has(id))
}

/* ════════════════════════════════════════════════════════════════════════════
   4. FORMÁZÁS
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * Lecke-hossz emberi alakban: `7:05`, illetve órás anyagnál `1:07:05`.
 * Érvénytelen/hiányzó hossz → null (a felület ilyenkor nem ír ki semmit).
 */
export function formatLessonDuration(durationSec: number | null | undefined): string | null {
  if (typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec <= 0) {
    return null
  }
  const total = Math.round(durationSec)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

/**
 * A magyar ELATIVUSZ toldalék (`-ból` / `-ből`) egy SZÁMHOZ, a szám kimondott
 * alakjának magánhangzó-harmóniája szerint.
 *
 * MIÉRT KELL: a képernyőolvasónak szánt mondat („12 lecke kész a 18-ból") a
 * számot kimondja, tehát a toldaléknak a KIMONDOTT alakhoz kell illeszkednie:
 * „tizennyolcból", de „tizenkettőből". Fix `-ból` mindkét helyen magyartalanul
 * hangzana el. A döntést az utolsó kiejtett szó hozza: ha a szám nem kerek
 * tízes, az egyes helyiérték, egyébként a tízes (100 fölött a „száz").
 */
export function elativeSuffix(value: number): 'ból' | 'ből' {
  const number = Math.abs(Math.round(Number.isFinite(value) ? value : 0))
  // nulla·ból, egy·ből, kettő·ből, három·ból, négy·ből, öt·ből,
  // hat·ból, hét·ből, nyolc·ból, kilenc·ből
  const ones = ['ból', 'ből', 'ből', 'ból', 'ből', 'ből', 'ból', 'ből', 'ból', 'ből'] as const
  // tíz·ből, húsz·ból, harminc·ból, negyven·ből, ötven·ből,
  // hatvan·ból, hetven·ből, nyolcvan·ból, kilencven·ből
  const tens = ['ból', 'ből', 'ból', 'ból', 'ből', 'ből', 'ból', 'ből', 'ból', 'ből'] as const

  const one = number % 10
  if (one !== 0) {
    return ones[one]
  }
  const ten = Math.floor(number / 10) % 10
  if (ten !== 0) {
    return tens[ten]
  }
  // Kerek száz/ezer: „száz·ból", „ezer·ből" — a százas a gyakoribb eset.
  return number % 1000 === 0 && number > 0 ? 'ből' : 'ból'
}

/**
 * A haladás-bejelentés MONDATA az élő régióba.
 * Például: „Csuklókörzés befejezve. 12 lecke kész a 18-ból."
 */
export function completionAnnouncement(input: {
  lessonTitle: string
  completed: number
  total: number
}): string {
  return `${input.lessonTitle} befejezve. ${input.completed} lecke kész a ${input.total}-${elativeSuffix(input.total)}.`
}

/* ════════════════════════════════════════════════════════════════════════════
   5. AZ AUTOMATIKUS „MEGNÉZETT" KÜSZÖBE (előkészítés)
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * Ekkora LEJÁTSZOTT ARÁNY felett számít megnézettnek egy videó-lecke.
 *
 * 0,9 a bevett LMS-küszöb: a stáblista/levezetés kihagyása nem tarthatja
 * örökre „félbehagyottként" a leckét, ugyanakkor egy véletlen előretekerés
 * még nem jelöl készre.
 */
export const AUTO_WATCHED_RATIO = 0.9

/**
 * Kell-e automatikusan késznek jelölni a leckét a lejátszott arány alapján?
 * Az automatikus jelölést a Bunny player.js kliens
 * (`src/lib/stream/playerjs-client.ts`) fogja hajtani: az onprogress/ontimeupdate
 * eseményből számolt arányt ADJA ÁT ennek a függvénynek, és igaz válasz esetén
 * a `CoursePlayer` `handleLessonProgress` bekötési pontján keresztül ugyanaz a
 * `markWatched` fut le, amit a gomb hív. A küszöb és a döntés SZÁNDÉKOSAN itt,
 */
export function shouldAutoMarkWatched(watchedRatio: number, alreadyWatched: boolean): boolean {
  if (alreadyWatched || !Number.isFinite(watchedRatio)) {
    return false
  }
  return watchedRatio >= AUTO_WATCHED_RATIO
}
