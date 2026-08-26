import type {
  CourseStudentProgress,
  CourseStudentStatus,
} from '../../lib/admin/course-progress-stats'

/**
 * A kurzus-haladás admin panel TISZTA nézet-logikája.
 * repóban nincs mivel renderelni tesztből (nincs React-testing-library, és a
 * Payload `useDocumentInfo` provider-környezetet igényel). A megjeleníthető
 * viselkedés — szűrés, keresés, rendezés, relatív idő, a kördiagram geometriája
 * — viszont mind tiszta függvény, így ide kiemelve KIMERÍTŐEN tesztelhető
 * (src/__tests__/admin-course-progress.test.ts), a komponens pedig csak
 */

/** A szűrő értékkészlete: a három állapot + „mind". */
export type StudentStatusFilter = 'mind' | CourseStudentStatus

/** A táblázat rendezhető oszlopai. */
export type StudentSortKey = 'nev' | 'haladas' | 'aktivitas'

export type SortDirection = 'asc' | 'desc'

/**
 * Hiányzó érték felirata a táblacellákban.
 *
 * A korábbi „—" (U+2014, kvirtmínusz) KÉT szabályt sértett egyszerre:
 * a magyar mikroszöveg-szabályzat szerint a kvirtmínusz magyar szövegben nem
 * írásjel (`docs/ui-sztenderdek.md` §3.1.1), a puszta jel pedig a
 * képernyőolvasóban vagy néma, vagy „em dash"-ként hangzik el, tehát a cella
 * jelentése elvész (WCAG 2.2 SC 1.3.1). Szó áll a helyén.
 */
export const NO_DATA = 'Nincs adat'

/**
 * A mély link query-paraméterének neve.
 *
 * A szerződés KÖTÖTT (vezetői döntés, `docs/statisztika-audit-2026-08-21.md`
 * 1. pont): a Statisztika oldal
 * `/admin/collections/products/<id>?haladas=nem-kezdte#kurzus-haladas`
 * alakban linkel ide.
 */
export const PROGRESS_DEEP_LINK_PARAM = 'haladas'

/** A panel horgonya, hogy a mély link oda tudjon görgetni. */
export const PROGRESS_PANEL_ANCHOR = 'kurzus-haladas'

/**
 * A mély link állapot-paraméterének kiolvasása egy query-stringből.
 * viselkedik, mintha nem lenne paraméter. Egy elgépelt vagy elavult link
 * SOSEM okozhat hibaképernyőt egy belső munkalapon (NN/g, 5. heurisztika,
 * Error Prevention: https://www.nngroup.com/articles/ten-usability-heuristics/).
 * A „mind" SZÁNDÉKOSAN nincs az elfogadott értékek között: a szerződés a
 * három állapotot sorolja fel, és a „mind" nem szűkít semmire, tehát az
 */
export function readProgressDeepLink(
  search: string | null | undefined,
): CourseStudentStatus | null {
  if (typeof search !== 'string' || search.trim().length === 0) {
    return null
  }
  let value: string | null = null
  try {
    value = new URLSearchParams(
      search.startsWith('?') ? search.slice(1) : search,
    ).get(PROGRESS_DEEP_LINK_PARAM)
  } catch {
    // Értelmezhetetlen query-string (pl. hibás százalék-escape) — nincs link.
    return null
  }
  if (value === 'nem-kezdte' || value === 'folyamatban' || value === 'befejezte') {
    return value
  }
  return null
}

/** Az állapot-chip magyar felirata. */
export function statusLabel(status: CourseStudentStatus): string {
  switch (status) {
    case 'befejezte':
      return 'Befejezte'
    case 'folyamatban':
      return 'Folyamatban'
    default:
      return 'Nem kezdte el'
  }
}

/** A szűrő legördülő magyar feliratai — a komponens ebből építi az `option`-öket. */
export const STATUS_FILTER_OPTIONS: ReadonlyArray<{ value: StudentStatusFilter; label: string }> = [
  { value: 'mind', label: 'Mind' },
  { value: 'nem-kezdte', label: 'Nem kezdte el' },
  { value: 'folyamatban', label: 'Folyamatban' },
  { value: 'befejezte', label: 'Befejezte' },
]

/**
 * Az állapot-chip színei a Payload SAJÁT téma-változóiból.
 *
 * Nyers hexa érték szándékosan nincs: az admin világos és sötét témában is
 * használható, a `--theme-*` változók pedig mindkettőben helyes kontrasztot
 * adnak. (A storefront `--kc-*` tokenjei ide nem valók — az admin más
 * stílusrendszer.)
 */
export function statusChipColors(status: CourseStudentStatus): {
  background: string
  color: string
} {
  switch (status) {
    case 'befejezte':
      return { background: 'var(--theme-success-100)', color: 'var(--theme-success-750)' }
    case 'folyamatban':
      return { background: 'var(--theme-elevation-100)', color: 'var(--theme-elevation-800)' }
    default:
      return { background: 'var(--theme-elevation-50)', color: 'var(--theme-elevation-650)' }
  }
}

/**
 * Relatív időpont MAGYARUL („3 napja").
 *
 * Miért nem `Intl.RelativeTimeFormat`: az „1 napja" helyett „tegnap"-ot, illetve
 * a napon belüli finomabb bontást kézzel akarjuk — és a magyar toldalékolás itt
 * elég egyszerű ahhoz, hogy a saját tábla átláthatóbb legyen, mint az Intl
 * egységválasztásának kiszámítása.
 *
 * @param iso a vizsgált időpont ISO-alakban (null/érvénytelen → null)
 * @param now a „most" (injektálható, hogy a teszt determinisztikus legyen)
 */
export function formatRelativeHungarian(iso: string | null, now: Date = new Date()): string | null {
  if (typeof iso !== 'string' || iso.trim().length === 0) {
    return null
  }
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) {
    return null
  }
  const diffMs = now.getTime() - then
  // Jövőbeli időpont (óracsúszás a szerver és a böngésző között) — nem
  // állítunk valótlant, csak annyit, hogy épp most történt.
  if (diffMs < 60_000) {
    return 'az imént'
  }
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) {
    return `${String(minutes)} perce`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${String(hours)} órája`
  }
  const days = Math.floor(hours / 24)
  if (days === 1) {
    return 'tegnap'
  }
  if (days < 7) {
    return `${String(days)} napja`
  }
  if (days < 30) {
    return `${String(Math.floor(days / 7))} hete`
  }
  if (days < 365) {
    return `${String(Math.floor(days / 30))} hónapja`
  }
  return `${String(Math.floor(days / 365))} éve`
}

/** Kis- és nagybetű, valamint ékezet szerint elnéző összehasonlítási alak. */
function searchable(value: string | null): string {
  return (value ?? '')
    .toLocaleLowerCase('hu-HU')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

/**
 * Szűrés állapot szerint ÉS keresés névre/e-mailre.
 *
 * A keresés ékezet-érzéketlen: a „Kovacs" beírás a „Kovács Anna" sort is
 * megtalálja — az ügyintéző gyorsan gépel, és nem az ő dolga eltalálni az
 * ékezeteket.
 */
export function filterStudents(
  students: readonly CourseStudentProgress[],
  options: { status: StudentStatusFilter; query: string },
): CourseStudentProgress[] {
  const needle = searchable(options.query)
  return students.filter((student) => {
    if (options.status !== 'mind' && student.status !== options.status) {
      return false
    }
    if (needle.length === 0) {
      return true
    }
    return (
      searchable(student.name).includes(needle) || searchable(student.email).includes(needle)
    )
  })
}

/**
 * A hallgató sorának AZONOSÍTÓJA (a `<th scope="row">` tartalma).
 *
 * A táblázat sorfejléce nem lehet üres: a képernyőolvasó ezt olvassa fel a
 * „67%" cella előtt, hogy kiderüljön, kié az érték (WCAG 2.2 SC 1.3.1).
 * Ha a felhasználó nem adott meg nevet, az e-mail-cím azonosít — ugyanaz a
 * tartalék, amit a névszerinti rendezés is használ, tehát a lista sorrendje
 * és a felolvasott azonosító nem tud szétcsúszni.
 */
export function studentRowLabel(student: { name: string | null; email: string }): string {
  const nev = (student.name ?? '').trim()
  if (nev.length > 0) {
    return nev
  }
  const email = student.email.trim()
  return email.length > 0 ? email : NO_DATA
}

/** Rendezéskor a hiányzó időpont mindig a lista végére kerül. */
function activityMs(student: CourseStudentProgress): number {
  if (student.lastActivityAt === null) {
    return Number.NEGATIVE_INFINITY
  }
  const ms = new Date(student.lastActivityAt).getTime()
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms
}

/**
 * Rendezés — mindig ÚJ tömböt ad vissza (a bemenet nem módosul).
 *
 * A haladás SZÁM szerint rendez (nem a „12/18" szöveg szerint), ez a
 * megrendelői igény lényege: egy kattintással látszódjon, ki áll a leghátrébb.
 * Azonos százaléknál a név dönt, hogy a sorrend determinisztikus legyen —
 * különben minden újrarendezés összekeverné az egyenlő sorokat.
 */
export function sortStudents(
  students: readonly CourseStudentProgress[],
  key: StudentSortKey,
  direction: SortDirection,
): CourseStudentProgress[] {
  const sign = direction === 'asc' ? 1 : -1
  const byName = (a: CourseStudentProgress, b: CourseStudentProgress): number =>
    (a.name ?? a.email).localeCompare(b.name ?? b.email, 'hu-HU')

  return [...students].sort((a, b) => {
    if (key === 'nev') {
      return sign * byName(a, b)
    }
    if (key === 'aktivitas') {
      // KÉT aktivitás nélküli hallgatónál a −Infinity − −Infinity = NaN volna,
      // ami a sort() komparátorából visszaadva NEM determinisztikus sorrendet
      // ad (code review-találat). Az egyenlőség ezért explicit ág.
      const aMs = activityMs(a)
      const bMs = activityMs(b)
      if (aMs === bMs) {
        return byName(a, b)
      }
      return sign * (aMs < bMs ? -1 : 1)
    }
    const diff = a.percent - b.percent
    return diff === 0 ? byName(a, b) : sign * diff
  })
}

/** Az oszlopfejléc `aria-sort` értéke — képernyőolvasónak is látszik a rendezés. */
export function ariaSortValue(
  column: StudentSortKey,
  activeKey: StudentSortKey,
  direction: SortDirection,
): 'ascending' | 'descending' | 'none' {
  if (column !== activeKey) {
    return 'none'
  }
  return direction === 'asc' ? 'ascending' : 'descending'
}

/**
 * A LÁTHATÓ rendezés-jelölés az oszlopfejlécen.
 * Eddig csak `aria-sort` volt: a képernyőolvasó tudta, hogy az oszlop
 * rendezhető és melyik szerint áll a lista, a LÁTÓ felhasználó nem. NN/g,
 * Data Tables: „Indicate which column the table is sorted by"
 * (https://www.nngroup.com/articles/data-tables/); ugyanezt kéri a GOV.UK
 * Design System rendezhető táblája
 */
export function sortIndicator(
  column: StudentSortKey,
  activeKey: StudentSortKey,
  direction: SortDirection,
): { glyph: string; active: boolean } {
  if (column !== activeKey) {
    return { glyph: '⇅', active: false }
  }
  return { glyph: direction === 'asc' ? '↑' : '↓', active: true }
}

/** A kis kördiagram (ring) geometriája. */
export interface RingGeometry {
  /** A kör sugara a viewBox-ban. */
  radius: number
  /** A teljes kerület — a `stroke-dasharray` alapja. */
  circumference: number
  /** A kitöltött ív hossza (0 ≤ x ≤ kerület). */
  dash: number
  /** A hátralévő ív hossza. */
  gap: number
}

/**
 * A dekoratív kördiagram ívhosszai a százalékból.
 *
 * A százalékot 0–100 közé szorítjuk: hibás bemenetből sem rajzolhat a böngésző
 * negatív vagy túlfutó ívet. A ring `aria-hidden`, az információt a mellette
 * álló szám hordozza — a WCAG szerint a színnel/formával közölt adatnak mindig
 * kell szöveges párja.
 */
export function ringGeometry(percent: number, radius = 12): RingGeometry {
  const safe = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0
  const circumference = 2 * Math.PI * radius
  const dash = (circumference * safe) / 100
  return { radius, circumference, dash, gap: circumference - dash }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LISTA-KORLÁT, ÉLŐ VISSZAJELZÉS, CSV-EXPORT
 *
 * Mindhárom az admin UX-audit MÉRT megállapításaira válaszol:
 *  - a panel korlátlanul rajzolta ki a hallgatókat: 305 beiratkozottnál a panel
 *    17 126 px magas lett (≈19 képernyő) — az űrlap gyakorlatilag használhatatlan;
 *  - a szűrés mellett NEM volt darabszám-visszajelzés, tehát a „ki nem kezdte
 *    még el" kérdésre (a munkatársak legfontosabb kérdése) kézzel kellett volna
 *    300 sort megszámolni;
 *  - nem volt exportálás, tehát az emlékeztető-küldéshez egy HTML-táblázatból
 *    kellett volna e-mail-címeket kimásolni — vagyis a felület helyett Excelbe
 *    menekülnének, és onnantól az adat elavul.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Alapból ennyi sor látszik; a többi gombnyomásra jön. */
export const STUDENT_PAGE_SIZE = 25

/** Egy „továbbiak" kattintás ennyi sorral bővíti a listát. */
export const STUDENT_PAGE_STEP = 50

/**
 * A szűrő/kereső melletti élő visszajelzés szövege.
 * SOSEM hallgat: ha a lista korlátozott, azt is kimondja, hány sor van összesen.
 * A korábbi „… felel meg a szűrésnek — ebből 25 látszik" alak kvirtmínuszt
 * (U+2014) használt töltelék-elválasztóként, ami a magyar mikroszöveg-
 * szabályzat szerint hiba (`docs/ui-sztenderdek.md` §3.1.1–3.1.3: két állítás
 * közé vessző, kettőspont vagy pont való). Vessző áll a helyén.
 */
export function visibleCountLabel(shown: number, matching: number, total: number): string {
  if (matching === total) {
    return shown < matching
      ? `${String(total)} hallgatóból ${String(shown)} látszik`
      : `${String(total)} hallgató`
  }
  const talalat = `${String(total)} hallgatóból ${String(matching)} felel meg a szűrésnek`
  return shown < matching ? `${talalat}, ebből ${String(shown)} látszik` : talalat
}

/**
 * A „Következő lecke" oszlop értéke.
 *
 * A régi fejléc („Aktuális lecke") ellentmondott a mellette álló „Nem kezdte el"
 * címkének: aki még el sem indult, annál is leckecím állt, mintha ott tartana.
 * A „következő" mindhárom állapotra igaz — a nem-kezdte sornál viszont ki is
 * mondjuk, hogy ez még csak a kezdőpont.
 */
export function nextLessonLabel(student: {
  status: CourseStudentStatus
  currentLessonTitle: string | null
}): string {
  if (student.currentLessonTitle === null) {
    // A mag két ESETBEN ad null-t (course-progress-stats.ts): a kurzus kész,
    // vagy nincs elindítható lecke. A kettő nem ugyanaz, ezért nem is
    // ugyanaz a felirat: a „Nincs adat" a befejezett sorban hazugság volna.
    return student.status === 'befejezte' ? 'Nincs hátralévő lecke' : NO_DATA
  }
  if (student.status === 'nem-kezdte') {
    return `Itt fog kezdeni: ${student.currentLessonTitle}`
  }
  return student.currentLessonTitle
}

/**
 * A lemorzsolódás-cella szövege.
 *
 * A régi „—" KÉT különböző dolgot jelentett: „ez az első lecke, nincs mihez
 * hasonlítani" ÉS „nem volt veszteség" — a modulhatárokon ez olvashatatlanná
 * tette a tölcsért. A kettő most szétválik, és a NÖVEKEDÉS is látszik ahelyett,
 * hogy 0-ra vágnánk.
 */
export function dropOffLabel(
  index: number,
  completedCount: number,
  previousCompletedCount: number | null,
): string {
  if (index === 0 || previousCompletedCount === null) {
    return '(kezdés)'
  }
  const valtozas = completedCount - previousCompletedCount
  if (valtozas === 0) {
    return '0 fő'
  }
  return valtozas < 0 ? `−${String(-valtozas)} fő` : `+${String(valtozas)} fő`
}

/** A „Fejezet" cella tartalma és az, hogy vizuálisan ismétlődik-e. */
export interface ModuleCell {
  /** A cella SZÖVEGE. Ismétlődésnél is a teljes fejezetcím, sosem üres. */
  text: string
  /** Igaz, ha az előző sorban ugyanez a fejezetcím állt. */
  repeated: boolean
}

/**
 * A „Fejezet" oszlop cellája.
 * A modulcím vizuálisan CSAK a modul első során jelenik meg: enélkül egy
 * hatleckés modulnál hatszor egymás alatt állt ugyanaz a hosszú cím, és a
 * szem nem talált fogódzót a leckék között.
 * A korábbi változat viszont ÜRES STRINGET adott az ismétlődő soroknál, tehát
 * a cella tényleg üres maradt: a képernyőolvasó a 2., 3., 4. lecke sorában
 */
export function moduleColumnCell(
  moduleTitle: string,
  previousModuleTitle: string | null,
): ModuleCell {
  const text = moduleTitle.trim().length === 0 ? NO_DATA : moduleTitle
  return { text, repeated: moduleTitle === previousModuleTitle }
}

/** Egy CSV-mező idézőjelezése (Excel-kompatibilis: a `"` duplázva). */
function csvField(value: string): string {
  // FORMULA-INJEKCIÓ elleni védelem (code review-találat): a hallgató a saját
  // nevét szabadon állítja, és az Excel/LibreOffice a `=`, `+`, `-`, `@`
  // kezdetű cellát KÉPLETKÉNT futtatja — egy `=HYPERLINK(...)` névvel a
  // munkatárs gépén nyílna meg támadói tartalom. Az aposztróf-előtag az
  // ajánlott (OWASP) semlegesítés: a cella szövegként jelenik meg.
  const veszelyes = /^[=+\-@\t\r]/.test(value)
  const safe = veszelyes ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

/**
 * A LÁTHATÓ (szűrt és rendezett) hallgatók CSV-je.
 *
 * Két részlet nem elhagyható, különben a magyar Excel elrontja a fájlt:
 *  - UTF-8 BOM, enélkül az ékezetek összetörnek,
 *  - PONTOSVESSZŐ elválasztó, enélkül minden sor egyetlen cellába kerül.
 * A sorvég CRLF — ez a CSV (RFC 4180) és az Excel elvárása is.
 */
export function studentsCsv(
  students: readonly CourseStudentProgress[],
  options: { totalLessons: number },
): string {
  const fejlec = [
    'Név',
    'E-mail',
    'Állapot',
    'Elvégzett leckék',
    'Összes lecke',
    'Haladás (%)',
    'Utolsó aktivitás',
    'Következő lecke',
  ]
  const sorok = students.map((student) =>
    [
      student.name ?? '',
      student.email,
      statusLabel(student.status),
      String(student.completed),
      String(student.total === 0 ? options.totalLessons : student.total),
      String(student.percent),
      student.lastActivityAt ?? '',
      nextLessonLabel(student),
    ]
      .map(csvField)
      .join(';'),
  )
  return `﻿${[fejlec.map(csvField).join(';'), ...sorok].join('\r\n')}\r\n`
}

/**
 * A letöltött fájl neve: a kurzus nevével és a dátummal, hogy több export
 * között is el lehessen igazodni.
 * A fájlnév SZÁNDÉKOSAN ékezetmentes. Böngészőben MÉRVE (Chromium): ha egy
 * blob-letöltés `download` attribútuma nem ASCII karaktert tartalmaz, a böngésző
 * NÉMÁN eldobja az egész nevet, és „download" néven menti a fájlt — a
 * „Kéztorna-otthon-haladas-2026-08-15.csv" helyett. A fájl tartalma ettől
 */
export function csvFileName(courseTitle: string, isoDate: string): string {
  const tiszta = courseTitle
    // Unicode-bontás: az ékezet külön kombináló jellé válik, amit eldobunk.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Ami az átírás után sem ASCII (pl. emodzsi), az sem maradhat a névben.
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[\\/:*?"<>|]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
  const nev = tiszta.length > 0 ? tiszta : 'kurzus'
  const datum = /^\d{4}-\d{2}-\d{2}/.exec(isoDate)?.[0] ?? 'datum-nelkul'
  return `${nev}-haladas-${datum}.csv`
}
