import { isCoursePromoDisplayed, type CoursePromoDisplayFields } from '../../../lib/course-promo'
import type { SalesForras, SalesForrasok } from '../../courses/sales-content'
import { szekcioMelylink } from '../szekcio-melylink'
import { SZERKESZTEM_FELIRAT, type SzalagLink } from './szerkeszto-szalag'

/**
 * A kurzusoldal forrás-szalagjai a piszkozat-előnézetben (modul-térkép H50/A19).
 *
 * Tiszta modul: React, Next és Payload nélkül. A route
 * (src/app/(frontend)/kurzusok/[slug]/page.tsx) CSAK `isPreview` mellett hívja,
 * a látogató kimenetébe semmi nem kerül belőle.
 *
 * MIÉRT KELL. A kurzusoldal szakaszai más-más mezőből jönnek, és a kód egy
 * részüket a Részletes leírás kulcsszavas címsorai alól vágja ki
 * (src/components/courses/sales-content.ts `classifyHeading`), üres mezőnél
 * pedig beépített tartalékot mutat. A szerkesztő így nem tudja, hol írja át,
 * amit lát. A szalag kimondja a forrást, és a szerkesztő PONTOS mezőjére visz:
 * - Sanity Visual Editing: „overlays appear on content elements, letting the
 *   editor click any piece of content to jump directly to the corresponding
 *   field in Sanity Studio.”
 *   (https://www.sanity.io/docs/visual-editing/visual-editing-overlays);
 * - NN/g, Visibility of System Status: „The design should always keep users
 *   informed about what is going on”
 *   (https://www.nngroup.com/articles/visibility-system-status/).
 *
 * A SZÖVEGEK. A forrás-mondat a mezőt és a fület nevezi meg; címsorból vágott
 * vagy tartalék tartalomnál azt is, mit kell tenni, hogy a saját szöveg
 * látsszon. NN/g, Error-Message Guidelines: „Merely stating the problem is
 * also not enough; offer some potential remedies.” és „Avoid technical jargon
 * and use language familiar to your users instead.”
 * (https://www.nngroup.com/articles/error-message-guidelines/). GOV.UK Design
 * System, Warning text: „Use the warning text component when you need to warn
 * users about something important” (az akciós figyelmeztetés;
 * https://design-system.service.gov.uk/components/warning-text/). Töltelék
 * gondolatjel nincs (termektervezes skill, 2. pont; docs/ui-sztenderdek.md).
 *
 * A MEZŐ- ÉS FÜLNEVEK BETŰRE AZ ADMIN FELIRATAI (WCAG 2.2 SC 3.2.4 Consistent
 * Identification): a src/plugins/ecommerce.ts `label`-jei és a
 * `courseEditorTabs` fülcímkéi, a tananyagé a src/fields/course-modules.ts-ből.
 * A config ide nem importálható (Payload-függő), ezért az egyezést a
 * src/__tests__/kurzus-forras-szalag.test.tsx forrás-olvasással őrzi.
 *
 * A LINK. Látható felirata „Szerkesztem” (vagy azzal kezdődik: SC 2.5.3 Label
 * in Name), vizuálisan rejtett folytatása megnevezi a szakaszt, a fület és a
 * mezőt (SC 2.4.4 Link Purpose, C7 technika). A cél a Kurzusok szerkesztője a
 * `?mezo=<mezőnév>` paraméterrel (szekcio-melylink.ts, az admin mélylink-nyitója
 * a fület kiválasztja, és a mezőhöz görget).
 */

/** A kurzusoldal szakaszai, a route horgony-azonosítóival (a galéria képnek nincs horgonya). */
export type KurzusSzakaszId =
  'mi-ez' | 'galeria' | 'hogyan-mukodik' | 'tananyag' | 'kinek-valo' | 'garancia' | 'gyik'

/** A Kurzusok szerkesztőjének fülei (src/plugins/ecommerce.ts `courseEditorTabs`). */
export const KURZUSOLDAL_FUL = 'Kurzusoldal'
export const TANANYAG_FUL = 'Tananyag'
export const AR_ES_HOZZAFERES_FUL = 'Ár és hozzáférés'

/**
 * A szalagokon hivatkozott mezők admin-felirata és füle. A kulcs a Payload
 * mezőneve (ez kerül a `?mezo=` paraméterbe), a felirat BETŰRE az admin
 * `label`-je.
 */
export const KURZUS_MEZOK = {
  longDescription: { cimke: 'Részletes leírás', ful: KURZUSOLDAL_FUL },
  salesHighlights: { cimke: 'Fő előnyök (pipás sorok)', ful: KURZUSOLDAL_FUL },
  howItWorks: { cimke: 'Hogyan működik? (lépések)', ful: KURZUSOLDAL_FUL },
  fitFor: { cimke: 'Kinek való (pipás lista)', ful: KURZUSOLDAL_FUL },
  notFitFor: { cimke: 'Kinek nem való', ful: KURZUSOLDAL_FUL },
  guaranteeTitle: { cimke: 'Garancia címe', ful: KURZUSOLDAL_FUL },
  guaranteeText: { cimke: 'Garancia szövege', ful: KURZUSOLDAL_FUL },
  faq: { cimke: 'Gyakori kérdések (GYIK)', ful: KURZUSOLDAL_FUL },
  gallery: { cimke: 'Képgaléria', ful: KURZUSOLDAL_FUL },
  modules: { cimke: 'Tananyag (modulok)', ful: TANANYAG_FUL },
  videos: { cimke: 'Videók (régi, fejezet nélküli lista)', ful: TANANYAG_FUL },
  promoEnabled: { cimke: 'Akciós kurzus', ful: AR_ES_HOZZAFERES_FUL },
} as const satisfies Record<string, { cimke: string; ful: string }>

export type KurzusMezo = keyof typeof KURZUS_MEZOK

/** Az akció beállításait tartalmazó csukható doboz admin-felirata (ecommerce.ts). */
export const AKCIOS_MEGJELENES_DOBOZ = 'Akciós megjelenés'

/**
 * A szakaszok címe a lapon, BETŰRE a route címsoraival (a route
 * forrás-olvasó tesztje őrzi). A garancia címe a tartalomból jön.
 */
export const SZAKASZ_CIMEK = {
  'mi-ez': 'A kurzusról',
  galeria: 'Galéria első képe',
  'hogyan-mukodik': 'Hogyan működik?',
  tananyag: 'Tananyag',
  'kinek-valo': 'Kinek való, és kinek nem?',
  garancia: 'Garancia',
  gyik: 'Gyakori kérdések',
} as const satisfies Record<KurzusSzakaszId, string>

/** A két „kinek” lista címe a lapon (route: `fitTitle`, `notFitTitle`). */
export const NEKED_VALO_LISTA = 'Neked való, ha…'
export const NEM_JAVASOLJUK_LISTA = 'Nem javasoljuk, ha…'

/** Az oldal-szalag címkéjének eleje (a Szekciók oldal-szalagjának „Az egész oldal” párja). */
export const KURZUS_OLDAL_CIMKE_ELOTAG = 'Az egész kurzus'

/** A két külön célú „kinek” link látható felirata (azonos felirat más célra: SC 2.4.4, 3.2.4). */
export const NEKED_VALO_LINK = `${SZERKESZTEM_FELIRAT} a „${NEKED_VALO_LISTA}” listát`
export const NEM_JAVASOLJUK_LINK = `${SZERKESZTEM_FELIRAT} a „${NEM_JAVASOLJUK_LISTA}” listát`

/** Az oldal-szalag második linkje: a vásárlódoboz pipás sorai. */
export const PIPAS_SOROK_LINK = `${SZERKESZTEM_FELIRAT} a pipás sorokat`

/** Az akciós figyelmeztetés linkje. */
export const AKCIO_LINK = `${SZERKESZTEM_FELIRAT} az akció beállításait`

/** Az akciós figyelmeztetés címkéje és szövege. */
export const AKCIOS_CIMKE = 'Akciós elrendezés: az előnézet nem mutatja'
export const AKCIOS_SZOVEG =
  'Élesben ez a kurzus akciós elrendezésben jelenik meg, mert az akció most él. Az előnézet a normál elrendezést mutatja, az akciós oldalt a közzététel után, a kurzus nyilvános címén látod.'

/** Egy szakasz szalagja. */
export interface KurzusSzakaszSzalag {
  szakaszId: KurzusSzakaszId
  /** A szakasz neve, ahogy a lapon látszik, pl. „„Hogyan működik?” szakasz”. */
  cimke: string
  /** Egy-három mondat: honnan jön a szakasz, és ha kell, mit írj át. */
  forrasMondat: string
  /** Igaz, ha a beépített tartalék látszik (a szalag figyelmeztető felületet kap). */
  tartalek: boolean
  link: SzalagLink
  /** A „kinek” szakasz második listájának linkje, ha az máshova visz. */
  masodikLink: SzalagLink | null
}

export interface KurzusOldalSzalag {
  cimke: string
  /** A vásárlódoboz pipás sorainak forrása. */
  jelzes: string
  linkek: readonly SzalagLink[]
}

export interface KurzusAkciosSzalag {
  cimke: string
  szoveg: string
  link: SzalagLink
}

export interface KurzusForrasSzalagok {
  oldal: KurzusOldalSzalag
  /** Csak ha a kurzus élesben akciós elrendezést kapna; különben null. */
  akcios: KurzusAkciosSzalag | null
  /** Csak a lapon megjelenő szakaszok szalagja. */
  szakaszok: Partial<Record<KurzusSzakaszId, KurzusSzakaszSzalag>>
}

/** Az értékesítő tartalom a forrásokkal (a `buildCourseSalesContent` kimenetének része). */
export interface KurzusSalesBemenet {
  steps: readonly unknown[]
  fitFor: readonly string[]
  notFitFor: readonly string[]
  guarantee: { title: string } | null
  faq: readonly unknown[]
  body: { root: { children: readonly unknown[] } } | null
  forrasok: SalesForrasok
}

/** A kurzus a szalagokhoz szükséges mezőkkel. */
export type KurzusSzalagTermek = CoursePromoDisplayFields & {
  id: number | string
  displayTitle?: string | null
  sku?: string | null
}

export interface KurzusForrasSzalagBemenet {
  product: KurzusSzalagTermek
  sales: KurzusSalesBemenet
  /**
   * A Tananyag szakasz forrása: `modulok` (Tananyag (modulok)), `regi` (a régi
   * videólista, `buildCurriculum(...).legacy`), vagy null, ha a lapon nincs
   * Tananyag szakasz.
   */
  tananyag?: 'modulok' | 'regi' | null
  /** Van-e a lapon galéria-kép (a route `firstGalleryMedia(product) !== null`-ja). */
  galeria?: boolean
  /** A Payload admin-útvonala, alapból `/admin`. */
  adminRoute?: string
  /** Az akció időablakának vizsgálati időpontja (teszthez). */
  now?: Date
}

function mezoCimke(mezo: string): string {
  return mezo in KURZUS_MEZOK ? KURZUS_MEZOK[mezo as KurzusMezo].cimke : mezo
}

function mezoFul(mezo: string): string {
  return mezo in KURZUS_MEZOK ? KURZUS_MEZOK[mezo as KurzusMezo].ful : KURZUSOLDAL_FUL
}

/**
 * „A Kurzusoldal fül „Részletes leírás” mezőjéből” (pont nélkül). Mondat
 * belsejében (`mondatElejen: false`) kisbetűs névelővel.
 */
function mezobolSzoveg(mezo: string, mondatElejen = true): string {
  return `${mondatElejen ? 'A' : 'a'} ${mezoFul(mezo)} fül „${mezoCimke(mezo)}” mezőjéből`
}

/** „Ha a „Kinek való (pipás lista)” mezőt kitöltöd, az látszik helyette.” */
function helyetteMondat(mezo: string): string {
  return `Ha a „${mezoCimke(mezo)}” mezőt kitöltöd, az látszik helyette.`
}

/** A link vizuálisan rejtett folytatása: szakasz, fül, mező (SC 2.4.4). */
function rejtettKontextus(szakasz: string, mezo: string): string {
  return `: ${szakasz}, ${mezoFul(mezo)} fül, ${mezoCimke(mezo)} mező`
}

function termekCim(product: KurzusSzalagTermek): string {
  const cim = typeof product.displayTitle === 'string' ? product.displayTitle.trim() : ''
  if (cim) {
    return cim
  }
  return typeof product.sku === 'string' ? product.sku.trim() : ''
}

/**
 * Élesben akciós elrendezést kapna-e a kurzus. Az előnézet a LEGÚJABB
 * piszkozatot mutatja, amelynek Payload-státusza `draft`, ezért a közös
 * szabályt (course-promo.ts `isCoursePromoDisplayed`, a route `usePromoView`-ja
 * ugyanezt hívja) a közzétett állapotra értékeljük: ha ezt a piszkozatot most
 * közzéteszik, akciós oldal lesz belőle. A többi feltétel (a láthatósági
 * `status`, az ár, az időablak) változatlanul számít.
 */
export function elesbenAkciosElrendezes(
  product: CoursePromoDisplayFields,
  now: Date = new Date(),
): boolean {
  return isCoursePromoDisplayed({ ...product, _status: 'published' }, now)
}

interface Resz {
  /** A forrás-mondat(ok). */
  mondat: string
  /** Ahová a link visz. */
  mezo: string
}

/**
 * Egy lista- vagy szöveges szakasz forrása mondatban. `alany` a mondat alanya
 * (pl. „A „Neked való, ha…” lista”), null esetén a mondat alany nélküli
 * („A Részletes leírás … címsora alól.”). `helyette` a teendő: melyik mezőt
 * kitöltve látszik a saját szöveg, ha most a leírás címsora alól jön.
 */
function forrasResz(forras: SalesForras, alany: string | null, helyette: string): Resz {
  if (forras.mezo === 'longDescription' && forras.cimsor !== null) {
    const eleje =
      alany === null
        ? `A Részletes leírás „${forras.cimsor}” címsora alól.`
        : `${alany} a Részletes leírás „${forras.cimsor}” címsora alól jön.`
    return { mondat: `${eleje} ${helyette}`, mezo: 'longDescription' }
  }
  return {
    mondat:
      alany === null
        ? `${mezobolSzoveg(forras.mezo)}.`
        : `${alany} ${mezobolSzoveg(forras.mezo, false)} jön.`,
    mezo: forras.mezo,
  }
}

/**
 * A kurzusoldal forrás-szalagjai. Szalag csak ahhoz a szakaszhoz készül,
 * amelyet a route ki is rajzol (ugyanazok a feltételek, mint a route
 * `sections` tömbjében).
 */
export function kurzusForrasSzalagok({
  product,
  sales,
  tananyag = null,
  galeria = false,
  adminRoute = '/admin',
  now = new Date(),
}: KurzusForrasSzalagBemenet): KurzusForrasSzalagok {
  const href = (mezo?: string) =>
    szekcioMelylink({
      adminRoute,
      collection: 'products',
      id: product.id,
      ...(mezo === undefined ? {} : { mezo }),
    })
  const link = (felirat: string, szakasz: string, mezo: string): SzalagLink => ({
    felirat,
    rejtettKontextus: rejtettKontextus(szakasz, mezo),
    href: href(mezo),
  })
  const f = sales.forrasok
  const szakaszok: Partial<Record<KurzusSzakaszId, KurzusSzakaszSzalag>> = {}
  const egyszeru = (
    szakaszId: KurzusSzakaszId,
    cim: string,
    resz: Resz,
    tartalek = false,
  ): KurzusSzakaszSzalag => {
    const szakasz = `„${cim}” szakasz`
    return {
      szakaszId,
      cimke: szakasz,
      forrasMondat: resz.mondat,
      tartalek,
      link: link(SZERKESZTEM_FELIRAT, szakasz, resz.mezo),
      masodikLink: null,
    }
  }

  // „A kurzusról”: a leírás maradéka. Ha a kód szakaszokat vágott ki belőle,
  // megnevezzük a címsorokat, hogy a szerkesztő ne keresse őket itt.
  if (sales.body !== null && sales.body.root.children.length > 0) {
    const kivagott = [f.kinekValo, f.kinekNem, f.garancia, f.gyik]
      .filter((forras) => forras.mezo === 'longDescription' && forras.cimsor !== null)
      .map((forras) => `„${forras.cimsor}”`)
    const kiegeszites =
      kivagott.length === 0
        ? ''
        : kivagott.length === 1
          ? ` A ${kivagott.join('')} címsor a hozzá tartozó szöveggel együtt lejjebb, külön szakaszban látszik.`
          : ` Ezek a címsorok a hozzájuk tartozó szöveggel együtt lejjebb, külön szakaszban látszanak: ${kivagott.join(', ')}.`
    szakaszok['mi-ez'] = egyszeru('mi-ez', SZAKASZ_CIMEK['mi-ez'], {
      mondat: `${mezobolSzoveg(f.leiras.mezo)}.${kiegeszites}`,
      mezo: f.leiras.mezo,
    })
  }

  if (galeria) {
    szakaszok.galeria = egyszeru('galeria', SZAKASZ_CIMEK.galeria, {
      mondat: `A ${KURZUSOLDAL_FUL} fül „${KURZUS_MEZOK.gallery.cimke}” mezőjének első képe.`,
      mezo: 'gallery',
    })
  }

  if (sales.steps.length > 0) {
    const cimke = KURZUS_MEZOK.howItWorks.cimke
    szakaszok['hogyan-mukodik'] = egyszeru(
      'hogyan-mukodik',
      SZAKASZ_CIMEK['hogyan-mukodik'],
      f.lepesek.tartalek
        ? {
            mondat: `A „${cimke}” mező üres, ezért a beépített ${String(sales.steps.length)} lépés látszik. Ha kitöltöd, a te lépéseid jelennek meg.`,
            mezo: 'howItWorks',
          }
        : { mondat: `${mezobolSzoveg('howItWorks')}.`, mezo: 'howItWorks' },
      f.lepesek.tartalek,
    )
  }

  if (tananyag !== null) {
    szakaszok.tananyag = egyszeru(
      'tananyag',
      SZAKASZ_CIMEK.tananyag,
      tananyag === 'regi'
        ? {
            mondat: `${mezobolSzoveg('videos')}, mert a „${KURZUS_MEZOK.modules.cimke}” mezőben még nincs lecke.`,
            mezo: 'videos',
          }
        : { mondat: `${mezobolSzoveg('modules')}.`, mezo: 'modules' },
    )
  }

  if (sales.fitFor.length > 0 || sales.notFitFor.length > 0) {
    const szakasz = `„${SZAKASZ_CIMEK['kinek-valo']}” szakasz`
    const fel = (
      forras: SalesForras,
      lista: string,
      mezo: 'fitFor' | 'notFitFor',
      van: boolean,
    ): Resz =>
      van
        ? forrasResz(forras, `A „${lista}” lista`, helyetteMondat(mezo))
        : {
            mondat: `A „${lista}” lista nem látszik, mert a „${mezoCimke(mezo)}” mező üres, és a leírásban sincs ilyen címsor.`,
            mezo,
          }
    const valo = fel(f.kinekValo, NEKED_VALO_LISTA, 'fitFor', sales.fitFor.length > 0)
    const nem = fel(f.kinekNem, NEM_JAVASOLJUK_LISTA, 'notFitFor', sales.notFitFor.length > 0)
    const kozos = valo.mezo === nem.mezo
    szakaszok['kinek-valo'] = {
      szakaszId: 'kinek-valo',
      cimke: szakasz,
      forrasMondat: `${valo.mondat} ${nem.mondat}`,
      tartalek: false,
      link: kozos
        ? link(SZERKESZTEM_FELIRAT, szakasz, valo.mezo)
        : link(NEKED_VALO_LINK, szakasz, valo.mezo),
      masodikLink: kozos ? null : link(NEM_JAVASOLJUK_LINK, szakasz, nem.mezo),
    }
  }

  if (sales.guarantee !== null) {
    // A strukturált garancia csak KÉT kitöltött mezővel él (sales-content.ts),
    // ezért a teendő és a mezős forrás is mindkettőt megnevezi.
    const cimMezo = KURZUS_MEZOK.guaranteeTitle.cimke
    const szovegMezo = KURZUS_MEZOK.guaranteeText.cimke
    const resz: Resz =
      f.garancia.mezo === 'longDescription'
        ? forrasResz(
            f.garancia,
            null,
            `Ha a „${cimMezo}” és a „${szovegMezo}” mezőt is kitöltöd, azok látszanak helyette.`,
          )
        : {
            mondat: `A ${KURZUSOLDAL_FUL} fül „${cimMezo}” és „${szovegMezo}” mezőjéből.`,
            mezo: 'guaranteeTitle',
          }
    szakaszok.garancia = egyszeru('garancia', SZAKASZ_CIMEK.garancia, resz)
  }

  if (sales.faq.length > 0) {
    szakaszok.gyik = egyszeru(
      'gyik',
      SZAKASZ_CIMEK.gyik,
      forrasResz(f.gyik, null, helyetteMondat('faq')),
    )
  }

  const cim = termekCim(product)
  const elonyCimke = KURZUS_MEZOK.salesHighlights.cimke
  const jelzes = f.elonyok.tartalek
    ? `A „${elonyCimke}” mező üres, és a leírásban sincs felsorolás, ezért a vásárlódobozban a tananyag adataiból épített sorok látszanak.`
    : f.elonyok.mezo === 'longDescription'
      ? `A vásárlódoboz pipás sorai a Részletes leírás első felsorolásából jönnek. ${helyetteMondat('salesHighlights')}`
      : `A vásárlódoboz pipás sorai ${mezobolSzoveg('salesHighlights', false)} jönnek.`

  const oldal: KurzusOldalSzalag = {
    cimke: cim ? `${KURZUS_OLDAL_CIMKE_ELOTAG}: ${cim}` : KURZUS_OLDAL_CIMKE_ELOTAG,
    jelzes,
    linkek: [
      {
        felirat: SZERKESZTEM_FELIRAT,
        rejtettKontextus: cim ? `: az egész kurzus, ${cim}` : ': az egész kurzus',
        href: href(),
      },
      link(PIPAS_SOROK_LINK, 'a vásárlódoboz pipás sorai', f.elonyok.mezo),
    ],
  }

  const akcios: KurzusAkciosSzalag | null = elesbenAkciosElrendezes(product, now)
    ? {
        cimke: AKCIOS_CIMKE,
        szoveg: AKCIOS_SZOVEG,
        link: {
          felirat: AKCIO_LINK,
          rejtettKontextus: `: ${AR_ES_HOZZAFERES_FUL} fül, ${AKCIOS_MEGJELENES_DOBOZ}`,
          href: href('promoEnabled'),
        },
      }
    : null

  return { oldal, akcios, szakaszok }
}
