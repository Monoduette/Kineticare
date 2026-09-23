import { buildExitPreviewHref } from '@/lib/preview/exit-preview'
import { Container } from '@/components/ui/Container'

/**
 * PreviewBar — vékony jelzősáv a piszkozat-előnézethez.
 * Akkor jelenik meg egy tartalmi oldal tetején, ha a szerkesztő a
 * `/next/preview` route-tal bekapcsolta a Next draft mode-ot (oda csak
 * staff/owner jut be). Három dolgot tesz:
 * - kimondja, hogy a piszkozat látszik, nem a nyilvános változat (NN/g,
 *   Visibility of System Status: „systems should always keep users informed
 *   about what is going on”, https://www.nngroup.com/articles/visibility-system-status/);
 * - „Vissza a szerkesztőbe”: a dokumentum szerkesztője (ha a route átadja),
 *   ugyanabban a lapban (NN/g: „always open links in the same browser tab”,
 *   https://www.nngroup.com/articles/new-browser-windows-and-tabs/);
 * - kilépés az előnézetből (`/next/exit-preview`, a visszatérési útvonallal).
 * A linkek szándékosan sima `<a>`-k (nem next/link): teljes oldalbetöltés
 * kell, és a next/link előtöltése a kilépő route-ot is meghívná.
 * A szövegben nincs töltelék gondolatjel (docs/ui-sztenderdek.md §3.1).
 */
export interface PreviewBarProps {
  /** Az aktuális oldal útvonala — kilépés után ide tér vissza a szerkesztő. */
  path: string
  /**
   * A dokumentum admin-szerkesztője (`szekcioMelylink(...)`, blokk nélkül).
   * Elhagyva a „Vissza a szerkesztőbe” link nem jelenik meg.
   */
  szerkesztoHref?: string
}

/** Az előnézet-sáv szövege (töltelék gondolatjel nélkül). */
export const PREVIEW_BAR_SZOVEG = 'a piszkozatot látod, ez a változat még nem nyilvános.'

/** A dokumentum szerkesztőjére vivő link felirata. */
export const VISSZA_A_SZERKESZTOBE = 'Vissza a szerkesztőbe'

export function PreviewBar({ path, szerkesztoHref }: PreviewBarProps) {
  return (
    <div className="kc-preview-bar">
      <Container className="kc-preview-bar__inner">
        <p className="kc-preview-bar__text">
          <strong>Előnézet:</strong> {PREVIEW_BAR_SZOVEG}
        </p>
        <p className="kc-preview-bar__links">
          {szerkesztoHref ? (
            <a className="kc-preview-bar__exit" href={szerkesztoHref}>
              {VISSZA_A_SZERKESZTOBE}
            </a>
          ) : null}
          <a className="kc-preview-bar__exit" href={buildExitPreviewHref(path)}>
            Kilépés az előnézetből
          </a>
        </p>
      </Container>
    </div>
  )
}
