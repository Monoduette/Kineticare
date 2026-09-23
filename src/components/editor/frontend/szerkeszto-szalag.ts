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
import { COURSE_SHOWCASE_MARK } from '../../../lib/course-showcase'
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

// ---------------------------------------------------------------------------
// „Kódban van” szalagok (modul-térkép H09 1. pont, H21, H35, H18)
// ---------------------------------------------------------------------------

/**
 * A NEM szekció modulok szalagja: a lapon látható elem, amely nincs a
 * Szekciók között (fejléc, lábléc, a kezdőlapi Barion-sáv, a /kurzusok és a
 * /blog lapfeje). A szalag kimondja, honnan jön a modul, és ha van része,
 * amely az adminban szerkeszthető, oda visz.
 *
 * MIÉRT KELL. A szerkesztő a piszkozat-előnézetben minden szekció fölött
 * szalagot lát; ahol nincs, ott joggal hiszi, hogy a modul nem létezik az
 * adminban, vagy hogy elrontott valamit. A rendszer mondja meg, mi történik
 * (NN/g, Visibility of System Status: „The design should always keep users
 * informed about what is going on”,
 * https://www.nngroup.com/articles/visibility-system-status/). A Sanity
 * vizuális szerkesztője is csak a CMS-ből jövő elemre tesz kattintható
 * overlay-t, a kódbeli elem ott nem kínál szerkesztést
 * (https://www.sanity.io/docs/visual-editing/visual-editing-overlays), a
 * Drupal kontextuális linkje pedig mindig a tényleges szerkesztő helyre visz
 * (https://www.drupal.org/docs/develop/user-interface-standards/contextual-links).
 * Mi a kettőt összekötjük: a kódbeli részt szöveg mondja ki, a CMS-részre link visz.
 *
 * NINCS „Szerkesztem” LINK A KÓDBELI RÉSZEN. A felirat legyen igaz
 * (termektervezes skill, 2. pont): kódbeli modulnál a „Szerkesztem” hamis
 * ígéret volna. A más helyen szerkeszthető részre a meglévő forrás-link
 * felirata visz, BETŰRE ugyanúgy, mint a szekció-szalagok második linkje
 * (`Ugrás oda, ahol szerkeszted: Kurzusok`, section-row-label.ts
 * UGRAS_FELIRAT): azonos célhoz azonos felirat (WCAG 2.2 SC 3.2.4
 * Consistent Identification), a látható szöveg az akadálymentes név elején
 * (SC 2.5.3 Label in Name), és ahol a felirat önmagában kevés, vizuálisan
 * rejtett folytatás pontosít (SC 2.4.4 Link Purpose, C7 technika).
 *
 * A JELZÉS SZÖVEG, NEM SZÍN (SC 1.4.1): a címke a „Kódban van” vagy a
 * „Részben kódban van” szóval zárul.
 *
 * MINDEN ÁLLÍTÁS A KÓDBÓL IGAZOLVA (a forrássorok a jelentésben):
 * - Barion-sáv: src/components/checkout/BarionFizetesJelzes.tsx (a cím a
 *   Barion elfogadóhelyi jóváhagyásának szó szerinti kérése, a logósort
 *   „módosítás nélkül” kell kiszolgálni, az MNB-engedélyszám az ÁSZF-ből).
 * - Fejléc: src/components/layout/Header.tsx (a logó kódban), a menü a
 *   Menüpontokból (src/lib/menus.ts getNavTree), a „Kurzusok” menüpontot a
 *   kód teszi az első helyre, ha a Menüpontok között nincs `/kurzusok` célú
 *   gyökér-menüpont (src/lib/menu-tree.ts withCoursesNavItem), a fiók ikonja
 *   kódban (AccountNav).
 * - Lábléc: src/components/layout/Footer.tsx (a szlogen, a jogi linkek és a
 *   felépítés kódban), a hírlevél-doboz címe és bevezetője a
 *   NewsletterForm.tsx-ben (nem az Űrlapokban), a kapcsolati e-mail a
 *   Kapcsolat oldal első látható Időpontkérés szekciójának E-mail-cím mezője,
 *   a KÖZZÉTETT változatból (src/lib/contact-email-server.ts).
 * - /kurzusok: a cím és a bevezető a route-ban, a kártyák fölötti cím, a
 *   „Kurzusaink” felirat és a kártyák alatti mondat a course-showcase.ts
 *   állandói (a route nem ad át CMS-szöveget), a kártyák a Kurzusokból.
 * - /blog: a „Tudástár” cím és a bevezető a route-ban (LEAD), a cikkek a
 *   Blogbejegyzésekből, a szűrő gombjai és a szűrt nézet címe a Kategóriákból
 *   (PostListFilter.tsx).
 */
export interface KodSzalag {
  /** Rövid címke: a modul neve és a „Kódban van” / „Részben kódban van” jelzés. */
  cimke: string
  /** Legfeljebb három rövid mondat: mi van kódban, és mit hol írsz át. */
  magyarazat: string
  /** A más helyen szerkeszthető részek linkjei; kódbeli modulnál üres. */
  linkek: readonly SzalagLink[]
}

/** A teljesen kódbeli modul jelzése a címke végén. */
export const KODBAN_VAN = 'Kódban van'

/** A vegyes (kód + CMS) modul jelzése a címke végén. */
export const RESZBEN_KODBAN_VAN = 'Részben kódban van'

/** A Barion-sáv címe; betűre a BarionFizetesJelzes.tsx `BARION_CIM`-je (őr: kodban-van-szalag.test.tsx). */
export const BARION_SAV_NEV = 'Bankkártyás fizetés Barionnal'

/** A Kurzuskártyák blokk neve; betűre a src/blocks/course-cards.ts `labels.singular`-ja (őr a tesztben). */
export const KURZUSKARTYAK_BLOKK_NEV = 'Kurzuskártyák (automatikus)'

/** Az Időpontkérés blokk neve; betűre a src/blocks/appointment.ts `labels.singular`-ja (őr a tesztben). */
export const IDOPONTKERES_BLOKK_NEV = 'Időpontkérés'

/** A kapcsolati e-mail mezőjének címkéje a blokkban (src/blocks/appointment.ts `label`). */
export const EMAIL_MEZO_NEV = 'E-mail-cím'

function kodCimke(nev: string, jelzes: string): string {
  return `${nev} · ${jelzes}`
}

/** Általános építő: a hívó adja a három részt. */
export function kodSzalag({ cimke, magyarazat, linkek }: KodSzalag): KodSzalag {
  return { cimke, magyarazat, linkek: [...linkek] }
}

/** A forrás-link a szekció-szalagok második linkjének feliratával (SC 3.2.4). */
function forrasLink(nev: string, href: string, rejtettKontextus = ''): SzalagLink {
  return { felirat: `${UGRAS_FELIRAT}: ${nev}`, rejtettKontextus, href }
}

/** A kezdőlapi Barion-sáv szalagja. Link nincs: a sáv minden része kódban van. */
export function barionSavSzalag(): KodSzalag {
  return kodSzalag({
    cimke: kodCimke(BARION_SAV_NEV, KODBAN_VAN),
    magyarazat:
      'Ezt a sávot a weboldal kódja adja, az adminban nem szerkeszthető. A címét és a logósort a Barion elfogadóhelyi előírása köti, az engedélyszám az ÁSZF-fel egyezik. Ha változtatnál rajta, szólj a fejlesztőnek.',
    linkek: [],
  })
}

/** A fejléc szalagja: a menü a Menüpontokból, a többi a kódból. */
export function fejlecSzalag({ adminRoute = '/admin' }: { adminRoute?: string } = {}): KodSzalag {
  return kodSzalag({
    cimke: kodCimke('Fejléc', RESZBEN_KODBAN_VAN),
    magyarazat:
      'A menüpontokat a Menüpontok között írod át. A logó és a fiók ikonja a weboldal kódjában van, és a kód a Kurzusok menüpontot is az első helyre teszi, ha a menüben nincs a Kurzusok oldalra vivő főmenüpont.',
    linkek: [
      forrasLink('Menüpontok', `${adminGyoker(adminRoute)}/collections/menus`, ', a fejléc menüje'),
    ],
  })
}

/**
 * A lábléc szalagja. A kapcsolati e-mail link célja a hívótól jön
 * (`kapcsolatIdopontSzerkesztoHref`); hiányában az Oldalak listája.
 */
export function lablecSzalag({
  adminRoute = '/admin',
  kapcsolatIdopontHref,
}: { adminRoute?: string; kapcsolatIdopontHref?: string } = {}): KodSzalag {
  const kontextus = `, ${IDOPONTKERES_BLOKK_NEV} szekció, ${EMAIL_MEZO_NEV} mező`
  return kodSzalag({
    cimke: kodCimke('Lábléc', RESZBEN_KODBAN_VAN),
    magyarazat: `A kapcsolati e-mail-címet a Kapcsolat oldal ${IDOPONTKERES_BLOKK_NEV} szekciójában, az „${EMAIL_MEZO_NEV}” mezőben írod át, és a lábléc a közzététel után mutatja. A szlogen, a hírlevél-doboz szövege, a jogi linkek és a lábléc felépítése a weboldal kódjában van.`,
    linkek: [
      kapcsolatIdopontHref
        ? forrasLink('Kapcsolat oldal', kapcsolatIdopontHref, kontextus)
        : forrasLink(
            'Oldalak',
            `${adminGyoker(adminRoute)}/collections/pages`,
            `, a Kapcsolat oldal${kontextus}`,
          ),
    ],
  })
}

/** Melyik lista-oldal lapfeje. */
export type ListaOldal = 'kurzusok' | 'tudastar'

/** A /kurzusok és a /blog lapfejének szalagja. */
export function listaFejSzalag(
  melyik: ListaOldal,
  { adminRoute = '/admin' }: { adminRoute?: string } = {},
): KodSzalag {
  const admin = adminGyoker(adminRoute)
  if (melyik === 'kurzusok') {
    return kodSzalag({
      cimke: kodCimke('Kurzusok oldal', RESZBEN_KODBAN_VAN),
      magyarazat: `A lap címe, a bevezető, a kártyák fölötti cím, a „${COURSE_SHOWCASE_MARK}” felirat és a kártyák alatti mondat a weboldal kódjában van, a kezdőlapi „${KURZUSKARTYAK_BLOKK_NEV}” szekció mezői ezt a lapot nem változtatják. A kurzus nevét, árát és borítóképét a Kurzusoknál írod át.`,
      linkek: [forrasLink('Kurzusok', `${admin}/collections/products`)],
    })
  }
  return kodSzalag({
    cimke: kodCimke('Tudástár oldal', RESZBEN_KODBAN_VAN),
    magyarazat:
      'A „Tudástár” cím és a bevezető mondat a weboldal kódjában van. A cikkeket a Blogbejegyzéseknél írod át, a szűrő gombjai és a szűrt nézet címe a Kategóriákból jönnek.',
    linkek: [forrasLink('Blogbejegyzések', `${admin}/collections/posts`)],
  })
}

/**
 * A Kapcsolat oldal ELSŐ LÁTHATÓ Időpontkérés blokkjának azonosítója, vagy
 * null. Ugyanaz a szabály, mint a kapcsolati e-mail feloldójában
 * (src/lib/contact-email.ts `kapcsolatiEmailLayoutbol`: az első
 * `appointment` blokk, amelynek `sectionSettings.visible` nem `false`), így a
 * link oda visz, ahonnan a lábléc a címet veszi.
 */
export function elsoLathatoIdopontkeresId(layout: unknown): string | null {
  if (!Array.isArray(layout)) {
    return null
  }
  for (const blokk of layout) {
    if (!isRecord(blokk) || blokk.blockType !== 'appointment') {
      continue
    }
    const beallitas = isRecord(blokk.sectionSettings) ? blokk.sectionSettings : null
    if (beallitas && beallitas.visible === false) {
      continue
    }
    return ervenyesBlokkId(blokk.id) ? blokk.id : null
  }
  return null
}

/**
 * A lábléc e-mail-linkjének célja: a Kapcsolat oldal első látható
 * Időpontkérés szekciója (mélylink); ha ilyen nincs, a Kapcsolat oldal
 * szerkesztője; ha az oldal sincs meg, `undefined` (a lábléc-szalag ekkor az
 * Oldalak listájára visz).
 */
export function kapcsolatIdopontSzerkesztoHref({
  lap,
  adminRoute = '/admin',
}: {
  lap: { id: number | string; layout?: readonly unknown[] | null } | null
  adminRoute?: string
}): string | undefined {
  if (!lap) {
    return undefined
  }
  return szekcioMelylink({
    adminRoute,
    collection: 'pages',
    id: lap.id,
    blokkId: elsoLathatoIdopontkeresId(lap.layout),
  })
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
