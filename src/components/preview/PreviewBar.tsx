import { buildExitPreviewHref } from '@/lib/preview/exit-preview'
import { Container } from '@/components/ui/Container'

/**
 * PreviewBar — vékony jelzősáv a piszkozat-előnézethez.
 * Akkor jelenik meg egy tartalmi oldal tetején, ha a szerkesztő a
 * `/next/preview` route-tal bekapcsolta a Next draft mode-ot (oda csak
 * staff/owner jut be). Kettős szerepe van:
 * (`/next/exit-preview`, a visszatérési útvonallal).
 * A kilépés szándékosan sima `<a>` (nem next/link): teljes oldalbetöltés kell,
 */
export interface PreviewBarProps {
  /** Az aktuális oldal útvonala — kilépés után ide tér vissza a szerkesztő. */
  path: string
}

export function PreviewBar({ path }: PreviewBarProps) {
  return (
    <div className="kc-preview-bar">
      <Container className="kc-preview-bar__inner">
        <p className="kc-preview-bar__text">
          <strong>Előnézet:</strong> a piszkozatot látod — ez a változat még nem nyilvános.
        </p>
        <a className="kc-preview-bar__exit" href={buildExitPreviewHref(path)}>
          Kilépés az előnézetből
        </a>
      </Container>
    </div>
  )
}
