import Link from 'next/link'
import type { Payload } from 'payload'

import { hasStaffOrOwnerRole, type RoleUser } from '../../access/roles'
import { logger } from '../../lib/logger'
import { FigyelmetIgenyel } from './FigyelmetIgenyel'
import { ADMIN_UTAK, adminCim, KEZDOLAP_SLUG } from './KezdolapCel'
import './GyakoriTeendok.css'

/**
 * „Gyakori teendők” panel az Irányítópult tetején (admin.components.
 * beforeDashboard, admin-audit K32).
 *
 * A PROBLÉMA (mérve, admin-audit séta t1): az Irányítópulton csak a 16
 * általános gyűjtemény-kártya állt, feladat-belépési pont nélkül; a kezdőlapot
 * a szerkesztő nem találta meg (a „kezdolap” keresés 0 találat, a lista 2.
 * oldalán volt).
 *
 * A MEGOLDÁS: 6 nagy, egy mondattal magyarázott feladat-link, a leggyakoribb
 * szerkesztői feladatok szerint. Források (megnyitva, 2026-09-22):
 * - NN/g, Homepage Design: 5 Fundamental Principles, 4.2: „Begin by
 *   identifying a list of top tasks. Use hierarchy and visual weight to draw
 *   attention to your prioritized tasks.”
 *   https://www.nngroup.com/articles/homepage-design-principles/
 * - NN/g, Memory Recognition and Recall in User Interfaces: „making
 *   information and interface functions visible and easily accessible”
 *   https://www.nngroup.com/articles/recognition-and-recall/
 * - WCAG 2.2 SC 2.4.5 Multiple Ways (G125, kapcsolódó oldalakra mutató
 *   linkek): https://www.w3.org/WAI/WCAG22/Understanding/multiple-ways.html
 *
 * A KÁRTYA CÍME a cél oldalsáv-nevével KEZDŐDIK (WCAG 2.2 SC 3.2.4
 * Consistent Identification: „If identical functions have different labels
 * […] the site will be considerably more difficult to use”, és ugyanoda
 * mutató linkeknél „best practice is to have identical text”,
 * https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html):
 * - a saját nézetek kártyája (Kezdőlap, videószövegek, Statisztika) az
 *   ADMIN_UTAK feliratát kapja, amelyet az oldalsáv linkje is használ;
 * - a gyűjteményre mutató kártya a gyűjtemény oldalsáv-nevét olvassa a
 *   szerver-propként kapott szanitált configból (`labels.plural`, ugyanaz a
 *   forrás, amelyből az oldalsáv dolgozik: @payloadcms/ui/dist/utilities/
 *   groupNavItems.js), legfeljebb egy folytatással („Kurzusok és árak”). A
 *   konstans cím csak tartalék, ha a címke nem szöveg; egyezését a config
 *   címkéjével teszt őrzi (admin-kezdolap-utak.test.tsx).
 * A leírás egy E/2-es mondat arról, mit csinálsz ott (docs/ui-sztenderdek.md
 * P-1e). A link hozzáférhető neve csak a cím, a leírás `aria-describedby`-jal
 * kapcsolódik, így a képernyőolvasó linklistája rövid marad; a teljes kártya
 * kattintható (a cím linkje kiterjesztett célfelülettel).
 *
 * SZEREPKÖR: a panel csak munkatársnak és tulajdonosnak jelenik meg, és csak
 * azokat a feladatokat mutatja, amelyek gyűjteményét a felhasználó olvashatja
 * (a Payload szanitált jogosultságai). Ez megjelenítés; a védelem a
 * gyűjteményekben és a nézetekben van. A tulajdonos a kártyák előtt a
 * „Figyelmet igényel" blokkot is látja (`FigyelmetIgenyel.tsx`).
 *
 * A kártyák alatt a panel a fő oldalak gyorslinkjeit is mutatja
 * (`FoOldalakGyorslinkjei`, lent); ugyanez a komponens áll az Oldalak lista
 * fölött is.
 */

export interface GyakoriTeendo {
  /** DOM-azonosító-rész (a leírás `aria-describedby` célja). */
  kulcs: string
  /**
   * A kártya címe. Gyűjteményre mutató kártyánál csak tartalék: a megjelenő
   * cím a gyűjtemény oldalsáv-nevéből épül (`cimAGyujtemenybol`).
   */
  cim: string
  /**
   * Ha van: a cím a `gyujtemeny` oldalsáv-neve (a config `labels.plural`-ja),
   * utána ez a folytatás (pl. „ és árak”).
   */
  cimAGyujtemenybol?: { folytatas: string }
  leiras: string
  /** Útvonal az admin-útvonal alatt. */
  utvonal: string
  /** A gyűjtemény, amelynek olvasási joga kell; null: elég a munkatársi szerepkör. */
  gyujtemeny: string | null
}

export const GYAKORI_TEENDOK_CIM = 'Gyakori teendők'

export const GYAKORI_TEENDOK: readonly GyakoriTeendo[] = [
  {
    kulcs: 'kezdolap',
    cim: ADMIN_UTAK.kezdolap.felirat,
    leiras: 'Szerkeszd a kezdőlap szekcióit: szövegek, képek, gombok és a sorrendjük.',
    utvonal: ADMIN_UTAK.kezdolap.utvonal,
    gyujtemeny: 'pages',
  },
  {
    kulcs: 'video-szovegei',
    cim: ADMIN_UTAK.videoSzovegei.felirat,
    leiras:
      'Írd át a nyitó videón látható fő címet, bevezetőt, címkéket, gombokat és a két beúszó feliratot.',
    utvonal: ADMIN_UTAK.videoSzovegei.utvonal,
    gyujtemeny: 'pages',
  },
  {
    kulcs: 'kurzusok',
    cim: 'Kurzusok és árak',
    cimAGyujtemenybol: { folytatas: ' és árak' },
    leiras: 'Módosítsd a kurzusok leírását, árát és akcióját.',
    utvonal: '/collections/products',
    gyujtemeny: 'products',
  },
  {
    kulcs: 'menu',
    cim: 'Menüpontok',
    cimAGyujtemenybol: { folytatas: '' },
    leiras: 'Állítsd be az oldal tetején látszó menüpontokat és a sorrendjüket.',
    utvonal: '/collections/menus',
    gyujtemeny: 'menus',
  },
  {
    kulcs: 'urlapok',
    cim: 'Űrlapbeküldések',
    cimAGyujtemenybol: { folytatas: '' },
    leiras:
      'Olvasd el a beérkezett kapcsolatfelvételeket, időpontkéréseket és hírlevél-feliratkozásokat.',
    utvonal: '/collections/form-submissions',
    gyujtemeny: 'form-submissions',
  },
  {
    kulcs: 'statisztika',
    cim: ADMIN_UTAK.statisztika.felirat,
    leiras: 'Nézd meg a havi bevételt és a kurzusok haladását.',
    utvonal: ADMIN_UTAK.statisztika.utvonal,
    gyujtemeny: null,
  },
]

/** A Payload szanitált jogosultságainak az a része, amit a panel olvas. */
export interface GyakoriTeendokJogok {
  collections?: Readonly<Record<string, { read?: boolean } | undefined>>
}

/** A szanitált config gyűjteményeinek az a része, amit a panel olvas. */
export type GyakoriTeendokGyujtemenyek = ReadonlyArray<{
  slug: string
  labels?: { plural?: unknown }
}>

/**
 * A Payload szerver-propjainak az a része, amit a panel és a fő oldalak
 * gyorslinkje olvas (az Irányítópult és a lista is ezeket adja át:
 * @payloadcms/next/dist/views/Dashboard/Default/index.js,
 * views/List/index.js `serverProps`). A `find` a Local API.
 */
export interface GyakoriTeendokProps {
  payload: Pick<Payload, 'find'> & {
    config: { routes: { admin: string }; collections?: GyakoriTeendokGyujtemenyek }
  }
  permissions?: GyakoriTeendokJogok | null
  user?: RoleUser | null
}

/**
 * A gyűjtemény oldalsáv-neve a configból (`labels.plural`), ha nem üres
 * szöveg; különben null (pl. fordítási objektum vagy függvény esetén).
 */
export function gyujtemenyOldalsavNeve(
  gyujtemenyek: GyakoriTeendokGyujtemenyek | null | undefined,
  slug: string,
): string | null {
  const nev = gyujtemenyek?.find((gyujtemeny) => gyujtemeny.slug === slug)?.labels?.plural
  return typeof nev === 'string' && nev.trim() !== '' ? nev : null
}

/** A kártya megjelenő címe: gyűjteménynél az oldalsáv-névvel kezdődik (SC 3.2.4). */
export function teendoCime(
  teendo: GyakoriTeendo,
  gyujtemenyek: GyakoriTeendokGyujtemenyek | null | undefined,
): string {
  if (teendo.cimAGyujtemenybol && teendo.gyujtemeny !== null) {
    const nev = gyujtemenyOldalsavNeve(gyujtemenyek, teendo.gyujtemeny)
    if (nev !== null) {
      return `${nev}${teendo.cimAGyujtemenybol.folytatas}`
    }
  }
  return teendo.cim
}

/** A felhasználónak megjelenő feladatok (szerepkör és olvasási jog szerint). */
export function lathatoTeendok(
  user: RoleUser | null | undefined,
  permissions: GyakoriTeendokJogok | null | undefined,
): GyakoriTeendo[] {
  if (!hasStaffOrOwnerRole(user)) {
    return []
  }
  return GYAKORI_TEENDOK.filter(
    (teendo) =>
      teendo.gyujtemeny === null || permissions?.collections?.[teendo.gyujtemeny]?.read === true,
  )
}

// ---------------------------------------------------------------------------
// A fő oldalak gyorslinkje (modul-térkép H08, R1 §2)
// ---------------------------------------------------------------------------

/**
 * A PROBLÉMA (mérve a helyi adatbázisban, 2026-09-23): az Oldalak lista minden
 * sort az oldal Címével mutat, és ez a fő oldalaknál más, mint a menüben
 * látható név. A kezdolap sora „Hatékony és biztonságos módszerek…”, a rolunk
 * sora „A kéz a mindenünk”, a szolgaltatasok sora „A kezed folyton
 * dolgozik…”, így a listából nem derül ki, melyik sor melyik oldal.
 *
 * A MEGOLDÁS: egy linklista a menüben látható névvel, mellette az oldal saját
 * Címével, hogy a lista sorával is összekapcsolható legyen. Ugyanez az egy
 * komponens áll az Irányítópult panelján és az Oldalak lista fölött
 * (admin.components.beforeListTable, a Pages.ts-be a B-2 köti be). Források
 * (megnyitva, 2026-09-23):
 * - NN/g, Memory Recognition and Recall in User Interfaces: a felismerést
 *   segíti, ha az információt „visible and easily accessible” módon mutatjuk,
 *   és „contextual tips tailored to the page” adunk, ahelyett hogy a
 *   szerkesztőnek fejben kellene párosítania a menünevet és a Címet.
 *   https://www.nngroup.com/articles/recognition-and-recall/
 * - NN/g, Homepage Design: 5 Fundamental Principles, 4.2: „The most crucial
 *   tasks should be visually prominent.” Ezért az Irányítópulton a lista a
 *   hat feladatkártya UTÁN, kisebb vizuális súllyal áll (keret és kártya
 *   nélkül), a Kezdőlap és a videó kártyája marad elöl.
 *   https://www.nngroup.com/articles/homepage-design-principles/
 * - NN/g, A Lesson on Top Tasks: „Top tasks are activities that users must
 *   be able to do with a product.” A fő oldalak szerkesztése ilyen feladat.
 *   https://www.nngroup.com/articles/top-tasks/
 * - WCAG 2.2 SC 2.4.5 Multiple Ways (G125, kapcsolódó oldalakra mutató
 *   linkek): a szerkesztő a listán kívül innen is eléri az oldalt.
 *   https://www.w3.org/WAI/WCAG22/Understanding/multiple-ways.html
 * - WCAG 2.2 SC 2.4.4 Link Purpose (In Context): a link neve a menünév, a
 *   „Cím: …” ugyanabban a listaelemben áll, ez programból kiolvasható
 *   környezet; a leírás `aria-describedby`-jal is kapcsolódik.
 *   https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html
 * - WCAG 2.2 SC 3.2.4 Consistent Identification: a Kezdőlap linkje az
 *   oldalsáv „Kezdőlap” linkjével azonos nevű és célú (ADMIN_UTAK),
 *   „best practice is to have identical text”.
 *   https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html
 * - WCAG 2.2 SC 2.5.8 Target Size (Minimum): a link doboza legalább 24 CSS px
 *   magas (GyakoriTeendok.css).
 *   https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
 *
 * LEKÉRDEZÉS: EGY Local API-hívás slug alapján (`slug in […]`), a kérés
 * felhasználójának jogaival (`overrideAccess: false`), a legújabb változaton
 * (`draft: true`, mint az Oldalak lista), `depth: 0`, csak a cím és a webcím
 * mezővel. Az azonosító így új telepítésen és visszaállítás után is a
 * valódi. A lekérdező injektálható (src/__tests__/admin-kezdolap-utak.test.tsx),
 * hálózati kérést nem küld.
 *
 * JELÖLÉS: a linkcsoport `<nav>` tájékozódási pont a címével (aria-labelledby),
 * mert navigációs linkek csoportja. Az Oldalak listán a Payload a táblázatot és
 * a lista-előtti elemeket tájékozódási ponton kívül rajzolja (nincs <main>),
 * így a <nav> nélkül az axe `region` szabálya ezt az elemet is jelezné (mérve).
 *
 * MIT NEM CSINÁL: nem ír adatot, nem küld fetch-et, új útvonalat és
 * jogosultságot nem vezet be. Csak munkatárs és tulajdonos látja, ha az
 * Oldalakat olvashatja; ez megjelenítés, a védelem a gyűjteményben van.
 */

export interface FoOldal {
  /** Az oldal webcíme (pages.slug): ez alapján keressük meg. */
  slug: string
  /** A név, amelyet a látogató a weboldal menüjében lát. */
  nev: string
  /**
   * Saját admin-útvonal a szerkesztő helyett. Csak a Kezdőlapnál: ugyanaz a
   * cél, mint az oldalsáv „Kezdőlap” linkjéé (SC 3.2.4).
   */
  sajatUtvonal?: string
}

/**
 * A fő oldalak a weboldal menüjének sorrendjében. A nevek a menüpontok
 * feliratai (mérve 2026-09-23: a helyi menus tábla Kezdőlap, Bemutatkozás,
 * Szolgáltatások, Rólunk, Kapcsolat sora; az élő menüben Szolgáltatások,
 * Rólunk, Kapcsolat, a kezdőlapra ott a logó visz). A Bemutatkozás oldal
 * élőben nincs meg, ezért ott kimarad.
 */
export const FO_OLDALAK: readonly FoOldal[] = [
  {
    slug: KEZDOLAP_SLUG,
    nev: ADMIN_UTAK.kezdolap.felirat,
    sajatUtvonal: ADMIN_UTAK.kezdolap.utvonal,
  },
  { slug: 'bemutatkozas', nev: 'Bemutatkozás' },
  { slug: 'szolgaltatasok', nev: 'Szolgáltatások' },
  { slug: 'rolunk', nev: 'Rólunk' },
  { slug: 'kapcsolat', nev: 'Kapcsolat' },
]

export const FO_OLDALAK_CIM = 'Fő oldalak a weboldal menüje szerint'

export const FO_OLDALAK_SZOVEG =
  'Az Oldalak listában minden oldal a saját Címével szerepel, ez sokszor más, mint a menüben látható neve. A névre kattintva megnyílik az oldal szerkesztője.'

/** A lista oszlopfejlécének szava (Pages.ts `title` mező: „Cím”), hogy a sorral összekapcsolható legyen. */
export const FO_OLDAL_CIM_ELOTAG = 'Cím:'

/** Egy megtalált fő oldal: a menünév, az oldal saját Címe és az azonosítója. */
export interface FoOldalTalalat {
  slug: string
  nev: string
  /** Az oldal Címe a legújabb változaton; null, ha üres. */
  cim: string | null
  oldalId: number | string
  sajatUtvonal?: string
}

/** A lekérdező: a megadott webcímű oldalak, a találatok a `docs` tömbben. */
export type FoOldalakLekerdezo = (
  slugok: readonly string[],
) => Promise<{ docs: readonly unknown[] }>

/** A valódi lekérdező: Payload Local API, a kérés felhasználójával. */
export function payloadFoOldalakLekerdezo(
  payload: Pick<Payload, 'find'>,
  user: RoleUser | null | undefined,
): FoOldalakLekerdezo {
  return (slugok) =>
    payload.find({
      collection: 'pages',
      where: { slug: { in: [...slugok] } },
      draft: true,
      depth: 0,
      pagination: false,
      select: { title: true, slug: true },
      overrideAccess: false,
      user,
    })
}

function isRekord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A fő oldalak feloldása: csak a megtalált oldalak, a FO_OLDALAK sorrendjében.
 * A lekérdezés hibáját nem nyeli el (a komponens naplózza).
 */
export async function foOldalakFeloldasa(lekerdezo: FoOldalakLekerdezo): Promise<FoOldalTalalat[]> {
  const { docs } = await lekerdezo(FO_OLDALAK.map((oldal) => oldal.slug))
  const slugSzerint = new Map<string, { oldalId: number | string; cim: string | null }>()
  for (const doc of docs) {
    if (!isRekord(doc)) {
      continue
    }
    const { id, slug, title } = doc
    if (typeof slug !== 'string' || (typeof id !== 'number' && typeof id !== 'string')) {
      continue
    }
    if (!slugSzerint.has(slug)) {
      const cim = typeof title === 'string' && title.trim() !== '' ? title.trim() : null
      slugSzerint.set(slug, { oldalId: id, cim })
    }
  }
  return FO_OLDALAK.flatMap((oldal) => {
    const talalat = slugSzerint.get(oldal.slug)
    return talalat ? [{ ...oldal, ...talalat }] : []
  })
}

/** A link célja: a Kezdőlapnál az oldalsáv útvonala, máskor az oldal szerkesztője. */
export function foOldalHref(adminRoute: string, talalat: FoOldalTalalat): string {
  return adminCim(
    adminRoute,
    talalat.sajatUtvonal ?? `/collections/pages/${encodeURIComponent(String(talalat.oldalId))}`,
  )
}

export type FoOldalakElhelyezes = 'lista' | 'panel'

export interface FoOldalakProps extends GyakoriTeendokProps {
  /**
   * Hol jelenik meg. 'lista' (alapérték): az Oldalak lista fölött, a
   * `.kc-admin-notice` tájékoztató dobozában, címsor nélkül. 'panel': az
   * Irányítópult „Gyakori teendők” paneljén, h3 címsorral (a panel h2-je alatt).
   */
  elhelyezes?: FoOldalakElhelyezes
}

/**
 * A fő oldalak gyorslinkje. Szerver-komponens: az Oldalak lista fölé
 * (`/components/admin/GyakoriTeendok#FoOldalakGyorslinkjei`) és a
 * GyakoriTeendok panelbe is ez kerül.
 */
export async function FoOldalakGyorslinkjei({
  payload,
  permissions,
  user,
  elhelyezes = 'lista',
}: FoOldalakProps) {
  if (!hasStaffOrOwnerRole(user) || permissions?.collections?.pages?.read !== true) {
    return null
  }
  let talalatok: FoOldalTalalat[]
  try {
    talalatok = await foOldalakFeloldasa(payloadFoOldalakLekerdezo(payload, user))
  } catch (error) {
    logger.error('a fő oldalak gyorslinkje nem tölthető be', {
      error: error instanceof Error ? error.message : String(error),
      elhelyezes,
    })
    return null
  }
  if (talalatok.length === 0) {
    return null
  }
  const adminRoute = payload.config.routes.admin
  const cimId = `kc-fo-oldalak-cim-${elhelyezes}`
  const panelen = elhelyezes === 'panel'
  return (
    <nav
      aria-labelledby={cimId}
      className={panelen ? 'kc-fo-oldalak kc-fo-oldalak--panel' : 'kc-admin-notice kc-fo-oldalak'}
      data-elhelyezes={elhelyezes}
    >
      {panelen ? (
        <h3 className="kc-fo-oldalak__cim" id={cimId}>
          {FO_OLDALAK_CIM}
        </h3>
      ) : (
        <p className="kc-admin-notice__cim" id={cimId}>
          {FO_OLDALAK_CIM}
        </p>
      )}
      <p className={panelen ? 'kc-fo-oldalak__szoveg' : 'kc-admin-notice__szoveg'}>
        {FO_OLDALAK_SZOVEG}
      </p>
      <ul className="kc-fo-oldalak__lista">
        {talalatok.map((talalat) => {
          const cimSzovegId = `kc-fo-oldal-${elhelyezes}-${talalat.slug}`
          return (
            <li className="kc-fo-oldalak__elem" key={talalat.slug}>
              <Link
                aria-describedby={talalat.cim === null ? undefined : cimSzovegId}
                className="kc-fo-oldalak__link"
                href={foOldalHref(adminRoute, talalat)}
                prefetch={false}
              >
                {talalat.nev}
              </Link>
              {talalat.cim === null ? null : (
                <span className="kc-fo-oldalak__oldalcim" id={cimSzovegId}>
                  {FO_OLDAL_CIM_ELOTAG} „{talalat.cim}”
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/**
 * A Payload a teljes Local API-t adja át; a panel típusa csak a `find`-et
 * követeli (a tesztek szűk mockkal hívják). A „Figyelmet igényel" blokknak a
 * `count` is kell, ezt itt szűkítjük.
 */
function vanCount(
  payload: GyakoriTeendokProps['payload'],
): payload is GyakoriTeendokProps['payload'] & Pick<Payload, 'count'> {
  return typeof (payload as { count?: unknown }).count === 'function'
}

export async function GyakoriTeendok({ payload, permissions, user }: GyakoriTeendokProps) {
  const teendok = lathatoTeendok(user, permissions)
  if (teendok.length === 0) {
    return null
  }
  const adminRoute = payload.config.routes.admin
  // A tulajdonosi „Figyelmet igényel" blokk a kártyák ELÉ kerül: a beragadt
  // pénz fontosabb a szerkesztői feladatoknál (FigyelmetIgenyel.tsx).
  const figyelmet = vanCount(payload) ? await FigyelmetIgenyel({ payload, user }) : null
  const foOldalak = await FoOldalakGyorslinkjei({
    payload,
    permissions,
    user,
    elhelyezes: 'panel',
  })
  return (
    <>
      {figyelmet}
      <section aria-labelledby="kc-gyakori-teendok-cim" className="kc-gyakori-teendok">
        <h2 className="kc-gyakori-teendok__cim" id="kc-gyakori-teendok-cim">
          {GYAKORI_TEENDOK_CIM}
        </h2>
        <ul className="kc-gyakori-teendok__lista">
          {teendok.map((teendo) => {
            const leirasId = `kc-gyakori-teendo-${teendo.kulcs}`
            return (
              <li className="kc-gyakori-teendok__kartya" key={teendo.kulcs}>
                <h3 className="kc-gyakori-teendok__kartya-cim">
                  <Link
                    aria-describedby={leirasId}
                    className="kc-gyakori-teendok__link"
                    href={adminCim(adminRoute, teendo.utvonal)}
                    prefetch={false}
                  >
                    {teendoCime(teendo, payload.config.collections)}
                  </Link>
                </h3>
                <p className="kc-gyakori-teendok__leiras" id={leirasId}>
                  {teendo.leiras}
                </p>
              </li>
            )
          })}
        </ul>
        {foOldalak}
      </section>
    </>
  )
}

export default GyakoriTeendok
