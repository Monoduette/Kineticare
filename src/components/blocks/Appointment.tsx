import type { BlockAppointment } from '../../payload-types'
import { appointmentShowsForm } from '../../lib/appointment/context'
import { MAPS_LINK_HINT, mapsHref } from '../../lib/maps-href'
import { sanitizeCmsUrl } from '../../lib/safe-url'
import { telHref } from '../../lib/tel-href'
import { Container } from '../ui/Container'
import { Section } from '../ui/Section'

import { AppointmentForm } from './AppointmentForm'

import '../../app/(frontend)/styles/blocks/appointment.css'

/**
 * Appointment — időpontkérő szekció a rendelői kezelésekhez.
 * NEM renderel, a rács egyhasábos lesz, és a telefonszám marad az egyetlen út.
 */

export interface AppointmentProps {
  block: BlockAppointment
}

/** Egy megjelenítendő telefonszám: felirat, szám és a hívás-link. */
export interface AppointmentPhone {
  nev: string
  szam: string
  href: string | null
}

/** A blokk telefonszám-sorai → megjeleníthető alak (üres szám kimarad). */
export function appointmentPhones(block: BlockAppointment): AppointmentPhone[] {
  return (block.telefonszamok ?? [])
    .map((row) => ({
      nev: row.nev?.trim() ?? '',
      szam: row.szam?.trim() ?? '',
    }))
    .filter((row) => row.szam.length > 0)
    .map((row) => ({ ...row, href: telHref(row.szam) }))
}

export interface AppointmentIntroProps {
  block: BlockAppointment
  /** A szekció címsorának id-je (a `Section` aria-labelledby-jához). */
  headingId: string
}

/**
 * A szekció bal hasábja — TISZTÁN a CMS mezőiből. Külön exportált komponens,
 * hogy a „nincs beégetett vevői szöveg" őr-teszt pontosan ezt a felületet
 * mérhesse (az űrlap-chrome szükségszerűen rögzített szövegeket visel).
 */
export function AppointmentIntro({ block, headingId }: AppointmentIntroProps) {
  const eyebrow = block.eyebrow?.trim() ?? ''
  const title = block.title?.trim() ?? ''
  const lead = block.lead?.trim() ?? ''
  const magyarazat = block.magyarazat?.trim() ?? ''

  const helyszinek = (block.helyszinek ?? [])
    .map((row) => ({ cim: row.cim?.trim() ?? '', megjegyzes: row.megjegyzes?.trim() ?? '' }))
    .filter((row) => row.cim.length > 0)
    .map((row) => ({ ...row, href: mapsHref(row.cim) }))
  const telefonok = appointmentPhones(block)
  const email = block.email?.trim() ?? ''
  const emailHref = email.length > 0 ? sanitizeCmsUrl(`mailto:${email}`) : null

  const helyszinekFelirat = block.helyszinekFelirat?.trim() ?? ''
  const telefonFelirat = block.telefonFelirat?.trim() ?? ''
  const emailFelirat = block.emailFelirat?.trim() ?? ''

  const hasContact = helyszinek.length > 0 || telefonok.length > 0 || email.length > 0

  // Űrlap nélkül az elérhetőség nem kísérő adat, hanem A cselekvés — ezért kap
  // saját módosítót, amin a CSS a 44 px-es célfelületet adja (lásd a fájl fejét).
  const contactClass = appointmentShowsForm(block)
    ? 'kc-appointment__contact'
    : 'kc-appointment__contact kc-appointment__contact--fo'

  return (
    <div className="kc-appointment__intro">
      {eyebrow.length > 0 ? <p className="kc-appointment__eyebrow">{eyebrow}</p> : null}
      {title.length > 0 ? (
        <h2 className="kc-appointment__title" id={headingId}>
          {title}
        </h2>
      ) : null}
      {lead.length > 0 ? <p className="kc-appointment__lead">{lead}</p> : null}
      {magyarazat.length > 0 ? (
        <p className="kc-appointment__note">{magyarazat}</p>
      ) : null}

      {hasContact ? (
        <dl className={contactClass}>
          {helyszinek.length > 0 ? (
            <div className="kc-appointment__contact-group">
              {helyszinekFelirat.length > 0 ? <dt>{helyszinekFelirat}</dt> : null}
              {helyszinek.map((helyszin) => (
                <dd key={helyszin.cim}>
                  {/* A cím a telefonszámmal azonos mintán kattintható: a látható
                      szöveg maga a cím, a link a Google Térképet nyitja új lapon
                      (miért `search` és miért új lap: src/lib/maps-href.ts). A
                      rejtett toldat a képernyőolvasónak mondja meg a célt és az
                      ablaknyitást (WCAG 2.2 SC 2.4.4, SC 3.2.5; G200, G201).
                      Az aláhúzást és a 44 px-es célt az appointment.css
                      `.kc-appointment__contact dd a` szabálya adja, ahogy a
                      tel- és mailto-linknek (NN/g, Guidelines for Visualizing
                      Links: a linkek egy oldalon egyformán nézzenek ki,
                      https://www.nngroup.com/articles/guidelines-for-visualizing-links/).
                      A megjegyzés a linken KÍVÜL marad: nem része a címnek. */}
                  {helyszin.href ? (
                    <a href={helyszin.href} target="_blank" rel="noopener noreferrer">
                      {helyszin.cim}
                      <span className="kc-visually-hidden">{MAPS_LINK_HINT}</span>
                    </a>
                  ) : (
                    helyszin.cim
                  )}
                  {helyszin.megjegyzes.length > 0 ? (
                    <span className="kc-appointment__contact-note">{helyszin.megjegyzes}</span>
                  ) : null}
                </dd>
              ))}
            </div>
          ) : null}

          {telefonok.length > 0 ? (
            <div className="kc-appointment__contact-group">
              {telefonFelirat.length > 0 ? <dt>{telefonFelirat}</dt> : null}
              {telefonok.map((telefon) => (
                <dd key={telefon.szam}>
                  {telefon.href ? <a href={telefon.href}>{telefon.szam}</a> : telefon.szam}
                  {telefon.nev.length > 0 ? (
                    <span className="kc-appointment__contact-note">{telefon.nev}</span>
                  ) : null}
                </dd>
              ))}
            </div>
          ) : null}

          {email.length > 0 ? (
            <div className="kc-appointment__contact-group">
              {emailFelirat.length > 0 ? <dt>{emailFelirat}</dt> : null}
              <dd>{emailHref ? <a href={emailHref}>{email}</a> : email}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  )
}

export interface AppointmentSectionProps extends AppointmentProps {
  /** Az „Időpontkérés" űrlap azonosítója; null = az űrlap letiltva renderel. */
  formId: string | null
  /** TURNSTILE_SITE_KEY; null/üres = a widget rejtve marad. */
  turnstileSiteKey: string | null
}

export function Appointment({ block, formId, turnstileSiteKey }: AppointmentSectionProps) {
  const settings = block.sectionSettings
  const anchorId = settings?.anchorId?.trim() || undefined
  const variant =
    settings?.hatter === 'sotet' ? 'dark' : settings?.hatter === 'feher' ? 'default' : 'tint'
  const headingId = `appointment-cim-${block.id ?? 'fo'}`
  const title = block.title?.trim() ?? ''
  const urlapCim = block.urlapCim?.trim() ?? ''

  const idopontSavok = (block.idopontSavok ?? [])
    .map((row) => row.felirat?.trim() ?? '')
    .filter((felirat) => felirat.length > 0)

  const urlapLatszik = appointmentShowsForm(block)

  return (
    <Section
      aria-labelledby={title.length > 0 ? headingId : undefined}
      className="kc-appointment"
      id={anchorId}
      variant={variant}
    >
      <Container>
        <div
          className={
            urlapLatszik
              ? 'kc-appointment__grid'
              : 'kc-appointment__grid kc-appointment__grid--egyhasabos'
          }
        >
          <AppointmentIntro block={block} headingId={headingId} />
          {urlapLatszik ? (
            <div className="kc-appointment__panel">
              {urlapCim.length > 0 ? (
                <h3 className="kc-appointment__panel-title">{urlapCim}</h3>
              ) : null}
              <AppointmentForm
                formId={formId}
                gombFelirat={block.gombFelirat ?? undefined}
                idopontSavok={idopontSavok}
                sikerCim={block.sikerCim ?? undefined}
                sikerSzoveg={block.sikerSzoveg ?? undefined}
                telefonok={appointmentPhones(block)}
                turnstileSiteKey={turnstileSiteKey}
              />
            </div>
          ) : null}
        </div>
      </Container>
    </Section>
  )
}
