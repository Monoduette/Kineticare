/**
 * Ingyenes kurzus igénylése — a LÁTOGATÓNAK MEGJELENŐ szövegek, egy helyen.
 *
 * MIÉRT KÜLÖN MODUL: ugyanaz a mondat több helyen jelenik meg (űrlap,
 * siker-nézet, teszt), és a mikroszöveg-szabályokat (docs/ui-sztenderdek.md
 * §2.7 és §3.1) csak akkor lehet ŐRIZNI, ha a szöveg nem a JSX-be van
 * szétszórva. A hírlevél `consent-text.ts`-ének mintája, kibővítve a folyamat
 * összes állapotüzenetével.
 *
 * A SZABÁLYOK, amiket ezek a szövegek betartanak:
 *  - töltelék gondolatjel (– vagy —) SEHOL (§3.1.1–3.1.2, tulajdonosi kikötés);
 *  - „Kérjük" SEHOL: a GOV.UK szerint a „please" választást sugall ott, ahol
 *    nincs választás (§2.7, A/9);
 *  - a hibaüzenet megmondja, MI történt és MI a következő lépés (§2.7);
 *  - a magyarázó szöveg TEGEZ (E/2, P-1b), a beküldő gomb E/1 (P-1a) — a
 *    felirat indoklása és forrásai a `FREE_COURSE_SUBMIT_LABEL` kommentjében;
 *  - a folyamatban-felirat a ZÁRT L-1 készletből jön
 *    (`src/lib/cta-vocabulary.ts` `CTA_PROGRESS_LABELS.send` = „Küldés…").
 */

import { ctaLabel } from '../cta-vocabulary'

/**
 * Beküldő gomb: „Kérem a kurzust" (E/1) — vállalás, nem navigáció (#3 vs #25); CTA szótárban.
 */
export const FREE_COURSE_SUBMIT_LABEL = ctaLabel('free-course-request')

/** Az adatkezelési tájékoztató útvonala (a lábléc jogi linkjeivel azonos). */
export const PRIVACY_POLICY_PATH = '/adatvedelem'

/** A kapcsolati oldal — ide küldjük a látogatót, ha a levél nem tud kimenni. */
export const CONTACT_PATH = '/kapcsolat'

/**
 * Az űrlap bevezetője. Kimondja, hogy INGYENES (a felirat és a valóság
 * egyezzen), és megmondja, mi történik a beküldés után. GOV.UK: a lap mondja
 * el előre a következő lépést, ne a beküldés után derüljön ki.
 */
export const FREE_COURSE_INTRO =
  'A kurzus ingyenes, fizetned nem kell érte. Add meg a neved és az e-mail-címed. Új címre belépő linket küldünk; ha már van fiókod, a levélben leírjuk a következő lépést.'

/** Mezőfeliratok — a kapcsolat-űrlap szóhasználatával azonos (WCAG 3.2.4). */
export const FREE_COURSE_NAME_LABEL = 'Név'
export const FREE_COURSE_EMAIL_LABEL = 'E-mail-cím'

/**
 * Az e-mail-mező súgója. Baymard: mondd meg, MIRE használod a mezőt; ez a
 * bizalmi kifogást („mit fogtok küldeni?") a mező mellett oldja fel.
 */
export const FREE_COURSE_EMAIL_HINT =
  'Erre a címre küldjük a belépő vagy a belépési útmutató levelet.'

/**
 * Az adatkezelési hozzájárulás szövege, linkkel a tájékoztatóra. A GDPR
 * tájékoztatási követelménye: a látogató a hozzájárulás ELŐTT, egy
 * kattintással érje el a tájékoztatót.
 */
export const FREE_COURSE_CONSENT_TEXT = {
  before:
    'Hozzájárulok, hogy a Kineticare a nevemet és az e-mail-címemet a kurzus-hozzáférés létrehozásához és a belépő link kiküldéséhez kezelje az ',
  linkLabel: 'Adatkezelési és adatvédelmi szabályzat',
  after: ' szerint. A hozzájárulás bármikor visszavonható.',
} as const

/**
 * A hozzájárulás alatti megnyugtató sor. Egészségügyi kontextusban ez nem
 * díszítés: a látogató jogosan tart attól, hogy panaszt vagy diagnózist kell
 * megadnia. Az űrlap TÉNYLEG nem kér ilyet (GDPR 9. cikk szerinti különleges
 * adatot nem kezelünk ebben a folyamatban), tehát a mondat igaz.
 */
export const FREE_COURSE_CONSENT_HINT = 'Egészségi állapotra vonatkozó adatot nem kérünk.'

/**
 * A siker-nézet ága. A nyilvános HTTP-válasz vendégnél csak `{ ok, emailSent }`:
 * a `next` CSAK bejelentkezett hívónak megy (fiók-felderítés ellen).
 *
 * Forrás: GOV.UK, Confirm a user exists (a nyilvános válasz maradjon semleges)
 * https://design-system.service.gov.uk/patterns/confirm-a-user-exists/ ;
 * NN/g, Error-message guidelines (mondd meg, mi történt)
 * https://www.nngroup.com/articles/error-message-guidelines/ ;
 * WCAG 2.2 · 3.3.1 Error Identification
 * https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html
 */
export type FreeCourseUiNext = 'library' | 'email' | 'blocked'

export type FreeCourseSuccessKind = 'library' | 'email' | 'no-email' | 'blocked'

export function resolveFreeCourseSuccessKind(input: {
  next?: FreeCourseUiNext | null
  emailSent: boolean
}): FreeCourseSuccessKind {
  if (input.next === 'library') {
    return 'library'
  }
  if (input.next === 'blocked') {
    return 'blocked'
  }
  return input.emailSent ? 'email' : 'no-email'
}

/** Siker, bejelentkezett vevő: a grant megvan, levél nincs. */
export const FREE_COURSE_LIBRARY_TITLE = 'A kurzusod megvan'
export const FREE_COURSE_LIBRARY_BODY =
  'A hozzáférésed elkészült. Nyisd meg a kurzust, és azonnal indulhat.'

/** Siker-szerű, de owner/staff fiók: nem írunk hozzáférést. */
export const FREE_COURSE_BLOCKED_TITLE = 'Ezzel a fiókkal nem adható hozzá a kurzus'
export const FREE_COURSE_BLOCKED_BODY =
  'Munkatársi vagy tulajdonosi fiókkal az ingyenes kurzust nem tudjuk ide írni. Lépj be a vevői fiókoddal, vagy írj nekünk.'

/**
 * Siker, levél kiment. Vendégnél SZÁNDÉKOSAN fedi az új címet és a meglévő
 * fiókot: a nyilvános válasz nem árulhatja el, van-e már fiók.
 */
export const FREE_COURSE_SUCCESS_TITLE = 'Nézd meg a postaládád'
export const FREE_COURSE_SUCCESS_BODY =
  'Ha ez a cím új, belépő linket küldtünk: azzal jelszót állítasz, utána a kurzusod megnyílik. Ha már van fiókod, a levélben leírtuk, hogyan kérheted a kurzust belépés után. Ha pár percen belül nem érkezik meg, nézd meg a levélszemét mappát is.'

/**
 * Siker-szerű, de a levél NEM ment ki. Vendégnél nem állítjuk, hogy a
 * hozzáférés létrejött: aktivált fióknál nem is írtunk kurzust.
 */
export const FREE_COURSE_NO_EMAIL_TITLE = 'A kérésedet megkaptuk'
export const FREE_COURSE_NO_EMAIL_BODY =
  'A belépő levelet most nem tudjuk kiküldeni, mert a levélküldésünk éppen nem működik. Írj nekünk ugyanerről az e-mail-címről, és kézzel elküldjük a belépőt.'
/**
 * A „nem ment ki a levél" ág kisegítő hivatkozásának felirata.
 *
 * A §3.2 #33 szótári sorából olvas: a `/kapcsolat` oldalra vivő cselekvés
 * felirata a felület MINDEN pontján ugyanaz (WCAG 2.2 · 3.2.4). A korábbi
 * „Írj nekünk a kapcsolati oldalon" öt szó volt (M-3), és a köszönőoldal
 * „Segítséget kérek" / „Kapcsolat" gombjaival együtt HÁROM feliratot adott
 * ugyanarra a célra.
 */
export const FREE_COURSE_NO_EMAIL_LINK_LABEL = ctaLabel('contact-open')

/** Általános szerverhiba — a szerver válasza felülírhatja. */
export const FREE_COURSE_GENERIC_ERROR =
  'Az igénylés most nem sikerült. Próbáld újra néhány perc múlva, vagy írj nekünk a kapcsolati oldalon.'

/** Turnstile-kulcs mellett, még token nélküli állapotban ez az üzenet megy ki. */
export const FREE_COURSE_TURNSTILE_PENDING_ERROR =
  'Várd meg a spam-ellenőrzés befejezését, majd küldd el újra.'

/** Az űrlap fölött álló hiba-összefoglaló általános sora (mezőhibáknál). */
export const FREE_COURSE_ERROR_SUMMARY = 'Nézd át a megjelölt mezőket, majd küldd el újra.'

/** Pénztár ingyenes-kapu: tájékoztató szöveg, mert checkout/start elutasítja a 0 Ft-ot. */
export const FREE_COURSE_NOT_CHECKOUT_TEXT =
  'Ez a kurzus ingyenes, ezért nem a pénztáron át jár. A kurzus oldalán igényelheted: az űrlap rövid, és fizetned nem kell érte.'

/**
 * Ugyanaz az állapot annak, aki a hozzáférést MÁR megkapta. Igényelnie nincs
 * mit: a gomb a lejátszóra visz (§3.2 #8). Vendégként ez az ág nem fut: fiók
 * nélkül nincs mihez hasonlítani (a lap `alreadyPurchased`-e bejelentkezés
 * nélkül mindig hamis).
 *
 * Forrás: NN/g, Error Message Guidelines (mondd meg a következő lépést)
 * https://www.nngroup.com/articles/error-message-guidelines/ ;
 * WCAG 2.2 · 3.2.4 Consistent Identification
 * https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html
 */
export const FREE_COURSE_ALREADY_GRANTED_TEXT =
  'Ez a kurzus ingyenes, és a hozzáférésed már megvan. A lejátszóban éred el.'
