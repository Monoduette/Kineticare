import type { CSSProperties } from 'react'
import Link from 'next/link'

import { WEB_STATS_PERIODS, type WebStatsPeriodDays } from '../../../lib/admin/posthog-web-stats'

/**
 * Időszak-választó a látogatói számok fölött: két sima link, mert a választás
 * új adatot tölt, és az URL-be kerül (könyvjelzőzhető, megosztható, a vissza
 * gomb is működik). A kiválasztott link `aria-current="page"`-et kap (WAI-ARIA
 * 1.2, aria-current: https://www.w3.org/TR/wai-aria-1.2/#aria-current), és
 * nem csak színnel tér el: kitöltött háttér és félkövér betű jelzi
 * (WCAG 2.2 SC 1.4.1). A GOV.UK is linkként, nem gombként kezeli a
 * nézetváltást, ha az új oldalt tölt
 * (https://design-system.service.gov.uk/components/button/: „do not use the
 * button component for links”).
 *
 * Méret és kontraszt (mérve, custom.scss tokenjei):
 * - a célfelület legalább 44 × 44 px (docs/ui-sztenderdek.md §3; WCAG 2.2
 *   SC 2.5.8 minimuma 24 px);
 * - a kijelölt link fehér szövege az akcenten világosban 4,70:1, sötétben a
 *   --kc-as-surface-raised az akcenten 6,61:1 (SC 1.4.3);
 * - a nem kijelölt link kerete a --kc-as-hairline-strong (3,91:1 / 5,97:1,
 *   SC 1.4.11).
 */

export const PERIOD_LABEL = 'Időszak:'

export function periodHref(days: WebStatsPeriodDays): string {
  return `/admin/webanalitika?idoszak=${days}`
}

const rowStyle: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--kc-as-space-2, calc(var(--base) * 0.5))',
  marginBottom: 'var(--kc-as-space-4, calc(var(--base) * 1))',
}

const listStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--kc-as-space-2, calc(var(--base) * 0.5))',
  listStyle: 'none',
  margin: 0,
  padding: 0,
}

const linkBaseStyle: CSSProperties = {
  alignItems: 'center',
  border: '1px solid var(--kc-as-hairline-strong)',
  borderRadius: 'var(--kc-as-radius-md)',
  display: 'inline-flex',
  justifyContent: 'center',
  minHeight: '44px',
  minWidth: '44px',
  padding: '0 calc(var(--base) * 0.75)',
}

/* A kijelölt link színe inline: ez a jelenlegi oldal, a hover-színnek itt
   nincs dolga, a háttér és a súly viszont mindig látszik. */
const linkActiveStyle: CSSProperties = {
  ...linkBaseStyle,
  background: 'var(--kc-as-accent)',
  borderColor: 'var(--kc-as-accent)',
  color: 'var(--kc-as-surface-raised)',
  fontWeight: 700,
  textDecoration: 'none',
}

export function PeriodSwitch({ current }: { current: WebStatsPeriodDays }) {
  return (
    <div aria-labelledby="kc-wa-idoszak" role="group" style={rowStyle}>
      <span id="kc-wa-idoszak">{PERIOD_LABEL}</span>
      <ul style={listStyle}>
        {WEB_STATS_PERIODS.map((days) => {
          const active = days === current
          return (
            <li key={days}>
              <Link
                aria-current={active ? 'page' : undefined}
                href={periodHref(days)}
                prefetch={false}
                style={active ? linkActiveStyle : linkBaseStyle}
              >
                {`${days} nap`}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
