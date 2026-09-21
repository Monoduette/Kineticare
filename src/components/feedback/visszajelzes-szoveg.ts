/**
 * VISSZAJELZÉS (WP65) — a vevői hibajelző doboz SZÖVEGEI, egyetlen helyen.
 *
 * MIÉRT KONSTANS, NEM BEÉGETETT JSX: a mikroszöveget a vezető hagyta jóvá,
 * és őr-teszt méri (`src/__tests__/visszajelzes-ui.test.tsx`), hogy bitre ez
 * áll a felületen. Ha a szöveg a JSX-ben szóródna szét, az ellenőrzés
 * „valahol benne van a HTML-ben" szintre csúszna vissza.
 *
 * A NYELV. Natív magyar, tegező, gondolatjel nélkül: a magyar tipográfiában
 * a kvirtmínusz (U+2014) nem írásjel, és a tulajdonos kifejezetten tiltotta a
 * gondolatjel-halmozó, fordítás-ízű írásmódot
 * (`docs/ui-sztenderdek.md` §3.1.1–3.1.2; `.claude/skills/termektervezes` 2.).
 *
 * A HIBAÜZENET FORMÁJA. GOV.UK, *Error messages*: a hibaüzenet mondja meg, mi
 * a baj és mit tegyen a látogató, ne kérjen bocsánatot és ne hibáztasson
 * (https://design-system.service.gov.uk/components/error-message/). NN/g,
 * *Error-Message Guidelines*: „Display the error message close to the error's
 * source" és „Take a positive tone and don't blame the user"
 * (https://www.nngroup.com/articles/error-message-guidelines/). Ezt a repóban
 * a G-UI7 őr tartatja be (`Kérjük`, `Sajnos`, `Érvénytelen`, `Hopp`, hibakód).
 *
 * A KÉT KÉRDÉS. GOV.UK „Report a problem with this page" mintája két szabad
 * szöveges mezőt tesz fel: mit csináltál, és mi ment félre
 * (https://github.com/alphagov/govuk-design-guide/blob/main/docs/components/feedback.md).
 * Az első opcionális (a kontextus hasznos, de nem kötelezhető), a második
 * kötelező: e nélkül a bejelentés nem visz információt.
 */

/** A dialógus címe (a `aria-labelledby` erre a látható címsorra mutat). */
export const VISSZAJELZES_CIM = 'Mi a probléma?'

/** Felvezető mondat a cím alatt: mit kérünk, és mi lesz vele. */
export const VISSZAJELZES_BEVEZETO = 'Írd le, mi nem működik. Elolvassuk, és javítjuk.'

/** 1. kérdés (OPCIONÁLIS) — a GOV.UK „what were you doing?" mezője. */
export const VISSZAJELZES_MIT_CSINALTAL_CIMKE = 'Mit csináltál, amikor a hiba történt?'

/** 2. kérdés (KÖTELEZŐ) — a GOV.UK „what went wrong?" mezője. */
export const VISSZAJELZES_MI_TORTENT_CIMKE = 'Mi történt?'

/**
 * Segédszöveg a kötelező mező alatt.
 *
 * MIÉRT ÁLL ITT. A bejelentés egy kézrehabilitációs oldalról érkezik, ahol a
 * látogató könnyen írna panaszt vagy diagnózist a hibaleírás mellé. Az ilyen
 * adat a GDPR 9. cikke szerinti különleges kategória, és a bejelentésnek
 * semmilyen célja nem kívánja meg. A mezőt ezért a beírás ELŐTT címkézzük meg
 * (adattakarékosság, GDPR 5. cikk (1) c).
 */
export const VISSZAJELZES_MI_TORTENT_SUGO = 'Ne írj ide személyes vagy egészségügyi adatot.'

/**
 * A kötelező mező hibaüzenete.
 *
 * Nem „Érvénytelen" és nem „Kötelező mező": megmondja, MIT tegyen a látogató
 * (GOV.UK error messages; G-UI7 őr).
 */
export const VISSZAJELZES_MI_TORTENT_HIBA = 'Írd le, mi történt.'

/**
 * A „miért nincs e-mail-mező" magyarázata.
 *
 * SZÁNDÉKOS DÖNTÉS, nem feledékenység. Az oldalnak EGY válaszcsatornája van, a
 * /kapcsolat űrlap (`docs/informacios-architektura.md`); egy második,
 * párhuzamos „írd ide a címed" mező ugyanarra a célra két utat adna, ami a
 * WCAG 2.2 SC 3.2.4 (Consistent Identification) szellemével is szemben áll.
 * A másik ok adatvédelmi: a bejelentéshez PostHog-azonosító tartozik, és a
 * `src/lib/analytics/posthog.ts` fejlécében rögzített szabály szerint
 * személyes adat (e-mail, név, IP) nem kerülhet az esemény mellé. Ha nem
 * kérünk címet, nincs is mit kiszivárogtatni.
 */
export const VISSZAJELZES_VALASZ_INFO =
  'E-mail-címet nem kérünk, a bejelentés a csapathoz jut. Ha választ is szeretnél, írj a Kapcsolat oldalon.'

/**
 * A „küldés folyamatban" állapot SZÖVEGES alakja az élő régióban.
 *
 * A GOMB felirata ettől külön él: az a ZÁRT L-1 lista `Küldés…` eleme
 * (`src/lib/cta-vocabulary.ts`). Azért kell mindkettő, mert a gombfelirat
 * rövid jelzés, a képernyőolvasónak viszont egész mondat kell, és a
 * `role="status"` régió változását hallja meg, nem a gomb átírását
 * (WCAG 2.2 SC 4.1.3 Status Messages:
 * https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
 */
export const VISSZAJELZES_KULDES_ALLAPOT = 'Küldés folyamatban'

/** Siker: rövid nyugta, köszönettel. Ez lesz a fókuszált címsor is. */
export const VISSZAJELZES_SIKER_CIM = 'Megkaptuk. Köszönjük, hogy szóltál.'

/** Siker, második mondat: hova menjen, ha választ is vár. */
export const VISSZAJELZES_SIKER_SZOVEG =
  'Választ erre a bejelentésre nem küldünk. Ha beszélnél velünk, írj a Kapcsolat oldalon.'

/** Beküldési hiba: mi történt, és mi a két következő lépés. */
export const VISSZAJELZES_HIBA =
  'Most nem sikerült elküldeni. Próbáld újra, vagy írj a Kapcsolat oldalon.'

/** A kapcsolati oldal útvonala (a dialógus egyetlen kifelé mutató linkje). */
export const KAPCSOLAT_UTVONAL = '/kapcsolat'

/**
 * A beküldő végpont. A szerveroldalt másik ügynök építi; a kliens ezt az
 * útvonalat és az alábbi `VisszajelzesAdat` alakot ismeri.
 */
export const VISSZAJELZES_VEGPONT = '/api/visszajelzes'

/** A dialógus MINDEN látogatói szövege — az őr-teszt ezen a listán mér. */
export const VISSZAJELZES_SZOVEGEK = [
  VISSZAJELZES_CIM,
  VISSZAJELZES_BEVEZETO,
  VISSZAJELZES_MIT_CSINALTAL_CIMKE,
  VISSZAJELZES_MI_TORTENT_CIMKE,
  VISSZAJELZES_MI_TORTENT_SUGO,
  VISSZAJELZES_MI_TORTENT_HIBA,
  VISSZAJELZES_VALASZ_INFO,
  VISSZAJELZES_KULDES_ALLAPOT,
  VISSZAJELZES_SIKER_CIM,
  VISSZAJELZES_SIKER_SZOVEG,
  VISSZAJELZES_HIBA,
] as const
