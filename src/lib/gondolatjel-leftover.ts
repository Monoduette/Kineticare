/**
 * Élő CMS-maradék a gondolatjel-söprésből.
 *
 * A seed és a HowItWorks beépített lépés már vesszős (`home-seed.ts`,
 * `HowItWorks.tsx`). A kezdőlap szekciósorát `ensureHomeLayout` meglévő
 * tartalomnál nem írja felül, ezért a production CMS 2026-09-06-án még a
 * töltelék jeleket szolgálta ki (mért: `kineticare-production.up.railway.app`).
 *
 * Csere KIZÁRÓLAG pontos egyezésre — más mondatot nem nyúlunk.
 * Vessző, nem gondolatjel: `docs/ui-sztenderdek.md` §3.1.3 (AkH. 249. a
 * közbevetés alapesete). Az U+2014 kvirtmínusz magyar szövegben nem írásjel
 * (ELTE Szabadbölcsészet, Szedés, mikrotipográfia).
 */

/** U+2014 a „megvásárolod" és a „bankkártyával" között. */
export const HOW_IT_WORKS_STEP1_LEFTOVER =
  'A panaszodhoz illő programot néhány kattintással megvásárolod — bankkártyával, biztonságosan.'

/** A surrounding „Így működik" lépések vesszős tagolását követi. */
export const HOW_IT_WORKS_STEP1_FIXED =
  'A panaszodhoz illő programot néhány kattintással megvásárolod, bankkártyával, biztonságosan.'

/** U+2013 a „gyógytornászoktól" és a „csukló-" között — kurzuskártya lead. */
export const COURSE_SHORT_DESCRIPTION_LEFTOVER =
  'Könnyen követhető, otthon is biztonságosan alkalmazható kézrehabilitációs program gyógytornászoktól – csukló-, ujj-, alkar- és könyökfájdalmakra, a saját tempódban, 50+ videós gyakorlattal.'

export const COURSE_SHORT_DESCRIPTION_FIXED =
  'Könnyen követhető, otthon is biztonságosan alkalmazható kézrehabilitációs program gyógytornászoktól, csukló-, ujj-, alkar- és könyökfájdalmakra, a saját tempódban, 50+ videós gyakorlattal.'

/** Pontos egyezésnél a két maradék jelet vesszőre cseréli; minden más szöveg érintetlen. */
export function rewriteVisitorDashLeftover(text: string): string {
  if (text === HOW_IT_WORKS_STEP1_LEFTOVER) return HOW_IT_WORKS_STEP1_FIXED
  if (text === COURSE_SHORT_DESCRIPTION_LEFTOVER) return COURSE_SHORT_DESCRIPTION_FIXED
  return text
}
