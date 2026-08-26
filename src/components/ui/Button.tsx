import Link from 'next/link'
import type { ReactNode } from 'react'

import { sanitizeCmsUrl } from '../../lib/safe-url'

/**
 * Button — a storefront elsődleges akcióeleme.
 * LETILTOTT ÁLLAPOT: a jelölés NEM áttetszőség, hanem szándékos token-pár
 * ott a gombot NEM tiltjuk le: a natív `disabled` kiesik a Tab-sorrendből,
 */

export interface ButtonProps {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'md' | 'sm'
  href?: string
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
  /**
   * Az `aria-describedby` célja: a gomb MELLETT álló magyarázó szöveg
   * azonosítója (pl. „mi hiányzik még a fizetéshez"). Kötelező mindenütt, ahol
   * a gomb letiltott vagy a beküldés feltételhez kötött.
   */
  describedBy?: string
  /** Csak <button>-rendernél értelmezett. */
  onClick?: () => void
  /**
   * Új lapon nyitás (target="_blank" + noopener) — belső és külső href-re is
   * érvényes: a CMS linkmezők „Új lapon nyíljon" kapcsolója ide fut be, és a
   * szerkesztő döntése akkor sem veszhet el némán, ha az útvonal belső.
   */
  openInNewTab?: boolean
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  href,
  disabled = false,
  type = 'button',
  className,
  describedBy,
  onClick,
  openInNewTab = false,
}: ButtonProps) {
  // A gomb célja gyakran CMS-tartalom (szekció-blokkok CTA-mezői), ezért a
  // href allowlist-szűrésen megy át (src/lib/safe-url.ts): tiltott sémánál
  // (`javascript:` és társai) a gomb LETILTOTT állapotban, href nélkül jelenik
  // meg — a felirat így nem tűnik el, de a link nem kattintható. A saját,
  // rendszer-generált útvonalak (`/kurzusok`, `#ingyenes`, `/penztar?termek=1`)
  // változatlanul átmennek.
  const safeHref = sanitizeCmsUrl(href)
  // A megjelenés a TÉNYLEGES állapotot kövesse: a kiszűrt cél ugyanúgy
  // letiltott gomb, mint az explicit `disabled` — különben aktívnak látszana
  // egy olyan elem, amire kattintva nem történik semmi.
  const isDisabled = disabled || (Boolean(href) && safeHref === null)

  const described = describedBy === undefined ? {} : { 'aria-describedby': describedBy }

  const classes = [
    'kc-button',
    `kc-button--${variant}`,
    size === 'sm' ? 'kc-button--sm' : '',
    isDisabled ? 'kc-button--disabled' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  if (safeHref && !disabled) {
    if (/^https?:\/\//i.test(safeHref)) {
      return (
        <a
          className={classes}
          href={safeHref}
          {...described}
          {...(openInNewTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {children}
        </a>
      )
    }
    return (
      <Link
        className={classes}
        href={safeHref}
        {...described}
        {...(openInNewTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {children}
      </Link>
    )
  }

  if (href) {
    return (
      <span className={classes} aria-disabled="true" {...described}>
        {children}
      </span>
    )
  }

  return (
    <button className={classes} disabled={disabled} onClick={onClick} type={type} {...described}>
      {children}
    </button>
  )
}
