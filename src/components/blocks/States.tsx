import type { BlockStates } from '../../payload-types'
import { MediaImage } from '../content/MediaImage'
import { Section } from '../ui/Section'

import '../../app/(frontend)/styles/blocks/states.css'

/**
 * States — „Három állapot" (szekció-rendszer terv 2. katalógus, 3.4).
 * A landing `kc-states` szekciójának portja: bevezető + 1–3 kártya, kártyánként
 * Media-képpel, sorszámmal, címmel és rövid szöveggel (zárt → nyíló → nyitott).
 * A képek a Media collectionből jönnek (terv 3.4), így a szerkesztők
 * cserélhetik őket. A képleírás (alt) a Media dokumentumon él — a MediaImage
 * onnan veszi. Kép nélkül a kártya szöveges marad, a szekció nem törik el.
 */
export interface StatesProps {
  block: BlockStates
}

export function States({ block }: StatesProps) {
  const cards = (block.cards ?? []).filter((card) => (card.title?.trim() ?? '').length > 0)
  if (cards.length === 0) {
    return null
  }

  const settings = block.sectionSettings
  const anchorId = settings?.anchorId?.trim() || undefined
  const variant =
    settings?.hatter === 'tint' ? 'tint' : settings?.hatter === 'sotet' ? 'dark' : 'default'
  const headingId = `states-cim-${block.id ?? 'fo'}`
  const title = block.title?.trim() ?? ''
  const lead = block.lead?.trim() ?? ''

  return (
    <Section
      aria-labelledby={title.length > 0 ? headingId : undefined}
      className="kc-states kc-board"
      id={anchorId}
      variant={variant}
    >
      <div className="kc-board__inner">
        {title.length > 0 ? (
          <h2 className="kc-states__title" id={headingId}>
            {title}
          </h2>
        ) : null}
        {lead.length > 0 ? <p className="kc-states__lead">{lead}</p> : null}
        <ol className="kc-states__grid">
          {cards.map((card, index) => {
            const media = typeof card.image === 'object' && card.image !== null ? card.image : null
            // Ha a szerkesztő nem adott meg sorszámot, a rendszer számoz (01, 02…).
            const number = card.number?.trim() || String(index + 1).padStart(2, '0')
            const text = card.text?.trim() ?? ''
            return (
              <li className="kc-states__item" key={card.id ?? `kartya-${index}`}>
                <figure className="kc-states__card">
                  <span aria-hidden="true" className="kc-states__index">
                    {number}
                  </span>
                  {media ? (
                    <span className="kc-states__media">
                      <MediaImage
                        media={media}
                        preferredSize="sm"
                        sizes="(max-width: 900px) 100vw, 352px"
                      />
                    </span>
                  ) : null}
                  <figcaption className="kc-states__caption">
                    <h3 className="kc-states__card-title">{card.title.trim()}</h3>
                    {text.length > 0 ? <p className="kc-states__text">{text}</p> : null}
                  </figcaption>
                </figure>
              </li>
            )
          })}
        </ol>
      </div>
    </Section>
  )
}
