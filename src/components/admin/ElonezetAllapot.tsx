'use client'

import { useConfig, useDocumentInfo, useTranslation } from '@payloadcms/ui'
import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'

import { DocAuditLink } from './DocAuditLink'

/**
 * Közzétételi állapot a szerkesztő tetején (Oldalak, Blogbejegyzések): mi
 * látszik most a lapon, és hogyan lehet visszalépni.
 *
 * Miért kell: az automatikus mentés CSAK piszkozatot ír, a lap a közzétett
 * verziót mutatja tovább (Payload Drafts: a piszkozat-mentésnél „the main
 * collection document remains unchanged”, https://payloadcms.com/docs/versions/drafts).
 * A core ezt egy kis szürke „Megváltozott” szóval jelzi. Az NN/g első
 * heurisztikája: „systems should always keep users informed about what is
 * going on” (https://www.nngroup.com/articles/visibility-system-status/).
 *
 * A három állapot PONTOSAN a core Status elemének logikája
 * (@payloadcms/ui dist/elements/Status/index.js): van közzé nem tett
 * verzió ÉS van közzétett → „változott”; nincs közzétett → „piszkozat”;
 * különben „közzétéve”. Állapotonként egy címsor és egy mondat. Egy fogalom,
 * egy szó (WCAG 2.2 SC 3.2.4): a core „verzió”-nak hívja (Verziók fül, „A
 * verzió visszaállítása” gomb), a doboz is ezt a szót használja.
 *
 * Akadálymentesség: a doboz mountkor NEM élő régió (nincs role="alert"; a
 * GOV.UK Notification banner is csak sikerüzenetnél fókuszál,
 * https://design-system.service.gov.uk/components/notification-banner/). Egy
 * mountkor üres, láthatatlan role="status" régió csak ÁLLAPOTVÁLTOZÁSKOR kapja
 * meg az új állapot címét (WCAG 2.2 SC 4.1.3,
 * https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html). A jelentést
 * a szöveg mondja ki, a szín csak kiegészítő (SC 1.4.1). Stílus: a B1
 * `.kc-admin-notice` szerződése, saját szín nélkül.
 *
 * A „Korábbi verziók és visszaállítás” link a core verziólistájára visz. A
 * visszaállítás a TELJES dokumentumot hozza vissza a választott verzióra (a
 * szekció eltávolítása a core-ban megerősítés nélküli, ez a visszaút hozzá;
 * NN/g: „Do go to great lengths to provide undo”,
 * https://www.nngroup.com/articles/confirmation-dialog/). A szövegek a
 * Payload 3.88 forrásából és mérésből jönnek, mindkét verziótípusra igazak:
 * - A „Visszaállítás piszkozatként” csak KÖZZÉTETT verziónál létezik
 *   (@payloadcms/next dist/views/Version/Restore/index.js:46:
 *   `canRestoreAsDraft = status !== 'draft' && …`), ezért a doboz nem ajánlja;
 *   a megerősítő ablak (version:aboutToRestore) a cselekvés helyén mondja el.
 * - A fő gomb („A verzió visszaállítása”, POST …/versions/<id>?draft=false) a
 *   verzió állapotát a fő dokumentumba írja (payload dist/collections/
 *   operations/restoreVersion.js:206: `result._status = draftArg ? 'draft' :
 *   result._status`, :207-215 updateOne). Piszkozat verzió visszaállítása után
 *   a lap tehát piszkozat, a weboldalon nem látszik.
 * - A hasPublishedDoc a fő dokumentum MOSTANI állapota (@payloadcms/next
 *   dist/views/Document/getVersions.js:48-77: a doc `_status`-a, különben egy
 *   `_status: 'published'` szűrésű find ugyanarra az azonosítóra), nem a múlt.
 *   Ezért a „piszkozat” állapot címe „Nincs közzétéve.”: új lapon, a
 *   közzététel visszavonása után és piszkozat verzió visszaállítása után is
 *   igaz, a „sosem volt közzétéve” viszont az utóbbi kettőn hamis lenne.
 * Mérve 2026-09-23, helyi példányon, eldobható, közzétett oldalon (a B vezető
 * meres3 átvételi mérése, a végén törölve, 0 maradt): egy autosave-piszkozat
 * után a piszkozat verzió nézetében nincs „Visszaállítás piszkozatként”, a
 * közzétettében van; a fő gomb a piszkozat verzión 200-at ad, utána az anonim
 * GET /api/pages?where[slug][equals]=<webcím> 0 találat, a lap 404, a doboz
 * „piszkozat” állapotú; a közzététel visszavonása után ugyanígy 0 és 404.
 * Eldobható blogbejegyzésen ugyanez (GET /api/posts 0 találat, /blog/<webcím>
 * 404; a B3 3. javító körének mérése, törölve, 0 maradt). Az állítást a
 * src/__tests__/oldal-szerkeszto-tajekoztatas.test.tsx readFileSync-es őre
 * a három forrássorhoz köti.
 */

export type KozzetetelAllapot = 'kozzeteve' | 'valtozott' | 'piszkozat'

export function kozzetetelAllapot(
  hasPublishedDoc: boolean,
  unpublishedVersionCount: number,
): KozzetetelAllapot {
  if (unpublishedVersionCount > 0 && hasPublishedDoc) return 'valtozott'
  if (!hasPublishedDoc) return 'piszkozat'
  return 'kozzeteve'
}

export interface AllapotSzoveg {
  cim: string
  szoveg: string
}

/**
 * Az állapot szövege. A gomb nevét a core fordításából kapja
 * (`version:publishChanges`), így betűre egyezik a gombbal (WCAG 3.2.4).
 */
export function allapotSzoveg(allapot: KozzetetelAllapot, kozzeteszGomb: string): AllapotSzoveg {
  if (allapot === 'valtozott') {
    return {
      cim: 'Van közzé nem tett módosításod.',
      szoveg: `A látogatók még a legutóbb közzétett verziót látják: az Előnézettel megnézheted, a „${kozzeteszGomb}” gombbal közzéteszed.`,
    }
  }
  if (allapot === 'piszkozat') {
    return {
      cim: 'Nincs közzétéve.',
      szoveg: `A látogatók nem látják: az Előnézettel megnézheted, a „${kozzeteszGomb}” gombbal teszed közzé.`,
    }
  }
  return {
    cim: 'Közzétéve, nincs közzé nem tett módosítás.',
    szoveg: 'A látogatók pontosan ezt a verziót látják.',
  }
}

export const VALTOZATOK_FELIRAT = 'Korábbi verziók és visszaállítás'

/**
 * A visszaállítás két mondata, mindkét verziótípusra igaz (a fejléc forrás-
 * sorai és mérése szerint). A „Visszaállítás piszkozatként” szándékosan
 * nincs benne: piszkozat verziónál nem létezik
 * (next/dist/views/Version/Restore/index.js:46, canRestoreAsDraft), a fő gomb
 * pedig piszkozat verziónál a fő dokumentumot is piszkozattá teszi
 * (payload/dist/collections/operations/restoreVersion.js:206, _status), így a
 * lap 404-et ad, amíg közzé nem teszik. A második mondat ezt a
 * következményt és a visszautat mondja ki; a gomb nevét a core fordításából
 * kapja (`version:publishChanges`), így betűre egyezik a gombbal (SC 3.2.4).
 * „Újra” nincs benne: egy sosem közzétett lap verziói mind piszkozatok, ott
 * az „újra közzéteszed” hamis előfeltevés volna (az A-1 mérése, a core
 * version.aboutToRestore fordítása is így mondja).
 */
export function visszaallitasMondat(
  collectionSlug: string | undefined,
  kozzeteszGomb: string,
): string {
  const [mi, mit, egyseg] =
    collectionSlug === 'pages'
      ? ['a lap', 'az oldal', 'szekcióval']
      : ['a blogbejegyzés', 'a blogbejegyzés', 'bekezdéssel']
  return (
    `Innen ${mit} korábbi verzióját egészben visszaállíthatod, egy véletlenül törölt ${egyseg} együtt. ` +
    `Piszkozat verzió visszaállítása után ${mi} nem látszik a weboldalon, amíg a „${kozzeteszGomb}” gombbal közzé nem teszed.`
  )
}

export function valtozatokHref(
  adminRoute: string,
  collectionSlug: string,
  id: number | string,
): string {
  return `${adminRoute.replace(/\/+$/, '')}/collections/${collectionSlug}/${String(id)}/versions`
}

/** Láthatatlan, de felolvasható élő régió (a szokásos „visually hidden” minta). */
const REJTETT: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

export interface ElonezetAllapotViewProps {
  allapot: KozzetetelAllapot
  kozzeteszGomb: string
  valtozatokUrl: string
  collectionSlug: string | undefined
  bejelentes: string
  auditLink?: JSX.Element | null
}

export function ElonezetAllapotView({
  allapot,
  kozzeteszGomb,
  valtozatokUrl,
  collectionSlug,
  bejelentes,
  auditLink = null,
}: ElonezetAllapotViewProps): JSX.Element {
  const { cim, szoveg } = allapotSzoveg(allapot, kozzeteszGomb)
  const modosito = allapot === 'valtozott' ? ' kc-admin-notice--figyelem' : ''
  return (
    <div className={`kc-admin-notice${modosito} kc-elonezet-allapot`} data-allapot={allapot}>
      <p className="kc-admin-notice__cim">{cim}</p>
      <p className="kc-admin-notice__szoveg">{szoveg}</p>
      <p className="kc-admin-notice__szoveg">
        {visszaallitasMondat(collectionSlug, kozzeteszGomb)}
      </p>
      <ul className="kc-admin-notice__linkek">
        <li>
          <a href={valtozatokUrl}>{VALTOZATOK_FELIRAT}</a>
        </li>
        {auditLink}
      </ul>
      <p role="status" style={REJTETT}>
        {bejelentes}
      </p>
    </div>
  )
}

export function ElonezetAllapot(): JSX.Element | null {
  const { id, collectionSlug, hasPublishedDoc, unpublishedVersionCount, isTrashed } =
    useDocumentInfo()
  const { config } = useConfig()
  const { t } = useTranslation()
  const allapot = kozzetetelAllapot(Boolean(hasPublishedDoc), unpublishedVersionCount ?? 0)
  const kozzeteszGomb = t('version:publishChanges')

  // Mountkor NINCS bejelentés; csak ha az állapot a lapon maradva megváltozik
  // (automatikus mentés, közzététel, visszavonás).
  const [bejelentes, setBejelentes] = useState('')
  const elozo = useRef<KozzetetelAllapot | null>(null)
  useEffect(() => {
    if (elozo.current !== null && elozo.current !== allapot) {
      setBejelentes(allapotSzoveg(allapot, kozzeteszGomb).cim)
    }
    elozo.current = allapot
  }, [allapot, kozzeteszGomb])

  if (id === undefined || id === null || !collectionSlug || isTrashed) {
    return null
  }
  return (
    <ElonezetAllapotView
      allapot={allapot}
      auditLink={<DocAuditLink />}
      bejelentes={bejelentes}
      collectionSlug={collectionSlug}
      kozzeteszGomb={kozzeteszGomb}
      valtozatokUrl={valtozatokHref(config.routes.admin, collectionSlug, id)}
    />
  )
}
