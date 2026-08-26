import Link from 'next/link'

import { ctaLabel } from '../../../lib/cta-vocabulary'
import { sanitizeCmsUrl } from '../../../lib/safe-url'
import { Container } from '../../ui/Container'
import { Section } from '../../ui/Section'

import '../../../app/(frontend)/styles/blocks/creds-strip.css'

/**
 * CredentialsStrip — kondenzált szakmai hitel-csík (audit M2/K5).
 * A legerősebb bizalmi érvek (gyógytornász–manuálterapeuta háttér, sportolói/
 * olimpikoni bizalom, szakmai egyesületi tagság) egyetlen visszafogott csíkban,
 * a Rólunk oldalra mutató linkkel.
 * Két hívási mód:
 * - prop nélkül (rögzített kezdőlap): az audit által rögzített statikus tények,
 */

const CREDENTIALS: string[] = [
  'Gyógytornász és manuálterapeuta szakmai háttér',
  'Sportolók és olimpikonok is hozzánk fordulnak',
  'Szakmai egyesületi tagság',
]

/**
 * A csík alapértelmezett hivatkozása. A felirat a §3.2 #34 szótári sora: a
 * korábbi „Bővebben a szakmai hátterünkről" öt szó volt (M-3: legfeljebb négy),
 * nem igével kezdett, és a „Bővebben" a GOV.UK által kifejezetten kerülendő
 * általános linkszöveg magyar párja („avoid generic text like 'click here' or
 * 'more'").
 */
const DEFAULT_LINK: CredentialsLink = {
  label: ctaLabel('about-open'),
  href: '/rolunk',
}

export interface CredentialsLink {
  label: string
  href: string
  /** Külső linknél új lapon nyitás (target="_blank" + noopener). */
  newTab?: boolean
}

export interface CredentialsStripProps {
  /** Tétel-felülírás a CMS-ből; üresen/hiányozva a beépített tények jönnek. */
  items?: string[]
  /** `null` = nincs link; `undefined` = a beépített Rólunk-link. */
  link?: CredentialsLink | null
  id?: string
  variant?: 'default' | 'tint' | 'dark'
}

export function CredentialsStrip({
  items,
  link = DEFAULT_LINK,
  id,
  variant = 'default',
}: CredentialsStripProps = {}) {
  const credentials = items && items.length > 0 ? items : CREDENTIALS
  // A cél a `credsStrip` blokkból akár szabadon gépelt CMS-webcím is lehet,
  // ezért allowlist-szűrésen megy át (src/lib/safe-url.ts). Tiltott sémánál a
  // csík LINK NÉLKÜL renderelődik — a hitel-tételek megmaradnak.
  const safeHref = link ? sanitizeCmsUrl(link.href) : null
  const safeLink = link && safeHref ? { ...link, href: safeHref } : null
  // A nyíl dekoratív (a linket a felirat nevezi meg), ezért aria-hidden.
  const linkContent = safeLink ? (
    <>
      <span className="kc-text-link__label">{safeLink.label}</span>
      <span aria-hidden="true" className="kc-text-link__arrow">
        →
      </span>
    </>
  ) : null

  return (
    <Section className="kc-creds" flush id={id} variant={variant}>
      <Container>
        <div className="kc-creds__inner">
          <div className="kc-creds__items">
            {credentials.map((credential) => (
              <span className="kc-creds__item" key={credential}>
                <span aria-hidden="true" className="kc-creds__dot" />
                {credential}
              </span>
            ))}
          </div>
          {safeLink ? (
            safeLink.newTab ? (
              <a
                className="kc-text-link kc-creds__link"
                href={safeLink.href}
                rel="noopener noreferrer"
                target="_blank"
              >
                {linkContent}
              </a>
            ) : (
              <Link className="kc-text-link kc-creds__link" href={safeLink.href}>
                {linkContent}
              </Link>
            )
          ) : null}
        </div>
      </Container>
    </Section>
  )
}
