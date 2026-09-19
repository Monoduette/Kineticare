import { ConsentSettingsButton } from '../analytics/ConsentSettingsButton'
import { Container } from '../ui/Container'
import { BRAND_LOGO_ALT, BRAND_LOGO_HORIZONTAL } from '../../lib/brand-logo'

import { FooterPageLink } from './FooterPageLink'
import { NewsletterSignup } from './NewsletterSignup'

/**
 * Lábléc — a régi koncepció-landing `kc-footer` nyelvén (egyszeri tükör, már
 * nincs a repóban): felül egy óriás, aláhúzott serif „Kapcsolat" link, mellette
 * a márkajel, alatta a meta-sor a jogi linkekkel és a copyrighttal
 * (`kc-footer-meta`). A korábbi navy sáv helyett a lap-háttér (szerep-token:
 * `--kc-color-surface`) viszi a láblécet, felül hajszálvonallal — lásd
 * styles/layout.css.
 *
 * WP49 (2026-09-19): a ritkított szöveges wordmark helyén a tulajdonosok új,
 * vízszintes logója áll (a fejléccel azonos SVG, színes változat, mert a
 * lábléc világos, `--kc-color-surface` = paper hátterű). Nem link: a
 * kezdőlapra a fejléc logója visz, a láblécben a jel csak azonosít (NN/g,
 * Footers 101: a lábléc-logó nem kötelezően kattintható, a navigációt a
 * linkek adják; https://www.nngroup.com/articles/footers/).
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
            <FooterPageLink className="kc-site-footer__link" href="/kapcsolat">
              Kapcsolat
            </FooterPageLink>
            <div className="kc-site-footer__mark">
              {/* eslint-disable-next-line @next/next/no-img-element -- SVG-logó bitre azonosan, next/image nélkül (src/lib/brand-logo.ts) */}
              <img
                alt={BRAND_LOGO_ALT}
                className="kc-site-footer__logo"
                height={BRAND_LOGO_HORIZONTAL.height}
                src={BRAND_LOGO_HORIZONTAL.src}
                width={BRAND_LOGO_HORIZONTAL.width}
              />
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
                    <FooterPageLink href={link.href}>{link.label}</FooterPageLink>
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
