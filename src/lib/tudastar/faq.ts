/**
 * A Tudástár cikkeinek GYIK-tételei (kérdés-válasz párok).
 *
 * ═══ HONNAN JÖNNEK A KÉRDÉSEK ═══
 * Egyetlen kérdést sem találtunk ki. Mindegyik a 2026-08-21-i Monid-mérésből
 * való: valódi Google-autocomplete kifejezések magyar keresésből
 * (api.strale.io /x402/keyword-suggest, hl=hu), kiegészítve a Google Trends
 * „top” és „emelkedő” listáival (x402atlas). A mérés futásazonosítói:
 *
 *   kéztőalagút szindróma  01M0K0796WSMMM4711CMDWR0JX   (24 kifejezés)
 *   kéz zsibbadás          01M0K0CNJFR1NWGC5YABHZ6557   (40)
 *   teniszkönyök           01M0K0CSA4V8A02M74PW30JGVW   (41)
 *   pattanó ujj            01M0K0CX65HY4G2ZB7YRKBSFZF   (18)
 *   csuklófájdalom         01M0K0D5A6WZWPGF2TGHCJJP6W   (11)
 *   csuklótörés            01M0K0DKQKY8QQG37XN21H8MY9   (13)
 *   ínhüvelygyulladás      01M0SJQ0SBHS103YQ37Z6MTX1B
 *   befagyott váll         01M0ST9XKE8HY4VC81DB7BWAAP
 *   Trends: 01M0K0DQM4TGHVBN0971W1F21X, 01M0K0E2YMEHXJ9CFKC94QF1M0,
 *           01M0K0E8PB8RVH71AK85TW21H0, 01M0K0EE3ZJ0S5J52TCJWP0E2F
 *           (csuklófájdalom és csuklótörés: ÜRES, nincs elég trend-adat)
 *
 * Minden tételnél a `mert` mező mondja meg, melyik MÉRT kifejezésből jön a
 * kérdés. Ahol a mérés több változatot adott ugyanarra (például „mitől alakul
 * ki” és „mi az”), ott a tágabb, ok-kereső változatot vittük tovább, mert a
 * puszta „mi az”-ra a cikk CÍME és nyitó mondata amúgy is válaszol.
 *
 * ═══ A LEGFONTOSABB SZABÁLY: A VÁLASZ A CIKK KIVONATA, NEM A BŐVÍTÉSE ═══
 * A válasz KIZÁRÓLAG azt mondhatja, amit a cikk törzse már kimond. Ez nem
 * stílus-kérdés: egészségügyi (YMYL) tartalomról van szó, ahol egy kitalált
 * klinikai állítás valódi kárt okoz. Ezért minden tétel viszi a `szakasz`
 * mezőt (a cikk melyik H2-je adja a választ) és a `horgony` listát (szó
 * szerinti kifejezések, amiknek a válaszban ÉS a cikk törzsében is ott kell
 * lenniük). A `src/__tests__/tudastar-faq.test.ts` mindkettőt méri.
 *
 * Amire a cikk nem válaszol, arra itt NINCS tétel, akkor sem, ha nagy a
 * keresési igény. A mérés több ilyet is hozott: a kéztőalagút-szindrómánál a
 * krém (Trends top 69!), a B-vitamin, az akupunktúra, a borogatás és a műtét
 * ára, négy cikknél pedig a „lelki okai”. Ezekre ma nem születhet válasz. A
 * hiánylista a `docs/tudastar-cikkek-betoltese.md` 10. szakaszában áll: az
 * mondja meg, mivel érdemes bővíteni a cikkeket.
 *
 * ═══ MIÉRT ÍGY FOGALMAZUNK ═══
 * A mező admin-leírása kimondja az elvárást: a válasz önmagában is álljon meg
 * (2–4 mondat), mert a keresők és az AI-válaszok pontosan ezt idézik, a cikk
 * többi mondata nélkül. Ezért minden válasz kiírja a saját tárgyát is („A
 * teniszkönyök otthoni kezelése…”), nem hivatkozik vissza a szövegre.
 *
 * Ahol a cikk mentőhívási vagy orvoshoz fordulási küszöböt mond ki, ott a
 * válasz PONTOSAN azt ismétli, nem lazít rajta. Forrás- vagy tanulmány-név a
 * válaszokban nincs (tulajdonosi döntés, 2026-08-21; az őrt lásd a
 * `markdown-to-lexical.ts` FORRAS_JELOLESEK listájánál).
 *
 * Gondolatjeles, töltelék-elválasztós írásmód nincs: a nagykötőjel csak
 * számtartományban áll, szóközök nélkül („4–6 hét”), ahogy a
 * `docs/ui-sztenderdek.md` §3.1 előírja.
 */

/** Egy kérdés-válasz pár, a mérési és a cikkbeli eredetével együtt. */
export interface GyikTetel {
  /** A kérdés, ahogy a felhasználó beírja, de rendes magyar mondatként. */
  kerdes: string
  /** A válasz: 2–4 mondat, önmagában is megálló, kizárólag a cikk törzséből. */
  valasz: string
  /** A MÉRT keresési kifejezés(ek), amiből a kérdés jön. */
  mert: readonly string[]
  /** A cikk H2-je, amelyik a választ adja (szó szerint, a törzsből). */
  szakasz: string
  /**
   * Szó szerinti horgonyok: olyan kifejezések, amiknek a VÁLASZBAN és a cikk
   * TÖRZSÉBEN is szerepelniük kell. Ez teszi géppel mérhetővé, hogy a válasz
   * kulcsállításai a cikkből jönnek, nem a fejünkből.
   */
  horgony: readonly string[]
}

/** Egy cikk teljes GYIK-je. */
export interface CikkGyik {
  /** A bejegyzés slugja (a `posts.slug` mezővel egyezik). */
  slug: string
  /** A tételek, a mért keresési igény sorrendjében. */
  tetelek: readonly GyikTetel[]
}

/**
 * A `posts.faq` mező `maxRows` korlátja. Ennél több tételt a Payload
 * visszautasítana íráskor, ezért a betöltő már a fordításkor megáll.
 */
export const GYIK_MAX = 6

/**
 * Alsó korlát: két tétel alatt a blokk nem ér semmit (a mező admin-leírása is
 * 2–6 tételt kér). Ha egy cikkhez ennyi sem gyűlik össze a törzsből, az nem
 * hiba, hanem jelzés: a cikket kell bővíteni, nem a választ kitalálni.
 */
export const GYIK_MIN = 2

/** Egy válasz alsó és felső mondathatára (a mező admin-leírása szerint). */
export const VALASZ_MONDAT_MIN = 2
export const VALASZ_MONDAT_MAX = 4

export const CIKK_GYIK: readonly CikkGyik[] = [
  {
    slug: 'miert-zsibbad-a-kezem',
    tetelek: [
      {
        // A legerősebb mért igény: az „okai” az autocomplete első helye, és a
        // Trends-listán is 85 pontot visz.
        kerdes: 'Mi okozhatja a kéz zsibbadását?',
        valasz:
          'A zsibbadás tünet, nem diagnózis: sokféle, egymástól nagyon távoli ok állhat mögötte. ' +
          'Lehetséges okként szóba jön a cukorbetegség, a Raynaud-jelenség, a hiperventilláció, ' +
          'az isiász és a sclerosis multiplex is. A tartósan megmaradó zsibbadás hátterében a ' +
          'nyakban vagy a hátban becsípődött ideg, a kemoterápia, egyes gyógyszerek, a rossz ' +
          'táplálkozás és a túlzott alkoholfogyasztás is állhat. A kéztőalagút-szindróma pedig a ' +
          'középideg nyomás okozta károsodása, és jellemzően a hüvelyk-, a mutató- és a középső ' +
          'ujjban okoz fájdalmat, zsibbadást, bizsergést.',
        mert: ['kéz zsibbadás okai', 'bal kéz zsibbadás okai', 'Trends top: okai (85)'],
        szakasz: 'Mi okozhat még zsibbadást?',
        horgony: [
          'tünet, nem diagnózis',
          'Raynaud-jelenség',
          'sclerosis multiplex',
          'túlzott alkoholfogyasztás',
        ],
      },
      {
        // Három mért kifejezés fut össze ide: „éjszaka”, „alvás közben”,
        // „alváskor”. A cikknek külön H2-je van rá.
        kerdes: 'Miért zsibbad a kezem éjszaka?',
        valasz:
          'Az éjszaka erősödő kézzsibbadás a kéztőalagút-szindróma jellegzetes mintázata: a ' +
          'tünetek lassan indulnak, jönnek-mennek, és éjjel a legerősebbek. A zsibbadás gyakran ' +
          'fel is ébreszt, és sokaknál a kéz mozgatása vagy rázogatása enyhíti. Ez ismerős lehet, ' +
          'de nem bizonyíték: az éjszakai zsibbadásnak más oka is lehet, ezért ne diagnosztizáld ' +
          'magad.',
        mert: [
          'kéz zsibbadás éjszaka',
          'kéz zsibbadás alvás közben',
          'kéz zsibbadás alváskor',
          'bal kéz zsibbadás éjszaka',
        ],
        szakasz: 'Miért zsibbad a kezed éjszaka?',
        horgony: [
          'jellegzetes mintázata',
          'éjjel a legerősebbek',
          'rázogatása enyhíti',
          'ne diagnosztizáld magad',
        ],
      },
      {
        // A Trends-listán a „bal kéz” 100, a „jobb kéz” 69 pont: ez a fürt
        // nagyobb, mint az „okai”. A cikk válasza viszont az, hogy az oldal
        // ritkán számít, egy életmentő kivétellel.
        kerdes: 'Számít, hogy a bal vagy a jobb kezem zsibbad?',
        valasz:
          'Önmagában az oldal ritkán mondja meg az okot. A cukorbetegség, a Raynaud-jelenség, a ' +
          'becsípődött ideg és a gyógyszermellékhatás egyaránt jelentkezhet a bal és a jobb kézen ' +
          'is. Egy kivétel van, és ez életmentő: ha a zsibbadás hirtelen kezdődik a test egyik ' +
          'oldalán, és mellette lelóg az arc egyik fele, erőtlen a kar vagy akadozik a beszéd, az ' +
          'stroke gyanúja, és ilyenkor azonnal a 112-t kell hívni.',
        mert: [
          'bal kéz zsibbadás',
          'Trends top: bal kéz (100)',
          'Trends top: jobb kéz (69)',
        ],
        szakasz: 'Számít, hogy a bal vagy a jobb kezed zsibbad?',
        horgony: ['ritkán mondja meg az okot', 'stroke gyanúja', 'azonnal a 112-t'],
      },
      {
        kerdes: 'Mit tehetsz otthon a kézzsibbadás ellen?',
        valasz:
          'Az első lépés a terhelés csökkentése: pihentesd a csuklódat, mozgasd finoman a kezed, ' +
          'és hagyd abba vagy csökkentsd a panaszt okozó tevékenységet, például a gépelést, a ' +
          'rezgő szerszám használatát vagy a hangszeres játékot. A kéztőalagút-eredetű ' +
          'zsibbadásnál az éjszakai csuklósín az, amire a legtöbb bizonyíték van, viselni viszont ' +
          'akár 6 hetet is kell, mire javulni kezd. Gyógyulást ez nem ígér: nem tudjuk, hogy ' +
          'használ-e, de olcsó és ártalmatlan, tehát megpróbálható. Ha a panasz két hét otthoni ' +
          'kezelés után sem javul, orvosi kivizsgálás kell.',
        mert: ['kéz zsibbadás ellen', 'kéz zsibbadás kezelése'],
        szakasz: 'Mit lehet tenni kézzsibbadás ellen otthon?',
        horgony: [
          'terhelés csökkentése',
          'éjszakai csuklósín',
          'olcsó és ártalmatlan',
          'két hét otthoni kezelés után sem javul',
        ],
      },
      {
        kerdes: 'Okozhat a cukorbetegség kézzsibbadást?',
        valasz:
          'Igen, a cukorbetegség a kézzsibbadás lehetséges okai között szerepel. A cukorbetegség ' +
          'mellett jelentkező kézpanasznál kivizsgálás kell, mert ilyenkor a kézproblémák ' +
          'komolyabbak lehetnek. Bármilyen tartósan megmaradó bizsergés vagy érzéskiesés a kézen ' +
          'orvosi kivizsgálást igényel.',
        mert: ['kéz zsibbadás cukorbetegség', 'kéz zsibbadás cukorbetegeknek'],
        szakasz: 'Mikor kell kivizsgálás, ha nem sürgős?',
        horgony: [
          'a kézproblémák komolyabbak lehetnek',
          'bizsergés vagy érzéskiesés',
          'orvosi kivizsgálást igényel',
        ],
      },
      {
        // A mért „hirtelen” kifejezés. A cikk a mentőhívási küszöböt a szöveg
        // ELEJÉRE tette; a GYIK-ben a blokk végén áll, de szó szerint ugyanazt
        // a négy jelet sorolja, lazítás nélkül.
        kerdes: 'Mikor kell azonnal mentőt hívni kézzsibbadásnál?',
        valasz:
          'Azonnal hívj mentőt, Magyarországon a 112-t, ha lelóg az arc egyik fele, erőtlen vagy ' +
          'zsibbadt az egyik kar, és akadozik a beszéd. Ugyanígy sürgős a test egyik oldalára ' +
          'kiterjedő erőtlenség vagy zsibbadás, a homályos látás, a hirtelen erős fejfájás és a ' +
          'szédülés. Ha a stroke jelei már el is múltak, de 24 órán belül megvoltak, akkor is ' +
          'azonnali segítség kell. Sérülés után is mentőt kell hívni, ha a sérült kar vagy csukló ' +
          'zsibbad, ha erősen vérző seb van rajta, ha a csont kiáll a bőrből, vagy ha a kar alakja ' +
          'megváltozott.',
        mert: ['kéz zsibbadás hirtelen'],
        szakasz: 'Előbb ezt: mikor kell azonnal mentőt hívni?',
        horgony: [
          'lelóg az arc egyik fele',
          '24 órán belül megvoltak',
          'a csont kiáll a bőrből',
        ],
      },
    ],
  },
  {
    slug: 'keztoalagut-szindroma',
    tetelek: [
      {
        // A Trends-listán a „tünetei” 100 pont, és ez az EGYETLEN emelkedő
        // kifejezés is (+130). A cikk H2-je szó szerint erre válaszol.
        kerdes: 'Mik a kéztőalagút-szindróma tünetei?',
        valasz:
          'A jellemző tünetek: fájdalom vagy sajgás az ujjakban, a kézben és a karban, zsibbadás, ' +
          'bizsergés, gyenge hüvelykujj vagy nehéz markolás. A lefolyás is jellegzetes: a tünetek ' +
          'lassan indulnak, jönnek-mennek, és éjjel a legerősebbek. A zsibbadás gyakran felébreszt ' +
          'éjjel, és sokaknál a kéz rázogatása enyhíti. Jellemző az ügyetlenség is, és az, hogy ' +
          'elejted a tárgyakat.',
        mert: ['kéztőalagút szindróma tünetei', 'Trends top: tünetei (100), emelkedő +130'],
        szakasz: 'Hol fáj, és mik a tünetei?',
        horgony: ['gyenge hüvelykujj', 'jönnek-mennek', 'elejted a tárgyakat'],
      },
      {
        // Külön tétel a „hol fáj”-ra: az előző a tünetek LISTÁJÁT adja, ez a
        // helyüket. Két külön keresés, két külön idézhető válasz.
        kerdes: 'Hol fáj a kéztőalagút-szindróma?',
        valasz:
          'A zsibbadás elsősorban a hüvelyk-, a mutató-, a középső és a gyűrűsujjat érinti. A ' +
          'fájdalom vagy sajgás nem csak az ujjakban jelentkezhet, hanem a kézben és a karban is. ' +
          'A tünetek éjjel a legerősebbek, és a zsibbadás gyakran fel is ébreszt.',
        mert: ['kéztőalagút szindróma hol fáj'],
        szakasz: 'Hol fáj, és mik a tünetei?',
        horgony: ['a hüvelyk-, a mutató-, a középső és a gyűrűsujjat érinti', 'éjjel a legerősebbek'],
      },
      {
        // A „mitől alakul ki” és a „mi az” ugyanarra a H2-re fut; a tágabb,
        // ok-kereső változatot vittük tovább, mert a „mi az”-ra a cikk címe és
        // nyitó mondata amúgy is felel.
        kerdes: 'Mitől alakul ki a kéztőalagút-szindróma?',
        valasz:
          'A kéztőalagút-szindróma azt jelenti, hogy a csuklón átfutó középideg nyomás alá kerül. ' +
          'A csuklóban van egy szűk járat, ez a kéztőalagút: vagy maga a járat szűkül be, vagy a ' +
          'benne futó inak körüli szövet duzzad meg. Az esetek nagy részében több tényező áll ' +
          'együtt a háttérben, és a nők, valamint az idősebbek gyakrabban érintettek. Egyetlen okot ' +
          'tehát ritkán lehet megnevezni.',
        mert: ['kéztőalagút szindróma mitől alakul ki', 'kéztőalagút szindróma mi az'],
        szakasz: 'Mi a kéztőalagút-szindróma, és mitől alakul ki?',
        horgony: [
          'középideg nyomás alá kerül',
          'szűk járat',
          'Egyetlen okot tehát ritkán lehet megnevezni',
        ],
      },
      {
        // A cikk elsődleges célkifejezése is ez („kezelése házilag”), és a
        // „csuklórögzítő” is ide fut: a cikk maga mondja ki, hogy magyarul így
        // hívják a sínt.
        kerdes: 'Mit tehetsz otthon, mielőtt műtétre kerül a sor?',
        valasz:
          'Három nem műtéti lehetőségről van értékelhető bizonyíték: az éjszakai csuklósínről, a ' +
          'kortikoszteroid injekcióról és az idegsiklató gyakorlatokról. Első lépésként az éjszakai ' +
          'csuklósín jön szóba, amit magyarul csuklórögzítőnek is hívnak, és akár hat hét is kell, ' +
          'mire javulni kezd. A valós kép ez: nem tudjuk, hogy használ-e, de olcsó és ártalmatlan, ' +
          'tehát megpróbálható. Konkrét terméket nem ajánlunk, a sín és a fájdalomcsillapító ' +
          'kiválasztásában a gyógyszerész is tud segíteni.',
        mert: [
          'kéztőalagút szindróma kezelése házilag',
          'kéztőalagút szindróma kezelése',
          'kéztőalagút szindróma csuklórögzítő',
          'Trends top: kezelése (75)',
        ],
        szakasz: 'Mit tehetsz, mielőtt műtétre kerül a sor?',
        horgony: [
          'Három nem műtéti lehetőségről van értékelhető bizonyíték',
          'csuklórögzítőnek',
          'olcsó és ártalmatlan',
        ],
      },
      {
        // A „torna” az autocomplete ELSŐ helye ennél a kifejezésnél. A cikk
        // válasza kellemetlen, de egyértelmű, ezért szó szerint ezt visszük.
        kerdes: 'Segít a torna a kéztőalagút-szindrómán?',
        valasz:
          'A torna nem gyógyítja meg a kéztőalagút-szindrómát: kevés bizonyíték szól amellett, hogy ' +
          'a kézgyakorlatok enyhítik a tüneteket. A gyakorlatozás a hosszú távú, beteg által ' +
          'jelentett eredményt nem javítja, és a konzervatív módszerek között nincs jelentős ' +
          'különbség a betegek által jelentett eredményekben. Az idegsiklató gyakorlatok inkább ' +
          'kiegészítőnek jók, amelyek gyorsíthatják a funkció visszatérését. A rendezett gyakorlás ' +
          'arra jó, hogy legyen napi rendszered addig, amíg a kezelésről születik döntés.',
        mert: ['kéztőalagút szindróma torna'],
        szakasz: 'Amit őszintén el kell mondanunk a gyakorlatokról',
        horgony: [
          'Nem gyógyítja meg',
          'kevés bizonyíték szól amellett',
          'a funkció visszatérését',
        ],
      },
      {
        // A „műtét” és a „műtét után” két külön mért kifejezés, a cikkben két
        // külön H2. Egy tételbe vontuk, mert a beteg kérdése is egy: mikor, és
        // utána mi jön.
        kerdes: 'Mikor merül fel a műtét, és mennyi a felépülés?',
        valasz:
          'A műtétről mindig orvos dönt, és akkor kerül szóba, ha a tünetek romlanak vagy nem ' +
          'múlnak. A legtöbb betegnél a kéztőalagút-szindróma idővel romlik, és ha túl sokáig marad ' +
          'kezeletlenül, tartós kézfunkció-károsodáshoz vezethet. A műtét általában meggyógyítja a ' +
          'kéztőalagút-szindrómát, a megszokott tevékenységekhez pedig utána körülbelül egy hónap ' +
          'kell. A szorító- és a csippentőerő 2–3 hónap alatt tér vissza, a teljes felépülés akár ' +
          'egy évig is eltarthat.',
        mert: ['kéztőalagút szindróma műtét', 'kéztőalagút szindróma műtét után'],
        szakasz: 'Mikor merül fel a műtét?',
        horgony: [
          'tartós kézfunkció-károsodáshoz vezethet',
          'körülbelül egy hónap',
          'akár egy évig is eltarthat',
        ],
      },
    ],
  },
  {
    slug: 'teniszkonyok',
    tetelek: [
      {
        kerdes: 'Mitől alakul ki a teniszkönyök?',
        valasz:
          'A teniszkönyök a könyök külső oldalán tapadó ínszövet túlterheléses elváltozása: az ín ' +
          'elhasználódásáról, egyes esetekben mikroszakadásairól van szó. Okként azok a ' +
          'tevékenységek jönnek szóba, amelyeknél megfogsz valamit, és közben ismételten csavarod a ' +
          'csuklód és az alkarod. Ilyen a számítógépes munka, a kézműves feladat, például a varrás ' +
          'és a csavarhúzózás, és a szabadidős tevékenység, például a tenisz és a hangszeres játék. ' +
          'Nem csak sportolóknál jelentkezik: a festők, a vízvezeték-szerelők és az asztalosok ' +
          'különösen hajlamosak rá.',
        mert: [
          'teniszkönyök mitől alakul ki',
          'teniszkönyök kialakulása',
          'teniszkönyök mi az',
        ],
        szakasz: 'Mi a teniszkönyök, és mitől alakul ki?',
        horgony: [
          'túlterheléses elváltozása',
          'ismételten csavarod a csuklód és az alkarod',
          'Nem csak sportolóknál jelentkezik',
        ],
      },
      {
        kerdes: 'Hol fáj a teniszkönyök, és mik a tünetei?',
        valasz:
          'A teniszkönyök fő tünete a fájdalom a könyök külső oldalán. Jellemzően akkor rosszabb, ' +
          'amikor emeled vagy hajlítod a karod, amikor megfogsz valamit, és amikor mozgatod a ' +
          'csuklód. Előfordulhat nyomásérzékenység vagy duzzanat a könyökben, fájdalom az alkarban, ' +
          'gyenge szorítóerő, és az is, hogy nehezen tudod teljesen kinyújtani a karod. Ez viszont ' +
          'tünetlista, nem diagnózis: a könyökfájdalom mögött más ok is állhat, és ezt szakember ' +
          'tudja megítélni.',
        mert: ['teniszkönyök hol fáj', 'teniszkönyök tünetei', 'Trends top: tünetei (45)'],
        szakasz: 'Honnan tudod, hogy a könyökfájdalmad teniszkönyök?',
        horgony: [
          'fájdalom a könyök külső oldalán',
          'gyenge szorítóerő',
          'tünetlista, nem diagnózis',
        ],
      },
      {
        // A „kezelése” a Trends-lista első helye (100), és a „házilag”,
        // „házi gyógymód”, „borogatás”, „fájdalom csillapítása” mind ide fut.
        // A gyúlékonyság-figyelmeztetés benne marad: a cikk is kiemeli, és
        // idézve is értelmesnek kell lennie.
        kerdes: 'Hogyan kezelheted a teniszkönyököt otthon?',
        valasz:
          'A teniszkönyök otthoni kezelése azzal kezdődik, hogy kerülöd vagy csökkented azokat a ' +
          'tevékenységeket, amelyek rontják a tüneteidet. Emellett szóba jön a paracetamol vagy a ' +
          'fájó területre kent gyulladáscsökkentő gél, a meleg vagy hideg borogatás törölközőbe ' +
          'csavarva, legfeljebb 20 percig, 2–3 óránként, továbbá egyszerű gyakorlatok és a ' +
          'patikában kapható alkarpánt. Ha ibuprofén gélt használsz, ne dohányozz, és ne menj nyílt ' +
          'láng közelébe: a gél gyúlékony, és súlyos égés kockázatával jár.',
        mert: [
          'teniszkönyök kezelése',
          'teniszkönyök kezelése házilag',
          'teniszkönyök házi gyógymód',
          'teniszkönyök borogatás',
          'Trends top: kezelése (100)',
        ],
        szakasz: 'Hogyan kezelheted a teniszkönyököt otthon?',
        horgony: [
          'rontják a tüneteidet',
          'legfeljebb 20 percig, 2–3 óránként',
          'súlyos égés kockázatával jár',
        ],
      },
      {
        // A mérés legerősebben EMELKEDŐ kifejezése: pánt +120, a top-listán 71.
        // A cikk viszont csak annyit mond róla, hogy az otthoni teendők között
        // van, és patikában kapható. Hatásosságot ezért nem állítunk.
        kerdes: 'Segít a teniszkönyök pánt?',
        valasz:
          'A rögzítés az otthoni teendők között szerepel: alkarpánt, csuklórögzítő vagy ' +
          'könyökrögzítő is kapható patikában. Hogy melyik rögzítő való neked, abban a gyógyszerész ' +
          'is tud tanácsot adni. A pánt mellett ugyanilyen fontos a terhelés: kerüld vagy csökkentsd ' +
          'azokat a tevékenységeket, amelyek rontják a tüneteidet, de nem kell mindent abbahagynod, ' +
          'mert a csökkentés is opció.',
        mert: [
          'teniszkönyök pánt',
          'teniszkönyök pánt használata',
          'teniszkönyök rögzítő',
          'teniszkönyök bandázs',
          'Trends top: pánt (71), emelkedő +120',
        ],
        szakasz: 'Hogyan kezelheted a teniszkönyököt otthon?',
        horgony: [
          'Alkarpánt, csuklórögzítő vagy könyökrögzítő',
          'melyik rögzítő való neked',
          'a csökkentés is opció',
        ],
      },
      {
        kerdes: 'Mikor segít a gyógytorna a teniszkönyöknél?',
        valasz:
          'A gyógytorna akkor segíthet, ha az otthoni kezelés hat hét után sem hozott javulást. ' +
          'Háziorvoshoz ennél hamarabb érdemes menni: akkor keresd fel, ha legalább két hét pihenés ' +
          'és otthoni kezelés után is fáj a könyököd. A gyógytornán masszázs jöhet szóba, emellett a ' +
          'csuklóra és az alkarra irányuló nyújtó és erősítő gyakorlatok, valamint ultrahangkezelés. ' +
          'A gyakorlatozás a legnagyobb összesítés szerint jobb eredményt ad a passzív kezeléseknél, ' +
          'de a hatás kicsi, és a bizonyosság alacsony.',
        mert: [
          'teniszkönyök gyógytorna',
          'teniszkönyök masszírozása',
          'Trends top: gyógytorna (25), emelkedő +40',
        ],
        szakasz: 'Mikor menj gyógytornászhoz vagy orvoshoz?',
        horgony: [
          'hat hét után',
          'legalább két hét pihenés',
          'jobb eredményt ad a passzív kezeléseknél',
        ],
      },
      {
        kerdes: 'Mikor merül fel a műtét a teniszkönyöknél?',
        valasz:
          'A műtét akkor merül fel, ha 6–12 hónap után is megvan a teniszkönyök, és a döntést mindig ' +
          'orvos hozza meg. A betegek körülbelül 80–95%-a sikerrel jár a nem műtéti kezeléssel, a ' +
          'teniszkönyök-műtét pedig a betegek 80–90%-ánál sikeres. Ehhez tartozik egy fenntartás is: ' +
          'a műtét után nem ritka az erővesztés.',
        mert: ['teniszkönyök műtét', 'Trends top: műtét (24), emelkedő +50'],
        szakasz: 'Mikor menj gyógytornászhoz vagy orvoshoz?',
        horgony: ['6–12 hónap után is megvan', '80–95%-a sikerrel jár', 'nem ritka az erővesztés'],
      },
    ],
  },
  {
    slug: 'pattano-ujj',
    tetelek: [
      {
        kerdes: 'Mitől alakul ki a pattanó ujj?',
        valasz:
          'A pattanó ujjnál az ujj hajlítóina nem tud simán átcsúszni a tenyér tövénél lévő gyűrűn, ' +
          'amit A1-gyűrűnek hívnak. Az ín megvastagszik vagy csomót képez, és maga a gyűrű is ' +
          'megvastagodhat és beszűkülhet, így kevesebb hely marad az ínnak. Ez adja az akadást, a ' +
          'pattanást és a fájdalmat: az ujj vagy a hüvelykujj behajlított helyzetben megakad.',
        mert: ['pattanó ujj mitől alakul ki'],
        szakasz: 'Mi történik az ujjadban, amikor „pattan”?',
        horgony: [
          'nem tud simán átcsúszni',
          'kevesebb hely marad az ínnak',
          'behajlított helyzetben megakad',
        ],
      },
      {
        // A mérésben nincs „tünetei” vagy „hol fáj” a pattanó ujjra; a
        // legközelebbi tünet-kereső kifejezés a „hüvelykujj” és a „hüvelykujj
        // fájdalom”, ezért erre feleltünk.
        kerdes: 'Melyik ujjat érinti a pattanó ujj, és hol fáj?',
        valasz:
          'A pattanó ujj leggyakrabban a gyűrűsujjat és a hüvelykujjat érinti, a pattanó hüvelykujj ' +
          'tehát nem ritka. A jellegzetes tünet a kattanó, pattanó vagy beakadó érzés az ujj ' +
          'mozgatásakor, mellette pedig fájdalom az ujj tövénél, hajlításkor vagy nyújtáskor. A ' +
          'merevség és az akadás mozdulatlanság után a legerősebb, például amikor felébredsz, és ' +
          'előfordul, hogy a másik kezeddel kell kiegyenesítened az ujjat.',
        mert: ['pattanó ujj hüvelykujj', 'pattanó ujj hüvelykujj fájdalom'],
        szakasz: 'Miért reggel a legrosszabb?',
        horgony: [
          'a gyűrűsujjat és a hüvelykujjat érinti',
          'az ujj tövénél, hajlításkor vagy nyújtáskor',
          'a másik kezeddel kell kiegyenesítened',
        ],
      },
      {
        // A Trends szerint a „kezelése házilag” EMELKEDIK (+50). A cikk itt
        // fontos határt húz: a sínezés NEM otthoni döntés. Ezt a határt a
        // válasz is meghúzza, különben félrevezetne.
        kerdes: 'Mit tehetsz otthon a pattanó ujj ellen?',
        valasz:
          'Otthon, magadtól két dolog jön szóba: kerüld vagy csökkentsd a tüneteket rontó ' +
          'tevékenységeket, és szedj fájdalomcsillapítót, ha kell. Az ismétlődő markoló és ' +
          'csippentő mozdulatok a kockázati tényezők közé tartoznak, ezért ezek csökkentése ésszerű ' +
          'első lépés, külön vizsgálati eredményt viszont erre nem találtunk. A sínezés ennél egy ' +
          'szinttel feljebb van: nem öngyógyító módszer, hanem háziorvosi vagy szakorvosi kezelés, ' +
          'és a sín kiválasztása, mérete és beállítása szakember dolga.',
        mert: [
          'pattanó ujj kezelése házilag',
          'pattanó ujj kezelése',
          'Trends top: kezelése (80), emelkedő +40; kezelése házilag emelkedő +50',
        ],
        szakasz: 'Mit tehetsz otthon, és mit tud a sín?',
        horgony: [
          'nem öngyógyító módszer',
          'markoló és csippentő mozdulatok',
          'beállítása szakember dolga',
        ],
      },
      {
        kerdes: 'Mennyire segít a sín a pattanó ujjnál?',
        valasz:
          'A sínezés az a kezelés, amiről a legtöbbet tudjuk: rövid távon, egy éven belül ' +
          'következetesen csökkentette a fájdalmat, megszüntette az akadást, és javította a ' +
          'kézfunkciót. A közölt sikerarány akár 97% volt, ez viszont a legjobb közölt érték, nem az ' +
          'átlag, és ezek rövid távú eredmények. A sín akkor volt a leghatékonyabb, ha napi 24 órán ' +
          'át viselték. Hogy melyik ízületet érdemes rögzíteni, abban nem egységes a kép, ezért a ' +
          'sín kiválasztása szakember dolga.',
        mert: ['pattanó ujj rögzítő'],
        szakasz: 'Mit tehetsz otthon, és mit tud a sín?',
        horgony: [
          'amiről a legtöbbet tudjuk',
          'a legjobb közölt érték, nem az átlag',
          'napi 24 órán át viselték',
        ],
      },
      {
        // A Trends-lista első helye (100). A cikk számot is ad, de rögtön a
        // hatókör-jelzéssel együtt: a fokozatot orvos állapítja meg.
        kerdes: 'Mikor kerül sor műtétre pattanó ujjnál?',
        valasz:
          'A műtét akkor kerül szóba, ha a többi kezelés nem hozott eredményt, és a kezelés ' +
          'kiválasztása orvosi döntés. A nem műtéti kezelés egy 2025-ös vizsgálatban az esetek ' +
          '68,9%-ánál hozott megszűnést vagy javulást: az enyhébb, 1-es és 2-es fokozatú eseteknél ' +
          'a siker körülbelül 75% volt, a 3-as fokozatnál 60%. A fokozatot orvos állapítja meg ' +
          'vizsgálattal, ezt otthon nem lehet eldönteni.',
        mert: ['pattanó ujj műtét', 'Trends top: műtét (100)'],
        szakasz: 'Sín, injekció vagy műtét: mi mennyire válik be?',
        horgony: [
          'ha a többi kezelés nem hozott eredményt',
          'A fokozatot orvos állapítja meg',
        ],
      },
      {
        kerdes: 'Mennyi a pattanó ujj műtét utáni gyógyulási ideje?',
        valasz:
          'A seb általában néhány hét alatt begyógyul, a duzzanat és a merevség viszont 4–6 hónap ' +
          'alatt múlik el teljesen. A teljes felépülés érzete átlagosan a műtét után 6 hónappal ' +
          'érkezik meg, vagyis a felépülés jóval tovább tart, mint a seb gyógyulása. Azt, hogy mikor ' +
          'mit szabad, a műtétet végző orvos és a gyógytornászod mondja meg.',
        mert: ['pattanó ujj műtét utáni gyógyulási idő'],
        szakasz: 'Mennyi a pattanó ujj műtét utáni gyógyulási idő?',
        horgony: [
          'néhány hét alatt begyógyul',
          '4–6 hónap alatt múlik el teljesen',
          'a műtét után 6 hónappal',
        ],
      },
    ],
  },
  {
    slug: 'csuklo-es-kezfajdalom',
    tetelek: [
      {
        kerdes: 'Mi okozhat csuklófájdalmat?',
        valasz:
          'A csuklófájdalomnak sokféle oka lehet, és a leggyakoribb a csukló megütése vagy sérülése. ' +
          'Hirtelen, éles fájdalom, duzzanat és a sérüléskor hallott pattanó vagy roppanó hang ' +
          'törött csuklóra utalhat, a fájdalom, a duzzanat és a véraláfutás pedig rándult csuklóra. ' +
          'A hüvelykujj tövénél jelentkező tartós fájdalom ínhüvelygyulladás vagy artrózis, az éjjel ' +
          'erősödő zsibbadás kéztőalagút-szindróma, a csukló tetején lévő sima tapintású csomó pedig ' +
          'ganglion lehet. Ez a lista tájékozódásra való: ne próbáld magad megállapítani a fájdalom ' +
          'okát.',
        mert: ['csuklófájdalom okai'],
        szakasz: 'Mi okozhat csukló- és kézfájdalmat?',
        horgony: [
          'a csukló megütése vagy sérülése',
          'sima tapintású',
          'ne próbáld magad megállapítani a fájdalom okát',
        ],
      },
      {
        kerdes: 'Hogyan kezelhető otthon a csuklófájdalom?',
        valasz:
          'A csuklófájdalom otthoni kezelése pihentetéssel, jegeléssel és a kéz kíméletes ' +
          'mozgatásával kezdődik. A jégpakolást tedd törölközőbe, és tartsd a csuklódon legfeljebb ' +
          '20 percig, 2–3 óránként; ha duzzadtnak látod a kezed, vedd le az ékszereidet. Éjszakára ' +
          'sín támaszthatja meg a csuklód, a nehéz feladatokhoz, például üvegnyitáshoz pedig ' +
          'segédeszköz is jöhet. Sérülés után az első 2–3 napban ne használj melegítő pakolást, ne ' +
          'fürödj forró vízben, ne emelj nehezet, és ne szoríts meg semmit erősen.',
        mert: ['csuklófájdalom kezelése', 'csuklófájdalom ellen'],
        szakasz: 'Mit tehetsz otthon az első napokban?',
        horgony: [
          'pihentetéssel, jegeléssel',
          'legfeljebb 20 percig, 2–3 óránként',
          'ne használj melegítő pakolást',
        ],
      },
      {
        kerdes: 'Milyen orvoshoz fordulj csuklófájdalommal?',
        valasz:
          'Az első lépés lehet a gyógyszertár: a gyógyszerész tud tanácsot adni a ' +
          'fájdalomcsillapítóról, a sínről, és arról is, kell-e orvoshoz menned. Nálunk a háziorvos ' +
          'az, aki megvizsgál, és ha kell, továbbküld a megfelelő szakrendelésre. Orvoshoz akkor ' +
          'kell fordulni, ha a csuklófájdalom akadályoz a szokásos tevékenységeidben, ha romlik, ha ' +
          'újra és újra visszatér, vagy ha két hét otthoni kezelés után sem javult. Bármilyen ' +
          'bizsergés vagy érzéskiesés esetén szintén orvosi vizsgálat kell.',
        mert: ['csuklófájdalom milyen orvos'],
        szakasz: 'Milyen orvoshoz fordulj csuklófájdalommal, és mikor?',
        horgony: [
          'Az első lépés lehet a gyógyszertár',
          'továbbküld a megfelelő szakrendelésre',
          'két hét otthoni kezelés után sem javult',
        ],
      },
      {
        // Két mért kifejezés egy tételben: a cikk H2-je is együtt kezeli a
        // terhességet és a szülés utáni időszakot, mert a két mintázat más
        // kórképhez tartozik, de ugyanabban az élethelyzetben jelentkezik.
        kerdes: 'Terhesség alatt vagy szülés után miért fáj a csuklód?',
        valasz:
          'Terhesség alatt gyakoribb a kéztőalagút-szindróma, mert a terhesség a kockázati tényezők ' +
          'közé tartozik, és a panasz néha néhány hónap alatt magától rendeződik. A hüvelykujj ' +
          'felőli csuklófájdalomnak is van szülés utáni mintázata: a De Quervain-szindróma ' +
          'összefüggésbe hozható a terhességgel és a szülés utáni időszakkal, és akinél szülés után ' +
          'jelentkezik, az gyakran 4–6 héten belül veszi észre. Jellegzetes fájdalmas mozdulat, ' +
          'amikor magad elé nyújtott karral, felfelé néző hüvelykujjal emelsz valamit, például a ' +
          'gyermekedet. Ebből nem következik, hogy nálad is ez van: a kivizsgálás küszöbe terhesség ' +
          'alatt és szülés után is ugyanaz, mint bármilyen csuklófájdalomnál.',
        mert: ['csuklófájdalom terhesség alatt', 'csuklófájdalom szülés után'],
        szakasz: 'Terhesség alatt vagy szülés után fáj a csuklód?',
        horgony: [
          'a kockázati tényezők közé tartozik',
          '4–6 héten belül veszi észre',
          'a kivizsgálás küszöbe',
        ],
      },
      {
        kerdes: 'Mit jelent, ha hirtelen kezd fájni a csuklód?',
        valasz:
          'Sérülés után otthonról nem lehet eldönteni, hogy törés, ficam vagy erős rándulás történt: ' +
          'ehhez általában röntgen kell. A törött kar vagy csukló a sérülés után hirtelen ' +
          'fájdalmassá, duzzadttá, véraláfutásossá és nehezen mozgathatóvá válik, és a terület ' +
          'zsibbadhat is. Ha törésre gyanakszol, ne kezeld magad otthon, hanem minél előbb kérj ' +
          'orvosi tanácsot. Sérülés után négy jelnél azonnal a 112-t kell hívni: ha a kar vagy a ' +
          'csukló zsibbad, ha a csont kiáll a bőrből, ha a kar alakja megváltozott, vagy ha erősen ' +
          'vérző seb van a területen.',
        mert: ['csuklófájdalom hirtelen'],
        szakasz: 'Sérülés után fáj a csuklód? Ezt figyeld',
        horgony: [
          'általában röntgen kell',
          'ne kezeld magad otthon',
          'A csont kiáll a bőrből',
        ],
      },
      {
        // A mért „krém” kifejezés. A cikk gyógyszert nem ajánl, ezért a válasz
        // sem tesz mást, mint amit a cikk: megnevezi, mi jön szóba, és a
        // gyógyszerészhez küld.
        kerdes: 'Segít valamilyen krém vagy gél a csuklófájdalomra?',
        valasz:
          'Fájdalomcsillapítóként a paracetamol és az ibuprofén gél jön szóba. Gyógyszerről és ' +
          'adagolásról ez a cikk nem ad tanácsot: a gyógyszerész tud segíteni abban, melyik ' +
          'fájdalomcsillapító a legjobb neked. A sín kiválasztásában is a gyógyszerész az első ' +
          'segítség.',
        mert: ['csuklófájdalom krém'],
        szakasz: 'Mit tehetsz otthon az első napokban?',
        horgony: [
          'a paracetamol és az ibuprofén gél jön szóba',
          'melyik fájdalomcsillapító a legjobb neked',
          'a gyógyszerész az első segítség',
        ],
      },
    ],
  },
  {
    slug: 'csuklotores-utani-gyogytorna',
    // Öt tétel, nem hat. A mérés 13 kifejezést hozott, ebből a „tünetei”, a
    // „gipsz helyett”, a „lelki okai”, a „bno”, a „bno kód” és az „angolul”
    // olyan kérdés, amire ez a cikk nem válaszol. Kitalálni nem lehet: a
    // hiánylista a betöltő dokumentációjában áll.
    tetelek: [
      {
        kerdes: 'Mikor indul a csuklótörés utáni gyógytorna?',
        valasz:
          'Ha nem kellett műtét, a gipszet jellemzően 4–6 héttel a törés után veszik le, és ekkor ' +
          'indul a gyógytorna. A gipsz levétele után szinte mindenkinél marad merevség a csuklóban, ' +
          'és a csukló meg a kar gyenge is lehet. Ez nem visszaesés, hanem a felépülés első ' +
          'szakasza, a merevség és a gyengeség viszont néha több hónapig is elhúzódik.',
        mert: ['csuklótörés utáni gyógytorna'],
        szakasz: 'Mikor veszik le a gipszet, és mi történik utána?',
        horgony: [
          '4–6 héttel a törés után veszik le',
          'marad merevség a csuklóban',
          'nem visszaesés',
        ],
      },
      {
        kerdes: 'Mennyi a csuklótörés gyógyulási ideje?',
        valasz:
          'A felgyógyulás általában 6–8 hét, súlyosabb sérülésnél tovább. A legtöbb csuklótörés ' +
          'körülbelül 3 hónap alatt gyógyul annyira, hogy a csuklót minden tevékenységre használni ' +
          'lehet, a teljes felépülés viszont akár egy évig is eltarthat. A merevség a gipszlevétel ' +
          'vagy a műtét utáni egy-két hónapban javul a legtöbbet, és legalább két évig tovább javul. ' +
          'Ezek átlagok, nem határidők; ha a fájdalom sokkal erősebb és tartósabb, mint amit a ' +
          'sérülés indokolna, orvosi kivizsgálás kell.',
        mert: ['csuklótörés gyógyulási ideje'],
        szakasz: 'Meddig tart a gyógyulás csuklótörés után?',
        horgony: [
          'általában 6–8 hét',
          'legalább két évig tovább javul',
          'Ezek átlagok, nem határidők',
        ],
      },
      {
        // A cikk nem sorol fel konkrét gyakorlatokat, és a válasz sem talál ki
        // ilyet: azt mondja el, mit lehet a gipsz alatt csinálni, és milyen
        // elvekre épül a program.
        kerdes: 'Milyen gyakorlatokat végezhetsz csuklótörés után?',
        valasz:
          'A gipsz felhelyezése vagy a műtét után azonnal el kell kezdened mozgatni az ujjaidat, és ' +
          'a kezed lehetőleg a könyököd fölött tartani. Az ujjak mozgatása és a kéz magasan tartása ' +
          'a legtöbb, amit a gipsz alatt magadért tehetsz, a további gyakorlatokba pedig csak akkor ' +
          'kezdj bele, ha a kezelőorvosod engedélyezte. Egy értelmes otthoni program négy elven áll: ' +
          'fokozatosság (előbb a mozgástartomány, utána az erő), rendszeresség (rövid, napi ' +
          'alkalmak), fájdalomhatár (a gyakorlatoknak nem kell fájniuk) és türelem.',
        mert: ['csuklótörés utáni gyógytorna gyakorlatok'],
        szakasz: 'Hogyan épül fel egy értelmes otthoni program?',
        horgony: [
          'azonnal el kell kezdened mozgatni az ujjaidat',
          'a legtöbb, amit a gipsz alatt magadért tehetsz',
          'a gyakorlatoknak nem kell fájniuk',
        ],
      },
      {
        kerdes: 'Csuklótörés után mikor lehet dolgozni?',
        valasz:
          'Erre nincs egyetlen szám, mert a munkaterhelés mindenkinél más: egy irodai nap és egy ' +
          'szerszámmal töltött nap nem ugyanaz a csuklódnak. Amit kérhetsz, az a konkrét ' +
          'tájékoztatás: a törést ellátó csapatnak szóban és írásban is meg kell adnia a várható ' +
          'kimenetelt, benne azzal, mikor térhetsz vissza a szokásos tevékenységeidhez. Addig egy ' +
          'egyszerű szabály él: ne vezess, és ne emelj nehezet, amíg meg nem mondják, hogy szabad.',
        mert: ['csuklótörés után mikor lehet dolgozni'],
        szakasz: 'Csuklótörés után mikor lehet dolgozni?',
        horgony: [
          'a munkaterhelés mindenkinél más',
          'szóban és írásban is meg kell adnia',
          'ne vezess, és ne emelj nehezet',
        ],
      },
      {
        kerdes: 'Mire figyelj, amíg a gipsz rajtad van?',
        valasz:
          'Kérj orvosi tanácsot, ha a fájdalom erősödik a karodban vagy a csuklódban, ha nagyon ' +
          'magas a lázad, vagy ha melegséget és hidegrázást érzel. Szólj akkor is, ha a gipsz ' +
          'eltörik, túl szorossá vagy túl lazává válik. Sürgősen kérj tanácsot, ha az ujjaid, a ' +
          'csuklód vagy a karod zsibbadni kezd, megduzzad, elkékül vagy elfehéredik, és ugyanígy a ' +
          'gipsz alól jövő rossz szag és váladék esetén. Két dolgot ne tegyél: a gipsz ne ázzon el, ' +
          'és ne nyúlj alá semmivel a viszketés miatt, mert az fertőzéshez vezethet.',
        mert: ['csuklótörés gipsz'],
        szakasz: 'Mire figyelj, amíg a gipsz rajtad van?',
        horgony: [
          'túl szorossá vagy túl lazává válik',
          'elkékül vagy elfehéredik',
          'ne ázzon el',
        ],
      },
    ],
  },
  {
    slug: 'inhuvelygyulladas',
    tetelek: [
      {
        kerdes: 'Mennyi ideig tarthat?',
        valasz:
          'Nincs megígérhető időablak. A lefolyás egyéni. A De Quervain-kép magától is rendeződhet, ' +
          'ebből nem következik, hogy nálad is így lesz.',
        mert: ['ínhüvelygyulladás', 'Monid 01M0SJQ0SBHS103YQ37Z6MTX1B'],
        szakasz: 'Mennyi ideig tarthat?',
        horgony: ['Nincs megígérhető időablak', 'A lefolyás egyéni', 'magától is rendeződhet'],
      },
      {
        kerdes: 'Mit tehetek házilag?',
        valasz:
          'Kíméld a rontó mozdulatot, jegelj textillel, kérj tanácsot a fájdalomcsillapítóról. ' +
          'Ez az első lépés, nem a teljes kezelés. A sín, az injekció és a műtét orvosi döntés.',
        mert: ['ínhüvelygyulladás kezelése házilag', 'Monid 01M0SJQ0SBHS103YQ37Z6MTX1B'],
        szakasz: 'Mit tehetek házilag?',
        horgony: [
          'jegelj textillel',
          'nem a teljes kezelés',
          'A sín, az injekció és a műtét orvosi döntés',
        ],
      },
      {
        kerdes: 'Hideg vagy meleg?',
        valasz:
          'Hideg, textilben. Sérülés után 2–3 napig ne melegíts, és ne fürödj forrón.',
        mert: ['ínhüvelygyulladás', 'Monid 01M0SJQ0SBHS103YQ37Z6MTX1B'],
        szakasz: 'Hideg vagy meleg?',
        horgony: ['Hideg, textilben', 'ne melegíts', 'ne fürödj forrón'],
      },
      {
        kerdes: 'Kell-e sín vagy rögzítő?',
        valasz:
          'A sín, különösen éjjel, a nem műtéti sorban van. Hogy rád kell-e, szakember dönti el. ' +
          'A sín önmagában vitatott. A tape / kinesio szalag ennél a képnél nem megnyitott evidencia: ' +
          'nem állítjuk, hogy segít, és terméket sem ajánlunk.',
        mert: ['ínhüvelygyulladás', 'Monid 01M0SJQ0SBHS103YQ37Z6MTX1B'],
        szakasz: 'Kell-e sín vagy rögzítő?',
        horgony: [
          'különösen éjjel',
          'A sín önmagában vitatott',
          'nem állítjuk, hogy segít',
        ],
      },
      {
        kerdes: 'Ínhüvelygyulladás vagy kéztőalagút?',
        valasz:
          'A hüvelykoldali ínhüvely-panasz fogásra és csuklófordításra fáj. A kéztőalagút a ' +
          'középideg nyomása: inkább éjszakai zsibbadás és ügyetlenség. A kettő előfordulhat együtt. ' +
          'A szétválasztás vizsgálat.',
        mert: ['ínhüvelygyulladás', 'kéztőalagút', 'Monid 01M0SJQ0SBHS103YQ37Z6MTX1B'],
        szakasz: 'Ínhüvelygyulladás vagy kéztőalagút?',
        horgony: [
          'fogásra és csuklófordításra fáj',
          'éjszakai zsibbadás',
          'A szétválasztás vizsgálat',
        ],
      },
      {
        kerdes: 'Mikor kell orvoshoz menni?',
        valasz:
          'Ha a panasz akadályoz, romlik, visszatér, vagy két hét otthon után sem javul. ' +
          'Bizsergésnél, érzéskiesésnél, cukorbetegségnél és lázas, meleg, duzzadt képnél is. ' +
          'Négy Kanavel-jel együtt: azonnali sürgősségi osztály.',
        mert: ['ínhüvelygyulladás', 'Monid 01M0SJQ0SBHS103YQ37Z6MTX1B'],
        szakasz: 'Mikor kell orvoshoz menni?',
        horgony: [
          'két hét otthon után sem javul',
          'Négy Kanavel-jel együtt',
          'azonnali sürgősségi osztály',
        ],
      },
    ],
  },
  {
    slug: 'befagyott-vall',
    tetelek: [
      {
        kerdes: 'Milyen szakaszai vannak?',
        valasz:
          'A magyar irányelv három stádiumot ír le. A betegtájékoztatók fagyási, merev és olvadó ' +
          'felosztása más időablakú. A szakaszt vizsgálattal állapítják meg. Ne sorold be magad.',
        mert: ['befagyott váll', 'Monid 01M0ST9XKE8HY4VC81DB7BWAAP'],
        szakasz: 'Milyen szakaszai vannak?',
        horgony: [
          'három stádiumot ír le',
          'fagyási, merev és olvadó',
          'Ne sorold be magad',
        ],
      },
      {
        kerdes: 'Mennyi ideig tarthat?',
        valasz:
          'A tünetek fellépésétől átlagosan 1–3 év. Más tájékoztatók is években számolnak, van ahol ' +
          'több mint két évet írnak. Enyhe merevség visszamaradhat. Ez csoportos lefolyás, nem ígéret rád.',
        mert: ['befagyott váll', 'Monid 01M0ST9XKE8HY4VC81DB7BWAAP'],
        szakasz: 'Mennyi ideig tarthat?',
        horgony: [
          'átlagosan 1–3 év',
          'Enyhe merevség visszamaradhat',
          'nem ígéret rád',
        ],
      },
      {
        kerdes: 'Tornázhatok, ha fáj?',
        valasz:
          'Csak a vizsgáló által betanított, a fájdalomhatárig vitt gyakorlat. Magas irritációnál ' +
          'fájdalommentes mozgás kell, nem áterőltetés. Ha a gyakorlat rontja a tüneted, hagyd abba, ' +
          'és szólj a gyógytornászodnak vagy az orvosodnak.',
        mert: ['befagyott váll torna', 'Monid 01M0ST9XKE8HY4VC81DB7BWAAP'],
        szakasz: 'Tornázhatok, ha fáj?',
        horgony: [
          'fájdalomhatárig vitt gyakorlat',
          'nem áterőltetés',
          'hagyd abba',
        ],
      },
      {
        kerdes: 'Magától elmúlik?',
        valasz:
          'A legtöbb esetben a fájdalom és a merevség idővel javul. Kezeletlenül is javulhat a ' +
          'mozgás, csak lassabban. Nem minden tünet tűnik el teljesen. Enyhe merevség maradhat.',
        mert: ['befagyott váll', 'Monid 01M0ST9XKE8HY4VC81DB7BWAAP'],
        szakasz: 'Magától elmúlik?',
        horgony: [
          'idővel javul',
          'Kezeletlenül is javulhat',
          'Enyhe merevség maradhat',
        ],
      },
      {
        kerdes: 'Befagyott váll vagy rotátorköpeny?',
        valasz:
          'Otthonról nem dönthető el. Itt az aktív és a passzív mozgás is beszűkül. ' +
          'Rotátorköpenynél a passzív mozgás gyakran megmarad, és a panasz terheléshez vagy ' +
          'eséshez kötődhet. A diagnózist orvos mondja ki.',
        mert: ['befagyott váll', 'Monid 01M0ST9XKE8HY4VC81DB7BWAAP'],
        szakasz: 'Befagyott váll vagy rotátorköpeny?',
        horgony: [
          'Otthonról nem dönthető el',
          'passzív mozgás is beszűkül',
          'A diagnózist orvos mondja ki',
        ],
      },
      {
        kerdes: 'Mikor kell orvoshoz menni?',
        valasz:
          'Ha a fájdalom és a merevség nem múlik, vagy annyira erős, hogy alig mozdul a kar. ' +
          'Aznap, ha hirtelen nagyon erős a fájdalom, ha nem mozdul a kar, ha megváltozott az ' +
          'alakja, vagy ha lázad van. Cukorbetegség mellett ne várj sokáig.',
        mert: ['befagyott váll', 'Monid 01M0ST9XKE8HY4VC81DB7BWAAP'],
        szakasz: 'Mikor kell orvoshoz menni?',
        horgony: [
          'alig mozdul a kar',
          'hirtelen nagyon erős a fájdalom',
          'ne várj sokáig',
        ],
      },
    ],
  },
]

/** Egy cikk GYIK-je slug szerint, vagy `undefined`, ha nincs hozzá tétel. */
export function faqFor(slug: string): CikkGyik | undefined {
  return CIKK_GYIK.find((gyik) => gyik.slug === slug)
}

/**
 * A `posts.faq` mezőbe írható alak.
 *
 * A leképezés szándékosan itt él, az adat mellett: így a betöltő nem ismeri a
 * belső mezőneveket, és a `mert`, `szakasz`, `horgony` (a mérési és cikkbeli
 * eredet) nem szivárog ki az adatbázisba. Azok a szerkesztés ellenőrzéséhez
 * kellenek, nem a látogatónak.
 */
export function faqMezore(slug: string): { question: string; answer: string }[] | undefined {
  const gyik = faqFor(slug)
  if (gyik === undefined) return undefined
  return gyik.tetelek.map((tetel) => ({ question: tetel.kerdes, answer: tetel.valasz }))
}
