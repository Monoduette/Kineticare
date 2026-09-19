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
