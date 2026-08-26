import Link from 'next/link'

import type { BlockTeamMembers } from '../../payload-types'
import { sanitizeCmsUrl } from '../../lib/safe-url'
import { telHref } from '../../lib/tel-href'
import { MediaImage } from '../content/MediaImage'
import { Container } from '../ui/Container'
import { Section } from '../ui/Section'

import '../../app/(frontend)/styles/blocks/team-members.css'

/**
 * TeamMembers — két gyógytornász 50–50 bemutatása (blokk: team-members.ts).
 * auto-fit rács; szakmai listák natív details-ben. Teljesen CMS-vezérelt szöveg/kép.
 * Telefon link (nem gomb); opcionális írásos időpontkérés.
 */
export interface TeamMembersProps {
  block: BlockTeamMembers
}

/**
 * Telefonszám → `tel:` href. A megvalósítás a `src/lib/tel-href.ts` közös
 * moduljába költözött, mert az időpontkérő szekció is CMS-mezőből jövő
 * telefonszámot jelenít meg, és a `tel:`-összeállítás biztonsági kérdés: két
 * másolat csendben szétcsúszhatna. Itt tovább-exportáljuk, hogy a meglévő
 * importok (és a szakértő-kártya tesztjei) változatlanul működjenek.
 */
export { telHref }

/**
 * Dekoratív telefon-ikon a hívás-felületen.
 *
 * `aria-hidden`, mert a hivatkozásnak már van szöveges neve; a `focusable`
 * kikapcsolása a régi Edge/IE-örökség miatt kell, hogy az SVG ne kerüljön külön
 * tabsorrendbe. A színe `currentColor`, így a hover-inverzióban is együtt mozog
 * a szöveggel (nem kell külön kontraszt-számolás rá).
 */
function PhoneGlyph() {
  return (
    <svg
      aria-hidden="true"
      className="kc-team__call-icon"
      focusable="false"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M20 15.5c-1.25 0-2.45-.2-3.57-.57a1 1 0 0 0-1.02.24l-2.2 2.2a15.05 15.05 0 0 1-6.59-6.59l2.2-2.2a1 1 0 0 0 .25-1.02A11.36 11.36 0 0 1 8.5 4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1c0 9.39 7.61 17 17 17a1 1 0 0 0 1-1v-3.5a1 1 0 0 0-1-1z"
        fill="currentColor"
      />
    </svg>
  )
}

/** Egy szakmai lista sorai: soronként egy tétel, az üres sorok kimaradnak. */
export function cvItemLines(items: string): string[] {
  return items
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/** A blokk `linkGroup` mezőinek alakja (kártya-hivatkozás és időpontkérés). */
type CmsLink = { felirat?: string | null; url?: string | null; ujAblakban?: boolean | null } | null

/**
 * CMS-hivatkozás előkészítése: allowlist-szűrés + a felirat megléte.
 *
 * `null`-t ad, ha a webcím tiltott sémájú vagy a felirat üres — ilyenkor a hívó
 * egyszerűen NEM rendereli a linket (csendes elhagyás, a szerkesztő hibája nem
 * ejti szét az oldalt).
 */
function resolveCmsLink(link: CmsLink) {
  const url = sanitizeCmsUrl(link?.url) ?? ''
  const label = link?.felirat?.trim() ?? ''
  if (url.length === 0 || label.length === 0) {
    return null
  }
  const newTab = link?.ujAblakban === true
  return {
    url,
    label,
    isExternal: /^https?:\/\//i.test(url),
    linkProps: newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {},
  }
}

/**
 * Egy feloldott CMS-hivatkozás renderelése.
 *
 * Belső útvonalon `next/link` (kliens-oldali navigáció, előtöltés), külsőn sima
 * `a` — a `next/link` külső címre fölösleges router-munkát végezne.
 */
function CmsLinkAnchor({
  ariaLabel,
  className,
  link,
}: {
  ariaLabel?: string
  className: string
  link: NonNullable<ReturnType<typeof resolveCmsLink>>
}) {
  const content = (
    <>
      {link.label} <span aria-hidden="true">→</span>
    </>
  )
  return link.isExternal ? (
    <a aria-label={ariaLabel} className={className} href={link.url} {...link.linkProps}>
      {content}
    </a>
  ) : (
    <Link aria-label={ariaLabel} className={className} href={link.url} {...link.linkProps}>
      {content}
    </Link>
  )
}

export function TeamMembers({ block }: TeamMembersProps) {
  const members = (block.members ?? []).filter((member) => (member.name?.trim() ?? '').length > 0)
  if (members.length === 0) {
    return null
  }

  const settings = block.sectionSettings
  const anchorId = settings?.anchorId?.trim() || undefined
  const variant =
    settings?.hatter === 'tint' ? 'tint' : settings?.hatter === 'sotet' ? 'dark' : 'default'
  const headingId = `team-cim-${block.id ?? 'fo'}`
  const eyebrow = block.eyebrow?.trim() ?? ''
  const title = block.title?.trim() ?? ''
  const lead = block.lead?.trim() ?? ''
  const bookingLink = resolveCmsLink(block.bookingLink ?? null)

  return (
    <Section
      aria-labelledby={title.length > 0 ? headingId : undefined}
      className="kc-team"
      id={anchorId}
      variant={variant}
    >
      <Container>
        {eyebrow.length > 0 ? <p className="kc-team__eyebrow">{eyebrow}</p> : null}
        {title.length > 0 ? (
          <h2 className="kc-team__title" id={headingId}>
            {title}
          </h2>
        ) : null}
        {lead.length > 0 ? <p className="kc-team__lead">{lead}</p> : null}
        <ul className="kc-team__grid">
          {members.map((member, index) => (
            <li className="kc-team__item" key={member.id ?? `tag-${index}`}>
              {/* Cím nélküli szekcióban a nevek lépnek a h2 helyére: a h1 → h3
                  ugrás címsor-szintet hagyna ki (WCAG 1.3.1 gyakorlata). */}
              <TeamMemberCard
                blockId={block.id}
                index={index}
                member={member}
                nameLevel={title.length > 0 ? 'h3' : 'h2'}
              />
            </li>
          ))}
        </ul>
        {/* Aszinkron időpontkérés a kártyák ALATT: a hívás marad az elsődleges,
            de aki nem telefonál szívesen, itt talál írásos utat (NN/g
            healthcare-customer-journeys). A hivatkozás saját felirata elég
            beszédes, ezért nem kap külön `aria-label`-t (WCAG 2.5.3: a
            hozzáférhető név és a látható felirat így pontosan egyezik). */}
        {bookingLink ? (
          <p className="kc-team__booking-note">
            <CmsLinkAnchor className="kc-team__booking-link" link={bookingLink} />
          </p>
        ) : null}
      </Container>
    </Section>
  )
}

type Member = NonNullable<BlockTeamMembers['members']>[number]

function TeamMemberCard({
  blockId,
  index,
  member,
  nameLevel,
}: {
  blockId?: string | null
  index: number
  member: Member
  nameLevel: 'h2' | 'h3'
}) {
  const NameHeading = nameLevel
  const name = member.name.trim()
  const role = member.role?.trim() ?? ''
  const bio = member.bio?.trim() ?? ''
  const photo = typeof member.photo === 'object' && member.photo !== null ? member.photo : null
  const phone = member.phone?.trim() ?? ''
  const phoneHref = phone.length > 0 ? telHref(phone) : null
  const callLabel = member.callLabel?.trim() ?? ''
  const availability = member.availability?.trim() ?? ''
  const email = member.email?.trim() ?? ''
  // A mailto: az allowlist engedélyezett sémája — a szerkesztő elgépelt vagy
  // szándékosan más sémájú értékét ugyanaz a szűrő ejti, mint a CTA-kat.
  const emailHref = email.length > 0 ? sanitizeCmsUrl(`mailto:${email}`) : null
  /*
   * A hívás hozzáférhető neve. WCAG 2.5.3 (Label in Name): a hozzáférhető
   * névnek tartalmaznia kell a LÁTHATÓ feliratot — ezért ha van `callLabel`,
   * az kerül elé, és a szám is benne marad. Felirat nélkül a puszta szám nem
   * megkülönböztethető egy linklistában, ilyenkor a szakember neve azonosít.
   * Elválasztónak kettőspont áll, nem gondolatjel (projekt-skill 2. pont).
   */
  const callAriaLabel =
    callLabel.length > 0 ? `${callLabel}: ${phone}` : `${name} telefonszáma: ${phone}`
  const cvSections = (member.cvSections ?? [])
    .map((section) => ({
      id: section.id,
      heading: section.heading?.trim() ?? '',
      lines: cvItemLines(section.items ?? ''),
    }))
    .filter((section) => section.heading.length > 0 && section.lines.length > 0)

  // CMS-webcím allowlist-szűrése: tiltott sémánál a kártya link NÉLKÜL renderel.
  const cardLink = resolveCmsLink(member.link ?? null)

  return (
    <article className="kc-team__card">
      {photo ? (
        <figure className="kc-team__figure">
          {/* Két hasáb az 1120px-es konténerben → hasábonként ~540px; mobilon a
              kártya a teljes szélességet viszi. */}
          <MediaImage media={photo} preferredSize="md" sizes="(max-width: 899px) 100vw, 540px" />
        </figure>
      ) : null}
      <div className="kc-team__body">
        <NameHeading className="kc-team__name">{name}</NameHeading>
        {role.length > 0 ? <p className="kc-team__role">{role}</p> : null}
        {bio.length > 0 ? <p className="kc-team__bio">{bio}</p> : null}
        {phoneHref || emailHref || availability.length > 0 ? (
          <div className="kc-team__booking">
            {phoneHref ? (
              /* A `tel:` href-jét a telHref építi: a LÁTHATÓ szám tagolt marad
                 (leolvasható, visszamondható), a hivatkozásba viszont csak a
                 `+` és a számjegyek kerülnek — a nemzetközi alak az, ami minden
                 készüléken és külföldről is tárcsáz (web.dev, Click to Call). */
              <a aria-label={callAriaLabel} className="kc-team__call" href={phoneHref}>
                <PhoneGlyph />
                <span className="kc-team__call-text">
                  {callLabel.length > 0 ? (
                    <span className="kc-team__call-label">{callLabel}</span>
                  ) : null}
                  <span className="kc-team__call-number">{phone}</span>
                </span>
              </a>
            ) : null}
            {availability.length > 0 ? (
              <p className="kc-team__availability">{availability}</p>
            ) : null}
            {emailHref ? (
              <a
                aria-label={`${name} e-mail-címe: ${email}`}
                className="kc-team__email"
                href={emailHref}
              >
                {email}
              </a>
            ) : null}
          </div>
        ) : null}
        {cvSections.length > 0 ? (
          <div className="kc-team__cv">
            {/* A nyitott/zárt állapotot a natív details közli; a darabszám a
                rejtett tartalom MENNYISÉGÉT tartja láthatóan (bizalmi jelzés). */}
            {cvSections.map((section, sectionIndex) => (
              <details className="kc-team__cv-section" key={section.id ?? `lista-${sectionIndex}`}>
                <summary className="kc-team__cv-summary">
                  <span className="kc-team__cv-heading">{section.heading}</span>
                  <span className="kc-team__cv-count">{section.lines.length}</span>
                </summary>
                <ul className="kc-team__cv-list">
                  {section.lines.map((line, lineIndex) => (
                    <li
                      className="kc-team__cv-entry"
                      key={`${blockId ?? 'blokk'}-${index}-${sectionIndex}-${lineIndex}`}
                    >
                      {line}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        ) : null}
        {cardLink ? (
          <CmsLinkAnchor
            ariaLabel={`${name}: ${cardLink.label}`}
            className="kc-team__link"
            link={cardLink}
          />
        ) : null}
      </div>
    </article>
  )
}
