/**
 * A kezdőlapi „Ingyenes villámkurzus sáv” (`freeSos` blokk) nagy címének
 * EGYETLEN feloldója.
 *
 * MIÉRT KÜLÖN MODUL (modul-térkép H07 és H46, terv 2. és 5. szakasz, „Egy
 * mező, egy feloldó”): a lap, az admin sorcímkéje, a frontend szerkesztői
 * szalagja és a gépi olvasás (llms-full.txt) ugyanazt a szabályt hívja, így a
 * „hasonló, de más” cím szerkezetileg nem jöhet létre újra. Korábban a sáv a
 * rögzített konstanst mutatta, a sorcímke és az llms-full.txt pedig a nyers
 * CMS-címet („SOS Kézrelax — ingyenes villámkurzus”), vagyis ugyanazt a
 * szekciót három helyen kétféle néven nevezte.
 * - WCAG 2.2 SC 3.2.4 Consistent Identification: „Components that have the
 *   same functionality within a set of web pages are identified
 *   consistently.” https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html
 * - NN/g, Consistency and Standards: „Users should not have to wonder whether
 *   different words, situations, or actions mean the same thing.”
 *   https://www.nngroup.com/articles/consistency-and-standards/
 *
 * TISZTA MODUL, import nélkül: nincs React, next, Payload és szerveroldali
 * függőség, ezért a kliensoldali admin-komponens (sorcímke) és a szerveroldali
 * route is behúzhatja. Az őr: src/__tests__/free-sos-cim.test.tsx.
 *
 * A megjelenítés a mentett CMS-szöveget nem írja át: a cím trimmelve jelenik
 * meg, a gondolatjeles régi értéket az adatban javítja az előtöltő szabály
 * (src/scripts/sos-cim-kitoltes.ts).
 */

/**
 * A sáv címének TARTALÉKA: akkor áll, ha a blokk `title` mezője üres vagy csak
 * szóköz (a mező kötelező, üresen csak piszkozatban maradhat).
 *
 * A tulajdonos 2026-09-07-i szava: „‚Ingyenes villámkurzus’ nagyon rövid
 * leírással”. A cím egyben az ár-tény is (ingyenes), a sáv legnagyobb
 * szövegén. A konstans a FreeSos.tsx-ből költözött ide; a komponens
 * változatlan néven továbbadja (re-export), a meglévő importok ezért nem
 * változnak.
 */
export const FREE_SOS_STRIP_TITLE = 'Ingyenes villámkurzus'

/**
 * A sáv semleges címe, ha nincs elérhető ingyenes SOS-kurzus: ilyenkor a
 * CMS-ben maradt SOS-cím elavult ígéret lenne, a gomb pedig a kurzuslistára
 * visz (FreeSos.tsx `resolveFreeSosCta`).
 */
export const FREE_SOS_NEUTRAL_TITLE = 'Kurzusaink'

/** A blokk `title` mezője trimmelve, ha valóban szöveg és nem üres. */
function cmsCim(block: unknown): string | null {
  if (typeof block !== 'object' || block === null || Array.isArray(block)) {
    return null
  }
  const title: unknown = (block as Readonly<Record<string, unknown>>).title
  if (typeof title !== 'string') {
    return null
  }
  const trimmed = title.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * A sáv h2-jének szövege.
 *
 * @param block          a `freeSos` blokk adata (a REST, a Local API vagy az
 *                       admin űrlapállapota); csak a `title` mezőt olvassa
 * @param vanIngyenesSos van-e a lapon elérhető ingyenes SOS-kurzus; a lap ezt
 *                       a publikált, látható termékekből dönti el
 *                       (`isAvailableSosProduct`, src/lib/sos-offer.ts)
 * @returns ingyenes SOS-nál a trimmelt CMS-cím, üresen `FREE_SOS_STRIP_TITLE`;
 *          SOS nélkül `FREE_SOS_NEUTRAL_TITLE` („Kurzusaink”)
 */
export function freeSosStripTitle(block: unknown, vanIngyenesSos: boolean): string {
  if (!vanIngyenesSos) {
    return FREE_SOS_NEUTRAL_TITLE
  }
  return cmsCim(block) ?? FREE_SOS_STRIP_TITLE
}
