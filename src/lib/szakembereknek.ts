import type { BlockOfferCards } from '../payload-types'
import { ctaLabel } from './cta-vocabulary'
import { PROFESSIONAL_TRAINING_URL } from './menu-seed'

/**
 * /szakembereknek — a szakmai választó oldal (WP49) tiszta adatai.
 *
 * A tulajdonosok kérése (2026-09): a fejléc „Szakembereknek" menüpontja ne
 * vigyen egyből a ProBody workshopra, hanem egy saját oldalra, ahol a
 * látogató a KÉPZÉS és a SZAKKÖNYV között választ.
 */

export const SZAKEMBEREKNEK_PATH = '/szakembereknek'

export const SZAKEMBEREKNEK_TITLE = 'Szakembereknek'

/**
 * Meta-leírás (120–160 karakter, natív magyar, töltelék gondolatjel nélkül):
 * a két utat és a célközönséget nevezi meg.
 */
export const SZAKEMBEREKNEK_DESCRIPTION =
  'Kézrehabilitáció gyógytornászoknak és terapeutáknak: akkreditált kézworkshop a ProBody Stúdióval, valamint a Kineticare szakkönyve. Válaszd a képzést vagy a könyvet.'

/**
 * A szakkönyv vásárlási címe. A tulajdonosok MÉG NEM adták meg (WP49, nyitott
 * tétel): amíg `null`, a kártya a /kapcsolat oldalra visz érdeklődő
 * felirattal. Kitalált vagy helykitöltő URL TILOS (CLAUDE.md).
 */
export const SZAKKONYV_URL: string | null = null

/** A szakkönyv-kártya tartalék célja, amíg nincs vásárlási cím. */
export const SZAKKONYV_ERDEKLODES_PATH = '/kapcsolat'

/** A képzés-kártya célja: a ProBody kézworkshop külső oldala (menu-seed). */
export const KEPZES_URL = PROFESSIONAL_TRAINING_URL

export interface SzakembereknekCta {
  readonly href: string
  /** A §3.2 szótár felirata (`ctaLabel`). */
  readonly label: string
  /** Külső oldalra visz: új lapon nyílik, jelöléssel (WCAG 2.2 SC 3.2.5). */
  readonly external: boolean
}

/** A képzés-kártya gombja: mindig a külső workshop-oldal (§3.2 #41). */
export function resolveKepzesCta(): SzakembereknekCta {
  return { href: KEPZES_URL, label: ctaLabel('workshop-open'), external: true }
}

/**
 * A szakkönyv-kártya gombja: ha van vásárlási cím, arra visz (§3.2 #42);
 * ha nincs, a kapcsolat-oldalra, érdeklődő felirattal (§3.2 #43).
 */
export function resolveSzakkonyvCta(url: string | null = SZAKKONYV_URL): SzakembereknekCta {
  if (url === null) {
    return { href: SZAKKONYV_ERDEKLODES_PATH, label: ctaLabel('book-inquiry'), external: false }
  }
  return { href: url, label: ctaLabel('book-open'), external: /^https?:\/\//i.test(url) }
}

/** A lapfej felső kis felirata (`kc-eyebrow`): a lap célközönsége, a kódban. */
export const SZAKEMBEREKNEK_EYEBROW = 'Gyógytornászoknak és terapeutáknak'

/**
 * A lapfej bevezetője, betűre a WP49 lap szövege. A CMS-rekord Rövid
 * bevezetője írja felül; üresen vagy rekord nélkül ez áll a lapon.
 */
export const SZAKEMBEREKNEK_LEAD =
  'Ha gyógytornászként vagy terapeutaként dolgozol a kézzel, két úton mélyítheted a tudásod nálunk. Válaszd a képzést, ha gyakorlatban tanulnál, vagy a szakkönyvet, ha a szakmai hátteret a saját tempódban olvasnád át.'

/** A szakkönyv „még nem kapható” állapot-szövege, betűre a WP49 lapé. */
export const SZAKKONYV_ALLAPOT_SZOVEG =
  'A vásárlás lehetőségét hamarosan közzétesszük. Addig kérdezz tőlünk, és szólunk, amint elérhető.'

/** A kapcsolat-oldali szakkönyv-cél jegyzete: a „hova jutok” válasz (WCAG 2.2 SC 2.4.4). */
export const SZAKKONYV_KAPCSOLAT_JEGYZET = 'A kapcsolat-oldalunkra visz.'

/**
 * A /szakembereknek lap két kártyája az „Ajánlat-kártyák” blokk (offerCards,
 * src/blocks/offer-cards.ts) szerződése szerint. Két helyen él:
 * - a route kódtartaléka, ha nincs „szakembereknek” webcímű Oldalak-rekord,
 *   vagy a szekciósorában nincs látható szekció: így a lap a WP49 lapja;
 * - a tartalom-szabály adata (src/scripts/szakembereknek-oldal.ts), amely a
 *   rekordot ebből hozza létre: a szerkesztő a mai szövegből indul.
 *
 * A blokk címe, felső felirata és bevezetője SZÁNDÉKOSAN üres: a lapfejet
 * (felső felirat, H1, bevezető) a route adja, így a kártyák címe H2 marad
 * (WCAG 2.2 SC 1.3.1, a WP49 lap H1 → kártya-H2 szerkezete).
 *
 * A feliratok a §3.2 szótárból jönnek (`ctaLabel`, a `resolve…Cta` feloldókon
 * át). A szakkönyvé a vásárlási cím szerint: cím nélkül #43 és a /kapcsolat
 * („még nem kapható” állapottal), címmel #42 és a vásárlási oldal. Kitalált
 * szakkönyv-URL tilos, ezért a paraméter alapértéke a `SZAKKONYV_URL`.
 */
export function szakembereknekAlapBlokk(
  szakkonyvUrl: string | null = SZAKKONYV_URL,
): BlockOfferCards {
  const kepzes = resolveKepzesCta()
  const szakkonyv = resolveSzakkonyvCta(szakkonyvUrl)
  const nincsVasarlasiCim = szakkonyvUrl === null
  return {
    blockType: 'offerCards',
    eyebrow: null,
    title: null,
    lead: null,
    kartyak: [
      {
        ikon: 'kepzes',
        kicker: 'Képzés',
        cim: 'Akkreditált kézrehabilitációs képzés',
        szoveg:
          'Tantermi képzés a kéz, a csukló- és a könyökízület rehabilitációjáról, gyógytornászoknak, orvosoknak, mozgásterapeutáknak és edzőknek, a ProBody Stúdióval együttműködve.',
        tenyek: [
          { szoveg: '12 kreditpont (SZTK-A-33553/2024)' },
          { szoveg: 'Az időpontokat és a díjat a ProBody Stúdió oldalán találod' },
        ],
        felirat: kepzes.label,
        url: kepzes.href,
        ujAblakban: kepzes.external,
        gombSuly: 'elsodleges',
        jegyzet: null,
        hamarosan: false,
        allapotSzoveg: null,
      },
      {
        ikon: 'szakkonyv',
        kicker: 'Szakkönyv',
        cim: 'A Kineticare szakkönyve',
        szoveg:
          'A Kineticare gyógytornászainak szakkönyve a kézrehabilitációról, kollégáknak: a szakmai háttér, amit a saját tempódban olvashatsz át.',
        tenyek: [],
        felirat: szakkonyv.label,
        url: szakkonyv.href,
        ujAblakban: szakkonyv.external,
        gombSuly: 'masodlagos',
        jegyzet: nincsVasarlasiCim ? SZAKKONYV_KAPCSOLAT_JEGYZET : null,
        hamarosan: nincsVasarlasiCim,
        allapotSzoveg: nincsVasarlasiCim ? SZAKKONYV_ALLAPOT_SZOVEG : null,
      },
    ],
    sectionSettings: { visible: true, hatter: 'feher' },
  }
}
