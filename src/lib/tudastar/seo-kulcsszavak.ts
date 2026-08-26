/**
 * Tudástár-cikkek mért kulcsszó-célzása és megosztási szövegei.
 *
 * Forrás: 2026-08-21-i Monid/Ahrefs mérés (docs/kulcsszavak.md). A cím a keresett
 * kifejezéssel kezdődik; a `elsodleges`/`masodlagos` listák Search-lockoltak
 * (2026-08-24) — volumen/KD nem másolódik a CMS-be.
 */

import { SEO_KEYWORDS_MAX_ROWS } from '../seo-keywords'

export interface CikkKulcsszo {
  /** A bejegyzés slugja (a `posts.slug` mezővel egyezik). */
  slug: string
  /** Az elsődleges célkifejezés, ahogy a felhasználó beírja. */
  elsodleges: string
  /** Mért havi keresési mennyiség (Ahrefs, hu, 2026-08). */
  volumen: number
  /** Mért kulcsszó-nehézség a százas skálán (Ahrefs). */
  nehezseg: number
  /** További mért kifejezések, amiket ugyanez a cikk visz. */
  masodlagos: readonly string[]
  /** A `posts.seoTitle` mezőbe kerülő cím. */
  seoTitle: string
  /** A `posts.seoDescription` mezőbe kerülő leírás. */
  seoDescription: string
  /** Miért pont ez a célzás — a mért indok, egy mondatban. */
  indok: string
  /**
   * A cikk TÁRGYA entitásként, a strukturált adat `about` mezőjéhez.
   *
   * A típus a schema.org hierarchiáját követi (ellenőrizve 2026-08-21):
   * Thing > MedicalEntity > MedicalCondition > MedicalSignOrSymptom. Nevesített
   * betegségnél `MedicalCondition`, panasznál (zsibbadás, fájdalom)
   * `MedicalSignOrSymptom` — a schema.org szerint „a symptom is generally
   * subjective while a sign is objective”.
   */
  targy: { tipus: 'MedicalCondition' | 'MedicalSignOrSymptom'; nev: string }
}

/**
 * A cikkek célzása, a mért megtérülés sorrendjében
 * (`docs/kulcsszavak.md` 4. „Oldalterv”; a 7. és 8. cikk Ahrefs/Monid 2026-08-24).
 */
export const CIKK_KULCSSZAVAK: readonly CikkKulcsszo[] = [
  {
    slug: 'miert-zsibbad-a-kezem',
    elsodleges: 'kéz zsibbadás',
    volumen: 450,
    nehezseg: 17,
    masodlagos: [
      'jobb kéz zsibbadás',
      'bal kéz zsibbadás',
      'bal kéz zsibbadás okai',
      'kéz zsibbadás okai',
      'jobb kéz zsibbadás okai',
      'kéz zsibbadás éjszaka',
      'kéz zsibbadás éjszaka gyakori kérdések',
      'kéz zsibbadás elleni gyógyszer',
      'ujj zsibbadás',
      'ujjak zsibbadása',
      'kéz zsibbadás kezelése',
      'kéz zsibbadás elleni krém',
      'kéz zsibbadásra krém',
      'kéz zsibbadás ellen',
      'kéz zsibbadásra vitamin',
      'kéz zsibbadás reggel',
      'kéz zsibbadás alvás közben',
      'kéz zsibbadás alváskor',
      'kéz zsibbadás alagút szindróma',
      'kéz zsibbadás terhesség alatt',
      'kéz zsibbadás terhesség alatt gyakori kérdések',
      'kéz zsibbadás bizsergés',
      'kéz zsibbadás b vitamin',
      'kéz zsibbadás cukorbetegeknek',
      'kéz zsibbadás csukló',
      'hideg kéz zsibbadás',
      'hirtelen kéz zsibbadás',
      'bal kéz zsibbadás éjszaka',
      'bal kéz zsibbadás fájdalom',
      'bal kéz zsibbadás alvás közben',
      'bal kéz hüvelykujj zsibbadás',
      'ujj zsibbadás okai',
      'ujj zsibbadás torna',
      'ujj zsibbadásra gyógyszer',
      'ujj zsibbadásra krém',
      'ujj zsibbadás műtét után',
      'ujj zsibbadás fájdalom',
      'ujj zsibbadás ellen',
      'ujj zsibbadás terhesség alatt',
      'bal ujj zsibbadás',
      'hirtelen ujj zsibbadás',
      'hüvelykujj zsibbadás',
    ],
    seoTitle: 'Kéz zsibbadás: mi okozza, és mikor kell orvos?',
    seoDescription:
      'Éjjel elzsibbad a kezed, és reggelre elmúlik? Végigvesszük, mi okozhatja a kéz zsibbadását, mit tehetsz otthon, és melyik jelnél kell azonnal orvoshoz fordulni.',
    indok:
      'A legnagyobb hozam: 450 keresés mellett a forgalmi potenciál 2 200, vagyis ötszöröse. Az erre rangsoroló oldal rengeteg rokon kérdésre is behoz.',
    targy: { tipus: 'MedicalSignOrSymptom', nev: 'Kézzsibbadás' },
  },
  {
    slug: 'keztoalagut-szindroma',
    elsodleges: 'kéztőalagút szindróma',
    volumen: 1200,
    nehezseg: 5,
    masodlagos: [
      'kéztő alagút szindróma kezelése házilag',
      'kéztőalagút szindróma műtét',
      'kéztőalagút szindróma krém',
      'kéztőalagút szindróma kezelése',
      'kéztőalagút szindróma tünetei',
      'kéztőalagút szindróma torna',
      'kéztőalagút szindróma csuklórögzítő',
      'kéztőalagút szindróma műtét után',
      'kéztőalagút szindróma hol fáj',
      'kéztőalagút szindróma mitől alakul ki',
      'kéztőalagút szindróma carpal tunnel syndrome',
      'kéztőalagút szindróma gyógyszer',
      'kéztőalagút szindróma vizsgálata',
      'kéztőalagút szindróma terhesség alatt',
      'kéztőalagút szindróma mi az',
      'kéztőalagút szindróma borogatás',
      'kéztőalagút szindróma akupunktúra',
      'kéztőalagút szindróma b vitamin',
      'kéztőalagút szindróma carpalis alagút szindróma',
      'kéztőalagút szindróma műtét ára',
      'kéztorna alagút szindróma',
    ],
    seoTitle: 'Kéztőalagút szindróma kezelése házilag',
    seoDescription:
      'Mit tehetsz a kéztőalagút szindróma ellen otthon, mielőtt műtétre kerülne a sor? Sínezés, gyakorlatok, és azok a jelek, amiknél már nem érdemes tovább várni.',
    indok:
      'A cikk a legnagyobb SZABAD kifejezést viszi: a „kéztő alagút szindróma kezelése házilag” havi 1 600 keresés, és a legerősebb versenytárs is csak a 6. helyen áll rá.',
    targy: { tipus: 'MedicalCondition', nev: 'Kéztőalagút-szindróma' },
  },
  {
    slug: 'teniszkonyok',
    elsodleges: 'teniszkönyök',
    volumen: 3500,
    nehezseg: 13,
    masodlagos: [
      'teniszkönyök kezelése',
      'teniszkönyök kezelése otthon',
      'teniszkönyök kezelése házilag',
      'teniszkönyök gyakorlatok',
      'teniszkönyök házi gyógymód',
      'teniszkönyök tünetei',
      'teniszkönyök pánt',
      'teniszkönyök gyógytorna',
      'teniszkönyök hol fáj',
      'teniszkönyök mitől alakul ki',
      'könyökfájdalom',
      'teniszkönyök krém',
      'teniszkönyök műtét',
      'teniszkönyök tape',
      'teniszkönyök rögzítő',
      'teniszkönyök masszírozása',
      'teniszkönyök bandázs',
      'teniszkönyök borogatás',
      'teniszkönyök fájdalom csillapítása',
      'teniszkönyök pánt használata',
      'teniszkönyök szorító használata',
      'teniszkönyök rögzítő használata',
      'a teniszkönyök kialakulása',
      'a teniszkönyök tünetei',
      'teniszkönyök mi az',
      'teniszkönyök betegség',
      'belső teniszkönyök',
      'golfkönyök vs teniszkönyök',
      'teniszkönyök akupunktúra',
      'teniszkönyök csontkovács',
      'teniszkönyök homeopátia',
    ],
    seoTitle: 'Teniszkönyök kezelése házilag: mit tegyél?',
    seoDescription:
      'Belenyilall a könyöködbe, ha megfogsz egy bögrét? A teniszkönyök otthoni kezelése lépésről lépésre: mely gyakorlatok segítenek, és mit érdemes most kerülni.',
    indok:
      'A legnagyobb egyedi díj a listán: 3 500 keresés 13-as nehézséggel. A keresési szándék lokális is, ezért a helyi célzás Cégprofilt kíván, nem cikket.',
    targy: { tipus: 'MedicalCondition', nev: 'Teniszkönyök' },
  },
  {
    slug: 'pattano-ujj',
    elsodleges: 'pattanó ujj',
    volumen: 800,
    nehezseg: 0,
    masodlagos: [
      'pattanó ujj kezelése házilag',
      'pattanó ujj gyakorlatok',
      'pattanó ujj gyógytorna videó',
      'pattanó ujj szindróma',
      'pattanó ujj műtét utáni gyógyulási idő',
      'beakadó ujj',
      'pattanó ujj műtét',
      'kéztorna pattanó ujjra',
    ],
    seoTitle: 'Pattanó ujj: miért akad be, és mit tehetsz?',
    seoDescription:
      'Reggel nem jön vissza magától az ujjad, aztán pattanva kiugrik? Elmondjuk, mi áll a pattanó ujj hátterében, mit tehetsz otthon, és mikor kell orvoshoz menni.',
    indok:
      'Nulla mért nehézség 800 keresés mellett. Aki elsőként ír róla rendes, szakértői cikket, az viszi az egészet.',
    targy: { tipus: 'MedicalCondition', nev: 'Pattanó ujj' },
  },
  {
    slug: 'csuklo-es-kezfajdalom',
    elsodleges: 'csukló fájdalom',
    volumen: 150,
    nehezseg: 0,
    masodlagos: [
      'csuklófájdalom',
      'kézfájdalom',
      'kéz fájdalom',
      'alkar fájdalom',
      'csukló fájdalom kezelése házilag',
      'kéz csukló fájdalom',
      'kéz és csukló fájdalom',
      'csuklófájdalom kezelése',
      'csuklófájdalom okai',
      'csuklófájdalom milyen orvos',
      'kéz alkar fájdalom',
      'kéz fájdalom zsibbadás',
      'kéz fájdalom okai',
      'kéz fájdalom kezelése',
      'kéz fájdalomra kenőcs',
      'kéz fájdalom milyen orvos',
      'bal kéz fájdalom',
      'bal kéz csukló fájdalom',
      'jobb kéz csukló fájdalom',
      'kéz hüvelykujj fájdalom',
      'csuklófájdalom krém',
      'csuklófájdalom kineziológiai tapasz',
      'csuklófájdalom terhesség alatt',
      'csuklófájdalom ellen',
      'hirtelen csuklófájdalom',
      'alkar fájdalom okai',
      'alkar fájdalom kezelése',
      'alkar fájdalom kezelése házilag',
      'alkar fájdalom és zsibbadás',
      'alkar csukló fájdalom',
    ],
    seoTitle: 'Csuklófájdalom és kézfájdalom: mi okozza?',
    seoDescription:
      'Fáj a csuklód, amikor kinyitod az üveget? Összeszedtük a csuklófájdalom és a kézfájdalom leggyakoribb okait, mit tehetsz otthon, és mikor kell kivizsgálás.',
    indok:
      'Kereskedelmi értékű fürt: a „kézfájdalom” kattintása 10, az „alkar fájdalom” 9 dollár, mindkettő nulla nehézséggel. Ahol magas a CPC, ott már keres valaki pénzt a témán.',
    targy: { tipus: 'MedicalSignOrSymptom', nev: 'Csukló- és kézfájdalom' },
  },
  {
    slug: 'csuklotores-utani-gyogytorna',
    elsodleges: 'csuklótörés utáni gyógytorna',
    volumen: 100,
    nehezseg: 0,
    masodlagos: [
      'csuklótörés utáni gyógytorna gyakorlatok',
      'csuklótörés után mikor lehet dolgozni',
      'csuklótörés gyógyulási ideje',
      'csuklótörés gipsz',
      'gipsz levétele után',
      'gipszlevétel után dagad a kéz',
      'csukló orsócsont törés gyógyulási ideje',
      'kéztorna csuklótörés után',
      'kéztorna törés után',
      'csuklótörés rehabilitáció',
      'csuklótörés',
      'csuklótörés tünetei',
      'csuklótörés műtét',
      'csuklótörés gipsz helyett',
      'gipsz levétele után torna',
    ],
    seoTitle: 'Csuklótörés utáni gyógytorna: mi jön most?',
    seoDescription:
      'Levették a gipszet, és a csuklód merev, idegen? Végigvesszük, mi történik a csuklótörés utáni gyógytorna során, mit csinálhatsz otthon, és mennyi a felépülés.',
    indok:
      'Pontosan a termék belépője: aki ezt keresi, most áll a rehabilitáció elején. A kifejezés nehézsége nulla.',
    targy: { tipus: 'MedicalCondition', nev: 'Csuklótörés' },
  },
  {
    slug: 'inhuvelygyulladas',
    elsodleges: 'ínhüvelygyulladás',
    volumen: 2200,
    nehezseg: 18,
    masodlagos: [
      'ínhüvelygyulladás tünetei',
      'hüvelykujj ínhüvelygyulladás',
      'ínhüvelygyulladás kezelése',
      'csukló ínhüvelygyulladás',
      'ínhüvelygyulladás krém',
      'ínhüvelygyulladás gyógyszer vény nélkül',
      'ínhüvelygyulladás rögzítő sín',
      'ínhüvelygyulladás gyógyulási ideje',
      'ínhüvelygyulladás hüvelykujj kezelése',
      'ínhüvelygyulladás kezelése házilag',
      'de quervain',
      'ínhüvelygyulladás torna',
      'de quervain szindróma',
      'ínhüvelygyulladás gyógyszer',
      'ínhüvelygyulladás rögzítő',
      'ínhüvelygyulladás tape',
      'ínhüvelygyulladás az ujjakban',
      'ínhüvelygyulladás alkar',
      'ínhüvelygyulladás az alkarban',
      'ínhüvelygyulladás borogatás',
      'ínhüvelygyulladás bandázs',
      'ínhüvelygyulladás csukló',
      'ínhüvelygyulladás csukló tünetei',
      'ínhüvelygyulladás csuklórögzítő',
      'ínhüvelygyulladás csukló kezelése',
      'ínhüvelygyulladás csuklószorító',
      'csukló ínhüvelygyulladás gyógytorna',
      'csukló ínhüvelygyulladás tape',
      'csukló ínhüvelygyulladás krém',
      'csukló ínhüvelygyulladás torna',
      'ínhüvelygyulladás hüvelykujj',
      'ínhüvelygyulladás hüvelykujj rögzítő',
      'ínhüvelygyulladás hüvelykujj tape',
      'ínhüvelygyulladás hol fáj',
      'ínhüvelygyulladás házi gyógymód',
      'ínhüvelygyulladás helye',
      'ínhüvelygyulladás hova kell mennem',
      'ínhüvelygyulladás hideg vagy meleg',
      'ínhüvelygyulladás hideg',
      'ínhüvelygyulladás csomó',
    ],
    seoTitle: 'Ínhüvelygyulladás: tünetek és mit tehetsz',
    seoDescription:
      'Ínhüvelygyulladás: hol fáj a csuklón és a hüvelykujjon, mit tehetsz házilag, és mikor kell orvoshoz menni. Nem diagnózis.',
    indok:
      'Ahrefs HU, Monid-futás 01M0SJQ0SBHS103YQ37Z6MTX1B: ínhüvelygyulladás 2200 keresés, KD 18. A De Quervain-kép H2, nem külön slug.',
    targy: { tipus: 'MedicalCondition', nev: 'Ínhüvelygyulladás' },
  },
  {
    slug: 'befagyott-vall',
    elsodleges: 'befagyott váll',
    volumen: 880,
    nehezseg: 12,
    masodlagos: [
      'befagyott váll torna',
      'befagyott váll szindróma',
      'befagyott váll kezelése',
      'befagyott váll kezelése otthon',
      'befagyott váll gyógytorna',
      'adhesive capsulitis',
      'adhesiv capsulitis',
      'adhezív kapszulitisz',
      'befagyott váll torna gyakorlatok',
      'befagyott váll tünetei',
      'befagyott váll szindróma mitől alakul ki',
      'befagyott vállra kenőcs',
      'befagyott váll fájdalom csillapítása',
      'befagyott váll kimozgatása altatásban',
      'befagyott váll szindróma adhesiv capsulitis',
      'befagyott váll adhezív kapszulitisz',
      'befagyott váll fórum',
      'befagyott váll akupunktúra',
      'befagyott váll csontkovács',
      'befagyott váll homeopátia',
    ],
    seoTitle: 'Befagyott váll: szakaszok és teendők',
    seoDescription:
      'Befagyott váll (adhesive capsulitis): a három szakasz, mit tehetsz otthon, milyen a torna, és mikor kell orvos. Nem diagnózis.',
    indok:
      'Monid-futás 01M0ST9XKE8HY4VC81DB7BWAAP: befagyott váll 880 keresés, KD 12. A vállfájdalom nem elsődleges; a hirdetés HOLD.',
    targy: { tipus: 'MedicalCondition', nev: 'Befagyott váll' },
  },
]

/** Egy cikk célzása slug szerint, vagy `undefined`, ha nincs hozzá mérés. */
export function kulcsszoFor(slug: string): CikkKulcsszo | undefined {
  return CIKK_KULCSSZAVAK.find((k) => k.slug === slug)
}

/**
 * Pontos kifejezéslista a CMS `seoKeywords` alakjában.
 *
 * Trim, üres kihagyás, ismétlés-szűrés, max. 48 tétel. Rangsort, volument,
 * KD-t ide tenni tilos.
 */
export function kifejezesekToSeoKeywords(kifejezesek: readonly string[]): { phrase: string }[] {
  const rows: { phrase: string }[] = []
  const seen = new Set<string>()
  for (const raw of kifejezesek) {
    const phrase = raw.trim()
    if (phrase.length === 0 || seen.has(phrase)) {
      continue
    }
    seen.add(phrase)
    rows.push({ phrase })
    if (rows.length === SEO_KEYWORDS_MAX_ROWS) {
      break
    }
  }
  return rows
}

/**
 * A mért elsődleges + másodlagos kifejezések a CMS `seoKeywords` alakjában.
 *
 * Az importer ezt írja a nyolc ismert slugra. Az elsodleges elöl áll, utána
 * a masodlagos lista. Kitalált kifejezést ide tenni tilos.
 */
export function meresToSeoKeywords(
  meres: Pick<CikkKulcsszo, 'elsodleges' | 'masodlagos'>,
): { phrase: string }[] {
  return kifejezesekToSeoKeywords([meres.elsodleges, ...meres.masodlagos])
}

/**
 * Search-lock 2026-08-24: a `pages.seoKeywords` mező tartalma slug szerint.
 *
 * Élő published pages (Railway, 2026-08-24): kapcsolat, impresszum,
 * adatvedelem, aszf, szolgaltatasok, rolunk, kezdolap. Nincs `kurzusok`
 * pages-rekord. Nincs A-gyökér pages (inhuvelygyulladas / keztoalagut-szindroma
 * / teniszkonyok 404) — ide felvenni és létrehozni tilos.
 *
 * `undefined` = szándékosan üres: ne írj kifejezést (állapot-KW tilos).
 * Csak meglévő rekord `seoKeywords` mezőjét szabad frissíteni; törzs, cím,
 * status, author, faq nem változik. Új page TILOS.
 */
export const OLDAL_KULCSSZAVAK: Readonly<Record<string, readonly string[] | undefined>> = {
  kezdolap: ['Kineticare', 'kéztorna', 'kéztorna gyakorlatok', 'otthoni gyógytorna'],
  szolgaltatasok: ['kéztorna', 'otthoni gyógytorna'],
  rolunk: ['Kiss Kata', 'Kocsis Kata', 'Kineticare'],
  kapcsolat: undefined,
  impresszum: undefined,
  adatvedelem: undefined,
  aszf: undefined,
  kurzusok: undefined,
}

/** A Search-lockolt oldalkifejezések, vagy `undefined` ha szándékosan üres / nincs lock. */
export function oldalKulcsszavakFor(slug: string): readonly string[] | undefined {
  return OLDAL_KULCSSZAVAK[slug]
}

/**
 * A pages-importer által írható CMS-sorok. Szándékosan üres locknál `undefined`:
 * a hívó nem ír kifejezést, és nem hoz létre oldalt.
 */
export function oldalSeoKeywordsFor(slug: string): { phrase: string }[] | undefined {
  const lock = oldalKulcsszavakFor(slug)
  if (lock === undefined || lock.length === 0) {
    return undefined
  }
  const rows = kifejezesekToSeoKeywords(lock)
  return rows.length > 0 ? rows : undefined
}

/**
 * Search-lock 2026-08-24: a `/kurzusok` lista meta- és JSON-LD-kulcsszavai.
 *
 * Nincs `kurzusok` pages-rekord — új page TILOS. A listing a lockolt listát
 * olvassa. A `/kezrehab` és `/kezrelax` 308-as átirányításához tilos nyúlni.
 * Primér: otthoni gyógytorna. Ugyanez a 3 kifejezés, ugyanebben a sorrendben
 * megy az `otthoni-kezrehab-program` product mezőbe.
 */
export const KURZUSLISTA_KULCSSZAVAK = [
  'otthoni gyógytorna',
  'kéztorna',
  'kéztorna gyakorlatok',
] as const

/**
 * Search-lock 2026-08-24: a `products.seoKeywords` mező slug szerint.
 *
 * SOS szándékosan üres: ne írj, ne találj ki. Más slug primére tilos.
 */
export const KURZUS_KULCSSZAVAK: Readonly<Record<string, readonly string[] | undefined>> = {
  'otthoni-kezrehab-program': KURZUSLISTA_KULCSSZAVAK,
  'sos-kezrelax-villamkurzus': undefined,
}

export function kurzusKulcsszavakFor(slug: string): readonly string[] | undefined {
  return KURZUS_KULCSSZAVAK[slug]
}

export function kurzusSeoKeywordsFor(slug: string): { phrase: string }[] | undefined {
  const lock = kurzusKulcsszavakFor(slug)
  if (lock === undefined || lock.length === 0) {
    return undefined
  }
  const rows = kifejezesekToSeoKeywords(lock)
  return rows.length > 0 ? rows : undefined
}

/**
 * A keresőben megjelenő cím felső korlátja.
 *
 * A keret-layout template-je ` | Kineticare` utótagot fűz hozzá (12 karakter),
 * ezért a NYERS cím ennyivel rövidebb kell legyen, hogy a teljes alak beférjen
 * a Google által jellemzően megjelenített ~60 karakterbe.
 */
export const SEO_TITLE_MAX = 60 - ' | Kineticare'.length

/** A leírás felső korlátja (a Google jellemzően 155–160 karaktert mutat). */
export const SEO_DESCRIPTION_MAX = 160

/** A leírás alsó korlátja: ennél rövidebb nem mond eleget. */
export const SEO_DESCRIPTION_MIN = 110
