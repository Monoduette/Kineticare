import type { Block } from 'payload'

import { about } from './about'
import { accordion } from './accordion'
import { appointment } from './appointment'
import { courseCards } from './course-cards'
import { credsStrip } from './creds-strip'
import { ctaBanner } from './cta-banner'
import { faq } from './faq'
import { filmHero } from './film-hero'
import { freeSos } from './free-sos'
import { howItWorks } from './how-it-works'
import { knowledge } from './knowledge'
import { pressLogos } from './press-logos'
import { richText } from './rich-text'
import { services } from './services'
import { states } from './states'
import { teamMembers } from './team-members'
import { testimonials } from './testimonials'
import { usps } from './usps'
import { welcome } from './welcome'

/**
 * A szekció-rendszer blokk-katalógusa (docs/szekcio-rendszer-terv.md 2. pont).
 * A tömb SORRENDJE az admin „+ Blokk" választólistájának sorrendje. Szándékosan
 * a terv 4. pontja szerinti AJÁNLOTT kezdőlap-sorrendet követi (M1–M8 +
 * kinézet-blokkok), hogy a laikus szerkesztő fentről lefelé haladva építhessen
 * kezdőlapot. Az utolsó két blokk (szabad szöveg, CTA-sáv) nem kötődik
 * kezdőlapi pozícióhoz, ezért külön admin-csoportba kerül. Ugyanebbe a
 */
export const pageBlocks: Block[] = [
  filmHero,
  credsStrip,
  courseCards,
  freeSos,
  pressLogos,
  welcome,
  usps,
  states,
  services,
  about,
  howItWorks,
  testimonials,
  knowledge,
  faq,
  teamMembers,
  accordion,
  appointment,
  richText,
  ctaBanner,
]

/** A katalógus blokk-azonosítói (renderelő és tesztek számára). */
export const pageBlockSlugs: string[] = pageBlocks.map((block) => block.slug)

export {
  about,
  accordion,
  appointment,
  courseCards,
  credsStrip,
  ctaBanner,
  faq,
  filmHero,
  freeSos,
  howItWorks,
  knowledge,
  pressLogos,
  richText,
  services,
  states,
  teamMembers,
  testimonials,
  usps,
  welcome,
}
export { linkFields, linkGroup, LINK_URL_DESCRIPTION } from './link-fields'
export type { LinkFieldsOptions, LinkGroupOptions } from './link-fields'
export { sectionSettings, validateAnchorId } from './section-settings'
export type { SectionBackground, SectionSettingsOptions } from './section-settings'
