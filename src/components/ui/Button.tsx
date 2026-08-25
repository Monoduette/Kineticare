import Link from 'next/link'
import type { ReactNode } from 'react'

import { sanitizeCmsUrl } from '../../lib/safe-url'

/**
 * Button — a storefront elsődleges akcióeleme.
 *
 * A vizuális nyelv a régi koncepció-landingé (a stílus az
 * `src/app/(frontend)/styles/ui.css`-ben él, minden szín szerep-tokenről):
 * - variant:
 *     'primary'   — akcent-mély kitöltés fehér szöveggel (5,45:1 — AA), alap
 *     'secondary' — 2px-es ink keret átlátszó háttéren, a hover invertál
 *                   (a landing `kc-sos-cta` nyelve); sötét sávon fehér keret
 *     'ghost'     — aláhúzott szöveglink-jelleg (a landing `kc-inline-link`)
 * - size: 'md' (alap) | 'sm' — az érintési célfelület mindkettőben ≥ 44px
 * - href: megadva linkként renderel (belső útvonalhoz next/link, külsőhöz <a>);
 *   nélküle <button>
 * - disabled: letiltott állapot (gombként valódi disabled; linkként aria-disabled
 *   + tabindex -1 + osztály, a href ilyenkor nem navigál)
 * - type: a <button> type-ja (alap 'button' — űrlapban 'submit'-re állítható)
 *
 * A fókusz-állapotot a globális :focus-visible szabály kezeli (lásd base.css);
 * sötét szekcióban a gyűrű fehérre vált (ui.css, .kc-section--dark).
 *
 * LETILTOTT ÁLLAPOT: a jelölés NEM áttetszőség, hanem szándékos token-pár
 * (ui.css `.kc-button:disabled`) — a felirat olvasható marad (7,08:1). A
 * letiltás OKÁT mindig ki kell mondani a gomb mellett, és a magyarázatot a
 * `describedBy`-jal a gombra kell kötni (W3C ARIA APG button-minta:
 * https://www.w3.org/WAI/ARIA/apg/patterns/button/). Ahol a letiltás a
 * felhasználó által ORVOSOLHATÓ hiányból fakad (pl. kipipálatlan nyilatkozat),
 * ott a gombot NEM tiltjuk le: a natív `disabled` kiesik a Tab-sorrendből,
 * tehát a billentyűzetes látogató meg sem találja, hogy elolvassa a
 * magyarázatot. Ilyenkor a gomb aktív marad, a beküldést pedig validáció fogja
 * meg, világos magyar hibaüzenettel — a GOV.UK gomb-útmutatója ugyanezt
 * ajánlja (https://design-system.service.gov.uk/components/button/).
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
