/**
 * CTA-szótár — docs/ui-sztenderdek.md §3.2 egyetlen kódbeli igazságforrása.
 * Új felirat csak a szótár bővítésével; őrök: cta-vocabulary-guard.test.ts, cta-a-termekben.test.ts.
 */

/** Melyik §3.2-beli cselekvésre vonatkozik a bejegyzés. Kulcsonként PONTOSAN egy felirat. */
export type CtaAction =
  | 'course-buy'
  | 'checkout-submit'
  | 'free-course-claim'
  | 'sign-in'
  | 'sign-up'
  | 'course-continue'
  | 'course-start'
  | 'my-courses-open'
  | 'course-list-open'
  | 'contact-submit'
  | 'newsletter-subscribe'
  | 'invoice-download'
  | 'back-to-courses'
  | 'course-unavailable-notice'
  | 'retry'
  | 'consent-accept-all'
  | 'consent-essential-only'
  | 'cart-remove-item'
  | 'cart-to-checkout'
  | 'password-reset-request'
  | 'password-reset-set'
  | 'call-specialist'
  | 'appointment-request-link'
  | 'appointment-submit'
  | 'free-course-request'
  | 'free-course-request-link'
  | 'course-sales-open'
  | 'course-rewatch'
  | 'course-finish'
  | 'profile-save'
  | 'sign-out'
  | 'contact-open'
  | 'about-open'
  | 'knowledge-list-open'
  | 'cookie-settings-open'
  | 'password-reset-start'
  | 'free-strip-jump'

/** A P-1 szabály szerinti nyelvtani alak – auditálható, ezért a szótár tárolja. */
export type CtaPerson =
  /** P-1a – egyes szám első személy: a látogató saját, elkötelező cselekvése. */
  | 'e1'
  /** P-1b – egyes szám második személy (tegező): puszta navigáció. */
  | 'e2'
  /** P-1c – bevett, egyszavas felületi címke főnévi alakban. */
  | 'nominal'
  /** P-1e – magyarázó mondat (nem gomb), tegező. */
  | 'explanatory'

/**
 * Vizuális súly (`docs/ui-sztenderdek.md` §2.2 és C-2: ugyanaz a cselekvés
 * mindenhol ugyanazt a súlyt kapja).
 */
export type CtaWeight = 'primary' | 'secondary' | 'ghost' | 'link' | 'none'

/** A folyamatban-feliratok (L-1) kulcsai. A lista ZÁRT – lásd `CTA_PROGRESS_LABELS`. */
export type CtaProgressKey =
  | 'sign-in'
  | 'sign-up'
  | 'sign-out'
  | 'send'
  | 'save'
  | 'processing'
  | 'loading'

export interface CtaEntry {
  /** A `docs/ui-sztenderdek.md` §3.2 táblázat sorszáma – a visszakereshetőség miatt kötelező. */
  readonly section: string
  readonly action: CtaAction
  /** A jóváhagyott, látható magyar szöveg. Bitre egyezik a §3.2 „Jóváhagyott felirat" oszlopával. */
  readonly label: string
  readonly person: CtaPerson
  readonly weight: CtaWeight
  /** Melyik L-1 folyamatban-feliratot kapja a gomb küldés közben; `null`, ha nincs ilyen állapota. */
  readonly progress: CtaProgressKey | null
  /**
   * `true`, ha a felirat MINTÁZAT (WCAG 3.2.4 megengedi: „Go to page 4" /
   * „Go to page 5"), tehát a tárgy cserélhető ugyanazzal a szerkezettel.
   * A §3.2 C-6 szabálya.
   */
  readonly patterned: boolean
  /** Mintázatos CTA regex forrása (G-UI1); patterned:true mellett kötelező. */
  readonly pattern: string | null
}

/**
 * A jóváhagyott feliratok. A sorrend a §3.2 táblázatét követi.
 *
 * FONTOS: a §3.2 #11 (kurzuskártya CTA-ja) SZÁNDÉKOSAN hiányzik – ott a
 * jóváhagyott megoldás az, hogy NINCS gomb: a kártya egésze link, a jelölő a
 * cím és a nyíl (NN/g: „don't make nonclickable items look like buttons").
 * Felirat nélküli szabályt nem tárolunk feliratként.
 */
export const CTA_VOCABULARY = [
  {
    // §3.2 #1 – fizetős kurzus vásárlása (kurzusoldal, buybox).
    // E/1: elkötelezés. A tárgy kötelező (Carbon/Polaris {ige}+{főnév};
    // NN/g „Substantial": a felirat a környezete nélkül is legyen érthető).
    section: '#1',
    action: 'course-buy',
    label: 'Megveszem a kurzust',
    person: 'e1',
    weight: 'primary',
    progress: null,
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #2 – a pénztár beküldő gombja. Ez a visszavonhatatlan lépés.
    // GOV.UK: a fizetésre „Pay", a záró lépésre „Confirm and send".
    // Baymard: explicit felirat a homályos „Continue" helyett.
    // A régi oldal szava: MEGRENDELEM. A Barion neve a gomb MELLÉ kerül, nem rá (M-6).
    section: '#2',
    action: 'checkout-submit',
    label: 'Megrendelem és fizetek',
    person: 'e1',
    weight: 'primary',
    progress: 'processing',
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #3 és #4 – ingyenes kurzus igénylése (kurzusoldal ÉS kezdőlapi sáv).
    // EGY cselekvés, EGY felirat (WCAG 3.2.4) – ezért egyetlen bejegyzés.
    // A mai „Ingyenes — azonnal eléred" háromszorosan hibás: nem ige, U+2014-et
    // használ elválasztóként (§3.1.1), és ígéretet tesz (M-8).
    // Az ingyenesség BADGE-ként jelenik meg, nem a gombban.
    section: '#3, #4',
    action: 'free-course-claim',
    label: 'Elindítom ingyen',
    person: 'e1',
    weight: 'secondary',
    progress: null,
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #5 – belépés. P-1c: bevett, egyszavas címke.
    // Carbon és Polaris ugyanígy mentesíti a rövid parancsokat (Done, Close, Cancel).
    section: '#5',
    action: 'sign-in',
    label: 'Belépés',
    person: 'nominal',
    weight: 'primary',
    progress: 'sign-in',
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #6 – regisztráció. P-1c, a #5 párja: a nav-menü is így nevezi,
    // tehát a menüpont és a beküldő gomb ugyanazt mondja (WCAG 3.2.4).
    section: '#6',
    action: 'sign-up',
    label: 'Regisztráció',
    person: 'nominal',
    weight: 'primary',
    progress: 'sign-up',
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #7 – megkezdett kurzus folytatása. P-1b: a lejátszó megnyílik,
    // semmi nem változik. A folytatás ≠ indítás, ezért külön felirat.
    section: '#7',
    action: 'course-continue',
    label: 'Folytasd a kurzust',
    person: 'e2',
    weight: 'primary',
    progress: null,
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #8 – még el nem kezdett, de már MEGLÉVŐ kurzus megnyitása.
    // Megkülönböztetendő a #3-tól: ott a hozzáférés keletkezik (E/1),
    // itt a meglévő kurzus nyílik meg (E/2).
    section: '#8',
    action: 'course-start',
    label: 'Kezdd el a kurzust',
    person: 'e2',
    weight: 'primary',
    progress: null,
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #9 – a saját kurzusok listájára. Ma NÉGY felirat él erre.
    // „Ugorj" helyett „Nyisd meg": az „Ugrás" szót a skip-link foglalja
    // („Ugrás a tartalomra"), és a C-4 szerint egy szó egy jelentés.
    section: '#9',
    action: 'my-courses-open',
    label: 'Nyisd meg a kurzusaidat',
    person: 'e2',
    weight: 'secondary',
    progress: null,
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #10 – a kurzuskínálatra. Ma NYOLC felirat él erre (A/6).
    // Kivétel: a főmenü menüpontjának neve marad „Kurzusok" (menücímke, nem CTA – N-3).
    section: '#10',
    action: 'course-list-open',
    label: 'Nézd meg a kurzusokat',
    person: 'e2',
    weight: 'primary',
    progress: null,
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #12 – kapcsolat-űrlap beküldése. E/1: adat megy el.
    // A régi oldal kapcsolat-űrlapján szó szerint ELKÜLDÖM állt (mérve).
    // A puszta „Küldés"/„Submit" tiltott (Atlassian).
    section: '#12',
    action: 'contact-submit',
    label: 'Elküldöm az üzenetet',
    person: 'e1',
    weight: 'primary',
    progress: 'send',
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #13 – hírlevél-feliratkozás. A SKILL.md 2. pontjának szó szerinti példája.
    // Egyszavas, de nem „puszta": önmagában megmondja, mi történik.
    section: '#13',
    action: 'newsletter-subscribe',
    label: 'Feliratkozom',
    person: 'e1',
    weight: 'secondary',
    progress: 'send',
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #14 – letöltés. E/1: fájl kerül a látogató gépére.
    // MINTÁZAT (C-6): `Letöltöm a <mit>` – pl. „Letöltöm az igazolást".
    // A fájl megnevezése kötelező (NN/g „Substantial").
    // A W3C SC 3.2.4 magyarázata SZÓ SZERINT ezt a mintát hozza példának:
    // „Download [document name]".
    section: '#14',
    action: 'invoice-download',
    label: 'Letöltöm a számlát',
    person: 'e1',
    weight: 'secondary',
    progress: null,
    patterned: true,
    // A magyar határozott névelő mindkét alakja (a/az) engedett; a tárgy nem
    // hagyható el, mert a puszta „Letöltöm" nem „Substantial".
    pattern: '^Letöltöm a[z]? \\S.*$',
  },
  {
    // §3.2 #15 – vissza-navigáció. MINTÁZAT (C-6): `Vissza a <hova>`.
    // A puszta „Vissza" nem „Substantial" (NN/g 4 S).
    //
    // A MINTÁZAT KIMONDÁSA (2026-08-18): a felületen ma kilenc élő
    // `Vissza a <hova>` felirat van (kezdőlapra, belépéshez, kurzusaimhoz,
    // Tudástárba). Ezek NEM eltérések, hanem a C-6 szabályos változatai –
    // a W3C SC 3.2.4 magyarázata ugyanezt engedi meg („Print receipt" /
    // „Print invoice"). Amíg a mintázat nem volt gépi alakban, a termék-őr
    // (G-UI2) mind a kilencet kivétel-sorként vezette.
    section: '#15',
    action: 'back-to-courses',
    label: 'Vissza a kurzusokhoz',
    person: 'e2',
    weight: 'ghost',
    progress: null,
    patterned: true,
    pattern: '^Vissza a[z]? \\S.*$',
  },
  {
    // §3.2 #16 – archivált / nem elérhető termék. NINCS GOMB, csak ez a mondat.
    // GOV.UK: „Disabled buttons have poor contrast and can confuse some users,
    // so avoid them if possible." A mai kód szürke, letiltott „Megveszem"-et
    // rajzol – hamis ígéret (NN/g: a link ígéret). → A/1.
    section: '#16',
    action: 'course-unavailable-notice',
    label: 'Ez a kurzus jelenleg nem vásárolható meg.',
    person: 'explanatory',
    weight: 'none',
    progress: null,
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #17 – újrapróbálkozás hiba után. Ma HÁROM alak él.
    // Ahol több újrapróbálható dolog van egy képernyőn, a cél a HOZZÁFÉRHETŐ
    // NÉVBE kerül rejtett szöveggel (WCAG 2.5.3), nem a látható feliratba.
    section: '#17',
    action: 'retry',
    label: 'Újrapróbálom',
    person: 'e1',
    weight: 'secondary',
    progress: null,
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #18 – süti-sáv, elfogadó ág. A két gomb AZONOS SÚLYÚ (nem dark pattern).
    section: '#18',
    action: 'consent-accept-all',
    label: 'Elfogadom mindet',
    person: 'e1',
    weight: 'secondary',
    progress: null,
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #18 – süti-sáv, elutasító ág. Elliptikus: az igét („fogadom el") az
    // első tagból veszi át, így a két gomb hossza és súlya is azonos marad.
    section: '#18',
    action: 'consent-essential-only',
    label: 'Csak a szükségeseket',
    person: 'e1',
    weight: 'secondary',
    progress: null,
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #19 (ÚJ) – tétel kivétele a kosárból.
    // MIÉRT NEM „Törlés": Carbon szerint a remove ≠ delete – „Deletion is the
    // most common type of removal and is destructive" –, és a helyreállítható
    // műveletre a remove alak való. A kosárból kivett tétel nem semmisül meg.
    // A tétel neve a hozzáférhető névbe kerül (több tételnél a puszta felirat
    // nem egyedi – WCAG 2.4.4).
    section: '#19',
    action: 'cart-remove-item',
    label: 'Kiveszem a kosárból',
    person: 'e1',
    weight: 'ghost',
    progress: null,
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #20 (ÚJ) – kosárból a pénztárba. P-1b: itt még semmi nem történik,
    // a vállalás a #2 gombnál van. A mai „Tovább a penztárhoz" puszta
    // „Tovább"-bal kezd (M-7) ÉS el van gépelve.
    section: '#20',
    action: 'cart-to-checkout',
    label: 'Menj a pénztárhoz',
    person: 'e2',
    weight: 'primary',
    progress: null,
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #21 (ÚJ) – jelszó-visszaállító link kérése. E/1: e-mail indul.
    // A régi oldal ugyanezt a szerkezetet használta: KÉREM A PROGRAMOT,
    // KÉREM A HOZZÁFÉRÉST, KÉREM AZ ÉRTESÍTÉST (mérve).
    // FIGYELEM: ez az E/1-es „kérem" ige, NEM a §2.7-ben tiltott „Kérjük".
    section: '#21',
    action: 'password-reset-request',
    label: 'Kérem a visszaállító linket',
    person: 'e1',
    weight: 'primary',
    progress: 'send',
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #22 (ÚJ) – új jelszó beállítása. A fiók megváltozik → E/1, ige + tárgy.
    // A folyamatban-felirat `Mentés…` (nem „Beállítás…"): a Polaris kimondja,
    // hogy a szinonimákat fel kell számolni, és a /fiok mentése is ezt írja.
    section: '#22',
    action: 'password-reset-set',
    label: 'Beállítom az új jelszót',
    person: 'e1',
    weight: 'primary',
    progress: 'save',
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #23 (ÚJ) – közvetlen telefonhívás a szakemberhez (`tel:` hivatkozás).
    // MINTÁZAT (C-6): `Hívd <Nevet>` – a név nélkül két szakembernél a felirat
    // nem egyedi (WCAG 2.4.4), és a képernyőolvasós link-listában sem lenne az.
    // P-1b → E/2: a hívás a telefon-alkalmazásnak adja át a látogatót, a
    // Kineticare-nél tárolt dolgaiban semmi nem változik (nincs foglalás).
    section: '#23',
    action: 'call-specialist',
    label: 'Hívd Kocsis Katát',
    person: 'e2',
    weight: 'secondary',
    progress: null,
    patterned: true,
    // Kötött ige + kötelező, nem üres név. Névelő nélkül: a személynév elé a
    // magyar nem tesz határozott névelőt a felszólító alakban.
    pattern: '^Hívd \\S.*$',
  },
  {
    // §3.2 #24 – írásos időpontkérés a szakember-szekcióból. P-1b → E/2:
    // a kattintás a /kapcsolat időpontkérő szekciójára VISZ, maga a vállalás
    // ott, a #25 gombbal történik. A kettő SZÁNDÉKOSAN külön sor: aki
    // „egységesítené", az a navigációt és a beküldést mosná össze.
    // NN/g egészségügyi kutatás: az írásos út a hívás mellett kötelező, mert a
    // válaszadók jelentős része kerüli a telefonálást.
    section: '#24',
    action: 'appointment-request-link',
    label: 'Kérj időpontot üzenetben',
    person: 'e2',
    weight: 'secondary',
    progress: null,
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #25 (ÚJ) – az időpontkérő űrlap BEKÜLDÉSE. P-1a → E/1: a beküldéssel
    // időpontkérés keletkezik, tehát a látogató dolgaiban változik valami.
    // Ezért E/1, szemben a #24 navigációs sorával.
    section: '#25',
    action: 'appointment-submit',
    label: 'Időpontot kérek',
    person: 'e1',
    weight: 'primary',
    progress: 'send',
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #26 (ÚJ) – az INGYENES kurzus igénylő űrlapjának BEKÜLDÉSE.
    // P-1a → E/1: a beküldéssel hozzáférés keletkezik és levél indul a
    // látogatónak, tehát a nála lévő dolgokban változik valami.
    //
    // MIÉRT NEM a #3 (`Elindítom ingyen`): az NAVIGÁCIÓS gomb (a kezdőlapról a
    // kurzus oldalára visz), ez pedig a VÁLLALÁS gombja. Ugyanaz a kettősség,
    // mint a #24 ↔ #25 párnál, tehát a WCAG 2.2 3.2.4 nem sérül: két
    // különböző funkció, két felirat.
    //
    // A régi www.kineticare.hu ugyanezt a szerkezetet vitte a `/kezrelax`
    // landingen (`KÉREM A VILLÁMKURZUST`, mérve: docs/regi-oldal-
    // osszehasonlitas.md 3.1) — Jakob törvénye. A tárgy SZÁNDÉKOSAN általános
    // („a kurzust"), mert az űrlap minden ingyenes terméken megjelenhet.
    section: '#26',
    action: 'free-course-request',
    label: 'Kérem a kurzust',
    person: 'e1',
    weight: 'primary',
    progress: 'send',
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #27 (ÚJ) – az ingyenes kurzus igénylő űrlapjához vivő, LAPON BELÜLI
    // ugrás a hosszú kurzusoldal aljáról.
    //
    // P-1b → E/2: a kattintás után semmi nem változik a látogató dolgaiban,
    // csak MÁSHOL lesz a lapon; a vállalás továbbra is a #26 gombnál történik.
    // Ugyanaz a szándékos kettősség, mint a #24 ↔ #25 és a #3 ↔ #26 párnál.
    //
    // MIÉRT NEM sérti a WCAG 2.2 3.2.4-et a #3 („Elindítom ingyen") mellett:
    // a #3 a KEZDŐLAPRÓL a kurzus OLDALÁRA visz (másik dokumentum), ez pedig az
    // ÜGYELETES lapon belül az űrlaphoz. Két különböző eredmény, tehát nem
    // „same functionality" (W3C Understanding SC 3.2.4).
    //
    // MIÉRT NEM „Ugorj az űrlaphoz": az „Ugrás" szót a felület a skip-linkre
    // foglalja („Ugrás a tartalomra"), a C-4 szerint pedig egy szó egy jelentés
    // (ugyanez az érv írta át a #9-et „Ugorj"-ról „Nyisd meg"-re).
    section: '#27',
    action: 'free-course-request-link',
    label: 'Kérd az ingyenes kurzust',
    person: 'e2',
    weight: 'secondary',
    progress: null,
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #28 (ÚJ, 2026-08-18) – a KURZUS SAJÁT (értékesítő) oldalának megnyitása.
    //
    // HÁROM hívóhely, EGY cselekvés (WCAG 2.2 · 3.2.4): a kurzuskártya
    // affordancia-felirata, a lejátszó „lejárt/nincs hozzáférésed" kapuja, és a
    // /kurzusaim lejárt kártyája. Mindhárom ugyanoda visz: `/kurzusok/<slug>`.
    // Eddig három felirat élt rá („Megnézem a programot", „A kurzus
    // megtekintése" kétszer).
    //
    // P-1b → E/2: a kattintás után semmi nem változik a látogató dolgaiban,
    // csak máshol lesz.
    //
    // MIÉRT NEM „Nézd meg a kurzust": a #10 („Nézd meg a kurzusokat") mellett
    // az egyetlen különbség egy toldalék lenne. Pontosan ezt az érvet mondta ki
    // a #9 sor is, amikor az „Ugorj a kurzusaidhoz"-t „Nyisd meg"-re írta át:
    // a „kurzusokat ↔ kurzusaidat" különbség önmagában kevés. A „Nyisd meg"
    // igét itt SZÁNDÉKOSAN ismételjük a #9-ből: egy fogalom (megnyitás) egy
    // ige (Polaris: „identify and eliminate synonyms").
    //
    // MIÉRT NEM „Nyisd meg a kurzust": az a #7/#8 párral ütközne, amelyek a
    // LEJÁTSZÓT nyitják meg. A „kurzusoldal" a célt nevezi meg, nem a tartalmat.
    //
    // FORRÁS: GOV.UK, Add links – „If your link takes the user to a page where
    // they can start a task, start your link with a verb."
    // https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/add-links/
    // NN/g, Better Link Labels – „Specific": „A link's primary purpose is to
    // communicate to users what they'll find on the other side of a click."
    // https://www.nngroup.com/articles/better-link-labels/
    section: '#28',
    action: 'course-sales-open',
    label: 'Nyisd meg a kurzusoldalt',
    person: 'e2',
    weight: 'secondary',
    progress: null,
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #29 (ÚJ, 2026-08-18) – BEFEJEZETT kurzus újranézése (/kurzusaim kártya).
    //
    // MIÉRT KÜLÖN SOR a #7 (folytatás) és a #8 (kezdés) mellett: mindhárom a
    // lejátszót nyitja meg, de MÁS állapotból, és a felirat ezt mondja meg. A
    // befejezett kurzuson a „Kezdd el" hazugság volna, a „Folytasd" pedig
    // félrevezető (nincs mit folytatni). NN/g, Better Link Labels – „Sincere":
    // „A link is a promise. To function properly, it must set expectations that
    // are not only specific, but also accurate."
    // https://www.nngroup.com/articles/better-link-labels/
    //
    // P-1b → E/2: a lejátszó megnyílik, a haladás nem áll vissza, semmi nem
    // változik a látogató dolgaiban.
    //
    // FORRÁS 2: GOV.UK Design System, Button – „Write button text in sentence
    // case, describing the action it performs."
    // https://design-system.service.gov.uk/components/button/
    // A mai „Újranézés" deverbális főnév, tárgy nélkül (M-1, M-7).
    section: '#29',
    action: 'course-rewatch',
    label: 'Nézd újra a kurzust',
    person: 'e2',
    weight: 'secondary',
    progress: null,
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #30 (ÚJ, 2026-08-18) – a kurzus BEFEJEZÉSE a lejátszóban (az utolsó
    // lecke gombja, `marksWatched: true`).
    //
    // P-1a → E/1: a kattintás MEGVÁLTOZTATJA a látogató haladás-adatát (az
    // utolsó lecke késznek jelölődik, a kurzus befejezetté válik), tehát a nála
    // lévő dolgokban változik valami. Ez a §3.2 P-1 határeset-kérdésének
    // („változik-e bármi a látogató dolgaiban?") egyértelmű igen-ága.
    //
    // A mai „Kurzus befejezése" deverbális főnévi alak (M-1): a §3.2 ugyanezt
    // az alakot írta át a #2, #12, #14, #21 és #22 soroknál is.
    //
    // FORRÁS: GOV.UK Design System, Button – „Write button text in sentence
    // case, describing the action it performs."
    // https://design-system.service.gov.uk/components/button/
    // NN/g, Better Link Labels – „Substantial": a felirat a környező szöveg
    // nélkül is álljon meg. https://www.nngroup.com/articles/better-link-labels/
    section: '#30',
    action: 'course-finish',
    label: 'Befejezem a kurzust',
    person: 'e1',
    weight: 'primary',
    progress: null,
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #31 (ÚJ, 2026-08-18) – a fiókadatok mentése (/fiok űrlap).
    //
    // MIÉRT MARAD FŐNÉVI (P-1c), szemben a #2/#12/#21/#22 E/1-es soraival:
    // a magyar E/1-es alak („Mentem az adataimat") KÉTÉRTELMŰ — a „mentem" az
    // ige („ment", elment valahova) múlt idejű E/1 alakja is. Vevői gombon
    // olyan szó nem állhat, amelyet a látogató két értelemben olvashat; a
    // §3.1.4 M-2 („a felirat legyen egyértelmű") ezt kizárja. A szinonima-csere
    // („Rögzítem az adataimat") viszont a L-1 `Mentés…` folyamatban-felirattal
    // ütközne, amit a Polaris kifejezetten tilt („identify and eliminate
    // synonyms").
    //
    // A „Mentés" ezért a #5/#6 (Belépés/Regisztráció) P-1c kivételébe tartozik:
    // bevett, egyszavas felületi címke, amelyet a magyar felületek (és a hazai
    // irodai szoftverek) egységesen így neveznek — Jakob törvénye (NN/g).
    //
    // FORRÁS: GOV.UK Design System, Button – a felsorolt példák között szó
    // szerint szerepel a „Save and continue".
    // https://design-system.service.gov.uk/components/button/
    // NN/g, Jakob's Law of Internet User Experience: a látogatók az idejük
    // nagy részét MÁS oldalakon töltik, ezért azt várják, hogy a tiéd is úgy
    // működjön, ahogy a többi, amit már ismernek.
    // https://www.nngroup.com/videos/jakobs-law-internet-ux/
    section: '#31',
    action: 'profile-save',
    label: 'Mentés',
    person: 'nominal',
    weight: 'primary',
    progress: 'save',
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #32 (ÚJ, 2026-08-18) – kijelentkezés (fiókmenü).
    //
    // A #5 („Belépés") SZABÁLYOS PÁRJA, ugyanazzal a P-1c kivétellel: bevett,
    // egyszavas felületi címke. Ha a belépés főnévi, a kijelentkezés sem lehet
    // más alakú — különben a menü két, egymásra felelő pontja két nyelvtani
    // személyben beszélne (WCAG 2.2 · 3.2.4 szellemében: a párba állított
    // funkciók azonos módon azonosítandók).
    //
    // Folyamatban: `Kijelentkezés…` – a L-1 lista HETEDIK eleme (2026-08-18).
    // A bővítés indoka BITRE ugyanaz, amivel a `Regisztráció…` felkerült rá:
    // ma is él a felületen, és a P-1c főnévi címke szabályos folyamatban-párja.
    //
    // FORRÁS: GOV.UK Design System, Button – „Write button text in sentence
    // case, describing the action it performs."
    // https://design-system.service.gov.uk/components/button/
    // NN/g, Jakob's Law: a kijelentkezés neve a magyar felületeken egységesen
    // „Kijelentkezés". https://www.nngroup.com/videos/jakobs-law-internet-ux/
    section: '#32',
    action: 'sign-out',
    label: 'Kijelentkezés',
    person: 'nominal',
    weight: 'ghost',
    progress: 'sign-out',
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #33 (ÚJ, 2026-08-18) – a /kapcsolat oldalra lépés.
    //
    // NÉGY hívóhely, EGY cselekvés: az üres tudástár-lista ajánlata, a
    // sikertelen fizetés segítség-gombja, a köszönőoldal hiba- és
    // „nem található" ága, és az ingyenes kurzus „nem ment ki a levél" ága.
    // Eddig HÁROM felirat élt rájuk („Kapcsolat", „Segítséget kérek", „Írj
    // nekünk a kapcsolati oldalon") – mért 3.2.4-ütközés a `/kapcsolat` célon.
    //
    // P-1b → E/2: a kattintás csak odavisz; a vállalás ott, a #12 gombbal
    // („Elküldöm az üzenetet") történik. Ugyanaz a szándékos kettősség, mint a
    // #24 ↔ #25 és a #3 ↔ #26 párnál.
    //
    // MIÉRT NEM „Kapcsolat": az menücímke (N-3), és a láblécben MARAD is annak.
    // Cselekvésgombként viszont nem mondja meg, mi történik (M-7); az „Írj
    // nekünk" igével kezd, és a látogató nyelvén nevezi meg a lépést.
    //
    // FORRÁS: GOV.UK, Add links – „If your link takes the user to a page where
    // they can start a task, start your link with a verb", és „make it
    // descriptive and avoid generic text like 'click here' or 'more'".
    // https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/add-links/
    // W3C, Understanding SC 3.2.4 Consistent Identification – „The intent of
    // this success criterion is to ensure consistent identification of
    // functional components that appear repeatedly within a set of web pages."
    // https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html
    section: '#33',
    action: 'contact-open',
    label: 'Írj nekünk',
    person: 'e2',
    weight: 'secondary',
    progress: null,
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #34 (ÚJ, 2026-08-18) – a /rolunk oldalra lépés a kezdőlapi
    // szakmai hitel-csíkból (CredentialsStrip).
    //
    // P-1b → E/2: puszta navigáció.
    //
    // A mai „Bővebben a szakmai hátterünkről" nem puszta „Bővebben" (a tárgyat
    // megnevezi), de nem is igével kezd, és öt szó – a M-3 négyszavas korlátja
    // fölött. Az „Ismerd meg" igei alak ugyanazt az ígéretet teszi rövidebben.
    //
    // FORRÁS: GOV.UK, Add links – verb-first, és „avoid generic text like
    // 'click here' or 'more'" (a magyar „Bővebben" ennek pontos párja).
    // https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/add-links/
    // NN/g, Better Link Labels – „Succinct": „When composing links, don't waste
    // words." https://www.nngroup.com/articles/better-link-labels/
    section: '#34',
    action: 'about-open',
    label: 'Ismerd meg a hátterünket',
    person: 'e2',
    weight: 'link',
    progress: null,
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #35 (ÚJ, 2026-08-18) – a tudástár (/blog) LISTÁJÁRA lépés a
    // kezdőlapi szekció lábából.
    //
    // P-1b → E/2. A mai „Összes bejegyzés a tudástárban" négy szó, de főnévi,
    // és a „Vissza a Tudástárba" (#15 mintázat) mellett MÁSODIK feliratot ad
    // ugyanarra a célra. A kettő SZÁNDÉKOSAN marad külön: az egyik BÖNGÉSZÉS,
    // a másik VISSZALÉPÉS – pontosan az a kettősség, amit a #10 ↔ #15 páros
    // már eldöntött a /kurzusok célon.
    //
    // FORRÁS: GOV.UK, Add links – verb-first szabály és „Consider using the
    // title of the page the link goes to as your link text." (a cél oldal neve
    // a felületen „Tudástár").
    // https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/add-links/
    // NN/g, Better Link Labels – „Specific".
    // https://www.nngroup.com/articles/better-link-labels/
    section: '#35',
    action: 'knowledge-list-open',
    label: 'Nézd meg a tudástárat',
    person: 'e2',
    weight: 'link',
    progress: null,
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #36 (ÚJ, 2026-08-18) – a süti-sáv ÚJRANYITÁSA a láblécből.
    //
    // A #18 a sáv KÉT DÖNTÉSGOMBJÁRÓL rendelkezik; a hozzájárulás
    // visszavonásának belépője (GDPR) eddig szótáron kívül élt.
    //
    // P-1c: bevett, egyszavas (kötőjeles összetett) felületi címke, ugyanaz a
    // kivétel, mint a #5/#6/#31/#32-nél. A „Süti-beállítások" a magyar
    // felületek bevett neve erre a belépőre; az igei alak („Módosítom a
    // süti-beállításokat") itt félrevezető is volna, mert a kattintás még nem
    // módosít semmit, csak megnyitja a sávot.
    //
    // FORRÁS: NN/g, Cookie Permissions 101 – a látogatónak tudnia kell később
    // is megváltoztatni a süti-döntését, és ehhez állandóan elérhető belépő
    // kell. https://www.nngroup.com/articles/cookie-permissions/
    // NN/g, Jakob's Law: a bevett elnevezéstől eltérni külön költség.
    // https://www.nngroup.com/videos/jakobs-law-internet-ux/
    section: '#36',
    action: 'cookie-settings-open',
    label: 'Süti-beállítások',
    person: 'nominal',
    weight: 'link',
    progress: null,
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #37 (ÚJ, 2026-08-18) – a jelszó-visszaállítás KEZDEMÉNYEZÉSE
    // (link a /elfelejtett-jelszo oldalra).
    //
    // KÉT hívóhely, EGY cselekvés: a belépőlap alatti hivatkozás és a lejárt
    // visszaállító linknél kínált „új link" hivatkozás. Eddig két felirat élt
    // rájuk („Elfelejtetted a jelszavad?" és „Új link kérése") – mért
    // 3.2.4-ütközés az /elfelejtett-jelszo célon.
    //
    // MIÉRT EZ A KETTŐ KÖZÜL: a cél oldal H1 CÍME szó szerint „Elfelejtetted a
    // jelszavad?" — a GOV.UK írásmódja pedig kimondja: „Consider using the
    // title of the page the link goes to as your link text."
    // https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/add-links/
    // Ez egyben a világ legbevettebb auth-mintája (Jakob törvénye, NN/g:
    // https://www.nngroup.com/videos/jakobs-law-internet-ux/) — a belépőlapról
    // elvenni tudatos veszteség volna.
    //
    // P-1b → E/2 (tegező kérdés): a kattintás után semmi nem változik, csak
    // máshol leszünk; a levelet a #21 gomb indítja el.
    section: '#37',
    action: 'password-reset-start',
    label: 'Elfelejtetted a jelszavad?',
    person: 'e2',
    weight: 'link',
    progress: null,
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #38 (ÚJ, 2026-08-18) – LAPON BELÜLI ugrás a kezdőlap ingyenes
    // sávjára (`#ingyenes`, a hero másodlagos gombja és a filmHero második
    // CMS-gombja).
    //
    // P-1b → E/2: a kattintás után a látogató ugyanazon a lapon, lentebb lesz.
    //
    // MIÉRT NEM a #27 („Kérd az ingyenes kurzust"): az a KURZUSOLDAL igénylő
    // ŰRLAPJÁHOZ ugrik, tehát az ígéret ott egy kattintással beváltható. Itt a
    // cél egy AJÁNLÓ SÁV, ahonnan még két lépés az igénylés — a „Kérd" ígéret
    // ezért nem volna őszinte (NN/g, Better Link Labels – „Sincere": „A link is
    // a promise. To function properly, it must set expectations that are not
    // only specific, but also accurate.")
    // https://www.nngroup.com/articles/better-link-labels/
    //
    // MIÉRT NEM „Ingyenes SOS gyakorlatok" (a mai alak): főnévi, nem mondja
    // meg, mi történik (M-7), és a hero elsődleges gombja mellett ugyanazt a
    // vizuális súlyt kérné. A sáv SAJÁT NEVE („SOS Kézrelax: ingyenes
    // villámkurzus") adja a tárgyat — GOV.UK: „Consider using the title of the
    // page the link goes to as your link text."
    // https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/add-links/
    //
    // Az „ingyenes" jelző SZÁNDÉKOSAN kimarad a gombból: a sávon és a kártyán
    // BADGE mondja ki (`Badge tone="success"`), ahogy a #3 sor is előírja.
    section: '#38',
    action: 'free-strip-jump',
    label: 'Nézd meg az SOS-kurzust',
    person: 'e2',
    weight: 'ghost',
    progress: null,
    patterned: false,
    pattern: null,
  },
] as const satisfies readonly CtaEntry[]

/**
 * L-1 – folyamatban-feliratok. ZÁRT lista, három ponttal (U+2026), gondolatjel
 * nélkül. Ez RENDSZERÁLLAPOT, nem a látogató cselekvése (NN/g 1. heurisztika;
 * WCAG 4.1.3 Status Messages), ezért soha nem E/1: a „Megveszem…" alak
 * nyelvtanilag is értelmetlen volna.
 *
 * A `Beállítás…` SZÁNDÉKOSAN nincs a listán: a `/jelszo-visszaallitas` űrlapja
 * a `Mentés…`-t használja. A „beállítás" és a „mentés" ugyanazt a műveletet
 * nevezi meg (a bevitt adat tartósan eltárolódik), a Polaris pedig előírja a
 * szinonimák felszámolását („identify and eliminate synonyms").
 *
 * A lista 2026-08-18-án HÉT elemre bővült: a `Kijelentkezés…` felkerült rá.
 * Az indok BITRE ugyanaz, amivel a `Regisztráció…` felkerült: ma is él a
 * felületen (`AccountNav`), és a §3.2 #32 főnévi címkéjének (P-1c) szabályos
 * folyamatban-párja. Az `Újratöltés folyamatban…` viszont NEM kerül fel: az a
 * `Betöltés…`-re egységesül (ugyanaz a művelet, két szó – Polaris: „identify
 * and eliminate synonyms").
 */
export const CTA_PROGRESS_LABELS = {
  'sign-in': 'Belépés…',
  'sign-up': 'Regisztráció…',
  'sign-out': 'Kijelentkezés…',
  send: 'Küldés…',
  save: 'Mentés…',
  processing: 'Feldolgozás…',
  loading: 'Betöltés…',
} as const satisfies Record<CtaProgressKey, string>

/**
 * Cselekvés-kulcs → bejegyzés index, duplikátum-ellenőrzéssel.
 *
 * Azért EXPORTÁLT, mert a G-UI1 őr így tudja a duplikátum-ágat közvetlenül,
 * szintetikus bemenettel is ellenőrizni. Ha csak a modulbetöltéskor dőlne ki,
 * a duplikátum-teszt maga sosem futna le (a fájl importja szállna el előbb):
 * a `guard-files-integrity` őr tanulsága: a némán ki nem futó ellenőrzés
 * ugyanolyan rossz, mint a hiányzó.
 */
export function buildCtaIndex(entries: readonly CtaEntry[]): ReadonlyMap<CtaAction, CtaEntry> {
  const index = new Map<CtaAction, CtaEntry>()
  for (const entry of entries) {
    const existing = index.get(entry.action)
    if (existing) {
      // C-1 / WCAG 3.2.4: egy cselekvésre PONTOSAN egy felirat. Ha valaki
      // mégis kettőt vesz fel, az modulbetöltéskor dől ki, nem élesben.
      throw new Error(
        `CTA-szótár: a(z) "${entry.action}" cselekvésre két felirat került be ` +
          `("${existing.label}" és "${entry.label}"). Egy cselekvés = egy felirat ` +
          `(docs/ui-sztenderdek.md §3.2, C-1, WCAG 3.2.4).`,
      )
    }
    index.set(entry.action, entry)
  }
  return index
}

const CTA_INDEX = buildCtaIndex(CTA_VOCABULARY)

/** A cselekvéshez tartozó teljes szótári bejegyzés (felirat, súly, személy, folyamatban-kulcs). */
export function ctaEntry(action: CtaAction): CtaEntry {
  const entry = CTA_INDEX.get(action)
  if (!entry) {
    throw new Error(
      `CTA-szótár: a(z) "${action}" cselekvésre nincs jóváhagyott felirat. ` +
        `Új feliratot előbb a docs/ui-sztenderdek.md §3.2 táblázatába kell felvenni, forrással.`,
    )
  }
  return entry
}

/** A cselekvéshez tartozó jóváhagyott, látható magyar felirat. */
export function ctaLabel(action: CtaAction): string {
  return ctaEntry(action).label
}

/** A gomb folyamatban-felirata (L-1); `null`, ha a gombnak nincs ilyen állapota. */
export function ctaProgressLabel(action: CtaAction): string | null {
  const { progress } = ctaEntry(action)
  return progress === null ? null : CTA_PROGRESS_LABELS[progress]
}

/**
 * A MINTÁZATOS (C-6) szótári sorok lefordított reguláris kifejezései.
 *
 * A `u` zászló azért kell, mert a feliratok magyar ékezetes karaktereket
 * tartalmaznak, és a `\S` osztálynak Unicode-módban kell működnie.
 */
const CTA_PATTERNS: readonly { readonly entry: CtaEntry; readonly regex: RegExp }[] =
  CTA_VOCABULARY.flatMap((entry) =>
    entry.pattern === null ? [] : [{ entry, regex: new RegExp(entry.pattern, 'u') }],
  )

/**
 * A felirathoz tartozó MINTÁZATOS szótári sor, ha van ilyen.
 *
 * Ez teszi gépileg eldönthetővé, hogy a `Vissza a kezdőlapra` a §3.2 #15
 * szabályos változata-e (C-6), nem pedig egy tizedik, számon nem tartott
 * felirat. A W3C SC 3.2.4 magyarázata kifejezetten megengedi az ilyen
 * mintázatot: „Text alternatives that are 'consistent' are not always
 * 'identical.'"
 * https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html
 *
 * A visszaadott bejegyzés a MINTA sora (a `label` mezője a minta kanonikus
 * példánya), nem a kapott felirat – így a hívó tudja, melyik §3.2 sor alá esik.
 */
export function ctaPatternEntry(label: string): CtaEntry | null {
  return CTA_PATTERNS.find(({ regex }) => regex.test(label))?.entry ?? null
}

const CTA_LABEL_SET: ReadonlySet<string> = new Set<string>(
  CTA_VOCABULARY.map((entry) => entry.label),
)

/** `true`, ha a felirat a §3.2 szótárból való, vagy egy MINTÁZATOS sor változata. */
export function isApprovedCtaLabel(label: string): boolean {
  return CTA_LABEL_SET.has(label) || ctaPatternEntry(label) !== null
}
