import type { Metadata } from 'next'
import Link from 'next/link'

import { NotFoundView } from '@/components/error/NotFoundView'

import './(frontend)/styles.css'

/**
 * GLOBÁLIS „nem található" oldal — minden NEM ILLESZKEDŐ URL ide fut
 * MIÉRT NEM A TELJES `Header`/`Footer` VAN ITT
 */
export const metadata: Metadata = {
  creator: 'Barna Norbert',
  other: { 'creator-url': 'https://www.barnanorbert.com/' },
  title: 'Ez az oldal nem található | Kineticare',
  description:
    'A keresett oldal nem található a Kineticare oldalán. Innen tovább tudsz lépni a kurzusokra, a tudástárba vagy a kapcsolatfelvételhez.',
}

/**
 * Jogi linkek. A `Footer.FOOTER_LEGAL_LINKS`-szel egyező lista, de saját
 * konstansként: a lábléc modulja Payload-függő gyerekeket hoz magával (lásd
 * fent). Az egyezést őr-teszt védi (`src/__tests__/hibaoldal.test.tsx`).
 */
const LEGAL_LINKS = [
  { href: '/adatvedelem', label: 'Adatkezelési és adatvédelmi szabályzat' },
  { href: '/aszf', label: 'Általános szerződési feltételek' },
  { href: '/impresszum', label: 'Impresszum' },
] as const

export default function GlobalNotFound() {
  return (
    <html lang="hu">
      <body>
        <a className="kc-skip-link" href="#tartalom">
          Ugrás a tartalomra
        </a>
        <header className="kc-site-header">
          <div className="kc-container">
            <div className="kc-site-header__bar">
              {/* A hozzáférhető név BITRE a `Header.tsx`-é: ugyanaz az elem,
                  ugyanaz a név (WCAG 2.2 · 3.2.4). A korábbi „Kineticare —
                  kezdőlap" ráadásul U+2014-et tartalmazott, amit a magyar
                  mikroszöveg-szabályzat tilt (docs/ui-sztenderdek.md §3.1.1). */}
              <Link aria-label="Kineticare kezdőlap" className="kc-site-header__brand" href="/">
                Kineti<span className="kc-site-header__brand-accent">care</span>
              </Link>
            </div>
          </div>
        </header>
        <main id="tartalom">
          <NotFoundView />
        </main>
        <footer className="kc-site-footer">
          <div className="kc-container">
            <ul className="kc-error-frame__legal">
              {LEGAL_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        </footer>
      </body>
    </html>
  )
}
