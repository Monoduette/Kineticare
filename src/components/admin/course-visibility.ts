/**
 * A kurzus LÁTHATÓSÁGÁNAK üzenete a szerkesztőnek: tiszta, React-mentes logika.
 * Az admin UX-audit végigjátszotta egy új kurzus felvitelét, és néma
 * adatvesztéssel egyenértékű csapdát talált: a lapon KÉT különböző dolgot
 * hívnak „Állapot"-nak, és a feltűnőbbik félrevezet.
 * - A lap TETEJÉN a Payload dokumentum-státusza áll („Állapot: Közzétett",
 *   `_status`): ezt írja ki a rendszer a „Módosítások közzététele" gomb után.
 * - A bolt viszont kizárólag a `products.status` mezőt („Megjelenés a
 *   weboldalon") nézi. Ha az nincs „Közzétéve", a kurzus nem jelenik meg.
 *
 * K42 (admin-audit, 2026-09-22): verzál helyett a cím félkövér (<strong>), a
 * jelentést a cím eleje szövegben mondja ki („Figyelem:”), hogy ne csak a
 * szín hordozza (WCAG 2.2 SC 1.4.1; GOV.UK Warning text:
 * https://design-system.service.gov.uk/components/warning-text/; Atlassian,
 * Warning messages: https://atlassian.design/foundations/content/designing-messages/warning-messages).
 */

/** A `products.status` értékei, ahogy a mező deklarálja. */
export type CourseVisibilityStatus = 'draft' | 'published' | 'archived'

export interface CourseVisibilityNotice {
  /** `figyelmeztetes` = a kurzus NEM látszik; `rendben` = látszik. */
  kind: 'figyelmeztetes' | 'rendben'
  title: string
  /** A teendő, szerepkör szerint, mert a mezőt csak tulajdonos állíthatja. */
  body: string
  /** A `body` egy szó szerinti részlete, amelyet a nézet <strong>-gal emel ki. */
  emphasis?: string
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
      title: 'Ez a kurzus látszik a weboldalon.',
      body: 'A vásárlók a közzétett változatot látják. Ha módosítasz, a „Módosítások közzététele” gombbal teszed közzé a változást.',
    }
  }

  // A teendő attól függ, hogy a szerkesztő maga tudja-e megoldani.
  const teendo = canEdit
    ? 'Az oldalsávban állítsd a „Megjelenés a weboldalon” mezőt „Közzétéve” értékre.'
    : 'Ezt csak a tulajdonos tudja átállítani. Kérd meg, hogy az oldalsávban állítsa a „Megjelenés a weboldalon” mezőt „Közzétéve” értékre.'

  if (ertek === 'archived') {
    return {
      kind: 'figyelmeztetes',
      title: 'Figyelem: ez a kurzus archivált, ezért nem látszik a weboldalon.',
      body: teendo,
    }
  }

  if (ertek === 'draft') {
    return {
      kind: 'figyelmeztetes',
      title: 'Figyelem: ez a kurzus még nem látszik a weboldalon.',
      body: `Piszkozat állapotban van. ${teendo}`,
    }
  }

  return {
    kind: 'figyelmeztetes',
    title: 'Figyelem: ez a kurzus még nem látszik a weboldalon.',
    body: `A „Megjelenés a weboldalon” mező nincs kitöltve. A lap tetején álló „Állapot: Közzétett” a szerkesztői változatra vonatkozik, nem a weboldali megjelenésre. ${teendo}`,
    emphasis: 'nem a weboldali megjelenésre',
  }
}
