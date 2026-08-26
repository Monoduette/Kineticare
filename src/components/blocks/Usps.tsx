import type { BlockUsps } from '../../payload-types'
import { Section } from '../ui/Section'

import '../../app/(frontend)/styles/blocks/usps.css'

/**
 * Usps — „Erre számíthatsz" kártyák (szekció-rendszer terv 2. katalógus, 3.4).
 * A landing `kc-usps` szekciójának portja: 1–4 sorszámozott kártya, kártyánként
 * egy állítással és 1–2 bekezdéssel. A sorszámot a MEGJELENÍTÉS adja (a CMS-ben
 * nincs sorszám-mező), ezért a lista rendezett (`ol`): a sorrendet a
 * képernyőolvasó is megkapja, a látható korong pedig dekoratív.
 * Kártya nélkül a szekció kimarad.
 */
export interface UspsProps {
  block: BlockUsps
}

export function Usps({ block }: UspsProps) {
  const cards = (block.cards ?? []).filter((card) => (card.title?.trim() ?? '').length > 0)
  if (cards.length === 0) {
    return null
  }

  const settings = block.sectionSettings
  const anchorId = settings?.anchorId?.trim() || undefined
  const variant =
    settings?.hatter === 'tint' ? 'tint' : settings?.hatter === 'sotet' ? 'dark' : 'default'
  const headingId = `usps-cim-${block.id ?? 'fo'}`
  const title = block.title?.trim() ?? ''

  return (
    <Section
      aria-labelledby={title.length > 0 ? headingId : undefined}
      className="kc-usps kc-board"
      id={anchorId}
      variant={variant}
    >
      <div className="kc-board__inner">
        {title.length > 0 ? (
          <h2 className="kc-usps__title" id={headingId}>
            {title}
          </h2>
        ) : null}
        <ol className="kc-usps__list">
          {cards.map((card, index) => {
            const body = card.body?.trim() ?? ''
            const extra = card.extra?.trim() ?? ''
            return (
              <li className="kc-usps__item" key={card.id ?? `kartya-${index}`}>
                <span aria-hidden="true" className="kc-usps__num">
                  {index + 1}
                </span>
                <div className="kc-usps__body">
                  <h3 className="kc-usps__card-title">{card.title.trim()}</h3>
                  {body.length > 0 ? <p className="kc-usps__text">{body}</p> : null}
                  {extra.length > 0 ? <p className="kc-usps__text">{extra}</p> : null}
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </Section>
  )
}
