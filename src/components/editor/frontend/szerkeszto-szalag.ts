import {
  describeSection,
  hiddenHint,
  REJTETT_CIM,
  REJTETT_MAGYARAZAT,
  sectionRepeatOrdinals,
  sectionRowLabelText,
  sectionSource,
  UGRAS_FELIRAT,
  visibleTwin,
} from '../../../lib/section-row-label'
import { ervenyesBlokkId, szekcioMelylink } from '../szekcio-melylink'

/**
 * A frontend „Szerkesztem” réteg adatai (modul-térkép A3, H09, H02, H29).
 *
 * Tiszta modul: React, Next és Payload nélkül. A szerver-oldali bemenetet (a
 * lap mentett dokumentumát és a `pageBlocks` blokk-katalógust) a hívó adja,
 * így a modul a route-okból és a tesztekből is ugyanúgy hívható.
 *
 * MIÉRT MÉLYLINK. A látott szekciótól a szerkesztő PONTOS sorához visz, a
 * Sanity overlays mintájára („Overlays appear on content elements, letting
 * the editor click any piece of content to jump directly to the corresponding
 * field”, https://www.sanity.io/docs/visual-editing/visual-editing-overlays),
 * a Drupal Contextual Links céljával („The user wants to change the
 * configuration of an object conveniently and without losing context”,
 * https://www.drupal.org/docs/develop/user-interface-standards/contextual-links).
 * Helyben szerkesztés nincs: a natív szerkesztő marad (piszkozat, verziók,
 * validálás), a link csak megjelenítés, a jogosultság a REST-en marad.
 *
 * A CÍMKE UGYANAZ, MINT AZ ADMINBAN (WCAG 2.2 SC 3.2.4 Consistent
 * Identification). A szöveget nem másoljuk: ugyanazt a kimenetet olvassuk,
 * amelyből a src/components/admin/SectionRowLabel.tsx dolgozik. A forrás
 *  - a `pageBlocks` elemeinek `admin.components.Label.clientProps`-a
 *    (`blockLabel`, `textFields`, a src/blocks/index.ts `withSectionAdmin`-ja
 *    teszi rá);
 *  - a src/lib/section-row-label.ts `describeSection`, `sectionRepeatOrdinals`
 *    és `sectionRowLabelText` függvénye;
 *  - a MENTETT dokumentum szekciósora és az EREDETI sorindex (piszkozat-
 *    előnézetben a legújabb piszkozaté). A megjelenítési átalakítás
 *    (`presentHomeLayout`) és a Tudástár-linkszűrő kimenete NEM forrás: az
 *    csak a látványt adja, a sorszám és a cím a mentett sorból jön.
 */

/** A link látható felirata. Az akadálymentes név ezzel kezdődik (WCAG 2.2 SC 2.5.3). */
export const SZERKESZTEM_FELIRAT = 'Szerkesztem'

/** A szekció horgonyának előtagja: `szekcio-<blokk-azonosító>`, csak piszkozat-előnézetben. */
export const HORGONY_ELOTAG = 'szekcio-'

/** H29: a rendelői árlista szerkezete nem ismerhető fel (a RenderBlocks felismerőjének eredménye). */
export const ARLISTA_NEM_ISMERHETO = 'Az árlista nem ismerhető fel, sima szövegként látszik.'

/**
 * H29: mit kell tenni, hogy árkártyák legyenek belőle. A src/lib/rendeloi-arlista.ts
 * felismerési szabályát mondja el: címsor a blokk elején, „Árlista” kezdetű
 * címsor, közvetlenül alatta 1–4 tételes lista. A tétel elválasztója lehet
 * kettőspont is, ezért a példa gondolatjel nélküli.
 */
export const ARLISTA_TEENDO =
  'Árkártyák akkor lesznek belőle, ha a szöveg címsorral kezdődik, és egy „Árlista” kezdetű címsor alatt közvetlenül egy lista áll, legfeljebb négy „50 perces alkalom: 18 000 Ft” alakú tétellel.'

/** Az oldal-szintű szalag címkéjének eleje. */
export const OLDAL_CIMKE_ELOTAG = 'Az egész oldal'

type Adat = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is Adat {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A blokktípus címke-forrása az admin sorcímkéjéhez (a Label clientProps-a). */
export interface CimkeForras {
  blockLabel: string
  textFields: readonly string[]
}

/**
 * A blokk-katalógusból (`pageBlocks`) blokktípusonként a sorcímke clientProps-a.
 * A bemenet `unknown`: a Payload `Block` típusában a clientProps `object`, ezért
 * mezőnként szűkítünk, és ami nem az elvárt alakú, az kimarad.
 */
export function cimkeForrasok(blokkok: readonly unknown[]): ReadonlyMap<string, CimkeForras> {
  const terkep = new Map<string, CimkeForras>()
  for (const blokk of blokkok) {
    if (!isRecord(blokk) || typeof blokk.slug !== 'string') {
      continue
    }
    const admin = isRecord(blokk.admin) ? blokk.admin : null
    const components = admin && isRecord(admin.components) ? admin.components : null
    const label = components && isRecord(components.Label) ? components.Label : null
    const props = label && isRecord(label.clientProps) ? label.clientProps : null
    if (!props) {
      continue
    }
    const blockLabel = typeof props.blockLabel === 'string' ? props.blockLabel : ''
    const textFields = Array.isArray(props.textFields)
      ? props.textFields.filter((mezo): mezo is string => typeof mezo === 'string')
      : []
    terkep.set(blokk.slug, { blockLabel, textFields })
  }
  return terkep
}

/** Egy szekció szalagjának adatai. */
export interface SzekcioSzalag {
  blokkId: string
  /** A mentett szekciósor 0-alapú indexe (az admin `#layout-row-<index>` sora). */
  sorIndex: number
  /** Betűre az admin sorcímkéje, pl. „05 · Szolgáltatás-sorok: Így tudunk segíteni”. */
  cimke: string
  rejtett: boolean
  /** `szekcioMelylink({ collection: 'pages', id, blokkId })`. */
  href: string
  /** A link vizuálisan rejtett folytatása: „: 05. szekció, Szolgáltatás-sorok, Így tudunk segíteni”. */
  rejtettKontextus: string
  /** `szekcio-<blokk-azonosító>`. */
  horgonyId: string
  /** Más gyűjteményből töltött szekció: a forrás rövid neve és a második link. */
  forras: { cim: string; link: { felirat: string; href: string } | null } | null
  /** Rejtett szekció magyarázata (a B tájékoztatójának szövegeivel), különben null. */
  rejtettMagyarazat: { cim: string; szoveg: string; teendo: string } | null
}

/** Egy szalag-link: látható felirat, vizuálisan rejtett folytatás, cél. */
export interface SzalagLink {
  felirat: string
  rejtettKontextus: string
  href: string
}

/** Az oldal-szintű szalag adatai (a lap tetején, a teljes oldal szerkesztője). */
export interface OldalSzalag {
  cimke: string
  linkek: readonly SzalagLink[]
}

/** A „Szerkesztem” réteg egy laphoz: oldal-szalag és blokk-azonosító → szekció-szalag. */
export interface SzerkesztoReteg {
  oldal: OldalSzalag
  szekciok: Readonly<Record<string, SzekcioSzalag>>
}

/** A lap mentett dokumentumának a réteghez szükséges része. */
export interface SzerkesztettLap {
  id: number | string
  slug?: string | null
  title?: string | null
  layout?: readonly unknown[] | null
}

export interface SzerkesztoRetegBemenet {
  lap: SzerkesztettLap
  /** A blokk-katalógus (`pageBlocks`), a címke-forrás. */
  blokkok: readonly unknown[]
  /** A Payload admin-útvonala, alapból `/admin`. */
  adminRoute?: string
}

function adminGyoker(adminRoute: string): string {
  const levagott = adminRoute.replace(/\/+$/, '')
  return levagott === '' ? '' : levagott.startsWith('/') ? levagott : `/${levagott}`
}

/** A link rejtett kontextusa: sorszám, rejtettség, típus és cím, vesszővel (WCAG 2.2 SC 2.4.4). */
function szekcioKontextus(
  sorszam: string,
  rejtett: boolean,
  tipus: string,
  cimSzoveg: string,
): string {
  return [`${sorszam}. szekció`, rejtett ? 'rejtett' : null, tipus, cimSzoveg]
    .filter((resz): resz is string => resz !== null)
    .join(', ')
}

/** A lap tetején álló szalag: a teljes oldal szerkesztője (blokk-azonosító nélkül). */
export function oldalSzalag({
  lap,
  adminRoute = '/admin',
}: {
  lap: SzerkesztettLap
  adminRoute?: string
}): OldalSzalag {
  const cim = typeof lap.title === 'string' ? lap.title.trim() : ''
  return {
    cimke: cim ? `${OLDAL_CIMKE_ELOTAG}: ${cim}` : OLDAL_CIMKE_ELOTAG,
    linkek: [
      {
        felirat: SZERKESZTEM_FELIRAT,
        rejtettKontextus: cim ? `: az egész oldal, ${cim}` : ': az egész oldal',
        href: szekcioMelylink({ adminRoute, collection: 'pages', id: lap.id }),
      },
    ],
  }
}

/** A tünet-hub szalagjának magyarázata: melyik dokumentum mit ad a laphoz. */
export const HUB_CIMKE =
  'Ennek a lapnak a szövegét a blogbejegyzésben írod, a keresőben megjelenő címét és leírását az oldalon.'

/** A hub két szerkesztője: a látható cikk (Blogbejegyzések) és a keresőadatok (Oldalak). */
export const HUB_BEJEGYZES_FELIRAT = 'Szerkesztem a blogbejegyzést'
export const HUB_OLDAL_FELIRAT = 'Szerkesztem az oldalt'

/**
 * A gyökér tünet-hub szalagja. A hubon a látható cikk és a JSON-LD a
 * blogbejegyzésből, a meta (cím, leírás) az oldalból jön (modul-térkép H05),
 * ezért két link kell, két KÜLÖN felirattal: azonos szövegű, más célú link
 * összetéveszthető (WCAG 2.2 SC 2.4.4, SC 3.2.4).
 */
export function hubSzalag({
  lap,
  bejegyzes,
  adminRoute = '/admin',
}: {
  lap: SzerkesztettLap
  bejegyzes: { id: number | string; title?: string | null }
  adminRoute?: string
}): OldalSzalag {
  const cikkCim = typeof bejegyzes.title === 'string' ? bejegyzes.title.trim() : ''
  const lapCim = typeof lap.title === 'string' ? lap.title.trim() : ''
  return {
    cimke: HUB_CIMKE,
    linkek: [
      {
        felirat: HUB_BEJEGYZES_FELIRAT,
        rejtettKontextus: cikkCim ? `: ${cikkCim}` : '',
        href: szekcioMelylink({ adminRoute, collection: 'posts', id: bejegyzes.id }),
      },
      {
        felirat: HUB_OLDAL_FELIRAT,
        rejtettKontextus: lapCim
          ? `: ${lapCim}, a keresőben megjelenő cím és leírás`
          : ': a keresőben megjelenő cím és leírás',
        href: szekcioMelylink({ adminRoute, collection: 'pages', id: lap.id }),
      },
    ],
  }
}

/**
 * A lap „Szerkesztem” rétege. A szekciók kulcsa a blokk-azonosító; az
 * azonosító nélküli (vagy nem 24 hexa jegyű) sor nem kap szalagot, mert arra
 * mélylink sem épülhet.
 */
export function szerkesztoReteg({
  lap,
  blokkok,
  adminRoute = '/admin',
}: SzerkesztoRetegBemenet): SzerkesztoReteg {
  const forrasok = cimkeForrasok(blokkok)
  const sorok = Array.isArray(lap.layout) ? lap.layout : []
  const ismetlesek = sectionRepeatOrdinals(sorok)
  const oldal = oldalSzalag({ lap, adminRoute })
  const admin = adminGyoker(adminRoute)
  const szekciok: Record<string, SzekcioSzalag> = {}
  sorok.forEach((sor, index) => {
    const blokkId = isRecord(sor) ? sor.id : undefined
    if (!ervenyesBlokkId(blokkId)) {
      return
    }
    const blockType = isRecord(sor) && typeof sor.blockType === 'string' ? sor.blockType : ''
    const forras = forrasok.get(blockType) ?? { blockLabel: blockType, textFields: [] }
    const leiras = {
      ...describeSection(sor, index, forras.blockLabel, forras.textFields),
      ismetles: ismetlesek[index] ?? null,
    }
    const forrasInfo = sectionSource(sor, lap.slug)
    szekciok[blokkId] = {
      blokkId,
      sorIndex: index,
      cimke: sectionRowLabelText(leiras),
      rejtett: leiras.rejtett,
      href: szekcioMelylink({ adminRoute, collection: 'pages', id: lap.id, blokkId }),
      rejtettKontextus: `: ${szekcioKontextus(leiras.sorszam, leiras.rejtett, leiras.tipus, leiras.cimSzoveg)}`,
      horgonyId: `${HORGONY_ELOTAG}${blokkId}`,
      forras: forrasInfo
        ? {
            cim: forrasInfo.cim,
            link: forrasInfo.hova
              ? {
                  felirat: `${UGRAS_FELIRAT}: ${forrasInfo.hova.nev}`,
                  href: `${admin}${forrasInfo.hova.adminPath}`,
                }
              : null,
          }
        : null,
      rejtettMagyarazat: leiras.rejtett
        ? {
            cim: REJTETT_CIM,
            szoveg: REJTETT_MAGYARAZAT,
            teendo: hiddenHint(visibleTwin(sor, index, sorok)),
          }
        : null,
    }
  })
  return { oldal, szekciok }
}

/** A szekció szalagja a réteg alapján, vagy null (nincs réteg, nincs azonosító, nincs ilyen sor). */
export function szekcioSzalagja(
  reteg: SzerkesztoReteg | null | undefined,
  blokkId: unknown,
): SzekcioSzalag | null {
  if (!reteg || typeof blokkId !== 'string') {
    return null
  }
  return Object.prototype.hasOwnProperty.call(reteg.szekciok, blokkId)
    ? (reteg.szekciok[blokkId] ?? null)
    : null
}
