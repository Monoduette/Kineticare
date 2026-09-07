/**
 * Élő CMS-maradék a gondolatjel-söprésből.
 *
 * A seed és a HowItWorks beépített lépés már vesszős (`home-seed.ts`,
 * `HowItWorks.tsx`). A kezdőlap szekciósorát `ensureHomeLayout` meglévő
 * tartalomnál nem írja felül, ezért a production CMS 2026-09-06-án még a
 * töltelék jeleket szolgálta ki (mért: `kineticare-production.up.railway.app`).
 * A /rolunk szekciósorát az `ensurePageLayout` ugyanígy nem írja felül, így a
 * 2026-09-07 előtti seed harmonika-címei és bevezetője is élő maradék.
 *
 * Csere KIZÁRÓLAG pontos egyezésre — más mondatot nem nyúlunk.
 * Vessző, nem gondolatjel: `docs/ui-sztenderdek.md` §3.1.3 (AkH. 12. kiadás
 * 250–251.: a gondolatjel közbevetést és tagolt gondolatváltást jelöl,
 * felsorolás-elválasztóként vagy cím–alcím kötőjeleként nem áll —
 * https://helyesiras.mta.hu/helyesiras/default/akh12#F250). Az U+2014
 * kvirtmínusz magyar szövegben nem írásjel (ELTE Szabadbölcsészet, Szedés,
 * mikrotipográfia).
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

/**
 * A /rolunk „Részletes szakmai háttér" harmonika 2026-09-07 előtti seed-szövegei
 * (U+2014 a név és a „szakmai önéletrajz" között, illetve a bevezetőben).
 * A javított alak birtokos szerkezet („Kocsis Kata szakmai önéletrajza"), a
 * bevezető felsorolása kettősponttal áll — a gondolatjel egyik helyen sem
 * közbevetést jelölt.
 */
export const ROLUNK_ACCORDION_LEFTOVERS: ReadonlyArray<readonly [string, string]> = [
  ['Kocsis Kata — szakmai önéletrajz', 'Kocsis Kata szakmai önéletrajza'],
  ['Kiss Kata — szakmai önéletrajz', 'Kiss Kata szakmai önéletrajza'],
  [
    'A teljes szakmai életutunk — tanulmányok, továbbképzések, publikációk, előadások és médiamegjelenések. Nyisd ki, amelyik érdekel.',
    'A teljes szakmai életutunk: tanulmányok, továbbképzések, publikációk, előadások és médiamegjelenések. Nyisd ki, amelyik érdekel.',
  ],
]

/**
 * A /rolunk többi 2026-09-07 előtti seed-maradéka (bemutatkozó statisztika,
 * „Miben segíthetünk?" sorok, a bevezető első bekezdése). A megjelenítő
 * komponensek ezekhez ma nem nyúlnak; az élő szekciósort a
 * `LEGACY_GONDOLATJEL=igen` kapu (restore-legacy-content.ts) javítja pontos
 * egyezésre, a seed pedig már a javított alakot teszi le.
 */
export const ROLUNK_SZEKCIO_LEFTOVERS: ReadonlyArray<readonly [string, string]> = [
  [
    'kreditpont — akkreditált képzés (SZTK-A-33553/2024)',
    'kreditpont, akkreditált képzés (SZTK-A-33553/2024)',
  ],
  ['Rendelői kezelések – személyesen', 'Rendelői kezelések, személyesen'],
  ['Otthoni program – online', 'Otthoni program, online'],
  ['Szakmai képzések – kollégáknak', 'Szakmai képzések, kollégáknak'],
  [
    '– és igazából neked is. Akinek nem fáj a keze, talán bele sem gondol, hogy szinte minden ébren töltött percben használjuk a kezünket valamire.',
    'És igazából neked is. Akinek nem fáj a keze, talán bele sem gondol, hogy szinte minden ébren töltött percben használjuk a kezünket valamire.',
  ],
  // A lap fejléc-bevezetője (Pages.excerpt, a hero-lead): a felsorolás elé
  // kettőspont való, nem gondolatjel.
  [
    'Kocsis Kata és Kiss Kata vagyunk, a KINETICARE alapítói – gyógytornászok, manuálterapeuták és sportrehabilitációs trénerek, évek óta elsősorban a kéz rehabilitációjával foglalkozunk.',
    'Kocsis Kata és Kiss Kata vagyunk, a KINETICARE alapítói: gyógytornászok, manuálterapeuták és sportrehabilitációs trénerek, évek óta elsősorban a kéz rehabilitációjával foglalkozunk.',
  ],
]

const LEFTOVER_MAP: ReadonlyMap<string, string> = new Map([
  [HOW_IT_WORKS_STEP1_LEFTOVER, HOW_IT_WORKS_STEP1_FIXED],
  [COURSE_SHORT_DESCRIPTION_LEFTOVER, COURSE_SHORT_DESCRIPTION_FIXED],
  ...ROLUNK_ACCORDION_LEFTOVERS,
  ...ROLUNK_SZEKCIO_LEFTOVERS,
])

/** Pontos egyezésnél a maradék jelet vesszőre (vagy természetes alakra) cseréli; minden más szöveg érintetlen. */
export function rewriteVisitorDashLeftover(text: string): string {
  return LEFTOVER_MAP.get(text) ?? text
}
