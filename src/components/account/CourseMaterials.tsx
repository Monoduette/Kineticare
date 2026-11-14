import type { CurriculumAttachment } from '@/lib/curriculum/curriculum'

/**
 * Segédanyag-linkek: a kurzus egészéhez (lejátszó, Kurzusaim kártya) és a
 * leckéhez csatolt fájlok közös megjelenítése.
 *
 * Tervezési döntések és forrásaik:
 *  - A link a dokumentum NEVE, mögötte a formátum és a méret: GOV.UK, Content
 *    design: Links („Application form (PDF, 19.5KB)”,
 *    https://www.gov.uk/guidance/content-design/links); NN/g, Avoid PDF for
 *    On-Screen Reading (https://www.nngroup.com/articles/avoid-pdf-for-on-screen-reading/).
 *  - A fájl ÚJ LAPON nyílik, a `download` attribútum nélkül. Telefonon a
 *    kényszerített letöltés a Fájlok alkalmazásba teszi a PDF-et, ahol a vevő
 *    nem találja meg; új lapon a telefon saját nézője nyitja meg, onnan
 *    menthető és nyomtatható, a lecke pedig a helyén marad. Az új lapot a
 *    link kimondja: WCAG 2.2 · 3.2.5 Change on Request, G201 technika
 *    (https://www.w3.org/WAI/WCAG22/Techniques/general/G201).
 *  - Érintőcél: 44 px magas sor (WCAG 2.2 · 2.5.8 Target Size, a 24 px-es
 *    minimum felett; Apple HIG 44 pt).
 */

export interface MaterialLinksProps {
  materials: readonly CurriculumAttachment[]
  /** A lista akadálymentes neve, ha nincs fölötte látható cím. */
  ariaLabel?: string
}

export function MaterialLinks({ ariaLabel, materials }: MaterialLinksProps) {
  return (
    <ul aria-label={ariaLabel} className="kc-materials__list" role="list">
      {materials.map((material, index) => (
        <li className="kc-materials__item" key={`${material.label}-${index}`}>
          {material.url === null ? (
            // A fájl nincs (még) feltöltve: a sor MEGMARAD, de nem ígér működő
            // megnyitást. A néma eltüntetés a szerkesztő elől is elrejtené a hibát.
            <span className="kc-materials__missing">
              <FileIcon />
              {/* Kettőspont, nem gondolatjel: docs/ui-sztenderdek.md §3.1 */}
              {material.label}: a fájl feltöltése folyamatban
            </span>
          ) : (
            <a
              className="kc-materials__link"
              href={material.url}
              rel="noopener noreferrer"
              target="_blank"
            >
              <FileIcon />
              <span className="kc-materials__label">{material.label}</span>
              {material.detail === null ? null : (
                <span className="kc-materials__detail">({material.detail})</span>
              )}
              <span className="kc-visually-hidden">, új lapon nyílik</span>
            </a>
          )}
        </li>
      ))}
    </ul>
  )
}

/** Dokumentum-ikon; dekoratív, a link neve a szöveg. */
function FileIcon() {
  return (
    <svg
      aria-hidden="true"
      className="kc-materials__icon"
      fill="none"
      focusable="false"
      height="20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="20"
    >
      <path d="M14 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V7.5l-4-4Z" />
      <path d="M14 3.5v4h4M9 12.5h6M9 16h6" />
    </svg>
  )
}

export const COURSE_MATERIALS_HEADING = 'Segédanyagok a kurzushoz'

/** A kurzus segédanyagai a lejátszóban: minden lecke alatt ugyanott. */
export function CourseMaterials({ materials }: { materials: readonly CurriculumAttachment[] }) {
  if (materials.length === 0) {
    return null
  }
  return (
    <section aria-labelledby="kc-kurzus-segedanyagok" className="kc-materials">
      <h2 className="kc-materials__title" id="kc-kurzus-segedanyagok">
        {COURSE_MATERIALS_HEADING}
      </h2>
      <MaterialLinks materials={materials} />
    </section>
  )
}
