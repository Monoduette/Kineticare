import { rewriteVisitorDashLeftover } from '../../lib/gondolatjel-leftover'
import type { BlockAccordion } from '../../payload-types'
import { MediaImage } from '../content/MediaImage'
import { pickMediaUrl } from '../content/media-url'
import { RichText } from '../lexical/RichText'
import { hasLexicalContent } from '../lexical/serialize'
import { Container } from '../ui/Container'
import { Section } from '../ui/Section'

import '../../app/(frontend)/styles/blocks/accordion.css'

/**
 * Accordion — nyitható-csukható szekció (harmonika).
 * FAQPage JSON-LD-t szándékosan NEM ad ki: egy szakmai önéletrajz strukturált
 */
export interface AccordionProps {
  block: BlockAccordion
}

export function Accordion({ block }: AccordionProps) {
  const items = (block.items ?? [])
    .map((item) => ({
      id: item.id,
      // Élő CMS-maradék (2026-09-07 előtti seed): a „Név — szakmai önéletrajz"
      // alak pontos egyezésre vesszőtlen, natív alakra vált; minden más
      // cím érintetlen (src/lib/gondolatjel-leftover.ts).
      cim: rewriteVisitorDashLeftover(item.cim?.trim() ?? ''),
      osszefoglalo: item.osszefoglalo?.trim() ?? '',
      tartalom: item.tartalom,
      // Csak a FELOLDOTT (depth ≥ 1) és URL-lel bíró médiát rendereljük; a
      // puszta id (depth 0) vagy törölt kép → a sor kép nélkül áll.
      kep:
        typeof item.kep === 'object' && item.kep !== null && pickMediaUrl(item.kep, 'sm')
          ? item.kep
          : null,
    }))
    .filter((item) => item.cim.length > 0 && hasLexicalContent(item.tartalom))

  if (items.length === 0) {
    return null
  }

  const settings = block.sectionSettings
  const anchorId = settings?.anchorId?.trim() || undefined
  const variant =
    settings?.hatter === 'tint' ? 'tint' : settings?.hatter === 'sotet' ? 'dark' : 'default'
  const headingId = `accordion-cim-${block.id ?? 'fo'}`
  const eyebrow = block.eyebrow?.trim() ?? ''
  const title = block.title?.trim() ?? ''
  const lead = rewriteVisitorDashLeftover(block.lead?.trim() ?? '')

  return (
    <Section
      aria-labelledby={title.length > 0 ? headingId : undefined}
      className="kc-accordion"
      id={anchorId}
      variant={variant}
    >
      <Container size="narrow">
        {eyebrow.length > 0 ? <p className="kc-accordion__eyebrow">{eyebrow}</p> : null}
        {title.length > 0 ? (
          <h2 className="kc-accordion__title" id={headingId}>
            {title}
          </h2>
        ) : null}
        {lead.length > 0 ? <p className="kc-accordion__lead">{lead}</p> : null}
        <div className="kc-accordion__list">
          {items.map((item, index) => (
            <details className="kc-accordion__item" key={item.id ?? `sor-${index}`}>
              {/* A kivonat a `summary`-n BELÜL van: csukott állapotban is
                  látszania kell (a rejtett tartalom mennyisége maga a bizalmi
                  jelzés), és a kattintható felület része marad. */}
              <summary className="kc-accordion__summary">
                {/* Kis, kör alakú portré a sor ELEJÉN, csukva is (A05). A
                    summary marad az egyetlen kattintható elem: a kép nem
                    link, nem gomb, csak a summary tartalma — az érintőcél és
                    a fókuszgyűrű változatlan (WCAG 2.2 SC 2.5.8, SC 2.4.7).
                    Az alt a Médiatárból jön (SC 1.1.1); a fejléc-sorban
                    ugyanaz a név szövegként is ott van, ezért az alt rövid
                    („Kocsis Kata portréja"), nem ismétli a sor tartalmát.
                    NN/g (Accordions on Desktop): a fejlécnek önmagában kell
                    közölnie, mi van a lenyitó mögött — az arc + név + kivonat
                    hármas ezt adja:
                    https://www.nngroup.com/articles/accordions-on-desktop/ */}
                {item.kep ? (
                  <span className="kc-accordion__portrait">
                    <MediaImage media={item.kep} preferredSize="sm" sizes="48px" />
                  </span>
                ) : null}
                <span className="kc-accordion__label">
                  <span className="kc-accordion__heading">{item.cim}</span>
                  {item.osszefoglalo.length > 0 ? (
                    <span className="kc-accordion__summary-note">{item.osszefoglalo}</span>
                  ) : null}
                </span>
              </summary>
              <div className="kc-accordion__panel">
                <RichText content={item.tartalom} />
              </div>
            </details>
          ))}
        </div>
      </Container>
    </Section>
  )
}
