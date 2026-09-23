import type { CSSProperties, ReactNode } from 'react'
import type { AdminViewServerProps } from 'payload'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { hasStaffOrOwnerRole } from '../../access/roles'
import { logger } from '../../lib/logger'
import { szekcioMelylink } from '../editor/szekcio-melylink'
import { AdminChrome, AdminViewFrame } from './AdminChrome'
import {
  ADMIN_UTAK,
  adminCim,
  kezdolapCelFeloldasa,
  payloadKezdolapLekerdezo,
  type KezdolapCel,
} from './KezdolapCel'

/**
 * Admin „Kezdőlap” nézet (`/admin/kezdolap`): stabil, beszédes cím, amely a
 * kezdőlap szerkesztőjébe visz (admin-audit K32, R1 §2).
 *
 * Miért átirányító nézet, és nem egy beégetett `/admin/collections/pages/1`
 * link: az oldal azonosítója telepítésenként más lehet, a slug (`kezdolap`)
 * viszont a frontend szerződése. A WCAG 2.2 SC 2.4.5 (Multiple Ways) szerint
 * egy lapnak több úton kell elérhetőnek lennie; eddig csak az Oldalak lista
 * 2. oldala vezetett ide
 * (https://www.w3.org/WAI/WCAG22/Understanding/multiple-ways.html).
 *
 * VÉDELEM. A Payload 3.88 a saját nézeteket nyilvános admin-útvonalként
 * kezeli („All Custom Views are public by default. It's up to you to secure
 * your custom views.”, https://payloadcms.com/docs/custom-components/custom-views),
 * ezért a szerepkör-kapu a lekérdezés ELŐTT fut, és be nem jelentkezett vagy
 * vásárlói fiók se azonosítót, se tartalmat nem kap (a StatisticsView mintája,
 * őr: src/__tests__/admin-kezdolap-utak.test.tsx).
 *
 * ÁTIRÁNYÍTÁS. A `next/navigation` `redirect()` a szerver-komponens
 * renderelésekor 307-es választ ad; a Payload maga is így irányít át a
 * nézeteiben (@payloadcms/next/dist/views/Root/index.js). A hívás a
 * try/catch-en KÍVÜL áll, mert a Next a `redirect()`-et kivétellel jelzi.
 */

const pageStyle: CSSProperties = {
  padding: 'calc(var(--base) * 1.5)',
  maxWidth: '64rem',
}

export const KEZDOLAP_CIM = ADMIN_UTAK.kezdolap.felirat

/** Anonim és vásárlói fióknak: se azonosító, se tartalom. */
export const KEZDOLAP_ELUTASITAS =
  'A kezdőlap szerkesztőjét csak munkatárs vagy tulajdonos nyithatja meg.'

export const KEZDOLAP_HIANYZIK_CIM = 'Figyelem: nincs kezdőlap'
export const KEZDOLAP_HIANYZIK =
  'Egyik oldal webcíme sem „kezdolap”, pedig a webhely nyitólapja ebből az oldalból épül fel.'
export const KEZDOLAP_HIANYZIK_TEENDO =
  'Nyisd meg az Oldalak listát, keresd meg a kezdőlapot, és a Webcím mezőbe írd vissza: kezdolap. Ha a kezdőlapot törölték, szólj a fejlesztőnek.'

export const KEZDOLAP_NEM_ELERHETO_CIM = 'Figyelem: a kezdőlap most nem nyitható meg'
export const KEZDOLAP_NEM_ELERHETO =
  'Az adatbázis nem válaszolt. Próbáld újra pár perc múlva, vagy nyisd meg a kezdőlapot az Oldalak listából.'

export const OLDALAK_LINK_FELIRAT = 'Oldalak listája'
export const BELEPES_LINK_FELIRAT = 'Belépés'

/** A nézet címe és a Payload admin-útvonala (config.routes.admin). */
export function adminUtvonal(props: AdminViewServerProps): string {
  return props.initPageResult.req.payload.config.routes.admin
}

/** A két belépési nézet közös kerete: cím és tartalom. */
export function KezdolapOldal({ cim, children }: { cim: string; children: ReactNode }) {
  return (
    <div style={pageStyle}>
      <h1 style={{ marginTop: 0 }}>{cim}</h1>
      {children}
    </div>
  )
}

/**
 * Figyelmeztető doboz a B1 stílusszerződésével (.kc-admin-notice--figyelem,
 * src/app/(payload)/custom.scss 9. szakasz: mindkét témán mért AA-kontraszt).
 */
export function KezdolapFigyelem({
  cim,
  szovegek,
  linkek,
}: {
  cim: string
  szovegek: readonly string[]
  linkek: ReadonlyArray<{ href: string; felirat: string }>
}) {
  return (
    <div className="kc-admin-notice kc-admin-notice--figyelem">
      <p className="kc-admin-notice__cim">{cim}</p>
      {szovegek.map((szoveg) => (
        <p className="kc-admin-notice__szoveg" key={szoveg}>
          {szoveg}
        </p>
      ))}
      <ul className="kc-admin-notice__linkek">
        {linkek.map((link) => (
          <li key={link.href}>
            <Link href={link.href} prefetch={false}>
              {link.felirat}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Elutasítás szerepkör nélkül. Be nem jelentkezett látogató a belépésre kap
 * linket, amely a belépés után ugyanide hozza vissza (a Payload belépő
 * nézetének `redirect` paramétere); vásárlói fiók csak a magyarázatot.
 */
export function KezdolapElutasitas({
  props,
  cim,
  uzenet,
  visszaUtvonal,
}: {
  props: AdminViewServerProps
  cim: string
  uzenet: string
  visszaUtvonal: string
}) {
  const adminRoute = adminUtvonal(props)
  const user = props.user ?? props.initPageResult.req.user
  const belepes = `${adminCim(adminRoute, '/login')}?redirect=${encodeURIComponent(
    adminCim(adminRoute, visszaUtvonal),
  )}`
  return (
    <AdminViewFrame props={props} title={cim}>
      <KezdolapOldal cim={cim}>
        <p>{uzenet}</p>
        {user ? null : (
          <p>
            <Link href={belepes} prefetch={false}>
              {BELEPES_LINK_FELIRAT}
            </Link>
          </p>
        )}
      </KezdolapOldal>
    </AdminViewFrame>
  )
}

/**
 * A kezdőlap feloldása a nézetekhez. Hibánál naplóz, és null-t ad: a nézet
 * ilyenkor magyar üzenetet mutat, nem 500-at.
 */
export async function kezdolapCelNezethez(
  props: AdminViewServerProps,
  nezet: string,
): Promise<KezdolapCel | null> {
  try {
    return await kezdolapCelFeloldasa(payloadKezdolapLekerdezo(props.initPageResult.req))
  } catch (error) {
    logger.error('admin-kezdőlapnézet: a kezdőlap nem oldható fel', {
      nezet,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/** Hiba- és hiányüzenetek a két nézetben (admin-keretben, a felhasználónak). */
export function KezdolapHibaNezet({
  props,
  cim,
  cel,
}: {
  props: AdminViewServerProps
  cim: string
  cel: KezdolapCel | null
}) {
  const oldalak = {
    href: adminCim(adminUtvonal(props), '/collections/pages'),
    felirat: OLDALAK_LINK_FELIRAT,
  }
  return (
    <AdminChrome props={props} title={cim}>
      <KezdolapOldal cim={cim}>
        {cel === null ? (
          <KezdolapFigyelem
            cim={KEZDOLAP_NEM_ELERHETO_CIM}
            szovegek={[KEZDOLAP_NEM_ELERHETO]}
            linkek={[oldalak]}
          />
        ) : (
          <KezdolapFigyelem
            cim={KEZDOLAP_HIANYZIK_CIM}
            szovegek={[KEZDOLAP_HIANYZIK, KEZDOLAP_HIANYZIK_TEENDO]}
            linkek={[oldalak]}
          />
        )}
      </KezdolapOldal>
    </AdminChrome>
  )
}

export async function KezdolapNezet(props: AdminViewServerProps) {
  const { req } = props.initPageResult
  if (!hasStaffOrOwnerRole(req.user)) {
    return (
      <KezdolapElutasitas
        props={props}
        cim={KEZDOLAP_CIM}
        uzenet={KEZDOLAP_ELUTASITAS}
        visszaUtvonal={ADMIN_UTAK.kezdolap.utvonal}
      />
    )
  }

  const cel = await kezdolapCelNezethez(props, 'kezdolap')
  if (cel === null || cel.allapot === 'nincs-kezdolap') {
    return <KezdolapHibaNezet props={props} cim={KEZDOLAP_CIM} cel={cel} />
  }

  redirect(
    szekcioMelylink({ adminRoute: adminUtvonal(props), collection: 'pages', id: cel.oldalId }),
  )
}

export default KezdolapNezet
