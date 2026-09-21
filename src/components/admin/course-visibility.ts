/**
 * A kurzus LÁTHATÓSÁGÁNAK üzenete a szerkesztőnek — tiszta, React-mentes logika.
 * Az admin UX-audit végigjátszotta egy új kurzus felvitelét, és NÉMA
 * adatvesztéssel egyenértékű csapdát talált: a lapon KÉT különböző dolgot
 * hívnak „Állapot"-nak, és a feltűnőbbik hazudik.
 * - A lap TETEJÉN a Payload dokumentum-státusza áll („Állapot: Közzétett",
 * `_status`) — ezt írja ki a rendszer a „Módosítások közzététele" gomb után.
 */

/** A `products.status` értékei, ahogy a mező deklarálja. */
export type CourseVisibilityStatus = 'draft' | 'published' | 'archived'

export interface CourseVisibilityNotice {
  /** `figyelmeztetes` = a kurzus NEM látszik; `rendben` = látszik. */
  kind: 'figyelmeztetes' | 'rendben'
  title: string
  /** A teendő — szerepkör-függő, mert a mezőt csak tulajdonos állíthatja. */
  body: string
}

/** A nyers mezőérték szűkítése; minden ismeretlen érték „nincs beállítva". */
export function normalizeVisibility(value: unknown): CourseVisibilityStatus | null {
  return value === 'draft' || value === 'published' || value === 'archived' ? value : null
}

/**
 * A megjelenítendő üzenet.
 *
 * @param status a `products.status` nyers értéke
 * @param canEdit állíthatja-e a bejelentkezett felhasználó a mezőt (owner)
 */
export function courseVisibilityNotice(
  status: unknown,
  canEdit: boolean,
  unlisted: unknown = false,
): CourseVisibilityNotice {
  const ertek = normalizeVisibility(status)

  if (ertek === 'published') {
    if (unlisted === true) {
      return {
        kind: 'rendben',
        title: 'Ez a kurzus közvetlen linkkel érhető el.',
        body: 'A nyilvános listákban és ajánlókban nem jelenik meg. A linkkel bárki megnyithatja és megvásárolhatja; a vásárlók a Kurzusaim között továbbra is elérik. Ez nem hozzáférés-védelem.',
      }
    }
    return {
      kind: 'rendben',
      title: 'Ez a kurzus LÁTSZIK a weboldalon.',
      body: 'A vásárlók a közzétett változatot látják. Ha módosítasz, a „Módosítások közzététele” gombbal élesítheted.',
    }
  }

  // A teendő attól függ, hogy a szerkesztő maga tudja-e megoldani.
  const teendo = canEdit
    ? 'Az oldalsávban állítsd a „Megjelenés a weboldalon” mezőt „Közzétéve”-re.'
    : 'Ezt csak a tulajdonos tudja átállítani — kérd meg, hogy az oldalsávban állítsa a „Megjelenés a weboldalon” mezőt „Közzétéve”-re.'

  if (ertek === 'archived') {
    return {
      kind: 'figyelmeztetes',
      title: 'Ez a kurzus ARCHIVÁLT — nem látszik a weboldalon.',
      body: teendo,
    }
  }

  if (ertek === 'draft') {
    return {
      kind: 'figyelmeztetes',
      title: 'Ez a kurzus MÉG NEM látszik a weboldalon.',
      body: `Piszkozat állapotban van. ${teendo}`,
    }
  }

  return {
    kind: 'figyelmeztetes',
    title: 'Ez a kurzus MÉG NEM látszik a weboldalon.',
    body: `A „Megjelenés a weboldalon” mező nincs kitöltve. Figyelem: a lap tetején lévő „Állapot: Közzétett” a szerkesztői változatra vonatkozik, NEM a weboldali megjelenésre. ${teendo}`,
  }
}
