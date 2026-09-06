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
  | 'course-modules-jump'
  | 'services-list-open'
  | 'free-sos-named-open'

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
  'sign-in' | 'sign-up' | 'sign-out' | 'send' | 'save' | 'processing' | 'loading'

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
    section: '#14',
    action: 'invoice-download',
    label: 'Letöltöm a számlát',
    person: 'e1',
    weight: 'secondary',
    progress: null,
    patterned: true,
    // Mintázat: Letöltöm a[z]? …
    pattern: '^Letöltöm a[z]? \\S.*$',
  },
  {
    // §3.2 #15 – vissza-navigáció. MINTÁZAT (C-6): `Vissza a <hova>`.
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
    // §3.2 #38 – lapon belüli navigáció; P03 szerint a gomb is kimondja az ingyenességet.
    section: '#38',
    action: 'free-strip-jump',
    label: 'Nézd meg ingyenes SOS-kurzusunkat',
    person: 'e2',
    weight: 'ghost',
    progress: null,
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #39: navigacio a kampany tananyagahoz, nem kurzusinditas vagy vasarlas.
    section: '#39',
    action: 'course-modules-jump',
    label: 'Nézd meg a modulokat',
    person: 'e2',
    weight: 'secondary',
    progress: null,
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #40 – a szolgáltatások listája (kezdőlapi sín, Nyitott állapot).
    section: '#40',
    action: 'services-list-open',
    label: 'Nézd meg a szolgáltatásokat',
    person: 'e2',
    weight: 'primary',
    progress: null,
    patterned: false,
    pattern: null,
  },
  {
    // §3.2 #41 – a Zárt állapot paneljének terméknevű belépője. MERGE HOLD:
    // ugyanoda visz, mint a #3/#4 (`Elindítom ingyen`). A tulajdonos a
    // terméknevet hagyta jóvá a sín-CTA-ra; a 3.2.4 ütközést emberi döntés zárja.
    section: '#41',
    action: 'free-sos-named-open',
    label: 'Ingyenes SOS KézRelax',
    person: 'e2',
    weight: 'primary',
    progress: null,
    patterned: false,
    pattern: null,
  },
] as const satisfies readonly CtaEntry[]

/** Folyamatban-feliratok — zárt lista, három pont (U+2026), nem E/1 cselekvés. */
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
