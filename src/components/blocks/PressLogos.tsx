import Link from 'next/link'

import type { BlockPressLogos } from '../../payload-types'
import { sanitizeCmsUrl } from '../../lib/safe-url'
import { MediaImage } from '../content/MediaImage'
import { pickMediaUrl } from '../content/media-url'
import { Section } from '../ui/Section'
import { LogoRail } from './LogoRail'

import '../../app/(frontend)/styles/blocks/press-logos.css'

/**
 * PressLogos — sajtó-logósor (szekció-rendszer terv 2. katalógus, 3.4).
 * A landing `kc-press` sávjának portja: rövid felirat + a médiamegjelenések és
 * szakmai szervezetek logói egy sorban, a Médiatárból.
 * Képleírás: alapesetben a Media dokumentum `alt`-ja jelenik meg (egy helyen
 * karbantartva); ha a szerkesztő a blokkban felülírta, az élvez elsőbbséget —
 * ilyenkor a MediaImage-nek átadott média-objektum `alt`-ja cserélődik le, hogy
 */

/**
 * A logósor beépített felirata — a blokk `heading` mezője írja felül.
 *
 * A korábbi „Ismerhetsz minket innen" helyett a tulajdonos 2026-08-16-án
 * jóváhagyott szövege: a sorban nemcsak sajtómegjelenések, hanem szakmai
 * szervezetek (MGYFT) logói is állnak, és a „találkozhattál velünk" ezt a
 * vegyes halmazt pontosan írja le, ráadásul a látogató szemszögéből.
 */
export const DEFAULT_HEADING = 'Itt találkozhattál velünk'

export interface PressLogosProps {
  block: BlockPressLogos
}

export function PressLogos({ block }: PressLogosProps) {
  const logos = (block.logos ?? []).filter(
    (logo) =>
      typeof logo.image === 'object' && logo.image !== null && pickMediaUrl(logo.image, 'xs'),
  )
  if (logos.length === 0) {
    return null
  }

  const settings = block.sectionSettings
  const anchorId = settings?.anchorId?.trim() || undefined
  const variant =
    settings?.hatter === 'tint' ? 'tint' : settings?.hatter === 'sotet' ? 'dark' : 'default'
  const headingId = `press-felirat-${block.id ?? 'fo'}`
  const heading = block.heading?.trim() || DEFAULT_HEADING

  return (
    <Section
      aria-labelledby={headingId}
      className="kc-press kc-board kc-board--band"
      id={anchorId}
      variant={variant}
    >
      <div className="kc-board__inner">
        <p className="kc-press__label" id={headingId}>
          {heading}
        </p>
        <LogoRail count={logos.length}>
          {logos.map((logo, index) => {
            const media = logo.image
            if (typeof media !== 'object' || media === null) {
              return null
            }
            const altOverride = logo.alt?.trim() ?? ''
            // Az egységes logókeret maximális szélességéhez választunk forrást.
            const image = (
              <MediaImage
                media={altOverride.length > 0 ? { ...media, alt: altOverride } : media}
                preferredSize="sm"
                sizes="(max-width: 960px) 192px, (max-width: 1280px) 20vw, 256px"
              />
            )
            // CMS-webcím allowlist-szűrése (src/lib/safe-url.ts): tiltott
            // sémánál (pl. `javascript:`) a logó LINK NÉLKÜL renderelődik —
            // a kép és a képleírás megmarad.
            const url = sanitizeCmsUrl(logo.url) ?? ''
            const isExternal = /^https?:\/\//i.test(url)
            return (
              <li className="kc-press__item" key={logo.id ?? `logo-${index}`}>
                {url.length === 0 ? (
                  image
                ) : isExternal ? (
                  <a
                    className="kc-press__link"
                    href={url}
                    {...(logo.ujAblakban ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  >
                    {image}
                  </a>
                ) : (
                  <Link
                    className="kc-press__link"
                    href={url}
                    {...(logo.ujAblakban ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  >
                    {image}
                  </Link>
                )}
              </li>
            )
          })}
        </LogoRail>
      </div>
    </Section>
  )
}
