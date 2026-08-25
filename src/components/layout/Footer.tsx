import Link from 'next/link'

import { ConsentSettingsButton } from '../analytics/ConsentSettingsButton'
import { Container } from '../ui/Container'

import { NewsletterSignup } from './NewsletterSignup'

/**
 * Lábléc — a régi koncepció-landing `kc-footer` nyelvén (egyszeri tükör, már
 * nincs a repóban): felül egy óriás, aláhúzott serif „Kapcsolat" link, mellette a
 * ritkított betűs wordmark (`kc-footer-mark`), alatta a meta-sor a jogi
 * linkekkel és a copyrighttal (`kc-footer-meta`). A korábbi navy sáv helyett a
 * lap-háttér (szerep-token: `--kc-color-surface`) viszi a láblécet, felül
 * hajszálvonallal — lásd styles/layout.css.
 *
 * A TARTALOM változatlan: minden korábbi link (jogi oldalak, ÁSZF, impresszum,
 * kapcsolati e-mail), a márkasor, a tagline és a copyright megmaradt; csak a
 * vizuális nyelv és az elrendezés újult meg. Az óriás „Kapcsolat" link a
 * meglévő /kapcsolat oldalra mutat (új cél nem került be).
 *
 * A linkek a legacy láblécből származnak (/adatvedelem, /aszf, /impresszum —
 * CMS-oldalslugok, a következő hullám oldalai). A configban jelenleg NINCS
 * settings global; ha megérkezik, ezt a konstanst az felülírhatja — addig is
 * EGY helyen kezelt.
 */
export const FOOTER_LEGAL_LINKS = [
  { href: '/adatvedelem', label: 'Adatkezelési és adatvédelmi szabályzat' },
  { href: '/aszf', label: 'Általános szerződési feltételek' },
  { href: '/impresszum', label: 'Impresszum' },
] as const

export const FOOTER_CONTACT_EMAIL = 'info@kineticare.hu'

export function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="kc-site-footer">
      <Container>
        <div className="kc-site-footer__grid">
          <div className="kc-site-footer__top">
            <Link className="kc-site-footer__link" href="/kapcsolat">
              Kapcsolat
            </Link>
            <div className="kc-site-footer__mark">
              <p className="kc-site-footer__brand">
                Kineti<span className="kc-site-footer__brand-accent">care</span>
              </p>
              <p className="kc-site-footer__tagline">Kézrehabilitációs online kurzusplatform</p>
            </div>
          </div>
          {/* C9 — hírlevél-feliratkozás. A lead-magnet a lábléc MÁSODLAGOS
              súlyú sávjában él (UX-skill 1. és 6. pont: az ingyenes ajánlat
              nem előzheti meg és nem nyomhatja el a fizetős kurzusokat), a
              jogi meta-sor FÖLÖTT. Aszinkron szerver-komponens: a form-builder
              űrlap azonosítóját maga oldja fel, és hiányában nem renderel. */}
          <NewsletterSignup />
          <div className="kc-site-footer__meta">
            <nav aria-label="Jogi és kapcsolat">
              <ul className="kc-site-footer__legal">
                {FOOTER_LEGAL_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
                <li>
                  {/* GDPR: a süti-hozzájárulás visszavonása/módosítása — a
                      ConsentBanner-t nyitja újra (kliens-komponens). */}
                  <ConsentSettingsButton />
                </li>
                <li className="kc-site-footer__contact">
                  Kapcsolat: <a href={`mailto:${FOOTER_CONTACT_EMAIL}`}>{FOOTER_CONTACT_EMAIL}</a>
                </li>
              </ul>
            </nav>
            <p className="kc-site-footer__copy">© {year} Kineticare, minden jog fenntartva</p>
          </div>
        </div>
      </Container>
    </footer>
  )
}
