import { HOME_PAGE_SLUG } from '../content-slugs'
import { isSectionHidden, KAPCSOLAT_OLDAL_SLUG, nonEmptyText } from '../section-row-label'
import { oldalNev } from './szekcio-masolatok'

/**
 * „Hol látszik”: a Vélemények lista oszlopa (modul-térkép H43/4). Tiszta
 * modul, React és Payload nélkül; a szerveroldali cella
 * (src/components/admin/TestimonialPlacementCell.tsx) hívja, a teszt
 * (src/__tests__/velemeny-helye.test.ts) közvetlenül.
 *
 * MIT MOND KI. Soronként, melyik közzétett oldalon látszik a vélemény, vagy
 * ha sehol, akkor miért. A szerkesztő így a pipák és a Sorrend átállítása
 * ELŐTT látja a következményt, nem a weboldalon keresi.
 * Források:
 * - NN/g, Visibility of System Status: „The design should always keep users
 *   informed about what is going on”.
 *   https://www.nngroup.com/articles/visibility-system-status/
 * - NN/g, Memory Recognition and Recall in User Interfaces: a felismerés
 *   könnyebb, mint a felidézés, ezért a lista maga mondja meg a helyet, a
 *   szerkesztőnek nem kell fejben összeraknia a pipákból és a Sorrendből.
 *   https://www.nngroup.com/articles/recognition-and-recall/
 * - WCAG 2.2 SC 3.2.4 Consistent Identification: az oldal neve BETŰRE az,
 *   amit a „Ugyanaz máshol” jelzés is ír (`oldalNev`, szekcio-masolatok.ts).
 *   https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html
 *
 * A SZABÁLY A WEBOLDAL KÓDJÁBÓL (nem feltételezés):
 * - A weboldal a Látható és Kiemelt véleményekből a Sorrend szerinti első
 *   hármat kéri le, egyszer, minden oldalnak ugyanazt (src/lib/cms.ts
 *   `getTestimonials`). Ami nincs benne, az sehol nem látszik.
 * - Egy Vélemények szekció ebből a listából az első `maxItems` darabot
 *   mutatja, 1 és 3 közé szorítva (TestimonialsSection.tsx
 *   `featuredTestimonials`; a RenderBlocks.tsx a `maxItems ?? undefined`
 *   értéket adja át, így a hiányzó érték 3). A rejtett szekció nem renderel
 *   (RenderBlocks.tsx, `sectionSettings.visible === false`).
 * - A Kapcsolat oldal (/kapcsolat) a Vélemények szekciónak üres listát ad
 *   (src/app/(frontend)/kapcsolat/page.tsx `testimonials={[]}`), ezért ott
 *   sosem látszik vélemény.
 * - A kezdőlap szekciósor nélkül a rögzített kezdőlapot rajzolja, benne a
 *   Vélemények szekcióval, 3 darabbal (HomeView.tsx, üres `layout` ága). Ez
 *   akkor is így van, ha nincs közzétett kezdőlap (app/(frontend)/page.tsx:
 *   `homePageOf` null értékkel is a HomeView-t rendereli).
 * - Csak a közzétett oldal számít: a weboldal a `status: 'published'`
 *   változatot rendereli (cms.ts `getPageBySlug`, `draft: false`).
 * - A rang a SZEKCIÓ sorrendje, nem az adatbázisé. A lekérdezés `sort:
 *   'order'`, a Postgres növekvő rendezésben a NULL értéket a végére teszi
 *   (ASC NULLS LAST). A szekció viszont a kapott hármat újrarendezi:
 *   `(a.order ?? 0) - (b.order ?? 0)` (TestimonialsSection.tsx
 *   `featuredTestimonials`), így az üres Sorrendű vélemény 0-nak számít, és
 *   a pozitív Sorrendűek elé kerül. Ezért a modul az első három {id, order}
 *   párját kapja, és a rangot ugyanazzal a stabil rendezéssel számolja
 *   (`sorrendSzerint`); a teszt a kettőt vegyes, üres és negatív Sorrenddel
 *   veti össze.
 *
 * ISMERT KORLÁT (ezt a cella nem látja, a lista itt tévedhet):
 * - A Tudástár-hub oldalak (src/lib/tudastar/hub-oldalak.ts `HUB_OLDALAK`)
 *   közzétett forrás-cikk mellett a cikket renderelik, nem az oldal
 *   szekciósorát (src/app/(frontend)/[slug]/page.tsx). A cella ezt nem
 *   kérdezi le (egy harmadik, posts-lekérdezés kellene hozzá), ezért egy hub
 *   szekciósorában álló Vélemények blokkot akkor is beszámol, ha a weboldal
 *   helyette a cikket mutatja.
 * - Egy statikus route (pl. /szakembereknek, /kurzusok) elfedheti az azonos
 *   webcímű CMS-oldalt: a Next.js a statikus szegmenst a dinamikus `[slug]`
 *   elé veszi. Az ilyen CMS-oldal Vélemények szekcióját a cella akkor is
 *   beszámolja, ha a weboldalon a statikus oldal látszik.
 */

/** A lista oszlopának neve; a Vélemények gyűjtemény leírása is így hivatkozik rá. */
export const HOL_LATSZIK_OSZLOP = 'Hol látszik'

/** A TestimonialsSection.tsx `MAX_HOME_TESTIMONIALS` értéke (a teszt köti össze). */
export const VELEMENY_FELSO_KORLAT = 3

/** Miért nem látszik a vélemény sehol. */
export type SeholOk = 'rejtett' | 'nincs-kiemelve' | 'nem-fer' | 'keves-hely' | 'nincs-szekcio'

/**
 * A „Sehol” feliratok. A „keves-hely” eset a kiírás négy esetén túli ötödik:
 * a vélemény benne van az első háromban, de minden szekció kevesebbet mutat
 * (pl. „Hány vélemény jelenjen meg” = 1, a vélemény a harmadik). Ilyenkor a
 * „nem fér az első háromba” nem volna igaz, a „nincs Vélemények szekció” sem.
 */
export const SEHOL_FELIRAT: Readonly<Record<SeholOk, string>> = {
  rejtett: 'Sehol (rejtett)',
  'nincs-kiemelve': 'Sehol (nincs kiemelve)',
  'nem-fer': 'Sehol (nem fér az első háromba)',
  'keves-hely': 'Sehol (a Vélemények szekció kevesebbet mutat)',
  'nincs-szekcio': 'Sehol (nincs Vélemények szekció)',
}

/** Hibánál ez áll a cellában (a részleteket a szervernapló kapja). */
export const NEM_MEGALLAPITHATO = 'Nem sikerült megállapítani'

/** A weboldal véleménylistájának egy eleme: azonosító és Sorrend. */
export interface HelyListaElem {
  id: unknown
  /** Hiányozhat (a Payload `order?: number | null`); ekkor 0 számít. */
  order?: unknown
}

/** A lista egy sora (a Payload `rowData`-jából annyi, amennyi kell). */
export interface HelyVelemeny {
  id: unknown
  featured: unknown
  visible: unknown
}

/** Egy közzétett oldal: webcím, cím és szekciósor. */
export interface HelyOldal {
  slug: unknown
  title: unknown
  layout: unknown
}

export interface VelemenyHelyeBemenet {
  velemeny: HelyVelemeny
  /**
   * A weboldal véleménylistája (legfeljebb 3) {id, order} párokként, az
   * adatbázis sorrendjében. A rangot a modul maga rendezi (`sorrendSzerint`).
   */
  elsoHarom: readonly HelyListaElem[]
  /** A közzétett oldalak. */
  oldalak: readonly HelyOldal[]
}

export type VelemenyHelye =
  { tipus: 'oldalak'; nevek: readonly string[] } | { tipus: 'sehol'; ok: SeholOk }

type Adat = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is Adat {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Egy Vélemények szekció ennyi véleményt mutat. BETŰRE a
 * `featuredTestimonials` szorítása (`Math.min(Math.max(1, Math.floor(limit)),
 * MAX)`), a hiányzó érték az alapérték (3). A teszt a két függvényt minden
 * határesetre összeveti.
 */
export function mutatottDarab(maxItems: unknown): number {
  const limit = typeof maxItems === 'number' ? maxItems : VELEMENY_FELSO_KORLAT
  const szoritott = Math.min(Math.max(1, Math.floor(limit)), VELEMENY_FELSO_KORLAT)
  return Number.isNaN(szoritott) ? 0 : szoritott
}

/** Az oldal szekciósora tömbként (a hiányzó mező üres sor). */
function szekciosor(oldal: HelyOldal): readonly unknown[] {
  return Array.isArray(oldal.layout) ? oldal.layout : []
}

/**
 * Hány véleményt mutat az oldal: a nem rejtett Vélemények szekciói közül a
 * legtöbbet mutató darabszáma; 0, ha nincs ilyen szekció, vagy ha az oldal a
 * Kapcsolat. A szekciósor nélküli kezdőlap a rögzített kezdőlap (3).
 */
export function oldalVelemenyDarab(oldal: HelyOldal): number {
  const slug = nonEmptyText(oldal.slug)
  if (slug === KAPCSOLAT_OLDAL_SLUG) {
    return 0
  }
  const sor = szekciosor(oldal)
  if (slug === HOME_PAGE_SLUG && sor.length === 0) {
    return VELEMENY_FELSO_KORLAT
  }
  return sor.reduce<number>((legtobb, szekcio) => {
    if (!isRecord(szekcio) || szekcio.blockType !== 'testimonials' || isSectionHidden(szekcio)) {
      return legtobb
    }
    return Math.max(legtobb, mutatottDarab(szekcio.maxItems))
  }, 0)
}

/** Az azonosító összevethető alakja (a Payload számot vagy szöveget ad). */
function azonositoKulcs(id: unknown): string | null {
  if (typeof id === 'number' && Number.isFinite(id)) {
    return String(id)
  }
  return typeof id === 'string' && id.length > 0 ? id : null
}

/** A Sorrend számként; ami nem szám (üres, hiányzó), az 0, mint a szekcióban. */
function sorrendErtek(order: unknown): number {
  return typeof order === 'number' ? order : 0
}

/**
 * A lista abban a sorrendben, ahogy a Vélemények szekció mutatja. BETŰRE a
 * `featuredTestimonials` rendezése: `(a.order ?? 0) - (b.order ?? 0)`, a
 * `Array.prototype.sort` stabil (ES2019), így az egyenlő Sorrendűek az
 * adatbázis sorrendjében maradnak. A bemenetet nem módosítja.
 */
export function sorrendSzerint<T extends HelyListaElem>(lista: readonly T[]): T[] {
  return [...lista].sort((a, b) => sorrendErtek(a.order) - sorrendErtek(b.order))
}

/** A nevek rendje: a Kezdőlap elöl, utána ábécérendben (magyar rendezés). */
function nevRend(a: string, b: string, kezdolapNev: string): number {
  if (a === kezdolapNev) return b === kezdolapNev ? 0 : -1
  if (b === kezdolapNev) return 1
  return a.localeCompare(b, 'hu')
}

/** Hol látszik a vélemény (lásd a fejkommentet). */
export function velemenyHelye({
  velemeny,
  elsoHarom,
  oldalak,
}: VelemenyHelyeBemenet): VelemenyHelye {
  if (velemeny.visible !== true) {
    return { tipus: 'sehol', ok: 'rejtett' }
  }
  if (velemeny.featured !== true) {
    return { tipus: 'sehol', ok: 'nincs-kiemelve' }
  }
  const kulcs = azonositoKulcs(velemeny.id)
  const rang =
    kulcs === null
      ? -1
      : sorrendSzerint(elsoHarom).findIndex((elem) => azonositoKulcs(elem.id) === kulcs)
  if (rang < 0) {
    return { tipus: 'sehol', ok: 'nem-fer' }
  }

  const vanKezdolap = oldalak.some((oldal) => nonEmptyText(oldal.slug) === HOME_PAGE_SLUG)
  const mind: readonly HelyOldal[] = vanKezdolap
    ? oldalak
    : [...oldalak, { slug: HOME_PAGE_SLUG, title: null, layout: [] }]

  let vanSzekcio = false
  const nevek = new Set<string>()
  for (const oldal of mind) {
    const darab = oldalVelemenyDarab(oldal)
    if (darab === 0) continue
    vanSzekcio = true
    if (rang < darab) {
      nevek.add(oldalNev({ slug: oldal.slug, title: oldal.title }))
    }
  }
  if (nevek.size > 0) {
    const kezdolapNev = oldalNev({ slug: HOME_PAGE_SLUG, title: null })
    return {
      tipus: 'oldalak',
      nevek: [...nevek].sort((a, b) => nevRend(a, b, kezdolapNev)),
    }
  }
  return { tipus: 'sehol', ok: vanSzekcio ? 'keves-hely' : 'nincs-szekcio' }
}

/** A cella szövege: a nevek vesszővel, vagy a „Sehol” ok. */
export function velemenyHelyeFelirat(hely: VelemenyHelye): string {
  return hely.tipus === 'oldalak' ? hely.nevek.join(', ') : SEHOL_FELIRAT[hely.ok]
}
