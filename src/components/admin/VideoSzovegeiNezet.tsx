import type { AdminViewServerProps } from 'payload'
import { redirect } from 'next/navigation'

import { hasStaffOrOwnerRole } from '../../access/roles'
import { szekcioMelylink } from '../editor/szekcio-melylink'
import { AdminChrome } from './AdminChrome'
import {
  KezdolapElutasitas,
  KezdolapFigyelem,
  KezdolapHibaNezet,
  KezdolapOldal,
  OLDALAK_LINK_FELIRAT,
  adminUtvonal,
  kezdolapCelNezethez,
} from './KezdolapNezet'
import { ADMIN_UTAK, adminCim } from './KezdolapCel'

/**
 * Admin „Kezdőlapi videó szövegei” nézet (`/admin/kezdolap-video`).
 *
 * A tulajdonos kérése (2026-09-22) szó szerint: „létre kell hozni az
 * adminisztrációs felületen egy olyan modult vagy menüpontot, ahol a videón
 * lévő szövegeket lehet szerkeszteni”. A menüpont ide visz; a nézet a
 * kezdőlap szerkesztőjébe irányít a nyitó videó szekció mélylinkjével
 * (`?szekcio=<blokk-azonosító>`), ahol a globális mélylink-nyitó
 * (src/components/editor/admin/SzekcioMegnyito.tsx) kinyitja a szekciót és a
 * Fő cím mezőre teszi a fókuszt. Egy kattintás bármely admin-oldalról.
 *
 * Miért nem külön űrlap (a vezető (b) döntése): a natív szerkesztő megtartja
 * a piszkozatot, a közzétételt, a verziókat, a dokumentumzárat és a
 * validálást; egy külön űrlapnak a teljes szekció-tömböt kellene
 * visszaírnia, ami automatikus mentés mellett adatvesztést kockáztat. A
 * Drupal ugyanezért tartotta meg a „szerkesztő-űrlapot megnyitó” kontextuális
 * linket, miközben a helyben szerkesztést kivezette
 * (https://www.drupal.org/node/3227039).
 *
 * A kapu és a hibaágak a KezdolapNezet mintáját követik (nyilvános útvonal,
 * a szerepkör-kapu a lekérdezés előtt fut).
 */

export const VIDEO_SZOVEGEI_CIM = ADMIN_UTAK.videoSzovegei.felirat

export const VIDEO_SZOVEGEI_ELUTASITAS =
  'A kezdőlapi videó szövegeit csak munkatárs vagy tulajdonos szerkesztheti.'

export const NINCS_NYITO_VIDEO_CIM = 'Figyelem: a kezdőlapon nincs nyitó videó'
export const NINCS_NYITO_VIDEO =
  'A videó szövegeit a „Nyitó videó (kéznyitás)” szekcióban írod, de ez a szekció most nincs a kezdőlapon.'
export const NINCS_NYITO_VIDEO_TEENDO =
  'Nyisd meg a kezdőlap szerkesztőjét, és a Szekciók lista alján add hozzá a „Nyitó videó (kéznyitás)” szekciót, majd húzd a lista elejére.'
export const KEZDOLAP_SZERKESZTO_FELIRAT = 'Kezdőlap szerkesztése'

export async function VideoSzovegeiNezet(props: AdminViewServerProps) {
  const { req } = props.initPageResult
  if (!hasStaffOrOwnerRole(req.user)) {
    return (
      <KezdolapElutasitas
        props={props}
        cim={VIDEO_SZOVEGEI_CIM}
        uzenet={VIDEO_SZOVEGEI_ELUTASITAS}
        visszaUtvonal={ADMIN_UTAK.videoSzovegei.utvonal}
      />
    )
  }

  const cel = await kezdolapCelNezethez(props, 'kezdolap-video')
  if (cel === null || cel.allapot === 'nincs-kezdolap') {
    return <KezdolapHibaNezet props={props} cim={VIDEO_SZOVEGEI_CIM} cel={cel} />
  }

  const adminRoute = adminUtvonal(props)
  if (!cel.vanNyitoVideo) {
    return (
      <AdminChrome props={props} title={VIDEO_SZOVEGEI_CIM}>
        <KezdolapOldal cim={VIDEO_SZOVEGEI_CIM}>
          <KezdolapFigyelem
            cim={NINCS_NYITO_VIDEO_CIM}
            szovegek={[NINCS_NYITO_VIDEO, NINCS_NYITO_VIDEO_TEENDO]}
            linkek={[
              {
                href: szekcioMelylink({ adminRoute, collection: 'pages', id: cel.oldalId }),
                felirat: KEZDOLAP_SZERKESZTO_FELIRAT,
              },
              { href: adminCim(adminRoute, '/collections/pages'), felirat: OLDALAK_LINK_FELIRAT },
            ]}
          />
        </KezdolapOldal>
      </AdminChrome>
    )
  }

  redirect(
    szekcioMelylink({
      adminRoute,
      collection: 'pages',
      id: cel.oldalId,
      blokkId: cel.nyitoVideoBlokkId,
    }),
  )
}

export default VideoSzovegeiNezet
