import type { CSSProperties } from 'react'
import type { AdminViewServerProps } from 'payload'
import Link from 'next/link'

import { hasStaffOrOwnerRole } from '../../access/roles'
import {
  EXTERNAL_ANALYTICS_LINKS,
  posthogEmbedUrl,
} from '../../lib/admin/web-analytics-config'
import { AdminChrome, AdminViewFrame } from './AdminChrome'

/**
 * Admin Webanalitika nézet (`/admin/webanalitika`).
 *
 * A tulajdonos kérése (2026-08-27): a munkatársaknak NE kelljen a PostHogba
 * belépniük és ott tájékozódniuk — a válogatott dashboard (Kineticare —
 * látogatók és érdeklődés) jelenjen meg az adminon belül, mellette pedig egy
 * helyen legyenek a külső elemző-felületek linkjei (GA4, Search Console,
 * Google Ads, PostHog).
 *
 * A beágyazás a PostHog MEGOSZTOTT dashboard-linkjén át megy (iframe). A
 * megosztott link jelszó nélkül, a link birtokában megnyitható — a dashboard
 * ezért KIZÁRÓLAG összesített viselkedés-adatot mutat (látogatószám, oldalak,
 * források, tölcsér), személyes adatot nem. A vásárlás- és haladás-SZÁMOK a
 * Statisztika oldalon élnek, az adatbázisból — ugyanaz a mérőszám sosem jön
 * két forrásból (docs/statisztika-audit-2026-08-21.md 4. szakasz).
 *
 * A Payload custom view NYILVÁNOS admin-route, ezért a szerver-oldali
 * szerepkör-kapu az egyetlen védelem (a BunnyLibraryView mintája).
 */

const pageStyle: CSSProperties = {
  padding: 'calc(var(--base) * 1.5)',
  maxWidth: '80rem',
}

const leadStyle: CSSProperties = {
  color: 'var(--theme-elevation-650)',
  maxWidth: '42rem',
}

/**
 * A külső linkek sora. A célfelület legalább 44 px magas (a repó saját
 * célértéke, docs/ui-sztenderdek.md §3), a linkek új lapon nyílnak — az admin
 * munkamenetét nem hagyjuk el.
 */
const toolLinkStyle: CSSProperties = {
  alignItems: 'center',
  border: '1px solid var(--theme-elevation-150)',
  borderRadius: '4px',
  color: 'var(--theme-text)',
  display: 'inline-flex',
  minHeight: '44px',
  padding: '0 calc(var(--base) * 0.75)',
  textDecoration: 'none',
}

export const WEB_ANALYTICS_ACCESS_DENIED_MESSAGE =
  'A Webanalitikát csak munkatárs vagy tulajdonos nézheti meg.'

export function WebAnalyticsView(props: AdminViewServerProps) {
  const { req } = props.initPageResult
  if (!hasStaffOrOwnerRole(req.user)) {
    return (
      <AdminViewFrame props={props}>
        <div style={pageStyle}>
          <h1 style={{ marginTop: 0 }}>Webanalitika</h1>
          <p>{WEB_ANALYTICS_ACCESS_DENIED_MESSAGE}</p>
        </div>
      </AdminViewFrame>
    )
  }

  const embedUrl = posthogEmbedUrl()

  return (
    <AdminChrome props={props}>
      <div style={pageStyle}>
        <h1 style={{ marginTop: 0 }}>Webanalitika</h1>
        <p style={leadStyle}>
          Az oldal látogatóinak viselkedése: hányan járnak nálunk, mit olvasnak, honnan jönnek, és
          hol akad el az érdeklődés. A vásárlások darabszáma és a vevők kurzus-haladása a{' '}
          <Link href="/admin/statisztika" prefetch={false}>
            Statisztika
          </Link>{' '}
          oldalon él: ott az adatbázis a forrás, az a pontos.
        </p>
        <nav aria-label="Külső elemző-felületek">
          <ul
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'calc(var(--base) * 0.5)',
              listStyle: 'none',
              margin: 'calc(var(--base) * 0.75) 0',
              padding: 0,
            }}
          >
            {EXTERNAL_ANALYTICS_LINKS.map((tool) => (
              <li key={tool.href}>
                <a href={tool.href} rel="noopener noreferrer" style={toolLinkStyle} target="_blank">
                  {tool.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {embedUrl ? (
          <iframe
            src={embedUrl}
            style={{
              border: '1px solid var(--theme-elevation-150)',
              borderRadius: '4px',
              height: '90rem',
              width: '100%',
            }}
            title="Kineticare — látogatók és érdeklődés (PostHog dashboard)"
          />
        ) : (
          <div
            style={{
              border: '1px solid var(--theme-elevation-150)',
              borderRadius: '4px',
              maxWidth: '42rem',
              padding: 'calc(var(--base) * 1)',
            }}
          >
            <h2 style={{ marginTop: 0 }}>A beágyazott dashboard még nincs bekötve</h2>
            <p>
              A PostHogban a „Kineticare — látogatók és érdeklődés” dashboardon kapcsold be a
              megosztást (Share gomb), majd a kapott linket állítsd be a Railway-en a{' '}
              <code>POSTHOG_SHARED_DASHBOARD_URL</code> változóba. A következő indulás után a
              dashboard itt jelenik meg.
            </p>
          </div>
        )}
      </div>
    </AdminChrome>
  )
}

export default WebAnalyticsView
