/**
 * A kapcsolati e-mail EGY forrása (modul-térkép H18/A10 és H46).
 *
 * A cím a `/kapcsolat` CMS-oldal (Oldalak, webcím: `kapcsolat`) ELSŐ LÁTHATÓ
 * Időpontkérő szekciójának „E-mail-cím” mezője; ha az üres, formailag hibás,
 * vagy a szekció rejtett, a kódtartalék. Minden fogyasztó ezt a láncot
 * használja: a lábléc, a (frontend) 404, az Organization JSON-LD minden lap
 * `@graph`-jában, az llms.txt és az llms-full.txt, és az átállási levél
 * Reply-To-ja. Így a szerkesztő egy helyen írja át, és a cím sehol nem
 * válik szét (NN/g, Consistency and Standards: „Users should not have to
 * wonder whether different words, situations, or actions mean the same
 * thing.” https://www.nngroup.com/articles/consistency-and-standards/).
 *
 * TISZTA modul: se Payload, se React, se Next import. A szerveroldali
 * lekérdezés a `contact-email-server.ts`-ben él; ezt a modult a kliens-közeli
 * és a DB nélküli kód (seo.ts, llms, 404-nézet) is betöltheti.
 *
 * A tartalék-literál CSAK itt áll a kódban (őr: kapcsolati-email-feloldo.test.ts,
 * forrás-pásztázás). Egyetlen kivétel: a src/scripts/restore-legacy-content.ts
 * Időpontkérő seed-ADATA, mert az maga a CMS-érték, nem kódtartalék.
 */

/** A kódtartalék: a CMS-mező hiányában, hibás alakjánál vagy DB-hibánál ez látszik. */
export const KAPCSOLATI_EMAIL_TARTALEK = 'info@kineticare.hu'

/** A kapcsolati e-mailt hordozó CMS-oldal webcíme (Oldalak → slug). */
export const KAPCSOLAT_OLDAL_WEBCIM = 'kapcsolat'

/**
 * Egy e-mail-cím legnagyobb hossza (RFC 5321 4.5.3.1.3: a teljes útvonal 256
 * oktett, a csúcsos zárójelek nélkül 254).
 */
const EMAIL_MAX_HOSSZ = 254

/**
 * Formailag érvényes cím: a WHATWG HTML „valid e-mail address” mintája
 * (https://html.spec.whatwg.org/multipage/input.html#valid-e-mail-address),
 * két szigorítással.
 * - A helyi részből kimarad a `?`, `&`, `#`, `%` és `/`: a cím `mailto:`
 *   linkbe kerül, ahol ezek a lekérdezés- és töredék-részt nyitják
 *   (RFC 6068 2. fejezet), így a mezőbe írt `info@x.hu?subject=…` nem
 *   injektálhat tárgyat vagy címzettet a levélíróba.
 * - A tartományban legalább egy pont kell (legfelső szintű tartomány), mert
 *   egy `info@localhost` alakú cím a vevőnek használhatatlan.
 */
const EMAIL_MINTA =
  /^[A-Za-z0-9.!$'*+=^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Formailag e-mail-cím-e a (már trimmelt) szöveg. */
export function ervenyesKapcsolatiEmail(ertek: string): boolean {
  return ertek.length <= EMAIL_MAX_HOSSZ && EMAIL_MINTA.test(ertek)
}

/**
 * Rejtett-e a szekció. Csak a kifejezett `visible: false` rejt, ugyanaz a
 * szabály, mint a lapon (RenderBlocks) és a sorcímkén
 * (src/lib/section-row-label.ts `isSectionHidden`); itt saját másolat áll,
 * mert az a modul a blokk-konfigurációt is betölti, ez pedig tiszta marad.
 */
function rejtettSzekcio(blokk: Record<string, unknown>): boolean {
  return isRecord(blokk.sectionSettings) && blokk.sectionSettings.visible === false
}

/**
 * A kapcsolati e-mail a `/kapcsolat` oldal szekciósorából: az ELSŐ LÁTHATÓ
 * Időpontkérő (`appointment`) blokk trimmelt `email` mezője, ha formailag
 * e-mail-cím; különben `null`. A második Időpontkérő akkor sem forrás, ha az
 * elsőé üres: a lapon is az első látható szekció címe áll a vevő előtt.
 */
export function kapcsolatiEmailLayoutbol(layout: unknown): string | null {
  if (!Array.isArray(layout)) return null
  for (const blokk of layout) {
    if (!isRecord(blokk) || blokk.blockType !== 'appointment' || rejtettSzekcio(blokk)) continue
    const email = typeof blokk.email === 'string' ? blokk.email.trim() : ''
    return email.length > 0 && ervenyesKapcsolatiEmail(email) ? email : null
  }
  return null
}

/** A feloldott kapcsolati e-mail: a CMS-mező, különben a kódtartalék. */
export function feloldottKapcsolatiEmail(layout: unknown): string {
  return kapcsolatiEmailLayoutbol(layout) ?? KAPCSOLATI_EMAIL_TARTALEK
}
