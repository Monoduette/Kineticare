import Link from 'next/link'

import { FeedbackTrigger } from '../feedback/FeedbackTrigger'
import { Button } from '../ui/Button'
import { Container } from '../ui/Container'
import { Section } from '../ui/Section'
import { KAPCSOLATI_EMAIL_TARTALEK } from '../../lib/contact-email'

import {
  NOT_FOUND_CHECKS,
  NOT_FOUND_DESTINATIONS_LABEL,
  NOT_FOUND_LEAD,
  NOT_FOUND_PRIMARY_ACTION,
  NOT_FOUND_SECONDARY_ACTION,
  NOT_FOUND_TITLE,
  notFoundDestinations,
} from './not-found-content'

export interface NotFoundViewProps {
  /**
   * A Tudástár-kapcsoló állapota (src/lib/tudastar-kapcsolo.ts). Hamis
   * értéknél a „Vagy folytasd innen” listában nincs Tudástár-javaslat.
   * Elhagyva látható: a nézet adatbázis nélkül is renderelhető marad.
   */
  tudastarLathato?: boolean
  /**
   * A kapcsolati e-mail (modul-térkép H18/A10). A (frontend) not-found határ
   * a kérésidejű feloldást adja át (`getContactEmail`); a global-not-found
   * statikusan előre renderelt könnyű lap, ott a prop elmarad, és a
   * kódtartalék látszik. A nézet maga nem olvas adatbázist, így a
   * szerveroldali feloldót sem importálja.
   */
  kapcsolatiEmail?: string
}

/**
 * A „nem található" oldal TÖRZSE. Egy komponens, két beépítési hely:
 * 2. `src/app/global-not-found.tsx` — ide fut minden NEM ILLESZKEDŐ URL
 */
export function NotFoundView({
  tudastarLathato = true,
  kapcsolatiEmail = KAPCSOLATI_EMAIL_TARTALEK,
}: NotFoundViewProps = {}) {
  return (
    <Section>
      {/* Felvezető sor (eyebrow) SZÁNDÉKOSAN nincs: a régi lapon a nagy „404"
          állt itt, de a GOV.UK minta tiltja a hibakódot, egy „Nem található"
          felvezető pedig szó szerint megismételné a h1-et. A GOV.UK
          „Page not found" lapja is egyetlen címsorral indul. */}
      <Container className="kc-error-page" size="narrow">
        <h1 className="kc-error-page__title">{NOT_FOUND_TITLE}</h1>
        <p className="kc-error-page__text">{NOT_FOUND_LEAD}</p>

        <ul className="kc-error-page__checks">
          {NOT_FOUND_CHECKS.map((check) => (
            <li key={check}>{check}</li>
          ))}
        </ul>

        <div className="kc-error-page__actions">
          <Button href={NOT_FOUND_PRIMARY_ACTION.href}>{NOT_FOUND_PRIMARY_ACTION.label}</Button>
          <Button href={NOT_FOUND_SECONDARY_ACTION.href} variant="secondary">
            {NOT_FOUND_SECONDARY_ACTION.label}
          </Button>
        </div>

        <nav aria-labelledby="kc-404-celok" className="kc-error-page__destinations">
          <p className="kc-error-page__destinations-title" id="kc-404-celok">
            {NOT_FOUND_DESTINATIONS_LABEL}
          </p>
          <ul className="kc-error-page__dest-list">
            {notFoundDestinations(tudastarLathato).map((destination) => (
              <li key={destination.href}>
                <Link className="kc-error-page__dest-link" href={destination.href}>
                  <span className="kc-error-page__dest-label">{destination.label}</span>
                  <span className="kc-error-page__dest-hint">{destination.hint}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <p className="kc-error-page__contact">
          Nem találod, amit kerestél? Írj a{' '}
          <a href={`mailto:${kapcsolatiEmail}`}>{kapcsolatiEmail}</a> címre.
        </p>
        {/* WP65 — hibajelzés a 404-ről is. A gomb NEM hivatkozás, tehát a lap
            cél-leltárát nem duplázza (őr: src/__tests__/hibaoldal.test.tsx),
            és a doboz csak nyitáskor kerül a DOM-ba. */}
        <p className="kc-error-page__contact">
          <FeedbackTrigger />
        </p>
      </Container>
    </Section>
  )
}
