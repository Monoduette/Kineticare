/**
 * A Tudástár cikkeinek MÉRT kulcsszó-célzása és megosztási szövegei.
 *
 * ═══ HONNAN JÖNNEK A SZÁMOK ═══
 * Nem becslés és nem ötlet: minden érték a 2026-08-21-i Monid-mérésből való.
 * Forrásonként: `docs/kulcsszavak.md` (Ahrefs kulcsszó-metrikák, country=hu),
 * `docs/monid-masodik-kor.md` (hosszú farok, szezonalitás, versenytárs-pozíciók),
 * `docs/kampanyterv-mert-adatokbol.md` (SERP és fizetett táj).
 *
 * ═══ MIÉRT KELL EZ EGYÁLTALÁN ═══
 * A `posts.seoTitle` és `seoDescription` mezője üresen maradt a betöltéskor,
 * ezért a `buildDocMetadata` fallback-lánca a cikk CÍMÉT és a BEVEZETŐJÉT
 * használta. Az így kapott cím jó magyar mondat, de nem a keresett kifejezéssel
 * kezdődik — márpedig a mérés szerint az összes célkifejezés nehézsége 0–17
 * között van, vagyis a rés valóban nyitva áll, és a pontos célzás dönt.
 *
 * ═══ A HÁROM SZABÁLY, AMI A SZÖVEGEKET ALAKÍTOTTA ═══
 * 1. **A keresett kifejezés elöl.** A cím a felhasználó SAJÁT szavával kezd,
 *    nem márkanévvel. A versenytárs 30 legerősebb oldalát lekérdezve
 *    (`docs/monid-masodik-kor.md` 3.) minden top oldal tünet-cikk, ugyanezzel a
 *    címsablonnal; a kezdőlapjuk gyengébb, mint négy cikkük.
 * 2. **A „házilag” a mi szavunk.** A `kéztő alagút szindróma kezelése házilag`
 *    havi 1 600 keresés, és a legerősebb versenytárs is csak a **6. helyen**
 *    áll rá. Ez pontosan az Otthoni KézRehab Program ígérete, ezért ahol a cikk
 *    tényleg erről szól, ott a szó bekerül a címbe.
 * 3. **Helyzet, nem téma** (`docs/seo-geo-llm.md` 2.4, Category Entry Point):
 *    az AI-promptok élethelyzeteket írnak le. A leírás ezért a beteg
 *    helyzetének elismerésével kezd, és kérdésre válaszol.
 *
 * Gondolatjeles, töltelék-elválasztós írásmód nincs — a tulajdonos kikötése
 * (`CLAUDE.md`, „Felületi (UX/UI) munka”).
 */

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
 * A hat cikk célzása, a mért megtérülés sorrendjében
 * (`docs/kulcsszavak.md` 4. „Oldalterv”).
 */
export const CIKK_KULCSSZAVAK: readonly CikkKulcsszo[] = [
  {
    slug: 'miert-zsibbad-a-kezem',
    elsodleges: 'kéz zsibbadás',
    volumen: 450,
    nehezseg: 17,
    masodlagos: ['bal kéz zsibbadás', 'kéz zsibbadás éjszaka', 'ujjak zsibbadása'],
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
      'kéztőalagút szindróma tünetei',
      'kéztőalagút műtét',
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
      'teniszkönyök kezelése házilag',
      'teniszkönyök gyakorlatok',
      'teniszkönyök házi gyógymód',
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
    masodlagos: ['pattanó ujj gyakorlatok', 'pattanó ujj műtét', 'beakadó ujj'],
    seoTitle: 'Pattanó ujj: miért akad be, és mit tehetsz?',
    seoDescription:
      'Reggel nem jön vissza magától az ujjad, aztán pattanva kiugrik? Elmondjuk, mi áll a pattanó ujj hátterében, mit tehetsz otthon, és mikor kell orvoshoz menni.',
    indok:
      'Nulla mért nehézség 800 keresés mellett. Aki elsőként ír róla rendes, szakértői cikket, az viszi az egészet.',
    targy: { tipus: 'MedicalCondition', nev: 'Pattanó ujj' },
  },
  {
    slug: 'csuklo-es-kezfajdalom',
    elsodleges: 'csuklófájdalom',
    volumen: 150,
    nehezseg: 0,
    masodlagos: ['kézfájdalom', 'alkar fájdalom', 'csukló fájdalom kezelése házilag'],
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
      'csuklótörés után mikor lehet dolgozni',
      'gipsz levétele után',
      'csuklótörés rehabilitáció',
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
      'ínhüvelygyulladás kezelése',
      'csukló ínhüvelygyulladás',
      'De Quervain',
    ],
    seoTitle: 'Ínhüvelygyulladás: tünetek és mit tehetsz',
    seoDescription:
      'Ínhüvelygyulladás: hol fáj a csuklón és a hüvelykujjon, mit tehetsz házilag, és mikor kell orvoshoz menni. Nem diagnózis.',
    indok:
      'Ahrefs HU 2200 keresés, KD 18, run 01M0SJQ0SBHS103YQ37Z6MTX1B. A De Quervain v1-ben nincs külön oldal.',
    targy: { tipus: 'MedicalCondition', nev: 'Ínhüvelygyulladás' },
  },
  {
    slug: 'befagyott-vall',
    elsodleges: 'befagyott váll',
    volumen: 880,
    nehezseg: 12,
    masodlagos: ['befagyott váll torna', 'befagyott váll szindróma', 'adhesive capsulitis'],
    seoTitle: 'Befagyott váll: szakaszok és teendők',
    seoDescription:
      'Befagyott váll (adhesive capsulitis): a három szakasz, mit tehetsz otthon, milyen a torna, és mikor kell orvos. Nem diagnózis.',
    indok:
      'Semrush HU 880 keresés, KD 12, run 01M0ST9XKE8HY4VC81DB7BWAAP. A kanonikus név a Befagyott váll, nem a csonka alak.',
    targy: { tipus: 'MedicalCondition', nev: 'Befagyott váll' },
  },
]

/** Egy cikk célzása slug szerint, vagy `undefined`, ha nincs hozzá mérés. */
export function kulcsszoFor(slug: string): CikkKulcsszo | undefined {
  return CIKK_KULCSSZAVAK.find((k) => k.slug === slug)
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
