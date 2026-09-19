/**
 * A Tudástár kanonikus kategóriái és a cikk → kategória hozzárendelés.
 *
 * ═══ MIÉRT VAN EZ A MODUL ═══
 * A tulajdonosi kérés (2026-09-07): „A Tudástár címkéit (bilétáit) kérnénk
 * egységesíteni” és „minden elem label-lel legyen ellátva”. Mérve a betöltött
 * készleten: a nyolc cikk KÖZÜL EGYNEK SEM volt kategóriája (a `posts_rels`
 * tábla `categories` útvonalon üres volt), ezért minden kártya a PostCard
 * „Tudástár” tartalék-címkéjét viselte, a `/blog` kategória-szűrője pedig
 * meg sem jelent. Élesben ugyanez vegyesen is előfordulhat (egy cikknek van,
 * másiknak nincs), és pontosan az a „nem egységes” állapot.
 *
 * A kategória-rendszer NEM új találmány: a `docs/tudastar-tartalmi-terv.md`
 * 3. szakasza a cikkírás ELŐTT rögzítette a három kategóriát és cikkenként
 * a besorolást (a slug utólagos átírása webcímet tör). Ez a modul azt a
 * döntést teszi géppel ellenőrizhetővé: a betöltő innen olvassa a
 * hozzárendelést, az őr-teszt (`src/__tests__/tudastar-kategoriak.test.ts`)
 * pedig kimondja, hogy MINDEN importált cikknek PONTOSAN EGY kategóriája van.
 *
 * ═══ MIÉRT PONTOSAN EGY KATEGÓRIA CIKKENKÉNT ═══
 * A kártyán egyetlen címke áll (`docs/tudastar-ux-terv.md` 3.2: „Pontosan
 * egy, az első kategória. Több címke tördel, és a kártyák magassága
 * szétcsúszik”). A `posts.categories` mező `hasMany`, ez sémailag marad
 * (nincs migráció); a betöltő viszont egyelemű tömböt ír, és a
 * `postCardLabel` az elsőt mutatja. Forrás a címke-elvhez:
 *  - GOV.UK Design System, Tag: „If you use the same tag in more than one
 *    place, make sure you keep the colour consistent” és „Do not make a tag
 *    interactive by making it into a link or button”
 *    (https://design-system.service.gov.uk/components/tag/).
 *  - WCAG 2.2 SC 3.2.4 Consistent Identification (AA): „Components that have
 *    the same functionality within a set of web pages are identified
 *    consistently” (https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html).
 *  - WCAG 2.2 SC 1.4.3 Contrast (Minimum): a címke kis, félkövér szöveg, tehát
 *    a 4,5:1-es küszöb áll rá; a `.kc-badge--info` páros 8,49:1 (tokens.css).
 *
 * ═══ A HÁROM KATEGÓRIA ═══
 * Testtáj szerinti, kevés, jól elkülönülő halmaz (`docs/szerkesztoi-utmutato.md`
 * 5.). A „Váll és könyök” azért egy kategória, mert a kettő együtt adja ki a
 * felső végtagi láncot, és így az 1. hullámban is élő, többcikkes kategória
 * (tartalmi terv 3.). A seedből létező „Tudástár” (`tudastar`) kategóriát a
 * modul NEM bántja és NEM használja: az a lista neve, nem téma.
 */

export interface TudastarKategoria {
  /** A kategória webcím-slugja (`/blog/kategoria/<slug>`); utólag NEM írható át. */
  readonly slug: string
  /** A kategória neve, ahogy a kártya-címkén és a szűrő-chipen áll. */
  readonly title: string
}

/** A Tudástár három kanonikus, `type: 'content'` kategóriája. */
export const TUDASTAR_KATEGORIAK: readonly TudastarKategoria[] = [
  { slug: 'kez-es-csuklo', title: 'Kéz és csukló' },
  { slug: 'vall-es-konyok', title: 'Váll és könyök' },
  { slug: 'tores-es-mutet-utan', title: 'Törés és műtét után' },
]

/**
 * Cikk-slug → kategória-slug. A tartalmi terv 3. szakaszának táblája, a
 * 7. és 8. cikk esetében a cikkfájl fejlécében rögzített kategóriával
 * (`docs/cikkek/7-…md`, `8-…md` „Kategória” sora) azonosan.
 *
 * Új cikk felvételekor ide IS fel kell venni; az őr-teszt különben bukik
 * (nem lehet kategória nélküli importált cikk).
 */
export const CIKK_KATEGORIA: Readonly<Record<string, string>> = {
  'miert-zsibbad-a-kezem': 'kez-es-csuklo',
  'keztoalagut-szindroma': 'kez-es-csuklo',
  teniszkonyok: 'vall-es-konyok',
  'pattano-ujj': 'kez-es-csuklo',
  'csuklo-es-kezfajdalom': 'kez-es-csuklo',
  'csuklotores-utani-gyogytorna': 'tores-es-mutet-utan',
  inhuvelygyulladas: 'kez-es-csuklo',
  'befagyott-vall': 'vall-es-konyok',
  // Tulajdonosi blogötletek (2026-09-19), a cikkfájl fejlécében rögzített
  // kategóriával azonosan (őr-teszt T3).
  'peace-and-love-friss-serules': 'kez-es-csuklo',
  'gipszben-a-kezed': 'tores-es-mutet-utan',
}

/** A kategória a slugja alapján, vagy `undefined`, ha nincs ilyen. */
export function kategoriaBySlug(slug: string): TudastarKategoria | undefined {
  return TUDASTAR_KATEGORIAK.find((kategoria) => kategoria.slug === slug)
}

/**
 * A cikkhez rendelt kategória. Ismeretlen cikk-slugra DOB: a betöltő nem
 * írhat kategória nélküli cikket, és a néma kihagyás pont az a hiba, amit a
 * tulajdonos jelzett.
 */
export function kategoriaForCikk(cikkSlug: string): TudastarKategoria {
  const kategoriaSlug = CIKK_KATEGORIA[cikkSlug]
  const kategoria = kategoriaSlug === undefined ? undefined : kategoriaBySlug(kategoriaSlug)
  if (kategoria === undefined) {
    throw new Error(
      `A(z) „${cikkSlug}” cikkhez nincs kategória a src/lib/tudastar-kategoriak.ts ` +
        'CIKK_KATEGORIA táblájában. Minden importált cikknek pontosan egy kategória kell.',
    )
  }
  return kategoria
}

/**
 * A kártya-címke szövege: az ELSŐ feloldott kategória neve. Ha nincs
 * (élesben egy kézzel felvett, besorolatlan cikknél előfordulhat), a
 * tartalék a tartalomtár neve, „Tudástár”: igaz állítás, nem kitalált
 * besorolás. Az importált készletben ilyen cikk nincs (őr-teszt).
 *
 * A kategória-hivatkozás lehet fel nem oldott id (`number`) vagy populate-olt
 * dokumentum; csak a dokumentum nem üres címe számít.
 */
export const TUDASTAR_TARTALEK_CIMKE = 'Tudástár'

export function postCardLabel(categories: unknown): string {
  if (!Array.isArray(categories)) return TUDASTAR_TARTALEK_CIMKE
  for (const kategoria of categories) {
    if (typeof kategoria !== 'object' || kategoria === null) continue
    const title = (kategoria as { title?: unknown }).title
    if (typeof title === 'string' && title.trim().length > 0) {
      return title.trim()
    }
  }
  return TUDASTAR_TARTALEK_CIMKE
}
