import type { BlockWelcome } from '../../payload-types'
import { Section } from '../ui/Section'

import '../../app/(frontend)/styles/blocks/welcome.css'

/**
 * Welcome — üdvözlő / probléma-blokk (szekció-rendszer terv 2. katalógus, 3.4).
 * A landing `kc-welcome` szekciójának portja: cím + felvezető sor, alatta bal
 * oldalon a pipás felsorolás („Tudjuk, milyen, amikor…"), jobb oldalon az
 * összefoglaló bekezdések. Minden szöveg a CMS-ből érkezik — kódban
 * hardcode-olt marketingszöveg nincs.
 * Közös szekció-viselkedés (mind a nyolc blokk-komponensben ugyanígy):
 */
export interface WelcomeProps {
  block: BlockWelcome
}

export function Welcome({ block }: WelcomeProps) {
  const title = block.title?.trim() ?? ''
  if (title.length === 0) {
    return null
  }

  const settings = block.sectionSettings
  const anchorId = settings?.anchorId?.trim() || undefined
  const variant =
    settings?.hatter === 'tint' ? 'tint' : settings?.hatter === 'sotet' ? 'dark' : 'default'
  // A szekció landmarkját a saját címsora nevezi meg; a blokk Payload-azonosítója
  // teszi egyedivé, ha ugyanaz a blokk többször szerepel az oldalon.
  const headingId = `welcome-cim-${block.id ?? 'fo'}`

  const lead = block.lead?.trim() ?? ''
  const checklist = (block.checklist ?? []).filter((item) => (item.text?.trim() ?? '').length > 0)
  const sideParagraphs = (block.sideParagraphs ?? []).filter(
    (item) => (item.text?.trim() ?? '').length > 0,
  )

  return (
    <Section
      aria-labelledby={headingId}
      className="kc-welcome kc-board"
      id={anchorId}
      variant={variant}
    >
      <div className="kc-board__inner">
        <div className="kc-welcome__head">
          <h2 className="kc-welcome__title" id={headingId}>
            {title}
          </h2>
          {lead.length > 0 ? <p className="kc-welcome__lead">{lead}</p> : null}
        </div>
        {checklist.length > 0 || sideParagraphs.length > 0 ? (
          <div className="kc-welcome__grid">
            {checklist.length > 0 ? (
              <ul className="kc-welcome__checklist">
                {checklist.map((item, index) => (
                  <li className="kc-welcome__checklist-item" key={item.id ?? `tetel-${index}`}>
                    {item.text.trim()}
                  </li>
                ))}
              </ul>
            ) : null}
            {sideParagraphs.length > 0 ? (
              <div className="kc-welcome__side">
                {sideParagraphs.map((item, index) => {
                  const text = item.text.trim()
                  return (
                    <p className="kc-welcome__side-text" key={item.id ?? `bekezdes-${index}`}>
                      {item.emphasized ? <strong>{text}</strong> : text}
                    </p>
                  )
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Section>
  )
}
